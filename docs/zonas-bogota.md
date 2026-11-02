# Zonas de Bogotá y borde de la ciudad

La ciudad se amplió de 240 a 400 metros de ancho, solo hacia +X. Nada de lo anterior cambió de lugar: las partidas guardadas abren igual, delante del cambuche, y las pruebas comparan tile por tile que los lotes y las casas de la parte vieja dan lo mismo que antes. Las colisiones sí crecieron: los cierres del borde suman cajas también en esa parte, pero cada entrada al juego empieza frente al cambuche, así que nadie aparece dentro de una. La columna X 238, que era el muro del oriente, ahora es manzana o calle: las calles del centro siguen hasta la Carrera 5 (X 256–266), que recorre la ciudad de norte a sur y separa el centro de los barrios nuevos.

## La Candelaria (X 267–400, Z 0–121)

Casas de uno y dos pisos con paredes encaladas o de colores (ocre, añil, almagre, blanco manchado), zócalo oscuro, techo de teja de barro a dos aguas y alero de madera. Balcones de madera, jardineras con flores, puertas talladas, ventanas con reja de hierro y faroles de pared. En algunas culatas hay murales inventados, sin marcas.

- **Calles.** Empedradas, más angostas (cuatro tiles de calzada) y con andenes de piedra de un tile. `neighborhoodAt(x, z).streets` lleva `{ cobbles: true, paintedLines: false }`; quien pinta la calzada debe respetarlo.
- **Plaza de la Candelaria.** Losas de piedra, fuente en el centro, bancas, bandada de palomas y un vendedor de tinto. La iglesia colonial de dos torres ocupa el costado oriental; es decoración sólida, no se entra, pero las gradas del atrio se pisan a su altura.
- **Carreras 4 y 3.** Recorren los dos barrios de norte a sur: en la Candelaria son de piedra y en Chapinero de asfalto. La plaza interrumpe la Carrera 4 entre Z 35 y Z 75; ahí no hay calle.

## Chapinero y Teusaquillo (X 267–400, Z 121–320)

Ladrillo rojo, casas de estilo inglés con hastiales y ventanas en saliente, antejardín con reja y seto, árboles más grandes y andenes de tres tiles (seis metros).

- **Calle 7 comercial.** Locales con cortina metálica, toldo y avisos inventados, y un puesto de fritanga.
- **Plaza de mercado.** Seis puestos con toldos de lona o a franjas, canastas de fruta y verdura, y costales. Bloquea el paso solo por donde hay mesas.
- **Parque de Teusaquillo y torres de ladrillo.** Tres arcos curvos de ladrillo, escalonados, inspirados en los conjuntos de ladrillo bogotanos. Sólidos en su curva real: la colisión son tiras de medio metro que siguen la planta (`towerColliderBoxes`). Se ven desde todo el barrio: su bruma tiene tope y ni la cámara ni el descarte las cortan en el plano lejano. Cerca del horizonte, torres, cerros y ciudad de fondo se hunden en una bruma que depende del ángulo de la mirada: con neblina, lluvia, al atardecer o de noche sube más y con el día despejado queda abajo, para que la ciudad real, que a esa distancia ya es solo niebla, no se recorte contra ellos.

## El borde

El tile `wall` sigue sólido en las cuatro orillas, pero ya no se dibuja como muro. `CityEdge.js` lo viste según lo que tiene al frente:

| Al frente | Qué se ve | Colisión |
| --- | --- | --- |
| Calle o andén | Cierre de obra: lámina, tablas, malla sobre varas, aviso «Vía cerrada», separadores, barreras de franjas, conos | Una franja de 2,4 m delante del tile: nadie se pega a la lámina, salvo en el carril del bus |
| Parque | Seto, reja de hierro y pilares de ladrillo | La del tile |
| Manzana | Un edificio de fondo que sale hacia afuera | La del tile |

El carril del bus queda sin barreras, conos ni franja: el articulado arranca con la cola junto al cierre, y a pie se llega hasta la lámina, que tiene una losa de asfalto al pie. Bajo la rampa del puente del lago y a lo largo de sus estribos sigue el piso de asfalto hasta esa losa. Los costados de la terminal llevan reja y su final de vía lleva cierre de obra; antes se veía la colisión invisible como una pared gris.

Detrás de todo está `CityBackdrop.js`: **de tres a siete llamadas de dibujo** por vista, sin colisiones y excluidas de los sectores. El cerro siempre se dibuja; de los bloques, solo los costados que caben en cuadro.

- **Suelo y cerros.** Una sola malla en anillo, con las calles que siguen detrás de los cierres.
- **Bloques.** Unos 3.000 ejemplares de una caja de cinco caras, entre edificios, cuartos de azotea y casitas. Pisos, ventanas, alféizares y luces de noche salen del sombreador, según la escala de cada ejemplar, sin texturas.
- **Más allá de la Candelaria,** hacia +X, un cerro alto con iglesia blanca en la cumbre, torres de teleférico y cabinas.
- **Al sur,** un barrio de ladrillo trepando la ladera, con casitas que se encienden de noche.

## Tráfico, gente y mapa

- **Carros.** Dos circuitos más (ocho carros), siempre girando a la derecha, para que las calles de cuatro tiles nunca crucen el sentido contrario. Los carros del oriente y los del centro **no comparten carril**: si se mezclan, los cruces anchos de la Caracas reciben más de los que despachan. No parquean en las calles angostas.
- **Semáforos.** Solo en los cruces de la Carrera 5 con las calles de la red de siempre; dentro de los barrios no hay.
- **Peatones.** 14 más y dos vendedores, todos dentro del oriente. La población del centro sigue igual.
- **Basura y parqueados.** `getSpawnGrid` incluye los andenes y las plazas nuevas, pero no la fuente, los puestos ni lo que queda detrás de un cierre; en toda la ciudad descarta además los puntos donde un cuerpo no cabe, pegados a una caja sólida. `populationScale` subió de 3 a 4,6 para que el centro conserve la densidad de bolsas y carros parqueados que tenía.
- **Mapa.** Radar y mapa grande pintan las zonas desde los mismos tiles, sin deformarse. Nombran Plaza de la Candelaria, Parque de Teusaquillo, Torres de ladrillo y Plaza de mercado, y el GPS llega a pie.

## Reglas para seguir construyendo aquí

- **Azar local.** La arquitectura se siembra por coordenada, nunca con `Math.random`, para que la misma partida vea las mismas casas.
- **Materiales compartidos.** Un solo juego por ciudad (`createZoneMaterials`), con hojas de textura y celdas por nombre (`detailRect`). Las fachadas nuevas no pasan de doce texturas.
- **Vista isométrica.** Toda casa pasa por `createBuildingShell` y `BuildingVisibility`: techos y aleros son piezas `roof`, los balcones `walls`. Así se recortan al acercarse. Cada torre curva son varios edificios, uno por tramo de arco: la caja de la torre entera abarcaría la plaza de su lado cóncavo y no se abriría. Su silueta del fondo no se dibuja en isométrica, porque taparía al jugador.
- **Noche.** Sin luces por casa: las ventanas encendidas viven en el mapa emisivo; solo uno de cada varios faroles de pared lleva `PointLight`, que entra al grupo limitado de luces locales. Ese farol y los de la plaza dejan un charco pintado en el lote de luz de la calle, partido por tiles para seguir la altura del piso y no subirse a los muros; se ve aunque su luz real esté apagada por el límite.
- **Sin navegador.** Toda textura de canvas se protege con `typeof document`: las pruebas corren en Node.
- **Sin marcas.** Avisos, murales y rótulos son inventados.
- **Costo a vigilar.** El fondo está partido en ocho costados y solo se dibujan los que caben en cuadro: unos 33 mil triángulos en total, de los que una vista a la altura de la calle gasta entre 9 y 26 mil en tres a siete llamadas. Más ejemplares no suman llamadas, pero sí triángulos.
