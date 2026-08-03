import { CSRF } from "@shared/constants";
import { getCSRFToken } from "./csrf";

/**
 * Generic SSE consumer using `XMLHttpRequest` for progressive streaming.
 * We use XHR instead of `fetch` because Cloudflare advertises HTTP/3 (QUIC)
 * via `Alt-Svc` and Chrome/Brave will negotiate HTTP/3 for fetch requests.
 * HTTP/3 QUIC has issues with long-running SSE streams (ERR_QUIC_PROTOCOL_ERROR),
 * whereas XHR reliably uses HTTP/1.1 or HTTP/2 which work correctly with
 * Cloudflare's SSE proxy.
 *
 * Each parsed `data: ` line is forwarded to `onEvent`. Comment lines (`: ping`)
 * and the `[DONE]` sentinel are handled gracefully.
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
  const csrfToken = getCSRFToken();
  const xhr = new XMLHttpRequest();
  let processedLength = 0;
  let buffer = "";
  let hasEnded = false;
  let receivedEvents = false;

  const processChunk = () => {
    const newText = xhr.responseText.slice(processedLength);
    processedLength = xhr.responseText.length;
    if (!newText) {
      return;
    }

    buffer += newText;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) {
        // SSE comment (keepalive ping) or empty line — skip
        continue;
      }
      if (!trimmed.startsWith("data: ")) {
        continue;
      }
      const payload = trimmed.slice(6);
      if (!payload) {
        continue;
      }
      if (payload === "[DONE]") {
        hasEnded = true;
        onEvent({ type: "done" } as unknown as T);
        continue;
      }
      try {
        const parsed = JSON.parse(payload) as T;
        receivedEvents = true;

        if (
          parsed &&
          typeof parsed === "object" &&
          ((parsed as { type?: string }).type === "done" ||
            (parsed as { type?: string }).type === "error")
        ) {
          hasEnded = true;
        }
        onEvent(parsed);
      } catch {
        // ignore malformed JSON
      }
    }
  };

  xhr.open("POST", url, true);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Accept", "text/event-stream");
  if (csrfToken) {
    xhr.setRequestHeader(CSRF.headerName, csrfToken);
  }
  if (init?.headers) {
    for (const [key, value] of Object.entries(init.headers)) {
      xhr.setRequestHeader(key, value);
    }
  }
  xhr.withCredentials = true;

  xhr.onprogress = () => {
    processChunk();
  };

  xhr.onload = () => {
    processChunk();
    if (!hasEnded) {
      hasEnded = true;
      onEvent({ type: "done" } as unknown as T);
    }
  };

  xhr.onerror = () => {
    if (receivedEvents) {
      if (!hasEnded) {
        hasEnded = true;
        onEvent({ type: "done" } as unknown as T);
      }
    } else {
      const msg = `SSE request failed: network error`;
      onEvent({ type: "error", message: msg } as unknown as T);
    }
  };

  xhr.onabort = () => {
    if (!hasEnded) {
      hasEnded = true;
    }
  };

  xhr.send(JSON.stringify(body));

  return { abort: () => xhr.abort() };
}
