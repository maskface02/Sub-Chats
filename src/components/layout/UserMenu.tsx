"use client";

import { useTransition, useState } from "react";
import { signOutAction } from "@/lib/api-client/auth";
import { Button } from "@/components/ui/button";

export interface UserMenuProps {
  email: string;
  name?: string | null;
}

export function UserMenu({ email, name }: UserMenuProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = () => {
    setError(null);
    startTransition(async () => {
      try {
        await signOutAction();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Could not sign out";
        setError(message);
      }
    });
  };

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right text-xs leading-tight sm:block">
        {name ? (
          <div className="font-medium text-foreground">{name}</div>
        ) : null}
        <div className="text-muted-foreground">{email}</div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleSignOut}
        disabled={pending}
        aria-label="Sign out"
        aria-busy={pending}
        title={error ?? undefined}
      >
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}