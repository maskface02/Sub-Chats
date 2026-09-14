"use client";

import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

export interface ToastAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface ToastData {
  id: string;
  message: string;
  role?: "status" | "alert";
  ariaLabel?: string;
  action?: ToastAction;
  /** ms until auto-dismiss; default 5000 */
  duration?: number;
}

let toasts: ToastData[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function makeId(): string {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function showToast(
  toast: Omit<ToastData, "id"> & { id?: string },
): string {
  const id = toast.id ?? makeId();
  toasts = [...toasts, { ...toast, id }];
  emit();
  return id;
}

export function updateToast(
  id: string,
  patch: Partial<Omit<ToastData, "id">>,
): void {
  toasts = toasts.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const EMPTY: ToastData[] = [];
function getSnapshot(): ToastData[] {
  return toasts;
}
function getServerSnapshot(): ToastData[] {
  return EMPTY;
}

/**
 * Global toast surface (role="status"/"alert" per phase-4 a11y notes).
 * Rendered once in the root layout so toasts survive client navigations
 * (e.g. the delete → navigate → undo flow).
 */
export function ToastHost() {
  const items = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex flex-col items-center gap-2 px-4">
      {items.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: ToastData }) {
  // Timer runs once from mount — phase updates (undo → "Deleted") must not
  // reset the auto-dismiss deadline.
  useEffect(() => {
    const t = setTimeout(() => dismissToast(toast.id), toast.duration ?? 5000);
    return () => clearTimeout(t);
  }, [toast.id, toast.duration]);

  return (
    <div
      role={toast.role ?? "status"}
      aria-label={toast.ariaLabel}
      data-testid="toast"
      className={cn(
        "pointer-events-auto flex max-w-md items-center gap-3 rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg",
      )}
    >
      <span>{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={toast.action.onClick}
          disabled={toast.action.disabled}
          className="shrink-0 rounded border px-2 py-0.5 text-xs font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  );
}
