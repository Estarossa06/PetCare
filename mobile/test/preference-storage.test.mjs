import assert from "node:assert/strict";
import test from "node:test";

const { createPreferenceStorage } = await import("../src/platform/preferenceStorageCore.ts");

function memoryStore() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("web preferences survive recreating the adapter with the same browser store", async () => {
  const browser = memoryStore();
  const noSecureStore = {
    getItemAsync: async () => { throw new Error("Web must not use SecureStore."); },
    setItemAsync: async () => { throw new Error("Web must not use SecureStore."); },
    deleteItemAsync: async () => { throw new Error("Web must not use SecureStore."); },
  };
  await createPreferenceStorage("web", noSecureStore, () => browser).setItem("petcare.theme.mode", "dark");
  const afterReload = createPreferenceStorage("web", noSecureStore, () => browser);
  assert.equal(await afterReload.getItem("petcare.theme.mode"), "dark");
  await afterReload.removeItem("petcare.theme.mode");
  assert.equal(await afterReload.getItem("petcare.theme.mode"), null);
});

test("native preferences keep using the same SecureStore keys", async () => {
  const calls = [];
  const secureStore = {
    getItemAsync: async (key) => { calls.push(["get", key]); return "dark"; },
    setItemAsync: async (key, value) => { calls.push(["set", key, value]); },
    deleteItemAsync: async (key) => { calls.push(["remove", key]); },
  };
  const storage = createPreferenceStorage("native", secureStore, () => { throw new Error("Unexpected browser storage"); });
  assert.equal(await storage.getItem("petcare.theme.mode"), "dark");
  await storage.setItem("petcare.theme.mode", "light");
  await storage.removeItem("petcare.theme.mode");
  assert.deepEqual(calls, [["get", "petcare.theme.mode"], ["set", "petcare.theme.mode", "light"], ["remove", "petcare.theme.mode"]]);
});

test("browser storage errors are returned generically without leaking details", async () => {
  const storage = createPreferenceStorage("web", {}, () => { throw new Error("private browser details"); });
  await assert.rejects(storage.getItem("key"), (error) => error.message === "Browser preference storage is unavailable.");
  await assert.rejects(storage.setItem("key", "value"), (error) => error.message === "Browser preference storage is unavailable.");
});
