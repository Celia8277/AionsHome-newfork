import type { ReactNode } from "react";

interface MarkdownTextProps {
  text: string;
  className?: string;
}

const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+?\*\*|__[^_]+?__|\*[^*\n]+?\*|_[^_\n]+?_)/g;

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  text.replace(INLINE_PATTERN, (match, _token, offset: number) => {
    if (offset > lastIndex) parts.push(text.slice(lastIndex, offset));
    const key = `${offset}-${match}`;

    if (match.startsWith("`")) {
      parts.push(<code key={key}>{match.slice(1, -1)}</code>);
    } else if (match.startsWith("**") || match.startsWith("__")) {
      parts.push(<strong key={key}>{match.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={key}>{match.slice(1, -1)}</em>);
    }

    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function renderHeading(level: number, content: ReactNode[], key: string) {
  if (level <= 1) return <h1 key={key}>{content}</h1>;
  if (level === 2) return <h2 key={key}>{content}</h2>;
  if (level === 3) return <h3 key={key}>{content}</h3>;
  if (level === 4) return <h4 key={key}>{content}</h4>;
  if (level === 5) return <h5 key={key}>{content}</h5>;
  return <h6 key={key}>{content}</h6>;
}

export function MarkdownText({ text, className = "cottage-markdown" }: MarkdownTextProps) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push(
        <pre key={`code-${index}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${index}`} />);
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push(renderHeading(headingMatch[1].length, renderInline(headingMatch[2].trim()), `heading-${index}`));
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push(<blockquote key={`quote-${index}`}>{renderInline(quoteLines.join("\n"))}</blockquote>);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}-${item}`}>{renderInline(item)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      index -= 1;
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={`${itemIndex}-${item}`}>{renderInline(item)}</li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines = [line];
    while (
      index + 1 < lines.length &&
      lines[index + 1].trim() &&
      !lines[index + 1].trim().startsWith("```") &&
      !lines[index + 1].trim().startsWith(">") &&
      !/^(#{1,6})\s+/.test(lines[index + 1].trim()) &&
      !/^[-*]\s+/.test(lines[index + 1].trim()) &&
      !/^\d+\.\s+/.test(lines[index + 1].trim()) &&
      !/^[-*_]{3,}$/.test(lines[index + 1].trim())
    ) {
      index += 1;
      paragraphLines.push(lines[index]);
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraphLines.join("\n"))}</p>);
  }

  return <div className={className}>{blocks.length ? blocks : <p />}</div>;
}
