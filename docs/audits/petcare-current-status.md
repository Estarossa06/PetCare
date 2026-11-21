# Auditoría técnica del estado actual de PetCare

**Fecha:** 16 de noviembre de 2026  
**Base:** código, documentación y pruebas versionadas en `main`.  
**Límites:** no se consultaron ni modificaron bases de datos; no se ejecutaron migraciones, instalaciones, builds con salida a disco, ni verificaciones en dispositivos. La última evidencia remota disponible es documental, no una comprobación de esta auditoría.

## A. Resumen ejecutivo

PetCare ya tiene una aplicación Expo/React Native con persistencia SQLite y flujos locales para mascotas, historial médico, rutinas y calendario. El cliente registra operaciones pendientes en una cola local; esto permite trabajar localmente, pero **no constituye sincronización funcional**. La API Express ofrece infraestructura, autenticación y health checks, pero no CRUD remoto de dominio ni endpoints de sincronización. La autenticación móvil tampoco asocia la cuenta central con el identificador local de los datos.

KIRAI tiene identidad, reglas, un proveedor Ollama y pruebas automatizadas del adaptador, pero no un orquestador, endpoint conversacional, interfaz de chat real ni memoria/RAG/herramientas. No hay integración funcional de extremo a extremo entre aplicación, API, PostgreSQL y KIRAI.

En esta auditoría pasaron las 22 pruebas de API y los chequeos TypeScript de API y móvil. Son pruebas automatizadas locales: no prueban PostgreSQL real ni validan Android/iOS. La documentación registra una verificación anterior de SQLite Web, pero señala validaciones nativas y Web de producción pendientes.

## B. Estado por componente

| Componente | Estado | Observaciones |
|---|---|---|
| Aplicación móvil y Web | Parcialmente implementado | Un proyecto Expo SDK 58, TypeScript y Expo Router comparte rutas para Android, iOS y Web. La pantalla inicial actual es Dashboard; existe además una ruta separada de verificación SQLite. No se validó en dispositivos en esta auditoría. |
| Gestión de mascotas | Parcialmente implementado | CRUD local, filtros, eliminación lógica y fotos con almacenamiento por plataforma. Los datos no se consultan ni guardan mediante endpoints remotos. |
| Historial médico | Parcialmente implementado | Registros, categorías, campos estructurados y adjuntos locales. Los binarios quedan en el dispositivo/IndexedDB; no existe servicio remoto de archivos ni sincronización. |
| Rutinas de cuidado | Parcialmente implementado | Horarios recurrentes, zonas horarias, ejecuciones e historial local. Las ejecuciones no tienen soporte equivalente en el esquema/API remotos. |
| Calendario y recordatorios | Parcialmente implementado | Agrega localmente citas, cuidados, fechas médicas, eventos y recordatorios. Las notificaciones del sistema son solo nativas; Web informa que no están soportadas. La entrega real en Android/iOS no se validó; la auditoría previa documenta que el filtro no incluye el estado `scheduled`. |
| SQLite y modo offline | Parcialmente implementado | Migraciones locales, repositorios y escrituras disponibles sin red. La cola, dependencias, cursores y conflictos existen como estructura local; no hay worker que sincronice. SQLite no está cifrado. |
| Backend y API | Parcialmente implementado | Node.js, Express y TypeScript con `/health`, `/ready` y rutas `/auth/*`; no hay endpoints CRUD para mascotas, salud, cuidados o calendario. |
| Autenticación y seguridad | Parcialmente implementado | Registro, login, refresh/logout, JWT, scrypt, rate limit y middleware existen. Las pruebas usan un `MemoryAuthStore`; no se comprobó la persistencia PostgreSQL. El limitador es por proceso y el Web guarda tokens en `sessionStorage`, accesible a JavaScript. |
| PostgreSQL y Neon | Parcialmente implementado | Hay cuatro migraciones locales. El último informe de inspección de Neon (10 nov.) documenta 0001–0003 aplicadas con checksum coincidente y 0004 ausente; el plan posterior la considera de estado desconocido. El estado actual no se comprobó. |
| Sincronización | Parcialmente implementado | El cliente genera outbox y dependencias; PostgreSQL contiene tablas de soporte y cursores. No existen rutas/servicios push-pull, acuses, cursor operativo de cliente, idempotencia en API ni resolución de conflictos funcional. |
| KIRAI | Parcialmente implementado | Fundamentos y adaptador Ollama presentes. Las fases conversacionales, memoria, RAG, herramientas e integración con datos de PetCare no están implementadas. La pestaña Asistente sigue siendo una vista de demostración. |
| Pruebas y documentación | Parcialmente implementado | API cuenta con 22 pruebas automatizadas; ambos proyectos pasan TypeScript. No hay suite `npm test` ni cobertura configurada para móvil. Hay diferencias entre documentación y rutas/esquemas actuales. La auditoría npm existente reporta cinco vulnerabilidades moderadas en el árbol móvil, pero no se repitió el análisis. |

## C. Principales problemas y pendientes

1. **Desajuste crítico entre autenticación y migración:** `PostgresAuthStore` usa `auth_refresh_tokens` y `auth_sessions.updated_at`, creados por la migración 0004. La evidencia disponible de Neon documenta que 0004 no estaba aplicada; por tanto, registro/rotación pueden fallar en ese entorno. No se verificó si el estado cambió después del 10 de noviembre.
2. **No existe sincronización de extremo a extremo:** las escrituras locales quedan en SQLite/outbox, pero no hay proceso ni endpoint para enviarlas o descargar cambios. Conflictos, versiones, tombstones e idempotencia son diseños/esquemas, no comportamientos integrados.
3. **Cuenta y datos locales separados:** SQLite crea un `account_id` provisional, independiente del `user.id` autenticado. No hay asociación/importación/consentimiento que vincule los datos a una cuenta central.
4. **Esquemas divergentes:** SQLite incluye campos médicos añadidos, ejecuciones de cuidados y tablas de calendario que no están en las migraciones PostgreSQL actuales. Los tipos remotos de `sync_changes` tampoco incluyen `care_execution`, `calendar_event` o `calendar_reminder`. Las versiones locales comienzan en 0 y el esquema central exige versiones positivas.
5. **KIRAI no ofrece una función utilizable en la app:** no hay endpoint ni orquestador; la pestaña es un preview. Las instrucciones de seguridad del prompt no sustituyen evaluación del modelo. Las pruebas automáticas de Ollama usan `fetch` simulado; la prueba manual real solo consta en documentación previa y no se repitió aquí.
6. **Validación de plataforma incompleta:** documentación anterior registra SQLite Web local aprobado, pero no prueba Android/iOS físicos ni hosting Web de producción con origen seguro y COOP/COEP. Notificaciones requieren validación física. Los adjuntos Web usan IndexedDB; SecureStore es nativo y el Web usa `sessionStorage`; no hay equivalencia de protección.
7. **Documentación desalineada:** `README.md` y `docs/multiplatform-architecture.md` describen la ruta de verificación como entrada actual, aunque hoy la ruta de tabs muestra Dashboard. `docs/data-model.md` incluye tablas PostgreSQL de calendario que el código de migraciones no crea. `docs/database-setup.md` aún enumera tres migraciones, mientras el registro de código ya incluye 0004.
8. **Auditoría de dependencias no actualizada:** el informe de la quinta entrega registra cinco vulnerabilidades moderadas en dependencias transitivas móviles y cero en API. Ese dato es histórico; no se ejecutó `npm audit` ni se actualizaron dependencias.

## D. Próximos pasos recomendados

1. **Reconciliar PostgreSQL antes de desplegar autenticación** — confirmar en un entorno autorizado el historial/checksum de 0001–0004; probar el comportamiento de autenticación con PostgreSQL desechable y resolver cualquier diferencia antes de aplicar cambios. No avanzar números de migración por suposición.
2. **Definir asociación e importación local** — decidir identidad de propietario, consentimiento, tratamiento de datos locales existentes y recuperación ante fallos. Depende de tener autenticación y esquema central verificables.
3. **Alinear los esquemas por migraciones incrementales** — diseñar soporte remoto para campos de salud, ejecuciones, calendario y recordatorios; determinar qué entidades se sincronizan y cuáles se excluyen. Depende de las decisiones del paso 2 y de reconciliar el historial de migraciones.
4. **Implementar API de dominio owner-scoped** — DTO/validación, CRUD remoto, transacciones y autorización derivada del principal. Depende del paso 3; no aceptar `owner_id` confiado del cliente.
5. **Construir sincronización push/pull** — enviar outbox en orden de dependencias, recibos idempotentes, cursores transaccionales, ACK/versiones, tombstones y persistencia local atómica; implementar detección/resolución de conflictos y reintentos. Depende de los pasos 3–4 y de una política de retención/cursor.
6. **Integrar el cliente y probar flujos completos** — asociar/importar datos, ejecutar sync en red intermitente y validar reintentos, concurrencia, aislamiento y recuperación. Luego ejecutar pruebas Web con headers de producción y pruebas físicas de SQLite/notificaciones Android e iOS.
7. **Retomar KIRAI después de disponer de identidad y contratos de datos** — implementar orquestación/endpoints, consentimiento y contexto mínimo; después memoria/RAG/herramientas con autorización y evaluación veterinaria/seguridad. Mantener el asistente opcional y no bloquear el uso offline.
8. **Actualizar documentación y revisar dependencias** — corregir estados/rutas/esquemas y repetir auditoría de dependencias en un cambio separado, sin degradaciones forzadas incompatibles.

## E. Conclusión

PetCare tiene una base local sustancial y varios flujos de producto implementados, pero sigue siendo una aplicación parcialmente integrada: no hay persistencia remota de dominio ni sincronización operativa, y la autenticación no conecta todavía los datos SQLite con la cuenta central. KIRAI está en etapa de fundamentos/proveedor, no de asistente integrado. El proyecto está más cerca de un prototipo local multiplataforma que de una versión funcional integrada lista para producción; las validaciones de base remota y dispositivos reales siguen siendo decisivas.

## Evidencia y validaciones de esta auditoría

- Revisados código de `mobile/app/`, repositorios y migraciones SQLite, rutas Express, autenticación, migraciones PostgreSQL, pruebas y documentación de `docs/`.
- Ejecutado `npm test --prefix api`: **22/22 pruebas aprobadas**. Los tests HTTP/autenticación usan dependencias simuladas; no se conectaron a PostgreSQL.
- Ejecutado `npm run typecheck --prefix api`: aprobado.
- Ejecutado `npm run typecheck --prefix mobile`: aprobado.
- No se ejecutó build/export de Expo, verificador de SQLite, `npm audit`, prueba manual de Ollama ni prueba en dispositivos.
- Git al inicio: rama `main`, commit `1e742649b04293a2d5051cbd8ad56634d6a39fc3` (`2026-11-13`, “Actualizacion README.md y documentos de arquitectura”), árbol limpio.
- La última evidencia directa documentada para Neon está en [phase-4-3-neon-verification.md](../sync/phase-4-3-neon-verification.md) (10 nov.); registra 0001–0003 aplicadas y 0004 no presente. Esta auditoría no volvió a comprobar ese estado.
- El historial anterior de pruebas/limitaciones está en [persistence-verification.md](../persistence-verification.md), [fifth-delivery-audit.md](../audit/fifth-delivery-audit.md) y los documentos de [KIRAI](../kirai/).

Este informe es el único archivo creado para esta auditoría. No se ejecutaron operaciones sobre bases de datos.
