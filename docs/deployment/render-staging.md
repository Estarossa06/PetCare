# Backend staging en Render

**Estado:** preparación local; no se creó un servicio ni se desplegó.
**Destino:** un servicio aislado llamado `petcare-api-staging`, conectado a una base Neon nueva y exclusiva de staging.

## Arquitectura y comandos

El monorepo contiene `api/` y `mobile/`. El Blueprint raíz `render.yaml` crea solo un Web Service Node para la API; no crea bases de datos, buckets, workers independientes ni recursos de producción. Configuración declarada:

| Opción | Valor |
|---|---|
| Root Directory | `api` |
| Runtime | Node.js |
| Node.js | `22.22.0`, fijado mediante `NODE_VERSION` en el Blueprint |
| Build Command | `npm ci && npm run build` |
| Start Command | `npm start` (`node dist/server.js`) |
| Health Check Path | `/health` |
| Host | `0.0.0.0` |
| Puerto | Render inyecta `PORT`; la aplicación acepta el valor y tiene `3000` como fallback local |
| Auto deploy | Desactivado (`autoDeployTrigger: off`) |

Los scripts se respaldan en `api/package.json`; `api/package-lock.json` está presente. El lockfile y los paquetes requieren Node 20 o posterior; el Blueprint fija una versión 22 compatible. Se omite `plan` para no fijar un nivel de cómputo ni su costo en este archivo; Render indica como predeterminado `0.5c-512mb` para un nuevo Web Service. El propietario debe revisar el plan y costo en el Dashboard antes de crear el servicio. Debe ser una instancia siempre activa para que los workers periódicos tengan oportunidad continua de procesar colas; los reinicios y despliegues siguen siendo posibles.

## Compatibilidad y límites observados

- `server.ts` usa `config.port` y `config.host`. Render requiere escuchar en `0.0.0.0`; el Blueprint lo define explícitamente. El valor predeterminado local sigue siendo `127.0.0.1`.
- `/health` devuelve solo `{"status":"ok"}` y no consulta ni divulga dependencias. `/ready` consulta PostgreSQL y responde con estado genérico; no expone URL, datos ni errores de conexión. Render usa `/health` para no marcar como caído el servicio durante una interrupción temporal de Neon.
- La conexión PostgreSQL usa `pg.Pool`, límite 10 por instancia y timeouts configurados. La aplicación no implementa `DATABASE_SSL`; hay que usar el connection string TLS de Neon con `sslmode=require`. El pool de la API no lee archivos de base de datos locales.
- Rutas de archivos usan `os.tmpdir()` únicamente para archivos temporales y los limpian al final de la petición. El almacenamiento duradero de medios es R2; no hay que depender del filesystem efímero del servicio.
- SIGTERM/SIGINT detienen el servidor, esperan solicitudes HTTP en curso, limpian intervalos y esperan la ejecución activa del worker de eliminación antes de cerrar el pool. El apagado puede superar la ventana de gracia de Render si hay operaciones R2 lentas; Render puede terminar forzosamente el proceso. El lease de eliminación permite reclamar solicitudes abandonadas al expirar.
- El worker de eliminación está dentro del proceso API y despierta cada 30 segundos. Varias instancias no procesan a la vez la misma petición: el claim usa transacción y `FOR UPDATE SKIP LOCKED`, con lease y reintentos. Sin R2 configurado, las eliminaciones se difieren de forma reintentable; para validar el ciclo completo hace falta R2 de staging.
- El mantenimiento de medios también se ejecuta en cada instancia cada hora. Limpia objetos mediante operaciones de borrado idempotentes, pero no tiene una exclusión global para evitar barridos redundantes entre instancias. Recomendar una sola instancia en staging; antes de escalarlo, convertir el barrido en tarea coordinada o worker dedicado.
- CORS se limita a los orígenes exactos en `CORS_ORIGINS`; vacío significa que no se habilita acceso de navegador cross-origin. No es una lista de URLs con rutas.
- KIRAI/Ollama y visión Ollama rechazan intencionalmente direcciones que no sean loopback. Un Ollama ejecutado como servicio separado no puede configurarse en Render con la validación actual. Por tanto, dejar estas variables sin configurar conserva el endpoint pero fallará cerrado/no estará disponible; habilitar modelos requiere un diseño de red/configuración aprobado y evaluación de costo/capacidad.
- Traccar permite HTTPS remoto y requiere URL y token juntos. No configurar hasta disponer de una instancia de staging y una cuenta/dispositivo de prueba.
- `/health` no equivale a readiness. `/ready` sí consulta base. Los checks externos del servicio deben consultar `/health`; usar `/ready` solo si se quiere retirar tráfico durante cortes de base.
- La API no ejecuta migraciones al arrancar. No hay `preDeployCommand` de migración en el Blueprint.

## Variables de entorno

Valores secretos se cargan por el Dashboard de Render o el flujo inicial del Blueprint con `sync: false`; jamás se guardan aquí. `DATABASE_SSL`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET` y `CORS_ORIGIN` **no** son nombres usados por el código actual. La aplicación usa un secreto de acceso y refresh tokens aleatorios rotatorios almacenados como hashes en PostgreSQL.

| Variable exacta | Requerida | Formato / uso | Secreto | Consumidor |
|---|---|---|---|---|
| `NODE_ENV` | Sí | `staging`; se añadió al validador. | No | Configuración API |
| `PORT` | Sí en Render | Puerto TCP numérico; Render lo proporciona. Fallback local `3000`. | No | HTTP server |
| `HOST` | Sí en Render | Dirección IP/nombre; Blueprint usa `0.0.0.0`. | No | HTTP server |
| `DATABASE_URL` | Sí | URL `postgresql://…/…?sslmode=verify-full` de Neon staging; validar que use base y credenciales independientes. | Sí | PostgreSQL pool y comandos manuales de DB |
| `AUTH_ACCESS_TOKEN_SECRET` | Sí | Texto aleatorio de al menos 32 bytes; único para staging. | Sí | JWT de acceso |
| `CORS_ORIGINS` | Opcional | Lista separada por comas de orígenes HTTP(S) exactos, sin rutas; añadir solo la URL web de staging si aplica. | No | Middleware CORS |
| `R2_ACCOUNT_ID` | Opcional, en grupo | ID de cuenta o endpoint S3 canónico de Cloudflare; todas las cuatro vars deben configurarse juntas. | No | Almacenamiento R2 |
| `R2_BUCKET` | Opcional, en grupo | Nombre del bucket privado de staging. | No | Almacenamiento R2 |
| `R2_ACCESS_KEY_ID` | Opcional, en grupo | Access key mínimo del bucket de staging. | Sí | Cliente S3/R2 |
| `R2_SECRET_ACCESS_KEY` | Opcional, en grupo | Secret key asociado, mínimo privilegio. | Sí | Cliente S3/R2 |
| `KIRAI_OLLAMA_BASE_URL` | Opcional, actualmente no utilizable en servicio remoto | HTTP loopback solamente. Default `http://127.0.0.1:11434`; no apunta a otro servicio Render. | No | KIRAI/Ollama |
| `KIRAI_OLLAMA_MODEL` | Opcional | Identificador de modelo; default `qwen3:8b`. | No | KIRAI/Ollama |
| `KIRAI_OLLAMA_TIMEOUT_MS` | Opcional | Entero de 1–300000 ms; default 60000. | No | KIRAI/Ollama |
| `PET_VISION_OLLAMA_BASE_URL` | Opcional, actualmente no utilizable en servicio remoto | HTTP loopback solamente; default `http://127.0.0.1:11434`. | No | Identificación por imagen |
| `PET_VISION_OLLAMA_MODEL` | Opcional | Identificador de modelo; default `qwen2.5vl:7b`. | No | Identificación por imagen |
| `PET_VISION_TIMEOUT_MS` | Opcional | Entero de 1–300000 ms; default 90000. | No | Identificación por imagen |
| `TRACCAR_URL` | Opcional, junto al token | URL HTTPS sin credenciales/query string. | No | Cliente GPS Traccar |
| `TRACCAR_TOKEN` | Opcional, junto a URL | Token de API de staging; se envía como bearer. | Sí | Cliente GPS Traccar |

No existen variables JWT/refresh separadas ni `DATABASE_SSL`. No cargar `PETCARE_TEST_DATABASE_URL`, `PETCARE_RUN_*` ni variables de pruebas en el servicio.

## Neon staging, linaje y migraciones

1. Crear manualmente una base/proyecto Neon aparte de producción, con credenciales independientes y región compatible con el servicio. No usar `petcare_test`.
2. Guardar el connection string TLS de esa base exclusivamente como `DATABASE_URL` del servicio staging. No introducirlo en archivos del repositorio, logs, comandos compartidos ni configuración móvil.
3. Antes de cualquier migración futura, verificar hostname/base por canal protegido y confirmar expresamente que no sea producción ni `petcare_test`. Hacer un backup de Neon y comprobar que se puede restaurar a una base desechable.
4. Consultar primero el estado con `npm run db:migrate:status` desde `api/`, cargando localmente el `DATABASE_URL` staging aprobado. Este comando adquiere un advisory lock y lee el ledger/linaje; no ejecuta DDL. Si reporta esquema sin historial reconocido, checksum divergente o error, detenerse.
5. Linaje: para una base staging nueva y vacía, el código selecciona `remote` (migraciones canónicas fusionadas). Para una base con historial, `resolveMigrationLineage` identifica `remote` o `legacy-local` mediante el ledger y checksums conocidos; nunca adivinar ni editar ledger para forzar un resultado. Los casos ambiguos bloquean.
6. Esta preparación no conectó Neon ni ejecutó `status`, migración, verificación de esquema, backup o restore. No se modificó ninguna base.

Para recuperación, restaurar un snapshot verificado en una base aislada y probar aplicación/consulta allí. El rollback de app debe mantener un esquema compatible hacia adelante; no ejecutar migraciones inversas ni restaurar sobre staging activo sin procedimiento aprobado. La recuperación de objetos R2 es independiente y requiere validar también su versionado/backup.

## R2 de staging

Crear bucket privado exclusivo y token restringido a ese bucket. Guardar las cuatro variables R2 solo en Render. El backend exige la configuración completa o ninguna. Validar PUT/GET/DELETE y el flujo de eliminación de cuenta con fixtures sintéticos de staging antes de habilitarlo para usuarios de prueba. Nunca reutilizar bucket, token ni archivos de producción.

## Procedimiento de despliegue y comprobación (pendiente de autorización)

1. Revisar `render.yaml` y publicar posteriormente la rama staging autorizada que contenga estos cambios.
2. En Render, seleccionar el Blueprint, comprobar que solo cree `petcare-api-staging`, `rootDir=api`, plan siempre activo y `autoDeployTrigger=off`; no aceptar recursos de producción o bases automáticas.
3. Proveer `DATABASE_URL` Neon staging con TLS y secreto independiente `AUTH_ACCESS_TOKEN_SECRET` de al menos 32 bytes. Cargar `CORS_ORIGINS` exacto si el frontend web staging lo necesita.
4. Confirmar el health check `/health`, build y arranque desde logs sin imprimir valores de entorno.
5. Verificar certificado HTTPS del hostname Render y respuesta: `GET https://<hostname-staging>/health` debe ser 200 con `status=ok`; probar `/ready` devuelve 200 solo cuando PostgreSQL staging responde y 503 genérico si está temporalmente indisponible.
6. Ejecutar pruebas autenticadas con cuentas sintéticas, revisar CORS, almacenamiento (si configurado), borrado diferido y comportamiento tras reinicio. No importar datos reales.

No se conocen ni se inventan hostname, URL de base, secretos o credenciales. El servicio no ha sido creado ni verificado en Render.

## Rollback de aplicación

En Render, volver al deploy previo conocido y comprobar `/health` y `/ready`. Como las migraciones no corren automáticamente, el rollback de app no debe implicar rollback de esquema. Si una futura migración ya fue ejecutada, verificar primero compatibilidad hacia atrás; restaurar backup solo en una ventana acordada y con una base destino confirmada. Revisar workers/leases y cola de medios tras reinicio. No desplegar ni revertir una release de producción desde este procedimiento.

## Limitaciones y acciones del propietario

- Confirmar la rama staging y autorizar el push/despliegue en una etapa posterior.
- Crear Neon staging, cargar secretos por Dashboard y aprobar backup/restore.
- Aprovisionar bucket R2 aislado y decidir permisos/lifecycle.
- Elegir una instancia Render siempre activa. El plan Free duerme después de 15 minutos sin tráfico y sus workers no son continuos; incluso el plan persistente puede reiniciarse.
- Definir arquitectura de Ollama remoto o aceptar KIRAI/visión no disponibles en staging.
- Proporcionar instancia Traccar y dispositivo de prueba si se valida GPS.
- Confirmar política de escalado: el worker de borrado coordina reclamos en DB, pero el barrido horario de medios puede duplicarse entre instancias.
- Revisar ventana de apagado: la configuración actual no impone un límite propio a operaciones R2 activas; Render puede terminar el proceso tras su ventana de gracia. La lease permite reintento del worker, pero no sustituye una prueba de apagado.

## Fuentes de plataforma consultadas

- [Blueprint spec de Render](https://render.com/docs/blueprint-spec): `rootDir`, `autoDeployTrigger`, variables `sync: false` y Node runtime.
- [Node version en Render](https://render.com/docs/node-version): fijación por `NODE_VERSION`.
- [Web Services](https://render.com/docs/web-services): escucha en `0.0.0.0` y `PORT`.
- [Health checks](https://render.com/docs/health-checks): ruta HTTP del check.
- [Free instances](https://render.com/docs/free): suspensión por inactividad, filesystem efímero y límites del plan Free.
- [Deploys y apagado graceful](https://render.com/docs/deploys): señal SIGTERM y ventana de shutdown.
