import assert from "node:assert/strict";
import test from "node:test";

const { applyAndPersistThemeMode } = await import("../src/theme/themeMode.ts");
const { themePalettes } = await import("../src/theme/palette.ts");

test("light and dark palettes define the same semantic colors", () => {
  const lightKeys = Object.keys(themePalettes.light).sort();
  const darkKeys = Object.keys(themePalettes.dark).sort();
  assert.deepEqual(darkKeys, lightKeys);
  for (const palette of [themePalettes.light, themePalettes.dark]) {
    for (const color of Object.values(palette)) assert.match(color, /^#[0-9A-F]{6}$/i);
  }
});

test("theme mode updates the UI before waiting for persistence", async () => {
  const events = [];
  await assert.rejects(
    applyAndPersistThemeMode("dark", {
      apply: (mode) => events.push(`apply:${mode}`),
      update: (mode) => events.push(`update:${mode}`),
      persist: async (mode) => {
        events.push(`persist:${mode}`);
        throw new Error("storage unavailable");
      },
    }),
    /storage unavailable/,
  );
  assert.deepEqual(events, ["apply:dark", "update:dark", "persist:dark"]);
});

test("theme mode applies and persists both light and dark selections", async () => {
  const events = [];
  for (const mode of ["dark", "light"]) {
    await applyAndPersistThemeMode(mode, {
      apply: (value) => events.push(`apply:${value}`),
      update: (value) => events.push(`update:${value}`),
      persist: async (value) => events.push(`persist:${value}`),
    });
  }
  assert.deepEqual(events, [
    "apply:dark", "update:dark", "persist:dark",
    "apply:light", "update:light", "persist:light",
  ]);
});
