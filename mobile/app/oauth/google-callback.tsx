import { useEffect, useRef, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { AppButton } from "../../src/components/ui/AppButton";
import { AppTextField } from "../../src/components/ui/TextField";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { colors, spacing } from "../../src/theme/tokens";

type CredentialChoice = "google_only" | "google_and_password";

export default function GoogleCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; recoveryCode?: string; passwordLinkCode?: string; error?: string; linked?: string }>();
  const { loading, loginWithGoogleHandoff, completeGoogleAccountRecovery, completeGoogleAccountLink } = useAuth();
  const [message, setMessage] = useState("Comprobando el inicio de sesión con Google…");
  const [failed, setFailed] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [passwordLinkCode, setPasswordLinkCode] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [credentialChoice, setCredentialChoice] = useState<CredentialChoice>("google_only");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (loading || started.current) return;
    const fragment = typeof window !== "undefined" && window.location.hash
      ? new URLSearchParams(window.location.hash.slice(1))
      : new URLSearchParams();
    const callbackHandoffCode = typeof params.code === "string" ? params.code : fragment.get("code");
    const callbackRecoveryCode = typeof params.recoveryCode === "string" ? params.recoveryCode : fragment.get("recoveryCode");
    const callbackPasswordLinkCode = typeof params.passwordLinkCode === "string" ? params.passwordLinkCode : fragment.get("passwordLinkCode");
    if (typeof window !== "undefined" && (window.location.search || window.location.hash)) {
      window.history.replaceState(window.history.state, document.title, "/oauth/google-callback");
    }
    if (params.linked === "1") {
      started.current = true;
      setMessage("La cuenta Google se vinculó correctamente.");
      return;
    }
    if (typeof callbackRecoveryCode === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(callbackRecoveryCode)) {
      started.current = true;
      setRecoveryCode(callbackRecoveryCode);
      setMessage("Para continuar, confirma el código enviado al correo asociado a tu cuenta PetCare.");
      return;
    }
    if (typeof callbackPasswordLinkCode === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(callbackPasswordLinkCode)) {
      started.current = true;
      setPasswordLinkCode(callbackPasswordLinkCode);
      setMessage("Confirma la contraseña de tu cuenta PetCare para vincular esta cuenta de Google.");
      return;
    }
    if (params.error) {
      started.current = true;
      router.replace({ pathname: "/auth", params: { googleError: String(params.error) } });
      return;
    }
    if (typeof callbackHandoffCode !== "string" || callbackHandoffCode.length < 32 || callbackHandoffCode.length > 128) {
      started.current = true;
      router.replace({ pathname: "/auth", params: { googleError: "invalid_callback" } });
      return;
    }
    started.current = true;
    void loginWithGoogleHandoff(callbackHandoffCode).then(() => {
      if (typeof window !== "undefined") window.history.replaceState({}, document.title, "/oauth/google-callback");
      router.replace("/(tabs)/profile");
    }).catch(() => {
      setFailed(true);
      setMessage("No pudimos completar el inicio con Google. Vuelve a intentarlo.");
    });
  }, [loading, loginWithGoogleHandoff, params.code, params.error, params.linked, params.passwordLinkCode, params.recoveryCode, router]);

  const confirmPasswordLink = async () => {
    if (!passwordLinkCode || busy) return;
    setBusy(true);
    setRecoveryError(null);
    try {
      await completeGoogleAccountLink({ linkCode: passwordLinkCode, currentPassword });
      router.replace("/(tabs)/profile");
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : 0;
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
      setRecoveryError(code === "GOOGLE_IDENTITY_CONFLICT"
        ? "Esta identidad de Google ya está vinculada a otra cuenta PetCare. No se modificó ninguna cuenta."
        : status === 429
          ? "Se alcanzó el límite de intentos. Espera un momento e inicia Google de nuevo."
          : status === 401
            ? "La contraseña es incorrecta o el enlace caducó. Comprueba la contraseña e inténtalo de nuevo; si caducó, inicia Google otra vez."
            : "No se pudo vincular Google. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  };

  const confirmRecovery = async () => {
    if (!recoveryCode || busy) return;
    if (credentialChoice === "google_and_password" && (newPassword.length < 12 || newPassword.length > 128 || newPassword !== confirmPassword)) {
      setRecoveryError(newPassword !== confirmPassword ? "Las contraseñas nuevas no coinciden." : "La contraseña nueva debe tener entre 12 y 128 caracteres.");
      return;
    }
    setBusy(true);
    setRecoveryError(null);
    try {
      await completeGoogleAccountRecovery({
        recoveryCode,
        emailCode,
        credentialChoice,
        ...(credentialChoice === "google_and_password" ? { newPassword } : {}),
      });
      router.replace("/(tabs)/profile");
    } catch (error) {
      const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: unknown }).status) : 0;
      const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
      setRecoveryError(code === "GOOGLE_IDENTITY_CONFLICT" || status === 409
        ? "Esta identidad de Google ya está vinculada a otra cuenta PetCare. No se modificó ninguna cuenta."
        : status === 400
          ? "La contraseña nueva no cumple los requisitos. Revisa los datos e inténtalo de nuevo."
          : "No se pudo verificar el código. Comprueba que siga vigente o inicia Google de nuevo para solicitar otro.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      {recoveryCode ? <>
        <Text style={styles.message}>{message}</Text>
        <AppTextField label="Código de verificación de 8 dígitos" value={emailCode} onChangeText={(value) => setEmailCode(value.replace(/\D/g, "").slice(0, 8))} keyboardType="number-pad" autoComplete="one-time-code" maxLength={8} />
        <Text style={styles.choiceHeading}>Elige cómo quieres acceder</Text>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: credentialChoice === "google_only" }} onPress={() => setCredentialChoice("google_only")} style={styles.choice}>
          <Text style={styles.choiceMark}>{credentialChoice === "google_only" ? "●" : "○"}</Text>
          <View><Text style={styles.choiceTitle}>Usar solo Google</Text><Text style={styles.choiceCopy}>La contraseña anterior quedará invalidada.</Text></View>
        </Pressable>
        <Pressable accessibilityRole="radio" accessibilityState={{ checked: credentialChoice === "google_and_password" }} onPress={() => setCredentialChoice("google_and_password")} style={styles.choice}>
          <Text style={styles.choiceMark}>{credentialChoice === "google_and_password" ? "●" : "○"}</Text>
          <View><Text style={styles.choiceTitle}>Google y contraseña nueva</Text><Text style={styles.choiceCopy}>Podrás usar cualquiera de los dos métodos.</Text></View>
        </Pressable>
        {credentialChoice === "google_and_password" ? <>
          <AppTextField label="Contraseña nueva" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoComplete="new-password" maxLength={128} hint="Usa entre 12 y 128 caracteres." />
          <AppTextField label="Repite la contraseña nueva" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry autoComplete="new-password" maxLength={128} />
        </> : null}
        {recoveryError ? <Text accessibilityRole="alert" style={styles.error}>{recoveryError}</Text> : null}
        <AppButton label="Verificar y recuperar cuenta" onPress={() => void confirmRecovery()} loading={busy} disabled={busy || emailCode.length !== 8} />
        <AppButton label="Cancelar" variant="quiet" disabled={busy} onPress={() => router.replace("/auth")} />
      </> : null}
      {passwordLinkCode ? <>
        <Text style={styles.message}>{message}</Text>
        <AppTextField label="Contraseña actual de PetCare" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoComplete="current-password" maxLength={128} />
        {recoveryError ? <Text accessibilityRole="alert" style={styles.error}>{recoveryError}</Text> : null}
        <AppButton label="Verificar y vincular Google" onPress={() => void confirmPasswordLink()} loading={busy} disabled={busy || currentPassword.length < 1} />
        <AppButton label="Cancelar" variant="quiet" disabled={busy} onPress={() => router.replace("/auth")} />
      </> : null}
      {!recoveryCode && !passwordLinkCode && !failed && params.linked !== "1" ? <ActivityIndicator color={colors.blue} /> : null}
      {!recoveryCode && !passwordLinkCode ? <Text accessibilityRole={failed ? "alert" : undefined} style={styles.message}>{message}</Text> : null}
      {params.linked === "1" ? <AppButton label="Volver al perfil" onPress={() => router.replace("/(tabs)/profile")} /> : null}
      {failed ? <AppButton label="Volver a iniciar sesión" onPress={() => router.replace("/auth")} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "stretch", gap: spacing.md, padding: spacing.xl, backgroundColor: colors.background, maxWidth: 520, width: "100%", alignSelf: "center" },
  message: { color: colors.text, fontSize: 15, lineHeight: 22, textAlign: "center", marginBottom: spacing.sm },
  choiceHeading: { color: colors.text, fontSize: 15, fontWeight: "700", marginTop: spacing.sm },
  choice: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  choiceMark: { color: colors.blue, fontSize: 20 },
  choiceTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  choiceCopy: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  error: { color: "#B42318", fontSize: 13, lineHeight: 19, textAlign: "center" },
});
