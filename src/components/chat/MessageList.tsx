import { MessageBubble } from "./MessageBubble";
import { GitBranch, Highlighter, Sparkles } from "lucide-react";
import type { EditSaveResult } from "./EditMessage";
import type { Message } from "@/lib/api-client/types";
import type { BranchRange } from "./branchHighlights";

export interface MessageListProps {
  branches?: Map<string, BranchRange[]>;
  conversationId?: string;
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
  branches,
  conversationId,
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
      <div className="animate-enter flex h-full items-center justify-center px-6 py-12">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-2xl border border-primary/15 bg-primary/[0.04] text-primary">
            <GitBranch className="h-5 w-5" strokeWidth={1.6} />
          </div>
          <h2 className="text-xl font-semibold tracking-[-0.025em]">
            A new thread of thought
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Send a message to get started. You can branch from any answer
            when you want to explore a different direction.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-[11px] font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5">
              <Highlighter className="h-3 w-3 text-primary" /> Highlight a phrase
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card/70 px-3 py-1.5">
              <GitBranch className="h-3 w-3 text-primary" /> Ask in a branch
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Regenerate targets only the final message when it is an assistant reply
  // (US-408 AC.7); the server still validates last-assistant-only.
  const lastId = messages[messages.length - 1]?.id ?? null;

  return (
    <div
      className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-7"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          message={m}
          branches={branches?.get(m.id)}
          conversationId={conversationId}
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
