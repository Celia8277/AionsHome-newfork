import type { LLMAdapter } from "../types";
import type { TopicRecallJudgeResult } from "../utils/topicMemoryGate";

const TOPIC_RECALL_JUDGE_TIMEOUT_MS = 7000;

function emptyWatchContext() {
  return {
    title: "",
    currentTime: 0,
    duration: 0,
    sourceType: "local-file" as const,
    subtitleWindow: { previous: [], next: [] },
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(
      () => reject(new Error("topic_recall_judge_timeout")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function parseTopicRecallJudgeResponse(raw: string): TopicRecallJudgeResult {
  try {
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/i) || raw.match(/{[\s\S]*}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[1] || jsonMatch[0]) : {};
    const rawRelation = String(parsed?.topicRelation || "").toLowerCase();
    const topicRelation = rawRelation === "same" || rawRelation === "related" || rawRelation === "changed"
      ? rawRelation
      : "unknown";
    const needsRecall = typeof parsed?.needsRecall === "boolean" ? parsed.needsRecall : null;
    const rawConfidence = String(parsed?.confidence || "").toLowerCase();
    const confidence = rawConfidence === "high" || rawConfidence === "medium" || rawConfidence === "low"
      ? rawConfidence
      : "low";
    return {
      topicRelation,
      needsRecall,
      confidence,
      reason: String(parsed?.reason || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180) || "journal_topic_recall_judge",
      raw,
    };
  } catch {
    return {
      topicRelation: "unknown",
      needsRecall: null,
      confidence: "low",
      reason: "invalid_journal_topic_recall_json",
      raw,
    };
  }
}

export async function judgeTopicRecallWithJournalModel(
  llm: LLMAdapter,
  input: {
    cacheScope: string;
    userMessage: string;
    previousAssistantText?: string;
    topicFingerprint?: string[];
    memoryTitles?: string[];
    localGateReason?: string;
  },
): Promise<TopicRecallJudgeResult> {
  const userMessage = String(input.userMessage || "").trim().slice(0, 900);
  if (!userMessage) {
    return {
      topicRelation: "unknown",
      needsRecall: null,
      confidence: "low",
      reason: "empty_input",
    };
  }

  const previousAssistantText = String(input.previousAssistantText || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 900);
  const topicFingerprint = (input.topicFingerprint || []).filter(Boolean).slice(0, 18).join(", ") || "-";
  const memoryTitles = (input.memoryTitles || []).filter(Boolean).slice(0, 8).join(" | ") || "-";
  const instruction = [
    "You are a lightweight topic-and-memory-need classifier for a chat memory system.",
    "Return only valid JSON. Do not answer the conversation.",
  ].join("\n");
  const prompt = `
Judge two independent questions:
1. How the user's new message relates to the active topic memory set.
2. Whether answering reliably needs memory/archive context.

Return exactly one JSON object:
{"topicRelation":"same|related|changed","needsRecall":true,"confidence":"high|medium|low","reason":"short reason"}

Definitions:
- topicRelation=same: continues the active topic or is a short natural continuation.
- topicRelation=related: opens a nearby branch connected to the active topic.
- topicRelation=changed: moves to a substantially different topic.
- needsRecall=true: the reply depends on a past event, private title, prior decision, earlier conversation, diary/log/archive, or other stored detail. Existing active memories may be reused when they already cover it.
- needsRecall=false: the message can be answered from the current exchange, general reasoning, or present-moment information without searching old records.

Guidelines:
- Do not treat playful tone, laughter, short affection, or filler as a topic change by itself.
- A topic change alone does not mean memory recall is needed.
- A user-defined private title or past event may need recall even when the user does not say "remember", "before", or "in the diary".
- A new current request, ordinary question, or present-moment topic usually does not need recall.
- Do not infer needsRecall=true merely because a noun, module, file, or technical term is new.
- If uncertain about topic relation, prefer related over changed. Judge needsRecall separately.

Local gate reason: ${input.localGateReason || "-"}
Current topic fingerprint: ${topicFingerprint}
Current memory titles: ${memoryTitles}

Previous assistant message, clipped:
${previousAssistantText || "(none)"}

User message:
${userMessage}
`;

  try {
    const response = await withTimeout(
      llm.complete({
        mode: "chat",
        channel: "journal",
        purpose: "topic-recall-judge",
        cacheScope: `topic-recall-judge:${input.cacheScope}`,
        userMessage: prompt,
        watch: emptyWatchContext(),
        personaCore: instruction,
        userContext: "",
        memories: [],
        recentMessages: [],
        temperatureOverride: 0.05,
        maxOutputTokensOverride: 220,
      }),
      TOPIC_RECALL_JUDGE_TIMEOUT_MS,
    );
    return parseTopicRecallJudgeResponse(response.text);
  } catch (error) {
    return {
      topicRelation: "unknown",
      needsRecall: null,
      confidence: "low",
      reason: String(error instanceof Error ? error.message : error || "journal_topic_recall_judge_failed")
        .slice(0, 180),
    };
  }
}
