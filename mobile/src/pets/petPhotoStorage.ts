import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

export type PetPhotoStorage = {
  savePickedPhoto(sourceUri: string, storageKey: string): Promise<void>;
  getPhotoUri(storageKey: string): Promise<string | null>;
  deletePhoto(storageKey: string): Promise<void>;
};

const databaseName = "petcare-pet-photos";
const objectStoreName = "photos";
const objectUrls = new Map<string, string>();

function getStoredFile(storageKey: string): File {
  const [directory, filename] = storageKey.split("/");
  if (directory !== "pet-photos" || !filename || filename.includes("..")) {
    throw new Error("Invalid pet photo storage key.");
  }
  return new File(new Directory(Paths.document, directory), filename);
}

function openPhotoDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Persistent photo storage is unavailable in this browser."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(objectStoreName)) {
        request.result.createObjectStore(objectStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open browser photo storage."));
  });
}

function storeBlob(storageKey: string, blob: Blob): Promise<void> {
  return openPhotoDatabase().then(async (database) => {
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(objectStoreName, "readwrite");
        transaction.objectStore(objectStoreName).put(blob, storageKey);
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the selected photo."));
        transaction.onabort = () => reject(transaction.error ?? new Error("Saving the selected photo was cancelled."));
        transaction.oncomplete = () => resolve();
      });
    } finally {
      database.close();
    }
  });
}

async function loadBlob(storageKey: string): Promise<Blob | null> {
  const database = await openPhotoDatabase();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const transaction = database.transaction(objectStoreName, "readonly");
      const request = transaction.objectStore(objectStoreName).get(storageKey) as IDBRequest<Blob | undefined>;
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error ?? new Error("Could not read the saved photo."));
    });
  } finally {
    database.close();
  }
}

export const petPhotoStorage: PetPhotoStorage = {
  async savePickedPhoto(sourceUri, storageKey) {
    if (Platform.OS === "web") {
      const response = await fetch(sourceUri);
      if (!response.ok) throw new Error("Could not read the selected photo.");
      await storeBlob(storageKey, await response.blob());
      return;
    }

    const source = new File(sourceUri);
    if (!source.exists) throw new Error("The selected photo is no longer available.");
    const destination = getStoredFile(storageKey);
    destination.parentDirectory.create({ idempotent: true, intermediates: true });
    await source.copy(destination);
  },

  async getPhotoUri(storageKey) {
    if (Platform.OS !== "web") {
      const file = getStoredFile(storageKey);
      return file.exists ? file.uri : null;
    }

    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await loadBlob(storageKey);
    if (!blob) return null;
    const uri = URL.createObjectURL(blob);
    objectUrls.set(storageKey, uri);
    return uri;
  },

  async deletePhoto(storageKey) {
    if (Platform.OS !== "web") {
      const file = getStoredFile(storageKey);
      if (file.exists) file.delete();
      return;
    }

    const database = await openPhotoDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(objectStoreName, "readwrite");
        transaction.objectStore(objectStoreName).delete(storageKey);
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the saved photo."));
        transaction.oncomplete = () => resolve();
      });
    } finally {
      database.close();
    }
    const objectUrl = objectUrls.get(storageKey);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(storageKey);
    }
  },
};
