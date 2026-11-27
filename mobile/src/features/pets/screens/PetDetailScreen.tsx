import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ArrowLeft, CalendarDays, Edit3, HeartPulse, Info, MapPin, Trash2, VenusAndMars, Weight, Palette, PawPrint, type LucideIcon } from "lucide-react-native";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/ui/AppButton";
import { ConfirmActionModal } from "../../../components/ui/ConfirmActionModal";
import { PetAvatar } from "../../../components/ui/PetAvatar";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { petPhotoStorage, petService } from "../petService";
import type { Pet } from "../types";
import { colors, radius, spacing } from "../../../theme/tokens";

type PetProfile = Pet & { photoUri: string | null };

function speciesLabel(species: string): string {
  const known: Record<string, string> = { dog: "Perro", perro: "Perro", cat: "Gato", gato: "Gato", bird: "Ave", ave: "Ave", other: "Otra especie", undetermined: "No determinada", unknown: "No determinada" };
  return known[species] ?? species;
}

function breedLabel(breed: string | null): string {
  if (!breed) return "Sin registrar";
  const known: Record<string, string> = {
    undetermined: "No determinada",
    unknown: "No determinada",
    "breed not visually distinguishable": "No determinada visualmente",
    "mixed-breed dog": "Mestizo",
    "domestic shorthair cat": "Gato doméstico de pelo corto",
  };
  return known[breed.trim().toLowerCase()] ?? breed;
}

function ageLabel(pet: Pet): string | null {
  if (pet.birth_date) {
    const birth = new Date(`${pet.birth_date}T00:00:00`);
    const months = Math.max(0,
      (new Date().getFullYear() - birth.getFullYear()) * 12 +
      new Date().getMonth() - birth.getMonth(),
    );
    if (months < 24) return `${months} ${months === 1 ? "mes" : "meses"}`;
    const years = Math.floor(months / 12);
    const remaining = months % 12;
    return remaining ? `${years} años y ${remaining} meses` : `${years} ${years === 1 ? "año" : "años"}`;
  }
  if (pet.approximate_age_months !== null) {
    if (pet.approximate_age_months < 24) return `Aproximadamente ${pet.approximate_age_months} meses`;
    const years = Math.floor(pet.approximate_age_months / 12);
    const remaining = pet.approximate_age_months % 12;
    return `Aproximadamente ${years}${remaining ? ` años y ${remaining} meses` : ` ${years === 1 ? "año" : "años"}`}`;
  }
  return null;
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailIcon}><Icon size={16} color={colors.blue} /></View>
      <View style={styles.detailCopy}>
        <Text style={styles.detailLabel}>{label}</Text>
        <Text style={styles.detailValue}>{value}</Text>
      </View>
    </View>
  );
}

function friendly(value: string | null | undefined): string {
  if (!value || ["undetermined", "unknown", "not determined"].includes(value.trim().toLowerCase())) return "Sin registrar";
  return value;
}

export default function PetDetailScreen({ petId }: { petId: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [pet, setPet] = useState<PetProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadPet = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await petService.getById(petId);
      if (!result) {
        setPet(null);
        setError("Esta mascota no existe o ya fue eliminada.");
        return;
      }
      const photoUri = result.photo_storage_key
        ? await petPhotoStorage.getPhotoUri(result.photo_storage_key)
        : null;
      setPet({ ...result, photoUri });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el perfil.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPet();
  }, [petId]);

  const deletePet = async () => {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await petService.delete(petId);
      setConfirmDelete(false);
      router.replace("/(tabs)/pets");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "No se pudo eliminar el perfil.");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const age = pet ? ageLabel(pet) : null;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, wide && styles.wideScrollContent]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.topBar}>
            <Pressable accessibilityRole="button" accessibilityLabel="Volver a mascotas" onPress={() => router.back()} style={styles.backButton}>
              <ArrowLeft size={19} color={colors.text} />
            </Pressable>
            <Text style={styles.topTitle}>Perfil de mascota</Text>
            <View style={styles.topSpacer} />
          </View>

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.blue} />
              <Text style={styles.loadingText}>Cargando carnet…</Text>
            </View>
          ) : pet ? (
            <>
              <SurfaceCard style={styles.carnet}>
                <View style={styles.carnetHeader}>
                  <View style={styles.carnetMark}><PawPrint size={19} color={colors.blue} /></View>
                  <View style={styles.carnetBrand}><Text style={styles.carnetBrandName}>PetCare</Text><Text style={styles.carnetEyebrow}>CARNET VETERINARIO</Text></View>
                  <Pressable accessibilityRole="button" accessibilityLabel="Editar perfil de mascota" onPress={() => router.push({ pathname: "/pet/[id]/edit", params: { id: pet.id } })} style={styles.editButton}><Edit3 size={17} color={colors.blue} /></Pressable>
                </View>
                <View style={styles.petSummary}>
                  <View style={styles.photoFrame}>
                    {pet.photoUri ? (
                      <Image source={{ uri: pet.photoUri }} style={styles.heroPhoto} />
                    ) : (
                      <PetAvatar
                        name={pet.name}
                        emoji={pet.species === "cat" ? "🐈" : pet.species === "bird" ? "🐦" : "🐕"}
                        size="large"
                        tone={pet.species === "cat" ? "lavender" : "yellow"}
                      />
                    )}
                  </View>
                  <View style={styles.heroText}>
                    <Text style={styles.petName}>{pet.name}</Text>
                    <Text style={styles.petSubtitle}>
                      {[speciesLabel(pet.species), breedLabel(pet.breed)].filter((value) => value !== "Sin registrar").join(" · ") || speciesLabel(pet.species)}
                    </Text>
                    {age ? <Text style={styles.ageText}>{age}</Text> : null}
                  </View>
                </View>
                <View style={styles.identitySection}>
                  <Text style={styles.sectionTitle}>Identificación</Text>
                  <View style={styles.detailsGrid}>
                    <View style={styles.detailCell}><DetailRow icon={PawPrint} label="Especie" value={speciesLabel(pet.species)} /></View>
                    <View style={styles.detailCell}><DetailRow icon={Info} label="Raza" value={breedLabel(pet.breed)} /></View>
                    <View style={styles.detailCell}><DetailRow icon={VenusAndMars} label="Sexo" value={pet.sex === "female" ? "Hembra" : pet.sex === "male" ? "Macho" : pet.sex === "unknown" ? "Prefiero no indicar" : "Sin registrar"} /></View>
                    <View style={styles.detailCell}><DetailRow icon={CalendarDays} label="Nacimiento" value={pet.birth_date ? new Date(`${pet.birth_date}T00:00:00`).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" }) : "Sin registrar"} /></View>
                    <View style={styles.detailCell}><DetailRow icon={CalendarDays} label="Edad" value={age ?? "Sin registrar"} /></View>
                    <View style={styles.detailCell}><DetailRow icon={Weight} label="Peso" value={pet.weight_kg !== null ? `${pet.weight_kg} kg` : "Sin registrar"} /></View>
                    <View style={styles.detailCell}><DetailRow icon={Palette} label="Color" value={friendly(pet.color)} /></View>
                  </View>
                </View>
                <View style={styles.carnetActions}>
                  <Pressable accessibilityRole="button" onPress={() => router.push(`/pet/${pet.id}/medical`)} style={styles.actionTile}><CalendarDays size={19} color={colors.blue} /><Text style={styles.actionLabel}>Historial médico</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => router.push(`/pet/${pet.id}/care`)} style={styles.actionTile}><HeartPulse size={19} color={colors.blue} /><Text style={styles.actionLabel}>Cuidados</Text></Pressable>
                  <Pressable accessibilityRole="button" onPress={() => router.push(`/pet/${pet.id}/tracking`)} style={styles.actionTile}><MapPin size={19} color={colors.blue} /><Text style={styles.actionLabel}>Rastreo GPS</Text></Pressable>
                </View>
                <View style={styles.notesSection}>
                  <Text style={styles.sectionTitle}>Notas</Text>
                  <Text style={pet.notes?.trim() ? styles.notesText : styles.notesEmpty}>
                    {pet.notes?.trim() || "No hay notas registradas para esta mascota."}
                  </Text>
                </View>
                <View style={styles.recordMeta}>
                  <CalendarDays size={13} color={colors.textMuted} />
                  <Text style={styles.recordMetaText}>
                    Perfil creado {new Date(pet.created_at).toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })}
                  </Text>
                </View>
              </SurfaceCard>

              {error ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmDelete(true)}
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
              >
                <Trash2 size={16} color={colors.orange} />
                <Text style={styles.deleteText}>Eliminar perfil</Text>
              </Pressable>
              <ConfirmActionModal
                visible={confirmDelete}
                title={`¿Eliminar el perfil de ${pet.name}?`}
                message="Dejará de aparecer en la lista. Su registro se conservará como eliminado."
                busy={deleting}
                onCancel={() => setConfirmDelete(false)}
                onConfirm={() => void deletePet()}
              />
            </>
          ) : (
            <SurfaceCard style={styles.missingCard}>
              <Text style={styles.missingTitle}>No encontramos este perfil</Text>
              <Text style={styles.missingText}>{error ?? "Puede que la mascota ya haya sido eliminada."}</Text>
              <AppButton label="Volver a mascotas" onPress={() => router.replace("/(tabs)/pets")} />
              <AppButton label="Reintentar" variant="secondary" onPress={() => void loadPet()} />
            </SurfaceCard>
          )}
        </View>
      </ScrollView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 42,
  },
  wideScrollContent: {
    paddingHorizontal: 32,
    paddingTop: 16,
    paddingLeft: 278,
  },
  page: { width: "100%", alignSelf: "center", gap: spacing.md },
  widePage: {
    maxWidth: 920,
  },
  topBar: {
    height: 45,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  topSpacer: {
    width: 40,
  },
  heroCard: {
    padding: spacing.md,
    gap: spacing.md,
  },
  carnet: { padding: spacing.md, gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  carnetHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  carnetMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  carnetBrand: { flex: 1, gap: 2 },
  carnetBrandName: { color: colors.blueDark, fontSize: 14, fontWeight: "800" },
  carnetEyebrow: { color: colors.textMuted, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  editButton: { width: 38, height: 38, borderRadius: radius.pill, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  petSummary: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  identitySection: { gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  detailsGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: spacing.md },
  detailCell: { width: "50%", paddingRight: spacing.sm },
  carnetActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  actionTile: { flexBasis: "48%", flexGrow: 1, minHeight: 58, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.blueSoft },
  actionLabel: { color: colors.blueDark, fontSize: 12, fontWeight: "800" },
  heroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  photoFrame: {
    width: 128,
    height: 128,
    borderRadius: 22,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
  },
  heroPhoto: {
    width: "100%",
    height: "100%",
  },
  heroText: {
    flex: 1,
    minWidth: 0,
  },
  petName: {
    color: colors.blueDark,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.6,
    marginTop: 4,
  },
  petSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  ageText: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 7,
  },
  localStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 10,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.green,
  },
  localStatusText: {
    color: colors.green,
    fontSize: 10,
    fontWeight: "700",
  },
  heroActions: {
    alignItems: "flex-start",
  },
  detailsCard: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.blueDark,
    fontSize: 15,
    fontWeight: "700",
  },
  detailsList: {
    gap: spacing.md,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  detailIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
  },
  detailCopy: {
    flex: 1,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  detailValue: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  noDetails: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
  },
  notesSection: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  notesText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 21,
  },
  notesEmpty: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 19,
  },
  recordMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recordMetaText: {
    color: colors.textMuted,
    fontSize: 10,
  },
  deleteButton: {
    alignSelf: "flex-start",
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
  },
  deleteText: {
    color: colors.orange,
    fontSize: 12,
    fontWeight: "800",
  },
  deleteHint: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 16,
    marginTop: -spacing.md,
    paddingHorizontal: 12,
  },
  errorBanner: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    color: colors.orange,
    fontSize: 12,
    lineHeight: 18,
  },
  loading: {
    paddingVertical: 56,
    alignItems: "center",
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  missingCard: {
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  missingTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  missingText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.7,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 430,
    gap: spacing.md,
  },
  confirmIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.orangeSoft,
  },
  confirmTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  confirmBody: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 19,
  },
  confirmActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  confirmDelete: {
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.orange,
  },
  confirmDeleteText: {
    color: colors.onAccent,
    fontSize: 14,
    fontWeight: "800",
  },
});
