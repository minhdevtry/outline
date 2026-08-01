import { sequelize } from "@server/storage/database";
import { getMistralClient } from "@server/utils/embeddings/mistral";

/**
 * A single retrieved chunk returned by the RAG search.
 */
export interface SearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  documentUrl: string;
  content: string;
  heading: string | null;
  /** Reciprocal Rank Fusion combined score. Higher = more relevant. */
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

interface SearchRow {
  chunk_id: string;
  documentId: string;
  content: string;
  heading: string | null;
  document_title: string;
  score: number;
  vector_rank: number | null;
  keyword_rank: number | null;
}

const PER_SIDE_LIMIT = 20;
const DEFAULT_RESULT_LIMIT = 8;

/**
 * Run a hybrid search over the team's document chunks: vector similarity
 * (cosine distance against the Mistral embedding of the query) fused with
 * keyword relevance (Postgres FTS on the chunk's tsvector + pg_trgm
 * similarity for typo tolerance) via Reciprocal Rank Fusion.
 *
 * The query is embedded on demand; the per-team embedding client handles
 * key rotation and rate limiting. An in-process LRU cache of the query
 * embedding avoids re-embedding identical strings within 60 seconds.
 */
export async function searchChunks(
  query: string,
  teamId: string,
  limit: number = DEFAULT_RESULT_LIMIT
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const queryEmbedding = await embedQueryCached(trimmed, teamId);
  if (!queryEmbedding) {
    return [];
  }

  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  // Single SQL: two CTEs (vector hits, keyword hits) FULL OUTER JOIN'd
  // through RRF. RRF = 1/(60 + rank_v) + 1/(60 + rank_k).
  const sql = `
    WITH q AS (
      SELECT CAST(:vectorLiteral AS vector) AS v
    ),
    vector_hits AS (
      SELECT dc.id, dc."documentId", dc.content, dc.heading,
             ROW_NUMBER() OVER (ORDER BY dc.embedding <=> q.v) AS rank
        FROM document_chunks dc, q
       WHERE dc."teamId" = :teamId
         AND dc.embedding IS NOT NULL
       ORDER BY dc.embedding <=> q.v
       LIMIT :perSide
    ),
    keyword_hits AS (
      SELECT dc.id, dc."documentId", dc.content, dc.heading,
             ROW_NUMBER() OVER (
               ORDER BY (
                 COALESCE(ts_rank_cd(dc.search_tsv, plainto_tsquery('simple', :query)), 0) * 2.0
                 + COALESCE(similarity(dc.content, :query), 0) * 1.0
               ) DESC
             ) AS rank
        FROM document_chunks dc
       WHERE dc."teamId" = :teamId
         AND (
           dc.search_tsv @@ plainto_tsquery('simple', :query)
           OR dc.content % :query
         )
       LIMIT :perSide
    ),
    combined AS (
      SELECT
        COALESCE(v.id, k.id) AS chunk_id,
        COALESCE(v."documentId", k."documentId") AS "documentId",
        COALESCE(v.content, k.content) AS content,
        COALESCE(v.heading, k.heading) AS heading,
        v.rank AS vector_rank,
        k.rank AS keyword_rank
      FROM vector_hits v
      FULL OUTER JOIN keyword_hits k ON v.id = k.id
    )
    SELECT
      c.chunk_id,
      c."documentId",
      c.content,
      c.heading,
      d.title AS document_title,
      (COALESCE(1.0 / (60 + c.vector_rank), 0)
       + COALESCE(1.0 / (60 + c.keyword_rank), 0))::float AS score,
      c.vector_rank,
      c.keyword_rank
    FROM combined c
    JOIN documents d ON d.id = c."documentId"
    ORDER BY score DESC
    LIMIT :limit;
  `;

  const replacements = {
    vectorLiteral,
    teamId,
    query: trimmed,
    perSide: PER_SIDE_LIMIT,
    limit,
  };

  const rows = (await sequelize.query(sql, {
    replacements,
    type: "SELECT",
  })) as unknown as SearchRow[];

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.documentId,
    documentTitle: row.document_title,
    documentUrl: `/doc/${row.documentId}`,
    content: row.content,
    heading: row.heading,
    score: Number(row.score),
    vectorRank: row.vector_rank,
    keywordRank: row.keyword_rank,
  }));
}

// Simple in-process LRU for query embeddings. Avoids hitting Mistral
// when the same query is re-asked within the TTL.
const QUERY_CACHE_TTL_MS = 60_000;
const QUERY_CACHE_MAX = 200;

interface CacheEntry {
  embedding: number[] | null;
  expiresAt: number;
}
const queryCache = new Map<string, CacheEntry>();

async function embedQueryCached(
  query: string,
  teamId: string
): Promise<number[] | null> {
  const key = `${teamId}::${query}`;
  const now = Date.now();
  const cached = queryCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.embedding;
  }
  try {
    const client = await getMistralClient(teamId);
    const vectors = await client.embed([query], "query");
    const embedding = vectors[0] ?? null;
    if (queryCache.size >= QUERY_CACHE_MAX) {
      // Drop the oldest entry.
      const oldest = queryCache.keys().next().value;
      if (oldest !== undefined) {
        queryCache.delete(oldest);
      }
    }
    queryCache.set(key, { embedding, expiresAt: now + QUERY_CACHE_TTL_MS });
    return embedding;
  } catch (err) {
    return null;
  }
}
