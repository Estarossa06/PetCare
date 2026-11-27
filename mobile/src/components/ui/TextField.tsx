import { useState } from "react";
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { colors, radius, spacing } from "../../theme/tokens";

type AppTextFieldProps = TextInputProps & {
  label: string;
  hint?: string;
  leadingIcon?: LucideIcon;
  labelStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
};

export function AppTextField({ label, hint, leadingIcon: LeadingIcon, labelStyle, containerStyle, placeholderTextColor, onFocus, onBlur, style, ...inputProps }: AppTextFieldProps) {
  const [focused, setFocused] = useState(false);
  const input = (
    <TextInput
      {...inputProps}
      accessibilityLabel={inputProps.accessibilityLabel ?? label}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        onBlur?.(event);
      }}
      placeholderTextColor={placeholderTextColor ?? colors.textMuted}
      style={[
        LeadingIcon ? styles.inputWithIcon : styles.input,
        style,
        focused && !LeadingIcon && styles.focused,
      ]}
    />
  );

  return (
    <View style={[styles.container, containerStyle]}>
      <Text style={[styles.label, labelStyle]}>{label}</Text>
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
