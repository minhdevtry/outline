import env from "@server/env";
import { AnthropicProvider } from "./anthropicProvider";
import { OpenAIProvider } from "./openaiProvider";
import type { Provider, ProviderConfig } from "./providers";

/* -------------------------------------------------------------------------- */
/*  Provider resolver                                                         */
/* -------------------------------------------------------------------------- */

/** Build a provider from a ProviderConfig. Dispatches to the right
 * adapter based on providerId. */
export function buildProvider(config: ProviderConfig): Provider {
  switch (config.providerId) {
    case "openai":
    case "openai-compatible":
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl ?? "https://api.openai.com/v1",
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        headers: config.headers,
      });
    case "anthropic":
      return new AnthropicProvider({
        apiKey: config.apiKey,
        model: config.model,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        headers: config.headers,
        baseUrl: env.ANTHROPIC_API_BASE_URL ?? undefined,
      });
  }
}

/* -------------------------------------------------------------------------- */
/*  Default provider resolver                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Pick the best available provider from environment variables. Returns
 * `null` if no AI provider is configured.
 *
 * Priority:
 *   1. Anthropic if `ANTHROPIC_API_KEY` is set
 *   2. OpenAI-compatible if `AI_API_BASE_URL` is set
 *   3. OpenAI if `OPENAI_API_KEY` is set
 */
export function resolveDefaultProvider(): Provider | null {
  const anthropic = env.ANTHROPIC_API_KEY;
  if (anthropic) {
    return buildProvider({
      providerId: "anthropic",
      apiKey: anthropic,
      model: env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      maxTokens: 4096,
    });
  }
  const openai = env.OPENAI_API_KEY;
  if (!openai) {
    return null;
  }
  if (env.AI_API_BASE_URL) {
    return buildProvider({
      providerId: "openai-compatible",
      apiKey: openai,
      baseUrl: env.AI_API_BASE_URL,
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
    });
  }
  return buildProvider({
    providerId: "openai",
    apiKey: openai,
    model: env.OPENAI_MODEL ?? "gpt-4o-mini",
  });
}
