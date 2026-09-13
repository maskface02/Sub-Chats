"use client";

import { useTransition } from "react";
import { createChatAction } from "@/lib/api-client/auth";
import { Button } from "@/components/ui/button";

export interface NewChatButtonProps {
  className?: string;
  fullWidth?: boolean;
}

export function NewChatButton({ className, fullWidth = true }: NewChatButtonProps) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => createChatAction())}
      aria-busy={pending}
      className={fullWidth ? `w-full ${className ?? ""}` : className}
    >
      {pending ? "Creating…" : "+ New chat"}
    </Button>
  );
}