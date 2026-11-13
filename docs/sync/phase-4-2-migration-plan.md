# PetCare — Fase 4.2: auditoría y plan de migraciones para sincronización

**Fecha:** 10 de noviembre de 2026  
**Estado:** auditoría estática y propuesta; no implementada.  
**Referencias:** [auditoría de persistencia](./phase-4-audit.md) y
[diseño de sincronización Fase 4.1](./phase-4-1-sync-design.md).  
**Límites:** se inspeccionó el código versionado. No se conectó a Neon, no se
consultó una base de datos, no se ejecutaron migraciones y no se modificaron
datos.

## 1. Resumen ejecutivo

El repositorio registra cuatro migraciones PostgreSQL, numeradas 0001–0004.
La 0004, `auth_refresh_token_history`, está incluida en el registro local de
migraciones; su aplicación en Neon es **desconocida**. El esquema remoto
versionado ya contiene usuarios/sesiones, mascotas, historial médico,
adjuntos, cuidados, citas, recordatorios legacy, tablas de KIRAI y soporte
estructural de sincronización. No hay servicios ni endpoints de sincronización
que utilicen esas tablas.

Las brechas PostgreSQL que bloquean el alcance inicial del diseño 4.1 son:

1. Faltan columnas de SQLite en `health_records` y `care_tasks`.
2. No existe `care_task_executions`.
3. No existen `calendar_events` ni `calendar_reminders`.
4. El `CHECK` de `sync_changes.entity_type` no admite `care_execution`,
   `calendar_event` o `calendar_reminder`.
5. El estado de dispositivo no registra la versión/plataforma de cliente.
   Se adopta `sync_imports` para registrar preview, consentimiento y estado
   de importación, y `sync_conflicts` para los metadatos de conflicto. Ninguna
   de esas tablas almacenará snapshots médicos.
6. La versión local no equivale al `version` positivo remoto; PostgreSQL puede
   conservar `version` como contador canónico, mientras SQLite debe separar
   `local_revision`/`server_version`.

La tabla legacy `reminders` no representa el modelo móvil de calendario. Se
mantendrá separada de `calendar_reminders` durante la primera versión. Una
búsqueda estática de `api/src` encontró su DDL en 0001 y su nombre en el
verificador de esquema, pero no consultas o servicios de aplicación. En móvil,
el esquema inicial aún la define y una tabla de notificación antigua la
referencia; no se encontraron operaciones de repositorio que la usen. En
cambio, los repositorios actuales de calendario operan con
`calendar_reminders`. Se conservará `reminder` en el esquema y el feed por
compatibilidad, pero el tipo se excluirá de la allowlist de la API inicial.
No se migrará, eliminará ni reutilizará la tabla legacy en esta fase.

## 2. Método y grado de certeza

Se revisaron:

- Migraciones PostgreSQL 0001–0004 y su índice de registro.
- Migrador, comandos de package, verificador de esquema y verificador de
  cursores.
- Migraciones SQLite 0001–0005, con foco en salud, cuidados, agenda y
  restricciones de recordatorio.
- Referencias a `reminders`/`calendar_reminders` en `api/src` y `mobile/src`.
- Documentos de auditoría Fase 4 y diseño Fase 4.1.

Las etiquetas de este informe significan:

- **EXISTENTE EN CÓDIGO:** el esquema o comando está registrado localmente.
- **USO LOCAL CONFIRMADO:** se encontró una llamada/repository/query en el
  código inspeccionado.
- **SIN USO DE APLICACIÓN ENCONTRADO:** búsqueda estática no encontró un
  consumidor; no demuestra que nunca existan datos o consumidores externos.
- **PENDIENTE DE VERIFICACIÓN:** depende del estado desplegado en Neon o de
  inventario de datos que no se hizo.
- **PROPUESTO:** cambio futuro, no existente ni autorizado.

La migración `0001_core` y las siguientes describen el esquema que el
repositorio intentaría crear. No son evidencia de que ese esquema esté aplicado
en Neon.

## 3. Estado actual de migraciones PostgreSQL

| Versión | Nombre registrado | Contenido relevante | Estado en Neon |
|---|---|---|---|
| 0001 | `core` | `users`, `auth_sessions`, `pets`, `health_records`, `health_attachments`, `care_tasks`, `appointments`, `reminders`, `ai_conversations`, `ai_messages`; claves de owner, checks e índices. | Pendiente de verificación. |
| 0002 | `sync_support` | `sync_devices`, `sync_operations`, `sync_changes`; receipt idempotente por usuario/operación y feed con cursor inicialmente global. | Pendiente de verificación. |
| 0003 | `ordered_sync_cursors` | `sync_cursors`; cursor por owner; convierte el PK del feed a `(owner_id,cursor)` y reordena valores existentes por propietario. | Pendiente de verificación. |
| 0004 | `auth_refresh_token_history` | `auth_sessions.updated_at`, nueva `auth_refresh_tokens`, índice único de hash e índice por sesión; copia a historial los hashes actuales. | Pendiente de verificación. |

`api/src/db/migrations/index.ts` registra las cuatro en ese orden. No hay
migración 0005 en el código inspeccionado.

### Cómo comprobar 0004 de manera autorizada, sin aplicar migraciones

El migrador implementa `npm run db:migrate:status`. Lee `schema_migrations`,
compara `version`, `name` y checksum calculado del `up` registrado, e imprime
`Applied`/`Pending`. Para usarlo hace falta una conexión; el comando obtiene
`DATABASE_URL` y toma un advisory lock de PostgreSQL, aunque la ruta `status`
no llama `up` ni ejecuta DDL de migraciones. **No se ejecutó aquí**, por la
restricción de no conectarse a Neon.

Después de autorización explícita y confirmación de que la URL corresponde al
ambiente esperado, se puede verificar el registro con `db:migrate:status` (no
con `db:migrate up`). Una comprobación de solo lectura más directa puede
consultar, en la base destino, la fila de versión 4 y los catálogos de
`auth_refresh_tokens` y `auth_sessions.updated_at`; también debe compararse el
checksum/nombre con el código local. La mera existencia de la tabla no prueba
que se ejecutó exactamente esa migración; la sola fila de historial tampoco
detecta drift manual del esquema.

No usar `db:verify` ni `db:verify:cursor` como comandos de comprobación de
estado en Neon: requieren `PETCARE_RUN_DB_CHECKS=1`, escriben fixtures y los
revierten/limpian; no son herramientas de solo lectura. Ejecutarlos solo
contra una base desechable y autorizada.

## 4. Esquema PostgreSQL existente en el código

### 4.1 Identidad y dominio

| Tabla | Definición actual del repositorio | Restricciones/índices destacables |
|---|---|---|
| `users` | UUID, email, password hash, nombre, timestamps y `deleted_at`. | Email lower-case/no vacío y único; las referencias de dominio usan `ON DELETE RESTRICT`. |
| `auth_sessions` | Usuario, hash de refresh actual, expiración, revocación y creación. | FK usuario restrictiva; índice parcial de sesiones activas. La 0004 agrega `updated_at`. |
| `auth_refresh_tokens` | En 0004: session, hash, expiración, consumed/revoked y creación. | FK a sesión con `ON DELETE CASCADE`, hash no vacío, expiración posterior a creación, hash único y `(session_id,created_at DESC)`. La migración copia el hash/expiración/estado actual de cada sesión. |
| `pets` | Campos base de mascota, `owner_id`, `version > 0`, timestamps y tombstone. | `UNIQUE(owner_id,id)`, checks de nombre/especie/sexo/edad/peso/version; índice `(owner_id,updated_at DESC)`. |
| `health_records` | Pet, tipo, título, descripción, fecha, profesional, versión y tombstone. | FK compuesta owner/pet restrictiva; tipo enumerado; claves únicas owner/id y owner/id/pet; índice por mascota/fecha. |
| `health_attachments` | Metadata y `storage_key`; no `local_uri` ni bytes. | FK compuesta a registro/mascota/owner; restricciones de nombre/MIME/size/version; índice por registro. Está en el esquema, aunque Fase 4.1 excluye adjuntos del primer protocolo. |
| `care_tasks` | Tipo, título/notas, `recurrence_rule`, timezone, inicio, enabled, version y tombstone. | FK owner/pet restrictiva; únicos owner/id y owner/id/pet; tipo limitado; índice parcial para tareas activas. |
| `appointments` | Mascota, título, inicio/fin, ubicación, notas, estado, versión y tombstone. | FK owner/pet restrictiva; uniques owner/id y owner/id/pet; fin posterior al inicio; status enum; índice parcial owner/pet/start. |
| `reminders` | Ver §5. | Relaciones composite con mascota y sus targets existentes; índice parcial para pendientes. |
| `ai_conversations`, `ai_messages` | Tablas de conversación/mensajes asociadas a mascota y propietario. | FKs owner-aware y versión/tombstone; no forman parte del sync inicial según 4.1. |

Las tablas de dominio ya tienen `version` positiva y columnas `deleted_at`.
Esto no implementa por sí solo el compare-and-swap ni la propagación de
tombstones. En PostgreSQL se propone conservar la columna `version` como
versión autoritativa (el DTO puede llamarla `server_version`); no añadir una
segunda columna remota `server_version` sin una necesidad distinta.

### 4.2 Soporte de sincronización

| Tabla | Estado actual |
|---|---|
| `sync_devices` | `id`, `user_id`, nombre opcional, `last_download_cursor`, `last_seen_at`, `revoked_at`, timestamps. Unique `(user_id,id)` y cursor no negativo. No contiene platform ni versión de app/esquema. |
| `sync_operations` | PK `(user_id,operation_id)`, hash de solicitud de 64 caracteres, respuesta JSONB objeto y `processed_at`; índice por fecha. Es estructura de idempotencia, no existe consumidor API. No define retención ni purga automática. |
| `sync_changes` | Feed con `owner_id`, `cursor`, tipo/ID de entidad, versión, operation ID opcional, tipo de cambio, campos cambiados y hora. La 0002 admite `pet`, `health_record`, `health_attachment`, `care_task`, `appointment`, `reminder`, `ai_conversation`, `ai_message`; excluye las tres entidades nuevas locales. Desde 0003 PK `(owner_id,cursor)`, cursor por owner y sin identity global. |
| `sync_cursors` | Fila por propietario y contador monotónico no negativo, usado para asignar cursores ordenados dentro de transacciones. |
| `sync_conflicts` | No hay tabla server-side en migraciones. SQLite sí tiene `sync_conflicts`. Se adopta crearla para conservar metadatos de conflicto y resolución server-side; sin snapshots ni payloads médicos. |
| `sync_imports` | No existe en PostgreSQL. Se adopta para registrar preview, consentimiento explícito y estado durable de importación; manifest/hash sin PHI. |

El `CHECK` de `sync_changes` limita qué valores se pueden guardar, pero no es
un contrato API ni autorización. El endpoint futuro debe aplicar su propia
allowlist; para el alcance inicial, KIRAI y adjuntos no deben activarse solo
porque algunos tipos ya aparecen en el `CHECK` actual.

## 5. Análisis detallado de `reminders`

### 5.1 PostgreSQL: columnas y constraints (0001)

`reminders` se crea en `0001_core` con:

| Columna | Tipo/nullable | Valor/default o significado |
|---|---|---|
| `id` | UUID, PK | `gen_random_uuid()` por defecto. |
| `owner_id` | UUID, no nulo | Referencia lógica al usuario a través de FKs composite. |
| `pet_id` | UUID, no nulo | Toda fila legacy está asociada a una mascota. |
| `care_task_id` | UUID, nullable | Target de cuidado. |
| `appointment_id` | UUID, nullable | Target de cita. |
| `title` | text, no nulo | Requerido y no vacío después de trim. |
| `due_at` | timestamptz, no nulo | Hora de vencimiento/recordatorio. |
| `timezone` | text, no nulo | Default `UTC`, no vacío. |
| `status` | text, no nulo | Default `pending`; valores `pending`, `completed`, `cancelled`. |
| `notes` | text, nullable | Nota opcional. |
| `version` | integer, no nulo | Default 1; debe ser > 0. |
| `created_at`, `updated_at` | timestamptz, no nulos | Defaults `now()`. |
| `deleted_at` | timestamptz, nullable | Tombstone. |

Constraints e índices:

- FK `(owner_id,pet_id)` → `pets(owner_id,id)`, `ON DELETE RESTRICT`.
- FK `(owner_id,care_task_id,pet_id)` → `care_tasks(owner_id,id,pet_id)`,
  restrictiva.
- FK `(owner_id,appointment_id,pet_id)` → `appointments(owner_id,id,pet_id)`,
  restrictiva.
- `UNIQUE(owner_id,id)`.
- `reminders_single_source` es
  `care_task_id IS NULL OR appointment_id IS NULL`. Evita que ambos targets
  estén presentes a la vez, pero **permite que ambos sean NULL**; por tanto no
  garantiza exactamente un target.
- Checks de título, timezone, status y versión.
- Índice parcial `(owner_id,pet_id,due_at)` para `status='pending'` y
  `deleted_at IS NULL`.

No hay target de evento de calendario ni registro médico. Tampoco hay
`lead_minutes`, `enabled`, estado `attended` o forma de recordatorio general
sin mascota.

### 5.2 SQLite y uso real encontrado

- SQLite `0001_initial` crea una tabla `reminders` casi homónima, con las
  mismas dos columnas target opcionales y el mismo check que no exige
  exactamente un target. Las FKs son owner/pet-aware.
- Esa migración crea también `scheduled_notifications`, que referencia
  `reminders(id)` con `ON DELETE CASCADE`.
- La tabla/servicios nuevos de calendario se crean en SQLite 0004:
  `calendar_events`, `calendar_reminders`,
  `calendar_scheduled_notifications`. SQLite 0005 agrega triggers para
  comprobar que `pet_id` del recordatorio coincide con el de su target.
- La búsqueda estática en `mobile/src` no encontró consultas CRUD a la tabla
  legacy `reminders`; sí encontró el esquema, el verificador de tablas y la
  FK de `scheduled_notifications`. El repositorio de calendario usa de forma
  explícita `calendar_reminders` y
  `calendar_scheduled_notifications`.
- En `api/src`, `reminders` aparece en `0001_core` y en la lista de tablas
  esperadas por `db/verify.ts`; no se encontraron servicios o consultas de
  negocio. El verificador revisa presencia de tablas/índices/constraints
  generales; no es consumidor funcional ni prueba la semántica del recordatorio.

“Sin uso de aplicación encontrado” no prueba que una instancia real carezca de
filas, que no exista una versión móvil antigua ni que no haya consumidores
externos. El inventario requiere acceso autorizado al entorno antes de
cualquier decisión de migración.

### 5.3 Diferencia con `calendar_reminders`

| Semántica | `reminders` legacy | `calendar_reminders` local |
|---|---|---|
| Target | Tarea o cita; por el CHECK pueden ser ambos nulos. | Exactamente uno de evento, tarea, cita o registro médico. |
| Mascota | Obligatoria. | Nullable para eventos generales; para target pet-scoped debe coincidir con `pet_id` del target. |
| Hora | `due_at`. | `remind_at`; timezone y `lead_minutes` opcional. |
| Estado | pending/completed/cancelled. | pending/attended/cancelled. |
| Habilitación | No tiene `enabled`. | Tiene `enabled`. |
| Tombstone/version | Sí; PostgreSQL empieza en version 1 y SQLite en 0. | Sí; SQLite version 0 por defecto. |
| Notificación de SO | `scheduled_notifications` local referencia el reminder legacy. | `calendar_scheduled_notifications` local referencia el reminder de calendario. |
| CRUD actual encontrado | No se encontró en repositorios/servicios. | Usado por `calendarRepository`, `calendarService` y lógica de notificación local. |

No se deben copiar `calendar_reminders` a `reminders` ni renombrar una tabla
para que encaje. Eso perdería campos/estados, targets, reminders múltiples por
evento y casos generales sin mascota; además rompe FKs de notificaciones y
puede producir duplicados entre agenda de dominio y notificaciones del SO.

### 5.4 Opciones y recomendación

1. **Mantener ambas tablas separadas durante la primera sincronización
   —decisión adoptada.** No modificar ni migrar datos de `reminders`; añadir
   una tabla PostgreSQL `calendar_reminders` que represente el modelo local.
2. **Conservar `reminder` en `sync_changes`, excluido de la allowlist de API
   inicial —decisión adoptada.** La presencia del tipo en el CHECK es
   compatibilidad de esquema y no habilita push/pull legacy.
3. **Migrar legacy a calendar reminders —no se hará en v1.** Requeriría
   mapear target/estado/hora, resolver filas con ambos targets nulos, decidir
   duplicados y actualizar dependencias; no hay una conversión 1:1 segura.
4. **Reemplazar/eliminar `reminders` —no se hará en esta fase.** Riesgo de
   pérdida en Neon, consumidores no encontrados, verificadores, builds
   móviles antiguos y dependencias locales de `scheduled_notifications`.
5. **Usar legacy para todos los recordatorios —descartado.** El schema no
   soporta eventos/registro médico, target exactly-one, mascota opcional,
   `lead_minutes`, `enabled` ni estado attended.

Antes de una eventual deprecación: consultar aplicación desplegada autorizada,
contar y clasificar filas por target/estado/tombstone, identificar dispositivos
y versiones consumidoras, inventariar claves/constraints reales, planear copia
de seguridad y preparar reconciliación verificable. No borrar ni cambiar
constraints en esa investigación.

## 6. Comparación PostgreSQL vs. SQLite según el diseño 4.1

| Entidad/dominio | PostgreSQL en migraciones | SQLite/modelo local | Cambio remoto requerido |
|---|---|---|---|
| Mascotas | Tabla base completa, FK owner y version positiva/tombstone. | UUID local, owner provisional, versión local actual no autoritativa. | No se identifica una columna de dominio faltante. Requiere servicio owner-scoped y CAS de `version`, fuera de esta fase documental. |
| Historial médico | Campos base, enum de `record_type`, versión/tombstone. No `record_subtype`, clínica, observaciones, JSON details ni próxima fecha. | 0002 agrega `clinic_name`, `observations`, `details_json`, `next_event_at`, `record_subtype='exam'`. | Añadir las columnas y tipos compatibles; conservar `record_type='observation'` + subtype `exam` o aprobar un modelo alternativo. Índice parcial upcoming si se consulta remoto. |
| Adjuntos médicos | Tabla metadata existente con FK owner/record/pet. No bytes ni URI local. | Tabla metadata y bytes/URI local. | No se requiere cambio para primera sync 4.1: adjuntos excluidos y todos sus metadatos/bytes permanecen locales. Fase posterior define storage y transferencia. |
| Tareas de cuidado | `task_type` limitado, notas, texto `recurrence_rule`, timezone/inicio, enabled/version/tombstone. | 0003 añade `category` (incluye exercise), description, observations, `schedule_json`, `next_run_at`, `ends_at`. | Agregar campos/categoría/checks e índices. Mantener `task_type`/`recurrence_rule`; no hacer backfill ambiguo a `category`/`schedule_json`. |
| Ejecuciones de cuidado | Sin tabla ni tipo feed. | `care_task_executions`: UUID, owner/task/pet, scheduled/actual, status, notas, version/tombstone, unicidad por tarea y slot. Una ocurrencia programada cancelada se conserva como `cancelled`; reprogramar crea otra fila `scheduled` con ID nuevo y nuevo `scheduled_for`. | Crear tabla owner-scoped con FK compuesta, checks, unicidad `(owner_id,task_id,scheduled_for)` e índices; añadir tipo feed. No sobrescribir ni borrar el historial. Requiere ampliar el enum local actual con `scheduled`. |
| Citas | Tabla base compatible para campos principales, FK owner/pet, status/version/tombstone. | Tabla local equivalente. | Sin nueva columna evidente; probar semántica, versión y owner-scoping. |
| `reminders` legacy | Tabla base existente, estructura reducida y chequeo target débil. | Tabla local inicial semejante, sin CRUD encontrado. | Mantener intacta en esta fase. Resolver su futuro después de inspección de datos/usos. |
| Eventos de calendario | Sin tabla remota. | `calendar_events`: mascota opcional, categoría, descripción, tiempos, zona, observaciones, version/tombstone. | Crear tabla, FK compuesta nullable pet, checks, uniques e índices. |
| Recordatorios de calendario | No equivalente; legacy insuficiente. | Target exactamente uno entre evento/tarea/cita/registro médico, pet opcional, `lead_minutes`, `enabled`, estado attended, version/tombstone. Evento general puede no tener mascota. | Crear tabla separada y constraints/índices. FK garantizan owner-target; constraint trigger diferible valida igualdad de mascota y permite `NULL` solo cuando evento y recordatorio son ambos generales, incluyendo updates posteriores del target. |
| Notificaciones programadas | No deben replicarse en servidor. | Tablas locales de SO por dispositivo para `reminders` y `calendar_reminders`. | Ningún cambio PostgreSQL. |
| Conversaciones/mensajes IA | Tablas existen; 0002 incluye tipos en `sync_changes`. | Outbox reconoce AI, pero diseño 4.1 excluye estas entidades. | No habilitar en sync inicial; revisión de privacidad/retención separada. |
| Versionado y tombstones | Entidades base tienen `version > 0`, `deleted_at`; feed usa versiones positivas. | Versiones iniciales 0; mutaciones no incrementan sistemáticamente. | PostgreSQL mantiene `version` autoritativa; el cambio principal de contadores es SQLite (`local_revision`, `server_version`, ACK revision). API debe aplicar update condicional y tombstones. |

### Integridad y ownership

- En nuevas tablas, usar `owner_id` del Principal, `UNIQUE(owner_id,id)` y
  FKs compuestas con `owner_id`; no aceptar dueño del DTO.
- No usar `ON DELETE CASCADE` para purgar entidades de dominio. FKs deben
  restringir borrado físico y la sincronización utiliza tombstones.
- Para recordatorios con varios tipos de targets, cada target requiere FK
  owner-aware y exactamente uno no nulo. La FKs deben evitar referencias
  cruzadas entre usuarios.
- La tabla nueva `calendar_reminders` tendrá FKs compuestas owner-target para
  cada destino y un `CHECK` que exija exactamente una FK target no nula.
  `pet_id` será nullable únicamente para un recordatorio dirigido a un
  `calendar_event` cuyo `pet_id` también sea `NULL`. Para un evento
  pet-scoped, o para cualquier care task, appointment o health record, el
  recordatorio debe llevar la misma mascota no nula.
- Las FKs owner-target no garantizan por sí solas la igualdad nullable de
  `pet_id`. Implementar constraint triggers `DEFERRABLE INITIALLY DEFERRED`
  que comprueben `reminder.pet_id IS NOT DISTINCT FROM target.pet_id` al
  insertar/actualizar el recordatorio, y que validen los reminders existentes
  al cambiar `owner_id`, `id` o `pet_id` del destino. Los IDs/owners de
  destinos deberían ser inmutables; `ON DELETE RESTRICT` protege el borrado
  físico. La comprobación al final de la transacción permite actualizar en
  conjunto una relación y sus reminders sin ventana de inconsistencia.
- Un evento general con `pet_id=NULL` puede tener uno o varios
  `calendar_reminders` generales con `pet_id=NULL`. No se inventa una mascota,
  no se convierte el evento a pet-scoped y no se exige una FK a `pets` para
  ese caso. Si el mismo evento se asocia luego a una mascota, la transacción
  debe actualizar también todos sus reminders a esa mascota; de lo contrario,
  el trigger rechaza el cambio.
- Las tablas `sync_imports` y `sync_conflicts` guardarán únicamente metadatos
  de control y estado. No incluirán payloads, notas, snapshots ni campos
  médicos.
- El feed de cambios y `sync_cursors` deben actualizarse en la misma
  transacción que dominio y receipt; las migraciones solo crean soporte, no
  implementan esa atomicidad.

## 7. Lista de cambios requeridos

La lista es propuesta para sincronización de dominio inicial según 4.1.
No incluye protocolo, endpoints, consultas remotas ni aplicación de
migraciones.

### Requeridos para que las entidades del alcance tengan representación

1. **`health_records`:** añadir `record_subtype` compatible con examen,
   `clinic_name`, `observations`, `details_json jsonb NOT NULL DEFAULT '{}'`,
   `next_event_at timestamptz`; constraints JSON object/subtype y un índice
   parcial de fechas futuras si la consulta remota lo requiere.
2. **`care_tasks`:** añadir categoría separada y compatible con el enum local,
   `description`, `observations`, `schedule_json jsonb`, `next_run_at`,
   `ends_at`; checks e índices útiles. Conservar `task_type` y
   `recurrence_rule`. No rellenar `category`/`schedule_json` con backfill
   automático en la migración inicial; permitir estado transitorio NULL para
   filas existentes hasta tener correspondencia determinista aprobada o
   edición explícita. Los nuevos writes sincronizables deben aportar los campos
   nuevos. No eliminar ni reutilizar los campos legacy durante la transición.
3. **`care_task_executions`:** crear tabla con ID UUID, `owner_id`, `task_id`,
   `pet_id`, `scheduled_for`, `executed_at`, `status`, `notes`, `version`,
   timestamps y `deleted_at`; FKs compuestas; check de status/ejecución
   (`scheduled|completed|omitted|cancelled`);
   `UNIQUE(owner_id,task_id,scheduled_for)` e índices por mascota/fecha y
   tarea/fecha. Ampliar el enum local actual para admitir `scheduled` además de
   `completed`, `omitted` y `cancelled`. Una reprogramación cancela la
   ocurrencia programada anterior (`status='cancelled'`,
   `executed_at=NULL`) sin cambiar `scheduled_for` ni borrar la fila y crea una
   nueva fila (`status='scheduled'`) con UUID y nuevo `scheduled_for`. La
   unicidad aplica también a filas canceladas y
   tombstoned: una ocurrencia/slot tiene una sola fila histórica. No se permite
   reusar exactamente el mismo slot después de cancelarlo; si ese caso se
   requiere, deberá aprobarse una extensión de modelo/versionado antes de
   añadir una dimensión de generación al unique.
4. **`calendar_events`:** crear con UUID, owner, `pet_id` nullable, title,
   description, category, starts/ends, timezone, status, observations,
   version/timestamps/tombstone; FKs/checks/unique owner-ID y owner-ID-pet;
   índices owner/start y owner/pet/start.
5. **`calendar_reminders`:** crear una tabla distinta a legacy con UUID,
   owner, pet opcional, los cuatro target IDs, title, `remind_at`,
   `lead_minutes`, timezone, status `pending|attended|cancelled`, `enabled`,
   notes, version/timestamps/tombstone. Añadir exactly-one check,
   FKs owner-target para evento/tarea/cita/registro médico, y constraint
   triggers diferibles para la coincidencia nullable de `pet_id` tanto al
   insertar/actualizar el reminder como al cambiar el target. Evento general
   (`calendar_event.pet_id IS NULL`) permite recordatorios con `pet_id=NULL`;
   todos los demás destinos requieren mascota coincidente no nula.
   No añadir unicidad por target ni por hora: aceptar múltiples reminders
   independientes por destino, incluso a la misma hora. Mantener
   `UNIQUE(owner_id,id)` e índices no únicos de destino y vencimiento.
6. **`sync_changes`:** añadir los entity types `care_execution`,
   `calendar_event`, `calendar_reminder` a la restricción existente en una
   migración nueva. Mantener `reminder` legacy durante compatibilidad; las
   allowlists de API pueden excluir attachment/AI aunque DB todavía los permita.
7. **Dispositivos e importación:** añadir platform, `app_version` y
   `schema_version` a `sync_devices` con defaults/checks compatibles con
   registros existentes. Crear `sync_imports` para registrar preview,
   consentimiento explícito y estado de importación; guardar owner/device,
   manifest hash de IDs/tipos (sin PHI), versión de esquema, estado y
   timestamps. No guardar payloads ni información médica.
8. **Conflictos remotos:** crear `sync_conflicts` con owner, device, operation,
   entidad/tipo, base/server version, campos conflictivos, estado y
   timestamps. No guardar snapshots ni payloads médicos. La resolución
   obtiene el snapshot vigente mediante consulta owner-scoped; el cliente
   conserva snapshots localmente.

### No requeridos en la primera versión PostgreSQL

- Cambios a `health_attachments`: excluidos de sync inicial; conservar tabla
  remota existente y storage local intactos.
- Tabla de notificaciones programadas del SO: no crear en PostgreSQL.
- Tablas `ai_conversations`/`ai_messages`: ya existen, pero permanecen fuera
  del protocolo inicial.
- Adjuntos médicos: tabla PostgreSQL existente se conserva, pero adjuntos y
  sus metadatos quedan fuera de la primera sincronización.
- Columna PostgreSQL adicional `server_version`: usar `version` existente
  como la versión autoritativa; `local_revision` es solo cliente.
- Mantener `reminders` separado y sin migración/eliminación en v1; conservar
  el tipo en el esquema/feed por compatibilidad y excluirlo de la allowlist de
  la API inicial. Un cambio posterior exige inventario y aprobación.
- Retención/compactación de feed, tombstones y receipts: en v1 no purgar
  automáticamente; una política futura requiere diseño y aprobación.

## 8. Orden propuesto para futuras migraciones

Todas las versiones siguientes son ilustrativas. Antes de asignar el próximo
número se debe comprobar el estado de la base destino autorizada y revisar que
no haya migraciones posteriores no presentes en este checkout. Nunca editar
0001–0004.

| Orden sugerido | Alcance de migración futura | Dependencia/precaución |
|---|---|---|
| 0005 (tentativa) | Ampliación de `health_records` y `care_tasks`; columnas, checks e índices. | Añadir `category` y `schedule_json` inicialmente nullable para filas preexistentes; no ejecutar backfill ambiguo. Conservar `task_type` y `recurrence_rule`. |
| 0006 (tentativa) | Crear `care_task_executions` y constraints/FKs/índices. | FK y check según §7, incluyendo estado `scheduled`. Una ejecución cancelada se conserva; reprogramación crea nuevo ID/slot. `UNIQUE(owner_id,task_id,scheduled_for)` incluye filas canceladas/tombstoned. |
| 0007 (tentativa) | Crear `calendar_events`. | FK owner/pet nullable; unique keys necesarias para reminders; probar eventos generales y pet-scoped. |
| 0008 (tentativa) | Crear `calendar_reminders`, checks de exactly-one, FKs owner-target, constraint triggers diferibles para relación pet-target e índices no únicos por destino. | Depende de tablas e índices target. Los reminders generales solo pueden apuntar a evento general y llevar `pet_id=NULL`. No copiar filas legacy. |
| 0009 (tentativa) | Extender check de `sync_changes.entity_type`; añadir metadatos de cliente a `sync_devices`. | Mantener `reminder` en el CHECK/feed, pero excluirlo de allowlist API v1. DDL de check debe reemplazarse incrementalmente y probarse en datos existentes. |
| 0010 (tentativa) | Crear `sync_imports` y `sync_conflicts`. | Decisiones adoptadas. Aplicar FKs owner/device, estados permitidos e idempotencia; guardar solo manifest hash/IDs/tipos, consentimiento y metadatos de conflicto. No almacenar snapshots ni PHI. |
| Posteriores | Ajustes de constraints/índices después de pruebas; cualquier cambio legacy de recordatorios solo con nueva aprobación. | No purgar datos, tombstones, cambios ni receipts automáticamente. KIRAI y adjuntos quedan fuera de sync v1. |

La lista no afirma que la numeración pueda usarse directamente: si Neon ya tiene
un número desconocido o divergente, detener y reconciliar historial con el
equipo antes de generar la siguiente migración.

### Reglas de rollout

1. Verificar checksum y estado desplegado con autorización antes de proponer
   versión siguiente.
2. Probar `up` desde esquema vacío y desde cada versión anterior soportada en
   una base PostgreSQL desechable.
3. Asegurar que cambios de check no invalidan filas existentes antes de
   reemplazar la constraint; reportar conteos sintéticos de preflight.
4. Mantener expand/contract: añadir columnas nuevas, backfill, desplegar
   lectores/escritores compatibles y retirar columnas antiguas solo después de
   demostrar que no hay consumidores.
5. Transacción/rollback por migración y checksum inmutable, siguiendo el
   runner actual. No usar `db:migrate up` durante esta fase.

## 9. Riesgos y pruebas necesarias

### Riesgos de pérdida/incompatibilidad/integridad

| Riesgo | Efecto posible | Mitigación/prueba |
|---|---|---|
| Suponer que 0004 está desplegada por existir el archivo | API de auth falla por falta de columna/tabla; despliegue no coincide. | Consultar status y checksum en ambiente autorizado; validar catálogos; no cambiar el archivo aplicado. |
| Migrar/eliminar `reminders` sin datos ni uso inventariados | Pérdida de recordatorios o rotura en clientes antiguos/FKs. | Mantener tabla; contar/clasificar datos y versiones consumidoras; migración reversible y reconciliación si algún día se aprueba. |
| Convertir legacy `reminders` en `calendar_reminders` | Perder target, status, habilitación, timezone o producir target vacío/duplicado. | No conversión automática; casos de datos ambiguos deben bloquear migración y requerir resolución. |
| Backfill ambiguo de `recurrence_rule` a JSON o de `task_type` a `category` | Cambio de frecuencia/categoría o agenda inválida. | Conservar ambos campos legacy y nuevos; no backfill automático ambiguo. Solo conversiones demostrablemente deterministas con reporte de filas excluidas y pruebas round-trip. |
| Mapear local exercise/custom al `task_type` remoto | Categoría se degrada o tipo enum rompe inserciones. | Nueva columna `category`, mantener tipo previo y probar todos los valores/legacy. |
| `calendar_reminders` target/pet mismatch | Recordatorio puede aparecer bajo mascota incorrecta o crear relación cruzada. | FKs owner-target, exactly-one y constraint triggers diferibles al insertar/actualizar recordatorio y modificar mascota/owner/ID del destino; probar destino general NULL-safe. |
| Usar FK cascada para borrar dominio | Eliminar historial fuera de la cola, sin tombstones ni feed. | `ON DELETE RESTRICT`; pruebas físicas de delete fallan y soft-delete mantiene filas. |
| Índices/constraints únicos incompatibles con datos | Migración falla, impide reprogramar ejecuciones o bloquea reminders múltiples. | Mantener unicidad de ejecución por slot y reprogramar en otro slot; permitir reminder múltiple con índices no únicos. Preflight de duplicados en ambiente autorizado antes de aplicar. |
| Feed CHECK no acepta nuevas entidades | Push/commit del feed falla al añadir ejecución o calendario. | Probar cada entity_type después de migración, incluidos tipos legacy que se mantienen. |
| Versiones locales 0 y remotas >0 | Conflictos falsos, sobreescritura o entidades sin ACK. | Mantener columna PostgreSQL `version`; separar contadores locales y ejecutar tests CAS/replay. |
| FK composite en tabla nueva incompleta | Usuario podría referenciar mascota/target de otro owner. | Dos owners en tests de FK; consultas siempre derivadas de Principal. |
| Cursor global asumido después de 0003 | Saltos, repetición o mezcla de cursores entre owners. | Tests concurrentes de cursor por owner y rollback en DB desechable; no reintroducir identidad global. |
| Cursor, receipt y dominio no atómicos | Cambios duplicados o feed incompleto tras crash. | Prueba transaccional de rollback/timeout; implementación futura debe confirmar juntos. |
| Prueba DB ejecutada accidentalmente en Neon | Inserta fixtures temporales y puede intentar limpieza remota. | No usar `db:verify*` en Fase 4.2; requiere base desechable y guard explícito. |
| Datos/consumidores no observados | Una búsqueda sin resultados se toma erróneamente como permiso para borrar. | Tratar como incertidumbre; inspección autorizada de catálogo, datos, despliegues y consumidores externos antes de deprecar. |

### Matriz mínima de pruebas para futuras migraciones

- Esquema vacío: 0001→última futura, tablas/constraints/indexes esperados.
- Upgrade desde 0001, 0002, 0003 y 0004 donde esté soportado; historial y
  checksums sin edición de migraciones previas.
- Segunda lectura/status idempotente; un segundo `up` no vuelve a copiar
  refresh tokens ni crea duplicados.
- 0004: sesión con token válido se refleja una sola vez en historial; hashes,
  fechas, revocación y constraints se preservan.
- Health records: `exam` conserva subtype, JSON object válido, fecha nullable
  y campos históricos preservados.
- Care tasks: todos los tipos locales, campos legacy preservados, nuevas
  columnas nullable para filas existentes, ausencia de backfill ambiguo,
  recurrence válida/ambigua, zona horaria, fechas y conservación de texto
  original.
- Care executions: estados y relación owner/task/pet válidos; FK de otro owner
  rechazada; una ejecución programada que se cancela queda como fila
  `cancelled` con `executed_at=NULL` sin borrarse y una reprogramación genera
  nueva fila `scheduled`/UUID/slot; unique impide duplicar un slot incluso si
  la primera fila está cancelada.
- Calendar events: eventos generales y mascota asociada; fin previo inválido;
  FK de otra cuenta rechazada.
- Calendar reminders: cada uno de los cuatro targets, target exactamente uno,
  owner mismatch, pet mismatch (insert y update de reminder y target), evento
  general con evento y reminder ambos `pet_id=NULL`, fallo si el reminder
  general lleva mascota o viceversa, actualización conjunta de evento general
  a pet-scoped y sus reminders en una transacción, múltiples reminders para
  mismo target y misma hora sin unique por target/hora, status y lead_minutes.
- Import/conflict metadata: previews con IDs/tipos y consentimiento explícito,
  estado/expiración e idempotencia; constraints owner/device; revisión de
  esquema que demuestre que ni `sync_imports` ni `sync_conflicts` almacenan
  snapshots, payloads, notas o datos médicos.
- Legacy reminder: permitir el estado actual solo durante compatibilidad;
  prueba que ambas columnas target nulas todavía son posibles explica por qué
  no se debe confundir con el nuevo modelo. Si se aprueba una migración futura,
  enumerar primero qué hacer con tales filas.
- Sync: nuevos tipos en feed, tipo legacy preservado, cursores aislados por
  owner y asignación concurrente sin saltos visibles.
- No-borrado: `DELETE` físico de pet/task/appointment/targets con dependencias
  se rechaza; `deleted_at` conserva fila y referencias.
- Negativos de privacidad: dueño A no puede insertar ni enumerar datos de B;
  errores/logs no contienen payload médico.
- Verificador: ejecutar únicamente contra PostgreSQL desechable; verificar
  rollback/limpieza de fixtures y revisar cualquier DDL no transaccional.

## 10. Compatibilidad con el diseño de sincronización 4.1

Las decisiones de mantener separados los dos modelos de recordatorio, usar
exactamente un target, permitir mascota opcional para evento general, preservar
versiones/tombstones, excluir KIRAI/adjuntos, y no purgar tombstones/receipts
son compatibles con el diseño 4.1. La adopción de `sync_imports` y
`sync_conflicts` concreta los estados durables sugeridos allí sin almacenar
snapshots médicos.

Se identificó una **brecha que debe resolverse antes de implementar**, no una
contradicción de esquema PostgreSQL existente: el diseño 4.1 enumera
`health_attachment` entre los tipos del DTO push, aunque en el mismo apartado
indica expresamente que se excluye por completo de preview/push/pull; este plan
adopta la exclusión explícita y exige que la allowlist API v1 no lo admita.
Además, el DTO de `care_execution` en 4.1 enumera
`completed|omitted|cancelled`, pero una nueva ejecución programada después de
reprogramar requiere estado `scheduled`. Este plan añade ese estado y requiere
actualizar el contrato 4.1 y el esquema SQLite en una revisión documental/
migración móvil antes de implementar. La unicidad por `(owner_id,task_id,
scheduled_for)` se conserva; reprogramar significa usar un `scheduled_for`
nuevo, no reusar un slot cancelado.

No se detecta contradicción para los eventos generales: el contrato 4.1 ya
admite `calendar_event.pet_id` opcional y un recordatorio con exactamente un
target. Este plan precisa que, si ese target es un evento general sin mascota,
el reminder también debe tener `pet_id=NULL`; la constraint diferible evita
desacuerdos posteriores.

## 11. Decisiones cerradas y pendientes antes de crear migraciones

### Decisiones cerradas para el diseño v1

1. `reminders` y `calendar_reminders` permanecen separados. El modelo legacy
   no se migra ni elimina en v1; `reminder` permanece en el schema/feed por
   compatibilidad y se excluye de la allowlist inicial de API.
2. `task_type` y `recurrence_rule` se conservan durante transición. Se añaden
   `category` y `schedule_json`; no se realiza backfill ambiguo. Solo se
   permitirán conversiones deterministas, revisables y probadas.
3. Las ejecuciones son historial append-preserving: no borrar ni sobrescribir
   una ocurrencia al reprogramar. Marcar la anterior `cancelled` con
   `executed_at=NULL` y su `scheduled_for` original; crear otra fila
   `scheduled` con UUID y nuevo slot. `UNIQUE(owner_id,task_id,scheduled_for)`
   aplica también a filas canceladas y tombstoned. Reusar el mismo slot
   cancelado queda fuera del contrato v1.
4. `calendar_reminders` exige exactamente un target y FKs owner-target. Un
   evento sin mascota (`calendar_event.pet_id=NULL`) admite recordatorios solo
   con `pet_id=NULL`; un destino pet-scoped exige la misma mascota no nula.
   Constraint triggers diferibles validan insert/update del reminder y cambios
   posteriores del destino, sin permitir inconsistencia al commit.
5. Se crearán `sync_imports` y `sync_conflicts` para registrar preview,
   consentimiento/estado de importación y metadatos de conflictos. No guardan
   contenido, snapshots ni información médica.
6. KIRAI y adjuntos quedan fuera de la primera sincronización. No ampliar la
   allowlist API v1 para `ai_*` o `health_attachment` por su mera presencia
   en el esquema/feed.

### Pendientes operativos/producto

1. **Inventario desplegado:** antes de crear la primera migración, verificar
   con autorización el estado/checksum de 0001–0004 y el historial de
   migraciones de la base destino. No se conectó a Neon en esta auditoría.
2. **Inspección de legacy:** aunque la decisión v1 es no migrar `reminders`,
   todavía se necesita inventario autorizado de filas, consumidores y
   versiones desplegadas antes de cualquier deprecación posterior.
3. **Backfills deterministas:** no realizar backfill inicial de
   `task_type`/`recurrence_rule`; mantener las nuevas columnas nullable para
   filas legacy hasta que haya una conversión probada o edición explícita. Si
   después se propone un backfill, definir sus casos deterministas y reportar
   los excluidos sin asignarles un default semántico inventado.
4. **Slot ya cancelado:** v1 no permite crear otra ejecución en el mismo
   `(owner,task,scheduled_for)`. Si producto exige un nuevo intento al mismo
   horario, diseñar dimensión de generación/ocurrencia y actualizar también el
   contrato 4.1 antes de migrar.
5. **Checks exactos:** cerrar límites de longitudes, precisión numérica,
   zonas horarias, enums y estados a partir de fixtures antes de redactar DDL.
6. **Contrato documental 4.1:** actualizar, antes de implementar, el enum
   `care_execution` para incluir `scheduled` y retirar `health_attachment` de
   la lista efectiva de tipos admitidos. Esta auditoría no modifica el
   documento 4.1.
7. **Límites de API:** definir/medir límites configurables antes del despliegue;
   no alteran las decisiones de esquema de este documento.

Hasta resolver estos puntos, el documento es un plan de cambios PostgreSQL,
no autorización para crear/aplicar migraciones, conectarse a Neon ni empezar el
protocolo de sincronización.
