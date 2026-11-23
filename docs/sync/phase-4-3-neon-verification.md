# PetCare — Fase 4.3: verificación de Neon (solo lectura)

**Fecha y hora:** 10 de noviembre de 2026, 13:54 (-05:00)  
**Base verificada:** Neon, base `petcare_db`.  
**Resultado general:** **BLOQUEADO** para avanzar a la siguiente fase de
migraciones hasta reconciliar el estado de autenticación 0004.  
**Alcance:** inspección de metadatos y catálogos; no se consultaron filas de
usuarios ni de dominio, no se ejecutaron migraciones, y no se escribieron
datos.

## 1. Conexión y configuración

El repositorio configura el API con `DATABASE_URL`, validada por
`api/src/config/env.ts`. El migrador carga `dotenv/config`; la documentación y
`api/.env.example` indican que la configuración local esperada está en
`api/.env`. Ese archivo no estaba presente. Se encontró un `.env` ignorado en
la raíz del repositorio; su URL se cargó expresamente para esta inspección,
sin mostrar ni registrar credenciales. La conexión confirmó en PostgreSQL que
el destino era `petcare_db`.

**Observación de configuración:** al ejecutarse los scripts desde `api/`,
`dotenv/config` busca por defecto `api/.env`; el `.env` raíz no se carga
automáticamente. Por ello, la inspección confirmó el destino de la conexión
utilizada aquí, pero no demuestra que el comando habitual de migraciones
encuentre esa misma configuración. No se modificó ningún archivo de entorno.

La sesión PostgreSQL se abrió con `default_transaction_read_only=on`, se
iniciaron transacciones `BEGIN READ ONLY` y se cerraron con `ROLLBACK`. Cada
conexión volvió a comprobar `current_database()` y
`transaction_read_only`. No se usó `db:migrate:status`: el runner actual
adquiere un advisory lock antes de ejecutar ese comando.

## 2. Historial y checksums de migraciones

Los checksums locales se calcularon con el mismo mecanismo del migrador:
SHA-256 de `migration.up.toString()`.

| Versión | Nombre | Estado en Neon | Checksum local | Checksum Neon | Resultado |
|---|---|---|---|---|---|
| 0001 | `core` | Aplicada — 2026-11-08 23:46:04 UTC | `2036effb8873308f5f385e1b468afbae56aa99bca4710013ffcc4dd0d375f5a3` | `2036effb8873308f5f385e1b468afbae56aa99bca4710013ffcc4dd0d375f5a3` | Coincide |
| 0002 | `sync_support` | Aplicada — 2026-11-08 23:46:05 UTC | `f90c77ab1ba68da5a4fb99a7cfb66f9a28500b852dbda5600f4ba9e360b5e89c` | `f90c77ab1ba68da5a4fb99a7cfb66f9a28500b852dbda5600f4ba9e360b5e89c` | Coincide |
| 0003 | `ordered_sync_cursors` | Aplicada — 2026-11-08 23:46:05 UTC | `d7379f8365e5c36c772ff9ab5f159412d5f72dbbaf7e21a94caa4bbafaa62ddb` | `d7379f8365e5c36c772ff9ab5f159412d5f72dbbaf7e21a94caa4bbafaa62ddb` | Coincide |
| 0004 | `auth_refresh_token_history` | **No aparece en `schema_migrations`** | `dfd4f5469c8d14561e6f88eb11a002b5941c3e3c9b47abbbb9c5aeb2b1ba23ec` | No disponible | Pendiente/no aplicada |

No se encontraron versiones desconocidas en el historial consultado. El nombre
y checksum almacenados para 0001–0003 coinciden exactamente con los archivos
locales. No hay nombre ni checksum remoto para 0004 con los que compararlos.

## 3. Esquema desplegado

Se inspeccionaron columnas y tipos de todas las tablas solicitadas, además de
constraints y los índices asociados. La presencia de columnas `version` y
`deleted_at` confirma esos campos en las entidades de dominio inspeccionadas;
no demuestra por sí sola el comportamiento de una aplicación ni la integridad
de datos existentes.

### 3.1 Tablas y brechas destacadas

| Tabla o grupo | Estado observado |
|---|---|
| `users` | Existe con UUID, email, password hash, nombre, timestamps y `deleted_at`. Check de email en minúsculas/no vacío, nombre/hash no vacíos; índice único de email. |
| `auth_sessions` | Existe con `user_id`, hash de refresh actual, expiración, revocación y `created_at`; **no tiene `updated_at`**. FK restrictiva a `users`. |
| `auth_refresh_tokens` | **No existe**. La 0004 que la crea no figura aplicada. |
| `pets` | Existe con `owner_id`, campos de mascota, `version`, timestamps y `deleted_at`; FK a usuario, claves únicas owner/ID, checks de campos y versión positiva. |
| `health_records` | Existe con mascota, tipo, título, descripción, fecha, profesional, `version` y tombstone. Faltan `record_subtype`, `clinic_name`, `observations`, `details_json` y `next_event_at` del plan 4.1/4.2. FK compuesta owner/mascota y restricciones de tipo/versión. |
| `health_attachments` | Existe con metadata, `storage_key`, versión y tombstone; FK compuesta a registro/mascota/owner. Su existencia no la incorpora a sync v1; no se modificó. |
| `care_tasks` | Existe con `task_type`, `recurrence_rule`, `notes`, zona horaria, inicio, enabled, `version` y tombstone. Faltan las columnas nuevas `category`, `description`, `observations`, `schedule_json`, `next_run_at` y `ends_at`. Se mantienen los campos legacy. |
| `care_task_executions` | **No existe**. |
| `appointments` | Existe con owner/mascota, horario, estado, versión y tombstone; FK compuesta y checks de estado/horario/versión. |
| `calendar_events`, `calendar_reminders` | **No existen**. |
| `reminders` | Existe como tabla legacy separada: target opcional de tarea o cita, `due_at`, zona horaria, estado, versión y tombstone. Sus FKs atan owner, target y mascota; su CHECK permite como máximo un target, pero también permite que ambos sean `NULL`. No equivale al modelo `calendar_reminders`. |
| `sync_devices` | Existe con `id`, `user_id`, nombre, cursor descargado, `last_seen_at`, revocación y timestamps. Tiene unique `(user_id,id)` y cursor no negativo. No contiene plataforma ni versiones de app/esquema. |
| `sync_operations` | Existe con clave `(user_id,operation_id)`, hash, respuesta JSON y `processed_at`; FK a usuario y restricciones de hash/respuesta. |
| `sync_changes` | Existe con clave primaria `(owner_id,cursor)`, versión positiva, cambio, campos JSON y FK al propietario/receipt. Su CHECK actual admite `pet`, `health_record`, `health_attachment`, `care_task`, `appointment`, `reminder`, `ai_conversation` y `ai_message`; **no** admite `care_execution`, `calendar_event` ni `calendar_reminder`. |
| `sync_cursors` | Existe con `owner_id`, `last_cursor` y `updated_at`; clave por owner y cursor no negativo. |
| `sync_imports`, `sync_conflicts` | **No existen**. |

### 3.2 Ownership, restricciones e índices

Se confirmaron claves foráneas owner-scoped para relaciones de dominio:
registros médicos, adjuntos, tareas, citas y reminders enlazan con sus
propietarios y mascotas/destinos mediante claves compuestas y `ON DELETE
RESTRICT`. `sync_changes` referencia al owner y, si está presente, al receipt
correspondiente. Los catálogos confirman checks de versión positiva en las
entidades principales y de tombstones mediante columnas `deleted_at`.

Índices relevantes observados:

- Mascotas: unique `(owner_id,id)` y `(owner_id,updated_at DESC)`.
- Salud: uniques owner/ID y owner/ID/mascota; índice por owner/mascota/fecha.
- Adjuntos: unique owner/ID e índice por owner/registro.
- Cuidados y citas: claves owner-scoped; índices parciales por mascota/tarea
  activa y por inicio de cita.
- `reminders`: unique owner/ID e índice parcial de pendientes por mascota y
  vencimiento.
- Sincronización: devices con unique `(user_id,id)` e índice parcial de
  activos; receipts con PK `(user_id,operation_id)` e índice por fecha; feed
  con PK `(owner_id,cursor)` e índice por entidad; cursor con PK `owner_id`.

No se consultaron filas de usuarios, mascotas, recordatorios u otros datos de
dominio. Por tanto, esta auditoría no determina cantidades, duplicados ni
integridad efectiva del contenido almacenado.

## 4. Comparación con el repositorio y las fases 4.1/4.2

- El esquema y catálogo observados concuerdan con las migraciones locales
  0001–0003, cuyos nombres y checksums están aplicados sin discrepancias.
- La migración 0004 está en el repositorio pero no en el historial de Neon.
  Su ausencia también coincide con la falta de `auth_refresh_tokens` y de
  `auth_sessions.updated_at`.
- Las ausencias de columnas extendidas de salud/cuidados, ejecuciones,
  calendario, `sync_imports` y `sync_conflicts` corresponden a cambios futuros
  propuestos, no a migraciones existentes.
- `reminders` permanece legacy e independiente; la base conserva el tipo
  `reminder` en el CHECK del feed, como requieren las decisiones 4.1/4.2. La
  allowlist de API v1 debe seguir excluyéndolo.
- El CHECK actual del feed incluye además adjuntos y entidades KIRAI. Su
  presencia en el esquema/feed no debe habilitarlas en la allowlist v1.
- `sync_devices` aún no tiene los metadatos de plataforma/versiones cliente
  propuestos. `sync_imports` y `sync_conflicts` no se han creado.

## 5. Riesgos y recomendaciones

### Riesgos

1. **Bloqueo de autenticación:** el código local contempla el historial de
   refresh tokens de 0004, pero Neon no tiene la migración ni la tabla. El
   acceso del servicio de autenticación que dependa de esos objetos puede
   fallar contra esta base.
2. **Numeración de migraciones:** no se debe asumir que la próxima migración
   es 0005 hasta resolver la 0004 pendiente y confirmar el estado del entorno.
3. **Protocolo de sincronización aún no soportado:** faltan tablas/columnas
   planificadas y tipos de entidad para el feed; implementar endpoints antes
   de esas migraciones dejaría contratos incompatibles.
4. **Recordatorios legacy:** `reminders` permite cero targets y no implementa
   el contrato exactamente-un-target de `calendar_reminders`. No copiar,
   transformar ni eliminar filas como parte de una migración automática.
5. **Configuración local:** existe un `.env` en raíz, pero el runner y el
   README de API esperan `api/.env`; una ejecución habitual puede no cargar la
   URL que se utilizó en esta inspección.
6. **Límites de la auditoría:** no se leyeron datos de aplicación ni se
   verificó drift mediante comparación exhaustiva de cada objeto fuera del
   alcance de tablas/columnas/constraints/índices inspeccionados.

### Preparación recomendada

1. Reconciliar con autorización el estado pendiente de 0004, incluyendo
   compatibilidad del código de autenticación y una estrategia de despliegue
   respaldada por pruebas en una base desechable/staging. Esta auditoría no
   aplicó 0004 ni recomienda aplicarla sin ese proceso.
2. Aclarar y corregir en una tarea autorizada la ruta de configuración usada
   por los comandos API; no copiar ni mostrar credenciales en documentación o
   cliente móvil.
3. Después de reconciliar el historial, revisar el estado otra vez y confirmar
   que checksums/nombres coincidan antes de asignar números futuros.
4. Mantener el orden tentativo de 4.2 solo como guía: ampliación de dominio;
   ejecuciones; eventos; recordatorios de calendario y sus constraints
   diferibles; allowlist/feed y metadatos de device; después `sync_imports` y
   `sync_conflicts`. Conservar `reminders`, `task_type` y `recurrence_rule`;
   evitar backfills ambiguos, purgas automáticas y cambios a `health_attachments`.
5. Validar migraciones en PostgreSQL desechable desde cada versión soportada,
   probando constraints owner-target, eventos generales, ejecuciones
   reprogramadas, recordatorios múltiples e integridad de cursores. No usar
   verificadores que escriban fixtures contra Neon.

## 6. Consultas realizadas

Todas las consultas siguientes se ejecutaron dentro de una transacción
`READ ONLY`, en conexiones configuradas con `default_transaction_read_only=on`.
Los parámetros de listas fueron los nombres de tablas enumerados en §3.1,
incluidas las seis tablas planeadas que se comprobaron por existencia.
No se usaron `INSERT`, `UPDATE`, `DELETE`, DDL ni funciones que escriban datos.
La lista completa utilizada en las consultas de columnas/constraints/índices
fue: `users`, `auth_sessions`, `pets`, `health_records`,
`health_attachments`, `care_tasks`, `appointments`, `reminders`,
`sync_devices`, `sync_operations`, `sync_changes`, `sync_cursors`,
`auth_refresh_tokens`, `care_task_executions`, `calendar_events`,
`calendar_reminders`, `sync_imports` y `sync_conflicts`.

1. Verificación del destino, modo read-only y existencia del historial
   (ejecutada con los alias indicados y, en conexiones posteriores, con los
   alias breves `db` y `ro`):

   ```sql
   SELECT current_database() AS database,
          current_setting('transaction_read_only') AS read_only,
          to_regclass('public.schema_migrations') IS NOT NULL
            AS migration_table_exists;
   ```

   También se comprobó el destino y el modo sin la columna del historial:

   ```sql
   SELECT current_database() AS db,
          current_setting('transaction_read_only') AS ro;
   ```

2. Historial de migraciones. Se ejecutó la consulta base y una variante que
   normaliza `applied_at` a UTC:

   ```sql
   SELECT version, name, checksum, applied_at
   FROM public.schema_migrations
   ORDER BY version;
   ```

   ```sql
   SELECT version, name, checksum,
          to_char(applied_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
            AS applied_utc
   FROM public.schema_migrations
   ORDER BY version;
   ```

3. Columnas y tipos. Se consultó primero el conjunto completo de columnas y
   luego una variante acotada para resumir tipos:

   ```sql
   SELECT table_name, ordinal_position, column_name, data_type, udt_name,
          is_nullable, column_default
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = ANY($1::text[])
   ORDER BY table_name, ordinal_position;
   ```

   ```sql
   SELECT table_name, column_name, udt_name, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = ANY($1::text[])
   ORDER BY table_name, ordinal_position;
   ```

4. Constraints. Se consultó el conjunto completo y luego dos variantes
   filtradas para reportar claves/constraints relevantes:

   ```sql
   SELECT t.relname AS table_name, c.conname AS constraint_name,
          c.contype AS type, pg_get_constraintdef(c.oid, true) AS definition
   FROM pg_constraint c
   JOIN pg_class t ON t.oid = c.conrelid
   JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = ANY($1::text[])
   ORDER BY t.relname, c.conname;
   ```

   ```sql
   SELECT t.relname AS tbl, c.conname AS name, c.contype AS typ,
          pg_get_constraintdef(c.oid, true) AS def
   FROM pg_constraint c
   JOIN pg_class t ON t.oid=c.conrelid
   JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='public'
     AND t.relname=ANY($1::text[])
     AND (c.contype IN ('f','u','p')
          OR (t.relname='sync_changes' AND c.contype='c'))
   ORDER BY t.relname,c.conname;
   ```

   También se consultaron las FK y los CHECK de las tablas con dominio y
   `sync_changes`:

   ```sql
   SELECT t.relname AS tbl, c.conname AS name, c.contype AS typ,
          pg_get_constraintdef(c.oid,true) AS def
   FROM pg_constraint c
   JOIN pg_class t ON t.oid=c.conrelid
   JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='public'
     AND t.relname=ANY($1::text[])
     AND (c.contype='f'
          OR (c.contype='c'
              AND (t.relname='sync_changes'
                   OR t.relname IN ('pets','health_records','care_tasks',
                                    'appointments','reminders','users',
                                    'auth_sessions'))))
   ORDER BY t.relname,c.conname;
   ```

   ```sql
   SELECT t.relname AS tbl, c.conname AS name, c.contype AS typ,
          pg_get_constraintdef(c.oid,true) AS def
   FROM pg_constraint c
   JOIN pg_class t ON t.oid=c.conrelid
   JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='public'
     AND t.relname=ANY($1::text[])
     AND (c.contype='f'
          OR (c.contype='c'
              AND (t.relname='sync_changes'
                   OR t.relname IN ('pets','health_records','care_tasks',
                                    'appointments','reminders','users',
                                    'auth_sessions'))))
   ORDER BY t.relname,c.conname;
   ```

5. Índices desplegados:

   ```sql
   SELECT tablename, indexname, indexdef
   FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = ANY($1::text[])
   ORDER BY tablename, indexname;
   ```

6. Presencia de las tablas nuevas/esperadas mediante `to_regclass`:

   ```sql
   SELECT x.name,
          to_regclass('public.' || quote_ident(x.name)) IS NOT NULL AS exists
   FROM unnest($1::text[]) AS x(name);
   ```

7. Columnas de `auth_sessions` para comprobar explícitamente la 0004:

   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'auth_sessions'
   ORDER BY ordinal_position;
   ```

Además, se calcularon localmente los checksums SHA-256 de las cuatro
migraciones registradas usando la función del migrador. No se ejecutó el
comando de estado del runner, migraciones, verificadores de fixtures ni
consultas de datos de aplicación. Cada transacción de inspección terminó con
`ROLLBACK`.

## 7. Conclusión

**BLOQUEADO.** La base verificada contiene 0001–0003 con checksums correctos,
pero 0004 está pendiente y faltan sus objetos de autenticación. Las brechas
restantes de sincronización coinciden con la planificación futura 4.1/4.2;
no se implementó ni modificó ninguna de ellas. Se requiere resolver primero
la discrepancia de 0004 y la configuración de entorno antes de preparar una
siguiente migración.
