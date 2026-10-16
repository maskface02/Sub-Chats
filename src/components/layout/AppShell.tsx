import type { ReactNode } from "react";
import type { ProviderInfo } from "@/lib/api-client/types";
import { ProviderBanner } from "@/components/chat/ProviderBanner";

// Navigation lives in the shared layout and survives conversation changes.
export function AppShell({
  children,
  providerInfo,
}: {
  children: ReactNode;
  providerInfo: ProviderInfo;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProviderBanner provider={providerInfo} />
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
