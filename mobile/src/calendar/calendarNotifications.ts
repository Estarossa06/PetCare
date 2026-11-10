import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { calendarRepository } from "./calendarRepository";
import type { CalendarReminder } from "./types";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function syncCalendarNotification(
  reminder: CalendarReminder,
  requestPermission: boolean,
): Promise<CalendarReminder["scheduling_status"]> {
  if (Platform.OS === "web") {
    await calendarRepository.setNotificationState(reminder.id, "unsupported");
    return "unsupported";
  }
  if (reminder.status !== "pending" || !reminder.enabled || reminder.deleted_at) {
    await cancelCalendarNotification(reminder.id);
    await calendarRepository.setNotificationState(reminder.id, "disabled");
    return "disabled";
  }
  if (new Date(reminder.remind_at).getTime() <= Date.now()) {
    await cancelCalendarNotification(reminder.id);
    await calendarRepository.setNotificationState(reminder.id, "expired");
    return "expired";
  }

  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("petcare-calendar", {
        name: "Calendario PetCare",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    let permission = await Notifications.getPermissionsAsync();
    if (permission.status !== "granted" && requestPermission) {
      permission = await Notifications.requestPermissionsAsync();
    }
    if (permission.status !== "granted") {
      await cancelCalendarNotification(reminder.id);
      await calendarRepository.setNotificationState(reminder.id, "denied");
      return "denied";
    }

    await Notifications.cancelScheduledNotificationAsync(reminder.id);
    const osId = await Notifications.scheduleNotificationAsync({
      identifier: reminder.id,
      content: {
        title: reminder.title,
        body: "Tienes un recordatorio de PetCare.",
        data: { reminderId: reminder.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.remind_at),
        ...(Platform.OS === "android" ? { channelId: "petcare-calendar" } : {}),
      },
    });
    await calendarRepository.setScheduledNotification(reminder.id, osId, reminder.version, reminder.remind_at);
    return "scheduled";
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo programar la notificación local.";
    await calendarRepository.setNotificationState(reminder.id, "failed", message);
    return "failed";
  }
}

let reconciliation: Promise<void> | undefined;

export function reconcileCalendarNotifications(): Promise<void> {
  if (Platform.OS === "web") return Promise.resolve();
  if (reconciliation) return reconciliation;

  reconciliation = reconcileScheduledNotifications().finally(() => {
    reconciliation = undefined;
  });
  return reconciliation;
}

async function reconcileScheduledNotifications(): Promise<void> {
  const [reminders, scheduled] = await Promise.all([
    calendarRepository.listReminders(),
    Notifications.getAllScheduledNotificationsAsync(),
  ]);
  const activeReminders = new Map(
    reminders
      .filter((reminder) => reminder.status === "pending" && reminder.enabled === 1 && !reminder.deleted_at)
      .map((reminder) => [reminder.id, reminder]),
  );

  for (const request of scheduled) {
    const reminderId = request.content.data?.reminderId;
    if (
      typeof reminderId === "string" &&
      (!activeReminders.has(reminderId) || request.identifier !== reminderId)
    ) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }

  const permission = await Notifications.getPermissionsAsync();
  const scheduledIds = new Set(
    scheduled
      .filter((request) => request.content.data?.reminderId === request.identifier)
      .map((request) => request.identifier),
  );
  const now = Date.now();
  for (const reminder of activeReminders.values()) {
    if (
      permission.status !== "granted" ||
      reminder.scheduling_status !== "scheduled" ||
      !scheduledIds.has(reminder.id) ||
      new Date(reminder.remind_at).getTime() <= now
    ) {
      await syncCalendarNotification(reminder, false);
    }
  }
}

export async function cancelCalendarNotification(reminderId: string): Promise<void> {
  if (Platform.OS === "web") return;
  await Notifications.cancelScheduledNotificationAsync(reminderId);
}
