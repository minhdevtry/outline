import { pipeline, env as transformersEnv, type FeatureExtractionPipeline } from "@huggingface/transformers";
import Logger from "@server/logging/Logger";

/**
 * Local embedding pipeline using Xenova/paraphrase-multilingual-MiniLM-L6-v2.
 * 384-dim, multilingual (incl. Vietnamese), MIT-licensed, ~50 MB download.
 * Runs entirely in-process via ONNX Runtime — no external API call, no rate
 * limit, no key to manage.
 *
 * The pipeline is loaded lazily on first use and cached for the process
 * lifetime. Subsequent `embed()` calls reuse the same instance.
 *
 * Trade-offs vs Mistral:
 *   - Quality: MiniLM-L6 is smaller than mistral-embed; Vietnamese recall is
 *     usable but not state-of-the-art. For a personal knowledge base this
 *     is a fine default.
 *   - Latency: ~10-30 ms per chunk on a modern CPU (Apple M1 / Ryzen).
 *   - Memory: ~500 MB resident while the pipeline is loaded.
 *   - Disk: model is downloaded once to `LOCAL_EMBEDDING_CACHE_DIR`
 *     (default `node_modules/@huggingface/transformers/.../models`); survives
 *     process restarts.
 */

const DEFAULT_MODEL = "Xenova/multilingual-e5-small";
const DEFAULT_DIMENSION = 384;

export const DEFAULT_LOCAL_EMBEDDING_MODEL = DEFAULT_MODEL;
export const DEFAULT_LOCAL_EMBEDDING_DIM = DEFAULT_DIMENSION;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
let activeModel = DEFAULT_MODEL;
let activeDimension = DEFAULT_DIMENSION;

/**
 * Set the directory the transformers.js library uses to cache downloaded
 * models. Must be called before the first `getPipeline()` call. We default
 * to a path under the user's home so the model survives `yarn install`.
 */
export function configureLocalEmbeddingCache(
  cacheDir: string,
  modelName: string = DEFAULT_MODEL
): void {
  transformersEnv.cacheDir = cacheDir;
  transformersEnv.localModelPath = cacheDir;
  // Allow remote download of the model the first time.
  transformersEnv.allowRemoteModels = true;
  transformersEnv.allowLocalModels = true;
  if (modelName !== activeModel) {
    activeModel = modelName;
    pipelinePromise = null;
  }
}

/**
 * Returns the (singleton, lazily-loaded) feature-extraction pipeline. The
 * first call downloads the model (~50 MB) and instantiates ONNX session;
 * subsequent calls return the cached promise.
 */
export async function getPipeline(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      Logger.info(
        "embedding",
        `Loading local embedding model ${activeModel} (first call downloads ~50 MB)...`
      );
      const start = Date.now();
      const pipe = await pipeline("feature-extraction", activeModel, {
        // dtype: q8 prefers the smaller quantized ONNX variant when available,
        // saving ~3x download size and ~2x memory.
        dtype: "q8",
      });
      const elapsed = Date.now() - start;
      Logger.info(
        "embedding",
        `Local embedding model loaded in ${elapsed}ms`
      );
      return pipe;
    })();
  }
  return pipelinePromise;
}

/**
 * Embed one or more texts, returning one 384-dim vector per input in order.
 * Texts longer than the model's max sequence length (typically 128 tokens
 * for MiniLM) are truncated by the tokenizer.
 *
 * For the e5 model family, the docs recommend prepending "query: " to
 * search queries and "passage: " to indexed passages. We always treat the
 * input as passages (the `passage` flag) so that the same set of prefixes
 * is used for both indexing and query embedding, which is what the model
 * was fine-tuned for.
 *
 * @param texts Strings to embed. Empty input returns [].
 * @param kind "passage" (default, used for chunk indexing) or "query" (used
 *   for the user's question at search time). E5 expects different prefixes.
 * @returns One number[384] per input.
 */
export async function embedLocal(
  texts: string[],
  kind: "passage" | "query" = "passage"
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }
  const prefix = kind === "query" ? "query: " : "passage: ";
  const prefixed = texts.map((t) => prefix + t);
  const pipe = await getPipeline();
  // The pipeline returns a Tensor; call() with an array uses the model's
  // default pooling (mean over tokens) and normalization, which is what we
  // want for cosine-similarity search via pgvector <=>.
  const output = await pipe(prefixed, { pooling: "mean", normalize: true });
  // output is a Tensor of shape [N, 384]. Convert to plain number[][].
  const data = output.tolist() as number[][];
  if (data.length !== texts.length) {
    throw new Error(
      `Embedding length mismatch: expected ${texts.length}, got ${data.length}`
    );
  }
  return data;
}

export function getLocalEmbeddingModel(): string {
  return activeModel;
}

export function getLocalEmbeddingDimension(): number {
  return activeDimension;
}

export { DEFAULT_DIMENSION };
