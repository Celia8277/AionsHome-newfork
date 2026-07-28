import { NativeModules, Platform } from 'react-native';
import type { RunCommandConfig } from '../../stores/settings';
import { ToolDefinition, ToolModule } from './types';

const DEFAULT_TIMEOUT_MS = 60000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 3600000;
const DEFAULT_MAX_OUTPUT_CHARS = 20000;
const MAX_COMMAND_CHARS = 8000;
const MAX_FILE_PATH_CHARS = 2000;
const MAX_FILE_CONTENT_CHARS = 500000;
const FILE_WRITE_BASE64_CHUNK_CHARS = 6000;
// 必须是 3 的倍数：保证每个分块单独 base64 编码时中间分块不产生 '=' 填充，可以安全拼接。
const FILE_READ_RAW_CHUNK_BYTES = 96000;
const FILE_READ_CHUNK_MAX_OUTPUT_CHARS = 200000;

const RemoteSshCommand = NativeModules.RemoteSshCommand as
  | {
      connect: (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
      command: (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
      status: () => Promise<Record<string, unknown>>;
      close: () => Promise<Record<string, unknown>>;
    }
  | undefined;

const SSH_CONNECT_TOOL_BASE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_connect',
    description:
      '连接用户在 Tool 设置中配置的专用 AI SSH 服务器，建立一个持久化 SSH transport。开始操作远程服务器前先调用；如果 session 已存在会直接复用，不要为每个命令重复连接。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const SSH_STATUS_TOOL_BASE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_status',
    description:
      '探测当前持久化 SSH transport 是否仍然可用。需要确认 session 状态时使用；不要为了每条命令都调用 ssh_connect。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const SSH_COMMAND_TOOL_BASE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_command',
    description:
      '通过当前持久化 SSH transport 执行命令。必须先调用 ssh_connect。工具会尽量保留 cd 后的目录和 export 的环境变量；不要依赖 alias、shell 函数、交互式程序或前台长期进程状态。',
    parameters: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: '要在当前 SSH shell 中执行的完整命令。',
        },
        timeout_ms: {
          type: 'number',
          description: '可选超时时间，单位毫秒。命令长时间不结束时会返回部分输出；前台进程可能仍占用当前 shell。',
        },
      },
      required: ['command'],
    },
  },
};

const SSH_READ_FILE_TOOL_BASE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_read_file',
    description:
      '读取当前 SSH session 中远程服务器上的文本文件。编辑代码前优先使用此工具读取文件，不要用很长的 shell 命令拼 cat/sed。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '要读取的远程文件路径。相对路径会基于当前 SSH 工作目录解析。',
        },
        max_chars: {
          type: 'number',
          description: '可选，最多返回多少字符。默认使用工具设置里的输出上限。',
        },
      },
      required: ['path'],
    },
  },
};

const SSH_WRITE_FILE_TOOL_BASE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_write_file',
    description:
      '写入当前 SSH session 中远程服务器上的文本文件。编辑代码、配置或文档时优先使用此工具；它会分块传输内容，避免 ssh_command 的命令长度限制。默认覆盖目标文件，可选择追加。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '要写入的远程文件路径。相对路径会基于当前 SSH 工作目录解析。',
        },
        content: {
          type: 'string',
          description: '完整文件内容或要追加的文本内容。',
        },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append'],
          description: '写入模式。overwrite 覆盖文件；append 追加到文件末尾。默认 overwrite。',
        },
        timeout_ms: {
          type: 'number',
          description: '可选，单个传输步骤的超时时间，单位毫秒。',
        },
      },
      required: ['path', 'content'],
    },
  },
};

const SSH_CLOSE_TOOL_BASE: ToolDefinition = {
  type: 'function',
  function: {
    name: 'ssh_close',
    description:
      '关闭当前持久化 SSH transport。只有用户明确要求关闭连接、重置远程命令状态，或当前 session 已不可恢复时才调用；普通任务完成后不要自动关闭。',
    parameters: {
      type: 'object',
      properties: {
        confirm: {
          type: 'string',
          description: '必须填写 close_current_ssh_session，表示明确要关闭当前持久 SSH session。',
        },
      },
      required: ['confirm'],
    },
  },
};

export const runCommandTool: ToolModule = {
  id: 'run-command',
  labels: {
    ssh_connect: 'SSH 连接',
    ssh_status: 'SSH 状态',
    ssh_command: 'SSH 命令',
    ssh_read_file: 'SSH 读文件',
    ssh_write_file: 'SSH 写文件',
    ssh_close: 'SSH 关闭',
    run_command: '远程命令',
  },
  getDefinitions: (config) =>
    config.runCommand?.enabled
      ? [
          SSH_CONNECT_TOOL_BASE,
          SSH_STATUS_TOOL_BASE,
          SSH_COMMAND_TOOL_BASE,
          SSH_READ_FILE_TOOL_BASE,
          SSH_WRITE_FILE_TOOL_BASE,
          SSH_CLOSE_TOOL_BASE,
        ]
      : [],
  execute: async (toolName, args, context) => {
    if (toolName === 'ssh_connect') {
      return await executeSshConnect(args, context.runCommandConfig);
    }
    if (toolName === 'ssh_status') {
      return await executeSshStatus(context.runCommandConfig);
    }
    if (toolName === 'ssh_command') {
      return await executeSshCommand(args, context.runCommandConfig);
    }
    if (toolName === 'ssh_read_file') {
      return await executeSshReadFile(args, context.runCommandConfig);
    }
    if (toolName === 'ssh_write_file') {
      return await executeSshWriteFile(args, context.runCommandConfig);
    }
    if (toolName === 'ssh_close') {
      return await executeSshClose(args, context.runCommandConfig);
    }
    if (toolName === 'run_command') {
      return await executeLegacyRunCommand(args, context.runCommandConfig);
    }
    return undefined;
  },
};

async function executeSshConnect(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  const maxOutputChars = normalizeMaxOutputChars(config.maxOutputChars);
  const result = await ensureRemoteSshCommand().connect({
    ...buildConnectionPayload(config),
    reconnect: false,
    cwd: config.defaultCwd || undefined,
    timeoutMs: normalizeTimeoutMs(args?.timeout_ms, config.timeoutMs),
    maxOutputChars,
  });
  return formatSshResponse('SSH session 连接结果：', result, maxOutputChars);
}

async function executeSshStatus(config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  const result = await ensureRemoteSshCommand().status();
  return formatSshResponse('SSH session 状态：', result, normalizeMaxOutputChars(config.maxOutputChars));
}

async function executeSshCommand(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  const command = String(args?.command || '').trim();
  if (!command) {
    throw new Error('command 不能为空');
  }
  if (command.length > MAX_COMMAND_CHARS) {
    throw new Error(`command 过长，最多 ${MAX_COMMAND_CHARS} 个字符`);
  }

  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms, config.timeoutMs);
  const maxOutputChars = normalizeMaxOutputChars(config.maxOutputChars);
  const result = await ensureRemoteSshCommand().command({
    ...buildConnectionPayload(config),
    autoReconnect: true,
    cwd: config.defaultCwd || undefined,
    command,
    timeoutMs,
    maxOutputChars,
  });
  return formatSshResponse('SSH session 命令结果：', result, maxOutputChars);
}

async function executeSshReadFile(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  const path = normalizeRemotePath(args?.path);
  const maxOutputChars = normalizeMaxOutputChars(
    typeof args?.max_chars === 'number' ? args.max_chars : config.maxOutputChars
  );
  const timeoutMs = normalizeTimeoutMs(args?.timeout_ms, config.timeoutMs);
  const result = await runSshCommandRaw(
    `cat -- ${shellQuote(path)}`,
    config,
    timeoutMs,
    maxOutputChars
  );
  return formatSshResponse(`SSH 文件读取结果：${redactRemotePath(path)}`, result, maxOutputChars);
}

async function executeSshWriteFile(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  const path = normalizeRemotePath(args?.path);
  const content = normalizeFileContent(args?.content);
  const mode = String(args?.mode || 'overwrite') === 'append' ? 'append' : 'overwrite';
  const maxOutputChars = normalizeMaxOutputChars(config.maxOutputChars);

  const result = await sshUploadTextFileResult(config, path, content, mode, args?.timeout_ms);
  if (!result.ok) return result.message;

  const lines = [
    'SSH 文件写入结果：',
    `path: ${redactRemotePath(path)}`,
    `mode: ${mode}`,
    `content_chars: ${String(result.contentChars)}`,
    `base64_chars: ${String(result.base64Chars)}`,
    `chunks: ${String(result.chunks)}`,
    'remote: configured_ssh_server',
    'status: ok',
  ];
  return truncateOutput(lines.join('\n'), maxOutputChars);
}

export type SshTransferResult<T> = ({ ok: true } & T) | { ok: false; message: string };

/**
 * 把文本内容分块 base64 上传写入远程文件。供 ssh_write_file 和文件互传工具复用。
 */
export async function sshUploadTextFileResult(
  config: RunCommandConfig,
  rawPath: string,
  content: string,
  mode: 'overwrite' | 'append',
  timeoutMsArg?: unknown
): Promise<SshTransferResult<{ contentChars: number; base64Chars: number; chunks: number }>> {
  ensureSshConfig(config);
  const path = normalizeRemotePath(rawPath);
  const timeoutMs = normalizeTimeoutMs(timeoutMsArg, config.timeoutMs);
  const maxOutputChars = normalizeMaxOutputChars(config.maxOutputChars);
  const base64 = encodeUtf8Base64(content);

  const initScript = [
    `TARGET=${shellQuote(path)}`,
    'DIR=$(dirname -- "$TARGET")',
    'mkdir -p -- "$DIR"',
    'TMP_FILE=$(mktemp "${DIR}/.ysclaude-write.XXXXXX")',
    'printf "%s\\n" "$TMP_FILE"',
  ].join('\n');
  const initResult = await runSshCommandRaw(initScript, config, timeoutMs, 4000);
  if ((initResult?.exit_code ?? initResult?.exitCode ?? 1) !== 0) {
    return {
      ok: false,
      message: formatSshResponse(`SSH 文件写入准备失败：${redactRemotePath(path)}`, initResult, maxOutputChars),
    };
  }

  const tmpPath = normalizeOutput(initResult?.stdout ?? initResult?.output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .pop();
  if (!tmpPath) {
    throw new Error('远程临时文件路径为空，无法写入文件');
  }

  let writtenBase64Chars = 0;
  try {
    for (let index = 0; index < base64.length; index += FILE_WRITE_BASE64_CHUNK_CHARS) {
      const chunk = base64.slice(index, index + FILE_WRITE_BASE64_CHUNK_CHARS);
      const appendScript = `printf %s ${shellQuote(chunk)} | base64 -d >> ${shellQuote(tmpPath)}`;
      const appendResult = await runSshCommandRaw(appendScript, config, timeoutMs, 4000);
      if ((appendResult?.exit_code ?? appendResult?.exitCode ?? 1) !== 0) {
        await runSshCommandRaw(`rm -f -- ${shellQuote(tmpPath)}`, config, 5000, 1000).catch(() => undefined);
        return {
          ok: false,
          message: formatSshResponse(`SSH 文件写入失败：${redactRemotePath(path)}`, appendResult, maxOutputChars),
        };
      }
      writtenBase64Chars += chunk.length;
    }

    const finalizeScript = mode === 'append'
      ? `cat -- ${shellQuote(tmpPath)} >> ${shellQuote(path)} && rm -f -- ${shellQuote(tmpPath)}`
      : `mv -f -- ${shellQuote(tmpPath)} ${shellQuote(path)}`;
    const finalizeResult = await runSshCommandRaw(finalizeScript, config, timeoutMs, maxOutputChars);
    if ((finalizeResult?.exit_code ?? finalizeResult?.exitCode ?? 1) !== 0) {
      await runSshCommandRaw(`rm -f -- ${shellQuote(tmpPath)}`, config, 5000, 1000).catch(() => undefined);
      return {
        ok: false,
        message: formatSshResponse(`SSH 文件写入完成步骤失败：${redactRemotePath(path)}`, finalizeResult, maxOutputChars),
      };
    }

    return {
      ok: true,
      contentChars: content.length,
      base64Chars: writtenBase64Chars,
      chunks: Math.ceil(base64.length / FILE_WRITE_BASE64_CHUNK_CHARS),
    };
  } catch (error) {
    await runSshCommandRaw(`rm -f -- ${shellQuote(tmpPath)}`, config, 5000, 1000).catch(() => undefined);
    throw error;
  }
}

/**
 * 从远程服务器分块 base64 拉取文本文件内容。供文件互传工具使用。
 * maxBytes 用于在传输前拒绝过大的文件。
 */
export async function sshDownloadTextFileResult(
  config: RunCommandConfig,
  rawPath: string,
  maxBytes: number,
  timeoutMsArg?: unknown
): Promise<SshTransferResult<{ content: string; sizeBytes: number }>> {
  ensureSshConfig(config);
  const path = normalizeRemotePath(rawPath);
  const timeoutMs = normalizeTimeoutMs(timeoutMsArg, config.timeoutMs);
  const maxOutputChars = normalizeMaxOutputChars(config.maxOutputChars);

  const sizeResult = await runSshCommandRaw(
    `wc -c < ${shellQuote(path)}`,
    config,
    timeoutMs,
    4000
  );
  if ((sizeResult?.exit_code ?? sizeResult?.exitCode ?? 1) !== 0) {
    return {
      ok: false,
      message: formatSshResponse(`读取远程文件大小失败：${redactRemotePath(path)}`, sizeResult, maxOutputChars),
    };
  }
  const sizeBytes = Number.parseInt(normalizeOutput(sizeResult?.stdout ?? sizeResult?.output).trim(), 10);
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return { ok: false, message: `无法解析远程文件大小：${redactRemotePath(path)}` };
  }
  if (sizeBytes > maxBytes) {
    return {
      ok: false,
      message: `远程文件过大：${sizeBytes} 字节，超过 ${maxBytes} 字节上限，无法拉取到对话文件。`,
    };
  }
  if (sizeBytes === 0) {
    return { ok: true, content: '', sizeBytes: 0 };
  }

  let base64 = '';
  for (let offset = 0; offset < sizeBytes; offset += FILE_READ_RAW_CHUNK_BYTES) {
    const chunkScript =
      `tail -c +${offset + 1} ${shellQuote(path)} | head -c ${FILE_READ_RAW_CHUNK_BYTES} | base64 | tr -d '\\n'`;
    const chunkResult = await runSshCommandRaw(chunkScript, config, timeoutMs, FILE_READ_CHUNK_MAX_OUTPUT_CHARS);
    if ((chunkResult?.exit_code ?? chunkResult?.exitCode ?? 1) !== 0) {
      return {
        ok: false,
        message: formatSshResponse(`SSH 文件读取失败：${redactRemotePath(path)}`, chunkResult, maxOutputChars),
      };
    }
    base64 += normalizeOutput(chunkResult?.stdout ?? chunkResult?.output).replace(/\s+/g, '');
  }

  let content: string;
  try {
    content = decodeUtf8Base64(base64);
  } catch {
    return { ok: false, message: `远程文件内容解码失败，可能不是文本文件：${redactRemotePath(path)}` };
  }
  if (content.includes('\0')) {
    return { ok: false, message: `远程文件包含二进制内容，暂不支持拉取到对话文件：${redactRemotePath(path)}` };
  }
  return { ok: true, content, sizeBytes };
}

async function executeSshClose(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  ensureSshConfig(config);
  if (String(args?.confirm || '') !== 'close_current_ssh_session') {
    throw new Error('关闭 SSH session 需要 confirm=close_current_ssh_session');
  }
  const result = await ensureRemoteSshCommand().close();
  return formatSshResponse('SSH session 关闭结果：', result, normalizeMaxOutputChars(config.maxOutputChars));
}

async function executeLegacyRunCommand(args: Record<string, any>, config: RunCommandConfig): Promise<string> {
  await executeSshConnect({}, config);
  return await executeSshCommand(args, config);
}

async function runSshCommandRaw(
  command: string,
  config: RunCommandConfig,
  timeoutMs: number,
  maxOutputChars: number
): Promise<Record<string, unknown>> {
  return await ensureRemoteSshCommand().command({
    ...buildConnectionPayload(config),
    autoReconnect: true,
    cwd: config.defaultCwd || undefined,
    command,
    timeoutMs,
    maxOutputChars,
  });
}

function ensureSshConfig(config: RunCommandConfig): void {
  if (!config?.enabled) {
    throw new Error('远程命令工具未启用，请先在「Tool 设置」中打开');
  }
  if (Platform.OS !== 'android') {
    throw new Error('SSH 远程命令当前仅支持 Android development build');
  }

  const sshHost = String(config.sshHost || '').trim();
  const sshUsername = String(config.sshUsername || '').trim();
  if (!sshHost) {
    throw new Error('请先在「Tool 设置」中填写 SSH 主机');
  }
  if (!sshUsername) {
    throw new Error('请先在「Tool 设置」中填写 SSH 用户名');
  }
  if (!String(config.sshPassword || '').trim() && !String(config.sshPrivateKey || '').trim()) {
    throw new Error('请至少配置 SSH 密码或私钥');
  }
}

function ensureRemoteSshCommand(): NonNullable<typeof RemoteSshCommand> {
  if (!RemoteSshCommand) {
    throw new Error('SSH 原生模块未加载，请重新运行 npx expo run:android 安装包含原生模块的新包');
  }
  return RemoteSshCommand;
}

function buildConnectionPayload(config: RunCommandConfig): Record<string, unknown> {
  return {
    host: String(config.sshHost || '').trim(),
    port: normalizePort(config.sshPort),
    username: String(config.sshUsername || '').trim(),
    password: config.sshPassword || undefined,
    privateKey: config.sshPrivateKey || undefined,
    passphrase: config.sshPassphrase || undefined,
    strictHostKeyChecking: !!config.strictHostKeyChecking,
    knownHosts: config.knownHosts || undefined,
  };
}

function normalizeTimeoutMs(input: unknown, fallback: number): number {
  const value = typeof input === 'number' ? input : fallback;
  if (!Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}

function normalizeMaxOutputChars(input: number): number {
  if (!Number.isFinite(input) || input <= 0) return DEFAULT_MAX_OUTPUT_CHARS;
  return Math.min(500000, Math.max(1000, Math.round(input)));
}

function normalizePort(input: number): number {
  if (!Number.isFinite(input)) return 22;
  return Math.min(65535, Math.max(1, Math.round(input)));
}

function normalizeRemotePath(input: unknown): string {
  const path = String(input || '').trim();
  if (!path) {
    throw new Error('path 不能为空');
  }
  if (path.length > MAX_FILE_PATH_CHARS) {
    throw new Error(`path 过长，最多 ${MAX_FILE_PATH_CHARS} 个字符`);
  }
  if (path.includes('\0')) {
    throw new Error('path 不能包含空字符');
  }
  return path;
}

function normalizeFileContent(input: unknown): string {
  const content = String(input ?? '');
  if (content.length > MAX_FILE_CONTENT_CHARS) {
    throw new Error(`content 过长，最多 ${MAX_FILE_CONTENT_CHARS} 个字符`);
  }
  return content;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function encodeUtf8Base64(value: string): string {
  if (typeof btoa !== 'function') {
    throw new Error('当前运行环境不支持 base64 编码');
  }
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}

function decodeUtf8Base64(value: string): string {
  if (typeof atob !== 'function') {
    throw new Error('当前运行环境不支持 base64 解码');
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function redactRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return '[empty]';
  const normalized = trimmed.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts[parts.length - 1] || normalized;
  if (!normalized.startsWith('/') && parts.length <= 1) return fileName;
  return `.../${fileName}`;
}

function formatSshResponse(title: string, data: any, maxOutputChars: number): string {
  const exitCode = data?.exit_code ?? data?.exitCode ?? data?.code;
  const stdout = normalizeOutput(data?.stdout ?? data?.output);
  const stderr = normalizeOutput(data?.stderr ?? data?.error);
  const durationMs = data?.duration_ms ?? data?.durationMs;
  const hasRemoteIdentity = !!normalizeOutput(data?.host);
  const status = normalizeOutput(data?.status);
  const sessionId = normalizeOutput(data?.session_id ?? data?.sessionId);
  const sessionConnected = data?.session_connected ?? data?.sessionConnected;
  const timedOut = data?.timed_out ?? data?.timedOut;
  const cwd = normalizeOutput(data?.cwd);
  const retriedAfterReconnect = data?.retried_after_reconnect ?? data?.retriedAfterReconnect;
  const reconnectReason = normalizeOutput(data?.reconnect_reason ?? data?.reconnectReason);
  const lastError = normalizeOutput(data?.last_error ?? data?.lastError);

  const lines = [
    title,
    status ? `status: ${status}` : '',
    sessionId ? `session_id: ${sessionId}` : '',
    hasRemoteIdentity ? 'remote: configured_ssh_server' : '',
    cwd ? `cwd: ${cwd}` : '',
    typeof sessionConnected !== 'undefined' ? `session_connected: ${String(!!sessionConnected)}` : '',
    typeof retriedAfterReconnect !== 'undefined'
      ? `retried_after_reconnect: ${String(!!retriedAfterReconnect)}`
      : '',
    reconnectReason ? `reconnect_reason: ${reconnectReason}` : '',
    lastError ? `last_error: ${lastError}` : '',
    typeof exitCode !== 'undefined' ? `exit_code: ${String(exitCode)}` : '',
    typeof timedOut !== 'undefined' ? `timed_out: ${String(!!timedOut)}` : '',
    typeof durationMs !== 'undefined' ? `duration_ms: ${String(durationMs)}` : '',
    stdout ? `\n[stdout]\n${stdout}` : '',
    stderr ? `\n[stderr]\n${stderr}` : '',
  ].filter(Boolean);

  return truncateOutput(lines.join('\n') || 'SSH 操作已完成，未返回输出。', maxOutputChars);
}

function normalizeOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || typeof value === 'undefined') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateOutput(output: string, maxOutputChars: number): string {
  if (output.length <= maxOutputChars) return output;
  const omitted = output.length - maxOutputChars;
  return `${output.slice(0, maxOutputChars)}\n\n[输出已截断，省略 ${omitted} 个字符]`;
}
