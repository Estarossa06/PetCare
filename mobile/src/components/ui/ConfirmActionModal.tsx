import { Modal, Pressable, StyleSheet, Text, View, ActivityIndicator } from "react-native";
import { Trash2 } from "lucide-react-native";
import { colors, radius, spacing } from "../../theme/tokens";

type ConfirmActionModalProps = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmActionModal({
  visible,
  title,
  message,
  confirmLabel = "Eliminar",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmActionModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onCancel(); }}>
      <View style={styles.backdrop}>
        <View accessibilityRole="alert" accessibilityViewIsModal style={styles.dialog}>
          <View style={styles.icon}><Trash2 size={21} color={colors.orange} /></View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onCancel} style={[styles.cancel, busy && styles.disabled]}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onConfirm} style={[styles.confirm, busy && styles.disabled]}>
              {busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.confirmText}>{confirmLabel}</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(15, 23, 42, 0.52)" },
  dialog: { width: "100%", maxWidth: 420, alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface, elevation: 12, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  icon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.orangeSoft },
  title: { color: colors.blueDark, fontSize: 18, fontWeight: "800", textAlign: "center" },
  message: { color: colors.textMuted, fontSize: 14, lineHeight: 21, textAlign: "center" },
  actions: { width: "100%", flexDirection: "row", justifyContent: "center", gap: spacing.sm, marginTop: spacing.xs },
  cancel: { minHeight: 46, flex: 1, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  cancelText: { color: colors.text, fontSize: 14, fontWeight: "700" },
  confirm: { minHeight: 46, flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.orange },
  confirmText: { color: colors.surface, fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.6 },
});
