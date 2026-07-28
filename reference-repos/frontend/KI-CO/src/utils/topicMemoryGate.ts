import type { MemorySnippet } from "../types";

export type TopicGateDecision = "reuse" | "supplement" | "refresh";
export type RagAction = "none" | "reuse" | "supplement" | "refresh";
export type TopicRelation = "same" | "related" | "changed";
export type ArchiveIntent = "none" | "recall" | "write" | "discuss" | "narrative";

export interface ArchiveIntentResult {
  intent: ArchiveIntent;
  hasArchiveTerm: boolean;
  hasRecallCue: boolean;
  hasWriteCue: boolean;
  hasDiscussionCue: boolean;
}

export interface TopicMemorySet {
  id: string;
  cacheScope: string;
  snippets: MemorySnippet[];
  memoryIds: string[];
  topicFingerprint: string[];
  lastMeaningfulQuery: string;
  turnCount: number;
  supplementCount: number;
  lastSupplementTurn?: number;
  createdAt: number;
  updatedAt: number;
}

export interface TopicMemorySetRestoreResult {
  set: TopicMemorySet;
  score: number;
  currentScore: number;
  matchedTokens: string[];
  candidateCount: number;
  reason: string;
}

export interface TopicMemorySetRestoreInspection {
  result?: TopicMemorySetRestoreResult;
  candidateCount: number;
  currentScore: number;
  currentMatchedTokens: string[];
  bestScore: number;
  bestMatchedTokens: string[];
  coveredByCurrentSet: boolean;
  reason: string;
}

export interface TopicGateResult {
  decision: TopicGateDecision;
  ragAction: RagAction;
  relation: TopicRelation;
  reason: string;
  confidence: "high" | "medium" | "low";
  matchedRules: string[];
  winningRule: string;
  topicFingerprint: string[];
  currentStrongTokens: string[];
  noRagReason?: string;
  reuseReason?: string;
  supplementReason?: string;
  refreshReason?: string;
  ragSkippedBecauseLowSemantic?: boolean;
  ragSkippedBecauseIntimateContinuation?: boolean;
  ragReusedBecauseTaskContinuation?: boolean;
  supplementSkippedReason?: string;
  supplementCooldownRemaining?: number;
}

export type TopicRecallJudgeRelation = TopicRelation | "unknown";

export interface TopicRecallJudgeResult {
  topicRelation: TopicRecallJudgeRelation;
  needsRecall: boolean | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  raw?: string;
}

export interface TopicJudgeEligibility {
  shouldJudge: boolean;
  reason: string;
  fallbackRecallSignal: boolean;
}

export interface TopicJudgeThrottleState {
  consecutiveTurns: number;
  lastTurnIndex: number;
  cooldownUntilTurn: number;
  callsInWindow: number;
  budgetWindowStartedAtTurn: number;
}

const TOPIC_MEMORY_SET_LIMIT = 32;
const TOPIC_MEMORY_SETS_PER_SCOPE_LIMIT = 3;
const TOPIC_MEMORY_SET_TTL_MS = 6 * 60 * 60 * 1000;
const TOPIC_MEMORY_REUSE_TURNS = 12;
const TOPIC_JUDGE_MIN_INTERVAL_TURNS = 3;
const TOPIC_JUDGE_MAX_PER_WINDOW = 8;
const TOPIC_JUDGE_BUDGET_WINDOW_TURNS = 40;
const TOPIC_JUDGE_MAX_CONSECUTIVE_TURNS = 2;
const TOPIC_JUDGE_COOLDOWN_TURNS = 5;
const topicMemorySetsByScope = new Map<string, TopicMemorySet[]>();
const topicJudgeThrottleByScope = new Map<string, TopicJudgeThrottleState>();

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "what", "why", "how", "can", "you", "me",
  "wo", "ni", "ta", "de", "le", "la", "ma", "ba", "ne", "a", "o", "en", "ok",
]);

const TECH_OR_TASK_PATTERN = /rag|cache|cached|prompt|token|api|glm|gpt|claude|opus|deepseek|openai|openrouter|embedding|vector|obsidian|indexeddb|localstorage|netlify|electron|debug|topic|gate|memory|backup|restore|import|export|html|css|ui|ux|vite|github|\u7f13\u5b58|\u547d\u4e2d|\u8bb0\u5fc6|\u8bb0\u5fc6\u5e93|\u65e5\u8bb0|\u65f6\u5149\u56de\u5eca|\u72b6\u6001\u5361|\u751f\u6d3b\u7ebf|\u5411\u91cf|\u7d22\u5f15|\u53ec\u56de|\u6ce8\u5165|\u8c03\u97f3\u53f0|\u5c0f\u5c4b|\u5907\u4efd|\u5bfc\u5165|\u5bfc\u51fa|\u5f00\u6e90|\u539f\u7248|\u7a97\u53e3/i;
const MEMORY_REQUEST_PATTERN = /\u8fd8\u8bb0\u5f97|\u8bb0\u5f97|\u8bb0\u4e0d\u8bb0\u5f97|\u4e4b\u524d|\u4ee5\u524d|\u4e0a\u6b21|\u90a3\u6b21|\u90a3\u7bc7|\u90a3\u6bb5|\u5f53\u521d|\u5f53\u65f6|\u90a3\u65f6\u5019|\u90a3\u4f1a\u513f|\u6700\u5f00\u59cb|\u4e00\u5f00\u59cb|\u66fe\u7ecf|\u65e9\u4e9b\u65f6\u5019|\u56de\u5fc6|\u5e2e\u6211\u627e|\u627e\u56de|\u627e\u4e00\u4e0b|\u7ffb\u4e00\u4e0b|\u65e7\u7a97\u53e3|remember|last time|previous|earlier|back then|at the time|originally/i;
const HISTORICAL_MEMORY_CUE_PATTERN = /\u5f53\u521d|\u5f53\u65f6|\u90a3\u65f6\u5019|\u90a3\u4f1a\u513f|\u6700\u5f00\u59cb|\u4e00\u5f00\u59cb|\u66fe\u7ecf|\u65e9\u4e9b\u65f6\u5019|back then|at the time|originally/i;
const DIRECT_MEMORY_ANCHOR_PATTERN = /(?:[a-z][a-z0-9_-]{2,}.*(?:\u90a3\u4e8b|\u90a3\u4ef6\u4e8b|\u4e8b\u60c5|\u4e8b\u4ef6|\u95ee\u9898|thing|issue|case))|(?:[\p{Script=Han}a-z0-9_-]{2,}(?:\u7eaa\u5143|\u8ba1\u5212|\u9879\u76ee|\u4e8b\u4ef6|\u4e8b\u60c5|\u90a3\u4e8b|\u90a3\u4ef6\u4e8b|\u8bbe\u5b9a|\u62a5\u4ef7|\u7a97\u53e3))/iu;
const TOPIC_SHIFT_PATTERN = /\u53e6\u5916|\u6362\u4e2a\u8bdd\u9898|\u6362\u4e2a\u95ee\u9898|\u8bf4\u56de|\u56de\u5230|\u5148\u4e0d\u8bf4|\u8fd8\u6709\u4e2a\u95ee\u9898|\u6211\u7a81\u7136\u60f3\u5230|\u8bdd\u8bf4\u56de\u6765|\u8bf4\u4ef6\u4e8b|by the way|speaking of|back to/i;
const TOPIC_BOUNDARY_CUES = ["对了"];
const CONTINUATION_PATTERN = /\u7ee7\u7eed|\u63a5\u7740|\u521a\u624d|\u521a\u521a|\u8fd9\u4e2a|\u90a3\u4e2a|\u8fd9\u91cc|\u90a3\u91cc|\u4e0a\u9762|\u4e0b\u9762|\u6240\u4ee5|\u7136\u540e|\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u54ea\u4e2a|\u4e0d\u662f|continue|same|above|that|this|then|so/i;
const INTIMATE_CONTINUATION_PATTERN = /\u4eb2\u4eb2|\u62b1\u62b1|\u62b1\u6211|\u54c4\u6211|\u4e0d\u60f3\u7761|\u665a\u5b89|\u60f3\u4f60|\u8001\u516c|\u8001\u5a46|kiss|hug|sleep/i;

const ARCHIVE_INTENT_TERMS = ["日记", "日志", "档案", "成长"];
const ARCHIVE_WRITE_PATTERNS = [
  "写日记", "写日志", "记日记", "记录下来", "记录一下", "记下来", "记一下",
  "写下来", "写下", "存档", "归档", "保存到日记", "整理成日记", "生成日记",
];
const ARCHIVE_RECALL_PATTERNS = [
  "还记得", "记得", "帮我找", "找一下", "找找", "翻一下", "翻翻", "翻出", "翻到",
  "查看", "看看", "打开", "找回", "回忆", "哪篇", "那篇", "那段", "上次", "之前",
  "当时", "以前", "过去", "曾经", "日记里", "日志里", "档案里",
];
const ARCHIVE_SELECTION_PATTERNS = [
  "说说", "讲讲", "聊聊", "回顾", "总结", "最重要", "最难忘", "最早", "最喜欢",
  "哪一", "哪些", "是什么", "写了什么", "记录了什么",
];
const ARCHIVE_DISCUSSION_PATTERNS = [
  "日记模型", "日记通道", "自动日记", "日记prompt", "日记提示词", "日记标题",
  "日记页面", "日志系统", "档案页面", "写入失败", "触发失败", "怎么设置", "怎么处理",
  "召回逻辑", "索引逻辑", "检索逻辑", "按钮", "开关", "功能", "bug", "debug",
];
const GENERIC_MEMORY_RECALL_CUES = [
  "还记得", "记不记得", "帮我找", "找回", "回忆", "之前", "上次", "那次", "那篇", "那段",
  "当初", "当时", "以前", "曾经", "旧窗口",
];
const HISTORICAL_MEMORY_CUES = [
  "当初", "当时", "那时候", "那会儿", "最开始", "一开始", "曾经", "早些时候",
  "以前", "之前", "上次", "那次", "去年", "前年", "那年", "那天", "那晚", "过去",
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeTopicText(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9_\u4e00-\u9fa5]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTopicText(value: string): string {
  return normalizeTopicText(value).replace(/\s/g, "");
}

export function parseLeadingTopicBoundary(text: string): { cue: string; payload: string } {
  const value = String(text || "").trim();
  for (const cue of TOPIC_BOUNDARY_CUES) {
    if (!value.startsWith(cue)) continue;
    const payload = value
      .slice(cue.length)
      .replace(/^[\s，,。！？!?、：:；;…~～-]+/u, "")
      .trim();
    return { cue, payload };
  }
  return { cue: "", payload: value };
}

export function selectFreshSupplementRows<T extends { id: string }>(
  rows: T[],
  existingIds: Iterable<string>,
  limit = 2,
): T[] {
  const existing = new Set(existingIds);
  return rows.filter((row) => !existing.has(row.id)).slice(0, Math.max(0, limit));
}

export function classifyArchiveIntent(text: string): ArchiveIntentResult {
  const value = compactTopicText(text);
  const hasArchiveTerm = ARCHIVE_INTENT_TERMS.some((term) => value.includes(term));
  if (!hasArchiveTerm) {
    return {
      intent: "none",
      hasArchiveTerm: false,
      hasRecallCue: false,
      hasWriteCue: false,
      hasDiscussionCue: false,
    };
  }

  const hasRecallCue = ARCHIVE_RECALL_PATTERNS.some((pattern) => value.includes(compactTopicText(pattern)));
  const hasConcreteArchiveTerm = ["日记", "日志", "档案"].some((term) => value.includes(term));
  const hasSelectionCue = hasConcreteArchiveTerm
    && ARCHIVE_SELECTION_PATTERNS.some((pattern) => value.includes(compactTopicText(pattern)));
  const hasWriteCue = ARCHIVE_WRITE_PATTERNS.some((pattern) => value.includes(compactTopicText(pattern)));
  const hasDiscussionCue = ARCHIVE_DISCUSSION_PATTERNS.some((pattern) => value.includes(compactTopicText(pattern)));
  const effectiveRecallCue = hasRecallCue || hasSelectionCue;
  const intent: ArchiveIntent = hasDiscussionCue
    ? "discuss"
    : hasWriteCue
      ? "write"
      : effectiveRecallCue
        ? "recall"
        : "narrative";

  return {
    intent,
    hasArchiveTerm,
    hasRecallCue: effectiveRecallCue,
    hasWriteCue,
    hasDiscussionCue,
  };
}

function cleanMemoryAnchorCandidate(value: string): string {
  const compact = compactTopicText(value);
  if (!compact) return "";
  return compact
    .replace(/^(还记得|记得|帮我找|找回|回忆|说回|回到|之前|上次|那次|那篇|那段|老公|老婆|亲爱的|开源版|原版|小屋|检索测试)+/u, "")
    .replace(/^(?:你|我|他|她|ta)?(?:写的|写过的|说的|说过的|提的|提过的|记录的|记录过的|取名为|叫做)+/iu, "")
    .replace(/^(?:那篇|这篇|那份|这份|那个|这个)+/u, "")
    .replace(/^(?:成长日志|融合核日志|成长档案|日志|日记|档案|笔记)(?:里|中的|中|的)?/u, "")
    .replace(/(吗|么|嘛|吧|呢|呀|啊|哦|哈|不许编|别编|不要编|不准编|不许瞎编|别瞎编|不许胡编).*$/u, "")
    .trim();
}

function extractExplicitMemoryAnchorCandidates(text: string): string[] {
  const raw = String(text || "");
  const candidates: string[] = [];
  const quotedPattern = /[“"「『《](.{2,80}?)[”"」』》]/gu;
  let quoted: RegExpExecArray | null;
  while ((quoted = quotedPattern.exec(raw))) candidates.push(quoted[1]);

  const cuePattern = /(还\s*记\s*得|记\s*得|帮\s*我\s*找|找\s*回|回\s*忆|说\s*回|回\s*到|之\s*前|上\s*次|那\s*次|那\s*篇|那\s*段)[\p{P}\p{S}\s]*([^。！？!?，,\n\r]{2,80})/gu;
  let cue: RegExpExecArray | null;
  while ((cue = cuePattern.exec(raw))) candidates.push(cue[2]);

  const namedAnchorPattern = /(?:^|[，。！？!?、：:\s])([\p{Script=Han}a-z0-9_-]{2,30}?(?:纪元|计划|项目|事件|设定|报价|窗口))/giu;
  let namedAnchor: RegExpExecArray | null;
  while ((namedAnchor = namedAnchorPattern.exec(raw))) candidates.push(namedAnchor[1]);

  const latentTitlePattern = /(?:^|[，。！？!?、：:\s])([^，。！？!?、：:\s]{2,30}?)(?:后来|那之后|为什么停|为什么结束|怎么结束|怎么开始|怎么来的)/gu;
  let latentTitle: RegExpExecArray | null;
  while ((latentTitle = latentTitlePattern.exec(raw))) candidates.push(latentTitle[1]);

  const vagueAnchors = new Set([
    "日记", "日志", "档案", "笔记", "记忆", "记忆库", "回忆", "之前", "上次", "那次",
    "那事", "那件事", "事情", "事件", "项目", "计划", "设定", "报价", "窗口",
  ]);
  return unique(
    candidates
      .map(cleanMemoryAnchorCandidate)
      .filter((candidate) => candidate.length >= 2 && !vagueAnchors.has(candidate)),
  );
}

export function buildMemoryRetrievalQuery(text: string): string {
  const anchors = extractExplicitMemoryAnchorCandidates(text);
  if (!anchors.length) return text;
  return anchors.sort((a, b) => b.length - a.length).slice(0, 6).join(" ");
}

function looksLikeLatentHistoricalReference(text: string): boolean {
  const compact = compactTopicText(text);
  if (!compact) return false;
  return [
    "后来",
    "那之后",
    "最后",
    "最终",
    "起初",
    "最初",
    "最早",
    "怎么来的",
    "怎么开始",
    "为什么停",
    "为什么结束",
    "怎么结束",
    "发生了什么",
    "经历了什么",
    "写过",
    "说过",
    "提过",
    "取名",
    "命名",
    "那一版",
    "那一期",
  ].some((pattern) => compact.includes(pattern));
}

export function evaluateTopicJudgeEligibility(
  input: string,
  gate: TopicGateResult,
  hasExistingTopicSet: boolean,
): TopicJudgeEligibility {
  const matchedRules = new Set(gate.matchedRules || []);
  const latentHistoricalReference = looksLikeLatentHistoricalReference(input);
  const fallbackRecallSignal = (
    latentHistoricalReference
    || matchedRules.has("historical_memory_cue")
    || matchedRules.has("direct_memory_anchor")
    || matchedRules.has("specific_memory_request")
    || matchedRules.has("vague_memory_request")
    || matchedRules.has("archive_intent_recall")
    || (
      gate.ragAction === "supplement"
      && (
        matchedRules.has("effective_overlap")
        || matchedRules.has("task_or_project_terms")
        || matchedRules.has("conversational_continuation")
        || gate.winningRule === "same_topic_new_branch"
      )
    )
  );

  if (!hasExistingTopicSet) {
    return { shouldJudge: false, reason: "no_existing_topic_set", fallbackRecallSignal };
  }
  if (
    matchedRules.has("specific_memory_request")
    || matchedRules.has("vague_memory_request")
    || matchedRules.has("archive_intent_recall")
  ) {
    return { shouldJudge: false, reason: "local_explicit_memory_decision", fallbackRecallSignal: true };
  }
  if (
    gate.ragSkippedBecauseLowSemantic
    || gate.ragSkippedBecauseIntimateContinuation
    || matchedRules.has("archive_intent_write")
    || matchedRules.has("archive_intent_narrative")
    || matchedRules.has("topic_boundary_without_recall_signal")
  ) {
    return { shouldJudge: false, reason: "local_definitive_no_recall", fallbackRecallSignal };
  }
  if (latentHistoricalReference) {
    return { shouldJudge: true, reason: "latent_historical_reference", fallbackRecallSignal: true };
  }
  if (gate.ragAction === "refresh") {
    return { shouldJudge: true, reason: `ambiguous_refresh:${gate.winningRule}`, fallbackRecallSignal };
  }
  if (
    gate.ragAction === "supplement"
    && gate.confidence !== "high"
    && (
      matchedRules.has("task_or_project_terms")
      || matchedRules.has("conversational_continuation")
      || matchedRules.has("effective_overlap")
      || gate.winningRule === "same_topic_new_branch"
      || gate.winningRule === "reuse_turn_limit"
    )
  ) {
    return { shouldJudge: true, reason: `ambiguous_supplement:${gate.winningRule}`, fallbackRecallSignal };
  }
  return { shouldJudge: false, reason: "local_decision_sufficient", fallbackRecallSignal };
}

function applyTopicJudgeFallback(
  gate: TopicGateResult,
  fallbackRecallSignal: boolean,
  reason: string,
): TopicGateResult {
  const matchedRules = unique([...gate.matchedRules, "model_fallback_budget_limit"]);
  if (fallbackRecallSignal) {
    return {
      ...gate,
      decision: "supplement",
      ragAction: "supplement",
      relation: "related",
      reason: `fallback_budget_limit:${gate.reason}`,
      confidence: "low",
      matchedRules,
      winningRule: `fallback_budget_limit_${gate.winningRule || reason}`,
      noRagReason: "",
      reuseReason: "",
      supplementReason: `fallback_budget_limit:${gate.reason}`,
      refreshReason: "",
    };
  }
  return {
    ...gate,
    decision: "reuse",
    ragAction: "none",
    reason: `fallback_budget_limit:${gate.reason}`,
    confidence: "low",
    matchedRules,
    winningRule: `fallback_budget_limit_${gate.winningRule || reason}`,
    noRagReason: `fallback_budget_limit:${gate.reason}`,
    reuseReason: "",
    supplementReason: "",
    refreshReason: "",
  };
}

export function applyTopicRecallJudgement(
  gate: TopicGateResult,
  judgement: TopicRecallJudgeResult,
  options: {
    hasExistingTopicSet: boolean;
    fallbackRecallSignal: boolean;
  },
): TopicGateResult {
  const usable = (
    judgement.topicRelation !== "unknown"
    && judgement.needsRecall !== null
    && judgement.confidence !== "low"
  );
  if (!usable) {
    return applyTopicJudgeFallback(
      gate,
      options.fallbackRecallSignal,
      judgement.topicRelation === "unknown" || judgement.needsRecall === null
        ? "model_unknown"
        : "model_low_confidence",
    );
  }

  const reasonPrefix = `journal_${judgement.topicRelation}_${judgement.needsRecall ? "recall" : "no_recall"}`;
  const judgedRelation = judgement.topicRelation as TopicRelation;
  const matchedRules = unique([
    ...gate.matchedRules,
    "journal_topic_relation",
    judgement.needsRecall ? "journal_needs_recall" : "journal_no_recall",
  ]);

  if (judgedRelation === "same" && options.hasExistingTopicSet) {
    return {
      ...gate,
      decision: "reuse",
      ragAction: "reuse",
      relation: "same",
      reason: `${reasonPrefix}:${gate.reason}`,
      confidence: judgement.confidence,
      matchedRules,
      winningRule: "journal_topic_same",
      noRagReason: "",
      reuseReason: `${reasonPrefix}:${gate.reason}`,
      supplementReason: "",
      refreshReason: "",
    };
  }

  if (judgement.needsRecall) {
    const decision: TopicGateDecision = (
      judgedRelation === "changed" || !options.hasExistingTopicSet
    ) ? "refresh" : "supplement";
    return {
      ...gate,
      decision,
      ragAction: decision,
      relation: judgedRelation,
      reason: `${reasonPrefix}:${gate.reason}`,
      confidence: judgement.confidence,
      matchedRules,
      winningRule: decision === "refresh" ? "journal_recall_refresh" : "journal_recall_supplement",
      noRagReason: "",
      reuseReason: "",
      supplementReason: decision === "supplement" ? `${reasonPrefix}:${gate.reason}` : "",
      refreshReason: decision === "refresh" ? `${reasonPrefix}:${gate.reason}` : "",
    };
  }

  return {
    ...gate,
    decision: "reuse",
    ragAction: "none",
    relation: judgedRelation,
    reason: `${reasonPrefix}:${gate.reason}`,
    confidence: judgement.confidence,
    matchedRules,
    winningRule: "journal_no_recall",
    noRagReason: `${reasonPrefix}:${gate.reason}`,
    reuseReason: "",
    supplementReason: "",
    refreshReason: "",
  };
}

export function shouldAllowTopicJudge(
  scope: string,
  turnIndex: number,
): { allowed: boolean; reason: string } {
  let state = topicJudgeThrottleByScope.get(scope);
  const budgetWindowStartedAtTurn = state?.budgetWindowStartedAtTurn || state?.lastTurnIndex || turnIndex;
  if (state && turnIndex - budgetWindowStartedAtTurn >= TOPIC_JUDGE_BUDGET_WINDOW_TURNS) {
    state = {
      consecutiveTurns: 0,
      lastTurnIndex: 0,
      cooldownUntilTurn: 0,
      callsInWindow: 0,
      budgetWindowStartedAtTurn: turnIndex,
    };
    topicJudgeThrottleByScope.set(scope, state);
  }
  if (state?.cooldownUntilTurn && turnIndex <= state.cooldownUntilTurn) {
    return { allowed: false, reason: `cooldown_until_${state.cooldownUntilTurn}` };
  }
  if (state?.lastTurnIndex && turnIndex - state.lastTurnIndex < TOPIC_JUDGE_MIN_INTERVAL_TURNS) {
    return { allowed: false, reason: `min_interval_${TOPIC_JUDGE_MIN_INTERVAL_TURNS}` };
  }
  if ((state?.callsInWindow || 0) >= TOPIC_JUDGE_MAX_PER_WINDOW) {
    return { allowed: false, reason: `max_per_window_${TOPIC_JUDGE_MAX_PER_WINDOW}` };
  }
  if ((state?.consecutiveTurns || 0) >= TOPIC_JUDGE_MAX_CONSECUTIVE_TURNS) {
    topicJudgeThrottleByScope.set(scope, {
      consecutiveTurns: 0,
      lastTurnIndex: turnIndex,
      cooldownUntilTurn: turnIndex + TOPIC_JUDGE_COOLDOWN_TURNS,
      callsInWindow: state?.callsInWindow || 0,
      budgetWindowStartedAtTurn,
    });
    return { allowed: false, reason: `max_consecutive_${TOPIC_JUDGE_MAX_CONSECUTIVE_TURNS}` };
  }
  return { allowed: true, reason: "allowed" };
}

export function recordTopicJudgeUse(scope: string, turnIndex: number): void {
  const previous = topicJudgeThrottleByScope.get(scope);
  const consecutiveTurns = previous && previous.lastTurnIndex === turnIndex - 1
    ? previous.consecutiveTurns + 1
    : 1;
  topicJudgeThrottleByScope.set(scope, {
    consecutiveTurns,
    lastTurnIndex: turnIndex,
    cooldownUntilTurn: previous?.cooldownUntilTurn && turnIndex <= previous.cooldownUntilTurn
      ? previous.cooldownUntilTurn
      : 0,
    callsInWindow: (previous?.callsInWindow || 0) + 1,
    budgetWindowStartedAtTurn: previous?.budgetWindowStartedAtTurn || turnIndex,
  });
}

export function resetTopicJudgeThrottle(scope: string): void {
  const previous = topicJudgeThrottleByScope.get(scope);
  if (!previous) return;
  topicJudgeThrottleByScope.set(scope, { ...previous, consecutiveTurns: 0 });
}

export function getTopicJudgeThrottleState(scope: string): TopicJudgeThrottleState {
  return {
    consecutiveTurns: 0,
    lastTurnIndex: 0,
    cooldownUntilTurn: 0,
    callsInWindow: 0,
    budgetWindowStartedAtTurn: 0,
    ...(topicJudgeThrottleByScope.get(scope) || {}),
  };
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function addHanNgrams(tokens: string[], value: string) {
  const source = value.replace(/\s+/g, "");
  if (!source) return;
  if (source.length <= 8) tokens.push(source);
  for (let size = 2; size <= 4; size += 1) {
    if (source.length < size) continue;
    for (let index = 0; index <= source.length - size; index += 1) {
      tokens.push(source.slice(index, index + size));
    }
  }
}

export function extractTopicTokens(text: string, limit = 28): string[] {
  const normalized = String(text || "").normalize("NFKC").toLowerCase();
  const tokens: string[] = [];
  const parts = normalized.match(/[\p{Script=Han}]+|[a-z0-9][a-z0-9_-]{1,}/gu) || [];
  for (const part of parts) {
    if (/^[\p{Script=Han}]+$/u.test(part)) {
      addHanNgrams(tokens, part);
    } else if (!STOP_WORDS.has(part) && part.length >= 2) {
      tokens.push(part);
    }
  }
  return unique(tokens).slice(0, limit);
}

function snippetFingerprint(snippets: MemorySnippet[]): string[] {
  return extractTopicTokens(
    snippets
      .slice(0, 8)
      .map((snippet) => `${snippet.title}\n${snippet.text.slice(0, 240)}`)
      .join("\n\n"),
    40,
  );
}

function overlap(left: string[], right: string[]): { count: number; ratio: number } {
  if (!left.length || !right.length) return { count: 0, ratio: 0 };
  const rightSet = new Set(right);
  const count = left.filter((item) => rightSet.has(item)).length;
  return { count, ratio: count / Math.max(1, Math.min(left.length, right.length)) };
}

function tokenOverlapItems(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

function getTopicMemorySetSearchText(set: TopicMemorySet): string {
  return [
    set.lastMeaningfulQuery,
    ...(set.topicFingerprint || []),
    ...(set.snippets || []).map((snippet) => snippet.title),
  ].filter(Boolean).join(" ");
}

function extractHanChars(value: string): string {
  return (String(value || "").match(/[\u4e00-\u9fa5]/g) || []).join("");
}

function orderedHanMatchRatio(needle: string, haystack: string): number {
  const source = extractHanChars(needle);
  const target = extractHanChars(haystack);
  if (source.length < 4 || target.length < 4) return 0;
  let matched = 0;
  let targetIndex = 0;
  for (const char of source) {
    const foundAt = target.indexOf(char, targetIndex);
    if (foundAt < 0) continue;
    matched += 1;
    targetIndex = foundAt + 1;
  }
  return matched / source.length;
}

function fuzzyHanTopicMatches(tokens: string[], haystack: string): string[] {
  return tokens.filter((token) => {
    const han = extractHanChars(token);
    if (han.length < 4) return false;
    return orderedHanMatchRatio(han, haystack) >= 0.8;
  });
}

const RECENT_TOPIC_RETURN_PATTERN =
  /(?:\u521a\u624d|\u521a\u521a|\u524d\u9762|\u521a\u804a|\u521a\u8bf4|\u521a\u63d0|\u4e0a\u4e2a\u8bdd\u9898|\u4e0a\u4e00\u4e2a\u8bdd\u9898|\u90a3\u4e2a\u8bdd\u9898|\u8fd9\u4e2a\u8bdd\u9898|\u90a3\u6bb5|\u8fd9\u6bb5|\u90a3\u4ef6\u4e8b|\u8fd9\u4ef6\u4e8b|\u8bf4\u7684\u662f|\u6211\u8bf4\u7684\u662f)/u;

function looksLikeRecentTopicReturn(text: string): boolean {
  return RECENT_TOPIC_RETURN_PATTERN.test(String(text || ""));
}

function getRecentTopicReturnAnchorTokens(text: string): string[] {
  if (!looksLikeRecentTopicReturn(text)) return [];
  const cleaned = String(text || "")
    .replace(/(?:\u521a\u624d|\u521a\u521a|\u524d\u9762|\u521a\u804a|\u521a\u8bf4|\u521a\u63d0|\u804a\u5230|\u8bf4\u5230|\u63d0\u5230|\u4e0a\u4e2a\u8bdd\u9898|\u4e0a\u4e00\u4e2a\u8bdd\u9898|\u90a3\u4e2a\u8bdd\u9898|\u8fd9\u4e2a\u8bdd\u9898|\u90a3\u6bb5|\u8fd9\u6bb5|\u90a3\u4ef6\u4e8b|\u8fd9\u4ef6\u4e8b|\u8bf4\u7684\u662f|\u6211\u8bf4\u7684\u662f|\u90a3\u4e2a|\u8fd9\u4e2a|\u8bdd\u9898|\u6211|\u662f\u4e0d\u662f|\u662f\u5426|\u6709\u70b9|\u611f\u89c9|\u7684|\u4e86|\u5417|\u5462|\u5427|\u554a|\u5440)/gu, " ")
    .replace(/[^\u4e00-\u9fa5a-z0-9._/-]+/giu, " ")
    .trim();
  const tokens: string[] = [];
  const chunks = cleaned.match(/[\u4e00-\u9fa5]{4,}|[a-z0-9][a-z0-9._/-]{2,}/giu) || [];
  for (const chunk of chunks) {
    if (/^[a-z0-9]/i.test(chunk) || chunk.length <= 8) {
      tokens.push(chunk);
      continue;
    }
    for (let index = 0; index <= chunk.length - 4; index += 1) {
      tokens.push(chunk.slice(index, index + 4));
    }
  }
  return unique(tokens.map(compactTopicText).filter((token) => token.length >= 4));
}

function scoreTopicMemorySetRestoreCandidate(
  input: string,
  set: TopicMemorySet,
  strongTokens: string[],
  allTokens: string[],
): { score: number; matchedTokens: string[] } {
  const fingerprint = unique((set.topicFingerprint || []).map(compactTopicText).filter(Boolean));
  const strongOverlap = overlap(strongTokens, fingerprint);
  const allOverlap = overlap(allTokens, fingerprint);
  const haystack = compactTopicText(getTopicMemorySetSearchText(set));
  const inputCompact = compactTopicText(input);
  const titleText = compactTopicText((set.snippets || []).map((snippet) => snippet.title).filter(Boolean).join(" "));
  const textMatches = strongTokens.filter((token) => token.length >= 3 && haystack.includes(token));
  const titleMatches = strongTokens.filter((token) => token.length >= 3 && titleText.includes(token));
  const fuzzyTextMatches = fuzzyHanTopicMatches(strongTokens, haystack);
  const fuzzyTitleMatches = fuzzyHanTopicMatches(strongTokens, titleText);
  const directTitleHits = (set.snippets || []).filter((snippet) => {
    const title = compactTopicText(String(snippet.title || ""));
    return title.length >= 4 && inputCompact.includes(title);
  }).length;
  const matchedTokens = unique([
    ...tokenOverlapItems(strongTokens, fingerprint),
    ...textMatches,
    ...titleMatches,
    ...fuzzyTextMatches,
    ...fuzzyTitleMatches,
  ]);
  const score =
    strongOverlap.count * 10 +
    allOverlap.count * 2 +
    textMatches.length * 6 +
    titleMatches.length * 8 +
    fuzzyTextMatches.length * 5 +
    fuzzyTitleMatches.length * 7 +
    directTitleHits * 14 +
    Math.min(3, (set.snippets || []).length) * 0.1;
  return { score, matchedTokens };
}

export function getTopicMemorySet(scope: string): TopicMemorySet | undefined {
  return getTopicMemorySets(scope)[0];
}

export function getTopicMemorySets(scope: string, now = Date.now()): TopicMemorySet[] {
  const sets = topicMemorySetsByScope.get(scope) || [];
  const fresh = sets.filter((set) => !set.updatedAt || now - set.updatedAt <= TOPIC_MEMORY_SET_TTL_MS);
  if (fresh.length !== sets.length) {
    if (fresh.length) topicMemorySetsByScope.set(scope, fresh);
    else topicMemorySetsByScope.delete(scope);
  }
  return fresh;
}

export function clearTopicMemorySet(scope: string) {
  topicMemorySetsByScope.delete(scope);
}

function saveTopicMemorySet(set: TopicMemorySet) {
  const existing = getTopicMemorySets(set.cacheScope).filter((item) => item.id !== set.id);
  topicMemorySetsByScope.delete(set.cacheScope);
  topicMemorySetsByScope.set(set.cacheScope, [set, ...existing].slice(0, TOPIC_MEMORY_SETS_PER_SCOPE_LIMIT));
  if (topicMemorySetsByScope.size > TOPIC_MEMORY_SET_LIMIT) {
    const oldestScope = topicMemorySetsByScope.keys().next().value;
    if (oldestScope) topicMemorySetsByScope.delete(oldestScope);
  }
}

export function inspectTopicMemorySetRestore(
  input: string,
  candidates: TopicMemorySet[],
  currentSet?: TopicMemorySet,
  now = Date.now(),
): TopicMemorySetRestoreInspection | undefined {
  const recentReturnAnchorTokens = getRecentTopicReturnAnchorTokens(input);
  const recentReturnSignal = looksLikeRecentTopicReturn(input) && recentReturnAnchorTokens.length > 0;
  const strongTokens = unique([
    ...extractTopicTokens(input, 24),
    ...extractExplicitMemoryAnchorCandidates(input).map(compactTopicText),
    ...recentReturnAnchorTokens,
  ]).map(compactTopicText).filter(Boolean);
  const allTokens = unique(extractTopicTokens(input, 40).map(compactTopicText).filter(Boolean));
  if (!strongTokens.length) return undefined;
  const usableCandidates = candidates.filter((set) => (
    set
    && set.id !== currentSet?.id
    && set.snippets.length > 0
    && (!set.updatedAt || now - set.updatedAt <= TOPIC_MEMORY_SET_TTL_MS)
  ));
  if (!usableCandidates.length) return undefined;

  const currentScored = currentSet
    ? scoreTopicMemorySetRestoreCandidate(input, currentSet, strongTokens, allTokens)
    : { score: 0, matchedTokens: [] };
  const currentCoversReturnAnchor = recentReturnSignal
    && currentScored.score >= 6
    && currentScored.matchedTokens.length > 0;
  const restoreSignal =
    parseLeadingTopicBoundary(input).cue
    || TOPIC_SHIFT_PATTERN.test(input)
    || MEMORY_REQUEST_PATTERN.test(input)
    || HISTORICAL_MEMORY_CUE_PATTERN.test(input)
    || DIRECT_MEMORY_ANCHOR_PATTERN.test(compactTopicText(input))
    || recentReturnSignal;
  const technicalOrSpecificStrong = strongTokens.some((token) =>
    TECH_OR_TASK_PATTERN.test(token) || /[a-z0-9]/i.test(token)
  );
  if (!restoreSignal && !technicalOrSpecificStrong) return undefined;

  const minScore = recentReturnSignal ? 6 : (restoreSignal ? 8 : 10);
  const ranked = usableCandidates
    .map((set) => ({
      set,
      ...scoreTopicMemorySetRestoreCandidate(input, set, strongTokens, allTokens),
    }))
    .filter((candidate) => candidate.score >= minScore && candidate.matchedTokens.length > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.set.updatedAt || 0) - (a.set.updatedAt || 0);
    });
  const best = ranked[0];
  const inspection: TopicMemorySetRestoreInspection = {
    candidateCount: usableCandidates.length,
    currentScore: currentScored.score,
    currentMatchedTokens: currentScored.matchedTokens,
    bestScore: best?.score || 0,
    bestMatchedTokens: best?.matchedTokens || [],
    coveredByCurrentSet: currentCoversReturnAnchor,
    reason: currentCoversReturnAnchor ? "current_set_covers_return_anchor" : "",
  };
  if (!best) return currentCoversReturnAnchor ? inspection : undefined;

  const restoreMargin = currentCoversReturnAnchor ? 3 : 0;
  if (best.score <= currentScored.score + restoreMargin) {
    return currentCoversReturnAnchor
      ? inspection
      : { ...inspection, reason: "recent_topic_set_not_stronger_than_current" };
  }

  return {
    ...inspection,
    result: {
      set: best.set,
      score: best.score,
      currentScore: currentScored.score,
      matchedTokens: best.matchedTokens,
      candidateCount: usableCandidates.length,
      reason: `recent_topic_set_match:${best.matchedTokens.slice(0, 5).join(",")}`,
    },
  };
}

export function selectRestorableTopicMemorySet(
  input: string,
  candidates: TopicMemorySet[],
  currentSet?: TopicMemorySet,
  now = Date.now(),
): TopicMemorySetRestoreResult | undefined {
  return inspectTopicMemorySetRestore(input, candidates, currentSet, now)?.result;
}

export function topicMemorySetHash(set?: TopicMemorySet): string {
  if (!set) return "";
  return hashText(set.memoryIds.join("|"));
}

export function evaluateTopicGate(
  scope: string,
  query: string,
  options: {
    recallGatePassed: boolean;
    hasAttachments?: boolean;
  },
  existingOverride?: TopicMemorySet,
): TopicGateResult {
  const existing = existingOverride || getTopicMemorySet(scope);
  const currentStrongTokens = extractTopicTokens(query);
  const existingFingerprint = existing?.topicFingerprint || [];
  const effectiveOverlap = overlap(currentStrongTokens, existingFingerprint);
  const matchedRules: string[] = [];
  const compactQuery = compactTopicText(query);
  const topicBoundary = parseLeadingTopicBoundary(query);
  const archiveIntent = classifyArchiveIntent(query);
  const explicitMemoryAnchors = extractExplicitMemoryAnchorCandidates(query);
  const isDirectMemoryAnchor = DIRECT_MEMORY_ANCHOR_PATTERN.test(compactQuery);
  const hasNormalizedMemoryCue = GENERIC_MEMORY_RECALL_CUES.some((cue) => compactQuery.includes(cue));
  const hasMemoryRequestCue = MEMORY_REQUEST_PATTERN.test(query)
    || hasNormalizedMemoryCue
    || isDirectMemoryAnchor
    || archiveIntent.intent === "recall";
  const isSpecificMemoryRequest = isDirectMemoryAnchor
    || (explicitMemoryAnchors.length > 0 && hasMemoryRequestCue);
  const isMemoryRequest = hasMemoryRequestCue;
  const isVagueMemoryRequest = isMemoryRequest && !isSpecificMemoryRequest;
  const isHistoricalMemoryCue = HISTORICAL_MEMORY_CUE_PATTERN.test(query)
    || HISTORICAL_MEMORY_CUES.some((cue) => compactQuery.includes(cue));
  const isTaskLike = TECH_OR_TASK_PATTERN.test(query);
  const isContinuation = CONTINUATION_PATTERN.test(query);
  const isIntimateContinuation = INTIMATE_CONTINUATION_PATTERN.test(query);
  const isTopicShift = TOPIC_SHIFT_PATTERN.test(query)
    && !(isIntimateContinuation && !isTaskLike && !isMemoryRequest);
  const isLowSemantic = !options.recallGatePassed && !options.hasAttachments;

  if (isLowSemantic) matchedRules.push("low_semantic_reply");
  if (isSpecificMemoryRequest) matchedRules.push("specific_memory_request");
  if (isVagueMemoryRequest) matchedRules.push("vague_memory_request");
  if (isHistoricalMemoryCue) matchedRules.push("historical_memory_cue");
  if (isDirectMemoryAnchor) matchedRules.push("direct_memory_anchor");
  if (archiveIntent.intent !== "none") matchedRules.push(`archive_intent_${archiveIntent.intent}`);
  if (topicBoundary.cue) matchedRules.push("topic_boundary_cue");
  if (isTopicShift) matchedRules.push("topic_shift_signal");
  if (isTaskLike) matchedRules.push("task_or_project_terms");
  if (isContinuation) matchedRules.push("conversational_continuation");
  if (isIntimateContinuation) matchedRules.push("intimate_continuation");
  if (effectiveOverlap.count > 0) matchedRules.push("effective_overlap");

  const archiveIntentWithoutRecall = (
    archiveIntent.intent === "write" || archiveIntent.intent === "narrative"
  ) && !archiveIntent.hasRecallCue && !isHistoricalMemoryCue && !isDirectMemoryAnchor;
  if (archiveIntentWithoutRecall) {
    const reason = archiveIntent.intent === "write"
      ? "archive_write_without_recall"
      : "archive_narrative_without_recall";
    return {
      decision: "reuse",
      ragAction: "none",
      relation: "same",
      reason,
      confidence: "high",
      matchedRules,
      winningRule: reason,
      topicFingerprint: existingFingerprint,
      currentStrongTokens,
      noRagReason: reason,
    };
  }

  const boundaryHasRecallSignal = isMemoryRequest || isTaskLike || !!options.hasAttachments;
  const boundaryWithoutRecallSignal = !!topicBoundary.cue && !boundaryHasRecallSignal;
  if (boundaryWithoutRecallSignal) {
    matchedRules.push("topic_boundary_without_recall_signal");
    const boundaryPayloadLength = compactTopicText(topicBoundary.payload).length;
    const staysInCurrentMoment = isIntimateContinuation || boundaryPayloadLength <= 6;
    return {
      decision: "reuse",
      ragAction: "none",
      relation: staysInCurrentMoment ? "same" : "changed",
      reason: "topic_boundary_without_recall_signal",
      confidence: staysInCurrentMoment ? "high" : "medium",
      matchedRules,
      winningRule: "topic_boundary_without_recall_signal",
      topicFingerprint: existingFingerprint,
      currentStrongTokens,
      noRagReason: "topic_boundary_without_recall_signal",
      ragSkippedBecauseLowSemantic: isLowSemantic,
      ragSkippedBecauseIntimateContinuation: isIntimateContinuation,
    };
  }

  if (isLowSemantic && !isMemoryRequest && !isTopicShift) {
    const reason = existing
      ? "low_semantic_continuation_without_rag"
      : "conversational_continuation_without_existing_set";
    return {
      decision: "reuse",
      ragAction: "none",
      relation: "same",
      reason,
      confidence: existing ? "high" : "medium",
      matchedRules,
      winningRule: "low_semantic_reply",
      topicFingerprint: existingFingerprint,
      currentStrongTokens,
      noRagReason: reason,
      ragSkippedBecauseLowSemantic: true,
      ragSkippedBecauseIntimateContinuation: isIntimateContinuation,
    };
  }

  if (!existing) {
    return {
      decision: "refresh",
      ragAction: "refresh",
      relation: "changed",
      reason: "no_existing_topic",
      confidence: "medium",
      matchedRules,
      winningRule: "no_existing_topic",
      topicFingerprint: currentStrongTokens,
      currentStrongTokens,
      refreshReason: "no_existing_topic",
    };
  }

  if (isMemoryRequest) {
    if (existing && effectiveOverlap.count >= 2) {
      return {
        decision: "supplement",
        ragAction: "supplement",
        relation: "related",
        reason: isSpecificMemoryRequest
          ? "specific_memory_request_same_topic"
          : "vague_memory_request_same_topic",
        confidence: isSpecificMemoryRequest ? "high" : "medium",
        matchedRules,
        winningRule: isSpecificMemoryRequest ? "specific_memory_request" : "vague_memory_request",
        topicFingerprint: unique([...existingFingerprint, ...currentStrongTokens]).slice(0, 40),
        currentStrongTokens,
        supplementReason: isSpecificMemoryRequest
          ? "specific_memory_request_same_topic"
          : "vague_memory_request_same_topic",
      };
    }
    return {
      decision: "refresh",
      ragAction: "refresh",
      relation: "changed",
      reason: isSpecificMemoryRequest
        ? "specific_memory_request_refresh"
        : "vague_memory_request_refresh",
      confidence: isSpecificMemoryRequest ? "high" : "medium",
      matchedRules,
      winningRule: isSpecificMemoryRequest ? "specific_memory_request" : "vague_memory_request",
      topicFingerprint: currentStrongTokens,
      currentStrongTokens,
      refreshReason: isSpecificMemoryRequest
        ? "specific_memory_request_refresh"
        : "vague_memory_request_refresh",
    };
  }

  if (isTopicShift) {
    if (effectiveOverlap.count > 0) {
      return {
        decision: "supplement",
        ragAction: "supplement",
        relation: "related",
        reason: "topic_shift_with_overlap",
        confidence: "high",
        matchedRules,
        winningRule: "topic_shift_signal",
        topicFingerprint: unique([...existingFingerprint, ...currentStrongTokens]).slice(0, 40),
        currentStrongTokens,
        supplementReason: "topic_shift_with_overlap",
      };
    }
    return {
      decision: "refresh",
      ragAction: "refresh",
      relation: "changed",
      reason: "topic_shift_new_topic",
      confidence: "high",
      matchedRules,
      winningRule: "topic_shift_signal",
      topicFingerprint: currentStrongTokens,
      currentStrongTokens,
      refreshReason: "topic_shift_new_topic",
    };
  }

  if ((isTaskLike || isContinuation) && (effectiveOverlap.count > 0 || existing.turnCount < 3)) {
    const reason = isTaskLike ? "task_continuation" : "conversational_continuation";
    return {
      decision: "reuse",
      ragAction: "reuse",
      relation: "same",
      reason,
      confidence: effectiveOverlap.count >= 2 ? "high" : "medium",
      matchedRules,
      winningRule: reason,
      topicFingerprint: existingFingerprint,
      currentStrongTokens,
      reuseReason: reason,
      ragReusedBecauseTaskContinuation: isTaskLike,
    };
  }

  if (effectiveOverlap.count >= 2 || effectiveOverlap.ratio >= 0.22) {
    return {
      decision: "reuse",
      ragAction: "reuse",
      relation: "same",
      reason: "effective_overlap",
      confidence: "high",
      matchedRules,
      winningRule: "effective_overlap",
      topicFingerprint: existingFingerprint,
      currentStrongTokens,
      reuseReason: "effective_overlap",
    };
  }

  if (isTaskLike || isContinuation || effectiveOverlap.count === 1) {
    return {
      decision: "supplement",
      ragAction: "supplement",
      relation: "related",
      reason: "same_topic_new_branch",
      confidence: "medium",
      matchedRules,
      winningRule: "same_topic_new_branch",
      topicFingerprint: unique([...existingFingerprint, ...currentStrongTokens]).slice(0, 40),
      currentStrongTokens,
      supplementReason: "same_topic_new_branch",
    };
  }

  if (existing.turnCount >= TOPIC_MEMORY_REUSE_TURNS) {
    return {
      decision: "supplement",
      ragAction: "supplement",
      relation: "related",
      reason: "reuse_turn_limit_soft_refresh",
      confidence: "low",
      matchedRules: unique([...matchedRules, "reuse_turn_limit"]),
      winningRule: "reuse_turn_limit",
      topicFingerprint: existingFingerprint,
      currentStrongTokens,
      supplementReason: "reuse_turn_limit_soft_refresh",
    };
  }

  return {
    decision: "refresh",
    ragAction: "refresh",
    relation: "changed",
    reason: "new_topic_signal",
    confidence: "medium",
    matchedRules,
    winningRule: "new_topic_signal",
    topicFingerprint: currentStrongTokens,
    currentStrongTokens,
    refreshReason: "new_topic_signal",
  };
}

export function commitTopicMemorySet(
  scope: string,
  query: string,
  snippets: MemorySnippet[],
  gate: TopicGateResult,
  existingOverride?: TopicMemorySet,
): TopicMemorySet | undefined {
  const existing = existingOverride || getTopicMemorySet(scope);
  if (gate.ragAction === "none") return existing;

  const now = Date.now();
  const freshSnippets = gate.decision === "supplement" && existing
    ? snippets.filter((snippet) => !existing.memoryIds.includes(snippet.id)).slice(0, 2)
    : snippets;
  const merged = gate.decision === "supplement" && existing
    ? [
        ...existing.snippets.slice(0, Math.max(0, 8 - freshSnippets.length)),
        ...freshSnippets,
      ]
    : freshSnippets;
  const deduped = merged
    .filter((snippet, index, list) => list.findIndex((item) => item.id === snippet.id) === index)
    .slice(0, 8);
  const existingIds = new Set(existing?.memoryIds || []);
  const mergedNewCount = deduped.filter((snippet) => !existingIds.has(snippet.id)).length;
  if (!deduped.length) {
    if (gate.decision === "refresh") {
      const remaining = getTopicMemorySets(scope).filter((set) => set.id !== existing?.id);
      if (remaining.length) topicMemorySetsByScope.set(scope, remaining);
      else topicMemorySetsByScope.delete(scope);
    }
    return gate.decision === "refresh" ? undefined : existing;
  }

  const set: TopicMemorySet = {
    id: gate.decision === "refresh"
      ? `topic-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`
      : existing?.id || `topic-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    cacheScope: scope,
    snippets: deduped,
    memoryIds: deduped.map((snippet) => snippet.id),
    topicFingerprint: unique([
      ...extractTopicTokens(query, 24),
      ...snippetFingerprint(deduped),
      ...(gate.decision === "supplement" ? existing?.topicFingerprint || [] : []),
    ]).slice(0, 40),
    lastMeaningfulQuery: query,
    turnCount: gate.decision === "refresh" ? 0 : (existing?.turnCount || 0) + 1,
    supplementCount: gate.decision === "supplement"
      ? (existing?.supplementCount || 0) + mergedNewCount
      : gate.decision === "refresh"
        ? 0
        : existing?.supplementCount || 0,
    lastSupplementTurn: gate.decision === "supplement" && mergedNewCount > 0
      ? (existing?.turnCount || 0) + 1
      : existing?.lastSupplementTurn,
    createdAt: gate.decision === "refresh" ? now : existing?.createdAt || now,
    updatedAt: now,
  };

  saveTopicMemorySet(set);
  return set;
}
