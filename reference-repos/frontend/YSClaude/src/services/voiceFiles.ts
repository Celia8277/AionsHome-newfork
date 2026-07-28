import { File } from 'expo-file-system';
import type { Message, VoiceAttachment } from '../types';
import {
  getMessagesByConversation,
  getVoiceAttachmentMessages,
  updateMessageVoiceAttachment,
} from '../db/operations';

const VOICE_FILE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_MIN_INTERVAL_MS = 60 * 60 * 1000;

let cleanupInFlight = false;
let lastCleanupAt = 0;

export async function deleteVoiceAttachmentFile(voice?: VoiceAttachment): Promise<void> {
  if (!voice?.uri) return;
  try {
    const file = new File(voice.uri);
    if (file.exists) {
      file.delete();
    }
  } catch (error) {
    console.warn('[Voice] Failed to delete voice file:', error);
  }
}

export async function deleteMessageVoiceFile(message: Message | undefined): Promise<void> {
  await deleteVoiceAttachmentFile(message?.voiceAttachment);
}

export async function deleteConversationVoiceFiles(conversationId: string): Promise<void> {
  const messages = await getMessagesByConversation(conversationId);
  await Promise.all(messages.map((message) => deleteMessageVoiceFile(message)));
}

function canDropVoiceFile(voice: VoiceAttachment, cutoff: number, fallbackCreatedAt: number): boolean {
  const createdAt = voice.createdAt || fallbackCreatedAt;
  return (
    !!voice.uri &&
    createdAt < cutoff &&
    voice.transcriptStatus === 'completed' &&
    !!voice.transcript?.trim()
  );
}

export async function cleanupExpiredVoiceFiles(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastCleanupAt < CLEANUP_MIN_INTERVAL_MS) return;
  if (cleanupInFlight) return;

  cleanupInFlight = true;
  lastCleanupAt = now;
  try {
    const cutoff = now - VOICE_FILE_RETENTION_MS;
    const records = await getVoiceAttachmentMessages();
    for (const record of records) {
      const voice = record.voiceAttachment;
      if (!canDropVoiceFile(voice, cutoff, record.createdAt)) continue;

      await deleteVoiceAttachmentFile(voice);
      await updateMessageVoiceAttachment(record.messageId, {
        ...voice,
        uri: '',
        updatedAt: Date.now(),
      });
    }
  } catch (error) {
    console.warn('[Voice] Failed to clean expired voice files:', error);
  } finally {
    cleanupInFlight = false;
  }
}
