export type DiagnosticScreenName = "dashboard" | "profile" | "pets" | "calendar" | "kirai" | "root";
type ComponentName =
  | "care_dashboard"
  | "dashboard_agenda"
  | "profile_menu"
  | "pet_list"
  | "calendar_view"
  | "kirai_chat"
  | "route_boundary"
  | "api_client";
type RenderBranch = "loading" | "error" | "data" | "empty" | "unauthenticated" | "ready";
type DiagnosticState = {
  loading?: boolean;
  authenticated?: boolean;
  busy?: boolean;
  errorPresent?: boolean;
  dataCount?: number;
  secondaryCount?: number;
  selectedCount?: number;
  filtersCount?: number;
  renderBranch?: RenderBranch;
  availability?: "checking" | "available" | "unavailable";
};

const enabled = process.env.EXPO_PUBLIC_RENDER_DIAGNOSTICS === "true";

function emit(record: Record<string, string | number | boolean>) {
  if (!enabled) return;
  console.info(`[PetCareDiag] ${JSON.stringify({ at: Date.now(), ...record })}`);
}

function safeErrorMetadata(error: unknown): Record<string, number | string> {
  const errorType = error instanceof TypeError
    ? "TypeError"
    : error instanceof SyntaxError
      ? "SyntaxError"
      : error instanceof RangeError
        ? "RangeError"
        : error instanceof Error
          ? "Error"
          : "NonError";
  const status = typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: unknown }).status
    : undefined;

  return {
    errorType,
    ...(typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599
      ? { httpStatus: status }
      : {}),
  };
}

function safeState(state: DiagnosticState): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  const booleans = ["loading", "authenticated", "busy", "errorPresent"] as const;
  const counts = ["dataCount", "secondaryCount", "selectedCount", "filtersCount"] as const;

  for (const key of booleans) {
    if (typeof state[key] === "boolean") result[key] = state[key];
  }
  for (const key of counts) {
    const value = state[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) result[key] = value;
  }
  if (["loading", "error", "data", "empty", "unauthenticated", "ready"].includes(state.renderBranch ?? "")) {
    result.renderBranch = state.renderBranch!;
  }
  if (["checking", "available", "unavailable"].includes(state.availability ?? "")) {
    result.availability = state.availability!;
  }
  return result;
}

export function reportScreenOpened(screen: DiagnosticScreenName) {
  emit({ event: "screen_open", screen });
}

export function reportRuntimeInfo(platform: string, development: boolean) {
  emit({ event: "runtime_info", platform, development });
}

export function reportThemeMode(mode: "light" | "dark") {
  emit({ event: "theme_mode", mode });
}

export function reportComponentState(screen: DiagnosticScreenName, component: ComponentName, state: DiagnosticState) {
  emit({ event: "component_state", screen, component, ...safeState(state) });
}

export function reportClientError(screen: DiagnosticScreenName, component: ComponentName, error: unknown) {
  emit({ event: "client_error", screen, component, ...safeErrorMetadata(error) });
}

export function reportRenderError(screen: DiagnosticScreenName, error: unknown) {
  emit({ event: "render_error", screen, component: "route_boundary", ...safeErrorMetadata(error) });
}
