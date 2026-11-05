# Cambios respecto al juego web

Correcciones de lógica aplicadas al portar. El código de `web/` no se modifica: las
correcciones de datos viven en `tools/export_data.mjs`, que regenera `data/game_data.json`
(`node tools/export_data.mjs`).

## Fase 1 · datos
| # | Problema en la versión web | Corrección nativa |
|---|---|---|
| 1 | 5 de 6 recetas apuntaban a ítems inexistentes (`arma`, `mochila`, `curita`, `rifa`, `hierba`, y los ingredientes `alambre`, `tela`, `plastico`); `craft()` devolvía `null`. | Quedan 3 recetas con ítems reales: antibiótico (pastilla + botella), vendajes (1 lona → 3) y carbón activo (2 tablas → 1). **Decisión de diseño revisable.** El exportador falla si una receta usa un ítem inexistente. |
| 2 | Las curas usaban ids que no existían como enfermedad (`tetanos`, `sarna`, `parasitos`) y `intoxicacion` ≠ `intoxication`: vacuna, pomada, antiparasitario y carbón se gastaban sin curar. | El catálogo tiene 6 enfermedades (`gripe`, `infeccion`, `intoxicacion`, `tetanos`, `sarna`, `parasitos`) y el exportador falla si una cura no tiene enfermedad. Valores de las 3 nuevas: derivados de los de las existentes (ver el exportador). |
| 3 | El talento `surv2` ("-40 % enfermedad") usaba la clave `diseaseResist`, que se sumaba (1 + 0.6) y aumentaba el riesgo un 60 %. | Pasa a `diseaseResistMult` (0.6) y se multiplica. Igual para el origen *desplazado* (0.7). |

## Fase 2 · simulación
| # | Problema en la versión web | Corrección nativa |
|---|---|---|
| 4 | `CraftingSystem.craft` comprobaba el peso del resultado sin descontar los ingredientes que se iban a consumir: con la mochila llena no se podía fabricar nada. | Se descuenta el peso de los ingredientes (`CraftingSystem::craft`). |
| 5 | El guardado no tenía autoguardado y `SaveSystem.load` no tenía `try/catch` (JSON corrupto o `localStorage` bloqueado rompía el arranque); `clock` ausente lanzaba. | `SaveSystem` v3: escritura atómica (tmp + rename), `AutoSaver` cada 60 s de juego, un archivo ilegible se mueve a `save.json.corrupt` y se arranca partida nueva, campos ausentes toman su valor por defecto. Lee también las partidas v1/v2 del juego web (v1: dólares×250; `intoxication`→`intoxicacion`; ítems que ya no existen se descartan). |
| 6 | `talent-unlock` se mostraba dos veces (lo emitían el sistema y el clic del HUD). | Solo `TalentSystem::unlock` emite el evento. |
| 7 | Los eventos eran `CustomEvent` sobre `window`. | `EventBus` tipado (`std::variant`); la UI/audio consumen con `drain()` por frame. |

Sin cambio, aunque el análisis lo marcó como posible bug:
- La energía no usa `decayMult`: el talento *Estómago de Hierro* dice "hambre y sed", así que es lo descrito.

## Fase 3 · mundo lógico
Sin correcciones de comportamiento: el objetivo es paridad exacta con el juego web. Verificada con
`data/world_reference.json`, que genera `tools/export_world.mjs` ejecutando el código JS original
(`node tools/export_world.mjs`, requiere `npm ci` en `web/`):
- mapa completo de 120×111 tiles, ejes de calles, bandas, migración de posiciones v0/v1;
- zonas reservadas, rejilla de aparición, 640 puestos de parqueo, 6 circuitos de tráfico (40 muestras cada uno) y ruta del bus;
- 465 cajas de colisión y 400 movimientos `resolveMove`;
- red peatonal (4325 nodos), rutas con la misma semilla (`Mulberry32Rng` reproduce `mulberry32` bit a bit), 66 peatones + 6 vendedores.

Diferencias de implementación (no de comportamiento):
- Las rutas peatonales y los NPC reciben el `Rng` inyectado; el tráfico y el bus usan subpasos de 0,05 s como el original.
- `TrafficRoute::sample` devuelve el final del último tramo si el redondeo lo deja fuera (JS dejaba el vector sin tocar).
- Los vehículos de tráfico usan las medidas del carro/taxi (4,3 × 1,76 m); la buseta no se usa en la ciudad.

## Fase 4 · render base
Sin cambios de comportamiento. Iluminación día/noche, cámara (tercera persona con brazo que se acorta
ante paredes, e isométrica) y movimiento del jugador verificados contra el JS con
`data/render_reference.json` (`tools/export_render.mjs`): 17 horas del día, 7 cámaras, recuperación
del brazo, cámara isométrica, límites de giro/zoom y 103 casos de WASD.

Aproximaciones del render (se afinan en las fases 5–6):
- Luz difusa estilo three.js (hemisférica + direccional + ambiente), tonemapping ACES (exposición 1,05), sRGB y niebla lineal por profundidad de vista.
- El IBL de `RoomEnvironment` (PMREM) se sustituye por una irradiancia ambiental constante escalada con `environmentIntensity` (`kEnvIrradiance` en `Renderer.cpp`).
- Edificios como cajas de color plano y personajes/vehículos como cajas: la geometría real llega en las fases 5 y 7. Sin sombras todavía (fase 6).

## Fase 5 · ciudad visual
| # | Problema en la versión web | Corrección nativa |
|---|---|---|
| 8 | El césped (textura de tierra casi negra × verde oscuro `#3e5a2c`) quedaba prácticamente negro. | El tinte se amplifica ×12 para que se vea verde sin perder el relieve de la textura. |

Lo portado (sin paridad bit a bit: el JS usa `Math.random` sin semilla y un navegador para rasterizar):
- **Texturas procedurales** (`ProceduralTextures.cpp`): asfalto, andén, ladrillo, fachadas (pintada/ladrillo/ruina con ventanas encendidas, rejas, persianas con grafiti y avisos), tejas, losa, cartón, bolsa, tierra, concreto y letreros. Se dibujan con `Canvas2D` (CPU: rectángulos, degradados, trazos, elipses y texto con Overpass vía `stb_truetype`).
- **Ciudad** (`VisualWorld`): suelo con UV en metros y bordillos, marcas viales, casas de 2–4 tiles con zócalo + paredes altas + techo, relleno y perímetro, letreros de locales, balcones, tanques, faroles, bancas, canecas con fuego, zorras, cambuches, colchones, ropa colgada, árboles, estación de la troncal, vendedores y los cerros del fondo.
- **BuildingVisibility** (cinco rayos, fundido de 0,22 s, espera de 0,18 s): en isométrica las paredes/techos que tapan al jugador se atenúan; las casas con alguna pieza atenuada se dibujan por piezas y el resto sale del lote agrupado (un SSBO de indicadores descarta sus vértices en el shader).
- **Culling por frustum** de cada lote de 32 m, materiales con texturas (mipmaps y anisotropía 8), emisivo nocturno de ventanas y carteles sin luz.
- Textura de fachada compartida por clave `ancho:pisos:estilo:variante`.

Sin portar todavía: las luces dinámicas (faroles, fuego), sombras y los modelos de personajes (fases 6 y 7). Los cristales de la estación son láminas opacas.
Diferencias de dibujo: sin mapas de relieve (`bumpMap`) ni de rugosidad; el texto del avisito «FRÁGIL ↑» del cartón no lleva la flecha (no está en la fuente).

## Fase 6 · iluminación y sombras
Sin cambios de comportamiento; se verifican con tests (`lights_test.cpp`) los números del JS:
- **Sombra del sol**: mapa de 2048² ortográfico de ±45 m que sigue al jugador, PCF 3×3 sobre comparación por hardware, sesgo 0,0005 más *polygon offset*. Mejora respecto al JS: el centro del mapa se ajusta a la rejilla de texels (no hay temblor al caminar). De noche (sol < 0,12) se omite la pasada: casi no se vería.
- **Dos luces puntuales reales** (`LocalLights`): puntuación `pico / (1 + d²)`, rango de 80 m, plazas fijas (vacías con intensidad 0); la atenuación es la de three.js (`1/d^decay` con corte suave). Faroles (1,2 solo de noche, 8 m), 4 canecas (5 ± 1,2 ± 0,8) y 2 fritangas (2,2 ± 0,4) parpadeantes.
- **Halos decorativos** (hasta 48, a menos de 45 m, color atenuado por intensidad y distancia), aditivos y sin tonemapping, sobre el suelo.
- **Silueta del jugador**: pasada con profundidad `GREATER` (cian `0x73e5ef`, 0,65) y repintado del jugador visible para borrar la falsa silueta entre sus partes.
- **Resolución adaptativa** (`AdaptiveResolution`, 0,75×–1,5×, ventanas de 3 s; `--scale` para forzarla): la escena se dibuja en un FBO multimuestreado, se resuelve a textura y se amplía con un triángulo de pantalla completa (un blit con escalado hacia el framebuffer multimuestreado de la ventana no es válido en OpenGL).
- Los lotes con `castShadow = false` (suelo, marcas, carteles, cerros) no proyectan sombra.

## Fase 7 · personajes
Sin correcciones de comportamiento. Verificado con `gltf_test`, `animation_test`, `character_test` y `procedural_test`:
- **glTF** (`cgltf` + `libwebp`): jerarquía de nodos, skins, materiales, animaciones y el atributo propio `_VID`; `EXT_texture_webp` (la imagen vive en `texture.webp_image`). Solo se decodifican las texturas de color base: los mapas normales (hasta 4096², 67 MB cada uno) no se usan y agotaban la memoria. Las texturas de personaje se reducen a un máximo de 1024 px y se libera su copia en CPU al subirlas a la GPU (RAM ≈ 280 MB con 72 personajes).
- **Retarget Mixamo → MakeHuman en tiempo de ejecución** (`Retargeter`, port de `retarget.js`): se hornea una vez por cuerpo (6 cuerpos × completo/liviano). No hace falta la herramienta offline `bake_anims` que preveía el plan.
- **Mezcla de animaciones** (`Animator`): pesos que siguen al objetivo con `k = min(1, dt·8)`, acumulación con slerp ponderado como `PropertyMixer`, `walk`/`run` con `timeScale` por velocidad y acciones sin clip cayendo en idle (solo existen idle/walk/run de prueba).
- **Ensamblado por piezas** (`CharacterLibrary`): pelo, barba, ropa y calzado atados al esqueleto del cuerpo por nombre de hueso; el cuerpo pierde los triángulos tapados por la ropa (`oculta` + `_VID`); tintes de piel (25 % blanco) y pelo (15 %); materiales de pelo (recorte alfa 0,08), barba/cejas/pestañas (mezcla alfa) y ropa (*polygon offset*). Mallas, texturas y esqueletos se comparten entre personajes con las mismas piezas.
- **Skinning en GPU** (shader con 64 matrices), sombra con recorte alfa para el pelo y silueta cian del jugador.
- **Gente de la calle** (`randomStreetLook`, 72 % hombres, ropa vieja en El Cartucho), **LOD** (completo a < 7 m, liviano a > 10 m, sin sombra propia), animación cada 3 cuadros pasados 20 m y congelada pasados 40 m, y sin animar fuera de cámara.
- **Personaje procedural** (`ProceduralCharacter`, tecla M o `--procedural`): la misma geometría de primitivas que `character.js` con un esqueleto de 16 huesos animado a mano; se dibuja con el pipeline de skinning (una malla por material).
- **Apariencia** (`Look`): normalización, migración del formato antiguo, `randomLook` y JSON compatible con el guardado web.

Diferencias respecto al web:
- Las texturas se reducen a 1024 px y no se usan mapas normales (el JS cargaba los de 4096²).
- Los modelos se leen de `web/public/models` mientras exista (CMake lo detecta); al eliminar `web/` hay que mover esa carpeta a `native/assets/models`.
- La carga de los 72 personajes tarda ~5 s al arrancar; la pantalla de carga con progreso llega en la fase 9.

Pendientes de fases siguientes (ya identificados):
- Fase 10: desaturación por ánimo bajo (`getDesaturation` ya está portado).

## Fase 8 · entidades e interacción
Lógica (`game/Entities`, `Interaction`, `Places`, `Money`; sin GL ni SDL, probada en `game_test.cpp`):
- **Población**: 42 bolsas (14 · escala) desde la rejilla de spawn y 15 carros (5 · escala) en puestos de parqueo separados > 8 m (30 % taxis, 8 pinturas). La basura revive a los 20 s en otro punto válido; los carros a los 40 s.
- **Interacción**: objetivo más cercano a < 1,8 m; E recoge/roba/abre menús, mantener Q 1,5 s selecciona la bolsa (más objetos), F boost (−10 energía, drena salud, 8 s), B/L pedir limosna (enfriamiento de 4 s en tiempo de juego), dealer (solo compra de noche, Q abre su tienda).
- **Correcciones**:
  - `sortValueMult` (Selección Experta) ahora multiplica las tiradas de lo seleccionado.
  - La higiene baja aumenta la probabilidad de enfermar al recoger (`getDiseaseChanceMultiplier`); Piel Dura y Selección Experta la reducen.
  - Si la mochila está llena se avisa de lo que se deja en el suelo (antes se perdía en silencio).
  - La mesa de crafteo ahora es interactuable (`EvOpenCrafting`).
  - La caja de colisión de la tienda queda alineada con el modelo (el web la desplazaba −0,7 en z) y la fachada queda junto al punto de interacción.
- **Lugares**: recicladora (×1,2 con boost, ×origen), tienda (dinero, peso, costal único), cambuche por piezas (la base primero) y crafteo con XP.

Visual (`app/EntityModels`, `Renderer::uploadMesh` + `MeshDraw`): todo son mallas fusionadas con color de vértice y tinte (bolsa con anillo ámbar, aura dorada con boost y barra de selección; carros con pintura teñida y taxi con letrero; dealer de noche; tienda con toldo; mesa de crafteo; cambuche por piezas; bus articulado que se desvanece; tráfico con los mismos carros). Los marcadores y el bus usan mezcla alfa sin escribir profundidad.

Diferencias respecto al web:
- Sin texto sobre los carteles de la tienda ni la recicladora (la bodega ya existe en el mundo; solo lleva un anillo verde marcador, igual que el cambuche).
- Los menús (recicladora, tienda, cambuche, dealer) llegan en la fase 9: de momento los eventos se imprimen en consola, E en la recicladora vende todo y E en el cambuche duerme si hay base.
- La animación de acciones (`buscar`, `pedir`...) se envía al animador pero cae en idle porque solo existen los clips idle/walk/run.

## Fase 9 · interfaz, audio y guardado
- **Interfaz (Dear ImGui 1.91.9 + SDL3/OpenGL3, fuente Overpass, paleta azul/amarilla)**: HUD (nombre, nivel, XP, 7 necesidades con vicio en rojo en abstinencia, reloj, dinero, boost, advertencias críticas), mochila clicable (comida y remedios se usan con clic), enfermedades con tiempo, cartel de interacción, avisos apilados (2,5 s, máx. 6), paneles de talentos (T), crafteo (C) y dealer (Q), menús de recicladora, tienda/vendedores y cambuche (con dormir), diálogo de muerte con causas, creador de personaje (nombre, origen, sexo, edad, piel, pelo, barba, ropa; se previsualiza en el mundo con la cámara de frente, clic derecho para girar) y medidor de rendimiento (F3). Los textos y reglas sin dibujo viven en `game/UiText` (probados). Los emoji de los avisos se quitan porque la fuente no los tiene.
- **Pantalla de carga** con progreso por etapas y pantalla de error si falla la carga.
- **Audio (miniaudio, `audio/AudioEngine`)**: efectos, pasos en bucle (1,4× al correr), boost y ambiente en streaming. Tolera sin dispositivo, archivos ausentes (`boost.wav` no existe en el juego web) o punteros LFS. Los WAV se leen de `web/public/audio` (mover a `native/assets/audio` al quitar `web/`; hace falta `git lfs pull`).
- **Guardado**: carga al arrancar (posición migrada, apariencia, cambuche), autoguardado cada 60 s, al dormir, al aceptar el creador y al salir. Un archivo ilegible se mueve a `*.corrupt` y se empieza de cero.
- **Muerte y sueño**: el mundo se congela con menús, creador, muerte o sueño (fundido a negro de 1,4 s); reaparecer lleva al cambuche.
- Nuevas opciones: `--new`, `--no-audio`, `--save RUTA`, `--creator`, `--open PANEL` (capturas de interfaz).

Diferencias respecto al web: sin vista 3D propia en el creador (se usa el mundo); sin iconos en los menús; la mochila y los paneles no se pueden mover.

## Fase 10 · pulido y paridad
- **Barrido contra `docs-contexto/02-mecanicas.md`**: la desaturación por ánimo bajo ya se aplica al color de la escena (`applyDesaturation`), la mesa de crafteo es interactuable (fase 8) y `player.speedMult` muerto no se porta.
- **Tests de integración** (`integration_test.cpp`): un día completo de reloj (3600 s) con rutina de supervivencia (recoger, comer, beber) mantiene todas las necesidades en 0–100 sin NaN, guardar y recargar da el mismo estado, y sin comer ni beber el personaje muere, reaparece con ≥ 60 % y sigue vivo. Suite total: 222 casos, ~2,6 M aserciones.
- **README** con compilación, controles, opciones y estructura.
- Rendimiento (Release, Intel UHD): ~8 ms/cuadro con 72 personajes, ~1.270 dibujos (265 de sombra), arranque ~8 s (5,4 s cargando personajes con barra de progreso), ~283 MB de RAM.

## Pendientes conocidos
- Mapas normales/relieve y IBL reales (se aproximan con color base y ambiente constante).
- Clips de acción (`buscar`, `pedir`, `comer`, `dormir`) del personaje: solo existen idle/walk/run, así que las acciones caen en idle.
- Texto en los carteles de la tienda; vista 3D propia del creador; iconos en los menús.
- Al eliminar `web/`: mover `web/public/models` y `web/public/audio` a `native/assets/` y quitar el movimiento de `.gitattributes`/LFS que apunta a `web/`.
