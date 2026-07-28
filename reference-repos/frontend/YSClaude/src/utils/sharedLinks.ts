import type { ResolvedSharePayload, SharePayload } from 'expo-sharing';

const URL_MATCH = /https?:\/\/[^\s<>"']+/i;
const TRAILING_PUNCTUATION = /[),.;:!?，。；：！？、）】》"'`]+$/;

function extractFirstHttpUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(URL_MATCH);
  if (!match) return null;

  let value = match[0].replace(TRAILING_PUNCTUATION, '');
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return value;
  }
}

export function getSingleHttpUrlMessage(content: string): string | null {
  const trimmed = content.trim();
  const match = trimmed.match(URL_MATCH);
  if (!match) return null;
  const rawUrl = match[0].replace(TRAILING_PUNCTUATION, '');
  if (rawUrl !== trimmed) return null;
  return extractFirstHttpUrl(trimmed);
}

export function extractSharedHttpUrl(
  payloads: SharePayload[],
  resolvedPayloads: ResolvedSharePayload[] = []
): string | null {
  const sharedValues = [
    ...payloads.filter((payload) => payload.shareType === 'url').map((payload) => payload.value),
    ...payloads.map((payload) => payload.value),
    ...resolvedPayloads
      .filter((payload) => payload.contentType === 'website')
      .flatMap((payload) => [payload.contentUri, payload.value]),
    ...resolvedPayloads.map((payload) => payload.value),
  ];

  for (const value of sharedValues) {
    const url = extractFirstHttpUrl(value);
    if (url) return url;
  }

  return null;
}

export function getLinkCardInfo(url: string) {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./i, '');
    return {
      title: hostname,
      subtitle: parsed.pathname === '/' ? parsed.origin : `${hostname}${parsed.pathname}`,
    };
  } catch {
    return {
      title: '网页链接',
      subtitle: url,
    };
  }
}
