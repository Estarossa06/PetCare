import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Appearance } from "react-native";
import { reportThemeMode } from "../diagnostics/renderDiagnostics";
import { preferenceStorage } from "../platform/preferenceStorage";

type ThemeMode = "light" | "dark";
type ThemeContextValue = { mode: ThemeMode; ready: boolean; setMode(mode: ThemeMode): Promise<void> };
const ThemeContext = createContext<ThemeContextValue | null>(null);
const THEME_KEY = "petcare.theme.mode";

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    void preferenceStorage.getItem(THEME_KEY).then((stored) => {
      const next = stored === "dark" ? "dark" : "light";
      Appearance.setColorScheme(next);
      reportThemeMode(next);
      if (active) setModeState(next);
    }).catch(() => {
      Appearance.setColorScheme("light");
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, []);

  const setMode = useCallback(async (next: ThemeMode) => {
    await preferenceStorage.setItem(THEME_KEY, next);
    Appearance.setColorScheme(next);
    reportThemeMode(next);
    setModeState(next);
  }, []);

  const value = useMemo(() => ({ mode, ready, setMode }), [mode, ready, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider.");
  return value;
}
