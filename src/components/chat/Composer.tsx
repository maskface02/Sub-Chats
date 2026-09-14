"use client";

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { StopButton } from "./StopButton";
import { cn } from "@/lib/utils";

export interface ComposerProps {
  onSend: (content: string) => void | Promise<void>;
  disabled?: boolean;
  statusLabel?: string | null;
  className?: string;
  placeholder?: string;
  /** While in flight the send button is replaced by Stop (US-405 AC.1). */
  streaming?: boolean;
  onStop?: () => void;
}

const MAX_LENGTH = 8000;

export function Composer({
  onSend,
  disabled = false,
  statusLabel = null,
  className,
  placeholder,
  streaming = false,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !disabled;

  const submit = (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!canSend) return;
    onSend(trimmed);
    setValue("");
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // US-405 AC.5: after stop, focus returns to the composer textarea.
  const handleStop = () => {
    onStop?.();
    requestAnimationFrame(() => taRef.current?.focus());
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "border-t bg-background px-4 py-3",
        className,
      )}
      aria-label="Message composer"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        <div className="flex items-end gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "AI is responding…" : placeholder ?? "Message the AI…"}
            disabled={disabled}
            rows={1}
            maxLength={MAX_LENGTH}
            aria-label="Message input"
            className="flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />
          {streaming && onStop ? (
            <StopButton onStop={handleStop} />
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={!canSend}
              aria-label="Send message"
              className="shrink-0"
            >
              Send
            </Button>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{statusLabel ?? "Press Enter to send, Shift+Enter for newline."}</span>
          <span aria-hidden="true">
            {trimmed.length}/{MAX_LENGTH}
          </span>
        </div>
      </div>
    </form>
  );
}