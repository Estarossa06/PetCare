# GPS PetCare con Traccar

PetCare no obtiene GPS del teléfono ni del collar directamente. Traccar recibe ubicaciones del dispositivo y la API PetCare las consulta cuando el usuario abre el rastreo de una mascota. No hay historial, geocerca en segundo plano ni notificación automática por salida de zona.

## Configurar una instancia de prueba

1. Usa una instancia Traccar de prueba accesible únicamente desde el backend PetCare. Elige un usuario Traccar con acceso limitado a los dispositivos que administrará el entorno.
2. Configura en el backend `TRACCAR_URL` con HTTPS y `TRACCAR_TOKEN` con el token del usuario Traccar. HTTP solo se acepta en loopback fuera de producción. No pongas el token en Expo, navegador, logs, tickets ni repositorio.
3. Registra el dispositivo o Traccar Client. El identificador que usa PetCare es el ID numérico interno que devuelve Traccar, no el IMEI ni el identificador del hardware.
4. En el dispositivo de Traccar agrega el atributo personalizado `petcareOwnerId` con el UUID exacto del usuario PetCare autorizado. Debe ser configurado por el administrador; no lo envía ni decide el cliente móvil.
5. Configura API y PostgreSQL de pruebas, inicia sesión con ese usuario y asocia el dispositivo desde Mascota > Rastreo GPS. El backend consulta el dispositivo en Traccar y rechaza la asociación si `attributes.petcareOwnerId` no coincide con el usuario derivado del JWT.
6. Confirma que la pantalla muestra una posición reciente y que las coordenadas/fecha coinciden con la consola Traccar. Prueba con otra cuenta y verifica que la asociación responde como recurso no encontrado.

## Controles implementados

- Todos los endpoints `/tracking/:petId` requieren JWT y verifican que la mascota pertenezca al usuario autenticado.
- El backend valida el `deviceId` con la instancia Traccar y exige el atributo de propietario antes de guardar la asociación o consultar coordenadas.
- La URL remota usa HTTPS; las redirecciones no están permitidas. El timeout upstream es de 9 segundos y los errores no devuelven credenciales ni detalles internos.
- Coordenadas, fecha de fix, accuracy, radio (100–1000 m) y coordenadas del centro se validan antes de mostrarse/calcular distancia.
- El radio y las coordenadas de zona segura son configuración de PetCare; la alerta se calcula solo mientras se consulta la pantalla.

## Pendiente para una integración real

- Configurar una instancia Traccar alcanzable desde el backend, revisar aislamiento de usuario/dispositivo y mantener los secretos en el secret store del servidor.
- Conectar un GPS físico o un teléfono con Traccar Client y validar latencia, cortes y exactitud en campo.
- Definir retención, consentimiento y acceso a datos de ubicación antes de producción.
- Añadir historial/mapa en la app y alertas de fondo solo mediante una decisión de producto y diseño adicional.

La suite automatizada comprueba configuración segura, asociación por propietario, respuesta de posición, coordenadas inválidas y fallos upstream usando un cliente HTTP controlado. No simula ni certifica una conexión real con Traccar. No se conectó un dispositivo GPS real en la validación actual.
