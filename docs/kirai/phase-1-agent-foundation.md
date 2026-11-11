# KIRAI — Fase 1: identidad y estructura inicial del agente

**Estado:** fundamento de código implementado; no conectado a un modelo ni a
la API pública.
**Alcance:** identidad, instrucciones iniciales, reglas de seguridad,
contratos TypeScript y una interfaz neutral de proveedor. Esta fase no
implementa inferencia.

## 1. Identidad de KIRAI

- **Nombre:** KIRAI.
- **Idioma predeterminado:** español.
- **Personalidad:** profesional, cercana, empática y educativa.
- **Comunicación:** clara, precisa y concisa, evitando explicaciones
  innecesariamente extensas.
- **Especialización:** animales domésticos de distintas especies.
- **Temas:** prevención, salud, nutrición, comportamiento, higiene y bienestar
  animal.

La identidad está definida en
[`api/src/modules/kirai/core/identity.ts`](../../api/src/modules/kirai/core/identity.ts)
y se incorpora a un mensaje de sistema mediante
[`api/src/modules/kirai/prompts/system.ts`](../../api/src/modules/kirai/prompts/system.ts).

## 2. Reglas de comportamiento y seguridad

Las reglas iniciales, definidas en
[`api/src/modules/kirai/safety/rules.ts`](../../api/src/modules/kirai/safety/rules.ts),
indican al agente:

1. No presentar diagnósticos veterinarios como definitivos.
2. No prescribir medicamentos, dosis ni cambios de tratamiento.
3. Reconocer explícitamente la incertidumbre o información faltante y hacer
   preguntas relevantes cuando sea necesario.
4. Recomendar atención veterinaria urgente ante señales de alarma.
5. Diferenciar información general de orientación apoyada en datos aportados
   explícitamente por la persona.
6. No inventar información ni fuentes, ni afirmar acceso a historiales que no
   estén disponibles en el contexto.
7. Responder en español y no mostrar razonamientos internos privados.

Son instrucciones iniciales para un futuro modelo, no una garantía de que un
modelo las cumpla. Antes de exposición a usuarios se requiere evaluación de
seguridad veterinaria y validación de salidas.

## 3. Estructura implementada

```text
api/src/modules/kirai/
├── core/
│   └── identity.ts
├── prompts/
│   └── system.ts
├── providers/
│   └── model-provider.ts
├── safety/
│   └── rules.ts
└── types/
    └── agent.ts
```

### Responsabilidades

- `core/`: identidad estable y lógica del agente independiente de transporte y
  proveedor. Por ahora solo se define la identidad.
- `prompts/`: construye el mensaje de sistema inicial combinando identidad y
  reglas; no llama a modelos ni procesa conversación.
- `providers/`: define `ModelProvider.generate()` sobre contratos neutrales.
  No contiene implementaciones de Ollama, llama.cpp u otros proveedores.
- `safety/`: reglas iniciales de comportamiento y seguridad.
- `types/`: tipos comunes de identidad, mensajes, solicitud y respuesta del
  modelo.

La interfaz del proveedor acepta mensajes y opciones opcionales de generación.
Permite implementar adaptadores intercambiables posteriormente sin acoplar la
identidad de KIRAI a una SDK. No afirma compatibilidad probada con una versión
particular de Ollama o llama.cpp; esa compatibilidad se validará al crear cada
adaptador.

## 4. Integración con la arquitectura existente

La API actual ya cuenta con Express, configuración, middleware de request,
autenticación y módulo `api/src/modules/auth/`. Esta fase no altera dichos
componentes. KIRAI no se registra en `api/src/app.ts`, no añade endpoints y no
depende del `Principal`, PostgreSQL ni SQLite.

Aunque PostgreSQL contiene tablas preliminares para conversaciones y mensajes,
el módulo nuevo no las consulta ni las modifica. No se implementa acceso al
perfil de una mascota, importación de datos, sincronización, memoria,
recuperación documental ni herramientas de lectura/escritura.

## 5. Qué está implementado

- Estructura del módulo KIRAI por responsabilidad.
- Identidad de KIRAI como valor TypeScript tipado.
- Reglas iniciales de comportamiento.
- Constructor de mensaje de sistema en español.
- Contratos neutrales de mensajes, solicitudes/respuestas y proveedor.
- Compatibilidad de compilación con la configuración TypeScript actual de la
  API.

No se instalaron dependencias ni se modificaron las existentes.

## 6. Qué queda pendiente

- Evaluación de seguridad y calidad veterinaria por especie, incluyendo
  situaciones de urgencia.
- Implementaciones y pruebas de proveedores Ollama y llama.cpp; selección de
  modelos, licencias, recursos y estrategia de despliegue.
- Manejo de timeout, cancelación, límites de salida, errores, disponibilidad y
  observabilidad sin registrar información sensible.
- Diseño y autorización de endpoints, límites de uso y política de privacidad.
- Decisiones de consentimiento y contexto mínimo si en el futuro se habilita
  acceso a datos de mascotas.
- Memoria, RAG, herramientas, persistencia de conversaciones e interfaz de
  usuario, que permanecen fuera de esta fase.

No se afirma que la identidad o las reglas hagan al agente seguro sin pruebas,
ni que el agente tenga acceso a datos o fuentes veterinarias.

## 7. Validación

Se deben ejecutar desde `api/`:

- `npm run typecheck`
- `npm test`
- `npm run build`

El módulo no realiza I/O ni requiere servicios externos; estas verificaciones
no se conectan a Neon ni a SQLite.
