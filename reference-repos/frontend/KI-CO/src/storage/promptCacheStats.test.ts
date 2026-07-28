import { describe, expect, it } from "vitest";
import { parseUsageForPromptCache } from "./promptCacheStats";

describe("parseUsageForPromptCache", () => {
  it("does not add cached tokens on top of OpenRouter prompt_tokens", () => {
    expect(parseUsageForPromptCache({
      prompt_tokens: 14033,
      input_tokens: 14001,
      cache_read_input_tokens: 3296,
      completion_tokens: 500,
      prompt_tokens_details: { cached_tokens: 3296 },
    })).toEqual({
      inputTokens: 14033,
      cachedTokens: 3296,
      outputTokens: 500,
    });
  });

  it("sums Anthropic native input breakdown when no prompt total exists", () => {
    expect(parseUsageForPromptCache({
      input_tokens: 120,
      cache_creation_input_tokens: 1000,
      cache_read_input_tokens: 3000,
      output_tokens: 240,
    })).toEqual({
      inputTokens: 4120,
      cachedTokens: 3000,
      outputTokens: 240,
    });
  });

  it("keeps ordinary OpenAI-compatible prompt usage unchanged", () => {
    expect(parseUsageForPromptCache({
      prompt_tokens: 5000,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 2048 },
    })).toEqual({
      inputTokens: 5000,
      cachedTokens: 2048,
      outputTokens: 300,
    });
  });
});
