# PetCare — Fase 4.1: diseño técnico de sincronización

**Estado:** propuesta de contrato para revisión; todavía no implementada.  
**Base:** [auditoría de persistencia y sincronización](./phase-4-audit.md).  
**Alcance:** SQLite móvil ↔ API autenticada ↔ PostgreSQL. Este documento no
afirma que las migraciones existentes estén aplicadas en Neon.

## 1. Decisiones técnicas propuestas

1. SQLite continúa siendo la fuente de lectura/escritura para el uso offline.
   El móvil no conecta con PostgreSQL. La API es el único acceso remoto.
2. El usuario central se identifica exclusivamente mediante el `Principal`
   derivado del access JWT. `owner_id`, `account_id`, `user_id` y campos
   equivalentes enviados en un payload nunca seleccionan al propietario
   remoto.
3. Inicialmente habrá una sola cuenta autenticada activa por dispositivo. El
   `sync_metadata.account_id` actual es un identificador local provisional, no
   una identidad, sesión, autorización ni `users.id`. El login nunca arranca
   una importación ni asocia los datos locales con la cuenta autenticada.
4. El UUID de entidad creado offline se conserva en PostgreSQL cuando es
   posible. `operation_id` identifica una mutación concreta e idempotente y no
   es el UUID de entidad.
5. Push usa lotes pequeños, topológicamente ordenados y con resultado por
   operación. Cada mutación de dominio se confirma atómicamente con su receipt
   de idempotencia, feed entry y asignación de cursor.
6. Pull pagina por cursor de propietario y persiste cambios/cursor en una sola
   transacción SQLite. Tombstones son cambios first-class, no borrados físicos.
7. SQLite mantiene `local_revision`, `server_version` y
   `acknowledged_local_revision` como conceptos separados. Toda modificación
   local incrementa `local_revision`; solo ACK/pull avanza
   `acknowledged_local_revision`; el servidor administra la versión remota
   canónica en la columna PostgreSQL `version`, expuesta como
   `server_version` en el contrato. `updated_at` es auditoría/orden visual,
   nunca control de concurrencia.
8. Campos locales de salud, cuidados, ejecuciones y calendario no se
   descartarán ni se mapearán a entidades incompatibles. Primero se completan
   contratos y migraciones incrementales. En cuidados se conservan
   `task_type`/`recurrence_rule` durante la transición y no se ejecutan
   backfills ambiguos a `category`/`schedule_json`.
9. Los adjuntos quedan fuera de la primera implementación de sincronización.
   Sus metadatos y bytes permanecen locales. No se modificará la tabla
   PostgreSQL existente `health_attachments`; una fase posterior definirá
   almacenamiento remoto y transferencia autenticada.
10. Las tablas `scheduled_notifications` y `calendar_scheduled_notifications`
    son estrictamente por dispositivo y no se sincronizan como recordatorios
    de dominio.

### Identificadores y esquema de operación

- `device_id`: UUID estable por instalación; generado una vez y persistido
  localmente. No es un secreto ni una identidad de usuario.
- `local_account_id`: el actual UUID provisional de SQLite, usado únicamente
  para seleccionar localmente el conjunto que el usuario quiere importar.
- `entity_id`: UUID estable de la fila de dominio.
- `operation_id`: UUID inmutable de una operación outbox/replay.
- `batch_id`: UUID de una petición push; facilita trazabilidad, pero no
  sustituye la idempotencia por operación.
- `cursor`: entero monotónico por propietario para el feed remoto. Cada
  dispositivo conserva su propio cursor aplicado.

Todos los timestamps de transporte usan ISO 8601 UTC con `Z`. Fechas civiles
como cumpleaños pueden enviarse como `YYYY-MM-DD`; horarios recurrentes llevan
además zona IANA. Valores JSON tienen tipos explícitos y no aceptan claves no
conocidas en la versión actual del contrato.

## 2. Asociación explícita de datos locales

### Flujo propuesto

```text
Login central satisfactorio
   │
   ├─ NO importa ni reescribe SQLite automáticamente
   ▼
Pantalla "Datos de este dispositivo"
   ├─ Resumen local calculado en el dispositivo (sin enviar PHI)
   ├─ Mantener separado en este dispositivo
   └─ "Revisar e importar" (consentimiento explícito)
          │
          ▼
   Preview remoto autenticado: solo IDs, tipo y versión de esquema
          │
          ├─ Mostrar colisiones opacas / casos que requieren decisión
          └─ Confirmar importación
                  │
                  ▼
          Remapear UUID locales en colisión y todas sus referencias de dominio
          y dependencias locales (sin sincronizar adjuntos)
          Push de operaciones en lotes idempotentes
          ACK local transaccional
```

### Preview, consentimiento y rechazo

- Antes de una llamada remota, la UI calcula localmente mascotas, registros,
  rutinas, ejecuciones, citas, eventos y recordatorios pendientes, además de
  errores y total aproximado. Los adjuntos médicos y sus metadatos se excluyen
  del preview y de sus conteos importables; permanecen locales. El resumen no
  incluye nombres, notas, síntomas, medicamentos ni contenidos médicos en
  telemetría.
- El primer preview remoto envía solo `local_account_id`, `device_id`, versión
  de esquema y manifest de `{entity_type, entity_id, local_revision}` de las
  entidades sincronizables admitidas por la allowlist v1 que el usuario eligió
  revisar. No incluye `health_attachment`, payloads médicos ni metadatos de
  adjuntos. La API
  autentica al usuario y responde por cada ID si está libre en su ámbito,
  ya es propiedad de esa misma cuenta o está en una colisión no revelable.
- La respuesta no confirma ni revela que un UUID colisionado pertenece a otro
  usuario. No devuelve propietario, email, nombre ni snapshots ajenos.
- La UI muestra el alcance y las advertencias. Solo una acción explícita
  “Confirmar importación” arma el primer push con datos. Un consentimiento no
  implícito en login, selección de dispositivo, permiso de notificaciones o
  aceptación general.
- Si se rechaza/cancela, no se actualizan `owner_id`, `account_id`, datos,
  outbox, cursor ni tokens. Los datos provisionales se conservan localmente y
  separados; la cuenta autenticada puede usar funciones online sin asociarlos.
- Una importación pausada puede continuar por las mismas operaciones
  persistidas; cualquier cambio nuevo local permanece en el outbox. El usuario
  puede desconectarse de la cuenta sin borrar sus datos locales. Inicialmente
  solo una cuenta autenticada puede estar activa en el dispositivo; cambiarla
  requiere cerrar la sesión activa, sin cambiar el propietario provisional ni
  combinar perfiles locales.

### Duplicados y colisiones UUID

- Import idempotente: la misma fila/UUID ya existente en el mismo `user_id` se
  trata como existente, no como una segunda entidad. No sobrescribirla por
  comparar únicamente UUID.
- Si la entidad existe y la versión/contenido local coinciden según la regla
  canónica acordada, responder `already_applied` o crear un no-op auditable;
  si difiere, crear conflicto y pedir decisión.
- Si el UUID ya pertenece a otro propietario, responder `identity_collision`
  opaco. No actualizar, transferir, enumerar ni devolver datos.
- Después de la confirmación de importación, generar un UUID nuevo para la
  entidad local en colisión y actualizar en una transacción SQLite su clave
  primaria y todas las referencias locales: mascota, historial médico,
  solo referencias locales de adjuntos, cuidados, ejecuciones, citas,
  eventos, recordatorios, referencias en snapshots/conflictos y payloads
  pendientes del outbox. Mantener un mapping local de importación
  `source_entity_id → imported_entity_id` hasta que la importación termine y
  sea recuperable. Aplicar remaps en orden de dependencias y sin descartar
  registros.
- Para operaciones pendientes nunca enviadas, generar `operation_id` nuevos
  cuando cambie el contenido canónico y crear un mapping local
  `old_operation_id → new_operation_id`; actualizar tanto las referencias de
  entidad en payloads como los `depends_on` que apunten a IDs reemplazados, y
  calcular de nuevo el hash. Una operación que ya se envió o
  quedó `in_flight` es inmutable: no reescribirla ni reutilizar su ID con otro
  hash. Resolverla por el flujo de conflicto y crear una operación sucesora.
  El remap de entidad se confirma localmente antes del primer push de
  importación; si falla, rollback completo.
- `operation_id` tiene unicidad por usuario en el servidor. No cambiarlo al
  reintentar; si se genera un ID nuevo se pierde la garantía de deduplicación.

### Cuentas y dispositivos

- Cada instalación registra su UUID `device_id` bajo el usuario autenticado.
  La tabla `sync_devices` ya reserva ese concepto, pero su registro/revocación
  no tiene endpoint.
- El propietario central es compartido; cada dispositivo guarda su cursor
  propio y ejecuta push/pull bajo el mismo `user_id`. Un cambio que crea
  dispositivo A aparece en el feed que consulta B.
- Reinstalar implica nueva instalación/device ID salvo que exista backup
  seguro. Revocar un dispositivo invalida su acceso a sync y no borra datos
  remotos ni datos locales.
- Un dispositivo mantiene una sola cuenta autenticada activa a la vez. El
  cierre de sesión no borra el perfil provisional ni los datos autenticados
  cacheados; cualquier cambio de cuenta exige una acción explícita y no importa
  ni mezcla datos locales.
- La base remota no distingue datos de “cuenta” por el UUID provisional local.
  Los datos provisionales quedan separados hasta que el usuario decida
  importarlos o mantenerlos separados.

## 3. Contratos HTTP

Prefijo propuesto `/sync/v1`. Todas las rutas, excepto health, exigen
`Authorization: Bearer <access-token>` vigente y TLS en despliegue. Ningún DTO
incluye credenciales, `user_id` o un `owner_id` confiable. Si se incluyen
metadatos locales heredados, la API los ignora para autorización y no los
persiste como dueño.

### 3.1 Registro y revocación de dispositivo

`PUT /sync/v1/devices/{device_id}` es idempotente para un usuario autenticado.
Un dispositivo no puede reasignarse a otro usuario.

```json
{
  "device_id": "44af5334-c444-4912-8e5e-2f2894ad615a",
  "client": {
    "platform": "ios",
    "app_version": "1.0.0",
    "schema_version": 5
  },
  "device_name": "iPhone de Ana"
}
```

Respuesta `200` al registrar/reafirmar:

```json
{
  "device_id": "44af5334-c444-4912-8e5e-2f2894ad615a",
  "status": "active",
  "last_download_cursor": "0",
  "registered_at": "2026-11-10T18:00:00.000Z"
}
```

El cliente no puede enviar ni adelantar `last_download_cursor`. `device_name`
es opcional, de longitud máxima 100 y texto saneado. Los valores de plataforma
permitidos son `ios`, `android`, `web`, `other`.

`DELETE /sync/v1/devices/{device_id}` revoca solo si pertenece al Principal;
ID inexistente o ajeno devuelve la misma respuesta `204`. Revocar no elimina
datos del usuario.

### 3.2 Preview de importación local

`POST /sync/v1/import/preview` prepara una comparación, no crea ni modifica
entidades.

```json
{
  "device_id": "44af5334-c444-4912-8e5e-2f2894ad615a",
  "local_account_id": "5b93fbb0-20d2-48f1-a0a0-51d04bd6872f",
  "schema_version": 5,
  "manifest": [
    { "entity_type": "pet", "entity_id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79", "local_revision": 3 },
    { "entity_type": "health_record", "entity_id": "4dad1c0c-5f71-4434-b2b8-a93739a81224", "local_revision": 1 }
  ]
}
```

Respuesta:

```json
{
  "preview_id": "a9f73b38-fb5c-40ee-a344-49f11b873846",
  "expires_at": "2026-11-10T18:10:00.000Z",
  "counts": { "new": 1, "same_owner_existing": 0, "collision": 1, "unsupported": 0 },
  "items": [
    {
      "entity_type": "pet",
      "entity_id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
      "disposition": "new"
    },
    {
      "entity_type": "health_record",
      "entity_id": "4dad1c0c-5f71-4434-b2b8-a93739a81224",
      "disposition": "identity_collision"
    }
  ]
}
```

`preview_id` es corto de vida, asociado server-side con Principal/device,
manifest y esquema; no autoriza push y caduca a los 10 minutos. No guardar
payload médico ni snapshots en el preview. La respuesta nunca revela la
identidad de otro dueño. Solo tipos habilitados por la versión del servidor
pueden aparecer como importables.

Tras que el usuario confirme, el cliente comienza push normal con un
`import_id` UUID, referido en cada operación o en la petición batch. El backend
rechaza operaciones de importación no asociadas a un preview vigente cuando
la política de cuenta/device exige consentimiento. Repetir el mismo
`import_id` debe ser idempotente.

### 3.3 Push de operaciones

`POST /sync/v1/push`, máx. **50 operaciones** y **512 KiB** de JSON UTF-8 por
solicitud. Máx. recomendado de **64 KiB** por payload de entidad; adjuntos
binarios no se admiten. `operation_id` y `entity_id` deben ser UUID canónicos.
Las dependencias deben existir en el batch o estar previamente confirmadas.

```json
{
  "protocol_version": 1,
  "device_id": "44af5334-c444-4912-8e5e-2f2894ad615a",
  "batch_id": "5094b2f3-0d9e-40ea-8203-7ace7032c500",
  "import_id": "2ce4a0ed-a34a-46ac-b7fe-17915aed7b39",
  "operations": [
    {
      "operation_id": "3a4eb4c9-f853-4f66-91c3-d6c85a5f235d",
      "entity_type": "pet",
      "entity_id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
      "action": "create",
      "base_version": 0,
      "local_revision": 1,
      "depends_on": [],
      "changed_fields": ["name", "species"],
      "payload": {
        "id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
        "name": "Miso",
        "species": "cat",
        "breed": null,
        "sex": "female",
        "birth_date": "2023-04-15",
        "approximate_age_months": null,
        "weight_kg": 4.2,
        "color": "carey",
        "notes": null,
        "photo_storage_key": null,
        "created_at": "2026-11-10T17:00:00.000Z",
        "updated_at": "2026-11-10T17:00:00.000Z",
        "deleted_at": null
      }
    }
  ]
}
```

Campos:

- `protocol_version`: entero requerido; servidor rechaza versión no soportada
  con `PROTOCOL_VERSION_UNSUPPORTED`.
- `device_id`, `batch_id`: requeridos, UUID; dispositivo activo y del
  Principal.
- `import_id`: opcional, UUID emitido tras confirmación de importación.
- `entity_type`: enum cerrado por versión; allowlist efectiva de API v1:
  `pet`, `health_record`, `care_task`, `care_execution`, `appointment`,
  `calendar_event`, `calendar_reminder`. `health_attachment` y `reminder`
  legacy se excluyen de la allowlist y de import preview, push y pull.
  `reminder` se conserva en PostgreSQL y en el CHECK/feed por compatibilidad,
  pero no puede ser admitido por las rutas v1. `ai_conversation`/`ai_message`
  también quedan excluidos. La tabla PostgreSQL `health_attachments` no se
  modifica; filas, metadata y archivos locales no participan en el protocolo.
- `action`: `create`, `update`, `delete`; delete es siempre tombstone.
- `base_version`: versión remota que el cliente cree haber confirmado; `0`
  solo para creación nueva. `update`/`delete` exigen versión > 0, excepto
  operación create aún no enviada coalescida como create.
- `local_revision`: contador monotónico local, diagnóstico/ACK; no sustituye
  `base_version`.
- `depends_on`: hasta 50 operation IDs; acíclico y topológico. En un batch se
  ordenan antecedente antes de dependiente. Dependencias que aún no estén
  confirmadas se conservan en el outbox y no se incluyen como elegibles.
- `changed_fields`: array único de nombres permitidos del tipo; no puede
  incluir campos server-owned (`owner_id`, `version`, `created_at` ya creado,
  `updated_at`, cursores) ni incluir una clave que no corresponda al DTO.
- `payload.id` debe coincidir con `entity_id`; campos del usuario se validan
  por esquema; campos de ownership se omiten.

El cliente calcula `request_hash` sobre la operación canónica definida en
§3.4; no lo elige ni lo envía como autoridad. El servidor calcula el mismo
hash después de validar/normalizar.

### 3.4 Hash canónico e idempotencia

Para cada operación, calcular SHA-256 hexadecimal de UTF-8 de JSON canónico
RFC 8785/JCS sobre:

```json
{
  "protocol_version": 1,
  "operation_id": "UUID",
  "entity_type": "pet",
  "entity_id": "UUID",
  "action": "update",
  "base_version": 4,
  "local_revision": 8,
  "depends_on": [],
  "changed_fields": ["name"],
  "payload": {}
}
```

Normalización previa: trim/case únicamente en campos cuyo contrato lo define;
timestamps UTC; números finitos; arrays conservan orden salvo `changed_fields`
y `depends_on`, que se validan únicos y se ordenan lexicográficamente para el
hash; objetos sin claves extra; `null` explícito donde el DTO lo permite. No
se incluyen `batch_id`, bearer token, device name, reintentos, ni cabeceras.
Regla exacta de canonicalización debe compartirse mediante test vectors
cliente/servidor.

La clave receipt es `(user_id, operation_id)`. Mismo ID/hash devuelve el
resultado previamente guardado; mismo ID/hash diferente devuelve
`OPERATION_ID_REUSED`. Receipt, dominio, `sync_changes`, cursor y respuesta se
confirman en una sola transacción por operación. La respuesta guardada incluye
los resultados terminales y no vuelve a ejecutar side effects.

### 3.5 Respuesta por operación y confirmación cliente

Respuesta HTTP `200` significa que el batch fue parseado; **no** que todos los
items se aceptaron. Cada operación devuelve un resultado:

```json
{
  "protocol_version": 1,
  "batch_id": "5094b2f3-0d9e-40ea-8203-7ace7032c500",
  "results": [
    {
      "operation_id": "3a4eb4c9-f853-4f66-91c3-d6c85a5f235d",
      "status": "applied",
      "entity_type": "pet",
      "entity_id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
      "server_version": 1,
      "server_updated_at": "2026-11-10T18:00:01.000Z",
      "cursor": "42",
      "request_hash": "64-lowercase-hex-characters"
    }
  ],
  "summary": {
    "applied": 1,
    "already_applied": 0,
    "conflict": 0,
    "rejected": 0,
    "dependency_blocked": 0,
    "retryable": 0
  }
}
```

Resultados posibles:

| Estado | Significado y acción cliente |
|---|---|
| `applied` | Commit remoto finalizado; aplicar versión y cursor devueltos en transacción local y marcar operación acknowledged. |
| `already_applied` | Receipt igual ya fue procesado; misma aplicación local del ACK guardado. |
| `conflict` | Base versión obsoleta; persistir conflicto y snapshots locales/remotos; no avanzar operación dependiente. |
| `rejected` | Error permanente de validación/relación/identidad/contrato; pasar a failed, mostrar mensaje accionable sanitizado. |
| `dependency_blocked` | Antecedente no aceptado/confirmado; mantener pendiente bloqueada sin consumirla como success. |
| `retryable` | Fallo transitorio no confirmado; mantener operación y reintentar con backoff. Receipt no debe fingir éxito. |

Confirmación local del ACK **no usa un endpoint adicional**: en una transacción
SQLite, el cliente verifica `operation_id` y `request_hash`, actualiza
`server_version` y `acknowledged_local_revision` hasta la revisión que recibió
ACK, elimina o marca acknowledged la fila de outbox, aplica los IDs/cursors y
desbloquea dependientes. Si hubo una edición posterior al envío, el ACK no
reemplaza el snapshot local ni marca esa revisión posterior como confirmada;
su operación dependiente sigue pendiente. Si la app cae antes del commit local,
repite push; receipt vuelve a responder igual. La cola actual carece del estado
`acknowledged`; se propone agregarlo o eliminar la operación y preservar
relaciones hasta que no existan referencias.

Respuesta `207` no se propone inicialmente para evitar intermediarios que no
manejan WebDAV multi-status; el detalle parcial va en `results`. Errores de
envoltura (JSON inválido, token no válido, device revocado, batch demasiado
grande) usan HTTP 4xx/5xx con error común y no cambian datos.

### 3.6 Pull de cambios

`POST /sync/v1/pull`:

```json
{
  "protocol_version": 1,
  "device_id": "44af5334-c444-4912-8e5e-2f2894ad615a",
  "after_cursor": "41",
  "limit": 200
}
```

El cursor es string decimal para no perder precisión al pasar `bigint` por
JavaScript. `limit` permitido: 1–500; default 200.

Respuesta:

```json
{
  "protocol_version": 1,
  "device_id": "44af5334-c444-4912-8e5e-2f2894ad615a",
  "changes": [
    {
      "cursor": "42",
      "entity_type": "pet",
      "entity_id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
      "entity_version": 1,
      "change_type": "upsert",
      "changed_fields": ["name", "species"],
      "occurred_at": "2026-11-10T18:00:01.000Z",
      "entity": {
        "id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
        "name": "Miso",
        "species": "cat",
        "version": 1,
        "created_at": "2026-11-10T17:00:00.000Z",
        "updated_at": "2026-11-10T18:00:01.000Z",
        "deleted_at": null
      }
    }
  ],
  "next_cursor": "42",
  "has_more": false,
  "server_cursor": "42"
}
```

- `entity` es snapshot canónico owner-scoped actual; en tombstone puede ser
  metadata mínima (`id`, `version`, `deleted_at`) si los datos sensibles deben
  purgarse del cliente, conservando el tipo y el ID.
- Orden estricto ascendente por cursor; cursor de un propietario, no global
  para autorización. No saltar valores por paginación.
- `next_cursor` avanza únicamente hasta el último cambio incluido. Si no hay
  cambios, permanece igual que `after_cursor`. `server_cursor` es la última
  secuencia confirmada y sirve para indicar que hay más páginas, no para
  avanzar el cliente.
- Cambios del mismo usuario pueden incluir otros dispositivos; el pull de un
  dispositivo puede omitir su propio cambio si operation_id se devuelve
  también en pull, pero no debe omitir cambios necesarios para otro dispositivo.
  Propuesta inicial: devolverlos todos e ignorar localmente versiones ya
  aplicadas, para simplificar continuidad. Confirmar en benchmark.
- Aplicación cliente y `sync_metadata.last_download_cursor` cambian juntos en
  transacción SQLite. Si cualquier fila no se puede aplicar, rollback y reintento
  o registrar item de conflicto sin adelantar el cursor más allá del primer
  cambio no resuelto.

### 3.7 Reporte y resolución de conflictos

Push puede responder `conflict` con información suficiente para resolver:

```json
{
  "operation_id": "3a4eb4c9-f853-4f66-91c3-d6c85a5f235d",
  "status": "conflict",
  "conflict": {
    "conflict_id": "2a3aecc5-d515-4094-8e0b-233a8b97c453",
    "entity_type": "pet",
    "entity_id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
    "base_version": 4,
    "server_version": 5,
    "local_revision": 8,
    "conflicting_fields": ["name"],
    "server_snapshot": {
      "id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
      "name": "Miso",
      "species": "cat",
      "version": 5,
      "updated_at": "2026-11-10T18:05:00.000Z"
    }
  }
}
```

El cliente ya conserva su snapshot local en `sync_conflicts`; debe guardar la
respuesta sin exponerla en logs. Snapshot remoto se devuelve únicamente al
propietario autenticado y al recurso que pertenece a su `Principal`.

`POST /sync/v1/conflicts/{conflict_id}/resolve`:

```json
{
  "device_id": "44af5334-c444-4912-8e5e-2f2894ad615a",
  "resolution_operation_id": "2d0b2533-c37b-4b1f-99f9-6075c9388677",
  "strategy": "merge",
  "expected_server_version": 5,
  "changed_fields": ["name", "notes"],
  "payload": {
    "id": "e5bff8e4-88f4-4af4-8b5a-b65cb8d50d79",
    "name": "Miso",
    "species": "cat",
    "notes": "Nombre confirmado con la familia"
  }
}
```

Estrategias permitidas `accept_server`, `keep_local`, `merge`. `accept_server`
no debe enviar payload; se aplica el snapshot remoto localmente, se cierra el
conflicto y las operaciones locales relacionadas quedan preservadas como
resueltas/reemplazadas con trazabilidad, no eliminadas silenciosamente.
`keep_local`/`merge` se convierten en una nueva operación con nuevo
`resolution_operation_id` y `base_version = expected_server_version`; la
operación original permanece trazada, no se reutiliza el ID ni se borra el
conflicto antes del ACK. Si la versión actual ya cambió, responder conflicto
nuevo (409/resultado conflict), no forzar overwrite.

La combinación controlada se permite solo para campos básicos de `pet`
(nombre, especie, raza, sexo, fecha de nacimiento/edad aproximada, peso, color
y notas generales). La UI muestra los valores local y remoto por campo; el
usuario selecciona el valor resultante y confirma antes de producir el nuevo
payload. La estrategia `merge` del endpoint solo se admite para `pet`; para los
demás tipos se rechaza como estrategia y la interfaz debe recoger una decisión
manual explícita de conservar remoto, conservar local o editar el valor final.
No hay merge automático por timestamp. Para `health_record`,
`care_execution` y `calendar_reminder`, cualquier divergencia requiere
resolución manual explícita (aceptar remoto, conservar local o editar un
resultado); no se combinan snapshots automáticamente. Los demás tipos quedan
en conflicto manual hasta definir una política específica.

#### Cambio remoto mientras hay ediciones locales pendientes

Se considera localmente sucia una entidad con operación outbox no confirmada o
`local_revision > acknowledged_local_revision`. Al recibir un cambio remoto:

1. Si `entity_version <= server_version` ya aplicado localmente, tratarlo como
   repetido/antiguo: no alterar la fila ni el outbox; puede avanzar el cursor
   dentro de la transacción normal.
2. Si la entidad no tiene cambios locales sin confirmar, aplicar el snapshot
   remoto y su `server_version` normalmente, sin incrementar `local_revision`
   (la aplicación de sync no es una edición del usuario).
3. Si la entidad está sucia y el cambio remoto supera la `server_version`
   local, **no sobrescribir la fila local ni reemplazar/eliminar operaciones**.
   Guardar el snapshot remoto y su cursor en la tabla SQLite local
   `sync_conflicts`, junto con la versión base, revisión local y operation IDs
   implicados. La tabla PostgreSQL `sync_conflicts` guarda solo metadatos, sin
   snapshots ni payloads. Marcar esas operaciones como `conflict`/`blocked`
   sin alterar su payload/hash; bloquear nuevas operaciones dependientes de esa
   entidad hasta resolver.
4. Persistir el conflicto antes de avanzar `last_download_cursor`. La
   aplicación del registro de conflicto y del cursor se hace en la misma
   transacción SQLite. Si no se puede conservar el conflicto, rollback y
   repetir pull desde el cursor anterior.
5. Resolver mediante la regla de la entidad: merge revisado por usuario para
   campos básicos de mascota; resolución manual para historial médico,
   ejecuciones y recordatorios. La resolución crea una operación nueva con
   base en la `server_version` remota observada. Si entretanto llega otra
   versión, se abre/actualiza el conflicto y se requiere resolver de nuevo.
6. Entidades locales sin ACK remoto (por ejemplo, create con `server_version=0`)
   no se sustituyen por coincidencia de UUID. Tratar la coincidencia como
   conflicto de identidad y aplicar el flujo opaco de colisión/importación.

No se hace merge silencioso ni siquiera cuando los campos modificados parecen
disjuntos. Una futura optimización de merge de campos no conflictivos requiere
un contrato explícito, pruebas y decisión de producto.

### 3.8 Errores de protocolo

Formato común:

```json
{
  "error": {
    "code": "DEVICE_REVOKED",
    "message": "Este dispositivo ya no puede sincronizar.",
    "requestId": "uuid"
  }
}
```

Errores de envoltura: `400 INVALID_REQUEST`,
`401 UNAUTHENTICATED`, `403 DEVICE_REVOKED`, `409 PROTOCOL_VERSION_UNSUPPORTED`,
`413 BATCH_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `422 INVALID_OPERATION`,
`429 RATE_LIMITED`, `503 SYNC_TEMPORARILY_UNAVAILABLE`. Nunca devolver SQL,
connection string, detalle interno, existencia de recursos ajenos ni contenido
de otro propietario.

## 4. Matriz de entidades y representación canónica

Reglas comunes de todas las tablas remotas syncables: `id uuid`, `owner_id`
tomado de Principal, `version integer > 0`, `created_at`, `updated_at`,
nullable `deleted_at`; FK compuestas por `(owner_id, id)` donde una entidad
hija referencia otra; no usar `ON DELETE CASCADE` para purgar datos de dominio.
Cada mutación válida crea una entrada de feed, incluido tombstone.

| Tipo de entidad | DTO canónico / campos a preservar | Relaciones y reglas | Migración remota requerida |
|---|---|---|---|
| `pet` | Nombre, especie, raza, sexo, birth date/edad, peso, color, notas, photo key. IDs/timestamps/version server owned. | `owner_id` siempre JWT. UUID debe ser único global; colisión ajena opaca. | Esquema base existente en 0001; revisar normalización/constraints y metadata de versión local, sin asumir despliegue. |
| `health_record` | `record_type`, `record_subtype`, título, descripción, occurred_at, profesional, clínica, observaciones, `details` JSON object, `next_event_at`. | FK `(owner_id, pet_id)`; exam conserva subtype sin degradarse a observation genérico. Campos PHI limitados. | Añadir `record_subtype`, `clinic_name`, `observations`, `details_json jsonb NOT NULL DEFAULT '{}'`, `next_event_at`; checks/index upcoming. |
| `health_attachment` | No forma parte del protocolo ni del manifest de importación inicial. Metadatos, referencias, URI/bytes y estado permanecen locales. | No subir filas, `local_uri`, metadatos ni bytes en import preview/push/pull. El remapeo UUID por importación solo actualiza referencias locales si corresponde. | No modificar la tabla PostgreSQL `health_attachments` existente. No crear migración de adjuntos para v1; storage y transferencia quedan para fase posterior. |
| `care_task` | `category` (incluye exercise), `task_type`, `recurrence_rule`, title, description, observations, notes, `schedule_json`, timezone IANA, starts/next/ends y enabled. Conservar los dos campos legacy durante la transición. | FK `(owner_id, pet_id)`; conservar ambos modelos de schedule durante transición. No recalcular historia al pull. | Añadir columnas nuevas sin eliminar `task_type`/`recurrence_rule`. No ejecutar backfills ambiguos de categoría o schedule; permitir estado transitorio para datos existentes y exigir datos nuevos válidos en writes sincronizables. |
| `care_execution` | UUID de ocurrencia, task/pet, `scheduled_for`, `executed_at`, status `scheduled`, `completed`, `omitted` o `cancelled`, notes, versión/tombstone. Una fila `scheduled` es una ocurrencia programada; una cancelada conserva su `scheduled_for` original y `executed_at=NULL`. Reprogramar crea otra fila `scheduled` con UUID y slot diferentes. | FK compuesta owner/task/pet; `UNIQUE(owner_id, task_id, scheduled_for)` incluye filas canceladas/tombstoned; v1 no permite reutilizar un slot cancelado. `completed` exige `executed_at`; `scheduled`, `omitted` y `cancelled` lo dejan NULL. | Crear la tabla PostgreSQL `care_task_executions`, índices timeline/task, checks y FK; añadir el tipo de feed `care_execution`. Mantener el historial: reprogramar nunca sobrescribe ni elimina la ocurrencia anterior. |
| `appointment` | Pet, title, starts/ends, location, notes, status scheduled/completed/cancelled. | FK owner/pet; ends > starts; deleted_at tombstone. | Tabla base existe en 0001; alinear constraints y pruebas de esquema. |
| `calendar_event` | Título, descripción, category custom/birthday/travel/grooming/other, starts/ends, timezone, status, observations, opcional pet. | General permitido (`pet_id NULL`) o pet-owned; FK compuesta owner/pet; ends > starts. | Crear tabla con `UNIQUE(owner_id,id)` y `UNIQUE(owner_id,id,pet_id)`, índices owner/start y pet/start y checks. |
| `calendar_reminder` | UUID, exactamente un target (calendar event, care task, appointment, health record), `pet_id` opcional solo para evento general, title, remind_at, lead_minutes, timezone, pending/attended/cancelled, enabled, notes. | Owner del reminder y del target debe ser el Principal; mascota igual a la del target, o ambos NULL para evento general. Se permiten múltiples reminders por target incluso con la misma hora. | Crear la tabla PostgreSQL `calendar_reminders` separada de `reminders`; CHECK exactly-one; FKs owner-target; para evento FK independiente `(owner_id,calendar_event_id)` y además relación composite pet; constraint triggers diferibles validan ambos lados, incluidos updates posteriores del target. |
| `reminder` legacy | Modelo legacy separado, no es alias de `calendar_reminder`. | Mantener su tipo en schema/feed por compatibilidad, pero no admitir en allowlist API v1 ni en import preview/push/pull. | No migrar ni eliminar en v1. No modificar la tabla PostgreSQL existente. |
| `ai_conversation`/`ai_message` | Fuera de sync inicial. | Datos sensibles; modelo actual pet-only. | No habilitar sin aprobación independiente de privacidad/retención y soporte general vs pet-scoped. |
| notificación programada | No DTO remoto. | Solo identificador de SO/estado local por instalación. | No crear tabla remota. |

#### Integridad relacional de `calendar_reminders`

- Debe cumplirse exactamente uno de `calendar_event_id`, `care_task_id`,
  `appointment_id` y `health_record_id`. Una restricción `CHECK` valida esa
  cardinalidad; FKs compuestas hacen cumplir existencia y ownership, no solo
  validación de la API.
- Para eventos, definir una FK independiente
  `(owner_id,calendar_event_id)` → `calendar_events(owner_id,id)`, además de
  la relación composite necesaria para validar `pet_id`. La FK independiente
  también valida la existencia/propiedad cuando `pet_id` del evento general
  es `NULL` y una FK compuesta con `MATCH SIMPLE` podría no comprobarla.
- `pet_id=NULL` solo es válido si el único destino es un `calendar_event` cuyo
  `pet_id` también es `NULL`. Para un evento con mascota, tarea, cita o
  registro médico, el reminder debe tener el mismo `pet_id` no nulo.
- Constraint triggers `DEFERRABLE INITIALLY DEFERRED` validan el reminder al
  insertarlo/cambiar target, owner o pet; también vuelven a validar reminders
  existentes cuando cambia `owner_id`, ID o `pet_id` del destino. La
  transacción que cambia un evento general a pet-scoped debe actualizar sus
  reminders de forma coherente antes del commit; de lo contrario se rechaza.
- Eventos generales y sus reminders pueden conservar `pet_id=NULL`. No se
  crea mascota implícita. No se define unicidad por target ni por hora:
  múltiples recordatorios independientes, incluso a la misma hora, son
  válidos.

### Tablas de soporte PostgreSQL propuestas

| Tabla | Columnas/constraints propuestas |
|---|---|
| `sync_devices` | Actual: `(id,user_id)`, cursor y revocación. Mantener cursor no negativo. Considerar platform, app/schema version, `last_seen_at`, `revoked_at`; ninguna actualización de cursor desde body no validado. Unique `(user_id,id)` ya existe. |
| `sync_operations` | Mantener receipt `(user_id,operation_id)`, SHA-256 hash y respuesta terminal JSON. No purgar automáticamente en la primera versión; limitar payload almacenado a respuesta no sensible. Insert/update atomizados con dominio. |
| `sync_changes` | Mantener PK `(owner_id,cursor)`, entity/version/op/change/changed_fields. Ampliar CHECK para care_execution, calendar_event, calendar_reminder después de esquema. `operation_id` opcional para cambios internos y referencia compuesta al receipt cuando presente. |
| `sync_cursors` | Contador transaccional por `owner_id`, único. Reservar N cursores con row lock y escribir todos los cambios en misma transacción. |
| `sync_conflicts` (nuevo, adoptado) | `id`, `owner_id`, `device_id`, `operation_id`, `entity_type`, `entity_id`, `base_version`, `server_version`, `conflicting_fields`, `status`, timestamps. FK/unique owner-op. Solo metadatos; no guardar snapshots, payloads ni información médica. Los snapshots necesarios se guardan localmente; una respuesta remota obtiene el estado vigente por consulta owner-scoped. |
| `sync_imports` (nuevo, adoptado) | `id/import_id`, `owner_id`, `device_id`, manifest hash de IDs/tipos admitidos, schema version, estado preview/confirmed/completed/cancelled/expired, registro de consentimiento y timestamps. Solo metadatos; no guardar payloads ni información médica. Excluir adjuntos y reminder legacy del manifest v1. |
| `sync_entity_ownership` (solo si UUID global requiere mapping) | No adoptar de entrada: domain tables ya tienen IDs UUID globales y owner. Usar control de conflicto sin mapa si posible. Un mapping temporal de importación vive localmente si se genera un UUID alternativo. |

Índices requeridos: `(owner_id,cursor)` para pull; `(user_id,revoked_at,last_seen_at)`
para devices; `(user_id,processed_at)` para retención receipts; índice de
consulta por `(owner_id,entity_type,entity_id,cursor DESC)`; índices parciales
para upcoming/reminders/tombstones si las consultas lo requieren. Revisar
EXPLAIN en DB de prueba; no añadir índices por duplicado a los existentes.

## 5. Versionado y concurrencia

### Campos y reglas

Se propone separar inequívocamente:

- `local_revision`: entero local que empieza en `0` y aumenta exactamente en
  uno en la misma transacción que **toda** modificación local de la entidad,
  incluidos cambios de campos, relaciones, soft delete y ejecuciones. No se
  envía como autoridad de concurrencia.
- `server_version`: contador local de la última versión remota confirmada;
  empieza en `0` para una entidad aún no creada remotamente. Solo una respuesta
  remota confirmada o un pull válido puede cambiarlo. En PostgreSQL, la columna
  canónica se llama `version`; el DTO la expone como `server_version`.
- `acknowledged_local_revision`: última `local_revision` cuyo contenido fue
  confirmado por el servidor. Permite detectar datos locales sucios incluso si
  la cola quedó inconsistente. Avanza solo en la transacción local que aplica
  un ACK correspondiente.
- `base_version`: en cada operación es el `server_version` local que el cliente
  espera modificar y corresponde a PostgreSQL `version`. El outbox lo congela
  al momento de despacho inicial; jamás se sustituye por `updated_at` ni se
  incrementa con la revisión local.
- PostgreSQL `version`: entero positivo canónico. Create aceptado asigna 1;
  update/delete aceptado solo con `base_version = version` asigna
  `version + 1`; solo una transacción gana.

### Mutaciones offline y `base_version`

1. Cada edición incrementa `local_revision` y escribe/actualiza la operación
   local en la misma transacción. La primera operación después de una
   confirmación guarda `server_version` como `base_version`.
2. Mientras una operación de esa entidad no se haya enviado (`pending`), varias
   ediciones offline se coalescen en un único payload/operación conservando el
   primer `operation_id`, base_version, unión de `changed_fields` y revisión
   local más reciente.
3. Create seguido por update, antes de primer envío, permanece `create` y
   contiene el snapshot final, `base_version=0`. Create seguido por delete
   conserva la cadena y sus dependencias; no se cancela silenciosamente.
4. Si hay operación en vuelo, cambios posteriores crean operación dependiente.
   Después del ACK del antecedente, pero antes del primer envío del
   dependiente, cliente reasigna su `base_version` a la versión canónica recién
   confirmada. Una vez transmitido, esa versión queda inmutable.
5. El cliente no debe coalescer una operación que tenga dependientes referidos
   sin actualizar sus enlaces de forma transaccional.
6. La respuesta push incluye `server_version`. Aplicación del ACK en SQLite y
   actualización de `server_version` son atómicas.

Se requiere adaptar el esquema SQLite: la columna `version` actual no
incrementa sistemáticamente y no puede reutilizarse como ninguno de los tres
contadores sin backfill probado. Una migración local futura debe añadir
`local_revision`, `server_version` y `acknowledged_local_revision`, preservar
el outbox existente e inferir valores iniciales solo con evidencia segura.
Filas con estado ambiguo se ponen en cuarentena/revisión; no se adivina ni se
descarta ningún cambio. Tras la migración, todos los repositorios y triggers
locales deben incrementar `local_revision` en cada mutación.

### Detección de concurrencia

- SQL condicional remoto: `UPDATE ... WHERE owner_id=$principal AND id=$id AND
  version=$base_version AND deleted_at IS NULL RETURNING ...`.
- Si no actualiza, leer la versión/snapshot solo dentro del mismo owner. Si
  recurso inexistente/ajeno, responder conflicto/ausente indistinguible sin
  revelar pertenencia. Si existe propio con versión distinta, conflict.
- Update y cursor asignado bajo una transacción PostgreSQL; el contador por
  propietario serializa el orden de cambios confirmados.
- Reintentar una operación repetida consulta receipt antes de volver a validar
  ni aplicar el update.

## 6. Conflictos

Un conflicto es una operación con base remota obsoleta o una colisión de
identidad, no un fallo transitorio.

- Persistir en SQLite el snapshot local enviado, snapshot del servidor
  autorizado, `base_version`, `server_version`, operación, campos conflictivos
  y estado abierto.
- No resolver “last write wins” por timestamp. No fusionar por defecto
  `health_record`, `care_execution`, `calendar_reminder` ni tombstones.
- Para campos independientes de perfil, puede ofrecerse merge explícito de
  campo; para notas médicas el usuario elige servidor, local o edición manual.
- Resolver `keep_local`/`merge` crea nueva operación y nuevo `operation_id`,
  basada en la `server_version` vigente. El original y el conflicto no se
  borran hasta recibir confirmación.
- Si llega otra edición remota antes del push de resolución, crear conflicto
  actualizado. No enviar resolución a versión obsoleta.
- Un conflict en padre bloquea dependientes; el usuario debe resolver el padre
  antes de procesar hijos que dependan de su estado.
- Colisión UUID de dueño distinto es opaca y nunca “mergeable” por acceso
  directo. Para importación, proponer reasignación local a UUID nuevo y revisión
  de relaciones.

## 7. Eliminaciones lógicas y tombstones

- `delete` produce `deleted_at` UTC y un `sync_changes.change_type='delete'`
  con entity ID, versión nueva, cursor y fecha. No se hace `DELETE FROM` de
  datos de dominio por sincronización.
- Un pull entrega el tombstone a todos los dispositivos, incluso si el row
  completo se ha minimizado por privacidad. El receptor conserva un registro
  local de tombstone/version para impedir que un snapshot antiguo resucite la
  fila.
- Eliminar mascota: antes de ejecutar, calcular y mostrar un resumen de
  registros médicos, tareas y ejecuciones, citas, eventos y recordatorios
  relacionados; distinguir los adjuntos locales, que no se sincronizan. Exigir
  confirmación explícita que indique que la eliminación lógica coordinada
  afectará a las entidades hijas listadas. Si se cancela, nada cambia.
- Tras confirmar, bloquear nuevas referencias y crear tombstones explícitos
  para la mascota y cada entidad de dominio hija afectada. La cola conserva
  cada operación y su relación de dependencia; procesa hijos antes que el
  padre (o usa una operación de grupo transaccional equivalente). No se
  eliminan físicamente filas, dependencias ni operaciones pendientes.
- Los adjuntos quedan locales y sus metadatos/bytes no se purgan. Se conserva
  su referencia local para recuperación/exportación; la UI debe advertir que
  no se sincronizan ni se eliminan por la tombstone remota de la mascota.
- Si existen hijos con create/update pendientes, mantener la cadena y ordenar
  sus operaciones antes del tombstone correspondiente. No cancelar ni
  reescribir operaciones ya enviadas; cualquier conflicto se resuelve
  explícitamente y el tombstone espera. Nunca borrar el receipt pendiente para
  “desatascar”.
- Bloquear nuevas creaciones hijas para padres tombstoned local/remoto.
- Durante la primera versión no hay purga automática de tombstones, cambios ni
  receipts de idempotencia. Se conservan hasta que exista una política de
  retención aprobada y probada; no se ejecuta compactación que vuelva
  irrecuperable un cursor.
- La caducidad de dispositivos y el full resync después de inactividad quedan
  pendientes. Ningún valor temporal (incluidos 180 días) se fija todavía como
  regla de borrado o expiración.

## 8. Protocolo push y pull

### Push

```text
Worker toma lock local
  → consulta operaciones pending/retry due cuyas deps están ACKed
  → orden topológico y límites de batch
  → marca in_flight y persiste antes de enviar
  → POST /push con bearer y operation_id estable
      → auth Principal + device ownership
      → validar DTO, tamaño, referencias y owner de cada FK
      → por operación: BEGIN
          receipt existente:
            mismo hash → devolver respuesta guardada
            hash distinto → OPERATION_ID_REUSED
          validar base_version y estado del padre
          aplicar mutación condicional, version++,
          reservar cursor owner-scoped, escribir sync_change + receipt
        COMMIT
      → respuesta por operación; batch puede mezclar resultados
  → transacción SQLite: aplicar ACK/rechazo/conflicto y desbloquear dependientes
  → liberar lock
```

El punto transaccional primario es por operación, no por batch: una operación
fallida no revierte operaciones independientes ya confirmadas. El receipt y
dominio/feed/cursor de cada operación sí son indivisibles. Un timeout de
respuesta no implica fallo remoto; el replay con el mismo ID recupera receipt.

### Dependencias y lotes

- Grafo acíclico en SQLite. El worker selecciona solo nodos cuyas dependencias
  ya tienen ACK remoto, ordena topológicamente y preserva orden por entidad.
- Un lote puede contener antecedente y dependiente en orden; el backend procesa
  secuencialmente. Si antecedente falla, dependiente devuelve
  `dependency_blocked`; no se procesa.
- Límite inicial: 50 operaciones, 512 KiB de JSON. Reducir lote al recibir
  `413`; una operación individual que excede límite pasa a rechazo permanente
  y no se reintenta eternamente.
- Coalescencia solo para operaciones nunca despachadas; límites, reglas y
  manejo de IDs de dependencia como en §5.

### Pull

```text
Worker tiene lock
  → POST /pull(device_id, after_cursor)
  → servidor valida Principal/device
  → lee sync_changes WHERE owner_id=Principal AND cursor>after
    ORDER BY cursor LIMIT N, snapshot owner-scoped
  → móvil abre BEGIN IMMEDIATE
      aplica cada cambio con regla server_version/tombstone
      actualiza metadata.last_download_cursor al next_cursor
    COMMIT
  → si has_more, solicita siguiente página; de lo contrario termina
  → libera lock
```

Cuando un cambio remoto corresponde a una entidad sucia localmente (outbox no
confirmado o `local_revision > acknowledged_local_revision`), no aplicar su
snapshot sobre la fila local ni modificar sus operaciones. Guardar cambio y
snapshot remoto como conflicto local, vincularlo a las operaciones pendientes
y persistirlo junto con el avance del cursor en una única transacción. Si no
puede guardarse el conflicto, rollback de toda la página y reintentar desde el
cursor anterior. Las operaciones afectadas quedan bloqueadas para push hasta
resolución explícita. Una entidad limpia acepta el snapshot remoto y actualiza
`server_version` sin incrementar `local_revision`. Ver §6 para reglas por tipo
y resolución; nunca se sobrescriben silenciosamente cambios locales.

### Cursores y atomicidad

- El cursor se serializa como decimal string en JSON y `bigint` en PostgreSQL.
- Cada transacción que emite k cambios incrementa `sync_cursors.last_cursor` en
  k y escribe el rango completo bajo el lock de esa fila. Rollback revierte
  incremento y feed; no hay cursor comprometido antes de commit.
- `sync_devices.last_download_cursor` se actualiza al último cursor que ese
  dispositivo confirmó localmente. API no puede avanzar ese cursor por un
  parámetro recibido: el cliente reenvía `after_cursor`; el servidor valida que
  sea coherente con el registro del device y no superior al feed.
- Cliente aplica todas las filas de página + cursor en la misma transacción.
  Fallo de integridad revierte ambos.
- Pull concurrente entre dispositivos es seguro; pull simultáneo en el mismo
  dispositivo se excluye por lock del worker.

### Reintentos y recuperación

- Solo errores de red, timeout, 429, 5xx y `503` son transitorios. Backoff
  exponencial con jitter: base 1 s, máximo 6 h; respetar `Retry-After`, máximo
  de intentos para mostrar estado/acción manual, no borrar operación.
- 400/401/403/413/422 y conflictos requieren acción de cliente o usuario;
  auth 401 puede intentar renovar token una vez, pero no reintentar operación
  si refresh falla.
- Después de cierre, `in_flight` vuelve a elegible; conservar `operation_id`,
  payload, hash y dependencias. Push replay es seguro por receipt.
- Lock local transaccional/atómico para un worker por DB, más exclusión in
  process para no abrir dos workers. Lease/owner/expiry puede ser necesario si
  hay múltiples runtimes Web/tab; Web necesita `navigator.locks`/Broadcast
  Channel o lease en SQLite validada bajo transacción.
- Las operaciones no se eliminan por éxito antes de aplicar el ACK local.
  Operaciones agotadas se mantienen visibles/recuperables.

## 9. Seguridad, privacidad y límites

- Todas las rutas push/pull/conflict/import/device exigen access JWT activo.
  `user_id` sale del Principal. `device_id` se consulta bajo el mismo user.
- SQL parametrizado; cada fila, parent, target, pet, adjunto y cambio de feed se
  verifica por `owner_id=Principal.userId`. FK compuesta es defensa adicional,
  no autorización suficiente.
- Nunca permitir payload cambiar `owner_id`, `version` canónica, cursor,
  operation owner, timestamps de servidor ni remote storage path.
- Respuestas a ID inexistente/ajeno deben ser indistinguibles, salvo el
  preview de importación que ofrece estados opacos sin datos del dueño.
- TLS en tránsito. Validar `content-type`, profundidad JSON, claves extra,
  UUID, enums, longitudes, rangos, JSON details y número finito. No cargar
  `local_uri`, rutas absolutas, tokens ni datos binarios en JSON de sync.
- Límites iniciales configurables: batch 50 op/512 KiB, item 64 KiB, pull
  500 changes, import preview 2,000 manifest items por página, 10 push/pull
  requests/min por device, además de límites IP y cuota por user. Son valores
  iniciales sujetos a pruebas y medición de red; no contratos inmutables.
- No registrar bodies, notas médicas, snapshots, bearer tokens, refresh
  tokens, cookies, connection strings ni nombres de archivo. Logs estructurados
  solo con request id, user/device pseudónimos si aprobados, operation ID,
  entity type, status, tamaño/duración y cursor. `last_error` local solo código
  seguro, no payload/excepción cruda.
- Datos médicos requieren minimización, consentimiento, acceso por usuario,
  retención definida y tratamiento de logs/backups. No cifrar por campo
  automáticamente sin decisión de búsqueda/recuperación y gestión de llaves.
- Los adjuntos no forman parte de la primera implementación. No aceptar bytes,
  metadata, URI local, checksum ni claves de almacenamiento en rutas de sync.
  Su estrategia de transferencia/autorización queda para una fase posterior.

## 10. Migraciones incrementales futuras

No ejecutar ni crear estas migraciones durante la fase de diseño. Implementar
como migraciones numeradas posteriores, tras aprobar contratos y verificar en
entorno autorizado qué versiones están aplicadas:

1. **Dominio extendido:** columnas de salud (`record_subtype`, clínica,
   observaciones, details JSONB, próxima fecha); columnas/categorías de cuidado
   (`category`, description, observations, schedule JSONB, next_run_at,
   ends_at); constraints/version checks e índices. Conservar
   `task_type`/`recurrence_rule`; no hacer backfills ambiguos de `category` ni
   `schedule_json`.
2. **Care executions:** tabla nueva con UUID, owner/task/pet, programada,
   real, status `scheduled|completed|omitted|cancelled`, notes,
   version/timestamps/deleted_at, FK compuesta, `UNIQUE(owner_id,task_id,
   scheduled_for)` incluso para canceladas/tombstoned y timeline indexes.
   Reprogramación conserva la ocurrencia cancelada y crea otra en un slot
   distinto; no se reutiliza el slot cancelado en v1.
3. **Calendar:** `calendar_events` y `calendar_reminders` separados, campos,
   status checks, exactly-one target, FK compuestas owner-target, FK
   independiente `(owner_id,event_id)` para el target evento además de la
   relación que valida mascota, constraint triggers diferibles para integridad
   pet-target e índices no únicos due/target.
4. **Sync entity support:** alterar el CHECK de `sync_changes` de forma
   incremental para incluir nuevos entity types; asegurar constraints/relación
   con receipts y cursor `(owner_id,cursor)`.
5. **Device/protocol state:** revisar tabla `sync_devices` para app/schema
   versions y lifecycle; crear `sync_conflicts` para metadatos de conflictos y
   `sync_imports` para preview, consentimiento y estado. No guardar snapshots,
   payloads ni información médica en esas estructuras.
6. **Version contract:** agregar/corregir `local_revision`,
   `server_version` y `acknowledged_local_revision` en SQLite, con campos de
   ACK/estado enviados. PostgreSQL conserva `version` como canónica remota y
   el DTO la expone como `server_version`. No reinterpretar versiones mediante
   migración silenciosa.
7. **Tombstone/retención:** no implementar purga automática de tombstones,
   cambios ni receipts en la primera versión. Definir retención, caducidad de
   cursores/dispositivos y full resync antes de diseñar compactación física.
8. **Adjuntos (fase posterior):** definir storage, metadata remota,
   transferencia, verificación e importación. En la primera versión, archivos
   y metadatos permanecen locales; no se modifica la tabla PostgreSQL
   `health_attachments`.

Las migraciones 0001–0004 existentes no se editan. La migración de auth 0004
está en el código pero su presencia en Neon es desconocida; validar status
antes de planear el siguiente número/aplicación.

## 11. Orden de implementación recomendado

1. Cerrar solo las decisiones pendientes de la sección 13.
2. Congelar OpenAPI/JSON Schema de DTOs, enums y golden test vectors de
   canonical JSON/hash.
3. Resolver migraciones de dominio remotas y local outbox/version con tests de
   migración/datos preexistentes, sin aplicación automática a producción.
4. Implementar repositorio PostgreSQL owner-scoped, receipt idempotente,
   optimistic concurrency y cursor transaccional.
5. Añadir endpoints register/revoke device, preview/confirm import, push y
   pull, con autorización, cuotas y resultados por item.
6. Implementar worker local con lock, coalescencia no enviada, batching,
   retries, ACK local y crash recovery.
7. Implementar pull atómico/tombstones/conflictos y resolución explícita.
8. Mantener adjuntos excluidos y sus datos locales intactos; planear su
   transferencia solo como fase posterior.
9. Probar DB desechable y fixtures sintéticos; luego alpha con opt-in y backup
   comprobado. No habilitar globalmente hasta rollback/observabilidad validada.

## 12. Pruebas de aceptación

### Identidad e importación

- Login sin consentimiento no cambia ninguna fila SQLite, cuenta local,
  payload o cola.
- En el dispositivo solo una cuenta autenticada puede estar activa; cambiar de
  cuenta no asocia, mezcla ni borra el perfil provisional.
- Preview envía solo manifest allowlisted; rechazo deja DB/outbox byte-a-byte
  igual.
- Confirmar crea solo registros elegidos; caída/reintento conserva import_id,
  UUID y receipts.
- UUID perteneciente a otra cuenta produce colisión opaca; no revela owner ni
  contenido. Remapear a UUID local nuevo actualiza PKs, referencias y payloads
  pendientes en una transacción, reescribe dependencias de operaciones y no
  altera operaciones ya enviadas; rollback ante fallo no pierde datos.
- Dos dispositivos autenticados ven/descargan el mismo owner feed con
  cursores propios; device revocado no puede push/pull.

### Contratos, integridad y propiedad

- DTO válido para cada entidad y cada campo; rechazo de campo desconocido,
  owner spoof, UUID malformado, status/categoría inválidos, pet/target cruzado,
  timestamps no válidos y números NaN/Infinity.
- Dos usuarios no pueden acceder, crear hijo sobre entidad del otro, resolver
  conflicto ajeno ni leer el feed del otro manipulando UUID/device/cursor.
- Relaciones de reminder a evento/tarea/cita/registro médico validan
  exactamente un target y mismo owner; el target evento tiene FK independiente
  `(owner_id,event_id)` y relación para validar mascota. Un evento general y su
  reminder aceptan ambos `pet_id=NULL`; cualquier mismatch al cambiar el
  reminder o el target falla al commit.
- `calendar_reminders` permite varios recordatorios al mismo destino y hora;
  no existe unique por target/hora.
- Allowlist de API v1 rechaza `health_attachment` y `reminder` legacy en
  preview/push/pull; `reminder` permanece en schema/feed por compatibilidad y
  la tabla `health_attachments` no cambia.
- Round-trip conserva examen, detalles JSON, categorías, zona horaria, ejecuciones,
  recordatorios múltiples y campos nulos sin truncación.

### Idempotencia, lote, versión

- Repetir operation ID/hash devuelve el mismo resultado, no crea segunda fila,
  cursor ni efecto; reutilizar ID con hash diferente da error.
- Toda mutación local de dominio incrementa exactamente una vez
  `local_revision`; ACK actualiza `acknowledged_local_revision` sin pisar una
  edición local posterior.
- Commit DB seguido de socket cerrado antes de respuesta; retry confirma
  receipt y cliente solo aplica ACK una vez.
- Lote con éxito, rechazo, conflicto, transient y dependiente bloqueado produce
  resultados independientes precisos.
- Create versión 0 da server version 1; update/delete con base igual
  incrementa; base antigua produce conflicto sin overwriting.
- Ejecución programada usa `scheduled`; al reprogramar se preserva la anterior
  como `cancelled` con el `scheduled_for` original y `executed_at=NULL`, y se
  crea UUID/slot distinto en estado `scheduled`. Una ejecución completada
  conserva `executed_at`; no se reutiliza el slot cancelado.
- Ediciones offline coalescidas preservan ID/base/changed fields y snapshot
  final; ediciones durante in-flight rebasing solo antes de primer dispatch.
- Dos escrituras concurrentes del mismo `base_version`: exactamente una
  aplicada y otra conflictiva.

### Cursor, fallos y tombstones

- Dos writers del mismo user, commit/rollback y paginación no saltan cursor ni
  cambian orden de commit; usuarios no comparten secuencia visible.
- Cierre en cada paso (marcar in-flight, push, commit remoto, respuesta, ACK
  SQLite, pull apply) recupera sin pérdida ni doble aplicación.
- Pull aplica datos + cursor en una transacción; fallo de FK revierte cursor.
- Pull de versión remota nueva para entidad con edición pendiente guarda
  conflicto y cursor atómicamente, preserva payload/fila local, bloquea push y
  no sobrescribe silenciosamente; fallo al persistir conflicto revierte cursor.
- Pull de entidad limpia actualiza snapshot y `server_version` sin incrementar
  `local_revision`.
- Tombstone llega a dispositivo que estuvo offline, bloquea creación hija y no
  permite que un snapshot antiguo resucite row.
- Delete de mascota muestra el resumen, exige confirmación, tombstonea
  explícitamente entidades relacionadas, mantiene dependencias y adjuntos
  locales, y no realiza borrado físico.
- No existe job o ruta que purgue automáticamente tombstones o receipts.
- Test de `Retry-After`, backoff+jitter, red intermitente, respuesta 429/5xx,
  límite del cuerpo, lote parcial y sincronización concurrente entre tabs.

### Privacidad y adjuntos

- Los logs y errores no contienen email/password/token, notas médicas,
  snapshots, file path ni SQL.
- Import preview/push/pull no enumeran ni aceptan adjuntos; metadatos y bytes
  locales permanecen íntegros al sincronizar y al remapear UUIDs. La tabla
  PostgreSQL `health_attachments` no se modifica.
- `sync_imports` y `sync_conflicts` remotos contienen metadatos solamente, sin
  snapshots, payloads o información médica.
- Tablas de notificación del OS no generan cambios remotos ni duplican
  calendar reminders.

## 13. Puntos que continúan pendientes

Las decisiones solicitadas para esta revisión quedan incorporadas en el
diseño. Antes de implementar quedan por investigar o validar:

1. **Deprecación futura de reminders legacy:** `reminders` y
   `calendar_reminders` permanecen separados en v1; `reminder` sigue en
   schema/feed y está fuera de la allowlist API v1. Cualquier migración o
   deprecación posterior requiere inventario de datos, consumidores,
   constraints y dependencias, más aprobación. No modificar el modelo legacy
   en v1.
2. **Retención futura:** no hay purga automática en la primera versión. Definir
   después plazos legales/producto, expiración de devices/cursors y full resync
   con pruebas antes de habilitar cualquier compactación.
3. **Adjuntos:** diseñar en una fase posterior almacenamiento remoto,
   transferencia, cuotas, validación y recuperación. En la primera versión se
   excluyen de preview/push/pull, se mantienen locales (incluidos metadatos) y
   no se modifica la tabla remota `health_attachments`.
4. **KIRAI:** conversaciones y mensajes quedan fuera de sync inicial; su
   eventual sincronización requiere decisión separada de consentimiento,
   retención y modelo de propiedad.
5. **Límites configurables:** 50 operaciones, 512 KiB por batch, 64 KiB por
   operación, 500 cambios por página, 2,000 IDs por página de preview y 10
   requests/minuto por device son valores iniciales. Confirmarlos mediante
   pruebas, medición y configuración de despliegue.
6. **Full resync y dispositivos inactivos:** definir el contrato cuando un
   cursor ya no pueda servirse y las reglas de revocación/caducidad, sin borrar
   datos ni receipts automáticamente mientras no exista esa política.

Este documento incorpora decisiones de diseño; no autoriza todavía cambios de
código, ejecución de migraciones ni conexión a Neon.
