"use client";

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { StopButton } from "./StopButton";
import { cn } from "@/lib/utils";
import { ArrowUp, CornerDownLeft } from "lucide-react";

export interface ComposerProps {
  onSend: (content: string) => void | boolean | Promise<void | boolean>;
  disabled?: boolean;
  statusLabel?: string | null;
  className?: string;
  placeholder?: string;
  recoveredDraft?: string;
  draftKey?: string;
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
  recoveredDraft,
  draftKey,
  streaming = false,
  onStop,
}: ComposerProps) {
  const [value, setValue] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [loadedDraftKey, setLoadedDraftKey] = useState<string>();

  useEffect(() => {
    if (!draftKey) return;
    try {
      setValue(sessionStorage.getItem(draftKey) ?? "");
    } catch {
      // Storage may be unavailable; the composer must remain usable.
    }
    setLoadedDraftKey(draftKey);
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || loadedDraftKey !== draftKey) return;
    try {
      if (value) sessionStorage.setItem(draftKey, value);
      else sessionStorage.removeItem(draftKey);
    } catch {}
  }, [draftKey, loadedDraftKey, value]);

  useEffect(() => {
    if (recoveredDraft) setValue((current) => current || recoveredDraft);
  }, [recoveredDraft]);

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
    setValue("");
    void Promise.resolve(onSend(trimmed)).then((sent) => {
      if (sent === false) {
        // Keep a failed prompt available without overwriting any new draft.
        setValue((current) => current || trimmed);
      }
    });
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
        "relative shrink-0 bg-gradient-to-t from-background via-background to-transparent px-4 pb-4 pt-3 sm:px-6 sm:pb-5",
        className,
      )}
      aria-label="Message composer"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-2">
        <div className="group flex items-end gap-2 rounded-[1.35rem] border border-border/80 bg-card/90 p-2 pl-4 shadow-lg shadow-foreground/[0.055] backdrop-blur-xl transition-all duration-200 focus-within:border-primary/35 focus-within:shadow-xl focus-within:shadow-primary/[0.08] focus-within:ring-4 focus-within:ring-primary/[0.06]">
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
            className="min-h-10 flex-1 resize-none bg-transparent py-2 text-[14px] leading-6 outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-60"
          />
          {streaming && onStop ? (
            <StopButton onStop={handleStop} />
          ) : (
            <Button
              type="submit"
              size="sm"
              disabled={!canSend}
              aria-label="Send message"
              className="h-10 w-10 shrink-0 rounded-2xl p-0"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.4} />
              <span className="sr-only">Send</span>
            </Button>
          )}
        </div>
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground/80">
          {statusLabel ? (
            <span className="font-medium text-primary">{statusLabel}</span>
          ) : (
            <>
              <span>Press</span>
              <span className="inline-flex items-center gap-1 rounded-md border bg-card/70 px-1.5 py-0.5 font-medium text-foreground/70">
                <CornerDownLeft className="h-2.5 w-2.5" /> Enter
              </span>
              <span>to send · Shift + Enter for a new line</span>
            </>
          )}
          {trimmed.length > MAX_LENGTH * 0.8 ? (
            <span aria-hidden="true" className="ml-auto">
              {trimmed.length}/{MAX_LENGTH}
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}
