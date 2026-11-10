import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Bell, Clock3 } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { AppTextField } from "../components/ui/TextField";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { isoToLocalDateTime } from "../care/recurrence";
import { calendarRepository } from "../calendar/calendarRepository";
import { calendarService } from "../calendar/calendarService";
import { syncCalendarNotification } from "../calendar/calendarNotifications";
import type { CalendarReminder, CalendarReminderTarget } from "../calendar/types";
import { colors, radius, spacing } from "../theme/tokens";

const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const localLater = () => {
  const date = new Date(Date.now() + 30 * 60_000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const asTarget = (type: string, id: string): CalendarReminderTarget => {
  if (type !== "calendar_event" && type !== "care_task" && type !== "appointment" && type !== "health_record") {
    throw new Error("El recordatorio no tiene un evento válido asociado.");
  }
  return { kind: type, id };
};
const targetOf = (reminder: CalendarReminder): CalendarReminderTarget => {
  if (reminder.calendar_event_id) return { kind: "calendar_event", id: reminder.calendar_event_id };
  if (reminder.care_task_id) return { kind: "care_task", id: reminder.care_task_id };
  if (reminder.appointment_id) return { kind: "appointment", id: reminder.appointment_id };
  if (reminder.health_record_id) return { kind: "health_record", id: reminder.health_record_id };
  throw new Error("El recordatorio no tiene una relación válida.");
};

export default function CalendarReminderFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ targetType?: string; targetId?: string; reminderId?: string }>();
  const targetId = typeof params.targetId === "string" ? params.targetId : "";
  const reminderId = typeof params.reminderId === "string" ? params.reminderId : undefined;
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [target, setTarget] = useState<CalendarReminderTarget | null>(null);
  const [title, setTitle] = useState("");
  const [remindLocal, setRemindLocal] = useState(localLater);
  const [notes, setNotes] = useState("");
  const [timezone, setTimezone] = useState(deviceTimezone);
  const [relative, setRelative] = useState(false);
  const [leadMinutes, setLeadMinutes] = useState("30");
  const [targetTitle, setTargetTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const existing = reminderId ? await calendarRepository.getReminder(reminderId) : null;
        if (reminderId && !existing) throw new Error("No encontramos este recordatorio.");
        const selectedTarget = existing ? targetOf(existing) : asTarget(params.targetType ?? "", targetId);
        const info = await calendarRepository.targetInfo(selectedTarget.kind, selectedTarget.id);
        if (!active) return;
        setTarget(selectedTarget);
        setTargetTitle(info.title);
        setTimezone(existing?.timezone ?? info.timezone);
        if (existing) {
          setTitle(existing.title);
          setRemindLocal(isoToLocalDateTime(existing.remind_at, existing.timezone));
          setNotes(existing.notes ?? "");
          setRelative(existing.lead_minutes !== null);
          if (existing.lead_minutes !== null) setLeadMinutes(String(existing.lead_minutes));
        } else {
          setTitle(`Recordatorio · ${info.title}`);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el recordatorio.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [params.targetType, reminderId, targetId]);

  const save = async () => {
    if (!target || saving) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await calendarService.saveReminder({
        target,
        title,
        remindLocal,
        leadMinutes: relative ? Number(leadMinutes) : null,
        timezone,
        notes,
      }, reminderId);
      await syncCalendarNotification(saved, true);
      router.replace(`/calendar/reminder/${saved.id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el recordatorio.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]} keyboardShouldPersistTaps="handled">
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.back}><ArrowLeft size={19} color={colors.text} /></Pressable>
            <View><Text style={styles.eyebrow}>AVISOS LOCALES</Text><Text style={styles.heading}>{reminderId ? "Editar recordatorio" : "Nuevo recordatorio"}</Text></View>
          </View>
          {loading ? <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Cargando…</Text></View> : target ? (
            <>
              <SurfaceCard style={styles.card}>
                <View style={styles.targetRow}><Bell size={18} color={colors.blue} /><View style={styles.targetCopy}><Text style={styles.label}>Asociado a</Text><Text style={styles.body}>{targetTitle}</Text><Text style={styles.muted}>{target.kind === "care_task" ? "Actividad de cuidado" : target.kind === "health_record" ? "Historial médico" : target.kind === "appointment" ? "Cita veterinaria" : "Evento personal"}</Text></View></View>
                <AppTextField label="Título del aviso *" value={title} onChangeText={setTitle} placeholder="Recordatorio" />
                <View style={styles.choiceRow}>
                  <Pressable onPress={() => setRelative(false)} style={[styles.choice, !relative && styles.choiceSelected]}><Text style={[styles.choiceText, !relative && styles.choiceTextSelected]}>Fecha y hora exacta</Text></Pressable>
                  <Pressable onPress={() => setRelative(true)} style={[styles.choice, relative && styles.choiceSelected]}><Text style={[styles.choiceText, relative && styles.choiceTextSelected]}>Anticipación</Text></Pressable>
                </View>
                {relative ? (
                  <AppTextField label="Minutos antes del evento" value={leadMinutes} onChangeText={setLeadMinutes} keyboardType="number-pad" placeholder="30" hint="Para acontecimientos médicos de día completo se toma como referencia las 09:00 locales." />
                ) : (
                  <AppTextField label="Avisar el (fecha y hora local)" value={remindLocal} onChangeText={setRemindLocal} placeholder="AAAA-MM-DDTHH:mm" />
                )}
                <AppTextField label="Notas (opcional)" value={notes} onChangeText={setNotes} placeholder="Información útil para el aviso" multiline />
                <View style={styles.info}><Clock3 size={15} color={colors.blue} /><Text style={styles.muted}>El recordatorio se guarda localmente aunque se deniegue el permiso de notificaciones. Puedes activarlo después.</Text></View>
              </SurfaceCard>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <AppButton label={saving ? "Guardando…" : "Guardar recordatorio"} onPress={() => void save()} loading={saving} />
            </>
          ) : <Text accessibilityRole="alert" style={styles.error}>{error ?? "Selecciona un evento."}</Text>}
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
  widePage: { maxWidth: 700, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: 4 },
  back: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.blue, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  heading: { color: colors.blueDark, fontSize: 23, fontWeight: "900" },
  card: { gap: spacing.md },
  targetRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  targetCopy: { flex: 1, gap: 4 },
  label: { color: colors.text, fontSize: 13, fontWeight: "800" },
  body: { color: colors.blueDark, fontSize: 15, fontWeight: "800" },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  choiceRow: { flexDirection: "row", gap: spacing.sm },
  choice: { paddingHorizontal: 13, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: "#F1F5F9" },
  choiceSelected: { backgroundColor: colors.blue },
  choiceText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  choiceTextSelected: { color: colors.surface },
  info: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  error: { color: colors.orange, fontSize: 13 },
  loading: { padding: spacing.xl, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center" },
});
