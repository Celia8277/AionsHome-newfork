import '@elevenlabs/react-native';
import { Conversation, type VoiceConversation } from '@elevenlabs/client';
import { useSettingsStore } from '../stores/settings';
import type { VoiceCallSnapshot } from './voiceCallSession';

type SnapshotListener = (snapshot: VoiceCallSnapshot) => void;
type Subscription = { remove: () => void };

export class ElevenLabsVoiceCallSession {
  private conversation: VoiceConversation | null = null;
  private listeners = new Set<SnapshotListener>();
  private stopping = false;
  private snapshot: VoiceCallSnapshot = {
    active: false,
    status: 'idle',
    startedAt: null,
    micEnabled: true,
    speakerphoneOn: true,
    partialTranscript: '',
    lastUserText: '',
    speakingText: '',
    transcriptItems: [],
    error: null,
  };

  subscribe(listener: SnapshotListener): Subscription {
    this.listeners.add(listener);
    listener(this.snapshot);
    return { remove: () => this.listeners.delete(listener) };
  }

  async start(): Promise<void> {
    if (this.snapshot.active) return;
    const settings = useSettingsStore.getState();
    const tts = settings.ttsConfig;
    if (settings.voiceCallSTTProvider !== 'elevenlabs' || settings.voiceCallTTSProvider !== 'elevenlabs') {
      throw new Error('ElevenLabs Speech Engine 仅在通话 STT 和 TTS 都选择 ElevenLabs 时启用');
    }
    const endpoint = tts.elevenLabsTokenEndpoint.trim();
    if (!endpoint) {
      throw new Error('请先配置 ElevenLabs Token Endpoint');
    }

    this.update({
      active: true,
      status: 'connecting',
      startedAt: Date.now(),
      micEnabled: true,
      speakerphoneOn: true,
      error: null,
      transcriptItems: [],
      partialTranscript: '',
      lastUserText: '',
      speakingText: '',
    });

    try {
      const conversationToken = await fetchConversationToken(endpoint);
      const conversation = await Conversation.startSession({
        conversationToken,
        connectionType: 'webrtc',
        overrides: {
          agent: {
            language: normalizeElevenLabsLanguage(tts.elevenLabsLanguage),
          },
          ...(tts.elevenLabsVoiceId.trim()
            ? { tts: { voiceId: tts.elevenLabsVoiceId.trim() } }
            : {}),
        },
        onConnect: () => this.update({ status: 'listening' }),
        onStatusChange: ({ status }) => {
          if (status === 'connecting') this.update({ status: 'connecting' });
        },
        onModeChange: ({ mode }) => {
          this.update({
            status: mode === 'speaking' ? 'speaking' : 'listening',
            partialTranscript: '',
            ...(mode === 'listening' ? { speakingText: '' } : {}),
          });
        },
        onMessage: ({ message, role }) => this.handleMessage(message, role),
        onInterruption: () => this.update({ status: 'listening', speakingText: '' }),
        onError: (message) => this.fail(message || 'ElevenLabs 通话出错'),
        onDisconnect: (details) => {
          if (this.stopping || details.reason === 'user') return;
          this.fail(details.reason === 'error' ? details.message : 'ElevenLabs 通话已断开');
        },
      });
      if (conversation.type !== 'voice') {
        await conversation.endSession();
        throw new Error('ElevenLabs 未建立语音会话');
      }
      this.conversation = conversation;
      this.update({ status: 'listening' });
    } catch (error: any) {
      this.fail(error?.message || 'ElevenLabs Speech Engine 连接失败');
      throw error;
    }
  }

  async startAssistantInitiatedTurn(instruction: string): Promise<void> {
    if (!this.conversation || !instruction.trim()) return;
    this.conversation.sendContextualUpdate(instruction.trim());
    this.conversation.sendUserActivity();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.conversation?.setMicMuted(!enabled);
    this.update({ micEnabled: enabled });
  }

  async setSpeakerphoneOn(enabled: boolean): Promise<void> {
    // ElevenLabs React Native uses LiveKit's communication audio session. This
    // flag controls output volume while preserving the existing call UI API.
    this.conversation?.setVolume({ volume: enabled ? 1 : 0.85 });
    this.update({ speakerphoneOn: enabled });
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    this.update({ status: 'stopping' });
    const conversation = this.conversation;
    this.conversation = null;
    try {
      await conversation?.endSession();
    } finally {
      this.stopping = false;
      this.update({
        active: false,
        status: 'idle',
        startedAt: null,
        partialTranscript: '',
        speakingText: '',
        error: null,
      });
    }
  }

  private handleMessage(message: string, role: 'user' | 'agent'): void {
    const text = message.trim();
    if (!text) return;
    const speaker = role === 'agent' ? 'assistant' : 'user';
    this.update({
      transcriptItems: [
        ...this.snapshot.transcriptItems,
        { id: `elevenlabs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, speaker, text },
      ],
      ...(speaker === 'user'
        ? { lastUserText: text, partialTranscript: '', status: 'thinking' as const }
        : { speakingText: text, status: 'speaking' as const }),
    });
  }

  private fail(message: string): void {
    this.update({ active: false, status: 'error', error: message });
  }

  private update(patch: Partial<VoiceCallSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}

async function fetchConversationToken(endpoint: string): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`ElevenLabs Token Endpoint 请求失败 (${response.status}): ${body.slice(0, 180)}`);
  }
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    parsed = { token: body.trim() };
  }
  const token = String(parsed?.token || parsed?.conversationToken || parsed?.conversation_token || '').trim();
  if (!token) throw new Error('Token Endpoint 未返回 token 或 conversationToken');
  return token;
}

function normalizeElevenLabsLanguage(value: string): any {
  return (value.trim() || 'zh').replace('_', '-');
}
