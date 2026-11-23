import type { NotificationResponse } from "expo-notifications";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getReminderRoute(
  response: NotificationResponse,
  defaultActionIdentifier: string,
): string | null {
  if (response.actionIdentifier !== defaultActionIdentifier) return null;

  const reminderId = response.notification.request.content.data?.reminderId;
  if (typeof reminderId !== "string" || !UUID_PATTERN.test(reminderId)) {
    return null;
  }
  return `/calendar/reminder/${reminderId.toLowerCase()}`;
}
