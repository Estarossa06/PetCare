# Almacenamiento privado de archivos

La app móvil y Web se comunican exclusivamente con la API de PetCare. La API transmite los cuerpos y las descargas al bucket privado Cloudflare R2 mediante el SDK S3. El cliente no recibe claves de R2 ni URLs presignadas.

## Configuración del backend

En el entorno privado de la API se deben configurar conjuntamente:

- `R2_ACCOUNT_ID` (the 32-character Cloudflare account ID; the matching canonical HTTPS R2 S3 endpoint is also accepted)
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Crear el bucket sin acceso público y emitir un token limitado a ese bucket con permisos de lectura, escritura y listado necesarios para subir, bajar, borrar y limpiar huérfanos. No definir estas variables en `mobile/.env`, Expo ni en el bundle. Sin ellas la API permanece disponible, pero los endpoints de archivos responden `503 MEDIA_STORAGE_UNAVAILABLE`; no se finge que una subida tuvo éxito.

La validación real anterior se realizó con credenciales privadas y un prefijo temporal. Esta auditoría no vuelve a consultar ni revelar valores de configuración. La disponibilidad actual de credenciales debe comprobarse en el entorno backend; la privacidad efectiva del bucket debe confirmarse en el panel de Cloudflare.

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

Las pruebas automatizadas incluyen almacén en memoria y PostgreSQL desechable `petcare_test`. La ejecución real separada reportó transferencias autenticadas de imagen y PDF con comparación SHA-256, aislamiento, límites, reintento tras interrupción y tombstones contra Cloudflare R2. Esa evidencia no confirma la política de acceso público del bucket, CORS del panel ni el comportamiento físico de dispositivos. Verificar el bucket privado en Cloudflare antes de habilitarlo en un despliegue.

Las imágenes se validan realmente. PDF se valida por cabecera, marca EOF y ausencia de datos finales ajenos, no con un parser PDF completo; DOCX valida estructura ZIP y partes XML principales pero no ejecuta macros. Para procesamiento antivirus/Content Disarm & Reconstruction se requiere un servicio adicional todavía no integrado.
