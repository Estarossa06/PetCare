import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Activity,
  Bath,
  Check,
  Clock3,
  Dumbbell,
  Droplets,
  Heart,
  Pill,
  Plus,
  Search,
  ShieldPlus,
  Syringe,
  Utensils,
  Footprints,
  type LucideIcon,
} from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { AppTextField } from "../components/ui/TextField";
import { EmptyState } from "../components/ui/EmptyState";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { careCategoryLabels } from "../care/careService";
import { careRepository } from "../care/careRepository";
import type { CareCategory, CareExecution, CareTask } from "../care/types";
import { colors, radius, spacing } from "../theme/tokens";

type ActivityTask = CareTask & { pet_name?: string };
type HistoryItem = CareExecution & { task_title: string; category: CareCategory; timezone: string };

const categoryVisuals: Record<CareCategory, { icon: LucideIcon; color: string; background: string }> = {
  feeding: { icon: Utensils, color: "#A16207", background: colors.yellowSoft },
  walk: { icon: Footprints, color: colors.blue, background: colors.blueSoft },
  bath: { icon: Bath, color: "#0369A1", background: "#E0F2FE" },
  hygiene: { icon: Droplets, color: "#0F766E", background: "#CCFBF1" },
  medication: { icon: Pill, color: "#7C3AED", background: "#EDE9FE" },
  vaccination: { icon: Syringe, color: "#15803D", background: colors.greenSoft },
  deworming: { icon: ShieldPlus, color: "#0F766E", background: "#CCFBF1" },
  exercise: { icon: Dumbbell, color: "#0369A1", background: "#E0F2FE" },
  custom: { icon: Heart, color: "#BE123C", background: "#FFE4E6" },
};

const categoryFilters: { value: CareCategory | ""; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "feeding", label: "Alimentación" },
  { value: "walk", label: "Paseos" },
  { value: "bath", label: "Baños" },
  { value: "hygiene", label: "Higiene" },
  { value: "medication", label: "Medicamentos" },
  { value: "vaccination", label: "Vacunas" },
  { value: "deworming", label: "Desparasitación" },
  { value: "exercise", label: "Ejercicio" },
  { value: "custom", label: "Personalizados" },
];

function localDateTime(value: string, timezone: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function statusLabel(status: CareExecution["status"]) {
  if (status === "completed") return "Completada";
  if (status === "omitted") return "Omitida";
  return "Cancelada";
}

function TaskCard({ task, onPress, onExecution }: {
  task: ActivityTask;
  onPress: () => void;
  onExecution: (status: "completed" | "omitted") => void;
}) {
  const visual = categoryVisuals[task.category];
  const Icon = visual.icon;
  return (
    <SurfaceCard style={styles.taskCard}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Ver ${task.title}`} onPress={onPress} style={styles.taskMain}>
        <View style={[styles.taskIcon, { backgroundColor: visual.background }]}><Icon size={20} color={visual.color} /></View>
        <View style={styles.taskCopy}>
          <Text style={styles.categoryLabel}>{careCategoryLabels[task.category]}</Text>
          <Text style={styles.taskTitle}>{task.title}</Text>
          {task.pet_name ? <Text style={styles.meta}>{task.pet_name}</Text> : null}
          <Text style={styles.meta}>{task.next_run_at ? localDateTime(task.next_run_at, task.timezone) : "Sin próxima ejecución"}</Text>
        </View>
        <View style={[styles.statusDot, task.enabled ? styles.enabledDot : styles.disabledDot]} />
      </Pressable>
      {task.enabled && task.next_run_at ? (
        <View style={styles.taskActions}>
          <AppButton label="Completar" icon={Check} size="small" onPress={() => onExecution("completed")} />
          <AppButton label="Omitir" size="small" variant="quiet" onPress={() => onExecution("omitted")} />
        </View>
      ) : <Text style={styles.disabledLabel}>Desactivada</Text>}
    </SurfaceCard>
  );
}

export default function CareDashboardScreen({ petId }: { petId: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [upcoming, setUpcoming] = useState<ActivityTask[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<CareCategory | "">("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [section, setSection] = useState<"activities" | "history">("activities");
  const [petName, setPetName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { getPetCareDatabase } = await import("../db/database");
      const { getLocalAccountId } = await import("../db/localAccount");
      const db = await getPetCareDatabase();
      const ownerId = await getLocalAccountId();
      const pet = await db.getFirstAsync<{ name: string }>(
        "SELECT name FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId,
        petId,
      );
      if (!pet) throw new Error("No encontramos esta mascota en la cuenta local.");
      setPetName(pet.name);
      const [items, due, executions] = await Promise.all([
        careRepository.list(petId, { search, category, enabled: enabledFilter }),
        careRepository.upcoming(petId, 20),
        careRepository.history(petId),
      ]);
      setTasks(items);
      setUpcoming(due);
      setHistory(executions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar los cuidados.");
    } finally {
      setLoading(false);
    }
  }, [petId, search, category, enabledFilter]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const registerExecution = async (task: CareTask, status: "completed" | "omitted") => {
    setBusyTask(task.id);
    setError(null);
    try {
      await careRepository.recordExecution(task.id, status);
      await load();
    } catch (executionError) {
      setError(executionError instanceof Error ? executionError.message : "No se pudo registrar la ejecución.");
    } finally {
      setBusyTask(null);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]} showsVerticalScrollIndicator={false}>
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.header}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver al perfil" onPress={() => router.back()} style={styles.back}>
              <Text style={styles.backArrow}>‹</Text>
            </Pressable>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>RUTINAS Y BIENESTAR</Text>
              <Text style={styles.title}>Cuidados</Text>
              <Text style={styles.subtitle}>{petName ? `Actividades de ${petName}` : "Planifica y registra sus rutinas."}</Text>
            </View>
            <AppButton label="Nueva actividad" icon={Plus} size="small" onPress={() => router.push(`/pet/${petId}/care/new`)} />
          </View>

          <View style={styles.sectionSwitch}>
            {(["activities", "history"] as const).map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityState={{ selected: section === value }}
                onPress={() => setSection(value)}
                style={[styles.sectionTab, section === value && styles.sectionTabSelected]}
              >
                <Text style={[styles.sectionTabText, section === value && styles.sectionTabTextSelected]}>
                  {value === "activities" ? "Actividades" : "Historial realizado"}
                </Text>
              </Pressable>
            ))}
          </View>

          {section === "activities" ? (
            <>
              {upcoming.length ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Próximas actividades</Text>
                  {upcoming.slice(0, 3).map((task) => (
                    <Pressable
                      key={`upcoming-${task.id}`}
                      accessibilityRole="button"
                      onPress={() => router.push(`/pet/${petId}/care/${task.id}`)}
                    >
                      <SurfaceCard style={styles.upcomingCard}>
                        <Clock3 size={18} color={colors.blue} />
                        <View style={styles.upcomingCopy}>
                          <Text style={styles.taskTitle}>{task.title}</Text>
                          <Text style={styles.meta}>{localDateTime(task.next_run_at ?? task.starts_at, task.timezone)}</Text>
                        </View>
                      </SurfaceCard>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={styles.search}>
                <Search size={18} color={colors.textMuted} />
                <AppTextField label="Buscar actividades" value={search} onChangeText={setSearch} placeholder="Nombre de la rutina" style={styles.searchInput} />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                {categoryFilters.map((item) => (
                  <Pressable key={item.value || "all"} accessibilityRole="button" onPress={() => setCategory(item.value)} style={[styles.chip, category === item.value && styles.chipSelected]}>
                    <Text style={[styles.chipText, category === item.value && styles.chipTextSelected]}>{item.label}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.statusFilters}>
                {([
                  ["all", "Todas"],
                  ["enabled", "Habilitadas"],
                  ["disabled", "Deshabilitadas"],
                ] as const).map(([value, label]) => (
                  <Pressable key={value} onPress={() => setEnabledFilter(value)} style={[styles.statusChip, enabledFilter === value && styles.statusChipSelected]}>
                    <Text style={[styles.statusChipText, enabledFilter === value && styles.statusChipTextSelected]}>{label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Rutinas</Text>
                {loading ? (
                  <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.meta}>Cargando cuidados locales…</Text></View>
                ) : error ? (
                  <SurfaceCard style={styles.emptyCard}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><AppButton label="Reintentar" variant="secondary" onPress={() => void load()} /></SurfaceCard>
                ) : tasks.length ? (
                  <View style={styles.taskList}>
                    {tasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onPress={() => router.push(`/pet/${petId}/care/${task.id}`)}
                        onExecution={(status) => void registerExecution(task, status)}
                      />
                    ))}
                    {busyTask ? <ActivityIndicator color={colors.blue} /> : null}
                  </View>
                ) : (
                  <SurfaceCard style={styles.emptyCard}>
                    <EmptyState
                      icon={Activity}
                      title={search || category ? "No encontramos actividades" : "Una rutina a la vez"}
                      description={search || category ? "Cambia los filtros o la búsqueda." : "Agrega un cuidado recurrente o una actividad puntual para tu mascota."}
                    />
                    {!search && !category ? <AppButton label="Crear actividad" icon={Plus} onPress={() => router.push(`/pet/${petId}/care/new`)} /> : null}
                  </SurfaceCard>
                )}
              </View>
            </>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Ejecuciones registradas</Text>
              {loading ? (
                <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.meta}>Cargando historial…</Text></View>
              ) : history.length ? history.map((item) => {
                const visual = categoryVisuals[item.category];
                const Icon = visual.icon;
                return (
                  <SurfaceCard key={item.id} style={styles.historyCard}>
                    <View style={[styles.taskIcon, { backgroundColor: visual.background }]}><Icon size={19} color={visual.color} /></View>
                    <View style={styles.taskCopy}>
                      <Text style={styles.taskTitle}>{item.task_title}</Text>
                      <Text style={styles.meta}>{statusLabel(item.status)} · Programada {localDateTime(item.scheduled_for, item.timezone)}</Text>
                      {item.executed_at ? <Text style={styles.meta}>Realizada {localDateTime(item.executed_at, item.timezone)}</Text> : null}
                      {item.notes ? <Text style={styles.meta}>{item.notes}</Text> : null}
                    </View>
                  </SurfaceCard>
                );
              }) : (
                <SurfaceCard style={styles.emptyCard}>
                  <EmptyState icon={Check} title="Aún no hay ejecuciones" description="Al completar u omitir una rutina, aparecerá aquí el historial." />
                </SurfaceCard>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 18, paddingBottom: 42, paddingTop: 10 },
  wideScroll: { paddingLeft: 278, paddingHorizontal: 32, paddingTop: 26 },
  page: { width: "100%", gap: spacing.lg },
  widePage: { maxWidth: 1050, alignSelf: "center" },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  backArrow: { color: colors.text, fontSize: 28, lineHeight: 32, marginTop: -4 },
  heading: { flex: 1, gap: 3 },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  title: { color: colors.blueDark, fontSize: 24, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: 13 },
  sectionSwitch: { flexDirection: "row", backgroundColor: colors.blueSoft, padding: 4, borderRadius: radius.sm },
  sectionTab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  sectionTabSelected: { backgroundColor: colors.surface },
  sectionTabText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  sectionTabTextSelected: { color: colors.blue },
  section: { gap: spacing.md },
  sectionTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "800" },
  upcomingCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md },
  upcomingCopy: { flex: 1, gap: 3 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  searchInput: { flex: 1, borderWidth: 0, backgroundColor: "transparent" },
  chips: { gap: 8, paddingRight: 20 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: colors.surface },
  statusFilters: { flexDirection: "row", gap: 8 },
  statusChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  statusChipSelected: { borderColor: colors.blueMuted, backgroundColor: colors.blueSoft },
  statusChipText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  statusChipTextSelected: { color: colors.blue },
  taskList: { gap: 10 },
  taskCard: { gap: spacing.sm, padding: spacing.md },
  taskMain: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  taskIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  taskCopy: { flex: 1, gap: 3 },
  categoryLabel: { color: colors.blue, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  taskTitle: { color: colors.blueDark, fontSize: 14, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  statusDot: { width: 9, height: 9, borderRadius: 5 },
  enabledDot: { backgroundColor: colors.green },
  disabledDot: { backgroundColor: colors.textMuted },
  taskActions: { flexDirection: "row", alignItems: "center", gap: 6, justifyContent: "flex-end", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  disabledLabel: { color: colors.textMuted, fontSize: 11, textAlign: "right" },
  loading: { padding: spacing.xl, flexDirection: "row", justifyContent: "center", gap: 10 },
  emptyCard: { gap: spacing.md },
  error: { color: colors.orange, fontSize: 13 },
  historyCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md },
});
