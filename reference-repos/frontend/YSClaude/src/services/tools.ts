import { hotboardTool } from './toolModules/hotboard';
import { accountingTool } from './toolModules/accounting';
import { conversationArtifactsTool } from './toolModules/conversationArtifacts';
import { conversationWindowsTool } from './toolModules/conversationWindows';
import { mcpRemoteTool } from './toolModules/mcpRemote';
import { memoryVaultTool, uploadDiary } from './toolModules/memoryVault';
import { nativeDeviceTool } from './toolModules/nativeDevice';
import { runCommandTool } from './toolModules/runCommand';
import { shizukuShellTool } from './toolModules/shizukuShell';
import { sshArtifactTransferTool } from './toolModules/sshArtifactTransfer';
import { voiceCallTool } from './toolModules/voiceCall';
import { webSearchTool } from './toolModules/webSearch';
import { webViewTool } from './toolModules/webView';
import { botMessagingTool } from './toolModules/botMessaging';
import { discordBotTool } from './toolModules/discordBot';
import { messageReactionTool } from './toolModules/messageReaction';
import { askUserTool } from './toolModules/askUser';
import { subAgentTool } from './toolModules/subAgent';
import { useSettingsStore, type McpToolConfig } from '../stores/settings';
import {
  ToolDefinition,
  ToolDefinitionConfig,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolModule,
} from './toolModules/types';

export type { ToolDefinition, ToolDefinitionConfig, ToolExecutionContext, ToolExecutionResult, ToolModule };
export { uploadDiary };

const TOOL_MODULES: ToolModule[] = [
  askUserTool,
  subAgentTool,
  messageReactionTool,
  conversationWindowsTool,
  accountingTool,
  memoryVaultTool,
  webSearchTool,
  hotboardTool,
  runCommandTool,
  shizukuShellTool,
  sshArtifactTransferTool,
  mcpRemoteTool,
  webViewTool,
  conversationArtifactsTool,
  nativeDeviceTool,
  voiceCallTool,
  botMessagingTool,
  discordBotTool,
];

const TOOL_LABELS: Record<string, string> = TOOL_MODULES.reduce(
  (labels, toolModule) => ({ ...labels, ...toolModule.labels }),
  {}
);

export function getToolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__').filter(Boolean);
    if (parts.length >= 3) {
      const serverId = parts[1];
      const rawToolName = parts.slice(2).join('__');
      return `MCP ${serverId}: ${rawToolName}`;
    }
  }
  if (toolName.startsWith('mcp_resource__')) {
    const parts = toolName.split('__').filter(Boolean);
    if (parts.length >= 2) {
      return `MCP ${parts[1]}: 读取资源`;
    }
  }
  return toolName;
}

/**
 * 根据启用状态返回 tool 定义列表。
 */
export function getToolDefinitions(config: ToolDefinitionConfig): ToolDefinition[] {
  return TOOL_MODULES.flatMap((toolModule) => toolModule.getDefinitions(config));
}

export function getPermissiveMcpToolConfig(): McpToolConfig {
  const config = useSettingsStore.getState().mcpToolConfig;
  return {
    ...config,
    enabled: true,
    resourceToolsEnabled: true,
    servers: (config.servers || []).map((server) => ({
      ...server,
      enabled: true,
      tools: (server.tools || []).map((tool) => ({ ...tool, enabled: true })),
      resources: (server.resources || []).map((resource) => ({ ...resource, enabled: true })),
    })),
  };
}

/** 用于权限选择器：列出所有内置工具和已导入的 MCP 工具，不受主 Agent开关影响。 */
export function getToolPoolDefinitions(): ToolDefinition[] {
  const settings = useSettingsStore.getState();
  const nativeTools = new Proxy({ ...settings.nativeToolConfig }, {
    get(target, property) {
      const value = Reflect.get(target, property);
      return typeof value === 'boolean' || value === undefined ? true : value;
    },
  });
  return getToolDefinitions({
    memoryVault: true,
    memoryVaultConfig: settings.memoryVaultConfig,
    webSearch: true,
    webInteraction: true,
    conversationArtifacts: true,
    conversationWindows: true,
    htmlArtifacts: true,
    hotboard: true,
    runCommand: { ...settings.runCommandConfig, enabled: true },
    nativeTools,
    mcpTools: getPermissiveMcpToolConfig(),
    voiceCallActive: true,
    qqBotTools: true,
    wechatClawBotTools: true,
    discordBotTools: true,
    subAgents: true,
  });
}

/**
 * 执行指定工具并返回结果文本。
 */
export async function executeTool(
  toolName: string,
  args: Record<string, any>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  try {
    for (const toolModule of TOOL_MODULES) {
      const result = await toolModule.execute(toolName, args, context);
      if (result !== undefined) {
        return result;
      }
    }
    return `未知工具: ${toolName}`;
  } catch (err: any) {
    return `工具执行失败: ${err.message || '未知错误'}`;
  }
}
