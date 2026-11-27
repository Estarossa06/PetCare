export interface SecurePreferenceStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface BrowserPreferenceStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createPreferenceStorage(
  platform: "web" | "native",
  secureStore: SecurePreferenceStore,
  getBrowserStore: () => BrowserPreferenceStore,
): PreferenceStorage {
  if (platform === "native") {
    return {
      getItem: (key) => secureStore.getItemAsync(key),
      setItem: (key, value) => secureStore.setItemAsync(key, value),
      removeItem: (key) => secureStore.deleteItemAsync(key),
    };
  }

  return {
    async getItem(key) {
      try {
        return getBrowserStore().getItem(key);
      } catch {
        throw new Error("Browser preference storage is unavailable.");
      }
    },
    async setItem(key, value) {
      try {
        getBrowserStore().setItem(key, value);
      } catch {
        throw new Error("Browser preference storage is unavailable.");
      }
    },
    async removeItem(key) {
      try {
        getBrowserStore().removeItem(key);
      } catch {
        throw new Error("Browser preference storage is unavailable.");
      }
    },
  };
}
