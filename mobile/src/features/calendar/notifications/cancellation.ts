import type {
  CalendarNotificationPlatform,
  CalendarNotificationStore,
} from "./types";
import { reminderIdFromNotification } from "./ids";

export async function cancelReminderNotifications(
  reminderId: string,
  platform: CalendarNotificationPlatform,
  store: CalendarNotificationStore,
): Promise<void> {
  const [storedId, scheduled] = await Promise.all([
    store.getNotificationId(reminderId),
    platform.getScheduled(),
  ]);
  const identifiers = new Set<string>();
  if (storedId) identifiers.add(storedId);
  identifiers.add(reminderId);
  for (const request of scheduled) {
    if (reminderIdFromNotification(request) === reminderId) {
      identifiers.add(request.identifier);
    }
  }
  await Promise.all([...identifiers].map((identifier) => platform.cancel(identifier)));
}
