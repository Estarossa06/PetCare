import { Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import type {
  CalendarNotificationPlatform,
  NotificationPermission,
  NotificationPlatform,
} from "./types";

function currentPlatform(): NotificationPlatform {
  if (Platform.OS === "android" || Platform.OS === "ios" || Platform.OS === "web") {
    return Platform.OS;
  }
  return "unsupported";
}

function permissionResult(
  result: Awaited<ReturnType<typeof Notifications.getPermissionsAsync>>,
): NotificationPermission {
  const provisional =
    result.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
    result.ios?.status === Notifications.IosAuthorizationStatus.EPHEMERAL;
  return {
    granted: result.granted || provisional,
    canAskAgain: result.canAskAgain,
  };
}

export const calendarNotificationPlatform: CalendarNotificationPlatform = {
  platform: currentPlatform(),

  async ensureAndroidChannel() {
    await Notifications.setNotificationChannelAsync("petcare-calendar", {
      name: "Calendario PetCare",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  },

  async getPermission() {
    return permissionResult(await Notifications.getPermissionsAsync());
  },

  async requestPermission() {
    return permissionResult(
      await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: false,
          allowSound: true,
        },
      }),
    );
  },

  getExactAlarmPermission() {
    if (Platform.OS !== "android") return Promise.resolve(true);
    return Notifications.getExactAlarmPermissionsAsync().then(
      (permission) => permission.granted,
    );
  },

  schedule(request) {
    return Notifications.scheduleNotificationAsync({
      identifier: request.identifier,
      content: request.content,
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: request.triggerDate,
        ...(request.channelId ? { channelId: request.channelId } : {}),
      },
    });
  },

  getScheduled() {
    return Notifications.getAllScheduledNotificationsAsync();
  },

  cancel(identifier) {
    return Notifications.cancelScheduledNotificationAsync(identifier);
  },

  async openSettings() {
    await Linking.openSettings();
  },
};

if (calendarNotificationPlatform.platform === "android" ||
  calendarNotificationPlatform.platform === "ios") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}
