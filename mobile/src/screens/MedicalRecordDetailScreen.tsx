import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AlertCircle, ArrowLeft, CalendarDays, Edit3, FileText, Stethoscope, Trash2 } from "lucide-react-native";
import { ActivityIndicator, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { medicalCategoryLabels, medicalService } from "../medical/medicalService";
import { medicalFileStorage } from "../medical/medicalFileStorage";
import type { MedicalAttachment, MedicalRecord } from "../medical/types";
import { colors, radius, spacing } from "../theme/tokens";

type AttachmentView = MedicalAttachment & { uri: string | null };

function dateLabel(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

export default function MedicalRecordDetailScreen({ petId, recordId }: { petId: string; recordId: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [record, setRecord] = useState<MedicalRecord | null>(null);
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await medicalService.getById(recordId);
      if (!result || result.record.pet_id !== petId) {
        setRecord(null);
        setError("No encontramos este registro médico.");
        return;
      }
      setRecord(result.record);
      setAttachments(await Promise.all(result.attachments.map(async (attachment) => ({
        ...attachment,
        uri: await medicalFileStorage.getUri(attachment.storage_key),
      }))));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el registro médico.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [recordId, petId]);

  const deleteRecord = async () => {
    setDeleting(true);
    setError(null);
    try {
      await medicalService.softDelete(recordId);
      setConfirmDelete(false);
      router.replace(`/pet/${petId}/medical`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el registro.");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]}>
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.top}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver al historial" onPress={() => router.back()} style={styles.back}>
              <ArrowLeft size={19} color={colors.text} />
            </Pressable>
            <Text style={styles.topTitle}>Detalle médico</Text>
            <View style={styles.spacer} />
          </View>
          {loading ? (
            <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Cargando desde este dispositivo…</Text></View>
          ) : record ? (
            <>
              <SurfaceCard style={styles.hero}>
                <Text style={styles.eyebrow}>{medicalCategoryLabels[record.category].toLocaleUpperCase("es-ES")}</Text>
                <Text style={styles.title}>{record.title}</Text>
                <View style={styles.dateRow}><CalendarDays size={16} color={colors.blue} /><Text style={styles.date}>{dateLabel(record.occurred_at)}</Text></View>
                <View style={styles.actions}>
                  <AppButton label="Editar" icon={Edit3} variant="secondary" onPress={() => router.push(`/pet/${petId}/medical/${recordId}/edit`)} />
                  <AppButton label="Eliminar" icon={Trash2} variant="quiet" onPress={() => setConfirmDelete(true)} />
                </View>
              </SurfaceCard>
              <SurfaceCard style={styles.card}>
                <Text style={styles.sectionTitle}>Información</Text>
                {record.description ? <Text style={styles.body}>{record.description}</Text> : null}
                {record.professional_name ? <View style={styles.detailRow}><Stethoscope size={17} color={colors.blue} /><Text style={styles.body}>{record.professional_name}</Text></View> : null}
                {record.clinic_name ? <Text style={styles.secondary}>Clínica · {record.clinic_name}</Text> : null}
                {record.observations ? <Text style={styles.secondary}>Observaciones · {record.observations}</Text> : null}
                {record.next_event_at ? <Text style={styles.nextEvent}>Próximo evento · {dateLabel(record.next_event_at)}</Text> : null}
                {Object.entries(record.details).filter(([, value]) => Boolean(value)).map(([key, value]) => (
                  <View key={key} style={styles.detailItem}>
                    <Text style={styles.detailLabel}>{detailLabel(key)}</Text>
                    <Text style={styles.body}>{value}</Text>
                  </View>
                ))}
              </SurfaceCard>
              <SurfaceCard style={styles.card}>
                <Text style={styles.sectionTitle}>Archivos adjuntos</Text>
                {attachments.length ? attachments.map((attachment) => (
                  <Pressable
                    key={attachment.id}
                    accessibilityRole="button"
                    onPress={() => attachment.uri ? void Linking.openURL(attachment.uri) : setError(`No se pudo abrir ${attachment.original_filename}.`)}
                    style={styles.attachment}
                  >
                    {attachment.mime_type.startsWith("image/") && attachment.uri ? (
                      <Image source={{ uri: attachment.uri }} style={styles.attachmentImage} />
                    ) : <FileText size={22} color={colors.blue} />}
                    <View style={styles.attachmentCopy}>
                      <Text numberOfLines={1} style={styles.body}>{attachment.original_filename}</Text>
                      <Text style={styles.secondary}>{attachment.mime_type} · {formatBytes(attachment.size_bytes)}</Text>
                    </View>
                    <Text style={styles.openText}>Abrir</Text>
                  </Pressable>
                )) : <Text style={styles.secondary}>No hay documentos adjuntos.</Text>}
              </SurfaceCard>
              <Text style={styles.meta}>Creado {dateLabel(record.created_at)} · Actualizado {dateLabel(record.updated_at)}</Text>
            </>
          ) : (
            <SurfaceCard style={styles.card}>
              <AlertCircle size={22} color={colors.orange} />
              <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
              <AppButton label="Volver al historial" onPress={() => router.replace(`/pet/${petId}/medical`)} />
            </SurfaceCard>
          )}
          {error && record ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        </View>
      </ScrollView>
      <Modal visible={confirmDelete} transparent animationType="fade" onRequestClose={() => setConfirmDelete(false)}>
        <View style={styles.backdrop}>
          <SurfaceCard style={styles.confirm}>
            <View style={styles.confirmIcon}><Trash2 size={21} color={colors.orange} /></View>
            <Text style={styles.confirmTitle}>¿Eliminar este registro?</Text>
            <Text style={styles.secondary}>Se ocultará del historial y conservará su marca de eliminación para sincronización futura.</Text>
            <View style={styles.actions}>
              <AppButton label="Cancelar" variant="secondary" onPress={() => setConfirmDelete(false)} disabled={deleting} />
              <AppButton label="Eliminar" onPress={() => void deleteRecord()} loading={deleting} />
            </View>
          </SurfaceCard>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function detailLabel(key: string) {
  const labels: Record<string, string> = {
    medicationName: "Medicamento", dose: "Dosis", frequency: "Frecuencia", duration: "Duración",
    vaccineName: "Vacuna", applicationDate: "Aplicación", nextDoseDate: "Próxima dosis",
    dewormingProduct: "Producto", nextApplicationDate: "Próxima aplicación",
    consultationReason: "Motivo", recommendations: "Recomendaciones", procedure: "Procedimiento",
    postoperativeObservations: "Cuidados posteriores", examType: "Tipo de examen", examResults: "Resultados",
  };
  return labels[key] ?? key;
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  title: { color: colors.blueDark, fontSize: 25, fontWeight: "800" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  date: { color: colors.textMuted, fontSize: 13 },
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  card: { gap: spacing.md },
  sectionTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "800" },
  body: { color: colors.text, fontSize: 14, lineHeight: 21, flexShrink: 1 },
  secondary: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  detailItem: { gap: 3 },
  detailLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  nextEvent: { color: colors.green, fontSize: 13, fontWeight: "700" },
  attachment: { flexDirection: "row", alignItems: "center", gap: 11, minHeight: 54 },
  attachmentImage: { width: 46, height: 46, borderRadius: 9 },
  attachmentCopy: { flex: 1 },
  openText: { color: colors.blue, fontSize: 12, fontWeight: "800" },
  meta: { color: colors.textMuted, fontSize: 11, textAlign: "center" },
  loading: { padding: spacing.xl, flexDirection: "row", justifyContent: "center", gap: 10 },
  muted: { color: colors.textMuted },
  error: { color: colors.orange, fontSize: 13, flex: 1 },
  backdrop: { flex: 1, padding: 22, backgroundColor: "#0F172A66", justifyContent: "center", alignItems: "center" },
  confirm: { width: "100%", maxWidth: 440, gap: spacing.md },
  confirmIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.orangeSoft, alignItems: "center", justifyContent: "center" },
  confirmTitle: { color: colors.blueDark, fontSize: 18, fontWeight: "800" },
});
