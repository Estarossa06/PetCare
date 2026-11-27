import { useEffect } from "react";
import { Stack } from "expo-router";
import { ActivityIndicator, AppState, Platform, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../src/theme/tokens";
import { reconcileCalendarNotifications } from "../src/features/calendar/calendarNotifications";
import { useNotificationNavigation } from "../src/features/calendar/notifications/useNotificationNavigation";
import { AuthProvider, useAuth } from "../src/features/auth/AuthProvider";
import { getAuthRouteGuards } from "../src/features/auth/routeAccess";
import { PersistentAppTabBar } from "../src/navigation/AppTabBar";
import { ThemeProvider, useTheme } from "../src/theme/ThemeProvider";

function AuthenticatedNavigation() {
  useNotificationNavigation();
  const { user, loading } = useAuth();
  const guards = getAuthRouteGuards(loading, Boolean(user));

  useEffect(() => {
    if (loading || !user) return;
    const reconcile = () => {
      void reconcileCalendarNotifications().catch((error: unknown) => {
        console.error("Calendar notification reconciliation failed.", error);
      });
    };
    reconcile();
    if (Platform.OS === "web") return;

    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reconcile();
    });
    return () => subscription.remove();
  }, [loading, user?.id]);

  if (guards.loading) {
    return (
      <SafeAreaView style={styles.loadingScreen}>
        <ActivityIndicator color={colors.blue} />
        <Text style={styles.loadingText}>Comprobando tu sesión…</Text>
      </SafeAreaView>
    );
  }
  return (
    <View style={styles.appShell}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
        <Stack.Protected guard={guards.authentication}>
          <Stack.Screen name="auth" options={{ presentation: "modal" }} />
        </Stack.Protected>
        <Stack.Protected guard={guards.application}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="pet/new" />
          <Stack.Screen name="pet/[id]" />
          <Stack.Screen name="pet/[id]/edit" />
          <Stack.Screen name="pet/[id]/medical/index" />
          <Stack.Screen name="pet/[id]/medical/new" />
          <Stack.Screen name="pet/[id]/medical/[recordId]" />
          <Stack.Screen name="pet/[id]/medical/[recordId]/edit" />
          <Stack.Screen name="pet/[id]/care/index" />
          <Stack.Screen name="pet/[id]/care/new" />
          <Stack.Screen name="pet/[id]/care/[taskId]" />
          <Stack.Screen name="pet/[id]/care/[taskId]/edit" />
          <Stack.Screen name="calendar/new" />
          <Stack.Screen name="calendar/event/[eventId]" />
          <Stack.Screen name="calendar/event/[eventId]/edit" />
          <Stack.Screen name="calendar/appointment/[appointmentId]" />
          <Stack.Screen name="calendar/appointment/[appointmentId]/edit" />
          <Stack.Screen name="calendar/reminder/new" />
          <Stack.Screen name="calendar/reminder/[reminderId]" />
          <Stack.Screen name="calendar/reminder/[reminderId]/edit" />
          <Stack.Screen name="sync-status" />
          <Stack.Screen name="database-verification" />
        </Stack.Protected>
      </Stack>
      {guards.application ? <PersistentAppTabBar /> : null}
    </View>
  );
}

function RootContent() {
  const { mode } = useTheme();
  return (
    <View style={styles.root}>
      <StatusBar barStyle={mode === "dark" ? "light-content" : "dark-content"} />
      <AuthenticatedNavigation />
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <RootContent />
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appShell: { flex: 1 },
  loadingScreen: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: colors.background },
  loadingText: { color: colors.textMuted, fontSize: 14 },
});
