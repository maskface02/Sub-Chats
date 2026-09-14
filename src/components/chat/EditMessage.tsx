"use client";

import { useRef, useState, type KeyboardEvent } from "react";

export interface EditSaveResult {
  ok: boolean;
  /** Inline field error shown under the textarea (422 INVALID_INPUT etc.). */
  error?: string;
}

export interface EditMessageProps {
  initialContent: string;
  onSave: (content: string) => Promise<EditSaveResult>;
  onCancel: () => void;
}

const MAX_LENGTH = 8000;

/**
 * Inline edit UI on user messages (US-407 AC.8): prefilled textarea,
 * Enter = Save, Shift+Enter = newline, Esc = Cancel, save shows
 * "Re-asking…" while the truncate-and-restream round-trip starts.
 */
export function EditMessage({ initialContent, onSave, onCancel }: EditMessageProps) {
  const [value, setValue] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= MAX_LENGTH && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setFieldError(null);
    const result = await onSave(trimmed);
    if (result.ok) return; // parent swaps the bubble for the streaming tail
    setSaving(false);
    setFieldError(result.error ?? "Could not save — try again");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (!saving) onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <div role="group" aria-label="Editing your message" className="w-full">
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={saving}
        rows={3}
        maxLength={MAX_LENGTH}
        aria-label="Edit message"
        autoFocus
        className="w-full resize-y rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
      />
      {fieldError ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {fieldError}
        </p>
      ) : null}
      <div className="mt-1 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border px-2 py-1 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!canSave}
          aria-busy={saving}
          className="rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Re-asking…" : "Save"}
        </button>
      </div>
    </div>
  );
}
