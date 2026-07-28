import { randomUUID } from 'expo-crypto';
import { streamChatCompletion, type ChatMessage } from './api';
import { executeTool, getPermissiveMcpToolConfig, getToolPoolDefinitions } from './tools';
import { useSettingsStore, type SubAgentProfile } from '../stores/settings';
import { appendAgentRunEvent, createAgentRun, finishAgentRun } from '../db/agentRuns';

export interface SubAgentRunResult {
  runId: string;
  status: 'completed' | 'failed' | 'cancelled' | 'timeout';
  output: string;
  toolCallCount: number;
  totalTokens: number;
  error?: string;
}

function resultText(result: Awaited<ReturnType<typeof executeTool>>): string {
  return typeof result === 'string' ? result : result.text;
}

export async function runSubAgent(
  profile: SubAgentProfile,
  task: string,
  parentDepth: number,
  parentSignal?: AbortSignal,
  context?: { conversationId?: string; messageId?: string; remainingDepth?: number; parentRunId?: string }
): Promise<SubAgentRunResult> {
  const settings = useSettingsStore.getState();
  const api = settings.apiConfigs.find((item) => item.name === profile.apiConfigName);
  const runId = randomUUID();
  const depth = parentDepth + 1;
  await createAgentRun({ id: runId, parentRunId: context?.parentRunId, conversationId: context?.conversationId, parentMessageId: context?.messageId, profile, task, depth });
  let eventSequence = 0;
  const finalize = async (result: SubAgentRunResult): Promise<SubAgentRunResult> => {
    await finishAgentRun({ id: runId, status: result.status, output: result.output, error: result.error, toolCallCount: result.toolCallCount, totalTokens: result.totalTokens });
    return result;
  };
  if (!api) {
    return finalize({ runId, status: 'failed', output: '', toolCallCount: 0, totalTokens: 0, error: `未找到 API 配置：${profile.apiConfigName || '未设置'}` });
  }

  const remainingDepth = context?.remainingDepth === undefined
    ? profile.maxNestingDepth
    : Math.min(profile.maxNestingDepth, Math.max(0, context.remainingDepth));
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), profile.maxRuntimeMs);
  const messages: ChatMessage[] = [
    { role: 'system', content: profile.systemPrompt },
    { role: 'user', content: task },
  ];
  const allowed = new Set(profile.allowedToolNames);
  let tools = getToolPoolDefinitions();
  tools = tools.filter((tool) => tool.function.name === 'dispatch_subagent'
    ? remainingDepth > 0
    : allowed.has(tool.function.name));
  const subAgentMcpToolConfig = getPermissiveMcpToolConfig();

  let toolCallCount = 0;
  let totalTokens = 0;
  let output = '';
  try {
    while (true) {
      let roundOutput = '';
      const response = await streamChatCompletion({
        ...api,
        model: profile.model || api.model,
        messages,
        maxTokens: profile.maxOutputTokens,
        tools,
        sessionId: runId,
        usageContext: { feature: 'sub-agent', requestKind: 'tool-loop', conversationId: context?.conversationId, messageId: context?.messageId, metadata: { runId, depth, profileId: profile.id } },
      }, (token) => { roundOutput += token; }, controller.signal);
      output += roundOutput;
      totalTokens += response.usage?.totalTokens || 0;
      await appendAgentRunEvent({ runId, sequence: ++eventSequence, type: 'assistant', content: response.content || '' });
      const calls = response.tool_calls || [];
      if (calls.length === 0 || toolCallCount >= profile.maxToolCalls) {
        return finalize({ runId, status: 'completed', output, toolCallCount, totalTokens });
      }
      const acceptedCalls = calls.slice(0, profile.maxToolCalls - toolCallCount);
      messages.push({ role: 'assistant', content: response.content || '', tool_calls: acceptedCalls });
      toolCallCount += acceptedCalls.length;
      const executeCall = async (call: (typeof acceptedCalls)[number]) => {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* executor receives empty args */ }
        const result = await executeTool(call.function.name, args, {
          conversationId: context?.conversationId,
          messageId: context?.messageId,
          memoryVaultConfig: settings.memoryVaultConfig,
          webSearchConfig: settings.webSearchConfig,
          webInteractionConfig: settings.webInteractionConfig,
          conversationArtifactToolConfig: settings.conversationArtifactToolConfig,
          conversationWindowToolConfig: settings.conversationWindowToolConfig,
          htmlArtifactToolConfig: settings.htmlArtifactToolConfig,
          hotboardConfig: settings.hotboardConfig,
          runCommandConfig: settings.runCommandConfig,
          nativeToolConfig: settings.nativeToolConfig,
          mcpToolConfig: subAgentMcpToolConfig,
          qqBotToolConfig: settings.qqBotToolConfig,
          wechatClawBotToolConfig: settings.wechatClawBotToolConfig,
          discordBotToolConfig: settings.discordBotToolConfig,
          subAgentRunId: runId,
          subAgentDepth: depth,
          subAgentRemainingDepth: remainingDepth,
          abortSignal: controller.signal,
        });
        return resultText(result);
      };
      const toolResults = acceptedCalls.length > 1 && acceptedCalls.every((call) => call.function.name === 'dispatch_subagent')
        ? await Promise.all(acceptedCalls.map(executeCall))
        : await acceptedCalls.reduce<Promise<string[]>>(async (pending, call) => {
            const collected = await pending;
            collected.push(await executeCall(call));
            return collected;
          }, Promise.resolve([]));
      for (let index = 0; index < acceptedCalls.length; index++) {
        const call = acceptedCalls[index];
        const toolResult = toolResults[index];
        await appendAgentRunEvent({ runId, sequence: ++eventSequence, type: 'tool', toolCallId: call.id, toolName: call.function.name, toolArgs: call.function.arguments || '{}', toolResult });
        messages.push({ role: 'tool', tool_call_id: call.id, content: toolResult });
      }
    }
  } catch (error: any) {
    const timedOut = !parentSignal?.aborted && controller.signal.aborted;
    return finalize({ runId, status: timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'failed', output, toolCallCount, totalTokens, error: error?.message || String(error) });
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }
}
