# PetCare Web en Render Staging

## Alcance

El servicio `petcare-web-staging` es un sitio estático independiente de la API.
Su `EXPO_PUBLIC_API_URL` apunta a la API de staging y no incluye credenciales.
El servicio se define con despliegue automático desactivado: crear o sincronizar
el Blueprint no debe usarse como sustituto de la revisión previa al despliegue.

## Configuración del sitio

La definición ejecutable está en `render.yaml`:

- Tipo/runtime: `web` / `static`.
- Root directory: `mobile`.
- Build command: `npm ci && npx expo export --platform web`.
- Publish directory, relativa a `mobile`: `dist`.
- Variable pública de build: `EXPO_PUBLIC_API_URL`, URL HTTPS conocida de la
  API PetCare staging. No poner secretos en variables `EXPO_PUBLIC_*`.
- Rewrite SPA: `/*` a `/index.html`.
- Headers globales: `Cross-Origin-Opener-Policy: same-origin` y
  `Cross-Origin-Embedder-Policy: credentialless` para SQLite WASM.
- TLS/HTTPS: proporcionado por Render para el subdominio del sitio.

El nombre `petcare-web-staging` es una propuesta de recurso. Render asignará
el hostname al crear el Static Site; no se inventa ni se presupone aquí.

## CORS de la API

Después de que Render asigne el hostname HTTPS real:

1. En variables del servicio API `petcare-api-staging`, configura
   `CORS_ORIGINS` con el origen exacto, por ejemplo el formato
   `https://<hostname-real-asignado>` sin ruta ni barra final. Sustituye el
   marcador; no lo guardes literalmente.
2. No uses `*`: el middleware permite únicamente coincidencia exacta y la
   aplicación envía `Authorization` y `Content-Type` en preflight.
3. Reinicia o redepliega la API staging mediante el flujo aprobado y verifica
   un `OPTIONS` desde el origen real. Este documento no cambia variables de
   Render ni realiza un despliegue.

El código de API permite `GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS` y
autoriza los headers de autenticación y transferencia que usa el cliente.
La respuesta CORS del origen final sigue pendiente hasta tener el hostname.

## Variables y separación de entornos

`EXPO_PUBLIC_API_URL` es visible en el bundle del navegador. El valor del
Static Site se fija a staging en `render.yaml`; no se debe reutilizar el
artefacto local exportado, que puede tomar valores de `.env.local`. El API
mantiene sus credenciales en variables privadas de su propio servicio.

## Persistencia y seguridad del navegador

- SQLite usa el WASM incluido por `expo-sqlite`, corre migraciones locales y
  recupera colas que quedaron `in_flight` al inicializar el cliente.
- PetCare guarda archivos en IndexedDB. Tanto SQLite como IndexedDB pertenecen
  al origen, están sujetos a cuotas/evicción y no son un backup remoto.
- El navegador no obtiene cifrado SQLCipher por usar SQLite WASM. No usar
  cuentas/datos reales o sensibles para una demostración pública.
- Los tokens Web permanecen en `sessionStorage` (no `localStorage`); siguen
  accesibles a JavaScript del mismo origen. Proteger el frontend contra XSS y
  cerrar sesión al terminar una demostración.
- Las notificaciones locales no están soportadas en Web. No hay manifest PWA,
  service worker ni shell offline; este servicio es una SPA web, no una PWA.

## Validación de publicación

Después de crear el servicio, pero antes de habilitar despliegue automático,
comprobar desde un navegador real:

1. HTTPS, headers COOP/COEP y `crossOriginIsolated === true`.
2. Carga del WASM, apertura de `petcare.db`, aplicación de migraciones y una
   recarga conservando una escritura local de prueba.
3. Preflight CORS y registro/login/logout/restauración de sesión.
4. Separación entre dos cuentas, CRUD/sincronización de mascotas y datos de
   calendario, KIRAI y subida/descarga de archivos según los servicios staging
   configurados.
5. Recarga directa de rutas, responsive design y recuperación ante
   desconexión, cuota llena o almacenamiento bloqueado.

Una exportación exitosa solo valida el bundle; no demuestra estos recorridos.
