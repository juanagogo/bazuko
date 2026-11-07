# Descarte por edificio, un esqueleto por persona y el desglose del render

Tres cambios que no alteran la imagen y una herramienta para medir. La imagen se comprobó píxel a píxel: en las mismas vistas congeladas, con el cambio y sin él, no cambia ningún píxel (ver «Cómo se midió»).

## Descarte de dos niveles

`FrustumCulling` descartaba por sectores de 64 metros. Dentro de un sector visible, Three recorría cada nodo y probaba cada malla contra el frustum, en la pasada principal y otra vez en la de sombras. Ahora `registerSectorChildren` (`src/core/SectorCulling.js`) registra también los hijos de cada sector con seis nodos o más: edificios, lotes, mobiliario agrupado. Los sectores se registran antes, así que el hijo de un sector oculto ni se prueba.

La caja de cada hijo no es la de su geometría: contiene la esfera de cada malla, que es lo que Three prueba (`Frustum.intersectsObject`). Si alguna malla del hijo habría pasado la prueba de Three en una pasada, la caja también la pasa; por eso el descarte fino nunca quita algo que Three habría dibujado. Las llamadas de dibujo quedan iguales: lo que se ahorra es recorrer y probar nodos.

No se registra un hijo que:

- tenga algo con `userData.update` (se mueve), una malla con piel o un sprite;
- tenga una malla con `frustumCulled = false` que no sea de bruma lejana (`material.userData.pastFar`). La bruma lejana se descarta solo por los lados, como ya hacían los sectores.

Mantenimiento: los hijos de los sectores son estáticos (`freezeStaticTransforms`) y su caja se calcula una vez, al cargar. Si algo dentro de un sector empieza a moverse o crece después de la carga, debe llevar `userData.update` (y entonces no se registra) o volver a registrarse. `tests/sector-culling.test.js` arma la ciudad real y compara, en cuatro lugares, con ocho giros de cámara y la isométrica, lo que dibuja cada pasada con el descarte por sectores y con el de dos niveles.

## Un esqueleto por persona

`SkeletonUtils.clone` le da un `THREE.Skeleton` propio a cada malla con piel del cuerpo, y `attachPart` otro a cada prenda, pelo, barba, calzado y cabeza. Three calcula y sube la textura de huesos una vez por esqueleto y por cuadro en que algo suyo se dibuja: eran 7 u 8 subidas por persona completa y 5 o 6 por liviana, todas con los mismos números.

`shareSkeletons` (`src/character/sharedSkeleton.js`) ata cada malla al esqueleto del cuerpo cuando tiene los mismos objetos `Bone` en el mismo orden y las mismas matrices inversas bit a bit, y libera los esqueletos que quedan sin uso. Lo que difiere aunque sea en 1e-6 conserva su esqueleto. Todas las piezas del catálogo coinciden con su cuerpo; la única excepción en disco, `policia.gltf` (diferencias de hasta 9,4e-6), no está en el catálogo. `buildInstance` lo llama justo antes de crear el mezclador, así que vale para el jugador, los peatones, el dealer y el creador. El `bindMatrix` sigue siendo de cada malla.

Mantenimiento: si algún sistema llama `skeleton.pose()` o `calculateInverses()`, ahora afecta a todas las piezas de esa persona. Mover huesos (animación, ragdoll, posturas) no cambia nada.

## hls.js y el cargador FBX fuera del arranque

Los grupos de bloques de `vite.config.js` metían todo `node_modules` en `vendor` y todo `three` en `three`, incluidos `hls.js` y `FBXLoader`, que el juego solo pide con `import()`. Como `vendor` y `three` son imports estáticos del juego, se descargaban en cada arranque. Ahora `SOLO_A_DEMANDA` los deja fuera de los grupos y quedan en bloques propios que solo baja quien sintoniza una emisora en vivo sin HLS nativo, o a quien le falta un GLB de pelea. Se usa `codeSplitting` en lugar de `advancedChunks`, que Vite 8 da por obsoleto. Se conserva el `hls.js` completo, no `hls.js/light`: el código de la radio no usa nada que le falte a light, pero no hay forma de comprobar sin red que ninguna emisora use audio alterno.

`tests/bundle-chunks.test.js` compila en memoria y falla si `hls.js` o `FBXLoader` entran en algo que baje el arranque, o si sus bloques son solo una reexportación.

| Bloque (`npm run build`) | Antes | Después |
| --- | ---: | ---: |
| `vendor` | 697,6 kB (213,2 gz) | 122,5 kB (34,2 gz) |
| `three` | 744,7 kB (192,3 gz) | 695,1 kB (176,4 gz) |
| `game` | 1.406,5 kB (490,5 gz) | 1.410,3 kB (491,9 gz), con los módulos nuevos |
| `hls` (a demanda) | 1,0 kB, reexporta `vendor` | 575,4 kB (179,3 gz) |
| `FBXLoader` (a demanda) | 0,04 kB, reexporta `three` | 49,8 kB (16,6 gz) |
| JS del arranque (`game` + `three` + `vendor`) | 2.848,8 kB (895,9 gz) | 2.227,8 kB (702,5 gz) |

## Desglose del render

`renderBreakdown(game)` (`src/core/RenderBreakdown.js`), también en `game.getPerformanceReport().breakdown`, da:

- `memoria`: geometrías, texturas y programas que Three tiene en la GPU;
- `ultimoCuadro`: llamadas y triángulos del último cuadro, con sombra y silueta;
- `descarte`: entradas del descarte y cuántas quedan visibles, solo para sombra u ocultas con la cámara actual;
- `escena` y `sombraSol`: nodos recorridos, pruebas de frustum, mallas, llamadas y transparentes de cada pasada, y llamadas y nodos por categoría (`ciudad`, `peatones`, `vehiculos`, `jugador`, `perro`, `otros`);
- `conPiel`: mallas con piel dibujadas y esqueletos distintos, que son las subidas de textura de huesos del cuadro;
- `peatones`: cuántos tienen ya su modelo completo y cuántos se ven con el completo o el liviano.

Recorre la escena entera y crea objetos: es para la consola y el benchmark, nunca por cuadro. Replica las pasadas de Three con el descarte aplicado y lo restaura al terminar.

`npm run benchmark:performance` guarda el desglose de cada vista y cuenta las llamadas WebGL por cuadro (`drawElements`, `drawArrays`, sus variantes instanciadas, `texImage2D`, `texSubImage2D` y `useProgram`) en `glPerFrame`. Las cuenta en una ventana aparte, después de la de FPS (`--gl-segundos`, 3 por defecto; 0 la omite): los contadores se ponen en el prototipo de WebGL solo durante esa ventana y se quitan al terminar, así que los FPS, el p95 y el p99 se miden sin ellos y siguen siendo comparables con informes anteriores (`glCountersDuringFps: false` en el informe). `--memoria` agrega un recorrido por las cuatro vistas, quince segundos en cada una, con muestras de memoria cada 30 segundos (`--memoria-segundos`, 180 por defecto). `--angle metal` pide la GPU en macOS también sin ventana.

## Cómo se midió

Chromium con ANGLE sobre Metal (Apple M5 Pro), 1280 × 720, resolución 1, semilla fija. Con el juego cargado se detuvo el bucle y cada vista se dibujó a mano con el mismo estado, primero con los cambios y después sin ellos (solo las entradas de los sectores y un esqueleto nuevo por malla, como antes). Las imágenes se compararon píxel a píxel: 0 píxeles distintos en las 16 vistas (8 en baja y 8 en media, con sombras). La vista del grupo pone la cámara del lado abierto del peatón con más vecinos a 12 metros, donde se ven 11 de los 13.

| Vista | Calidad | Subidas de textura por cuadro | Esqueletos dibujados | Nodos por pasada |
| --- | --- | ---: | ---: | ---: |
| Inicio | baja | 47 → 9 | 49 → 11 | 3.910 → 3.482 |
| Inicio, girada | baja | 183 → 33 | 184 → 34 | 3.606 → 3.556 |
| Colpatria | baja | 28 → 5 | 31 → 8 | 3.421 → 3.001 |
| Terminal | baja | 23 → 4 | 26 → 7 | 3.037 → 2.529 |
| Grupo de peatones | baja | 111 → 17 | 114 → 20 | 2.469 → 2.327 |
| Cerca de un peatón | baja | 86 → 15 | 88 → 17 | 4.485 → 3.971 |
| Isométrica | baja | 77 → 14 | 79 → 16 | 14.453 → 8.284 |
| Inicio | media | 143 → 25 | 137 → 26 | 5.684 → 5.316 |
| Colpatria | media | 181 → 31 | 176 → 33 | 5.733 → 5.241 |
| Grupo de peatones | media | 119 → 18 | 114 → 20 | 3.231 → 2.945 |
| Cerca de un peatón | media | 170 → 29 | 164 → 30 | 5.939 → 5.595 |
| Isométrica | media | 161 → 28 | 155 → 29 | 15.577 → 11.651 |

Las dos filas «Isométrica» salieron de una vista mal armada (el modo isométrico con la cámara a ras de calle, que veía todas las paredes sueltas de la ciudad); la isométrica real está medida en «La isométrica con lotes». Las llamadas de dibujo y los triángulos son los mismos antes y después en todas las vistas. En calidad media, la pasada de sombras recorre los mismos nodos que la principal. El tiempo de CPU de envío del render bajó entre 0,2 y 1,4 ms por cuadro en esas vistas, pero se midió con la máquina ocupada por otros procesos: es indicativo, no una cifra para citar.

En Node, con la ciudad real y la cámara a 300 metros, el recorrido de las dos pasadas del inicio bajó de 11.035 a 5.496 nodos y de 2,9 a 1,3 ms; en el juego hay menos que ganar porque la niebla, la distancia de dibujo y la visibilidad de los edificios ya ocultan parte de la ciudad.

## La isométrica con lotes

Antes, al pasar a isométrica todos los edificios dejaban sus lotes cerrados y se dibujaban con sus paredes, techos y adornos sueltos, cada pieza con su material, para poder atenuar la que tapa al jugador. Solo se atenúa lo que cruzan las cinco líneas de la cámara al jugador (a tres alturas y a los lados), y eso ocurre con uno a siete edificios a la vez. Los demás, más de 500, gastaban una llamada por pieza, en la pasada principal y en la de sombras.

Ahora `BuildingVisibility` deja en sus lotes cerrados todo edificio que no esté cerca de esas líneas, igual que en tercera persona:

- Un edificio se suelta cuando alguna línea pasa a menos de 1,5 metros de su caja (`LOOSE_MARGIN_IN`) y vuelve al lote cuando todas pasan a más de 3 metros (`LOOSE_MARGIN_OUT`) y sus piezas ya recuperaron la opacidad. Una pared solo se atenúa si una línea toca la caja del edificio, así que siempre está suelta antes de empezar a atenuarse, en el mismo cuadro, y no vuelve al lote a medio fundido.
- Cada lote guarda en qué tramo de su índice está cada edificio (`buildClosedView` los junta edificio por edificio). Cuando uno se suelta, el lote deja de dibujar ese tramo: si queda un solo tramo seguido sigue siendo una llamada; si queda partido, se dibuja por grupos de índice con el mismo material (`geometry.groups`), una llamada más por corte; si no queda nada, se oculta. La geometría y las matrices no cambian.
- Lo transparente (la humedad de las fachadas) sigue suelto en isométrica aunque su edificio vaya en lotes: Three ordena lo transparente por objeto, y fundido en un lote de 64 metros se pintaba encima de una pared a medio atenuar, como una mancha a pleno color. Son pocas piezas.
- Antes de medir cada edificio contra las cinco líneas se mira si toca la caja que las envuelve, ampliada en `LOOSE_MARGIN_OUT`: lo que no la toca está lejos de todas. Sin ese filtro, `update` pasaba de 0,14 a 0,25 ms por cuadro en el inicio; con él queda en 0,04–0,06 ms (antes del cambio, 0,14).
- `isoBatches = false` vuelve a la isométrica de antes (todo suelto). Sirve para comparar en el mismo cuadro.

El descarte de dos niveles no cambia: las raíces de los edificios y los sectores de los lotes siguen registrados con sus cajas de siempre, que cubren lo que se dibuje. El brillo nocturno de las ventanas ya se aplicaba a los dos juegos de materiales (`facadeMats` y `closedMaterials`). El modo foto pasa a tercera persona, así que se ve todo en lotes, como antes. Las colisiones no se tocan.

### Cómo se midió

Chromium con ANGLE sobre Metal (Apple M5 Pro), ventana de 1280 × 720 (baja dibuja a 1088 × 612), semilla fija. Con el juego cargado se detuvo el bucle y cada vista se dibujó a mano dos veces en el mismo estado: con lotes y con `isoBatches = false`. Dos ejecuciones en procesos nuevos; las cifras de la isométrica sin lotes coinciden con las del código anterior medido aparte (678 y 1.942 llamadas en el inicio).

| Vista isométrica | Calidad | Llamadas | Nodos (pasada principal) | CPU del render |
| --- | --- | ---: | ---: | ---: |
| Inicio, día | baja | 671–707 → 455–491 (−31 %) | 3.784 → 2.663 | 3,0 → 2,1 ms |
| Inicio, noche | baja | 678–714 → 462–498 (−31 %) | 3.788 → 2.667 | 3,0 → 2,1 ms |
| Colpatria | baja | 527–543 → 363–379 (−30 %) | 3.098 → 2.234 | 2,1 → 1,6 ms |
| La Candelaria | baja | 432–443 → 268–279 (−37 %) | 2.673 → 1.936 | 1,4 → 1,0 ms |
| Chapinero (una casa atenuada) | baja | 273 → 152 (−44 %) | 1.983 → 1.561 | 1,1 → 0,7 ms |
| Terminal | baja | 76 → 70 (−8 %) | 1.245 → 1.085 | 0,5 → 0,4 ms |
| Inicio, día | media | 1.924–1.978 → 933–987 (−51 %) | 5.389 → 3.511 | 5,5 → 3,5 ms |
| Inicio, noche | media | 2.313–2.355 → 1.090–1.132 (−52 %) | 6.353 → 3.934 | 6,3 → 3,7 ms |
| Colpatria | media | 1.024–1.039 → 564–579 (−45 %) | 3.518 → 2.515 | 3,3 → 2,2 ms |
| La Candelaria | media | 924–935 → 404–415 (−56 %) | 3.067 → 2.094 | 2,5 → 1,6 ms |
| Chapinero | media | 737 → 226 (−69 %) | 2.655 → 1.671 | 2,0 → 1,1 ms |

En media la mayor parte sale de la pasada de sombras: en el inicio, de 1.217 llamadas a 422. Con el juego andando (inicio, 8 segundos por vista, dos ejecuciones por lado), la isométrica pasó de 680 a 454–472 llamadas y de 4,1–4,2 a 3,1–3,2 ms de envío del render en baja, y de 2.179–2.192 a 1.028–1.099 llamadas y de 6,8–7,3 a 4,4 ms en media. Tercera persona no cambia: mismas llamadas, mismos nodos y 0 píxeles distintos.

Seis lugares más, elegidos porque el jugador queda detrás de un edificio, se compararon con las paredes del todo atenuadas, a medio volver (opacidad 0,45), ya opacas y a medio irse (0,55): con lotes, entre 145 y 691 llamadas; sin ellos, entre 180 y 1.642.

La imagen no es idéntica bit a bit: entre el 0,04 % y el 0,75 % de los píxeles cambian. Son de dos clases, y las dos ya separan hoy la tercera persona de la isométrica en el mismo edificio: el relieve (`bumpMap`) de ladrillo y tejas, que deriva la posición en pantalla y cambia en 1 a 4 niveles en píxeles sueltos, y los bordes donde un alféizar o una cornisa casi coinciden con la pared, cuyo dibujo de dientes cambia de sitio (hasta 100 niveles en un píxel). La geometría del lote está ya transformada al mundo y la de la pieza suelta la transforma la GPU: el redondeo es otro. Aumentadas dos y tres veces, las capturas no se distinguen, salvo esos dientes, que también parpadean al mover la cámara. Ninguna pieza falta ni sobra (`tests/visibility.test.js` cuenta los índices dibujados).

Mantenimiento: un lote solo puede saltarse los tramos de edificios enteros. Si algo nuevo se agrega a las piezas de un edificio después de `buildClosedView`, no queda en su tramo. Un material transparente nuevo en una fachada, o una malla con varios materiales (no entra en ningún lote), queda suelto en isométrica sin hacer nada; en tercera persona esa malla de varios materiales no se ve, como antes.

## Lo que no se hizo

- **Armar en segundo plano los modelos completos lejanos.** El dueño lo permite si nada aparece de golpe cerca de la cámara. Medido al entrar (semilla fija): las 96 personas precargadas (peatones y las de las escenas de calle) tienen su modelo completo armado y ninguna lo está mostrando; 63 caminan a más de 30 metros. Cada completo tiene 0,87 MB de geometría propia de mediana (máximo 1,41 MB) y 0,47 MB compartida con otros, en promedio. Los 63 lejanos suman 57 MB de geometría propia, de 87 MB para todos; el montón de JavaScript marca 670 MB. Esa geometría vive en la memoria de JavaScript: Three la sube a la GPU la primera vez que la dibuja, y al entrar hay 1.122 geometrías en la GPU. Las imágenes no cuentan: cada imagen de un completo la usa también otra persona (las de todas suman 188 MB sin comprimir), y `Renderer.prepare` ya las sube al cargar. Armarlos en segundo plano solo aplaza esa memoria: al terminar la cola, el consumo es el mismo. Para bajarla de verdad habría que soltar el completo de quien se aleja y rearmarlo al volver, que es otro cambio, con riesgo de ver el liviano de cerca. En tiempo, armar un completo con sus archivos ya cargados toma 1,4 ms de mediana (30 en 44 ms): para los 92 peatones son unos 130 ms de la carga. No se hizo: la ganancia es pequeña y transitoria.
- **Reutilizar los `Set` de `CollisionSystem.setVehicles`.** Medido en Node con una generación joven grande, la versión con `clear()` asignaba más memoria por llamada que la actual (638 frente a 40 bytes): V8 rehace la tabla al vaciarla. Se dejó como estaba.
- **Sombras a 30 Hz.** Cambia la imagen: decisión del dueño.
- **La vista isométrica** quedó hecha después: ver «La isométrica con lotes». Las 3.500 y 5.800 llamadas que se anotaron aquí salieron de una vista mal armada: el modo isométrico con la cámara a ras de calle, que veía todas las paredes sueltas de la ciudad. Con la cámara isométrica de verdad eran 680 en baja y 1.940 en media.
- **Descartar peatones por grupo.** Sus huesos son un tercio de los nodos recorridos en las vistas con gente (hasta 2.000 de 5.300), pero el modelo completo, que sí proyecta sombra, se pone después de registrar el descarte, y su pose puede salir de cualquier caja fija. Ahorraría unos 0,2 ms por pasada.
