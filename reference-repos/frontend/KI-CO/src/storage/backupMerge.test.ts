import { beforeEach, describe, expect, it, vi } from "vitest";
import { importChronicles, importMemorySeeds, listChronicles, listMemorySeeds } from "./chronicles";
import { importMemoryJson, listMemoryEntries, saveMemoryEntries } from "./memoryBank";

const store = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  },
});

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    dispatchEvent: vi.fn(() => true),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
});

Object.defineProperty(globalThis, "CustomEvent", {
  configurable: true,
  value: class {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  },
});

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("non-destructive backup merging", () => {
  it("keeps local memory content and ignores an identical same-id import", () => {
    saveMemoryEntries([{
      id: "memory-1",
      title: "本机标题",
      content: "本机记忆正文",
      tags: ["本机"],
      aliases: ["本机记忆"],
      importance: 3,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    }]);

    const identical = importMemoryJson(JSON.stringify(listMemoryEntries()));
    expect(identical.merged).toBe(0);

    const changed = importMemoryJson(JSON.stringify([{
      ...listMemoryEntries()[0],
      title: "备份标题",
      content: "备份里的不同正文",
      tags: ["备份"],
    }]));
    expect(changed.merged).toBe(1);
    expect(listMemoryEntries()[0].content).toBe("本机记忆正文");
    expect(listMemoryEntries()[0].tags).toEqual(expect.arrayContaining(["本机", "备份"]));
  });

  it("merges chronicle metadata without replacing local title, date, or active state", () => {
    importChronicles([{
      id: "chronicle-1",
      title: "本机日记标题",
      content: "本机较完整的日记正文",
      dateRange: "2026-07-01",
      createdAt: 100,
      updatedAt: 100,
      isActive: false,
      starred: false,
      mode: "manual",
      triggerKeywords: ["本机"],
      facts: [],
    }]);

    const report = importChronicles([{
      id: "chronicle-1",
      title: "备份标题",
      content: "短正文",
      dateRange: "2026-07-15",
      createdAt: 200,
      updatedAt: 200,
      isActive: true,
      starred: true,
      mode: "auto",
      triggerKeywords: ["备份"],
      facts: ["新增事实"],
    }]);
    const entry = listChronicles()[0];
    expect(report.merged).toBe(1);
    expect(entry.title).toBe("本机日记标题");
    expect(entry.content).toBe("本机较完整的日记正文");
    expect(entry.dateRange).toBe("2026-07-01");
    expect(entry.isActive).toBe(false);
    expect(entry.starred).toBe(true);
    expect(entry.triggerKeywords).toEqual(expect.arrayContaining(["本机", "备份"]));
  });

  it("merges memory seeds without deleting local rows or duplicating identical content", () => {
    importMemorySeeds([{
      id: "seed-local",
      title: "本机种子",
      content: "不要忘记这件事",
      date: "2026-07-01",
      tags: ["本机"],
      importance: 4,
      sourceChronicleIds: ["chronicle-1"],
      status: "pending",
      createdAt: 100,
    }]);

    const report = importMemorySeeds([
      {
        id: "seed-backup-duplicate",
        title: "重复种子",
        content: "不要忘记这件事",
        date: "2026-07-01",
        tags: ["备份"],
        importance: 4,
        sourceChronicleIds: [],
        status: "pending",
        createdAt: 200,
      },
      {
        id: "seed-new",
        title: "新种子",
        content: "另一件值得记住的事",
        date: "2026-07-15",
        tags: ["新增"],
        importance: 5,
        sourceChronicleIds: ["chronicle-2"],
        status: "pending",
        createdAt: 300,
      },
    ]);

    expect(report).toEqual({ added: 1, merged: 0, skipped: 1 });
    expect(listMemorySeeds(true)).toHaveLength(2);
  });
});
