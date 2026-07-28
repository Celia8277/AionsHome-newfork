import { randomUUID } from 'expo-crypto';
import { getDatabase } from './database';
import type { SubAgentProfile } from '../stores/settings';

const MAX_EVENT_TEXT_LENGTH = 100_000;

function sanitizeEventText(value?: string): string | null {
  if (!value) return null;
  return value
    .replace(/("(?:api[_-]?key|password|token|authorization|secret)"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1[REDACTED]')
    .slice(0, MAX_EVENT_TEXT_LENGTH);
}

export async function createAgentRun(input: {
  id: string;
  parentRunId?: string;
  conversationId?: string;
  parentMessageId?: string;
  profile: SubAgentProfile;
  task: string;
  depth: number;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO agent_runs (id, parent_run_id, conversation_id, parent_message_id, profile_id, profile_snapshot, task, status, depth, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
    [input.id, input.parentRunId || null, input.conversationId || null, input.parentMessageId || null, input.profile.id, JSON.stringify(input.profile), input.task, input.depth, Date.now()]
  );
}

export async function appendAgentRunEvent(input: {
  runId: string;
  sequence: number;
  type: string;
  content?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: string;
  toolResult?: string;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO agent_run_events (id, run_id, sequence, type, content, tool_call_id, tool_name, tool_args, tool_result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), input.runId, input.sequence, input.type, sanitizeEventText(input.content), input.toolCallId || null, input.toolName || null, sanitizeEventText(input.toolArgs), sanitizeEventText(input.toolResult), Date.now()]
  );
}

export async function finishAgentRun(input: {
  id: string;
  status: string;
  output: string;
  error?: string;
  toolCallCount: number;
  totalTokens: number;
}): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE agent_runs SET status = ?, final_output = ?, error = ?, tool_call_count = ?, total_tokens = ?, finished_at = ? WHERE id = ?`,
    [input.status, sanitizeEventText(input.output), sanitizeEventText(input.error), input.toolCallCount, input.totalTokens, Date.now(), input.id]
  );
}
