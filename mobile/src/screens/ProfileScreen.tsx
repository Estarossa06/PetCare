import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { useAuth } from "../auth/AuthProvider";
import { colors, spacing } from "../theme/tokens";

export default function ProfileScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, loading, error, logout, restore } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const openAuth = (mode: "login" | "register") => {
    router.push({ pathname: "/auth", params: { mode } });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.inner, width >= 760 && styles.innerWide]}>
          <ScreenHeader
            eyebrow="Cuenta"
            title="Perfil"
            subtitle="La identidad online es independiente de tus datos locales."
          />

          <SurfaceCard>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.blue} />
                <Text style={styles.body}>Restaurando sesión…</Text>
              </View>
            ) : user ? (
              <View style={styles.section}>
                <Text style={styles.name}>{user.name}</Text>
                <Text style={styles.body}>{user.email}</Text>
                <Text style={styles.notice}>
                  Tus registros locales de mascotas, cuidados y calendario no se
                  han asociado ni enviado a esta cuenta.
                </Text>
                {logoutError ? <Text style={styles.error}>{logoutError}</Text> : null}
                <AppButton
                  label="Cerrar sesión"
                  variant="secondary"
                  onPress={() => {
                    setLogoutError(null);
                    void logout().catch((logoutFailure: unknown) => {
                      setLogoutError(
                        logoutFailure instanceof Error
                          ? logoutFailure.message
                          : "No se pudo cerrar la sesión en el servidor.",
                      );
                    });
                  }}
                />
              </View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.name}>Conecta tu cuenta</Text>
                <Text style={styles.body}>
                  Inicia sesión para usar los futuros servicios online. PetCare
                  mantiene sus funciones locales disponibles sin conexión.
                </Text>
                {error ? (
                  <>
                    <Text style={styles.error}>{error}</Text>
                    <AppButton
                      label="Reintentar restauración"
                      variant="secondary"
                      onPress={() => void restore()}
                    />
                  </>
                ) : null}
                <AppButton
                  label="Iniciar sesión"
                  onPress={() => openAuth("login")}
                />
                <AppButton
                  label="Crear cuenta"
                  variant="secondary"
                  onPress={() => openAuth("register")}
                />
              </View>
            )}
          </SurfaceCard>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg },
  inner: { width: "100%", maxWidth: 620, alignSelf: "center" },
  innerWide: { maxWidth: 760 },
  section: { gap: spacing.md },
  loading: {
    minHeight: 140,
    gap: spacing.md,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { color: colors.blueDark, fontSize: 20, fontWeight: "800" },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  notice: {
    color: colors.blueDark,
    backgroundColor: colors.blueSoft,
    padding: spacing.md,
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 19,
  },
  error: { color: colors.orange, fontSize: 13, lineHeight: 19 },
});
