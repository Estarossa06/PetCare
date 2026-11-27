# Google Sign-In for PetCare Web (staging)

## Implementation status

The repository now contains an Authorization Code flow with PKCE (S256), random one-use `state` and `nonce`, server-side code exchange, Google ID-token verification, a short-lived one-use handoff, and PetCare access/refresh session issuance through the existing auth service. Google accounts are keyed by Google's immutable `sub`. An email match never silently links an existing PetCare account; the user must first authenticate to that account and explicitly start linking from Profile.

Unit tests use a provider test double and prove application behavior only. They do **not** verify Google credentials, an actual Google redirect, Render CORS, or Neon persistence. A guarded PostgreSQL test is available for the disposable database named `petcare_test`. No Google authentication has been validated against a live Google client.

## Staging configuration (owner action)

Create a Google OAuth **Web application** client. Do not put its client secret in Expo variables or the repository. Configure its exact authorized redirect URI as:

`https://petcare-api-staging-zmu4.onrender.com/auth/google/callback`

Configure the API service on Render with these four variables together:

| Variable | Staging value |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | Client ID issued for the Google Web application |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Secret issued for that client; Render secret field only |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://petcare-api-staging-zmu4.onrender.com/auth/google/callback` |
| `GOOGLE_OAUTH_WEB_RETURN_URL` | `https://petcare-pxcc.onrender.com/oauth/google-callback` |

Set the API's `CORS_ORIGINS` to include the exact web origin `https://petcare-pxcc.onrender.com` (preserve other required staging origins). These settings are not committed in `render.yaml`. Google configuration is optional as a complete group: with none set, the API returns a clear 503 for Google sign-in; partial configuration prevents startup. Non-local redirect and return URLs must use HTTPS and cannot include query strings or fragments.

Before enabling the client, verify the actual Static Site origin in Render and the API's allowed origin list. Shared `onrender.com` hostnames are suitable only for constrained staging tests and may not satisfy Google branding/domain-verification requirements for public launch. Public availability requires an owner-controlled domain, consent-screen setup, Google's applicable verification and policy review, and leaving Testing mode. Until those are complete, do not claim every visitor can authenticate.

## Schema and rollout

Migration `0014_google_oauth` adds nullable `users.password_hash`, provider identity storage, one-use OAuth transaction/link-intent/handoff storage, and expiry indexes. It is append-only and the API does not run it automatically. First back up the **staging** Neon branch and inspect the ledger and schema. Then have the staging owner apply pending migration 14 through the repository's established migration process using only staging `DATABASE_URL`; verify the name/checksum, four created tables, and indexes before enabling Google variables. Stop on any lineage or checksum mismatch. Never point this process at production.

For a disposable PostgreSQL integration run only, set `PETCARE_TEST_DATABASE_URL` to a URL whose database path is exactly `petcare_test` and `PETCARE_RUN_AUTH_DB_TESTS=1`, then run `npm run test:integration:auth` from `api`. The test checks the database name again before writing and cleans fixtures. This does not migrate a database; the test requires migration 14 to have already been applied to that disposable test database.

## Routes and security properties

- `GET /auth/google` starts login; `GET /auth/google/callback` handles Google's code.
- `POST /auth/google/exchange` consumes a random handoff code once and returns normal PetCare tokens.
- Authenticated `POST /auth/google/link/start` requires the existing password, or a recent PetCare authentication for a Google-only account. It returns a 60-second, single-use continuation URL; the Web client navigates to it at the API as a top-level request. `GET /auth/google/link/continue` consumes it, rechecks the active session, sets the OAuth state cookie first-party, and redirects to Google.
- Google JWT signature, issuer, exact audience, authorized presenter when supplied, maximum age, verified email, subject, and nonce are checked server-side. PKCE, state, and nonce values are stored only as hashes except for the short-lived PKCE verifier needed at the callback. OAuth state is also bound to the initiating browser by a short-lived host-only `HttpOnly; Secure; SameSite=Lax` callback cookie. The link continuation ensures this cookie is set by a top-level API navigation, because Render's shared `onrender.com` domain cannot reliably support cross-subdomain cookies.
- Handoff codes expire after one minute and are stored by hash. Refresh/access tokens are never placed in callback URLs. The Web callback removes its handoff query from browser history before exchanging it.
- An existing email match returns an explicit link-required outcome; it is never treated as proof of ownership. Unique database constraints prevent one Google identity from linking to multiple PetCare accounts.

## Validation and release boundary

Automated unit tests and a guarded PostgreSQL integration test cover local logic and persistence. A real staging test still requires owner-configured Google OAuth credentials, the staging API CORS origin, migration 14 applied to Neon staging, and a deployed staging build. Confirm registration/login, account linking, replay rejection, logout, refresh rotation, and account deletion in that staging environment. This work does not publish/deploy anything and does not configure production.
