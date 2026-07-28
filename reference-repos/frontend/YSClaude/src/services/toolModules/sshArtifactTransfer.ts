import {
  createConversationArtifactFromContent,
  inferArtifactKind,
  readConversationArtifact,
  replaceConversationArtifactContent,
} from '../conversationArtifacts';
import type { RunCommandConfig } from '../../stores/settings';
import { sshDownloadTextFileResult, sshUploadTextFileResult } from './runCommand';
import { ToolDefinition, ToolModule } from './types';

// 与 conversationArtifacts.ts 中 MAX_TEXT_FILE_BYTES 对齐
const MAX_ARTIFACT_BYTES = 512 * 1024;

const ARTIFACT_UPLOAD_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_upload_to_server',
    description:
      '把当前对话中的某个文件（artifact）通过 SSH 上传写入远程服务器指定路径。内容在工具内部直接传输，不经过模型上下文；需要 SSH 服务器已在 Tool 设置中配置。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: '要上传的文件 ID，来自 artifact_list 或聊天文件卡片' },
        remote_path: {
          type: 'string',
          description: '远程目标文件路径。相对路径会基于当前 SSH 工作目录解析；父目录会自动创建。',
        },
        mode: {
          type: 'string',
          enum: ['overwrite', 'append'],
          description: '写入模式。overwrite 覆盖文件；append 追加到文件末尾。默认 overwrite。',
        },
      },
      required: ['artifactId', 'remote_path'],
    },
  },
};

const ARTIFACT_DOWNLOAD_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_download_from_server',
    description:
      '把远程服务器上的文本文件通过 SSH 拉取保存为当前对话的文件（artifact）。内容在工具内部直接传输，不经过模型上下文。只支持 512KB 以内的 UTF-8 文本文件。默认新建文件；传 artifactId 时覆盖已有文件并保存为新版本。',
    parameters: {
      type: 'object',
      properties: {
        remote_path: {
          type: 'string',
          description: '远程源文件路径。相对路径会基于当前 SSH 工作目录解析。',
        },
        name: {
          type: 'string',
          description: '可选，保存到对话中的文件名。不填时取远程路径的文件名。',
        },
        artifactId: {
          type: 'string',
          description: '可选，已有文件 ID。填写时把远程内容保存为该文件的新版本，而不是新建文件。',
        },
      },
      required: ['remote_path'],
    },
  },
};

export const sshArtifactTransferTool: ToolModule = {
  id: 'ssh-artifact-transfer',
  labels: {
    artifact_upload_to_server: '文件上传服务器',
    artifact_download_from_server: '文件拉取到对话',
  },
  // 远程命令 + 对话文件同时启用时自动激活
  getDefinitions: (config) =>
    config.runCommand?.enabled && config.conversationArtifacts
      ? [ARTIFACT_UPLOAD_TOOL, ARTIFACT_DOWNLOAD_TOOL]
      : [],
  execute: async (toolName, args, context) => {
    if (toolName === 'artifact_upload_to_server') {
      return await executeArtifactUpload(args, context.conversationId, context.runCommandConfig);
    }
    if (toolName === 'artifact_download_from_server') {
      return await executeArtifactDownload(args, context.conversationId, context.runCommandConfig);
    }
    return undefined;
  },
};

function requireConversationId(conversationId?: string): string {
  if (!conversationId) throw new Error('当前没有可绑定文件的对话窗口');
  return conversationId;
}

function normalizeArtifactId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('缺少有效文件 ID');
  return raw.trim();
}

function fileNameFromRemotePath(remotePath: string): string {
  const normalized = remotePath.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || 'downloaded.txt';
}

async function executeArtifactUpload(
  args: Record<string, any>,
  conversationId: string | undefined,
  runCommandConfig: RunCommandConfig
): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  const artifactId = normalizeArtifactId(args?.artifactId);
  const remotePath = String(args?.remote_path || '').trim();
  if (!remotePath) throw new Error('remote_path 不能为空');
  const mode = String(args?.mode || 'overwrite') === 'append' ? 'append' : 'overwrite';

  const { artifact, version } = await readConversationArtifact(scopedConversationId, artifactId);
  const result = await sshUploadTextFileResult(runCommandConfig, remotePath, version.content, mode);
  if (!result.ok) return result.message;

  return [
    '文件已上传到服务器：',
    `artifact: ${artifact.name} (id=${artifact.id}, version=${version.version})`,
    `remote_path: ${remotePath}`,
    `mode: ${mode}`,
    `content_chars: ${result.contentChars}`,
    'status: ok',
  ].join('\n');
}

async function executeArtifactDownload(
  args: Record<string, any>,
  conversationId: string | undefined,
  runCommandConfig: RunCommandConfig
): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  const remotePath = String(args?.remote_path || '').trim();
  if (!remotePath) throw new Error('remote_path 不能为空');

  const result = await sshDownloadTextFileResult(runCommandConfig, remotePath, MAX_ARTIFACT_BYTES);
  if (!result.ok) return result.message;

  const rawArtifactId = typeof args?.artifactId === 'string' ? args.artifactId.trim() : '';
  if (rawArtifactId) {
    const { artifact } = await readConversationArtifact(scopedConversationId, rawArtifactId);
    const version = await replaceConversationArtifactContent({
      conversationId: scopedConversationId,
      artifactId: artifact.id,
      content: result.content,
      createdBy: 'assistant',
    });
    return [
      '已从服务器拉取并更新对话文件：',
      `artifact: ${artifact.name} (id=${artifact.id}, version=${version.version})`,
      `remote_path: ${remotePath}`,
      `size_bytes: ${result.sizeBytes}`,
      'status: ok',
    ].join('\n');
  }

  const name = typeof args?.name === 'string' && args.name.trim() ? args.name.trim() : fileNameFromRemotePath(remotePath);
  const artifact = await createConversationArtifactFromContent({
    conversationId: scopedConversationId,
    name,
    kind: inferArtifactKind(name),
    content: result.content,
    createdBy: 'assistant',
  });
  return [
    '已从服务器拉取并创建对话文件：',
    `artifact: ${artifact.name} (id=${artifact.id})`,
    `remote_path: ${remotePath}`,
    `size_bytes: ${result.sizeBytes}`,
    '如果需要在对话中显示文件卡片，请调用 artifact_show_card。',
    'status: ok',
  ].join('\n');
}
