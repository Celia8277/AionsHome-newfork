import { Platform } from 'react-native';

export type VoiceCallStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'stopping'
  | 'error';

export interface VoiceCallTranscriptItem {
  id: string;
  speaker: 'user' | 'assistant';
  text: string;
}

export interface VoiceCallSnapshot {
  active: boolean;
  status: VoiceCallStatus;
  startedAt: number | null;
  micEnabled: boolean;
  speakerphoneOn: boolean;
  partialTranscript: string;
  lastUserText: string;
  speakingText: string;
  transcriptItems: VoiceCallTranscriptItem[];
  error: string | null;
}

export type VoiceCallMediaMode = 'voice' | 'video' | 'screen';

export function getVoiceCallStartSystemMessage(mode: VoiceCallMediaMode): string {
  if (mode === 'video') return '开启视频通话，以下内容为通话记录';
  if (mode === 'screen') return '开启共享屏幕通话，以下内容为通话记录';
  return '开启语音通话，以下内容为通话记录';
}

export function getVoiceCallRuntimeInstruction(mode: VoiceCallMediaMode): string {
  const spokenRequirement =
    '请把接下来的回复当作会被 TTS 朗读出来的口语回复：优先简洁、自然、可直接念出；避免 Markdown 表格、长列表、复杂括号说明和不适合朗读的格式；如果内容较长，请先给结论，再分段说明。';
  if (mode === 'video') {
    return `当前正在与用户进行实时视频通话。用户消息可能附带当前摄像头画面，请结合画面和语音回答；无法看清时要明确询问，不要臆测画面内容。${spokenRequirement}`;
  }
  if (mode === 'screen') {
    return `当前正在与用户进行实时共享屏幕通话。用户消息可能附带当前屏幕画面，请重点结合屏幕上的界面、文字和操作回答；无法看清时要明确询问，不要臆测屏幕内容。${spokenRequirement}`;
  }
  return `当前正在与用户进行实时语音通话。本模式没有视觉画面，不要声称看到了用户或屏幕。${spokenRequirement}`;
}

export const VOICE_CALL_ASSISTANT_INITIATED_INSTRUCTION =
  '用户已接听你主动发起的语音通话。你现在必须先开口，用自然口语直接开始这通电话；不要等待用户先说话，不要说明你调用了工具。';

export function getVoiceCallEndSystemMessage(mode: VoiceCallMediaMode): string {
  if (mode === 'video') return '视频通话结束';
  if (mode === 'screen') return '共享屏幕通话结束';
  return '语音通话结束';
}

export function isAndroidVoiceCallAvailable(): boolean {
  return Platform.OS === 'android';
}
