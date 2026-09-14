"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api-client/types";
import { Markdown } from "@/components/markdown/Markdown";
import { EditMessage, type EditSaveResult } from "./EditMessage";
import { RegenerateButton } from "./RegenerateButton";

export interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  /**
   * When true, this bubble is rendered inside the parent-context banner
   * preview and the SelectionMenu should NOT consider it a branch source.
   */
  disableBranch?: boolean;
  /** Ephemeral "Stopped" chip (US-405): in-memory only, set at abort time. */
  stopped?: boolean;
  /** Edit affordance on your own user messages (US-407). */
  canEdit?: boolean;
  /** Regenerate affordance on the last assistant message (US-408). */
  canRegenerate?: boolean;
  /** Pane is in-flight — edit/regenerate suppressed. */
  busy?: boolean;
  onEditSave?: (messageId: string, content: string) => Promise<EditSaveResult>;
  onRegenerate?: () => void;
}

export function MessageBubble({
  message,
  isStreaming = false,
  disableBranch = false,
  stopped = false,
  canEdit = false,
  canRegenerate = false,
  busy = false,
  onEditSave,
  onRegenerate,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const ariaLabel = isUser
    ? "User message"
    : isAssistant
      ? "Assistant message"
      : "System message";

  return (
    <article
      aria-label={ariaLabel}
      data-message-id={message.id}
      data-message-role={message.role}
      data-no-branch={disableBranch ? "true" : undefined}
      className={cn(
        "group flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "flex max-w-[85%] flex-col sm:max-w-[75%]",
          isUser ? "items-end" : "items-start",
        )}
      >
        {editing && isUser && onEditSave ? (
          <div className="w-full min-w-[16rem]">
            <EditMessage
              initialContent={message.content}
              onSave={async (content) => {
                const result = await onEditSave(message.id, content);
                if (result.ok) setEditing(false);
                return result;
              }}
              onCancel={() => setEditing(false)}
            />
          </div>
        ) : (
          <>
            <div
              className={cn(
                "rounded-2xl px-4 py-2.5 text-sm shadow-sm",
                "select-text",
                // Plain-text accumulation keeps pre-wrap; markdown blocks collapse it
                // themselves so a rendered message must NOT preserve tags' whitespace.
                isAssistant && !isStreaming ? "" : "whitespace-pre-wrap",
                isUser
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground",
              )}
              title={new Date(message.createdAt).toLocaleString()}
            >
              {isAssistant && !isStreaming ? (
                <Markdown content={message.content} />
              ) : (
                <span className={cn(isAssistant && isStreaming && "streaming-caret")}>
                  {message.content || (isAssistant && isStreaming ? "" : "")}
                </span>
              )}
              {stopped && isAssistant && !isStreaming ? (
                <span
                  role="status"
                  className="mt-1 inline-block rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  Stopped
                </span>
              ) : null}
            </div>
            {isUser && canEdit && !busy && onEditSave ? (
              <div className="mt-1 flex justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Edit message"
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Edit
                </button>
              </div>
            ) : null}
            {isAssistant && canRegenerate && !busy && onRegenerate ? (
              <div className="mt-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <RegenerateButton onRegenerate={() => onRegenerate()} />
              </div>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}
