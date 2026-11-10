import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ArrowLeft, CalendarDays, Edit3, HeartPulse, Info, Scale, Trash2, type LucideIcon } from "lucide-react-native";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { PetAvatar } from "../components/ui/PetAvatar";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { petPhotoStorage, petService } from "../pets/petService";
import type { Pet } from "../pets/types";
import { colors, radius, spacing } from "../theme/tokens";

type PetProfile = Pet & { photoUri: string | null };

function speciesLabel(species: string): string {
  const known: Record<string, string> = { dog: "Perro", cat: "Gato", bird: "Ave", other: "Otra especie" };
  return known[species] ?? species;
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
              <Text style={styles.loadingText}>Cargando desde este dispositivo…</Text>
            </View>
          ) : pet ? (
            <>
              <SurfaceCard style={styles.heroCard}>
                <View style={styles.heroContent}>
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
                    <Text style={styles.eyebrow}>SU COMPAÑERO</Text>
                    <Text style={styles.petName}>{pet.name}</Text>
                    <Text style={styles.petSubtitle}>
                      {[speciesLabel(pet.species), pet.breed].filter(Boolean).join(" · ")}
                    </Text>
                    {age ? <Text style={styles.ageText}>{age}</Text> : null}
                    <View style={styles.localStatus}>
                      <View style={styles.statusDot} />
                      <Text style={styles.localStatusText}>Guardado en este dispositivo</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.heroActions}>
                  <AppButton
                    label="Editar perfil"
                    icon={Edit3}
                    onPress={() => router.push({ pathname: "/pet/[id]/edit", params: { id: pet.id } })}
                  />
                  <AppButton
                    label="Historial médico"
                    icon={CalendarDays}
                    variant="secondary"
                    onPress={() => router.push(`/pet/${pet.id}/medical`)}
                  />
                  <AppButton
                    label="Cuidados"
                    icon={HeartPulse}
                    variant="secondary"
                    onPress={() => router.push(`/pet/${pet.id}/care`)}
                  />
                </View>
              </SurfaceCard>

              <View style={[styles.detailsColumns, wide && styles.detailsColumnsWide]}>
                <SurfaceCard style={[styles.detailsCard, wide && styles.detailsColumn]}>
                  <Text style={styles.sectionTitle}>Datos de perfil</Text>
                  <View style={styles.detailsList}>
                    {pet.species ? <DetailRow icon={Info} label="Especie" value={speciesLabel(pet.species)} /> : null}
                    {pet.breed ? <DetailRow icon={Info} label="Raza" value={pet.breed} /> : null}
                    {pet.sex ? (
                      <DetailRow icon={Info} label="Sexo" value={pet.sex === "female" ? "Hembra" : pet.sex === "male" ? "Macho" : "Prefiero no indicar"} />
                    ) : null}
                    {pet.birth_date ? (
                      <DetailRow
                        icon={CalendarDays}
                        label="Fecha de nacimiento"
                        value={new Date(`${pet.birth_date}T00:00:00`).toLocaleDateString("es-ES", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                      />
                    ) : age ? <DetailRow icon={CalendarDays} label="Edad aproximada" value={age} /> : null}
                    {pet.weight_kg !== null ? <DetailRow icon={Scale} label="Peso" value={`${pet.weight_kg} kg`} /> : null}
                    {pet.color ? <DetailRow icon={Info} label="Color" value={pet.color} /> : null}
                  </View>
                  {!pet.breed && !pet.sex && !age && pet.weight_kg === null && !pet.color ? (
                    <Text style={styles.noDetails}>Aún puedes completar más datos de su perfil.</Text>
                  ) : null}
                </SurfaceCard>

                <SurfaceCard style={[styles.notesCard, wide && styles.detailsColumn]}>
                  <View style={styles.notesHeader}>
                    <View style={styles.notesIcon}><Info size={17} color={colors.blue} /></View>
                    <Text style={styles.sectionTitle}>Sobre {pet.name}</Text>
                  </View>
                  <Text style={pet.notes ? styles.notesText : styles.notesEmpty}>
                    {pet.notes || "Todavía no hay una descripción u observaciones. Puedes añadirlas al editar su perfil."}
                  </Text>
                  <View style={styles.recordMeta}>
                    <CalendarDays size={14} color={colors.textMuted} />
                    <Text style={styles.recordMetaText}>
                      Perfil creado el {new Date(pet.created_at).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" })}
                    </Text>
                  </View>
                </SurfaceCard>
              </View>

              {error ? <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>{error}</Text></View> : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmDelete(true)}
                style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
              >
                <Trash2 size={16} color={colors.orange} />
                <Text style={styles.deleteText}>Eliminar perfil</Text>
              </Pressable>
              <Text style={styles.deleteHint}>El perfil se ocultará de la lista, pero conservará su registro local de forma lógica.</Text>
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

      <Modal
        visible={confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDelete(false)}
      >
        <View style={styles.modalBackdrop}>
          <SurfaceCard style={styles.confirmCard}>
            <View style={styles.confirmIcon}><Trash2 size={21} color={colors.orange} /></View>
            <Text style={styles.confirmTitle}>¿Eliminar el perfil de {pet?.name}?</Text>
            <Text style={styles.confirmBody}>
              Dejará de aparecer en tus mascotas. Su registro se conservará como eliminado para mantener la integridad de los datos.
            </Text>
            <View style={styles.confirmActions}>
              <AppButton label="Cancelar" variant="secondary" onPress={() => setConfirmDelete(false)} disabled={deleting} />
              <Pressable
                accessibilityRole="button"
                disabled={deleting}
                onPress={() => void deletePet()}
                style={[styles.confirmDelete, deleting && styles.pressed]}
              >
                {deleting ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.confirmDeleteText}>Eliminar</Text>}
              </Pressable>
            </View>
          </SurfaceCard>
        </View>
      </Modal>
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
  page: {
    width: "100%",
    alignSelf: "center",
    gap: spacing.lg,
  },
  widePage: {
    maxWidth: 1050,
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
    padding: spacing.lg,
    gap: spacing.lg,
  },
  heroContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  photoFrame: {
    width: 110,
    height: 110,
    borderRadius: 28,
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
  eyebrow: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.9,
  },
  petName: {
    color: colors.text,
    fontSize: 27,
    fontWeight: "800",
    letterSpacing: -0.7,
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
  detailsColumns: {
    gap: spacing.md,
  },
  detailsColumnsWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  detailsColumn: {
    flex: 1,
  },
  detailsCard: {
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
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
  notesCard: {
    gap: spacing.md,
  },
  notesHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  notesIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: colors.blueSoft,
    alignItems: "center",
    justifyContent: "center",
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
    borderColor: "#FECACA",
    borderRadius: radius.sm,
    backgroundColor: "#FEF2F2",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  errorText: {
    color: "#B91C1C",
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
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.48)",
    padding: spacing.lg,
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
    backgroundColor: "#DC2626",
  },
  confirmDeleteText: {
    color: colors.surface,
    fontSize: 14,
    fontWeight: "800",
  },
});
