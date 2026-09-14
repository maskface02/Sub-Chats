import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api-client/types";
import { Markdown } from "@/components/markdown/Markdown";

export interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  /**
   * When true, this bubble is rendered inside the parent-context banner
   * preview and the SelectionMenu should NOT consider it a branch source.
   */
  disableBranch?: boolean;
}

export function MessageBubble({
  message,
  isStreaming = false,
  disableBranch = false,
}: MessageBubbleProps) {
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
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm sm:max-w-[75%]",
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
      </div>
    </article>
  );
}
