import type {
  CalendarNotificationPlatform,
  NotificationPermission,
  NotificationPlatform,
} from "./types";

export async function resolveNotificationPermission(
  platform: NotificationPlatform,
  adapter: Pick<
    CalendarNotificationPlatform,
    "ensureAndroidChannel" | "getPermission" | "requestPermission"
  >,
  shouldRequest: boolean,
): Promise<NotificationPermission> {
  if (platform === "android") {
    await adapter.ensureAndroidChannel();
  }

  const current = await adapter.getPermission();
  if (current.granted || !shouldRequest || !current.canAskAgain) {
    return current;
  }
  return adapter.requestPermission();
}
