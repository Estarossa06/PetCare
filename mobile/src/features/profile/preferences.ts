import * as SecureStore from "expo-secure-store";

const NOTIFICATIONS_KEY = "petcare.preferences.notifications";

export async function getNotificationsEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(NOTIFICATIONS_KEY)) !== "false";
  } catch {
    return true;
  }
}

export async function setNotificationsEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(NOTIFICATIONS_KEY, String(enabled));
}
