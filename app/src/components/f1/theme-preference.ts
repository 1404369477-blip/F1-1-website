export type F1Theme = "dark" | "light";

export const F1_THEME_STORAGE_KEY = "f1p1-theme";
export const F1_THEME_COOKIE_KEY = "f1p1-theme";
export const F1_DEFAULT_THEME: F1Theme = "dark";

export type ThemePreferenceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function isF1Theme(value: unknown): value is F1Theme {
  return value === "dark" || value === "light";
}

export function readThemePreference(
  storage: Pick<ThemePreferenceStorage, "getItem"> | undefined,
  fallback: F1Theme = F1_DEFAULT_THEME
): F1Theme {
  if (!storage) return fallback;
  try {
    const storedTheme = storage.getItem(F1_THEME_STORAGE_KEY);
    return isF1Theme(storedTheme) ? storedTheme : fallback;
  } catch {
    return fallback;
  }
}

export function writeThemePreference(
  storage: Pick<ThemePreferenceStorage, "setItem"> | undefined,
  theme: F1Theme
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(F1_THEME_STORAGE_KEY, theme);
    return true;
  } catch {
    return false;
  }
}
