import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import Constants from "expo-constants";
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  ArrowLeft, Bell, ChevronRight, CircleHelp, Info, LockKeyhole, LogOut,
  Moon, RefreshCw, ShieldAlert, UserRound, type LucideIcon,
} from "lucide-react-native";
import { AppButton } from "../../../components/ui/AppButton";
import { ConfirmActionModal } from "../../../components/ui/ConfirmActionModal";
import { ScreenHeader } from "../../../components/ui/ScreenHeader";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { useAuth } from "../../auth/AuthProvider";
import { apiClient, type AuthUser } from "../../auth/apiClient";
import { calendarNotificationPlatform } from "../../calendar/notifications/platform";
import { reconcileCalendarNotifications } from "../../calendar/calendarNotifications";
import { getNotificationsEnabled, setNotificationsEnabled } from "../preferences";
import { useTheme } from "../../../theme/ThemeProvider";
import { colors, radius, spacing } from "../../../theme/tokens";
import { reportClientError, reportComponentState, reportScreenOpened } from "../../../diagnostics/renderDiagnostics";

type Page = "profile" | "password" | "notifications" | "about" | "help" | "account" | "google-link" | null;
type AccountAction = "deactivate" | "delete" | null;
type ApiUserResponse = { user: AuthUser };

function userMessage(error: unknown): string {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: unknown }).status) : 0;
  if (status === 401) return "La contraseña actual no es correcta o la sesión venció.";
  if (status === 409) return "Ese correo ya está asociado a otra cuenta.";
  if (status === 400) return "Revisa los datos ingresados e inténtalo de nuevo.";
  return "No pudimos completar la operación. Inténtalo nuevamente.";
}

function SettingRow({ icon: Icon, title, subtitle, onPress, danger = false, trailing }: {
  icon: LucideIcon; title: string; subtitle?: string; onPress?: () => void;
  danger?: boolean; trailing?: React.ReactNode;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}><Icon size={19} color={danger ? colors.orange : colors.blue} /></View>
      <View style={styles.rowCopy}>
        <Text style={[styles.rowTitle, danger && styles.dangerText]}>{title}</Text>
        {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
      </View>
      {trailing ?? (onPress ? <ChevronRight size={18} color={colors.textMuted} /> : null)}
    </Pressable>
  );
}

export default function ProfileScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, loading, error, logout, restore, finishDeactivatedAccount, finishPermanentlyDeletedAccount, updateLocalUser } = useAuth();
  const { mode, setMode } = useTheme();
  const [page, setPage] = useState<Page>(null);
  const [profile, setProfile] = useState<AuthUser | null>(user);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [googleLinkPassword, setGoogleLinkPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [notificationGranted, setNotificationGranted] = useState(false);
  const [notificationSupported, setNotificationSupported] = useState(false);
  const [accountAction, setAccountAction] = useState<AccountAction>(null);
  const [confirmAccountAction, setConfirmAccountAction] = useState(false);

  useFocusEffect(useCallback(() => {
    reportScreenOpened("profile");
  }, []));

  useEffect(() => {
    reportComponentState("profile", "profile_menu", {
      loading,
      authenticated: Boolean(user),
      dataCount: profile ? 1 : 0,
      errorPresent: Boolean(error || message),
      renderBranch: loading ? "loading" : user ? "data" : "unauthenticated",
    });
  }, [error, loading, message, profile, user]);

  const wide = width >= 760;
  const initials = useMemo(() => (profile?.name ?? user?.name ?? "P").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""), [profile?.name, user?.name]);

  useEffect(() => {
    setProfile(user);
    if (!user) return;
    let active = true;
    void apiClient.request<ApiUserResponse>("/auth/me", { authenticated: true })
      .then((result) => { if (active) setProfile(result.user); })
      .catch((profileError) => {
        reportClientError("profile", "api_client", profileError);
        if (active) setMessage("No pudimos actualizar los datos del perfil. Puedes volver a intentarlo.");
      });
    return () => { active = false; };
  }, [user]);

  useEffect(() => {
    let active = true;
    void Promise.all([getNotificationsEnabled(), calendarNotificationPlatform.getPermission()])
      .then(([enabled, permission]) => {
        if (!active) return;
        setNotificationsEnabledState(enabled);
        setNotificationGranted(permission.granted);
        setNotificationSupported(calendarNotificationPlatform.platform === "ios" || calendarNotificationPlatform.platform === "android");
      }).catch((notificationError) => reportClientError("profile", "profile_menu", notificationError));
    return () => { active = false; };
  }, []);

  const openPage = (next: Exclude<Page, null>) => {
    setMessage("");
    setCurrentPassword("");
    if (next === "profile" && profile) { setName(profile.name); setEmail(profile.email); }
    setPage(next);
  };

  const saveProfile = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await apiClient.request<ApiUserResponse>("/auth/me", {
        method: "PATCH", authenticated: true,
        body: { name, email, currentPassword },
      });
      setProfile(result.user); updateLocalUser(result.user); setMessage("Tus datos se actualizaron correctamente."); setCurrentPassword("");
    } catch (saveError) { setMessage(userMessage(saveError)); }
    finally { setBusy(false); }
  };

  const changePassword = async () => {
    if (newPassword !== confirmPassword) { setMessage("Las contraseñas nuevas no coinciden."); return; }
    setBusy(true); setMessage("");
    try {
      await apiClient.request<void>("/auth/password", { method: "POST", authenticated: true, body: { currentPassword, newPassword } });
      setMessage("La contraseña se cambió correctamente."); setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
    } catch (changeError) { setMessage(userMessage(changeError)); }
    finally { setBusy(false); }
  };

  const startGoogleLink = async () => {
    setBusy(true); setMessage("");
    try {
      const url = await apiClient.startGoogleLink(googleLinkPassword || undefined);
      if (Platform.OS === "web") window.location.assign(url);
      else setMessage("La vinculación Google está disponible en PetCare Web.");
    } catch (linkError) { setMessage(userMessage(linkError)); }
    finally { setBusy(false); }
  };

  const toggleNotifications = async (enabled: boolean) => {
    setBusy(true); setMessage("");
    try {
      if (enabled) {
        if (calendarNotificationPlatform.platform === "android") await calendarNotificationPlatform.ensureAndroidChannel();
        let permission = await calendarNotificationPlatform.getPermission();
        if (!permission.granted) permission = await calendarNotificationPlatform.requestPermission();
        setNotificationGranted(permission.granted);
        if (!permission.granted) {
          setMessage("Permite las notificaciones de PetCare en los ajustes del dispositivo para activarlas.");
          return;
        }
      }
      await setNotificationsEnabled(enabled);
      setNotificationsEnabledState(enabled);
      await reconcileCalendarNotifications();
      setMessage(enabled ? "Las notificaciones de este dispositivo están activas." : "Las notificaciones de PetCare se desactivaron en este dispositivo.");
    } catch { setMessage("No pudimos actualizar las notificaciones de este dispositivo."); }
    finally { setBusy(false); }
  };

  const toggleTheme = async (enabled: boolean) => {
    setMessage("");
    try {
      await setMode(enabled ? "dark" : "light");
    } catch {
      setMessage("No pudimos guardar la preferencia de apariencia en este navegador.");
    }
  };

  const executeAccountAction = async () => {
    if (!accountAction) return;
    setBusy(true); setMessage("");
    try {
      if (accountAction === "deactivate") {
        await apiClient.request<void>("/auth/deactivate", { method: "POST", authenticated: true, body: { currentPassword } });
      } else {
        await apiClient.request<{ status: string }>("/auth/deletion-request", { method: "POST", authenticated: true, body: { currentPassword } });
      }
      setConfirmAccountAction(false);
      setAccountAction(null);
      if (accountAction === "delete") {
        const localDataRemoved = await finishPermanentlyDeletedAccount();
        Alert.alert(
          "Solicitud registrada",
          localDataRemoved
            ? "La solicitud de eliminación quedó pendiente de procesamiento en el servidor. Los datos de esta instalación se eliminaron. Otros dispositivos sin conexión deberán conectarse y borrar sus datos locales por separado."
            : "La solicitud de eliminación quedó pendiente de procesamiento en el servidor, pero no se pudieron borrar todos los datos locales de esta instalación. No reinstales ni compartas este dispositivo hasta completar esa limpieza.",
        );
      } else {
        await finishDeactivatedAccount();
      }
      router.replace("/auth");
    } catch (accountError) {
      setConfirmAccountAction(false);
      setMessage(userMessage(accountError));
    } finally { setBusy(false); }
  };

  const handleLogout = async () => {
    setLogoutBusy(true);
    try { await logout(); } catch { /* La sesión local queda cerrada aunque el servidor no responda. */ }
    finally { setLogoutBusy(false); }
  };

  const renderPage = () => {
    switch (page) {
      case "profile": return <>
        <Text style={styles.modalTitle}>Datos del perfil</Text>
        <Text style={styles.modalIntro}>Estos datos se guardan en tu cuenta PetCare.</Text>
        <Field label="Nombre" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Correo electrónico" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        <Field label="Contraseña actual" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        <AppButton label="Guardar cambios" onPress={() => void saveProfile()} loading={busy} />
      </>;
      case "password": return <>
        <Text style={styles.modalTitle}>Cambiar contraseña</Text>
        <Text style={styles.modalIntro}>Usa tu contraseña actual para confirmar el cambio. Se cerrarán las demás sesiones de tu cuenta.</Text>
        <Field label="Contraseña actual" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
        <Field label="Nueva contraseña" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Field label="Repetir contraseña nueva" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry />
        <AppButton label="Actualizar contraseña" onPress={() => void changePassword()} loading={busy} />
      </>;
      case "google-link": return <>
        <Text style={styles.modalTitle}>Vincular cuenta Google</Text>
        <Text style={styles.modalIntro}>Confirma tu contraseña PetCare para vincular una cuenta Google. Si tu cuenta no tiene contraseña local, una sesión Google reciente es suficiente.</Text>
        <Field label="Contraseña actual (si aplica)" value={googleLinkPassword} onChangeText={setGoogleLinkPassword} secureTextEntry />
        <AppButton label="Continuar con Google" onPress={() => void startGoogleLink()} loading={busy} />
      </>;
      case "notifications": return <>
        <Text style={styles.modalTitle}>Notificaciones</Text>
        <Text style={styles.modalIntro}>Las alertas del calendario se programan localmente en este dispositivo.</Text>
        {notificationSupported ? <View style={styles.preferenceRow}><View style={styles.rowCopy}><Text style={styles.rowTitle}>Recordatorios del calendario</Text><Text style={styles.rowSubtitle}>{notificationGranted ? "Permiso concedido por el dispositivo" : "Permiso pendiente en el dispositivo"}</Text></View><Switch value={notificationsEnabled} onValueChange={(value) => void toggleNotifications(value)} disabled={busy} trackColor={{ true: colors.blue }} /></View> : <Text style={styles.infoBox}>Las notificaciones locales están disponibles en la aplicación móvil.</Text>}
        {!notificationGranted && notificationSupported ? <AppButton label="Abrir ajustes del dispositivo" variant="secondary" onPress={() => void calendarNotificationPlatform.openSettings()} /> : null}
      </>;
      case "about": return <>
        <Text style={styles.modalTitle}>Acerca de PetCare</Text>
        <Text style={styles.modalIntro}>PetCare te ayuda a organizar la información, los cuidados, el historial médico y los recordatorios de tus mascotas.</Text>
        <View style={styles.infoBox}><Text style={styles.infoLabel}>Versión instalada</Text><Text style={styles.infoValue}>{Constants.expoConfig?.version ?? "1.0.0"}</Text></View>
        <Text style={styles.modalIntro}>Los datos de salud y cuidado deben revisarse con un profesional veterinario. La app no reemplaza su atención.</Text>
      </>;
      case "help": return <>
        <Text style={styles.modalTitle}>Ayuda y preguntas frecuentes</Text>
        <HelpItem title="¿Dónde están mis datos?" body="Con tu sesión activa, mascotas y registros de salud, cuidados y calendario se sincronizan cuando hay conexión. Puedes revisar su estado en Configuración > Sincronización. Las fotografías y los archivos médicos adjuntos permanecen en este dispositivo." />
        <HelpItem title="¿Cómo cambio de cuenta?" body="Cierra sesión desde esta pantalla. Cada cuenta conserva un espacio local distinto; los datos de una cuenta no se importan automáticamente a otra." />
        <HelpItem title="¿Cómo se programan los recordatorios?" body="Se programan en el dispositivo. Debes permitir las notificaciones en los ajustes del sistema para recibirlas." />
        <HelpItem title="¿Cómo solicito ayuda?" body="La aplicación aún no incluye un canal de contacto integrado. Para soporte sobre tu cuenta o tus datos, utiliza el medio de contacto que te proporcionó el equipo de PetCare." />
      </>;
      case "account": return <>
        <Text style={styles.modalTitle}>Cuenta y privacidad</Text>
        <Text style={styles.modalIntro}>Desactivar cierra tu cuenta e invalida sus sesiones. La eliminación permanente es una solicitud separada.</Text>
        <AppButton label="Desactivar mi cuenta" variant="secondary" icon={ShieldAlert} onPress={() => { setPage(null); setAccountAction("deactivate"); setCurrentPassword(""); }} />
        <AppButton label="Solicitar eliminación permanente" variant="quiet" onPress={() => { setPage(null); setAccountAction("delete"); setCurrentPassword(""); }} />
        <Text style={styles.smallNote}>La solicitud de eliminación queda registrada para su procesamiento. La eliminación definitiva no se ejecuta automáticamente en esta versión.</Text>
      </>;
      default: return null;
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.inner, wide && styles.innerWide]}>
          <ScreenHeader title="Configuración" />
          {loading ? <SurfaceCard><View style={styles.loading}><ActivityIndicator color={colors.blue} /><Text style={styles.body}>Cargando tu cuenta…</Text></View></SurfaceCard> : user ? <>
            <SurfaceCard style={styles.userCard}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{initials || "P"}</Text></View>
              <View style={styles.userCopy}><Text style={styles.userName}>{profile?.name ?? user.name}</Text><Text style={styles.body}>{profile?.email ?? user.email}</Text><Text style={styles.accountLabel}>Cuenta PetCare</Text></View>
            </SurfaceCard>
            {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            <SurfaceCard style={styles.menuCard}>
              <Text style={styles.groupTitle}>Mi cuenta</Text>
              <SettingRow icon={UserRound} title="Datos del perfil" subtitle="Nombre y correo electrónico" onPress={() => openPage("profile")} />
              <SettingRow icon={RefreshCw} title="Sincronización" subtitle="Cambios pendientes y versiones en conflicto" onPress={() => router.push("/sync-status")} />
              <SettingRow icon={LockKeyhole} title="Contraseña" subtitle="Actualiza tu contraseña de acceso" onPress={() => openPage("password")} />
              {Platform.OS === "web" ? <SettingRow icon={UserRound} title="Vincular Google" subtitle="Accede con Google a esta cuenta PetCare" onPress={() => { setGoogleLinkPassword(""); openPage("google-link"); }} /> : null}
              <SettingRow icon={Bell} title="Notificaciones" subtitle="Preferencias de este dispositivo" onPress={() => openPage("notifications")} />
              <View style={styles.divider} />
              <Text style={styles.groupTitle}>Preferencias</Text>
              <SettingRow icon={Moon} title="Modo oscuro" subtitle="Apariencia de la aplicación" trailing={<Switch value={mode === "dark"} onValueChange={(value) => void toggleTheme(value)} trackColor={{ true: colors.blue }} />} />
              <View style={styles.divider} />
              <Text style={styles.groupTitle}>Información</Text>
              <SettingRow icon={Info} title="Acerca de PetCare" onPress={() => openPage("about")} />
              <SettingRow icon={CircleHelp} title="Ayuda y preguntas frecuentes" onPress={() => openPage("help")} />
              <View style={styles.divider} />
              <SettingRow icon={ShieldAlert} title="Desactivar o eliminar cuenta" subtitle="Gestiona tu cuenta y tus datos" danger onPress={() => openPage("account")} />
            </SurfaceCard>
            <AppButton label="Cerrar sesión" icon={LogOut} variant="secondary" loading={logoutBusy} onPress={() => void handleLogout()} />
          </> : <SurfaceCard style={styles.emptyCard}>
            <Text style={styles.userName}>Inicia sesión para ver tu perfil</Text>
            {error ? <Text style={styles.message}>{error}</Text> : null}
            <AppButton label="Reintentar" variant="secondary" onPress={() => void restore()} />
            <AppButton label="Iniciar sesión" onPress={() => router.push("/auth")} />
          </SurfaceCard>}
        </View>
      </ScrollView>
      <Modal visible={page !== null} transparent animationType="slide" onRequestClose={() => setPage(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPage(null)} accessibilityLabel="Cerrar" />
          <View style={[styles.modalSheet, wide && styles.modalSheetWide]}>
            <View style={styles.modalHeader}><Pressable accessibilityRole="button" onPress={() => setPage(null)} style={styles.modalBack}><ArrowLeft size={19} color={colors.text} /></Pressable><View style={styles.handle} /></View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.modalContent}>
              {renderPage()}
              {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={accountAction !== null && !confirmAccountAction} transparent animationType="fade" onRequestClose={() => setAccountAction(null)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.actionDialog, wide && styles.actionDialogWide]}>
            <Text style={styles.modalTitle}>{accountAction === "delete" ? "Solicitar eliminación permanente" : "Desactivar mi cuenta"}</Text>
            <Text style={styles.modalIntro}>{accountAction === "delete" ? "La solicitud se registrará y tu cuenta se desactivará. La eliminación final requiere procesamiento posterior." : "Tu cuenta se desactivará y se revocarán todas las sesiones activas. Podrás contactar soporte para reactivarla."}</Text>
            <Field label="Confirma con tu contraseña" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry />
            {message ? <Text accessibilityRole="alert" style={styles.message}>{message}</Text> : null}
            <View style={styles.dialogActions}><AppButton label="Cancelar" variant="secondary" onPress={() => { setAccountAction(null); setMessage(""); }} /><AppButton label="Continuar" onPress={() => { setMessage(""); setConfirmAccountAction(true); }} /></View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ConfirmActionModal
        visible={confirmAccountAction}
        title={accountAction === "delete" ? "¿Enviar solicitud de eliminación?" : "¿Desactivar tu cuenta?"}
        message={accountAction === "delete" ? "Tu sesión se cerrará. La cuenta quedará desactivada mientras se procesa la solicitud de eliminación." : "Se cerrará tu sesión y las demás sesiones de la cuenta quedarán revocadas."}
        confirmLabel={accountAction === "delete" ? "Enviar solicitud" : "Desactivar cuenta"}
        busy={busy}
        onCancel={() => setConfirmAccountAction(false)}
        onConfirm={() => void executeAccountAction()}
      />
    </SafeAreaView>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} style={styles.input} placeholderTextColor={colors.textMuted} autoCorrect={false} /></View>;
}

function HelpItem({ title, body }: { title: string; body: string }) {
  return <View style={styles.helpItem}><Text style={styles.helpTitle}>{title}</Text><Text style={styles.modalIntro}>{body}</Text></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: 36 },
  inner: { width: "100%", maxWidth: 620, alignSelf: "center", gap: spacing.md },
  innerWide: { maxWidth: 760 },
  userCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.lg },
  avatar: { width: 58, height: 58, borderRadius: radius.pill, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.blue, fontSize: 21, fontWeight: "800" },
  userCopy: { flex: 1, gap: 3 },
  userName: { color: colors.text, fontSize: 19, fontWeight: "800" },
  accountLabel: { color: colors.blue, fontSize: 11, fontWeight: "700", marginTop: 3 },
  body: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  menuCard: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  groupTitle: { color: colors.textMuted, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7, marginTop: spacing.sm, marginBottom: 3 },
  row: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: 9 },
  rowIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  rowIconDanger: { backgroundColor: colors.dangerSoft },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  dangerText: { color: colors.orange },
  rowSubtitle: { color: colors.textMuted, fontSize: 11, lineHeight: 16 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  pressed: { opacity: 0.72 },
  loading: { minHeight: 125, alignItems: "center", justifyContent: "center", gap: spacing.md },
  emptyCard: { gap: spacing.md },
  message: { color: colors.orange, fontSize: 13, lineHeight: 19, paddingHorizontal: 2 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.48)" },
  modalSheet: { maxHeight: "88%", backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  modalSheetWide: { width: "100%", maxWidth: 560, alignSelf: "center", borderRadius: 26, marginBottom: 20 },
  modalHeader: { height: 50, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  modalBack: { position: "absolute", left: 0, width: 38, height: 38, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  handle: { width: 40, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  modalContent: { gap: spacing.md, paddingBottom: spacing.md },
  modalTitle: { color: colors.text, fontSize: 21, fontWeight: "800" },
  modalIntro: { color: colors.textMuted, fontSize: 13, lineHeight: 20 },
  field: { gap: 7 },
  fieldLabel: { color: colors.text, fontSize: 12, fontWeight: "700" },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, color: colors.text, backgroundColor: colors.background, fontSize: 14 },
  preferenceRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.md },
  infoBox: { padding: spacing.md, backgroundColor: colors.blueSoft, borderRadius: radius.sm, gap: 5 },
  infoLabel: { color: colors.textMuted, fontSize: 11 },
  infoValue: { color: colors.text, fontSize: 16, fontWeight: "800" },
  helpItem: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.xs },
  helpTitle: { color: colors.text, fontSize: 14, fontWeight: "800" },
  smallNote: { color: colors.textMuted, fontSize: 11, lineHeight: 17 },
  actionDialog: { margin: spacing.lg, padding: spacing.lg, gap: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, elevation: 12 },
  actionDialogWide: { width: "100%", maxWidth: 440, alignSelf: "center" },
  dialogActions: { flexDirection: "row", gap: spacing.sm, justifyContent: "flex-end" },
});
