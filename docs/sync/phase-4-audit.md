# PetCare — Fase 4: auditoría de persistencia y sincronización

**Fecha:** 10 de noviembre de 2026  
**Alcance:** inspección estática de migraciones y código fuente local. No se
consultó Neon ni se ejecutaron migraciones, cambios de datos, ni pruebas que
escriban en SQLite/PostgreSQL.

## 1. Resumen ejecutivo

PetCare ya tiene una base offline-first real en SQLite: repositorios locales,
UUID, operaciones de escritura transaccionales, eliminaciones lógicas y un
outbox con dependencias, estados de reintento y snapshots de conflicto. En
PostgreSQL están definidos usuarios/sesiones, varias entidades de dominio y
tablas de soporte para idempotencia, feed de cambios y cursores.

**No existe todavía sincronización end-to-end.** No hay worker móvil, cliente
de sync, endpoints de push/pull, ni servicios backend que consuman
`sync_queue`, `sync_operations`, `sync_changes` o `sync_cursors`. Las tablas de
sync son estructura, no una API funcional.

Las brechas bloqueantes más importantes:

1. SQLite contiene `care_task_executions`, `calendar_events` y
   `calendar_reminders`, pero PostgreSQL no tiene tablas equivalentes en las
   migraciones inspeccionadas. Además, `sync_changes.entity_type` no admite
   `care_execution`, `calendar_event` ni `calendar_reminder`.
2. Campos añadidos localmente a salud y cuidados no tienen columnas remotas
   correspondientes. El subtype de examen y los detalles médicos pueden
   perderse si se envían sin ampliar el contrato.
3. Las entidades locales empiezan en `version = 0`, pero las ediciones no
   incrementan `version`; `base_version` se vuelve a llenar con esa misma
   versión. No hay un contrato que concilie la versión local con las versiones
   positivas del servidor.
4. El `account_id`/`owner_id` de SQLite es provisional y no corresponde
   automáticamente a `users.id`. El login no enlaza ni migra esos datos. El
   servidor debe derivar siempre el owner de `Principal`, nunca aceptar el
   owner enviado en payload.
5. Se usan eliminaciones lógicas locales, pero no existe recepción de
   tombstones ni política de retención. Borrar una mascota no genera en el
   repositorio una cascada lógica de sus entidades hijas.
6. La migración 0004 de historial de refresh tokens está registrada en el
   código, pero no se verificó si se aplicó en Neon. No se consultó el estado
   remoto de ninguna migración.

**Evaluación:** la arquitectura es un buen punto de partida, pero no se debe
activar sincronización todavía. Primero hacen falta decisiones explícitas de
vinculación de cuenta, contratos/representación de entidades, versionado,
propiedad y tombstones; luego implementar API y cliente por etapas.

## 2. Método y límites de la auditoría

Se compararon las cinco migraciones SQLite (`mobile/src/db/migrations/`), las
migraciones PostgreSQL 0001–0004 (`api/src/db/migrations/`), los repositorios
móviles de mascotas, salud, cuidados y calendario, la configuración de rutas
Express, el middleware de autenticación y las consultas owner-scoped.

Las conclusiones sobre bases describen **lo que define el repositorio**. No
afirman que esos cambios estén aplicados en una instancia Neon. El estado
desplegado solo puede clasificarse como **pendiente de verificación**; esta
auditoría no cargó `DATABASE_URL`, no conectó a Neon y no ejecutó comandos DB.

## 3. Comparación de entidades SQLite y PostgreSQL

| Entidad / datos | SQLite y operación local | PostgreSQL según migraciones | Estado de sincronización |
|---|---|---|---|
| Cuenta `users` | No hay tabla de usuario central local. `sync_metadata.account_id` genera UUID provisional. | `users` con email, password hash, nombre y `deleted_at`. | Identidad central implementada en API; mapping de cuenta local no existe ni debe inferirse. |
| Sesiones | Tokens del cliente en SecureStore nativo y `sessionStorage` Web; no son filas de SQLite. | `auth_sessions`; la migración 0004 añade `updated_at` e historial de hash en `auth_refresh_tokens`. | Auth no es una entidad del outbox. Sesiones no se sincronizan entre cliente y SQLite. Aplicación remota de 0004 no verificada. |
| Mascotas | `pets`, CRUD local, soft delete; UUID local; owner por cuenta local. Cada mutación crea una operación `pet`. | `pets` con campos principales, versionado, owner y soft delete. FK owner-aware desde entidades hijas. | Equivalencia parcial/fuerte para los campos base; no hay endpoint ni transporte. Payload incluye owner local, que no se debe aceptar como dueño remoto. |
| Historial médico | `health_records`; migración 0002 agrega `clinic_name`, `observations`, `details_json`, `next_event_at` y `record_subtype`. Repositorio queuea create/update/delete. | `health_records` incluye tipo, título, descripción, fecha, profesional, versionado y tombstone; no define las columnas extras de SQLite. | Falta migración/contrato para extras locales. `examination` se representa localmente como `observation` + `record_subtype='exam'`; PostgreSQL no tiene `record_subtype`, por lo que esa distinción se perdería. |
| Adjuntos médicos (metadata) | `health_attachments` incluye `storage_key`, `local_uri`, nombre, MIME, bytes y timestamps. Un create/update/delete se queuea aparte y depende del registro. | `health_attachments` almacena metadata y `storage_key`; no `local_uri` ni bytes. | Metadata mayormente equivalente; `local_uri` no debe subirse. El contenido existe en filesystem local o IndexedDB, sin upload ni object storage remoto implementado. Hace falta protocolo de carga/descarga y retención coordinado. |
| Tareas de cuidado | `care_tasks`; migración 0003 agrega categoría, descripción, observaciones, JSON de agenda, `next_run_at`, `ends_at` y zona horaria. | `care_tasks` tiene `task_type`, `recurrence_rule`, `starts_at`, enabled, owner/version/tombstone; faltan varias columnas locales y categoría extensible. | Incompleto. `exercise`/`custom` se mapean ambos a remoto `task_type='custom'`; el campo remoto no conserva por sí solo la categoría/subtipo. Agenda serializada en `recurrence_rule` requiere un contrato acordado. |
| Ejecuciones de cuidado | `care_task_executions`, con fecha programada/real, estado, notas, versionado, UUID y soft delete; cada ejecución crea `care_execution` y depende de la operación de tarea. | No hay tabla equivalente en migraciones 0001–0004. El enum/check de `sync_changes` tampoco admite `care_execution`. | Sin soporte remoto. No es seguro sincronizar hasta crear esquema, constraint de entidad y reglas de historial/actualización. |
| Citas | Tabla local `appointments`, CRUD/soft delete y queue como `appointment`; asociada a mascota. | Tabla `appointments` con título, tiempos, ubicación, notas, estado, owner/version/tombstone y FK compuesta. | Correspondencia principal presente, pero sin endpoint. Verificar reglas de campo y versiones. |
| Recordatorios legacy | SQLite inicial incluye `reminders` con target opcional de tarea o cita. | PostgreSQL `reminders` tiene campos semejantes, pero su check solo excluye que ambos targets sean no nulos; ambos pueden ser nulos. | Equivalencia estructural parcial. El uso actual del calendario se centra en `calendar_reminders`, no debe confundirse con esta tabla. |
| Eventos personales de calendario | Desde migración 0004: `calendar_events`, general o pet-scoped, con estado, zona, soft delete; repository queuea `calendar_event`. | No existe `calendar_events` en PostgreSQL migrations 0001–0004. `docs/data-model.md` la enumera, pero contradice las migraciones. | No sincronizable hasta añadir migración remota y entidad aceptada por `sync_changes`. |
| Recordatorios de calendario | `calendar_reminders` permite un target de evento, tarea, cita o registro médico; admite `lead_minutes`, `enabled`, estado `attended` y soft delete. Queuea `calendar_reminder`. | No existe `calendar_reminders`. PostgreSQL `reminders` no representa completamente targets médicos/eventos, `lead_minutes`, `enabled` ni estado `attended`. | Sin equivalencia. No mapear a `reminders` por nombre: se perdería semántica. |
| Notificaciones locales programadas | `scheduled_notifications` y `calendar_scheduled_notifications` almacenan IDs del SO, versiones programadas y estado por instalación/dispositivo. | No hay equivalente remoto intencional en migraciones. | Deben permanecer device-local; no enviar IDs del sistema operativo ni su estado a PostgreSQL como recordatorio de dominio. |
| Conversaciones KIRAI | `ai_conversations` y `ai_messages` están en SQLite; no se encontraron repositorios/servicios funcionales que las usen. | Tablas homónimas con FK y owner, `pet_id NOT NULL`, roles `user`/`assistant`. Sync support acepta esos dos entity types. | Esquema en ambas bases, pero no hay operaciones reales ni sync. Modelo actual impide conversaciones generales sin mascota. IA está fuera de este alcance. |
| Metadata/outbox local | `sync_metadata`, `sync_queue`, `sync_queue_dependencies`, `sync_conflicts`; payload JSON, versiones base, changed fields y reintentos. | Se modelan `sync_devices`, `sync_operations`, `sync_changes`, `sync_cursors`; no se almacenan payloads completos de cambio en feed. | Ambos lados preparados parcialmente; no existe protocolo/servicio que los enlace. `account_id` local no es el `user_id` central. |

### Diferencias globales de versión y UUID

- Los UUID de filas de dominio locales son UUID en minúsculas y pueden
  conservarse al sincronizar; PostgreSQL acepta UUID. El ID de operación
  (`operation_id`) es otro UUID independiente y sirve para idempotencia.
- SQLite inicializa entidades nuevas con `version = 0`; PostgreSQL usa
  `version = 1` por defecto y exige versión positiva.
- Los repositorios actualizan `updated_at`, pero no se encontró incremento de
  `version` en las mutaciones de producto. Las operaciones capturan la versión
  actual como `base_version`. Por ello, versiones repetidas y snapshots
  posteriores al primer sync no podrán aplicar optimistic concurrency fiable.
- No debe usarse `updated_at` como sustituto de un contador de versión:
  relojes de dispositivo pueden desfasarse y timestamp no detecta de forma
  atómica una actualización perdida.
- Definir el contrato antes del worker: versión remota aceptada, incremento
  local por mutación, `base_version` inmutable por operación, y respuesta
  autoritativa del servidor. Las operaciones locales aún no reconocidas
  necesitan conservar su snapshot/tombstone durante los reintentos.

## 4. Cola local y dependencias

`sync_queue` contiene UUID de operación, `account_id`, entidad, ID de entidad,
acción (`create`, `update`, `delete`), payload JSON, `base_version`,
`changed_fields`, estado (`pending`, `in_flight`, `blocked`, `conflict`,
`failed`), contador, próxima hora de reintento y último error. Hay índices por
cuenta/estado/fecha y por entidad. Las dependencias se restringen a
operaciones de la misma cuenta. `sync_conflicts` conserva snapshots local y
servidor, campos en conflicto y resolución.

Los repositorios realizan escrituras de dominio y queue en la misma
transacción SQLite mediante `withLocalWriteTransaction`; usan dependencias con
mascota/entidad padre y con la operación previa de la misma entidad. La
migración SQLite 0003 amplía tipos para `care_execution`; la 0004 para
`calendar_event` y `calendar_reminder`.

Al abrir DB, `recoverInterruptedSync` restablece todas las operaciones
`in_flight` a `pending`. Es una recuperación local, no un worker. No hay código
que seleccione lotes listos, marque `in_flight`, respete `next_retry_at`,
interprete fallos parciales, aplique ACK, reintente con backoff, limpie
dependencias confirmadas o cree/resuelva conflictos.

La dependencia de la operación anterior impone serialización por entidad,
pero genera riesgos que el protocolo debe tratar:

- Una operación posterior puede quedar bloqueada indefinidamente si un
  antecedente falla o entra en conflicto; se necesita propagación de bloqueo y
  UI/diagnóstico, no saltar automáticamente la dependencia.
- Crear, editar y borrar antes del primer sync produce una cadena de
  operaciones, no una sola operación coalescida. El servidor debe conservar
  el orden o definirse una coalescencia segura que mantenga `operation_id` y
  estado de creación/borrado.
- Borrar un padre debe ordenar hijos y/o preservar dependencias, y nunca
  implicar una eliminación física remota inadvertida.
- El payload incluye `owner_id`/`account_id` local. El servidor debe descartar
  ese dato como autoridad, derivar usuario de JWT y comprobar que las
  relaciones de las entidades destino pertenecen al usuario.

## 5. Operaciones locales sin soporte remoto

1. **`care_execution`:** la app crea historial de completadas/omitidas/
   canceladas, avanza la próxima ocurrencia y queuea la ejecución. Falta tabla,
   constraint de entidad, cambio/feed y endpoint.
2. **`calendar_event`:** CRUD/soft delete local, sin tabla ni tipo de feed
   remoto.
3. **`calendar_reminder`:** crear/editar/atender/desactivar/borrar lógico
   localmente y refrescar fechas según la fuente; no hay equivalente remoto.
4. **Campos de historial médico:** clínica, observaciones, detalles JSON,
   próxima fecha y subtipo de examen necesitan representación/migración remota.
5. **Campos de cuidados:** categoría, descripción, observaciones, agenda
   estructurada, próxima ejecución y fin necesitan contrato remoto.
6. **Adjuntos:** falta servicio de upload/download de binarios y estrategia de
   almacenamiento; solo hay filesystem/IndexedDB local más metadata.
7. **Pull:** no hay aplicación de snapshots remotos, upsert owner-scoped,
   resolución de dependencias entrantes ni aplicación de tombstones a SQLite.
8. **Sync de dispositivo:** no hay registro/rotación de `sync_devices`, ni
   cursor remoto por dispositivo asociado al login.
9. **IA:** hay tablas, pero no se usan; no sincronizar conversaciones vacías ni
   presentar estas tablas como memoria ya disponible.

Las tablas remotas de `appointments`, `health_records`, `health_attachments`,
`care_tasks`, `reminders`, `pets` y entidades AI son soporte de esquema, no
prueba de operaciones activas.

## 6. Migraciones y endpoints

### Migraciones según fuente

| Sistema | Migraciones en el repositorio | Consecuencia |
|---|---|---|
| SQLite | 0001 inicial; 0002 detalles médicos; 0003 rutinas, ejecuciones y ampliación del outbox; 0004 calendario/recordatorios/notificaciones locales y ampliación de tipos; 0005 integridad mascota-target de recordatorios. | Aplicadas localmente por `migrateLocalDatabase`; la versión real en un dispositivo depende del ledger `_local_migrations`. Esta auditoría no abrió ni modificó DB de usuario. |
| PostgreSQL | 0001 core; 0002 sync support; 0003 cursores ordenados; 0004 historial de refresh. | `api/src/db/migrations/index.ts` registra la 0004. No se consultó el ledger remoto; 0004 y el resto de la secuencia quedan pendientes de verificación en Neon. |

Migraciones remotas recomendadas para la fase de sync: revisar y añadir, de
forma incremental, campos faltantes de salud/cuidados; tabla de ejecuciones;
tablas de evento y recordatorio de calendario; ampliar el `CHECK` de
`sync_changes.entity_type`; y ajustar constraints/índices/relaciones. No
modificar migraciones ya aplicadas. Definir primero el modelo final y probar
cada migración en una base desechable.

### Endpoints actuales

- `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`
  implementan identidad y sesión.
- `GET /health` y `/ready` son rutas del sistema.
- No existen endpoints `/sync/push`, `/sync/pull`, batch ACK, conflictos,
  registro de dispositivo ni CRUD remoto de dominio. El middleware de auth se
  aplica al logout; `OwnerScopedQueries` es un helper de mascotas, no una ruta
  de negocio. No hay integración de consultas de dominio protegidas con sync.

## 7. Aislamiento por propietario

**Local:** los repositorios obtienen el `owner_id` mediante
`getLocalAccountId()` y filtran consultas por owner; tablas relacionan mascota,
registro médico, cuidado, cita, recordatorio y conversación usando claves
compuestas `owner_id` + IDs. El valor se genera localmente y no es una cuenta
autenticada.

**Servidor/esquema:** PostgreSQL tiene FK compuestas para varias relaciones
propietario-mascota. El JWT produce `Principal.userId`; el helper
`OwnerScopedQueries.findPet` consulta por `principal.userId` y oculta recurso
ausente/no propio. Sin embargo, actualmente solo se consume desde pruebas: no
hay endpoints de dominio. El esquema por sí solo no autoriza solicitudes.

**Requisito de sync:** `user_id` debe provenir exclusivamente del JWT
verificado. Ignorar/validar contra Principal cualquier `owner_id` del payload.
Toda FK hija debe validarse bajo el mismo usuario, y las consultas de pull
deben filtrar por ese user. No convertir automáticamente el
`sync_metadata.account_id` provisional en `users.id`.

## 8. Riesgos principales

| Riesgo | Consecuencia | Tratamiento requerido |
|---|---|---|
| Confundir cuenta local con cuenta autenticada | Datos de un dispositivo atribuidos a usuario incorrecto o exposición a otro dueño. | Flujo posterior de asociación explícita: preview, confirmación, comprobar duplicados/UUID y resolución de identidad; no vincular al login automáticamente. |
| Tipos de entidad no aceptados por feed | Rechazo de operaciones o ausencia de cambios descargables. | Alinear enum local/servidor/tablas/endpoints mediante contratos versionados y prueba de cobertura exhaustiva. |
| Columnas incompatibles o silenciosamente omitidas | Pérdida de datos clínicos/categorías al push/pull. | Contratos typed con validación y round-trip de cada campo/categoría; migration incremental previa. |
| Versiones que no avanzan | Updates perdidos, conflictos invisibles o reintentos aceptados con base obsoleta. | Incremento local transaccional, compare-and-set remoto (`base_version`), versión nueva en ACK, pruebas de dos escritores. |
| Repetición/doble aplicación | Filas duplicadas o tareas/ejecuciones repetidas ante timeout tras commit. | Recibo idempotente `(user_id, operation_id)` y hash canónico del request, guardados con cambio de dominio/feed en la misma transacción; mismo ID/diferente hash debe rechazarse. |
| Feed con cursores | Cliente salta cambios confirmados o procesa fuera de orden. | Usar contador por owner en la misma transacción de dominio + feed; continuar el protocolo de 0003 y probar rollback/commit concurrente. |
| Eliminación lógica parcial | Filas hijas siguen activas después de soft-delete del padre, se descargan huérfanas o el padre reaparece. | Diseñar tombstones por entidad, reglas de cascada lógica y orden/dependencias; bloquear nuevos hijos de un padre eliminado y conservar tombstones hasta retención segura. |
| Operaciones bloqueadas en outbox | Cola se atasca por dependencia fallida/conflicto; sin visibilidad ni recuperación. | Estados terminales/transitorios, política backoff, dependencia de lote, reintento manual y UI/telemetría sin exponer payload sensible. |
| Adopción de otro dispositivo con local queue | Reasignar el provisional cambia el ámbito de muchas operaciones y puede mezclar historial personal. | No reescribir `account_id`; estrategia explícita de importación/merge tras decisión del usuario, con rollback y preview. |
| Archivos médicos | Filas remotas apuntan a bytes que siguen en un solo dispositivo; URI local inválida en servidor. | Upload separado y autenticado, checksum/tamaño/MIME, URL firmada/escaneo según política, estados pending/uploaded y borrado remoto coordinado. |
| Recordatorios duplicados | Sincronizar agenda y cada ejecución calculada como recordatorio podría duplicar eventos. | Mantener recordatorio como entidad propia; sync no copiar `calendar_scheduled_notifications` ni sintetizar una segunda fuente para care/appointment/health. |
| Datos de IA | Conversaciones pueden contener datos veterinarios sensibles y tablas actuales son pet-only. | No sincronizar hasta consentimientos/retención y modelo general vs pet-scoped definidos; minimizar datos y aplicar owner scope estricto. |
| Migración 0004 no desplegada | Login/rotación nuevo consulta tabla/columna ausente en despliegue. | Verificar estado con autorización en la base destino y aplicar migración planificada antes de activar build que depende de ella. |

## 9. Arquitectura de sincronización propuesta

### Principios

1. SQLite sigue siendo fuente de escritura/lectura offline del móvil; Neon solo
   se accede por API HTTPS. Login no dispara sync ni reasigna datos locales.
2. La identidad central es el JWT. En el primer diseño de sync, incluir un
   flujo visible y autorizado para vincular/importar los datos del
   `account_id` provisional. Hasta entonces, sync solo puede operar sobre
   datos explícitamente asociados a esa cuenta.
3. Conservar UUID de entidad y `operation_id` entre reintentos y dispositivos;
   nunca aceptar del cliente el owner como fuente de autoridad.
4. `push` es batch transaccional por operación/idempotency receipt. Cada
   operación lleva `entity_type`, `entity_id`, acción, `base_version`,
   `changed_fields` y payload validado. Procesar dependencias en orden
   topológico; respuesta individual por operación permite fallos parciales.
5. Mutación, nueva versión, receipt, feed event y cursor por propietario se
   confirman juntos. Pull pagina por cursor ordenado y solo devuelve datos del
   Principal; snapshot actual debe ser owner-scoped.
6. Respuesta ACK incluye `operation_id`, versión canónica y timestamps;
   actualizar fila/metadata local y quitar/desbloquear operación solo después
   de confirmar ACK en una transacción SQLite.
7. Si base version no coincide, devolver conflicto con snapshots/campos
   mínimos necesarios; el móvil persiste en `sync_conflicts` y no sobrescribe
   automáticamente historial clínico/ejecuciones.
8. Los tombstones se descargan igual que updates y retienen entity ID/version,
   para que un dispositivo antiguo no resucite la fila. Acordar retención,
   cursores caducados y recuperación completa.
9. Archivos se transfieren por protocolo dedicado de objetos, referenciados por
   metadata; no incluir rutas de archivo del dispositivo en payload de dominio.
10. Batch size y límites de payload deben estar acotados, con timeouts y
    backoff exponencial con jitter; tratar respuesta parcial sin replay de
    operaciones confirmadas.

### Push / pull propuestos

- **Push:** móvil toma operaciones elegibles (`pending`, retry due, todas las
  dependencias ACKed), marca lote en curso localmente y manda `operation_id`.
  Backend verifica Principal, ID/owner/FKs y payload; reserva/consume receipt
  idempotente. Conflictos/validación/temporalidad se informan por item, sin
  responder falsamente que todo el batch fue exitoso.
- **Idempotencia:** clave `(user_id, operation_id)` + hash de una codificación
  canónica que excluya credenciales. Mismo ID/mismo hash retorna la respuesta
  guardada; mismo ID/hash distinto produce rechazo explícito.
- **Pull:** manda cursor guardado; API retorna cambios en orden y límite
  acotado, nuevo cursor solo con continuidad garantizada. Aplicar entidades y
  cursor juntos en SQLite; si un item/relación no se puede aplicar, rollback o
  aislar item con política explícita para evitar avanzar cursor y perderlo.
- **Offline / crash:** conservar outbox hasta ACK persistido; recuperar
  `in_flight`; replay por mismo operation ID; si el request pudo committear,
  receipt devuelve el resultado previo.
- **Fallos parciales:** estados por operación; las dependientes permanecen
  blocked si el padre falla; operaciones independientes pueden ACKearse.
  Retry solo errores transitorios; validación/conflicto requieren corrección o
  resolución, no retry ciego.

## 10. Orden recomendado de implementación

1. **Decisiones de identidad y producto:** política para usuarios ya con datos
   locales, asociación/importación, privacidad de datos veterinarios, múltiples
   dispositivos, retención y política de conflictos.
2. **Matriz de entidades/contratos:** definir DTOs de push/pull, ownership y
   campos canónicos. Resolver tablas/columnas que faltan y estados
   enumerados; decidir alcance para AI separado.
3. **Migraciones PostgreSQL incrementales:** ejecuciones, calendario y campos
   faltantes; ampliar entidad/constraints, FK owner/pet, índices y auditoría.
   Revisar versión aplicada de 0004 antes de deployment. Probar migraciones en
   DB desechable.
4. **Reglas locales de outbox:** corregir avance de `version`, snapshot/base
   version, deps, coalescencia segura, política de borrado parent/children y
   límites de lote. Pruebas sin red.
5. **Servicios API owner-scoped:** validación de DTOs, transacción, CAS de
   versiones, receipts idempotentes, cambios/cursor; no aceptar owner cliente.
6. **Endpoints push/pull y dispositivos:** auth obligatoria, límites batch,
   respuestas parciales y cursores.
7. **Worker móvil:** exclusión mutua, batch topológico, backoff/reintentos,
   cancelación, conectividad/foreground, ACK y recuperación tras crash.
8. **Aplicación de pull/conflictos:** atomicidad local, tombstones, snapshots,
   resolución explícita y recuperación por cursor vencido.
9. **Adjuntos:** protocolo de carga/descarga binaria y estados de transferencia
   separados.
10. **Piloto controlado:** DB de prueba y dos dispositivos/cuentas de prueba,
    métricas de errores/latencia, sin activar sync para cuentas reales antes
    de validar restore/backup y migración.

## 11. Pruebas necesarias

### Migraciones y esquema

- Migración desde versiones anteriores y base recién creada; aplicar dos
  veces/status; rollback por fallo; preservar hashes/sesiones de 0004.
- FK y checks para owner/pet/target, todas las categorías/estados, entidades
  feed admitidas, soft delete y ejecución única por tarea/fecha.
- Verificar existencia real de migraciones en DB desechable; nunca inferirla
  del build o del archivo `data-model.md`.

### Push, idempotencia y lote

- Crear pet → registro/cuidado/cita/evento → recordatorio/ejecución y validar
  orden de dependencias y FK.
- Mismo operation ID y mismo hash responde mismo ACK sin duplicar; mismo ID
  con payload diferente se rechaza.
- Error tras commit pero antes de respuesta; timeout, retry y cierre inesperado
  no duplican.
- Batch con padre fallido, hijo dependiente, y operación independiente:
  resultado parcial preciso y bloqueos correctos.
- Batch duplicado y reordenado, operaciones dos veces, payload inválido,
  límite de bytes/item y excesos de tamaño.
- Owner/UUID manipulados, ID de recurso de usuario distinto, pet_id cruzado,
  `owner_id` cliente falsificado y token expirado/revocado: sin lectura ni
  mutación cruzada ni filtración de existencia.

### Pull, versiones, conflictos y borrados

- Cursor paginado sin saltos/duplicados, incluyendo commits concurrentes y
  rollback; usuario A no recibe cambios de B.
- Dos dispositivos editan misma versión; ACK aceptado, conflicto por base
  obsoleta, resolución y reintento usando nueva versión.
- Tombstone se propaga a dispositivo offline; no resucitar al subir snapshot
  viejo; borrar padre con hijos y dependencias pendientes.
- Entidad remota nueva se aplica con FK en una transacción; si falla un item,
  cursor no avanza inadvertidamente.
- Reinicio en cada frontera transaccional, reconexión, retries con jitter,
  conflictos persistidos y cierre/reapertura de SQLite.

### Entidades / round-trip

- Golden tests de ida/vuelta para cada campo de mascotas, todos los tipos de
  historial (incluido examen), detalles JSON, tareas todas las categorías,
  zonas horarias/DST, ejecuciones y estados, citas, eventos, reminders y
  targets médicos.
- Adjuntos: upload parcial, checksum, reintento, metadata antes/después del
  binario, descarga, tombstone y archivo ausente.
- Las tablas de notificación de OS permanecen locales y no crean duplicados
  en calendario.
- Verificar datos AI únicamente tras aprobación separada de alcance/consent.

## 12. Fuentes inspeccionadas

- Migraciones locales: [0001_initial.ts](../../mobile/src/db/migrations/0001_initial.ts),
  [0002_health_records.ts](../../mobile/src/db/migrations/0002_health_records.ts),
  [0003_care_routines.ts](../../mobile/src/db/migrations/0003_care_routines.ts),
  [0004_calendar_reminders.ts](../../mobile/src/db/migrations/0004_calendar_reminders.ts),
  [0005_calendar_reminder_pet_integrity.ts](../../mobile/src/db/migrations/0005_calendar_reminder_pet_integrity.ts).
- Migraciones PostgreSQL: [0001_core.ts](../../api/src/db/migrations/0001_core.ts),
  [0002_sync_support.ts](../../api/src/db/migrations/0002_sync_support.ts),
  [0003_ordered_sync_cursors.ts](../../api/src/db/migrations/0003_ordered_sync_cursors.ts),
  [0004_auth_refresh_token_history.ts](../../api/src/db/migrations/0004_auth_refresh_token_history.ts).
- Repositorios: [petRepository.ts](../../mobile/src/pets/petRepository.ts),
  [medicalRepository.ts](../../mobile/src/medical/medicalRepository.ts),
  [careRepository.ts](../../mobile/src/care/careRepository.ts),
  [calendarRepository.ts](../../mobile/src/calendar/calendarRepository.ts).
- Recuperación local: [migrate.ts](../../mobile/src/db/migrate.ts),
  [localAccount.ts](../../mobile/src/db/localAccount.ts).
- API y aislamiento: [app.ts](../../api/src/app.ts),
  [authenticate.ts](../../api/src/middleware/authenticate.ts),
  [ownerScopedQueries.ts](../../api/src/modules/auth/ownerScopedQueries.ts).
- Referencia documental: [data-model.md](../data-model.md); sus tablas remotas
  `calendar_events` y `calendar_reminders` no están en las migraciones
  PostgreSQL observadas.

## Conclusión

PetCare tiene persistencia offline y una estructura de outbox prometedora,
además de entidades PostgreSQL para varios dominios y soporte de auth. No hay
sync operativo ni se confirmó el estado del despliegue Neon. Antes de
implementar el worker, hace falta cerrar contratos/identidad, completar el
esquema remoto y corregir el versionado local. La migración de datos locales a
una cuenta y cualquier cambio en Neon requieren una aprobación y fase
posteriores.
