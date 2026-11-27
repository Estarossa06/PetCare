# Localizador dual en PetCare
Base: PetCare-main(1).zip, versión entregada el 27 de noviembre. Se conserva esa funcionalidad y se añade un apartado independiente en el perfil.

## Instalación
Desde mobile, ejecutar `npm install`, luego `npx expo install expo-intent-launcher` (necesario antes de compilar; selecciona la versión compatible y actualiza package.json y package-lock.json). Después `npm run typecheck` y `npx expo start -c`. Si Expo Go no incluye el módulo nativo, usar una compilación de desarrollo o nativa con `npx expo run:android` / `npx expo run:ios` (iOS requiere macOS).

## Pruebas pendientes en teléfonos físicos
- iOS: con Buscar instalada, pulsar Rastrear mascota y comprobar apertura mediante findmy:// (esquema no garantizado por Apple); sin ella, comprobar App Store.
- Android: con Find Hub instalado, comprobar apertura mediante intent MAIN/LAUNCHER dirigido al paquete com.google.android.apps.adm; sin ella, comprobar Google Play.
- Web: comprobar mensaje de plataforma no compatible.
- Vincular el OTag manualmente según su manual y seleccionar el accesorio en la aplicación oficial. El botón no selecciona automáticamente una mascota ni comprueba la vinculación. El uso simultáneo de las dos redes no está confirmado; podría requerir desvincular y restablecer el accesorio para cambiar de red.
- Verificar que los perfiles, historial, cuidados y rastreo Traccar anterior sigan funcionando.

No se requieren cambios de API ni base de datos para esta nueva función. No se garantiza alcance, frecuencia de actualización ni GPS propio. No se han ejecutado pruebas en dispositivos ni compilación en este entorno.
