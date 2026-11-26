# Estado técnico actual de PetCare

**Actualizado:** 25 de noviembre de 2026. Se basa en el árbol de trabajo inspeccionado; incluye cambios locales sin commit. No equivale a una aprobación de lanzamiento.

## Corte de verificación de Ejecución 4 (25 de noviembre de 2026)

- API: `npm test` terminó con 64 aprobadas, 0 fallidas y 3 omitidas. KIRAI PostgreSQL con flag y la inferencia de fotos requieren opt-in/fixtures específicos. `npm run build` pasó.
- Móvil: `npm test` y `npm run typecheck` pasaron.
- KIRAI/Ollama real local: `npm run kirai:ollama:test` respondió con `qwen3:8b`. `npm run test:kirai:e2e` pasó contra `petcare_test` con fixtures sintéticos; midió 4,226 ms en la primera respuesta y comprobó contexto, persistencia, aislamiento de propietarios e idempotencia. Esta prueba no valida disponibilidad ni capacidad de un despliegue externo.
- Traccar: se añadieron casos de timeout, HTTP no exitoso, JSON malformado y ausencia de posición. La instancia y un dispositivo físicos siguen sin conectar.
- Web: `npx expo export --platform web` produjo `mobile/dist` con 3,127 módulos. La inspección de salida no encontró manifest de instalación ni service worker; no es una PWA y no se validó un hosting real.
- Dependencias: `npm audit` en los lockfiles API y móvil reportó 0 vulnerabilidades (182 y 576 paquetes, respectivamente). Se regeneraron los informes audit, SBOM CycloneDX y reportes de licencias desde los lockfiles. El inventario asigna licencia declarada o evidencia de upstream a los 758 paquetes; esto no sustituye revisión legal ni verifica exhaustivamente mantenimiento/abandono.
- Ollama local usa la versiÃ³n 0.40.13; estÃ¡n instalados `qwen3:8b` (5.2 GB) y `qwen2.5vl:7b` (6.0 GB). La licencia local consultada para Qwen3 declara Apache-2.0; el BOM de modelos separa estos artefactos de npm.\n- No hubo cambios de producciÃ³n, firma, publicaciÃ³n ni despliegue. Las pruebas KIRAI E2E usaron `petcare_test`; no representan integraciÃ³n PostgreSQL de producciÃ³n.

## Clasificación de evidencia

| Área | Implementado en código | Prueba automatizada | Integración real | Validación física |
|---|---|---|---|---|
| Autenticación | API con JWT/refresh, guards Expo, particiones SQLite por cuenta | Pruebas API/móviles y PostgreSQL de pruebas | API/PostgreSQL en `petcare_test` | Login, restauración y cambio de cuenta en Android/iOS pendientes |
| Sync de mascotas y seis entidades | Outbox, orden de dependencias, push/pull, ACK, versiones, cursores, idempotencia, conflictos, tombstones y recuperación local | SQLite y API/PostgreSQL con cuentas de prueba | Integraciones PostgreSQL ejecutadas solo en `petcare_test` en resultados anteriores | Piloto de dos instalaciones pendiente |
| Medios | API de streaming autenticada, validación/checksum, cola móvil, objetos R2 | Fixtures simulados y PostgreSQL | Existe evidencia previa de Cloudflare R2 real; el bucket privado debe verificarse en su panel | Interrupción/reinicio de transferencias en dispositivos pendiente |
| KIRAI | Chat por usuario, contexto remoto/local, límites, safety prompt y reintento idempotente | Suite de API y móvil | En esta ejecución, Ollama `qwen3:8b` respondió; E2E con aislamiento e idempotencia pasó en `petcare_test` | UI móvil en dispositivos pendientes |
| Identificación visual | API Ollama con decodificación y límites | Fixtures automatizados | `qwen2.5vl:7b` está presente en Ollama local; no se repitió inferencia de fotos en esta ejecución | Cámara/galería y flujo completo pendientes |
| GPS/Traccar | API owner-scoped; exige `attributes.petcareOwnerId` para asociar/leer posiciones | Tests cubren ownership, URLs, coordenadas, timeout, errores HTTP/JSON, posición vacía y cálculo de distancia | No se conectó instancia real de Traccar | Dispositivo GPS/campo no probado |
| Notificaciones | Planificación y reconciliación local | Adaptadores/lógica automatizados | No aplica a servidor remoto | Entrega real Android/iOS pendiente |
| Web | Expo export estático; SQLite Web/IndexedDB | Typecheck y export Web | No se probó hosting de producción | No existe PWA instalable ni prueba en navegador real en esta ejecución |

## Cambios relevantes de estado frente a auditorías antiguas

- `docs/sync/phase-4-audit.md` conserva el diagnóstico original, pero fue actualizado con una nota visible: sus conclusiones sobre ausencia de sync/KIRAI/R2 son históricas.
- La API móvil ya usa `/sync/v1` y `/sync/v1/domain`; no se debe describir el outbox como solo una estructura sin consumidor.
- KIRAI ya consulta registros remotos owner-scoped y cambios locales seleccionados. El modelo puede equivocarse; las respuestas son orientación y no reemplazan atención veterinaria.
- R2 usa el backend como único intermediario. Transferencias anteriores se probaron contra R2 real; transferencia no demuestra que el bucket sea privado. Cloudflare debe confirmarlo.
- La validación Traccar ahora requiere que un administrador configure en cada dispositivo el atributo `petcareOwnerId` igual al UUID del usuario PetCare. Sin esa asignación el backend rechaza el dispositivo.
- La exportación Expo Web no instala un service worker ni crea un manifest PWA.

## Verificaciones de esta ejecución

- Ollama local: servicio reachable y `qwen3:8b` listado. Smoke real de respuesta completado.
- KIRAI E2E: pasó con datos sintéticos en `petcare_test`; latencia primera respuesta 7,473 ms; verificó contexto PostgreSQL, persistencia, propietario A/B y repetición idempotente. Una ejecución inicial falló por timeout en la primera consulta de contexto; la siguiente pasó. Se añadió `stage` seguro al evento de error para diagnosticar futuras fallas sin loguear contenido/token.
- `npm audit` con los lockfiles actuales: API 0 vulnerabilidades (157 paquetes auditados); móvil 0 vulnerabilidades (576 paquetes auditados). No se actualizaron dependencias.
- Export Web Expo: Metro generó 3,127 módulos y los archivos estáticos bajo `mobile/dist`; no es una PWA ni validación de hosting.
- El E2E KIRAI fue limitado a `petcare_test` y limpia UUID/fixtures de esa ejecución. No se ejecutaron migraciones ni se consultó producción.

## Bloqueos para distribuir

1. Pruebas manuales en Android/iOS físicos: sesión, cámara, archivos, notificaciones, offline/reinicio y flujos reales.
2. Configuración operativa externa: dominios HTTPS y CORS, secretos aislados, proveedor/monitorización PostgreSQL, Ollama, R2 y Traccar.
3. Traccar requiere confirmar asociación administrativa del dispositivo a la cuenta. No hay prueba física de ubicación.
4. Verificar privacidad efectiva del bucket R2 en el panel Cloudflare.
5. No hay perfiles EAS ni proceso reproducible de firma para APK/AAB/IPA. Requiere cuentas/llaves del dueño y revisión de permisos/privacidad.
6. Web carece de manifest PWA, service worker, estrategia de caché/offline shell, revisión de cuotas IndexedDB, headers y prueba de instalación/actualización.
7. Revisión de avisos/licencias para artefactos nativos y modelos sigue siendo responsabilidad del release owner; el SBOM es inventario técnico, no dictamen legal.

## Prioridad recomendada

- **P0:** completar autorización/provisionamiento por propietario en Traccar, confirmar privacidad R2 y revisión de secretos/entornos antes de exponer servicios.
- **P1:** completar piloto de dos instalaciones y checklists Android/iOS; preparar firma y pruebas de artefactos.
- **P2:** definir producto PWA/hosting, cuotas y recuperación browser; confirmar distribución de notices.
- **P3:** métricas operativas de latencia Ollama, GPS y telemetría opt-in.

Runbooks: [checklist físico móvil](../testing/mobile-physical-validation.md), [piloto offline de dos instalaciones](../testing/offline-first-two-installations.md), [preparación de distribución](../deployment/distribution-readiness.md).
