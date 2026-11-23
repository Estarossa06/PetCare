import type { NotificationRequest } from "expo-notifications";

export const CALENDAR_NOTIFICATION_TYPE = "petcare-calendar-reminder";

export function reminderIdFromNotification(
  request: NotificationRequest,
): string | null {
  const reminderId = request.content.data?.reminderId;
  return typeof reminderId === "string" ? reminderId : null;
}

export function isCalendarNotification(request: NotificationRequest): boolean {
  return request.content.data?.notificationType === CALENDAR_NOTIFICATION_TYPE ||
    reminderIdFromNotification(request) !== null;
}

export function stableNotificationId(reminderId: string): string {
  return reminderId.toLowerCase();
}
