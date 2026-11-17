# KIRAI — Fase 2: proveedor local Ollama

**Estado:** adaptador implementado y primera etapa conversacional integrada.
**Proveedor inicial:** Ollama por HTTP local.
**Modelo predeterminado:** `qwen3:8b`.
**Alcance:** consulta autenticada de un turno, sin memoria, RAG, herramientas ni
integración con datos de PetCare.

## 1. Arquitectura

La identidad, el prompt y las reglas de KIRAI siguen independientes del
proveedor:

1. `buildSystemMessage()` compone el mensaje de sistema a partir de la
   identidad y reglas existentes.
2. `ModelProvider` define una interfaz agnóstica con `generate(request,
   options?)`; `options.signal` permite cancelación.
3. `OllamaProvider` adapta el contrato a `POST /api/chat`, envía
   `stream: false` y transforma la respuesta al contrato común.
4. El adaptador solo devuelve el contenido final del mensaje `assistant` y
   una razón de finalización normalizada. No copia ni expone campos como
   `thinking`.

El proveedor se limita a URLs HTTP de loopback (`127.0.0.1`, `localhost`,
`[::1]`); no admite URL pública, credenciales, rutas adicionales, query ni
fragment. Ollama debe permanecer accesible solo localmente y no se configura
acceso público.

Archivos principales:

- `api/src/modules/kirai/config.ts`: variables, valores por defecto y
  validación de configuración local.
- `api/src/modules/kirai/providers/model-provider.ts`: contrato común,
  ampliado para soportar `AbortSignal`.
- `api/src/modules/kirai/providers/ollamaProvider.ts`: adaptador HTTP,
  extracción de respuesta final y errores sanitizados.
- `api/src/modules/kirai/providers/test-ollama.ts`: prueba manual separada del
  arranque Express.
- `api/src/modules/kirai/service.ts`, `validation.ts` y `routes.ts`: orquestación
  de una pregunta, validación y endpoint HTTP.
- `mobile/src/features/kirai/`: cliente y pantalla de consulta de KIRAI.
- `api/test/kirai.test.ts`: pruebas automáticas con proveedor simulado y ruta HTTP.

Express monta `POST /kirai/chat`, protegido por el middleware de sesión actual
y limitado a 10 consultas por IP cada 15 minutos. No se modifican las rutas de
autenticación ni la identidad o las reglas de KIRAI. No se conecta a Neon o
SQLite ni se envía contexto de mascotas.

## 2. Configuración

El adaptador lee estas variables opcionales:

| Variable | Predeterminado | Validación |
|---|---|---|
| `KIRAI_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | HTTP y host loopback únicamente; sin credenciales/ruta/query/fragment. |
| `KIRAI_OLLAMA_MODEL` | `qwen3:8b` | Nombre no vacío, sin espacios y de hasta 120 caracteres. |
| `KIRAI_OLLAMA_TIMEOUT_MS` | `60000` | Entero entre 1 y 300000 ms. |

No se requieren credenciales de Ollama. No se añadió ninguna variable
`EXPO_PUBLIC_*`. El adaptador se instancia al crear la aplicación Express; la
generación solo se ejecuta en una solicitud autenticada a `/kirai/chat`.

El proceso de prueba manual importa `dotenv/config`, de modo que puede usar
las variables del entorno o el archivo local ignorado de API cuando se ejecuta
con el directorio de trabajo `api/`. No guardar secretos en configuración de
Ollama ni habilitar el servicio en una interfaz de red pública.

## 3. Respuestas y errores

- Envía los roles y contenidos del contrato `ModelRequest`, incluyendo el
  mensaje de sistema ya construido.
- Solicita una única respuesta no streaming.
- Desactiva el modo de razonamiento oculto cuando el modelo configurado es
  Qwen3, para reservar el límite de salida para la respuesta visible.
- Devuelve solo `message.content` final como mensaje `assistant`. No propaga
  el objeto de respuesta original del proveedor.
- Normaliza `done_reason` a `stop`, `length` u `other`.
- Informa fallos con `OllamaProviderError` y códigos `invalid_request`,
  `timeout`, `cancelled`, `connection`, `http` e `invalid_response`.
- Para HTTP, expone el status numérico, no el body remoto. Los errores de
  conexión no incluyen la URL ni detalles de red.
- No registra prompts, conversaciones ni respuestas.
- Timeout y cancelación abortan la petición. El timeout también cubre la
  lectura de la respuesta.
- El endpoint acepta únicamente una pregunta no vacía de hasta 2000 caracteres,
  limita cada respuesta a 512 tokens y solo devuelve el texto final y si fue
  truncado.
- Los errores del proveedor se registran sin prompt, respuesta, URL ni detalles
  de red y se presentan al cliente como una indisponibilidad genérica.

Una respuesta HTTP exitosa sin JSON válido, sin `message` de rol `assistant`
o sin contenido final no se convierte en una respuesta vacía exitosa: se
rechaza como `invalid_response`.

## 4. Prueba funcional local

Requiere que Ollama esté instalado, ejecutándose localmente y que el modelo
configurado ya esté disponible. La prueba no descarga modelos. Ejecutar desde
`api/`:

```powershell
npm run kirai:ollama:test
```

La prueba construye el mensaje del sistema, crea el adaptador como
`ModelProvider`, envía una pregunta inocua en español y muestra únicamente el
texto final. No forma parte de `npm start`, `npm run dev` ni del arranque de
Express.

En la máquina de desarrollo revisada, `ollama --version` informó
`0.40.13`; `ollama list` mostró `qwen3:8b` instalado. La prueba funcional
contra el servicio local terminó correctamente y devolvió una respuesta en
español. La compatibilidad con otras versiones de Ollama debe verificarse al
actualizar; no se fija una versión mínima universal en esta fase.

## 5. Pruebas automatizadas

`api/test/kirai.test.ts` usa el contrato `ModelProvider` y respuestas `fetch`
simuladas; no requiere Ollama real. Comprueba:

- Valores predeterminados y rechazo de hosts no loopback.
- Método, URL `/api/chat`, modelo, mensajes y mensaje de sistema.
- Extracción de contenido final y omisión de `thinking`.
- Error HTTP sin exponer body, fallo de conexión y timeout.
- Cancelación del llamador.
- JSON malformado, forma inválida y contenido final vacío.
- Autenticación, validación de la pregunta, límite de solicitudes, uso del
  prompt de seguridad, ausencia de datos de mascotas y sanitización de errores.

La suite está incluida en `npm test --prefix api`.

## 6. Validación ejecutada

Validación del proveedor realizada en la fase anterior:

- `npm run typecheck --prefix api` — aprobado.
- `npm run build --prefix api` — aprobado.
- `npm run kirai:ollama:test --prefix api` — aprobado contra Ollama local y
  `qwen3:8b` instalado en ese entorno.

Validación de la etapa conversacional:

- `npm run typecheck --prefix api` — aprobado.
- `npm test --prefix api` — 30 aprobadas, 0 fallidas y 2 omitidas porque no se
  habilitaron las pruebas PostgreSQL de integración.
- `npm run typecheck --prefix mobile` — aprobado.
- Exportación Expo Web — aprobada; se eliminó el directorio temporal generado.
- Las pruebas HTTP de KIRAI usan un `ModelProvider` simulado. No validan una
  inferencia real con Ollama en esta etapa.

No se instalaron dependencias.

## 7. Limitaciones y trabajo pendiente

- La etapa actual es una consulta de un turno; no conserva ni envía historial.
- La pantalla requiere una cuenta PetCare, pero no asocia ni sincroniza los
  datos locales de la cuenta.
- La persistencia de sesión con SecureStore no se ha verificado en dispositivos
  Android o iOS en esta validación.
- No hay selector de proveedor en runtime ni adaptadores para llama.cpp u
  otros motores.
- No se implementan memoria, RAG, herramientas, moderación adicional, streaming
  ni contexto de mascotas.
- Las instrucciones del prompt no garantizan por sí solas seguridad clínica;
  se necesita evaluación veterinaria y de seguridad antes del uso por
  usuarios.
- La prueba funcional demuestra una llamada local en el entorno inspeccionado,
  no disponibilidad, rendimiento ni compatibilidad en todos los sistemas.
- Ollama local puede no estar disponible en despliegues backend remotos; el
  alojamiento/red y la estrategia de fallback requieren una decisión futura.
- El flujo Mobile y la API se han validado con un proveedor simulado; la
  disponibilidad de Ollama real depende del entorno y debe probarse por
  separado.
