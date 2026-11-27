import { DynamicColorIOS, PlatformColor } from "react-native";
import { Platform } from "react-native";

function adaptive(
  light: string,
  dark: string,
  androidResource: string,
  variable: string,
) {
  if (Platform.OS === "ios") return DynamicColorIOS({ light, dark });
  if (Platform.OS === "android") return PlatformColor(androidResource, { fallback: dark });
  if (Platform.OS === "web") return `var(--petcare-${variable}, ${light})`;
  return light;
}

export const colors = {
  blue: "#2563EB",
  onAccent: "#FFFFFF",
  blueDark: adaptive("#172554", "#DBEAFE", "?android:attr/textColorPrimary", "blue-dark"),
  blueSoft: adaptive("#EFF6FF", "#1E293B", "?android:attr/colorBackground", "blue-soft"),
  blueMuted: adaptive("#DBEAFE", "#1E3A5F", "?android:attr/colorBackground", "blue-muted"),
  yellow: "#FBBF24",
  yellowSoft: adaptive("#FEF3C7", "#3F351A", "?android:attr/colorBackground", "yellow-soft"),
  yellowText: adaptive("#92400E", "#FDE68A", "?android:attr/textColorPrimary", "yellow-text"),
  background: adaptive("#F8FAFC", "#0B1220", "?android:attr/colorBackground", "background"),
  surface: adaptive("#FFFFFF", "#111827", "?android:attr/colorBackgroundFloating", "surface"),
  text: adaptive("#172033", "#F1F5F9", "?android:attr/textColorPrimary", "text"),
  textMuted: adaptive("#64748B", "#AAB4C5", "?android:attr/textColorSecondary", "text-muted"),
  border: adaptive("#E8EDF4", "#334155", "?android:attr/colorForeground", "border"),
  green: adaptive("#15803D", "#86EFAC", "?android:attr/colorAccent", "green"),
  greenSoft: adaptive("#DCFCE7", "#163B2A", "?android:attr/colorBackground", "green-soft"),
  orange: adaptive("#C2410C", "#FDBA74", "?android:attr/colorAccent", "orange"),
  orangeSoft: adaptive("#FFEDD5", "#422B1B", "?android:attr/colorBackground", "orange-soft"),
  dangerSoft: adaptive("#FEF2F2", "#451A1A", "?android:attr/colorBackground", "danger-soft"),
  dangerBorder: adaptive("#FECACA", "#7F1D1D", "?android:attr/colorForeground", "danger-border"),
  lavenderSoft: adaptive("#EDE9FE", "#312E52", "?android:attr/colorBackground", "lavender-soft"),
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  xxl: 40,
} as const;

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  pill: 999,
} as const;
