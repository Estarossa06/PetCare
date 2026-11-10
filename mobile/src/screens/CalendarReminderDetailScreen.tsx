import { useCallback, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Bell, BellOff, Check, Clock3, Pencil, Trash2 } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { calendarRepository } from "../calendar/calendarRepository";
import { cancelCalendarNotification, syncCalendarNotification } from "../calendar/calendarNotifications";
import type { CalendarReminder, CalendarReminderTarget } from "../calendar/types";
import { colors, radius, spacing } from "../theme/tokens";

const targetOf = (reminder: CalendarReminder): CalendarReminderTarget | null => {
  if (reminder.calendar_event_id) return { kind: "calendar_event", id: reminder.calendar_event_id };
  if (reminder.care_task_id) return { kind: "care_task", id: reminder.care_task_id };
  if (reminder.appointment_id) return { kind: "appointment", id: reminder.appointment_id };
  if (reminder.health_record_id) return { kind: "health_record", id: reminder.health_record_id };
  return null;
};
const dateLabel = (value: string, timezone: string) => new Intl.DateTimeFormat("es-ES", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timezone,
}).format(new Date(value));

export default function CalendarReminderDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reminderId?: string }>();
  const reminderId = typeof params.reminderId === "string" ? params.reminderId : "";
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [reminder, setReminder] = useState<CalendarReminder | null>(null);
  const [targetTitle, setTargetTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const current = await calendarRepository.getReminder(reminderId);
      if (!current) throw new Error("No encontramos este recordatorio.");
      const target = targetOf(current);
      if (!target) throw new Error("El recordatorio no está asociado a un evento.");
      const info = await calendarRepository.targetInfo(target.kind, target.id);
      setReminder(current);
      setTargetTitle(info.title);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el recordatorio.");
    } finally {
      setLoading(false);
    }
  }, [reminderId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const change = async (changes: { status?: "pending" | "attended" | "cancelled"; enabled?: boolean; deleted?: boolean }) => {
    if (!reminder) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await calendarRepository.updateReminder(reminder.id, changes);
      const state = await syncCalendarNotification(updated, changes.enabled === true);
      if (changes.deleted) {
        await cancelCalendarNotification(reminder.id);
        setConfirmDelete(false);
        router.replace("/calendar");
      } else {
        setReminder({ ...updated, scheduling_status: state });
      }
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "No se pudo actualizar el recordatorio.");
    } finally {
      setBusy(false);
    }
  };

  const statusText = reminder?.scheduling_status === "scheduled" ? "Notificación local programada"
    : reminder?.scheduling_status === "denied" ? "Permiso denegado; el recordatorio sigue guardado"
      : reminder?.scheduling_status === "unsupported" ? "Las notificaciones locales no están disponibles en Web"
        : reminder?.scheduling_status === "expired" ? "La hora del aviso ya pasó"
          : reminder?.scheduling_status === "failed" ? `No se pudo programar: ${reminder.last_error ?? "error desconocido"}`
            : reminder?.scheduling_status === "disabled" ? "Aviso desactivado" : "Pendiente de programación";

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]}>
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.top}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver al calendario" onPress={() => router.back()} style={styles.back}><ArrowLeft size={19} color={colors.text} /></Pressable>
            <Text style={styles.topTitle}>Detalle del recordatorio</Text>
          </View>
          {loading ? <Text style={styles.muted}>Cargando…</Text> : reminder ? (
            <>
              <SurfaceCard style={styles.card}>
                <View style={styles.icon}><Bell size={22} color={colors.blue} /></View>
                <Text style={styles.title}>{reminder.title}</Text>
                <View style={styles.info}><Clock3 size={16} color={colors.blue} /><Text style={styles.body}>{dateLabel(reminder.remind_at, reminder.timezone)}</Text></View>
                <Text style={styles.meta}>Relacionado con · {targetTitle}</Text>
                {reminder.lead_minutes !== null ? <Text style={styles.meta}>Anticipación · {reminder.lead_minutes} minutos</Text> : null}
                {reminder.notes ? <Text style={styles.meta}>{reminder.notes}</Text> : null}
                <Text style={styles.notificationState}>{statusText}</Text>
                {reminder.last_error ? <Text style={styles.error}>{reminder.last_error}</Text> : null}
                <View style={styles.switchRow}><Text style={styles.meta}>{reminder.enabled ? "Recordatorio activo" : "Recordatorio desactivado"}</Text><Switch value={Boolean(reminder.enabled)} onValueChange={(enabled) => void change({ enabled })} disabled={busy || reminder.status !== "pending"} trackColor={{ true: colors.blue }} /></View>
                <View style={styles.actions}>
                  {reminder.status === "pending" ? <AppButton label="Marcar atendido" icon={Check} onPress={() => void change({ status: "attended" })} disabled={busy} /> : null}
                  {reminder.scheduling_status === "denied" || reminder.scheduling_status === "failed" ? <AppButton label="Intentar activar avisos" icon={Bell} variant="secondary" onPress={() => void change({ enabled: true })} disabled={busy} /> : null}
                  <AppButton label="Editar" icon={Pencil} variant="secondary" onPress={() => router.push(`/calendar/reminder/${reminder.id}/edit`)} />
                  <AppButton label="Eliminar" icon={Trash2} variant="quiet" onPress={() => setConfirmDelete(true)} disabled={busy} />
                </View>
                {confirmDelete ? (
                  <View style={styles.confirm}>
                    <Text style={styles.confirmTitle}>¿Eliminar este recordatorio?</Text>
                    <Text style={styles.meta}>Se conservará como eliminación lógica.</Text>
                    <View style={styles.actions}>
                      <AppButton label="Conservar" variant="secondary" onPress={() => setConfirmDelete(false)} disabled={busy} />
                      <AppButton label="Confirmar eliminación" icon={Trash2} onPress={() => void change({ deleted: true })} loading={busy} />
                    </View>
                  </View>
                ) : null}
                {reminder.status !== "pending" ? <Text style={styles.meta}>Estado · {reminder.status}</Text> : null}
                {!reminder.enabled ? <View style={styles.disabledIcon}><BellOff size={16} color={colors.textMuted} /><Text style={styles.meta}>El recordatorio permanece guardado en SQLite.</Text></View> : null}
              </SurfaceCard>
            </>
          ) : <Text accessibilityRole="alert" style={styles.error}>{error ?? "No se encontró el recordatorio."}</Text>}
          {error && reminder ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.md, paddingBottom: 110 },
  wideScroll: { paddingLeft: 286, paddingTop: spacing.xl },
  page: { gap: spacing.md },
  widePage: { maxWidth: 720, width: "100%", alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  back: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  topTitle: { color: colors.blueDark, fontSize: 20, fontWeight: "900" },
  card: { gap: spacing.md },
  icon: { width: 46, height: 46, borderRadius: 16, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  title: { color: colors.blueDark, fontSize: 23, fontWeight: "900" },
  info: { flexDirection: "row", alignItems: "center", gap: 9 },
  body: { color: colors.text, fontSize: 14, fontWeight: "700" },
  meta: { color: colors.textMuted, fontSize: 13 },
  muted: { color: colors.textMuted, fontSize: 13 },
  notificationState: { color: colors.blue, fontSize: 13, fontWeight: "800" },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  confirm: { gap: spacing.sm, padding: spacing.md, backgroundColor: "#FFF7ED", borderRadius: radius.md },
  confirmTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "800" },
  disabledIcon: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { color: colors.orange, fontSize: 13 },
});
