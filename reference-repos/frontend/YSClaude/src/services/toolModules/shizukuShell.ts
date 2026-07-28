import { executeShizukuShell } from '../shizukuShell';
import type { ToolDefinition, ToolModule } from './types';

const definition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'run_android_shell',
    description: '在当前 Android 设备上以 Shizuku 提供的 shell/root 身份执行命令，并返回 stdout、stderr 和退出码。仅在用户明确要求操作本机或完成任务确实需要时使用。',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string', description: '交给 /system/bin/sh -c 执行的完整命令' } },
      required: ['command'],
    },
  },
};

export const shizukuShellTool: ToolModule = {
  id: 'shizuku-shell',
  labels: { run_android_shell: '执行本机 Shell' },
  getDefinitions: (config) => config.nativeTools?.shizukuShellEnabled ? [definition] : [],
  execute: async (name, args, context) => {
    if (name !== 'run_android_shell') return undefined;
    if (!context.nativeToolConfig?.shizukuShellEnabled) throw new Error('Shizuku Shell 工具未开启');
    const result = await executeShizukuShell(String(args.command || ''), context.nativeToolConfig.shellTimeoutMs, context.nativeToolConfig.shellMaxOutputChars);
    return JSON.stringify(result, null, 2);
  },
};
