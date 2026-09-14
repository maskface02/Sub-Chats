"use client";

export interface RegenerateButtonProps {
  onRegenerate: () => void;
  disabled?: boolean;
  className?: string;
}

/** Regenerate affordance on the last assistant message (US-408 AC.7). */
export function RegenerateButton({
  onRegenerate,
  disabled = false,
  className,
}: RegenerateButtonProps) {
  return (
    <button
      type="button"
      onClick={onRegenerate}
      disabled={disabled}
      aria-label="Regenerate response"
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 1.5v3h-3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      Regenerate
    </button>
  );
}
