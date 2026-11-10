import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "petcare.auth.tokens.v1";

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
}

function isAuthTokens(value: unknown): value is AuthTokens {
  if (typeof value !== "object" || value === null) return false;
  return (
    "accessToken" in value &&
    typeof value.accessToken === "string" &&
    "accessTokenExpiresAt" in value &&
    typeof value.accessTokenExpiresAt === "string" &&
    "refreshToken" in value &&
    typeof value.refreshToken === "string"
  );
}

function browserSessionStorage(): Storage {
  if (typeof globalThis.sessionStorage === "undefined") {
    throw new Error("Session storage is unavailable in this browser.");
  }
  return globalThis.sessionStorage;
}

export const tokenStorage = {
  async read(): Promise<AuthTokens | null> {
    const stored =
      Platform.OS === "web"
        ? browserSessionStorage().getItem(STORAGE_KEY)
        : await SecureStore.getItemAsync(STORAGE_KEY);
    if (stored === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(stored);
    } catch {
      throw new Error("Stored authentication data is invalid.");
    }
    if (!isAuthTokens(parsed)) {
      throw new Error("Stored authentication data is invalid.");
    }
    return parsed;
  },

  async write(tokens: AuthTokens): Promise<void> {
    const serialized = JSON.stringify(tokens);
    if (Platform.OS === "web") {
      browserSessionStorage().setItem(STORAGE_KEY, serialized);
      return;
    }
    await SecureStore.setItemAsync(STORAGE_KEY, serialized);
  },

  async clear(): Promise<void> {
    if (Platform.OS === "web") {
      browserSessionStorage().removeItem(STORAGE_KEY);
      return;
    }
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  },
};
