"use client";

import { useEffect } from "react";
import { applyThemePreference, readThemePreference, THEME_CHANGE_EVENT } from "@/lib/theme";

export function ThemeRuntime() {
  useEffect(() => {
    const update = () => applyThemePreference(readThemePreference());
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    update();
    media.addEventListener("change", update);
    window.addEventListener("storage", update);
    window.addEventListener(THEME_CHANGE_EVENT, update);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", update);
      window.removeEventListener(THEME_CHANGE_EVENT, update);
    };
  }, []);
  return null;
}
