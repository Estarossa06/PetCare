import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { ActivityIndicator, Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from "react-native";
import { AlertTriangle, ArrowLeft, CheckCircle2, Cloud, RefreshCw, RotateCcw } from "lucide-react-native";
import { AppButton } from "../../../components/ui/AppButton";
import { ScreenHeader } from "../../../components/ui/ScreenHeader";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { useAuth } from "../../auth/AuthProvider";
import { synchronizePets } from "../petSync";
import { getLastSuccessfulSync, getSyncItems, resolveSyncConflict, retrySyncOperation, type SyncChoice, type SyncItem } from "../recovery";
import { reconcileCalendarNotifications } from "../../calendar/calendarNotifications";
import { colors, radius, spacing } from "../../../theme/tokens";

type Decision = { item: SyncItem; choice: SyncChoice } | null;
const entityNames: Record<string, string> = {
  pet: "Mascota", health_record: "Registro médico", care_task: "Cuidado", care_execution: "Ejecución de cuidado",
  appointment: "Cita", calendar_event: "Evento", calendar_reminder: "Recordatorio", health_attachment: "Archivo médico",
};
const fieldNames: Record<string, string> = {
  name: "Nombre", species: "Especie", breed: "Raza", sex: "Sexo", birth_date: "Fecha de nacimiento", weight_kg: "Peso",
  color: "Color", notes: "Notas", pet_id: "Mascota vinculada", title: "Título", description: "Descripción", occurred_at: "Fecha",
  record_type: "Tipo", record_subtype: "Categoría", professional_name: "Profesional", clinic_name: "Clínica", observations: "Observaciones",
  details: "Detalles", next_event_at: "Próximo evento", task_id: "Cuidado vinculado", scheduled_for: "Programado para",
  executed_at: "Realizado el", status: "Estado", starts_at: "Inicio", ends_at: "Fin", location: "Lugar", timezone: "Zona horaria",
  category: "Categoría", remind_at: "Recordar el", enabled: "Activo", deleted_at: "Eliminación",
};

function statusLabel(item: SyncItem): string {
  if (item.status === "conflict") return "Necesita una decisión";
  if (item.status === "failed") return item.last_error === "REMOTE_FILE_STORAGE_NOT_CONFIGURED" ? "Archivo solo en este dispositivo" : "No se pudo enviar";
  if (item.status === "blocked") return "Esperando un cambio relacionado";
  if (item.status === "in_flight") return "Enviando cambios";
  return "Pendiente de envío";
}

function errorDescription(item: SyncItem): string {
  if (item.last_error === "REMOTE_FILE_STORAGE_NOT_CONFIGURED") return "Los archivos adjuntos todavía no se guardan en la nube; permanecen en este dispositivo.";
  if (["INVALID_RELATION_OR_VALUE", "INVALID_REQUIRED_FIELD", "ENTITY_NOT_FOUND", "PET_NOT_FOUND"].includes(item.last_error ?? "")) return "Revisa la información y sus vínculos desde el módulo correspondiente. Tus datos locales se conservan.";
  if (item.status === "blocked") return "Primero debe completarse otra operación vinculada.";
  if (item.status === "conflict") return "Este registro cambió en este dispositivo y en otro. Compara las versiones y elige cuál conservar.";
  if (item.status === "failed") return "Tus datos locales se conservan. Puedes volver a intentar con la información actual del registro.";
  return "El cambio está guardado localmente y se enviará cuando PetCare pueda conectarse.";
}

function friendlyValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Sin dato";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseSnapshot(value: string | null): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function conflictFields(item: SyncItem): string[] {
  try {
    const configured = JSON.parse(item.conflicting_fields ?? "[]") as string[];
    if (configured.length) return configured.slice(0, 5);
    const local = JSON.parse(item.local_snapshot ?? "{}") as Record<string, unknown>;
    const remote = JSON.parse(item.server_snapshot ?? "{}") as Record<string, unknown>;
    return Object.keys(local).filter((key) => key in remote && JSON.stringify(local[key]) !== JSON.stringify(remote[key]) && key !== "id" && key !== "owner_id").slice(0, 5);
  } catch { return []; }
}

function remoteIsDeleted(item: SyncItem): boolean {
  try { return Boolean((JSON.parse(item.server_snapshot ?? "{}") as Record<string, unknown>).deleted_at); } catch { return false; }
}

export default function SyncStatusScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [items, setItems] = useState<SyncItem[]>([]);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [decision, setDecision] = useState<Decision>(null);

  const load = useCallback(async () => {
    if (!user) { setItems([]); setLoading(false); return; }
    try {
      const [nextItems, nextLastSync] = await Promise.all([getSyncItems(), getLastSuccessfulSync()]);
      setItems(nextItems);
      setLastSync(nextLastSync);
    } catch {
      setMessage("No pudimos actualizar el estado. Tus datos guardados localmente siguen disponibles.");
    } finally { setLoading(false); }
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]));

  const counts = useMemo(() => ({
    pending: items.filter((item) => ["pending", "in_flight", "blocked"].includes(item.status)).length,
    failed: items.filter((item) => item.status === "failed").length,
    conflicts: items.filter((item) => item.status === "conflict").length,
  }), [items]);

  const syncNow = async () => {
    setWorking(true); setMessage("");
    try { await synchronizePets(); await load(); setMessage("Sincronización actualizada."); }
    catch { await load(); setMessage("No se completó el envío. Los cambios permanecen guardados y se pueden intentar después."); }
    finally { setWorking(false); }
  };

  const retry = async (item: SyncItem) => {
    setWorking(true); setMessage("");
    try { await retrySyncOperation(item.operation_id); await synchronizePets(); await load(); }
    catch { await load(); setMessage("No se pudo completar el reintento. La operación sigue guardada para revisarla después."); }
    finally { setWorking(false); }
  };

  const resolve = async () => {
    if (!decision?.item.conflict_id) return;
    setWorking(true); setMessage("");
    try {
      await resolveSyncConflict(decision.item.conflict_id, decision.choice);
      setDecision(null);
      await reconcileCalendarNotifications().catch(() => undefined);
      await synchronizePets();
      await load();
      setMessage(decision.choice === "local" ? "Se conservó tu versión y se envió como un nuevo cambio seguro." : "Se aplicó la versión recibida del otro dispositivo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo resolver el conflicto; no se modificaron tus datos.");
    } finally { setWorking(false); }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.inner}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}><ArrowLeft size={19} color={colors.blue} /><Text style={styles.backText}>Configuración</Text></Pressable>
          <ScreenHeader eyebrow="Tus datos" title="Sincronización" subtitle="Consulta el estado de tus cambios entre dispositivos." />
          <SurfaceCard>
            <View style={styles.summaryTop}><Cloud size={21} color={colors.blue} /><Text style={styles.summaryTitle}>Estado de tus datos</Text></View>
            <Text style={styles.summaryText}>{counts.pending === 0 && counts.failed === 0 && counts.conflicts === 0 ? "Todo está actualizado." : `${counts.pending} pendientes · ${counts.failed} con error · ${counts.conflicts} por resolver`}</Text>
            <Text style={styles.caption}>{lastSync ? `Última actualización: ${new Date(lastSync).toLocaleString("es-CO")}` : "Aún no hay una sincronización completada en esta cuenta."}</Text>
            <AppButton label="Sincronizar ahora" icon={RefreshCw} loading={working} onPress={() => void syncNow()} />
          </SurfaceCard>
          {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
          {loading ? <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.caption}>Revisando tus cambios…</Text></View> : items.length === 0 ? <SurfaceCard><View style={styles.empty}><CheckCircle2 size={26} color={colors.green} /><Text style={styles.summaryTitle}>No hay operaciones pendientes</Text><Text style={styles.caption}>Tus cambios sincronizables están al día.</Text></View></SurfaceCard> : items.map((item) => {
            const local = parseSnapshot(item.local_snapshot);
            const remote = parseSnapshot(item.server_snapshot);
            const fields = item.status === "conflict" ? conflictFields(item) : [];
            const remoteDeleted = remoteIsDeleted(item);
            const canUseLocal = !(remoteDeleted && !local.deleted_at);
            return <SurfaceCard key={item.operation_id}>
              <View style={styles.itemHeading}>
                {item.status === "conflict" || item.status === "failed" ? <AlertTriangle size={18} color={colors.orange} /> : <Cloud size={18} color={colors.blue} />}
                <View style={styles.itemCopy}><Text style={styles.itemTitle}>{entityNames[item.entity_type] ?? "Dato"} · {item.action === "delete" ? "eliminación" : item.action === "create" ? "nuevo" : "actualización"}</Text><Text style={styles.status}>{statusLabel(item)}</Text></View>
              </View>
              <Text style={styles.body}>{errorDescription(item)}</Text>
              {item.status === "conflict" ? <>
                <View style={styles.versions}><Text style={styles.version}>Versión local: {friendlyValue(local.version ?? item.local_revision)}</Text><Text style={styles.version}>Versión remota: {item.server_version ?? "—"}</Text><Text style={styles.version}>Revisión local: {item.local_revision}</Text></View>
                {fields.map((field) => <View key={field} style={styles.compare}><Text style={styles.compareLabel}>{fieldNames[field] ?? field}</Text><Text style={styles.compareValue}>Este dispositivo: {friendlyValue(local[field])}</Text><Text style={styles.compareValue}>Otro dispositivo: {friendlyValue(remote[field])}</Text></View>)}
                {!canUseLocal ? <Text style={styles.caution}>El servidor eliminó el registro; el protocolo actual no permite restaurarlo sobre esa eliminación.</Text> : null}
                {remoteDeleted && item.external_dependent_count > 0 ? <Text style={styles.caution}>Hay cambios vinculados. Se conservarán localmente y mantendrán la relación con este registro eliminado.</Text> : null}
                <View style={styles.actions}><AppButton label="Conservar mi versión" variant="secondary" disabled={working || !canUseLocal} onPress={() => setDecision({ item, choice: "local" })} /><AppButton label="Usar versión remota" variant="secondary" disabled={working} onPress={() => setDecision({ item, choice: "remote" })} /></View>
              </> : item.status === "failed" && item.entity_type !== "health_attachment" ? <AppButton label="Reintentar envío" size="small" icon={RotateCcw} disabled={working} onPress={() => void retry(item)} /> : null}
            </SurfaceCard>;
          })}
          <Text style={styles.footnote}>Los archivos adjuntos médicos permanecen en este dispositivo. Las notificaciones se programan por separado en cada dispositivo.</Text>
        </View>
      </ScrollView>
      <Modal visible={Boolean(decision)} transparent animationType="fade" onRequestClose={() => { if (!working) setDecision(null); }}>
        <View style={styles.modalBackdrop}><View accessibilityRole="alert" accessibilityViewIsModal style={styles.modal}>
          <Text style={styles.modalTitle}>{decision?.choice === "local" ? "¿Conservar tu versión?" : "¿Usar la versión remota?"}</Text>
          <Text style={styles.body}>{decision?.choice === "local" ? "Se creará una operación nueva basada en la versión remota actual. El intento anterior se conserva y el nuevo usa una clave idempotente propia." : "La información local de este registro se reemplazará con la copia remota. Esta decisión no se puede deshacer desde la aplicación."}</Text>
          <View style={styles.actions}><AppButton label="Cancelar" variant="secondary" disabled={working} onPress={() => setDecision(null)} /><AppButton label="Confirmar" loading={working} onPress={() => void resolve()} /></View>
        </View></View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: 100 },
  inner: { width: "100%", maxWidth: 720, alignSelf: "center", gap: spacing.md },
  back: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  backText: { color: colors.blue, fontSize: 13, fontWeight: "700" },
  summaryTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  summaryTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  summaryText: { color: colors.text, fontSize: 14, fontWeight: "700", marginTop: spacing.md },
  caption: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  message: { color: colors.orange, fontSize: 13, lineHeight: 19 },
  loading: { minHeight: 90, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  empty: { minHeight: 100, justifyContent: "center", alignItems: "center", gap: spacing.xs },
  itemHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  itemCopy: { flex: 1, gap: 3 },
  itemTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  status: { color: colors.orange, fontSize: 12, fontWeight: "700" },
  body: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginVertical: spacing.sm },
  versions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  version: { color: colors.blueDark, backgroundColor: colors.blueSoft, fontSize: 11, fontWeight: "800", paddingVertical: 6, paddingHorizontal: 9, borderRadius: radius.pill },
  compare: { paddingVertical: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border, gap: 2 },
  compareLabel: { color: colors.text, fontSize: 12, fontWeight: "800" },
  compareValue: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  caution: { color: colors.orange, fontSize: 11, lineHeight: 16, marginTop: spacing.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 17, paddingHorizontal: spacing.xs },
  modalBackdrop: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: "rgba(15,23,42,0.52)" },
  modal: { width: "100%", maxWidth: 460, alignSelf: "center", gap: spacing.sm, padding: spacing.lg, borderRadius: radius.md, backgroundColor: colors.surface },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
});
