export const DEFAULT_AI_REACTION_EMOJIS = ['❤️', '👍', '😂', '🥰', '🎉', '😕', '👎', '😢', '😠', '💔'];
export const DEFAULT_POSITIVE_REACTION_EMOJIS = ['❤️', '👍', '😂', '🥰', '🎉'];
export const DEFAULT_NEGATIVE_REACTION_EMOJIS = ['😕', '👎', '😢', '😠', '💔'];

export function normalizeReactionEmojiList(
  value: unknown,
  fallback: string[],
  limit = 24
): string[] {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(/[\s,，、;；]+/)
      : [];
  const unique = source
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, limit);
  return unique.length > 0 ? unique : [...fallback];
}

export function formatReactionEmojiList(value: string[]): string {
  return value.join(' ');
}
