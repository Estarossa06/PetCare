import { useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { ArrowLeft, ImagePlus, PawPrint, Trash2, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
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
import { petPhotoStorage, petService } from "../pets/petService";
import type { Pet, PetInput, PetSex } from "../pets/types";
import { colors, radius, spacing } from "../theme/tokens";

type FormValues = {
  name: string;
  species: string;
  customSpecies: string;
  breed: string;
  sex: PetSex | "";
  birthDate: string;
  ageMonths: string;
  weightKg: string;
  color: string;
  notes: string;
};

const initialForm: FormValues = {
  name: "",
  species: "dog",
  customSpecies: "",
  breed: "",
  sex: "",
  birthDate: "",
  ageMonths: "",
  weightKg: "",
  color: "",
  notes: "",
};

const speciesOptions = [
  { value: "dog", label: "Perro", emoji: "🐕" },
  { value: "cat", label: "Gato", emoji: "🐈" },
  { value: "bird", label: "Ave", emoji: "🐦" },
  { value: "other", label: "Otra", emoji: "🐾" },
];

const sexOptions: { value: PetSex; label: string }[] = [
  { value: "female", label: "Hembra" },
  { value: "male", label: "Macho" },
  { value: "unknown", label: "Prefiero no indicar" },
];

function formFromPet(pet: Pet): FormValues {
  const knownSpecies = speciesOptions.some(({ value }) => value === pet.species);
  return {
    name: pet.name,
    species: knownSpecies ? pet.species : "other",
    customSpecies: knownSpecies ? "" : pet.species,
    breed: pet.breed ?? "",
    sex: pet.sex ?? "",
    birthDate: pet.birth_date ?? "",
    ageMonths: pet.approximate_age_months === null ? "" : String(pet.approximate_age_months),
    weightKg: pet.weight_kg === null ? "" : String(pet.weight_kg),
    color: pet.color ?? "",
    notes: pet.notes ?? "",
  };
}

function toPetInput(values: FormValues, photoStorageKey: string | null): PetInput {
  const ageValue = values.ageMonths.trim();
  const weightValue = values.weightKg.trim();
  const species = values.species === "other" ? values.customSpecies.trim() : values.species;
  return {
    name: values.name,
    species,
    breed: values.breed,
    sex: values.sex || null,
    birthDate: values.birthDate.trim() || null,
    approximateAgeMonths: ageValue ? Number(ageValue) : null,
    weightKg: weightValue ? Number(weightValue) : null,
    color: values.color,
    notes: values.notes,
    photoStorageKey,
  };
}

export default function PetFormScreen({ petId }: { petId?: string }) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 820;
  const [values, setValues] = useState(initialForm);
  const [pet, setPet] = useState<Pet | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [selectedPhoto, setSelectedPhoto] = useState<{ uri: string; mimeType?: string } | null>(null);
  const [removeExistingPhoto, setRemoveExistingPhoto] = useState(false);
  const [loading, setLoading] = useState(Boolean(petId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!petId) return;
    let active = true;
    void petService.getById(petId).then(async (result) => {
      if (!active) return;
      if (!result) {
        setError("No encontramos esta mascota. Puede que se haya eliminado.");
      } else {
        setPet(result);
        setValues(formFromPet(result));
        if (result.photo_storage_key) {
          setPhotoUri(await petPhotoStorage.getPhotoUri(result.photo_storage_key));
        }
      }
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : "No se pudo cargar el perfil.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [petId]);

  const pageTitle = useMemo(() => petId ? "Editar perfil" : "Nueva mascota", [petId]);

  const update = <Key extends keyof FormValues>(key: Key, value: FormValues[Key]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
  };

  const selectPhoto = async () => {
    setError(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("No se pudo leer la fotografía seleccionada.");
      setSelectedPhoto({ uri: asset.uri, mimeType: asset.mimeType });
      setPhotoUri(asset.uri);
      setRemoveExistingPhoto(false);
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : "No se pudo abrir la galería.");
    }
  };

  const clearPhoto = () => {
    setSelectedPhoto(null);
    setPhotoUri(null);
    setRemoveExistingPhoto(true);
  };

  const submit = async () => {
    if (saving || loading) return;
    setSaving(true);
    setError(null);
    try {
      const photoStorageKey = removeExistingPhoto ? null : pet?.photo_storage_key ?? null;
      const input = toPetInput(values, photoStorageKey);
      const saved = petId
        ? await petService.update(petId, input, selectedPhoto ?? undefined)
        : await petService.create(input, selectedPhoto ?? undefined);
      router.replace({ pathname: "/pet/[id]", params: { id: saved.id } });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar el perfil.");
    } finally {
      setSaving(false);
    }
  };

  const customSpecies = values.species === "other";

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, wide && styles.wideScrollContent]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.page, wide && styles.widePage]}>
            <View style={styles.topBar}>
              <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.back()} style={styles.backButton}>
                <ArrowLeft size={19} color={colors.text} />
              </Pressable>
              <Text style={styles.topBarTitle}>Mascotas</Text>
              <View style={styles.topBarSpacer} />
            </View>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>PERFIL DE TU COMPAÑERO</Text>
              <Text style={styles.title}>{pageTitle}</Text>
              <Text style={styles.subtitle}>Cuéntanos un poco sobre quien hace tu día más especial.</Text>
            </View>

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.blue} />
                <Text style={styles.loadingText}>Cargando perfil…</Text>
              </View>
            ) : (
              <>
                <SurfaceCard style={styles.photoCard}>
                  <View style={styles.photoPreview}>
                    {photoUri ? (
                      <Image source={{ uri: photoUri }} style={styles.photoImage} />
                    ) : (
                      <View style={styles.photoPlaceholder}>
                        <PawPrint size={34} color={colors.blue} />
                      </View>
                    )}
                  </View>
                  <View style={styles.photoCopy}>
                    <Text style={styles.photoTitle}>Una foto para recordar</Text>
                    <Text style={styles.photoSubtitle}>Elige una imagen de tu dispositivo. Se guarda localmente.</Text>
                    <View style={styles.photoActions}>
                      <AppButton
                        label={photoUri ? "Cambiar foto" : "Elegir foto"}
                        icon={ImagePlus}
                        variant="secondary"
                        size="small"
                        onPress={() => void selectPhoto()}
                      />
                      {photoUri ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Quitar fotografía"
                          onPress={clearPhoto}
                          style={styles.removePhoto}
                        >
                          <X size={17} color={colors.textMuted} />
                        </Pressable>
                      ) : null}
                    </View>
                  </View>
                </SurfaceCard>

                <View style={[styles.formColumns, wide && styles.formColumnsWide]}>
                  <SurfaceCard style={[styles.formCard, wide && styles.formColumn]}>
                    <View style={styles.formSectionHeading}>
                      <View style={styles.stepBadge}><Text style={styles.stepNumber}>01</Text></View>
                      <View>
                        <Text style={styles.formSectionTitle}>Lo esencial</Text>
                        <Text style={styles.formSectionHint}>La información principal de su perfil.</Text>
                      </View>
                    </View>

                    <AppTextField
                      label="Nombre *"
                      value={values.name}
                      onChangeText={(text) => update("name", text)}
                      placeholder="Ej. Nala"
                      autoCapitalize="words"
                      maxLength={100}
                      returnKeyType="next"
                    />

                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Especie *</Text>
                      <View style={styles.optionRow}>
                        {speciesOptions.map((option) => (
                          <Pressable
                            key={option.value}
                            accessibilityRole="button"
                            accessibilityState={{ selected: values.species === option.value }}
                            onPress={() => update("species", option.value)}
                            style={[styles.optionChip, values.species === option.value && styles.optionChipSelected]}
                          >
                            <Text style={styles.optionEmoji}>{option.emoji}</Text>
                            <Text style={[styles.optionText, values.species === option.value && styles.optionTextSelected]}>
                              {option.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>

                    {customSpecies ? (
                      <AppTextField
                        label="¿Qué especie?"
                        value={values.customSpecies}
                        onChangeText={(text) => update("customSpecies", text)}
                        placeholder="Ej. Conejo"
                        autoCapitalize="words"
                        maxLength={80}
                      />
                    ) : null}

                    <AppTextField
                      label="Raza"
                      value={values.breed}
                      onChangeText={(text) => update("breed", text)}
                      placeholder="Ej. Mestizo"
                      autoCapitalize="words"
                      maxLength={100}
                    />

                    <View style={styles.fieldGroup}>
                      <Text style={styles.fieldLabel}>Sexo</Text>
                      <View style={styles.optionRow}>
                        {sexOptions.map((option) => (
                          <Pressable
                            key={option.value}
                            accessibilityRole="button"
                            accessibilityState={{ selected: values.sex === option.value }}
                            onPress={() => update("sex", values.sex === option.value ? "" : option.value)}
                            style={[styles.optionChip, values.sex === option.value && styles.optionChipSelected]}
                          >
                            <Text style={[styles.optionText, values.sex === option.value && styles.optionTextSelected]}>
                              {option.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </View>
                  </SurfaceCard>

                  <SurfaceCard style={[styles.formCard, wide && styles.formColumn]}>
                    <View style={styles.formSectionHeading}>
                      <View style={[styles.stepBadge, styles.stepBadgeYellow]}><Text style={styles.stepNumber}>02</Text></View>
                      <View>
                        <Text style={styles.formSectionTitle}>Un poco más sobre él</Text>
                        <Text style={styles.formSectionHint}>Los detalles que quieras recordar.</Text>
                      </View>
                    </View>

                    <View style={styles.fieldGroup}>
                      <AppTextField
                        label="Fecha de nacimiento"
                        value={values.birthDate}
                        onChangeText={(text) => {
                          update("birthDate", text);
                          if (text) update("ageMonths", "");
                        }}
                        placeholder="AAAA-MM-DD"
                        keyboardType="numbers-and-punctuation"
                        maxLength={10}
                      />
                      <Text style={styles.fieldHint}>Si no la conoces, indica su edad aproximada abajo.</Text>
                    </View>

                    <AppTextField
                      label="Edad aproximada (meses)"
                      value={values.ageMonths}
                      onChangeText={(text) => {
                        update("ageMonths", text.replace(/[^0-9]/g, ""));
                        if (text) update("birthDate", "");
                      }}
                      placeholder="Ej. 24"
                      keyboardType="number-pad"
                      maxLength={4}
                    />

                    <View style={styles.inlineFields}>
                      <View style={styles.inlineField}>
                        <AppTextField
                          label="Peso (kg)"
                          value={values.weightKg}
                          onChangeText={(text) => update("weightKg", text.replace(",", "."))}
                          placeholder="Ej. 8.5"
                          keyboardType="decimal-pad"
                          maxLength={7}
                        />
                      </View>
                      <View style={styles.inlineField}>
                        <AppTextField
                          label="Color"
                          value={values.color}
                          onChangeText={(text) => update("color", text)}
                          placeholder="Ej. Canela"
                          maxLength={60}
                        />
                      </View>
                    </View>

                    <AppTextField
                      label="Descripción y observaciones"
                      value={values.notes}
                      onChangeText={(text) => update("notes", text)}
                      placeholder="Cuéntanos algo importante sobre tu compañero…"
                      multiline
                      maxLength={2000}
                      style={styles.notesInput}
                    />
                  </SurfaceCard>
                </View>

                {error ? (
                  <View accessibilityRole="alert" style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.bottomActions}>
                  <Text style={styles.localNotice}>Se guarda en este dispositivo y queda pendiente de sincronización.</Text>
                  <View style={styles.actionButtons}>
                    <AppButton label="Cancelar" variant="quiet" onPress={() => router.back()} disabled={saving} />
                    <AppButton label={saving ? "Guardando…" : petId ? "Guardar cambios" : "Guardar perfil"} onPress={() => void submit()} loading={saving} />
                  </View>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 36,
  },
  wideScrollContent: {
    paddingHorizontal: 32,
    paddingTop: 16,
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
    height: 46,
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
  topBarTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  topBarSpacer: {
    width: 40,
  },
  heading: {
    gap: 5,
  },
  eyebrow: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
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
  },
  photoCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  photoPreview: {
    width: 84,
    height: 84,
    borderRadius: 22,
    overflow: "hidden",
    backgroundColor: colors.blueSoft,
  },
  photoImage: {
    width: "100%",
    height: "100%",
  },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  photoCopy: {
    flex: 1,
    gap: 5,
  },
  photoTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  photoSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
    maxWidth: 430,
  },
  photoActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 5,
  },
  removePhoto: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  formColumns: {
    gap: spacing.md,
  },
  formColumnsWide: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  formColumn: {
    flex: 1,
  },
  formCard: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  formSectionHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    marginBottom: 2,
  },
  stepBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
  },
  stepBadgeYellow: {
    backgroundColor: colors.yellowSoft,
  },
  stepNumber: {
    color: colors.blue,
    fontSize: 11,
    fontWeight: "800",
  },
  formSectionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  formSectionHint: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 3,
  },
  fieldGroup: {
    gap: spacing.xs,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  fieldHint: {
    color: colors.textMuted,
    fontSize: 10,
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  optionChipSelected: {
    borderColor: colors.blue,
    backgroundColor: colors.blueSoft,
  },
  optionEmoji: {
    fontSize: 14,
  },
  optionText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
  },
  optionTextSelected: {
    color: colors.blue,
  },
  inlineFields: {
    flexDirection: "row",
    gap: spacing.md,
  },
  inlineField: {
    flex: 1,
  },
  notesInput: {
    minHeight: 94,
    paddingTop: 13,
    textAlignVertical: "top",
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
    fontSize: 13,
  },
  bottomActions: {
    gap: spacing.sm,
  },
  localNotice: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
  },
  actionButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.sm,
  },
});
