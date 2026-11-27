# Almacenamiento privado de archivos

La app móvil y Web se comunican exclusivamente con la API de PetCare. La API transmite los cuerpos y las descargas al bucket privado Cloudflare R2 mediante el SDK S3. El cliente no recibe claves de R2 ni URLs presignadas.

## Configuración del backend

En el entorno privado de la API se deben configurar conjuntamente:

- `R2_ACCOUNT_ID`
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Crear el bucket sin acceso público y emitir un token limitado a ese bucket con permisos de lectura, escritura y listado necesarios para subir, bajar, borrar y limpiar huérfanos. No definir estas variables en `mobile/.env`, Expo ni en el bundle. Sin ellas la API permanece disponible, pero los endpoints de archivos responden `503 MEDIA_STORAGE_UNAVAILABLE`; no se finge que una subida tuvo éxito.

No se proporciona conexión R2 ni se han usado credenciales reales en desarrollo o pruebas.

## API y controles

- `POST /media/pets/:petId/photo`: foto JPEG, PNG o WebP, máximo 10 MiB.
- `POST /media/health-records/:recordId/attachments`: PDF, DOCX, texto UTF-8 y las imágenes soportadas, máximo 15 MiB. El formato binario antiguo `.doc` se rechaza porque no hay un decodificador seguro para verificarlo.
- `GET /media/assets/:assetId/content`, `GET /media/changes` y `DELETE /media/assets/:assetId` requieren JWT.
- El propietario sale del principal validado por JWT. La API comprueba que mascota, registro médico y recurso pertenezcan a ese propietario.
- La API valida el contenido decodificable, límites, MIME/extensión y SHA-256; calcula MD5 para la integridad S3 compatible. Las descargas se verifican antes de enviarse al cliente.
- La subida usa `X-Upload-Id` y checksum como clave idempotente. Los errores conservan el archivo local y la operación SQLite para reintento.
- La migración aditiva PostgreSQL `0012_media_storage` almacena metadatos, versiones, cursores, tombstones y una cola de limpieza remota. La migración móvil `0010_media_storage` añade identificadores separados de las rutas locales y la cola durable. Las filas antiguas se conservan como `local_only`; no se importan automáticamente.
- Eliminaciones de mascota o registro generan tombstones de archivos. El worker horario reintenta la cola de borrados y elimina objetos sin referencia tras 24 horas.

## Validación realizada

Las pruebas automatizadas usan un almacén en memoria y PostgreSQL desechable `petcare_test`. No verifican conectividad real a R2 ni sus permisos, CORS ni configuración de bucket. Antes de habilitarlo en un despliegue hay que crear/configurar el bucket privado y probar las variables en un entorno no productivo.

Las imágenes se validan realmente. PDF se valida por cabecera, marca EOF y ausencia de datos finales ajenos, no con un parser PDF completo; DOCX valida estructura ZIP y partes XML principales pero no ejecuta macros. Para procesamiento antivirus/Content Disarm & Reconstruction se requiere un servicio adicional todavía no integrado.
