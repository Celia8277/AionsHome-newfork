import {
  createConversationArtifactFromContent,
  deleteConversationArtifactFile,
  formatArtifactToken,
  listConversationArtifacts,
  patchArtifactText,
  readConversationArtifact,
  replaceConversationArtifactContent,
  inferArtifactKind,
} from '../conversationArtifacts';
import { truncateText } from './shared';
import { ToolDefinition, ToolModule } from './types';

const ARTIFACT_LIST_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_list',
    description: '列出当前对话窗口绑定的可编辑文本文件。只能看到当前对话的文件。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
};

const ARTIFACT_READ_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_read',
    description: '读取当前对话窗口中某个文件的当前版本内容。不能读取其他对话的文件。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: '文件 ID，来自 artifact_list 或聊天文件卡片' },
      },
      required: ['artifactId'],
    },
  },
};

export const LEGACY_ARTIFACT_CREATE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_create',
    description: '在当前对话窗口创建一个新的可编辑文本文件，并自动绑定到当前对话。只负责创建文件，不会自动显示文件卡片；需要显示时调用 artifact_show_card。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '文件名，例如 index.html、notes.md、data.json' },
        mimeType: { type: 'string', description: '可选 MIME 类型，例如 text/html 或 application/json' },
        content: { type: 'string', description: '文件完整内容' },
      },
      required: ['name', 'content'],
    },
  },
};

export const LEGACY_ARTIFACT_REPLACE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_replace',
    description: '整体替换当前对话文件的内容，保存为一个新版本。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: '文件 ID' },
        content: { type: 'string', description: '新的完整文件内容' },
      },
      required: ['artifactId', 'content'],
    },
  },
};

export const LEGACY_ARTIFACT_PATCH_TEXT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_patch_text',
    description: '在当前对话文件中按文本查找替换，保存为一个新版本。适合小改动。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: '文件 ID' },
        find: { type: 'string', description: '要查找的原文本' },
        replace: { type: 'string', description: '替换后的文本' },
        all: { type: 'boolean', description: '是否替换全部匹配。默认 false，只替换第一处' },
      },
      required: ['artifactId', 'find', 'replace'],
    },
  },
};

const ARTIFACT_WRITE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_write',
    description: '创建或修改当前对话文件。action=create 时传 name、content 和可选 mimeType；action=replace 时传 artifactId、content；action=patch 时传 artifactId、find、replace 和可选 all。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'replace', 'patch'], description: '写入方式' },
        artifactId: { type: 'string', description: 'replace/patch 时的文件 ID' },
        name: { type: 'string', description: 'create 时的文件名' },
        mimeType: { type: 'string', description: 'create 时可选的 MIME 类型' },
        content: { type: 'string', description: 'create/replace 时的完整内容' },
        find: { type: 'string', description: 'patch 时要查找的原文本' },
        replace: { type: 'string', description: 'patch 时的替换文本' },
        all: { type: 'boolean', description: 'patch 时是否替换全部匹配，默认 false' },
      },
      required: ['action'],
    },
  },
};

const ARTIFACT_DELETE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_delete',
    description: '删除当前对话窗口中绑定的文件及其所有版本。只能删除当前对话的文件。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: '要删除的文件 ID' },
      },
      required: ['artifactId'],
    },
  },
};

const ARTIFACT_SHOW_CARD_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'artifact_show_card',
    description: '把当前对话中的某个文件以卡片形式显示到当前 AI 回复中。只显示卡片，不读取或修改文件内容。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: '要显示成卡片的文件 ID' },
      },
      required: ['artifactId'],
    },
  },
};

const ARTIFACT_TOOLS = [
  ARTIFACT_LIST_TOOL,
  ARTIFACT_READ_TOOL,
  ARTIFACT_WRITE_TOOL,
  ARTIFACT_DELETE_TOOL,
  ARTIFACT_SHOW_CARD_TOOL,
];

export const conversationArtifactsTool: ToolModule = {
  id: 'conversation-artifacts',
  labels: {
    artifact_list: '列出文件',
    artifact_read: '读取文件',
    artifact_write: '写入文件',
    artifact_delete: '删除文件',
    artifact_show_card: '显示文件卡片',
  },
  getDefinitions: (config) => (config.conversationArtifacts ? ARTIFACT_TOOLS : []),
  execute: async (toolName, args, context) => {
    switch (toolName) {
      case 'artifact_list':
        return await executeArtifactList(context.conversationId);
      case 'artifact_read':
        return await executeArtifactRead(context.conversationId, args.artifactId);
      case 'artifact_write':
        if (args.action === 'create') {
          return await executeArtifactCreate(context.conversationId, args.name, args.mimeType, args.content);
        }
        if (args.action === 'replace') {
          return await executeArtifactReplace(context.conversationId, args.artifactId, args.content);
        }
        if (args.action === 'patch') {
          return await executeArtifactPatchText(context.conversationId, args);
        }
        throw new Error('action 必须是 create、replace 或 patch');
      case 'artifact_delete':
        return await executeArtifactDelete(context.conversationId, args.artifactId);
      case 'artifact_show_card':
        return await executeArtifactShowCard(context.conversationId, args.artifactId);
      default:
        return undefined;
    }
  },
};

function requireConversationId(conversationId?: string): string {
  if (!conversationId) throw new Error('当前没有可绑定文件的对话窗口');
  return conversationId;
}

async function executeArtifactList(conversationId?: string): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  const artifacts = await listConversationArtifacts(scopedConversationId);
  if (artifacts.length === 0) return '当前对话还没有文件。';
  return [
    '当前对话文件:',
    ...artifacts.map((artifact) =>
      `- ${artifact.name} id=${artifact.id} kind=${artifact.kind} size=${artifact.size} updated=${new Date(artifact.updatedAt).toLocaleString()}`
    ),
  ].join('\n');
}

async function executeArtifactRead(conversationId: string | undefined, rawArtifactId: unknown): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  const artifactId = normalizeArtifactId(rawArtifactId);
  const { artifact, version } = await readConversationArtifact(scopedConversationId, artifactId);
  return [
    `文件: ${artifact.name}`,
    `ID: ${artifact.id}`,
    `类型: ${artifact.kind} / ${artifact.mimeType}`,
    `版本: ${version.version}`,
    '',
    truncateText(version.content, 12000),
  ].join('\n');
}

async function executeArtifactCreate(
  conversationId: string | undefined,
  rawName: unknown,
  rawMimeType: unknown,
  rawContent: unknown
): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  if (typeof rawName !== 'string' || !rawName.trim()) throw new Error('缺少文件名');
  if (typeof rawContent !== 'string') throw new Error('缺少文件内容');
  const mimeType = typeof rawMimeType === 'string' && rawMimeType.trim() ? rawMimeType.trim() : undefined;
  const artifact = await createConversationArtifactFromContent({
    conversationId: scopedConversationId,
    name: rawName.trim(),
    mimeType,
    kind: inferArtifactKind(rawName.trim(), mimeType),
    content: rawContent,
    createdBy: 'assistant',
  });
  return [
    `已创建当前对话文件：${artifact.name}`,
    `id=${artifact.id}`,
    `kind=${artifact.kind}`,
    `size=${artifact.size}`,
    '如果需要在对话中显示文件卡片，请调用 artifact_show_card。',
  ].join('\n');
}

async function executeArtifactReplace(
  conversationId: string | undefined,
  rawArtifactId: unknown,
  rawContent: unknown
): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  const artifactId = normalizeArtifactId(rawArtifactId);
  if (typeof rawContent !== 'string') throw new Error('缺少新的文件内容');
  const version = await replaceConversationArtifactContent({
    conversationId: scopedConversationId,
    artifactId,
    content: rawContent,
    createdBy: 'assistant',
  });
  return `已保存文件新版本：id=${artifactId}, version=${version.version}, size=${version.size}`;
}

async function executeArtifactPatchText(conversationId: string | undefined, args: Record<string, any>): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  const artifactId = normalizeArtifactId(args.artifactId);
  if (typeof args.find !== 'string') throw new Error('缺少要查找的文本');
  if (typeof args.replace !== 'string') throw new Error('缺少替换文本');
  const { version: current } = await readConversationArtifact(scopedConversationId, artifactId);
  const nextContent = patchArtifactText(current.content, args.find, args.replace, args.all === true);
  const version = await replaceConversationArtifactContent({
    conversationId: scopedConversationId,
    artifactId,
    content: nextContent,
    createdBy: 'assistant',
  });
  return `已修改文件并保存新版本：id=${artifactId}, version=${version.version}, size=${version.size}`;
}

async function executeArtifactDelete(conversationId: string | undefined, rawArtifactId: unknown): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  const artifactId = normalizeArtifactId(rawArtifactId);
  const artifact = await deleteConversationArtifactFile(scopedConversationId, artifactId);
  return `已删除当前对话文件：${artifact.name} id=${artifact.id}`;
}

async function executeArtifactShowCard(conversationId: string | undefined, rawArtifactId: unknown): Promise<string> {
  const scopedConversationId = requireConversationId(conversationId);
  const artifactId = normalizeArtifactId(rawArtifactId);
  const { artifact } = await readConversationArtifact(scopedConversationId, artifactId);
  return [
    `已准备显示当前对话文件卡片：${formatArtifactToken(artifact.id)} ${artifact.name}`,
    `id=${artifact.id}`,
    `kind=${artifact.kind}`,
    `size=${artifact.size}`,
  ].join('\n');
}

function normalizeArtifactId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('缺少有效文件 ID');
  return raw.trim();
}
