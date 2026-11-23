# KIRAI IA — Documento de arquitectura técnica

**Proyecto:** PetCare  
**Componente:** KIRAI IA  
**Versión:** 1.0  
**Estado:** Diseño inicial

## 1. Propósito

KIRAI IA será un agente inteligente especializado en animales domésticos, integrado con PetCare.

Su objetivo será proporcionar información confiable, consultar información individual de las mascotas y asistir a sus propietarios en el cuidado y bienestar animal.

KIRAI tendrá una personalidad profesional, cercana, responsable y representada visualmente mediante una gata carey.

## 2. Decisiones arquitectónicas

| Elemento | Decisión |
|---|---|
| Motor de IA | Arquitectura híbrida |
| Modelo principal | Proveedor externo en la nube |
| Modelo alternativo | Ollama o modelo local |
| Backend | Node.js, Express y TypeScript |
| Base de datos central | Neon PostgreSQL |
| Base local | SQLite |
| Frontend | React Native, Expo y TypeScript |
| Conectividad | KIRAI requiere Internet |
| Memoria | PostgreSQL |
| Conocimiento | RAG con fuentes documentales |
| Autonomía | Consulta libre y modificaciones con confirmación |

## 3. Separación entre PetCare y KIRAI

PetCare debe seguir funcionando sin conexión y sin disponibilidad del servicio de IA.

SQLite continuará siendo la base local de la aplicación.

KIRAI será un servicio adicional que requiere conexión a Internet y utiliza el backend.

Un fallo de KIRAI no debe afectar las funciones locales de PetCare.

## 4. Motor de inteligencia artificial

Crear una abstracción independiente del proveedor.

Componentes:

- AIProvider: contrato común.
- CloudProvider: conexión con el modelo principal.
- OllamaProvider: conexión con modelos locales.
- ModelRouter: selección del proveedor disponible.
- ResponseNormalizer: normalización de respuestas.

El cambio de proveedor no debe modificar la identidad, las instrucciones, la memoria ni las herramientas del agente.

El sistema debe gestionar errores, límites de consumo, tiempos de espera y proveedores no disponibles.

No garantizar disponibilidad ilimitada de proveedores gratuitos.

## 5. Núcleo del agente

El agente estará compuesto por:

- Agent Orchestrator.
- System Instructions.
- Model Router.
- Knowledge Retriever.
- Memory Manager.
- Tool Registry.
- Safety Guard.

El orquestador coordinará la consulta, recuperación de contexto, ejecución de herramientas y generación de respuestas.

## 6. Memoria

Utilizar PostgreSQL para almacenar:

- Conversaciones.
- Mensajes.
- Resúmenes de conversaciones.
- Preferencias del propietario.
- Referencias al contexto de mascotas.
- Metadatos de interacción.

Distinguir entre información declarada por el usuario, información consultada en PetCare e información generada por KIRAI.

No guardar automáticamente las respuestas del modelo como hechos confirmados.

Permitir consultar y eliminar conversaciones y administrar las preferencias de memoria.

## 7. Conocimiento especializado

Implementar recuperación aumentada por generación (RAG).

La base documental contemplará:

- Medicina preventiva.
- Nutrición.
- Comportamiento.
- Higiene.
- Enfermedades.
- Síntomas.
- Primeros auxilios.
- Cuidados por especie.
- Señales de urgencia.

Cada fuente deberá registrar procedencia, fecha de publicación cuando esté disponible, fecha de revisión y nivel de confiabilidad.

KIRAI debe diferenciar información respaldada, orientación general e información que no puede confirmar.

## 8. Integración con PetCare

Crear herramientas controladas para consultar:

- Mascotas.
- Historial médico.
- Vacunas y desparasitaciones.
- Cuidados y rutinas.
- Calendario.
- Recordatorios.

La consulta debe respetar el propietario autenticado y los permisos correspondientes.

### Consideración sobre SQLite

Los datos locales de SQLite no estarán automáticamente disponibles en PostgreSQL.

En la primera implementación, la aplicación deberá enviar al backend únicamente el contexto de la mascota seleccionado y necesario para responder.

Ese contexto se transmitirá de forma segura, con autorización del propietario y minimización de datos.

No se debe asumir que existe sincronización remota de mascotas o historiales.

En una etapa posterior se evaluará qué información puede sincronizarse centralmente.

## 9. Sistema de acciones

KIRAI podrá consultar información sin solicitar confirmación individual para cada lectura, siempre que el propietario haya autorizado el acceso.

Las modificaciones requerirán confirmación explícita.

Ejemplos:

- Crear recordatorios.
- Modificar actividades.
- Actualizar información de mascotas.
- Registrar información médica.

El backend deberá validar nuevamente cada acción antes de ejecutarla.

La confirmación debe estar vinculada a la operación concreta y no depender exclusivamente de instrucciones generadas por el modelo.

## 10. Seguridad y privacidad

- Autenticación obligatoria.
- Aislamiento por propietario.
- Protección de credenciales y claves API.
- Comunicación cifrada.
- Validación de entradas.
- Control de permisos.
- Registro de operaciones.
- Minimización de información médica.
- Consentimiento para transmitir datos al servicio de IA.

KIRAI no reemplazará a un veterinario, no emitirá diagnósticos definitivos y deberá reconocer situaciones que requieran atención profesional.

## 11. Estructura del backend

api/src/modules/kirai/

- core/
- providers/
- memory/
- knowledge/
- tools/
- safety/
- routes/

La estructura podrá evolucionar conforme se implementen los componentes.

## 12. Etapas de implementación

1. Inspección de arquitectura y diseño de contratos.
2. Conexión con el primer modelo.
3. Construcción del núcleo del agente.
4. Identidad e instrucciones.
5. Memoria y conversaciones.
6. Conocimiento especializado mediante RAG.
7. Integración con PetCare.
8. Chat y avatar interactivo.
9. Evaluación y pruebas de seguridad.

Cada etapa deberá contar con pruebas y documentación antes de avanzar.

## 13. Restricciones iniciales

- No entrenar modelos desde cero.
- No conectar la aplicación directamente con proveedores de IA.
- No exponer claves API en el frontend.
- No permitir acceso irrestricto a PostgreSQL.
- No asumir que los datos SQLite están sincronizados.
- No permitir modificaciones sin confirmación.
- No implementar diagnósticos veterinarios automáticos.
- No introducir dependencias nativas sin justificación.

**Principio arquitectónico:** la identidad, memoria, conocimiento, herramientas y reglas de KIRAI pertenecen a PetCare; el modelo de IA es un componente reemplazable.