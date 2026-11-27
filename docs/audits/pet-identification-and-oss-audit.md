# PetCare: identificación visual y auditoría OSS

**Fecha:** 23 de noviembre de 2026  
**Estado:** inferencia local validada con dos fotos reales; validación de plataformas físicas y PostgreSQL pendiente.

## Cambios y límites del servidor

- `sharp` decodifica JPEG, PNG y WebP. El API valida base64 canónico, MIME frente al formato real, estructura completa y fin exacto del contenedor; rechaza CRC/decodificación inválidos, formatos multipágina y contenido añadido tras el fin de imagen.
- Límites: archivo comprimido de entrada 1.200.000 bytes; anchura y altura máximas de 6.000 px; máximo 8.000.000 píxeles y 32 MiB de raster decodificado estimado (canales reportados, hasta cuatro); salida JPEG normalizada de hasta 750.000 bytes y 1.024 px por lado. `sharp` limita píxeles en el decodificador, usa una sola hebra, caché limitada a 32 MB y el API permite un decodificador de imagen activo a la vez.
- La salida rota según orientación EXIF, redimensiona y se vuelve JPEG sin metadatos antes de llamar al modelo. La subida usa un parser JSON de 2 MB únicamente en la ruta visual; las demás rutas conservan 1 MB. El análisis exige autenticación antes de leer el cuerpo, y responde `Cache-Control: no-store`.
- Los límites de píxeles y de raster reducen el máximo de memoria de imagen decodificada, pero no fijan un techo absoluto de RSS para el proceso nativo de libvips/Sharp. Debe considerarse en el dimensionamiento del servicio y comprobarse en el runtime objetivo.

## Flujo y privacidad

La pantalla conserva cámara/galería, vista previa y guardado local. El análisis solo se habilita después del consentimiento explícito; se requiere una sesión autenticada, y las sugerencias se aceptan o descartan una por una. Los errores mantienen la opción manual. El archivo normalizado se envía por API a Ollama en loopback; ni la imagen ni la respuesta se persisten en el servidor. En producción, el tramo móvil–API requiere HTTPS.

La prueba HTTP verifica registro, token de sesión, acceso sin token rechazado, JSON malformado, validación real y envío al proveedor. El cliente no incluye la foto en la solicitud hasta que `photoConsent` está activado. Esta revisión de código y pruebas de API no reemplaza una captura de tráfico de una app móvil compilada.

## Inferencia real con Ollama

Se instaló y ejecutó `qwen2.5vl:7b` en Ollama 0.40.13: Q4_K_M, aproximadamente 8,3B parámetros, modelo de 5.969.233.408 bytes (≈5,56 GiB en disco). Equipo: NVIDIA RTX 3050 con 8 GiB de VRAM, 23,8 GiB de RAM del sistema y 12 núcleos. El proceso de API usó menos de 100 MiB RSS en la pasada final; modelo y contexto ocupan la mayor parte de la GPU. Muestreo máximo observado en esa pasada: 7.346 MiB GPU.

| Muestra pública | Procedencia | Entrada original → normalizada | Latencia final | Resultado |
|---|---|---:|---:|---|
| Perro, retrato | [Wikimedia Commons, CC BY 2.0](https://commons.wikimedia.org/wiki/File:Portrait_dog.jpg), autor Muhammad Albadarin | 2.523.120 → 69.644 bytes | 2,88 s | `dog`; raza indeterminada; edad `adult` |
| Gato, retrato | [Wikimedia Commons, CC BY 2.0](https://commons.wikimedia.org/wiki/File:Cat-portrait.jpg), autor *Micky | 597.109 → 249.050 bytes | 2,54 s | `cat`; raza indeterminada; edad `adult` |

Ambas fotos se identificaron correctamente en la ejecución final autenticada a través del endpoint, la normalización Sharp y el proveedor Ollama. No se obtuvo confianza numérica; la respuesta de Ollama omitió esos valores y el API los conserva como `null`. La raza quedó indeterminada, como corresponde a estas imágenes. En pasadas anteriores, las latencias fueron 3,24–8,70 s para perro y 2,74–4,53 s para gato. RSS máximo observado del proceso API: 105 MiB; pico de GPU muestreado: 7.292 MiB/8 GiB. La variación y sólo dos fotos no permiten afirmar una tasa general de acierto ni rendimiento de producción. Las fotos se descargaron en una carpeta temporal y no se incluyen en el repositorio.

El digest principal del artefacto del modelo es `sha256:a99b7f834d754b88f122d865f32758ba9f0994a83f8363df2c1e71c17605a025`; manifiesto Ollama `sha256:5ced39dfa4bac325dc183dd1e4febaa1c46b3ea28bce48896c8e69c1e79611cc`. La capa de licencia descargada contiene Apache License 2.0. Referencias: [ficha Ollama](https://ollama.com/library/qwen2.5vl), [model card Qwen2.5-VL 7B](https://huggingface.co/Qwen/Qwen2.5-VL-7B-Instruct), [repositorio oficial](https://github.com/QwenLM/Qwen2.5-VL). El modelo no se distribuye con el código. Su inventario separado está en [`petcare-models.cdx.json`](petcare-models.cdx.json).

## Dependencias y licencias

Los SBOM npm se generan desde los lockfiles con hashes de integridad cuando existen. Incluyen paquetes opcionales de otras plataformas que están bloqueados aunque no se hayan instalado localmente. Licencias procedentes de repositorios upstream se documentan como evidencia y no se presentan como verificación legal exhaustiva. Los inventarios generados no sustituyen la conservación de avisos en el artefacto de distribución.

| Proyecto | Componentes del lockfile | Sin licencia resuelta en el inventario | SBOM |
|---|---:|---:|---|
| API | 157 | 0 | [`petcare-api.cdx.json`](petcare-api.cdx.json) |
| Mobile | 576 | 0 | [`petcare-mobile.cdx.json`](petcare-mobile.cdx.json) |

Los 46 nombres que en la auditoría previa carecían del campo `license` en el manifiesto instalado se comprobaron contra los repositorios y textos de licencia upstream. 26 del API corresponden a 25 paquetes opcionales de plataforma `@esbuild/*` (MIT) y `fsevents` (MIT). 20 de mobile corresponden a tres `@expo/modules-macros-*` (MIT), siete `@noxcturnal/noxcturnal-*` (MIT) y diez binarios opcionales `lightningcss-*` (MPL-2.0). El generador conserva URL/repo de evidencia y añade la licencia al componente correspondiente del SBOM. Entre los fuentes: [esbuild LICENSE](https://github.com/evanw/esbuild/blob/main/LICENSE.md), [fsevents LICENSE](https://github.com/fsevents/fsevents/blob/master/LICENSE), [Expo modules macros LICENSE](https://github.com/expo/expo-modules-macros/blob/main/LICENSE), [noxcturnal LICENSE](https://github.com/expo/noxcturnal/blob/main/LICENSE) y [lightningcss LICENSE](https://github.com/parcel-bundler/lightningcss/blob/master/LICENSE).

Revisión específica:

- `node-forge@1.4.3` declara `(BSD-3-Clause OR GPL-2.0)` y su [LICENSE upstream](https://github.com/digitalbazaar/forge/blob/main/LICENSE) incluye ambas alternativas. El consumidor puede optar por BSD-3-Clause y conservar avisos; la declaración por sí sola no determina cómo se cumplirá una distribución concreta. El advisory [GHSA-ppp5-5v6c-4jwp](https://github.com/advisories/GHSA-ppp5-5v6c-4jwp) afecta versiones anteriores a 1.4.0; 1.4.3 queda fuera del rango afectado.
- `lightningcss@1.33.0` declara MPL-2.0 y su [LICENSE upstream](https://github.com/parcel-bundler/lightningcss/blob/master/LICENSE) confirma esa licencia. Revisar obligaciones de fuente y avisos si se distribuye código cubierto; el trabajo combinado puede tener términos propios.
- `caniuse-lite@1.0.30001823` declara CC-BY-4.0 en sus datos; el [repositorio oficial](https://github.com/browserslist/caniuse-lite) identifica los datos de Can I Use y pide atribuir caniuse.com. La atribución está en [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
- Sharp 0.35.5 declara Apache-2.0 para el paquete principal y los wrappers de plataforma; `@img/sharp-win32-x64` combina `Apache-2.0 AND LGPL-3.0-or-later`, `@img/sharp-wasm32` declara `Apache-2.0 AND LGPL-3.0-or-later AND MIT`, y los `@img/sharp-libvips-*` opcionales declaran LGPL-3.0-or-later y tienen [avisos adicionales](https://github.com/lovell/sharp-libvips/blob/main/THIRD-PARTY-NOTICES.md). Las expresiones se guardan en el SBOM. En Windows se inspeccionaron `package.json`, `README.md` y `LICENSE`; para sistemas no instalados se consultaron los manifiestos de sus carpetas en el repositorio upstream. Revisar avisos nativos para cada plataforma distribuida.

El 46 inicial queda resuelto en el inventario con su licencia upstream; al incorporar Sharp aparecieron otros paquetes opcionales de plataforma y se mapearon también. `0 sin declarar` describe el SBOM actualizado, no una opinión legal. npm audit debe volver a consultarse al preparar cada release.

## Pruebas y limitaciones

- Suite API: 45 pruebas; 42 aprobadas, 0 fallidas, 3 omitidas (dos suites PostgreSQL sin `PETCARE_TEST_DATABASE_URL` y la integración de visión que requiere variables/fotos). Incluye archivos corruptos, CRC PNG inválido, MIME falso, base64 y JSON malformados, poliglotas JPEG/PNG/WebP, dimensiones y raster excesivos, límite de archivo, auth y proveedor.
- Integración real aparte: 1/1 aprobada con las dos fotos y modelo local; no es una simulación.
- `tsc --noEmit` en API y mobile: aprobado.
- Hardware: se probó inferencia GPU local; no se midió consumo de energía ni memoria total del sistema durante todo el intervalo. La GPU comparte capacidad con escritorio y no se garantiza el mismo rendimiento en despliegue.
- `npm audit`: API, 0 vulnerabilidades. Mobile, 4 moderadas (árbol transitivo de `@expo/cli`/`@expo/fingerprint` a `glob` y `minimatch`, avisos GHSA-3g3m-2fjr-6pw4 y GHSA-g3hv-75wg-m249). No se aplicó `npm audit fix` ni una actualización amplia; requiere decisión específica sobre la cadena de herramientas Expo.
- PostgreSQL: no se detectó `PETCARE_TEST_DATABASE_URL` ni cliente `psql`; las dos pruebas de integración siguen omitidas.
- Cámara/galería: código y configuración Expo se inspeccionaron; no hay emulador Android, simulador iOS ni dispositivo físico validado en esta ejecución. No se afirma prueba física ni ejecución funcional en Android/iOS.
- No se hizo una auditoría legal formal, análisis de todos los avisos de todas las plataformas nativas, prueba de carga/concurrencia, captura de red de la app compilada ni validación estadística del modelo.

La inferencia real queda comprobada para dos fotografías en este equipo. La función es técnicamente operativa con Ollama y una GPU compatible; el despliegue debe configurar el modelo/runtime y HTTPS, dimensionar memoria, y completar pruebas de plataforma y base de datos que no están disponibles aquí.
