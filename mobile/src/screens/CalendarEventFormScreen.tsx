import { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { AppTextField } from "../components/ui/TextField";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { isoToLocalDateTime } from "../care/recurrence";
import { calendarRepository } from "../calendar/calendarRepository";
import { calendarService } from "../calendar/calendarService";
import type { CalendarEventCategory, CalendarEventStatus, CalendarPetOption } from "../calendar/types";
import { colors, radius, spacing } from "../theme/tokens";

type FormKind = "event" | "appointment";
const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const localNow = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const categories: { id: CalendarEventCategory; label: string }[] = [
  { id: "custom", label: "Personalizado" }, { id: "birthday", label: "Cumpleaños" },
  { id: "travel", label: "Viaje" }, { id: "grooming", label: "Estética" }, { id: "other", label: "Otro" },
];

export default function CalendarEventFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string; appointmentId?: string }>();
  const eventId = typeof params.eventId === "string" ? params.eventId : undefined;
  const appointmentId = typeof params.appointmentId === "string" ? params.appointmentId : undefined;
  const editing = Boolean(eventId || appointmentId);
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [kind, setKind] = useState<FormKind>(appointmentId ? "appointment" : "event");
  const [pets, setPets] = useState<CalendarPetOption[]>([]);
  const [petId, setPetId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [observations, setObservations] = useState("");
  const [category, setCategory] = useState<CalendarEventCategory>("custom");
  const [eventStatus, setEventStatus] = useState<CalendarEventStatus>("scheduled");
  const [appointmentStatus, setAppointmentStatus] = useState<"scheduled" | "completed" | "cancelled">("scheduled");
  const [startsLocal, setStartsLocal] = useState(localNow);
  const [endsLocal, setEndsLocal] = useState("");
  const [eventTimezone, setEventTimezone] = useState(deviceTimezone);
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(editing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void calendarRepository.pets().then((rows) => { if (active) { setPets(rows); setPetId(rows[0]?.id ?? null); } })
      .then(async () => {
        if (eventId) {
          const result = await calendarRepository.getEvent(eventId);
          if (!active) return;
          if (!result) throw new Error("No encontramos este evento.");
          const event = result.event;
          setKind("event");
          setPetId(event.pet_id);
          setTitle(event.title);
          setDescription(event.description ?? "");
          setObservations(event.observations ?? "");
          setCategory(event.category);
          setEventStatus(event.status);
          setEventTimezone(event.timezone);
          setStartsLocal(isoToLocalDateTime(event.starts_at, event.timezone));
          setEndsLocal(event.ends_at ? isoToLocalDateTime(event.ends_at, event.timezone) : "");
        } else if (appointmentId) {
          const result = await calendarRepository.getAppointment(appointmentId);
          if (!active) return;
          if (!result) throw new Error("No encontramos esta cita.");
          const appointment = result.appointment;
          setKind("appointment");
          setPetId(appointment.pet_id);
          setTitle(appointment.title);
          setDescription(appointment.notes ?? "");
          setLocation(appointment.location ?? "");
          setAppointmentStatus(appointment.status as "scheduled" | "completed" | "cancelled");
          setEventTimezone(deviceTimezone);
          setStartsLocal(isoToLocalDateTime(appointment.starts_at, deviceTimezone));
          setEndsLocal(appointment.ends_at ? isoToLocalDateTime(appointment.ends_at, deviceTimezone) : "");
        }
      }).catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el evento.");
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [appointmentId, eventId]);

  const save = async () => {
    if (saving || loading) return;
    setSaving(true);
    setError(null);
    try {
      if (kind === "appointment") {
        if (!petId) throw new Error("Selecciona la mascota de esta cita.");
        const saved = await calendarService.saveAppointment({
          petId, title, startsLocal, endsLocal, location, notes: description, status: appointmentStatus,
        }, appointmentId);
        router.replace(`/calendar/appointment/${saved.id}`);
      } else {
        const saved = await calendarService.saveEvent({
          petId, title, description, observations, category, startsLocal, endsLocal, timezone: eventTimezone, status: eventStatus,
        }, eventId);
        router.replace(`/calendar/event/${saved.id}`);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar.");
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
            <View><Text style={styles.eyebrow}>AGENDA PETCARE</Text><Text style={styles.heading}>{editing ? "Editar" : "Crear"} evento</Text></View>
          </View>
          {loading ? <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Cargando…</Text></View> : (
            <>
              {!editing ? (
                <SurfaceCard style={styles.card}>
                  <Text style={styles.label}>Tipo de registro</Text>
                  <View style={styles.chips}>
                    {(["event", "appointment"] as const).map((value) => (
                      <Pressable key={value} onPress={() => setKind(value)} style={[styles.chip, kind === value && styles.chipSelected]}>
                        <Text style={[styles.chipText, kind === value && styles.chipTextSelected]}>{value === "event" ? "Evento personal" : "Cita veterinaria"}</Text>
                      </Pressable>
                    ))}
                  </View>
                </SurfaceCard>
              ) : null}
              <SurfaceCard style={styles.card}>
                <Text style={styles.section}>{kind === "appointment" ? "Cita veterinaria" : "Detalles del evento"}</Text>
                <AppTextField label="Título *" value={title} onChangeText={setTitle} placeholder={kind === "appointment" ? "Consulta de control" : "Nombre del evento"} />
                <Text style={styles.label}>Mascota {kind === "appointment" ? "*" : "(opcional)"}</Text>
                <View style={styles.chips}>
                  {kind === "event" ? <Pressable onPress={() => setPetId(null)} style={[styles.chip, petId === null && styles.chipSelected]}><Text style={[styles.chipText, petId === null && styles.chipTextSelected]}>General</Text></Pressable> : null}
                  {pets.map((pet) => <Pressable key={pet.id} onPress={() => setPetId(pet.id)} style={[styles.chip, petId === pet.id && styles.chipSelected]}><Text style={[styles.chipText, petId === pet.id && styles.chipTextSelected]}>{pet.name}</Text></Pressable>)}
                </View>
                {kind === "event" ? (
                  <>
                    <Text style={styles.label}>Categoría</Text>
                    <View style={styles.chips}>{categories.map((option) => <Pressable key={option.id} onPress={() => setCategory(option.id)} style={[styles.chip, category === option.id && styles.chipSelected]}><Text style={[styles.chipText, category === option.id && styles.chipTextSelected]}>{option.label}</Text></Pressable>)}</View>
                    <AppTextField label="Descripción" value={description} onChangeText={setDescription} placeholder="Detalles del evento" multiline />
                    <AppTextField label="Observaciones" value={observations} onChangeText={setObservations} placeholder="Notas adicionales" multiline />
                  </>
                ) : (
                  <>
                    <AppTextField label="Clínica o ubicación" value={location} onChangeText={setLocation} placeholder="Clínica veterinaria" />
                    <AppTextField label="Notas" value={description} onChangeText={setDescription} placeholder="Motivo y preparación" multiline />
                  </>
                )}
                {editing ? (
                  <>
                    <Text style={styles.label}>Estado</Text>
                    <View style={styles.chips}>
                      {(["scheduled", "completed", "cancelled"] as const).map((value) => {
                        const selected = kind === "event" ? eventStatus === value : appointmentStatus === value;
                        return <Pressable key={value} onPress={() => kind === "event" ? setEventStatus(value) : setAppointmentStatus(value)}
                          style={[styles.chip, selected && styles.chipSelected]}>
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{value === "scheduled" ? "Programado" : value === "completed" ? "Completado" : "Cancelado"}</Text>
                        </Pressable>;
                      })}
                    </View>
                  </>
                ) : null}
              </SurfaceCard>
              <SurfaceCard style={styles.card}>
                <Text style={styles.section}>Fecha y hora local</Text>
                <AppTextField label="Inicio *" value={startsLocal} onChangeText={setStartsLocal} placeholder="AAAA-MM-DDTHH:mm" />
                <AppTextField label="Fin (opcional)" value={endsLocal} onChangeText={setEndsLocal} placeholder="AAAA-MM-DDTHH:mm" />
                <Text style={styles.muted}>Zona horaria: {eventTimezone}. Los cambios de horario se validan al guardar.</Text>
              </SurfaceCard>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <AppButton label={saving ? "Guardando…" : "Guardar"} onPress={() => void save()} loading={saving} />
            </>
          )}
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
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: 4 },
  back: { width: 42, height: 42, borderRadius: radius.pill, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.blue, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  heading: { color: colors.blueDark, fontSize: 24, fontWeight: "900" },
  card: { gap: spacing.md },
  section: { color: colors.blueDark, fontSize: 17, fontWeight: "800" },
  label: { color: colors.text, fontSize: 13, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: "#F1F5F9" },
  chipSelected: { backgroundColor: colors.blue },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: colors.surface },
  muted: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.orange, fontSize: 13 },
  loading: { padding: spacing.xl, flexDirection: "row", gap: spacing.sm, alignItems: "center", justifyContent: "center" },
});
