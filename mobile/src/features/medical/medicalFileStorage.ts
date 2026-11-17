import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

const databaseName = "petcare-medical-files";
const objectStoreName = "files";
const objectUrls = new Map<string, string>();

function getStoredFile(storageKey: string): File {
  const [directory, filename] = storageKey.split("/");
  if (directory !== "medical-files" || !filename || filename.includes("..")) {
    throw new Error("Invalid medical file storage key.");
  }
  return new File(new Directory(Paths.document, directory), filename);
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Persistent medical file storage is unavailable in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(objectStoreName)) {
        request.result.createObjectStore(objectStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open medical file storage."));
  });
}

export const medicalFileStorage = {
  async save(sourceUri: string, storageKey: string): Promise<void> {
    if (Platform.OS === "web") {
      const response = await fetch(sourceUri);
      if (!response.ok) throw new Error("Could not read the selected medical file.");
      const blob = await response.blob();
      const db = await openDatabase();
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction(objectStoreName, "readwrite");
          transaction.objectStore(objectStoreName).put(blob, storageKey);
          transaction.onerror = () => reject(transaction.error ?? new Error("Could not save the selected file."));
          transaction.oncomplete = () => resolve();
        });
      } finally {
        db.close();
      }
      return;
    }

    const source = new File(sourceUri);
    if (!source.exists) throw new Error("The selected file is no longer available.");
    const destination = getStoredFile(storageKey);
    destination.parentDirectory.create({ idempotent: true, intermediates: true });
    await source.copy(destination);
  },

  async getUri(storageKey: string): Promise<string | null> {
    if (Platform.OS !== "web") {
      const file = getStoredFile(storageKey);
      return file.exists ? file.uri : null;
    }
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const db = await openDatabase();
    let blob: Blob | null;
    try {
      blob = await new Promise((resolve, reject) => {
        const transaction = db.transaction(objectStoreName, "readonly");
        const request = transaction.objectStore(objectStoreName).get(storageKey) as IDBRequest<Blob | undefined>;
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error ?? new Error("Could not read the saved file."));
      });
    } finally {
      db.close();
    }
    if (!blob) return null;
    const uri = URL.createObjectURL(blob);
    objectUrls.set(storageKey, uri);
    return uri;
  },

  async delete(storageKey: string): Promise<void> {
    if (Platform.OS !== "web") {
      const file = getStoredFile(storageKey);
      if (file.exists) file.delete();
      return;
    }
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(objectStoreName, "readwrite");
        transaction.objectStore(objectStoreName).delete(storageKey);
        transaction.onerror = () => reject(transaction.error ?? new Error("Could not remove the saved medical file."));
        transaction.oncomplete = () => resolve();
      });
    } finally {
      db.close();
    }
    const objectUrl = objectUrls.get(storageKey);
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrls.delete(storageKey);
    }
  },
};
