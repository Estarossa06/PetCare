import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { AlertCircle, PawPrint, Plus, Search, X } from "lucide-react-native";
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
import { AppButton } from "../../../components/ui/AppButton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PetAvatar } from "../../../components/ui/PetAvatar";
import { AppTextField } from "../../../components/ui/TextField";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { petPhotoStorage, petService } from "../petService";
import type { Pet } from "../types";
import { colors, radius, spacing } from "../../../theme/tokens";

type PetWithPhoto = Pet & { photoUri: string | null };

const commonSpecies = [
  { value: "", label: "Todas" },
  { value: "dog", label: "Perros" },
  { value: "cat", label: "Gatos" },
  { value: "bird", label: "Aves" },
];

function speciesLabel(species: string): string {
  const known: Record<string, string> = { dog: "Perro", cat: "Gato", bird: "Ave", other: "Otra especie" };
  return known[species] ?? species;
}

function ageLabel(pet: Pet): string | null {
  if (pet.birth_date) {
    const date = new Date(`${pet.birth_date}T00:00:00`);
    const months = Math.max(0,
      (new Date().getFullYear() - date.getFullYear()) * 12 +
      new Date().getMonth() - date.getMonth(),
    );
    if (months < 24) return `${months} ${months === 1 ? "mes" : "meses"}`;
    const years = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return remainingMonths ? `${years} a ${remainingMonths} m` : `${years} ${years === 1 ? "año" : "años"}`;
  }
  if (pet.approximate_age_months !== null) {
    if (pet.approximate_age_months < 24) return `~${pet.approximate_age_months} meses`;
    const years = Math.floor(pet.approximate_age_months / 12);
    const months = pet.approximate_age_months % 12;
    return `~${years}${months ? ` a ${months} m` : ` ${years === 1 ? "año" : "años"}`}`;
  }
  return null;
}

function PetListCard({
  pet,
  last,
  onPress,
}: {
  pet: PetWithPhoto;
  last: boolean;
  onPress: () => void;
}) {
  const age = ageLabel(pet);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver perfil de ${pet.name}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.petCard,
        last && styles.petCardLast,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.petPhoto}>
        <PetAvatar
          name={pet.name}
          imageUri={pet.photoUri}
          emoji={pet.species === "cat" ? "🐈" : pet.species === "bird" ? "🐦" : "🐕"}
          size="large"
          tone={pet.species === "cat" ? "lavender" : "yellow"}
        />
      </View>
      <View style={styles.petInfo}>
        <Text style={styles.petName}>{pet.name}</Text>
        <Text style={styles.petSpecies}>
          {[speciesLabel(pet.species), pet.breed].filter(Boolean).join(" · ")}
        </Text>
        <View style={styles.petMetaRow}>
          {age ? <Text style={styles.petMeta}>{age}</Text> : null}
          {pet.weight_kg !== null ? <Text style={styles.petMeta}>{pet.weight_kg} kg</Text> : null}
          {pet.sex ? (
            <Text style={styles.petMeta}>{pet.sex === "female" ? "Hembra" : pet.sex === "male" ? "Macho" : "Sin indicar"}</Text>
          ) : null}
        </View>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export default function PetListScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const compact = width < 540;
  const [pets, setPets] = useState<PetWithPhoto[]>([]);
  const [search, setSearch] = useState("");
  const [species, setSpecies] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadPets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await petService.list({ search, species });
      const withPhotos = await Promise.all(result.map(async (pet) => ({
        ...pet,
        photoUri: pet.photo_storage_key
          ? await petPhotoStorage.getPhotoUri(pet.photo_storage_key)
          : null,
      })));
      setPets(withPhotos);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las mascotas.");
    } finally {
      setLoading(false);
    }
  }, [search, species]);

  useFocusEffect(useCallback(() => {
    void loadPets();
  }, [loadPets]));

  const filters = useMemo(() => {
    const customSpecies = [...new Set(pets.map(({ species: item }) => item))]
      .filter((item) => !commonSpecies.some(({ value }) => value === item));
    return [...commonSpecies, ...customSpecies.map((value) => ({ value, label: `${speciesLabel(value)}s` }))];
  }, [pets]);

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, wide && styles.wideScrollContent]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.headerTop}>
            <Text style={styles.title}>Mascotas</Text>
            {!compact ? (
              <AppButton label="Agregar mascota" icon={Plus} onPress={() => router.push("/pet/new")} />
            ) : null}
          </View>

          <View style={styles.searchWrap}>
            <View style={styles.searchIcon}><Search size={18} color={colors.textMuted} /></View>
            <AppTextField
              label="Buscar"
              value={search}
              onChangeText={setSearch}
              placeholder="Nombre, raza o especie"
              returnKeyType="search"
              style={styles.searchInput}
            />
            {search ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Limpiar búsqueda" onPress={() => setSearch("")} style={styles.clearSearch}>
                <X size={16} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {filters.map((filter) => (
              <Pressable
                key={filter.value || "all"}
                accessibilityRole="button"
                accessibilityState={{ selected: species === filter.value }}
                onPress={() => setSpecies(filter.value)}
                style={[styles.filterChip, species === filter.value && styles.filterChipSelected]}
              >
                <Text style={[styles.filterText, species === filter.value && styles.filterTextSelected]}>{filter.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <View style={styles.listHeading}>
            <Text style={styles.sectionTitle}>Mis mascotas</Text>
            {!loading ? <Text style={styles.countText}>{pets.length}</Text> : null}
          </View>

          {error ? (
            <SurfaceCard style={styles.errorCard}>
              <AlertCircle size={20} color={colors.orange} />
              <View style={styles.errorCopy}>
                <Text style={styles.errorTitle}>No se pudieron cargar tus datos</Text>
                <Text style={styles.errorText}>{error}</Text>
                <Pressable accessibilityRole="button" onPress={() => void loadPets()}>
                  <Text style={styles.retryText}>Intentar de nuevo</Text>
                </Pressable>
              </View>
            </SurfaceCard>
          ) : loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.blue} />
              <Text style={styles.loadingText}>Cargando desde este dispositivo…</Text>
            </View>
          ) : pets.length ? (
            <View style={styles.listGrid}>
              {pets.map((pet, index) => (
                <PetListCard
                  key={pet.id}
                  pet={pet}
                  last={index === pets.length - 1}
                  onPress={() => router.push({ pathname: "/pet/[id]", params: { id: pet.id } })}
                />
              ))}
            </View>
          ) : (
            <SurfaceCard style={styles.emptyCard}>
              <EmptyState
                icon={search || species ? Search : PawPrint}
                title={search || species ? "No encontramos coincidencias" : "Aún no hay mascotas"}
                description={
                  search || species
                    ? "Prueba con otro nombre o cambia el filtro de especie."
                    : "Agrega un perfil para tener su información en un solo lugar."
                }
              />
            </SurfaceCard>
          )}

          {compact ? (
            <View style={styles.compactAction}>
              <AppButton label="Agregar mascota" icon={Plus} onPress={() => router.push("/pet/new")} />
            </View>
          ) : null}
          <Text style={styles.localNotice}>Los perfiles se guardan en este dispositivo.</Text>
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
    paddingTop: 16,
    paddingBottom: 110,
  },
  wideScrollContent: {
    paddingHorizontal: 30,
    paddingTop: 30,
    paddingLeft: 278,
    paddingBottom: 40,
  },
  page: {
    width: "100%",
    alignSelf: "center",
    gap: spacing.md,
  },
  widePage: {
    maxWidth: 1050,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  title: {
    color: colors.blueDark,
    fontSize: 28,
    fontWeight: "700",
    letterSpacing: -0.6,
  },
  searchWrap: {
    position: "relative",
    justifyContent: "center",
  },
  searchIcon: {
    position: "absolute",
    zIndex: 1,
    left: 14,
    top: 37,
  },
  searchInput: {
    paddingLeft: 43,
    paddingRight: 44,
  },
  clearSearch: {
    position: "absolute",
    right: 9,
    top: 28,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  filterRow: {
    gap: 8,
    paddingVertical: 1,
  },
  filterChip: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipSelected: {
    backgroundColor: colors.blueSoft,
    borderColor: colors.blueMuted,
  },
  filterText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  filterTextSelected: {
    color: colors.blue,
  },
  listHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.xs,
  },
  sectionTitle: {
    color: colors.blueDark,
    fontSize: 17,
    fontWeight: "700",
  },
  countText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  listGrid: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  petCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  petCardLast: {
    borderBottomWidth: 0,
  },
  petPhoto: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: radius.sm,
  },
  pressed: {
    opacity: 0.72,
  },
  petInfo: {
    flex: 1,
    minWidth: 0,
  },
  petName: {
    color: colors.blueDark,
    fontSize: 16,
    fontWeight: "700",
  },
  petSpecies: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 3,
  },
  petMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 6,
  },
  petMeta: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "500",
  },
  chevronText: {
    color: colors.textMuted,
    fontSize: 23,
    lineHeight: 25,
    marginTop: -2,
  },
  chevron: { color: colors.textMuted, fontSize: 24, fontWeight: "300" },
  emptyCard: {
    alignItems: "center",
    paddingBottom: spacing.lg,
  },
  loading: {
    paddingVertical: 50,
    alignItems: "center",
    gap: spacing.md,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  errorCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.orangeSoft,
    borderColor: colors.dangerBorder,
  },
  errorCopy: {
    flex: 1,
    gap: 5,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  errorText: {
    color: colors.orange,
    fontSize: 11,
    lineHeight: 16,
  },
  retryText: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },
  localNotice: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: "center",
  },
  compactAction: {
    width: "100%",
    alignItems: "center",
  },
});
