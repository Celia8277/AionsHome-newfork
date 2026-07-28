import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import type { Conversation, Message } from '../types';
import { importConversation } from '../db/operations';
import {
  hasAndroidNativeFilePicker,
  pickAndroidConversationFile,
  readAndroidTextFile,
} from './androidFilePicker';
import { importClaudeConversations } from './claudeImport';

type SillyTavernRecord = {
  user_name?: unknown;
  character_name?: unknown;
  create_date?: unknown;
  chat_metadata?: unknown;
  name?: unknown;
  is_user?: unknown;
  is_system?: unknown;
  send_date?: unknown;
  gen_started?: unknown;
  mes?: unknown;
  extra?: { model?: unknown } | unknown;
};

export interface SillyTavernImportResult {
  conversation: Conversation;
  messageCount: number;
  fileName: string;
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const direct = Date.parse(value);
  if (Number.isFinite(direct)) return direct;

  const match = value.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})@(\d{1,2})h(\d{1,2})m(\d{1,2})s$/
  );
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ).getTime();
}

function getModel(record: SillyTavernRecord): string | undefined {
  if (!record.extra || typeof record.extra !== 'object') return undefined;
  const model = (record.extra as { model?: unknown }).model;
  return typeof model === 'string' && model.trim() ? model.trim() : undefined;
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.jsonl$/i, '').trim() || 'SillyTavern 聊天';
}

export function parseSillyTavernChat(
  text: string,
  fileName: string
): { conversation: Conversation; messages: Message[] } {
  const records: SillyTavernRecord[] = [];
  const invalidLines: number[] = [];

  text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') records.push(parsed);
    } catch {
      invalidLines.push(index + 1);
    }
  });

  if (invalidLines.length > 0) {
    throw new Error(`第 ${invalidLines.slice(0, 3).join('、')} 行不是有效 JSON`);
  }

  const metadata = records.find(
    (record) => record.chat_metadata !== undefined || record.user_name !== undefined
  );
  const messageRecords = records.filter(
    (record) => typeof record.mes === 'string' &&
      (typeof record.is_user === 'boolean' || typeof record.is_system === 'boolean')
  );
  if (messageRecords.length === 0) {
    throw new Error('文件中没有找到 SillyTavern 聊天消息');
  }

  const fallbackStart =
    parseTimestamp(metadata?.create_date) ||
    parseTimestamp(messageRecords[0]?.send_date) ||
    Date.now();
  let previousTimestamp = fallbackStart - 1;
  const messages = messageRecords.map((record, index): Message => {
    const parsedTimestamp =
      parseTimestamp(record.send_date) ||
      parseTimestamp(record.gen_started) ||
      fallbackStart + index;
    const createdAt = Math.max(parsedTimestamp, previousTimestamp + 1);
    previousTimestamp = createdAt;

    return {
      id: randomUUID(),
      role: record.is_system === true
        ? 'system'
        : record.is_user === true
          ? 'user'
          : 'assistant',
      content: String(record.mes),
      createdAt,
    };
  });

  const models = messageRecords.map(getModel).filter((model): model is string => !!model);
  const createdAt = messages[0].createdAt;
  const updatedAt = messages[messages.length - 1].createdAt;
  return {
    conversation: {
      id: randomUUID(),
      title: titleFromFileName(fileName),
      systemPrompt: '',
      model: models[models.length - 1] || '',
      createdAt,
      updatedAt,
      hiddenRanges: [],
      hiddenMessageIds: [],
    },
    messages,
  };
}

export async function pickAndImportSillyTavernChats(): Promise<SillyTavernImportResult[]> {
  const useAndroidPicker = hasAndroidNativeFilePicker();
  const androidFile = useAndroidPicker ? await pickAndroidConversationFile() : null;
  if (useAndroidPicker && !androidFile) return [];

  const picked = useAndroidPicker
    ? null
    : await File.pickFileAsync({
        mimeTypes: ['*/*'],
        multipleFiles: false,
      });
  if (!androidFile && (picked?.canceled || !picked?.result)) return [];

  const file = androidFile ? new File(androidFile.uri) : picked?.result;
  if (!file) return [];
  const fileName = androidFile?.name || file.name || 'SillyTavern 聊天.jsonl';
  const text = (await readAndroidTextFile(file.uri)) ?? (await file.text());
  if (/\.json$/i.test(fileName)) {
    const imported = await importClaudeConversations(text);
    return imported.map((item) => ({ ...item, fileName }));
  }
  const parsed = parseSillyTavernChat(text, fileName);
  await importConversation(parsed.conversation, parsed.messages);
  return [{
    conversation: parsed.conversation,
    messageCount: parsed.messages.length,
    fileName,
  }];
}
