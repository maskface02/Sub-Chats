export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export class SSEParser {
  private buffer = "";

  constructor(private readonly onEvent: (ev: SseEvent) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let sep: number;
    while ((sep = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, sep);
      this.buffer = this.buffer.slice(sep + 2);
      const ev = this.parseEvent(raw);
      if (ev) this.onEvent(ev);
    }
  }

  end(): void {
    if (this.buffer.trim()) {
      const ev = this.parseEvent(this.buffer);
      if (ev) this.onEvent(ev);
      this.buffer = "";
    }
  }

  private parseEvent(raw: string): SseEvent | null {
    const lines = raw.split(/\r?\n/);
    let event = "message";
    const dataLines: string[] = [];
    let id: string | undefined;
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      const value = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") dataLines.push(value);
      else if (field === "id") id = value;
    }
    if (!dataLines.length) return null;
    return { event, data: dataLines.join("\n"), id };
  }
}

export async function* streamSse(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<SseEvent, void, void> {
  if (!response.ok || !response.body) {
    throw new Error(`SSE stream failed: ${response.status} ${response.statusText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const queue: SseEvent[] = [];
  let resolveNext: (() => void) | null = null;
  let ended = false;
  let error: Error | null = null;

  const parser = new SSEParser((ev) => {
    queue.push(ev);
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  });

  const onAbort = () => {
    error = new DOMException("Aborted", "AbortError");
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
    }
  };
  signal?.addEventListener("abort", onAbort);

  (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
      parser.push(decoder.decode());
      parser.end();
    } catch (e) {
      error = e as Error;
    } finally {
      ended = true;
      if (resolveNext) {
        (resolveNext as () => void)();
        resolveNext = null;
      }
    }
  })();

  try {
    while (true) {
      if (queue.length) {
        yield queue.shift()!;
        continue;
      }
      if (error) throw error;
      if (ended) return;
      await new Promise<void>((r) => {
        resolveNext = r;
      });
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}
