import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  SignJWT,
  jwtVerify,
} from "jose";
import type { AuthUser, Principal } from "./types.js";

const ISSUER = "petcare-api";
const AUDIENCE = "petcare-mobile";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function signAccessToken(
  user: AuthUser,
  sessionId: string,
  secret: Uint8Array,
  now = new Date(),
): Promise<{ token: string; expiresAt: string }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = new Date((issuedAt + ACCESS_TOKEN_TTL_SECONDS) * 1000);
  const token = await new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .setJti(randomUUID())
    .sign(secret);
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function verifyAccessToken(
  token: string,
  secret: Uint8Array,
  now = new Date(),
): Promise<Principal> {
  const { payload } = await jwtVerify(token, secret, {
    algorithms: ["HS256"],
    issuer: ISSUER,
    audience: AUDIENCE,
    currentDate: now,
  });
  if (
    typeof payload.sub !== "string" ||
    typeof payload.sid !== "string" ||
    typeof payload.jti !== "string" ||
    !UUID_PATTERN.test(payload.sub) ||
    !UUID_PATTERN.test(payload.sid) ||
    !UUID_PATTERN.test(payload.jti)
  ) {
    throw new Error("Access token claims are invalid.");
  }
  return { userId: payload.sub, sessionId: payload.sid };
}

export function createRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function refreshTokenExpiry(now = new Date()): Date {
  return new Date(now.getTime() + REFRESH_TOKEN_TTL_MS);
}
