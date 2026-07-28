import type { ModelProvider, UplinkSettings } from "../types";

const API_KEY_RING_STORAGE_KEY = "kisera_cottage_api_key_ring_v1";
const API_KEY_RING_SEPARATOR = "::";

export function canonicalizeKnownApiBaseUrl(rawBaseUrl: string): string {
  const source = String(rawBaseUrl || "").trim().replace(/\/+$/, "");
  if (!source) return "";

  try {
    const url = new URL(source);
    if (/^(?:www\.)?openrouter\.ai$/i.test(url.hostname)) {
      url.protocol = "https:";
      url.hostname = "openrouter.ai";
      url.port = "";
      return url.toString().replace(/\/+$/, "");
    }
  } catch {
    // Local and custom relays may use nonstandard addresses.
  }

  return source;
}

export function normalizeCredentialEndpoint(rawBaseUrl: string): string {
  return canonicalizeKnownApiBaseUrl(rawBaseUrl).toLowerCase();
}

function keyRingEntryKey(provider: ModelProvider, baseUrl: string): string {
  return `${provider}${API_KEY_RING_SEPARATOR}${normalizeCredentialEndpoint(baseUrl)}`;
}

function readApiKeyRing(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(API_KEY_RING_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

function writeApiKeyRing(ring: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(API_KEY_RING_STORAGE_KEY, JSON.stringify(ring));
  } catch {
    // The active profile still retains its key if storage is unavailable.
  }
}

export function rememberApiKeyForEndpoint(provider: ModelProvider, baseUrl: string, apiKey: string): void {
  const endpoint = normalizeCredentialEndpoint(baseUrl);
  if (!endpoint) return;

  const ring = readApiKeyRing();
  const entryKey = keyRingEntryKey(provider, endpoint);
  const cleanKey = String(apiKey || "").trim();
  if (cleanKey) {
    ring[entryKey] = cleanKey;
  } else {
    delete ring[entryKey];
  }
  writeApiKeyRing(ring);
}

export function findRememberedApiKey(provider: ModelProvider, baseUrl: string): string {
  const endpoint = normalizeCredentialEndpoint(baseUrl);
  if (!endpoint) return "";
  return String(readApiKeyRing()[keyRingEntryKey(provider, endpoint)] || "");
}

function endpointsMatch(left: string, right: string): boolean {
  const normalizedLeft = normalizeCredentialEndpoint(left);
  return !!normalizedLeft && normalizedLeft === normalizeCredentialEndpoint(right);
}

export function preserveLocalSecretsForImportedSettings(
  imported: UplinkSettings,
  current: UplinkSettings,
): UplinkSettings {
  const next = JSON.parse(JSON.stringify(imported)) as UplinkSettings;

  (Object.keys(next.profiles) as ModelProvider[]).forEach((provider) => {
    const currentProfile = current.profiles[provider];
    const importedProfile = next.profiles[provider];
    if (!currentProfile || !importedProfile) return;

    rememberApiKeyForEndpoint(provider, currentProfile.baseUrl, currentProfile.apiKey);
    importedProfile.apiKey = endpointsMatch(importedProfile.baseUrl, currentProfile.baseUrl)
      ? currentProfile.apiKey
      : findRememberedApiKey(provider, importedProfile.baseUrl);
  });

  if (next.memoryRetrieval && current.memoryRetrieval) {
    next.memoryRetrieval.vectorOpenAIApiKey = endpointsMatch(
      next.memoryRetrieval.vectorOpenAIBaseUrl,
      current.memoryRetrieval.vectorOpenAIBaseUrl,
    )
      ? current.memoryRetrieval.vectorOpenAIApiKey
      : "";
  }

  return next;
}
