import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";
import { Appearance } from "react-native";
import { reportThemeMode } from "../diagnostics/renderDiagnostics";
import { preferenceStorage } from "../platform/preferenceStorage";
import { Platform } from "react-native";

type ThemeMode = "light" | "dark";
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

    const palette = mode === "dark" ? {
      background: "#0B1220",
      surface: "#111827",
      text: "#F1F5F9",
      "text-muted": "#AAB4C5",
      border: "#334155",
      "blue-dark": "#DBEAFE",
      "blue-soft": "#1E293B",
      "blue-muted": "#1E3A5F",
      "yellow-soft": "#3F351A",
      "yellow-text": "#FDE68A",
      green: "#86EFAC",
      "green-soft": "#163B2A",
      orange: "#FDBA74",
      "orange-soft": "#422B1B",
      "danger-soft": "#451A1A",
      "danger-border": "#7F1D1D",
      "lavender-soft": "#312E52",
    } : {
      background: "#F8FAFC",
      surface: "#FFFFFF",
      text: "#172033",
      "text-muted": "#64748B",
      border: "#E8EDF4",
      "blue-dark": "#172554",
      "blue-soft": "#EFF6FF",
      "blue-muted": "#DBEAFE",
      "yellow-soft": "#FEF3C7",
      "yellow-text": "#92400E",
      green: "#15803D",
      "green-soft": "#DCFCE7",
      orange: "#C2410C",
      "orange-soft": "#FFEDD5",
      "danger-soft": "#FEF2F2",
      "danger-border": "#FECACA",
      "lavender-soft": "#EDE9FE",
    };

    Object.entries(palette).forEach(([key, value]) => {
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
    }).finally(() => {
      if (active) setReady(true);
    });
    return () => { active = false; };
  }, []);

  const setMode = useCallback(async (next: ThemeMode) => {
    await preferenceStorage.setItem(THEME_KEY, next);
    applyColorScheme(next);
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
