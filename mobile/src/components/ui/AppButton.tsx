import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "../../theme/tokens";

type AppButtonProps = {
  label: string;
  onPress?: () => void;
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "quiet";
  size?: "regular" | "small";
  loading?: boolean;
  disabled?: boolean;
  buttonStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  labelColor?: string;
};

export function AppButton({
  label,
  onPress,
  icon: Icon,
  variant = "primary",
  size = "regular",
  loading = false,
  disabled = false,
  buttonStyle,
  labelStyle,
  labelColor,
}: AppButtonProps) {
  const isPrimary = variant === "primary";
  const isQuiet = variant === "quiet";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        size === "small" && styles.small,
        isPrimary ? styles.primary : isQuiet ? styles.quiet : styles.secondary,
        buttonStyle,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? "#FFFFFF" : colors.blue} size="small" />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon color={isPrimary ? "#FFFFFF" : colors.blue} size={17} strokeWidth={2.2} /> : null}
          <Text style={[styles.label, isPrimary && styles.primaryLabel, isQuiet && styles.quietLabel, labelColor ? { color: labelColor } : null, labelStyle]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  small: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  primary: {
    backgroundColor: colors.blue,
  },
  secondary: {
    backgroundColor: colors.blueSoft,
  },
  quiet: {
    backgroundColor: "transparent",
    paddingHorizontal: spacing.sm,
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.82,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  label: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: "700",
  },
  primaryLabel: {
    color: "#FFFFFF",
  },
  quietLabel: {
    color: colors.textMuted,
  },
});
