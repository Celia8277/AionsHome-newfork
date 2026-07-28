import type { MemorySnippet, TimeBridgeMeta, UplinkSettings } from "../types";
import type { ContinuityLine, ChronicleEntry } from "../storage/chronicles";
import { getChroniclePreferences, getContinuityLine, listChronicles } from "../storage/chronicles";
import { DEFAULT_MEMORY_ENTRIES, listMemoryEntries } from "../storage/memoryBank";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const SPECIAL_DATE_LABELS: Record<string, string> = {
  "01-01": "元旦",
  "02-14": "情人节",
  "05-20": "520",
  "08-29": "七夕",
  "10-31": "万圣夜",
  "12-24": "平安夜",
  "12-25": "圣诞节",
};

const TIME_BRIDGE_DAILY_VISIT_KEY = "kis_cottage_time_bridge_daily_visit_v1";
const LONG_CONVERSATION_MAX_GAP_MS = 60 * 60 * 1000;
const LONG_CONVERSATION_STALE_MS = 2 * 60 * 60 * 1000;
const LONG_CONVERSATION_MIN_MESSAGES = 4;
const LONG_CONVERSATION_MIN_CHARS = 400;

type TimeBridgeMessage = {
  role?: string;
  text?: string;
  content?: string;
  createdAt?: string | number;
  timestamp?: string | number;
};

type TimeBridgeStateCard = {
  content?: string;
  updatedAt?: number;
  enabled?: boolean;
  visibleToPersona?: boolean;
} | null;

export interface TimeBridgeContextOptions {
  messages?: TimeBridgeMessage[];
  stateCard?: TimeBridgeStateCard;
  continuityLine?: ContinuityLine | null;
  memories?: MemorySnippet[];
  memoryRecallEnabled?: boolean;
  chronicleRecallEnabled?: boolean;
}

interface TimeBridgeDebug {
  timeBridgeInjected: boolean;
  timeBridgeReason: string;
  timeBridgeTokens: number;
  timeBridgePosition: "dynamicContext";
  currentTimeSource: "device timezone";
  previousUserMessageAt: string;
  timeSincePreviousUserMessage: string;
  lastLongConversationAt: string;
  lastLongConversationMatched: boolean;
  lastLongConversationReason: string;
  recentMessagesTimeSpan: string;
  materialFreshness: string;
  memoryStatus: string;
}

function getTimePeriodLabel(hour: number): string {
  if (hour < 5) return "凌晨";
  if (hour < 8) return "清晨";
  if (hour < 12) return "上午";
  if (hour < 14) return "中午";
  if (hour < 18) return "下午";
  if (hour < 22) return "晚上";
  return "深夜";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

function formatDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatLocalDateTime(date: Date): string {
  return `${formatDateKey(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatTimePointLabel(date: Date): string {
  return `${formatDateKey(date)} ${getTimePeriodLabel(date.getHours())}`;
}

function formatMaterialDate(value?: number | string | null): string {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{1,2}-\d{1,2}/.test(trimmed)) return trimmed.slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDateKey(date);
}

function formatRelativeDuration(ms: number): string {
  const safeMs = Math.max(0, Number(ms || 0));
  const minutes = Math.round(safeMs / 60000);
  if (minutes < 3) return "刚刚";
  if (minutes < 60) return `约${minutes}分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `约${hours}小时`;
  const days = Math.round(hours / 24);
  if (days < 30) return `约${days}天`;
  const months = Math.round(days / 30);
  return `约${months}个月`;
}

function getMessageText(message: TimeBridgeMessage): string {
  return String(message.text ?? message.content ?? "").trim();
}

function getMessageTime(message: TimeBridgeMessage): number {
  const value = message.createdAt ?? message.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function isConversationRole(role: unknown): boolean {
  return role === "user" || role === "companion" || role === "assistant";
}

function getHistoryMessages(messages: TimeBridgeMessage[] = []): TimeBridgeMessage[] {
  const last = messages[messages.length - 1];
  if (last?.role === "user") return messages.slice(0, -1);
  return messages;
}

function findPreviousUserMessage(messages: TimeBridgeMessage[]): TimeBridgeMessage | null {
  const history = getHistoryMessages(messages);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index]?.role === "user") return history[index];
  }
  return null;
}

function getRecentMessagesTimeSpan(messages: TimeBridgeMessage[], now: Date): string {
  const timestamps = getHistoryMessages(messages)
    .filter((message) => isConversationRole(message.role))
    .map(getMessageTime)
    .filter((value) => value > 0);
  if (!timestamps.length) return "";
  const startAt = Math.min(...timestamps);
  return `${formatTimePointLabel(new Date(startAt))} → ${formatTimePointLabel(now)}`;
}

function extractTimeBridgeAnchors(messages: TimeBridgeMessage[]): string[] {
  const source = messages
    .map(getMessageText)
    .join("\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ");
  const candidates = source.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fa5]{2,10}/g) || [];
  const stopwords = new Set([
    "我们", "你们", "他们", "这个", "那个", "就是", "还是", "然后", "因为", "所以", "但是",
    "如果", "其实", "感觉", "可以", "不用", "不是", "没有", "什么", "怎么", "哈哈哈",
    "嗯嗯", "啊啊", "知道", "一个", "现在", "刚才", "之前", "之后", "继续", "小屋",
    "用户", "助手", "模型", "对话", "消息",
  ]);
  const counts = new Map<string, number>();
  for (const raw of candidates) {
    const token = raw.trim();
    if (!token || stopwords.has(token)) continue;
    if (/^[a-z]{1,2}$/i.test(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 5)
    .map(([token]) => token);
}

function findLastLongConversation(
  messages: TimeBridgeMessage[],
  nowMs: number,
): { endedAt: number; anchors: string[]; reason: string } | null {
  const conversationMessages = getHistoryMessages(messages)
    .filter((message) => isConversationRole(message.role) && getMessageText(message))
    .map((message) => ({ message, time: getMessageTime(message) }))
    .filter((item) => item.time > 0)
    .sort((a, b) => a.time - b.time);

  const clusters: Array<Array<{ message: TimeBridgeMessage; time: number }>> = [];
  let current: Array<{ message: TimeBridgeMessage; time: number }> = [];
  for (const item of conversationMessages) {
    const prev = current[current.length - 1];
    if (!prev || item.time - prev.time <= LONG_CONVERSATION_MAX_GAP_MS) {
      current.push(item);
    } else {
      if (current.length) clusters.push(current);
      current = [item];
    }
  }
  if (current.length) clusters.push(current);

  for (let index = clusters.length - 1; index >= 0; index -= 1) {
    const cluster = clusters[index];
    const endedAt = cluster[cluster.length - 1]?.time || 0;
    if (!endedAt || nowMs - endedAt < LONG_CONVERSATION_STALE_MS) continue;
    const totalChars = cluster.reduce((sum, item) => sum + getMessageText(item.message).length, 0);
    if (cluster.length >= LONG_CONVERSATION_MIN_MESSAGES && totalChars >= LONG_CONVERSATION_MIN_CHARS) {
      return {
        endedAt,
        anchors: extractTimeBridgeAnchors(cluster.map((item) => item.message)),
        reason: `messages>=${LONG_CONVERSATION_MIN_MESSAGES};chars>=${LONG_CONVERSATION_MIN_CHARS};gap<=60m`,
      };
    }
  }
  return null;
}

function consumeFirstVisitToday(now: Date): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    const today = formatDateKey(now);
    const previous = localStorage.getItem(TIME_BRIDGE_DAILY_VISIT_KEY);
    if (previous === today) return false;
    localStorage.setItem(TIME_BRIDGE_DAILY_VISIT_KEY, today);
    return true;
  } catch {
    return false;
  }
}

function isDefaultExampleChronicle(entry: ChronicleEntry): boolean {
  const title = `${entry.title || ""} ${entry.diaryTitle || ""}`.toLowerCase();
  const content = String(entry.content || "").slice(0, 160).toLowerCase();
  return /示例|example|demo|默认/.test(title) || /示例|example|demo|默认/.test(content);
}

function getLatestRealChronicle(entries: ChronicleEntry[]): ChronicleEntry | undefined {
  return entries.find((entry) => entry.isActive !== false && !isDefaultExampleChronicle(entry));
}

function getRecalledChronicleDateLabels(memories: MemorySnippet[], chronicles: ChronicleEntry[]): string[] {
  const byId = new Map(chronicles.map((entry) => [entry.id, entry]));
  const dates: string[] = [];
  for (const memory of memories) {
    if (memory.source !== "chronicle" && !memory.id.startsWith("chronicle:")) continue;
    const id = memory.id.replace(/^chronicle:/, "");
    const matched = byId.get(id);
    const date =
      formatMaterialDate(matched?.createdAt) ||
      formatMaterialDate(memory.title.match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0]) ||
      formatMaterialDate(memory.text.match(/\d{4}-\d{1,2}-\d{1,2}/)?.[0]);
    if (date) dates.push(date);
  }
  return Array.from(new Set(dates)).slice(0, 3);
}

function getMemoryStatus(memoryRecallEnabled: boolean, chronicleEntries: ChronicleEntry[], chronicleRecallEnabled = memoryRecallEnabled): string {
  const defaultIds = new Set(DEFAULT_MEMORY_ENTRIES.map((entry) => entry.id));
  const realMemoryCount = listMemoryEntries().filter((entry) => !defaultIds.has(entry.id)).length;
  const realChronicleCount = chronicleEntries.filter((entry) => entry.isActive !== false && !isDefaultExampleChronicle(entry)).length;
  return [
    memoryRecallEnabled ? (realMemoryCount > 0 ? "记忆库可读取" : "记忆库为空") : "记忆库未启用",
    chronicleRecallEnabled ? (realChronicleCount > 0 ? "时光回廊可读取" : "时光回廊为空") : "时光回廊未启用",
  ].join("；");
}

function buildMaterialFreshness(params: {
  nowMs: number;
  stateCard?: TimeBridgeStateCard;
  continuityLine?: ContinuityLine | null;
  chronicles: ChronicleEntry[];
  memories: MemorySnippet[];
}): string {
  const materialParts: string[] = [];
  const { nowMs, stateCard, continuityLine, chronicles, memories } = params;
  const stateCardHasContent =
    stateCard?.enabled !== false &&
    stateCard?.visibleToPersona !== false &&
    !!String(stateCard?.content || "").trim();
  const continuityHasContent =
    !!String(continuityLine?.content || "").trim() ||
    !!(continuityLine?.pinned || []).length;

  if (stateCardHasContent && stateCard?.updatedAt) {
    materialParts.push(`状态卡 ${formatRelativeDuration(nowMs - Number(stateCard.updatedAt))}前`);
  }
  if (continuityHasContent && continuityLine?.updatedAt) {
    materialParts.push(`生活线 ${formatRelativeDuration(nowMs - Number(continuityLine.updatedAt))}前`);
  }

  const latestChronicleDate = formatMaterialDate(getLatestRealChronicle(chronicles)?.createdAt);
  if (latestChronicleDate) materialParts.push(`最近日记 ${latestChronicleDate}`);

  const recalledDates = getRecalledChronicleDateLabels(memories, chronicles);
  if (recalledDates.length) {
    materialParts.push(`本轮召回日记 ${recalledDates.join("、")}`);
  }

  return materialParts.join("；") || "暂无可用素材时间";
}

function writeDebug(debug: TimeBridgeDebug) {
  try {
    if (typeof window !== "undefined") {
      (window as unknown as { __kisCottageTimeBridgeDebug?: { latest: TimeBridgeDebug } }).__kisCottageTimeBridgeDebug = {
        latest: debug,
      };
    }
  } catch {
    // Debug is best-effort only.
  }
}

function estimateTokensByChars(chars: number): number {
  return Math.ceil(chars / 4);
}

export function buildTimeBridgeMeta(options: TimeBridgeContextOptions = {}): TimeBridgeMeta {
  const userMessages = (options.messages || [])
    .filter((message) => message.role === "user")
    .map((message) => ({ time: getMessageTime(message) }))
    .filter((item) => item.time > 0)
    .sort((a, b) => a.time - b.time);
  const current = userMessages[userMessages.length - 1];
  const previous = userMessages[userMessages.length - 2];
  const intervals: number[] = [];

  for (let index = userMessages.length - 1; index > 0 && intervals.length < 3; index -= 1) {
    const gap = userMessages[index].time - userMessages[index - 1].time;
    if (gap > 0) intervals.push(gap);
  }

  return {
    previousUserGapMs: current && previous ? Math.max(0, current.time - previous.time) : 0,
    recentUserAverageGapMs: intervals.length
      ? Math.round(intervals.reduce((sum, gap) => sum + gap, 0) / intervals.length)
      : 0,
    previousUserMessageAt: previous ? new Date(previous.time).toISOString() : "",
    currentUserMessageAt: current ? new Date(current.time).toISOString() : "",
  };
}

export function buildTimeBridgeContext(
  settings: UplinkSettings,
  optionsOrNow: TimeBridgeContextOptions | Date = {},
  maybeNow = new Date(),
): string {
  const mode = settings.contextLoad.timeAwarenessMode || "date_only";
  const options = optionsOrNow instanceof Date ? {} : optionsOrNow;
  const now = optionsOrNow instanceof Date ? optionsOrNow : maybeNow;
  const nowMs = now.getTime();
  const debug: TimeBridgeDebug = {
    timeBridgeInjected: false,
    timeBridgeReason: "time_awareness_off",
    timeBridgeTokens: 0,
    timeBridgePosition: "dynamicContext",
    currentTimeSource: "device timezone",
    previousUserMessageAt: "",
    timeSincePreviousUserMessage: "",
    lastLongConversationAt: "",
    lastLongConversationMatched: false,
    lastLongConversationReason: "",
    recentMessagesTimeSpan: "",
    materialFreshness: "",
    memoryStatus: "",
  };

  if (mode === "off") {
    writeDebug(debug);
    return "";
  }

  const messages = options.messages || [];
  const chroniclePreferences = getChroniclePreferences();
  const memoryRecallEnabled = options.memoryRecallEnabled ?? chroniclePreferences.enableMemoryRecall;
  const chronicleRecallEnabled = options.chronicleRecallEnabled ?? memoryRecallEnabled;
  const chronicles = listChronicles();
  const previousUserMessage = findPreviousUserMessage(messages);
  const previousUserAt = previousUserMessage ? getMessageTime(previousUserMessage) : 0;
  const previousGapMs = previousUserAt ? Math.max(0, nowMs - previousUserAt) : 0;
  const firstVisitToday = consumeFirstVisitToday(now);
  const noPreviousUser = !previousUserAt;
  const fullBridge = firstVisitToday || noPreviousUser || previousGapMs >= 24 * 60 * 60 * 1000 || messages.length <= 2;
  const mediumBridge = previousGapMs >= 6 * 60 * 60 * 1000;
  const shortBridge = previousGapMs >= 30 * 60 * 1000;
  const hasReadableWarning = !memoryRecallEnabled || !chronicleRecallEnabled || !getLatestRealChronicle(chronicles);
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  const dateLabel = formatDateKey(now);
  const weekdayLabel = WEEKDAY_LABELS[now.getDay()] || "";
  const periodLabel = getTimePeriodLabel(now.getHours());
  const specialDateLabel = SPECIAL_DATE_LABELS[`${month}-${day}`];
  const currentTime = mode === "realtime"
    ? `${dateLabel} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
    : dateLabel;

  const lines: string[] = [];
  lines.push(`当前时间：${currentTime}，${weekdayLabel}，${periodLabel}，设备时区 ${getDeviceTimezone()}；日期与星期由本地程序计算，请直接采用，不要自行换算`);
  if (specialDateLabel) lines.push(`特殊日期：${specialDateLabel}`);

  if (previousUserAt) {
    const relative = formatRelativeDuration(previousGapMs);
    lines.push(`上一条用户消息时间：${formatLocalDateTime(new Date(previousUserAt))}；间隔由本地时间桥根据消息时间戳计算，不是模型推测`);
    lines.push(`距离上一条用户消息：${relative}`);
    debug.previousUserMessageAt = formatLocalDateTime(new Date(previousUserAt));
    debug.timeSincePreviousUserMessage = relative;
  } else {
    lines.push("距离上一条用户消息：新窗口或暂无上一条用户消息；没有可靠间隔时不要自行推断");
  }

  const recentMessagesTimeSpan = fullBridge ? getRecentMessagesTimeSpan(messages, now) : "";
  if (recentMessagesTimeSpan) {
    lines.push(`recentMessages 时间跨度：${recentMessagesTimeSpan}`);
    debug.recentMessagesTimeSpan = recentMessagesTimeSpan;
  }

  const lastLongConversation = findLastLongConversation(messages, nowMs);
  if (lastLongConversation && (fullBridge || mediumBridge)) {
    const relative = formatRelativeDuration(nowMs - lastLongConversation.endedAt);
    const anchors = lastLongConversation.anchors.length ? `；锚点：${lastLongConversation.anchors.join("、")}` : "";
    lines.push(`上一次长对话结束时间：${formatLocalDateTime(new Date(lastLongConversation.endedAt))}；距离现在：${relative}${anchors}`);
    debug.lastLongConversationAt = formatLocalDateTime(new Date(lastLongConversation.endedAt));
    debug.lastLongConversationMatched = true;
    debug.lastLongConversationReason = lastLongConversation.reason;
  } else if (fullBridge || mediumBridge) {
    lines.push("距离上一次长对话：暂无可判定的长对话；没有可靠依据时不要自行编造间隔");
    debug.lastLongConversationReason = "no_cluster_matched";
  }

  if (fullBridge || hasReadableWarning) {
    const materialFreshness = buildMaterialFreshness({
      nowMs,
      stateCard: options.stateCard,
      continuityLine: options.continuityLine ?? getContinuityLine(),
      chronicles,
      memories: options.memories || [],
    });
    const memoryStatus = getMemoryStatus(memoryRecallEnabled, chronicles, chronicleRecallEnabled);
    lines.push(`素材时间：${materialFreshness}`);
    lines.push(`记忆状态：${memoryStatus}`);
    debug.materialFreshness = materialFreshness;
    debug.memoryStatus = memoryStatus;
  }

  const reason = firstVisitToday
    ? "first_visit_today"
    : noPreviousUser
      ? "new_window"
      : fullBridge
        ? "gap_over_24h"
        : mediumBridge
          ? "gap_over_6h"
          : shortBridge
            ? "gap_over_30m"
            : "short_gap";
  const text = `[Time Bridge]\n${lines.join("\n")}`;
  debug.timeBridgeInjected = true;
  debug.timeBridgeReason = reason;
  debug.timeBridgeTokens = estimateTokensByChars(text.length);
  writeDebug(debug);

  return text;
}

export function buildTimeAwarenessContext(
  settings: UplinkSettings,
  optionsOrNow: TimeBridgeContextOptions | Date = {},
  maybeNow = new Date(),
): string {
  return buildTimeBridgeContext(settings, optionsOrNow, maybeNow);
}
