import { MessageBubble } from "./MessageBubble";
import type { Message } from "@/lib/api-client/types";

export interface MessageListProps {
  messages: Message[];
  streamingContent?: string | null;
  streamingId?: string;
}

export function MessageList({
  messages,
  streamingContent,
  streamingId,
}: MessageListProps) {
  if (messages.length === 0 && !streamingContent) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-12">
        <p className="text-center text-sm text-muted-foreground">
          Send a message to get started.
        </p>
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
      {streamingContent !== undefined && streamingContent !== null ? (
        <MessageBubble
          message={{
            id: streamingId ?? "streaming",
            role: "assistant",
            content: streamingContent,
            createdAt: new Date().toISOString(),
          }}
          isStreaming
        />
      ) : null}
    </div>
  );
}