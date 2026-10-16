"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listProviders, updateProvider } from "@/lib/api-client/providers";
import { Button } from "@/components/ui/button";
import { ProviderForm } from "./ProviderForm";
import { DeleteProviderDialog } from "./DeleteProviderDialog";
import type { ProviderDto } from "@/lib/api-client/types";

type LoadState = "loading" | "error" | "ready";

interface Toast {
  kind: "success" | "error";
  text: string;
}

const PROVIDER_LIMIT = 10;

export function ProviderList() {
  const [items, setItems] = useState<ProviderDto[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProviderDto | null>(null);
  const [deleting, setDeleting] = useState<ProviderDto | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = useCallback((next: Toast) => {
    setToast(next);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await listProviders();
      setItems(res.items);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useCallback(async () => {
    try {
      const res = await listProviders();
      setItems(res.items);
    } catch {
      showToast({ kind: "error", text: "Could not refresh the provider list" });
    }
  }, [showToast]);

  const handleSetDefault = async (provider: ProviderDto) => {
    setBusyId(provider.id);
    try {
      await updateProvider(provider.id, { isDefault: true });
      const res = await listProviders();
      setItems(res.items);
      showToast({ kind: "success", text: `Default provider set to ${provider.type}` });
    } catch {
      showToast({ kind: "error", text: "Could not set default — try again" });
      // previous selection stays active: nothing changed locally
    } finally {
      setBusyId(null);
    }
  };

  const handleSaved = (_created: boolean) => {
    setAdding(false);
    setEditing(null);
    showToast({ kind: "success", text: "Provider saved" });
    refetch();
  };

  const handleDeleted = (deleted: boolean, error?: string) => {
    const wasDeleting = deleting;
    setDeleting(null);
    if (error) {
      showToast({ kind: "error", text: error });
      return;
    }
    if (deleted && wasDeleting) {
      showToast({ kind: "success", text: "Provider deleted" });
      refetch();
    }
  };

  const closeForm = useCallback(() => {
    setAdding(false);
    setEditing(null);
  }, []);

  if (state === "loading") {
    return (
      <section aria-busy="true" data-testid="providers-loading">
        <div className="mb-4 h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </section>
    );
  }

  if (state === "error") {
    return (
      <section data-testid="providers-error">
        <p role="alert" className="text-sm text-destructive">
          Could not load providers
        </p>
        <Button type="button" variant="outline" size="sm" onClick={load} className="mt-2">
          Retry
        </Button>
      </section>
    );
  }

  const hasDefault = items.some((p) => p.isDefault);
  const limitReached = items.length >= PROVIDER_LIMIT;
  const formOpen = adding || editing !== null;

  return (
    <section aria-label="AI providers" data-testid="providers-list">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your providers</h2>
        {!formOpen ? (
          <div>
            <Button
              type="button"
              size="sm"
              onClick={() => setAdding(true)}
              disabled={limitReached}
            >
              Add provider
            </Button>
            {limitReached ? (
              <p className="mt-1 text-right text-xs text-muted-foreground">
                Provider limit reached ({PROVIDER_LIMIT})
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {!hasDefault ? (
        <p
          className="mb-4 rounded-xl border border-primary/10 bg-primary/[0.05] px-3.5 py-2.5 text-xs text-muted-foreground"
          data-testid="env-default-indicator"
        >
          Using server default (environment)
        </p>
      ) : null}

      {items.length === 0 && !formOpen ? (
        <div className="rounded-2xl border border-dashed bg-muted/25 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-foreground">
            No custom providers. You&apos;re using the server default (environment).
          </p>
          <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
            You&apos;re using the server default. Add a provider to choose your own model and key.
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <ul className="space-y-2">
          {items.map((p) => (
            <li
              key={p.id}
              data-testid="provider-row"
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/60 px-4 py-3 shadow-sm transition-colors hover:border-primary/20"
            >
              <div className="flex min-w-0 items-center gap-3">
                <fieldset className="w-14">
                  <legend className="sr-only">Default provider</legend>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="radio"
                      name="defaultProvider"
                      value={p.id}
                      checked={p.isDefault}
                      onChange={() => handleSetDefault(p)}
                      disabled={busyId === p.id}
                      aria-busy={busyId === p.id}
                      className="h-3.5 w-3.5"
                    />
                    {p.isDefault ? (
                      <span className="font-semibold">default</span>
                    ) : (
                      <span className="sr-only">set default</span>
                    )}
                  </label>
                </fieldset>
                <span
                  className="rounded-lg bg-secondary px-2.5 py-1 text-[11px] font-semibold uppercase text-secondary-foreground dark:bg-muted/60"
                  aria-label={`Provider type ${p.type}`}
                >
                  {p.type}
                </span>
                <div className="min-w-0 text-xs text-muted-foreground">
                  {p.baseUrl ? <div className="truncate">{p.baseUrl}</div> : null}
                  {p.defaultModel ? (
                    <div className="truncate">model: {p.defaultModel}</div>
                  ) : null}
                  {p.apiKeyHint ? (
                    <div>key: {p.apiKeyHint}</div>
                  ) : null}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAdding(false);
                    setEditing(p);
                  }}
                  aria-label={`Edit ${p.type} provider`}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleting(p)}
                  aria-label={`Delete ${p.type} provider`}
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {formOpen ? (
        <div className="mt-4">
          <ProviderForm
            provider={editing}
            onSaved={handleSaved}
            onCancel={closeForm}
            onError={(message) =>
              showToast({ kind: "error", text: message })
            }
          />
        </div>
      ) : null}

      {deleting ? (
        <DeleteProviderDialog provider={deleting} onClosed={handleDeleted} />
      ) : null}

      {toast ? (
        <div
          role={toast.kind === "error" ? "alert" : "status"}
          className={
            "fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-lg " +
            (toast.kind === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-card text-foreground")
          }
        >
          {toast.text}
        </div>
      ) : null}
    </section>
  );
}

function SkeletonRow() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
    >
      <div className="h-3.5 w-3.5 animate-pulse rounded-full bg-muted" />
      <div className="h-4 w-16 animate-pulse rounded bg-muted" />
      <div className="h-4 flex-1 animate-pulse rounded bg-muted" />
      <div className="h-4 w-12 animate-pulse rounded bg-muted" />
      <div className="h-4 w-14 animate-pulse rounded bg-muted" />
    </div>
  );
}
