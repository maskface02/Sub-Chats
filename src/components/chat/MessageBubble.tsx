"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api-client/types";
import { Markdown } from "@/components/markdown/Markdown";
import { EditMessage, type EditSaveResult } from "./EditMessage";
import { RegenerateButton } from "./RegenerateButton";
import { Bot, UserRound } from "lucide-react";
import type { BranchRange } from "./branchHighlights";

export interface MessageBubbleProps {
  branches?: BranchRange[];
  conversationId?: string;
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
  branches,
  conversationId,
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
      data-message-source={message.content}
      data-no-branch={disableBranch ? "true" : undefined}
      className={cn(
        "group flex w-full animate-enter gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser ? (
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
          <Bot className="h-4 w-4" />
        </div>
      ) : null}
      <div
        className={cn(
          "flex max-w-[88%] flex-col sm:max-w-[78%]",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div className={cn("mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground", isUser && "flex-row-reverse")}>
          {isUser ? <UserRound className="h-3 w-3" /> : null}
          <span>{isUser ? "You" : "Assistant"}</span>
        </div>
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
                "select-text text-[14px] leading-6",
                // Plain-text accumulation keeps pre-wrap; markdown blocks collapse it
                // themselves so a rendered message must NOT preserve tags' whitespace.
                isAssistant && !isStreaming ? "" : "whitespace-pre-wrap",
                isUser
                  ? "rounded-2xl bg-secondary px-4 py-3 text-foreground"
                  : "py-1 text-foreground",
              )}
              title={new Date(message.createdAt).toUTCString()}
            >
              {isAssistant && !isStreaming ? (
                <Markdown content={message.content} branches={disableBranch ? undefined : branches} parentId={conversationId} />
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
              <div className="mt-1 flex justify-end opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label="Edit message"
                  className="rounded-lg px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
