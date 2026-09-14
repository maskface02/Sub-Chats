import { MessageBubble } from "./MessageBubble";
import type { EditSaveResult } from "./EditMessage";
import type { Message } from "@/lib/api-client/types";

export interface MessageListProps {
  messages: Message[];
  streamingContent?: string | null;
  streamingId?: string;
  /** Ephemeral stopped-message ids (US-405 AC.3). */
  stoppedIds?: ReadonlySet<string>;
  /** Pane in-flight — edit/regenerate affordances disabled (US-407/408). */
  busy?: boolean;
  onEditSave?: (messageId: string, content: string) => Promise<EditSaveResult>;
  onRegenerate?: () => void;
}

export function MessageList({
  messages,
  streamingContent,
  streamingId,
  stoppedIds,
  busy = false,
  onEditSave,
  onRegenerate,
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

  // Regenerate targets only the final message when it is an assistant reply
  // (US-408 AC.7); the server still validates last-assistant-only.
  const lastId = messages[messages.length - 1]?.id ?? null;

  return (
    <div
      className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          stopped={stoppedIds?.has(m.id) ?? false}
          canEdit={m.role === "user" && !!onEditSave}
          canRegenerate={
            m.role === "assistant" && m.id === lastId && !!onRegenerate
          }
          busy={busy}
          onEditSave={onEditSave}
          onRegenerate={onRegenerate}
        />
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
