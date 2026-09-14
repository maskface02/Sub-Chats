"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import { getConversationTree } from "@/lib/api-client/tree";
import type { TreeResponse } from "@/lib/api-client/types";

/**
 * Local, per-mount TanStack Query client. The app has no global
 * QueryClientProvider yet; this scopes the client to the tree surfaces
 * (sidebar, picker) so invalidation is predictable and no provider change
 * bleeds into phase 1 flows.
 */
export function TreeQueryScope({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  useRegisterQueryClient(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function useConversationTree(
  rootId: string | null,
): UseQueryResult<TreeResponse> {
  return useQuery({
    queryKey: ["tree", rootId],
    queryFn: () => getConversationTree(rootId as string),
    enabled: rootId !== null,
    staleTime: 30_000,
  });
}

/**
 * Invalidate the tree cache after a successful branch creation.
 * Omits `rootId` when the caller only knows its own conversation id —
 * the branch is always within the caller's root, so all known tree
 * queries (≤ 1 mounted sidebar) are invalidated.
 */
export function invalidateTree(rootId?: string | null): void {
  for (const client of queryClients.values()) {
    void client.invalidateQueries({
      queryKey: rootId ? ["tree", rootId] : ["tree"],
    });
  }
}

const queryClients = new Set<QueryClient>();

export function useRegisterQueryClient(client: QueryClient | null): void {
  useEffect(() => {
    if (client) queryClients.add(client);
    return () => {
      if (client) queryClients.delete(client);
    };
  }, [client]);
}
