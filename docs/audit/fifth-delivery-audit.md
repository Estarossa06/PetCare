# Auditoría técnica — quinta entrega de PetCare

**Fecha:** 8 de noviembre de 2026  
**Alcance:** calendario, recordatorios, persistencia local, Expo Go, dependencias npm y exportaciones multiplataforma.  
**Decisión:** no se inició el asistente inteligente, no se conectó Neon y no se actualizaron dependencias.

## 1. Resumen ejecutivo

La quinta entrega compila y exporta correctamente para Web, Android e iOS. `expo-notifications` `~58.1.8` es la versión recomendada para Expo SDK 58 y la documentación oficial confirma que las **notificaciones locales** funcionan en Expo Go tanto en Android como en iOS. No se pudo comprobar su entrega real porque no había un dispositivo Android/iOS conectado ni herramientas `adb`/`xcrun` disponibles.

Se corrigió un vacío de restauración: al abrir la app y al volver a primer plano, PetCare ahora reconcilia recordatorios activos de SQLite con los avisos locales programados, vuelve a programar los que faltan y cancela notificaciones PetCare huérfanas. La reconciliación no pide permiso por sí sola y conserva el UUID de recordatorio como identificador estable. También se adelantó la creación del canal Android al momento anterior a solicitar permiso.

La auditoría npm confirma **cinco vulnerabilidades moderadas** en la cadena `expo` → `@expo/cli`/`@expo/fingerprint` → `glob`/`minimatch`. Tanto `npm audit` como `npm audit --omit=dev` reportan las cinco. npm propone `expo@53.0.11` con `--force`, una degradación incompatible con el SDK 58 actual; no se aplicó.

La UI Web mostró y filtró un evento creado para la prueba, pero los filtros de mascota y la navegación a registros de cuidados/médicos no se pudieron ejercitar con datos relacionados disponibles. Se encontró que la interfaz no ofrece un filtro de estado «Programados», aunque los eventos personales y las citas usan el estado `scheduled`.

### Estado global

**APROBADO CON OBSERVACIONES** — exportaciones y comprobaciones locales pasan; falta validación física, el filtro «Programados» no está disponible y permanecen vulnerabilidades moderadas de tooling.

## 2. Estado de pruebas

| Prueba | Estado | Resultado / límite |
|---|---|---|
| `npm run typecheck` | **APROBADO** | `tsc --noEmit` terminó sin errores después de los cambios de restauración. |
| `npx expo install --check` | **APROBADO** | Dependencias instaladas compatibles con el SDK configurado. |
| `npx expo-doctor` | **APROBADO** | 20/20 verificaciones. |
| `npx expo export --platform web` | **APROBADO** | Bundle Web generado. |
| `npx expo export --platform android` | **APROBADO** | Bundle Android generado. |
| `npx expo export --platform ios` | **APROBADO** | Bundle iOS generado. |
| Verificador SQLite de la app | **APROBADO CON OBSERVACIONES** | En Web, migraciones repetidas, UUID, aislamiento, relaciones, múltiples recordatorios, cola y persistencia pasaron. No es una suite `npm test`; se ejecutó por la ruta de verificación de SQLite. |
| Rollback por excepción en operaciones de escritura | **APROBADO CON OBSERVACIONES** | El helper de transacciones incluye `ROLLBACK` al fallar. No se inyectó un fallo dentro de una operación real del repositorio durante esta auditoría. |
| Navegación Mes/Semana/Día y cambio de fecha | **APROBADO** | Se recorrieron las tres vistas y se cambió al día siguiente. |
| Combinación de filtros por categoría, tipo y estado | **APROBADO CON OBSERVACIONES** | Un evento temporal de SQLite apareció con categoría y tipo coincidentes; al aplicar «Pendientes» dejó de aparecer por tener estado `scheduled`. No existe una opción de filtro para ese estado. |
| Filtro por mascota y eventos de cuidados/médicos | **APROBADO CON OBSERVACIONES** | No había filas de prueba de mascotas, salud o cuidados para ejercer estos filtros en UI. |
| Navegación desde evento personal a detalle | **APROBADO** | Se creó un evento temporal, se abrió su detalle y se eliminó lógicamente. |
| Navegación a detalles de citas, cuidados e historial médico | **APROBADO CON OBSERVACIONES** | No había filas relacionadas disponibles para abrir desde el calendario; los destinos se revisaron en el código. |
| Eventos sin resultados / filtros sin coincidencias | **APROBADO** | Se observó el estado «Día despejado» en fechas/filtros sin resultados. |
| Dashboard con datos integrados reales | **APROBADO CON OBSERVACIONES** | El código consulta el repositorio SQLite; no se pudo comprobar la presentación de una mascota/cita/actividad real sin datos relacionados. Las tarjetas demostrativas existentes se identifican por separado. |
| Notificaciones locales en Android e iOS | **PENDIENTE DE PRUEBA EN DISPOSITIVO** | No se observó un dispositivo conectado. Las exportaciones solo validan empaquetado. |
| Push remoto en Expo Go | **APROBADO CON OBSERVACIONES** | No se usa en PetCare. Expo Go en Android no admite push remoto desde SDK 53; se requiere Development Build. |
| Auditoría npm | **FALLIDO** | Cinco vulnerabilidades moderadas, sin actualización segura compatible identificada dentro del SDK 58 actual. |
| Funcionamiento con varias pestañas Web | **APROBADO CON OBSERVACIONES** | Una verificación falló al abrir dos conexiones SQLite Web al mismo tiempo (`createSyncAccessHandle` ocupado). Al cerrar la pestaña concurrente y repetir en una sola pestaña, pasó. |

No existe script `test` en `mobile/package.json`. La verificación SQLite descrita es una pantalla de diagnóstico ejecutada manualmente en Web, no una prueba automatizada integrada en CI.

## 3. Android e iOS

### Android

- **Compatibilidad documentada:** notificaciones locales disponibles en Expo Go. La API puede programar una fecha y hora y crear canales Android.
- **Configuración encontrada:** Expo SDK `~58.0.23`; `expo-notifications` `~58.1.8`; `app.json` define `android.package`, pero no configura un plugin específico de `expo-notifications`. El canal `petcare-calendar` se crea en tiempo de ejecución.
- **Corrección aplicada:** el canal ahora se crea antes de `getPermissionsAsync`/`requestPermissionsAsync`, lo cual evita depender de solicitar permiso antes de que exista un canal en Android 13+.
- **Permisos y recepción reales:** no observados en un teléfono ni emulador.
- **Entrega en segundo plano/reinicio:** no observada físicamente. El sistema operativo es quien presenta la notificación programada mientras la app no está en primer plano; ahorro de batería, fabricantes y modo de forzado de detención pueden afectar la entrega o su reprogramación.
- **Exactitud:** la app usa disparadores de fecha con entrega `bestEffort`; no se promete una alarma exacta ni se configura permiso de alarma exacta.

### iOS

- **Compatibilidad documentada:** notificaciones locales disponibles en Expo Go.
- **Configuración encontrada:** `ios.bundleIdentifier` está definido; no se añadió un plugin de notificaciones. La app solicita permisos desde la API en el flujo de guardado y utiliza el manejador de primer plano.
- **Permisos y recepción reales:** no observados en iPhone/iPad.
- **Segundo plano/reinicio:** no observados físicamente. El comportamiento depende de permisos y ajustes del sistema. Si el usuario deniega el permiso, puede tener que habilitarlo en Configuración; no se debe asumir que el diálogo de permiso reaparecerá.

### Diferencias y resultado

Android requiere un canal de notificación para presentar avisos en versiones modernas; el canal se crea antes de pedir autorización. iOS gestiona autorización de alertas/sonido mediante el sistema y puede mantener preferencias de presentación independientes. En ambas plataformas el usuario puede denegar o revocar permisos. El calendario y los recordatorios SQLite continúan disponibles aunque no haya permiso.

La documentación oficial de SDK 58 indica `expo-notifications` recomendado `~58.1.8`, y que las notificaciones locales siguen disponibles en Expo Go; las push remotas no están disponibles en Expo Go Android desde SDK 53:

- [Expo SDK 58 — Expo Notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/)
- [Expo Notifications — guía general](https://docs.expo.dev/push-notifications/overview/)

## 4. Restauración de notificaciones

### Comportamiento previo y solución aplicada

Antes de esta auditoría, la app programaba o cancelaba la notificación al guardar/cambiar un recordatorio, pero no revisaba el estado del sistema al iniciar ni al volver a primer plano. Una interrupción entre commit SQLite y operación del SO podía dejar un aviso desactualizado o faltar un aviso después de reinicio.

Se implementó reconciliación en [calendarNotifications.ts](../../mobile/src/calendar/calendarNotifications.ts) y se conecta desde [\_layout.tsx](../../mobile/app/_layout.tsx):

1. Al iniciar y cada vez que `AppState` vuelve a `active`, obtiene los recordatorios activos de SQLite y las notificaciones pendientes del SO.
2. Solo considera notificaciones etiquetadas con `content.data.reminderId`, que identifica avisos propios de PetCare.
3. Cancela avisos etiquetados cuyo recordatorio ya no está activo y avisos propios con identificador inconsistente.
4. Si el permiso fue revocado, si falta el aviso, si la fila quedó en estado distinto de `scheduled` o si ya venció, vuelve a pasar por la lógica de sincronización local.
5. El identificador de notificación coincide con el UUID del recordatorio, así que programar tras cancelar no debe crear duplicados por una operación repetida.
6. La reconciliación evita solicitudes concurrentes dentro del proceso. Un error se registra en consola y se vuelve a intentar en el siguiente inicio/retorno a primer plano.

No solicita permiso automáticamente durante la reconciliación; el permiso se solicita desde la acción explícita de guardar/activar un recordatorio. En Web no ejecuta API del SO.

### Escenarios y límites

| Escenario | Comportamiento esperado/implementado | Estado |
|---|---|---|
| Cerrar y volver a abrir app | El sistema puede conservar el aviso pendiente; al inicio se verifica y se reconstruye si falta. | **APROBADO CON OBSERVACIONES**; sin prueba física. |
| Reiniciar dispositivo | Se reconcilia la próxima vez que la app se abra o vuelva a primer plano. No puede reparar avisos mientras la app nunca se vuelva a ejecutar. | **PENDIENTE DE PRUEBA EN DISPOSITIVO**. |
| Modificar recordatorio | La fila local cambia, el aviso se cancela/reprograma usando el mismo UUID. Si el proceso cae entre pasos, reconciliación repara al reabrir. | **APROBADO CON OBSERVACIONES**; entrega real pendiente. |
| Eliminar/deshabilitar/atender recordatorio | La app cancela el aviso; si cae tras persistir, la reconciliación identifica el aviso huérfano por su marcador y lo cancela. | **APROBADO CON OBSERVACIONES**; entrega real pendiente. |
| Denegar/revocar permiso | El recordatorio permanece en SQLite y pasa a estado de permiso denegado al sincronizar; al restaurar permiso, la siguiente reconciliación intenta programarlo. | **PENDIENTE DE PRUEBA EN DISPOSITIVO**. |
| Reinstalar app/restaurar dispositivo | SQLite local y notificaciones dependen del almacenamiento/respaldo del SO; no hay servicio remoto que restaure datos ni garantía de recuperar IDs del SO. La reconciliación solo recupera los recordatorios presentes en SQLite. | **APROBADO CON OBSERVACIONES**; recuperación de datos tras reinstalar no implementada. |
| App en segundo plano | La entrega depende del SO una vez programada; el manejador de primer plano solo configura la presentación mientras la app está activa. | **PENDIENTE DE PRUEBA EN DISPOSITIVO**. |
| Pulsar la notificación | No hay listener de respuesta/deep link que abra el detalle del recordatorio ni lo marque como atendido. | **FALLIDO** para navegación/atención automática; el aviso solo presenta título y cuerpo. |

La solución no intenta reconciliar silenciosamente otra app: solo cancela solicitudes que llevan el campo `reminderId` de PetCare. Sigue siendo necesario probar reinicio del proceso, reinicio físico, permisos y entrega real en Expo Go Android e iOS.

## 5. Auditoría npm

Comandos ejecutados desde `mobile/`:

- `npm audit`
- `npm audit --omit=dev`
- `npm outdated`

Los dos comandos de audit reportaron **5 moderadas, 0 altas, 0 críticas**. El árbol de Expo está bajo dependencias del proyecto, por lo que `--omit=dev` no elimina esas herramientas de Expo del árbol analizado. Los advisories afectan a herramientas de búsqueda de archivos/patrones usadas por el CLI/fingerprint, no a una llamada de la app PetCare que procese patrones proporcionados por usuarios.

| Paquete afectado | Relación | Versión instalada | Severidad / advisory | Versión corregida conocida | Impacto y compatibilidad |
|---|---|---:|---|---|---|
| `expo` | Directa | `58.0.23` | Moderada; heredada de `@expo/cli` y `@expo/fingerprint` | No hay una versión corregida compatible con el SDK actual identificada. npm sugiere `53.0.11` en la salida de consola y `57.0.32` en el informe JSON de producción, ambas con cambio mayor. | Implicaría degradar desde SDK 58 y perder compatibilidad con las dependencias actuales. **No aplicar.** |
| `@expo/cli` | Transitiva de `expo` | `58.1.19` | Moderada; incorpora `glob` vulnerable | No hay actualización compatible de Expo 58 indicada por audit | Herramienta de desarrollo/compilación; no es lógica de runtime de la app. El cambio global recomendado por npm es incompatible. |
| `@expo/fingerprint` | Transitiva de `expo` | `0.21.9` | Moderada; transitivamente `glob` y `minimatch` | No hay actualización compatible de Expo 58 indicada por audit | Herramienta de Expo para fingerprint/configuración; misma limitación de cadena de dependencias. |
| `glob` | Transitiva de CLI/fingerprint | `13.0.7` | Moderada, [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4): `AbortSignal` puede no detener a tiempo un recorrido de archivos | `14.0.2` corrige el rango del advisory; `14.0.4` es la versión más reciente consultada | `@expo/cli` y `@expo/fingerprint` declaran `^13.0.0`; forzar la versión 14 es un salto mayor fuera del rango declarado. Exposición práctica acotada al tooling del proyecto. |
| `minimatch` | Transitiva de `glob` | `10.2.6` | Moderada, [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): posible consumo excesivo por amplificación de `globparts` | `11.0.1` corrige el rango del advisory; `11.0.5` es la versión más reciente consultada | Salto mayor desde 10; `glob@13` usa la rama 10. Forzarla sin validar la cadena podría romper glob/Expo CLI. |

`npm audit fix --force` **no se ejecutó**. La recomendación automática degradaría Expo a `53.0.11`, incompatible con Expo SDK 58 y contrario a mantener Expo Go/SKD 58. No se aplicaron overrides arbitrarios de `glob` o `minimatch`.

`npm outdated` detectó:

| Paquete | Instalado / wanted | Último publicado | Evaluación |
|---|---|---|---|
| `react` | `19.3.0` / `19.3.0` | `19.3.1` | Parche; se conserva versión exacta probada con SDK 58 hasta validar combinación recomendada por Expo. |
| `react-dom` | `19.3.0` / `19.3.0` | `19.3.1` | Parche; se conserva por paridad con React y Web. |
| `react-native-svg` | `15.16.0` / `15.16.0` | `15.16.1` | Parche; se conserva versión compatible instalada, sin necesidad de cambio para la auditoría. |
| `typescript` | `6.0.3` / `6.0.3` | `7.0.2` | Mayor; actualización fuera de alcance y no justificada. |

No se actualizó ninguna dependencia; por ello no se requirió repetir verificaciones por cambios de paquete. Los comandos de tipo, Doctor y exportaciones se ejecutaron después de los cambios locales a notificaciones.

## 6. Calendario: filtros, fuentes y navegación

### Pruebas manuales Web de esta auditoría

- Mes, Semana y Día se pudieron seleccionar.
- Los botones de periodo anterior/siguiente cambiaron la fecha correctamente en la prueba del día.
- La UI expuso filtros de categoría, estado y tipo. Se combinaron categoría Personal + tipo Eventos y se mostró un evento proveniente de SQLite.
- Al seleccionar Pendientes, el evento `scheduled` dejó de aparecer; el estado vacío se mostró.
- La pantalla detallada mostró el evento, su fecha y el estado. Se confirmó eliminación lógica desde su acción de eliminar.
- No había mascota en el conjunto de prueba; no fue posible activar una opción de mascota distinta de «Todas».

La prueba creó el evento temporal `AUDIT-20261108-calendar-event` y lo eliminó lógicamente desde la app. No se editó ni eliminó ninguna fila preexistente. Por el diseño de soft delete, el tombstone del registro temporal se conserva en el almacenamiento Web de prueba.

### Integración y cobertura restante

La consulta de calendario compone filas SQLite de `care_tasks`, `care_task_executions`, `appointments`, `health_records`, `calendar_events` y `calendar_reminders`, en lugar de duplicar las fuentes. El verificador SQLite valida integridad y más de un recordatorio por evento. Pruebas manuales de la entrega anterior registraron dos recordatorios sobre un evento y recalcularon uno relativo al cambiar la fecha del objetivo; esa prueba no se repitió en esta auditoría.

No se pudo validar con datos reales de prueba:

- Filtro por mascota con filas de más de una mascota.
- Cuidados, ejecuciones, citas e historial médico visibles conjuntamente, sin duplicados.
- Navegación desde cada clase de fuente y acciones de registrar ejecución.
- Dashboard con una cita, un evento médico y tareas reales.

La revisión del código confirma que estas fuentes proceden del repositorio local, pero no sustituye una prueba funcional con filas de cada tipo.

**Problema observado:** `CalendarScreen` no ofrece el estado `scheduled` en la lista de filtros. Los eventos personales/citas programados se muestran al elegir «Todos», pero no se pueden filtrar directamente como programados. Se recomienda añadir esa opción y cubrir estados reales por origen.

## 7. Integridad, migraciones y persistencia

La ruta de verificación de base local ejecutó dos veces la migración y pasó:

- UUID canónicos, propietario y relaciones mascota/objetivo.
- Eventos generales y más de un recordatorio.
- Concordancia de mascota entre recordatorio y objetivo (incluidos triggers de migración 0005).
- Dependencias de operaciones `sync_queue`.
- Claves foráneas y aislamiento por propietario.
- Versionado inicial, tombstones y `foreign_key_check`.
- Cierre/reapertura de SQLite y persistencia después de recargar Web.
- Restricciones inválidas probadas con sentencias que deben fallar; el verificador revierte su transacción al finalizar.

No se alteraron migraciones anteriores. La prueba de fallo no inyectó una excepción en medio de un `saveEvent`/`saveReminder` real, por lo que no se afirma cobertura exhaustiva de rollback de todos los repositorios.

La primera ejecución Web de verificación falló porque otra pestaña de la misma app mantenía un `createSyncAccessHandle` abierto. Al navegar esa pestaña fuera de la app y repetir en una sola pestaña, la suite pasó y el control posterior a la recarga confirmó que la fila de persistencia temporal se eliminó. Esto es una limitación/riesgo de SQLite Web con varias pestañas concurrentes que merece una prueba separada; no se observó en la ejecución de una sola pestaña.

## 8. Problemas encontrados y correcciones

1. **Restauración no implementada al iniciar/reactivar.** Se añadió `reconcileCalendarNotifications`, conectado al inicio de la app y al retorno a primer plano. Solo limpia solicitudes marcadas como PetCare.
2. **Canal Android creado después del chequeo/solicitud de permiso.** Se movió la creación del canal antes del flujo de permisos.
3. **Filtro de estado carece de `scheduled`.** Hallazgo confirmado con evento temporal; no se cambió la UI porque el alcance de esta entrega es auditoría y no nuevos cambios funcionales salvo restauración segura.
4. **Cinco advisories moderados en npm.** No se aplicó el downgrade incompatible ni overrides no validados.
5. **Exportaciones ejecutadas en paralelo sobre el mismo `dist/`.** La primera exportación Android tuvo `EPERM` por escritura concurrente; las tres exportaciones se repitieron secuencialmente y pasaron.
6. **Caché Metro inválida.** Metro hizo full crawl y completó exportaciones; las exportaciones secuenciales posteriores terminaron sin error.
7. **Contención de SQLite Web multi-pestaña durante verificación.** Repetir serialmente pasó; queda como limitación observada.
8. **Web informa que el listener de tokens push no está plenamente soportado.** PetCare no usa tokens ni push remoto; en Web se conserva el estado local de recordatorios y se marca notificación del SO no compatible.

## 9. Pruebas que requieren intervención del usuario

No hay Android ni iOS accesibles desde este entorno. Para probar en dispositivos reales:

1. Instalar **Expo Go** en un Android y en un iPhone/iPad. En `mobile/`, ejecutar `npx expo start --go` y abrir el proyecto con el QR.
2. En cada dispositivo, crear un evento de prueba no relacionado con datos reales; agregar un recordatorio para 2–3 minutos después. Conceder permiso y confirmar que aparece **un solo** aviso en la hora esperada.
3. Mantener PetCare en primer plano y repetir: confirmar banner/presentación. Después enviar la app a segundo plano y repetir; comprobar centro de notificaciones Android/iOS.
4. Editar el recordatorio a una nueva hora. Confirmar que no llega el aviso de la hora vieja y que llega una sola vez el nuevo.
5. Eliminar/desactivar el recordatorio, esperar a que pase la hora prevista y confirmar que no aparece. Crear dos recordatorios del mismo evento y confirmar que cada uno se entrega una sola vez.
6. Con un recordatorio pendiente, cerrar normalmente la app y volver a abrirla; luego, en otra prueba, reiniciar el dispositivo y abrir PetCare antes de la hora. Comprobar si se entrega y si el estado se mantiene.
7. Denegar permiso en el diálogo inicial y guardar el recordatorio: debe seguir visible en SQLite. Concederlo luego desde Ajustes del sistema, regresar a PetCare y verificar reconciliación. Repetir con revocación del permiso.
8. En Android, repetir con Android 13+ y comprobar el canal «Calendario PetCare» en Ajustes de notificaciones. En iOS, revisar Ajustes → Notificaciones → PetCare y probar alertas/banners según la configuración del usuario.
9. Al terminar, borrar los eventos y recordatorios temporales desde la UI; no usar datos clínicos reales para la prueba.

Informar modelo/OS, versión de Expo Go, estado de permiso y hora esperada/recibida. Estas instrucciones no equivalen a resultados: todas las pruebas físicas siguen **PENDIENTE DE PRUEBA EN DISPOSITIVO**.

## 10. Riesgos técnicos pendientes

1. **Entrega no confirmada físicamente** en Android/iOS, en primer/segundo plano, tras reinicio y con permisos revocados.
2. **Interacción con la notificación:** no se registra la respuesta ni se navega al detalle; tampoco se marca atendida al pulsarla.
3. **Restauración tras reinstalación:** sin backend/sync, los datos SQLite y las notificaciones no tienen restauración garantizada.
4. **Expo Go:** es válido para probar notificaciones locales; no valida push remoto ni comportamiento de una app distribuida. Push remoto requeriría Development Build.
5. **Avisos exactos:** la programación es best effort, no una garantía de ejecución puntual.
6. **Cinco vulnerabilidades moderadas** de cadena Expo tooling siguen en el árbol.
7. **SQLite Web en múltiples pestañas** puede colisionar al abrir el mismo almacenamiento.
8. **Filtros por estado** no ofrecen `scheduled`.
9. **Datos por fuente** y filtros de mascota no se probaron en la auditoría por falta de un conjunto de prueba aislado con mascotas, cuidados, citas y salud.

## 11. Recomendaciones priorizadas

| Prioridad | Recomendación | Estado |
|---|---|---|
| P0 | Ejecutar el protocolo de notificaciones en Android y iOS físicos; no declarar entrega exitosa antes de esos resultados. | Pendiente de usuario/dispositivos. |
| P1 | Añadir respuesta/deep link al tocar una notificación y decidir explícitamente si debe marcarse atendida. | Pendiente de decisión/implementación. |
| P1 | Añadir estado `scheduled` al filtro del calendario y pruebas con datos de cada fuente, combinaciones y más de una mascota. | Pendiente. |
| P1 | Revisar con Expo el plan de actualización compatible para `glob`/`minimatch` dentro de SDK 58; no usar `--force` ni overrides sin suite de regresión. | Pendiente. |
| P2 | Añadir tests automatizados de repositorios que inyecten fallos y confirmen rollback de dominio + `sync_queue`. | Pendiente. |
| P2 | Probar SQLite Web con dos pestañas y definir si se bloquea, se comparte una conexión o se muestra un error recuperable. | Pendiente. |
| P2 | Evaluar respaldo/exportación local si se desea recuperar recordatorios y datos tras reinstalación antes de la sincronización remota. | Pendiente de decisión arquitectónica. |

## 12. Cambios realizados en esta auditoría

- Se actualizó el flujo de notificaciones en [calendarNotifications.ts](../../mobile/src/calendar/calendarNotifications.ts): reconciliación idempotente al inicio/retorno a primer plano y creación anticipada del canal Android.
- Se conectó la reconciliación en [\_layout.tsx](../../mobile/app/_layout.tsx), con registro explícito de errores.
- No se modificaron paquetes, migraciones, esquema remoto ni datos legítimos.
- No se hizo stage ni commit de Git.
