import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../../theme/tokens";

type AppButtonProps = {
  label: string;
  onPress?: () => void;
  icon?: LucideIcon;
  variant?: "primary" | "secondary" | "quiet";
  size?: "regular" | "small";
  loading?: boolean;
  disabled?: boolean;
};

export function AppButton({
  label,
  onPress,
  icon: Icon,
  variant = "primary",
  size = "regular",
  loading = false,
  disabled = false,
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
        (disabled || loading) && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? colors.surface : colors.blue} size="small" />
      ) : (
        <View style={styles.content}>
          {Icon ? <Icon color={isPrimary ? colors.surface : colors.blue} size={17} strokeWidth={2.2} /> : null}
          <Text style={[styles.label, isPrimary && styles.primaryLabel, isQuiet && styles.quietLabel]}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  small: {
    minHeight: 40,
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
    color: colors.surface,
  },
  quietLabel: {
    color: colors.textMuted,
  },
});
