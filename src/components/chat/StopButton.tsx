"use client";

import { Button } from "@/components/ui/button";

export interface StopButtonProps {
  onStop: () => void;
  className?: string;
}

/** Replaces the composer's send button while a response streams (US-405). */
export function StopButton({ onStop, className }: StopButtonProps) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={onStop}
      aria-label="Stop generating"
      className={`shrink-0 ${className ?? ""}`}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
      </svg>
      Stop
    </Button>
  );
}
