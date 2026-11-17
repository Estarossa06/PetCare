import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { getReminderRoute } from "./navigation";

export function useNotificationNavigation(): void {
  const handledResponses = useRef(new Map<string, number>());

  useEffect(() => {
    if (Platform.OS !== "android" && Platform.OS !== "ios") return;

    const handleResponse = (response: Notifications.NotificationResponse) => {
      const key = [
        response.notification.request.identifier,
        response.notification.date,
        response.actionIdentifier,
      ].join(":");
      const now = Date.now();
      const lastHandled = handledResponses.current.get(key);
      if (lastHandled !== undefined && now - lastHandled < 1_500) return;
      handledResponses.current.set(key, now);
      for (const [handledKey, handledAt] of handledResponses.current) {
        if (now - handledAt >= 1_500) handledResponses.current.delete(handledKey);
      }

      const route = getReminderRoute(
        response,
        Notifications.DEFAULT_ACTION_IDENTIFIER,
      );
      if (route) {
        try {
          router.push(route);
        } catch {
          console.warn("Could not open the screen from a notification.");
        }
      }
      Notifications.clearLastNotificationResponse();
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener(handleResponse);
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleResponse(response);
    }).catch(() => {
      console.warn("Could not read the initial notification response.");
    });

    return () => subscription.remove();
  }, []);
}
