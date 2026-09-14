"use client";

import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { exportChat } from "@/lib/api-client/chats";
import { ApiError } from "@/lib/api-client/base";
import { showToast } from "./toast";

export interface ExportMenuItemsProps {
  conversationId: string;
}

const MENU_ITEM_CLASS =
  "flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-sm outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50";

/**
 * "Export as Markdown" / "Export as JSON" header-menu items (US-403 AC.6):
 * blob download without navigation, per-item spinner while in flight,
 * failure toast. A 404 is left to the pane's existing not-found surface.
 */
export function ExportMenuItems({ conversationId }: ExportMenuItemsProps) {
  const [pendingFormat, setPendingFormat] = useState<"md" | "json" | null>(null);

  const run = async (format: "md" | "json") => {
    if (pendingFormat) return;
    setPendingFormat(format);
    try {
      const { blob, filename } = await exportChat(conversationId, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      const notFound = err instanceof ApiError && err.status === 404;
      if (!notFound) {
        showToast({ message: "Could not export — try again", role: "alert" });
      }
    } finally {
      setPendingFormat(null);
    }
  };

  return (
    <>
      <DropdownMenu.Item
        className={MENU_ITEM_CLASS}
        disabled={pendingFormat !== null}
        aria-busy={pendingFormat === "md" ? "true" : undefined}
        onSelect={() => void run("md")}
      >
        Export as Markdown
        {pendingFormat === "md" ? <ItemSpinner /> : null}
      </DropdownMenu.Item>
      <DropdownMenu.Item
        className={MENU_ITEM_CLASS}
        disabled={pendingFormat !== null}
        aria-busy={pendingFormat === "json" ? "true" : undefined}
        onSelect={() => void run("json")}
      >
        Export as JSON
        {pendingFormat === "json" ? <ItemSpinner /> : null}
      </DropdownMenu.Item>
    </>
  );
}

function ItemSpinner() {
  return (
    <span
      aria-hidden="true"
      className="ml-auto h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
    />
  );
}
