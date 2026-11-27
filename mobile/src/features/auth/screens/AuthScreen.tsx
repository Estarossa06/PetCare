import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/ui/AppButton";
import { AppTextField } from "../../../components/ui/TextField";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { authErrorMessage } from "../authErrorMessage";
import { useAuth } from "../AuthProvider";
import { useTheme } from "../../../theme/ThemeProvider";

const palettes = {
  light: {
    background: "#F5F8FC",
    surface: "#FFFFFF",
    input: "#FFFFFF",
    text: "#172033",
    muted: "#64748B",
    placeholder: "#7B8BA1",
    border: "#D5E0ED",
    error: "#B42318",
  },
  dark: {
    background: "#0B1220",
    surface: "#111827",
    input: "#0F172A",
    text: "#F1F5F9",
    muted: "#AAB4C5",
    placeholder: "#94A3B8",
    border: "#334155",
    error: "#FDA29B",
  },
} as const;

export default function AuthScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const { width, height } = useWindowDimensions();
  const { login, register, error: restoreError, clearError } = useAuth();
  const { mode: themeMode } = useTheme();
  const palette = palettes[themeMode];
  const [isRegister, setIsRegister] = useState(mode === "register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    clearError();
    try {
      if (isRegister) {
        await register(email, password, name);
      } else {
        await login(email, password);
      }
      router.replace("/(tabs)/profile");
    } catch (requestError) {
      setError(authErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    { color: palette.text, backgroundColor: palette.input, borderColor: palette.border },
  ];

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.safeArea, { backgroundColor: palette.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: height < 700 ? 12 : 24, paddingHorizontal: width < 360 ? 18 : 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        >
          <View style={[styles.inner, width >= 760 && styles.innerWide]}>
            <View style={styles.brandRow}>
              <Image
                source={require("../../../../assets/brand/petcare-heart-paw.png")}
                style={imageStyles.brandMark}
                resizeMode="cover"
                accessibilityLabel="Huella de PetCare"
              />
              <View style={styles.brandCopy}>
                <Text style={[styles.brandName, { color: palette.text }]}>PETCARE</Text>
                <Text style={[styles.brandTagline, { color: palette.muted }]}>Cuidado diario, conectado</Text>
              </View>
            </View>

            <View style={styles.heading}>
              <Text style={[styles.title, { color: palette.text }]}>
                {isRegister ? "Crea tu cuenta" : "Bienvenido de nuevo"}
              </Text>
              <Text style={[styles.subtitle, { color: palette.muted }]}>
                {isRegister ? "Un mejor cuidado empieza aquí." : "Accede para continuar cuidando de tu mascota."}
              </Text>
            </View>

            <SurfaceCard style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <View style={styles.form}>
                {isRegister ? (
                  <AppTextField
                    label="Nombre"
                    labelStyle={{ color: palette.text }}
                    placeholder="Cómo te llamas"
                    placeholderTextColor={palette.placeholder}
                    style={inputStyle}
                    keyboardAppearance={themeMode}
                    value={name}
                    onChangeText={setName}
                    autoComplete="name"
                    maxLength={100}
                    returnKeyType="next"
                  />
                ) : null}
                <AppTextField
                  label="Correo electrónico"
                  labelStyle={{ color: palette.text }}
                  placeholder="tu@correo.com"
                  placeholderTextColor={palette.placeholder}
                  style={inputStyle}
                  keyboardAppearance={themeMode}
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
                  labelStyle={{ color: palette.text }}
                  placeholder="Tu contraseña"
                  placeholderTextColor={palette.placeholder}
                  style={inputStyle}
                  keyboardAppearance={themeMode}
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
                {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.error }]}>{error}</Text> : null}
                <AppButton
                  label={isRegister ? "Crear cuenta" : "Iniciar sesión"}
                  loading={busy}
                  buttonStyle={styles.primaryButton}
                  onPress={() => void submit()}
                />
                <AppButton
                  label={isRegister ? "Ya tengo una cuenta" : "Necesito crear una cuenta"}
                  variant="quiet"
                  disabled={busy}
                  labelColor={palette.muted}
                  onPress={() => {
                    setIsRegister((current) => !current);
                    setError(null);
                    clearError();
                  }}
                />
                {restoreError ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.error }]}>{restoreError}</Text> : null}
                <Text style={[styles.note, { color: palette.muted }]}>
                  Los datos locales anteriores no se vinculan automáticamente. Cada cuenta mantiene un espacio local separado en este dispositivo.
                </Text>
              </View>
            </SurfaceCard>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 28 },
  inner: { width: "100%", maxWidth: 440, alignSelf: "center" },
  innerWide: { maxWidth: 460 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 26 },
  brandCopy: { gap: 3 },
  brandName: { fontSize: 17, fontWeight: "800", letterSpacing: 1.4 },
  brandTagline: { fontSize: 12, letterSpacing: 0.1 },
  heading: { gap: 7, marginBottom: 20 },
  title: { fontSize: 27, lineHeight: 34, fontWeight: "700", letterSpacing: -0.5 },
  subtitle: { fontSize: 14, lineHeight: 21 },
  card: { borderWidth: 1, borderRadius: 20, shadowOpacity: 0.04, shadowRadius: 16, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  form: { gap: 16 },
  input: { minHeight: 52, borderWidth: 1, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 0, fontSize: 16, textAlignVertical: "center", includeFontPadding: false },
  primaryButton: { minHeight: 52, borderRadius: 13, marginTop: 2 },
  error: { fontSize: 13, lineHeight: 19 },
  note: { fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 1 },
});

const imageStyles = StyleSheet.create({
  brandMark: { width: 58, height: 58, borderRadius: 16 },
});
