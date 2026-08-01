/**
 * Generic SSE consumer using `fetch` + ReadableStream. Returns the underlying
 * AbortController so the caller can cancel. Each parsed `data: ` line is
 * forwarded to `onEvent`. Comment lines (`: ping`) and the `[DONE]` sentinel
 * are silently dropped.
 */
export interface SseHandle {
  abort: () => void;
}

export async function consumeSSE<T = unknown>(
  url: string,
  body: unknown,
  onEvent: (event: T) => void,
  init?: { headers?: Record<string, string> }
): Promise<SseHandle> {
  const controller = new AbortController();
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`SSE request failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  // Fire-and-forget: the read loop runs until the server closes the
  // connection or the caller aborts.
  void (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) {
            continue;
          }
          const payload = trimmed.slice(6);
          if (!payload || payload === "[DONE]") {
            continue;
          }
          try {
            onEvent(JSON.parse(payload) as T);
          } catch {
            // ignore malformed event
          }
        }
      }
    } catch {
      // connection closed or aborted
    }
  })();
  return { abort: () => controller.abort() };
}
