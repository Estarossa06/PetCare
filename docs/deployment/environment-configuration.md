# Configuración de entornos

**Estado:** guía documental para la configuración existente y su evolución.
No modifica el runner, archivos de entorno ni configuración de despliegue.

## 1. Objetivo

Definir cómo separar configuración y credenciales de desarrollo local,
pruebas, bases desechables/staging y producción, usando los nombres de
variables que existen hoy en el código. Los ejemplos son ficticios y no
conectan a ningún servicio.

## 2. Entornos

| Entorno | Configuración recomendada | Base de datos y precauciones |
|---|---|---|
| Desarrollo local | Variables API en un archivo local ignorado o variables del proceso; URL del API móvil apuntando al servidor local accesible desde el dispositivo/navegador de desarrollo. | Usar base de desarrollo separada y datos de prueba. En dispositivo físico, `localhost` apunta al dispositivo, no necesariamente al computador que ejecuta la API. |
| Pruebas automatizadas | Los tests unitarios/API actuales construyen configuración explícita con `NODE_ENV=test`, URL ficticia y secreto de prueba, y usan un store en memoria; no requieren una conexión PostgreSQL real. | No reutilizar credenciales de desarrollo ni producción. Las pruebas que verifican DDL/constraints requieren una base PostgreSQL desechable y son pruebas con escritura. |
| Base desechable o staging | Variables inyectadas por el entorno de ejecución o un archivo local protegido fuera del control de versiones; configuración equivalente a production en cuanto a validación, con secretos aislados. | Confirmar nombre/base destino y permisos antes de ejecutar migraciones o pruebas con fixtures. No usar datos de usuarios reales en fixtures. |
| Producción | Configurar variables mediante el mecanismo de secretos del proveedor del backend; no desplegar archivos `.env`. Mantener una configuración distinta para cada entorno. | `DATABASE_URL` debe apuntar únicamente a la base de producción prevista. Migraciones requieren un proceso de despliegue aprobado; pruebas con fixtures no se ejecutan en producción. |

## 3. Variables existentes

La configuración de runtime se parsea en `api/src/config/env.ts`. El
proyecto también tiene variables operativas y una URL pública del API móvil
fuera de ese parser.

| Variable | Componente/uso | Obligatoria | Valor de ejemplo ficticio / comportamiento |
|---|---|---:|---|
| `NODE_ENV` | API; restringe el valor a `development`, `test` o `production`. | No; por defecto `development`. | `NODE_ENV=development` |
| `PORT` | API; puerto TCP del servidor. Debe ser entero de 1 a 65535. | No; por defecto `3000`. | `PORT=3000` |
| `HOST` | API; host de escucha. | No; por defecto `127.0.0.1`; se rechazan espacios. | `HOST=127.0.0.1` |
| `DATABASE_URL` | API y scripts de migración/verificación; URL PostgreSQL requerida. | Sí para la API y herramientas DB. Debe usar esquema `postgres:` o `postgresql:`, host y nombre de base. | `DATABASE_URL=postgresql://petcare_dev:fake-password@db.example.invalid:5432/petcare_dev?sslmode=require` |
| `AUTH_ACCESS_TOKEN_SECRET` | API; secreto simétrico para firmar/verificar access tokens. Se carga como bytes UTF-8 y debe tener al menos 32 bytes. | Sí. | `AUTH_ACCESS_TOKEN_SECRET=replace-this-fake-value-with-a-random-secret-32-bytes-minimum` |
| `CORS_ORIGINS` | API; lista separada por comas de orígenes HTTP(S) permitidos. El parser exige un origin sin path ni credenciales. | No; vacío se interpreta como lista vacía. | `CORS_ORIGINS=http://localhost:8098,http://127.0.0.1:8098` |
| `KIRAI_OLLAMA_BASE_URL` | Adaptador KIRAI Ollama; URL base local. Solo se acepta HTTP en `127.0.0.1`, `localhost` o `[::1]`, sin credenciales/ruta/query. | No; `http://127.0.0.1:11434`. | `KIRAI_OLLAMA_BASE_URL=http://127.0.0.1:11434` |
| `KIRAI_OLLAMA_MODEL` | Adaptador KIRAI Ollama; nombre del modelo local. | No; `qwen3:8b`. | `KIRAI_OLLAMA_MODEL=qwen3:8b` |
| `KIRAI_OLLAMA_TIMEOUT_MS` | Adaptador KIRAI Ollama; timeout HTTP en milisegundos. | No; `60000`; rango permitido 1–300000. | `KIRAI_OLLAMA_TIMEOUT_MS=60000` |
| `PET_VISION_OLLAMA_BASE_URL` | Ollama para identificación visual. Solo admite loopback HTTP. | No; `http://127.0.0.1:11434`. | `PET_VISION_OLLAMA_BASE_URL=http://127.0.0.1:11434` |
| `PET_VISION_OLLAMA_MODEL` | Modelo Ollama de visión. | No; `qwen2.5vl:7b`. | `PET_VISION_OLLAMA_MODEL=qwen2.5vl:7b` |
| `PET_VISION_TIMEOUT_MS` | Timeout de inferencia visual. | No; `90000`; rango 1–300000. | `PET_VISION_TIMEOUT_MS=90000` |
| `R2_ACCOUNT_ID` | Cuenta/endpoint S3 de Cloudflare R2, backend solamente. | Opcional; todas las variables R2 deben configurarse juntas. | Se deja vacío en ejemplos; usa bucket privado y token de mínimo privilegio. |
| `R2_BUCKET` | Nombre del bucket R2, backend solamente. | Opcional junto al resto de R2. | En despliegue de prueba el bucket debe ser el asignado para pruebas; no incorporar credenciales al móvil. |
| `R2_ACCESS_KEY_ID` | Clave de acceso R2 del backend. | Opcional junto al resto de R2. | Secreto; nunca usar en `EXPO_PUBLIC_*`. |
| `R2_SECRET_ACCESS_KEY` | Secreto R2 del backend. | Opcional junto al resto de R2. | Secreto; nunca usar en `EXPO_PUBLIC_*`. |
| `TRACCAR_URL` | Base HTTPS del servidor Traccar. HTTP solo se admite para loopback fuera de producción. | Opcional; se requiere junto a `TRACCAR_TOKEN`. | Debe apuntar al servidor administrado; el cliente móvil solo llama a PetCare API. |
| `TRACCAR_TOKEN` | Token API Traccar mantenido en backend. | Opcional; se requiere junto a `TRACCAR_URL`. | Usa permisos mínimos y restringe el token a dispositivos autorizados. |
| `PETCARE_TEST_DATABASE_URL` | Solo integración PostgreSQL; suites comprueban el nombre exacto `petcare_test`. | Opcional fuera de pruebas DB. | Nunca apunta a desarrollo compartido o producción. |
| `PETCARE_RUN_AUTH_DB_TESTS` | Habilita integraciones PostgreSQL de auth/pets/sync/domain/KIRAI y ciclo de cuenta. | No; requiere valor `1` y URL de test. | Solo `petcare_test`. |
| `PETCARE_RUN_KIRAI_DB_TESTS` | Habilita integración KIRAI/PostgreSQL simulada. | No; requiere valor `1` y URL de test. | Solo `petcare_test`. |
| `PETCARE_RUN_MEDIA_DB_TESTS` | Habilita integración de metadata/API de archivos con store de test. | No; requiere valor `1` y URL de test. | Solo `petcare_test`; no significa que use R2 real. |
| `PETCARE_RUN_DB_CHECKS` | Scripts `db:verify` y `db:verify:cursor`; guard para permitir ejecutar los verificadores de base. | No para runtime. Es necesaria con valor exacto `1` para esos verificadores. | `PETCARE_RUN_DB_CHECKS=1` — habilita verificadores que escriben fixtures y los limpian; usar solo con base desechable autorizada. |
| `EXPO_PUBLIC_API_URL` | Cliente Expo; URL base HTTP(S) del API que se incorpora al bundle móvil/web. No es una credencial. | Sí al usar el cliente HTTP autenticado. | `EXPO_PUBLIC_API_URL=http://localhost:3000` para un navegador local; dispositivos físicos necesitan un host accesible desde ellos. |

La tabla no implica que el cliente móvil pueda conectarse a PostgreSQL. La
única variable de URL pública en el cliente es la dirección HTTP(S) del API.
`EXPO_PUBLIC_API_URL` es pública por diseño de Expo y no debe contener
contraseñas, tokens ni claves privadas. Ollama, R2 y Traccar solo se consumen
desde procesos backend. Ollama availability se comprueba al usar KIRAI o
identificación, no como prueba de distribución del modelo.

### KIRAI, visión y proveedores externos

KIRAI usa `KIRAI_OLLAMA_*`; visión usa `PET_VISION_OLLAMA_*`. Son
configuraciones separadas, aunque pueden compartir un mismo daemon Ollama.
Traccar debe estar configurado con `TRACCAR_URL` y `TRACCAR_TOKEN`; cada
dispositivo Traccar debe tener el atributo `petcareOwnerId` igual al UUID de
la cuenta PetCare autorizada. Si falta esa relación, la API rechaza la
asociación/lectura de posiciones. R2 es opcional, pero se configura con las
cuatro variables simultáneas y únicamente en API.

## 4. Ubicación y carga de archivos

### Comportamiento actual

Los puntos de entrada de API y herramientas DB importan `dotenv/config`.
`dotenv` busca por defecto un archivo `.env` relativo al directorio de trabajo
actual del proceso; no localiza automáticamente un `.env` raíz cuando el
proceso se ejecuta con el directorio de trabajo `api/`.

La guía de base de datos, `api/.env.example` y el mensaje de error del parser
indican usar `api/.env`. Durante la verificación de Fase 4.3 se encontró un
`.env` en la raíz y no se encontró `api/.env`; cargar manualmente la URL del
archivo raíz confirmó que el destino era `petcare_db`, pero esa carga manual
no es el comportamiento automático de los scripts. Las dos ubicaciones no son
equivalentes.

Los procesos suelen heredar las variables ya definidas en su entorno. `dotenv`
no reemplaza por defecto una variable preexistente con el contenido del
archivo. El resultado depende del directorio de trabajo y del entorno de
proceso.

### Estrategia única propuesta

1. Para desarrollo local, usar `api/.env`, creado a partir de
   `api/.env.example`, y ejecutar scripts de API con el directorio de trabajo
   establecido en `api/` (también al invocarlos desde el monorepo).
2. Para pruebas automatizadas, inyectar explícitamente valores ficticios y
   aislados en el proceso de test; no cargar credenciales de un entorno
   compartido.
3. Para CI, staging y producción, inyectar variables mediante el entorno
   protegido del runner/proveedor; no depender de archivos `.env` desplegados.
4. Considerar el `.env` raíz no canónico para la API. No mover, copiar,
   editar ni eliminarlo como parte de esta guía.

Esta estrategia es una recomendación documental. En esta tarea no se cambia
el `cwd`, el runner, `dotenv`, ni ningún archivo de entorno. Si se quisiera
permitir varias ubicaciones, sería necesario implementar y probar una regla
explícita de precedencia; hoy no se documenta como funcionalidad existente.

## 5. Seguridad

- Los archivos `.env` con credenciales nunca se suben a Git. El `.gitignore`
  actual excluye `.env`, `api/.env` y `api/.env.*`, y conserva
  `api/.env.example`.
- Mantener los ejemplos sin secretos reales; usar hosts reservados como
  `example.invalid` y contraseñas inequívocamente ficticias.
- No incluir `DATABASE_URL`, tokens de sesión ni claves privadas en la app
  móvil o sus bundles. Variables `EXPO_PUBLIC_*` son visibles al cliente.
- No registrar contraseñas, access/refresh tokens, cadenas de conexión ni
  payloads sensibles. Los mensajes de error deben evitar datos de conexión.
- Si una credencial real se expone, revocarla/rotarla en el proveedor y
  actualizar cada entorno afectado. Eliminarla del archivo actual no invalida
  una credencial ya comprometida.
- Usar el almacén de secretos del proveedor para staging y producción, limitar
  permisos y habilitar rotación cuando el proveedor lo soporte.
- Separar secretos, usuarios y bases para desarrollo, pruebas, staging y
  producción. No compartir credenciales entre entornos.
- CORS no reemplaza autenticación ni autorización; la API debe seguir
  aplicando identidad y ownership a toda operación protegida.

## 6. Conexión con Neon y operaciones de base

La API construye un pool `pg` con `DATABASE_URL`; el móvil solo llama al API.
En Neon, el backend debe usar la URL de conexión asignada al entorno correcto
y el transporte seguro recomendado por el proveedor. La cadena completa solo
debe existir en un secret store o en el archivo local ignorado.

Antes de ejecutar una migración o una prueba con escritura:

1. Verificar de forma segura que el secreto asignado corresponde al entorno y
   nombre de base esperados; no imprimir la URL completa.
2. Comprobar el nombre actual de base y el estado de migraciones con una
   revisión autorizada.
3. Confirmar backup/recuperación y ventana de despliegue según el proceso
   operativo del entorno.
4. Probar primero en una base desechable desde cada versión de esquema
   soportada.
5. Detenerse ante historial desconocido, checksum discrepante o destino
   ambiguo. No inferir el entorno por el hostname solamente.

Las clases de operación no son intercambiables:

| Operación | Efectos | Regla de uso |
|---|---|---|
| Consulta de solo lectura | Lee catálogos, historial o datos; no debe contener DDL ni DML. | Confirmar base y permisos read-only. Una transacción marcada `READ ONLY` ayuda a impedir escrituras SQL, pero no sustituye la comprobación del destino. |
| Consulta de escritura | Puede cambiar filas, secuencias u otro estado. | Solo sobre entorno autorizado; usar límites, transacción y revisión apropiados. |
| Migración (`db:migrate`) | Ejecuta DDL de cada migración pendiente y registra checksum/historial. El runner usa advisory lock y transacciones por migración. | Operación de escritura. Confirmar destino y estado; nunca ejecutar casualmente contra producción. No editar una migración ya aplicada. |
| Estado (`db:migrate:status`) | Lee historial y compara nombre/checksum, pero el runner también adquiere un advisory lock de PostgreSQL. | No ejecuta DDL/DML del proyecto, pero adquiere un lock de sesión. Ejecutar solo con configuración/destino confirmados; una inspección SQL read-only autorizada es alternativa si no se desea adquirirlo. |
| Verificadores (`db:verify`, `db:verify:cursor`) | Insertan fixtures de usuarios/entidades, ejercitan restricciones/concurrencia y ejecutan limpieza o rollback; exigen `PETCARE_RUN_DB_CHECKS=1`. | Son pruebas con escritura, aunque intenten limpiar los fixtures. Solo en base desechable, nunca en producción ni en Neon compartido sin aprobación expresa. |

El estado reportado en [verificación Neon Fase 4.3](../sync/phase-4-3-neon-verification.md)
fue 0001–0003 aplicadas con checksums coincidentes y 0004 pendiente en la
revisión del 10 de noviembre de 2026. **No se volvió a consultar Neon para
crear esta guía**; ese estado puede cambiar y debe revalidarse antes de
cualquier operación.

Actualización del 16 de noviembre de 2026: se comprobó el ledger y los
checksums en `petcare_db`; 0001–0003 estaban aplicadas y 0004 pendiente.
Después de una inspección de solo lectura que confirmó cero sesiones existentes,
se aplicó la migración 0004 existente y `db:migrate:status` confirmó las cuatro
versiones aplicadas con checksums coincidentes. Esta actualización no modifica
el informe histórico de Fase 4.3. La prueba de autenticación PostgreSQL sigue
pendiente de ejecutarse en una base desechable identificada como test.

## 7. KIRAI y manejo de datos

KIRAI funciona mediante Ollama detrás de la API. Las conversaciones y mensajes
se persisten por propietario; los logs excluyen contenido, tokens y respuestas
del modelo. Se envía al modelo contexto limitado de datos de la cuenta y del
dispositivo autenticado. El proveedor debe permanecer en loopback del backend;
no expongas el API Ollama a la red pública ni configures su URL en Expo.

Las respuestas pueden ser incorrectas y no constituyen diagnóstico ni
prescripción veterinaria. Las funciones de salud urgente deben remitir a
atención profesional. Para producción se requiere monitorizar disponibilidad,
latencia/memoria del modelo, límites, privacidad y retención de conversaciones.

## Referencias del repositorio

- [Configuración API](../../api/src/config/env.ts)
- [Runner de migraciones](../../api/src/db/migrate.ts)
- [Ejemplo de entorno API](../../api/.env.example)
- [Cliente HTTP móvil](../../mobile/src/features/auth/apiClient.ts)
- [Configuración de base de datos](../database-setup.md)
- [Estado verificado en Fase 4.3](../sync/phase-4-3-neon-verification.md)
