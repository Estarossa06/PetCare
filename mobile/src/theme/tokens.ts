import { DynamicColorIOS, PlatformColor } from "react-native";
import { Platform } from "react-native";
import { themePalettes, type ThemeColorKey } from "./palette";

function adaptive(
  key: ThemeColorKey,
  androidResource: string,
) {
  const light = themePalettes.light[key];
  const dark = themePalettes.dark[key];
  if (Platform.OS === "ios") return DynamicColorIOS({ light, dark });
  if (Platform.OS === "android") return PlatformColor(androidResource, { fallback: dark });
  if (Platform.OS === "web") return `var(--petcare-${key}, ${light})`;
  return light;
}

export const colors = {
  blue: "#2563EB",
  onAccent: "#FFFFFF",
  blueDark: adaptive("blue-dark", "?android:attr/textColorPrimary"),
  blueSoft: adaptive("blue-soft", "?android:attr/colorBackground"),
  blueMuted: adaptive("blue-muted", "?android:attr/colorBackground"),
  yellow: "#FBBF24",
  yellowSoft: adaptive("yellow-soft", "?android:attr/colorBackground"),
  yellowText: adaptive("yellow-text", "?android:attr/textColorPrimary"),
  background: adaptive("background", "?android:attr/colorBackground"),
  surface: adaptive("surface", "?android:attr/colorBackgroundFloating"),
  text: adaptive("text", "?android:attr/textColorPrimary"),
  textMuted: adaptive("text-muted", "?android:attr/textColorSecondary"),
  border: adaptive("border", "?android:attr/colorForeground"),
  green: adaptive("green", "?android:attr/colorAccent"),
  greenSoft: adaptive("green-soft", "?android:attr/colorBackground"),
  orange: adaptive("orange", "?android:attr/colorAccent"),
  orangeSoft: adaptive("orange-soft", "?android:attr/colorBackground"),
  danger: adaptive("danger", "?android:attr/colorError"),
  dangerSoft: adaptive("danger-soft", "?android:attr/colorBackground"),
  dangerBorder: adaptive("danger-border", "?android:attr/colorError"),
  lavenderSoft: adaptive("lavender-soft", "?android:attr/colorBackground"),
  teal: adaptive("teal", "?android:attr/colorAccent"),
  purple: adaptive("purple", "?android:attr/colorAccent"),
  input: adaptive("input", "?android:attr/colorBackgroundFloating"),
  placeholder: adaptive("placeholder", "?android:attr/textColorHint"),
  error: adaptive("error", "?android:attr/colorError"),
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
