import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { AppTextField } from "../components/ui/TextField";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { ApiClientError } from "../auth/apiClient";
import { useAuth } from "../auth/AuthProvider";
import { colors, spacing } from "../theme/tokens";

export default function AuthScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { width } = useWindowDimensions();
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(mode === "register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isRegister) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
      router.replace("/(tabs)/profile");
    } catch (requestError) {
      setError(formatAuthError(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.inner, width >= 760 && styles.innerWide]}>
            <ScreenHeader
              eyebrow="PetCare"
              title={isRegister ? "Crear cuenta" : "Iniciar sesión"}
              subtitle={
                isRegister
                  ? "Crea una identidad central para los servicios online."
                  : "Accede a tu cuenta PetCare."
              }
            />
            <SurfaceCard>
              <View style={styles.form}>
                {isRegister ? (
                  <AppTextField
                    label="Nombre"
                    value={name}
                    onChangeText={setName}
                    autoComplete="name"
                    maxLength={100}
                    returnKeyType="next"
                  />
                ) : null}
                <AppTextField
                  label="Correo electrónico"
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoComplete="email"
                  maxLength={254}
                  returnKeyType="next"
                />
                <AppTextField
                  label="Contraseña"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  maxLength={128}
                  hint={isRegister ? "Usa entre 12 y 128 caracteres." : undefined}
                  returnKeyType="done"
                  onSubmitEditing={() => void submit()}
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <AppButton
                  label={isRegister ? "Crear cuenta" : "Iniciar sesión"}
                  loading={busy}
                  onPress={() => void submit()}
                />
                <AppButton
                  label={
                    isRegister
                      ? "Ya tengo una cuenta"
                      : "Necesito crear una cuenta"
                  }
                  variant="quiet"
                  disabled={busy}
                  onPress={() => {
                    setIsRegister((current) => !current);
                    setError(null);
                  }}
                />
                <Text style={styles.note}>
                  La cuenta no vincula ni sube automáticamente la información
                  local guardada en este dispositivo.
                </Text>
                <AppButton
                  label="Volver al perfil"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => router.back()}
                />
              </View>
            </SurfaceCard>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function formatAuthError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "REGISTRATION_FAILED") {
      return "No se pudo crear una cuenta con los datos proporcionados.";
    }
    if (error.code === "INVALID_CREDENTIALS") {
      return "El correo o la contraseña no son correctos.";
    }
    if (error.code === "INVALID_REFRESH_TOKEN") {
      return "La sesión expiró. Inicia sesión nuevamente.";
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "No se pudo completar la solicitud.";
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, justifyContent: "center" },
  inner: { width: "100%", maxWidth: 560, alignSelf: "center" },
  innerWide: { maxWidth: 640 },
  form: { gap: spacing.md },
  error: { color: colors.orange, fontSize: 13, lineHeight: 19 },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
