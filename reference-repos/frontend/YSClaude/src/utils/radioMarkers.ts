import type { Message } from '../types';

export const RADIO_START_MARKER = '[AI_RADIO_START]';
export const RADIO_CALL_IN_MARKER = '[AI_RADIO_CALL_IN]';
export const RADIO_CONTINUE_MARKER = '[AI_RADIO_CONTINUE]';
export const RADIO_END_MARKER = '[AI_RADIO_END]';

export function buildRadioRuntimeContext(messages: Message[]): string | null {
  const radioMarkers = messages
    .filter((message) => message.role === 'system' && message.content.includes('[AI_RADIO_'))
    .slice(-4);
  if (radioMarkers.length === 0) return null;

  return [
    '当前聊天中存在 AI 电台状态标记。它们是系统上下文，不是用户自然发言。',
    ...radioMarkers.map((message) => message.content),
  ].join('\n\n');
}
