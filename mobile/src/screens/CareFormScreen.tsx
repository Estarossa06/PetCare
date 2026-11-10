import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { AppTextField } from "../components/ui/TextField";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { careCategoryLabels, careService, frequencyLabels } from "../care/careService";
import { isoToLocalDateTime } from "../care/recurrence";
import type { CareCategory, CareFrequency, CareSchedule, RecurrenceUnit } from "../care/types";
import { colors, radius, spacing } from "../theme/tokens";

const categories: CareCategory[] = ["feeding", "walk", "bath", "hygiene", "medication", "vaccination", "deworming", "exercise", "custom"];
const frequencies: CareFrequency[] = ["once", "daily", "weekly", "monthly", "custom"];
const units: RecurrenceUnit[] = ["days", "weeks", "months"];
const unitLabels: Record<RecurrenceUnit, string> = { days: "Días", weeks: "Semanas", months: "Meses" };
const localNow = () => {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};
const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export default function CareFormScreen({ petId, taskId }: { petId: string; taskId?: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [category, setCategory] = useState<CareCategory>("feeding");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [observations, setObservations] = useState("");
  const [frequency, setFrequency] = useState<CareFrequency>("daily");
  const [interval, setInterval] = useState("1");
  const [unit, setUnit] = useState<RecurrenceUnit>("days");
  const [startsLocal, setStartsLocal] = useState(localNow);
  const [endsLocal, setEndsLocal] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(Boolean(taskId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;
    let active = true;
    void careService.getById(taskId).then((result) => {
      if (!active) return;
      if (!result || result.task.pet_id !== petId) {
        setError("No encontramos esta rutina para la mascota.");
        return;
      }
      const { task } = result;
      setCategory(task.category);
      setTitle(task.title);
      setDescription(task.description ?? "");
      setObservations(task.observations ?? "");
      setFrequency(task.schedule.frequency);
      setInterval(String(task.schedule.interval));
      setUnit(task.schedule.unit);
      setStartsLocal(isoToLocalDateTime(task.starts_at, task.timezone));
      setEndsLocal(task.ends_at ? isoToLocalDateTime(task.ends_at, task.timezone).slice(0, 10) : "");
      setTimezone(task.timezone);
      setEnabled(Boolean(task.enabled));
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la actividad.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [petId, taskId]);

  const save = async () => {
    if (saving || loading) return;
    setSaving(true);
    setError(null);
    const schedule: CareSchedule = {
      frequency,
      interval: frequency === "custom" ? Number(interval) : 1,
      unit: frequency === "daily" ? "days" : frequency === "weekly" ? "weeks" : frequency === "monthly" ? "months" : unit,
    };
    try {
      const task = await careService.save(petId, {
        category,
        title,
        description,
        observations,
        schedule,
        startsLocal,
        endsLocal,
        timezone,
        enabled,
      }, taskId);
      router.replace(`/pet/${petId}/care/${task.id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar la actividad.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]} keyboardShouldPersistTaps="handled">
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.top}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver a cuidados" onPress={() => router.back()} style={styles.back}><ArrowLeft size={19} color={colors.text} /></Pressable>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>RUTINAS Y BIENESTAR</Text>
              <Text style={styles.title}>{taskId ? "Editar actividad" : "Nueva actividad"}</Text>
            </View>
          </View>
          {loading ? (
            <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Cargando rutina…</Text></View>
          ) : (
            <>
              <SurfaceCard style={styles.card}>
                <Text style={styles.sectionTitle}>Tipo de cuidado</Text>
                <View style={styles.chips}>
                  {categories.map((item) => (
                    <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: category === item }} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipSelected]}>
                      <Text style={[styles.chipText, category === item && styles.chipTextSelected]}>{careCategoryLabels[item]}</Text>
                    </Pressable>
                  ))}
                </View>
                <AppTextField label="Nombre *" value={title} onChangeText={setTitle} placeholder={categoryDefault(category)} />
                <AppTextField label="Descripción" value={description} onChangeText={setDescription} placeholder="Detalles para recordar de esta rutina" multiline />
                <AppTextField label="Observaciones" value={observations} onChangeText={setObservations} placeholder="Indicaciones u observaciones" multiline />
              </SurfaceCard>

              <SurfaceCard style={styles.card}>
                <Text style={styles.sectionTitle}>Frecuencia y horario</Text>
                <View style={styles.chips}>
                  {frequencies.map((item) => (
                    <Pressable key={item} accessibilityRole="button" accessibilityState={{ selected: frequency === item }} onPress={() => setFrequency(item)} style={[styles.chip, frequency === item && styles.chipSelected]}>
                      <Text style={[styles.chipText, frequency === item && styles.chipTextSelected]}>{frequencyLabels[item]}</Text>
                    </Pressable>
                  ))}
                </View>
                {frequency === "custom" ? (
                  <View style={styles.customRow}>
                    <View style={styles.intervalInput}><AppTextField label="Cada" value={interval} onChangeText={setInterval} placeholder="2" keyboardType="number-pad" /></View>
                    {units.map((item) => (
                      <Pressable key={item} onPress={() => setUnit(item)} style={[styles.unitChip, unit === item && styles.unitChipSelected]}>
                        <Text style={[styles.chipText, unit === item && styles.chipTextSelected]}>{unitLabels[item]}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                <AppTextField
                  label="Inicio (fecha y hora local)"
                  value={startsLocal}
                  onChangeText={setStartsLocal}
                  placeholder="AAAA-MM-DDTHH:mm"
                  hint="Se interpreta en la zona horaria seleccionada. Ejemplo: 2026-11-09T08:30."
                />
                <AppTextField label="Finalizar después del día (opcional)" value={endsLocal} onChangeText={setEndsLocal} placeholder="AAAA-MM-DD" />
                <AppTextField label="Zona horaria IANA" value={timezone} onChangeText={setTimezone} placeholder="America/Bogota" hint="Ejemplo: America/Bogota. Mantiene la hora local al cruzar cambios de horario." />
                <View style={styles.switchRow}>
                  <View style={styles.switchCopy}><Text style={styles.switchTitle}>Actividad habilitada</Text><Text style={styles.muted}>Las actividades deshabilitadas no aparecen entre las próximas.</Text></View>
                  <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: colors.blue }} />
                </View>
              </SurfaceCard>
              <Text style={styles.frequencyHint}>
                {frequency === "once"
                  ? "La actividad se programa una sola vez. Al registrar su ejecución se deshabilitará."
                  : "Las repeticiones mantienen la hora local programada. Los días y meses se calculan como fechas de calendario en la zona horaria elegida; el fin de mes se ajusta al último día disponible."}
              </Text>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <AppButton label="Cancelar" variant="secondary" onPress={() => router.back()} disabled={saving} />
                <AppButton label={taskId ? "Guardar cambios" : "Guardar actividad"} onPress={() => void save()} loading={saving} />
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function categoryDefault(category: CareCategory) {
  const examples: Record<CareCategory, string> = {
    feeding: "Ej. Desayuno",
    walk: "Ej. Paseo de la mañana",
    bath: "Ej. Baño mensual",
    hygiene: "Ej. Cepillado dental",
    medication: "Ej. Medicamento diario",
    vaccination: "Ej. Refuerzo de vacuna",
    deworming: "Ej. Desparasitación",
    exercise: "Ej. Juego activo",
    custom: "Ej. Cuidado personalizado",
  };
  return examples[category];
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 18, paddingBottom: 42 },
  wideScroll: { paddingLeft: 278, paddingHorizontal: 32, paddingTop: 26 },
  page: { width: "100%", gap: spacing.md },
  widePage: { maxWidth: 850, alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: 6 },
  back: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  heading: { flex: 1, gap: 3 },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  title: { color: colors.blueDark, fontSize: 23, fontWeight: "800" },
  card: { gap: spacing.md },
  sectionTitle: { color: colors.blueDark, fontSize: 15, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: colors.surface },
  customRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  intervalInput: { width: 90 },
  unitChip: { paddingHorizontal: 11, paddingVertical: 10, borderRadius: radius.pill, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, marginBottom: 2 },
  unitChipSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  switchRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
  switchCopy: { flex: 1, gap: 4 },
  switchTitle: { color: colors.blueDark, fontSize: 13, fontWeight: "800" },
  muted: { color: colors.textMuted, fontSize: 12 },
  frequencyHint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  loading: { padding: spacing.xl, flexDirection: "row", justifyContent: "center", gap: 10 },
  error: { color: colors.orange, fontSize: 13 },
});
