export interface PictureToken {
  tokenIndex: number;
  prompt: string;
  rawToken: string;
  start: number;
  end: number;
}

const PICTURE_PATTERN = /\[Pic:([^\]\r\n]+)\]/g;

function normalizePicturePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, ' ');
}

export function createPictureToken(prompt: string): string {
  return `[Pic:${normalizePicturePrompt(prompt)}]`;
}

export function extractPictureTokens(content: string): PictureToken[] {
  const tokens: PictureToken[] = [];
  const pattern = new RegExp(PICTURE_PATTERN);
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const prompt = normalizePicturePrompt(match[1]);
    if (!prompt) continue;
    tokens.push({
      tokenIndex: tokens.length,
      prompt,
      rawToken: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
}

export function hasPictureToken(content: string): boolean {
  return extractPictureTokens(content).length > 0;
}

export function removePictureTokenAtIndex(content: string, tokenIndex: number): string {
  const tokens = extractPictureTokens(content);
  const target = tokens.find((token) => token.tokenIndex === tokenIndex);
  if (!target) return content;

  const next = `${content.slice(0, target.start)}${content.slice(target.end)}`;
  return next
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function composePicturePrompt(basePrompt: string | undefined, prompt: string): string {
  const cleanBase = (basePrompt || '').trim();
  const cleanPrompt = normalizePicturePrompt(prompt);
  if (!cleanBase) return cleanPrompt;
  return `${cleanBase}\n\n画面描述：${cleanPrompt}`;
}

export function buildPictureSystemInstruction(enabled: boolean): string | null {
  if (!enabled) return null;

  return [
    '你可以发送 AI 生成图片。需要发送图片时，在回复中写 [Pic:图片描述]。',
    '图片描述应简短、具体，直接描述画面内容；不要把 [Pic:...] 放进代码块。',
    '仅在用户明确需要图片、插画、照片、头像、壁纸、示意图等视觉内容时使用；普通聊天不要使用。',
    '除非用户明确要求多张图，否则每次回复最多使用 1 个 [Pic:...]。',
  ].join('\n');
}
