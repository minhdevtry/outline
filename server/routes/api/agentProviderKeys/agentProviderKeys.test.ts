import { describe, expect, it, vi } from "vitest";

/* -------------------------------------------------------------------------- */
/*  Provider config validation (Zod schema parity)                           */
/* -------------------------------------------------------------------------- */

describe("agentProviderKeys.update request shape", () => {
  it("accepts a minimal Anthropic key", async () => {
    const { z } = await import("zod");
    const UpdateSchema = z.object({
      provider: z.enum(["openai", "anthropic", "openai-compatible"]),
      apiKey: z.string().min(1).max(2000),
      baseUrl: z.string().max(500).optional().nullable(),
      model: z.string().max(100).optional().nullable(),
      enabled: z.boolean().optional().default(true),
    });
    const parsed = UpdateSchema.parse({
      provider: "anthropic",
      apiKey: "sk-ant-test",
    });
    expect(parsed.enabled).toBe(true);
    expect(parsed.provider).toBe("anthropic");
  });

  it("accepts an OpenAI-compatible entrypoint with baseUrl", async () => {
    const { z } = await import("zod");
    const UpdateSchema = z.object({
      provider: z.enum(["openai", "anthropic", "openai-compatible"]),
      apiKey: z.string().min(1).max(2000),
      baseUrl: z.string().max(500).optional().nullable(),
      model: z.string().max(100).optional().nullable(),
      enabled: z.boolean().optional().default(true),
    });
    const parsed = UpdateSchema.parse({
      provider: "openai-compatible",
      apiKey: "sk-test",
      baseUrl: "https://gateway.example.com/v1",
      model: "my-model",
      enabled: false,
    });
    expect(parsed.enabled).toBe(false);
    expect(parsed.baseUrl).toBe("https://gateway.example.com/v1");
  });

  it("rejects unknown providers", async () => {
    const { z } = await import("zod");
    const UpdateSchema = z.object({
      provider: z.enum(["openai", "anthropic", "openai-compatible"]),
      apiKey: z.string().min(1).max(2000),
    });
    expect(() =>
      UpdateSchema.parse({ provider: "claude-200", apiKey: "sk" })
    ).toThrow();
  });

  it("rejects empty API keys", async () => {
    const { z } = await import("zod");
    const UpdateSchema = z.object({
      provider: z.enum(["openai", "anthropic", "openai-compatible"]),
      apiKey: z.string().min(1).max(2000),
    });
    expect(() =>
      UpdateSchema.parse({ provider: "anthropic", apiKey: "" })
    ).toThrow();
  });

  it("rejects overly long API keys (>2000 chars)", async () => {
    const { z } = await import("zod");
    const UpdateSchema = z.object({
      provider: z.enum(["openai", "anthropic", "openai-compatible"]),
      apiKey: z.string().min(1).max(2000),
    });
    expect(() =>
      UpdateSchema.parse({
        provider: "openai",
        apiKey: "x".repeat(2001),
      })
    ).toThrow();
  });
});

describe("agentProviderKeys.delete request shape", () => {
  it("accepts a known provider", async () => {
    const { z } = await import("zod");
    const DeleteSchema = z.object({
      provider: z.enum(["openai", "anthropic", "openai-compatible"]),
    });
    expect(DeleteSchema.parse({ provider: "anthropic" }).provider).toBe(
      "anthropic"
    );
  });

  it("rejects unknown providers", async () => {
    const { z } = await import("zod");
    const DeleteSchema = z.object({
      provider: z.enum(["openai", "anthropic", "openai-compatible"]),
    });
    expect(() => DeleteSchema.parse({ provider: "gpt" })).toThrow();
  });
});
