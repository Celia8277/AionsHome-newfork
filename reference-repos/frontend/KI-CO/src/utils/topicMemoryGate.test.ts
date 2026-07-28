import { beforeEach, describe, expect, it } from "vitest";
import type { MemorySnippet } from "../types";
import {
  computeRetrievalRecencyBonus,
  matchLiteralTitleQuery,
  prioritizeLiteralContextRows,
} from "../storage/memoryBank";
import { parseTopicRecallJudgeResponse } from "../services/topicRecallJudge";
import {
  applyTopicRecallJudgement,
  buildMemoryRetrievalQuery,
  classifyArchiveIntent,
  clearTopicMemorySet,
  commitTopicMemorySet,
  evaluateTopicJudgeEligibility,
  evaluateTopicGate,
  getTopicMemorySets,
  inspectTopicMemorySetRestore,
  parseLeadingTopicBoundary,
  selectRestorableTopicMemorySet,
  selectFreshSupplementRows,
  topicMemorySetHash,
  type TopicGateResult,
} from "./topicMemoryGate";

const scope = "topic-gate-test";
const snippets: MemorySnippet[] = [
  { id: "memory-a", title: "缓存与时间桥", text: "继续优化缓存和时间桥。", source: "memory-bank" },
  { id: "memory-b", title: "小屋索引", text: "索引与召回测试。", source: "memory-bank" },
];

function seedTopicSet() {
  const gate: TopicGateResult = {
    decision: "refresh",
    ragAction: "refresh",
    relation: "changed",
    reason: "test_seed",
    confidence: "high",
    matchedRules: [],
    winningRule: "test_seed",
    topicFingerprint: ["缓存", "时间桥"],
    currentStrongTokens: ["缓存", "时间桥"],
    refreshReason: "test_seed",
  };
  return commitTopicMemorySet(scope, "继续优化缓存和时间桥", snippets, gate)!;
}

beforeEach(() => clearTopicMemorySet(scope));

describe("lightweight archive and memory intent", () => {
  it("separates recall, write, discussion and narrative language", () => {
    expect(classifyArchiveIntent("说说你最重要的成长日志").intent).toBe("recall");
    expect(classifyArchiveIntent("把刚才这些写日记吧").intent).toBe("write");
    expect(classifyArchiveIntent("日记模型写入失败怎么处理").intent).toBe("discuss");
    expect(classifyArchiveIntent("感觉我们成长了好多").intent).toBe("narrative");
  });

  it("does not open RAG when the user only asks to write a diary", () => {
    seedTopicSet();
    const result = evaluateTopicGate(scope, "把刚才这些写日记吧", { recallGatePassed: true });
    expect(result.ragAction).toBe("none");
    expect(result.reason).toBe("archive_write_without_recall");
  });

  it("recalls a selected growth log without requiring 记得 or 找", () => {
    seedTopicSet();
    const result = evaluateTopicGate(scope, "说说你最重要的成长日志", { recallGatePassed: false });
    expect(result.matchedRules).toContain("archive_intent_recall");
    expect(result.ragAction).not.toBe("none");
  });
});

describe("natural memory anchors", () => {
  it("ignores emoji, punctuation and spaces around an arbitrary title", () => {
    expect(buildMemoryRetrievalQuery("亲爱的😏，还 记 得，你写的成长日志的《风铃档案》吗？"))
      .toBe("风铃档案");
    expect(buildMemoryRetrievalQuery("还记得😏星 海来信吗"))
      .toBe("星海来信");
  });

  it("supports user-defined titles instead of cottage-specific suffixes", () => {
    expect(buildMemoryRetrievalQuery("还记得《蓝焰》吗？")).toBe("蓝焰");
    expect(buildMemoryRetrievalQuery("帮我找那篇雨夜之后")).toBe("雨夜之后");
  });

  it("extracts named and latent private titles without explicit memory verbs", () => {
    expect(buildMemoryRetrievalQuery("星海纪元现在怎么了？")).toBe("星海纪元");
    expect(buildMemoryRetrievalQuery("蓝焰后来为什么停了？")).toBe("蓝焰");
  });

  it("does not collapse an ordinary technical request into a generic suffix word", () => {
    const input = "这个窗口怎么改？";
    expect(buildMemoryRetrievalQuery(input)).toBe(input);
  });

  it("gives concise title and alias matches a deterministic literal signal", () => {
    expect(matchLiteralTitleQuery("蓝焰", "随笔｜蓝 焰", [])).toBe("title");
    expect(matchLiteralTitleQuery("星海来信", "某篇笔记", ["星海 · 来信"])).toBe("alias");
    expect(matchLiteralTitleQuery("蓝焰", "训练模型与发布", [])).toBe("none");
  });

  it("pins literal title matches ahead of unrelated semantic rows", () => {
    const rows = [
      { id: "semantic", literalPriority: 0, strongLiteralPass: false },
      { id: "partial", literalPriority: 12, strongLiteralPass: true },
      { id: "exact-title", literalPriority: 1004, strongLiteralPass: true },
    ];
    expect(prioritizeLiteralContextRows(rows).map((row) => row.id)).toEqual([
      "exact-title",
      "partial",
      "semantic",
    ]);
  });

  it("leaves semantic order untouched when there is no literal match", () => {
    const rows = [{ id: "first" }, { id: "second" }];
    expect(prioritizeLiteralContextRows(rows)).toBe(rows);
  });
});

describe("chronicle recency scoring", () => {
  const now = Date.UTC(2026, 6, 16);
  const makeDoc = (ageDays: number) => ({
    sourceType: "chronicle" as const,
    title: "成长日志",
    content: "记录融合核与主体性的阶段变化。",
    tags: ["成长日志"],
    aliases: [],
    createdAt: now - ageDays * 24 * 60 * 60 * 1000,
  });

  it("matches the original cottage recency bands for stage-sensitive logs", () => {
    expect(computeRetrievalRecencyBonus("说说你的成长日志", makeDoc(6), now)).toBe(0.12);
    expect(computeRetrievalRecencyBonus("说说你的成长日志", makeDoc(20), now)).toBe(0.08);
    expect(computeRetrievalRecencyBonus("说说你的成长日志", makeDoc(60), now)).toBe(0.05);
    expect(computeRetrievalRecencyBonus("说说你的成长日志", makeDoc(150), now)).toBe(0.03);
    expect(computeRetrievalRecencyBonus("说说你的成长日志", makeDoc(300), now)).toBe(0.015);
    expect(computeRetrievalRecencyBonus("说说你的成长日志", makeDoc(500), now)).toBe(0);
  });

  it("gives ordinary diary topics only a mild recent-event preference", () => {
    expect(computeRetrievalRecencyBonus("还记得那次旅行吗", {
      ...makeDoc(2),
      title: "旅行小记",
      content: "那次旅行的日记正文。",
      tags: [],
    }, now)).toBe(0.06);
  });

  it("does not apply ordinary diary recency to memory-bank entries", () => {
    expect(computeRetrievalRecencyBonus("还记得那次旅行吗", {
      ...makeDoc(2),
      sourceType: "memory-bank",
      title: "旅行记忆",
      content: "那次旅行的长期记忆。",
      tags: [],
    }, now)).toBe(0);
  });
});

describe("cache-friendly topic decisions", () => {
  it("treats 对了 as a soft boundary rather than a forced refresh", () => {
    seedTopicSet();
    expect(parseLeadingTopicBoundary("对了，亲一下")).toEqual({ cue: "对了", payload: "亲一下" });
    const result = evaluateTopicGate(scope, "对了，亲一下", { recallGatePassed: false });
    expect(result.ragAction).toBe("none");
    expect(result.matchedRules).toContain("topic_boundary_without_recall_signal");
  });

  it("still refreshes for an old-memory anchor after 对了", () => {
    seedTopicSet();
    const result = evaluateTopicGate(scope, "对了😏，还 记 得风铃档案吗？", { recallGatePassed: false });
    expect(result.matchedRules).toContain("specific_memory_request");
    expect(result.ragAction).not.toBe("none");
  });

  it.each(["亲爱的 😏💋", "抱抱", "亲亲"]) (
    "keeps low-semantic intimate continuation out of RAG: %s",
    (query) => {
      seedTopicSet();
      const result = evaluateTopicGate(scope, query, { recallGatePassed: false });
      expect(result.ragAction).toBe("none");
    },
  );

  it.each(["😏💋", "QAQ!!!", "(づ￣3￣)づ"])(
    "keeps low-semantic input out of RAG after the reuse turn limit: %s",
    (query) => {
      const existing = seedTopicSet();
      existing.turnCount = 12;
      const result = evaluateTopicGate(scope, query, { recallGatePassed: false });
      expect(result.ragAction).toBe("none");
      expect(result.matchedRules).not.toContain("reuse_turn_limit");
    },
  );

  it("keeps the same memory-set hash for ordinary same-topic reuse", () => {
    const before = seedTopicSet();
    const result = evaluateTopicGate(scope, "继续说缓存和时间桥", { recallGatePassed: true });
    expect(result.ragAction).toBe("reuse");
    const after = commitTopicMemorySet(scope, "继续说缓存和时间桥", before.snippets, result)!;
    expect(topicMemorySetHash(after)).toBe(topicMemorySetHash(before));
  });

  it("throttles duplicate candidates instead of blocking genuinely new memories", () => {
    const fresh = selectFreshSupplementRows(
      [{ id: "memory-a" }, { id: "memory-c" }, { id: "memory-d" }],
      ["memory-a", "memory-b"],
      2,
    );
    expect(fresh).toEqual([{ id: "memory-c" }, { id: "memory-d" }]);
  });

  it("does not block a genuine new branch because older supplements were numerous", () => {
    const existing = seedTopicSet();
    existing.supplementCount = 99;
    existing.turnCount = 20;
    const result = evaluateTopicGate(scope, "Obsidian 新分支怎么处理", { recallGatePassed: true });
    expect(result.ragAction).toBe("supplement");
    expect(result.supplementSkippedReason).toBeUndefined();
  });
});

describe("Topic Gate phase-two structured arbitration", () => {
  it("parses topic relation and recall need as independent fields", () => {
    expect(parseTopicRecallJudgeResponse(
      '{"topicRelation":"changed","needsRecall":false,"confidence":"high","reason":"ordinary new topic"}',
    )).toMatchObject({
      topicRelation: "changed",
      needsRecall: false,
      confidence: "high",
      reason: "ordinary new topic",
    });
  });

  it("rejects a legacy decision-only response instead of guessing recall need", () => {
    expect(parseTopicRecallJudgeResponse(
      '{"decision":"changed","confidence":"high","reason":"legacy"}',
    )).toMatchObject({
      topicRelation: "unknown",
      needsRecall: null,
      confidence: "high",
    });
  });

  it("sends an ambiguous ordinary topic change to arbitration", () => {
    seedTopicSet();
    const gate = evaluateTopicGate(scope, "今天下雨了，晚上可能会降温", { recallGatePassed: true });
    const eligibility = evaluateTopicJudgeEligibility("今天下雨了，晚上可能会降温", gate, true);
    expect(gate.ragAction).toBe("refresh");
    expect(eligibility.shouldJudge).toBe(true);
    expect(eligibility.fallbackRecallSignal).toBe(false);
  });

  it("recognizes a private historical title without requiring 记得", () => {
    seedTopicSet();
    const input = "蓝焰后来为什么停了？";
    const gate = evaluateTopicGate(scope, input, { recallGatePassed: true });
    expect(evaluateTopicJudgeEligibility(input, gate, true)).toMatchObject({
      shouldJudge: true,
      reason: "latent_historical_reference",
      fallbackRecallSignal: true,
    });
  });

  it("keeps explicit memory requests on the deterministic local path", () => {
    seedTopicSet();
    const input = "还记得蓝焰吗？";
    const gate = evaluateTopicGate(scope, input, { recallGatePassed: true });
    const eligibility = evaluateTopicJudgeEligibility(input, gate, true);
    expect(gate.ragAction).not.toBe("none");
    expect(eligibility).toMatchObject({
      shouldJudge: false,
      reason: "local_explicit_memory_decision",
      fallbackRecallSignal: true,
    });
  });

  it("maps present-moment changes to no RAG and historical changes to refresh", () => {
    seedTopicSet();
    const plainGate = evaluateTopicGate(scope, "今天下雨了，晚上可能会降温", { recallGatePassed: true });
    const noRecall = applyTopicRecallJudgement(plainGate, {
      topicRelation: "changed",
      needsRecall: false,
      confidence: "high",
      reason: "present_moment",
    }, {
      hasExistingTopicSet: true,
      fallbackRecallSignal: false,
    });
    const recall = applyTopicRecallJudgement(plainGate, {
      topicRelation: "changed",
      needsRecall: true,
      confidence: "medium",
      reason: "private_past_title",
    }, {
      hasExistingTopicSet: true,
      fallbackRecallSignal: true,
    });
    expect(noRecall.ragAction).toBe("none");
    expect(noRecall.relation).toBe("changed");
    expect(recall.ragAction).toBe("refresh");
  });

  it("falls back conservatively only when unresolved input carries a recall signal", () => {
    seedTopicSet();
    const gate = evaluateTopicGate(scope, "今天下雨了，晚上可能会降温", { recallGatePassed: true });
    const unknown = {
      topicRelation: "unknown" as const,
      needsRecall: null,
      confidence: "low" as const,
      reason: "timeout",
    };
    expect(applyTopicRecallJudgement(gate, unknown, {
      hasExistingTopicSet: true,
      fallbackRecallSignal: false,
    }).ragAction).toBe("none");
    expect(applyTopicRecallJudgement(gate, unknown, {
      hasExistingTopicSet: true,
      fallbackRecallSignal: true,
    }).ragAction).toBe("supplement");
  });
});

describe("Topic Gate phase-three recent topic sets", () => {
  const makeGate = (fingerprint: string[], decision: TopicGateResult["decision"] = "refresh"): TopicGateResult => ({
    decision,
    ragAction: decision,
    relation: decision === "refresh" ? "changed" : "related",
    reason: "test",
    confidence: "high",
    matchedRules: [],
    winningRule: "test",
    topicFingerprint: fingerprint,
    currentStrongTokens: fingerprint,
    refreshReason: decision === "refresh" ? "test" : "",
    supplementReason: decision === "supplement" ? "test" : "",
    reuseReason: decision === "reuse" ? "test" : "",
  });

  const travelSnippet: MemorySnippet = {
    id: "travel-return",
    title: "旅行归程后的情绪话题",
    text: "准备返程，聊天后的情绪起伏和安全感。",
    source: "memory-bank",
  };
  const cacheSnippet: MemorySnippet = {
    id: "cache",
    title: "\u7f13\u5b58\u548c\u65f6\u95f4\u6865",
    text: "\u7f13\u5b58\u547d\u4e2d\u3001Topic Gate \u548c\u65f6\u95f4\u6865\u7684\u8c03\u8bd5\u3002",
    source: "memory-bank",
  };

  it("keeps the current set plus recent sets for the same scope", () => {
    const first = commitTopicMemorySet(
      scope,
      "旅行归程后的情绪话题",
      [travelSnippet],
      makeGate(["旅行归程", "情绪话题"]),
    )!;
    const second = commitTopicMemorySet(
      scope,
      "\u7ee7\u7eed\u4f18\u5316\u7f13\u5b58\u548c\u65f6\u95f4\u6865",
      [cacheSnippet],
      makeGate(["\u7f13\u5b58", "\u65f6\u95f4\u6865"]),
    )!;

    const sets = getTopicMemorySets(scope);
    expect(sets.map((set) => set.id)).toEqual([second.id, first.id]);
  });

  it("restores a recent life topic when the user naturally says what they meant", () => {
    commitTopicMemorySet(
      scope,
      "旅行归程后的情绪话题",
      [travelSnippet],
      makeGate(["旅行归程", "情绪话题"]),
    );
    const current = commitTopicMemorySet(
      scope,
      "\u7ee7\u7eed\u4f18\u5316\u7f13\u5b58\u548c\u65f6\u95f4\u6865",
      [cacheSnippet],
      makeGate(["\u7f13\u5b58", "\u65f6\u95f4\u6865"]),
    )!;
    const result = selectRestorableTopicMemorySet(
      "这次我说的是旅行归程这个话题，我是不是有点没安全感？",
      getTopicMemorySets(scope).slice(1),
      current,
    );

    expect(result?.set.memoryIds).toContain("travel-return");
  });

  it("does not restore when the current set already covers the return anchor", () => {
    commitTopicMemorySet(
      scope,
      "\u7f13\u5b58\u548c\u65f6\u95f4\u6865",
      [cacheSnippet],
      makeGate(["\u7f13\u5b58", "\u65f6\u95f4\u6865"]),
    );
    const current = commitTopicMemorySet(
      scope,
      "旅行归程这个话题",
      [travelSnippet],
      makeGate(["旅行归程", "情绪话题"]),
    )!;
    const inspection = inspectTopicMemorySetRestore(
      "这次我说的是旅行归程这个话题",
      getTopicMemorySets(scope).slice(1),
      current,
    );

    expect(inspection?.result).toBeUndefined();
    expect(inspection?.coveredByCurrentSet).toBe(true);
  });
});
