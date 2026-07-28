import { WebInteractionConfig } from '../../stores/settings';
import { readConversationArtifact } from '../conversationArtifacts';
import {
  clickWebViewElement,
  clickWebViewSelector,
  evalWebViewJs,
  getHtmlArtifactSource,
  patchHtmlArtifactElement,
  observeWebView,
  openHtmlArtifact,
  openWebView,
  replaceHtmlArtifactSource,
  saveHtmlArtifact,
  screenshotWebView,
  tapWebView,
  waitWebView,
} from '../webviewController';
import { normalizeWhitespace, truncateText, validateWebPageUrl } from './shared';
import { ToolDefinition, ToolExecutionResult, ToolModule } from './types';

const WEBVIEW_OPEN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'webview_open',
    description:
      '在用户端打开一个可见 WebView 网页面板，并返回打开后的页面观察结果。',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: '要打开的网页 URL，必须是 http 或 https 链接',
        },
        userAgent: {
          type: 'string',
          enum: ['mobile', 'desktop'],
          description:
            '打开网页时使用的 UA。mobile 使用默认移动端 UA；desktop 使用桌面端 UA。遇到移动端内容不完整、引导下载 App 或需要查看完整网页内容时优先选择 desktop。',
        },
      },
      required: ['url'],
    },
  },
};

const WEBVIEW_EVAL_JS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'webview_eval_js',
    description: '在当前 WebView 网页中执行 JavaScript，并返回执行结果。',
    parameters: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: '要执行的 JavaScript 代码',
        },
      },
      required: ['script'],
    },
  },
};

const WEBVIEW_SCREENSHOT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'webview_screenshot',
    description:
      '截取当前用户端 WebView 可见区域，并把截图作为图片返回给 AI 查看。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_GET_SOURCE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_get_source',
    description:
      '读取当前聊天 HTML artifact 的完整 HTML 源码。用于准备修改、检查当前 DOM，或在保存前确认内容。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const HTML_ARTIFACT_OPEN_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_open',
    description:
      '打开当前对话中的 HTML 文件到用户端 HTML 预览面板，并返回页面观察结果。只能打开当前对话绑定的 HTML 文件。',
    parameters: {
      type: 'object',
      properties: {
        artifactId: { type: 'string', description: 'HTML 文件 ID，来自 artifact_list 或文件卡片' },
      },
      required: ['artifactId'],
    },
  },
};

const HTML_ARTIFACT_OBSERVE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_observe',
    description:
      '观察当前打开的 HTML 预览，读取可见文本、可交互元素、坐标和 selector。适合了解用户交互后的页面状态。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_CLICK_ELEMENT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_click_element',
    description: '点击当前 HTML 预览中 html_artifact_observe 返回的元素 index。',
    parameters: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'html_artifact_observe 返回的可交互元素 index' },
      },
      required: ['index'],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_CLICK_SELECTOR_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_click_selector',
    description: '按 CSS selector 点击当前 HTML 预览中的元素。',
    parameters: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: '目标 CSS selector，例如 #start 或 .cell:nth-of-type(1)' },
      },
      required: ['selector'],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_TAP_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_tap',
    description: '按坐标点击当前 HTML 预览。适合 canvas 游戏等 observe 无法给出具体元素的场景。',
    parameters: {
      type: 'object',
      properties: {
        x: { type: 'number', description: '预览视口内 x 坐标' },
        y: { type: 'number', description: '预览视口内 y 坐标' },
      },
      required: ['x', 'y'],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_WAIT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_wait',
    description: '等待当前 HTML 预览运行一段时间，然后返回最新观察结果。',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: '等待毫秒数，200 到 10000' },
      },
      required: ['ms'],
    },
  },
};

const HTML_ARTIFACT_SCREENSHOT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_screenshot',
    description:
      '截取当前 HTML 预览可见区域并作为图片返回。适合 canvas、小游戏画面或视觉布局检查。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_REPLACE_SOURCE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_replace_source',
    description:
      '整体替换当前聊天 HTML artifact 的源码，并返回更新后的页面观察结果。只修改当前预览，保存到对话文件或聊天消息需继续调用 html_artifact_save。',
    parameters: {
      type: 'object',
      properties: {
        html: {
          type: 'string',
          description: '新的完整 HTML，或可被包装进 body 的 HTML 片段',
        },
      },
      required: ['html'],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_PATCH_ELEMENT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_patch_element',
    description:
      '按 CSS selector 修改当前 HTML artifact 中的单个 DOM 元素，可改文字、innerHTML、style 或 attributes，并返回更新后的观察结果。保存到对话文件或聊天消息需继续调用 html_artifact_save。',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: '目标 CSS selector，例如 #title 或 .card:nth-of-type(1)',
        },
        text: {
          type: 'string',
          description: '可选：替换元素 textContent',
        },
        html: {
          type: 'string',
          description: '可选：替换元素 innerHTML',
        },
        style: {
          type: 'object',
          description: '可选：要设置的 CSS style 键值，null/空字符串表示移除该属性',
        },
        attributes: {
          type: 'object',
          description: '可选：要设置的 HTML attribute 键值，null/false 表示移除该属性',
        },
      },
      required: ['selector'],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_SAVE_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_save',
    description:
      '把当前 HTML artifact 的源码保存回它所属的对话文件或聊天消息 HTML 代码块。仅当用户希望保留修改时调用。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

const HTML_ARTIFACT_INTERACT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_interact',
    description: '与当前 HTML 预览交互。可按观察结果中的元素 index、CSS selector 或坐标点击，也可等待页面更新；每次操作后返回最新观察结果。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['click_index', 'click_selector', 'tap', 'wait'] },
        index: { type: 'number', description: 'click_index 使用的元素 index' },
        selector: { type: 'string', description: 'click_selector 使用的 CSS selector' },
        x: { type: 'number', description: 'tap 使用的 x 坐标' },
        y: { type: 'number', description: 'tap 使用的 y 坐标' },
        ms: { type: 'number', description: 'wait 使用的毫秒数，200 到 10000' },
      },
      required: ['action'],
    },
  },
};

export const LEGACY_HTML_ARTIFACT_EDIT_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'html_artifact_edit',
    description: '修改当前 HTML 预览。action=replace_source 时传完整 html；action=patch_element 时传 selector，并可传 text、html、style 或 attributes。修改后需调用 html_artifact_save 才会永久保存。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['replace_source', 'patch_element'] },
        selector: { type: 'string', description: 'patch_element 的 CSS selector' },
        text: { type: 'string', description: '替换元素 textContent' },
        html: { type: 'string', description: 'replace_source 的完整源码，或 patch_element 的 innerHTML' },
        style: { type: 'object', description: '要设置的 CSS style 键值' },
        attributes: { type: 'object', description: '要设置的 HTML attribute 键值' },
      },
      required: ['action'],
    },
  },
};

const WEBVIEW_TOOLS = [
  WEBVIEW_OPEN_TOOL,
  WEBVIEW_EVAL_JS_TOOL,
  WEBVIEW_SCREENSHOT_TOOL,
];

const HTML_ARTIFACT_TOOLS = [
  HTML_ARTIFACT_OPEN_TOOL,
  HTML_ARTIFACT_OBSERVE_TOOL,
  HTML_ARTIFACT_INTERACT_TOOL,
  HTML_ARTIFACT_SCREENSHOT_TOOL,
];

export const webViewTool: ToolModule = {
  id: 'web-view',
  labels: {
    webview_open: '打开网页',
    webview_eval_js: '执行网页 JS',
    webview_screenshot: '网页截图',
    html_artifact_open: '打开 HTML',
    html_artifact_observe: '观察 HTML',
    html_artifact_interact: '操作 HTML',
    html_artifact_screenshot: 'HTML 截图',
  },
  getDefinitions: (config) => [
    ...(config.webInteraction ? WEBVIEW_TOOLS : []),
    ...(config.htmlArtifacts ? HTML_ARTIFACT_TOOLS : []),
  ],
  execute: async (toolName, args, context) => {
    switch (toolName) {
      case 'webview_open':
        return await executeWebViewOpen(
          args.url,
          args.userAgent,
          context.webInteractionConfig,
          !!context.webCruiseEnabled
        );
      case 'webview_eval_js':
        return await executeWebViewEvalJs(args.script, context.webInteractionConfig);
      case 'webview_screenshot':
        return await executeWebViewScreenshot(context.webInteractionConfig);
      case 'html_artifact_open':
        return await executeHtmlArtifactOpen(context.conversationId, args.artifactId, context.htmlArtifactToolConfig);
      case 'html_artifact_observe':
        return await executeHtmlArtifactObserve(context.htmlArtifactToolConfig);
      case 'html_artifact_interact':
        if (args.action === 'click_index') return await executeHtmlArtifactClickElement(args.index, context.htmlArtifactToolConfig);
        if (args.action === 'click_selector') return await executeHtmlArtifactClickSelector(args.selector, context.htmlArtifactToolConfig);
        if (args.action === 'tap') return await executeHtmlArtifactTap(args.x, args.y, context.htmlArtifactToolConfig);
        if (args.action === 'wait') return await executeHtmlArtifactWait(args.ms, context.htmlArtifactToolConfig);
        throw new Error('action 必须是 click_index、click_selector、tap 或 wait');
      case 'html_artifact_screenshot':
        return await executeHtmlArtifactScreenshot(context.htmlArtifactToolConfig);
      default:
        return undefined;
    }
  },
};

async function executeWebViewOpen(
  rawUrl: unknown,
  rawUserAgent: unknown,
  config: WebInteractionConfig,
  defaultDesktopUserAgent = false
): Promise<string> {
  ensureWebInteractionEnabled(config);
  const url = validateWebPageUrl(rawUrl);
  const userAgent = normalizeWebViewUserAgent(rawUserAgent, defaultDesktopUserAgent);
  const observation = await openWebView(
    url,
    userAgent === 'desktop' ? { userAgent: 'desktop' } : { userAgent: 'mobile' }
  );
  return [
    `已在用户端打开网页：${observation.url || url}`,
    `UA: ${userAgent === 'desktop' ? '桌面端' : '移动端'}`,
    '',
    formatWebViewObservation(observation),
    '',
    '如果用户要求继续操作，请继续调用 webview_eval_js 操作或读取页面。',
  ].join('\n');
}

async function executeWebViewEvalJs(
  rawScript: unknown,
  config: WebInteractionConfig
): Promise<string> {
  ensureWebInteractionEnabled(config);
  if (typeof rawScript !== 'string' || !rawScript.trim()) {
    throw new Error('缺少有效的 JavaScript 代码');
  }
  const result = await evalWebViewJs(rawScript);
  const lines = [
    '已执行 WebView JavaScript。',
    `网页标题: ${result.title || '无标题'}`,
    `URL: ${result.url}`,
    `结果类型: ${result.resultType}`,
    '',
    '执行结果:',
    formatEvalJsResult(result.result),
  ];
  return lines.join('\n');
}

async function executeWebViewScreenshot(config: WebInteractionConfig): Promise<ToolExecutionResult> {
  ensureWebInteractionEnabled(config);
  const screenshot = await screenshotWebView();
  const text = [
    '已截取当前 WebView 可见区域截图，并作为图片附在本轮工具结果后。',
    `网页标题: ${screenshot.title || '无标题'}`,
    `URL: ${screenshot.url}`,
    `截图区域: ${screenshot.viewport.width} x ${screenshot.viewport.height}`,
  ].join('\n');

  return {
    type: 'image',
    text,
    displayContent: text,
    dataUrl: screenshot.dataUrl,
  };
}

async function executeHtmlArtifactOpen(
  conversationId: string | undefined,
  rawArtifactId: unknown,
  config: { enabled?: boolean }
): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  const scopedConversationId = requireConversationId(conversationId);
  const artifactId = normalizeArtifactId(rawArtifactId);
  const { artifact, version } = await readConversationArtifact(scopedConversationId, artifactId);
  if (artifact.kind !== 'html') {
    throw new Error('只能用 HTML 预览工具打开 HTML 文件');
  }
  const observation = await openHtmlArtifact({
    artifactId: artifact.id,
    artifactName: artifact.name,
    html: version.content,
    title: artifact.name,
  });
  return [
    `已打开当前对话 HTML 文件：${artifact.name} id=${artifact.id}`,
    '',
    formatWebViewObservation(observation),
  ].join('\n');
}

async function executeHtmlArtifactObserve(config: { enabled?: boolean }): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  await ensureHtmlArtifactOpen();
  const observation = await observeWebView();
  return formatWebViewObservation(observation);
}

async function executeHtmlArtifactClickElement(
  rawIndex: unknown,
  config: { enabled?: boolean }
): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  await ensureHtmlArtifactOpen();
  const index = normalizeElementIndex(rawIndex);
  const result = await clickWebViewElement(index);
  return formatWebViewClickResult(result, `已点击 HTML 元素 ${index}`);
}

async function executeHtmlArtifactClickSelector(
  rawSelector: unknown,
  config: { enabled?: boolean }
): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  await ensureHtmlArtifactOpen();
  if (typeof rawSelector !== 'string' || !rawSelector.trim()) {
    throw new Error('缺少有效的 CSS selector');
  }
  const selector = rawSelector.trim();
  const result = await clickWebViewSelector(selector);
  return formatWebViewClickResult(result, `已点击 HTML 选择器 ${selector}`);
}

async function executeHtmlArtifactTap(
  rawX: unknown,
  rawY: unknown,
  config: { enabled?: boolean }
): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  await ensureHtmlArtifactOpen();
  const x = normalizeCoordinate(rawX, 'x');
  const y = normalizeCoordinate(rawY, 'y');
  const result = await tapWebView(x, y);
  return [
    `已点击 HTML 坐标 (${Math.round(result.x)}, ${Math.round(result.y)})`,
    `目标: ${result.target || '未知元素'}`,
    result.text ? `文本: ${result.text}` : '',
    '请调用 html_artifact_observe 或 html_artifact_wait 查看页面变化。',
  ].filter(Boolean).join('\n');
}

async function executeHtmlArtifactWait(rawMs: unknown, config: { enabled?: boolean }): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  await ensureHtmlArtifactOpen();
  const ms = normalizeWaitMs(rawMs);
  const observation = await waitWebView(ms);
  return formatWebViewObservation(observation);
}

async function executeHtmlArtifactScreenshot(config: { enabled?: boolean }): Promise<ToolExecutionResult> {
  ensureHtmlArtifactToolsEnabled(config);
  await ensureHtmlArtifactOpen();
  const screenshot = await screenshotWebView();
  const text = [
    '已截取当前 HTML 预览可见区域截图，并作为图片附在本轮工具结果后。',
    `标题: ${screenshot.title || '无标题'}`,
    `截图区域: ${screenshot.viewport.width} x ${screenshot.viewport.height}`,
    '请结合截图和 html_artifact_observe 的 DOM 信息继续判断；如果需要操作 canvas，可用 html_artifact_tap。',
  ].join('\n');
  return {
    type: 'image',
    text,
    displayContent: text,
    dataUrl: screenshot.dataUrl,
  };
}

export async function executeHtmlArtifactGetSource(config: { enabled?: boolean }): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  const source = await getHtmlArtifactSource();
  const target = source.info.artifactId
    ? `artifact=${source.info.artifactId}${source.info.artifactName ? ` (${source.info.artifactName})` : ''}`
    : `message=${source.info.messageId}, block=${(source.info.htmlBlockIndex ?? 0) + 1}`;
  return [
    `当前 HTML artifact: ${target}, dirty=${source.info.dirty ? 'yes' : 'no'}`,
    '',
    'HTML 源码:',
    truncateText(source.html, 8000),
  ].join('\n');
}

export async function executeHtmlArtifactReplaceSource(rawHtml: unknown, config: { enabled?: boolean }): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
    throw new Error('缺少有效 HTML');
  }
  const observation = await replaceHtmlArtifactSource(rawHtml);
  return [
    '已替换当前 HTML artifact 源码（尚未保存）。',
    '',
    formatWebViewObservation(observation),
    '',
    '如果用户希望保留修改，请调用 html_artifact_save。',
  ].join('\n');
}

export async function executeHtmlArtifactPatchElement(
  args: Record<string, any>,
  config: { enabled?: boolean }
): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  if (typeof args.selector !== 'string' || !args.selector.trim()) {
    throw new Error('缺少有效 selector');
  }
  const observation = await patchHtmlArtifactElement(args.selector, {
    text: typeof args.text === 'string' ? args.text : undefined,
    html: typeof args.html === 'string' ? args.html : undefined,
    style: isPlainObject(args.style) ? args.style : undefined,
    attributes: isPlainObject(args.attributes) ? args.attributes : undefined,
  });
  return [
    `已修改 HTML 元素：${args.selector}`,
    '',
    formatWebViewObservation(observation),
    '',
    '修改暂存在预览中；如果用户希望保留，请调用 html_artifact_save。',
  ].join('\n');
}

export async function executeHtmlArtifactSave(config: { enabled?: boolean }): Promise<string> {
  ensureHtmlArtifactToolsEnabled(config);
  const result = await saveHtmlArtifact();
  if (result.artifactId) {
    return `已保存 HTML artifact 到当前对话文件 ${result.artifactId}。`;
  }
  const blockIndex = typeof result.htmlBlockIndex === 'number' ? result.htmlBlockIndex + 1 : '?';
  return `已保存 HTML artifact 到聊天消息 ${result.messageId || '未知'} 的第 ${blockIndex} 个 HTML 代码块。`;
}

function ensureWebInteractionEnabled(config: WebInteractionConfig): void {
  if (!config?.enabled) {
    throw new Error('网页交互未启用，请先在「Tool 设置」中打开');
  }
}

function ensureHtmlArtifactToolsEnabled(config: { enabled?: boolean }): void {
  if (!config?.enabled) {
    throw new Error('HTML Artifact 工具未启用，请先在「Tool 设置」中打开');
  }
}

async function ensureHtmlArtifactOpen(): Promise<void> {
  await getHtmlArtifactSource();
}

function requireConversationId(conversationId?: string): string {
  if (!conversationId) throw new Error('当前没有可访问 HTML 文件的对话窗口');
  return conversationId;
}

function normalizeArtifactId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('缺少有效文件 ID');
  return raw.trim();
}

function normalizeCoordinate(raw: unknown, name: string): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`缺少有效的 ${name} 坐标`);
  }
  return value;
}

function normalizeWaitMs(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : 1000;
  if (!Number.isFinite(value)) return 1000;
  return Math.min(Math.max(Math.floor(value), 200), 10000);
}

function normalizeWebViewUserAgent(raw: unknown, defaultDesktopUserAgent: boolean): 'mobile' | 'desktop' {
  if (raw === undefined || raw === null || raw === '') {
    return defaultDesktopUserAgent ? 'desktop' : 'mobile';
  }
  if (typeof raw !== 'string') {
    throw new Error('缺少有效的 UA 类型，请使用 mobile 或 desktop');
  }
  const value = raw.trim().toLowerCase();
  if (value === 'mobile') return 'mobile';
  if (value === 'desktop') return 'desktop';
  throw new Error('UA 类型只支持 mobile 或 desktop');
}

function normalizeElementIndex(raw: unknown): number {
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('缺少有效的元素 index');
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function formatEvalJsResult(result: unknown): string {
  if (typeof result === 'string') {
    return truncateText(result, 8000);
  }
  if (result === undefined) {
    return 'undefined';
  }
  try {
    return truncateText(JSON.stringify(result, null, 2), 8000);
  } catch {
    return truncateText(String(result), 8000);
  }
}

function formatWebViewClickResult(result: Awaited<ReturnType<typeof clickWebViewElement>>, title: string): string {
  return [
    title,
    `坐标: (${Math.round(result.x)}, ${Math.round(result.y)})`,
    `目标: ${result.target || '未知元素'}`,
    result.selector ? `Selector: ${result.selector}` : '',
    result.text ? `文本: ${result.text}` : '',
    '请继续观察或等待页面变化。',
  ].filter(Boolean).join('\n');
}

export function formatWebViewObservation(observation: Awaited<ReturnType<typeof observeWebView>>): string {
  const lines = [
    `网页标题: ${observation.title || '无标题'}`,
    `URL: ${observation.url}`,
    `视口: ${observation.viewport.width} x ${observation.viewport.height}`,
  ];

  const text = normalizeWhitespace(observation.text || '');
  if (text) {
    lines.push('', `可见文本:\n${truncateText(text, 4000)}`);
  }

  if (observation.elements.length > 0) {
    lines.push('', '可交互元素:');
    for (const el of observation.elements.slice(0, 20)) {
      const label = el.text || el.role || el.tag || '元素';
      lines.push(
        `${el.index}. ${label} [${el.tag}] selector=${el.selector || '无'} x=${el.x}, y=${el.y}, w=${el.width}, h=${el.height}`
      );
    }
  }

  lines.push('\n如需继续操作页面，请调用对应的 WebView 或 HTML 工具。');
  return lines.join('\n');
}
