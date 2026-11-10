import { useEffect, useState } from "react";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import { ArrowLeft, FilePlus2, FileText, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { AppTextField } from "../components/ui/TextField";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { medicalCategoryLabels, medicalService } from "../medical/medicalService";
import type { MedicalCategory, MedicalDetails, MedicalRecordInput, PickedMedicalFile } from "../medical/types";
import { colors, radius, spacing } from "../theme/tokens";

const categories: MedicalCategory[] = [
  "consultation", "vaccination", "deworming", "medication", "treatment",
  "surgery", "allergy", "diagnosis", "examination", "observation",
];

const detailFields: Partial<Record<MedicalCategory, { key: keyof MedicalDetails; label: string; placeholder: string }[]>> = {
  consultation: [
    { key: "consultationReason", label: "Motivo de consulta", placeholder: "¿Qué motivó la visita?" },
    { key: "recommendations", label: "Recomendaciones", placeholder: "Indicaciones del profesional" },
  ],
  vaccination: [
    { key: "vaccineName", label: "Nombre de la vacuna", placeholder: "Ej. vacuna antirrábica" },
    { key: "applicationDate", label: "Fecha de aplicación", placeholder: "AAAA-MM-DD" },
    { key: "nextDoseDate", label: "Próxima dosis", placeholder: "AAAA-MM-DD" },
  ],
  deworming: [
    { key: "dewormingProduct", label: "Producto", placeholder: "Producto administrado" },
    { key: "nextApplicationDate", label: "Próxima aplicación", placeholder: "AAAA-MM-DD" },
  ],
  medication: [
    { key: "medicationName", label: "Medicamento", placeholder: "Nombre del medicamento" },
    { key: "dose", label: "Dosis", placeholder: "Cantidad por toma" },
    { key: "frequency", label: "Frecuencia", placeholder: "Ej. cada 12 horas" },
    { key: "duration", label: "Duración", placeholder: "Ej. 7 días" },
  ],
  surgery: [
    { key: "procedure", label: "Procedimiento", placeholder: "Nombre o descripción del procedimiento" },
    { key: "postoperativeObservations", label: "Cuidados posteriores", placeholder: "Indicaciones posteriores a la cirugía" },
  ],
  examination: [
    { key: "examType", label: "Tipo de examen", placeholder: "Ej. análisis de sangre" },
    { key: "examResults", label: "Resultados", placeholder: "Resultados documentados" },
  ],
  treatment: [{ key: "recommendations", label: "Indicaciones del tratamiento", placeholder: "Plan o recomendaciones registradas" }],
  diagnosis: [{ key: "recommendations", label: "Indicaciones profesionales", placeholder: "Registra lo indicado por el profesional veterinario" }],
};

const today = new Date().toISOString().slice(0, 10);
const emptyDetails: MedicalDetails = {};

export default function MedicalRecordFormScreen({ petId, recordId }: { petId: string; recordId?: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [category, setCategory] = useState<MedicalCategory>("consultation");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(today);
  const [professionalName, setProfessionalName] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [observations, setObservations] = useState("");
  const [details, setDetails] = useState<MedicalDetails>(emptyDetails);
  const [files, setFiles] = useState<PickedMedicalFile[]>([]);
  const [existingFiles, setExistingFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(Boolean(recordId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!recordId) return;
    let active = true;
    void medicalService.getById(recordId).then((result) => {
      if (!active) return;
      if (!result || result.record.pet_id !== petId) {
        setError("No encontramos este registro para la mascota seleccionada.");
        return;
      }
      const { record } = result;
      setCategory(record.category);
      setTitle(record.title);
      setDescription(record.description ?? "");
      setOccurredAt(record.occurred_at.slice(0, 10));
      setProfessionalName(record.professional_name ?? "");
      setClinicName(record.clinic_name ?? "");
      setObservations(record.observations ?? "");
      setDetails(record.details);
      setExistingFiles(result.attachments.map(({ original_filename }) => original_filename));
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el registro.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [petId, recordId]);

  const pickFiles = async () => {
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "application/pdf", "text/*", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const selected = result.assets.map((asset) => ({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType ?? "application/octet-stream",
        size: asset.size ?? 1,
      }));
      setFiles((current) => [...current, ...selected]);
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : "No se pudieron seleccionar los archivos.");
    }
  };

  const submit = async () => {
    if (saving || loading) return;
    setSaving(true);
    setError(null);
    const input: MedicalRecordInput = {
      category,
      title,
      description,
      occurredAt,
      professionalName,
      clinicName,
      observations,
      details,
    };
    try {
      const saved = await medicalService.save(petId, input, recordId, files);
      router.replace(`/pet/${petId}/medical/${saved.id}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el registro médico.");
    } finally {
      setSaving(false);
    }
  };

  const updateDetail = (key: keyof MedicalDetails, value: string) => {
    setDetails((current) => ({ ...current, [key]: value || undefined }));
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]} keyboardShouldPersistTaps="handled">
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.top}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver al historial" onPress={() => router.back()} style={styles.back}>
              <ArrowLeft size={19} color={colors.text} />
            </Pressable>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>HISTORIAL MÉDICO</Text>
              <Text style={styles.title}>{recordId ? "Editar registro" : "Nuevo registro"}</Text>
            </View>
          </View>

          {loading ? (
            <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Cargando registro…</Text></View>
          ) : (
            <>
              <SurfaceCard style={styles.section}>
                <Text style={styles.sectionTitle}>Tipo de acontecimiento</Text>
                <View style={styles.categoryGrid}>
                  {categories.map((item) => (
                    <Pressable
                      key={item}
                      accessibilityRole="button"
                      accessibilityState={{ selected: category === item }}
                      onPress={() => {
                        if (category !== item) setDetails({});
                        setCategory(item);
                      }}
                      style={[styles.categoryButton, category === item && styles.categorySelected]}
                    >
                      <Text style={[styles.categoryText, category === item && styles.categoryTextSelected]}>{medicalCategoryLabels[item]}</Text>
                    </Pressable>
                  ))}
                </View>
              </SurfaceCard>

              <SurfaceCard style={styles.section}>
                <Text style={styles.sectionTitle}>Información del registro</Text>
                <AppTextField label="Título *" value={title} onChangeText={setTitle} placeholder="Ej. Control anual" />
                <AppTextField label="Descripción" value={description} onChangeText={setDescription} placeholder="Resumen del acontecimiento" multiline />
                <AppTextField label="Fecha del acontecimiento *" value={occurredAt} onChangeText={setOccurredAt} placeholder="AAAA-MM-DD" />
                <AppTextField label="Profesional veterinario" value={professionalName} onChangeText={setProfessionalName} placeholder="Nombre del profesional (opcional)" />
                <AppTextField label="Clínica veterinaria" value={clinicName} onChangeText={setClinicName} placeholder="Clínica (opcional)" />
                {category === "diagnosis" ? (
                  <Text style={styles.helper}>Registra únicamente un diagnóstico comunicado por un profesional veterinario.</Text>
                ) : null}
                {(detailFields[category] ?? []).map((field) => (
                  <AppTextField
                    key={field.key}
                    label={field.label}
                    value={details[field.key] ?? ""}
                    onChangeText={(value) => updateDetail(field.key, value)}
                    placeholder={field.placeholder}
                    multiline={field.key === "examResults" || field.key === "recommendations" || field.key === "postoperativeObservations"}
                  />
                ))}
                <AppTextField label="Observaciones" value={observations} onChangeText={setObservations} placeholder="Notas adicionales" multiline />
              </SurfaceCard>

              <SurfaceCard style={styles.section}>
                <Text style={styles.sectionTitle}>Documentos y fotografías</Text>
                <Text style={styles.helper}>Los archivos se guardan en el dispositivo; en SQLite solo conservamos sus referencias y metadatos.</Text>
                {existingFiles.map((name) => (
                  <View key={name} style={styles.fileRow}><FileText size={17} color={colors.blue} /><Text style={styles.fileName}>{name}</Text><Text style={styles.fileStatus}>Adjunto</Text></View>
                ))}
                {files.map((file, index) => (
                  <View key={`${file.name}-${index}`} style={styles.fileRow}>
                    <FileText size={17} color={colors.blue} />
                    <Text numberOfLines={1} style={styles.fileName}>{file.name}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${file.name}`} onPress={() => setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>
                      <X size={17} color={colors.textMuted} />
                    </Pressable>
                  </View>
                ))}
                <AppButton label="Adjuntar archivo" variant="secondary" icon={FilePlus2} onPress={() => void pickFiles()} />
              </SurfaceCard>

              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <View style={styles.actions}>
                <AppButton label="Cancelar" variant="secondary" onPress={() => router.back()} disabled={saving} />
                <AppButton label={recordId ? "Guardar cambios" : "Guardar registro"} onPress={() => void submit()} loading={saving} />
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
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
  section: { gap: spacing.md },
  sectionTitle: { color: colors.blueDark, fontSize: 15, fontWeight: "800" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  categorySelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  categoryText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  categoryTextSelected: { color: colors.surface },
  helper: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  fileRow: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 4 },
  fileName: { flex: 1, color: colors.text, fontSize: 13 },
  fileStatus: { color: colors.green, fontSize: 11, fontWeight: "700" },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  loading: { padding: spacing.xl, flexDirection: "row", justifyContent: "center", gap: 10 },
  muted: { color: colors.textMuted },
  error: { color: colors.orange, fontSize: 13 },
});
