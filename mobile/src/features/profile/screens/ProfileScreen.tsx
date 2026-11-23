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
import { AppButton } from "../../../components/ui/AppButton";
import { ScreenHeader } from "../../../components/ui/ScreenHeader";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { authErrorMessage } from "../../auth/authErrorMessage";
import { useAuth } from "../../auth/AuthProvider";
import { colors, spacing } from "../../../theme/tokens";

export default function ProfileScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, loading, error, logout, restore } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [logoutBusy, setLogoutBusy] = useState(false);

  const openAuth = (mode: "login" | "register") => {
    setLogoutError(null);
    router.push({ pathname: "/auth", params: { mode } });
  };

  const handleLogout = async () => {
    setLogoutError(null);
    setLogoutBusy(true);
    try {
      await logout();
    } catch (logoutFailure) {
      setLogoutError(
        `La sesión local se cerró, pero no pudimos confirmar su revocación en el servidor. ${authErrorMessage(logoutFailure)}`,
      );
    } finally {
      setLogoutBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.inner, width >= 760 && styles.innerWide]}>
          <ScreenHeader
            title="Perfil"
          />

          <SurfaceCard>
            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.blue} />
                <Text style={styles.body}>Restaurando sesión…</Text>
              </View>
            ) : user ? (
              <View style={styles.section}>
                <Text style={styles.status}>Cuenta autenticada</Text>
                <Text style={styles.name}>{user.name}</Text>
                <Text style={styles.body}>{user.email}</Text>
                <Text style={styles.notice}>
                  Tus datos de mascotas y actividades siguen en este dispositivo; no se sincronizan ni se vinculan con esta cuenta.
                </Text>
                <AppButton
                  label="Cerrar sesión"
                  variant="secondary"
                  loading={logoutBusy}
                  disabled={logoutBusy}
                  onPress={() => void handleLogout()}
                />
              </View>
            ) : (
              <View style={styles.section}>
                <Text style={styles.name}>Modo local</Text>
                <Text style={styles.body}>
                  Puedes usar PetCare sin cuenta. Tus datos permanecen en este dispositivo y no se sincronizan.
                </Text>
                {logoutError ? <Text style={styles.error}>{logoutError}</Text> : null}
                {error && !logoutError ? (
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
  status: { color: colors.blue, fontSize: 13, fontWeight: "700" },
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
