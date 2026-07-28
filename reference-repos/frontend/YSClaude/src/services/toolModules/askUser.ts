import type { ToolModule } from './types';

export const ASK_USER_TOOL_NAME = 'ask_user';

export const askUserTool: ToolModule = {
  id: 'ask-user',
  labels: {
    [ASK_USER_TOOL_NAME]: '询问用户',
  },
  getDefinitions: (config) => {
    const settings = config.nativeTools;
    if (settings?.askUserEnabled === false) return [];
    const minQuestions = Math.max(1, Math.min(10, settings?.askUserMinQuestions ?? 1));
    const maxQuestions = Math.max(minQuestions, Math.min(10, settings?.askUserMaxQuestions ?? 4));
    const minOptions = Math.max(1, Math.min(8, settings?.askUserMinOptions ?? 2));
    const maxOptions = Math.max(minOptions, Math.min(8, settings?.askUserMaxOptions ?? 4));
    return [{
      type: 'function',
      function: {
        name: ASK_USER_TOOL_NAME,
        description:
          `当继续回答前确实需要用户补充信息或作出选择时使用。一次询问 ${minQuestions} 到 ${maxQuestions} 个简短问题，每题提供 ${minOptions} 到 ${maxOptions} 个互斥且容易理解的选项。用户也可以输入选项以外的答案。不要用它询问非必要信息。`,
        parameters: {
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              minItems: minQuestions,
              maxItems: maxQuestions,
              items: {
                type: 'object',
                properties: {
                  question: {
                    type: 'string',
                    description: '要询问用户的简短问题',
                  },
                  options: {
                    type: 'array',
                    minItems: minOptions,
                    maxItems: maxOptions,
                    items: { type: 'string' },
                    description: '互斥的推荐答案选项',
                  },
                },
                required: ['question', 'options'],
                additionalProperties: false,
              },
            },
          },
          required: ['questions'],
          additionalProperties: false,
        },
      },
    }];
  },
  execute: async (toolName) => {
    if (toolName !== ASK_USER_TOOL_NAME) return undefined;
    return '已向用户展示问题，等待用户回答。';
  },
};
