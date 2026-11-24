import { calendarRepository } from "./calendarRepository";
import { createCalendarNotificationManager } from "./notifications/manager";
import { calendarNotificationPlatform } from "./notifications/platform";
import { getNotificationsEnabled } from "../profile/preferences";

const manager = createCalendarNotificationManager(
  calendarNotificationPlatform,
  calendarRepository,
  getNotificationsEnabled,
);

export const syncCalendarNotification = manager.syncCalendarNotification;
export const cancelCalendarNotification = manager.cancelCalendarNotification;
export const reconcileCalendarNotifications =
  manager.reconcileCalendarNotifications;
export const openCalendarNotificationSettings = manager.openSettings;

export async function getCalendarNotificationExactAlarmPermission(): Promise<boolean> {
  return calendarNotificationPlatform.getExactAlarmPermission();
}
