import { randomUUID } from 'expo-crypto';
import { chatCompletion, type ChatCompletionResponse } from './api';
import { searchNeteaseTrack } from './neteaseMusic';
import type { MusicTrack } from '../stores/music';
import type { APIConfig, Conversation, Message } from '../types';
import {
  createConversation,
  getAllConversations,
  getFavoriteDiaries,
  getMessagesByConversation,
  insertMessage,
  updateConversation,
} from '../db/operations';
import { useChatStore } from '../stores/chat';

interface RadioSongSuggestion {
  title: string;
  artist?: string;
  query?: string;
  roleInProgram?: string;
  reason?: string;
}

interface RadioPlan {
  title: string;
  theme: string;
  thesis: string;
  summary: string;
  songs: RadioSongSuggestion[];
  reason?: string;
}

export interface RadioScriptSegment {
  type: 'cold_open' | 'resume_open' | 'bridge' | 'call_in' | 'closing' | 'silence';
  position: 'before_track' | 'between_tracks' | 'after_track';
  trackIndex?: number;
  afterTrackIndex?: number;
  beforeTrackIndex?: number;
  text: string;
}

export interface RadioProgram {
  title: string;
  theme: string;
  thesis: string;
  summary: string;
  reason?: string;
  tracks: MusicTrack[];
  skipped: RadioSongSuggestion[];
  segments: RadioScriptSegment[];
}

interface RadioGenerationOptions {
  apiConfig: APIConfig;
  neteaseBaseUrl: string;
  neteaseCookie: string;
  currentTracks: MusicTrack[];
  conversationId: string;
  systemPrompt: string;
  count?: number;
}

interface ContinueRadioOptions extends RadioGenerationOptions {
  previousProgram: RadioProgram;
  callInStartedAt: number;
}

interface ScriptPlan {
  title: string;
  summary: string;
  segments: RadioScriptSegment[];
  reason?: string;
}

const JSON_OUTPUT_RULES =
  '请输出严格 JSON。JSON 字符串内部引用用户原话、歌词、节目标题或任何短语时，优先使用单引号；如果必须使用英文双引号，必须写成 \\"。';

function logRadioJsonError(stage: string, details: Record<string, unknown>): void {
  console.error(`[AI Radio] JSON parse failed at ${stage}`, details);
  if (typeof details.rawContent === 'string') {
    console.error(`[AI Radio] Raw response at ${stage}:\n${details.rawContent}`);
  }
  if (typeof details.slicedJson === 'string') {
    console.error(`[AI Radio] Sliced JSON at ${stage}:\n${details.slicedJson}`);
  }
  if (typeof details.repairedJson === 'string') {
    console.error(`[AI Radio] Repaired JSON at ${stage}:\n${details.repairedJson}`);
  }
}

function repairUnescapedQuotesInJsonStrings(jsonText: string): string {
  let repaired = '';
  let inString = false;
  let escaping = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const char = jsonText[index];

    if (!inString) {
      repaired += char;
      if (char === '"') inString = true;
      continue;
    }

    if (escaping) {
      repaired += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      repaired += char;
      escaping = true;
      continue;
    }

    if (char === '"') {
      const nextNonWhitespace = jsonText.slice(index + 1).match(/\S/)?.[0];
      const closesString =
        !nextNonWhitespace || nextNonWhitespace === ':' || nextNonWhitespace === ',' || nextNonWhitespace === '}' || nextNonWhitespace === ']';

      if (closesString) {
        repaired += char;
        inString = false;
      } else {
        repaired += '\\"';
      }
      continue;
    }

    repaired += char;
  }

  return repaired;
}

function findBalancedJsonObject(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start < 0) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === '\\') {
        escaping = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function addJsonCandidate(candidates: string[], candidate: string | null | undefined): void {
  const trimmed = candidate?.trim();
  if (!trimmed || candidates.includes(trimmed)) return;
  candidates.push(trimmed);
}

function buildJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const trimmed = text.trim();
  addJsonCandidate(candidates, trimmed);

  const fenceRegex = /```(?:json|JSON)?\s*([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRegex.exec(trimmed))) {
    addJsonCandidate(candidates, fenceMatch[1]);
  }

  for (const candidate of [...candidates]) {
    addJsonCandidate(candidates, findBalancedJsonObject(candidate));
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    addJsonCandidate(candidates, trimmed.slice(start, end + 1));
  }

  return candidates;
}

function extractJsonObject(text: string, stage: string): unknown {
  const candidates = buildJsonCandidates(text);
  let lastError: unknown;

  for (const jsonText of candidates) {
    try {
      return JSON.parse(jsonText);
    } catch (parseError) {
      lastError = parseError;
      const repairedJson = repairUnescapedQuotesInJsonStrings(jsonText);
      if (repairedJson === jsonText) continue;

      try {
        const parsed = JSON.parse(repairedJson);
        console.warn(`[AI Radio] JSON repaired at ${stage}: escaped unescaped quotes inside JSON strings.`);
        return parsed;
      } catch (repairError) {
        lastError = repairError;
      }
    }
  }

  logRadioJsonError(stage, {
    reason: candidates.length > 0 ? 'json-candidates-parse-failed' : 'no-json-candidate',
    error: lastError,
    rawLength: text.length,
    rawContent: text,
    slicedJson: candidates[0],
  });
  throw new Error(`AI 电台 JSON 解析失败（${stage}），完整响应已输出到控制台`);
}

function assertRadioResponseNotTruncated(response: ChatCompletionResponse, stage: string): void {
  const finishReason = response.choices[0]?.finish_reason;
  if (!finishReason) return;

  const normalized = String(finishReason).toLowerCase();
  if (normalized === 'length' || normalized.includes('max_token') || normalized.includes('max_output')) {
    throw new Error(`AI 电台输出被模型截断（${stage}，finish_reason=${finishReason}）。请重试，或在设置中换用更大输出上限的模型。`);
  }
}

function normalizeSong(item: unknown): RadioSongSuggestion | null {
  if (typeof item === 'string') {
    const [title, ...artistParts] = item.split(' - ');
    const cleanTitle = title?.trim();
    if (!cleanTitle) return null;
    return {
      title: cleanTitle,
      artist: artistParts.join(' - ').trim() || undefined,
      query: item.trim(),
    };
  }

  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  const artist = typeof raw.artist === 'string' ? raw.artist.trim() : '';
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  const roleInProgram = typeof raw.roleInProgram === 'string' ? raw.roleInProgram.trim() : '';
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  if (!title && !query) return null;

  return {
    title: title || query,
    artist: artist || undefined,
    query: query || [title, artist].filter(Boolean).join(' - '),
    roleInProgram: roleInProgram || undefined,
    reason: reason || undefined,
  };
}

function normalizePlan(value: unknown): RadioPlan {
  if (!value || typeof value !== 'object') {
    throw new Error('AI 电台返回格式不正确');
  }

  const raw = value as Record<string, unknown>;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : 'AI 电台';
  const theme = typeof raw.theme === 'string' ? raw.theme.trim() : '';
  const thesis = typeof raw.thesis === 'string' ? raw.thesis.trim() : '';
  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 100) : '';
  const rawSongs = Array.isArray(raw.songs) ? raw.songs : [];
  const songs = rawSongs
    .map(normalizeSong)
    .filter((song): song is RadioSongSuggestion => !!song);

  if (songs.length === 0) {
    throw new Error('AI 电台没有生成歌曲');
  }

  return {
    title,
    theme: theme || title,
    thesis,
    summary: summary || `${title}：${theme || thesis || '今天的主题节目'}`.slice(0, 100),
    songs,
    reason: typeof raw.reason === 'string' ? raw.reason.trim() : undefined,
  };
}

function normalizeSegment(item: unknown): RadioScriptSegment | null {
  if (!item || typeof item !== 'object') return null;
  const raw = item as Record<string, unknown>;
  const rawType = raw.type;
  const type =
    rawType === 'resume_open' ||
    rawType === 'bridge' ||
    rawType === 'call_in' ||
    rawType === 'closing' ||
    rawType === 'silence'
      ? rawType
      : 'cold_open';
  const position =
    raw.position === 'between_tracks' || raw.position === 'after_track'
      ? raw.position
      : 'before_track';
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';

  return {
    type,
    position,
    trackIndex: typeof raw.trackIndex === 'number' ? raw.trackIndex : undefined,
    afterTrackIndex: typeof raw.afterTrackIndex === 'number' ? raw.afterTrackIndex : undefined,
    beforeTrackIndex: typeof raw.beforeTrackIndex === 'number' ? raw.beforeTrackIndex : undefined,
    text,
  };
}

function normalizeScriptPlan(value: unknown, fallbackTitle: string, fallbackSummary: string): ScriptPlan {
  if (!value || typeof value !== 'object') {
    throw new Error('AI 电台脚本格式不正确');
  }

  const raw = value as Record<string, unknown>;
  const segments = (Array.isArray(raw.segments) ? raw.segments : [])
    .map(normalizeSegment)
    .filter((segment): segment is RadioScriptSegment => !!segment);
  const summary = typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 100) : '';

  return {
    title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : fallbackTitle,
    summary: summary || fallbackSummary.slice(0, 100),
    segments,
    reason: typeof raw.reason === 'string' ? raw.reason.trim() : undefined,
  };
}

function formatCurrentQueue(tracks: MusicTrack[]): string {
  if (tracks.length === 0) return '(empty)';
  return tracks
    .slice(0, 12)
    .map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`)
    .join('\n');
}

function formatTracksForPrompt(tracks: MusicTrack[]): string {
  return tracks
    .map((track, index) => `${index}. ${track.title} - ${track.artist}${track.album ? ` (${track.album})` : ''}`)
    .join('\n');
}

function formatProgramForPrompt(program: RadioProgram): string {
  const tracks = program.tracks
    .map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`)
    .join('\n');
  const lines = program.segments
    .filter((segment) => segment.text.trim())
    .map((segment) => `- ${segment.type}/${segment.position}: ${segment.text}`)
    .join('\n');

  return [
    `节目标题：${program.title}`,
    `主题：${program.theme}`,
    `核心观察：${program.thesis}`,
    `摘要：${program.summary}`,
    `已播放歌曲：\n${tracks || '(无)'}`,
    `已播主持词：\n${lines || '(无)'}`,
  ].join('\n\n');
}

async function getMemoryAndChatContext(conversationId: string, since?: number): Promise<string> {
  const [messages, favoriteDiaries] = await Promise.all([
    getMessagesByConversation(conversationId),
    getFavoriteDiaries().catch(() => []),
  ]);

  const scopedMessages = since
    ? messages.filter((message) => message.createdAt >= since)
    : messages.slice(-24);
  const chat = scopedMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'user' ? '用户' : 'AI'}: ${message.content}`)
    .join('\n');
  const memories = favoriteDiaries
    .slice(0, 8)
    .map((diary) => `${diary.title}\n${diary.content}`)
    .join('\n\n---\n\n');

  return [
    memories ? `# 记忆\n${memories}` : '# 记忆\n（暂无收藏日记）',
    chat ? `# 聊天记录\n${chat}` : '# 聊天记录\n（暂无可用聊天记录）',
  ].join('\n\n');
}

async function resolveTracks(
  baseUrl: string,
  cookie: string,
  songs: RadioSongSuggestion[]
): Promise<{ tracks: MusicTrack[]; skipped: RadioSongSuggestion[] }> {
  const tracks: MusicTrack[] = [];
  const skipped: RadioSongSuggestion[] = [];
  const seen = new Set<string>();

  for (const song of songs) {
    const query = song.query || [song.title, song.artist].filter(Boolean).join(' - ');
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    try {
      const track = await searchNeteaseTrack(baseUrl, cookie, query);
      if (track) {
        tracks.push(track);
      } else {
        skipped.push(song);
      }
    } catch {
      skipped.push(song);
    }
  }

  if (tracks.length === 0) {
    throw new Error('AI 电台生成了节目歌曲，但没有解析到可播放歌曲');
  }

  return { tracks, skipped };
}

async function generateOpeningPlan(options: RadioGenerationOptions): Promise<RadioPlan> {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const context = await getMemoryAndChatContext(options.conversationId);
  const queue = formatCurrentQueue(options.currentTracks);

  const response = await chatCompletion({
    baseUrl: options.apiConfig.baseUrl,
    apiKey: options.apiConfig.apiKey,
    model: options.apiConfig.model,
    temperature: 0.85,
    usageContext: {
      feature: 'radio',
      requestKind: 'opening-plan',
      conversationId: options.conversationId,
    },
    messages: [
      {
        role: 'system',
        content: `${JSON_OUTPUT_RULES} 不要 Markdown，不要解释。`,
      },
      {
        role: 'user',
        content: [
          '# 当前主聊天设定',
          options.systemPrompt || 'You are a helpful assistant.',
          context,
          `# 当前时间\n${now}`,
          `# 当前播放队列\n${queue}`,
          '# 当前任务',
          [
            '现在进入 AI 电台主持模式。',
            '你延续当前主聊天中的身份、语气、记忆和与用户的关系。你以用户熟悉的方式说话，只是此刻把表达形式换成一档 AI 电台节目。',
            '请根据你的个人记忆、与用户的关系、共同经历、近期聊天内容、当前时间和此刻氛围，选择一个今天值得展开的主题，作为本期节目内容。',
            '这档节目以主题探讨为主体。你可以从一个细节、一段共同经历、一种情绪、一句用户曾经说过的话，或者一个最近反复出现的问题进入。主持词负责推进节目：观察、回忆、辨认、追问、转折、停顿、安放。歌曲负责给这些段落留出空间，像间奏、侧光、呼吸或余韵。',
            '每段主持词可以按照主题需要自由展开。长短由表达需要决定。重要的是让节目有自然的推进：从进入主题，到展开一两个层次，再到留给用户回应的入口。',
            `本段节目生成 ${options.count ?? 4} 首歌。请让每首歌服务于节目结构：它可以承接上一段、打开下一段、形成对照、制造停顿，或者把某种说不清的情绪放进音乐里。`,
            '如果当前播放队列里已有歌曲，本期节目选择一组有新鲜变化的歌曲；它们可以呼应当前队列的气质，但曲目本身应尽量不同。',
            '第 4 首结束后进入听众来电环节。请在节目结构中预留一个邀请用户回到主聊天窗口继续说话的入口。',
            `${JSON_OUTPUT_RULES} 输出结构：{"title":"节目标题","theme":"本期主题","thesis":"这一段节目想慢慢展开的核心观察","summary":"100字以内，用于插入主聊天的开台摘要","songs":[{"title":"歌名","artist":"歌手","query":"歌名 - 歌手","roleInProgram":"这首歌在节目结构中的作用"}],"reason":"内部理由"}`,
          ].join('\n\n'),
        ].join('\n\n---\n\n'),
      },
    ],
  });

  assertRadioResponseNotTruncated(response, 'opening-plan');
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('AI 电台没有返回节目规划');
  return normalizePlan(extractJsonObject(content, 'opening-plan'));
}

async function generateContinuationPlan(options: ContinueRadioOptions): Promise<RadioPlan> {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const context = await getMemoryAndChatContext(options.conversationId, options.callInStartedAt);

  const response = await chatCompletion({
    baseUrl: options.apiConfig.baseUrl,
    apiKey: options.apiConfig.apiKey,
    model: options.apiConfig.model,
    temperature: 0.85,
    usageContext: {
      feature: 'radio',
      requestKind: 'continuation-plan',
      conversationId: options.conversationId,
    },
    messages: [
      {
        role: 'system',
        content: `${JSON_OUTPUT_RULES} 不要 Markdown，不要解释。`,
      },
      {
        role: 'user',
        content: [
          '# 当前主聊天设定',
          options.systemPrompt || 'You are a helpful assistant.',
          '# 上一段节目',
          formatProgramForPrompt(options.previousProgram),
          context,
          `# 当前时间\n${now}`,
          '# 当前任务',
          [
            '现在继续 AI 电台节目。',
            '你延续当前主聊天中的身份、语气、记忆和与用户的关系。上一段节目已经打开了一个主题，现在请根据用户在来电环节中的反馈，把节目继续往下推进，并在这一段完成本期节目的收束。',
            '请参考上一段节目的主题、核心观察、已播放歌曲、已播主持词，以及用户在来电环节中的聊天内容。你可以回应用户刚才说到的具体感受、细节、疑问或方向，把它自然带回节目主题中。',
            '这一段节目仍然以主题探讨为主体。主持词负责继续推进：回应、辨认、转折、加深、重新理解、放下或收束。歌曲负责给这些段落留出空间，像间奏、侧光、呼吸或余韵。',
            '每段主持词可以按照主题需要自由展开。长短由表达需要决定。重要的是让节目从回应用户自然走向完成本期主题。',
            `本段节目生成 ${options.count ?? 4} 首歌。请让每首歌服务于节目结构：它可以回应用户反馈、承接上一段、形成对照、打开更深一层，或者帮助节目慢慢落地。`,
            '这一段的歌曲与上一段已播放歌曲形成新的推进，不重复上一段曲目。',
            '第 4 首结束后，请生成本期节目的最终结尾主持词。结尾可以回到主题，也可以回到用户刚才的反馈，给这期节目一个安静、完整、不夸张的收束。',
            `${JSON_OUTPUT_RULES} 输出结构：{"title":"节目标题，可沿用上一段或轻微变化","theme":"本期主题","thesis":"这一段如何回应用户反馈并推进主题","summary":"100字以内，用于插入主聊天的继续摘要","songs":[{"title":"歌名","artist":"歌手","query":"歌名 - 歌手","roleInProgram":"这首歌在继续段中的作用"}],"reason":"内部理由"}`,
          ].join('\n\n'),
        ].join('\n\n---\n\n'),
      },
    ],
  });

  assertRadioResponseNotTruncated(response, 'continuation-plan');
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('AI 电台没有返回继续规划');
  return normalizePlan(extractJsonObject(content, 'continuation-plan'));
}

async function generateScriptPlan({
  apiConfig,
  plan,
  tracks,
  systemPrompt,
  conversationId,
  mode,
  previousProgram,
  callInStartedAt,
}: {
  apiConfig: APIConfig;
  plan: RadioPlan;
  tracks: MusicTrack[];
  systemPrompt: string;
  conversationId: string;
  mode: 'opening' | 'continuation';
  previousProgram?: RadioProgram;
  callInStartedAt?: number;
}): Promise<ScriptPlan> {
  const context = await getMemoryAndChatContext(conversationId, callInStartedAt);
  const isContinuation = mode === 'continuation';

  const response = await chatCompletion({
    baseUrl: apiConfig.baseUrl,
    apiKey: apiConfig.apiKey,
    model: apiConfig.model,
    temperature: 0.8,
    usageContext: {
      feature: 'radio',
      requestKind: `${mode}-script`,
      conversationId,
    },
    messages: [
      {
        role: 'system',
        content: `${JSON_OUTPUT_RULES} 不要 Markdown，不要解释。`,
      },
      {
        role: 'user',
        content: [
          '# 当前主聊天设定',
          systemPrompt || 'You are a helpful assistant.',
          previousProgram ? `# 上一段节目\n${formatProgramForPrompt(previousProgram)}` : '',
          context,
          '# 本段节目规划',
          `标题：${plan.title}`,
          `主题：${plan.theme}`,
          `核心观察：${plan.thesis}`,
          `摘要：${plan.summary}`,
          plan.reason ? `内部理由：${plan.reason}` : '',
          `# 已确认可播放歌曲\n${formatTracksForPrompt(tracks)}`,
          '# 当前任务',
          [
            isContinuation ? '现在继续 AI 电台节目。' : '现在进入 AI 电台主持模式。',
            '你延续当前主聊天中的身份、语气、记忆和与用户的关系。你以用户熟悉的方式说话，只是此刻把表达形式换成一档 AI 电台节目。',
            '主持词是节目主体，负责围绕主题展开观察、回忆、辨认、追问、转折、停顿和安放。歌曲服务于节目结构，像段落之间的间奏、侧光、呼吸或余韵。',
            '每段主持词可以按照主题需要自由展开。长短由表达需要决定。让每段主持词都自然推进主题。',
            isContinuation
              ? '这一段从回应用户在来电环节中的反馈开始，慢慢走向本期节目的最终收束。'
              : '这一段从打开主题开始，逐步展开一两个层次，并在第 4 首结束后进入听众来电环节。',
            isContinuation
              ? '第 4 首结束后生成本期节目的最终结尾主持词。'
              : '第 4 首结束后生成来电环节主持词，邀请用户回到主聊天窗口说说刚才节目触到的地方、想继续聊的方向，或者下一段希望节目往哪里走。',
            isContinuation
              ? `${JSON_OUTPUT_RULES} 输出结构：{"title":"节目标题","summary":"100字以内摘要","segments":[{"type":"resume_open","position":"before_track","trackIndex":0,"text":"回应用户反馈并重新进入节目"},{"type":"bridge","position":"between_tracks","afterTrackIndex":0,"beforeTrackIndex":1,"text":"歌间主持词"},{"type":"closing","position":"after_track","trackIndex":3,"text":"最终结尾主持词"}],"reason":"内部理由"}`
              : `${JSON_OUTPUT_RULES} 输出结构：{"title":"节目标题","summary":"100字以内摘要","segments":[{"type":"cold_open","position":"before_track","trackIndex":0,"text":"开场主持词"},{"type":"bridge","position":"between_tracks","afterTrackIndex":0,"beforeTrackIndex":1,"text":"歌间主持词"},{"type":"call_in","position":"after_track","trackIndex":3,"text":"来电环节主持词"}],"reason":"内部理由"}`,
          ].join('\n\n'),
        ].filter(Boolean).join('\n\n---\n\n'),
      },
    ],
  });

  assertRadioResponseNotTruncated(response, `${mode}-script-plan`);
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error('AI 电台没有返回主持词');
  return normalizeScriptPlan(extractJsonObject(content, `${mode}-script-plan`), plan.title, plan.summary);
}

export async function generateOpeningRadioProgram(options: RadioGenerationOptions): Promise<RadioProgram> {
  const plan = await generateOpeningPlan(options);
  const { tracks, skipped } = await resolveTracks(options.neteaseBaseUrl, options.neteaseCookie, plan.songs);
  const script = await generateScriptPlan({
    apiConfig: options.apiConfig,
    plan,
    tracks,
    systemPrompt: options.systemPrompt,
    conversationId: options.conversationId,
    mode: 'opening',
  });

  return {
    title: script.title,
    theme: plan.theme,
    thesis: plan.thesis,
    summary: script.summary,
    reason: script.reason || plan.reason,
    tracks,
    skipped,
    segments: script.segments,
  };
}

export async function generateContinuationRadioProgram(options: ContinueRadioOptions): Promise<RadioProgram> {
  const plan = await generateContinuationPlan(options);
  const { tracks, skipped } = await resolveTracks(options.neteaseBaseUrl, options.neteaseCookie, plan.songs);
  const script = await generateScriptPlan({
    apiConfig: options.apiConfig,
    plan,
    tracks,
    systemPrompt: options.systemPrompt,
    conversationId: options.conversationId,
    mode: 'continuation',
    previousProgram: options.previousProgram,
    callInStartedAt: options.callInStartedAt,
  });

  return {
    title: script.title,
    theme: plan.theme || options.previousProgram.theme,
    thesis: plan.thesis,
    summary: script.summary,
    reason: script.reason || plan.reason,
    tracks,
    skipped,
    segments: script.segments,
  };
}

export async function getOrCreateLatestRadioConversation(apiConfig: APIConfig): Promise<Conversation> {
  const conversations = await getAllConversations();
  const latest = conversations[0];
  if (latest) return latest;

  const now = Date.now();
  const conversation: Conversation = {
    id: randomUUID(),
    title: 'AI 电台',
    systemPrompt: 'You are a helpful assistant.',
    model: apiConfig.model,
    createdAt: now,
    updatedAt: now,
  };
  await createConversation(conversation);
  return conversation;
}

export async function insertRadioChatMessage(
  conversationId: string,
  role: Message['role'],
  content: string
): Promise<Message> {
  const message: Message = {
    id: randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
  await insertMessage(conversationId, message);
  await updateConversation(conversationId, { updatedAt: Date.now() });

  const chat = useChatStore.getState();
  if (chat.conversationId === conversationId) {
    useChatStore.setState((state) => ({
      messages: [...state.messages, message],
    }));
  }

  return message;
}

function formatChatMessages(messages: Message[]): string {
  if (messages.length === 0) return '(无聊天内容)';
  return messages
    .map((message) => {
      const speaker =
        message.role === 'user' ? '用户' :
        message.role === 'assistant' ? 'AI' :
        message.role === 'system' ? '系统' : '工具';
      return `${speaker}: ${message.content}`;
    })
    .join('\n');
}

function formatRadioProgramLog(program: RadioProgram, playedTrackCount: number): string {
  const tracks = program.tracks
    .slice(0, playedTrackCount)
    .map((track, index) => `${index + 1}. ${track.title} - ${track.artist}`)
    .join('\n');
  const lines = program.segments
    .filter((segment) => segment.text.trim())
    .map((segment) => `- ${segment.type}/${segment.position}: ${segment.text}`)
    .join('\n');

  return [
    `节目：${program.title}`,
    `主题：${program.theme}`,
    `核心观察：${program.thesis}`,
    `摘要：${program.summary}`,
    `已播放歌曲：\n${tracks || '(无)'}`,
    `电台台词：\n${lines || '(无)'}`,
  ].join('\n\n');
}

export async function summarizeRadioSession({
  apiConfig,
  conversationId,
  startMessage,
  endMessage,
  programs,
}: {
  apiConfig: APIConfig;
  conversationId: string;
  startMessage: Message;
  endMessage: Message;
  programs: RadioProgram[];
}): Promise<string> {
  const messages = await getMessagesByConversation(conversationId);
  const scopedMessages = messages.filter(
    (message) => message.createdAt >= startMessage.createdAt && message.createdAt <= endMessage.createdAt
  );

  const response = await chatCompletion({
    baseUrl: apiConfig.baseUrl,
    apiKey: apiConfig.apiKey,
    model: apiConfig.model,
    temperature: 0.5,
    usageContext: {
      feature: 'radio',
      requestKind: 'session-summary',
      conversationId,
    },
    messages: [
      {
        role: 'system',
        content:
          '请根据给定边界内的聊天、电台台词和歌曲，生成简短自然的本期 AI 电台总结，直接给用户看。',
      },
      {
        role: 'user',
        content: [
          '# 电台内部日志',
          programs.map((program) => formatRadioProgramLog(program, program.tracks.length)).join('\n\n---\n\n'),
          '# 开始/结束边界内聊天',
          formatChatMessages(scopedMessages),
          '请输出 120 字以内中文总结。用自然段落，不列清单，只总结真实出现过的内容。',
        ].join('\n\n'),
      },
    ],
  });

  assertRadioResponseNotTruncated(response, 'session-summary');
  return response.choices[0]?.message?.content?.trim() || '本期 AI 电台已结束，节目记录已整理。';
}
