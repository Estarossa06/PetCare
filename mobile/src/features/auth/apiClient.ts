import { tokenStorage, type AuthTokens } from "./tokenStorage";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

interface TokenResponse extends AuthTokens {
  user: AuthUser;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
  retryAfterRefresh?: boolean;
};

function apiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL?.trim();
  if (!configured) {
    throw new Error("Configure EXPO_PUBLIC_API_URL to connect to the PetCare API.");
  }
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("EXPO_PUBLIC_API_URL must be a valid HTTP(S) URL.");
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password
  ) {
    throw new Error("EXPO_PUBLIC_API_URL must be a valid HTTP(S) URL.");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export class ApiClient {
  private refreshInFlight: Promise<TokenResponse> | undefined;

  constructor(
    private readonly baseUrl: () => string = apiBaseUrl,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async register(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<AuthUser> {
    return this.authenticate("/auth/register", input);
  }

  async login(input: {
    email: string;
    password: string;
  }): Promise<AuthUser> {
    return this.authenticate("/auth/login", input);
  }

  async restoreSession(): Promise<AuthUser | null> {
    const stored = await tokenStorage.read();
    if (!stored) return null;
    const response = await this.refreshTokens();
    return response.user;
  }

  async logout(): Promise<void> {
    try {
      await this.request("/auth/logout", { method: "POST", body: {}, authenticated: true });
    } finally {
      await tokenStorage.clear();
    }
  }

  private async authenticate(
    path: string,
    body: Record<string, string>,
  ): Promise<AuthUser> {
    const result = await this.request<TokenResponse>(path, {
      method: "POST",
      body,
      retryAfterRefresh: false,
    });
    await tokenStorage.write(result);
    return result.user;
  }

  async request<T>(
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await this.send(path, options);
    if (
      response.status === 401 &&
      options.authenticated &&
      options.retryAfterRefresh !== false &&
      path !== "/auth/refresh"
    ) {
      await this.refreshTokens();
      const retried = await this.send(path, options);
      return this.readResponse<T>(retried);
    }
    return this.readResponse<T>(response);
  }

  private async send(
    path: string,
    options: RequestOptions,
  ): Promise<Response> {
    const headers = new Headers();
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }
    if (options.authenticated) {
      const tokens = await tokenStorage.read();
      if (!tokens) {
        throw new ApiClientError("Authentication is required.", 401, "UNAUTHENTICATED");
      }
      headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    }
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    return this.fetcher(`${this.baseUrl()}${path}`, {
      method: options.method ?? "GET",
      headers,
      ...(body === undefined ? {} : { body }),
    });
  }

  private async refreshTokens(): Promise<TokenResponse> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      const stored = await tokenStorage.read();
      if (!stored) {
        throw new ApiClientError("Authentication is required.", 401, "UNAUTHENTICATED");
      }
      const response = await this.fetcher(`${this.baseUrl()}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: stored.refreshToken }),
      });
      if (!response.ok) {
        const error = await this.createError(response);
        if (response.status === 401) await tokenStorage.clear();
        throw error;
      }
      const result = (await response.json()) as TokenResponse;
      await tokenStorage.write(result);
      return result;
    })().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async readResponse<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    if (!response.ok) throw await this.createError(response);
    return (await response.json()) as T;
  }

  private async createError(response: Response): Promise<ApiClientError> {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = {};
    }
    return new ApiClientError(
      body.error?.message ?? "The request could not be completed.",
      response.status,
      body.error?.code ?? "REQUEST_FAILED",
    );
  }
}

export const apiClient = new ApiClient();
