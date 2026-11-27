# Social sign-in readiness

PetCare currently implements email and password authentication only. The API
creates users and sessions in PostgreSQL, and the mobile client stores native
tokens with Expo SecureStore (browser sessions use `sessionStorage`). There are
no Google or Meta authentication routes, provider identity columns, provider
SDKs, or OAuth client IDs configured in this repository.

## Google

Before implementation, configure an OAuth consent screen and OAuth client IDs
for the supported platforms in Google Cloud. Supply the Android application ID
and signing certificate fingerprints, the iOS bundle ID, and the redirect URI /
scheme used by the installed Expo app. The server must validate Google's ID
token signature, issuer, audience, expiry, and stable `sub` claim before
creating or linking a PetCare account. Do not link accounts based only on an
email address unless the provider's verified-email claim is checked under an
explicit account-linking policy. Keep any confidential client secret on the
server.

## Facebook Login

Before implementation, create/configure the Meta app, enable Facebook Login,
provide the App ID and client token, configure valid OAuth redirect URIs and
Android/iOS identifiers, signing hashes, and test/publishing access. The app
secret must remain server-side. The backend must validate the received access
token against the configured Meta app (for example using Meta's token debugging
endpoint) and bind the provider's stable user ID, not trust a client-supplied
profile. App review and tester availability may be required before general
availability.

## Implementation gate

No credentials or provider console configuration were present during this
change. Social login was therefore not exposed in the UI and no unverifiable
OAuth token is accepted by the API. Once configuration is supplied, add a
provider identity table with a unique `(provider, subject)` key, transactional
account/session creation, server-side token verification, and tests for invalid
tokens, issuer/audience mismatch, replay/expiry, account linking policy, and
cross-user data isolation.

References: [Expo authentication guide](https://docs.expo.dev/guides/authentication/),
[Expo AuthSession](https://docs.expo.dev/versions/latest/sdk/auth-session/),
[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect),
[Meta token debugging](https://developers.facebook.com/docs/graph-api/reference/debug_token/).
