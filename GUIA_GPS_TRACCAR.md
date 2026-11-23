# PetCare — módulo GPS 4G / Traccar (fase inicial)

Se conservaron las funciones anteriores. Se añadió una pantalla **Rastreo GPS** en el perfil de cada mascota y una API autenticada con asociación mascota–dispositivo y zona segura.

## Preparación
1. En `api`, configura PostgreSQL y ejecuta las migraciones del proyecto (`npm run` para consultar los scripts). La migración 0005 crea `pet_trackers`.
2. Configura en el **servidor API** las variables `TRACCAR_URL=https://tu-servidor-traccar` y `TRACCAR_TOKEN=token-de-api-traccar`. No pongas el token en Expo ni en el repositorio.
3. En Traccar registra el dispositivo físico o el teléfono de pruebas; usa su **ID numérico interno de Traccar** (no IMEI) en PetCare.
4. El collar debe ser GPS real con SIM de datos y protocolo soportado por Traccar, configurable para enviar a tu servidor. Confirma modelo, bandas 4G colombianas y puerto/protocolo antes de comprar.
5. En PetCare abre una mascota > Rastreo GPS, introduce el ID, radio 100–1000 m y, opcionalmente, latitud/longitud del centro. La app consulta cada 15 s mientras la pantalla está abierta.

## Limitaciones reales
- El mapa se abre en Google Maps; aún no hay mapa embebido ni GPS del teléfono ni historial ni notificaciones push.
- Se muestra la fecha de la última posición, que puede estar desactualizada. La salida de zona se calcula al consultar la pantalla, no es una alerta automática de fondo.
- La API requiere autenticación y comprueba la propiedad de la mascota; las credenciales Traccar permanecen en el servidor.
- Para pruebas sin collar, utiliza **Traccar Client** en un segundo teléfono, asociado a tu servidor. No representa una integración con AirTag.
- El presupuesto de 80.000 COP es un techo de compra, **no una garantía** de encontrar GPS 4G abierto y compatible. No compres rastreadores Bluetooth vendidos engañosamente como GPS.
- Para producción se necesitan HTTPS, configuración de acceso restringido en Traccar, políticas de retención de ubicaciones y pruebas en campo.
