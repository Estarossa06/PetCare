import { preferenceStorage } from "../../platform/preferenceStorage";

const NOTIFICATIONS_KEY = "petcare.preferences.notifications";

export async function getNotificationsEnabled(): Promise<boolean> {
  try {
    return (await preferenceStorage.getItem(NOTIFICATIONS_KEY)) !== "false";
  } catch {
    return true;
  }
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await preferenceStorage.setItem(NOTIFICATIONS_KEY, String(enabled));
}
