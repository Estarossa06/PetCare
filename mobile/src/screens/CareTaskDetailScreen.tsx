import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ArrowLeft, CalendarDays, Check, Clock3, Pause, Play, Trash2 } from "lucide-react-native";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { careCategoryLabels, frequencyLabels } from "../care/careService";
import { careRepository } from "../care/careRepository";
import { displayTaskTime } from "../care/careRepository";
import type { CareExecution, CareTask, ExecutionStatus } from "../care/types";
import { colors, radius, spacing } from "../theme/tokens";

function dateLabel(value: string, timezone: string) {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function CareTaskDetailScreen({ petId, taskId }: { petId: string; taskId: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [task, setTask] = useState<CareTask | null>(null);
  const [executions, setExecutions] = useState<CareExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await careRepository.getById(taskId);
      if (!result || result.task.pet_id !== petId) {
        setTask(null);
        setError("No encontramos esta actividad para la mascota.");
        return;
      }
      setTask(result.task);
      setExecutions(result.executions);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la actividad.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, [taskId, petId]);

  const toggleEnabled = async (enabled: boolean) => {
    if (!task) return;
    setSaving(true);
    try {
      await careRepository.setEnabled(task.id, enabled);
      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "No se pudo cambiar el estado.");
    } finally {
      setSaving(false);
    }
  };

  const complete = async (status: ExecutionStatus) => {
    if (!task) return;
    setSaving(true);
    setError(null);
    try {
      await careRepository.recordExecution(task.id, status);
      await load();
    } catch (completionError) {
      setError(completionError instanceof Error ? completionError.message : "No se pudo registrar la ejecución.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    try {
      await careRepository.softDelete(taskId);
      setConfirmDelete(false);
      router.replace(`/pet/${petId}/care`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar la actividad.");
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]}>
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.top}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver a cuidados" onPress={() => router.back()} style={styles.back}><ArrowLeft size={19} color={colors.text} /></Pressable>
            <Text style={styles.topTitle}>Detalle de actividad</Text>
            <View style={styles.spacer} />
          </View>
          {loading ? (
            <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.meta}>Cargando rutina local…</Text></View>
          ) : task ? (
            <>
              <SurfaceCard style={styles.hero}>
                <Text style={styles.eyebrow}>{careCategoryLabels[task.category].toLocaleUpperCase("es-ES")}</Text>
                <Text style={styles.title}>{task.title}</Text>
                <Text style={styles.meta}>{frequencyLabels[task.schedule.frequency]}{task.schedule.frequency === "custom" ? ` · cada ${task.schedule.interval} ${task.schedule.unit}` : ""}</Text>
                <View style={styles.row}><CalendarDays size={16} color={colors.blue} /><Text style={styles.meta}>Inicio · {dateLabel(task.starts_at, task.timezone)}</Text></View>
                {task.next_run_at ? <View style={styles.row}><Clock3 size={16} color={colors.blue} /><Text style={styles.nextRun}>Próxima · {dateLabel(task.next_run_at, task.timezone)}</Text></View> : null}
                {task.ends_at ? <Text style={styles.meta}>Finaliza · {dateLabel(task.ends_at, task.timezone)}</Text> : null}
                <View style={styles.actions}>
                  <AppButton label="Editar" onPress={() => router.push(`/pet/${petId}/care/${task.id}/edit`)} />
                  <AppButton label={task.enabled ? "Desactivar" : "Activar"} icon={task.enabled ? Pause : Play} variant="secondary" onPress={() => void toggleEnabled(!task.enabled)} disabled={saving} />
                  <AppButton label="Eliminar" icon={Trash2} variant="quiet" onPress={() => setConfirmDelete(true)} />
                </View>
                <View style={styles.switchRow}><Text style={styles.meta}>{task.enabled ? "Actividad habilitada" : "Actividad deshabilitada"}</Text><Switch value={Boolean(task.enabled)} onValueChange={(value) => void toggleEnabled(value)} disabled={saving} trackColor={{ true: colors.blue }} /></View>
              </SurfaceCard>
              {(task.description || task.observations) ? (
                <SurfaceCard style={styles.card}>
                  <Text style={styles.sectionTitle}>Detalles</Text>
                  {task.description ? <Text style={styles.body}>{task.description}</Text> : null}
                  {task.observations ? <Text style={styles.meta}>Observaciones · {task.observations}</Text> : null}
                  <Text style={styles.meta}>Zona horaria · {task.timezone}</Text>
                </SurfaceCard>
              ) : null}
              {task.enabled && task.next_run_at ? (
                <SurfaceCard style={styles.completeCard}>
                  <Text style={styles.sectionTitle}>Registrar esta ejecución</Text>
                  <Text style={styles.meta}>La fecha real se guardará al confirmar. El evento programado se conservará en el historial.</Text>
                  <View style={styles.actions}>
                    <AppButton label="Completar ahora" icon={Check} onPress={() => void complete("completed")} loading={saving} />
                    <AppButton label="Omitir" variant="secondary" onPress={() => void complete("omitted")} disabled={saving} />
                    <AppButton label="Cancelar ejecución" variant="quiet" onPress={() => void complete("cancelled")} disabled={saving} />
                  </View>
                </SurfaceCard>
              ) : null}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Historial de ejecuciones</Text>
                {executions.length ? executions.map((execution) => (
                  <SurfaceCard key={execution.id} style={styles.executionCard}>
                    <View style={[styles.executionMark, execution.status === "completed" ? styles.completeMark : styles.omittedMark]} />
                    <View style={styles.executionCopy}>
                      <Text style={styles.body}>{execution.status === "completed" ? "Completada" : execution.status === "omitted" ? "Omitida" : "Cancelada"}</Text>
                      <Text style={styles.meta}>Programada · {dateLabel(execution.scheduled_for, task.timezone)}</Text>
                      {execution.executed_at ? <Text style={styles.meta}>Realizada · {dateLabel(execution.executed_at, task.timezone)}</Text> : null}
                      {execution.notes ? <Text style={styles.meta}>{execution.notes}</Text> : null}
                    </View>
                  </SurfaceCard>
                )) : <SurfaceCard style={styles.card}><Text style={styles.meta}>Todavía no hay ejecuciones registradas.</Text></SurfaceCard>}
              </View>
            </>
          ) : <SurfaceCard style={styles.card}><Text accessibilityRole="alert" style={styles.error}>{error}</Text><AppButton label="Volver a cuidados" onPress={() => router.replace(`/pet/${petId}/care`)} /></SurfaceCard>}
          {error && task ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <View style={styles.backdrop}>
          <SurfaceCard style={styles.confirm}>
            <View style={styles.confirmIcon}><Trash2 size={21} color={colors.orange} /></View>
            <Text style={styles.confirmTitle}>¿Eliminar esta actividad?</Text>
            <Text style={styles.meta}>Se conservará el registro de ejecuciones y la actividad quedará marcada como eliminada.</Text>
            <View style={styles.actions}><AppButton label="Cancelar" variant="secondary" onPress={() => setConfirmDelete(false)} /><AppButton label="Eliminar" onPress={() => void remove()} loading={saving} /></View>
          </SurfaceCard>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: 18, paddingBottom: 42 },
  wideScroll: { paddingLeft: 278, paddingHorizontal: 32, paddingTop: 26 },
  page: { width: "100%", gap: spacing.md },
  widePage: { maxWidth: 850, alignSelf: "center" },
  top: { height: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  back: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  topTitle: { color: colors.blueDark, fontWeight: "800" },
  spacer: { width: 40 },
  hero: { gap: spacing.md },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  title: { color: colors.blueDark, fontSize: 24, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 9 },
  meta: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  nextRun: { color: colors.green, fontSize: 13, fontWeight: "800" },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  card: { gap: spacing.md },
  completeCard: { gap: spacing.md, backgroundColor: "#FFFEF7" },
  section: { gap: spacing.md },
  sectionTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "800" },
  body: { color: colors.text, fontSize: 14, lineHeight: 21, fontWeight: "600" },
  executionCard: { flexDirection: "row", gap: spacing.md, padding: spacing.md },
  executionMark: { width: 8, minHeight: 42, borderRadius: 4 },
  completeMark: { backgroundColor: colors.green },
  omittedMark: { backgroundColor: colors.textMuted },
  executionCopy: { flex: 1, gap: 4 },
  loading: { padding: spacing.xl, flexDirection: "row", justifyContent: "center", gap: 10 },
  error: { color: colors.orange, fontSize: 13 },
  backdrop: { flex: 1, padding: 22, backgroundColor: "#0F172A66", justifyContent: "center", alignItems: "center" },
  confirm: { width: "100%", maxWidth: 440, gap: spacing.md },
  confirmIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.orangeSoft, alignItems: "center", justifyContent: "center" },
  confirmTitle: { color: colors.blueDark, fontSize: 18, fontWeight: "800" },
});
