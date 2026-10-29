# Funciones de Cristianlv11

Integración selectiva de la rama [`feature/mejoras-navegacion-audio-pausa-clima`](https://github.com/Cristianlv11/bazuko/tree/feature/mejoras-navegacion-audio-pausa-clima), revisada en el commit `d939812`. El trabajo original de Cristianlv11 aporta `Minimap.js`, `Dog.js`, `PauseMenu.js`, `WeatherSystem.js` y cambios de cámara, iluminación e interfaz.

Se adaptaron estas funciones sobre `pruebas-integracion`. Se mantienen la ciudad actual, los modelos de mreyeswilson, el inventario por casillas, los materiales garantizados del refugio, los semáforos, el tráfico con atropellos y el ragdoll.

## Adaptaciones

- El radar calcula su orientación con la matriz de la cámara real, incluida la vista isométrica. Usa las posiciones actuales de cambuche, recicladora, tienda, crafteo y dealer. Se pinta como máximo veinte veces por segundo. Desde la rama `feat/radar-gps` dibuja además el plano de la ciudad (`CityMapRaster.js`), la ruta del GPS a pie (`GpsNavigation.js`) y un zoom dinámico; el mapa grande (`MapView.js`) vive en la pestaña Mapa de la pausa.
- Los ajustes de volumen usan el `Howler` ya existente. Motores, ralentí y claxones conservan sus archivos y voces normales. Volumen y silencio se guardan en almacenamiento local. El ladrido es un efecto corto sintetizado que pasa por el volumen maestro.
- La pausa usa el menú actual. Esc cierra primero inventario, tienda o panel activo sin abrir simultáneamente otro menú. Los paneles liberan el cursor y frenan la simulación. La recuperación tras un atropello mortal sigue requiriendo su botón propio.
- Los perfiles gráficos actualizan el límite de `AdaptiveResolution`; la adaptación no revierte la preferencia. La iluminación respeta la niebla elegida durante todo el día y se libera el render target anterior al cambiar el tamaño del mapa de sombras. No se promete un incremento fijo de FPS.
- Pointer Lock y arrastre usan rutas de eventos separadas para evitar contar el mismo movimiento dos veces. Los rechazos asíncronos de Pointer Lock dejan disponible el arrastre. Menús, creador, inventario, Esc y pérdida de foco liberan el ratón.
- El Chato se crea y registra junto al cambuche. Busca rutas sobre la cuadrícula transitable con vecinos ortogonales y colisiones simples; las conexiones se reutilizan, y el destino se revisa como máximo una vez por segundo. No activa una simulación física permanente. La amistad persiste como campo opcional del guardado. La mascota personalizable que llegó con la integración del original se unificó en El Chato: el juego tiene un solo perro, con su pelaje, accesorio y tamaño en la pestaña Estado de la pausa, y P vuelve a abrir el creador de personaje.
- Alimentarlo usa los objetos de comida existentes (`pan`, `lataComida`), sin confundir latas vacías con comida. Las caricias restauran cinco de ánimo con veinte segundos de enfriamiento. El olfato ignora basura vacía. Al dormir, se acuesta cerca y aporta quince de ánimo extra; al reaparecer acompaña al jugador al nuevo inicio.
- La lluvia usa un único `Points` de 350 partículas, se detiene con la pausa y precarga su material durante el arranque. El Chato participa en el descarte de objetos fuera de cámara.

## Validación

`npm test` ejecuta la suite de Node; incluye las pruebas previas de tráfico, bus, colisiones, audio, supervivencia, ragdoll y carga inicial junto con las nuevas comprobaciones de compatibilidad. `npm run build` genera la versión de producción. Estas comprobaciones no sustituyen medir FPS, escuchar el audio y revisar la presentación en un navegador real.
