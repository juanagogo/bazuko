# Descarte por edificio, la isométrica con lotes y el desglose del render

Dos cambios en lo que se manda a dibujar y una herramienta para medirlo. El descarte por edificio no cambia la imagen ni las llamadas: recorre menos nodos. La isométrica con lotes baja las llamadas de dibujo, sube algo los triángulos y cambia píxeles sueltos (ver «Cómo se midió»).

## Descarte de dos niveles

`FrustumCulling` descartaba por sectores de 64 metros. Dentro de un sector visible, Three recorría cada nodo y probaba cada malla contra el frustum, en la pasada principal y otra vez en la de sombras. Ahora `registerSectorChildren` (`src/core/SectorCulling.js`) registra también los hijos de cada sector con seis nodos o más: edificios, lotes, mobiliario agrupado. Los sectores se registran antes, así que el hijo de un sector oculto ni se prueba.

La caja de cada hijo no es la de su geometría: contiene la esfera de cada malla, que es lo que Three prueba (`Frustum.intersectsObject`). Si alguna malla del hijo habría pasado la prueba de Three en una pasada, la caja también la pasa; por eso el descarte fino nunca quita algo que Three habría dibujado. Las llamadas de dibujo quedan iguales: lo que se ahorra es recorrer y probar nodos. Una rama fuera de cuadro que proyecta sombra dentro del frustum del sol se queda, igual que un sector.

No se registra un hijo que:

- tenga algo con `userData.update` (se mueve), una malla con piel o un sprite;
- tenga una malla con `frustumCulled = false` que no sea de bruma lejana (`material.userData.pastFar`). La bruma lejana se descarta solo por los lados, como ya hacían los sectores.

Mantenimiento: los hijos de los sectores son estáticos (`freezeStaticTransforms`) y su caja se calcula una vez, al cargar. Si algo dentro de un sector empieza a moverse o crece después de la carga, debe llevar `userData.update` (y entonces no se registra) o volver a registrarse. `tests/sector-culling.test.js` arma la ciudad real y compara, en cuatro lugares, con ocho giros de cámara y la isométrica, lo que dibuja cada pasada con el descarte por sectores y con el de dos niveles.

## La isométrica con lotes

Antes, al pasar a isométrica todos los edificios dejaban sus lotes cerrados y se dibujaban con sus paredes, techos y adornos sueltos, cada pieza con su material, para poder atenuar la que tapa al jugador. Solo se atenúa lo que cruzan las cinco líneas de la cámara al jugador (a tres alturas y a los lados), y eso ocurre con unos pocos edificios a la vez. Los demás, más de 500, gastaban una llamada por pieza, en la pasada principal y en la de sombras.

Ahora `BuildingVisibility` deja en sus lotes cerrados todo edificio que no esté cerca de esas líneas, igual que en tercera persona:

- Un edificio se suelta cuando alguna línea pasa a menos de 1,5 metros de su caja (`LOOSE_MARGIN_IN`) y vuelve al lote cuando todas pasan a más de 3 metros (`LOOSE_MARGIN_OUT`) y sus piezas ya recuperaron la opacidad. Una pared solo se atenúa si una línea toca la caja del edificio, así que siempre está suelta antes de empezar a atenuarse, en el mismo cuadro, y no vuelve al lote a medio fundido.
- Cada lote guarda en qué tramo de su índice está cada edificio (`buildClosedView` los junta edificio por edificio). Cuando uno se suelta, el lote deja de dibujar ese tramo: si queda un solo tramo seguido sigue siendo una llamada; si queda partido, se dibuja por grupos de índice con el mismo material (`geometry.groups`), una llamada más por corte; si no queda nada, se oculta. La geometría y las matrices no cambian.
- Lo transparente (la humedad de las fachadas) sigue suelto en isométrica aunque su edificio vaya en lotes: Three ordena lo transparente por objeto, y fundido en un lote de 64 metros se pintaba encima de una pared a medio atenuar, como una mancha a pleno color. Son pocas piezas.
- Antes de medir cada edificio contra las cinco líneas se mira si toca la caja que las envuelve, ampliada en `LOOSE_MARGIN_OUT`: lo que no la toca está lejos de todas.
- `isoBatches = false` vuelve a la isométrica de antes (todo suelto). Sirve para comparar en el mismo cuadro. `isoStats` dice cuántos edificios van sueltos y cuántos lotes quedaron partidos u ocultos.

El descarte de dos niveles no cambia con esto: las raíces de los edificios y los sectores de los lotes siguen registrados con sus cajas de siempre, que cubren lo que se dibuje. El brillo nocturno de las ventanas ya se aplicaba a los dos juegos de materiales (`facadeMats` y `closedMaterials`). El modo foto pasa a tercera persona, así que se ve todo en lotes, como antes. Las colisiones no se tocan.

Mantenimiento: un lote solo puede saltarse los tramos de edificios enteros. Si algo nuevo se agrega a las piezas de un edificio después de `buildClosedView`, no queda en su tramo. Un material transparente nuevo en una fachada, o una malla con varios materiales (no entra en ningún lote), queda suelto en isométrica sin hacer nada; en tercera persona esa malla de varios materiales no se ve, como antes.

## Desglose del render

`renderBreakdown(game)` (`src/core/RenderBreakdown.js`), también en `game.getPerformanceReport().breakdown`, da:

- `memoria`: geometrías, texturas y programas que Three tiene en la GPU;
- `ultimoCuadro`: llamadas y triángulos del último cuadro, con sombra y silueta;
- `descarte`: entradas del descarte y cuántas quedan visibles, solo para sombra u ocultas con la cámara actual;
- `escena` y `sombraSol`: nodos recorridos, pruebas de frustum, mallas, llamadas y transparentes de cada pasada, y llamadas y nodos por categoría (`ciudad`, `peatones`, `vehiculos`, `jugador`, `perro`, `otros`);
- `conPiel`: mallas con piel dibujadas y esqueletos distintos, que son las subidas de textura de huesos del cuadro;
- `peatones`: cuántos tienen ya su modelo completo y cuántos se ven con el completo o el liviano.

Recorre la escena entera y crea objetos: es para la consola y para medir, nunca por cuadro. Replica las pasadas de Three con el descarte aplicado y lo restaura al terminar.

`countGlCalls` (`tools/contar-llamadas-gl.mjs`) cuenta las llamadas WebGL por cuadro: `drawElements`, `drawArrays`, sus variantes instanciadas, `texImage2D`, `texSubImage2D` y `useProgram`. Se le pasa a la página desde un guion de Playwright (`page.evaluate(countGlCalls, ms)`); pone los contadores en el prototipo de WebGL solo durante esa ventana y lo deja como estaba al terminar.

## Cómo se midió

Chromium con ANGLE sobre Metal (Apple M5 Pro), ventana de 1280 × 720, semilla fija. Con el juego cargado se congelan el reloj y el bucle, se pone al jugador en un punto y se dibuja el mismo cuadro, con el bucle del juego y sin avanzar el tiempo, en cuatro estados: como queda ahora; con `isoBatches = false`; sin las entradas del segundo nivel del descarte; y sin ninguna de las dos cosas, que es lo de antes. Cada estado se lee del framebuffer y se compara píxel a píxel con los demás. Las llamadas son `renderer.info.render.calls`, y `countGlCalls` dio el mismo número en todas las filas. Los nodos son los de `breakdown.escena`. Son seis puntos (el cambuche del inicio, Colpatria, el lago, la terminal, la plaza de La Candelaria y la plaza de mercado), dos vistas, tres calidades, de día (10:00) y de noche (22:00). No son medidas de FPS.

**Tercera persona.** Llamadas y triángulos iguales en las 36 filas, de día y de noche, y la misma imagen: 0 píxeles distintos en 35 (la otra es la de la terminal, de la que se habla al final). Se recorren entre un 3 % y un 15 % menos de nodos por pasada (por ejemplo, 5.917 → 5.557 en el inicio en media). Es una mejora chica.

**Isométrica**, de día (antes → ahora):

| Calidad | Punto | Llamadas | Triángulos | Nodos recorridos | Píxeles distintos |
| --- | --- | ---: | ---: | ---: | ---: |
| baja | Inicio (cambuche) | 731 → 513 (−30 %) | 359.302 → 406.206 (+13 %) | 7.976 → 2.847 (−64 %) | 461 (0,07 %) |
| baja | Colpatria | 530 → 359 (−32 %) | 262.812 → 294.504 (+12 %) | 7.623 → 2.392 (−69 %) | 855 (0,13 %) |
| baja | Lago | 395 → 308 (−22 %) | 309.299 → 331.031 (+7 %) | 6.436 → 2.127 (−67 %) | 74 (0,01 %) |
| baja | Terminal | 82 → 76 (−7 %) | 122.171 → 119.431 (−2 %) | 1.870 → 1.125 (−40 %) | 0 |
| baja | Plaza de la Candelaria | 318 → 214 (−33 %) | 205.876 → 259.261 (+26 %) | 6.350 → 1.977 (−69 %) | 51 (0,01 %) |
| baja | Plaza de mercado | 338 → 200 (−41 %) | 248.883 → 306.496 (+23 %) | 5.363 → 1.685 (−69 %) | 816 (0,12 %) |
| media | Inicio (cambuche) | 2.188 → 1.071 (−51 %) | 894.762 → 1.057.540 (+18 %) | 11.697 → 4.060 (−65 %) | 459 (0,05 %) |
| media | Colpatria | 1.380 → 660 (−52 %) | 774.154 → 829.112 (+7 %) | 9.308 → 2.971 (−68 %) | 1.139 (0,12 %) |
| media | Lago | 456 → 371 (−19 %) | 544.186 → 568.242 (+4 %) | 8.577 → 2.460 (−71 %) | 155 (0,02 %) |
| media | Terminal | 491 → 198 (−60 %) | 314.956 → 343.702 (+9 %) | 4.579 → 1.690 (−63 %) | 0 |
| media | Plaza de la Candelaria | 930 → 373 (−60 %) | 524.049 → 627.093 (+20 %) | 8.184 → 2.537 (−69 %) | 72 (0,01 %) |
| media | Plaza de mercado | 842 → 364 (−57 %) | 667.378 → 763.535 (+14 %) | 6.532 → 2.122 (−68 %) | 1.200 (0,13 %) |
| alta | Inicio (cambuche) | 2.219 → 1.102 (−50 %) | 957.454 → 1.120.232 (+17 %) | 11.753 → 4.116 (−65 %) | 489 (0,05 %) |
| alta | Colpatria | 1.410 → 690 (−51 %) | 804.309 → 859.267 (+7 %) | 9.330 → 2.993 (−68 %) | 1.111 (0,12 %) |
| alta | Lago | 458 → 373 (−19 %) | 546.418 → 570.474 (+4 %) | 8.667 → 2.550 (−71 %) | 199 (0,02 %) |
| alta | Terminal | 495 → 202 (−59 %) | 323.958 → 352.704 (+9 %) | 4.695 → 1.806 (−62 %) | 0 |
| alta | Plaza de la Candelaria | 935 → 378 (−60 %) | 525.873 → 628.917 (+20 %) | 8.101 → 2.454 (−70 %) | 73 (0,01 %) |
| alta | Plaza de mercado | 843 → 365 (−57 %) | 652.124 → 748.281 (+15 %) | 6.525 → 2.115 (−68 %) | 1.045 (0,11 %) |

Sumando los seis puntos, las llamadas bajan un 30 % en baja (2.394 → 1.670), un 52 % en media (6.287 → 3.037) y un 51 % en alta (6.360 → 3.110); de noche, un 30 %, un 52 % y un 52 %. En media y alta se ahorra más porque cada pieza suelta se dibujaba también en la pasada de sombras, que en baja no existe. Los triángulos suben entre un 12 % y un 14 % de día y entre un 14 % y un 17 % de noche: un lote de 64 metros se dibuja entero aunque solo asome una esquina, y las piezas sueltas se descartaban una por una. Es el mismo trato que ya tiene tercera persona: menos llamadas y algunos triángulos más.

La imagen de la isométrica no es idéntica bit a bit: en esos puntos cambia entre el 0 % y el 0,13 % de los píxeles, todo por los lotes y nada por el descarte de dos niveles (con lotes, prender y apagar el segundo nivel dio 0 píxeles distintos en las 72 filas). Son de dos clases, y las dos ya separan hoy la tercera persona de la isométrica en el mismo edificio: el relieve (`bumpMap`) de ladrillo y tejas, que deriva la posición en pantalla y cambia de 1 a 4 niveles en píxeles sueltos, y los bordes donde un alféizar o una cornisa casi coinciden con la pared, cuyo dibujo de dientes cambia de sitio en líneas de un píxel de alto (hasta 124 niveles en un píxel). Donde dos caras coinciden del todo, como el remate de una viga o de una cornisa, ya se pelean la profundidad en `develop` y lo que cambia es el dibujo de esa pelea, en franjas de varios píxeles: en media, junto a (207, 118) y a (150, 69), cambió el 0,85 % y el 0,80 % de los píxeles (7.802 y 7.373 de 921.600), casi la mitad con más de 32 niveles. La geometría del lote está ya transformada al mundo y la de la pieza suelta la transforma la GPU: el redondeo es otro. Ninguna pieza falta ni sobra (`tests/visibility.test.js` cuenta los índices dibujados).

Moviendo la cámara (a las 16:30, con sombras largas; en cuatro de los puntos, ocho giros de 45° en tercera persona y ocho pasos de 3 a 9 metros en isométrica, en las tres calidades: 192 encuadres), el descarte de dos niveles no cambió ningún píxel en ninguno. En isométrica las llamadas bajaron entre un 23 % y un 70 % por encuadre en media y alta, y entre un 0 % y un 35 % en baja; hubo dos edificios sueltos a la vez como mucho, y el peor encuadre cambió el 0,36 % de los píxeles. Caminando 45 metros en isométrica desde (262, 232), en media, el peor fue el 0,73 %.

El mismo estado dibujado dos veces dio 0 píxeles distintos en las 72 filas. Lo único que se salió fue la terminal en alta y tercera persona: de día, uno de los cuatro estados difirió de los otros tres en 36 píxeles, y de noche esos mismos 36 píxeles aparecieron al repetir el cuadro sin ninguno de estos cambios. Es el parpadeo de un aviso de neón (`neonSign`, en `src/world/bogota/props.js`), que baja el brillo un 40 % en un cuadro de cada 67, más o menos, también con el reloj congelado: forzándolo en el aviso que se ve desde ahí, a 76 metros, cambian esos mismos 36 píxeles, y sin él, ninguno. No es del descarte.

## Lo que no se hizo

- **Descartar peatones por grupo.** Sus huesos son buena parte de los nodos recorridos en las vistas con gente, pero el modelo completo, que sí proyecta sombra, se pone después de registrar el descarte, y su pose puede salir de cualquier caja fija.
- **Lotes más chicos en isométrica**, para no subir triángulos: serían más llamadas, que es lo que se quería bajar.
