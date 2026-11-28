import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ClipboardList,
  FileHeart,
  FlaskConical,
  Pill,
  Plus,
  Scissors,
  Search,
  ShieldPlus,
  Syringe,
  Tablets,
  TriangleAlert,
} from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type ColorValue } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/ui/AppButton";
import { AppTextField } from "../../../components/ui/TextField";
import { EmptyState } from "../../../components/ui/EmptyState";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { getPetCareDatabase } from "../../../db/database";
import { getLocalAccountId } from "../../../db/localAccount";
import { medicalCategoryLabels, medicalService } from "../medicalService";
import type { MedicalCategory, MedicalRecord } from "../types";
import { colors, radius, spacing } from "../../../theme/tokens";

const categories: { id: MedicalCategory | ""; label: string }[] = [
  { id: "", label: "Todas" },
  { id: "consultation", label: "Consultas" },
  { id: "vaccination", label: "Vacunas" },
  { id: "deworming", label: "Desparasitación" },
  { id: "medication", label: "Medicamentos" },
  { id: "treatment", label: "Tratamientos" },
  { id: "surgery", label: "Cirugías" },
  { id: "allergy", label: "Alergias" },
  { id: "diagnosis", label: "Diagnósticos" },
  { id: "examination", label: "Exámenes" },
  { id: "observation", label: "Observaciones" },
];

const categoryVisuals: Record<MedicalCategory, { icon: LucideIcon; color: ColorValue; background: ColorValue }> = {
  consultation: { icon: ClipboardList, color: colors.blue, background: colors.blueSoft },
  vaccination: { icon: Syringe, color: colors.green, background: colors.greenSoft },
  deworming: { icon: ShieldPlus, color: colors.teal, background: colors.greenSoft },
  medication: { icon: Pill, color: colors.purple, background: colors.lavenderSoft },
  treatment: { icon: Activity, color: colors.blueDark, background: colors.blueSoft },
  surgery: { icon: Scissors, color: colors.danger, background: colors.dangerSoft },
  allergy: { icon: TriangleAlert, color: colors.orange, background: colors.orangeSoft },
  diagnosis: { icon: FileHeart, color: colors.blueDark, background: colors.blueMuted },
  examination: { icon: FlaskConical, color: colors.purple, background: colors.lavenderSoft },
  observation: { icon: Tablets, color: colors.textMuted, background: colors.blueSoft },
};

function dateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

function RecordCard({ record, onPress }: { record: MedicalRecord; onPress: () => void }) {
  const visual = categoryVisuals[record.category];
  const Icon = visual.icon;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver ${record.title}`}
      onPress={onPress}
      style={styles.recordCard}
    >
        <View style={[styles.recordIcon, { backgroundColor: visual.background }]}>
          <Icon size={20} color={visual.color} />
        </View>
        <View style={styles.recordCopy}>
          <Text style={styles.recordTitle}>{record.title}</Text>
          <Text style={styles.recordDate}>
            {medicalCategoryLabels[record.category]} · {dateLabel(record.occurred_at)}
          </Text>
          {record.description || record.observations ? (
            <Text numberOfLines={1} style={styles.recordDescription}>
              {record.description || record.observations}
            </Text>
          ) : null}
        </View>
        <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function MedicalHistoryScreen({ petId }: { petId: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const narrow = width < 400;
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [upcoming, setUpcoming] = useState<MedicalRecord[]>([]);
  const [petName, setPetName] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<MedicalCategory | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const db = await getPetCareDatabase();
      const ownerId = await getLocalAccountId();
      const pet = await db.getFirstAsync<{ name: string }>(
        "SELECT name FROM pets WHERE owner_id = ? AND id = ? AND deleted_at IS NULL",
        ownerId,
        petId,
      );
      if (!pet) throw new Error("No encontramos esta mascota en la cuenta local.");
      setPetName(pet.name);
      const [items, due] = await Promise.all([
        medicalService.list(petId, { search, category }),
        medicalService.upcoming(petId),
      ]);
      setRecords(items);
      setUpcoming(due);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el historial médico.");
    } finally {
      setLoading(false);
    }
  }, [petId, search, category]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView contentContainerStyle={[styles.scroll, wide && styles.wideScroll]} showsVerticalScrollIndicator={false}>
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={[styles.top, narrow && styles.topNarrow]}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver al perfil" onPress={() => router.back()} style={styles.back}>
              <ArrowLeft size={19} color={colors.text} />
            </Pressable>
            <View style={styles.heading}>
              <Text style={styles.title}>Historial médico</Text>
              {petName ? <Text style={styles.subtitle}>{petName}</Text> : null}
            </View>
            <View style={narrow && styles.headerActionNarrow}>
              <AppButton label="Nuevo registro" icon={Plus} size="small" onPress={() => router.push(`/pet/${petId}/medical/new`)} />
            </View>
          </View>
          <AppTextField
            label="Buscar en el historial"
            value={search}
            onChangeText={setSearch}
            placeholder="Título o descripción"
            leadingIcon={Search}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {categories.map((item) => (
              <Pressable
                key={item.id || "all"}
                accessibilityRole="button"
                accessibilityState={{ selected: category === item.id }}
                onPress={() => setCategory(item.id)}
                style={[styles.chip, category === item.id && styles.chipSelected]}
              >
                <Text style={[styles.chipText, category === item.id && styles.chipTextSelected]}>{item.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {upcoming.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Próximos eventos médicos</Text>
              {upcoming.map((record) => (
                <Pressable
                  accessibilityRole="button"
                  key={`upcoming-${record.id}`}
                  onPress={() => router.push(`/pet/${petId}/medical/${record.id}`)}
                >
                  <View style={styles.upcomingCard}>
                    <View style={styles.upcomingMark} />
                    <View style={styles.upcomingCopy}>
                      <Text style={styles.recordTitle}>{record.title}</Text>
                      <Text style={styles.recordDate}>
                        {record.next_event_at ? dateLabel(record.next_event_at) : ""}
                        {" · "}{medicalCategoryLabels[record.category]}
                      </Text>
                    </View>
                    <Text style={styles.chevron}>›</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Línea de tiempo</Text>
            {loading ? (
              <View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Cargando historial local…</Text></View>
            ) : error ? (
              <SurfaceCard style={styles.errorCard}>
                <AlertCircle size={20} color={colors.orange} />
                <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
                <AppButton label="Reintentar" variant="secondary" onPress={() => void load()} />
              </SurfaceCard>
            ) : records.length ? (
              <View style={styles.timeline}>
                {records.map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    onPress={() => router.push(`/pet/${petId}/medical/${record.id}`)}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <EmptyState
                  title={search || category ? "No encontramos registros" : "El historial comienza aquí"}
                  description={search || category ? "Prueba con otra búsqueda o categoría." : "Guarda consultas, vacunas, tratamientos y otros datos médicos importantes."}
                  icon={ClipboardList}
                />
                {!search && !category ? (
                  <AppButton label="Agregar primer registro" icon={Plus} onPress={() => router.push(`/pet/${petId}/medical/new`)} />
                ) : null}
              </View>
            )}
          </View>
          <Text style={styles.footnote}>Tus notas no sustituyen la orientación veterinaria.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 18, paddingBottom: 42, paddingTop: 10 },
  wideScroll: { paddingLeft: 278, paddingHorizontal: 32, paddingTop: 26 },
  page: { width: "100%", gap: spacing.md },
  widePage: { maxWidth: 1050, alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  topNarrow: { flexWrap: "wrap" },
  headerActionNarrow: { width: "100%", alignItems: "flex-end" },
  back: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  heading: { flex: 1, gap: 3 },
  title: { color: colors.blueDark, fontSize: 24, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: 12 },
  chips: { gap: 8, paddingRight: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: colors.onAccent },
  section: { gap: spacing.md },
  sectionTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "700" },
  timeline: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  recordCard: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  recordIcon: { width: 38, height: 38, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  recordCopy: { flex: 1, gap: 3, minWidth: 0 },
  recordTitle: { color: colors.blueDark, fontSize: 14, fontWeight: "600" },
  recordDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  recordDate: { color: colors.textMuted, fontSize: 11 },
  chevron: { color: colors.blue, fontSize: 25, fontWeight: "300" },
  upcomingCard: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  upcomingMark: { width: 3, alignSelf: "stretch", minHeight: 36, backgroundColor: colors.yellow, borderRadius: 4 },
  upcomingCopy: { flex: 1, gap: 4 },
  loading: { padding: spacing.xl, flexDirection: "row", justifyContent: "center", gap: 10 },
  muted: { color: colors.textMuted, fontSize: 13 },
  errorCard: { gap: spacing.md },
  errorText: { color: colors.orange, flex: 1 },
  emptyCard: { gap: spacing.md, paddingVertical: spacing.xl },
  footnote: { color: colors.textMuted, fontSize: 11, textAlign: "center", paddingHorizontal: spacing.md },
});
