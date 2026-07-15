# Instaladores Android e iOS

La aplicación web está integrada con Capacitor. Los proyectos nativos están en `android/` e `ios/`, con el identificador `com.ecoalerta.recoleccion` y permisos de ubicación configurados.

Cada vez que cambie el código web, sincronizá ambos proyectos:

```bash
npm run mobile:sync
```

## Android

Abrí el proyecto en Android Studio con `npm run android:open`. Para crear directamente un APK de prueba en Windows ejecutá `npm run android:apk`; el archivo se genera en `android/app/build/outputs/apk/debug/app-debug.apk`.

Para publicar, usá Android Studio → Build → Generate Signed Bundle / APK y generá un Android App Bundle (`.aab`) firmado con una clave de producción.

## iOS

La compilación y firma de iOS requieren macOS, Xcode y una cuenta Apple Developer. Copiá o cloná el proyecto en una Mac, ejecutá `npm install` y `npm run ios:open`. En Xcode seleccioná el equipo de firma y usá Product → Archive para enviarlo a App Store Connect/TestFlight.

## Antes de publicar

- Reemplazá los iconos y pantallas de inicio nativos por los definitivos.
- Configurá la firma Android y los certificados de Apple; no los guardes en Git.
- Probá GPS, inicio de sesión y mapas en dispositivos físicos.
- El push web actual usa Service Worker/VAPID. Para recibir notificaciones con la app nativa cerrada se debe integrar FCM en Android y APNs en iOS.
