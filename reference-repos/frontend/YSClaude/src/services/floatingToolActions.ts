import { router } from 'expo-router';
import { randomUUID } from 'expo-crypto';
import { useChatStore } from '../stores/chat';
import { useMusicStore } from '../stores/music';
import { useSettingsStore } from '../stores/settings';
import { Conversation, Message } from '../types';
import { createConversation, getAllConversations } from '../db/operations';
import {
  FloatingBallToolAction,
  hideDesktopLyric,
  openYSClaudeFromFloatingBall,
  showFloatingBallMessage,
} from './floatingBall';
import {
  capturePendingAndroidAccessibilityContext,
  capturePendingAndroidScreenshotContext,
} from './androidAccessibilitySession';
import {
  buildAndroidAccessibilityCaptureNotice,
  buildAndroidScreenshotCaptureNotice,
} from '../utils/androidAccessibilityControl';

let actionBusy = false;

async function getLatestCreatedConversation(): Promise<Conversation | null> {
  const conversations = await getAllConversations();
  return conversations[0] ?? null;
}

async function ensureLatestCreatedConversationLoaded(): Promise<void> {
  const latest = await getLatestCreatedConversation();
  if (latest) {
    const state = useChatStore.getState();
    if (state.conversationId !== latest.id) {
      await state.loadConversation(latest.id);
    }
    return;
  }

  const settings = useSettingsStore.getState();
  const config = settings.apiConfigs[settings.activeConfigIndex];
  const now = Date.now();
  const conversation: Conversation = {
    id: randomUUID(),
    title: 'New conversation',
    systemPrompt: settings.systemPrompt,
    model: config?.model || '',
    createdAt: now,
    updatedAt: now,
  };
  await createConversation(conversation);
  await useChatStore.getState().loadConversation(conversation.id);
}

async function insertUserMessage(content: string, imageUri?: string): Promise<Message | null> {
  await ensureLatestCreatedConversationLoaded();
  const beforeIds = new Set(useChatStore.getState().messages.map((message) => message.id));
  await useChatStore.getState().addUserMessage(content, imageUri);
  return (
    useChatStore
      .getState()
      .messages
      .find((message) => !beforeIds.has(message.id) && message.role === 'user') ?? null
  );
}

async function handleScreenShare(): Promise<void> {
  const context = await capturePendingAndroidScreenshotContext();
  if (!context.imageUri) {
    showFloatingBallMessage('Screen capture cancelled', { speak: false }).catch(() => {});
    return;
  }

  await ensureLatestCreatedConversationLoaded();
  await useChatStore
    .getState()
    .addSystemMessage(buildAndroidScreenshotCaptureNotice());
  if (useSettingsStore.getState().floatingBallConfig.autoReplyOnScreenshotShare) {
    showFloatingBallMessage('Screenshot shared, getting reply...', { speak: false }).catch(() => {});
    await useChatStore.getState().triggerResponse();
    return;
  }

  showFloatingBallMessage('Screenshot shared for next reply', { speak: false }).catch(() => {});
}

async function handleScreenControlShare(): Promise<void> {
  const context = await capturePendingAndroidAccessibilityContext();
  await ensureLatestCreatedConversationLoaded();
  await useChatStore
    .getState()
    .addSystemMessage(buildAndroidAccessibilityCaptureNotice(context.activePackage));
  showFloatingBallMessage('Screen context captured for next reply', { speak: false }).catch(() => {});
}
async function handleTextInput(text?: string): Promise<void> {
  const content = text?.trim();
  if (!content) return;
  await insertUserMessage(content);
  showFloatingBallMessage(content, { speak: false }).catch(() => {});
}

async function handleGetReply(): Promise<void> {
  await ensureLatestCreatedConversationLoaded();
  await useChatStore.getState().triggerResponse();
}

async function handleOpenApp(): Promise<void> {
  await openYSClaudeFromFloatingBall();
  router.replace('/');
}

async function handleToggleMusic(): Promise<void> {
  const music = useMusicStore.getState();
  const enabled = !music.desktopLyricsEnabled;
  if (enabled && !music.isOpen) {
    music.openPlayer();
  }
  music.setDesktopLyricsEnabled(enabled);
  if (!enabled) {
    await hideDesktopLyric();
  }
}

export async function handleFloatingBallToolAction(action: FloatingBallToolAction): Promise<void> {
  const actionName = typeof action === 'string' ? action : action.action;
  if (actionBusy && actionName !== 'open_app' && actionName !== 'toggle_music') return;
  actionBusy = true;
  try {
    switch (actionName) {
      case 'screen_share':
        await handleScreenShare();
        break;
      case 'screen_control':
        await handleScreenControlShare();
        break;
      case 'text_input':
        await handleTextInput(typeof action === 'string' ? undefined : action.text);
        break;
      case 'get_reply':
        await handleGetReply();
        break;
      case 'toggle_music':
        await handleToggleMusic();
        break;
      case 'open_app':
        await handleOpenApp();
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Floating ball tool failed';
    showFloatingBallMessage(message, { speak: false }).catch(() => {});
  } finally {
    actionBusy = false;
  }
}
