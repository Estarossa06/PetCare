# PetCare

Aplicación móvil Expo para gestionar mascotas, historial de salud, cuidados y calendario. El cliente conserva datos por cuenta en SQLite; cuando hay conexión, la API autenticada sincroniza entidades y archivos con PostgreSQL y almacenamiento privado R2.

## Arquitectura actual

```text
Android / iOS / Web
   ├─ SQLite por cuenta, archivos locales y outbox
   └─ HTTPS → API PetCare → PostgreSQL
                         ├─ Ollama local: KIRAI y sugerencias visuales
                         ├─ Cloudflare R2 privado: medios
                         └─ Traccar: ubicación GPS (configuración externa)
```

El móvil no recibe credenciales PostgreSQL, Ollama, Traccar ni R2. `EXPO_PUBLIC_API_URL` es pública y se incorpora al bundle. Las notificaciones de calendario se programan localmente en cada dispositivo.

## Estado por función

| Función | Estado del código | Evidencia y límite |
|---|---|---|
| Autenticación, sesión y guards | Implementados | API y pruebas de rutas; restaurar sesión requiere acceso a la API para renovar tokens. |
| Mascotas y entidades de dominio | SQLite offline-first y protocolo push/pull implementados | Pruebas API/PostgreSQL y SQLite; completar piloto en dos dispositivos físicos. |
| Fotografías y adjuntos | Cola local y transferencias API→R2 implementadas | Hay evidencia de integración R2 real previa; bucket privado debe confirmarse en el panel de Cloudflare. |
| KIRAI | Chat persistente, contexto owner-scoped, reintentos idempotentes y Ollama implementados | Smoke real de Ollama y E2E con `petcare_test` pasan en este entorno; respuestas no son diagnósticos veterinarios. |
| Identificación visual | API usa Ollama y validación de imagen | `qwen2.5vl:7b` está instalado localmente; la precisión es orientativa, no diagnóstico. |
| GPS/Traccar | API autenticada, vínculo mascota/dispositivo y consulta de posición | Cliente ahora exige el atributo de Traccar `petcareOwnerId` que coincida con el usuario autenticado. Sin instancia y dispositivo asignado no hay integración física validada. |
| Notificaciones | Programación/reconciliación local | Lógica automatizada probada; falta verificar entrega del sistema operativo en Android/iOS físicos. |
| Web | Exportación Expo disponible | No es una PWA: no hay manifest instalable ni service worker/offline shell. |

Consulta [límites de operación móvil](docs/backend/mobile-operation-boundaries.md), [estado actual](docs/audits/petcare-current-status.md), [configuración de entornos](docs/deployment/environment-configuration.md), [integraciones externas](docs/deployment/external-integrations.md) y [checklists físicos](docs/testing/mobile-physical-validation.md).

### Funciones del producto

- Perfiles de mascotas con historial de salud: consultas, vacunas, desparasitación, medicamentos, tratamientos, cirugías, alergias y exámenes.
- Rutinas recurrentes, calendario y recordatorios locales.
- Persistencia offline por cuenta y sincronización de cambios cuando la API está disponible.
- Conversaciones KIRAI persistidas y aisladas por propietario. Su contexto autorizado no convierte sus respuestas en diagnóstico ni reemplaza atención veterinaria profesional.

### Tecnologías y límites de confianza

El cliente usa React Native, Expo, Expo Router, TypeScript, SQLite, SecureStore y notificaciones locales. La API usa Node.js, Express, TypeScript y PostgreSQL; las operaciones remotas y el acceso a integraciones pasan por ella. Ollama ejecuta los modelos configurados en el entorno del backend; R2 conserva medios privados y Traccar aporta ubicaciones solo cuando se configura una instancia y dispositivo reales.

La API autentica y limita los datos al usuario propietario. Contraseñas y tokens se gestionan en el backend; credenciales de base de datos, Ollama, Traccar y R2 nunca pertenecen al bundle móvil/web. Solo las variables `EXPO_PUBLIC_*` son públicas y deben tratarse como código descargable.

La estructura y responsabilidades de módulos están descritas en [project-structure.md](docs/architecture/project-structure.md); el modelo de entidades en [data-model.md](docs/data-model.md), y las decisiones multiplataforma en [multiplatform-architecture.md](docs/multiplatform-architecture.md).

## Configuración local

Requisitos: Node.js compatible con Expo/TypeScript del lockfile, npm, PostgreSQL de desarrollo/pruebas, y Ollama si se ejecutan funciones de IA localmente.

1. Instala dependencias dentro de `api/` y `mobile/` con `npm ci`.
2. Copia `api/.env.example` a `api/.env` y completa valores locales. Nunca copies secretos a `mobile/.env` ni los imprimas.
3. Configura `EXPO_PUBLIC_API_URL` en el entorno del cliente. En un teléfono debe ser una URL del equipo alcanzable desde la red del dispositivo; usa HTTPS fuera de desarrollo local.
4. Configura y verifica la base antes de cualquier migración. Las pruebas PostgreSQL destructivas se limitan a una base desechable cuyo nombre exacto sea `petcare_test`.
5. Para KIRAI se requiere Ollama disponible en el backend y el modelo definido por `KIRAI_OLLAMA_MODEL` (por defecto `qwen3:8b`). La identificación visual usa `PET_VISION_OLLAMA_MODEL` (por defecto `qwen2.5vl:7b`).

Variables, valores por defecto y límites están listados por nombre en [environment-configuration.md](docs/deployment/environment-configuration.md) y `api/.env.example`; allí no deben añadirse secretos reales.

## Scripts

Desde `api/`:

```sh
npm run dev
npm run typecheck
npm run build
npm test
npm run test:migration-lineage
npm run db:migrate:status
```

`npm run db:migrate` es una operación de escritura: confirma base, historial y respaldo antes de usarlo. No existe un script raíz de monorepo.

Desde `mobile/`:

```sh
npm run start
npm run android
npm run ios
npm run web
npm run typecheck
npm test
```

Exportación Web estática: `npx expo export --platform web`. El resultado solo es un bundle web; no aporta instalación PWA, service worker, hosting, monitorización ni validación física.

## Preparación de distribución

Los identificadores están definidos como `com.petcare.mobile`. No hay `eas.json`, perfiles de EAS ni artefactos firmados en el repositorio. La primera publicación contempla Android y Web; iOS queda fuera de este alcance. Aún se requieren firma y revisión de permisos Android, hosting HTTPS con headers COOP/COEP para Web, política de privacidad/retención, monitorización de API/DB/Ollama/R2/Traccar y smoke tests de cada artefacto. No se afirma preparación para producción hasta completar esos pasos.

## Documentación

- `docs/sync/phase-4-audit.md` es un diagnóstico histórico y fue superado por la implementación de sync descrita en `docs/backend/mobile-operation-boundaries.md`.
- Arquitectura, migraciones, medios, cuenta y KIRAI están documentados en `docs/`.
- SBOM npm y auditorías de vulnerabilidades están en `docs/audits/`; el BOM separado de modelos lista artifacts externos a npm.
- El estado de la candidata y el manifiesto de release están en [`docs/deployment/release-manifest.md`](docs/deployment/release-manifest.md).
