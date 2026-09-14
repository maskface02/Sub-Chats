"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Group,
  Panel,
  Separator,
} from "react-resizable-panels";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getChat } from "@/lib/api-client/chats";
import { ApiError } from "@/lib/api-client/base";
import type { Conversation } from "@/lib/api-client/types";
import { useSplit } from "@/lib/state/split";
import { ChatView } from "@/components/chat/ChatView";
import {
  TreeQueryScope,
} from "@/components/tree/useConversationTree";
import { cn } from "@/lib/utils";

/**
 * Split-state-aware chat area: renders the standalone ChatView normally and
 * the resizable two-pane SplitView when the split store is open.
 */
export function SplitChatArea({ conversation }: { conversation: Conversation }) {
  const split = useSplit();
  const router = useRouter();

  // Split is client-state only and scoped to the current conversation; a
  // navigation to a different conversation (back/forward, URL entry) while a
  // split from another conversation is open would leave a stale pane — close.
  useEffect(() => {
    if (split.splitOpen && split.primaryId !== conversation.id) {
      split.closeSplit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  if (split.splitOpen && split.primaryId === conversation.id && split.secondaryId) {
    return (
      <TreeQueryScope>
        <SplitView primary={conversation} secondaryId={split.secondaryId} />
      </TreeQueryScope>
    );
  }
  return (
    <>
      <ChatView conversation={conversation} />
    </>
  );
}

export function SplitView({
  primary,
  secondaryId,
}: {
  primary: Conversation;
  secondaryId: string;
}) {
  const split = useSplit();
  const router = useRouter();
  const secondaryRef = useRef<HTMLDivElement | null>(null);
  const primaryRef = useRef<HTMLDivElement | null>(null);

  const closePane = (closingPane: 1 | 2) => {
    if (closingPane === 1) {
      // Closing the primary pane: navigate the URL to the survivor per
      // US-206 AC.3, then drop the split entirely.
      split.closeSplit();
      router.push(`/c/${encodeURIComponent(secondaryId)}`);
      return;
    }
    split.closeSplit();
    // US-206 a11y: after closing the secondary, move focus to the
    // surviving pane's heading (post-commit; primaryRef is detached).
    setTimeout(() => {
      document
        .querySelector<HTMLHeadingElement>('[data-chat-pane="1"] h1')
        ?.focus();
    }, 100);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Group
        orientation={split.orientation}
        className="min-h-0 flex-1"
        aria-label="Split panes"
      >
        <Panel defaultSize="50" minSize="25">
          <PaneFrame
            paneIndex={1}
            conversationId={primary.id}
            fallbackConversation={primary}
            containerRef={primaryRef}
            onClose={() => closePane(1)}
          />
        </Panel>
        <Separator
          className={cn(
            "flex items-center justify-center bg-border",
            split.orientation === "horizontal"
              ? "w-1 hover:bg-ring"
              : "h-1 hover:bg-ring",
            "data-[active]:bg-ring",
          )}
          aria-label="Resize panes"
        >
          <span
            aria-hidden="true"
            className={cn(
              "rounded-full bg-foreground/30",
              split.orientation === "horizontal"
                ? "h-8 w-0.5"
                : "h-0.5 w-8",
            )}
          />
        </Separator>
        <Panel defaultSize="50" minSize="25">
          <PaneFrame
            paneIndex={2}
            conversationId={secondaryId}
            fallbackConversation={undefined}
            containerRef={secondaryRef}
            onClose={() => closePane(2)}
          />
        </Panel>
      </Group>
      <div className="flex items-center justify-end border-t px-3 py-1.5">
        <button
          type="button"
          onClick={split.toggleOrientation}
          className="rounded text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {split.orientation === "horizontal" ? "Stack panes" : "Side by side"}
        </button>
      </div>
    </div>
  );

}

function PaneFrame({
  paneIndex,
  conversationId,
  fallbackConversation,
  containerRef,
  onClose,
}: {
  paneIndex: 1 | 2;
  conversationId: string;
  /** Only pane 1 has the server-fetched conversation for an instant render. */
  fallbackConversation?: Conversation;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const split = useSplit();
  const isActive = split.activePane === paneIndex;
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<Conversation>([
    "chat-detail",
    conversationId,
  ]);
  const paneTitle =
    fallbackConversation?.id === conversationId
      ? fallbackConversation.title
      : cached?.title ?? "conversation";

  return (
    <div
      ref={containerRef}
      role="region"
      aria-label={`Chat pane ${paneIndex}: ${paneTitle}`}
      data-chat-pane={paneIndex}
      className={cn(
        "flex h-full min-h-0 flex-col",
        isActive
          ? "outline outline-1 outline-ring"
          : "",
      )}
      onFocusCapture={() => split.setActivePane(paneIndex)}
      onMouseDown={() => split.setActivePane(paneIndex)}
    >
      <div className="flex h-8 items-center justify-between border-b px-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {isActive ? "Active" : "Pane " + paneIndex}
        </span>
        <button
          type="button"
          aria-label={`Close pane: ${paneTitle}`}
          onClick={onClose}
          className="rounded px-1 text-sm text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          ×
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <PaneConversation
          conversationId={conversationId}
          fallbackConversation={fallbackConversation}
          paneIndex={paneIndex}
        />
      </div>
    </div>
  );
}

function PaneConversation({
  conversationId,
  fallbackConversation,
  paneIndex,
}: {
  conversationId: string;
  fallbackConversation?: Conversation;
  paneIndex: 1 | 2;
}) {
  const needsFetch =
    !fallbackConversation || fallbackConversation.id !== conversationId;

  if (needsFetch) {
    return <FetchedPane conversationId={conversationId} paneIndex={paneIndex} />;
  }
  return (
    <ChatView
      key={fallbackConversation!.id}
      conversation={fallbackConversation}
      pane={{ index: paneIndex }}
    />
  );
}

function FetchedPane({
  conversationId,
  paneIndex,
}: {
  conversationId: string;
  paneIndex: 1 | 2;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["chat-detail", conversationId],
    queryFn: () => getChat(conversationId),
    staleTime: 5_000,
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex w-full max-w-3xl flex-col gap-6 p-6" aria-busy="true">
          {range(6).map((i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className={cn("h-16 rounded-2xl bg-muted", i % 2 ? "ml-auto w-2/3" : "w-2/3")} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div role="alert" className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-sm text-destructive">
          {notFound
            ? "Conversation not found"
            : "Could not load this conversation"}
        </p>
      </div>
    );
  }

  return (
    <ChatView
      key={data!.id}
      conversation={data}
      pane={{ index: paneIndex }}
    />
  );
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}