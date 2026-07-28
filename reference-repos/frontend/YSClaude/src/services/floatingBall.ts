import { AppState, DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { useSettingsStore } from '../stores/settings';
import { playTTS, stopTTS } from './tts';

interface FloatingBallModule {
  canDrawOverlays: () => Promise<boolean>;
  openOverlaySettings: () => Promise<boolean>;
  configureAssets?: (
    normalUris: string[],
    edgeUris: string[],
    autoSwitchEnabled: boolean,
    autoSwitchIntervalSeconds: number,
    normalSizeDp: number,
    edgeSizeDp: number
  ) => Promise<boolean>;
  show: () => Promise<boolean>;
  hide: () => Promise<boolean>;
  isShowing: () => Promise<boolean>;
  showMessage: (text: string) => Promise<boolean>;
  enqueueMessageSequence?: (messages: string[], intervalMs: number, reset: boolean) => Promise<boolean>;
  hideMessage: () => Promise<boolean>;
  showDesktopLyric: (
    text: string,
    lyricProgress: number,
    title: string,
    artist: string,
    artworkUrl: string,
    songProgress: number,
    isPlaying: boolean,
    backgroundUri: string
  ) => Promise<boolean>;
  showDesktopLyricTimeline?: (
    text: string,
    lyricProgress: number,
    title: string,
    artist: string,
    artworkUrl: string,
    songProgress: number,
    isPlaying: boolean,
    backgroundUri: string,
    panelMode: string,
    radioStatus: string,
    radioScript: string,
    radioTrack: string,
    radioActionLabel: string,
    radioActionEnabled: boolean,
    lyrics: Array<{ timeMs: number; durationMs?: number; text: string }>,
    currentTimeMs: number,
    durationMs: number
  ) => Promise<boolean>;
  showDesktopLyricPanel?: (
    text: string,
    lyricProgress: number,
    title: string,
    artist: string,
    artworkUrl: string,
    songProgress: number,
    isPlaying: boolean,
    backgroundUri: string,
    panelMode: string,
    radioStatus: string,
    radioScript: string,
    radioTrack: string,
    radioActionLabel: string,
    radioActionEnabled: boolean
  ) => Promise<boolean>;
  hideDesktopLyric: () => Promise<boolean>;
  showVoiceCall?: (durationText: string) => Promise<boolean>;
  showScreenCall?: (durationText: string) => Promise<boolean>;
  showVideoCall?: (durationText: string, previewUri: string) => Promise<boolean>;
  hideVoiceCall?: () => Promise<boolean>;
  openApp: () => Promise<boolean>;
}

interface FloatingBallMessageOptions {
  speak?: boolean;
  showWhileAppActive?: boolean;
}

export type DesktopLyricTimelineLine = {
  timeMs: number;
  durationMs?: number;
  text: string;
};

export type FloatingBallToolAction =
  | 'screen_share'
  | 'screen_control'
  | 'get_reply'
  | 'toggle_music'
  | 'open_app'
  | { action: 'text_input'; text?: string };

export type DesktopLyricAction =
  | 'previous'
  | 'toggle_play'
  | 'next'
  | 'toggle_view'
  | 'radio_action'
  | 'close';

export type VoiceCallFloatingAction = 'open';

const nativeModule = NativeModules.FloatingBall as FloatingBallModule | undefined;

function ensureFloatingBall(): FloatingBallModule {
  if (Platform.OS !== 'android') {
    throw new Error('悬浮球仅支持 Android');
  }
  if (!nativeModule) {
    throw new Error('悬浮球原生模块未加载，请重新运行 npx expo run:android 安装新包');
  }
  return nativeModule;
}

export async function canDrawFloatingBall(): Promise<boolean> {
  return ensureFloatingBall().canDrawOverlays();
}

export async function openFloatingBallPermissionSettings(): Promise<void> {
  await ensureFloatingBall().openOverlaySettings();
}

export async function showFloatingBall(): Promise<void> {
  const floatingBall = ensureFloatingBall();
  await configureFloatingBallAssets(floatingBall);
  await floatingBall.show();
}

export async function hideFloatingBall(): Promise<void> {
  await ensureFloatingBall().hide();
  stopTTS().catch(() => {});
}

export async function isFloatingBallShowing(): Promise<boolean> {
  return ensureFloatingBall().isShowing();
}

export async function showFloatingBallMessage(
  text: string,
  options: FloatingBallMessageOptions = {}
): Promise<void> {
  if (shouldShowFloatingBallMessage(options)) {
    await ensureFloatingBall().showMessage(text);
  }
  if (options.speak !== false) {
    playFloatingBallTTS(text);
  }
}

export async function enqueueFloatingBallMessageSequence(
  messages: string[],
  intervalMs: number,
  reset = false
): Promise<void> {
  if (!shouldShowFloatingBallMessage()) {
    if (reset && messages.length === 0) {
      const floatingBall = ensureFloatingBall();
      if (floatingBall.enqueueMessageSequence) {
        await floatingBall.enqueueMessageSequence([], intervalMs, true);
      }
    }
    return;
  }
  const floatingBall = ensureFloatingBall();
  if (!floatingBall.enqueueMessageSequence) {
    for (const message of messages) {
      await floatingBall.showMessage(message);
    }
    return;
  }
  await floatingBall.enqueueMessageSequence(messages, intervalMs, reset);
}

export async function hideFloatingBallMessage(): Promise<void> {
  await ensureFloatingBall().hideMessage();
  stopTTS().catch(() => {});
}

export async function showDesktopLyric(
  text: string,
  lyricProgress = 0,
  title = '',
  artist = '',
  artworkUrl = '',
  songProgress = 0,
  isPlaying = false,
  backgroundUri = '',
  panelMode = 'lyrics',
  radioStatus = '',
  radioScript = '',
  radioTrack = '',
  radioActionLabel = '',
  radioActionEnabled = false,
  lyrics: DesktopLyricTimelineLine[] = [],
  currentTimeMs = 0,
  durationMs = 0
): Promise<void> {
  const floatingBall = ensureFloatingBall();
  const showTimeline = floatingBall.showDesktopLyricTimeline;
  if (showTimeline) {
    await showTimeline(
      text,
      lyricProgress,
      title,
      artist,
      artworkUrl,
      songProgress,
      isPlaying,
      backgroundUri,
      panelMode,
      radioStatus,
      radioScript,
      radioTrack,
      radioActionLabel,
      radioActionEnabled,
      lyrics,
      currentTimeMs,
      durationMs
    );
    return;
  }
  const showEnhanced = floatingBall.showDesktopLyricPanel;
  if (showEnhanced) {
    await showEnhanced(
      text,
      lyricProgress,
      title,
      artist,
      artworkUrl,
      songProgress,
      isPlaying,
      backgroundUri,
      panelMode,
      radioStatus,
      radioScript,
      radioTrack,
      radioActionLabel,
      radioActionEnabled
    );
    return;
  }

  await floatingBall.showDesktopLyric(
    text,
    lyricProgress,
    title,
    artist,
    artworkUrl,
    songProgress,
    isPlaying,
    backgroundUri
  );
}

export async function hideDesktopLyric(): Promise<void> {
  await ensureFloatingBall().hideDesktopLyric();
}

export async function showVoiceCallFloatingBall(durationText = ''): Promise<void> {
  const floatingBall = ensureFloatingBall();
  if (!floatingBall.showVoiceCall) {
    await floatingBall.show();
    return;
  }
  await floatingBall.showVoiceCall(durationText);
}

export async function showScreenCallFloatingBall(durationText = ''): Promise<void> {
  const floatingBall = ensureFloatingBall();
  if (!floatingBall.showScreenCall) {
    await showVoiceCallFloatingBall(durationText);
    return;
  }
  await floatingBall.showScreenCall(durationText);
}

export async function showVideoCallFloatingWindow(durationText: string, previewUri: string): Promise<void> {
  const floatingBall = ensureFloatingBall();
  if (floatingBall.showVideoCall && previewUri) {
    await floatingBall.showVideoCall(durationText, previewUri);
    return;
  }
  await showVoiceCallFloatingBall(durationText);
}

export async function hideVoiceCallFloatingBall(): Promise<void> {
  const floatingBall = ensureFloatingBall();
  if (floatingBall.hideVoiceCall) {
    await floatingBall.hideVoiceCall();
  }
}

export async function openYSClaudeFromFloatingBall(): Promise<void> {
  await ensureFloatingBall().openApp();
}

export async function syncFloatingBallAssets(): Promise<void> {
  await configureFloatingBallAssets(ensureFloatingBall());
}

export function addFloatingBallToolActionListener(
  listener: (action: FloatingBallToolAction) => void
): { remove: () => void } {
  return DeviceEventEmitter.addListener('FloatingBallToolAction', listener);
}

export function addDesktopLyricActionListener(
  listener: (action: DesktopLyricAction) => void
): { remove: () => void } {
  return DeviceEventEmitter.addListener('DesktopLyricAction', listener);
}

export function addVoiceCallFloatingActionListener(
  listener: (action: VoiceCallFloatingAction) => void
): { remove: () => void } {
  return DeviceEventEmitter.addListener('VoiceCallFloatingAction', listener);
}

function playFloatingBallTTS(text: string): void {
  const speakableText = sanitizeFloatingBallTTS(text);
  if (!speakableText) return;

  const { floatingBallConfig, ttsConfig } = useSettingsStore.getState();
  if (!floatingBallConfig.ttsEnabled) return;

  playTTS(speakableText, ttsConfig).catch(() => {});
}

function shouldShowFloatingBallMessage(options: FloatingBallMessageOptions = {}): boolean {
  return options.showWhileAppActive === true || AppState.currentState !== 'active';
}

async function configureFloatingBallAssets(floatingBall: FloatingBallModule): Promise<void> {
  if (!floatingBall.configureAssets) return;
  const { floatingBallConfig } = useSettingsStore.getState();
  await floatingBall.configureAssets(
    normalizeBallAssetUris(floatingBallConfig.normalImageUris, floatingBallConfig.normalImageUri),
    normalizeBallAssetUris(floatingBallConfig.edgeImageUris, floatingBallConfig.edgeImageUri),
    !!floatingBallConfig.assetAutoSwitchEnabled,
    floatingBallConfig.assetAutoSwitchIntervalSeconds || 8,
    floatingBallConfig.normalSizeDp || 64,
    floatingBallConfig.edgeSizeDp || 64
  );
}

function normalizeBallAssetUris(uris?: string[], legacyUri?: string): string[] {
  const merged = [...(uris || []), ...(legacyUri ? [legacyUri] : [])]
    .map((uri) => uri.trim())
    .filter(Boolean);
  return Array.from(new Set(merged));
}

function sanitizeFloatingBallTTS(text: string): string {
  let next = text;
  const bracketedContentPattern =
    /\[[^\[\]]*\]|\([^()]*\)|\{[^{}]*\}|\u3010[^\u3010\u3011]*\u3011|\uFF08[^\uFF08\uFF09]*\uFF09|\uFF5B[^\uFF5B\uFF5D]*\uFF5D/g;

  while (bracketedContentPattern.test(next)) {
    next = next.replace(bracketedContentPattern, ' ');
    bracketedContentPattern.lastIndex = 0;
  }

  return next.replace(/\s+/g, ' ').trim();
}
