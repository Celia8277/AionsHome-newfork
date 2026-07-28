import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_UPLINK_SETTINGS } from "./uplinkSettings";
import {
  canonicalizeKnownApiBaseUrl,
  findRememberedApiKey,
  preserveLocalSecretsForImportedSettings,
  rememberApiKeyForEndpoint,
} from "./apiKeyRing";

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

beforeEach(() => {
  store.clear();
});

describe("API key ring", () => {
  it("remembers separate keys for separate endpoints", () => {
    rememberApiKeyForEndpoint("openrouter", "https://openrouter.ai/api/v1", "sk-or-local");
    rememberApiKeyForEndpoint("openrouter", "https://relay.example.com/v1", "sk-relay-local");

    expect(findRememberedApiKey("openrouter", "https://openrouter.ai/api/v1/")).toBe("sk-or-local");
    expect(findRememberedApiKey("openrouter", "https://relay.example.com/v1")).toBe("sk-relay-local");
    expect(findRememberedApiKey("openrouter", "https://new.example.com/v1")).toBe("");
  });

  it("normalizes OpenRouter www/http aliases", () => {
    expect(canonicalizeKnownApiBaseUrl("http://www.openrouter.ai/api/v1/"))
      .toBe("https://openrouter.ai/api/v1");
  });

  it("does not carry a current key into an imported profile with another endpoint", () => {
    const current = structuredClone(DEFAULT_UPLINK_SETTINGS);
    current.profiles.openrouter.baseUrl = "https://openrouter.ai/api/v1";
    current.profiles.openrouter.apiKey = "sk-or-local";
    const imported = structuredClone(DEFAULT_UPLINK_SETTINGS);
    imported.profiles.openrouter.baseUrl = "https://relay.example.com/v1";

    const result = preserveLocalSecretsForImportedSettings(imported, current);

    expect(result.profiles.openrouter.apiKey).toBe("");
    expect(findRememberedApiKey("openrouter", current.profiles.openrouter.baseUrl)).toBe("sk-or-local");
  });

  it("restores a remembered key when an imported profile returns to that endpoint", () => {
    const current = structuredClone(DEFAULT_UPLINK_SETTINGS);
    current.profiles.openrouter.baseUrl = "https://relay.example.com/v1";
    current.profiles.openrouter.apiKey = "sk-relay-local";
    rememberApiKeyForEndpoint("openrouter", "https://openrouter.ai/api/v1", "sk-or-local");
    const imported = structuredClone(DEFAULT_UPLINK_SETTINGS);

    const result = preserveLocalSecretsForImportedSettings(imported, current);

    expect(result.profiles.openrouter.apiKey).toBe("sk-or-local");
  });
});
