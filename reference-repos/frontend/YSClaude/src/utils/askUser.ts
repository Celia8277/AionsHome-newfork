import type { Message, ToolInvocation } from '../types';
import { ASK_USER_TOOL_NAME } from '../services/toolModules/askUser';

export interface AskUserQuestion {
  question: string;
  options: string[];
}

export interface AskUserRequest {
  callId?: string;
  messageId: string;
  questions: AskUserQuestion[];
}

function parseQuestions(invocation: ToolInvocation): AskUserQuestion[] {
  if (invocation.name !== ASK_USER_TOOL_NAME) return [];
  try {
    const parsed = JSON.parse(invocation.args || '{}');
    if (!Array.isArray(parsed.questions)) return [];
    return parsed.questions
      .slice(0, 10)
      .map((item: any) => ({
        question: typeof item?.question === 'string' ? item.question.trim() : '',
        options: Array.isArray(item?.options)
          ? item.options
              .filter((option: unknown): option is string => typeof option === 'string')
              .map((option: string) => option.trim())
              .filter(Boolean)
              .slice(0, 8)
          : [],
      }))
      .filter((item: AskUserQuestion) => item.question && item.options.length > 0);
  } catch {
    return [];
  }
}

export function getPendingAskUserRequest(messages: Message[]): AskUserRequest | null {
  const latest = messages[messages.length - 1];
  if (!latest || latest.role !== 'assistant') return null;
  const invocation = [...(latest.toolInvocations || [])]
    .reverse()
    .find((item) => item.name === ASK_USER_TOOL_NAME);
  if (!invocation) return null;
  const questions = parseQuestions(invocation);
  if (questions.length === 0) return null;
  return {
    callId: invocation.callId,
    messageId: latest.id,
    questions,
  };
}

export function formatAskUserAnswers(
  questions: AskUserQuestion[],
  answers: string[]
): string {
  return questions
    .map((item, index) => `Q：${item.question}\nA：${answers[index] || ''}`)
    .join('\n\n');
}
