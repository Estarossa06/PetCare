import { Router } from "express";
import type { RequestHandler } from "express";
import type { Logger } from "../../observability/logger.js";
import { createAuthenticateMiddleware } from "./middleware/authenticate.js";
import { GoogleAccountPasswordUnavailableError, GoogleIdentityConflictError, InvalidCredentialsError, InvalidRequestError } from "./errors.js";
import { GoogleOAuthFlow, type GoogleOAuthConfig } from "./googleOAuth.js";
import type { AuthService } from "./service.js";
import type { AuthStore } from "./types.js";
import type { AccountRecoveryEmailSender } from "./recoveryEmail.js";

export function createGoogleOAuthRouter(
  store: AuthStore,
  service: AuthService,
  secret: Uint8Array,
  logger: Logger,
  limit: RequestHandler,
  config?: GoogleOAuthConfig,
  recoveryEmailSender?: AccountRecoveryEmailSender,
): Router {
  const secureCookie = config ? new URL(config.redirectUri).protocol === "https:" : true;
  const cookieOptions = { httpOnly: true, secure: secureCookie, sameSite: "lax" as const, path: "/auth/google/callback" };
  const router = Router();
  const authenticate = createAuthenticateMiddleware(store, secret);
  const flow = config ? new GoogleOAuthFlow(store, service, config, logger, undefined, { emailSender: recoveryEmailSender, codeSecret: secret }) : undefined;

  router.get("/google", limit, async (_request, response, next) => {
    if (!flow) {
      response.status(503).json({ error: { code: "GOOGLE_SIGN_IN_UNAVAILABLE", message: "Google sign-in is not configured." } });
      return;
    }
    try {
      response.setHeader("Cache-Control", "no-store");
      const authorization = await flow.startLogin();
      response.cookie(cookieNameForState(authorization.state), authorization.state, { ...cookieOptions, maxAge: 5 * 60_000 });
      response.redirect(302, authorization.url);
    } catch (error) { next(error); }
  });

  router.get("/google/link/continue", limit, async (request, response, next) => {
    if (!flow) {
      response.status(503).json({ error: { code: "GOOGLE_SIGN_IN_UNAVAILABLE", message: "Google sign-in is not configured." } });
      return;
    }
    try {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      const authorization = await flow.startLinkFromIntent(request.query.intent);
      response.cookie(cookieNameForState(authorization.state), authorization.state, { ...cookieOptions, maxAge: 5 * 60_000 });
      response.redirect(302, authorization.url);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({ error: { code: "INVALID_GOOGLE_LINK_INTENT", message: "Google account linking could not be started." } });
      } else next(error);
    }
  });

  router.get("/google/callback", limit, async (request, response, next) => {
    if (!flow) {
      response.status(503).json({ error: { code: "GOOGLE_SIGN_IN_UNAVAILABLE", message: "Google sign-in is not configured." } });
      return;
    }
    try {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Referrer-Policy", "no-referrer");
      const cookieName = cookieNameForState(request.query.state);
      const stateCookie = cookieName ? readCookie(request.headers.cookie, cookieName) : undefined;
      if (cookieName) response.clearCookie(cookieName, cookieOptions);
      const value = (input: unknown) => typeof input === "string" ? input : undefined;
      const destination = await flow.callback({
        code: value(request.query.code),
        state: value(request.query.state),
        stateCookie,
        providerError: value(request.query.error),
        requestId: String(response.getHeader("X-Request-Id") ?? ""),
      });
      response.redirect(303, destination);
    } catch (error) { next(error); }
  });

  router.post("/google/exchange", limit, async (request, response, next) => {
    try {
      const tokens = await service.exchangeGoogleHandoff(request.body?.code);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(tokens);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({ error: { code: "INVALID_GOOGLE_HANDOFF", message: "Google sign-in could not be completed." } });
      } else next(error);
    }
  });

  router.post("/google/recovery/complete", limit, async (request, response, next) => {
    try {
      const tokens = await service.completeGoogleAccountRecovery({
        flowCode: request.body?.recoveryCode,
        emailCode: request.body?.emailCode,
        credentialChoice: request.body?.credentialChoice,
        newPassword: request.body?.newPassword,
      });
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(tokens);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({ error: { code: "INVALID_GOOGLE_ACCOUNT_RECOVERY", message: "El código no es válido, caducó o ya fue utilizado. Inicia Google de nuevo para solicitar otro." } });
      } else if (error instanceof GoogleIdentityConflictError) {
        response.status(409).json({ error: { code: "GOOGLE_IDENTITY_CONFLICT", message: "Esta identidad de Google ya está vinculada a otra cuenta." } });
      } else if (error instanceof InvalidRequestError) {
        response.status(400).json({ error: { code: error.code, message: error.message } });
      } else next(error);
    }
  });

  router.post("/google/link/complete", limit, async (request, response, next) => {
    try {
      const tokens = await service.completeGoogleAccountLink({
        linkCode: request.body?.linkCode,
        currentPassword: request.body?.currentPassword,
      });
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json(tokens);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({ error: { code: "INVALID_GOOGLE_ACCOUNT_LINK", message: "La contraseña es incorrecta o el enlace caducó. Inicia Google de nuevo e inténtalo otra vez." } });
      } else if (error instanceof GoogleIdentityConflictError) {
        response.status(409).json({ error: { code: "GOOGLE_IDENTITY_CONFLICT", message: "Esta identidad de Google ya está vinculada a otra cuenta." } });
      } else if (error instanceof GoogleAccountPasswordUnavailableError) {
        response.status(409).json({ error: { code: "GOOGLE_ACCOUNT_PASSWORD_UNAVAILABLE", message: "Esta cuenta no puede verificarse con contraseña. Inicia sesión con el método que ya utilizas o usa la recuperación por correo si está habilitada." } });
      } else if (error instanceof InvalidRequestError) {
        response.status(400).json({ error: { code: error.code, message: error.message } });
      } else next(error);
    }
  });

  router.post("/google/link/start", authenticate, limit, async (request, response, next) => {
    if (!flow) {
      response.status(503).json({ error: { code: "GOOGLE_SIGN_IN_UNAVAILABLE", message: "Google sign-in is not configured." } });
      return;
    }
    try {
      const continuationUrl = await flow.startLink(request.principal!);
      response.setHeader("Cache-Control", "no-store");
      response.status(200).json({ continuationUrl });
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "La sesión PetCare no está activa. Inicia sesión de nuevo." } });
      } else if (error instanceof InvalidRequestError) {
        response.status(400).json({ error: { code: error.code, message: error.message } });
      } else next(error);
    }
  });

  return router;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const matches = header.split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (matches.length !== 1) return undefined;
  const value = matches[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{32,256}$/.test(value) ? value : undefined;
}

function cookieNameForState(state: unknown): string {
  const safeState = typeof state === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(state) ? state : "invalid";
  return `petcare_google_oauth_${safeState.slice(0, 16)}`;
}
