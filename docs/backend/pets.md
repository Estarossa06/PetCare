# API de mascotas

## Endpoints

Todas las rutas requieren un access JWT válido y una sesión activa.

| Método | Ruta | Respuesta |
|---|---|---|
| `POST` | `/pets` | `201 { pet }` |
| `GET` | `/pets` | `200 { pets, pagination }` |
| `GET` | `/pets/:petId` | `200 { pet }` |
| `PATCH` | `/pets/:petId` | `200 { pet }` |
| `DELETE` | `/pets/:petId` | `204`; establece `deleted_at` |

Una mascota no encontrada, eliminada o perteneciente a otra cuenta responde
`404`, evitando revelar si existe bajo otro propietario. Un cuerpo o parámetro
inválido responde `400`; las fallas internas de PostgreSQL se registran sin
devolver detalles internos.

## Campos y validación

Las entradas usan los nombres camelCase de `PetInput` móvil: `name`, `species`,
`breed`, `sex`, `birthDate`, `approximateAgeMonths`, `weightKg`, `color`,
`notes` y `photoStorageKey`. `name` y `species` son obligatorios al crear; los
demás campos admiten `null` u omisión. `PATCH` solo cambia los campos
presentados. El servidor rechaza campos desconocidos, incluido `owner_id`.

Se validan sexo (`female`, `male`, `unknown`), fechas reales `YYYY-MM-DD` no
futuras, edad entera no negativa y excluyente con fecha de nacimiento, y peso
positivo con hasta tres decimales (máximo `9999.999`). Los límites de texto son:
nombre 200, especie 100, raza 150, color 100, notas 10 000 y clave de foto
2 048 caracteres. Al establecer fecha de nacimiento o edad en un `PATCH`, el
servidor limpia automáticamente el campo excluyente.

La lista acepta `search`, `species`, `limit` y `offset`. La búsqueda parcial
ignora mayúsculas y busca en nombre, raza y especie; `species` es un filtro
exacto. `limit` por defecto es 50 (rango 1–100) y `offset` por defecto es 0
(máximo 1 000 000). La respuesta incluye el total para esos filtros.

## Persistencia y compatibilidad

Se reutiliza `pets` de la migración PostgreSQL `0001_core`; no se requiere una
migración nueva. Todas las consultas restringen por `owner_id` obtenido del
principal autenticado y usan parámetros. Las actualizaciones incrementan
`version` y `updated_at`; la eliminación es lógica.

La respuesta mantiene los campos snake_case del tipo `Pet` de SQLite,
incluyendo `owner_id`, UUID y timestamps. `weight_kg` se devuelve como número,
no como el texto que entrega el driver para `numeric`. La creación remota empieza
en versión 1; SQLite empieza en 0. `photo_storage_key` se conserva como valor
opaco: este módulo no sube ni sirve archivos y una clave local no implica que la
foto esté disponible remotamente. Mobile y su esquema local no se modifican.

## Pruebas

`npm run test:integration:pets --prefix api` usa exclusivamente
`PETCARE_TEST_DATABASE_URL`, requiere `PETCARE_RUN_AUTH_DB_TESTS=1` y aborta
antes de escribir salvo que la URL y `current_database()` sean exactamente
`petcare_test`. Comprueba los checksums aplicados antes de crear fixtures y
limpia los usuarios y mascotas de prueba al terminar. No ejecuta migraciones.
