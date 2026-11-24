import { useEffect, useMemo, useState } from "react";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { ApiClientError, apiClient } from "../../auth/apiClient";
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
import { AppButton } from "../../../components/ui/AppButton";
import { CalendarDateField } from "../../../components/ui/CalendarDateField";
import { AppTextField } from "../../../components/ui/TextField";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { petPhotoStorage, petService } from "../petService";
import type { Pet, PetInput, PetSex } from "../types";
import { colors, radius, spacing } from "../../../theme/tokens";

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

type Estimate = { value: string | null; confidence: number | null };
type IdentificationAnalysis = {
  animalDetected: boolean | null;
  species: Estimate;
  breed: Estimate;
  approximateAge: Estimate;
  weightKg: Estimate;
  size: Estimate;
  coatColor: Estimate;
  traits: Estimate;
  uncertainty: string;
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
  const birthDate = pet.birth_date ?? "";
  return {
    name: pet.name,
    species: knownSpecies ? pet.species : "other",
    customSpecies: knownSpecies ? "" : pet.species,
    breed: pet.breed ?? "",
    sex: pet.sex ?? "",
    birthDate,
    ageMonths: pet.approximate_age_months === null
      ? birthDate ? ageInMonths(birthDate) ?? "" : ""
      : String(pet.approximate_age_months),
    weightKg: pet.weight_kg === null ? "" : String(pet.weight_kg),
    color: pet.color ?? "",
    notes: pet.notes ?? "",
  };
}

function ageInMonths(birthDate: string, today = new Date()): string | null {
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  let months = (today.getFullYear() - birth.getFullYear()) * 12 + today.getMonth() - birth.getMonth();
  if (today.getDate() < birth.getDate()) months -= 1;
  return months < 0 ? null : String(months);
}

function formatAge(monthValue: string): string {
  const months = Number(monthValue);
  if (!Number.isInteger(months) || months < 0) return "";
  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  if (years && remainingMonths) return `${years} ${years === 1 ? "año" : "años"} y ${remainingMonths} ${remainingMonths === 1 ? "mes" : "meses"}`;
  if (years) return `${years} ${years === 1 ? "año" : "años"}`;
  return `${months} ${months === 1 ? "mes" : "meses"}`;
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
    approximateAgeMonths: values.birthDate.trim() ? null : ageValue ? Number(ageValue) : null,
    weightKg: weightValue ? Number(weightValue) : null,
    color: values.color,
    notes: values.notes,
    photoStorageKey,
  };
}

function estimatedNumber(value: string | null): string | null {
  if (!value) return null;
  const matches = [...value.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(",", ".")));
  if (!matches.length) return null;
  const number = matches.length > 1 ? (matches[0] + matches[1]) / 2 : matches[0];
  return Number.isFinite(number) && number > 0 && number <= 200 ? String(Math.round(number * 10) / 10) : null;
}

function analysisFailureMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401) return "Tu sesión expiró. Inicia sesión nuevamente para analizar la foto.";
    if (error.status === 413) return "La imagen es demasiado grande. Elige una foto más pequeña.";
    if (error.status >= 500) return "No pudimos analizar la foto en este momento. Inténtalo más tarde.";
    return "No se pudo analizar la foto. Elige otra imagen e inténtalo nuevamente.";
  }
  return "No se pudo completar el análisis de la foto. Inténtalo nuevamente.";
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
  const [analyzing, setAnalyzing] = useState(false);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [analysis, setAnalysis] = useState<IdentificationAnalysis | null>(null);
  const [autoFilledFields, setAutoFilledFields] = useState<Record<string, boolean>>({});
  const [imageMimeType, setImageMimeType] = useState<string | undefined>();

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
    setAutoFilledFields((current) => ({ ...current, [key]: false }));
    setError(null);
  };

  const choosePhoto = async (camera: boolean) => {
    setError(null);
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error("Permite el acceso a la cámara en los ajustes para tomar una foto.");
      }
      const result = await (camera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync)({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) throw new Error("No se pudo leer la fotografía seleccionada.");
      const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
      if (asset.mimeType && !allowed.has(asset.mimeType)) throw new Error("Elige una imagen JPEG, PNG o WebP.");
      if (asset.fileSize && asset.fileSize > 10 * 1024 * 1024) throw new Error("La foto debe pesar menos de 10 MB.");
      setSelectedPhoto({ uri: asset.uri, mimeType: asset.mimeType });
      setImageMimeType(asset.mimeType);
      setPhotoUri(asset.uri);
      setRemoveExistingPhoto(false);
      setAnalysis(null);
      setAutoFilledFields({});
    } catch (pickerError) {
      setError(pickerError instanceof Error ? pickerError.message : camera ? "No se pudo abrir la cámara." : "No se pudo abrir la galería.");
    }
  };

  const analyzePhoto = async () => {
    if (!photoUri || !photoConsent || analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const file = new File(photoUri);
      if (!file.exists || file.size > 1_200_000) throw new Error("Para analizarla, elige una foto de menos de 1,2 MB. Puedes completar el perfil manualmente.");
      const mimeType = imageMimeType ?? (photoUri.toLowerCase().includes(".png") ? "image/png" : photoUri.toLowerCase().includes(".webp") ? "image/webp" : "image/jpeg");
      if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("Formato no compatible. Usa JPEG, PNG o WebP.");
      const result = await apiClient.request<IdentificationAnalysis>("/pet-identification/analyze", { method: "POST", authenticated: true, body: { image: { mimeType, data: await file.base64() } } });
      setAnalysis(result);
      const filled: Record<string, boolean> = {};
      const apply = (field: keyof FormValues, value: string | null | undefined) => {
        if (!value?.trim()) return;
        acceptSuggestion(field, value.trim());
        filled[field] = true;
      };
      if (result.animalDetected !== false) {
        apply("species", result.species.value);
        const detectedSpecies = result.species.value?.toLowerCase() ?? "";
        if (/(dog|perro|cat|gato)/i.test(detectedSpecies)) {
          apply("breed", result.breed.value ?? "Raza no determinada");
        } else {
          apply("breed", result.breed.value);
        }
        apply("ageMonths", result.approximateAge.value);
        const estimatedWeight = estimatedNumber(result.weightKg.value);
        if (estimatedWeight) {
          update("weightKg", estimatedWeight);
          filled.weightKg = true;
        }
        apply("color", result.coatColor.value);
      }
      setAutoFilledFields(filled);
    } catch (analysisError) {
      setError(analysisFailureMessage(analysisError));
    } finally { setAnalyzing(false); }
  };

  const acceptSuggestion = (field: keyof FormValues, value: string | null) => {
    if (!value) return;
    if (field === "species") {
      const species = value.toLowerCase();
      update("species", species.includes("perro") || species.includes("dog") ? "dog" : species.includes("gato") || species.includes("cat") ? "cat" : "other");
      if (!species.includes("perro") && !species.includes("dog") && !species.includes("gato") && !species.includes("cat")) update("customSpecies", value);
    } else if (field === "ageMonths") {
      const numbers = [...value.matchAll(/\d+(?:[.,]\d+)?/g)].map((match) => Number(match[0].replace(",", ".")));
      const midpoint = numbers.length > 1 ? (numbers[0] + numbers[1]) / 2 : numbers[0];
      const months = /año|ano|year/i.test(value) ? Math.round(midpoint * 12) : Math.round(midpoint);
      if (Number.isFinite(months) && months >= 0 && months <= 999) { update("ageMonths", String(months)); update("birthDate", ""); }
    } else if (field === "notes") {
      update("notes", [values.notes.trim(), value].filter(Boolean).join(". "));
    } else update(field, value);
  };

  const clearPhoto = () => {
    setSelectedPhoto(null);
    setPhotoUri(null);
    setAnalysis(null);
    setAutoFilledFields({});
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
            </View>
            <View style={styles.heading}>
              <Text style={styles.title}>{pageTitle}</Text>
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
                    <Text style={styles.photoTitle}>Foto de perfil</Text>
                    <Text style={styles.photoSubtitle}>Guardada en este dispositivo.</Text>
                    <View style={styles.photoActions}>
                      <AppButton
                        label={photoUri ? "Cambiar foto" : "Elegir foto"}
                        icon={ImagePlus}
                        variant="secondary"
                        size="small"
                        onPress={() => void choosePhoto(false)}
                      />
                      <AppButton label="Cámara" variant="secondary" size="small" onPress={() => void choosePhoto(true)} />
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

                {photoUri ? <SurfaceCard style={styles.analysisCard}>
                  <Text style={styles.photoTitle}>Identificación visual opcional</Text>
                  <Text style={styles.photoSubtitle}>Usaremos la foto para sugerir datos del perfil. Las estimaciones pueden ser imprecisas; revísalas antes de guardar.</Text>
                  <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: photoConsent }} onPress={() => setPhotoConsent((value) => !value)} style={styles.consentRow}>
                    <View style={[styles.checkbox, photoConsent && styles.checkboxChecked]} />
                    <Text style={styles.photoSubtitle}>Autorizo enviar esta foto para obtener sugerencias visuales.</Text>
                  </Pressable>
                  <AppButton label={analyzing ? "Analizando…" : "Analizar fotografía"} onPress={() => void analyzePhoto()} loading={analyzing} disabled={!photoConsent || analyzing} />
                  {analysis ? <View style={styles.suggestionList}>
                    {analysis.animalDetected === false ? <Text style={styles.photoSubtitle}>No se identificó un animal en la fotografía. Prueba otra imagen o continúa manualmente.</Text> : null}
                    {analysis.animalDetected !== false ? <Text style={styles.autoFillNotice}>Completamos automáticamente los campos resaltados. La especie y la raza son estimaciones visuales; verifica la raza antes de guardar.</Text> : null}
                    {analysis.animalDetected !== false ? ([ ["Especie", analysis.species], ["Raza", analysis.breed.value ? analysis.breed : { ...analysis.breed, value: values.breed || null }], ["Edad aproximada", analysis.approximateAge], ["Peso aproximado", analysis.weightKg], ["Tamaño", analysis.size], ["Color", analysis.coatColor], ["Rasgos", analysis.traits] ] as const).map(([label, estimate]) => estimate.value ? <View key={label} style={styles.suggestionRow}>
                      <Text style={[styles.photoSubtitle, styles.suggestionCopy]}>{label}: {estimate.value}{estimate.confidence === null ? " · confianza no disponible" : ` · ${Math.round(estimate.confidence * 100)}% de confianza`}</Text>
                    </View> : null) : null}
                    <Text style={styles.photoSubtitle}>{analysis.uncertainty || "La edad y raza son estimaciones visuales, no datos comprobados."}</Text>
                  </View> : null}
                </SurfaceCard> : null}

                <View style={[styles.formColumns, wide && styles.formColumnsWide]}>
                  <SurfaceCard style={[styles.formCard, wide && styles.formColumn]}>
                    <Text style={styles.formSectionTitle}>Información</Text>

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
                      <View style={[styles.optionRow, autoFilledFields.species && styles.autoFilledGroup]}>
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

                    <View style={autoFilledFields.breed ? styles.autoFilledField : undefined}>
                    <AppTextField
                      label="Raza"
                      value={values.breed}
                      onChangeText={(text) => update("breed", text)}
                      placeholder="Ej. Mestizo"
                      autoCapitalize="words"
                      maxLength={100}
                    />
                    </View>

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
                    <Text style={styles.formSectionTitle}>Detalles</Text>

                    <View style={styles.fieldGroup}>
                      <View style={autoFilledFields.birthDate ? styles.autoFilledField : undefined}>
                      <CalendarDateField
                        label="Fecha de nacimiento"
                        value={values.birthDate}
                        onChange={(text) => {
                          update("birthDate", text);
                          const calculatedAge = text ? ageInMonths(text) : null;
                          update("ageMonths", calculatedAge ?? "");
                          setAutoFilledFields((current) => ({ ...current, ageMonths: Boolean(calculatedAge) }));
                        }}
                        mode="date"
                        allowClear
                      />
                      </View>
                    </View>

                    <View style={autoFilledFields.ageMonths ? styles.autoFilledField : undefined}>
                    <AppTextField
                      label={values.birthDate ? "Edad calculada (meses)" : "Edad aproximada (meses)"}
                      value={values.ageMonths}
                      onChangeText={(text) => {
                        update("ageMonths", text.replace(/[^0-9]/g, ""));
                        if (text) update("birthDate", "");
                      }}
                      placeholder="Ej. 24"
                      keyboardType="number-pad"
                      maxLength={4}
                      hint={values.birthDate ? values.ageMonths ? `Calculada automáticamente: ${formatAge(values.ageMonths)}.` : "La edad se calculará con la fecha de nacimiento." : undefined}
                    />
                    </View>

                    <View style={styles.inlineFields}>
                      <View style={[styles.inlineField, autoFilledFields.weightKg && styles.autoFilledField]}>
                        <AppTextField
                          label={autoFilledFields.weightKg ? "Peso aproximado (kg)" : "Peso (kg)"}
                          value={values.weightKg}
                          onChangeText={(text) => update("weightKg", text.replace(",", "."))}
                          placeholder="Ej. 8.5"
                          keyboardType="decimal-pad"
                          maxLength={7}
                        />
                      </View>
                      <View style={[styles.inlineField, autoFilledFields.color && styles.autoFilledField]}>
                        <AppTextField
                          label="Color"
                          value={values.color}
                          onChangeText={(text) => update("color", text)}
                          placeholder="Ej. Canela"
                          maxLength={60}
                        />
                      </View>
                    </View>

                    <View style={autoFilledFields.notes ? styles.autoFilledField : undefined}>
                    <AppTextField
                      label="Descripción y observaciones"
                      value={values.notes}
                      onChangeText={(text) => update("notes", text)}
                      placeholder="Cuéntanos algo importante sobre tu compañero…"
                      multiline
                      maxLength={2000}
                      style={styles.notesInput}
                    />
                    </View>
                  </SurfaceCard>
                </View>

                {error ? (
                  <View accessibilityRole="alert" style={styles.errorBanner}>
                    <Text style={styles.errorText}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.bottomActions}>
                  <Text style={styles.localNotice}>Se guardará en este dispositivo</Text>
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
  analysisCard: { gap: spacing.sm, padding: spacing.md },
  consentRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1, borderColor: colors.border },
  checkboxChecked: { backgroundColor: colors.blue, borderColor: colors.blue },
  suggestionList: { gap: spacing.xs },
  suggestionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  acceptText: { color: colors.blue, fontWeight: "800", fontSize: 12 },
  dismissText: { color: colors.textMuted, fontWeight: "700", fontSize: 12 },
  suggestionCopy: { flex: 1 },
  autoFillNotice: { color: colors.blueDark, backgroundColor: colors.yellowSoft, borderRadius: radius.sm, padding: spacing.sm, fontSize: 12, lineHeight: 18 },
  autoFilledField: { borderWidth: 2, borderColor: colors.yellow, borderRadius: radius.sm, backgroundColor: colors.yellowSoft, padding: 5 },
  autoFilledGroup: { borderWidth: 2, borderColor: colors.yellow, borderRadius: radius.sm, backgroundColor: colors.yellowSoft, padding: 5 },
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
