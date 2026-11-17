# Estructura arquitectónica de PetCare

## Principios

- `mobile/app/` declara exclusivamente rutas Expo Router; las pantallas y el comportamiento de cada dominio viven fuera del árbol de rutas.
- Las funcionalidades móviles implementadas se agrupan por dominio en `mobile/src/features/`.
- `mobile/src/components/ui/`, `mobile/src/navigation/` y `mobile/src/theme/` contienen recursos compartidos.
- `mobile/src/db/` conserva la persistencia SQLite y sus migraciones locales.
- `api/src/app.ts` compone la aplicación; configuración global, middleware común, base de datos y observabilidad permanecen en sus áreas transversales.
- Cada módulo de API implementado vive en `api/src/modules/` y separa rutas, controladores, servicios, repositorios, validaciones y tipos según las responsabilidades que ya existen.
- Las migraciones PostgreSQL se conservan en `api/src/db/migrations/`; su contenido y orden son inmutables durante la reorganización.
- No se crean carpetas o archivos para módulos de API sin funcionalidad implementada.

## Estructura objetivo

```text
api/
  src/
    app.ts
    server.ts
    config/                 Configuración global del proceso
    db/                     Pool, verificación y migraciones PostgreSQL
    middleware/             Middleware HTTP compartido
    modules/
      auth/                 Autenticación y middleware de autenticación
      kirai/                Configuración, identidad, seguridad y proveedor
      pets/                 CRUD de mascotas y aislamiento por propietario
      system/               Health y readiness
    observability/           Logger
  test/                     Pruebas API y adaptadores de prueba

mobile/
  app/                      Rutas Expo Router estables
  src/
    features/
      auth/                  Cliente, proveedor, tokens y screens/AuthScreen
      calendar/              Repositorio, servicio, tipos y screens/
      care/                  Repositorio, servicio, recurrencia y screens/
      dashboard/             screens/ y estilos de la pantalla de inicio
      medical/               Repositorio, servicio, adjuntos, tipos y screens/
      pets/                  Repositorio, servicio, fotos, tipos y screens/
      previews/              screens/ y estilos demostrativos transversales
      profile/               screens/
    components/ui/           Componentes visuales compartidos
    db/                      SQLite, acceso local y migraciones
    devtools/                Pantallas y utilidades de verificación
    navigation/              Navegación compartida
    theme/                   Tokens visuales

docs/
  architecture/              Decisiones y estructura del sistema
  backend/                   API y autenticación
  deployment/                Configuración de despliegue
  kirai/                     Documentación de KIRAI
  sync/                      Diseño y verificaciones de sincronización
  audits/                    Informes de auditoría
```

## Límites de implementación

La aplicación móvil ya cuenta con módulos locales para mascotas, historial médico, cuidado y calendario. El backend implementa autenticación, mascotas, KIRAI y endpoints de sistema; aún no implementa módulos API de historial médico, rutinas, calendario ni sincronización. La organización refleja lo existente y no agrega scaffolding vacío.

La pestaña móvil del asistente continúa siendo una vista demostrativa transversal; no existe todavía un módulo conversacional KIRAI en el cliente. El reordenamiento conserva los nombres de ruta de Expo Router, el contrato de las pantallas, la lógica de negocio, las adaptaciones por plataforma y el contenido de todas las migraciones.
