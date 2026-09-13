import { cn } from "@/lib/utils";
import type { Message } from "@/lib/api-client/types";

export interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
}

export function MessageBubble({ message, isStreaming = false }: MessageBubbleProps) {
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
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm shadow-sm sm:max-w-[75%]",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
        title={new Date(message.createdAt).toLocaleString()}
      >
        <span className={cn(isAssistant && isStreaming && "streaming-caret")}>
          {message.content || (isAssistant && isStreaming ? "\u200B" : "")}
        </span>
      </div>
    </article>
  );
}