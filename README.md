# PetCare

**Plataforma multiplataforma para la gestión integral del cuidado de animales domésticos.**

PetCare es un proyecto de ingeniería de software orientado a centralizar la información y el seguimiento del cuidado de animales domésticos. Permite gestionar mascotas, historiales médicos, rutinas de cuidado, citas y recordatorios desde una aplicación multiplataforma.

El proyecto utiliza una arquitectura *offline-first*, que permite realizar operaciones sobre los datos localmente y contempla su posterior sincronización con un servidor central.

Además, incorpora el desarrollo de **KIRAI**, un asistente de inteligencia artificial especializado en el cuidado de animales domésticos, diseñado para proporcionar orientación informativa y acompañamiento a los usuarios.

---

## Características principales

- **Gestión de mascotas:** registro, consulta, edición y eliminación de perfiles.
- **Historial médico:** organización de consultas, vacunas, desparasitaciones, medicamentos, tratamientos, cirugías, alergias, diagnósticos y exámenes.
- **Rutinas de cuidado:** administración de actividades recurrentes y seguimiento de su ejecución.
- **Calendario:** visualización y organización de eventos, citas y actividades.
- **Recordatorios:** programación de notificaciones para actividades importantes.
- **Persistencia local:** almacenamiento mediante SQLite para permitir el funcionamiento sin conexión.
- **Sincronización:** arquitectura diseñada para sincronizar los datos locales con el servidor.
- **KIRAI:** asistente de inteligencia artificial especializado en animales domésticos.

## Arquitectura del sistema

PetCare utiliza una arquitectura cliente-servidor compuesta por un cliente multiplataforma y un servicio API independiente.

```text
                         PETCARE
                            |
             +--------------+--------------+
             |                             |
       Cliente Expo                     API REST
             |                             |
      +------+------+               +------+------+
      |             |               |             |
   Android / iOS   Web         Autenticación   Lógica de
      |             |               |           negocio
      +------+------+               |             |
             |                      |           KIRAI
          SQLite                    |             |
             |                      +------+------+
      Cola de sincronización                |
             |                         PostgreSQL
             +-----------------------------|
                                          Neon
```

### Cliente multiplataforma

Una única aplicación desarrollada con React Native, Expo, Expo Router y TypeScript permite construir las versiones de Android, iOS y Web.

Las pantallas, la navegación y la lógica de negocio se comparten entre plataformas. Las diferencias específicas de cada sistema se aíslan mediante adaptadores.

### Backend

El backend centraliza la autenticación, las operaciones remotas, las reglas de negocio y el acceso a la base de datos.

El cliente móvil y web no se conecta directamente a PostgreSQL. Todas las operaciones remotas se realizan mediante la API.

### Persistencia de datos

PetCare utiliza dos niveles de persistencia:

| Componente | Tecnología | Responsabilidad |
|---|---|---|
| Base de datos local | SQLite | Persistencia y operaciones sin conexión. |
| Base de datos central | PostgreSQL (Neon) | Almacenamiento remoto y centralizado. |
| Servicio de acceso | Node.js + Express | Comunicación con la base de datos central. |

La estrategia *offline-first* utiliza almacenamiento local y una cola de operaciones pendientes para preparar la sincronización posterior.

**Estado actual:** la arquitectura de sincronización está diseñada, pero su implementación integral todavía está pendiente. Los cambios locales no se sincronizan automáticamente con Neon en esta etapa.

## Tecnologías utilizadas

### Aplicación cliente

- React Native
- Expo
- Expo Router
- TypeScript
- SQLite
- Expo Notifications
- Expo SecureStore

### Backend

- Node.js
- Express
- TypeScript
- PostgreSQL
- Neon
- JSON Web Tokens (JWT)
- Scrypt para el almacenamiento seguro de contraseñas

### Inteligencia artificial

- Ollama
- Qwen3 8B como modelo local de prueba
- Arquitectura independiente del proveedor de modelos
- Contrato común para la comunicación con modelos de lenguaje
- Reglas de seguridad y comportamiento del asistente

### Herramientas de desarrollo

- Visual Studio Code
- Git
- GitHub
- npm
- Expo Go

## KIRAI — Asistente de inteligencia artificial

KIRAI es el componente de inteligencia artificial de PetCare. Su propósito es proporcionar orientación informativa sobre el cuidado de animales domésticos mediante una interfaz conversacional.

Su arquitectura contempla:

- Identidad y personalidad propias.
- Instrucciones de comportamiento centralizadas.
- Reglas de seguridad para evitar diagnósticos definitivos y recomendaciones médicas irresponsables.
- Integración mediante proveedores intercambiables de modelos de lenguaje.
- Ejecución local mediante Ollama durante la etapa inicial.

### Estado de desarrollo

| Fase | Descripción | Estado |
|---|---|---|
| 1 | Fundamentos del agente, identidad, instrucciones y seguridad. | Completada |
| 2 | Integración del proveedor Ollama y pruebas con Qwen3 8B. | Completada |
| 3 | Orquestador conversacional y gestión de contexto. | Pendiente |
| 4 | Memoria persistente y contexto del usuario. | Pendiente |
| 5 | Recuperación de información y herramientas controladas. | Pendiente |
| 6 | Integración progresiva con los datos de PetCare. | Pendiente |

El desarrollo de KIRAI busca mantener separada la lógica del agente de la implementación específica del modelo utilizado.

Documentación: `docs/kirai/`

## Estructura del proyecto

```text
PetCare/
│
├── mobile/                  # Aplicación multiplataforma
│   ├── app/                 # Rutas y pantallas Expo Router
│   ├── components/          # Componentes reutilizables
│   └── ...
│
├── api/                     # Backend Node.js + Express
│   ├── src/
│   │   └── modules/
│   │       └── kirai/       # Módulo de inteligencia artificial
│   ├── migrations/          # Migraciones PostgreSQL
│   └── ...
│
├── docs/
│   ├── architecture/        # Decisiones de arquitectura
│   ├── kirai/               # Documentación de KIRAI
│   ├── sync/                # Diseño de sincronización
│   └── ...
│
└── README.md
```

La estructura representa la organización general del proyecto y puede evolucionar conforme avance su implementación.

## Configuración del entorno

### Requisitos previos

- Node.js y npm.
- Git.
- Expo CLI mediante `npx`.
- Una instancia PostgreSQL o una base de datos Neon para el backend.
- Ollama, si se desea ejecutar KIRAI localmente.

### 1. Clonar el repositorio

```bash
git clone https://github.com/Estarossa06/PetCare.git
cd PetCare
```

### 2. Configurar el backend

```bash
cd api
npm install
```

Crear el archivo `api/.env` con las variables necesarias:

```env
NODE_ENV=development
PORT=3000
HOST=127.0.0.1

DATABASE_URL=tu_conexion_postgresql

AUTH_ACCESS_TOKEN_SECRET=tu_secreto_seguro

CORS_ORIGINS=http://localhost:8081
```

Los valores son ejemplos de configuración y deben ajustarse al entorno de ejecución.

**Consideraciones de seguridad:**

- No subir archivos `.env` al repositorio.
- No incluir credenciales de Neon en la aplicación móvil.
- Utilizar secretos diferentes para desarrollo y producción.
- Mantener las claves de proveedores de inteligencia artificial exclusivamente en el backend.

### 3. Ejecutar las migraciones

Desde el directorio `api/`:

```bash
npm run db:migrate:status
npm run db:migrate
```

La variable `DATABASE_URL` debe estar configurada antes de ejecutar estos comandos.

### 4. Configurar la aplicación móvil

```bash
cd mobile
npm install
npx expo start
```

Desde Expo se puede iniciar el entorno de desarrollo y seleccionar la plataforma disponible.

La URL de la API debe configurarse mediante la variable correspondiente al entorno del cliente:

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

En dispositivos físicos, `localhost` debe sustituirse por la dirección IP local del equipo que ejecuta la API.

## Estado actual del desarrollo

PetCare se desarrolla de manera incremental. Las funcionalidades se implementan y verifican por etapas.

| Componente | Estado |
|---|---|
| Arquitectura general | Definida |
| Interfaz y navegación multiplataforma | Implementadas inicialmente |
| Gestión de mascotas | Implementada con persistencia local |
| Historial médico | Implementado con persistencia local |
| Rutinas de cuidado | Implementadas inicialmente |
| Calendario y recordatorios | Implementados inicialmente |
| Persistencia SQLite | Implementada y verificada en Web y Android |
| Backend Express | Implementado inicialmente |
| Autenticación | Implementada inicialmente |
| Migraciones PostgreSQL | Implementadas parcialmente |
| Sincronización local-remota | Diseño aprobado; implementación pendiente |
| KIRAI — fundamentos | Completados |
| KIRAI — proveedor Ollama | Integrado y probado |
| KIRAI — orquestador conversacional | Pendiente |

### Validaciones pendientes

- Validación nativa completa en iOS.
- Verificación de notificaciones en dispositivos físicos.
- Validación del alojamiento Web con las cabeceras de aislamiento requeridas.
- Finalización y verificación de las migraciones pendientes en Neon.
- Implementación y pruebas integrales del sistema de sincronización.
- Integración progresiva de KIRAI con el contexto y los datos de PetCare.

**Nota:** la ruta de entrada actual de Expo Router conserva temporalmente un entorno de verificación de SQLite. No representa todavía la pantalla definitiva de inicio del producto.

## Documentación técnica

La documentación se mantiene separada del código fuente para facilitar su consulta y evolución.

| Documento | Descripción |
|---|---|
| `docs/database-setup.md` | Configuración de las bases de datos. |
| `docs/data-model.md` | Modelo de datos. |
| `docs/multiplatform-architecture.md` | Arquitectura multiplataforma. |
| `docs/persistence-phase-2.md` | Alcance de la segunda fase de persistencia. |
| `docs/persistence-verification.md` | Informe de verificación de persistencia. |
| `docs/architecture/database-decision.md` | Decisiones sobre la arquitectura de bases de datos. |
| `docs/architecture/environment-configuration.md` | Configuración de entornos. |
| `docs/kirai/` | Documentación del desarrollo de KIRAI. |
| `docs/sync/` | Diseño y planificación de sincronización. |

## Seguridad

- La API es el único componente autorizado para acceder a Neon.
- Las operaciones remotas deben estar autenticadas y restringidas al propietario de los datos.
- Las contraseñas se almacenan mediante funciones de derivación seguras.
- Los tokens de actualización se gestionan mediante rotación.
- Las credenciales y secretos no deben almacenarse en el cliente ni publicarse en Git.
- KIRAI debe respetar sus límites de seguridad y no sustituir la valoración de un profesional veterinario.

## Objetivo del proyecto

Construir una plataforma escalable y multiplataforma que facilite la administración del cuidado de animales domésticos, integrando persistencia *offline-first*, sincronización de información y asistencia mediante inteligencia artificial.

PetCare se desarrolla de forma incremental, priorizando la comprensión de cada componente, la validación técnica y la documentación de las decisiones de arquitectura.