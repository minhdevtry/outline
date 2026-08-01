import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import Logger from "@server/logging/Logger";
import { getPipeline, configureLocalEmbeddingCache } from "@server/utils/embeddings/local";

/**
 * Initialize the local embedding model so the first user-facing `embed()`
 * call doesn't pay the ~10-30s model-load penalty.
 *
 * We model-cache under `~/.outline-data/embedding-models` by default so the
 * ONNX weights survive `yarn install` and process restarts. The first call
 * downloads from the Hugging Face Hub (~50 MB for the quantized
 * paraphrase-multilingual-MiniLM-L6-v2).
 */
export default async function initEmbeddingService() {
  const cacheDir =
    process.env.LOCAL_EMBEDDING_CACHE_DIR ??
    path.join(os.homedir(), ".outline-data", "embedding-models");
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    Logger.warn(`[embedding] Could not create cache dir ${cacheDir}: ${msg}`);
  }
  configureLocalEmbeddingCache(cacheDir);
  Logger.info("embedding", `Embedding cache: ${cacheDir}`);

  // Trigger the pipeline load asynchronously. We do not await the full
  // download here — we want the server to start quickly and the first
  // request to be the one that blocks on the load (with a progress log).
  void getPipeline()
    .then(() => Logger.info("embedding", "Local embedding model ready"))
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      Logger.error(
        `[embedding] Local embedding model failed to load: ${msg}`,
        err instanceof Error ? err : new Error(msg)
      );
    });
}
