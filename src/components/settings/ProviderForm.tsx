"use client";

import { useState, type FormEvent } from "react";
import { createProvider, updateProvider } from "@/lib/api-client/providers";
import { ApiError } from "@/lib/api-client/base";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import Link from "next/link";
import { NVIDIA_BASE_URL, NVIDIA_MODEL, isNvidiaEndpoint } from "@/lib/ai/nvidia";
import type {
  ProviderCreateBody,
  ProviderDto,
  ProviderTypeDto,
  ProviderUpdateBody,
} from "@/lib/api-client/types";

export interface ProviderFormProps {
  /** Present = edit this row; absent = add a new provider. */
  provider?: ProviderDto | null;
  onSaved: (created: boolean) => void;
  onCancel: () => void;
  onError: (message: string) => void;
}

type Field = "baseUrl" | "apiKey" | "defaultModel";
const PROVIDER_CHOICES = [
  ["openai", "OpenAI"],
  ["anthropic", "Anthropic"],
  ["nvidia", "NVIDIA NIM"],
  ["ollama", "Ollama"],
  ["custom", "Custom endpoint"],
] as const;

const TYPE_DEFAULT_MODEL: Record<
  Exclude<ProviderCreateBody["type"], undefined>,
  string
> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  ollama: "llama3.2",
  custom: "e.g. my-model",
};

const TYPE_PLACEHOLDER: Record<Field, Record<string, string>> = {
  baseUrl: {
    ollama: "http://localhost:11434/v1",
    custom: "https://my-endpoint.example.com/v1",
  },
  apiKey: {
    openai: "sk-…",
    anthropic: "sk-ant-…",
    custom: "Optional API key for the remote endpoint",
  },
  defaultModel: TYPE_DEFAULT_MODEL as unknown as Record<string, string>,
};

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function ProviderForm({
  provider,
  onSaved,
  onCancel,
  onError,
}: ProviderFormProps) {
  const editing = provider !== null && provider !== undefined;
  const [type, setType] = useState<ProviderCreateBody["type"]>(
    provider?.type ?? "openai",
  );
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? "");
  const [choice, setChoice] = useState<string>(
    provider?.type === "custom" && isNvidiaEndpoint(provider.baseUrl) ? "nvidia" : provider?.type ?? "openai",
  );
  const [apiKey, setApiKey] = useState("");
  const [defaultModel, setDefaultModel] = useState(
    provider?.defaultModel ?? "",
  );
  const [errors, setErrors] = useState<Partial<Record<Field | "form", string>>>({});
  const [saving, setSaving] = useState(false);

  const showsBaseUrl = type === "ollama" || type === "custom";
  const showsApiKey = type === "openai" || type === "anthropic" || type === "custom";

  const setError = (field: Field | "form", message: string) =>
    setErrors((prev) => ({ ...prev, [field]: message }));

  const clearErrors = () => setErrors({});

  function validate(): boolean {
    let ok = true;

    if (showsBaseUrl) {
      const url = baseUrl.trim();
      if (!url) {
        setError("baseUrl", "baseUrl is required for this provider type");
        ok = false;
      } else if (!isValidHttpUrl(url)) {
        setError("baseUrl", "baseUrl must be a valid http/https URL");
        ok = false;
      }
    }

    if (showsApiKey) {
      const key = apiKey.trim();
      // Edit with an empty key = keep the existing key (US-306 AC.3).
      if (!key && !editing) {
        setError("apiKey", "apiKey is required for this provider type");
        ok = false;
      }
    }

    const model = defaultModel.trim();
    if (model.length > 200) {
      setError("defaultModel", "defaultModel must be 200 characters or fewer");
      ok = false;
    } else if (!model && (type === "ollama" || type === "custom")) {
      setError("defaultModel", "defaultModel is required for this provider type");
      ok = false;
    }

    return ok;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearErrors();
    if (!validate()) return;

    setSaving(true);
    try {
      if (editing && provider) {
        const body: ProviderUpdateBody = {};
        if (showsBaseUrl) body.baseUrl = baseUrl.trim();
        if (showsApiKey && apiKey.trim()) body.apiKey = apiKey.trim();
        if (defaultModel.trim()) body.defaultModel = defaultModel.trim();
        await updateProvider(provider.id, body);
      } else {
        const body: ProviderCreateBody = { type };
        if (showsBaseUrl) body.baseUrl = baseUrl.trim();
        if (showsApiKey && apiKey.trim()) body.apiKey = apiKey.trim();
        if (defaultModel.trim()) body.defaultModel = defaultModel.trim();
        await createProvider(body);
      }
      onSaved(!editing);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("form", "Your session has expired. Sign in again before saving your provider.");
      } else if (err instanceof ApiError && err.fields) {
        const mapped: Partial<Record<Field | "form", string>> = {};
        (Object.keys(err.fields) as Array<keyof typeof err.fields>).forEach((f) => {
          const key = f as Field;
          if (showsBaseUrl && key === "baseUrl") mapped.baseUrl = err.fields![f];
          else if (showsApiKey && key === "apiKey") mapped.apiKey = err.fields![f];
          else if (key === "defaultModel") mapped.defaultModel = err.fields![f];
          else mapped.form = err.fields![f];
        });
        setErrors(mapped);
      } else {
        onError(
          err instanceof ApiError && err.code === "PROVIDER_LIMIT"
            ? "You can store up to 10 providers"
            : "Could not save provider — try again",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      className="rounded-lg border bg-card p-4 shadow-sm"
      onSubmit={handleSubmit}
      noValidate
      aria-busy={saving}
      data-testid="provider-form"
    >
      <h3 className="mb-3 text-sm font-semibold">
        {editing ? `Edit ${provider?.type} provider` : "Add provider"}
      </h3>

      {!editing ? (
        <fieldset className="mb-4" disabled={saving}>
          <legend className="mb-2 text-sm font-medium">Provider</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PROVIDER_CHOICES.map(([value, label]) => (
              <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-ring ${choice === value ? "border-primary bg-primary/5 text-primary" : "border-input hover:bg-muted"}`}>
                <input
                  type="radio"
                  name="providerType"
                  value={value}
                  checked={choice === value}
                  onChange={() => {
                    setChoice(value);
                    setType(value === "nvidia" ? "custom" : value);
                    setBaseUrl(value === "nvidia" ? NVIDIA_BASE_URL : "");
                    setDefaultModel(value === "nvidia" ? NVIDIA_MODEL : "");
                    setApiKey("");
                    setErrors({});
                  }}
                  className="accent-primary"
                />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Choose a provider before entering its key. Switching providers clears the key for safety.</p>
        </fieldset>
      ) : (
        <div className="mb-3 text-sm">
          <span className="text-muted-foreground">Type: </span>
          <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold uppercase">
            {provider?.type}
          </span>
        </div>
      )}

      <p role="status" className="sr-only">
        {showsBaseUrl
          ? "Base URL field shown"
          : "Base URL field hidden"}
      </p>

      {type === "custom" && isNvidiaEndpoint(baseUrl) ? (
        <p className="mb-3 text-xs text-muted-foreground">
          NVIDIA's OpenAI-compatible endpoint. Enter your NVIDIA API key below.
          Keys are encrypted on the server. Trial access and rate limits are managed by NVIDIA.
        </p>
      ) : null}

      {showsBaseUrl ? (
        <div className="mb-3">
          <Label htmlFor="p-baseurl">Base URL</Label>
          <Input
            id="p-baseurl"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={TYPE_PLACEHOLDER.baseUrl[type] ?? ""}
            autoComplete="off"
            aria-invalid={Boolean(errors.baseUrl)}
            aria-describedby={errors.baseUrl ? "p-baseurl-error" : undefined}
            className="mt-1"
          />
          {errors.baseUrl ? (
            <p id="p-baseurl-error" role="alert" className="mt-1 text-xs text-destructive">
              {errors.baseUrl}
            </p>
          ) : null}
        </div>
      ) : null}

      {showsApiKey ? (
        <div className="mb-3">
          <Label htmlFor="p-apikey">
            {editing ? "API key (leave empty to keep existing)" : "API key"}
          </Label>
          {editing && provider?.apiKeyHint ? (
            <p className="text-xs text-muted-foreground">
              Stored key: <code>{provider.apiKeyHint}</code>
            </p>
          ) : null}
          <Input
            id="p-apikey"
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={editing ? "•••• (unchanged)" : TYPE_PLACEHOLDER.apiKey[type] ?? ""}
            aria-invalid={Boolean(errors.apiKey)}
            aria-describedby={
              (errors.apiKey ? "p-apikey-error " : "") +
              (errors.apiKey ? "" : "p-apikey-hint")
            }
            className="mt-1"
          />
          {errors.apiKey ? (
            <p id="p-apikey-error" role="alert" className="mt-1 text-xs text-destructive">
              {errors.apiKey}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mb-3">
        <Label htmlFor="p-model">
          {type === "ollama" || type === "custom"
            ? "Model ID (required)"
            : `Model ID (default: ${TYPE_DEFAULT_MODEL[type]})`}
        </Label>
        <Input
          id="p-model"
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          placeholder={TYPE_DEFAULT_MODEL[type]}
          maxLength={200}
          aria-invalid={Boolean(errors.defaultModel)}
          aria-describedby={errors.defaultModel ? "p-model-error" : undefined}
          className="mt-1"
        />
        {errors.defaultModel ? (
          <p id="p-model-error" role="alert" className="mt-1 text-xs text-destructive">
            {errors.defaultModel}
          </p>
        ) : null}
      </div>

      {errors.form ? (
        <p role="alert" className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {errors.form}
          {errors.form.startsWith("Your session has expired") ? (
            <Link href="/signin" className="ml-2 underline">Sign in</Link>
          ) : null}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving} aria-busy={saving}>
          {saving ? "Saving…" : editing ? "Save changes" : "Add provider"}
        </Button>
      </div>
    </form>
  );
}
