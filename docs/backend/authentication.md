# Backend API y autenticación

## Arquitectura

El servidor de `api/` usa Express y TypeScript. `server.ts` crea un único pool
PostgreSQL y `PostgresAuthStore`; `MemoryAuthStore` existe solo en pruebas. La
autenticación está separada en rutas, controlador HTTP, servicio, validación,
repositorio PostgreSQL, errores y tipos.

## Rutas

| Método | Ruta | Acceso |
|---|---|---|
| POST | `/auth/register` | Público; valida y crea usuario/sesión. |
| POST | `/auth/login` | Público; credenciales genéricas en caso de fallo. |
| POST | `/auth/refresh` | Público; rota el refresh token. |
| GET | `/auth/me` | Requiere Bearer JWT y sesión activa; devuelve el usuario autenticado. |
| POST | `/auth/logout` | Requiere Bearer JWT; revoca la sesión y sus refresh tokens. |
| GET | `/pets` | Requiere Bearer JWT; lista mascotas del propietario autenticado. |
| POST | `/pets` | Requiere Bearer JWT; crea una mascota para el propietario autenticado. |
| GET | `/pets/:petId` | Requiere Bearer JWT; consulta una mascota propia. |
| PATCH | `/pets/:petId` | Requiere Bearer JWT; actualiza parcialmente una mascota propia. |
| DELETE | `/pets/:petId` | Requiere Bearer JWT; elimina lógicamente una mascota propia. |
| GET | `/health` | Liveness. |
| GET | `/ready` | Comprueba conectividad básica con PostgreSQL. |

El módulo de mascotas aplica el mismo aislamiento: el propietario se deriva del
`Principal`, nunca de un `owner_id` enviado por el cliente. La sincronización
del backend todavía no está implementada. El contrato, validaciones y
compatibilidad del módulo se describen en [pets.md](./pets.md).

Las contraseñas se derivan con scrypt; los access JWT son HS256 y expiran a
los 15 minutos. Los refresh tokens aleatorios se guardan como SHA-256, rotan
en una transacción y su reutilización revoca la sesión. Registro, login y
refresh tienen un límite de 10 intentos por IP cada 15 minutos. El limiter
actual es por proceso y debe sustituirse por almacenamiento compartido antes
de escalar a varias réplicas.

## Migración de autenticación

La migración `0004_auth_refresh_token_history` agrega
`auth_sessions.updated_at` y `auth_refresh_tokens`, copiando los refresh hashes
existentes. No editar migraciones aplicadas: los cambios de esquema futuros
requieren una migración numerada nueva. `db:migrate:status` compara nombre y
checksum sin aplicar migraciones. `db:migrate` modifica el esquema y debe
ejecutarse únicamente contra el destino autorizado.

La comprobación del 16 de noviembre de 2026 encontró 0001–0003 aplicadas y
coincidentes con sus checksums locales; 0004 estaba pendiente. Se aplicó la
migración 0004 existente de forma transaccional, sin modificar archivos de
migración ni eliminar datos; una inspección read-only previa contó cero
sesiones existentes. `db:migrate:status` confirmó después las cuatro
migraciones aplicadas y sus checksums coincidentes. La persistencia real de
las rutas todavía requiere ejecutar la prueba de integración en una base
desechable; el estado del ledger por sí solo no prueba el flujo de auth.

## Verificación

- `npm test --prefix api` ejecuta las pruebas HTTP/autenticación locales; usan
  `MemoryAuthStore` y no prueban persistencia PostgreSQL.
- `npm run test:integration:auth --prefix api` ejecuta el flujo contra
  PostgreSQL usando exclusivamente `PETCARE_TEST_DATABASE_URL` y requiere
  `PETCARE_RUN_AUTH_DB_TESTS=1`. El nombre de la base debe incluir `test`; el
  test comprueba las cuatro migraciones y sus checksums antes de crear fixtures
  únicos, verifica registro/login/rotación/reutilización/revocación/aislamiento
  y elimina los fixtures creados.
- No usar una base de producción para integración. Si la variable no está
  configurada, la prueba se omite; una prueba omitida no confirma persistencia
  real.

El API permite CORS solo para orígenes configurados. Los preflight aceptan
`Content-Type` y `Authorization`. En producción, configurar HTTPS en el
terminador de TLS y mantener los secretos fuera del cliente y del repositorio.
