import { create } from 'zustand';
import {
  generateContinuationRadioProgram,
  generateOpeningRadioProgram,
  getOrCreateLatestRadioConversation,
  insertRadioChatMessage,
  summarizeRadioSession,
  type RadioProgram,
  type RadioScriptSegment,
} from '../services/aiRadio';
import { isTTSConfigReady, playTTSAndWait, stopTTS } from '../services/tts';
import {
  RADIO_CALL_IN_MARKER,
  RADIO_CONTINUE_MARKER,
  RADIO_END_MARKER,
  RADIO_START_MARKER,
} from '../utils/radioMarkers';
import type { Message } from '../types';
import { useMusicStore } from './music';
import { useNeteaseStore } from './netease';
import { useSettingsStore } from './settings';

type RadioPhase =
  | 'idle'
  | 'generating_opening'
  | 'playing_opening'
  | 'call_in_waiting'
  | 'generating_continuation'
  | 'playing_continuation'
  | 'finished'
  | 'ending';

interface RadioState {
  phase: RadioPhase;
  loading: boolean;
  active: boolean;
  ending: boolean;
  title: string;
  status: string;
  currentScript: string;
  currentTrackLabel: string;
  programs: RadioProgram[];
  conversationId: string | null;
  startMessage: Message | null;
  callInMessage: Message | null;
  runId: number;

  start: () => Promise<void>;
  continueProgram: () => Promise<void>;
  end: () => Promise<void>;
}

function combineSegmentText(segments: RadioScriptSegment[]): string {
  return segments
    .map((segment) => segment.text.trim())
    .filter(Boolean)
    .join('\n');
}

function getNonRadioTracksForPlanning() {
  return useMusicStore.getState().tracks.filter((track) => track.source !== 'radio');
}

function waitForTrackFinish(trackId: string, runId: number): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      const radio = useRadioStore.getState();
      const music = useMusicStore.getState();
      return radio.runId !== runId || music.lastFinishedTrackId === trackId;
    };

    if (check()) {
      resolve();
      return;
    }

    const unsubscribe = useMusicStore.subscribe(() => {
      if (check()) {
        unsubscribe();
        resolve();
      }
    });
  });
}

async function playProgramSegment(
  program: RadioProgram,
  runId: number,
  kind: 'opening' | 'continuation'
): Promise<void> {
  const music = useMusicStore.getState();
  music.setAutoAdvanceEnabled(false);

  try {
    for (let index = 0; index < program.tracks.length; index++) {
      if (useRadioStore.getState().runId !== runId) return;

      const beforeText =
        index === 0
          ? combineSegmentText(program.segments.filter(
              (segment) => segment.position === 'before_track' && (segment.trackIndex ?? 0) === 0
            ))
          : combineSegmentText(program.segments.filter(
              (segment) =>
                segment.position === 'between_tracks' &&
                segment.afterTrackIndex === index - 1 &&
                segment.beforeTrackIndex === index
            ));

      if (beforeText) {
        useRadioStore.setState({
          status: index === 0 ? 'AI 电台开场中...' : 'AI 电台串场中...',
          currentScript: beforeText,
          currentTrackLabel: `${program.tracks[index]?.title ?? ''} - ${program.tracks[index]?.artist ?? ''}`.trim(),
        });
        await playTTSAndWait(beforeText, useSettingsStore.getState().ttsConfig);
      }
      if (useRadioStore.getState().runId !== runId) return;

      const track = program.tracks[index];
      useRadioStore.setState({
        status: `正在播放 ${index + 1}/${program.tracks.length}`,
        currentTrackLabel: `${track.title} - ${track.artist}`,
      });
      await useMusicStore.getState().playTrackAt(index);
      await waitForTrackFinish(program.tracks[index].id, runId);
    }

    if (useRadioStore.getState().runId !== runId) return;
    const afterText = combineSegmentText(program.segments.filter(
      (segment) => segment.position === 'after_track'
    ));
    if (afterText) {
      useRadioStore.setState({
        status: kind === 'opening' ? '正在进入来电环节...' : 'AI 电台收尾中...',
        currentScript: afterText,
        currentTrackLabel: '',
      });
      await playTTSAndWait(afterText, useSettingsStore.getState().ttsConfig);
    }

    if (useRadioStore.getState().runId !== runId) return;
    if (kind === 'opening') {
      const radio = useRadioStore.getState();
      if (radio.conversationId) {
        const callInMessage = await insertRadioChatMessage(
          radio.conversationId,
          'system',
          `${RADIO_CALL_IN_MARKER} 来电环节已开启。你可以在主聊天窗口继续聊天；聊差不多后点击“继续”生成后半段节目。`
        );
        useRadioStore.setState({ callInMessage });
      }
      useRadioStore.setState({
        phase: 'call_in_waiting',
        status: '来电环节已开启。请在主聊天窗口聊天，之后点击“继续”。',
        currentTrackLabel: '',
      });
      return;
    }

    useRadioStore.setState({
      phase: 'finished',
      status: '本期已播放完，请手动结束电台以生成总结。',
      currentTrackLabel: '',
    });
  } catch (error) {
    if (useRadioStore.getState().runId !== runId) return;
    useRadioStore.setState({
      status: error instanceof Error ? error.message : 'AI 电台播放中断',
    });
  }
}

export const useRadioStore = create<RadioState>((set, get) => ({
  phase: 'idle',
  loading: false,
  active: false,
  ending: false,
  title: 'AI 电台',
  status: '用当前播放器接入一档主题节目',
  currentScript: '',
  currentTrackLabel: '',
  programs: [],
  conversationId: null,
  startMessage: null,
  callInMessage: null,
  runId: 0,

  start: async () => {
    const state = get();
    if (state.loading || state.active) return;

    const settings = useSettingsStore.getState();
    const apiConfig = settings.apiConfigs[settings.activeConfigIndex];
    if (!apiConfig?.baseUrl || !apiConfig.apiKey || !apiConfig.model) {
      set({ status: '请先在设置中配置聊天 API' });
      return;
    }

    const netease = useNeteaseStore.getState();
    if (!netease.baseUrl.trim()) {
      set({ status: '请先在歌单管理里填写网易云 API 地址' });
      return;
    }

    if (!isTTSConfigReady(settings.ttsConfig)) {
      set({ status: '请先在设置中配置 TTS，电台主持需要语音。' });
      return;
    }

    set({
      loading: true,
      active: true,
      phase: 'generating_opening',
      status: '正在选择今天的节目主题...',
      currentScript: '',
      currentTrackLabel: '',
    });

    try {
      const music = useMusicStore.getState();
      const planningTracks = getNonRadioTracksForPlanning();
      const conversation = await getOrCreateLatestRadioConversation(apiConfig);
      const program = await generateOpeningRadioProgram({
        apiConfig,
        neteaseBaseUrl: netease.baseUrl,
        neteaseCookie: netease.cookie,
        currentTracks: planningTracks,
        conversationId: conversation.id,
        systemPrompt: settings.systemPrompt,
        count: 4,
      });

      const startMessage = await insertRadioChatMessage(
        conversation.id,
        'system',
        `${RADIO_START_MARKER} AI 电台已开启：${program.summary}\n第 4 首结束后会进入来电环节。`
      );

      const runId = get().runId + 1;
      music.replaceTracks(program.tracks);
      music.openPlayer();
      set({
        runId,
        loading: false,
        phase: 'playing_opening',
        title: program.title,
        programs: [program],
        conversationId: conversation.id,
        startMessage,
        callInMessage: null,
        currentScript: '',
        currentTrackLabel: '',
        status:
          program.skipped.length > 0
            ? `已生成前半段 ${program.tracks.length} 首，跳过 ${program.skipped.length} 首，准备开场。`
            : `已生成前半段 ${program.tracks.length} 首，准备开场。`,
      });

      playProgramSegment(program, runId, 'opening').catch(() => undefined);
    } catch (error) {
      set({
        loading: false,
        active: false,
        phase: 'idle',
        currentScript: '',
        currentTrackLabel: '',
        status: error instanceof Error ? error.message : 'AI 电台开台失败',
      });
    }
  },

  continueProgram: async () => {
    const state = get();
    if (state.loading || state.phase !== 'call_in_waiting') return;

    const settings = useSettingsStore.getState();
    const apiConfig = settings.apiConfigs[settings.activeConfigIndex];
    const previousProgram = state.programs[0];
    if (!apiConfig || !state.conversationId || !state.callInMessage || !previousProgram) {
      set({ status: '没有可继续的来电环节。' });
      return;
    }

    const netease = useNeteaseStore.getState();
    set({
      loading: true,
      phase: 'generating_continuation',
      status: '正在根据来电内容生成后半段节目...',
      currentTrackLabel: '',
    });

    try {
      await insertRadioChatMessage(
        state.conversationId,
        'system',
        `${RADIO_CONTINUE_MARKER} 用户已手动继续 AI 电台。开始根据来电期间聊天生成后半段节目和最终结尾。`
      );

      const music = useMusicStore.getState();
      const planningTracks = getNonRadioTracksForPlanning();
      const program = await generateContinuationRadioProgram({
        apiConfig,
        neteaseBaseUrl: netease.baseUrl,
        neteaseCookie: netease.cookie,
        currentTracks: planningTracks,
        conversationId: state.conversationId,
        systemPrompt: settings.systemPrompt,
        previousProgram,
        callInStartedAt: state.callInMessage.createdAt,
        count: 4,
      });

      const runId = get().runId + 1;
      music.replaceTracks(program.tracks);
      music.openPlayer();
      set((current) => ({
        runId,
        loading: false,
        phase: 'playing_continuation',
        title: program.title || current.title,
        programs: [...current.programs, program],
        currentScript: '',
        currentTrackLabel: '',
        status:
          program.skipped.length > 0
            ? `已生成后半段 ${program.tracks.length} 首，跳过 ${program.skipped.length} 首，准备继续。`
            : `已生成后半段 ${program.tracks.length} 首，准备继续。`,
      }));

      playProgramSegment(program, runId, 'continuation').catch(() => undefined);
    } catch (error) {
      set({
        loading: false,
        phase: 'call_in_waiting',
        currentTrackLabel: '',
        status: error instanceof Error ? error.message : 'AI 电台继续失败',
      });
    }
  },

  end: async () => {
    const state = get();
    if (state.ending || !state.active) return;

    const settings = useSettingsStore.getState();
    const apiConfig = settings.apiConfigs[settings.activeConfigIndex];
    if (!apiConfig || !state.startMessage || !state.conversationId || state.programs.length === 0) {
      set({ status: '没有可结束的电台会话。' });
      return;
    }

    const nextRunId = state.runId + 1;
    set({
      ending: true,
      phase: 'ending',
      runId: nextRunId,
      status: '正在结束电台并生成总结...',
      currentTrackLabel: '',
    });
    await stopTTS();
    await useMusicStore.getState().pause();
    useMusicStore.getState().setAutoAdvanceEnabled(true);

    try {
      const endMessage = await insertRadioChatMessage(
        state.conversationId,
        'system',
        `${RADIO_END_MARKER} AI 电台已结束。正在整理本期节目总结。`
      );
      const summary = await summarizeRadioSession({
        apiConfig,
        conversationId: state.conversationId,
        startMessage: state.startMessage,
        endMessage,
        programs: state.programs,
      });
      await insertRadioChatMessage(state.conversationId, 'assistant', summary);

      set({
        active: false,
        loading: false,
        ending: false,
        phase: 'idle',
        programs: [],
        conversationId: null,
        startMessage: null,
        callInMessage: null,
        currentScript: '',
        currentTrackLabel: '',
        status: '本期总结已插入聊天。',
      });
    } catch (error) {
      set({
        ending: false,
        phase: 'finished',
        status: error instanceof Error ? error.message : 'AI 电台结束失败',
      });
    }
  },
}));
