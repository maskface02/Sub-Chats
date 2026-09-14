"use client";

import { useEffect, useRef, useState } from "react";
import { deleteProvider } from "@/lib/api-client/providers";
import { Button } from "@/components/ui/button";
import type { ProviderDto } from "@/lib/api-client/types";

export interface DeleteProviderDialogProps {
  provider: ProviderDto;
  onClosed: (deleted: boolean, error?: string) => void;
}

export function DeleteProviderDialog({
  provider,
  onClosed,
}: DeleteProviderDialogProps) {
  const [pending, setPending] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLButtonElement>(
      "[data-autofocus]",
    );
    first?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClosed(false);
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        // Focus trap: cycle through focusable children.
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const firstEl = focusables[0];
        const lastEl = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleConfirm = async () => {
    setPending(true);
    try {
      await deleteProvider(provider.id);
      onClosed(true);
    } catch {
      setPending(false);
      onClosed(false, "Could not delete provider — try again");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-provider-title"
        className="mx-4 w-full max-w-sm rounded-lg border bg-card p-4 shadow-lg"
      >
        <h2 id="delete-provider-title" className="text-sm font-semibold">
          Delete provider{" "}
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold uppercase">
            {provider.type}
          </span>
          ?
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Delete provider {provider.type}? Chats will fall back to the server
          default.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onClosed(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={handleConfirm}
            disabled={pending}
            aria-busy={pending}
            data-autofocus
          >
            {pending ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}
