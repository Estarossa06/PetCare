# Integraciones externas: estado y configuración

Esta guía distingue implementación de validación real. Los nombres de variables se pueden documentar; sus valores secretos no deben guardarse ni imprimirse.

| Servicio | Uso y configuración | Evidencia actual | Pendiente |
|---|---|---|---|
| Ollama/KIRAI | La API llama a Ollama en loopback. `KIRAI_OLLAMA_BASE_URL`, `KIRAI_OLLAMA_MODEL`, `KIRAI_OLLAMA_TIMEOUT_MS`; modelo predeterminado `qwen3:8b`. | 25-nov-2026: el smoke local real respondiÃ³; E2E sobre `petcare_test` pasÃ³ en 4,226 ms, verificando contexto, persistencia, aislamiento de propietarios y reintento idempotente. La suite API omitiÃ³ el test PostgreSQL KIRAI que requiere flag. | El despliegue debe instalar el modelo/runtime y medir memoria/GPU y lÃ­mites; no se validÃ³ un despliegue externo. Repetir la integraciÃ³n DB con el flag en una base desechable autorizada. |
| Ollama/visión | API llama a Ollama para identificar imágenes. `PET_VISION_OLLAMA_BASE_URL`, `PET_VISION_OLLAMA_MODEL`, `PET_VISION_TIMEOUT_MS`; predeterminado `qwen2.5vl:7b`. | El modelo está instalado localmente y existe evidencia histórica de inferencia con fotos reales de perro/gato. No se repitió la prueba de fotos en esta ejecución. | Revalidar calidad/latencia por build de modelo; predicción de especie/raza/edad/peso es aproximada, no diagnóstico. |
| Cloudflare R2 | API transmite archivos al bucket usando `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`; móvil no recibe acceso directo. | Hay evidencia previa de transferencias reales, SHA-256, aislamiento, retries y tombstones contra un bucket de prueba. | Confirmar en Cloudflare que el bucket está privado, token mínimo y lifecycle/borrado; nunca inferir privacidad a partir de un GET autenticado. |
| Traccar | La API usa `TRACCAR_URL` y `TRACCAR_TOKEN`. La app envÃ­a IDs numÃ©ricos y preferencias GPS a la API, nunca el token. | Pruebas automatizadas cubren URL/HTTPS, asociaciÃ³n `petcareOwnerId`, ID, coordenadas y fallos; EjecuciÃ³n 4 agrega timeout, HTTP, JSON invÃ¡lido y respuesta sin posiciones. No se conectÃ³ instancia externa ni GPS fÃ­sico. | Configurar una instancia de prueba y cuenta de mÃ­nimo privilegio, asignar `petcareOwnerId` exacto y validar con hardware real en campo. |
| PostgreSQL/Neon | API usa `DATABASE_URL`; sync remoto y KIRAI persisten por propietario. | Integraciones con fixtures están limitadas a `petcare_test`; la ejecución actual de KIRAI E2E confirmó esa base. | Staging/producción requieren verificación autorizada de configuración, historial, backups, monitoreo y ventana de despliegue. |

## KIRAI: privacidad y comportamiento

- El usuario se deriva del JWT. Las consultas de mascotas, salud, cuidados, ejecuciones, citas, eventos y recordatorios usan `owner_id` del principal.
- El móvil envía contexto local limitado de la cuenta activa para representar cambios aún no sincronizados; la API valida campos, límites y UUID, y fusiona por ID.
- Conversaciones/mensajes se persisten con propietario e ID de solicitud. Un retry debe reutilizar `requestId`; reutilizarlo con otro contenido da conflicto.
- Estados locales: pendiente, enviando, no enviado y enviado. La UI solo marca enviado después de respuesta API validada.
- Límites backend: mensaje 2,000 caracteres, historia 10 mensajes/8,000 caracteres, 10 envíos por 15 minutos por cliente de API; Ollama tiene timeout configurable hasta 300,000 ms.
- Safety prompt rechaza diagnósticos definitivos/prescripciones y KIRAI declara en UI que no reemplaza a veterinarios. Esto reduce riesgo, pero no sustituye evaluación de seguridad veterinaria del modelo.
- En errores de generación se registran `requestId`, código y etapa, no mensaje, historial, contexto, token ni respuesta del modelo.

## Requisitos de despliegue

Configura cada proveedor por entorno con credenciales separadas y privilegio mínimo. Ollama debe permanecer en loopback/red privada del backend; no exponer el puerto 11434 públicamente. R2 debe estar privado. Traccar debe usar HTTPS y no conceder al token más dispositivos de los necesarios. Ejecuta el [checklist de distribución](distribution-readiness.md) antes de firmar/publicar.
