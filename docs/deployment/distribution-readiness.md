# Lista de preparación para distribución

Estado al 26 de noviembre de 2026. No se firmó ni publicó ninguna aplicación.

## Android APK/AAB

- [ ] Configurar build profiles reproducibles (EAS o CI Android) y versión/build number.
- [ ] Crear y proteger keystore de release; documentar custodia/rotación y registrar huella en la consola correspondiente.
- [ ] Revisar `com.petcare.mobile`, SDK/target Android y permisos efectivos en el manifest del artefacto.
- [ ] Confirmar textos de permiso cámara/galería, declaración de datos/ubicación y política de privacidad.
- [ ] Validar en dispositivos: autenticación, restauración, cambio de cuenta, archivos, cámara, notificaciones, offline/reinicio/sync.
- [ ] Probar AAB firmado en track interno, crash reporting, API HTTPS, links/deep links y actualización desde versión anterior.

Actualmente `mobile/app.json` declara `com.petcare.mobile` y version `1.0.0`. No hay `eas.json`, keystore de release del propietario, pipeline Android reproducible ni build firmado de release. El proyecto `mobile/android` y el APK debug son locales e ignorados por Git; la variante release de ese Gradle usa la clave debug y no es distribuible.

## iOS fuera de alcance

La primera publicación contempla Android y Web. No se prepara IPA, firma Apple, provisioning ni publicación en App Store; la ausencia de iOS no bloquea el lanzamiento definido.

## Web y posible PWA

- [x] Exportación estática Expo generada localmente en `mobile/dist` (3,127 módulos); es un bundle, no validación de hosting.
- [ ] Definir si la experiencia será web complementaria o una PWA instalable.
- [ ] Si será PWA: crear manifest, iconos, service worker/versionado, actualización segura y estrategia explícita de offline shell/asset cache; probar instalación y rollback.
- [ ] Configurar HTTPS, headers COOP/COEP requeridos por SQLite/WASM, SPA fallback, CSP, cache-control y CORS API de origen exacto.
- [ ] Evaluar cuota/evicción IndexedDB y recuperación de SQLite/archivos; probar navegadores objetivo y modo privado.
- [ ] Revisar `sessionStorage`: la sesión del cliente Web es por pestaña/sesión, no equivale al SecureStore nativo.

No se encontró manifest instalable ni service worker de PetCare. Expo Web export incluye SQLite Web con almacenamiento IndexedDB y WASM. El proyecto no mide cuotas ni implementa recuperación/exportación ante eviction o borrado del almacenamiento del navegador; es requisito pendiente de validación por navegador. HTTPS es requisito de hosting seguro y los headers COOP/COEP deben permitir SQLite/WASM según el despliegue.

## Backend, secretos y monitorización

- [ ] Separar URL/roles PostgreSQL, JWT secret, R2 keys, Ollama, Traccar y CORS en secretos independientes por entorno.
- [ ] Confirmar base/ledger y backup antes de migraciones aprobadas; nunca ejecutar suites de fixtures en producción.
- [ ] HTTPS con TLS válido, límites de red, rate limits y CORS explícito.
- [ ] Confirmar bucket R2 privado en consola y token de alcance mínimo; probar políticas de eliminación y lifecycle.
- [ ] Proteger Ollama en red privada; medir RAM/VRAM, latencia y capacidad de concurrencia.
- [ ] Provisionar cada dispositivo Traccar con atributo `petcareOwnerId` administrado y cuenta con acceso limitado.
- [ ] Monitorizar API 4xx/5xx, latencia y request IDs; DB pool/errores; cola de borrados R2; disponibilidad Ollama/Traccar sin registrar contenido sensible.
- [ ] Preparar política de privacidad, retención/eliminación de cuenta, soporte, backup/restore y respuesta a incidentes.

## Validación y evidencia

- [ ] Correr typechecks, suite API/móvil, npm audit y builds desde lockfiles de release.
- [ ] Ejecutar [piloto offline de dos instalaciones](../testing/offline-first-two-installations.md).
- [ ] Ejecutar la validación física Android con el [checklist de dispositivo](../testing/mobile-physical-validation.md), aplicando solo los casos Android.
- [ ] Conservar SBOM npm y modelos, Third Party Notices y versión/hash del artefacto.
- [ ] Registrar qué se probó automáticamente, contra servicio real y físicamente; no trasladar evidencia de una categoría a otra.

## Revision release local - 25 nov 2026

- Git esta en `main`, HEAD `c941261061a28bc27bafaf194448bc75548569f1`, alineado con `origin/main`. El arbol conserva 83 rutas locales visibles por Git de las ejecuciones; ninguna se descarto, reemplazo ni preparo para commit. No hay merge/rebase activo ni cambios staged. `git diff --check` esta limpio.
- No hay archivos `.env`, llaves de firma, bases, logs o credenciales rastreados. `.env`, `api/.env` y `mobile/.env.local` estan ignorados. No se encontraron referencias a secretos backend en el cliente ni coincidencias de patrones conocidos en archivos rastreados; esto no es un escaneo especializado.
- Config Expo declara nombre `PetCare`, version `1.0.0` e ID Android `com.petcare.mobile`. No hay `eas.json`. El Gradle nativo local contiene versionCode `1`/versionName `1.0.0` y target SDK `36`.
- Existe `mobile/android`, un proyecto nativo generado e ignorado por Git. Este host tiene Android SDK/build-tools/ADB y Java, pero no EAS CLI ni dispositivo/emulador conectado.
- Hay un APK local anterior: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`, tamano 83,926,811 bytes, fecha 16-nov-2026. `apksigner` verifica firma v2 del certificado Android Debug; `aapt` reporta `com.petcare.mobile`, versionCode `1`, versionName `1.0.0`, min SDK `24` y target SDK `36`. SHA-256: `232492CF6B8C51B70FA4FF30FDF10E49B918CF7C61BF8979B91E470D52C9CF03`. Es un APK debug ignorado, previo al arbol actual; no se instalo porque no hay dispositivo y no se presenta como candidato.
- **Bloqueo critico de firma:** el Gradle nativo local configura `buildTypes.release` para usar `signingConfigs.debug` y el `debug.keystore` estandar. No hay keystore de release del propietario. No se debe distribuir un `assembleRelease` de esta configuracion. EAS no esta configurado y no hay credenciales del propietario.
- El `EXPO_PUBLIC_API_URL` local usa HTTP y un host no loopback; GET `/health` sin credenciales resulto inaccesible incluso al repetir la comprobacion fuera del sandbox. No se proporciono URL HTTPS de produccion. No se puede verificar autenticacion, archivos o disponibilidad del entorno para un release.
- `app.json` ahora bloquea `android.permission.SYSTEM_ALERT_WINDOW`, que aparecia en el manifest nativo generado aunque la app no tiene una funcion que requiera dibujar sobre otras apps. La resolucion del config Expo confirma la regla. El proyecto Android ignorado aun conserva su manifest anterior; no lo regenere para preservar esos artefactos. Verificar que la proxima prebuild lo quite antes de compilar.
- El manifest Android generado incluye `INTERNET`, `POST_NOTIFICATIONS`, `VIBRATE` y permisos de almacenamiento heredados limitados hasta API 32. Las notificaciones son locales; no hay configuracion push FCM. Icono launcher existente es el icono generico Android y no hay branding/icono/splash declarados en `app.json`.
- `npm run test:migration-lineage` paso continuidad/checksum fuente-compilado para los linajes `remote` y `legacy-local`. La integracion PostgreSQL de eliminacion, incluida una subida retenida durante la desactivacion, paso en `petcare_test`; verifico que la subida termine antes de eliminar la cuenta y su objeto. Fixtures limpiados. `npm run build` API paso.
- No se accedio a Cloudflare ni se probo un bucket real en esta ejecucion. No se contacto staging/produccion ni se migraron esas bases. Workers de borrado y mantenimiento corren dentro del proceso API; el hosting debe mantenerlo vivo, permitir R2 LIST/DELETE y alertar sobre tareas diferidas.

## Verificacion final de preparacion - 26 nov 2026

- API: `npm run build --prefix api` y `npm test --prefix api` pasaron (68 pruebas, 65 aprobadas, 0 fallidas y 3 omitidas). `npm audit --prefix api`: 0 vulnerabilidades. La suite API fue ejecutada tras admitir `NODE_ENV=staging`.
- Móvil: `npm test --prefix mobile` y `npm run typecheck --prefix mobile` pasaron. `npm audit --prefix mobile`: 0 vulnerabilidades. No se modificaron dependencias.
- Web: exportación actual a `C:\Users\User\AppData\Local\Temp\petcare-web-final-2e95fa3d34684cd0b4a9d09d9b0169e4` generó 55 archivos; index existe, 3 referencias locales verificadas y 0 ausentes. El CLI imprimió `Exported` pero no terminó y fue interrumpido. La salida inspeccionada no tiene manifest, service worker ni registro de service worker. No es PWA ni release.
- El `EXPO_PUBLIC_API_URL` del entorno local se comprobó solo por esquema y uso de loopback: es HTTP y no loopback. El host se omitió y no se compiló un cliente de distribución con este destino.
- `render.yaml` se parseó y se verificaron sus campos principales con YAML local; no se validó desde el Dashboard. No hay servicio Render, Neon staging o credenciales staging creadas. No se ejecutaron migraciones.
- Android: no se hizo prebuild/build que sobrescribiera el proyecto nativo local ignorado; no hay APK/AAB actual. Android `release` apunta a `debug.keystore`; faltan firma del propietario y regeneración controlada para verificar permisos/backups.
- `git diff --check` sin errores; permanecen advertencias de normalización LF/CRLF. Sin staged, commit, push, despliegue ni modificación de producción.

## Ejecución de preparación de publicación - 26 nov 2026

- No fue posible preparar Render/Neon externamente: no hay CLI Render ni credenciales Render/Neon expuestas al entorno de ejecución. Se conserva el Blueprint con auto deploy apagado. No se simuló alta de servicio ni se ejecutaron migraciones.
- Android no es distribuible: no hay keystore de release ni credenciales EAS; el Gradle nativo ignorado sigue asignando `debug.keystore` a release. No se hizo prebuild/build para no sobrescribir el proyecto nativo local ignorado. El app config bloquea `SYSTEM_ALERT_WINDOW`, pero el manifest nativo existente sigue siendo anterior y no prueba el permiso efectivo de un nuevo build.
- No existe `mobile/assets` de branding, icono o splash. No se inventaron recursos de marca ni se modificó `allowBackup`; la política debe preservar offline y decidirse con el propietario.
- No hay URL de API HTTPS real de producción. La configuración local solo se comprobó por esquema y usa HTTP, así que no se compiló un artefacto Android/Web para distribución con ella.
- Web actual exportada en carpeta temporal (55 archivos, 3 referencias locales válidas) sin manifest ni service worker. El CLI no terminó tras el mensaje de export y fue interrumpido; la salida no valida rutas, sesión, responsive, SQLite/IndexedDB en navegador ni hosting. No se implementó PWA porque falta una política comprobada para caché/offline y datos privados.
- No hay servicio/dispositivo Traccar, bucket R2 de producción ni backend productivo conectado. Falta validación física Android y configuración FCM solo si se requieren notificaciones remotas. iOS queda fuera de alcance.
- No se hizo push, despliegue, publicación ni migración de producción. Android requiere API HTTPS de producción y clave release; Web requiere API y hosting HTTPS de producción verificados. Los recursos de producción deben ser independientes de staging.

## Decisión por plataforma

### Android: NO APTO

- No hay keystore de release del propietario; el Gradle nativo local firma `release` con `debug.keystore`.
- No hay API HTTPS de producción verificada ni APK/AAB actual. No existe branding de icono/splash y queda pendiente definir backup Android sin perder datos offline.
- Falta probar en un dispositivo Android un artefacto firmado, autenticación, archivos, notificaciones locales, modo offline, sincronización y recuperación.

### Web: NO APTO

- La exportación estática compila, pero el `EXPO_PUBLIC_API_URL` local usa HTTP y no es endpoint productivo.
- No existe hosting Web de producción verificado con HTTPS, fallback SPA, headers compatibles con SQLite/WASM y CORS para el origen real.
- Faltan pruebas de navegador de rutas, sesión, autenticación, IndexedDB, persistencia y recuperación. No es PWA; PWA no es requisito de este alcance salvo que el propietario decida ofrecer instalación.

## Bloqueadores compartidos

1. No existe backend de producción y base PostgreSQL/Neon independiente de staging, con autenticación, persistencia, sincronización y recuperación probadas.
2. No se verificaron integraciones reales R2/Traccar en infraestructura de producción. Ollama remoto no es compatible con el límite loopback actual; determinar si se habilita o se deja fuera de la primera publicación.
3. No hay backup/restore probado del entorno productivo ni política definida de backup Android para los datos locales.

## Intervención requerida del propietario

1. Aprovisionar API HTTPS y Neon/PostgreSQL de producción con secretos distintos de staging; verificar `/health`, `/ready`, autenticación, persistencia, sincronización y recuperación. Revisar backup/restore y aprobar el estado/linaje antes de migrar.
2. Proporcionar por canal seguro el keystore Android de release y su custodia; autorizar la corrección del signing config para rechazar `debug.keystore`.
3. Decidir reglas de backup Android, icono/splash y datos/permisos declarados en Google Play; después ejecutar prebuild controlado, APK/AAB firmado y piloto físico.
4. Elegir hosting Web de producción, cargar la URL real HTTPS de API mediante `EXPO_PUBLIC_API_URL` y configurar HTTPS, headers, fallback SPA y CORS exacto; validar en navegadores objetivo.
5. Provisionar R2/Traccar de producción si esas funciones forman parte del lanzamiento y probarlas con datos de validación autorizados. Definir si KIRAI/visión quedan deshabilitados hasta resolver Ollama remoto.
6. Ejecutar piloto Android offline de dos instalaciones, rollback de aplicación y recuperación/restauración antes de abrir el lanzamiento.

### Inventario de push final

El HEAD de origen es `c941261061a28bc27bafaf194448bc75548569f1` sobre `main`; el release solicitado incluiria cambios locales sin commit. Antes de preparar el commit/push, revisar exactamente los paths reportados por `git status --short` y tomar como entrada las cuatro ejecuciones completas. No incluir archivos ignorados: `mobile/.env.local`, `api/.env`, `mobile/android/` (incluido `debug.keystore` y el APK debug), `mobile/dist/`, `node_modules/`, ni artefactos/logs locales. Esta revision no preparo commit ni push.
#### Rutas locales visibles por Git (corte actual)

- ` M` .gitignore
- ` M` GUIA_GPS_TRACCAR.md
- ` M` README.md
- ` M` api/package.json
- ` M` api/src/config/env.ts
- ` M` api/src/db/migration-lineage.ts
- ` M` api/src/db/migration-runner.ts
- ` M` api/src/db/migrations/index.ts
- ` M` api/src/db/verify.ts
- ` M` api/src/modules/auth/controller.ts
- ` M` api/src/modules/auth/postgresAuthStore.ts
- ` M` api/src/modules/auth/service.ts
- ` M` api/src/modules/auth/types.ts
- ` M` api/src/modules/kirai/routes.ts
- ` M` api/src/modules/media/objectStore.ts
- ` M` api/src/modules/media/routes.ts
- ` M` api/src/modules/pets/trackingRoutes.ts
- ` M` api/src/server.ts
- ` M` api/test/app.test.ts
- ` M` api/test/auth.postgres.integration.test.ts
- ` M` api/test/auth.test.ts
- ` M` api/test/domain-sync.postgres.integration.test.ts
- ` M` api/test/kirai.postgres.integration.test.ts
- ` M` api/test/kirai.test.ts
- ` M` api/test/media.postgres.integration.test.ts
- ` M` api/test/memoryAuthStore.ts
- ` M` api/test/migration-lineage.check.mjs
- ` M` api/test/migration-lineage.postgres.mjs
- ` M` api/test/pets.postgres.integration.test.ts
- ` M` api/test/sync.postgres.integration.test.ts
- ` M` docs/audits/THIRD_PARTY_NOTICES.md
- ` M` docs/audits/petcare-api-licenses.json
- ` M` docs/audits/petcare-api-npm-audit.json
- ` M` docs/audits/petcare-api.cdx.json
- ` M` docs/audits/petcare-current-status.md
- ` M` docs/audits/petcare-mobile-licenses.json
- ` M` docs/audits/petcare-mobile-npm-audit.json
- ` M` docs/audits/petcare-mobile.cdx.json
- ` M` docs/audits/petcare-models.cdx.json
- ` M` docs/backend/mobile-operation-boundaries.md
- ` M` docs/backend/postgres-migration-lineages.md
- ` M` docs/backend/remote-media-storage.md
- ` M` docs/deployment/environment-configuration.md
- ` M` docs/sync/phase-4-audit.md
- ` M` mobile/app.json
- ` M` mobile/package.json
- ` M` mobile/src/db/localAccount.ts
- ` M` mobile/src/db/migrate.ts
- ` M` mobile/src/db/migrations/index.ts
- ` M` mobile/src/features/auth/AuthProvider.tsx
- ` M` mobile/src/features/profile/screens/ProfileScreen.tsx
- ` M` mobile/src/features/sync/domainQueueState.ts
- ` M` mobile/src/features/sync/domainSync.ts
- ` M` mobile/src/features/sync/mediaQueue.ts
- ` M` mobile/src/features/sync/mediaSync.ts
- ` M` mobile/src/features/sync/petSync.ts
- ` M` mobile/test/domain-queue-state.test.mjs
- ` M` scripts/generate-npm-sbom.mjs
- `??` api/src/db/migrations/0013_account_deletion_worker.ts
- `??` api/src/modules/auth/accountDeletionWorker.ts
- `??` api/src/modules/pets/traccarClient.ts
- `??` api/test/account-deletion.postgres.integration.test.ts
- `??` api/test/assertMigrations.ts
- `??` api/test/media-r2-config.test.ts
- `??` api/test/migration-checksum.portability.mjs
- `??` api/test/traccarClient.test.ts
- `??` docs/backend/account-deletion.md
- `??` docs/deployment/distribution-readiness.md
- `??` docs/deployment/external-integrations.md
- `??` docs/deployment/release-manifest.md
- `??` docs/deployment/render-staging.md
- `??` docs/testing/mobile-physical-validation.md
- `??` docs/testing/offline-first-two-installations.md
- `??` mobile/src/db/deleteLocalAccountData.ts
- `??` mobile/src/db/localAccountPurge.ts
- `??` mobile/src/db/migrations/0011_scoped_media_cache.ts
- `??` mobile/src/features/sync/mediaCacheKeyMigration.ts
- `??` mobile/src/features/sync/mediaStorageKey.ts
- `??` mobile/test/local-account-purge.test.mjs
- `??` mobile/test/local-migration-ledger.test.mjs
- `??` mobile/test/media-cache-key-migration.test.mjs
- `??` mobile/test/media-storage-key.test.mjs
- `??` render.yaml
