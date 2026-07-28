import { WebSearchConfig } from '../../stores/settings';
import { ToolDefinition, ToolModule } from './types';

const WEB_SEARCH_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      '搜索互联网获取最新信息。当用户询问新闻、实时信息、或你不确定的事实时使用。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索查询词',
        },
      },
      required: ['query'],
    },
  },
};

export const webSearchTool: ToolModule = {
  id: 'web-search',
  labels: {
    web_search: '联网搜索',
  },
  getDefinitions: (config) => (config.webSearch ? [WEB_SEARCH_TOOL] : []),
  execute: async (toolName, args, context) => {
    if (toolName !== 'web_search') return undefined;
    return await executeWebSearch(args.query, context.webSearchConfig);
  },
};

async function executeWebSearch(
  query: string,
  config: WebSearchConfig
): Promise<string> {
  const resp = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      max_results: config.maxResults,
      api_key: config.tavilyApiKey,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Tavily 搜索失败: HTTP ${resp.status} - ${text.slice(0, 200)}`);
  }

  const data = await resp.json();

  if (!data.results || data.results.length === 0) {
    return '未找到相关搜索结果。';
  }

  const lines: string[] = [`搜索到 ${data.results.length} 条结果：\n`];
  for (const item of data.results) {
    const title = item.title || '无标题';
    const url = item.url || '';
    const content = item.content || '';
    lines.push(`### ${title}\n${url}\n${content}\n`);
  }
  return lines.join('\n');
}
