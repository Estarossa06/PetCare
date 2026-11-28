import type { ThemeMode } from "./palette";

export type { ThemeMode } from "./palette";

export async function applyAndPersistThemeMode(
  mode: ThemeMode,
  actions: {
    apply(mode: ThemeMode): void;
    update(mode: ThemeMode): void;
    persist(mode: ThemeMode): Promise<void>;
  },
): Promise<void> {
  actions.apply(mode);
  actions.update(mode);
  await actions.persist(mode);
}
