import { randomUUID } from 'expo-crypto';
import { getMessagesByConversation, insertMessage } from '../../db/operations';
import { Message } from '../../types';
import {
  buildReactionSystemContent,
  getLatestUserMessageGroup,
} from '../messageReactions';
import type { ToolDefinition, ToolModule } from './types';
import {
  DEFAULT_AI_REACTION_EMOJIS,
  normalizeReactionEmojiList,
} from '../../utils/reactionEmojis';

function createReactionDefinition(allowedEmojis: string[]): ToolDefinition {
  return {
  type: 'function',
  function: {
    name: 'react_to_latest_user_message',
    description:
      '给最后一次助手回复之后、用户连续发送的某一条最新消息贴一个 emoji。仅在表情能自然表达情绪时使用；它不能代替正常回复。message_index 从 1 开始，按用户发送顺序编号。',
    parameters: {
      type: 'object',
      properties: {
        message_index: {
          type: 'integer',
          description: '最新用户消息组中的序号，从 1 开始。',
        },
        emoji: {
          type: 'string',
          description: `要贴的 emoji，只能从以下列表选择：${allowedEmojis.join(' ')}`,
          enum: allowedEmojis,
        },
      },
      required: ['message_index', 'emoji'],
    },
  },
  };
}

export const messageReactionTool: ToolModule = {
  id: 'message-reaction',
  labels: {
    react_to_latest_user_message: '给用户消息贴表情',
  },
  getDefinitions: (config) => {
    if (config.nativeTools?.messageReactionEnabled === false) return [];
    const allowedEmojis = normalizeReactionEmojiList(
      config.nativeTools?.aiReactionEmojis,
      DEFAULT_AI_REACTION_EMOJIS
    );
    return [createReactionDefinition(allowedEmojis)];
  },
  execute: async (toolName, args, context) => {
    if (toolName !== 'react_to_latest_user_message') return undefined;
    if (!context.conversationId) return '当前没有可操作的会话。';

    const emoji = String(args.emoji || '').trim();
    const allowedEmojis = new Set(normalizeReactionEmojiList(
      context.nativeToolConfig?.aiReactionEmojis,
      DEFAULT_AI_REACTION_EMOJIS
    ));
    if (!allowedEmojis.has(emoji)) return '该 emoji 不在允许列表中。';

    const messages = (await getMessagesByConversation(context.conversationId))
      .filter((message) => message.id !== context.messageId);
    const targets = getLatestUserMessageGroup(messages);
    const index = Number(args.message_index) - 1;
    const target = targets[index];
    if (!target) return `消息序号无效；当前共有 ${targets.length} 条最新用户消息。`;

    const reactionMessage: Message = {
      id: randomUUID(),
      role: 'system',
      content: buildReactionSystemContent({
        targetMessageId: target.id,
        reactor: 'assistant',
        emoji,
      }),
      createdAt: Date.now(),
    };
    await insertMessage(context.conversationId, reactionMessage);
    return `已给第 ${index + 1} 条最新用户消息贴了 ${emoji}。`;
  },
};
