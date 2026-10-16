"use client";

import { useEffect, useState } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { readThemePreference, saveThemePreference, THEME_CHANGE_EVENT, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const options = [
  { value: "system", label: "System", detail: "Match your device", icon: Monitor, preview: "bg-[linear-gradient(120deg,#f5f3ed_50%,#181b2c_50%)]" },
  { value: "light", label: "Light", detail: "Warm and clear", icon: Sun, preview: "bg-[#f5f3ed]" },
  { value: "dark", label: "Dark", detail: "Easy on the eyes", icon: Moon, preview: "bg-[#181b2c]" },
] as const;

export function ThemeSelector() {
  const [theme, setTheme] = useState<ThemePreference>("system");

  useEffect(() => {
    const update = () => setTheme(readThemePreference());
    update();
    window.addEventListener("storage", update);
    window.addEventListener(THEME_CHANGE_EVENT, update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener(THEME_CHANGE_EVENT, update);
    };
  }, []);

  return (
    <fieldset aria-label="Theme" className="border-b border-border/70 pb-8">
      <legend className="text-lg font-semibold tracking-tight">Appearance</legend>
      <p className="mb-5 mt-1 text-sm leading-6 text-muted-foreground">
        Choose how Sub-chats looks. Your choice is saved on this device.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map(({ value, label, detail, icon: Icon, preview }) => (
          <label key={value} className={cn(
            "relative cursor-pointer overflow-hidden rounded-2xl border bg-card text-foreground transition-[border-color,background-color] focus-within:ring-2 focus-within:ring-ring",
            theme === value ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
          )}>
            <input
              type="radio"
              name="theme"
              value={value}
              checked={theme === value}
              onChange={() => {
                setTheme(value);
                saveThemePreference(value);
              }}
              className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
            />
            <span aria-hidden="true" className={cn("relative block h-20 border-b border-border/60", preview)}>
              <span className={cn("absolute bottom-0 left-4 h-12 w-[72%] rounded-t-lg border p-2 shadow-sm", value === "dark" ? "border-white/10 bg-[#24283b]" : "border-black/10 bg-white")}>
                <span className={cn("block h-1.5 w-1/2 rounded-full", value === "dark" ? "bg-violet-300" : "bg-emerald-700")} />
                <span className={cn("mt-2 block h-1 w-3/4 rounded-full", value === "dark" ? "bg-white/30" : "bg-black/15")} />
              </span>
            </span>
            <span className="flex items-center gap-2.5 p-3">
              <Icon size={16} className="shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-muted-foreground">{detail}</span>
              </span>
              {theme === value && <Check size={16} className="text-primary" aria-hidden="true" />}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
