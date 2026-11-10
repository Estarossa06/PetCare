# PetCare / KIRAI — Fase 3: identidad y seguridad

## Alcance

Se implementó identidad central en la API y su integración de inicio/cierre de
sesión en el cliente Expo. KIRAI, CRUD remoto, sincronización y asociación de
datos SQLite quedaron fuera. No se conectó Neon ni se ejecutó ninguna
migración.

## Arquitectura de autenticación

```text
Expo AuthScreen/ProfileScreen
    └── ApiClient
        ├── SecureStore (Android/iOS)
        └── sessionStorage (Web; garantías menores)
             │ HTTPS en despliegue / HTTP solo para desarrollo local
             ▼
Express /auth
    ├── validación de entradas y rate limit
    ├── AuthService
    │   ├── scrypt (contraseñas)
    │   ├── jose HS256 (access JWT)
    │   └── refresh aleatorio + SHA-256
    ├── PostgresAuthStore (Pool compartido)
    └── authenticate middleware → Principal confiable
```

`users` ya incluía correo, `password_hash`, `name` y `deleted_at`; el índice
único de correo y los checks existentes se conservan. `auth_sessions` ya tenía
usuario, hash de refresh, expiración y revocación, pero no el historial de
rotación. Se agregó una migración incremental para ese historial, descrita
abajo.

## Registro y login

- `POST /auth/register`: recibe `{ "email", "password", "name" }`. Normaliza
  correo con trim y minúsculas, valida formato/longitud, y crea usuario,
  sesión y primer hash de refresh en una transacción.
- `POST /auth/login`: recibe `{ "email", "password" }`. La respuesta de
  credenciales incorrectas es uniforme, ya sea que falle la contraseña o no
  exista el usuario. Para correos inexistentes también se ejecuta una
  verificación scrypt ficticia para reducir diferencias de tiempo.
- La contraseña debe tener entre 12 y 128 caracteres. Se almacena con scrypt
  de Node.js (`N=32768`, `r=8`, `p=1`, sal aleatoria de 16 bytes y clave de 64
  bytes). La comparación de hashes usa `timingSafeEqual`.
- El cliente nunca recibe `password_hash`; las respuestas de error no incluyen
  la dirección introducida en el registro duplicado.
- Las operaciones `/auth/register`, `/auth/login` y `/auth/refresh` tienen un
  límite de 10 solicitudes por IP cada 15 minutos. El limiter actual es en
  memoria por proceso, no distribuido.

## Ciclo de vida de tokens y sesiones

- Access token JWT HS256 con `sub` (UUID de usuario), `sid` (UUID de sesión),
  `jti`, `iss`, `aud`, `iat` y `exp`. Expira a los **15 minutos**.
- Refresh token opaco con 256 bits aleatorios; la API solo guarda su SHA-256.
  Su expiración es de **30 días desde la última rotación**.
- `POST /auth/refresh` consume el token actual y genera uno nuevo dentro de una
  transacción. Los hashes anteriores permanecen en la tabla de historial, no
  se pueden reutilizar para renovar.
- Reutilizar un token consumido aún no expirado revoca la sesión y todos sus
  refresh tokens asociados. La respuesta es indistinguible de un refresh
  inválido.
- `POST /auth/logout` requiere access token y revoca la sesión actual, en una
  transacción. El middleware consulta la sesión en PostgreSQL en cada solicitud
  protegida, por lo que la revocación también invalida de inmediato el access
  token de esa sesión.
- Las sesiones expiradas/revocadas se mantienen lógicamente en PostgreSQL.
  Todavía no hay tarea de purga/retención ni endpoint para listar o revocar
  otras sesiones/dispositivos.

## Endpoints

| Método | Ruta | Resultado |
|---|---|---|
| `POST` | `/auth/register` | `201`, usuario y par de tokens. |
| `POST` | `/auth/login` | `200`, usuario y par de tokens. |
| `POST` | `/auth/refresh` | `200`, nuevo par y rotación atómica. |
| `POST` | `/auth/logout` | `204`, requiere `Authorization: Bearer <accessToken>`. |
| `GET` | `/health` | Liveness existente. |
| `GET` | `/ready` | Readiness PostgreSQL existente. |

Un error de autenticación responde con `401` genérico. El sistema no registra
tokens, contraseñas, cuerpos, URLs de conexión ni mensajes internos del Pool.

## Middleware, Principal y aislamiento

El middleware valida firma, algoritmo permitido, emisor, audiencia, expiración
y formato UUID de los claims. Luego comprueba en PostgreSQL que la sesión sigue
activa y que el usuario no está borrado. Solo entonces agrega
`request.principal: { userId, sessionId }`.

Las operaciones protegidas deben derivar el dueño de `principal.userId`; nunca
de `owner_id` recibido en body, query o ruta. Se añadió
`OwnerScopedQueries.findPet`, cuya consulta requiere conjuntamente
`owner_id = principal.userId`, ID del recurso y `deleted_at IS NULL`; no
encuentra/revela recursos de otro propietario y rechaza UUID malformados.
Esta fase no agrega CRUD remoto de mascotas ni expone recursos de negocio.

## Integración móvil

- El cliente HTTP centralizado está en `mobile/src/auth/apiClient.ts`; adjunta
  access tokens, coordina refresh concurrente dentro del proceso y reintenta
  una vez tras un `401`.
- Registro y login persisten el conjunto de tokens en una sola entrada.
- En Android/iOS se usa `expo-secure-store` (`~58.0.2`, coincidente con Expo
  SDK 58 instalado). Esta protección la ofrece el almacén seguro del SO; no
  equivale a cifrar SQLite.
- Expo Web no ofrece las mismas garantías de SecureStore en esta integración.
  Se usa `sessionStorage` por pestaña: es accesible a JavaScript y vulnerable
  ante XSS en el origen, y no debe describirse como almacenamiento seguro.
- El Provider intenta restaurar/rotar la sesión al abrir la app. Si la API no
  está disponible, muestra el error en Perfil; no bloquea mascotas, cuidados,
  calendario ni SQLite local.
- La sesión central no adopta el `account_id` provisional de SQLite. No se
  migraron ni asociaron datos y no se cambió ninguna tabla ni registro local.
- `EXPO_PUBLIC_API_URL` contiene solo la URL pública del servidor, nunca
  credenciales. Para un dispositivo físico, debe ser la IP LAN accesible de la
  máquina de desarrollo, no `localhost`; producción debe usar HTTPS.

## Variables de entorno

API:

| Variable | Requisito |
|---|---|
| `DATABASE_URL` | URL PostgreSQL requerida, validada centralmente. |
| `AUTH_ACCESS_TOKEN_SECRET` | Secreto aleatorio de al menos 32 bytes; no reutilizar el placeholder. |
| `NODE_ENV`, `PORT`, `HOST`, `CORS_ORIGINS` | Variables ya documentadas en la Fase 2. |

Crear el secreto localmente y guardarlo solo en `api/.env` o en el gestor de
secretos del despliegue:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

En Expo, configurar `EXPO_PUBLIC_API_URL` antes de iniciar Metro. Es una URL
pública, no un lugar para claves secretas.

## Migración

Se añadió `api/src/db/migrations/0004_auth_refresh_token_history.ts`:

- Añade `auth_sessions.updated_at`.
- Crea `auth_refresh_tokens`, con hashes únicos, expiración,
  `consumed_at` y `revoked_at`.
- Copia a la tabla nueva los hashes de sesión existentes para permitir
  revocación/rotación coherente después de aplicar la migración.
- No modifica las migraciones 0001–0003 y **no se ejecutó**.

Antes de habilitar auth en un entorno, revisar y aplicar la migración en una
base de desarrollo autorizada. El servidor no aplica migraciones al arrancar.

## Pruebas y verificaciones

| Verificación | Resultado |
|---|---|
| Typecheck API | Aprobado. |
| Build API | Aprobado; incluye herramientas DB y nueva migración. |
| Pruebas API | Aprobadas: 16 pruebas con stores mock. Cubren registro, duplicados, validación, login, tokens inválidos/expirados, refresh válido/expirado, rotación, replay, revocación, logout, ausencia de autenticación, aislamiento por dos propietarios y rate limit. |
| Typecheck móvil | Aprobado. |
| Expo install check | Aprobado; SecureStore compatible con Expo SDK 58. |
| Expo Doctor | Aprobado, 20/20 verificaciones. |
| Expo export Web | Aprobado. |
| Expo export Android | Aprobado; Metro descartó una caché no compatible y completó un full crawl. |
| Expo export iOS | Aprobado. |
| Audit producción API | 0 vulnerabilidades reportadas. |
| Audit árbol móvil | 5 moderadas en transitivas de `@expo/cli`/`@expo/fingerprint` (`glob`/`minimatch`); el remedio sugerido por npm requiere `--force` y degradar Expo a 53, por lo que no se aplicó. |
| PostgreSQL/Neon | No conectado; migraciones ni verificaciones remotas ejecutadas. |

Las pruebas usan almacenamiento simulado y no escriben datos en Neon. No
sustituyen una prueba de integración real contra PostgreSQL después de aplicar
la migración a una base desechable.

Las exportaciones son comprobaciones de empaquetado, no pruebas en dispositivos
físicos ni validación de la API desplegada.

## Limitaciones y riesgos pendientes

- El rate limit en memoria se reinicia al reiniciar el proceso y no coordina
  varias réplicas; antes de escalar, cambiar a un store compartido y considerar
  controles de gateway.
- Un token de refresh se rota estrictamente: reintentos de red concurrentes
  desde clientes distintos pueden activar la detección de reutilización. El
  cliente evita concurrencia dentro de su proceso, pero no entre pestañas o
  dispositivos que hayan copiado el mismo estado de sesión.
- En Web `sessionStorage` es una concesión funcional, no protección contra XSS.
  Para producción web, preferir una sesión con cookie `HttpOnly`, `Secure`,
  `SameSite` y protección CSRF, que requeriría diseñar el flujo de cookies.
- No se implementaron verificación de correo, recuperación/cambio de
  contraseña, segundo factor, cierre de todas las sesiones, purga, métricas ni
  integración con proveedor de identidad externo.
- No hay recursos remotos de mascotas que permitan autorización de extremo a
  extremo; el helper owner-scoped es la base reusable para módulos posteriores.
- No se conectó Neon. El esquema realmente desplegado y la migración pendiente
  requieren autorización/prueba independiente antes de habilitar el servidor.
- La instalación de SecureStore notificó cinco vulnerabilidades moderadas en
  el árbol móvil existente. No se ejecutó `npm audit fix` ni actualizaciones
  forzadas como parte de esta fase; se debe revisar el informe de auditoría por
  separado.
