import crypto from "node:crypto";

/**
 * A single chunk produced by `chunkMarkdown`. `contentHash` is a sha256
 * hex digest of the content; the embedding task uses it to diff against
 * the previous set of chunks and only re-embed those whose text actually
 * changed.
 */
export interface Chunk {
  chunkIndex: number;
  content: string;
  contentHash: string;
  heading: string | null;
  startOffset: number;
  endOffset: number;
}

export interface ChunkOptions {
  /** Maximum number of tokens per chunk. Default 800. */
  maxTokens: number;
  /** Number of tokens of overlap between consecutive chunks. Default 200. */
  overlapTokens: number;
  /** Merge trailing chunks smaller than this many tokens. Default 50. */
  minChunkTokens: number;
}

/**
 * A conservative 1 token ≈ 4 chars heuristic. Mistral's BPE will give
 * different numbers for non-English / code-heavy text, but for chunk-sizing
 * decisions (not token-budgeting) this is close enough.
 */
export function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashContent(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/gm;
const PARAGRAPH_SPLIT_RE = /\n\s*\n/;
const SENTENCE_SPLIT_RE = /(?<=[.!?。!?])\s+/;

interface RawSection {
  heading: string | null;
  text: string;
  startOffset: number;
}

/**
 * Split a markdown document into heading-anchored sections first. Each
 * section becomes a list of paragraph-like blocks. We then walk blocks,
 * accumulating until `maxTokens` is reached, and emit chunks with overlap.
 */
export function chunkMarkdown(
  source: string,
  options?: Partial<ChunkOptions>
): Chunk[] {
  const maxTokens = options?.maxTokens ?? 800;
  const overlapTokens = options?.overlapTokens ?? 200;
  const minChunkTokens = options?.minChunkTokens ?? 50;

  if (!source || !source.trim()) {
    return [];
  }

  const sections = splitIntoSections(source);
  const rawBlocks: Array<{
    heading: string;
    content: string;
    startOffset: number;
  }> = [];

  for (const section of sections) {
    const blocks = section.text
      .split(PARAGRAPH_SPLIT_RE)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);
    for (const block of blocks) {
      rawBlocks.push({
        heading: section.heading ?? "",
        content: block,
        // The startOffset of a block is the position of its first char in
        // `source`. We approximate by finding the block text; the cost of a
        // single O(n) indexOf per block is fine for our document sizes.
        startOffset: source.indexOf(block),
      });
    }
  }

  // Group blocks into chunks. Walk one block at a time; accumulate until we
  // would exceed `maxTokens`; emit a chunk; then start the next with the
  // overlap from the tail of the previous chunk.
  const maxChars = maxTokens * 4;
  const overlapChars = Math.max(0, overlapTokens * 4);
  const minChunkChars = minChunkTokens * 4;

  const out: Chunk[] = [];
  let current: string[] = [];
  let currentStart = 0;
  let currentLength = 0;
  let currentHeading: string | null = null;

  const emit = (endOffset: number) => {
    if (current.length === 0) {
      return;
    }
    const content = current.join("\n\n").trim();
    if (content.length === 0) {
      current = [];
      return;
    }
    out.push({
      chunkIndex: out.length,
      content,
      contentHash: hashContent(content),
      heading: currentHeading,
      startOffset: currentStart,
      endOffset,
    });
    current = [];
    currentLength = 0;
  };

  for (const block of rawBlocks) {
    if (block.heading) {
      currentHeading = block.heading;
    }
    const blockText = block.content;
    const blockLen = blockText.length;

    // If a single block is larger than maxTokens, hard-split on sentence
    // boundaries until it fits.
    if (blockLen > maxChars) {
      emit(block.startOffset);
      const subChunks = hardSplit(blockText, maxChars);
      let cursor = source.indexOf(blockText);
      for (const sub of subChunks) {
        out.push({
          chunkIndex: out.length,
          content: sub.trim(),
          contentHash: hashContent(sub.trim()),
          heading: currentHeading,
          startOffset: cursor,
          endOffset: cursor + sub.length,
        });
        cursor += sub.length;
      }
      currentStart = cursor;
      continue;
    }

    if (currentLength + blockLen + 2 > maxChars && current.length > 0) {
      // Emit the current chunk first. The overlap window is the last
      // `overlapChars` of the emitted text; we seed the next chunk with it
      // so context continuity is preserved.
      const lastBlock = current[current.length - 1];
      emit(block.startOffset);
      if (overlapChars > 0 && lastBlock && lastBlock.length <= overlapChars) {
        current = [lastBlock];
        currentLength = lastBlock.length;
        currentStart = block.startOffset - lastBlock.length;
      } else if (overlapChars > 0) {
        const tail = lastBlock.slice(-overlapChars);
        current = [tail];
        currentLength = tail.length;
        currentStart = block.startOffset - tail.length;
      } else {
        current = [];
        currentStart = block.startOffset;
      }
    }

    if (current.length === 0) {
      currentStart = block.startOffset;
    }
    current.push(blockText);
    currentLength += blockLen + 2;
  }

  // Flush the final chunk.
  emit(source.length);

  // Merge trailing chunks that are too small into the previous one.
  if (out.length >= 2 && out[out.length - 1].content.length < minChunkChars) {
    const last = out.pop()!;
    const prev = out[out.length - 1];
    prev.content = `${prev.content}\n\n${last.content}`;
    prev.contentHash = hashContent(prev.content);
    prev.endOffset = last.endOffset;
  }

  // Reindex
  out.forEach((c, i) => {
    c.chunkIndex = i;
  });

  return out;
}

function splitIntoSections(source: string): RawSection[] {
  const sections: RawSection[] = [];
  let cursor = 0;
  let currentHeading: string | null = null;
  let currentStart = 0;
  let lastIndex = 0;

  // Use the regex's lastIndex to walk the source string.
  HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  const matches: Array<{
    heading: string;
    start: number;
    end: number;
  }> = [];

  while ((match = HEADING_RE.exec(source)) !== null) {
    matches.push({
      heading: match[2].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
    if (match.index === lastIndex) {
      // Avoid infinite loop on zero-width match.
      HEADING_RE.lastIndex++;
    }
    lastIndex = HEADING_RE.lastIndex;
  }

  if (matches.length === 0) {
    return [
      {
        heading: null,
        text: source,
        startOffset: 0,
      },
    ];
  }

  // Pre-heading section (if any).
  if (matches[0].start > 0) {
    sections.push({
      heading: null,
      text: source.slice(0, matches[0].start),
      startOffset: 0,
    });
  }

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const next = matches[i + 1];
    const end = next ? next.start : source.length;
    sections.push({
      heading: m.heading,
      text: source.slice(m.end, end),
      startOffset: m.end,
    });
  }

  // Suppress unused-var warning while keeping the readability of the loop.
  cursor = cursor;
  currentHeading = currentHeading;
  currentStart = currentStart;

  return sections;
}

function hardSplit(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }
  const out: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    const cut = findSentenceBoundary(window);
    if (cut <= 0) {
      out.push(remaining.slice(0, maxChars));
      remaining = remaining.slice(maxChars);
    } else {
      out.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
  }
  if (remaining.length > 0) {
    out.push(remaining);
  }
  return out;
}

function findSentenceBoundary(window: string): number {
  const re = new RegExp(SENTENCE_SPLIT_RE.source, "g");
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(window)) !== null) {
    last = m.index + m[0].length;
  }
  return last;
}
