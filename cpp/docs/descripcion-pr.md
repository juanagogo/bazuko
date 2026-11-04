# Port C++/OpenGL: paridad con el juego web, evolución gráfica e interfaz de cartón

Reemplaza al PR #26 e incluye todos sus commits más el trabajo posterior.

## Qué trae

**Paridad con el juego web (los commits del PR #26)**
- Clima, GPS, audio, locomoción y El Chato; lago con nado; policía con persecución y sirenas; vehículos con puertas; mapa y mejoras de interfaz.
- Retiro de los modelos sin permiso de redistribución y créditos de los modelos 3D (`docs/creditos-modelos.md`).

**Gráficos (`cpp/docs/plan-hacia-aa.md`)**
- Buffer HDR con mapeo ACES, SSAO, bloom, rayos de luz del sol, clustered shading con hasta 256 luces y mapas de normales.
- Suelo mojado con charcos que se secan despacio según el clima; reflejos en pantalla (por G-buffer en calidad alta).
- Tres cascadas de sombra, sombras de contacto, niebla por altura y volumétrica, decals y haces de faros.
- Hojas y pasto: mipmaps que conservan color y cobertura, recorte con MSAA, gradiente y viento en el pasto; nitidez al reescalar.
- Mediciones (FPS medios, de día): RTX 3050 157 / 146 / 106 y Radeon integrada 74 / 53 / 33 en calidad baja / media / alta.

**Interfaz y datos del original**
- Tipografía «Dios Le Pague», costal de 5 × 4 con acceso rápido 1 a 5, mesa de crafteo, HUD de cartón, pantalla de carga con semitono y BAZUKO que se escribe, y los menús de señal azul pintados con la paleta de cartón. `BAZUKO_UI_OSCURA=1` devuelve la interfaz anterior.
- Objetos, recetas y textos del cambuche del original; cuchillo, botella picada y arma casera que se sacan con «Usar».
- Dos patrullas (hasta tres) que reaparecen con policías uniformados tras morir.

## Lo que falta o no se verificó
- El IK de pies en rampas y las sombras dinámicas lejanas.
- Cambuche funcional del original (llama y frío), el aviso de interacción inferior y el radar siguen con el estilo anterior.
- Las pruebas son de lógica (`ctest`, 13 pasan); lo visual se revisó en capturas locales, no en otros equipos.
- Licencias: los audios de policía y los modelos de terceros que siguen en el repositorio tienen licencia por revisar.

## Cómo probar
```sh
cmake -S cpp -B cpp/build && cmake --build cpp/build --config Release
ctest --test-dir cpp/build -C Release
```
