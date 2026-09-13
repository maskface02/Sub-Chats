"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ChatError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("chat route error", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-lg font-semibold">Could not load conversation</h2>
      <p className="max-w-sm text-sm text-muted-foreground">
        Something went wrong while loading this chat.
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => reset()}>
          Retry
        </Button>
        <Button asChild size="sm">
          <Link href="/">Back to chats</Link>
        </Button>
      </div>
    </div>
  );
}