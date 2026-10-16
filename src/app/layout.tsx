import type { Metadata } from "next";
import { ToastHost } from "@/components/chat/toast";
import { ThemeRuntime } from "@/components/settings/ThemeRuntime";
import { themeBootstrapScript } from "@/lib/theme";
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
      <head><script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} /></head>
      <body className="min-h-screen bg-background antialiased">
        <ThemeRuntime />
        {children}
        <ToastHost />
      </body>
    </html>
  );
}
