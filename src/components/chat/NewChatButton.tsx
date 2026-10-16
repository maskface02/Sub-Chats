"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { createChat } from "@/lib/api-client/chats";
import { showToast } from "@/components/chat/toast";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export interface NewChatButtonProps {
  className?: string;
  fullWidth?: boolean;
}

export function NewChatButton({ className, fullWidth = true }: NewChatButtonProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleCreate = () => {
    startTransition(async () => {
      try {
        const chat = await createChat();
        router.push(`/c/${encodeURIComponent(chat.id)}`);
      } catch {
        showToast({ message: "Could not create a conversation — try again", role: "alert" });
      }
    });
  };

  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={handleCreate}
      aria-busy={pending}
      aria-label="New chat"
      className={
        fullWidth
          ? `h-10 w-full justify-start rounded-lg px-3.5 shadow-none ${className ?? ""}`
          : className
      }
    >
      <span className="flex items-center gap-2">
        <Plus className="h-4 w-4" />
        {pending ? "Creating…" : "New chat"}
      </span>
    </Button>
  );
}
