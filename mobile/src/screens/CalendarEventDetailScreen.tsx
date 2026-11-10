import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Bell, CalendarDays, Clock3, MapPin, PawPrint, Pencil, Trash2 } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { calendarRepository } from "../calendar/calendarRepository";
import { cancelCalendarNotification } from "../calendar/calendarNotifications";
import { colors, radius, spacing } from "../theme/tokens";
import type { CalendarEvent, CalendarReminder } from "../calendar/types";

type Appointment = {
  id: string; pet_id: string; pet_name: string; title: string; starts_at: string; ends_at: string | null;
  location: string | null; notes: string | null; status: string;
};
const formatDate = (value: string, timezone: string) => new Intl.DateTimeFormat("es-ES", {
  weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timezone,
}).format(new Date(value));

export default function CalendarEventDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string; appointmentId?: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : undefined;
  const appointmentId = typeof params.appointmentId === "string" ? params.appointmentId : undefined;
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [reminders, setReminders] = useState<CalendarReminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (eventId) {
        const result = await calendarRepository.getEvent(eventId);
        if (!result) throw new Error("No encontramos este evento.");
        setEvent(result.event);
        setAppointment(null);
        setReminders(result.reminders);
      } else if (appointmentId) {
        const result = await calendarRepository.getAppointment(appointmentId);
        if (!result) throw new Error("No encontramos esta cita.");
        setAppointment(result.appointment as Appointment);
        setEvent(null);
        setReminders(result.reminders);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el evento.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [eventId, appointmentId]);

  const remove = async () => {
    if (!eventId && !appointmentId) return;
    setBusy(true);
    setError(null);
    try {
      const reminderIds = eventId
        ? await calendarRepository.deleteEvent(eventId)
        : await calendarRepository.deleteAppointment(appointmentId!);
      await Promise.all(reminderIds.map((id) => cancelCalendarNotification(id)));
      setConfirmDelete(false);
      router.replace("/calendar");
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : "No se pudo eliminar.");
    } finally {
      setBusy(false);
    }
  };

  const targetType = eventId ? "calendar_event" : "appointment";
  const targetId = eventId ?? appointmentId ?? "";
  const title = event?.title ?? appointment?.title ?? "Evento";
  const petName = appointment?.pet_name;
  const timeZone = event?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const startsAt = event?.starts_at ?? appointment?.starts_at;
  const isAppointment = Boolean(appointmentId);

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]}>
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.top}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver al calendario" onPress={() => router.back()} style={styles.back}><ArrowLeft size={19} color={colors.text} /></Pressable>
            <Text style={styles.topTitle}>{isAppointment ? "Cita veterinaria" : "Evento personal"}</Text>
          </View>
          {loading ? <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Cargando detalle…</Text></View>
            : startsAt ? (
              <>
                <SurfaceCard style={styles.hero}>
                  <Text style={styles.eyebrow}>{isAppointment ? "CITA" : (event?.category ?? "EVENTO").toLocaleUpperCase("es-ES")}</Text>
                  <Text style={styles.title}>{title}</Text>
                  <View style={styles.infoRow}><CalendarDays size={16} color={colors.blue} /><Text style={styles.body}>{formatDate(startsAt, timeZone)}</Text></View>
                  {event?.ends_at || appointment?.ends_at ? <View style={styles.infoRow}><Clock3 size={16} color={colors.blue} /><Text style={styles.meta}>Hasta · {formatDate(event?.ends_at ?? appointment?.ends_at ?? "", timeZone)}</Text></View> : null}
                  {event?.pet_id || appointment?.pet_id ? <View style={styles.infoRow}><PawPrint size={16} color={colors.blue} /><Text style={styles.meta}>{petName ?? "Mascota asociada"}</Text></View> : <Text style={styles.meta}>Evento general</Text>}
                  {appointment?.location ? <View style={styles.infoRow}><MapPin size={16} color={colors.blue} /><Text style={styles.meta}>{appointment.location}</Text></View> : null}
                  {event?.description || appointment?.notes ? <Text style={styles.body}>{event?.description ?? appointment?.notes}</Text> : null}
                  {event?.observations ? <Text style={styles.meta}>Observaciones · {event.observations}</Text> : null}
                  {event?.status || appointment?.status ? <Text style={styles.status}>Estado · {event?.status ?? appointment?.status}</Text> : null}
                  <View style={styles.actions}>
                    <AppButton label="Editar" icon={Pencil} onPress={() => router.push(eventId ? `/calendar/event/${eventId}/edit` : `/calendar/appointment/${appointmentId}/edit`)} />
                    <AppButton label="Eliminar" icon={Trash2} variant="quiet" onPress={() => setConfirmDelete(true)} disabled={busy} />
                  </View>
                </SurfaceCard>
                {confirmDelete ? (
                  <SurfaceCard style={styles.confirmCard}>
                    <Text style={styles.confirmTitle}>¿Eliminar este elemento?</Text>
                    <Text style={styles.meta}>Se conservará como eliminación lógica y se cancelarán sus recordatorios activos.</Text>
                    <View style={styles.actions}>
                      <AppButton label="Conservar" variant="secondary" onPress={() => setConfirmDelete(false)} disabled={busy} />
                      <AppButton label="Confirmar eliminación" icon={Trash2} onPress={() => void remove()} loading={busy} />
                    </View>
                  </SurfaceCard>
                ) : null}
                <View style={styles.reminderHeader}><Text style={styles.section}>Recordatorios</Text><AppButton label="Añadir" icon={Bell} size="small" onPress={() => router.push({ pathname: "/calendar/reminder/new", params: { targetType, targetId } })} /></View>
                {reminders.length ? reminders.map((reminder) => (
                  <Pressable key={reminder.id} onPress={() => router.push(`/calendar/reminder/${reminder.id}`)}>
                    <SurfaceCard style={styles.reminder}>
                      <Bell size={17} color={colors.blue} />
                      <View style={styles.reminderCopy}>
                        <Text style={styles.reminderTitle}>{reminder.title}</Text>
                        <Text style={styles.meta}>{formatDate(reminder.remind_at, reminder.timezone)}</Text>
                        <Text style={styles.meta}>{reminder.status} · notificación {reminder.scheduling_status}</Text>
                      </View>
                    </SurfaceCard>
                  </Pressable>
                )) : <SurfaceCard style={styles.reminder}><Text style={styles.meta}>No hay recordatorios para este elemento.</Text></SurfaceCard>}
              </>
            ) : <SurfaceCard style={styles.reminder}><Text accessibilityRole="alert" style={styles.error}>{error ?? "No se encontró el elemento."}</Text><AppButton label="Volver" onPress={() => router.back()} /></SurfaceCard>}
          {error && startsAt ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
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
  widePage: { maxWidth: 760, width: "100%", alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  back: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  topTitle: { color: colors.blueDark, fontSize: 20, fontWeight: "900" },
  hero: { gap: spacing.md },
  eyebrow: { color: colors.blue, fontSize: 11, letterSpacing: 1, fontWeight: "900" },
  title: { color: colors.blueDark, fontSize: 25, fontWeight: "900" },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  body: { color: colors.text, fontSize: 14, lineHeight: 21 },
  meta: { color: colors.textMuted, fontSize: 13 },
  muted: { color: colors.textMuted, fontSize: 13 },
  status: { color: colors.blue, fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
  actions: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  section: { color: colors.blueDark, fontSize: 18, fontWeight: "800" },
  reminderHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  reminder: { flexDirection: "row", gap: spacing.md, alignItems: "center" },
  reminderCopy: { flex: 1, gap: 4 },
  reminderTitle: { color: colors.text, fontWeight: "800" },
  confirmCard: { gap: spacing.sm, borderColor: colors.orange, borderWidth: 1 },
  confirmTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "800" },
  loading: { padding: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  error: { color: colors.orange },
});
