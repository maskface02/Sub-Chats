"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LogOut, Settings2, UserRound } from "lucide-react";
import { signOutAction } from "@/lib/api-client/auth";
import { cn } from "@/lib/utils";

export interface UserMenuProps {
  email: string;
  name?: string | null;
  guestMode?: boolean;
  variant?: "sidebar" | "compact";
}

export function UserMenu({
  email,
  name,
  guestMode = false,
  variant = "compact",
}: UserMenuProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const displayName = name || (guestMode ? "Guest workspace" : email.split("@")[0]);
  const initials = displayName
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const handleSignOut = () => {
    setError(null);
    startTransition(async () => {
      try {
        await signOutAction();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not sign out");
      }
    });
  };

  if (variant === "sidebar") {
    return (
      <div className="flex items-center gap-2 rounded-2xl p-1">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-primary">
          {initials || <UserRound className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold text-foreground">
            {displayName}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {email}
          </span>
        </span>
        <Link
          href="/settings/providers"
          aria-label="Settings"
          title="Settings"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Settings2 className="h-4 w-4" />
        </Link>
        {guestMode ? null : (
          <button
            type="button"
            onClick={handleSignOut}
            disabled={pending}
            aria-label="Sign out"
            title={error ?? "Sign out"}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          title={error ?? undefined}
          className={cn(
            "flex h-10 items-center gap-2 rounded-2xl px-1.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
          )}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-violet-400 text-xs font-bold text-primary-foreground shadow-sm">
            {initials || <UserRound className="h-4 w-4" />}
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[220px] animate-soft-pop rounded-2xl border border-border/80 bg-popover/95 p-1.5 text-popover-foreground shadow-xl shadow-foreground/10 backdrop-blur-xl"
        >
          <div className="px-2.5 py-2">
            <p className="truncate text-xs font-semibold">{displayName}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item asChild>
            <Link
              href="/settings/providers"
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent"
            >
              <Settings2 className="h-4 w-4 text-muted-foreground" />
              Settings
            </Link>
          </DropdownMenu.Item>
          {guestMode ? null : (
            <DropdownMenu.Item
              disabled={pending}
              onSelect={handleSignOut}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm outline-none transition-colors hover:bg-accent focus:bg-accent data-[disabled]:opacity-50"
            >
              <LogOut className="h-4 w-4 text-muted-foreground" />
              {pending ? "Signing out…" : "Sign out"}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
