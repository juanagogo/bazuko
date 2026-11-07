# Bazuko nativo (C++20 · SDL3 · OpenGL 4.5)

Reescritura en C++ del juego web (`../web`). Supervivencia en El Cartucho (Bogotá): recoge basura, recicla,
compra, arma tu cambuche, duerme, sobrevive. Las diferencias y correcciones de bugs respecto al web están en
[`CHANGES.md`](CHANGES.md).

## Compilar

```sh
sudo dnf install SDL3-devel mesa-libGL-devel libwebp-devel git-lfs   # Fedora; cmake y ninja (pip --user sirven)
git lfs pull                                                         # WAV reales del audio (opcional)
cd native
cmake --preset release && cmake --build --preset release
./build/release/bazuko
```

El resto de dependencias (glm, nlohmann/json, doctest, miniaudio, Dear ImGui) se descargan con CMake.
`BAZUKO_BUILD_APP=OFF` compila solo la lógica y los tests (sin SDL).

## Tests

```sh
cmake --preset debug && cmake --build --preset debug && ./build/debug/bazuko_tests
```

Los tests de paridad comparan contra `data/*_reference.json`, generados desde el JS original con
`tools/export_*.mjs` (`cd ../web && npm ci --ignore-scripts`).

## Controles

WASD mover · Shift correr · E interactuar/recoger · mantener Q seleccionar basura (Q junto al dealer: su tienda) ·
F boost · B/L pedir limosna · T talentos · C crafteo · P apariencia · V cámara · M personaje liviano ·
F3 rendimiento · clic derecho o flechas girar · rueda zoom · Esc cierra paneles o sale.

## Opciones

`--screenshot F.png --frames N` captura y sale · `--hour H` · `--iso` · `--at X Z` / `--pos X Z` · `--yaw` ·
`--size W H` · `--scale F` · `--seed N` · `--new` · `--no-audio` · `--save RUTA` · `--creator` ·
`--open talentos|crafteo|dealer|recicladora|tienda|cambuche`. `BAZUKO_PROFILE=1` imprime tiempos de arranque.

## Estructura

`src/core` y `src/game` (lógica, sin GL/SDL) · `src/world` (ciudad, colisiones, tráfico, peatones) ·
`src/render` y `src/character` (geometría, texturas procedurales, glTF, animación) · `src/audio` · `src/app`
(ventana, interfaz, modelos de entidades) · `tests` · `tools` (exportadores del JS).
Modelos y audio se leen de `../web/public`; al quitar `web/`, muévelos a `native/assets/models` y `native/assets/audio`.
