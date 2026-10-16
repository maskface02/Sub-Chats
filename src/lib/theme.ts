export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "subchats-theme";
export const THEME_CHANGE_EVENT = "subchats-theme-changed";

export function readThemePreference(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  const dark = preference === "dark" ||
    (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Still apply the selection for this page if storage is unavailable.
  }
  applyThemePreference(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

export const themeBootstrapScript = `(function(){var choice;try{choice=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}var dark=choice==='dark'||(choice!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',dark)})();`;
