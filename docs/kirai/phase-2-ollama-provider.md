# KIRAI — Fase 2: proveedor local Ollama

**Estado:** adaptador y prueba funcional implementados.
**Proveedor inicial:** Ollama por HTTP local.
**Modelo predeterminado:** `qwen3:8b`.
**Alcance:** generación de una respuesta; sin endpoints, memoria, RAG ni
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

- `api/src/config/kiraiOllama.ts`: variables, valores por defecto y
  validación de configuración local.
- `api/src/modules/kirai/providers/model-provider.ts`: contrato común,
  ampliado para soportar `AbortSignal`.
- `api/src/modules/kirai/providers/ollamaProvider.ts`: adaptador HTTP,
  extracción de respuesta final y errores sanitizados.
- `api/src/modules/kirai/providers/test-ollama.ts`: prueba manual separada del
  arranque Express.
- `api/test/kirai.test.ts`: pruebas automáticas con fetch simulado.

No se modifica el módulo Express, las rutas de autenticación ni la identidad
ni las reglas de KIRAI. No se conecta a Neon o SQLite ni se envía contexto de
mascotas.

## 2. Configuración

El adaptador lee estas variables opcionales:

| Variable | Predeterminado | Validación |
|---|---|---|
| `KIRAI_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | HTTP y host loopback únicamente; sin credenciales/ruta/query/fragment. |
| `KIRAI_OLLAMA_MODEL` | `qwen3:8b` | Nombre no vacío, sin espacios y de hasta 120 caracteres. |
| `KIRAI_OLLAMA_TIMEOUT_MS` | `60000` | Entero entre 1 y 300000 ms. |

No se requieren credenciales. No se añadió ninguna variable `EXPO_PUBLIC_*`.
El adaptador no se instancia durante el arranque normal de Express; configurar
Ollama no habilita por sí solo un endpoint.

El proceso de prueba manual importa `dotenv/config`, de modo que puede usar
las variables del entorno o el archivo local ignorado de API cuando se ejecuta
con el directorio de trabajo `api/`. No guardar secretos en configuración de
Ollama ni habilitar el servicio en una interfaz de red pública.

## 3. Respuestas y errores

- Envía los roles y contenidos del contrato `ModelRequest`, incluyendo el
  mensaje de sistema ya construido.
- Solicita una única respuesta no streaming.
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

La suite está incluida en `npm test --prefix api`.

## 6. Validación ejecutada

- `npm run typecheck --prefix api` — aprobado.
- `npm test --prefix api` — aprobado, 22/22 pruebas.
- `npm run build --prefix api` — aprobado.
- `npm run kirai:ollama:test --prefix api` — aprobado contra Ollama local y
  `qwen3:8b` ya instalado.

No se instalaron dependencias.

## 7. Limitaciones y trabajo pendiente

- KIRAI no está expuesta mediante un endpoint y no está conectada a Express.
- No hay selector de proveedor en runtime ni adaptadores para llama.cpp u
  otros motores.
- No se implementan memoria, RAG, herramientas, historial de conversación,
  moderación adicional, streaming ni contexto de mascotas.
- Las instrucciones del prompt no garantizan por sí solas seguridad clínica;
  se necesita evaluación veterinaria y de seguridad antes del uso por
  usuarios.
- La prueba funcional demuestra una llamada local en el entorno inspeccionado,
  no disponibilidad, rendimiento ni compatibilidad en todos los sistemas.
- Ollama local puede no estar disponible en despliegues backend remotos; el
  alojamiento/red y la estrategia de fallback requieren una decisión futura.

No comenzar otra fase hasta recibir autorización.
