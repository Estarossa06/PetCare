import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AppButton } from "../../src/components/ui/AppButton";
import { AppTextField } from "../../src/components/ui/TextField";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { colors, spacing } from "../../src/theme/tokens";

export default function GoogleCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; linkCode?: string; error?: string; linked?: string }>();
  const { user, loading, loginWithGoogleHandoff, completeGoogleAccountLink } = useAuth();
  const [message, setMessage] = useState("Comprobando el inicio de sesión con Google…");
  const [failed, setFailed] = useState(false);
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;
    const fragmentLinkCode = typeof window !== "undefined" && window.location.hash
      ? new URLSearchParams(window.location.hash.slice(1)).get("linkCode")
      : null;
    const callbackLinkCode = typeof params.linkCode === "string" ? params.linkCode : fragmentLinkCode;
    // OAuth handoff codes are single-use credentials. Remove them from browser
    // history before rendering the callback UI or making follow-up requests.
    if (typeof window !== "undefined" && (window.location.search || window.location.hash)) {
      window.history.replaceState(window.history.state, document.title, "/oauth/google-callback");
    }
    if (params.linked === "1") {
      started.current = true;
      setMessage("La cuenta Google se vinculó correctamente.");
      return;
    }
    if (typeof callbackLinkCode === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(callbackLinkCode)) {
      started.current = true;
      setLinkCode(callbackLinkCode);
      setMessage("Este correo ya tiene una cuenta PetCare. Confirma su contraseña para vincular Google de forma segura.");
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
  }, [loading, loginWithGoogleHandoff, params.code, params.error, params.linkCode, params.linked, router]);

  const confirmGoogleLink = async () => {
    if (!linkCode || !currentPassword || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      await completeGoogleAccountLink(linkCode, currentPassword);
      router.replace("/(tabs)/profile");
    } catch {
      setLinkError("No se pudo verificar la cuenta. Comprueba la contraseña o inicia Google de nuevo si el enlace caducó.");
    } finally {
      setLinkBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      {linkCode ? <>
        <Text style={styles.message}>{message}</Text>
        <AppTextField
          label="Contraseña actual de PetCare"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          maxLength={128}
        />
        {linkError ? <Text accessibilityRole="alert" style={styles.error}>{linkError}</Text> : null}
        <AppButton label="Verificar y vincular Google" onPress={() => void confirmGoogleLink()} loading={linkBusy} disabled={!currentPassword} />
        <AppButton label="Cancelar" variant="quiet" disabled={linkBusy} onPress={() => router.replace("/auth")} />
      </> : null}
      {!linkCode && !failed && params.linked !== "1" ? <ActivityIndicator color={colors.blue} /> : null}
      {!linkCode ? <Text accessibilityRole={failed ? "alert" : undefined} style={styles.message}>{message}</Text> : null}
      {params.linked === "1" ? <AppButton label="Volver al perfil" onPress={() => router.replace("/(tabs)/profile")} /> : null}
      {failed ? <AppButton label="Volver a iniciar sesión" onPress={() => router.replace("/auth")} /> : null}
      {user && failed ? <AppButton label="Volver al perfil" variant="secondary" onPress={() => router.replace("/(tabs)/profile")} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background },
  message: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 420 },
  error: { color: "#B42318", fontSize: 13, lineHeight: 19, textAlign: "center" },
});
