const HTML_FENCE_PATTERN = /(^|\n)([ \t]*)(`{3,}|~{3,})([^\r\n]*)\r?\n([\s\S]*?)(?:\r?\n\2\3[ \t]*(?=\r?\n|$)|$)/g;

interface HtmlCodeBlockMatch {
  blockIndex: number;
  content: string;
  language: string;
}

function getFenceLanguage(info: string): string {
  return info.trim().split(/\s+/)[0]?.toLowerCase() || '';
}

function isHtmlFenceLanguage(language: string): boolean {
  return language === 'html' || language === 'htm' || language === 'xhtml';
}

export function replaceMarkdownHtmlCodeBlock(
  markdown: string,
  targetBlockIndex: number,
  nextHtml: string
): string | null {
  let htmlBlockIndex = 0;
  let match: RegExpExecArray | null;
  HTML_FENCE_PATTERN.lastIndex = 0;

  while ((match = HTML_FENCE_PATTERN.exec(markdown)) !== null) {
    const language = getFenceLanguage(match[4] || '');
    if (!isHtmlFenceLanguage(language)) continue;

    if (htmlBlockIndex === targetBlockIndex) {
      const openingLineEnd = markdown.indexOf('\n', match.index);
      if (openingLineEnd < 0) return null;
      const contentStart = openingLineEnd + 1;
      const contentEnd = contentStart + match[5].length;
      return `${markdown.slice(0, contentStart)}${nextHtml}${markdown.slice(contentEnd)}`;
    }

    htmlBlockIndex += 1;
  }

  return null;
}

export function findMarkdownHtmlCodeBlocks(markdown: string): HtmlCodeBlockMatch[] {
  const matches: HtmlCodeBlockMatch[] = [];
  let match: RegExpExecArray | null;
  HTML_FENCE_PATTERN.lastIndex = 0;

  while ((match = HTML_FENCE_PATTERN.exec(markdown)) !== null) {
    const language = getFenceLanguage(match[4] || '');
    if (!isHtmlFenceLanguage(language)) continue;
    matches.push({
      blockIndex: matches.length,
      content: match[5],
      language,
    });
  }

  return matches;
}
