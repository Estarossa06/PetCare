import { useState } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, radius, spacing } from "../../theme/tokens";

type AppTextFieldProps = TextInputProps & {
  label: string;
  hint?: string;
  leadingIcon?: LucideIcon;
};

export function AppTextField({ label, hint, leadingIcon: LeadingIcon, onFocus, onBlur, style, ...inputProps }: AppTextFieldProps) {
  const [focused, setFocused] = useState(false);
  const input = (
    <TextInput
      {...inputProps}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      placeholderTextColor={colors.textMuted}
      style={[
        LeadingIcon ? styles.inputWithIcon : styles.input,
        focused && !LeadingIcon && styles.focused,
        style,
      ]}
    />
  );

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      {LeadingIcon ? (
        <View style={[styles.iconInput, focused && styles.focused]}>
          <LeadingIcon size={18} color={focused ? colors.blue : colors.textMuted} />
          {input}
        </View>
      ) : input}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 15,
    paddingHorizontal: spacing.md,
  },
  iconInput: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
  },
  inputWithIcon: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: colors.text,
    fontSize: 15,
  },
  focused: {
    borderColor: colors.blue,
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
