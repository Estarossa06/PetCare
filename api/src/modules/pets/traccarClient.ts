export type TraccarConfig = { baseUrl: string; token: string; timeoutMs: number };
export type TraccarPosition = {
  latitude: number;
  longitude: number;
  fixTime: string;
  accuracy: number | null;
};

export class TraccarUnavailableError extends Error {
  constructor() {
    super("Traccar is unavailable or returned an invalid response.");
    this.name = "TraccarUnavailableError";
  }
}

export class TraccarDeviceOwnershipError extends Error {
  constructor() {
    super("The configured Traccar device is not assigned to this PetCare account.");
    this.name = "TraccarDeviceOwnershipError";
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function loadTraccarConfig(env: NodeJS.ProcessEnv = process.env): TraccarConfig | null {
  const rawUrl = env.TRACCAR_URL?.trim() ?? "";
  const token = env.TRACCAR_TOKEN?.trim() ?? "";
  if (!rawUrl && !token) return null;
  if (!rawUrl || !token) throw new Error("TRACCAR_URL and TRACCAR_TOKEN must be configured together.");

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("TRACCAR_URL must be a valid HTTP(S) URL.");
  }
  const localDevelopmentHttp = env.NODE_ENV !== "production" && url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
  if ((url.protocol !== "https:" && !localDevelopmentHttp) || url.username || url.password || url.search || url.hash) {
    throw new Error("TRACCAR_URL must use HTTPS, except for a loopback development server, and must not contain credentials or query parameters.");
  }
  if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
  return { baseUrl: url.origin + (url.pathname === "/" ? "" : url.pathname), token, timeoutMs: 9_000 };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class TraccarClient {
  constructor(
    private readonly config: TraccarConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async assertDeviceOwnedBy(deviceId: number, ownerId: string): Promise<void> {
    const device = await this.getJson(`/api/devices/${deviceId}`);
    if (!isRecord(device) || device.id !== deviceId || !isRecord(device.attributes) || device.attributes.petcareOwnerId !== ownerId) {
      throw new TraccarDeviceOwnershipError();
    }
  }

  async getLatestPosition(deviceId: number, ownerId: string): Promise<TraccarPosition | null> {
    await this.assertDeviceOwnedBy(deviceId, ownerId);
    const positions = await this.getJson(`/api/positions?deviceId=${deviceId}`);
    if (!Array.isArray(positions)) throw new TraccarUnavailableError();
    if (positions.length === 0) return null;

    const position = positions[0];
    if (!isRecord(position) || position.deviceId !== deviceId) throw new TraccarUnavailableError();
    const latitude = Number(position.latitude);
    const longitude = Number(position.longitude);
    const fixTime = typeof position.fixTime === "string" ? position.fixTime : "";
    const accuracy = position.accuracy == null ? null : Number(position.accuracy);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(Date.parse(fixTime)) || (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0))) {
      throw new TraccarUnavailableError();
    }
    return { latitude, longitude, fixTime, accuracy };
  }

  private async getJson(path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetcher(`${this.config.baseUrl}${path}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${this.config.token}`, Accept: "application/json" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) throw new TraccarUnavailableError();
      return await response.json() as unknown;
    } catch {
      throw new TraccarUnavailableError();
    } finally {
      clearTimeout(timeout);
    }
  }
}
