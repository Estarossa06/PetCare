import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { calendarRepository } from "../calendar/calendarRepository";
import type { CalendarFilters, CalendarItem, CalendarPetOption } from "../calendar/types";
import { colors, radius, spacing } from "../theme/tokens";

type ViewMode = "month" | "week" | "day";
const sourceLabels: Record<CalendarItem["source"], string> = {
  care_task: "Cuidado",
  care_execution: "Ejecución",
  appointment: "Cita veterinaria",
  health_record: "Historial médico",
  calendar_event: "Evento",
  calendar_reminder: "Recordatorio",
};
const dayKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseDay = (value: string) => new Date(`${value}T12:00:00`);
const moveDay = (date: Date, count: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + count, 12);
const startOfWeek = (date: Date) => {
  const day = date.getDay();
  return moveDay(date, -(day === 0 ? 6 : day - 1));
};
const monthLabel = (date: Date) => date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });

function ChoiceChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function EventCard({ entry, onOpen, onReminder }: { entry: CalendarItem; onOpen: () => void; onReminder: () => void }) {
  const time = entry.allDay
    ? "Todo el día"
    : new Intl.DateTimeFormat("es-ES", { timeZone: entry.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(entry.startsAt));
  const statusLabel = entry.status === "overdue" ? "Atrasado"
    : entry.status === "pending" ? "Pendiente"
      : entry.status === "completed" ? "Completado"
        : entry.status === "attended" ? "Atendido" : entry.status;
  return (
    <SurfaceCard style={styles.eventCard}>
      <Pressable accessibilityRole="button" onPress={onOpen} style={styles.eventMain}>
        <View style={[styles.eventMark, entry.source === "appointment" ? styles.markYellow : entry.source === "health_record" ? styles.markGreen : null]} />
        <View style={styles.eventTime}>
          <Text style={styles.timeText}>{time}</Text>
          <Text style={styles.statusText}>{statusLabel}</Text>
        </View>
        <View style={styles.eventCopy}>
          <Text style={styles.eventTitle}>{entry.title}</Text>
          <Text style={styles.eventMeta}>
            {sourceLabels[entry.source]}{entry.petName ? ` · ${entry.petName}` : " · General"}
          </Text>
        </View>
      </Pressable>
      {entry.source !== "calendar_reminder" ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Crear recordatorio" onPress={onReminder} style={styles.bellButton}>
          <Bell size={17} color={colors.blue} />
        </Pressable>
      ) : null}
    </SurfaceCard>
  );
}

export default function CalendarScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [mode, setMode] = useState<ViewMode>("month");
  const [selected, setSelected] = useState(dayKey(new Date()));
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [pets, setPets] = useState<CalendarPetOption[]>([]);
  const [filters, setFilters] = useState<CalendarFilters>({ petId: null, category: "", status: "", type: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const selectedDate = parseDay(selected);
      let first: Date;
      let last: Date;
      if (mode === "month") {
        first = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
        const offset = (first.getDay() + 6) % 7;
        first = moveDay(first, -offset);
        last = moveDay(first, 41);
      } else if (mode === "week") {
        first = startOfWeek(selectedDate);
        last = moveDay(first, 6);
      } else {
        first = selectedDate;
        last = selectedDate;
      }
      const [rows, petRows] = await Promise.all([
        calendarRepository.listItems(dayKey(first), dayKey(last), filters),
        calendarRepository.pets(),
      ]);
      setItems(rows);
      setPets(petRows);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el calendario local.");
    } finally {
      setLoading(false);
    }
  }, [filters, mode, selected]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const visibleDates = useMemo(() => {
    const date = parseDay(selected);
    if (mode === "day") return [selected];
    if (mode === "week") {
      const first = startOfWeek(date);
      return Array.from({ length: 7 }, (_, index) => dayKey(moveDay(first, index)));
    }
    const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const first = moveDay(firstOfMonth, -((firstOfMonth.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, index) => dayKey(moveDay(first, index)));
  }, [mode, selected]);
  const selectedItems = items.filter((entry) => entry.day === selected);
  const eventDays = new Set(items.map((entry) => entry.day));

  const navigate = (direction: number) => {
    const date = parseDay(selected);
    const next = mode === "month"
      ? new Date(date.getFullYear(), date.getMonth() + direction, 1, 12)
      : moveDay(date, direction * (mode === "week" ? 7 : 1));
    setSelected(dayKey(next));
  };
  const openItem = (entry: CalendarItem) => {
    if (entry.source === "care_task" || entry.source === "care_execution") {
      if (entry.petId) router.push(`/pet/${entry.petId}/care/${entry.targetId}`);
    } else if (entry.source === "health_record") {
      if (entry.petId) router.push(`/pet/${entry.petId}/medical/${entry.targetId}`);
    } else if (entry.source === "calendar_event") {
      router.push(`/calendar/event/${entry.sourceId}`);
    } else if (entry.source === "appointment") {
      router.push(`/calendar/appointment/${entry.sourceId}`);
    } else {
      router.push(`/calendar/reminder/${entry.sourceId}`);
    }
  };
  const openReminder = (entry: CalendarItem) => router.push({
    pathname: "/calendar/reminder/new",
    params: { targetType: entry.source === "care_execution" ? "care_task" : entry.source, targetId: entry.targetId },
  });

  const dateTitle = mode === "month"
    ? monthLabel(parseDay(selected))
    : parseDay(selected).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: mode === "day" ? "numeric" : undefined });
  const activeCategory = filters.category;
  const categories = [
    ["", "Todas"],
    ["feeding", "Alimentación"], ["walk", "Paseo"], ["bath", "Baño"], ["hygiene", "Higiene"],
    ["medication", "Medicamentos"], ["vaccination", "Vacunas"], ["deworming", "Desparasitación"],
    ["exercise", "Ejercicio"], ["custom", "Personal"], ["consultation", "Consulta"],
    ["treatment", "Tratamiento"], ["surgery", "Cirugía"], ["allergy", "Alergia"],
    ["diagnosis", "Diagnóstico"], ["examination", "Examen"],
    ["veterinary_appointment", "Citas"], ["reminder", "Recordatorios"],
  ];

  return (
    <SafeAreaView edges={["top"]} style={styles.safe}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]}>
        <View style={[styles.page, wide && styles.widePage]}>
          <ScreenHeader eyebrow="ORGANIZA SU BIENESTAR" title="Calendario" subtitle="Cuidados, citas, historial médico y recordatorios en una sola vista." />
          <View style={styles.toolbar}>
            <View style={styles.modePicker}>
              {(["month", "week", "day"] as const).map((value) => (
                <ChoiceChip key={value} label={value === "month" ? "Mes" : value === "week" ? "Semana" : "Día"} selected={mode === value} onPress={() => setMode(value)} />
              ))}
            </View>
            <View style={styles.navigation}>
              <Pressable accessibilityRole="button" accessibilityLabel="Periodo anterior" onPress={() => navigate(-1)} style={styles.navButton}><ChevronLeft size={20} color={colors.text} /></Pressable>
              <Text style={styles.period}>{dateTitle}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Periodo siguiente" onPress={() => navigate(1)} style={styles.navButton}><ChevronRight size={20} color={colors.text} /></Pressable>
              <AppButton label="Hoy" size="small" variant="secondary" onPress={() => setSelected(dayKey(new Date()))} />
            </View>
            <AppButton label="Nuevo evento" icon={Plus} size="small" onPress={() => router.push("/calendar/new")} />
          </View>

          <SurfaceCard style={styles.filterCard}>
            <Text style={styles.filterLabel}>Mascota</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              <ChoiceChip label="Todas" selected={!filters.petId} onPress={() => setFilters({ ...filters, petId: null })} />
              {pets.map((pet) => <ChoiceChip key={pet.id} label={pet.name} selected={filters.petId === pet.id} onPress={() => setFilters({ ...filters, petId: pet.id })} />)}
            </ScrollView>
            <Text style={styles.filterLabel}>Categoría</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {categories.map(([value, label]) => <ChoiceChip key={value} label={label} selected={activeCategory === value} onPress={() => setFilters({ ...filters, category: value })} />)}
            </ScrollView>
            <Text style={styles.filterLabel}>Estado y tipo</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {[
                ["status", "", "Todos"], ["status", "pending", "Pendientes"], ["status", "overdue", "Atrasados"],
                ["status", "completed", "Completados"], ["status", "attended", "Atendidos"],
                ["status", "cancelled", "Cancelados"], ["status", "disabled", "Desactivados"],
                ["type", "", "Todos los tipos"], ["type", "care_task", "Cuidados"], ["type", "appointment", "Citas"],
                ["type", "care_execution", "Ejecuciones"], ["type", "health_record", "Médicos"],
                ["type", "calendar_event", "Eventos"], ["type", "calendar_reminder", "Avisos"],
              ].map(([filter, value, label]) => {
                const selectedValue = filters[filter as "status" | "type"];
                return <ChoiceChip key={`${filter}-${value}`} label={label} selected={selectedValue === value}
                  onPress={() => setFilters({ ...filters, [filter]: value })} />;
              })}
            </ScrollView>
          </SurfaceCard>

          <SurfaceCard style={styles.calendarCard}>
            {mode === "month" ? (
              <>
                <View style={styles.weekdays}>{["L", "M", "X", "J", "V", "S", "D"].map((day, index) => <Text key={index} style={styles.weekday}>{day}</Text>)}</View>
                <View style={styles.monthGrid}>
                  {visibleDates.map((date) => {
                    const selectedMonth = parseDay(selected).getMonth();
                    const isCurrentMonth = parseDay(date).getMonth() === selectedMonth;
                    const hasEvents = eventDays.has(date);
                    return (
                      <Pressable key={date} accessibilityRole="button" accessibilityLabel={date} accessibilityState={{ selected: date === selected }}
                        onPress={() => setSelected(date)}
                        style={[styles.dayCell, !isCurrentMonth && styles.outsideMonth, date === selected && styles.selectedDay]}>
                        <Text style={[styles.dayNumber, date === selected && styles.selectedDayText]}>{Number(date.slice(-2))}</Text>
                        {hasEvents ? <View style={[styles.dayDot, date === selected && styles.selectedDot]} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : mode === "week" ? (
              <View style={styles.weekStrip}>
                {visibleDates.map((date) => (
                  <Pressable key={date} accessibilityRole="button" accessibilityState={{ selected: date === selected }} onPress={() => setSelected(date)} style={[styles.weekDay, date === selected && styles.selectedWeekDay]}>
                    <Text style={[styles.weekDayName, date === selected && styles.selectedDayText]}>{parseDay(date).toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "")}</Text>
                    <Text style={[styles.weekDayNumber, date === selected && styles.selectedDayText]}>{Number(date.slice(-2))}</Text>
                    {eventDays.has(date) ? <View style={[styles.dayDot, date === selected && styles.selectedDot]} /> : null}
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.dayHeader}><CalendarDays size={18} color={colors.blue} /><Text style={styles.dayHeaderText}>{dateTitle}</Text></View>
            )}
          </SurfaceCard>

          <View style={styles.eventsHeader}>
            <View><Text style={styles.sectionTitle}>Eventos del día</Text><Text style={styles.muted}>{parseDay(selected).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</Text></View>
            <Text style={styles.count}>{selectedItems.length}</Text>
          </View>
          {loading ? <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Cargando calendario local…</Text></View>
            : error ? <SurfaceCard style={styles.empty}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><AppButton label="Reintentar" variant="secondary" onPress={() => void load()} /></SurfaceCard>
              : selectedItems.length ? selectedItems.map((entry) => (
                <EventCard key={entry.id} entry={entry} onOpen={() => openItem(entry)} onReminder={() => openReminder(entry)} />
              )) : <SurfaceCard style={styles.empty}><Clock3 size={24} color={colors.textMuted} /><Text style={styles.emptyTitle}>Día despejado</Text><Text style={styles.muted}>No hay eventos registrados para esta fecha y estos filtros.</Text><AppButton label="Crear evento" size="small" onPress={() => router.push("/calendar/new")} /></SurfaceCard>}
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
  widePage: { maxWidth: 1120, width: "100%", alignSelf: "center" },
  toolbar: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  modePicker: { flexDirection: "row", gap: 5 },
  navigation: { flexDirection: "row", alignItems: "center", gap: 8, flexGrow: 1, justifyContent: "center" },
  navButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, backgroundColor: colors.surface },
  period: { minWidth: 130, textAlign: "center", color: colors.blueDark, fontSize: 16, fontWeight: "800", textTransform: "capitalize" },
  filterCard: { gap: spacing.sm },
  filterLabel: { color: colors.text, fontSize: 12, fontWeight: "800", marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 7 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: "#F1F5F9" },
  chipSelected: { backgroundColor: colors.blue },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: colors.surface },
  calendarCard: { padding: spacing.md },
  weekdays: { flexDirection: "row", marginBottom: 6 },
  weekday: { flex: 1, textAlign: "center", color: colors.textMuted, fontWeight: "800", paddingVertical: 6 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1.35, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  outsideMonth: { opacity: 0.35 },
  selectedDay: { backgroundColor: colors.blue },
  dayNumber: { color: colors.text, fontWeight: "700", fontSize: 13 },
  selectedDayText: { color: colors.surface },
  dayDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.yellow, marginTop: 3 },
  selectedDot: { backgroundColor: colors.surface },
  weekStrip: { flexDirection: "row", justifyContent: "space-between", gap: 4 },
  weekDay: { flex: 1, minHeight: 76, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: "#F8FAFC" },
  selectedWeekDay: { backgroundColor: colors.blue },
  weekDayName: { color: colors.textMuted, fontSize: 11, textTransform: "capitalize" },
  weekDayNumber: { color: colors.text, fontSize: 18, fontWeight: "800", marginTop: 4 },
  dayHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12 },
  dayHeaderText: { color: colors.blueDark, fontSize: 16, fontWeight: "800", textTransform: "capitalize" },
  eventsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  sectionTitle: { color: colors.blueDark, fontSize: 18, fontWeight: "800" },
  muted: { color: colors.textMuted, fontSize: 13, textTransform: "capitalize" },
  count: { color: colors.blue, backgroundColor: colors.blueSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5, fontWeight: "800" },
  eventCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 12 },
  eventMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 11 },
  eventMark: { width: 4, height: 40, borderRadius: 4, backgroundColor: colors.blue },
  markYellow: { backgroundColor: colors.yellow },
  markGreen: { backgroundColor: colors.green },
  eventTime: { minWidth: 65 },
  timeText: { color: colors.blueDark, fontSize: 12, fontWeight: "800" },
  statusText: { color: colors.textMuted, fontSize: 10, marginTop: 3, textTransform: "capitalize" },
  eventCopy: { flex: 1, minWidth: 0 },
  eventTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  eventMeta: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  bellButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.blueSoft },
  empty: { alignItems: "center", gap: spacing.sm, padding: spacing.xl },
  emptyTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "800" },
  loading: { padding: spacing.xl, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.sm },
  error: { color: colors.orange, textAlign: "center" },
});
