import type { Metadata } from "next";
import { ToastHost } from "@/components/chat/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sub-chats",
  description: "AI chat with branching conversations",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background font-sans antialiased">
        {children}
        <ToastHost />
      </body>
    </html>
  );
}