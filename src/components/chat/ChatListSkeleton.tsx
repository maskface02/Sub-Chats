export function ChatListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <ul className="space-y-1" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <li key={i}>
          <div className="rounded-md px-3 py-2">
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted/70" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function MessageListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6"
      aria-hidden="true"
    >
      {Array.from({ length: rows }).map((_, i) => {
        const isUser = i % 2 === 0;
        return (
          <div
            key={i}
            className={`flex ${isUser ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`h-9 w-2/3 animate-pulse rounded-2xl sm:w-1/2 ${
                isUser ? "bg-muted" : "bg-muted/70"
              }`}
            />
          </div>
        );
      })}
    </div>
  );
}