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
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { AppTextField } from "../components/ui/TextField";
import { EmptyState } from "../components/ui/EmptyState";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { getPetCareDatabase } from "../db/database";
import { getLocalAccountId } from "../db/localAccount";
import { medicalCategoryLabels, medicalService } from "../medical/medicalService";
import type { MedicalCategory, MedicalRecord } from "../medical/types";
import { colors, radius, spacing } from "../theme/tokens";

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

const categoryVisuals: Record<MedicalCategory, { icon: LucideIcon; color: string; background: string }> = {
  consultation: { icon: ClipboardList, color: colors.blue, background: colors.blueSoft },
  vaccination: { icon: Syringe, color: "#15803D", background: "#DCFCE7" },
  deworming: { icon: ShieldPlus, color: "#0F766E", background: "#CCFBF1" },
  medication: { icon: Pill, color: "#7C3AED", background: "#EDE9FE" },
  treatment: { icon: Activity, color: "#0369A1", background: "#E0F2FE" },
  surgery: { icon: Scissors, color: "#BE123C", background: "#FFE4E6" },
  allergy: { icon: TriangleAlert, color: "#C2410C", background: colors.orangeSoft },
  diagnosis: { icon: FileHeart, color: "#1D4ED8", background: "#DBEAFE" },
  examination: { icon: FlaskConical, color: "#6D28D9", background: "#F3E8FF" },
  observation: { icon: Tablets, color: "#475569", background: "#F1F5F9" },
};

function dateLabel(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return date.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

function RecordCard({ record, onPress }: { record: MedicalRecord; onPress: () => void }) {
  const visual = categoryVisuals[record.category];
  const Icon = visual.icon;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Ver ${record.title}`} onPress={onPress}>
      <SurfaceCard style={styles.recordCard}>
        <View style={[styles.recordIcon, { backgroundColor: visual.background }]}>
          <Icon size={20} color={visual.color} />
        </View>
        <View style={styles.recordCopy}>
          <Text style={styles.recordCategory}>{medicalCategoryLabels[record.category]}</Text>
          <Text style={styles.recordTitle}>{record.title}</Text>
          <Text numberOfLines={2} style={styles.recordDescription}>
            {record.description || record.observations || "Sin descripción adicional"}
          </Text>
          <Text style={styles.recordDate}>{dateLabel(record.occurred_at)}</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </SurfaceCard>
    </Pressable>
  );
}

export default function MedicalHistoryScreen({ petId }: { petId: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
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
          <View style={styles.top}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver al perfil" onPress={() => router.back()} style={styles.back}>
              <ArrowLeft size={19} color={colors.text} />
            </Pressable>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>CUIDADO Y BIENESTAR</Text>
              <Text style={styles.title}>Historial médico</Text>
              <Text style={styles.subtitle}>{petName ? `Registros de ${petName}` : "Acontecimientos importantes, en orden."}</Text>
            </View>
            <AppButton label="Nuevo registro" icon={Plus} size="small" onPress={() => router.push(`/pet/${petId}/medical/new`)} />
          </View>
          <View style={styles.search}>
            <Search size={18} color={colors.textMuted} />
            <AppTextField
              label="Buscar en el historial"
              value={search}
              onChangeText={setSearch}
              placeholder="Título o descripción"
              style={styles.searchInput}
            />
          </View>
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
                  <SurfaceCard style={styles.upcomingCard}>
                    <View style={styles.upcomingMark} />
                    <View style={styles.upcomingCopy}>
                      <Text style={styles.recordTitle}>{record.title}</Text>
                      <Text style={styles.recordDate}>
                        {record.next_event_at ? dateLabel(record.next_event_at) : ""}
                        {" · "}{medicalCategoryLabels[record.category]}
                      </Text>
                    </View>
                  </SurfaceCard>
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
              <SurfaceCard style={styles.emptyCard}>
                <EmptyState
                  title={search || category ? "No encontramos registros" : "El historial comienza aquí"}
                  description={search || category ? "Prueba con otra búsqueda o categoría." : "Guarda consultas, vacunas, tratamientos y otros datos médicos importantes."}
                  icon={ClipboardList}
                />
                {!search && !category ? (
                  <AppButton label="Agregar primer registro" icon={Plus} onPress={() => router.push(`/pet/${petId}/medical/new`)} />
                ) : null}
              </SurfaceCard>
            )}
          </View>
          <Text style={styles.footnote}>Los diagnósticos son notas que registras a partir de indicaciones de profesionales veterinarios.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingHorizontal: 18, paddingBottom: 42, paddingTop: 10 },
  wideScroll: { paddingLeft: 278, paddingHorizontal: 32, paddingTop: 26 },
  page: { width: "100%", gap: spacing.lg },
  widePage: { maxWidth: 1050, alignSelf: "center" },
  top: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  back: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  heading: { flex: 1, gap: 3 },
  eyebrow: { color: colors.blue, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  title: { color: colors.blueDark, fontSize: 23, fontWeight: "800" },
  subtitle: { color: colors.textMuted, fontSize: 13 },
  search: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md },
  searchInput: { flex: 1, borderWidth: 0, backgroundColor: "transparent" },
  chips: { gap: 8, paddingRight: 20 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipSelected: { backgroundColor: colors.blue, borderColor: colors.blue },
  chipText: { color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  chipTextSelected: { color: colors.surface },
  section: { gap: spacing.md },
  sectionTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "800" },
  timeline: { gap: 10 },
  recordCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.md },
  recordIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  recordCopy: { flex: 1, gap: 4 },
  recordCategory: { color: colors.blue, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  recordTitle: { color: colors.blueDark, fontSize: 15, fontWeight: "800" },
  recordDescription: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  recordDate: { color: colors.textMuted, fontSize: 11 },
  chevron: { color: colors.blue, fontSize: 25, fontWeight: "300" },
  upcomingCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: spacing.md },
  upcomingMark: { width: 4, alignSelf: "stretch", minHeight: 42, backgroundColor: colors.yellow, borderRadius: 4 },
  upcomingCopy: { flex: 1, gap: 4 },
  loading: { padding: spacing.xl, flexDirection: "row", justifyContent: "center", gap: 10 },
  muted: { color: colors.textMuted, fontSize: 13 },
  errorCard: { gap: spacing.md },
  errorText: { color: colors.orange, flex: 1 },
  emptyCard: { gap: spacing.md },
  footnote: { color: colors.textMuted, fontSize: 11, lineHeight: 17, textAlign: "center", paddingHorizontal: spacing.md },
});
