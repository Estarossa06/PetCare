# PetCare release manifest

**Fecha de revision:** 26 de noviembre de 2026
**Alcance:** primera publicacion oficial Android y Web; iOS queda fuera de alcance
**Resultado:** Android `NO APTO`; Web `NO APTO`
**Produccion:** no aprobada, no consultada ni modificada
**Publicacion/firma:** ninguna realizada

## Fuente de codigo

| Campo | Valor |
|---|---|
| Rama | `main` |
| HEAD de referencia | `c941261061a28bc27bafaf194448bc75548569f1` |
| Commit date | `2026-11-24T01:14:28-05:00` |
| Relacion con `origin/main` | Alineado; 0 commits ahead / 0 behind |
| Estado de trabajo | 83 rutas visibles por Git modificadas/sin seguimiento; sin cambios staged. El codigo no esta representado por HEAD solamente. |
| Inventario para el futuro push | Ver lista exacta en [distribution-readiness.md](distribution-readiness.md#inventario-de-push-final). |

No se hizo commit ni push. No incluir en Git `.env`, `api/.env`, `mobile/.env.local`, `mobile/android/`, `mobile/dist/`, `node_modules/` ni artefactos locales ignorados.

## Variables por entorno (nombres, sin valores)

La referencia completa esta en [environment-configuration.md](environment-configuration.md). La API requiere `NODE_ENV`, `PORT`, `HOST`, `DATABASE_URL` y `AUTH_ACCESS_TOKEN_SECRET`; staging debe definir `CORS_ORIGINS`. Para funciones opcionales se configuran `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; `KIRAI_OLLAMA_BASE_URL`, `KIRAI_OLLAMA_MODEL`, `KIRAI_OLLAMA_TIMEOUT_MS`; `PET_VISION_OLLAMA_BASE_URL`, `PET_VISION_OLLAMA_MODEL`, `PET_VISION_TIMEOUT_MS`; y `TRACCAR_URL`, `TRACCAR_TOKEN`. El cliente solo recibe `EXPO_PUBLIC_API_URL`, que es publica y debe apuntar al API HTTPS del entorno previsto. Variables `PETCARE_TEST_*` y `PETCARE_RUN_*` son solo para tests aislados.

## Version y plataformas

| Plataforma | Configuracion | Artefacto de esta revision |
|---|---|---|
| Android | `com.petcare.mobile`, Expo `1.0.0`; el proyecto nativo local dice versionCode `1`, target SDK `36`. | Ningun APK/AAB actual generado. |
| Web | Expo static export/SQLite WASM; sin manifest de instalacion ni service worker. | La exportacion actual genero 55 archivos en `C:\Users\User\AppData\Local\Temp\petcare-web-final-2e95fa3d34684cd0b4a9d09d9b0169e4`; 3 referencias locales existen y 0 faltan. CLI imprimio `Exported` pero no termino y fue interrumpido. Sin manifest/service worker; bundle no es release ni PWA. |

iOS no se prepara ni se usa como criterio de bloqueo para esta primera publicacion.

### APK local preexistente (no candidato)

- Ruta: `mobile/android/app/build/outputs/apk/debug/app-debug.apk` (ignorada por Git).
- Fecha: 16 de noviembre de 2026; 83,926,811 bytes.
- SHA-256: `232492CF6B8C51B70FA4FF30FDF10E49B918CF7C61BF8979B91E470D52C9CF03`.
- `apksigner` valido con firma v2 de Android Debug; `aapt`: ID `com.petcare.mobile`, versionCode `1`, versionName `1.0.0`, min SDK `24`, target SDK `36`.
- No corresponde al estado de trabajo de las cuatro ejecuciones. No hay dispositivo/emulador conectado; no se instalo.

No existe un checksum para artefactos de release porque no se generaron. No se declara un APK descargable.

## Configuracion y servicios

| Area | Evidencia | Estado |
|---|---|---|
| URL del cliente | `EXPO_PUBLIC_API_URL` local usa HTTP, host no loopback; GET sin credenciales a `/health` fue inaccesible dentro y fuera del sandbox. El host se omite del informe. | Bloquea build candidato: no hay endpoint HTTPS de staging funcional identificado. |
| API secrets | `api/.env` local ignorado existe, pero `AUTH_ACCESS_TOKEN_SECRET` no tiene valor en ese archivo. La URL de base no se imprime ni se usa para operaciones de release. | No es configuracion de release verificable. |
| CORS | `CORS_ORIGINS` no tiene valor en `api/.env`. | El propietario debe definir origenes exactos para staging. |
| R2 | Las cuatro variables `R2_*` tienen valor en el archivo API local; no se inspeccionaron sus valores ni se llamo a Cloudflare. `PETCARE_RUN_MEDIA_R2_TESTS` no esta habilitado. | Configuracion presente, disponibilidad/permisos/privacidad no validados. No asumir que es staging. |
| KIRAI/Ollama | Evidencia previa en este hilo: daemon local disponible, smoke `qwen3:8b` y E2E `petcare_test` aprobados. | Validado localmente; no prueba disponibilidad/capacidad externa. |
| Traccar | `TRACCAR_URL` y `TRACCAR_TOKEN` ausentes en el `.env` API revisado; tests unitarios, sin instancia ni GPS fisico. | Pendiente de provision externa. |
| Notificaciones | Notificaciones locales; la dependencia aporta `POST_NOTIFICATIONS` al manifest fusionado. No hay configuracion de push FCM para Android. | Validacion fisica pendiente. |
| Cuenta Android | El proyecto Gradle local ignora los cambios y configura `buildTypes.release` con `signingConfigs.debug`. Solo se encontro `debug.keystore`. | Bloqueo critico. No usar para distribucion. |
| Permiso overlay | `mobile/app.json` bloquea `android.permission.SYSTEM_ALERT_WINDOW`; Expo config parsea la regla. El Android nativo ignorado mantiene un manifest anterior y debe regenerarse/verificarse antes de build. | Correccion de fuente aplicada; manifiesto generado nuevo pendiente. |
| Backups locales | Manifest Android actual declara `allowBackup=true` sin reglas explicitas de exclusion. | Revision de privacidad y retencion Android pendiente del propietario. |

## Migraciones, rollback y ejecucion

- `npm run test:migration-lineage` aprobo checksums source/compiled y los linajes `remote` y `legacy-local`. La integracion de eliminacion, incluida la carrera carga/desactivacion, paso en `petcare_test` y limpio sus fixtures.
- No se consulto ni modifico staging/produccion y no se corrieron migraciones contra esas bases.
- Antes de cualquier release: confirmar destino/linaje con `db:migrate:status`, respaldo recuperable y restauracion probada. Detenerse ante historial/checksum desconocido. Migrar primero en staging con la version API candidata y pruebas de dominio.
- Aplicar solo migraciones aditivas compatibles con la version API anterior. Si falla la API, volver al artefacto backend anterior y conservar el esquema avanzado; no ejecutar down-migration ni restaurar datos sin un plan de recuperacion aprobado.
- Desplegar API y workers como servicio persistente; comprobar `/health` y `/ready`, logs sanitizados, conectividad DB, cola de eliminacion, Ollama y almacenamiento. Mantener alerta y procedimiento de rollback antes de produccion.
- La distribucion movil requiere firma y pruebas de instalacion separadas. No se publico nada ni se genero credencial.

## Pruebas registradas

- API `npm test --prefix api`: 68 pruebas, 65 aprobadas, 0 fallidas, 3 omitidas; `npm run build --prefix api`: aprobado.
- API `npm run test:migration-lineage`: aprobado.
- Movil `npm test --prefix mobile` y `npm run typecheck --prefix mobile`: aprobados.
- Expo config: JSON parseado y `blockedPermissions` confirmado.
- `npm audit --prefix api` y `npm audit --prefix mobile`: 0 vulnerabilidades en lockfiles actuales. Inventarios/SBOM de licencias previos no se regeneraron porque los lockfiles no cambiaron.
- APK anterior: firma/formato/metadatos inspeccionados; instalacion pendiente por ausencia de dispositivo.
- Web: bundle exportado en ruta temporal arriba; el CLI no termino limpiamente. No se comprobó hosting. Configuración local de API es HTTP y no loopback; no es destino para release.
- `render.yaml` parseado localmente, no validado en Dashboard; staging no creado ni conectado.

## Bloqueadores

### Criticos

1. No hay API HTTPS ni base de datos de produccion desplegadas y verificadas, independientes de staging.
2. No hay clave de firma Android del propietario; Gradle release usa la clave debug.
3. No hay infraestructura productiva verificada para probar los flujos reales de Android y Web.

### Altos

1. R2 real, privacidad del bucket y permisos efectivos no verificados.
2. Traccar sin instancia/dispositivo real; sin piloto movil fisico.
3. Politica Android para backups de SQLite/archivos no decidida; copias de dispositivos desconectados no son remotamente borrables.

### Medios

1. Launcher generico y sin icono/splash de marca en config fuente.
2. Web no PWA ni hosting/cuotas de navegador validados.

## Acciones del propietario

1. Aprovisionar produccion independiente de staging: API HTTPS, PostgreSQL/Neon, secretos de backend y origen CORS exacto; verificar health/ready, autenticacion, persistencia, sincronizacion y recuperacion. No reutilizar el destino de staging como produccion.
2. Elegir EAS o CI Android; vincular cuenta/proyecto si aplica; proporcionar keystore de release bajo custodia segura y corregir el signing config para que rechace la clave debug.
3. Confirmar versionado, icono/splash y declaraciones de datos/permisos Play.
4. Confirmar privacidad y token minimo de Cloudflare R2; provisionar Traccar y un GPS real.
5. Configurar hosting Web de produccion con HTTPS, headers, fallback SPA y CORS; validar rutas, autenticacion, sesion e IndexedDB en navegador.
6. Decidir politica de backup/retencion, instalar APK firmado actual en dispositivo Android y aprobar piloto offline/rollback antes de cualquier publicacion.

## Corte final de preparación - 26 de noviembre de 2026

- No se pudo crear/validar servicio Render o Neon: no hay CLI ni credenciales disponibles en el entorno. No se conectó base, no se verificó backup/restore y no se ejecutaron migraciones.
- La exportación Web generó 55 archivos en `C:\Users\User\AppData\Local\Temp\petcare-web-final-2e95fa3d34684cd0b4a9d09d9b0169e4`, con 3 referencias locales válidas. El CLI quedó activo tras `Exported` y fue interrumpido. No hay PWA; esa carpeta temporal no se considera release.
- El cliente local apunta a un API HTTP no loopback; no se incorporó esa configuración en una release. Sin APK/AAB, firma release, URLs de hosting ni hashes de release.
- Suites API y mobile, typecheck mobile, builds API y auditorías npm actuales: aprobados según resultados de esta sesión. Web export solo valida generación estática; no se probó navegador/hosting. El linaje se validó anteriormente con tests, sin conexión a staging.
- Se conservaron los 83 paths locales, no staged. No se hizo push, deploy, publicación, migración ni operación sobre producción.
- Decisión: preparación local `PARCIAL`; Android `NO APTO`; Web `NO APTO`. Faltan infraestructura de producción independiente de staging, clave Android del propietario, hosting Web y pruebas físicas Android/browser. iOS está fuera de alcance.
