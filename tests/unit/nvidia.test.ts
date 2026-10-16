import { describe, expect, it, vi } from "vitest";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";
import { NVIDIA_BASE_URL, NVIDIA_MODEL, NVIDIA_GENERATION_SETTINGS, isNvidiaEndpoint } from "@/lib/ai/nvidia";

describe("NVIDIA OpenAI-compatible transport", () => {
  it("sends the expected chat-completion request and reads streamed output", async () => {
    const fetch = vi.fn(async () => new Response(
      'data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"meta/muse-glimmer-30b","choices":[{"index":0,"delta":{"content":"9.8 is larger."},"finish_reason":null}]}\n\n' +
      'data: {"id":"test","object":"chat.completion.chunk","created":1,"model":"meta/muse-glimmer-30b","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n',
      { headers: { "content-type": "text/event-stream" } },
    ));
    const client = createOpenAI({ baseURL: NVIDIA_BASE_URL, apiKey: "test-placeholder", fetch });
    const result = streamText({
      model: client(NVIDIA_MODEL),
      ...NVIDIA_GENERATION_SETTINGS,
      messages: [{ role: "user", content: "Which number is larger, 9.11 or 9.8?" }],
    });
    let text = "";
    for await (const chunk of result.textStream) text += chunk;
    expect(text).toBe("9.8 is larger.");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${NVIDIA_BASE_URL}/chat/completions`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: NVIDIA_MODEL, temperature: 1, top_p: 0.95, max_tokens: 8192, stream: true,
    });
  });

  it("matches only the NVIDIA endpoint", () => {
    expect(isNvidiaEndpoint(`${NVIDIA_BASE_URL}/`)).toBe(true);
    expect(isNvidiaEndpoint(`${NVIDIA_BASE_URL}.example.com`)).toBe(false);
    expect(isNvidiaEndpoint(null)).toBe(false);
  });
});
