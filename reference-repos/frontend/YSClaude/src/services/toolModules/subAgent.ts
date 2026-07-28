import { useSettingsStore } from '../../stores/settings';
import type { ToolModule } from './types';

export const subAgentTool: ToolModule = {
  id: 'sub-agent',
  labels: { dispatch_subagent: '派发子 Agent' },
  getDefinitions: (config) => {
    if (!config.subAgents) return [];
    const profiles = useSettingsStore.getState().subAgentConfig.profiles
      .filter((item) => item.enabled)
      .map((item) => `${item.id}（${item.name}）：${item.description || '未填写说明'}`)
      .join('\n');
    return [{
    type: 'function',
    function: {
      name: 'dispatch_subagent',
      description: `把一个独立、明确的任务派发给已配置的子 Agent，并等待其完成后返回结果。可用 Agent：\n${profiles}`,
      parameters: {
        type: 'object',
        properties: {
          agentId: { type: 'string', description: '子 Agent 配置 ID' },
          task: { type: 'string', description: '完整、可独立执行的任务说明' },
        },
        required: ['agentId', 'task'],
      },
    },
    }];
  },
  execute: async (toolName, args, context) => {
    if (toolName !== 'dispatch_subagent') return undefined;
    const config = useSettingsStore.getState().subAgentConfig;
    const profile = config.profiles.find((item) => item.id === args.agentId && item.enabled);
    if (!config.enabled) return '子 Agent 功能未启用。';
    if (!profile) return `未找到或未启用子 Agent：${String(args.agentId || '')}`;
    const currentDepth = context.subAgentDepth || 0;
    if (context.subAgentRunId && (context.subAgentRemainingDepth || 0) <= 0) {
      return '当前子 Agent 已达到最大嵌套深度。';
    }
    const { runSubAgent } = await import('../subAgentRuntime');
    const result = await runSubAgent(profile, String(args.task || ''), currentDepth, context.abortSignal, {
      conversationId: context.conversationId,
      messageId: context.messageId,
      remainingDepth: context.subAgentRunId
        ? Math.max(0, (context.subAgentRemainingDepth || 0) - 1)
        : undefined,
      parentRunId: context.subAgentRunId,
    });
    return JSON.stringify({ agent: profile.name, ...result }, null, 2);
  },
};
