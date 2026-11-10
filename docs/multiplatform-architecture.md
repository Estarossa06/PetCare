# PetCare multiplatform Expo architecture

## One application, one shared codebase

PetCare is one React Native + Expo + TypeScript application targeting Android, iOS and Web. `mobile/` is the single Expo project, not a mobile app plus a separate web app. Expo Router owns the one file-based route tree in `mobile/app/`; shared route components, features, state, validation, repositories and API clients live in `mobile/src/`. Responsive layouts adapt within those shared components.

Platform-specific code is isolated behind adapters or Expo's platform file resolution (`.native.ts`, `.web.ts`, `.ios.ts`, `.android.ts`). A platform file may implement a capability differently, but it must satisfy the same typed application interface. Shared screens and domain rules must not fork by platform. Business rules remain platform-neutral.

### Current scaffold and persistence layout

These are the files currently present; the routing and persistence scaffolding is implemented in this one Expo project.

```text
mobile/
├── app/
│   ├── _layout.tsx
│   └── index.tsx
├── src/
│   ├── db/
│   │   ├── migrations/
│   │   │   ├── 0001_initial.ts
│   │   │   ├── index.ts
│   │   │   └── types.ts
│   │   ├── migrate.ts
│   │   └── verify.ts
│   └── screens/
│       └── DatabaseVerificationScreen.tsx
├── app.json
├── metro.config.js
├── package.json
└── tsconfig.json

api/
└── src/db/
    ├── migrations/
    │   ├── 0001_core.ts
    │   ├── 0002_sync_support.ts
    │   ├── 0003_ordered_sync_cursors.ts
    │   ├── index.ts
    │   └── types.ts
    ├── migrate.ts
    ├── verify.ts
    └── verify-cursor.ts

docs/
├── data-model.md
├── database-setup.md
├── multiplatform-architecture.md
├── persistence-phase-2.md
└── persistence-verification.md
```

### Target shared-code organization

```text
mobile/
├── app/                         # Single Expo Router route tree for Android/iOS/Web
│   ├── _layout.tsx
│   └── index.tsx                # Temporary persistence-verification route
├── src/
│   ├── screens/                 # Shared screen components (not route files)
│   │   └── DatabaseVerificationScreen.tsx
│   ├── features/                # Shared domain UI and feature logic
│   ├── components/              # Shared responsive UI components
│   ├── db/                      # Shared schema, migrations and repositories
│   ├── platform/                # Small platform capability adapters
│   │   ├── secure-storage.ts    # Common interface
│   │   ├── secure-storage.native.ts
│   │   ├── secure-storage.web.ts
│   │   ├── notifications.ts
│   │   ├── notifications.native.ts
│   │   └── notifications.web.ts
│   ├── services/                # Shared API contracts/client
│   ├── state/
│   ├── types/
│   └── utils/
├── app.json                     # Shared Expo configuration and web headers
├── metro.config.js              # Shared Metro config incl. wasm assets
└── package.json
```

The second tree is the planned location for shared features and platform adapters as those capabilities are authorized; those feature and adapter modules are not implemented yet. The only current route is the temporary SQLite verification route. No additional web app or duplicate route tree is planned.

## Capability differences

| Capability | Android / iOS | Web | Architecture rule |
|---|---|---|---|
| Local SQLite | `expo-sqlite` native SQLite database in the app sandbox and available in the SDK-matched Expo Go client. | The same `expo-sqlite` API backed by WebAssembly/browser storage; requires Metro wasm support and cross-origin isolation headers (`COOP: same-origin`, `COEP: credentialless`) for `SharedArrayBuffer`. Expo SQLite Web does not enable every native compile option by default. | Keep repositories and migrations shared. Configure/build the web storage adapter at the platform boundary; treat browser data as origin-scoped and potentially clearable, not as durable backup. |
| Medical file attachments | Expo DocumentPicker selects supported images and documents; `expo-file-system` copies them into the app's document directory. SQLite stores only metadata and a storage key. | The same picker API selects files; `expo-file-system` is not used for browser persistence. File blobs are stored in IndexedDB and SQLite stores only the metadata and storage key. | Keep the medical feature shared behind one file-storage adapter. Files are local-only; this is not remote backup or encrypted storage. |
| Database encryption | SQLCipher can be built into Expo SQLite for a custom native build when configured; it is not enabled in Expo Go. | Expo SQLite's web/WASM build does not thereby inherit SQLCipher encryption. Do not claim parity; decide a browser encryption design and threat model separately before storing health data there. | Keep database APIs shared, isolate key providers, and do not silently downgrade encryption. Block or clearly limit sensitive offline storage on unsupported platforms until a strategy is approved. |
| Secure key/value storage | `expo-secure-store` uses native Keychain/Keystore-backed storage. Persistence/backup behavior differs by OS. | `expo-secure-store` does not support Web. A browser implementation would need a separate WebCrypto/IndexedDB adapter and cannot be described as equivalent to device Keychain/Keystore. | Depend on a typed secure-storage interface. Platform implementation must report unsupported/error states; never fall back silently to plaintext localStorage. |
| Local notifications | Expo notifications use OS permission/channel/scheduling APIs. iOS and Android differ in permissions, channels, reboot behavior and scheduling limits. APIs requiring native code not bundled in Expo Go require a Development Build. | `expo-notifications` is not a Web notifications implementation. Browser Notification/Push APIs require permission, secure origin and browser-specific lifecycle/service-worker behavior; background scheduling is not equivalent to mobile OS local scheduling. | One reminders feature calls a notification adapter. Store OS/browser schedule IDs locally; share reminder domain data, not platform notification records. |
| Networking and API | HTTPS API client with platform networking. | Same typed API client, with browser CORS, cookies/headers and origin policy configured at deployment. | One contract/client; no web-only API or duplicated business services. |

Web builds must be served from a secure origin. For SQLite Web hosting, the hosting server must return the cross-origin isolation headers. The Expo Router plugin in `app.json` configures those headers for compatible Expo Hosting deployments; other hosts need equivalent response-header configuration. The browser database remains scoped to the site origin and browser profile.

## SQLite verification scaffold

The SQLite verification harness is a route in this same Expo Router project. It calls the same migrations and verification assertions on native and Web; no separate web project or schema copy exists. The ordinary Android/iOS workflow uses the SDK-matched Expo Go app; the current SDK includes `expo-sqlite` in Expo Go. A Development Build is only needed if a future feature adds native code or custom native configuration not present in Expo Go (SQLCipher is one such case). `npx expo export --platform web` validates the shared web bundle, but browser SQLite runtime validation still requires serving the site with the required headers and running it in a browser.

The harness database is named `petcare-verification.db` and must contain no user data. It is not a production database bootstrap.

## Expo Go development workflow

`expo start --go` is the default development server mode. The `android` and `ios` package scripts also start Expo Go and request launch on an Android device/emulator or iOS simulator; they do not compile native projects. A physical iPhone can open the QR code from Expo Go while the server runs on Windows; the iOS simulator launch shortcut requires macOS/Xcode. Expo Go and the project must target the same Expo SDK. The Expo SDK 58 dependencies, including `expo-router` and `expo-sqlite`, are version-aligned and can be checked with `npx expo install --check`.

The `expo-dev-client` dependency, its config plugin, the no-option `expo-sqlite` config plugin, and the EAS-only Development Build profile were removed from the ordinary workflow. The SQLite config plugin only changes generated native build properties when options such as SQLCipher/FTS are set; with no options it did not contribute to Expo Go operation. The Expo Router plugin and its Web COOP/COEP headers remain configured. No native platform folders or duplicate app were introduced.

Run `npm start` in `mobile/`, scan the QR code using Expo Go on a physical Android or iOS device on the same network, then run the shared database verification route. `npm run android` or `npm run ios` starts the same Go workflow with a platform launch request; those commands require a connected Android device/emulator or an iOS simulator. Use `npm run web` for Web. Platform runtime validation is reported separately from dependency/configuration and bundle checks.

## Documentation sources

- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) — native/web support, wasm and COOP/COEP setup, native SQLCipher config.
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) — platform support and native key storage.
- [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/) — native platform coverage and build constraints.
- [Expo Router](https://docs.expo.dev/router/introduction/) — one file-based routing system across Expo platforms.
