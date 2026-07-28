import { randomUUID } from 'expo-crypto';
import type { Conversation, Message } from '../types';
import { importConversation } from '../db/operations';

type ClaudeContentBlock = {
  type?: unknown;
  text?: unknown;
  thinking?: unknown;
};

type ClaudeAttachment = {
  file_name?: unknown;
  extracted_content?: unknown;
};

type ClaudeMessage = {
  uuid?: unknown;
  sender?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  text?: unknown;
  content?: unknown;
  attachments?: unknown;
  files?: unknown;
};

type ClaudeConversation = {
  uuid?: unknown;
  name?: unknown;
  summary?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  chat_messages?: unknown;
};

export interface ClaudeImportResult {
  conversation: Conversation;
  messageCount: number;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function messageText(message: ClaudeMessage): string {
  const blocks = Array.isArray(message.content)
    ? message.content as ClaudeContentBlock[]
    : [];
  const contentBlocks = blocks.flatMap((block): string[] => {
    if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
      return [block.text.trim()];
    }
    if (
      block?.type === 'thinking' &&
      typeof block.thinking === 'string' &&
      block.thinking.trim()
    ) {
      return [`<thinking>\n${block.thinking.trim()}\n</thinking>`];
    }
    return [];
  });
  let text = contentBlocks.join('\n\n').trim() || asNonEmptyString(message.text) || '';

  // Claude exports the extracted text of uploaded documents separately from the
  // human message. Keep it in the imported transcript so future replies retain context.
  const attachments = Array.isArray(message.attachments)
    ? message.attachments as ClaudeAttachment[]
    : [];
  const attachmentTexts = attachments.flatMap((attachment) => {
    const content = asNonEmptyString(attachment?.extracted_content);
    if (!content) return [];
    const name = asNonEmptyString(attachment?.file_name) || '附件';
    return [`[附件：${name}]\n${content}`];
  });
  if (attachmentTexts.length > 0) {
    text = [text, ...attachmentTexts].filter(Boolean).join('\n\n');
  }

  return text.trim();
}

function isClaudeConversation(value: unknown): value is ClaudeConversation {
  if (!value || typeof value !== 'object') return false;
  const conversation = value as ClaudeConversation;
  return Array.isArray(conversation.chat_messages) &&
    (typeof conversation.uuid === 'string' ||
      typeof conversation.name === 'string' ||
      typeof conversation.summary === 'string');
}

export function parseClaudeConversations(
  text: string
): Array<{ conversation: Conversation; messages: Message[] }> {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new Error('文件不是有效的 JSON');
  }
  if (!Array.isArray(data) || !data.every(isClaudeConversation)) {
    throw new Error('文件不是 Claude 官方导出的 conversations.json');
  }

  const parsed = data.flatMap((raw, conversationIndex) => {
    const rawMessages = raw.chat_messages as ClaudeMessage[];
    const fallbackStart = parseTimestamp(raw.created_at) || Date.now() + conversationIndex;
    let previousTimestamp = fallbackStart - 1;
    const messages = rawMessages.flatMap((rawMessage, messageIndex): Message[] => {
      if (rawMessage?.sender !== 'human' && rawMessage?.sender !== 'assistant') return [];
      const content = messageText(rawMessage);
      if (!content) return [];
      const parsedTimestamp =
        parseTimestamp(rawMessage.created_at) ||
        parseTimestamp(rawMessage.updated_at) ||
        fallbackStart + messageIndex;
      const createdAt = Math.max(parsedTimestamp, previousTimestamp + 1);
      previousTimestamp = createdAt;
      return [{
        id: randomUUID(),
        role: rawMessage.sender === 'human' ? 'user' : 'assistant',
        content,
        createdAt,
      }];
    });
    if (messages.length === 0) return [];

    const createdAt = parseTimestamp(raw.created_at) || messages[0].createdAt;
    const updatedAt = Math.max(
      parseTimestamp(raw.updated_at) || 0,
      messages[messages.length - 1].createdAt
    );
    const conversation: Conversation = {
      id: randomUUID(),
      title: asNonEmptyString(raw.name) || asNonEmptyString(raw.summary) || 'Claude 聊天',
      systemPrompt: '',
      model: 'Claude',
      createdAt,
      updatedAt,
      hiddenRanges: [],
      hiddenMessageIds: [],
    };
    return [{ conversation, messages }];
  });

  if (parsed.length === 0) {
    throw new Error('Claude 导出文件中没有可导入的文本消息');
  }
  return parsed;
}

export async function importClaudeConversations(text: string): Promise<ClaudeImportResult[]> {
  const parsed = parseClaudeConversations(text);
  const results: ClaudeImportResult[] = [];
  for (const item of parsed) {
    await importConversation(item.conversation, item.messages);
    results.push({
      conversation: item.conversation,
      messageCount: item.messages.length,
    });
  }
  return results;
}
