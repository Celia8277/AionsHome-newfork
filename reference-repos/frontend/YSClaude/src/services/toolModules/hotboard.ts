import { HotboardConfig } from '../../stores/settings';
import {
  DEFAULT_HOTBOARD_PLATFORM_TYPES,
  normalizeHotboardPlatformTypes,
} from '../../utils/hotboardPlatforms';
import { truncateText } from './shared';
import { ToolDefinition, ToolModule } from './types';

const HOTBOARD_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'get_hotboard',
    description:
      '获取当前中文互联网热搜榜。AI网页巡游模式必须先调用它，可用 types 指定平台，再从返回的榜单里挑选 1-3 个带链接的话题继续用 webview 查看。',
    parameters: {
      type: 'object',
      properties: {
        types: {
          type: 'string',
          description: '可选，逗号分隔的平台类型，例如 weibo,zhihu,bilibili,douyin。用户指定微博/知乎/B站/抖音时应映射为这些 type。',
        },
      },
      required: [],
    },
  },
};

const HOTBOARD_URL = 'https://uapis.cn/api/v1/misc/hotboard';
const HOTBOARD_TIMEOUT_MS = 15000;
const MAX_HOTBOARD_CHARS = 24000;

export const hotboardTool: ToolModule = {
  id: 'hotboard',
  labels: {
    get_hotboard: '查询热榜',
  },
  getDefinitions: (config) => (config.hotboard ? [HOTBOARD_TOOL] : []),
  execute: async (toolName, args, context) => {
    if (toolName !== 'get_hotboard') return undefined;
    return await executeHotboard(args.types, context.hotboardConfig);
  },
};

async function executeHotboard(rawTypes: unknown, config: HotboardConfig): Promise<string> {
  if (!config?.enabled) {
    throw new Error('热榜工具未启用，请先在 Tool 设置中打开 AI 网页巡游热榜');
  }
  if (!config.apiKey.trim()) {
    throw new Error('缺少 UAPI API Key，请先在 Tool 设置中填写');
  }

  const types = normalizeHotboardTypes(rawTypes, config.platforms);
  const results: string[] = [];

  for (const type of types) {
    results.push(await fetchHotboardType(type, config.apiKey.trim()));
  }

  return truncateText(
    [
      '已获取热搜榜。',
      '请根据用户偏好选择 1-3 个带 URL 的候选，再用 webview_open 查看链接内容。',
      '',
      results.join('\n\n'),
    ].join('\n'),
    MAX_HOTBOARD_CHARS
  );
}

async function fetchHotboardType(type: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HOTBOARD_TIMEOUT_MS);
  const url = `${HOTBOARD_URL}?type=${encodeURIComponent(type)}`;

  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
        Authorization: `Bearer ${apiKey}`,
        'User-Agent': 'YSClaude/1.0',
      },
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`hotboard ${type} 请求失败: HTTP ${resp.status}${text ? ` - ${text.slice(0, 200)}` : ''}`);
    }

    const text = await resp.text();
    const parsed = parseJsonSafely(text);
    return parsed === null ? `## ${type}\n${text}` : formatHotboardData(parsed, type);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeHotboardTypes(rawTypes: unknown, configuredPlatforms: string): string[] {
  const allowed = parseHotboardPlatformList(configuredPlatforms);
  const fallback = allowed.slice(0, 4);
  const alias: Record<string, string> = {
    微博: 'weibo',
    weibo: 'weibo',
    知乎: 'zhihu',
    zhihu: 'zhihu',
    b站: 'bilibili',
    B站: 'bilibili',
    哔哩哔哩: 'bilibili',
    bilibili: 'bilibili',
    抖音: 'douyin',
    douyin: 'douyin',
    快手: 'kuaishou',
    kuaishou: 'kuaishou',
    头条: 'toutiao',
    今日头条: 'toutiao',
    toutiao: 'toutiao',
    百度: 'baidu',
    baidu: 'baidu',
    豆瓣: 'douban',
    douban: 'douban',
    虎扑: 'hupu',
    hupu: 'hupu',
    掘金: 'juejin',
    juejin: 'juejin',
    csdn: 'csdn',
    v2ex: 'v2ex',
  };

  if (typeof rawTypes !== 'string' || !rawTypes.trim()) {
    return fallback;
  }

  const requested = rawTypes
    .split(/[,，\s/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => alias[item] || item.toLowerCase())
    .filter((item) => /^[a-z0-9_-]+$/.test(item));

  const types = Array.from(new Set(requested)).filter((type) => allowed.includes(type));
  return (types.length > 0 ? types : fallback).slice(0, 4);
}

function parseHotboardPlatformList(raw: string): string[] {
  const normalized = normalizeHotboardPlatformTypes(raw);
  return normalized.length > 0 ? normalized : DEFAULT_HOTBOARD_PLATFORM_TYPES;
}

function parseJsonSafely(text: string): any | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function formatHotboardData(data: any, fallbackPlatform = '聚合热榜'): string {
  const root = data?.data ?? data?.result ?? data;
  const sections: { platform: string; items: any[] }[] = root && typeof root === 'object' && Array.isArray(root.list)
    ? [{ platform: pickString(root, ['type', 'name', 'title', 'platform', 'source']) || fallbackPlatform, items: root.list }]
    : extractHotboardSections(data);
  if (sections.length === 0) {
    return `## ${fallbackPlatform}\n${JSON.stringify(data, null, 2)}`;
  }

  const lines: string[] = [];
  for (const section of sections) {
    lines.push(`## ${section.platform}`);
    section.items.slice(0, 30).forEach((item, index) => {
      const title = pickString(item, ['title', 'name', 'word', 'keyword', 'desc', 'query']) || `话题 ${index + 1}`;
      const url = pickString(item, ['url', 'link', 'href', 'mobileUrl', 'pcUrl', 'articleUrl']) || '';
      const hot = pickString(item, ['hot', 'hotValue', 'heat', 'score', 'num', 'views']) || '';
      const summary = pickString(item, ['summary', 'description', 'content']) || '';
      lines.push(
        [
          `${index + 1}. ${title}`,
          hot ? `热度: ${hot}` : '',
          url ? `URL: ${url}` : '',
          summary ? `摘要: ${summary}` : '',
        ].filter(Boolean).join('\n')
      );
    });
    lines.push('');
  }

  return lines.join('\n').trim();
}

function extractHotboardSections(data: any): { platform: string; items: any[] }[] {
  const root = data?.data ?? data?.result ?? data;

  if (Array.isArray(root)) {
    if (root.some((item) => Array.isArray(item?.data) || Array.isArray(item?.list) || Array.isArray(item?.items))) {
      return root.flatMap((section, index) => {
        const items = section?.data ?? section?.list ?? section?.items ?? [];
        return Array.isArray(items)
          ? [{
              platform: pickString(section, ['name', 'title', 'platform', 'type', 'source']) || `平台 ${index + 1}`,
              items,
            }]
          : [];
      });
    }
    return [{ platform: '聚合热榜', items: root }];
  }

  if (root && typeof root === 'object') {
    const sections: { platform: string; items: any[] }[] = [];
    for (const [key, value] of Object.entries(root)) {
      if (Array.isArray(value)) {
        sections.push({ platform: key, items: value });
      } else if (value && typeof value === 'object') {
        const items = (value as any).data ?? (value as any).list ?? (value as any).items;
        if (Array.isArray(items)) {
          sections.push({
            platform: pickString(value, ['name', 'title', 'platform', 'type', 'source']) || key,
            items,
          });
        }
      }
    }
    return sections;
  }

  return [];
}

function pickString(obj: any, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}
