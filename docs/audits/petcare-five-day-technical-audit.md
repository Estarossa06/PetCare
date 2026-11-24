# PetCare — auditoría técnica y viabilidad para cinco días

**Fecha:** 23 de noviembre de 2026  
**Alcance:** inspección del repositorio actual, pruebas locales, revisión de los cambios de identificación visual y análisis de viabilidad de sincronización. Solo se añadió este informe: no se modificó código ni esquema, no se ejecutaron migraciones y no se hicieron commits ni push.

## Resumen ejecutivo

PetCare tiene una aplicación multiplataforma utilizable en modo local: mascotas, historial médico, cuidado y calendario escriben en SQLite. Registro/login y KIRAI ya tienen flujos reales entre móvil y API; la API también tiene CRUD remoto autenticado de mascotas. Sin embargo, **el CRUD remoto de mascotas no está conectado al repositorio SQLite** y las demás entidades no tienen API de dominio. La cola local y las tablas remotas son preparación para sync, no sincronización: no hay cliente/worker, endpoints push/pull, ACK, importación ni resolución operativa de conflictos.

El mayor riesgo inmediato es la base Neon. El `.env` local apunta a una base `petcare_db`, que no está identificada como desechable. La última inspección directa documentada (10 nov.) encontró `0001–0003` aplicadas y `0004 auth_refresh_token_history` ausente. El código actual de autenticación ya exige objetos creados por `0004`. No consulté esa base durante esta auditoría y no ejecuté DDL, para no tocar un destino de producción o estado incierto.

**Viabilidad:** completar en cinco días una sincronización bidireccional de todas las entidades —salud, adjuntos, cuidados, ejecuciones, calendario y recordatorios— con importación, idempotencia, tombstones, multi-dispositivo y resolución de conflictos no es realista con el estado actual. Un piloto acotado a mascotas podría intentarse en cinco días, con riesgo alto y solo después de confirmar una base PostgreSQL de prueba, resolver `0004`, cerrar el contrato de asociación de cuenta y limitar explícitamente el alcance. No se recomienda presentar el sync completo como terminado en ese plazo.

## Estado por módulo

| Módulo | Estado comprobado | Completo / pendiente |
|---|---|---|
| App Expo, navegación y dashboard | Cinco tabs enrutan a dashboard, mascotas, calendario, KIRAI y perfil. Expo Router y TypeScript están conectados. | Flujos locales presentes. No se validó visualmente en dispositivos en esta auditoría. Existe `SectionPreviewScreen` con contenido demo que no está referenciado por las rutas actuales; revisar si debe conservarse o retirarse en una tarea posterior. |
| Autenticación | Registro, login, restauración por refresh, rotación, logout, `/auth/me`, JWT, scrypt y limitación de intentos están implementados. App usa SecureStore nativo y `sessionStorage` Web. | Los tests unitarios pasan, pero dependen de `MemoryAuthStore`. La integración PostgreSQL se omitió. La base remota podría no tener `0004`, necesaria para `auth_refresh_tokens` y `auth_sessions.updated_at`. Web ofrece menor protección de tokens que SecureStore. |
| Mascotas | CRUD local completo, búsquedas/filtros, baja lógica y fotos locales. La API tiene CRUD PostgreSQL, paginación y autorización por propietario. | **No integrado:** el cliente no llama a `/pets`; `petService` usa solo `petRepository` SQLite. El CRUD API y el CRUD de app son dos almacenes separados. |
| Identificación visual | Consentimiento explícito en pantalla, petición autenticada, validación y decodificación real de imagen en API, Ollama loopback y sugerencias aceptables/descartables individualmente. | Validada con `qwen2.5vl:7b` y fotos reales; detalles en «Pruebas». No determina una tasa general de precisión. |
| Historial médico y adjuntos | CRUD local, categorías/detalles estructurados, búsqueda, próxima fecha y archivos guardados en el dispositivo/IndexedDB. | Sin API de dominio ni transferencia de adjuntos. Algunos campos locales no existen en PostgreSQL. SQLite no está cifrado; hace falta política de backup/retención para datos médicos. |
| Rutinas y ejecuciones de cuidado | CRUD local, frecuencias/zonas horarias, avance de próxima ocurrencia e historial de completadas/omitidas/canceladas. Verificación de DST y recurrencia aprobada. | Sin API remota. `care_task_executions` no existe en las migraciones PostgreSQL. Campos/categorías y semántica de recurrencia no están alineados con `care_tasks` remoto. |
| Calendario y notificaciones | Vista agregada local de citas, rutinas, fechas médicas, eventos y recordatorios. Notificaciones locales tienen reconciliación, cancelación, permisos y navegación por toque. | Web marca notificaciones locales como no soportadas. Sin API ni persistencia remota del calendario. No se probó entrega real en Android/iOS; Android puede diferir por alarmas/batería. |
| SQLite y offline | Cinco migraciones locales; repositorios transaccionales; outbox con dependencias, estados/reintentos y tabla de conflictos; metadatos por instalación. La DB migra al abrirse. | La outbox no tiene consumidor. `local_account_id` es un UUID local fijo, no `users.id`. No hay asociación/importación al iniciar sesión. Evidencia previa de SQLite Web está en el informe de persistencia; no se repitió el harness interactivo del navegador ahora. |
| API, PostgreSQL y Neon | API ofrece salud/readiness, auth, CRUD remoto de mascotas, KIRAI e identificación. Cuatro migraciones PostgreSQL en código; constraints owner-scoped en relaciones. | Ninguna ruta `/sync`; no CRUD remoto de médico/cuidado/calendario. Estado Neon actual no verificado; último estado directo: versiones 1–3 aplicadas y 4 ausente. |
| KIRAI | Tab móvil real y rutas autenticadas `/kirai/availability` y `/kirai/chat`; historial reciente en memoria, validación, límites, manejo de errores y prompt de seguridad. Modelo configurado `qwen3:8b`. | Prueba directa real con Ollama pasó. No guarda conversación, no usa mascotas/historial, herramientas ni RAG; no es un agente conectado a datos de PetCare. Las tablas `ai_*` no son usadas por este flujo. |
| Perfil/UX | Login/logout y estado de cuenta conectado. Fallback manual de mascotas y manejo de errores de red/modelo. | La interfaz muestra «pendiente de sincronizar», pero no existe proceso que vaya a completar esa sincronización. Al cambiar de usuario autenticado, el conjunto SQLite no cambia: los usuarios de la misma instalación pueden ver los mismos datos locales. Esto requiere decisión de producto/privacidad antes de habilitar sync. |

## Sincronización: evidencia y brechas

| Requisito | Lo que existe | Estado real |
|---|---|---|
| Autenticación | JWT/session principal y refresh en API; cliente adjunta bearer token. | Implementada, su persistencia Neon depende de `0004` y no está validada actualmente contra PostgreSQL. |
| Asociación cuenta–datos | `sync_metadata.account_id` local, generado y reutilizado por SQLite. API deriva `owner_id` de `Principal`. | No existe mapping/login-import/consentimiento que asocie ese `account_id` con `users.id`. El `owner_id` local del payload no puede aceptarse como autoridad remota. |
| CRUD remoto | API owner-scoped solo para mascotas; SQL filtra por `owner_id` y endpoints pasan el `userId` del principal. | Hay tests de propietario en repositorio simulado y test PostgreSQL preparado, pero móvil no llama a esos endpoints y test PostgreSQL no pudo ejecutarse. |
| Outbox y operaciones pendientes | Los repositorios insertan una operación por mutación local, con UUID, snapshot, acción, campos y dependencias. | Solo almacenamiento. No hay selección de operaciones listas, envío, ACK, backoff ejecutado, desbloqueo, cursor o limpieza por servidor. |
| Idempotencia | PostgreSQL tiene `sync_operations` con PK `(user_id, operation_id)`, hash y response JSON. Test de migración/verificador demuestra que la PK rechaza duplicados. | No hay endpoint ni servicio que inserte/compare receipts. No se garantiza replay que devuelva la misma respuesta ni error por misma key con hash distinto. |
| Versiones/concurrencia | Tablas remotas tienen `version` positiva; outbox guarda `base_version`; tabla local guarda snapshots de conflicto. | Filas SQLite nacen con versión 0 y ediciones no elevan la versión local. `base_version` no implementa control optimista completo. El esquema no prueba que el flujo use esas columnas. |
| Pull/cursor | `sync_changes`, `sync_devices`, `sync_cursors`; diseño de cursor por propietario y verificador concurrente previo. | No existe feed writer enlazado a cambios de dominio ni endpoint pull/cursor local aplicado atómicamente. El verificador acredita la mecánica SQL en la corrida histórica, no un endpoint. |
| Conflictos/tombstones | SQLite tiene `sync_conflicts`, estados y soft delete. El dominio remoto tiene `deleted_at`. | No hay comparación de versión, snapshots remotos, UI de conflicto, resolución, ACK de tombstone ni política de retención/cascada integrada. |
| Esquema y cobertura | PostgreSQL incluye pets, health records/attachments, care tasks, appointments y reminders legacy; SQLite tiene además ejecuciones, calendar events/reminders y más campos. | No equivalen. PostgreSQL carece de `care_task_executions`, `calendar_events`, `calendar_reminders` y campos médicos/cuidado añadidos; el CHECK de `sync_changes` tampoco admite `care_execution`, `calendar_event`, `calendar_reminder`. Mapear `calendar_reminders` a `reminders` perdería semántica. |
| Adjuntos | Metadata/outbox local y almacenamiento local de archivos. PostgreSQL tiene tabla metadata. | Bytes sin servicio de objeto/upload/download; fuera de un piloto seguro de sync inicial. |

### Bloqueos por prioridad

1. **P0 — destino y migración 0004:** reconciliar el historial/checksum en staging o DB de prueba identificada. El estado histórico en Neon indica que el registro del usuario puede fallar con el código actual. No ejecutar `db:migrate` en `petcare_db` durante la auditoría.
2. **P0 — privacidad de cuenta local:** acordar cómo separar usuarios locales, quién puede importar datos y qué ocurre al cerrar sesión/cambiar cuenta. No asociar UUID provisional con un usuario por inferencia.
3. **P0 — scope de sincronización:** seleccionar entidades y campos para un primer release. El sync total tiene diferencias de modelo, no solo falta de transporte.
4. **P1 — protocolo:** contrato/DTO estable, versionado local/remoto, receipt idempotente con hash, transacciones para dominio+feed+cursor, ACK local, pull atómico, reintentos y tratamiento de tombstones.
5. **P1 — calidad y seguridad:** pruebas PostgreSQL en base desechable; usuario A/B y colisiones, replay mismo/distinto hash, fallos de red, cambios simultáneos y restauración de backup. No usar SQLite como si estuviera cifrada.
6. **P2 — contenido y plataforma:** sincronización de adjuntos, ejecución nativa real, soporte de recuperación/retención y despliegue Web seguro.

## Pruebas ejecutadas en esta auditoría

- `npm test --prefix api`: **42 aprobadas, 0 fallidas, 3 omitidas** de 45. Las omitidas son las dos suites PostgreSQL (sin `PETCARE_TEST_DATABASE_URL` ni flag de DB) y la integración Ollama que se habilita por variables.
- Integración visual con `qwen2.5vl:7b`: **1/1 aprobada** atravesando registro, token, endpoint, Sharp y Ollama con fotos reales Commons. En la repetición actual: perro **9,28 s**, gato **4,82 s**; ambos clasificados correctamente. API RSS muestreado máximo **94 MiB** y GPU hasta **7.357 MiB/8 GiB**. Confianza no disponible; raza indeterminada. La latencia varió en ejecuciones anteriores, aproximadamente 2,5–8,7 s según foto/pasada; dos imágenes no permiten inferencia estadística.
- Prueba directa del proveedor KIRAI con `qwen3:8b`: aprobada; respuesta real a una pregunta de bienestar en español. No es una prueba E2E autenticada desde la interfaz.
- Tests mobile (`notifications`, navegación, lifecycle y conversación KIRAI) con `tsx`: **14/14 aprobadas**. Node sin loader falló importando TypeScript y, en sandbox, con `spawn EPERM`; con el loader adecuado pasan. No hay script `test` en `mobile/package.json`.
- `verifyCareRecurrence()` vía `tsx`: aprobado (DST, fecha inexistente, fin de mes y tarea única).
- `npm run typecheck --prefix api`, `npm run typecheck --prefix mobile`, `npm run build --prefix api`: aprobados.
- No se ejecutaron migraciones, verificación remota de Neon, pruebas PostgreSQL ni interacción SQLite Web en navegador en esta auditoría. No hay `psql`, `adb`, emulador/dispositivo Android, iOS/Xcode ni dispositivo iOS disponibles. El verificador SQLite interactivo no es una suite automatizada npm.

## Estimación para completar sincronización

Estimación aproximada para una persona familiarizada con el repositorio, sujeta a validar DB y decisiones de producto:

| Alcance | Esfuerzo estimado | Riesgo |
|---|---:|---|
| Conciliar entorno, migraciones y contrato/identidad | 1–2 días | Alto mientras el destino de Neon y 0004 sigan sin verificación actual. |
| Piloto bidireccional solo mascotas: asociación/import explícitos, push/pull, ACK, cursor, receipt idempotente, conflictos básicos y pruebas DB | 5–8 días después de resolver el entorno | Alto; cinco días es apretado, puede llegar a demo acotada con pruebas en staging, no a release robusto si aparecen colisiones o cambios de cuenta. |
| Extender a historial médico y adjuntos | +3–5 días | Alto por campos divergentes, privacidad y transferencia de archivos. |
| Extender a rutinas, ejecuciones y calendario/recordatorios | +4–7 días | Alto por nuevas entidades, zonas horarias, recurrencia y semántica de recordatorios. |
| Endurecimiento multidispositivo, offline prolongado, resolución UX, migración y plataforma | +3–5 días | Alto; requiere pruebas reales con más de una instalación y fallos/reintentos. |

**Sync completo estimado: 16–27 días-persona**, sin contar trabajo de backend de archivos, revisión legal/seguridad o ciclos externos de aprobación. El número no incluye rehacer la arquitectura: conserva SQLite offline-first y API como único acceso a PostgreSQL.

## Plan recomendado de cinco días

| Día | Objetivo y salida revisable | Condición de avance |
|---|---|---|
| 1 | Confirmar un Neon branch/base `petcare_test` desechable; comparar migraciones/checksums y probar auth con DB; acordar separación de cuentas, consentimiento de importación y alcance «solo mascotas». | Si `0004` o el destino no se pueden reconciliar, detener la activación remota y no improvisar número/DDL en producción. |
| 2 | Cerrar DTO/casos de sync de mascotas: ID, propietario derivado, versión, tombstone, operation ID/hash; definir preview/import y resultados por operación. Añadir/verificar migración solo en entorno desechable si hace falta. | Pruebas de contrato y schema pasan; nada de `owner_id` confiado del cliente. |
| 3 | Implementar API push idempotente y pull por cursor para mascotas en transacción; pruebas reales PostgreSQL de propietario, replays y cursor. | Mismo operation ID/hash retorna resultado estable; hash distinto se rechaza; usuario ajeno no filtra ni modifica filas. |
| 4 | Conectar outbox SQLite: importación explícita, push topológico, ACK/versiones, pull atómico, reintentos y conflicto simple visible. Probar offline/online y cambio de usuario. | No perder ni sobrescribir datos; cursores y ACK sobreviven reinicio. |
| 5 | Pruebas de regresión, build/export Web, verificación SQLite y despliegue staging; documentar lo que queda local y límites de lanzamiento. | Demo repetible, métricas y checklist de rollback; no declarar sync total. |

Este plan de cinco días **no sincroniza historial médico, adjuntos, rutinas, ejecuciones ni calendario**. Se conservan localmente hasta fases posteriores. Si la meta obligatoria es toda la aplicación bidireccional, debe ampliarse el plazo.

## Decisión pendiente

La recomendación es que el equipo revise este diagnóstico y confirme objetivo de los cinco días: **piloto seguro de mascotas** o **sincronización completa con plazo ampliado**. No se inició implementación de sync en esta auditoría; espero la revisión antes del siguiente cambio.
