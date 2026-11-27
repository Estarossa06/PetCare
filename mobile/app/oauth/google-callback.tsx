import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AppButton } from "../../src/components/ui/AppButton";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { colors, spacing } from "../../src/theme/tokens";

export default function GoogleCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; error?: string; linked?: string }>();
  const { user, loading, loginWithGoogleHandoff } = useAuth();
  const [message, setMessage] = useState("Comprobando el inicio de sesión con Google…");
  const [failed, setFailed] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;
    // OAuth handoff codes are single-use credentials. Remove them from browser
    // history before rendering the callback UI or making follow-up requests.
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, document.title, "/oauth/google-callback");
    }
    if (params.linked === "1") {
      started.current = true;
      setMessage("La cuenta Google se vinculó correctamente.");
      return;
    }
    if (params.error) {
      started.current = true;
      router.replace({ pathname: "/auth", params: { googleError: String(params.error) } });
      return;
    }
    if (typeof params.code !== "string" || params.code.length < 32 || params.code.length > 128) {
      started.current = true;
      router.replace({ pathname: "/auth", params: { googleError: "invalid_callback" } });
      return;
    }
    started.current = true;
    void loginWithGoogleHandoff(params.code).then(() => {
      if (typeof window !== "undefined") window.history.replaceState({}, document.title, "/oauth/google-callback");
      router.replace("/(tabs)/profile");
    }).catch(() => {
      setFailed(true);
      setMessage("No pudimos completar el inicio con Google. Vuelve a intentarlo.");
    });
  }, [loading, loginWithGoogleHandoff, params.code, params.error, params.linked, router]);

  return (
    <View style={styles.container}>
      {!failed && params.linked !== "1" ? <ActivityIndicator color={colors.blue} /> : null}
      <Text accessibilityRole={failed ? "alert" : undefined} style={styles.message}>{message}</Text>
      {params.linked === "1" ? <AppButton label="Volver al perfil" onPress={() => router.replace("/(tabs)/profile")} /> : null}
      {failed ? <AppButton label="Volver a iniciar sesión" onPress={() => router.replace("/auth")} /> : null}
      {user && failed ? <AppButton label="Volver al perfil" variant="secondary" onPress={() => router.replace("/(tabs)/profile")} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  message: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 420 },
});
