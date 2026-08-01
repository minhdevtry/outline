/**
 * Compatibility shim: previous code referenced `MistralEmbeddingClient` and
 * `getMistralClient` for a remote Mistral API. We've moved to a local
 * embedding model (see `local.ts`) so the API is preserved but the
 * implementation is a thin pass-through. Key-pool rotation, token-bucket
 * rate limiting, and remote validation are no longer applicable.
 *
 * Keep this file thin so callers don't need to change. Remove the key-pool
 * tables/API in a follow-up cleanup; for now they remain in the schema
 * unused.
 */
import {
  embedLocal,
  getLocalEmbeddingModel,
  getLocalEmbeddingDimension,
} from "./local";

export class NoValidEmbeddingKeyError extends Error {
  constructor() {
    super("Local embedding model is not available");
    this.name = "NoValidEmbeddingKeyError";
  }
}

export interface MistralConfig {
  endpoint?: string;
  model?: string;
  dimension?: number;
  maxBatchSize?: number;
  ratePerSecond?: number;
  maxRetries?: number;
}

/**
 * Stub client. The original Mistral class had per-team key rotation; the
 * local model has no such concept, so all the methods are thin pass-throughs
 * to the global pipeline. The class shape is kept so callers don't have to
 * change.
 */
export class MistralEmbeddingClient {
  constructor(
    private readonly teamId: string,
    config?: Partial<MistralConfig>
  ) {
    // Touch unused params so TypeScript doesn't complain about unused fields.
    void this.teamId;
    void config;
  }

  async refreshKeys(): Promise<void> {
    // No-op.
  }

  async embed(
    texts: string[],
    kind: "passage" | "query" = "passage"
  ): Promise<number[][]> {
    return embedLocal(texts, kind);
  }

  static async validateKey(
    _key: string
  ): Promise<{ ok: true; dimension: number } | { ok: false; error: string }> {
    return { ok: false, error: "Local model does not use API keys" };
  }
}

const clientCache = new Map<string, MistralEmbeddingClient>();

export async function getMistralClient(
  teamId: string
): Promise<MistralEmbeddingClient> {
  let client = clientCache.get(teamId);
  if (!client) {
    client = new MistralEmbeddingClient(teamId);
    clientCache.set(teamId, client);
  }
  return client;
}

export function invalidateClientCache(teamId?: string): void {
  if (teamId) {
    clientCache.delete(teamId);
  } else {
    clientCache.clear();
  }
}

/**
 * Always true with the local model. The RAG pre-check in `ai.ts` uses this
 * to decide whether to call the search.
 */
export async function teamHasEmbeddingKey(_teamId: string): Promise<boolean> {
  return true;
}

export function getActiveEmbeddingModel(): string {
  return getLocalEmbeddingModel();
}

export function getActiveEmbeddingDimension(): number {
  return getLocalEmbeddingDimension();
}
