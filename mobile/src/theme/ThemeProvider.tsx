import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Appearance, Platform } from "react-native";
import { reportThemeMode } from "../diagnostics/renderDiagnostics";
import { preferenceStorage } from "../platform/preferenceStorage";
import { themePalettes } from "./palette";
import { applyAndPersistThemeMode, type ThemeMode } from "./themeMode";

type ThemeContextValue = { mode: ThemeMode; ready: boolean; setMode(mode: ThemeMode): Promise<void> };
const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = "petcare.theme.mode";

function applyColorScheme(mode: ThemeMode) {
  if (typeof Appearance.setColorScheme === "function") {
    Appearance.setColorScheme(mode);
  }

  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    const root = document.documentElement.style;
    Object.entries(themePalettes[mode]).forEach(([key, value]) => {
      root.setProperty(`--petcare-${key}`, value);
    });
  }
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void preferenceStorage.getItem(THEME_KEY).then((stored) => {
      const next = stored === "dark" ? "dark" : "light";
      applyColorScheme(next);
      reportThemeMode(next);
      if (active) setModeState(next);
    }).catch(() => {
      applyColorScheme("light");
      if (active) setModeState("light");
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, []);

  const setMode = useCallback(async (next: ThemeMode) => {
    await applyAndPersistThemeMode(next, {
      apply: (mode) => {
        applyColorScheme(mode);
        reportThemeMode(mode);
      },
      update: setModeState,
      persist: (mode) => preferenceStorage.setItem(THEME_KEY, mode),
    });
  }, []);

  const value = useMemo(() => ({ mode, ready, setMode }), [mode, ready, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider.");
  return value;
}
