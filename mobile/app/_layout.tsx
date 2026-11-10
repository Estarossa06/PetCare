import { useEffect } from "react";
import { Stack } from "expo-router";
import { AppState, Platform, StatusBar } from "react-native";
import { colors } from "../src/theme/tokens";
import { reconcileCalendarNotifications } from "../src/calendar/calendarNotifications";
import { AuthProvider } from "../src/auth/AuthProvider";

export default function RootLayout() {
  useEffect(() => {
    if (Platform.OS === "web") return;

    const reconcile = () => {
      void reconcileCalendarNotifications().catch((error: unknown) => {
        console.error("Calendar notification reconciliation failed.", error);
      });
    };
    reconcile();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") reconcile();
    });
    return () => subscription.remove();
  }, []);

  return (
    <AuthProvider>
      <>
        <StatusBar barStyle="dark-content" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="auth" options={{ presentation: "modal" }} />
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
          <Stack.Screen name="database-verification" />
        </Stack>
      </>
    </AuthProvider>
  );
}
