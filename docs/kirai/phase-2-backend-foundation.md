# KIRAI IA — Fase 2: fundación del backend

**Estado:** infraestructura HTTP inicial implementada. No incluye autenticación,
sincronización ni funcionalidades de IA.

## Arquitectura

La API separa la construcción de Express (`src/app.ts`) del ciclo de vida HTTP
(`src/server.ts`). El servidor crea un único `pg.Pool` compartido, pero no abre
una conexión hasta que se ejecuta una consulta. Arrancar el proceso no ejecuta
migraciones. El cierre por `SIGINT` o `SIGTERM` deja de aceptar solicitudes y
cierra el pool.

Las rutas de infraestructura viven en `src/routes/system.ts`; la carpeta
`src/modules/` queda reservada para futuros módulos de negocio. La configuración
se valida en `src/config/env.ts`. El módulo PostgreSQL de migraciones y
verificación conserva su estructura y comandos; sus scripts reutilizan ahora
la validación compartida de `DATABASE_URL`.

## Estructura

```text
api/
├── .env.example
├── package.json
├── tsconfig.json
├── src/
│   ├── app.ts
│   ├── server.ts
│   ├── config/
│   │   └── env.ts
│   ├── db/
│   │   ├── pool.ts
│   │   ├── migrate.ts
│   │   ├── verify.ts
│   │   ├── verify-cursor.ts
│   │   └── migrations/          # existente, sin cambios
│   ├── middleware/
│   │   ├── cors.ts
│   │   ├── errors.ts
│   │   ├── requestId.ts
│   │   ├── requestLogging.ts
│   │   └── requireJsonBody.ts
│   ├── observability/
│   │   └── logger.ts
│   └── routes/
│       └── system.ts
└── test/
    └── app.test.ts
```

## Instalación y ejecución

Desde PowerShell, en la raíz del repositorio:

```powershell
npm install --prefix api
Copy-Item api\.env.example api\.env
# Editar api\.env localmente y completar DATABASE_URL sin compartirla.
npm run dev --prefix api
```

El servidor usa `http://127.0.0.1:3000` por defecto. Para verificar el build y
ejecutar la salida compilada:

```powershell
npm run typecheck --prefix api
npm run build --prefix api
npm start --prefix api
```

`npm run dev` usa `tsx watch`; `npm start` ejecuta `dist/server.js`. Los comandos
de migración conservados son `db:migrate`, `db:migrate:status`, `db:verify` y
`db:verify:cursor`.

## Variables de entorno

| Variable | Requerida | Valor/documentación |
|---|---:|---|
| `NODE_ENV` | No | `development`, `test` o `production`; por defecto `development`. |
| `PORT` | No | Entero entre 1 y 65535; por defecto `3000`. |
| `HOST` | No | Host de escucha; por defecto `127.0.0.1`. |
| `DATABASE_URL` | Sí | URL `postgres:`/`postgresql:` con host y base de datos. El ejemplo contiene solo placeholders. |
| `CORS_ORIGINS` | No | Lista separada por comas de orígenes HTTP(S) exactos; vacío deshabilita el acceso CORS desde navegador. |

Una variable obligatoria ausente o inválida produce un error de configuración
que nombra la variable, pero no muestra su valor. El servidor requiere
`DATABASE_URL` al arrancar; aun así, `/health` no consulta PostgreSQL y el
proceso puede arrancar si la base no está disponible. `CORS_ORIGINS` no es un
mecanismo de autenticación ni reemplaza controles de autorización.

Los scripts DB mantienen `dotenv/config` y sus modos de operación actuales,
pero obtienen `DATABASE_URL` mediante el validador compartido. No se conectaron
en esta fase.

## Componentes HTTP

- **Identificador de solicitud:** genera un UUID por solicitud y lo devuelve en
  `X-Request-Id`.
- **Logs:** JSON con nivel, evento, ID, método, patrón de ruta, estado y
  duración. No registra query strings, cuerpos, credenciales, tokens ni errores
  internos. Las rutas no reconocidas se registran como `unmatched`.
- **Errores:** respuesta JSON uniforme con `code`, mensaje público e ID. Los
  errores 5xx se sanitizan; los errores del parser se traducen a respuestas
  controladas.
- **Cuerpo:** solo JSON para solicitudes con body; máximo `1mb`. JSON inválido
  responde `400`, tipo de contenido no soportado `415` y exceso de tamaño `413`.
- **CORS:** permite solo los orígenes configurados. Preflight de origen no
  permitido devuelve `403`. No se habilitan credenciales.
- **Pool PostgreSQL:** pool único con máximo 10 conexiones, timeout de conexión
  de 5 s, timeout de inactividad de 30 s, timeout de sentencia de 5 s y timeout
  de consulta de 6 s. Los errores del pool se registran sin mensaje ni URL.

## Endpoints del sistema

| Método y ruta | Respuesta | Uso |
|---|---|---|
| `GET /health` | `200 {"status":"ok"}` | Liveness del proceso; no accede a PostgreSQL. |
| `GET /ready` | `200` si la consulta `SELECT 1` funciona; `503` si falla. | Readiness, con un resultado genérico que no expone detalles DB. |

Las rutas desconocidas responden `404` con el formato común de error.

## Pruebas y verificaciones

Ejecutado en esta fase:

| Verificación | Resultado |
|---|---|
| `npm run typecheck --prefix api` | Aprobado. |
| `npm run build --prefix api` | Aprobado; también compila las herramientas PostgreSQL existentes. |
| `npm test --prefix api` | Aprobado: 7 pruebas, 0 fallos. |
| `npm ls --depth=0 --prefix api` | Dependencias directas presentes y árbol consistente. |
| `npm audit --omit=dev --prefix api` | 0 vulnerabilidades de producción reportadas. |

Las pruebas HTTP usan el servidor local de Node y un repositorio PostgreSQL
inyectado/falso. Cubren configuración, arranque y cierre del servidor sin
migraciones, `/health`, consulta y fallo controlado de `/ready`, sanitización de
errores, `404`, JSON inválido, tipo de contenido, límite de body, ID de
solicitud y CORS. No se conectaron a Neon ni a otra base real.

No se ejecutó Expo Doctor: no se modificó el cliente móvil, Expo ni sus
dependencias. Las exportaciones de plataformas móviles/Web tampoco aplican a
este cambio backend.

## Dependencias

- `express` 5.x: servidor HTTP y enrutamiento.
- `@types/express` 5.x: tipos de Express para TypeScript.
- No se añadió framework de pruebas ni middleware CORS externo. Las pruebas
  utilizan `node:test`, `fetch` y un servidor local; CORS está limitado a las
  necesidades de esta fase.

Las versiones instaladas concretas se registran en `api/package-lock.json`.

## Decisiones y límites pendientes

- PostgreSQL se consulta solo desde la ruta de readiness en este alcance; no
  hay repositorios ni rutas de negocio.
- No hay autenticación, sesiones HTTP, autorización, rate limiting, CSRF,
  endpoints CRUD, sync ni proveedor/modelo de IA.
- La capa CORS está configurada por allowlist, pero no protege rutas frente a
  clientes no navegador.
- El pool implementa límites de conexión/consulta y cierre; no incluye
  reintentos de consultas ni circuit breaker.
- `/ready` prueba conectividad básica, no valida tablas ni estado de migraciones.
- Las pruebas de readiness simulan tanto éxito como caída. No se validó una
  conexión externa real y no se ejecutaron migraciones.
- Neon, SQLite y la aplicación móvil no fueron modificados.
