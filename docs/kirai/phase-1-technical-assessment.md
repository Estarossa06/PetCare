# KIRAI IA — Fase 1: diagnóstico técnico y viabilidad

**Fecha del diagnóstico:** 8 de noviembre de 2026  
**Alcance:** inspección estática del repositorio y consulta de documentación oficial de proveedores.  
**Cambios de producto:** ninguno. No se conectó Neon, no se ejecutaron migraciones, no se instalaron dependencias ni se modificaron esquemas.

## Clasificación de hallazgos

- **EXISTENTE Y FUNCIONAL:** código implementado y validado dentro del alcance inspeccionado.
- **EXISTENTE PERO INCOMPLETO:** existe parte del diseño o infraestructura, pero no una capacidad utilizable de extremo a extremo.
- **PROPUESTO:** recomendación de arquitectura; no existe aún en el producto.
- **NO IMPLEMENTADO:** el repositorio no contiene la capacidad.
- **PENDIENTE DE VERIFICACIÓN:** depende de un entorno externo, datos o una prueba que no se ejecutó en este diagnóstico.

## 1. Resumen ejecutivo

1. **El repositorio no contiene actualmente un backend Express ejecutable.** `api/src/` contiene solo migraciones y verificadores PostgreSQL. `api/package.json` no declara `express` ni tiene un script de arranque/servidor. Por tanto, KIRAI no puede añadirse aún como módulo de rutas a una API funcional sin completar primero una base HTTP, middleware, errores y despliegue.
2. **El esquema PostgreSQL sí incluye `ai_conversations` y `ai_messages`**, junto con tablas de usuarios, sesiones, mascotas y sync. Es solo estructura: no hay endpoints, autenticación, persistencia de chat, memoria, proveedor IA ni sincronizador que la use.
3. **La autenticación no está implementada como servicio.** `users` y `auth_sessions` modelan cuentas y hashes de refresh token, pero no hay registro/login, hash/verificación de contraseña, emisión/rotación de tokens, middleware de identidad, autorización ni gestión de revocación en código de servidor.
4. **SQLite y PostgreSQL son bases separadas.** La app crea un `account_id` provisional en `sync_metadata`; no existe sincronización implementada que lo convierta en el `user_id` de PostgreSQL ni que suba mascotas, notas médicas o cuidados. El backend no puede leer SQLite.
5. **Las tablas `ai_conversations` y `ai_messages` son reutilizables como punto de partida**, pero actualmente obligan a asociar cada conversación a una mascota; mensajes solo admiten roles `user`/`assistant`. No contienen una memoria semántica, resúmenes, preferencias, citas a fuentes ni metadatos de proveedor. El esquema por sí solo no constituye “memoria centralizada” funcional.
6. **La documentación de datos no coincide completamente con las migraciones PostgreSQL:** `docs/data-model.md` describe `calendar_events` y `calendar_reminders` remotos, pero esas tablas no aparecen en `api/src/db/migrations/0001_core.ts`–`0003_ordered_sync_cursors.ts`. La migración del cliente sí contiene `calendar_events` y `calendar_reminders`. KIRAI no debe asumir que esos datos locales existen en Neon.
7. **La arquitectura híbrida es viable en Node.js/TypeScript**, usando un contrato de proveedor propio y un fallback Ollama alojado en infraestructura controlada. Un Ollama en la computadora o red local de cada usuario no sería accesible desde el backend cloud de PetCare sin una ruta de red diseñada y autorizada.
8. **Recomendación de siguiente paso:** antes de la Fase 2, decidir alcance de autenticación y contexto de mascota, política de consentimiento y retención, backend HTTP/identidad y estrategia de fallback. No empezar por UI/avatar ni por elección del modelo.

### Estado global de preparación para KIRAI

**EXISTENTE PERO INCOMPLETO.** El modelo de datos preliminar y parte del esquema están; faltan todos los servicios que permiten operar de forma segura el agente.

## 2. Arquitectura actual de PetCare

| Componente | Evidencia actual | Estado |
|---|---|---|
| Cliente | Un proyecto React Native, Expo, TypeScript y Expo Router en `mobile/`, con rutas compartidas para Web/Android/iOS. | **EXISTENTE Y FUNCIONAL** |
| Persistencia móvil | `expo-sqlite`, migraciones locales, repositorios de mascotas, historial, cuidados y calendario; las escrituras locales usan una cola de sincronización. | **EXISTENTE Y FUNCIONAL** para las funciones locales implementadas |
| Backend | `api/src/` contiene `db/migrate.ts`, tres migraciones, verificadores y tipos de migración. No hay `src/index`, app Express, módulo HTTP, controlador ni ruta. | **NO IMPLEMENTADO** como API HTTP |
| Runtime/compilación API | `api/package.json` ofrece typecheck, build y comandos de DB. Dependencias runtime: `pg` y `dotenv`; no se declara Express. | **EXISTENTE Y FUNCIONAL** como toolkit de migraciones |
| PostgreSQL | Migraciones TypeScript versionadas con checksum, advisory lock y transacciones por migración; cursor multiusuario modelado. | **EXISTENTE Y FUNCIONAL** como mecanismo de esquema |
| Sincronización | SQLite tiene outbox, dependencias, retries/conflictos; PostgreSQL tiene dispositivos, recibos idempotentes, cambios y cursores. No hay API de sync que conecte ambos. | **EXISTENTE PERO INCOMPLETO** |
| Asistente actual | La ruta `mobile/app/(tabs)/assistant.tsx` muestra `SectionPreviewScreen`; no hay pantalla conversacional ni servicio IA. | **NO IMPLEMENTADO** |

En esta fase se ejecutó `npm run typecheck` en `api/`, que pasó. No se conectó a PostgreSQL ni se ejecutaron comandos `db:migrate`/`db:verify`.

## 3. Estado real del backend

### Organización inspeccionada

```text
api/
├── package.json
├── tsconfig.json
└── src/
    └── db/
        ├── migrate.ts
        ├── verify.ts
        ├── verify-cursor.ts
        └── migrations/
            ├── 0001_core.ts
            ├── 0002_sync_support.ts
            ├── 0003_ordered_sync_cursors.ts
            ├── index.ts
            └── types.ts
```

Los archivos `api/dist/` observados son salida compilada de estas herramientas DB; no se consideran un servidor HTTP.

| Aspecto solicitado | Estado y evidencia |
|---|---|
| Organización modular | Solo módulo `db` en `src`; no existen módulos HTTP/de dominio. **NO IMPLEMENTADO** para API de producto. |
| Express | No está en dependencias ni se encontró `express()`/router en `api/src`. **NO IMPLEMENTADO**. |
| Middlewares | No hay cadena middleware, manejo de request ID, logging HTTP, rate limit, CORS o límites de body. **NO IMPLEMENTADO**. |
| Errores HTTP | Los CLIs capturan fallos, imprimen mensaje y fijan `process.exitCode`; no existe catálogo/respuesta de errores HTTP. **NO IMPLEMENTADO**. |
| Validaciones API | Hay constraints/checks PostgreSQL y validadores implícitos en SQL; no hay parseo/validación de requests. **EXISTENTE PERO INCOMPLETO**. |
| Autenticación | Hay tabla `users` y `auth_sessions` con `refresh_token_hash`, expiración y revocación. No hay autenticador, endpoints ni middleware. **EXISTENTE PERO INCOMPLETO**. |
| Autorización/aislamiento | Las FK compuestas aseguran consistencia owner/pet en tablas; no existe identidad autenticada ni consultas API owner-scoped que apliquen autorización. **EXISTENTE PERO INCOMPLETO**. |
| Variables de entorno | Migrador carga `dotenv/config` y requiere `DATABASE_URL`; `.env.example` documenta una variable. No se mostró ni utilizó ningún valor secreto. **EXISTENTE Y FUNCIONAL** para migraciones. |
| Conexión Neon | `pg.Pool` se crea en scripts de migración/verificación. No hay pool singleton, health check, servicio web o manejo de solicitudes. **EXISTENTE PERO INCOMPLETO**. El estado desplegado no se consultó. |
| Migraciones | Tres migraciones ordenadas; ledger `schema_migrations`, checksum, advisory lock y rollback por transacción. **EXISTENTE Y FUNCIONAL** como mecanismo. |
| Pruebas | Scripts de verificación de esquema/constraints y concurrencia de cursor. Requieren `PETCARE_RUN_DB_CHECKS=1` y `DATABASE_URL`, advierten usar DB desechable y limpian fixtures. No se ejecutaron para evitar conectarse a un Neon no verificado. Typecheck pasó. **EXISTENTE PERO INCOMPLETO** como suite/CI. |

**Conclusión:** el backend no está preparado todavía para alojar KIRAI como módulo independiente de API. La estructura de migraciones permite crear un módulo futuro, pero falta crear primero la aplicación HTTP, middleware, autenticación efectiva, autorización, límites/observabilidad y pruebas de rutas.

## 4. Estado real de PostgreSQL

El inventario siguiente procede del código de migraciones, no de una consulta de esquema vivo. `docs/persistence-verification.md` registra ejecuciones anteriores sobre una instancia de desarrollo; esta auditoría no volvió a conectarse. El estado actual de Neon queda **PENDIENTE DE VERIFICACIÓN**.

| Tabla | Definida en fuente | Relaciones/campos | Funcionalidad real en API |
|---|---|---|---|
| `users` | `0001_core.ts` | UUID, email único normalizado, `password_hash`, nombre, soft-delete, timestamps. | Solo DDL; registro/login no implementados. |
| `auth_sessions` | `0001_core.ts` | `user_id`, hash de refresh token, vencimiento/revocación. | Solo DDL; emisión, rotación y revocación no implementadas. |
| `pets` | `0001_core.ts` | `owner_id → users`, UUID, versión/timestamps/`deleted_at`; índice por propietario/actualización. | Sin API CRUD ni sync endpoint. |
| `health_records` | `0001_core.ts` | Owner/pet FK, categoría médica, fecha, profesional, versión/tombstone. | DDL; cliente mantiene historial en SQLite. |
| `health_attachments` | `0001_core.ts` | Metadata y `storage_key`, vinculado al mismo propietario/mascota/registro. | DDL; servicio de objetos/upload no implementado. |
| `care_tasks` | `0001_core.ts` | Owner/pet, tipo, recurrencia, timezone, habilitado, versión/tombstone. | DDL; no hay API de cuidados. |
| `appointments` | `0001_core.ts` | Owner/pet, inicio/fin, ubicación/notas, estado e índice de fecha. | DDL; no hay API de citas. |
| `reminders` | `0001_core.ts` | Owner/pet, opcional care task o appointment, `due_at`, estado y tombstone. | DDL; no hay API de recordatorios. |
| `ai_conversations` | `0001_core.ts` | UUID, owner, **`pet_id NOT NULL`**, título, versión/timestamps/soft-delete; FK compuesta owner/pet; índice por mascota y actualización. | DDL; sin repositorio, endpoints o servicio que escriba conversaciones. |
| `ai_messages` | `0001_core.ts` | UUID, owner, `pet_id NOT NULL`, conversation, `role IN ('user','assistant')`, content/timestamps/version; FK owner/conversation/pet; índice cronológico. | DDL; sin generación, persistencia de chat, paginación o política de retención. |
| `sync_devices` | `0002_sync_support.ts` | Usuario/dispositivo, cursor de descarga, última actividad y revocación. | DDL; no existe servicio para dispositivos. |
| `sync_operations` | `0002_sync_support.ts` | Recibo idempotente `(user_id, operation_id)`, request hash y respuesta JSON. | DDL; el protocolo solo está diseñado, no implementado. |
| `sync_changes` | `0002_sync_support.ts` + `0003` | Feed por propietario, tipo/UUID/versión y cambio; acepta `ai_conversation` y `ai_message`. | DDL; no hay writer/pull endpoint. |
| `sync_cursors` | `0003_ordered_sync_cursors.ts` | Contador transaccional por `owner_id`. | DDL y verificador de concurrencia; no hay escritor de feed en el backend. |
| `calendar_events`, `calendar_reminders` | No aparecen en migraciones PostgreSQL 0001–0003. | Sí existen en la migración local móvil 0004. | **NO IMPLEMENTADO** en PostgreSQL. |

### Índices y aislamiento

Las migraciones definen, entre otros, índices de email, mascotas por owner/actualización, historiales por mascota/fecha, cuidados habilitados, citas por fecha, recordatorios pendientes, conversaciones por mascota/actualización, mensajes por conversación/fecha y sync por owner/cursor. Las tablas de dominio emplean FK compuestas como `(owner_id, pet_id)` y `(owner_id, conversation_id, pet_id)`, y `ON DELETE RESTRICT`; eliminaciones de aplicación deben ser lógicas.

Las constraints son una defensa adicional, no reemplazan `WHERE owner_id = authenticated_user_id` en cada consulta/acción. Actualmente no hay endpoint donde aplicar esa autorización.

### Observación de discrepancia documental

`docs/data-model.md` lista `calendar_events` y `calendar_reminders` bajo PostgreSQL, mientras el árbol real de migraciones remotas no las crea. La propia documentación de calendario dice que dichos cambios de PostgreSQL/API quedan pendientes. Corregir esa discrepancia documental en una fase autorizada antes de diseñar sync para el calendario.

**Estado desplegado:** **PENDIENTE DE VERIFICACIÓN**. No se inspeccionó `information_schema` de Neon ni se tocó una base remota.

## 5. Estado de SQLite y contexto disponible

### Persistencia local

La app abre `petcare.db` mediante `expo-sqlite`; el migrador ejecuta versiones locales 0001–0005 con `BEGIN IMMEDIATE`, registra `_local_migrations` y recupera operaciones `in_flight` como `pending`. Repositorios de mascotas, historial, cuidados y calendario consultan SQLite con `owner_id` local.

El helper local crea, si hace falta, un UUID en `sync_metadata.account_id`. No es una identidad autenticada: es un identificador provisional local. No existe mapping probado entre ese UUID y un PostgreSQL `users.id`.

### Qué datos conoce cada lado

| Dato | SQLite en dispositivo | PostgreSQL central | Transferencia actual |
|---|---|---|---|
| Mascotas, historial y cuidados | Tablas locales disponibles. | Tablas equivalentes están definidas en migraciones remotas. | **Ninguna sincronización activa**; backend no los puede leer del archivo local. |
| Calendario | Eventos y recordatorios nuevos en SQLite; citas y salud/cuidado vinculados a su fuente. | Citas y recordatorios legacy aparecen en esquema; tablas `calendar_*` nuevas faltan. | **No hay sincronización remota**. |
| Conversaciones/mensajes | Tablas `ai_conversations`/`ai_messages` existen en SQLite inicial. | Tablas homónimas definidas en migración remota. | **No se encontraron repositorios/servicios que las usen ni sync activa**. |
| Archivos médicos | Binarios almacenados localmente; SQLite conserva metadatos/clave local. | Tabla remota solo modela metadata/storage key. | Upload/almacenamiento remoto no implementado. Nunca asumir que el backend puede abrir el archivo local. |
| Operaciones pendientes | `sync_queue`, dependencias, retries, conflictos y metadata. | Recibos, cambios y cursores modelados. | Transporte/sync worker y endpoints no implementados. |

### Contexto potencial para KIRAI

Con autorización explícita, un cliente futuro podría enviar al endpoint únicamente un resumen mínimo necesario de la mascota seleccionada: UUID, especie, edad aproximada, alergias/condiciones declaradas, medicamentos, vacunas, historial relevante y cuidados relevantes. Debe distinguir datos confirmados por el usuario/profesional de contenido generado por el modelo; excluir adjuntos/binarios por defecto; y evitar enviar toda la cuenta o conversaciones no relacionadas.

Este contexto no puede obtenerse hoy desde Neon: residiría solo en SQLite hasta que el cliente lo transmita de forma explícita o un servicio de sync real lo suba. Si el backend identifica al propietario mediante login, además debe comprobar que los IDs seleccionados realmente pertenecen a ese usuario; no confiar en un `owner_id` suministrado por el cliente.

Los UUID de filas locales se pueden conservar al sincronizar, pero el `account_id` provisional no debe considerarse autorización ni equivaler a `users.id`.

## 6. Infraestructura reutilizable

| Recurso | Reutilización posible | Estado |
|---|---|---|
| Node.js + TypeScript strict/ES2022 | Base para un módulo de orquestación HTTP cuando se incorpore un servidor. | **EXISTENTE Y FUNCIONAL**, sin servidor aún. |
| `pg` Pool y carga de entorno | Reutilizables dentro de servicio API, después de definir ciclo de vida, timeouts, secrets y shutdown del servidor. | **EXISTENTE PERO INCOMPLETO**: hoy se usan en CLIs. |
| Migraciones y tipos | Añadir migraciones incrementales para ampliar memoria, consentimiento y conocimiento. No editar las ya aplicadas. | **EXISTENTE Y FUNCIONAL** como mecanismo. |
| `ai_conversations`/`ai_messages` en ambos esquemas | Punto de partida para historial central y relación owner/pet. Requieren decisiones de conversación general, consentimientos y campos de auditoría. | **EXISTENTE PERO INCOMPLETO**. |
| Sync outbox/idempotencia/cursors | Puede transportar más entidades si se implementa el protocolo completo; no sustituye API de IA síncrona. | **EXISTENTE PERO INCOMPLETO**. |
| Repositorios SQLite | Posible capa móvil para formar un snapshot consentido de contexto. | **EXISTENTE Y FUNCIONAL** para dominio local; integración KIRAI no existe. |
| Ruta “Asistente” | Puede servir después como punto de entrada visual. | **EXISTENTE PERO INCOMPLETO**; actualmente pantalla de preview, no chat. |

## 7. Proveedores de IA evaluados

Los precios cambian por modelo, región, tier, características y fecha. Los valores siguientes son muestras oficiales consultadas el **8 de noviembre de 2026**, expresadas por millón de tokens USD; antes de contratar o desplegar hay que revisarlos otra vez. No se crearon cuentas ni claves.

| Opción | Integración Node/TypeScript | Costes, cuotas y gratuidad | Evaluación para KIRAI |
|---|---|---|---|
| OpenAI API | API oficial y ecosistema Node; interfaz HTTP independiente. Los tiers y límites se ajustan por organización/modelo. | Página de precios consultada muestra `gpt-5-mini`: USD 0.25 entrada / 2.00 salida por 1M tokens; `gpt-5-nano`: 0.05 / 0.40. La documentación de límites describe niveles y límites mensuales, pero el acceso “Free” depende de geografía/condiciones; no asumir créditos gratuitos permanentes. | Candidato cloud. API data controls indican que API data no se usa para entrenamiento por defecto; abuse monitoring puede retener logs hasta 30 días salvo controles elegibles. Verificar retención/configuración, contratos y residencia antes de enviar datos veterinarios. |
| Gemini Developer API | API REST/SDK disponible para backend; quotas por proyecto y modelo medidas en RPM/TPM/RPD; tiers varían y pueden ajustarse. | La página muestra Gemini 3.8 Flash gratis en Free Tier (entrada/salida) y USD 0.75/3.75 por 1M tokens hasta 31-dic-2026; USD 1.50/7.50 desde 1-ene-2027. La tabla indica que el contenido del tier gratis puede usarse para mejorar productos; el paid tier indica que no. El tier gratuito tiene límites/cuotas, no servicio garantizado. | Candidato de bajo costo para prototipo no sensible. **No enviar datos veterinarios identificables usando Free Tier**; confirmar términos y privacidad de la ruta paid. |
| Anthropic Claude API | API HTTP/SDK Node; cuotas y spend limits por organización/tier. | La página consultada publica Claude Haiku 5.5 a USD 0.10 entrada / 0.50 salida por 1M tokens; límites/tier y costos de otras capacidades varían. No asumir un plan gratuito continuo para API; el acceso puede comenzar con límites de evaluación. | Candidato de comparación/calidad. Confirmar costos vigentes, política de retención y condiciones de datos antes de uso clínico/veterinario. |
| Ollama local | Servidor local HTTP y compatibilidad parcial con OpenAI API; la documentación ofrece JavaScript y endpoints REST. Mantener adaptador propio porque no todas las APIs/herramientas son compatibles. | Sin cobro por token para inferencia ejecutada en hardware propio; sí hay costo de hardware, energía, operación, capacidad, almacenamiento de modelos y soporte. No hay cuota de proveedor para modelo local, pero hay límite de throughput y recursos. | Fallback local viable si se aloja en infraestructura de PetCare y el backend puede accederlo por red privada. No es fallback accesible automáticamente desde una API cloud si Ollama corre en el portátil del usuario. |

### Ollama y hardware

La documentación de Ollama Quickstart usa Gemma 4 E2B como ejemplo: descarga aproximada de 7.2 GB y recomendación de 8 GB de VRAM o memoria unificada disponible; ventanas de contexto mayores consumen más memoria y RAM puede permitir ejecución más lenta. Es una referencia de un modelo pequeño concreto, no un mínimo universal. Modelos mayores requieren memoria adicional proporcional al tamaño/quantización y concurrencia. Hay que medir latencia, calidad veterinaria y costo de operación en el host elegido.

La documentación ofrece `http://localhost:11434` para API local y declara que el API local no requiere key. No exponer ese puerto directamente a Internet: aislarlo en red privada y poner autenticación, TLS/proxy y control de acceso si otro servicio lo llama.

### Recomendación de selección

**PROPUESTO:** mantener el proveedor cloud intercambiable y decidirlo con un benchmark propio, no por el plan gratuito. Para datos reales, usar solo tier/contrato cuya retención y uso de prompts hayan sido aprobados. Como candidata inicial, probar una API cloud pagada con controles de privacidad explícitos y comparar con una segunda mediante preguntas veterinarias curadas. Usar Ollama privado como fallback para continuidad, con degradación explícita de capacidades si no soporta la herramienta requerida.

No usar tier gratis de Gemini con datos identificables por la nota de uso de contenido para mejora; podría servir para experimentación con información sintética. Ningún modelo debe ejecutar acciones ni diagnosticar de forma autónoma.

Fuentes oficiales:

- [OpenAI API pricing](https://platform.openai.com/docs/pricing)
- [OpenAI API rate limits](https://platform.openai.com/docs/guides/rate-limits)
- [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
- [Gemini API additional terms](https://ai.google.dev/gemini-api/docs/terms)
- [Anthropic API pricing](https://docs.anthropic.com/en/docs/about-claude/pricing)
- [Anthropic API rate limits](https://platform.claude.com/docs/en/api/rate-limits)
- [Ollama Quickstart](https://docs.ollama.com/quickstart)
- [Ollama API introduction](https://docs.ollama.com/api/introduction)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [Ollama FAQ](https://docs.ollama.com/faq)

## 8. Arquitectura preliminar propuesta

```text
Expo client
  └── authenticated HTTPS request + explicit consent + minimal pet snapshot
      └── PetCare API (new HTTP server)
          ├── Authentication / owner authorization / quotas
          └── KIRAI module
              ├── Agent Orchestrator
              ├── Context Builder (authorized records only)
              ├── Safety / policy guard
              ├── Tool Registry (read tools + confirm-gated write intents)
              ├── Knowledge Retriever (curated/versioned sources)
              ├── Memory Repository (PostgreSQL)
              └── Model Router
                  ├── Cloud Provider adapter (primary)
                  └── Private Ollama adapter (fallback)
```

KIRAI es adicional: cualquier error de red, proveedor, memoria o presupuesto debe devolver un estado de “servicio IA no disponible” sin bloquear SQLite ni el resto de PetCare. El chat requiere conexión; PetCare offline sigue funcionando.

### Contratos sugeridos

```ts
interface AIProvider {
  generate(request: ModelRequest, signal?: AbortSignal): Promise<ModelResult>;
  health(): Promise<ProviderHealth>;
}

interface ModelRequest {
  messages: readonly AgentMessage[];
  tools?: readonly ToolDefinition[];
  maxOutputTokens: number;
  responseFormat?: "text" | "json";
  traceId: string;
}

interface ModelResult {
  message: AgentMessage;
  toolCalls: readonly ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
  provider: string;
  model: string;
}

interface MemoryRepository {
  createConversation(input: AuthorizedConversation): Promise<Conversation>;
  appendMessage(input: AuthorizedMessage): Promise<Message>;
  listMessages(ownerId: string, conversationId: string, cursor?: string): Promise<MessagePage>;
  deleteConversation(ownerId: string, conversationId: string): Promise<void>;
}

interface PetContextReader {
  loadSnapshot(ownerId: string, petId: string, scope: ContextScope): Promise<PetContext>;
}

interface Tool {
  describe(): ToolDefinition;
  authorize(input: ToolInput, principal: Principal): Promise<AuthorizedToolInput>;
  execute(input: AuthorizedToolInput, principal: Principal): Promise<ToolResult>;
}
```

Tipos ilustrativos; no se han creado en el código. Los contratos concretos deben incluir límites de tamaño, timeout, cancelación, validación estructural y redacción segura de logs.

### Política de orquestación

1. Autenticar usuario y limitar tasa/costo antes de llamar a proveedor.
2. Comprobar consentimiento vigente para el uso de IA y de contexto veterinario.
3. Resolver el propietario en servidor; cargar solo la mascota y campos autorizados.
4. Añadir identidad, límites veterinarios y conocimiento de confianza de forma separada del contenido de usuario/modelo.
5. Llamar al proveedor primario con timeout y presupuesto de tokens.
6. Cambiar al fallback solo en fallos transitorios/indisponibilidad y registrar la degradación. No hacer fallback que eluda rechazos de seguridad, denegaciones, validaciones o controles de permiso.
7. Validar llamadas a herramientas en servidor. Las lecturas autorizadas pueden ejecutarse con alcance acotado; escrituras se devuelven como propuesta de acción pendiente.
8. Exigir confirmación vinculada al usuario, operación, objetivo, argumentos normalizados y expiración. Revalidar autorización y estado al confirmar; no aceptar un simple “sí” generado o inferido por el modelo como autorización.
9. Guardar memoria solo según consentimiento/retención, con límites y opción de listar/exportar/borrar.
10. Responder con advertencias apropiadas y remitir a veterinario cuando haya signos urgentes o incertidumbre.

## 9. Estructura de módulos recomendada

Todos los directorios siguientes son **PROPUESTOS**, no existentes:

```text
api/src/
├── app.ts                         # construcción Express; errores/middleware
├── server.ts                      # escucha, cierre ordenado, health checks
├── config/
│   ├── env.ts                     # validación de configuración/secrets
│   └── limits.ts
├── middleware/
│   ├── authenticate.ts
│   ├── request-context.ts
│   ├── rate-limit.ts
│   └── error-handler.ts
├── modules/
│   └── kirai/
│       ├── routes/
│       │   ├── kirai.routes.ts
│       │   └── conversation.routes.ts
│       ├── schemas/               # requests/responses validados
│       ├── core/
│       │   ├── orchestrator.ts
│       │   ├── model-router.ts
│       │   ├── contracts.ts
│       │   └── prompts/
│       ├── providers/
│       │   ├── provider.ts
│       │   ├── cloud/
│       │   └── ollama/
│       ├── memory/
│       │   ├── memory.repository.ts
│       │   └── conversation.service.ts
│       ├── knowledge/
│       │   ├── retriever.ts
│       │   └── sources/
│       ├── context/
│       │   └── pet-context.service.ts
│       ├── tools/
│       │   ├── registry.ts
│       │   └── read/
│       └── safety/
│           ├── policy.ts
│           └── veterinary-triage.ts
├── db/                            # migraciones y pool existentes
└── observability/                 # métricas, tracing con redacción
```

Separar proveedores del orquestador evita acoplar identidad, memory, safety y tools a un SDK. La primera iteración debe evitar una abstracción de agentes general que permita ejecutar herramientas arbitrarias; exponer solo un conjunto allow-listed de funciones pequeñas.

## 10. Riesgos y medidas preventivas

| Riesgo | Nivel orientativo | Medidas preventivas |
|---|---|---|
| Datos veterinarios enviados a un proveedor sin consentimiento/retención adecuada | Alto | Consentimiento granular antes de transmitir; usar plan/contrato aprobado; minimización; evaluación legal de jurisdicción, retención y tratamiento; no usar tier gratuito con datos identificables si permite mejora con contenido. |
| Acceso a datos de otro propietario por `petId` manipulable | Crítico | Autenticación real antes de IA; owner derivado de principal en servidor; repository siempre filtra por owner; verificar relación de cada herramienta/contexto; tests cross-owner. |
| Claves API expuestas en Expo/client/logs | Alto | Secrets solo en servidor/secret manager; validar variables al arranque; nunca serializar config; rotación; redacción de logs. |
| Prompt injection desde usuario, historiales, adjuntos o documentos RAG | Alto | Tratar datos recuperados como no confiables; delimitar contexto; herramientas allow-listed; validar parámetros en código; no dar SQL/shell general; confirmar escrituras por protocolo externo al modelo. |
| Consejo veterinario falso o diagnóstico/urgencia mal clasificada | Alto | KIRAI informa, no diagnostica; contenido veterinario curado y versionado; avisos de urgencia deterministas; validación clínica; evaluación adversarial multiespecie; abstención y derivación profesional. |
| Caída/latencia/cuota del proveedor primario | Medio-alto | Timeout, circuit breaker, límites de retry, fallback privado, estados degradados claros; no afectar PetCare offline. |
| Coste de tokens/herramientas o bucles de agente | Alto | Presupuesto por usuario/día, límite de contexto/output/turnos/tool calls, alertas, kill switch, medidor de costo y límite mensual del proveedor. |
| Memoria contaminada, errónea o no borrada | Alto | No convertir respuestas en hechos; almacenar origen/confianza; consentimiento y retención; soft/hard deletion conforme política; resúmenes revisables; pruebas de borrado y exportación. |
| Dependencia de API propietaria/model drift | Medio | Provider interface propia, modelo configurable, suite de regresión común, versionar prompt y esquema de respuesta, observar calidad y compatibilidad antes de cambio. |
| Fallback local accesible indebidamente | Alto | Ollama en subnet privada, no exponer puerto 11434; autenticación TLS entre servicios, egress control, revisión de modelo/licencia y parcheo. |
| Confusión sobre fuentes de verdad SQLite/Neon | Alto | No consultar como si estuvieran sincronizadas; explicitar snapshot local enviado y timestamp; no prometer memoria de datos no subidos; resolver primero identidad y sync. |
| Conversación existente siempre ligada a mascota | Medio | Decidir soporte de conversaciones generales/múltiples mascotas; posiblemente permitir `pet_id NULL` o añadir scope, con migración futura aprobada. |
| Prompt/PII en observabilidad | Alto | No registrar prompts completos por defecto; IDs de correlación no identificables; redacción y retención corta; acceso a trazas restringido. |

## 11. Dependencias y requisitos pendientes

### Técnicos

- **NO IMPLEMENTADO:** servidor HTTP Express (o decisión explícita de framework), scripts start/dev, health/readiness y shutdown.
- **NO IMPLEMENTADO:** autenticación real, emisión/validación de access tokens, rotación/revocación segura de refresh tokens y autorización.
- **NO IMPLEMENTADO:** cliente de API en móvil con sesión segura; `mobile` no puede acceder a claves de proveedor.
- **NO IMPLEMENTADO:** cliente sync; el owner local provisional no puede usarse como cuenta central.
- **PENDIENTE DE VERIFICACIÓN:** esquema que está efectivamente aplicado en Neon hoy; solo se leyó el source y reportes previos.
- **PROPUESTO:** política de conversation scopes, consentimiento, retención, exportación y borrado.
- **PROPUESTO:** migración incremental futura para `pet_id` opcional o scope general y para metadatos de memoria/consentimiento, tras decidir el producto.
- **NO IMPLEMENTADO:** fuente de conocimiento veterinario, curación, licencias, fecha/revisor y proceso de actualización.
- **PROPUESTO:** elección de SDK/proveedor, egress/networking y despliegue Ollama de fallback.
- **PROPUESTO:** límite de coste, rate limiting por usuario, auditoría de herramientas y protección contra abuso.
- **PROPUESTO:** batería de evaluación veterinaria/especies/urgencias, prompt injection, aislamiento de propietario, borrado de memoria y fallos de proveedor.

### Producto, seguridad y operación

- Definir qué información puede consultarse de forma predeterminada y qué requiere consentimiento contextual.
- Definir si se permite usar conversaciones para personalización, cuánto se retienen y cómo se eliminan.
- Definir la jurisdicción de despliegue/procesamiento de datos veterinarios y revisión de términos con proveedor.
- Determinar hosting y conectividad privada Ollama, tamaño de modelo, GPU/RAM y SLO.
- Determinar si KIRAI puede crear recordatorios/actividades en la primera versión; si sí, especificar diálogo de confirmación, autorización, expiración e idempotencia.
- Elegir responsable veterinario para revisar protocolos y datos de conocimiento.
- Revisar discrepancia de `docs/data-model.md` sobre tablas de calendario remotas.

## 12. Recomendaciones para la siguiente fase

Orden sugerido antes de conectar modelos:

1. **Acordar límites del MVP:** solo conversación informativa con contexto seleccionado, o también herramientas de lectura; dejar escrituras fuera hasta tener confirmación técnica y UX.
2. **Cerrar identidad y propiedad:** implementar/probar autenticación y construir un `Principal` confiable en backend. Resolver explícitamente mapping SQLite `account_id` → PostgreSQL `users.id`; sin ello el contexto local no puede incorporarse de forma segura.
3. **Definir consentimiento y privacidad:** aviso de transmisión, campos enviados, política de retención/borrado, proveedor/tier y jurisdicción.
4. **Crear base de API independiente de IA:** Express, validación, error handler, autenticación, límites, logging redacted, conexión Pool administrada y health checks.
5. **Diseñar contratos y evolución de memoria:** decidir conversaciones globales vs mascota, migraciones incrementales, paginación, límites, ownership y delete/export. Las tablas actuales pueden evolucionarse; no se deben tratar como servicio acabado.
6. **Crear evaluación antes de proveedor:** casos veterinarios multiespecie, urgencias, no diagnóstico, grounding/citas y ataques de instrucciones.
7. **Probar proveedores con contexto sintético:** comparar calidad, latencia, uso de herramientas, costo, cuotas y políticas de datos; seleccionar cloud primary solo después.
8. **Operar fallback Ollama en red privada:** medir hardware y calidad, documentar capacidades no soportadas y verificar failover con circuit breaker.
9. **Implementar memoria/RAG/tools gradualmente:** fuentes versionadas y citas; lectura owner-scoped; propuesta de acción; confirmación explícita server-side para toda escritura.
10. **Mantener independencia offline:** KIRAI puede aparecer como no disponible sin conexión; jamás bloquear flujos locales SQLite.

No se debe comenzar implementación hasta que el usuario apruebe alcance, contrato de identidad y política de datos. No se implementó en esta fase ningún chat, avatar, API de proveedor, módulo backend ni cambio de esquema.

