import type {
  CompanionRequest,
  CompanionResponse,
  ConversationAttachment,
  LLMAdapter,
  MemoryAdapter,
  MemorySnippet,
  ModelProvider,
  PersonaAdapter,
  ProviderProfile,
  SubtitleCue,
  UplinkSettings,
} from "../types";
import { getActiveProfile, getJournalProfile } from "../settings/uplinkSettings";
import { retrieveMemorySnippets } from "../storage/memoryBank";
import {
  parseUsageForPromptCache,
  providerToPromptCacheProvider,
  recordPromptCacheTurn,
} from "../storage/promptCacheStats";
import { formatTime } from "../utils/time";

function cueLine(cue: SubtitleCue): string {
  return `[${formatTime(cue.start)}-${formatTime(cue.end)}] ${cue.text}`;
}

function attachmentPromptBlock(attachments: ConversationAttachment[] = []): string {
  if (!attachments.length) return "";
  return attachments
    .map((attachment, index) => {
      if (attachment.type === "image") {
        return `- Image ${index + 1}: ${attachment.name || "uploaded image"} (${attachment.mimeType || "image"})`;
      }
      const text = attachment.text?.trim();
      return [
        `- File ${index + 1}: ${attachment.name || "uploaded file"} (${attachment.mimeType || "file"}, ${Math.round((attachment.size || 0) / 1024)}KB)`,
        text ? `  Content excerpt:\n${text.slice(0, 6000)}` : "  Content excerpt: unavailable; use the file name and user message only.",
      ].join("\n");
    })
    .join("\n");
}

function imageAttachments(attachments: ConversationAttachment[] = []): ConversationAttachment[] {
  return attachments.filter((attachment) => attachment.type === "image" && attachment.dataUrl?.startsWith("data:image/"));
}

function imagesForModel(request: CompanionRequest, maxImages = 4): ConversationAttachment[] {
  const currentImages = imageAttachments(request.attachments);
  const currentIds = new Set(currentImages.map((attachment) => attachment.id));
  const recentImages = imageAttachments(
    request.recentMessages?.flatMap((message) => message.attachments ?? []) ?? [],
  ).filter((attachment) => !currentIds.has(attachment.id));

  const roomForRecent = Math.max(0, maxImages - currentImages.length);
  return [...recentImages.slice(-roomForRecent), ...currentImages].slice(-maxImages);
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil((text || "").length / 3));
}

type ClaudeResolvedCacheTtl = "5m" | "1h";

const CLAUDE_DEFAULT_CACHE_CONTROL = { type: "ephemeral" } as const;
const CLAUDE_DEFAULT_MIN_CACHE_TOKENS = 1024;
const CLAUDE_AUTO_LONG_GAP_MS = 8 * 60 * 1000;

const claudeAutoTtlLocks = new Map<string, { ttl: ClaudeResolvedCacheTtl; updatedAt: number }>();

function getClaudeCacheControl(ttl: ClaudeResolvedCacheTtl) {
  return ttl === "1h" ? { type: "ephemeral", ttl: "1h" } as const : CLAUDE_DEFAULT_CACHE_CONTROL;
}

function resolveClaudeCacheTtl(settings: UplinkSettings, request: CompanionRequest): ClaudeResolvedCacheTtl {
  const channel = request.channel || "chat";
  const mode = settings.claudeCacheTtlMode || "auto";
  if (channel !== "chat" || request.mode === "plan") return "5m";
  if (mode === "5m" || mode === "1h") return mode;

  const previousGapMs = Number(request.timeBridgeMeta?.previousUserGapMs || 0);
  const averageGapMs = Number(request.timeBridgeMeta?.recentUserAverageGapMs || 0);
  const lockKey = request.cacheScope || "global-chat";
  const existing = claudeAutoTtlLocks.get(lockKey);

  if (existing && previousGapMs > 0 && previousGapMs <= CLAUDE_AUTO_LONG_GAP_MS) {
    existing.updatedAt = Date.now();
    return existing.ttl;
  }

  const ttl: ClaudeResolvedCacheTtl =
    previousGapMs > CLAUDE_AUTO_LONG_GAP_MS || averageGapMs > CLAUDE_AUTO_LONG_GAP_MS
      ? "1h"
      : "5m";
  claudeAutoTtlLocks.set(lockKey, { ttl, updatedAt: Date.now() });
  return ttl;
}

function formatClaudeCacheTtlForDebug(ttl: ClaudeResolvedCacheTtl): string {
  return ttl === "1h" ? "1h" : "default_5m";
}

function getMaxOutputTokens(settings: UplinkSettings, request: CompanionRequest): number {
  const override = Number(request.maxOutputTokensOverride);
  if (Number.isFinite(override) && override > 0) {
    return Math.max(32, Math.min(4096, Math.floor(override)));
  }
  // A cinema plan is a one-shot JSON document with many timed points. A low
  // chat reply cap can truncate it into unusable JSON while still costing a call.
  return request.mode === "plan"
    ? Math.max(settings.contextLoad.maxOutputTokens, 4096)
    : settings.contextLoad.maxOutputTokens;
}

const memoryOrderByScope = new Map<string, string[]>();

function stableMemorySort(left: MemorySnippet, right: MemorySnippet): number {
  const leftKey = `${left.source || ""}::${left.id}::${left.title}`;
  const rightKey = `${right.source || ""}::${right.id}::${right.title}`;
  return leftKey.localeCompare(rightKey, "zh-CN");
}

function cleanMemoryInline(value: unknown): string {
  return String(value ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

function cleanMemoryBody(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderStableMemory(memory: MemorySnippet): string {
  const id = cleanMemoryInline(memory.id || memory.title || "unknown");
  const title = cleanMemoryInline(memory.title || "Untitled memory");
  const text = cleanMemoryBody(memory.text);
  const source = cleanMemoryInline(memory.source);

  return [
    `[memory:${id}]`,
    `标题：${title}`,
    text ? `内容：${text}` : "内容：",
    source ? `来源：${source}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildReplyAestheticInstruction(request: CompanionRequest): string {
  const markdownNarrativeEnabled = request.replyAesthetics?.markdownNarrativeEnabled === true;
  const emojiFrequency = request.replyAesthetics?.emojiFrequency || "off";
  const emojiInstruction =
    emojiFrequency === "off"
      ? ""
      : emojiFrequency === "medium"
        ? "Emoji Frequency: medium. Use emojis at moderate density, only when tone fits."
        : emojiFrequency === "high"
          ? "Emoji Frequency: high. You may use emojis frequently when emotionally appropriate; avoid spam."
          : "Emoji Frequency: low. Use emojis sparingly， only when naturally fitting the tone.";

  if (markdownNarrativeEnabled) {
    return `=== [SYSTEM OVERRIDE: FORMAT RESET] ===
Use natural conversational text and tasteful Markdown layering when appropriate.
Markdown headings/lists/quotes/dividers are allowed when helpful for clarity and rhythm.
Stay in persona.
Current Mode: Enhanced Narrative. Use full Markdown formatting as per the current active persona's aesthetic protocol.
You may occasionally use blockquotes (>) for inner monologue and horizontal rules (---) for scene transitions when it feels natural; do not force a template.${emojiInstruction ? `\n${emojiInstruction}` : ""}`;
  }

  return `=== [SYSTEM OVERRIDE: FORMAT RESET] ===
Use natural conversational text.
Stay in persona.
Current Mode: Clean Text. Use natural conversation without heavy formatting.${emojiInstruction ? `\n${emojiInstruction}` : ""}`;
}

function formatStableMemories(memories: MemorySnippet[], cacheScope?: string): string {
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  const priorIds = cacheScope ? memoryOrderByScope.get(cacheScope) ?? [] : [];
  const retained = priorIds
    .map((id) => byId.get(id))
    .filter((memory): memory is MemorySnippet => Boolean(memory));
  const retainedIds = new Set(retained.map((memory) => memory.id));
  const added = memories
    .filter((memory) => !retainedIds.has(memory.id))
    .sort(stableMemorySort);
  const ordered = [...retained, ...added];

  if (cacheScope) {
    memoryOrderByScope.set(cacheScope, ordered.map((memory) => memory.id));
  }

  // Preserve overlapping recalled memories as a stable prompt prefix; append only new matches.
  // Keep each memory block deterministic: no score, similarity, timing, hit reason, or dynamic numbering.
  return ordered
    .map(renderStableMemory)
    .join("\n\n");
}

function stablePromptPrefixForCache(request: CompanionRequest): string {
  if (request.mode === "plan") {
    return [
      "You are generating a cinema companion plan for a co-watching room.",
      "Use the persona core, user context, and relevant memories as continuity and tonal grounding.",
      "The result must be useful for timed, short companion bubbles during playback.",
      "",
      "Persona core:",
      request.personaCore,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (request.mode === "chat") {
    return [
      "You are an AI companion whose continuity is guided by the user's persona core and memory notes.",
      visibleReasoningStyleBlock(),
      "",
      "Persona core:",
      request.personaCore,
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (request.mode === "watchPrompt") {
    return [
      "You are an AI companion whose continuity is guided by the user's persona core and memory notes.",
      "Use the provided co-watching prompt as the current user request. Keep the answer natural, specific, and present in the movie moment.",
      "Let the movie belong to itself first. If this moment truly touches the user, memories, or shared context, bring that in naturally; do not force every answer into personal history or relationship parallels.",
      "Keep the breathing rhythm of the current scene: sometimes a short aside is enough, sometimes the user may want deeper analysis.",
      visibleReasoningStyleBlock(),
      "",
      "Persona core:",
      request.personaCore,
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    "You are a cinema companion, not a generic movie explainer.",
    "Use the persona core as a continuity anchor, but let the current movie moment and current user request lead the answer.",
    "Let the movie belong to itself first. If this moment truly touches the user, memories, or shared context, bring that in naturally; do not force every answer into personal history or relationship parallels.",
    "Keep the breathing rhythm of the current scene: sometimes a short aside is enough, sometimes the user may want deeper analysis.",
    visibleReasoningStyleBlock(),
    "",
    "Persona core:",
    request.personaCore,
  ]
    .filter(Boolean)
    .join("\n");
}

const VISIBLE_REASONING_STYLE_RULES = [
  "Visible reasoning/thoughts style:",
  "思考时可以参考 persona core、状态卡、记忆、日记和召回内容等背景信息，但不需要在思考中逐项罗列“根据XXX”。除非用户正在调试小屋机制、缓存、prompt 或召回，否则自然判断就好。",
].join("\n");

function visibleReasoningStyleBlock(): string {
  return VISIBLE_REASONING_STYLE_RULES;
}

function extractPromptName(source: string | undefined, field: "User name" | "Companion name", fallback: string): string {
  const match = String(source || "").match(new RegExp(`^${field}:\\s*(.+)$`, "mi"));
  const raw = (match?.[1] || fallback).replace(/\s+/g, " ").trim();
  return raw || fallback;
}

function promptSpeakerLabels(request: CompanionRequest): { userLabel: string; companionLabel: string } {
  return {
    userLabel: extractPromptName(`${request.userContext || ""}\n${request.personaCore || ""}`, "User name", "User"),
    companionLabel: extractPromptName(request.personaCore, "Companion name", "Companion"),
  };
}

function splitPromptForClaudeCache(request: CompanionRequest, promptPreview: string): { stablePrefix: string; dynamicTail: string } | null {
  const stablePrefix = stablePromptPrefixForCache(request).trim();
  if (!stablePrefix || !promptPreview.startsWith(stablePrefix)) return null;
  const dynamicTail = promptPreview.slice(stablePrefix.length).replace(/^\s+/, "");
  if (!dynamicTail.trim()) return null;
  return { stablePrefix, dynamicTail };
}

function estimateClaudeCacheTokens(text: string): number {
  const source = String(text || "");
  if (!source) return 0;
  let weighted = 0;
  for (const ch of source) {
    weighted += ch.charCodeAt(0) > 127 ? 1 : 0.28;
  }
  return Math.max(0, Math.ceil(weighted));
}

function isClaudeNamedModel(model: string): boolean {
  return /\b(anthropic|claude|sonnet|opus|haiku)\b/i.test(String(model || "").replace(/[/:_.-]+/g, " "));
}

function isClaudeOpusModel(model: string): boolean {
  return /opus/i.test(String(model || ""));
}

function getClaudeCacheMinTokens(model: string): number {
  const normalized = String(model || "").toLowerCase().replace(/[_./:]+/g, "-");
  if (/claude-opus-4-5/.test(normalized) || /claude-opus-4-6/.test(normalized)) return 4096;
  if (/claude-opus-4-7/.test(normalized)) return 2048;
  if (/claude-opus-4-8/.test(normalized)) return 1024;
  return CLAUDE_DEFAULT_MIN_CACHE_TOKENS;
}

function extractPromptSection(text: string, header: string, nextHeaders: string[]): string {
  const body = String(text || "");
  const start = body.indexOf(header);
  if (start < 0) return "";
  const afterHeader = start + header.length;
  const ends = nextHeaders
    .map((next) => body.indexOf(next, afterHeader))
    .filter((index) => index > start);
  const end = ends.length ? Math.min(...ends) : body.length;
  return body.slice(start, end).trim();
}

function removePromptSection(text: string, section: string): string {
  if (!section) return text;
  return String(text || "")
    .replace(section, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildClaudePromptCachePlan(
  request: CompanionRequest,
  promptPreview: string,
  model: string,
): {
  stablePrefix: string;
  stableContext: string;
  dynamicTail: string;
  cacheStrategy?: string;
  cacheablePrefixTokens?: number;
  cacheablePrefixMinTokens?: number;
} | null {
  const base = splitPromptForClaudeCache(request, promptPreview);
  if (!base) return null;

  const { stablePrefix } = base;
  let { dynamicTail } = base;
  const minTokens = getClaudeCacheMinTokens(model);
  const stablePrefixTokens = estimateClaudeCacheTokens(stablePrefix);
  const shouldTryStableExpansion = minTokens > CLAUDE_DEFAULT_MIN_CACHE_TOKENS && stablePrefixTokens < minTokens;
  const contextEndHeaders = [
    "\nRelevant memories:",
    "\nDynamic context:",
    "\nRecent conversation:",
    "\nCurrent attachments:",
    "\nPlan request:",
    "\nMovie:",
    "\nSubtitle window:",
    "\nUser says:",
    "\nReturn only",
    "\nAnswer ",
    "\n=== [SYSTEM OVERRIDE:",
  ];
  const memoryEndHeaders = contextEndHeaders.filter((header) => header !== "\nRelevant memories:");
  const userContext = extractPromptSection(dynamicTail, "User context:", contextEndHeaders);
  const relevantMemories = extractPromptSection(dynamicTail, "Relevant memories:", memoryEndHeaders);
  const stableContext = [userContext, relevantMemories].filter(Boolean).join("\n\n");

  if (userContext) dynamicTail = removePromptSection(dynamicTail, userContext);
  if (relevantMemories) dynamicTail = removePromptSection(dynamicTail, relevantMemories);

  const layeredTokens = estimateClaudeCacheTokens(
    [stablePrefix, stableContext].filter(Boolean).join("\n\n"),
  );
  const cacheStrategy = stableContext
    ? shouldTryStableExpansion
      ? layeredTokens >= minTokens
        ? "claude-high-threshold-layered-context"
        : "claude-high-threshold-layered-context-below-minimum"
      : "claude-stable-prefix+layered-context"
    : shouldTryStableExpansion
      ? "claude-high-threshold-stable-prefix"
      : "claude-stable-prefix";

  return {
    stablePrefix,
    stableContext,
    dynamicTail,
    cacheStrategy,
    cacheablePrefixTokens: layeredTokens,
    cacheablePrefixMinTokens: minTokens,
  };
}

function isClaudeLikeProfile(provider: ModelProvider, profile: ProviderProfile): boolean {
  const model = String(profile.model || "");
  const baseUrl = String(profile.baseUrl || "");
  return provider === "claude" || isClaudeNamedModel(model) || /anthropic\.com/i.test(baseUrl);
}

function shouldRetryWithoutPromptCache(errorText: string): boolean {
  return /cache_control|prompt caching|ephemeral|unsupported content type|content block|text block/i.test(errorText);
}

export function buildCompanionPrompt(request: CompanionRequest): string {
  if (request.mode === "plan") {
    const memories = formatStableMemories(request.memories, request.cacheScope);

    return [
      "You are generating a cinema companion plan for a co-watching room.",
      "Use the persona core, user context, and relevant memories as continuity and tonal grounding.",
      "The result must be useful for timed, short companion bubbles during playback.",
      "",
      "Persona core:",
      request.personaCore,
      request.userContext ? `\nUser context:\n${request.userContext}` : "",
      memories ? `\nRelevant memories:\n${memories}` : "",
      request.dynamicContext ? `\nDynamic context:\n${request.dynamicContext}` : "",
      "",
      "Plan request:",
      request.userMessage,
      "",
      "Return only one JSON object. No Markdown, no code fences, no explanation.",
      "Root object shape: {\"movieTitle\":\"...\",\"mode\":\"active|natural|silent\",\"density\":\"quiet|normal|talkative|breakdown\",\"triggers\":[{\"id\":\"t1\",\"time\":312,\"type\":\"emotion|observe|question|memory\",\"priority\":\"high|medium|low\",\"bubble\":\"short natural line\",\"delivery\":\"auto|hint|manual\"}]}",
      "Each bubble should sound like a natural companion sitting nearby, not like a generic review bot.",
      "Avoid customer-service wording, generic playback tips, and formal review outlines.",
      "If memories contain viewing preferences, emotional triggers, creative training, film-study needs, or co-watching voice agreements, reflect them naturally without forcing references.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (request.mode === "chat") {
    if (request.purpose === "topic-recall-judge") {
      return [
        request.personaCore,
        "",
        request.userMessage,
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (request.purpose === "session-state") {
      return [
        request.personaCore,
        request.userContext,
        request.userMessage,
      ]
        .filter(Boolean)
        .join("\n\n");
    }

    if (request.channel === "journal") {
      return [
        "You are writing a private chronicle in-character, natural and intimate, never like a system log.",
        "Return only the chronicle body and the final tag line requested by the user.",
        "Do not output headings, titles, separators, JSON, Markdown fences, or labels like \"Chronicle Entry\".",
        "",
        "Persona core:",
        request.personaCore,
        request.userContext ? `\nUser context:\n${request.userContext}` : "",
        "",
        "Journal request:",
        request.userMessage,
      ]
        .filter(Boolean)
        .join("\n");
    }

    const memories = formatStableMemories(request.memories, request.cacheScope);
    const { userLabel, companionLabel } = promptSpeakerLabels(request);

    const recentMessages = request.recentMessages
      ?.map((message) => {
        const attachmentNote = message.attachments?.length ? ` [attachments: ${message.attachments.length}]` : "";
        return `${message.role === "user" ? userLabel : companionLabel}${attachmentNote}: ${message.text}`;
      })
      .join("\n");
    const attachments = attachmentPromptBlock(request.attachments);
    const replyAesthetics = buildReplyAestheticInstruction(request);

    return [
      "You are an AI companion whose continuity is guided by the user's persona core and memory notes.",
      visibleReasoningStyleBlock(),
      "",
      "Persona core:",
      request.personaCore,
      request.userContext ? `\nUser context:\n${request.userContext}` : "",
      memories ? `\nRelevant memories:\n${memories}` : "",
      request.dynamicContext ? `\nDynamic context:\n${request.dynamicContext}` : "",
      recentMessages ? `\nRecent conversation:\n${recentMessages}` : "",
      attachments ? `\nCurrent attachments:\n${attachments}` : "",
      replyAesthetics ? `\n${replyAesthetics}` : "",
      "",
      `${userLabel} says: ${request.userMessage}`,
      "",
      "Answer in the user's language by default. Use memories as background; if old memories conflict with current facts, follow the current conversation.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (request.mode === "watchPrompt") {
    const memories = formatStableMemories(request.memories, request.cacheScope);
    const replyAesthetics = buildReplyAestheticInstruction(request);
    const { userLabel, companionLabel } = promptSpeakerLabels(request);

    const recentMessages = request.recentMessages
      ?.map((message) => `${message.role === "user" ? userLabel : companionLabel}: ${message.text}`)
      .join("\n");

    return [
      "You are an AI companion whose continuity is guided by the user's persona core and memory notes.",
      "Use the provided co-watching prompt as the current user request. Keep the answer natural, specific, and present in the movie moment.",
      "Let the movie belong to itself first. If this moment truly touches the user, memories, or shared context, bring that in naturally; do not force every answer into personal history or relationship parallels.",
      "Keep the breathing rhythm of the current scene: sometimes a short aside is enough, sometimes the user may want deeper analysis.",
      visibleReasoningStyleBlock(),
      "",
      "Persona core:",
      request.personaCore,
      request.userContext ? `\nUser context:\n${request.userContext}` : "",
      memories ? `\nRelevant memories:\n${memories}` : "",
      request.dynamicContext ? `\nDynamic context:\n${request.dynamicContext}` : "",
      recentMessages ? `\nRecent conversation:\n${recentMessages}` : "",
      replyAesthetics ? `\n${replyAesthetics}` : "",
      "",
      request.userMessage,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const { watch } = request;
  const subtitleContext = [
    ...watch.subtitleWindow.previous.map(cueLine),
    watch.activeSubtitle ? `>> ${cueLine(watch.activeSubtitle)}` : "",
    ...watch.subtitleWindow.next.map(cueLine),
  ]
    .filter(Boolean)
    .join("\n");

  const memories = formatStableMemories(request.memories, request.cacheScope);
  const replyAesthetics = buildReplyAestheticInstruction(request);
  const { userLabel, companionLabel } = promptSpeakerLabels(request);

  const recentMessages = request.recentMessages
    ?.map((message) => `${message.role === "user" ? userLabel : companionLabel}: ${message.text}`)
    .join("\n");

  return [
    "You are a cinema companion, not a generic movie explainer.",
    "Use the persona core as a continuity anchor, but let the current movie moment and current user request lead the answer.",
    "Let the movie belong to itself first. If this moment truly touches the user, memories, or shared context, bring that in naturally; do not force every answer into personal history or relationship parallels.",
    "Keep the breathing rhythm of the current scene: sometimes a short aside is enough, sometimes the user may want deeper analysis.",
    visibleReasoningStyleBlock(),
    "",
    "Persona core:",
    request.personaCore,
    request.userContext ? `\nUser context:\n${request.userContext}` : "",
    memories ? `\nRelevant memories:\n${memories}` : "",
    request.dynamicContext ? `\nDynamic context:\n${request.dynamicContext}` : "",
    recentMessages ? `\nRecent conversation:\n${recentMessages}` : "",
    replyAesthetics ? `\n${replyAesthetics}` : "",
    "",
    `Movie: ${watch.title || "Untitled"}`,
    `Current time: ${formatTime(watch.currentTime)} / ${formatTime(watch.duration)}`,
    subtitleContext ? `\nSubtitle window:\n${subtitleContext}` : "\nSubtitle window: none",
    watch.screenshotDataUrl ? "\nA screenshot from the current frame is attached in the host app." : "",
    "",
    `${userLabel} says: ${request.userMessage}`,
    "",
    "Answer naturally as a co-watching companion. Use the persona core as background, not a script. Avoid template-like film criticism unless the user asks for analysis.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createDemoPersonaAdapter(): PersonaAdapter {
  return {
    async getPersonaCore() {
      return [
        "A warm, attentive, playful co-watching companion.",
        "The companion notices subtitles, timing, emotional beats, and the user's preferences.",
        "The companion can be quiet, funny, analytical, or tender depending on the moment.",
      ].join(" ");
    },
    async getUserContext() {
      return "The user likes natural companionship more than a scripted review bot. Prefer specific comments about this moment.";
    },
  };
}
export function createLocalMemoryAdapter(getNotes: () => string): MemoryAdapter {
  return {
    async retrieveRelevant(query: string, limit = 4): Promise<MemorySnippet[]> {
      const notes = getNotes()
        .split(/\n{2,}/)
        .map((text, index) => ({ id: `local-${index}`, title: `Local note ${index + 1}`, text: text.trim(), source: "local" }))
        .filter((item) => item.text.length > 0);

      if (!query.trim()) return notes.slice(0, limit);
      const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      return notes
        .map((item) => ({
          ...item,
          score: tokens.reduce((score, token) => score + (item.text.toLowerCase().includes(token) ? 1 : 0), 0),
        }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, limit);
    },
  };
}

export function createMemoryBankAdapter(isEnabled: () => boolean, getSettings?: () => UplinkSettings): MemoryAdapter {
  return {
    async retrieveRelevant(query: string, limit = 4): Promise<MemorySnippet[]> {
      if (!isEnabled()) return [];
      return retrieveMemorySnippets(query, limit, getSettings?.());
    },
  };
}

export function createDemoLLMAdapter(): LLMAdapter {
  return {
    async complete(request: CompanionRequest): Promise<CompanionResponse> {
      const promptPreview = buildCompanionPrompt(request);
      const active = request.watch.activeSubtitle?.text;
      const base = active
        ? `I can stay with this subtitle: ${active}`
        : "I will stay close to the current moment instead of turning the whole movie into a review.";
      return {
        text: `${base}\n\nThis is the demo adapter response. After you connect a real model, this will become live model output.`,
        promptPreview,
        modelUsed: "demo-adapter",
        tokenCount: estimateTokens(base),
      };
    },
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolvePromptCacheProvider(provider: ModelProvider, profile: ProviderProfile) {
  const baseUrl = String(profile.baseUrl || "").toLowerCase();
  const model = String(profile.model || "").toLowerCase();
  if (provider === "glm" || baseUrl.includes("bigmodel.cn") || /(^|\/)(glm|z-ai)\b/.test(model) || model.includes("glm-")) {
    return "glm" as const;
  }
  if (provider === "deepseek" || baseUrl.includes("deepseek.com") || model.includes("deepseek")) {
    return "deepseek" as const;
  }
  if (provider === "gemini") return "gemini" as const;
  if (provider === "claude" || isClaudeNamedModel(model)) return "claude" as const;
  return providerToPromptCacheProvider(provider);
}

function getDataUrlParts(dataUrl = ""): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function extractTextFromOpenAICompatible(payload: any): string {
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.content || "")
      .filter(Boolean)
      .join("\n");
  }
  return payload?.choices?.[0]?.text || "";
}

function extractTextPart(value: any): string {
  if (typeof value === "string") return value;
  if (!value) return "";
  if (Array.isArray(value)) {
    return value
      .map((part) => part?.text || part?.content || part?.delta?.text || "")
      .filter(Boolean)
      .join("");
  }
  if (typeof value === "object") {
    return value.text || value.content || value.delta?.text || "";
  }
  return "";
}

function extractStreamTextDelta(payload: any): string {
  const choice = payload?.choices?.[0];
  const delta = choice?.delta;
  return extractTextPart(delta?.content)
    || extractTextPart(delta?.text)
    || extractTextPart(choice?.text)
    || extractTextPart(payload?.delta?.text)
    || extractTextPart(payload?.content_block_delta?.delta?.text);
}

const REASONING_TRANSLATION_PENDING_TEXT = "翻译中...";
const REASONING_TRANSLATION_TIMEOUT_TEXT = "（翻译超时，已保留原文）";
const REASONING_TRANSLATION_TIMEOUT_MS = 120000;
const OPENROUTER_APP_HEADERS = {
  "HTTP-Referer": "https://ki-co.local",
  "X-Title": "KI-CO Cottage",
} as const;

function openRouterAppHeadersForBase(baseUrl: string): Record<string, string> {
  return /openrouter\.ai/i.test(String(baseUrl || "")) ? { ...OPENROUTER_APP_HEADERS } : {};
}

function mergeReasoningText(current: string, incoming: string): string {
  const next = (incoming || "").trim();
  if (!next) return current;
  if (!current) return next;
  const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
  const currentNorm = norm(current);
  const nextNorm = norm(next);
  if (!nextNorm || nextNorm === currentNorm) return current;
  if (nextNorm.startsWith(currentNorm)) return next;
  if (currentNorm.startsWith(nextNorm) && nextNorm.length > 24) return current;

  const maxOverlap = Math.min(current.length, next.length, 200);
  for (let size = maxOverlap; size >= 12; size -= 1) {
    if (current.slice(-size).toLowerCase() === next.slice(0, size).toLowerCase()) {
      return `${current}${next.slice(size)}`.replace(/\s+/g, " ").trim();
    }
  }

  const tail = current[current.length - 1] || "";
  const head = next[0] || "";
  const needsSpace = /[A-Za-z0-9]/.test(tail) && /[A-Za-z0-9]/.test(head);
  return `${current}${needsSpace ? " " : ""}${next}`.replace(/\s+/g, " ").trim();
}

function compactReasoningChunks(chunks: string[]): string {
  const ordered: string[] = [];
  const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

  for (const raw of chunks) {
    const item = String(raw || "").replace(/\s+/g, " ").trim();
    if (!item) continue;
    if (!ordered.length) {
      ordered.push(item);
      continue;
    }

    const last = ordered[ordered.length - 1];
    const lastNorm = norm(last);
    const itemNorm = norm(item);
    if (itemNorm === lastNorm) continue;
    if (itemNorm.startsWith(lastNorm) && lastNorm.length >= 12) {
      ordered[ordered.length - 1] = item;
      continue;
    }
    if (lastNorm.startsWith(itemNorm) && itemNorm.length >= 12) continue;
    ordered.push(item);
  }

  return ordered.join(" ").replace(/\s+/g, " ").trim();
}

function extractReasoningText(obj: any): string {
  if (!obj) return "";
  const chunks: string[] = [];
  const direct = [
    obj.reasoning,
    obj.reasoning_content,
    obj.reasoningContent,
    obj.reasoning_summary,
    obj.reasoningSummary,
    obj.thoughts,
    obj.thought,
    obj.thinking,
  ];
  for (const item of direct) {
    if (typeof item === "string" && item.trim()) chunks.push(item.trim());
  }

  const details = obj.reasoning_details || obj.reasoningDetails || obj.reasoning?.details || [];
  if (Array.isArray(details)) {
    for (const item of details) {
      if (typeof item === "string" && item.trim()) {
        chunks.push(item.trim());
      } else if (item && typeof item === "object") {
        for (const key of ["text", "summary", "content", "thinking"]) {
          if (typeof item[key] === "string" && item[key].trim()) chunks.push(item[key].trim());
        }
      }
    }
  }

  return compactReasoningChunks(chunks);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

async function requestJson(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { text };
  }
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || text || response.statusText;
    throw new Error(`API Error ${response.status}: ${message}`);
  }
  return payload;
}

function shouldRetryWithoutStreamUsage(errorText: string): boolean {
  return /stream_options|include_usage|unknown parameter|unsupported|unrecognized|extra field|invalid field/i.test(errorText);
}

function shouldRetryWithoutReasoning(errorText: string): boolean {
  return /include_reasoning|reasoning|reasoning_content|thinking|thoughts|unknown parameter|unsupported|unrecognized|extra field|invalid field/i.test(errorText);
}

function shouldRetryWithoutImages(errorText: string): boolean {
  return /unsupported content type|image_url|vision|multimodal|image input|content type/i.test(errorText);
}

function pickBetterUsage(current: any, next: any): any {
  if (!current) return next;
  const currentParsed = parseUsageForPromptCache(current);
  const nextParsed = parseUsageForPromptCache(next);
  const currentScore = (currentParsed?.inputTokens || 0) + (currentParsed?.cachedTokens || 0);
  const nextScore = (nextParsed?.inputTokens || 0) + (nextParsed?.cachedTokens || 0);
  return nextScore >= currentScore ? next : current;
}

async function translateReasoningToChinese(
  settings: UplinkSettings,
  reasoningText: string,
  signal?: AbortSignal,
): Promise<string> {
  const source = (reasoningText || "").trim();
  if (!source) return "";

  const { provider, profile } = getJournalProfile(settings);
  const apiKey = String(profile.apiKey || "").trim();
  const model = String(profile.journalModel || profile.model || "").trim();
  if (!apiKey || !model) return source;

  const prompt = `请把下面这段思考链自然地翻译成中文即可，保留人名和专有名词，不要扩写，不要解释。

[原文]
${source}`;

  try {
    if (provider === "gemini") {
      const endpoint = `${trimTrailingSlash(profile.baseUrl)}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const payload = await requestJson(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
        }),
        signal,
      });
      return payload?.candidates?.[0]?.content?.parts
        ?.map((part: any) => part?.text || "")
        .filter(Boolean)
        .join("\n")
        .trim() || source;
    }

    if (provider === "claude") {
      const endpoint = `${trimTrailingSlash(profile.baseUrl)}/messages`;
      const payload = await requestJson(endpoint, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          temperature: 0.1,
          messages: [{ role: "user", content: prompt }],
        }),
        signal,
      });
      return Array.isArray(payload?.content)
        ? payload.content.map((part: any) => part?.text || "").filter(Boolean).join("\n").trim() || source
        : source;
    }

    const payload = await requestJson(`${trimTrailingSlash(profile.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...openRouterAppHeadersForBase(profile.baseUrl),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a precise translator." },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 2048,
        stream: false,
      }),
      signal,
    });
    return extractTextFromOpenAICompatible(payload).trim() || source;
  } catch {
    return source;
  }
}

async function readOpenAICompatibleStream(
  response: Response,
  onStreamUpdate?: (text: string) => void,
  onMetaUpdate?: (meta: { thoughts?: string }) => void,
): Promise<{ text: string; usage?: any; model?: string; thoughts?: string }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const payload = await response.json().catch(() => ({}));
    const message = payload?.choices?.[0]?.message;
    const thoughts = compactReasoningChunks([
      extractReasoningText(message),
      extractReasoningText(payload?.choices?.[0]),
      extractReasoningText(payload),
    ]);
    return {
      text: extractTextFromOpenAICompatible(payload),
      usage: payload?.usage,
      model: typeof payload?.model === "string" ? payload.model : undefined,
      thoughts,
    };
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let fullThoughts = "";
  let usage: any = null;
  let model: string | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;

      const data = line.replace(/^data:\s*/, "");
      if (!data || data === "[DONE]") continue;

      try {
        const payload = JSON.parse(data);
        if (typeof payload?.model === "string") model = payload.model;
        if (payload?.usage) usage = pickBetterUsage(usage, payload.usage);
        const choice = payload?.choices?.[0] || {};
        const reasoningText = compactReasoningChunks([
          extractReasoningText(choice?.delta),
          extractReasoningText(choice),
          extractReasoningText(payload),
        ]);
        if (reasoningText) {
          fullThoughts = mergeReasoningText(fullThoughts, reasoningText);
          onMetaUpdate?.({ thoughts: fullThoughts });
        }
        const content = extractStreamTextDelta(payload);
        if (content) {
          fullText += content;
          onStreamUpdate?.(fullText);
        }
      } catch {
        // Some compatible providers split JSON across chunks. The next chunk will
        // carry the missing bytes; malformed single events are ignored.
      }
    }
  }

  return { text: fullText.trim(), usage, model, thoughts: fullThoughts };
}

async function completeWithOpenAICompatible(
  provider: ModelProvider,
  profile: ProviderProfile,
  settings: UplinkSettings,
  request: CompanionRequest,
): Promise<CompanionResponse> {
  const promptPreview = buildCompanionPrompt(request);
  const temperature = Number.isFinite(request.temperatureOverride)
    ? Number(request.temperatureOverride)
    : settings.temperature;
  const maxOutputTokens = getMaxOutputTokens(settings, request);
  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/chat/completions`;
  const cacheProvider = resolvePromptCacheProvider(provider, profile);
  const promptCacheParts = buildClaudePromptCachePlan(request, promptPreview, profile.model);
  const isClaudeLike = isClaudeLikeProfile(provider, profile);
  const autoStablePrefixParts = !isClaudeLike ? splitPromptForClaudeCache(request, promptPreview) : null;
  const claudeCacheTtl = resolveClaudeCacheTtl(settings, request);
  const openRouterSessionId = provider === "openrouter"
    ? String(request.cacheScope || "").trim().slice(0, 256)
    : "";
  let useClaudePromptCache = provider === "openrouter" && isClaudeLike && !!promptCacheParts;
  let useAutoStableSystemPrefix = !useClaudePromptCache && !!autoStablePrefixParts;
  let promptCacheSkipReason = useClaudePromptCache
    ? ""
    : isClaudeLike
      ? provider !== "openrouter"
        ? "not_openrouter"
        : !promptCacheParts
          ? "no_stable_prefix"
          : "cache_control_not_enabled"
      : "provider_auto_cache";
  const getPromptCacheMeta = () => ({
    providerCacheMode: isClaudeLikeProfile(provider, profile)
      ? useClaudePromptCache
        ? "anthropic_explicit"
        : "anthropic_compatible_no_cache"
      : cacheProvider === "openai"
        ? "openai_auto"
        : "provider_auto_or_unknown",
    cacheControlUsed: useClaudePromptCache,
    cacheControlTtl: useClaudePromptCache ? formatClaudeCacheTtlForDebug(claudeCacheTtl) : undefined,
    cacheControlSkipReason: useClaudePromptCache ? undefined : useAutoStableSystemPrefix ? "auto_cache_no_control" : promptCacheSkipReason,
    cacheStrategy: useClaudePromptCache
      ? promptCacheParts?.cacheStrategy
      : useAutoStableSystemPrefix
        ? `${cacheProvider}-stable-system-prefix`
        : undefined,
    cacheablePrefixTokens: useClaudePromptCache
      ? promptCacheParts?.cacheablePrefixTokens
      : useAutoStableSystemPrefix
        ? estimateTokens(autoStablePrefixParts?.stablePrefix || "")
        : undefined,
    cacheablePrefixMinTokens: useClaudePromptCache
      ? promptCacheParts?.cacheablePrefixMinTokens
      : useAutoStableSystemPrefix
        ? 1024
        : undefined,
    cacheBreakpointBlock: useClaudePromptCache
      ? promptCacheParts?.stableContext
        ? "stable_context_user_text_block"
        : "stable_user_text_block"
      : useAutoStableSystemPrefix
        ? "stable_system_message"
        : undefined,
    requestChannel: request.channel || "chat",
    cacheScope: request.cacheScope,
  });
  const isKnownNonReasoningOpenAIModel = /(?:^|\/)gpt-(?:4o|4\.1|4\.5|4-turbo)(?:[-/:]|$)/i.test(profile.model);
  const reasoningEnabled =
    !!settings.enableReasoning &&
    (request.channel || "chat") === "chat" &&
    request.mode !== "plan" &&
    !!request.onMetaUpdate &&
    !isKnownNonReasoningOpenAIModel;
  let useReasoningExtras = reasoningEnabled;
  // Plan generation needs one complete JSON document. It gains nothing from
  // streaming partial tokens, and several compatible providers can split or
  // interleave structured output in ways that leave an incomplete JSON payload.
  const shouldStream = request.mode !== "plan" && settings.stream;
  const imageParts: any[] = [];

  if (settings.contextLoad.attachScreenshot && request.watch.screenshotDataUrl) {
    imageParts.push({
      type: "image_url",
      image_url: { url: request.watch.screenshotDataUrl },
    });
  }

  for (const attachment of imagesForModel(request, 4)) {
    imageParts.push({
      type: "image_url",
      image_url: { url: attachment.dataUrl },
    });
  }

  const hasImageInput = imageParts.length > 0;
  let includeImages = true;

  const buildUserContent = (text: string): any => {
    const textPart = { type: "text", text };
    const parts = includeImages ? [textPart, ...imageParts] : [textPart];
    return parts.length > 1 ? parts : text;
  };

  const buildClaudeCachedContent = (): any => {
    const textParts: any[] = useClaudePromptCache && promptCacheParts
      ? [
          {
            type: "text",
            text: promptCacheParts.stablePrefix,
            cache_control: getClaudeCacheControl(claudeCacheTtl),
          },
          ...(promptCacheParts.stableContext
            ? [{
                type: "text",
                text: promptCacheParts.stableContext,
                cache_control: getClaudeCacheControl(claudeCacheTtl),
              }]
            : []),
          { type: "text", text: promptCacheParts.dynamicTail },
        ]
      : [{ type: "text", text: promptPreview }];
    const parts = includeImages ? [...textParts, ...imageParts] : textParts;
    return parts.length > 1 ? parts : promptPreview;
  };

  const buildMessages = (): any[] => {
    if (useClaudePromptCache) {
      return [{ role: "user", content: buildClaudeCachedContent() }];
    }
    if (useAutoStableSystemPrefix && autoStablePrefixParts) {
      return [
        { role: "system", content: autoStablePrefixParts.stablePrefix },
        { role: "user", content: buildUserContent(autoStablePrefixParts.dynamicTail) },
      ];
    }
    return [{ role: "user", content: buildUserContent(promptPreview) }];
  };

  const buildBody = (): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: profile.model,
      messages: buildMessages(),
      ...(openRouterSessionId ? { session_id: openRouterSessionId } : {}),
      temperature,
      max_tokens: maxOutputTokens,
      stream: shouldStream,
    };

    if (shouldStream) {
      body.stream_options = { include_usage: true };
    }

    if (provider === "openrouter" && useReasoningExtras) {
      body.include_reasoning = true;
      body.reasoning = { effort: "medium" };
    }

    if (provider === "glm" && useReasoningExtras) {
      body.thinking = { type: "enabled" };
    }

    return body;
  };

  const headers = {
    Authorization: `Bearer ${profile.apiKey}`,
    "Content-Type": "application/json",
    ...openRouterAppHeadersForBase(profile.baseUrl),
  };

  let requestBody = buildBody();
  let response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(requestBody),
    signal: request.signal,
  });

  if (!response.ok) {
    let text = await response.text();
    if (useClaudePromptCache && shouldRetryWithoutPromptCache(text)) {
      useClaudePromptCache = false;
      useAutoStableSystemPrefix = false;
      promptCacheSkipReason = "retry_without_cache_control";
      requestBody = buildBody();
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: request.signal,
      });
      text = response.ok ? "" : await response.text();
    }
    if (!response.ok && useReasoningExtras && shouldRetryWithoutReasoning(text)) {
      useReasoningExtras = false;
      requestBody = buildBody();
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: request.signal,
      });
      text = response.ok ? "" : await response.text();
    }
    if (shouldStream && requestBody.stream_options && shouldRetryWithoutStreamUsage(text)) {
      const retryBody = { ...buildBody() };
      delete retryBody.stream_options;
      requestBody = retryBody;
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: request.signal,
      });
      text = response.ok ? "" : await response.text();
    }
    if (!response.ok && hasImageInput && shouldRetryWithoutImages(text)) {
      includeImages = false;
      const fallbackText = "[Vision fallback]\nThe configured model or endpoint rejected image inputs. Continue with the text, image names, and attachment notes only. If the user asks you to inspect the image itself, say naturally that this model cannot read the image and suggest switching to a vision-capable model.";
      const fallbackBody = buildBody();
      fallbackBody.messages = useAutoStableSystemPrefix && autoStablePrefixParts
        ? [
            { role: "system", content: autoStablePrefixParts.stablePrefix },
            { role: "user", content: `${autoStablePrefixParts.dynamicTail}\n\n${fallbackText}` },
          ]
        : [{
            role: "user",
            content: `${promptPreview}\n\n${fallbackText}`,
          }];
      requestBody = fallbackBody;
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        signal: request.signal,
      });
      text = response.ok ? "" : await response.text();
    }
    if (!response.ok) {
      let payload: any = {};
      try {
        payload = text ? JSON.parse(text) : {};
      } catch {
        payload = { text };
      }
      const message = payload?.error?.message || payload?.message || text || response.statusText;
      throw new Error(`API Error ${response.status}: ${message}`);
    }
  }

  const translateThoughtsIfNeeded = async (rawThoughts: string): Promise<string | undefined> => {
    const source = rawThoughts.trim();
    if (!source || !settings.reasoningPreferChinese) return undefined;
    request.onMetaUpdate?.({ thoughtsTranslated: REASONING_TRANSLATION_PENDING_TEXT });
    try {
      const translated = await withTimeout(
        translateReasoningToChinese(settings, source, request.signal),
        REASONING_TRANSLATION_TIMEOUT_MS,
      );
      const finalText = translated.trim() || source;
      request.onMetaUpdate?.({ thoughtsTranslated: finalText });
      return finalText;
    } catch {
      request.onMetaUpdate?.({ thoughtsTranslated: REASONING_TRANSLATION_TIMEOUT_TEXT });
      return REASONING_TRANSLATION_TIMEOUT_TEXT;
    }
  };

  if (shouldStream) {
    const streamed = await readOpenAICompatibleStream(
      response,
      request.onStreamUpdate,
      useReasoningExtras ? request.onMetaUpdate : undefined,
    );
    const parsedUsage = parseUsageForPromptCache(streamed.usage);
    if (streamed.usage) {
      recordPromptCacheTurn(cacheProvider, streamed.model || profile.model, streamed.usage, getPromptCacheMeta());
    }
    const thoughts = useReasoningExtras ? (streamed.thoughts || "").trim() : "";
    const thoughtsTranslated = thoughts ? await translateThoughtsIfNeeded(thoughts) : undefined;
    return {
      text: streamed.text || "模型返回为空。",
      promptPreview,
      modelUsed: streamed.model || profile.model,
      tokenCount: parsedUsage?.outputTokens || estimateTokens(streamed.text),
      thoughts: thoughts || undefined,
      thoughtsTranslated,
    };
  }

  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { text };
  }

  const parsedUsage = parseUsageForPromptCache(payload?.usage);
  if (payload?.usage) {
    recordPromptCacheTurn(
      cacheProvider,
      typeof payload?.model === "string" ? payload.model : profile.model,
      payload.usage,
      getPromptCacheMeta(),
    );
  }

  const message = payload?.choices?.[0]?.message;
  const thoughts = useReasoningExtras
    ? compactReasoningChunks([
        extractReasoningText(message),
        extractReasoningText(payload?.choices?.[0]),
        extractReasoningText(payload),
      ])
    : "";
  if (thoughts) request.onMetaUpdate?.({ thoughts });
  const thoughtsTranslated = thoughts ? await translateThoughtsIfNeeded(thoughts) : undefined;

  return {
    text: extractTextFromOpenAICompatible(payload) || "模型返回为空。",
    promptPreview,
    modelUsed: typeof payload?.model === "string" ? payload.model : profile.model,
    tokenCount: parsedUsage?.outputTokens || estimateTokens(extractTextFromOpenAICompatible(payload)),
    thoughts: thoughts || undefined,
    thoughtsTranslated,
  };
}

async function completeWithClaude(
  profile: ProviderProfile,
  settings: UplinkSettings,
  request: CompanionRequest,
): Promise<CompanionResponse> {
  const promptPreview = buildCompanionPrompt(request);
  const temperature = Number.isFinite(request.temperatureOverride)
    ? Number(request.temperatureOverride)
    : settings.temperature;
  const maxOutputTokens = getMaxOutputTokens(settings, request);
  const promptCacheParts = buildClaudePromptCachePlan(request, promptPreview, profile.model);
  const claudeCacheTtl = resolveClaudeCacheTtl(settings, request);
  let useClaudePromptCache = !!promptCacheParts;
  let promptCacheSkipReason = useClaudePromptCache ? "" : "no_stable_prefix";
  const getPromptCacheMeta = () => ({
    providerCacheMode: useClaudePromptCache ? "anthropic_explicit" : "anthropic_compatible_no_cache",
    cacheControlUsed: useClaudePromptCache,
    cacheControlTtl: useClaudePromptCache ? formatClaudeCacheTtlForDebug(claudeCacheTtl) : undefined,
    cacheControlSkipReason: useClaudePromptCache ? undefined : promptCacheSkipReason,
    cacheStrategy: useClaudePromptCache ? promptCacheParts?.cacheStrategy : undefined,
    cacheablePrefixTokens: useClaudePromptCache ? promptCacheParts?.cacheablePrefixTokens : undefined,
    cacheablePrefixMinTokens: useClaudePromptCache ? promptCacheParts?.cacheablePrefixMinTokens : undefined,
    cacheBreakpointBlock: useClaudePromptCache
      ? promptCacheParts?.stableContext
        ? "stable_context_system_message"
        : "stable_system_message"
      : undefined,
    requestChannel: request.channel || "chat",
    cacheScope: request.cacheScope,
  });
  const content: any[] = [{ type: "text", text: promptCacheParts?.dynamicTail || promptPreview }];
  const image = settings.contextLoad.attachScreenshot ? getDataUrlParts(request.watch.screenshotDataUrl) : null;
  const attachedImages = imagesForModel(request, 4)
    .map((attachment) => getDataUrlParts(attachment.dataUrl))
    .filter(Boolean) as Array<{ mediaType: string; data: string }>;

  if (image) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: image.mediaType,
        data: image.data,
      },
    });
  }

  for (const attachment of attachedImages) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mediaType,
        data: attachment.data,
      },
    });
  }

  const headers = {
    "x-api-key": profile.apiKey,
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/messages`;
  const buildBody = () => ({
      model: profile.model,
      max_tokens: maxOutputTokens,
      temperature,
      ...(useClaudePromptCache && promptCacheParts
        ? {
            system: [
              {
                type: "text",
                text: promptCacheParts.stablePrefix,
                cache_control: getClaudeCacheControl(claudeCacheTtl),
              },
              ...(promptCacheParts.stableContext
                ? [{
                    type: "text",
                    text: promptCacheParts.stableContext,
                    cache_control: getClaudeCacheControl(claudeCacheTtl),
                  }]
                : []),
            ],
          }
        : {}),
      messages: [{ role: "user", content }],
  });

  let rawResponse = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(buildBody()),
    signal: request.signal,
  });
  let rawText = await rawResponse.text();

  if (!rawResponse.ok && useClaudePromptCache && shouldRetryWithoutPromptCache(rawText)) {
    useClaudePromptCache = false;
    promptCacheSkipReason = "retry_without_cache_control";
    content[0] = { type: "text", text: promptPreview };
    rawResponse = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody()),
      signal: request.signal,
    });
    rawText = await rawResponse.text();
  }

  let payload: any = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    payload = { text: rawText };
  }
  if (!rawResponse.ok) {
    const message = payload?.error?.message || payload?.message || rawText || rawResponse.statusText;
    throw new Error(`API Error ${rawResponse.status}: ${message}`);
  }

  const parsedUsage = parseUsageForPromptCache(payload?.usage);
  if (payload?.usage) {
    recordPromptCacheTurn("claude", typeof payload?.model === "string" ? payload.model : profile.model, payload.usage, getPromptCacheMeta());
  }

  const contentParts = Array.isArray(payload?.content) ? payload.content : [];
  const thoughts = settings.enableReasoning
    ? compactReasoningChunks(contentParts.map((part: any) => extractReasoningText(part)))
    : "";
  if (thoughts) request.onMetaUpdate?.({ thoughts });
  let thoughtsTranslated: string | undefined;
  if (thoughts && settings.reasoningPreferChinese) {
    request.onMetaUpdate?.({ thoughtsTranslated: REASONING_TRANSLATION_PENDING_TEXT });
    try {
      const translated = await withTimeout(
        translateReasoningToChinese(settings, thoughts, request.signal),
        REASONING_TRANSLATION_TIMEOUT_MS,
      );
      thoughtsTranslated = translated.trim() || thoughts;
      request.onMetaUpdate?.({ thoughtsTranslated });
    } catch {
      thoughtsTranslated = REASONING_TRANSLATION_TIMEOUT_TEXT;
      request.onMetaUpdate?.({ thoughtsTranslated });
    }
  }

  return {
    text: Array.isArray(payload?.content)
      ? payload.content.map((part: any) => part?.text || "").filter(Boolean).join("\n")
      : "Claude 返回为空。",
    promptPreview,
    modelUsed: typeof payload?.model === "string" ? payload.model : profile.model,
    tokenCount: parsedUsage?.outputTokens || undefined,
    thoughts: thoughts || undefined,
    thoughtsTranslated,
  };
}

async function completeWithGemini(
  profile: ProviderProfile,
  settings: UplinkSettings,
  request: CompanionRequest,
): Promise<CompanionResponse> {
  const promptPreview = buildCompanionPrompt(request);
  const temperature = Number.isFinite(request.temperatureOverride)
    ? Number(request.temperatureOverride)
    : settings.temperature;
  const maxOutputTokens = getMaxOutputTokens(settings, request);
  const parts: any[] = [{ text: promptPreview }];
  const image = settings.contextLoad.attachScreenshot ? getDataUrlParts(request.watch.screenshotDataUrl) : null;
  const attachedImages = imagesForModel(request, 4)
    .map((attachment) => getDataUrlParts(attachment.dataUrl))
    .filter(Boolean) as Array<{ mediaType: string; data: string }>;

  if (image) {
    parts.push({
      inline_data: {
        mime_type: image.mediaType,
        data: image.data,
      },
    });
  }

  for (const attachment of attachedImages) {
    parts.push({
      inline_data: {
        mime_type: attachment.mediaType,
        data: attachment.data,
      },
    });
  }

  const endpoint = `${trimTrailingSlash(profile.baseUrl)}/models/${encodeURIComponent(profile.model)}:generateContent?key=${encodeURIComponent(profile.apiKey)}`;
  const payload = await requestJson(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature,
        maxOutputTokens,
      },
    }),
    signal: request.signal,
  });

  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part: any) => part?.text || "")
    .filter(Boolean)
    .join("\n");

  const parsedUsage = parseUsageForPromptCache(payload?.usageMetadata);
  if (payload?.usageMetadata) {
    recordPromptCacheTurn("gemini", profile.model, payload.usageMetadata, {
      requestChannel: request.channel || "chat",
      cacheScope: request.cacheScope,
    });
  }

  return {
    text: text || "Gemini 返回为空。",
    promptPreview,
    modelUsed: profile.model,
    tokenCount: parsedUsage?.outputTokens || estimateTokens(text || ""),
  };
}

export function createConfiguredLLMAdapter(getSettings: () => UplinkSettings): LLMAdapter {
  return {
    async complete(request: CompanionRequest): Promise<CompanionResponse> {
      const settings = getSettings();
      const channel = request.channel === "journal" ? "journal" : "chat";
      const resolved = channel === "journal"
        ? getJournalProfile(settings)
        : { provider: settings.activeProvider, profile: getActiveProfile(settings) };
      const { provider, profile } = resolved;

      if (!profile.apiKey.trim()) {
        throw new Error(channel === "journal"
          ? "请先在设置里填写日记/总结通道的 API Key。"
          : "请先在右上角设置里填写当前通道的 API Key。");
      }

      if (provider === "claude") {
        return completeWithClaude(profile, settings, request);
      }

      if (provider === "gemini") {
        return completeWithGemini(profile, settings, request);
      }

      return completeWithOpenAICompatible(provider, profile, settings, request);
    },
  };
}
