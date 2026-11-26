# Validación física móvil de PetCare

Este checklist prepara la ronda manual en dispositivos reales. Las pruebas automatizadas de Node/SQLite y los bundles no sustituyen estas comprobaciones. Usa dos cuentas de prueba distintas y datos sintéticos; no uses información personal ni producción. Para pruebas remotas, configura la API de pruebas apuntando exclusivamente a `petcare_test`.

## Preparación compartida

- [ ] Registrar modelo del dispositivo, versión del sistema, versión de PetCare, fecha y si se usa Wi-Fi o datos móviles.
- [ ] Confirmar que la API de pruebas está disponible y que la aplicación muestra la cuenta esperada.
- [ ] Preparar las cuentas A y B con correos de prueba diferentes; no compartir contraseñas en evidencias.
- [ ] Preparar una mascota sintética, una imagen JPEG pequeña, un PDF sintético y registros de prueba.
- [ ] Habilitar grabación de pantalla o capturas sin mostrar correos completos, tokens, datos médicos ni coordenadas reales.
- [ ] En cada paso anotar resultado, hora aproximada, mensaje visible y si el dato aparece en SQLite/estado de sincronización o en la API de pruebas.

## Android físico

### Cuenta y navegación

- [ ] Instalar la build destinada a pruebas y abrir la app sin sesión: solo aparece autenticación.
- [ ] Registrar la cuenta A e iniciar sesión; comprobar Dashboard y las cinco pestañas principales.
- [ ] Forzar cierre y volver a abrir con red: verificar restauración de sesión.
- [ ] Cerrar sesión y comprobar que vuelve a autenticación y que no se muestran datos de A.
- [ ] Iniciar sesión con B en el mismo dispositivo; confirmar que la lista local de mascotas, historial, cuidados, calendario y archivos de A no aparece.
- [ ] Probar credenciales incorrectas, error de red durante login/registro y reintento.

### Formularios y datos locales

- [ ] Crear, consultar, editar y eliminar una mascota; probar campos requeridos, fecha de nacimiento, edad y peso inválidos.
- [ ] Crear/editar/eliminar un registro médico con detalles y un adjunto PDF.
- [ ] Crear/editar/eliminar cuidado recurrente y registrar una ejecución.
- [ ] Crear/editar/eliminar cita, evento y recordatorio; comprobar fecha, zona horaria y relaciones.
- [ ] Forzar cierre después de guardar y comprobar persistencia local tras reabrir.
- [ ] Activar modo avión, crear y editar registros; cerrar y volver a abrir la app sin red y verificar qué datos locales siguen disponibles. Al restablecer conexión, comprobar push/pull, ACK y que no se creen duplicados.

### Cámara, galería y archivos

- [ ] Desde el formulario de mascota abrir la cámara, aceptar el permiso, tomar una imagen, ver la vista previa y guardar.
- [ ] Abrir galería/selector, cancelar y repetir seleccionando una imagen; comprobar vista previa, guardado local y carga remota.
- [ ] Denegar el permiso de cámara; confirmar mensaje útil y que el resto del formulario siga disponible.
- [ ] Consentir el análisis de imagen y verificar respuesta real de la API, campos sugeridos resaltados y posibilidad de corregirlos. Confirmar que el resultado se presenta como estimación y no diagnóstico.
- [ ] Adjuntar PDF válido, visualizar/descargarlo, activar modo avión y comprobar disponibilidad local; probar tipo no permitido y límite de tamaño.
- [ ] Interrumpir una carga cerrando la app o perdiendo red; reabrir y comprobar estado pendiente/fallido, reintento y ausencia de duplicados.

### Notificaciones

- [ ] Crear recordatorio futuro y conceder permiso; verificar canal PetCare y una única notificación programada.
- [ ] Editar hora, deshabilitar, completar y eliminar el recordatorio; comprobar reemplazo/cancelación sin duplicados.
- [ ] Denegar permiso, verificar estado denegado y que la app sugiera habilitarlo desde ajustes sin bloquear el guardado del recordatorio.
- [ ] Tocar una notificación y verificar navegación al elemento correcto.
- [ ] Reiniciar dispositivo y abrir PetCare; comprobar reconciliación de recordatorios.

### Pantallas y conectividad

- [ ] Repetir formularios y modales con teclado abierto, fuente grande y orientación admitida; verificar que botones no queden ocultos.
- [ ] Recorrer pantallas pequeñas y grandes disponibles, pestaña inferior, listas largas, vacíos y errores de red.
- [ ] Con red recuperada, verificar sincronización con el backend de pruebas y aislamiento entre A y B.

## iPhone físico

### Cuenta y navegación

- [ ] Instalar la build destinada a pruebas y abrir la app sin sesión: solo aparece autenticación.
- [ ] Registrar/iniciar sesión con A; comprobar pestañas, Dashboard y persistencia tras cerrar y reabrir.
- [ ] Cerrar sesión y luego entrar con B; comprobar que no se filtran registros ni medios locales de A.
- [ ] Probar credenciales incorrectas y fallos/reintentos de red en registro e inicio.

### Formularios y datos locales

- [ ] Completar CRUD de mascota, historial médico, medicamento/tratamiento, cuidado, ejecución, cita, evento y recordatorio.
- [ ] Revisar validaciones, fechas, zona horaria, estados vacíos y mensajes de error.
- [ ] Forzar cierre después de cambios y confirmar persistencia al reabrir.
- [ ] Con modo avión, crear/editar datos, cerrar/reabrir y comprobar recuperación local; reconectar y confirmar sincronización sin duplicados.

### Cámara, galería y archivos

- [ ] Aceptar permiso de cámara, tomar foto, confirmar vista previa, guardado local y carga.
- [ ] Usar selector de fotos con selección limitada, cancelar, y seleccionar otra imagen; verificar permisos y manejo de cancelación.
- [ ] Denegar cámara/fotos desde el sistema y comprobar mensajes y acceso a ajustes.
- [ ] Probar consentimiento de análisis, respuesta real del servicio, sugerencias editables y texto que no lo presente como diagnóstico.
- [ ] Adjuntar, abrir, descargar y eliminar PDF sintético; verificar disponibilidad local sin conexión e integridad al volver a sincronizar.
- [ ] Interrumpir una carga, cerrar PetCare, abrir de nuevo y comprobar reintento sin duplicados.

### Notificaciones

- [ ] Crear recordatorio y conceder autorización; comprobar entrega real con PetCare en segundo plano y en primer plano.
- [ ] Editar, deshabilitar, completar y eliminar; verificar sustitución/cancelación sin notificaciones duplicadas.
- [ ] Denegar permisos y comprobar que la app informa el estado y conserva el recordatorio local.
- [ ] Tocar notificación y validar la pantalla destino.
- [ ] Reiniciar iPhone y verificar reconciliación de recordatorios pendientes.

### Pantallas y conectividad

- [ ] Probar tamaños de iPhone disponibles, texto grande, teclado, scroll, modales y barra inferior.
- [ ] Revisar Dashboard, formularios largos, historial y calendario en cargas vacías, errores y conexión lenta.
- [ ] Verificar sincronización con API de pruebas y aislamiento A/B; registrar operaciones pendientes y ACK.

## Criterios para cerrar la validación

- Marcar cada paso como aprobado, fallido o no probado; adjuntar evidencia no sensible.
- Un cambio presente solo en SQLite no cuenta como push confirmado; comprobar el ACK y la lectura posterior desde otra instalación o mediante la API de pruebas.
- Para validar pull multidispositivo, usar una instalación limpia con cuenta A después de que la primera instalación haya recibido ACK.
- No marcar las notificaciones como aprobadas solo por verlas en la lista programada: confirmar entrega del sistema operativo.
- No marcar R2 como validado por la disponibilidad de la copia local: comprobar carga/descarga autenticada y checksum mediante el flujo de pruebas.
- Al terminar, borrar solo fixtures identificadas de `petcare_test` siguiendo el procedimiento de pruebas del backend; conservar capturas sin datos sensibles.

## Limitaciones conocidas antes de la ronda

- Las suites automatizadas prueban guards, migraciones SQLite, recuperación, política de reintentos, colas, conflictos y lógica de notificaciones con adaptadores; no ejecutan el selector nativo, cámara ni entrega del sistema operativo.
- La restauración de sesión requiere renovar tokens con el servicio; no se ha validado acceso autenticado offline tras reiniciar la aplicación.
- El comportamiento de cámara/galería, archivos en sandbox, notificaciones y layouts debe aprobarse en los dos dispositivos. Una compilación o bundle no equivale a esa aprobación.
