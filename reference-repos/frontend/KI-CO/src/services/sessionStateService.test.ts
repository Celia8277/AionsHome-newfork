import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanionRequest, CompanionResponse, ConversationMessage, ConversationRecord, LLMAdapter } from "../types";
import { createPersonaCard, type PersonaProfile } from "../storage/personaProfile";
import { clearSessionStateCard, getSessionStateCard, updateSessionStateCard } from "./sessionStateService";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    dispatchEvent: vi.fn(),
  },
});

const profile: PersonaProfile = {
  userName: "User",
  userAvatarDataUrl: "",
  userAvatarPosition: { x: 50, y: 50, scale: 1 },
  showAvatars: true,
  activePersonaId: "persona-test",
  personas: [
    createPersonaCard({
      id: "persona-test",
      name: "Companion",
      systemPrompt: "Stable persona core.",
    }),
  ],
};

function makeMessages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % 2 === 0 ? "user" : "companion",
    text: `sealed-test-message-${index}`,
    createdAt: new Date(Date.UTC(2026, 6, 19, 10, index)).toISOString(),
  }));
}

function makeConversation(messages: ConversationMessage[]): ConversationRecord {
  return {
    id: "session-test",
    title: "Test",
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-19T10:20:00.000Z",
    messages,
  };
}

function validCard(): string {
  return [
    "Now：旧话题已离开短期原文窗口。",
    "Note：之后自然相关时可以接回。",
    "Known：已形成一个明确结论。",
    "Mood：平静。",
    "Maybe：旧话题仍可继续。",
    "Anchor：封存区。",
  ].join("\n");
}

describe("session state card sealed-window behavior", () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    clearSessionStateCard("session-test");
  });

  it("uses the dedicated state-card request and excludes the recent message tail", async () => {
    let captured: CompanionRequest | undefined;
    const llm: LLMAdapter = {
      complete: vi.fn(async (request: CompanionRequest): Promise<CompanionResponse> => {
        captured = request;
        return { text: validCard() };
      }),
    };
    const messages = makeMessages(8);

    const result = await updateSessionStateCard(
      llm,
      profile,
      makeConversation(messages),
      6,
    );

    expect(result?.lastMessageCount).toBe(2);
    expect(captured?.purpose).toBe("session-state");
    expect(captured?.channel).toBe("journal");
    expect(captured?.temperatureOverride).toBe(0.35);
    expect(captured?.maxOutputTokensOverride).toBe(900);
    expect(captured?.userMessage).toContain("sealed-test-message-0");
    expect(captured?.userMessage).toContain("sealed-test-message-1");
    expect(captured?.userMessage).not.toContain("sealed-test-message-2");
    expect(captured?.userMessage).not.toContain("sealed-test-message-7");
  });

  it("does not rewrite the card again before enough newly sealed messages accumulate", async () => {
    const llm: LLMAdapter = {
      complete: vi.fn(async (): Promise<CompanionResponse> => ({ text: validCard() })),
    };
    await updateSessionStateCard(llm, profile, makeConversation(makeMessages(8)), 6);
    expect(getSessionStateCard("session-test")?.lastMessageCount).toBe(2);
    vi.mocked(llm.complete).mockClear();

    const result = await updateSessionStateCard(
      llm,
      profile,
      makeConversation(makeMessages(10)),
      6,
      "继续聊当前内容",
    );

    expect(result).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
    expect(getSessionStateCard("session-test")?.lastMessageCount).toBe(2);
  });

  it("updates before a coverage gap opens between the card and recent-message window", async () => {
    const llm: LLMAdapter = {
      complete: vi.fn(async (): Promise<CompanionResponse> => ({ text: validCard() })),
    };
    await updateSessionStateCard(llm, profile, makeConversation(makeMessages(8)), 6);
    vi.mocked(llm.complete).mockClear();

    const result = await updateSessionStateCard(
      llm,
      profile,
      makeConversation(makeMessages(12)),
      6,
      "继续聊当前内容",
    );

    expect(result?.lastMessageCount).toBe(6);
    expect(llm.complete).toHaveBeenCalledOnce();
  });
});
