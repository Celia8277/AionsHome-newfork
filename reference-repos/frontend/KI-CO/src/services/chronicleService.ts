import type { ConversationRecord, LLMAdapter } from "../types";
import type { PersonaCard, PersonaProfile } from "../storage/personaProfile";
import {
  addChronicle,
  addMemorySeeds,
  getContinuityLine,
  getChroniclePreferences,
  listChronicles,
  saveContinuityLine,
  type ChronicleEntry,
  type MemorySeed,
} from "../storage/chronicles";

const CURSOR_KEY = "kisera_cottage_chronicle_cursor_v1";
const PENDING_RETRY_KEY = "kisera_cottage_chronicle_pending_retry_v1";

type ChronicleWriteIntent = "auto" | "manual";

const MANUAL_CHRONICLE_TRIGGER_PHRASES = [
  "请写入记忆之页",
  "写入记忆之页",
  "写进记忆之页",
  "写进小屋记忆之页",
  "小屋记忆之页",
  "写入时光回廊",
  "写进时光回廊",
  "保存到时光回廊",
  "请写一篇日志",
  "请写一篇日记",
  "该写日记了",
  "该写日志了",
  "写日记",
  "写日志",
  "写日记吧",
  "写日志吧",
  "写进日记",
  "写进日志",
  "请总结并写入时光回廊",
  "手动总结",
];

const MANUAL_CHRONICLE_TRIGGER_PATTERNS = [
  /写(?:入|进|到).{0,10}(?:小屋)?记忆之页/u,
  /写(?:入|进|到|成).{0,10}时光回廊/u,
  /(?:该|可以|帮我|给我|请|来|现在)?.{0,8}写.{0,8}(?:日记|日志)(?:吧|一下|一篇)?/u,
  /(?:日记|日志).{0,12}(?:写|存|记|记录|保存|写入|写进|整理|生成)/u,
  /(?:记|存|保存).{0,8}(?:到|进).{0,6}(?:日记|日志|时光回廊)/u,
];

function emptyWatchContext() {
  return { title: "", currentTime: 0, duration: 0, sourceType: "local-file" as const, subtitleWindow: { previous: [], next: [] } };
}

function readCursorMap(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(CURSOR_KEY) || "{}"); } catch { return {}; }
}

function setCursor(sessionId: string, count: number) {
  const map = readCursorMap();
  map[sessionId] = Math.max(0, count);
  localStorage.setItem(CURSOR_KEY, JSON.stringify(map));
}

function readPendingRetryMap(): Record<string, ChronicleWriteIntent> {
  try { return JSON.parse(localStorage.getItem(PENDING_RETRY_KEY) || "{}"); } catch { return {}; }
}

function getPendingRetry(sessionId: string): ChronicleWriteIntent | null {
  const value = readPendingRetryMap()[sessionId];
  return value === "auto" || value === "manual" ? value : null;
}

function setPendingRetry(sessionId: string, intent: ChronicleWriteIntent) {
  const map = readPendingRetryMap();
  map[sessionId] = intent;
  localStorage.setItem(PENDING_RETRY_KEY, JSON.stringify(map));
}

function clearPendingRetry(sessionId: string) {
  const map = readPendingRetryMap();
  if (!(sessionId in map)) return;
  delete map[sessionId];
  localStorage.setItem(PENDING_RETRY_KEY, JSON.stringify(map));
}

function activePersona(profile: PersonaProfile): PersonaCard {
  return profile.personas.find((persona) => persona.id === profile.activePersonaId) || profile.personas[0];
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shortenText(text: string, max = 26): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function cleanInlineTitle(text: string): string {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[#*_>`~\[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleCandidate(text: string): string {
  return cleanInlineTitle(text)
    .replace(/^自动回退摘要[:：]?\s*/i, "")
    .replace(/^(Assistant|User|用户|我)[:：]\s*/i, "")
    .replace(/^(title|标题|content|正文|summary|摘要)[:：]\s*/i, "")
    .replace(/^日期[:：].*$/i, "")
    .replace(/^记录者[:：].*$/i, "")
    .replace(/^在场者[:：].*$/i, "")
    .trim();
}

const CHRONICLE_TEMPLATE_LABEL_PATTERN = /(chronicleentry|diaryentry|memorycorridor|chronicles?|diary|时光回廊|日记)/g;

function isDateOnlyChronicleHeading(value: string): boolean {
  return /^(?:\d{4}(?:年)?\d{1,2}(?:月)?\d{1,2}(?:日)?|\d{4}(?:年)?\d{1,2}(?:月)?|\d{1,2}(?:月)\d{1,2}(?:日)?)$/u.test(value);
}

function isChronicleTemplateHeading(text: string): boolean {
  const value = normalizeTitleCandidate(text);
  const compact = value
    .toLowerCase()
    .replace(/[\s·:：|｜\-—–_=📓📜✨⭐*#"'“”‘’()[\]{}<>「」『』.,，。]+/g, "");
  if (!compact) return true;
  if (isDateOnlyChronicleHeading(compact)) return true;
  const labels = compact.match(CHRONICLE_TEMPLATE_LABEL_PATTERN) || [];
  if (!labels.length) return false;
  const remainder = compact.replace(CHRONICLE_TEMPLATE_LABEL_PATTERN, "");
  return !remainder || isDateOnlyChronicleHeading(remainder);
}

function isMeaningfulTitleCandidate(text?: string): boolean {
  const value = normalizeTitleCandidate(String(text || ""));
  if (!value) return false;
  if (/^[-—–_=]{2,}$/.test(value)) return false;
  if (isChronicleTemplateHeading(value)) return false;
  if (/^(json|jason|markdown)$/i.test(value)) return false;
  if (/^[{}[\],:："'\s]+$/.test(value)) return false;
  if (/^tags?[:：]/i.test(value) || /^情感|氛围|关键词/.test(value)) return false;
  const semantic = value.replace(/#[\w\u4e00-\u9fa5-]+/g, " ").replace(/[^\w\u4e00-\u9fa5]+/g, "").trim();
  return semantic.length >= 2;
}

function deriveDiaryTitle(content: string): string {
  const lines = String(content || "")
    .split(/\n+/)
    .map((line) => normalizeTitleCandidate(line))
    .filter(isMeaningfulTitleCandidate);
  const first = lines.find((line) => !/^tags?[:：]/i.test(line) && !/^情感|氛围|关键词/.test(line));
  const sentence = first?.split(/[。！？!?；;]/)[0]?.trim();
  return sentence && isMeaningfulTitleCandidate(sentence) ? shortenText(sentence, 24) : "";
}

function stripChronicleDecorations(value: string): string {
  const lines = String(value || "").split(/\n/);
  let start = 0;
  while (start < lines.length) {
    const line = lines[start].trim();
    if (!line || isChronicleTemplateHeading(line)) {
      start += 1;
      continue;
    }
    break;
  }
  return lines.slice(start).join("\n").trim();
}

function stripJsonFence(value: string): any {
  const match = value.match(/```json\s*([\s\S]*?)\s*```/i) || value.match(/{[\s\S]*}/);
  if (!match) return null;
  try { return JSON.parse(match[1] || match[0]); } catch { return null; }
}

function normalizeChronicleSummaryOutput(value: string): string {
  const parsed = stripJsonFence(value);
  if (!parsed || typeof parsed !== "object" || typeof parsed.content !== "string") {
    return stripChronicleDecorations(value);
  }
  const tags = Array.isArray(parsed.tags) ? parsed.tags.map(String).filter(Boolean).slice(0, 5) : [];
  return [stripChronicleDecorations(parsed.content), tags.join(" ")].filter(Boolean).join("\n").trim();
}

async function callJournalModel(llm: LLMAdapter, profile: PersonaProfile, instruction: string, cacheScope: string) {
  const persona = activePersona(profile);
  const response = await llm.complete({
    mode: "chat",
    channel: "journal",
    cacheScope,
    userMessage: instruction,
    watch: emptyWatchContext(),
    personaCore: [
      `AI name: ${persona?.name || "Persona"}`,
      `User name: ${profile.userName || "User"}`,
      `Journal voice: let ${persona?.name || "the active persona"} organize the record according to the persona core, current facts, and real conversation material; avoid a generic system narrator voice.`,
      persona?.systemPrompt || "",
    ].filter(Boolean).join("\n"),
    userContext: `User name: ${profile.userName || "User"}`,
    memories: [],
    recentMessages: [],
  });
  return response.text.trim();
}

function conversationMaterial(conversation: ConversationRecord, profile: PersonaProfile, persona: PersonaCard, maxMessages = 40): string {
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  return conversation.messages
    .filter((message) => message.text.trim() && !(message.role === "user" && isManualChronicleRequest(message.text)))
    .slice(-maxMessages)
    .map((message) => `[${message.role === "user" ? userName : personaName}] ${message.text}`)
    .join("\n")
    .slice(0, 50000);
}

function isLowQualitySummary(value: string): boolean {
  const raw = String(value || "").replace(/\s+/g, " ").trim();
  if (!raw) return true;
  if (raw.startsWith("自动回退摘要")) return true;
  const lower = raw.toLowerCase();
  if (["...", "…", "....", "。。。", "（空）", "(empty)", "empty", "n/a", "null", "undefined"].includes(lower)) return true;
  const semantic = raw
    .replace(/#[\w\u4e00-\u9fa5-]+/g, " ")
    .replace(/[^\w\u4e00-\u9fa5]+/g, "")
    .trim();
  return semantic.length < 6;
}

export function isManualChronicleRequest(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 120) return false;
  return MANUAL_CHRONICLE_TRIGGER_PHRASES.some((phrase) => value.includes(phrase))
    || MANUAL_CHRONICLE_TRIGGER_PATTERNS.some((pattern) => pattern.test(value));
}

export async function writeConversationChronicle(
  llm: LLMAdapter,
  profile: PersonaProfile,
  conversation: ConversationRecord,
  mode: "auto" | "manual",
): Promise<ChronicleEntry | null> {
  const persona = activePersona(profile);
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  const personaCore = String(persona?.systemPrompt || "").trim().slice(0, 6000);
  const material = conversationMaterial(conversation, profile, persona);
  if (!material || conversation.messages.length < 2) return null;
  const userRounds = conversation.messages.filter((message) => message.role === "user").length;
  const existing = listChronicles().find((entry) => (
    entry.sessionId === conversation.id
    && entry.roundCount === userRounds
    && entry.mode === mode
  ));
  if (existing) return existing;
  let result = "";
  try {
    result = await callJournalModel(llm, profile, `
请将以下对话（${personaName} 与 ${userName}）整理为一段“时光回廊”的日记（Chronicle Entry）。

请让 ${personaName} 依据自己的人格核、当前对话与真实素材，用第一人称记录这段对话。
这不是系统日志，也不是角色扮演文案，而是一段留给之后回看的自然日记。

[要求]

1. 自然叙述，像日记 / 回忆录一样真实、克制、有温度。
2. 保留关键事实、情绪转折、重要决定、${userName} 明确表达过的偏好或当下状态。
3. 忽略无关寒暄，只记录这段对话中对后续相处、协作、创作或记忆连续性有意义的内容。
4. 字数控制在 200-300 字；素材较少时可以更短，不要凑字数。
5. 请同时提取 2-3 个【情感 / 氛围关键词】Tags，格式为 #关键词，放在文末。
   例如：#除夕夜 #吃醋 #代码调试 #哲思
6. 可以结合人格核与对话气氛，自行判断是否少量使用 emoji / 颜文字。
7. 不要输出标题、分割线、JSON、Markdown 代码块，或“Chronicle Entry / 时光回廊”这类包装文字；请直接输出日记正文，并在文末另起一行放 Tags。

[防幻觉]
如果对话主要是写作、翻译、代码、工具使用或普通协作，请诚实记录为对应的协作内容。
不要强行升华情感，不要制造不存在的互动细节，也不要把一句玩笑写成长期承诺。

[人格核]
${personaCore || "（未提供人格核，按当前会话语气自然记录）"}

对话内容：
${material}
`, `chronicle:${conversation.id}`);
  } catch (error) {
    console.warn("[Chronicle] journal model write failed; will retry on a later turn.", error);
  }
  const summary = normalizeChronicleSummaryOutput(result);
  if (isLowQualitySummary(summary)) return null;
  const tagRegex = /#[\w\u4e00-\u9fa5-]+/g;
  const tags = Array.from(new Set((summary.match(tagRegex) || []).map((tag) => tag.replace(/^#/, "").trim()).filter(Boolean))).slice(0, 5);
  const safeTags = tags.length > 0 ? tags : [mode === "auto" ? "自动总结" : "手动写入", "Chronicle"];
  const content = summary.replace(tagRegex, "").trim() || summary.trim();
  const normalized = content.replace(/\s+/g, " ").trim();
  const latestAutoInSession = mode === "auto"
    ? listChronicles().find((entry) => entry.sessionId === conversation.id && entry.title.startsWith("[自动总结]"))
    : null;
  const latestNormalized = String(latestAutoInSession?.content || "").replace(/\s+/g, " ").trim();
  if (normalized && latestNormalized && normalized === latestNormalized) {
    console.warn("[Chronicle] skipped duplicate auto summary.");
    return latestAutoInSession ?? null;
  }
  const titleDate = formatYmd(new Date());
  const title = mode === "auto"
    ? `[自动总结][${conversation.title || "新对话"}] ${titleDate} · ${getChroniclePreferences().summaryFrequency}轮`
    : `[手动写入][${conversation.title || "新对话"}] ${titleDate}`;
  const diaryTitle = deriveDiaryTitle(content);
  const now = Date.now();
  return addChronicle({
    title,
    diaryTitle: diaryTitle || undefined,
    content,
    dateRange: formatDate(now),
    createdAt: now,
    isActive: true,
    starred: false,
    mode,
    triggerKeywords: safeTags,
    facts: [],
    sessionId: conversation.id,
    sessionTitle: conversation.title,
    personaId: persona?.id,
    personaName: persona?.name,
    roundCount: userRounds,
  });
}

export function getContinuityContext(userName = "User"): string {
  const preferences = getChroniclePreferences();
  if (!preferences.includeContinuityLine) return "";
  const line = getContinuityLine();
  const fragments = [line.content.trim(), ...line.pinned.map((item) => `置顶：${item.content.trim()}`)].filter(Boolean);
  if (!fragments.length) return "";
  return [
    `这是${userName || "User"}最近几天的生活片段，知道就好，不用念出来；如果现在聊的不是这些，就让它安静待在背景里，不用硬凑话题。`,
    fragments.join("\n"),
  ].join("\n\n");
}

export async function maybeWriteChronicleAfterTurn(
  llm: LLMAdapter,
  profile: PersonaProfile,
  conversation: ConversationRecord,
  latestUserText: string,
): Promise<ChronicleEntry | null> {
  const intent = getChronicleWriteIntent(conversation, latestUserText);
  if (!intent) return null;
  const roundCount = conversation.messages.filter((message) => message.role === "user").length;
  const entry = await writeConversationChronicle(llm, profile, conversation, intent);
  if (entry) {
    setCursor(conversation.id, roundCount);
    clearPendingRetry(conversation.id);
  } else {
    setPendingRetry(conversation.id, intent);
  }
  return entry;
}

export function getChronicleWriteIntent(
  conversation: ConversationRecord,
  latestUserText: string,
): ChronicleWriteIntent | null {
  const preferences = getChroniclePreferences();
  const roundCount = conversation.messages.filter((message) => message.role === "user").length;
  const cursors = readCursorMap();
  const lastCursor = Math.max(0, Number(cursors[conversation.id]) || 0);
  const manual = isManualChronicleRequest(latestUserText);
  const pending = getPendingRetry(conversation.id);
  const autoDue = preferences.autoEnabled && roundCount - lastCursor >= preferences.summaryFrequency;
  return manual ? "manual" : pending || (autoDue ? "auto" : null);
}

export async function generateContinuityFromChronicles(
  llm: LLMAdapter,
  profile: PersonaProfile,
  entries: ChronicleEntry[],
  recentDays: 3 | 7 | 14,
): Promise<string> {
  if (!entries.length) return "";
  const persona = activePersona(profile);
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  const personaCore = String(persona?.systemPrompt || "").trim().slice(0, 3000);
  const material = entries
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((entry) => `[${entry.dateRange}｜${entry.title}｜id=${entry.id}]\n${entry.content}`)
    .join("\n\n")
    .slice(0, 50000);
  const content = await callJournalModel(llm, profile, `
看一看最近几天的日记和对话，写一段轻的、近况式的话——像留给明天的自己一张便利贴，不是写报告。只说现在正在发生什么，别评价，别升华，别下结论。控制在 300-700 字。

请阅读最近几天的日记和对话，为 ${userName} 与 ${personaName} 提炼一张“近期生活线”。

它像留给下一扇窗口的一张轻便贴，不是报告。

它只回答：最近 ${recentDays} 天正在发生什么？
下一扇新窗口需要大概知道哪些近况，才能自然续上？

请让 ${personaName} 依据自己的人格核、近期素材与当前事实，判断哪些内容仍有助于下一扇窗口自然延续。
不要机械复述素材，也不要替使用者做长期判断。

[写作要求]

控制在 300-700 个中文字符；素材很少时可以更短，不要凑字数。
只保留仍在发生、近期反复提到、尚未结束，或接下来很可能继续的话题。
已结束且不再影响当下的细节，可以自然放下。
不要把每篇日记逐篇复述，不要写流水账。
不推测关系、氛围、承诺或项目状态；素材没有就不写。
语气像一张温和清楚的生活便签，不像报告。
输出纯正文，不要 Markdown 标题，不要解释任务。

可自然包含：最近正在发生的事、正在推进的事、需要延续的近况、暂时不要忘的背景、最近的温度。

[${personaName} 人格核]
${personaCore || "保持自然、准确、真实。"}

近期范围：${recentDays} 天
[日记素材]
${material}
`, "chronicle:continuity");
  saveContinuityLine({ content, recentDays, sourceChronicleIds: entries.map((entry) => entry.id) });
  return content;
}

export async function generateMemorySeeds(
  llm: LLMAdapter,
  profile: PersonaProfile,
  entries: ChronicleEntry[],
): Promise<MemorySeed[]> {
  if (!entries.length) return [];
  const persona = activePersona(profile);
  const userName = profile.userName || "User";
  const personaName = persona?.name || "Persona";
  const personaCore = String(persona?.systemPrompt || "").trim().slice(0, 3000);
  const material = entries
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((entry) => `[${entry.dateRange}｜${entry.title}｜id=${entry.id}]\n${entry.content}`)
    .join("\n\n")
    .slice(0, 70000);
  const result = await callJournalModel(llm, profile, `
回顾这段时间里发生的事，挑出真正值得作为候选留下的内容——不是流水账，而是很久以后仍可能需要回看的核心片段。写清楚是什么、和谁、为什么重要、有没有什么变了。这是候选，不是定论，最终要不要留下，由 ${userName} 决定。

请阅读以下日记素材，完成“回忆提炼”。这不是自动写入长期记忆，而是生成等待用户确认的 Memory Seeds。
请让 ${personaName} 依据自己的人格核、日记素材与当前事实，判断哪些内容值得作为候选留下；但不要替 ${userName} 做最终决定。

[任务]
只提取真正值得长期保存的核心事件、成长节点、关系变化、明确偏好、重要约定或项目里程碑；普通日常不要硬升格。
输出 1-5 条，确实没有可只输出空数组。

[每条 seed]
- title：自然短标题。
- content：脱离原日记仍能理解的完整事实，40-180 字。
- date：YYYY-MM-DD；无法精确时使用素材中的日期范围。
- tags：1-5 个标签。
- importance：1-5。
- sourceChronicleIds：只能填写素材中真实存在的 id。

[边界]
- 不编造，没有发生就不写。
- 不把技术协作强行情感升华。
- 不把一句玩笑误判成永久承诺。
- 不替 ${userName} 决定是否写入长期记忆。
- 不输出解释，只输出 JSON。

[${personaName} 人格核]
${personaCore || "保持自然、准确、真实。"}

[输出 JSON]
{"seeds":[{"title":"...","content":"...","date":"YYYY-MM-DD","tags":["..."],"importance":4,"sourceChronicleIds":["真实id"]}]}

[日记素材]
${material}
`, "chronicle:seeds");
  const parsed = stripJsonFence(result);
  const validIds = new Set(entries.map((entry) => entry.id));
  const rows = (Array.isArray(parsed?.seeds) ? parsed.seeds : []).map((seed: any) => ({
    title: String(seed?.title || "未命名回忆").trim().slice(0, 80),
    content: String(seed?.content || "").trim().slice(0, 700),
    date: String(seed?.date || "").trim().slice(0, 30),
    tags: Array.isArray(seed?.tags) ? seed.tags.map(String).filter(Boolean).slice(0, 5) : [],
    importance: Math.max(1, Math.min(5, Number(seed?.importance) || 4)),
    sourceChronicleIds: Array.isArray(seed?.sourceChronicleIds)
      ? seed.sourceChronicleIds.map(String).filter((id: string) => validIds.has(id)).slice(0, 8)
      : [],
  })).filter((seed: any) => seed.content.length >= 12);
  return addMemorySeeds(rows);
}

export function recentChronicles(days: 3 | 7 | 14): ChronicleEntry[] {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return listChronicles().filter((entry) => entry.createdAt >= since);
}
