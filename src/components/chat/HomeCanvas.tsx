"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  ArrowUpRight,
  GitBranch,
  Lightbulb,
  Code2,
  PenLine,
  Loader2,
} from "lucide-react";
import { createChat } from "@/lib/api-client/chats";
import { setPendingQuestion } from "@/lib/state/pending-question";

const suggestions = [
  {
    icon: Lightbulb,
    title: "Untangle an idea",
    prompt:
      "Help me think through an idea. Ask me a few questions to get started.",
  },
  {
    icon: Code2,
    title: "Build something",
    prompt:
      "I want to build something. Help me turn my idea into a practical plan.",
  },
  {
    icon: PenLine,
    title: "Find the right words",
    prompt:
      "Help me write something clearly. Ask me about the audience and what I want to say.",
  },
];

export function HomeCanvas({ providerReady, draftKey }: { providerReady: boolean; draftKey: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    try {
      setValue(sessionStorage.getItem(draftKey) ?? "");
    } catch {}
  }, [draftKey]);
  const update = (next: string) => {
    setValue(next);
    try {
      sessionStorage.setItem(draftKey, next);
    } catch {}
  };
  const submit = () => {
    if (!value.trim() || pending || !providerReady) return;
    setError("");
    startTransition(async () => {
      try {
        const chat = await createChat();
        setPendingQuestion(chat.id, value.trim());
        try {
          sessionStorage.removeItem(draftKey);
        } catch {}
        router.push(`/c/${chat.id}`);
      } catch {
        setError(
          "Couldn't start the conversation. Your draft is safe — try again.",
        );
      }
    });
  };
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <header className="flex h-20 shrink-0 items-center justify-between px-6 sm:px-10">
        <span className="text-xs font-medium text-muted-foreground">
          Your workspace
        </span>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={`h-1.5 w-1.5 rounded-full ${providerReady ? "bg-emerald-500" : "bg-amber-500"}`}
          />
          {providerReady ? "Ready to chat" : "Setup needed"}
        </span>
      </header>
      <div className="mx-auto flex w-full max-w-[800px] flex-1 flex-col justify-center px-6 pb-14 pt-8 sm:px-10">
        <div className="animate-enter">
          <span className="mb-6 inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/5 text-primary">
            <GitBranch size={23} strokeWidth={1.6} />
          </span>
          <p className="mb-3 text-xs font-medium text-muted-foreground">
            SPACE TO THINK
          </p>
          <h1 className="text-4xl font-medium leading-[1.12] tracking-[-0.045em] sm:text-[48px]">
            Where will your
            <br />
            <span className="text-primary">curiosity take you?</span>
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-6 text-muted-foreground">
            Start with a question. Follow the interesting parts.
            <br className="hidden sm:block" /> Every branch keeps the context,
            so you can keep exploring.
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="mt-8 rounded-2xl border border-input bg-card p-4 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.10)] transition-shadow focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10"
        >
          <textarea
            ref={input}
            aria-label="Start a conversation"
            placeholder="What’s on your mind?"
            value={value}
            maxLength={8000}
            onChange={(e) => update(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                submit();
              }
            }}
            rows={3}
            className="w-full resize-none bg-transparent text-[15px] leading-6 outline-none placeholder:text-muted-foreground/75"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-muted-foreground">
              {pending
                ? "Opening your conversation…"
                : "Enter to send · Shift + Enter for a new line"}
            </span>
            <button
              type="submit"
              aria-label="Send message"
              disabled={!value.trim() || pending || !providerReady}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
            >
              {pending ? (
                <Loader2 size={17} className="animate-spin" />
              ) : (
                <ArrowUp size={18} />
              )}
            </button>
          </div>
        </form>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {!providerReady && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-2.5 text-xs">
            <span className="text-muted-foreground">
              Connect an AI provider to send your first message.
            </span>
            <Link
              href="/settings/providers"
              className="inline-flex items-center gap-1 font-semibold text-primary"
            >
              Connect provider <ArrowUpRight size={13} />
            </Link>
          </div>
        )}
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          {suggestions.map(({ icon: Icon, title, prompt }) => (
            <button
              key={title}
              onClick={() => {
                update(prompt);
                input.current?.focus();
              }}
              className="group flex items-center gap-2.5 rounded-xl border border-border/70 px-3 py-3 text-left text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.03] hover:text-foreground"
            >
              <Icon size={15} strokeWidth={1.7} />
              <span className="flex-1">{title}</span>
              <ArrowUpRight
                size={12}
                className="opacity-40 group-hover:opacity-100"
              />
            </button>
          ))}
        </div>
        <p className="mt-8 text-center text-[11px] text-muted-foreground/80">
          A new direction never has to mean starting over.
        </p>
      </div>
    </div>
  );
}
