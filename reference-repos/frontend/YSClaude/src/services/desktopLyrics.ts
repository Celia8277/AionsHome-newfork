import { AppState, Platform } from 'react-native';
import {
  addDesktopLyricActionListener,
  hideDesktopLyric,
  showDesktopLyric,
  type DesktopLyricAction,
  type DesktopLyricTimelineLine,
} from './floatingBall';
import { useMusicStore } from '../stores/music';
import { useRadioStore } from '../stores/radio';

let storeUnsubscribe: (() => void) | null = null;
let radioUnsubscribe: (() => void) | null = null;
let actionSubscription: { remove: () => void } | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let lastSignature = '';
let inFlightSignature = '';
let queuedSignature = '';
let queuedState: DesktopLyricNativeState | null = null;
let queuedTimer: ReturnType<typeof setTimeout> | null = null;
let lastDispatchAt = 0;
let panelMode: 'lyrics' | 'radio' = 'lyrics';
let lastPlaybackAnchor: PlaybackAnchor | null = null;

const DESKTOP_LYRIC_MIN_UPDATE_INTERVAL_MS = 320;
const DESKTOP_LYRIC_SEEK_DRIFT_MS = 1500;

type PlaybackAnchor = {
  trackId: string;
  currentTimeMs: number;
  sentAtMs: number;
  isPlaying: boolean;
};

type DesktopLyricNativeState = {
  trackId: string;
  text: string;
  lyricProgress: number;
  title: string;
  artist: string;
  artworkUrl: string;
  backgroundUri: string;
  songProgress: number;
  isPlaying: boolean;
  panelMode: 'lyrics' | 'radio';
  radioStatus: string;
  radioScript: string;
  radioTrack: string;
  radioActionLabel: string;
  radioActionEnabled: boolean;
  lyrics: DesktopLyricTimelineLine[];
  currentTimeMs: number;
  durationMs: number;
};

export function startDesktopLyricSync(): () => void {
  if (storeUnsubscribe) return stopDesktopLyricSync;

  actionSubscription = addDesktopLyricActionListener(handleDesktopLyricAction);
  appStateSubscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      refreshDesktopLyric();
    }
  });
  storeUnsubscribe = useMusicStore.subscribe(syncDesktopLyric);
  radioUnsubscribe = useRadioStore.subscribe(syncDesktopLyric);
  syncDesktopLyric();

  return stopDesktopLyricSync;
}

export function stopDesktopLyricSync(): void {
  storeUnsubscribe?.();
  radioUnsubscribe?.();
  actionSubscription?.remove();
  appStateSubscription?.remove();
  storeUnsubscribe = null;
  radioUnsubscribe = null;
  actionSubscription = null;
  appStateSubscription = null;
  lastSignature = '';
  inFlightSignature = '';
  lastPlaybackAnchor = null;
  clearQueuedDesktopLyricUpdate();
  hideDesktopLyric().catch(() => undefined);
}

export function refreshDesktopLyric(): void {
  lastSignature = '';
  inFlightSignature = '';
  lastPlaybackAnchor = null;
  lastDispatchAt = 0;
  clearQueuedDesktopLyricUpdate();
  syncDesktopLyric();
}

function syncDesktopLyric(): void {
  if (Platform.OS !== 'android') return;
  const state = useMusicStore.getState();
  const radio = useRadioStore.getState();
  if (!state.desktopLyricsEnabled || (!state.isOpen && !radio.active)) {
    if (lastSignature || inFlightSignature || queuedSignature) {
      lastSignature = '';
      inFlightSignature = '';
      clearQueuedDesktopLyricUpdate();
      hideDesktopLyric().catch(() => undefined);
    }
    return;
  }

  const nextState = getDesktopLyricState();
  const signature = getDesktopLyricSignature(nextState);
  if (!shouldDispatchDesktopLyricUpdate(nextState, signature)) {
    return;
  }
  queueDesktopLyricUpdate(nextState, signature);
}

function queueDesktopLyricUpdate(nextState: DesktopLyricNativeState, signature: string): void {
  queuedState = nextState;
  queuedSignature = signature;

  const elapsedMs = Date.now() - lastDispatchAt;
  const delayMs = Math.max(0, DESKTOP_LYRIC_MIN_UPDATE_INTERVAL_MS - elapsedMs);
  if (delayMs <= 0 && !queuedTimer) {
    dispatchQueuedDesktopLyricUpdate();
    return;
  }

  if (!queuedTimer) {
    queuedTimer = setTimeout(dispatchQueuedDesktopLyricUpdate, delayMs);
  }
}

function dispatchQueuedDesktopLyricUpdate(): void {
  if (queuedTimer) {
    clearTimeout(queuedTimer);
    queuedTimer = null;
  }

  const nextState = queuedState;
  const signature = queuedSignature;
  if (!nextState || !signature) return;

  queuedState = null;
  queuedSignature = '';
  inFlightSignature = signature;
  lastDispatchAt = Date.now();

  showDesktopLyric(
    nextState.text,
    nextState.lyricProgress,
    nextState.title,
    nextState.artist,
    nextState.artworkUrl,
    nextState.songProgress,
    nextState.isPlaying,
    nextState.backgroundUri,
    nextState.panelMode,
    nextState.radioStatus,
    nextState.radioScript,
    nextState.radioTrack,
    nextState.radioActionLabel,
    nextState.radioActionEnabled,
    nextState.lyrics,
    nextState.currentTimeMs,
    nextState.durationMs
  ).then(() => {
    if (inFlightSignature === signature) {
      lastSignature = signature;
      inFlightSignature = '';
      lastPlaybackAnchor = {
        trackId: nextState.trackId,
        currentTimeMs: nextState.currentTimeMs,
        sentAtMs: Date.now(),
        isPlaying: nextState.isPlaying,
      };
    }
  }).catch((error) => {
    if (inFlightSignature === signature) {
      inFlightSignature = '';
    }
    console.warn('[DesktopLyric] showDesktopLyric failed', error);
  });
}

function clearQueuedDesktopLyricUpdate(): void {
  if (queuedTimer) {
    clearTimeout(queuedTimer);
    queuedTimer = null;
  }
  queuedState = null;
  queuedSignature = '';
}

function getDesktopLyricSignature(nextState: DesktopLyricNativeState): string {
  return [
    nextState.trackId,
    nextState.text,
    nextState.title,
    nextState.artist,
    nextState.artworkUrl,
    nextState.backgroundUri,
    nextState.isPlaying ? '1' : '0',
    nextState.durationMs,
    getLyricsSignature(nextState.lyrics),
    nextState.panelMode,
    nextState.radioStatus,
    nextState.radioScript,
    nextState.radioTrack,
    nextState.radioActionLabel,
    nextState.radioActionEnabled ? '1' : '0',
  ].join('|');
}

function shouldDispatchDesktopLyricUpdate(
  nextState: DesktopLyricNativeState,
  signature: string
): boolean {
  if (signature === queuedSignature || signature === inFlightSignature) {
    return false;
  }

  if (signature !== lastSignature) {
    return true;
  }

  const anchor = lastPlaybackAnchor;
  if (!anchor || anchor.trackId !== nextState.trackId) return true;

  const elapsedMs = anchor.isPlaying ? Date.now() - anchor.sentAtMs : 0;
  const predictedTimeMs = anchor.currentTimeMs + elapsedMs;
  const driftMs = Math.abs(nextState.currentTimeMs - predictedTimeMs);

  if (nextState.isPlaying) {
    return driftMs >= DESKTOP_LYRIC_SEEK_DRIFT_MS;
  }

  return Math.abs(nextState.currentTimeMs - anchor.currentTimeMs) >= 250;
}

function getLyricsSignature(lyrics: DesktopLyricTimelineLine[]): string {
  if (lyrics.length === 0) return '';
  return `${lyrics.length}:${lyrics[0]?.timeMs ?? 0}:${lyrics[lyrics.length - 1]?.timeMs ?? 0}:${lyrics[lyrics.length - 1]?.text ?? ''}`;
}

function handleDesktopLyricAction(action: DesktopLyricAction): void {
  const music = useMusicStore.getState();
  if (action === 'previous') {
    music.previous().catch(() => undefined);
    return;
  }
  if (action === 'toggle_play') {
    music.togglePlayPause().catch(() => undefined);
    return;
  }
  if (action === 'next') {
    music.next().catch(() => undefined);
    return;
  }
  if (action === 'toggle_view') {
    panelMode = panelMode === 'lyrics' ? 'radio' : 'lyrics';
    lastSignature = '';
    syncDesktopLyric();
    return;
  }
  if (action === 'radio_action') {
    handleRadioAction();
    return;
  }
  if (action === 'close') {
    music.setDesktopLyricsEnabled(false);
    hideDesktopLyric().catch(() => undefined);
  }
}

function getDesktopLyricState(): DesktopLyricNativeState {
  const state = useMusicStore.getState();
  const radio = useRadioStore.getState();
  const track = state.tracks[state.currentIndex];
  const radioState = getRadioPanelState();
  const radioAction = getRadioActionState();
  if (!track) {
    return {
      trackId: panelMode === 'radio' ? 'radio' : 'empty',
      text: panelMode === 'radio' ? radioState.text : '暂无播放歌曲',
      lyricProgress: 0,
      title: panelMode === 'radio' ? radio.title : '暂无播放歌曲',
      artist: panelMode === 'radio' ? radio.status : '',
      artworkUrl: '',
      backgroundUri: state.desktopLyricBackgroundUri,
      songProgress: 0,
      isPlaying: false,
      panelMode,
      radioStatus: radio.status,
      radioScript: radioState.script,
      radioTrack: radio.currentTrackLabel,
      radioActionLabel: radioAction.label,
      radioActionEnabled: radioAction.enabled,
      lyrics: [],
      currentTimeMs: 0,
      durationMs: 0,
    };
  }

  const lyric =
    state.currentLyricIndex >= 0
      ? track.lyrics[state.currentLyricIndex]?.text
      : '';
  const lyricProgress = lyric
    ? getCurrentLyricProgress(state, track.lyrics[state.currentLyricIndex], track.lyrics[state.currentLyricIndex + 1])
    : getBoundedProgress(state.currentTimeMs, 0, state.durationMs);

  return {
    trackId: track.id,
    text: panelMode === 'radio' ? radioState.text : lyric || `${track.title} - ${track.artist}`,
    lyricProgress,
    title: panelMode === 'radio' ? radio.title : track.title,
    artist: panelMode === 'radio' ? radio.status : track.artist,
    artworkUrl: track.artworkUrl ?? '',
    backgroundUri: state.desktopLyricBackgroundUri,
    songProgress: getBoundedProgress(state.currentTimeMs, 0, state.durationMs),
    isPlaying: state.isPlaying,
    panelMode,
    radioStatus: radio.status,
    radioScript: radioState.script,
    radioTrack: radio.currentTrackLabel || `${track.title} - ${track.artist}`,
    radioActionLabel: radioAction.label,
    radioActionEnabled: radioAction.enabled,
    lyrics: panelMode === 'radio' ? [] : track.lyrics,
    currentTimeMs: state.currentTimeMs,
    durationMs: state.durationMs,
  };
}

function handleRadioAction(): void {
  const radio = useRadioStore.getState();
  if (radio.loading || radio.ending) return;

  if (radio.phase === 'call_in_waiting') {
    radio.continueProgram().catch(() => undefined);
    return;
  }

  if (radio.active) {
    radio.end().catch(() => undefined);
    return;
  }

  radio.start().catch(() => undefined);
}

function getRadioActionState(): { label: string; enabled: boolean } {
  const radio = useRadioStore.getState();
  if (radio.loading || radio.ending) {
    return { label: '处理中', enabled: false };
  }
  if (radio.phase === 'call_in_waiting') {
    return { label: '继续', enabled: true };
  }
  if (radio.active) {
    return { label: '总结', enabled: true };
  }
  return { label: '开台', enabled: true };
}

function getRadioPanelState(): { text: string; script: string } {
  const radio = useRadioStore.getState();
  if (!radio.active) {
    return {
      text: 'AI 电台未开台',
      script: '开启电台后，这里会显示当前节目脚本、来电环节和节目状态。',
    };
  }

  const script = radio.currentScript.trim();
  if (script) {
    return {
      text: script,
      script,
    };
  }

  const latestProgram = radio.programs[radio.programs.length - 1];
  const fallbackScript = latestProgram?.summary || radio.status;
  return {
    text: fallbackScript,
    script: fallbackScript,
  };
}

function getCurrentLyricProgress(
  state: ReturnType<typeof useMusicStore.getState>,
  currentLine: { timeMs: number; durationMs?: number },
  nextLine?: { timeMs: number }
): number {
  const endTimeMs = currentLine.durationMs
    ? currentLine.timeMs + currentLine.durationMs
    : nextLine?.timeMs ?? state.durationMs;
  return getBoundedProgress(state.currentTimeMs, currentLine.timeMs, endTimeMs);
}

function getBoundedProgress(currentTimeMs: number, startTimeMs: number, endTimeMs: number): number {
  const durationMs = Math.max(1, endTimeMs - startTimeMs);
  return Math.min(1, Math.max(0, (currentTimeMs - startTimeMs) / durationMs));
}
