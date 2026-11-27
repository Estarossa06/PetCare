import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { createPreferenceStorage } from "./preferenceStorageCore";

function getBrowserStore(): Storage {
  if (typeof globalThis.localStorage === "undefined") {
    throw new Error("Browser preference storage is unavailable.");
  }
  return globalThis.localStorage;
}

export const preferenceStorage = createPreferenceStorage(
  Platform.OS === "web" ? "web" : "native",
  SecureStore,
  getBrowserStore,
);
