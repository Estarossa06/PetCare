import { useCallback, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import { AlertCircle, PawPrint, Plus, Search, SlidersHorizontal, X } from "lucide-react-native";
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
import { EmptyState } from "../components/ui/EmptyState";
import { PetAvatar } from "../components/ui/PetAvatar";
import { AppTextField } from "../components/ui/TextField";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { petPhotoStorage, petService } from "../pets/petService";
import type { Pet } from "../pets/types";
import { colors, radius, spacing } from "../theme/tokens";

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
  wide,
  onPress,
}: {
  pet: PetWithPhoto;
  wide: boolean;
  onPress: () => void;
}) {
  const age = ageLabel(pet);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ver perfil de ${pet.name}`}
      onPress={onPress}
      style={({ pressed }) => [styles.cardPressable, pressed && styles.pressed]}
    >
      <SurfaceCard style={[styles.petCard, wide && styles.petCardWide]}>
        <PetAvatar
          name={pet.name}
          imageUri={pet.photoUri}
          emoji={pet.species === "cat" ? "🐈" : pet.species === "bird" ? "🐦" : "🐕"}
          size="large"
          tone={pet.species === "cat" ? "lavender" : "yellow"}
        />
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
        <View style={styles.chevron}><Text style={styles.chevronText}>›</Text></View>
      </SurfaceCard>
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
            <View>
              <Text style={styles.eyebrow}>SU FAMILIA, SIEMPRE CERCA</Text>
              <Text style={styles.title}>Mascotas</Text>
            </View>
            {!compact ? (
              <AppButton label="Agregar mascota" icon={Plus} onPress={() => router.push("/pet/new")} />
            ) : null}
          </View>
          <Text style={styles.subtitle}>Cada perfil guarda lo importante de su historia.</Text>

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

          <View style={styles.filterHeading}>
            <SlidersHorizontal size={15} color={colors.textMuted} />
            <Text style={styles.filterTitle}>Filtrar por especie</Text>
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
            <Text style={styles.sectionTitle}>Tus compañeros</Text>
            {!loading ? <Text style={styles.countText}>{pets.length} {pets.length === 1 ? "perfil" : "perfiles"}</Text> : null}
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
            <View style={[styles.listGrid, wide && styles.listGridWide]}>
              {pets.map((pet) => (
                <PetListCard
                  key={pet.id}
                  pet={pet}
                  wide={wide}
                  onPress={() => router.push({ pathname: "/pet/[id]", params: { id: pet.id } })}
                />
              ))}
            </View>
          ) : (
            <SurfaceCard style={styles.emptyCard}>
              <EmptyState
                icon={search || species ? Search : PawPrint}
                title={search || species ? "No encontramos coincidencias" : "Aquí empieza su historia"}
                description={
                  search || species
                    ? "Prueba con otro nombre o cambia el filtro de especie."
                    : "Agrega el perfil de una mascota para mantener sus datos importantes en un solo lugar."
                }
              />
              {!search && !species ? (
                <AppButton label="Agregar primera mascota" icon={Plus} onPress={() => router.push("/pet/new")} />
              ) : null}
            </SurfaceCard>
          )}

          {compact ? (
            <View style={styles.floatingAction}>
              <AppButton label="Agregar mascota" icon={Plus} onPress={() => router.push("/pet/new")} />
            </View>
          ) : null}
          <Text style={styles.localNotice}>Tus perfiles se guardan en SQLite en este dispositivo. La sincronización aún no está habilitada.</Text>
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
  eyebrow: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: 5,
  },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.8,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: -spacing.sm,
  },
  searchWrap: {
    position: "relative",
    justifyContent: "center",
    marginTop: 3,
  },
  searchIcon: {
    position: "absolute",
    zIndex: 1,
    left: 14,
    top: 15,
  },
  searchInput: {
    paddingLeft: 43,
    paddingRight: 44,
  },
  clearSearch: {
    position: "absolute",
    right: 9,
    top: 6,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  filterHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 2,
  },
  filterTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
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
    borderColor: "#BFDBFE",
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
    marginTop: spacing.sm,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  countText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  listGrid: {
    gap: spacing.sm,
  },
  listGridWide: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  cardPressable: {
    width: "100%",
  },
  petCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    minHeight: 106,
  },
  petCardWide: {
    flex: 1,
    minWidth: 310,
    maxWidth: 505,
  },
  pressed: {
    opacity: 0.8,
  },
  petInfo: {
    flex: 1,
    minWidth: 0,
  },
  petName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  petSpecies: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  petMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
    marginTop: 8,
  },
  petMeta: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "600",
  },
  chevron: {
    width: 29,
    height: 29,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  chevronText: {
    color: colors.textMuted,
    fontSize: 23,
    lineHeight: 25,
    marginTop: -2,
  },
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
    backgroundColor: "#FFF7ED",
    borderColor: "#FED7AA",
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
    color: "#94A3B8",
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: spacing.sm,
  },
  floatingAction: {
    position: "absolute",
    right: 0,
    bottom: 12,
    left: 0,
    alignItems: "center",
  },
});
