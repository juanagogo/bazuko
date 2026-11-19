# Clima, temporadas y cielo

El tiempo de Bogotá combina un reloj astronómico, temporadas y estados del tiempo que cambian de forma gradual. Todo se calcula con datos ligeros: el cielo es una sola malla y la lluvia cae en la GPU.

## Temporadas

Cada temporada dura cuatro días de juego (`DAYS_PER_SEASON` en `src/world/Climate.js`); el día 1 abre la temporada seca. Siguen el régimen bimodal de la ciudad:

| Temporada | Meses que representa | Rasgos |
| --- | --- | --- |
| 🌞 Temporada seca | dic – feb | Más sol y madrugadas con heladas (más frío nocturno). |
| 🌧️ Primeras lluvias | mar – may | Llovizna y aguaceros frecuentes, tormentas ocasionales. |
| 🪁 Veranillo de vientos | jun – ago | Cielo abierto y viento fuerte: nubes y lluvia se mueven más rápido. |
| ⛈️ Segundas lluvias | sep – nov | La temporada más húmeda y con más tormentas. |

La temporada se deriva del día guardado, así que el formato del guardado no cambia.

## Estados del tiempo

Soleado, parcialmente nublado, nublado, neblina, llovizna, aguacero y tormenta eléctrica. Cada uno define cobertura de nubes, intensidad de lluvia, viento, bruma y probabilidad de rayos. Cada tres a seis minutos se elige el siguiente estado con los pesos de la temporada:

- No hay saltos de más de dos niveles: el sol no pasa directo a la tormenta.
- La neblina solo aparece de madrugada (4:00–9:30).
- La transición dura alrededor de un minuto: primero se cierran las nubes y después empieza la lluvia; al escampar, la lluvia se va primero.
- `isRaining` se deriva de la intensidad mezclada. La humedad del asfalto sube según la intensidad y se seca más rápido con sol.

Una partida nueva empieza a las 6:00, soleada y con el asfalto seco; una guardada conserva su hora. Después el clima sigue su ciclo. En `npm run dev`, pedir un estado que no existe avisa en la consola en vez de quedarse callado.

## Sol, luna y cielo

`sunDirection` calcula el sol para la latitud de Bogotá (4,6° N) con la declinación de la época del año: sale por los cerros orientales (−X) hacia las 6:00 y pasa casi por el cenit. La luna tiene fases de 29,5 días y sale más tarde según su fase. Una sola luz direccional con sombra hace de sol o de luna; con ambos bajo el horizonte queda una luz nocturna mínima para que la ciudad siga siendo legible. Con la luna a ras del piso esa luz baja hasta un cuarto y se recupera a medida que sube, sin saltos: si no, rebota en la calzada como una franja blanca de borde duro, y se nota sobre todo hacia las 5:30. El sol no tiene ese límite, porque su hora dorada es rasante a propósito. La luz ambiente y los reflejos salen de un mapa de entorno de día y otro de noche, que se funden sobre una misma textura (`EnvironmentMix`) mientras el sol cruza el horizonte: cerca de un minuto real en cada amanecer y atardecer, sin saltos en el brillo del piso.

El shader de la cúpula (`src/core/Scene.js`) dibuja el degradado, el disco solar, la luna con fase y las estrellas. Las nubes diurnas (`SkyClouds.js`) tienen un banco bajo con base sombreada y un velo alto. Cada estrato se proyecta desde su altura y deriva con el viento. En aguacero la cobertura se vuelve continua y se funde al acercarse al horizonte. La cúpula se dibuja en el plano lejano de cada calidad. Con cielo cubierto baja la luz directa y sube la ambiental; de noche las nubes reflejan el tono anaranjado de la ciudad. El fondo usa el color del horizonte. La niebla toma el color de la cúpula en la dirección en que se mira, con la misma curva del degradado: un edificio lejano se funde con el cielo que tiene detrás o queda como silueta apenas más oscura, nunca más clara. En manzanas, suelo y cerros del fondo, `BackdropMist.js` calcula la bruma según la altura del trayecto, la distancia y el clima. Se concentra cerca del suelo y se abre de forma gradual hacia las cumbres.

Desde lo alto (con la cámara sobre 14 m, `skyFogAloft` en `Scene.js`) la niebla de la noche y la neblina de la mañana pesan menos: la distancia que cuenta para la niebla se acorta un 30 %, la neblina baja de la madrugada pesa la mitad y el velo queda más hondo que el cielo (a medio camino pierde un 45 % de noche y un 15 % de mañana, y de noche lo que queda bajo el horizonte se oscurece hasta un 30 %). La cúpula se oscurece igual bajo el horizonte, para que donde no hay ciudad no quede un parche claro. A pie de calle, y a mediodía despejado, no cambia nada. Quien llama a `skyFogMix` con su propia bruma, como `ZoneGeometry.js` y `CityBackdrop.js`, hereda el oscurecido.

El amanecer y el atardecer tienen paletas distintas en `Scene.js`. De mañana el sol bajo, el relleno, el cielo y las nubes toman `SUN.dawn`, `HEMI.dawn`, `SKY.dawnTop` y `SKY.dawnHorizon`, y `CLOUD.dawnLight` y `CLOUD.dawnShadow`: luz pálida y fría. De tarde toman `SUN.low`, `HEMI.twilight`, `SKY.twilightTop` y `SKY.twilightHorizon`, y `CLOUD.twilightLight` y `CLOUD.twilightShadow`: sol rosado y sombras malva. La cantidad de luz y la exposición solo dependen de la altura del sol; la paleta pasa de la de la mañana a la de la tarde entre las 11:00 y las 13:00 y vuelve entre las 23:00 y la medianoche, así que a medianoche nada salta.

El grado de color es una curva propia sobre la fílmica de three (`src/core/gradoColor.js`). `Renderer.js` la pide con `mapeoDeGrado`, que reescribe `THREE.ShaderChunk` para toda la página: cualquier lienzo que dibuje con `CustomToneMapping` toma la curva del juego. Una pantalla nueva que quiera la curva fílmica de three tiene que pedir `ACESFilmicToneMapping`, como hace el creador de personaje (`Creator.js`). De noche, lo que no está bajo un farol pierde naranja y vira al azul, y lo más oscuro sube para que la calzada y el prado se lean; el color de la noche entra más tarde que el pie de la noche, así que una tarde nublada o con llovizna queda gris y no azul.

## Lluvia, rayos y sonido

- La lluvia es un búfer fijo de 1.400 gotas animadas en el vertex shader, ancladas al mundo e inclinadas por el viento. Cada gota es un cuadro que mira a la cámara y se estira en la dirección de caída, con un ancho mínimo en píxeles para que no desaparezca de lejos; se apaga entre 18 y 34 m y, de noche, se aclara cerca de los faroles más próximos. La CPU solo actualiza uniformes. La calidad baja dibuja el 40 % de las gotas y la media el 70 %.
- Con lluvia caen además cortinas en tres anillos (24, 13 y 7 m) alrededor de la cámara, o del jugador si la cámara está lejos, como en la isométrica: rayas por columna y, en el anillo lejano, un velo del color de la niebla que cierra el fondo. En calidad baja solo se dibuja el anillo lejano.
- Las salpicaduras aumentan con la intensidad (hasta 36 instancias) y nacen delante de la cámara: tres gotitas se aplanan antes de abrir su aro, y algo menos de la mitad levanta además una corona. El aro es un material propio sin luz (`BogotaSalpicadura`, un solo `InstancedMesh`): toma el color de la lluvia a medio camino de su gris, con tope, así que nunca queda blanco, ni con el rayo; tiene el borde blando, se apaga con la edad (`aAge`) y con la distancia (de 4 a 12-16 m de la cámara) y saca de su lugar, sin azar del juego, su giro, su grosor, cuánto dura su brillo y si levanta corona. Vida y tamaño cambian de una a otra con los mismos sorteos de antes: casi todas chicas y unas pocas más abiertas.
- El filo del viaducto gotea cerca del jugador (`goteo.js`): hilos que cuelgan del borde real del tablero, sin gastar azar; en seco o lejos del viaducto no hay nada.
- Las cortinas y el goteo cuelgan de las gotas (`rainParticles`), que `game.js` deja visibles mientras prepara los programas al cargar: las cortinas se compilan con ellas. El goteo, apagado lejos del viaducto, compila su programa en el primer aguacero junto a él.
- En tormenta y, a veces, en aguacero, los relámpagos iluminan nubes, cielo y escena con un doble destello. El evento `weather-lightning` dispara un trueno sintetizado con el retraso del sonido según la distancia; pasa por `_fx()` y el volumen maestro.
- El bucle de lluvia ajusta su volumen según la intensidad.
- Los bordes de la pantalla se enfrían mientras el jugador se está congelando: el frío entra de a poco, pesa más con lluvia y se va en un par de segundos junto al fuego.

## Interfaz

El reloj muestra el icono del tiempo (🌙 con la noche despejada) y su título indica el estado y la temporada. La pestaña Estado de la pausa añade las tarjetas Clima y Temporada.

## Rendimiento

Sol, luna y nubes no añaden draw calls. Los estratos diurnos comparten el mapa de ruido de las nubes. En baja se omite una consulta de iluminación lateral. Los colores se mezclan sobre objetos reutilizados, sin crear colores en cada cuadro, y la humedad solo se envía a los materiales cuando cambia de forma visible. Las pruebas están en `tests/climate.test.js` y `tests/weather.test.js`; no sustituyen la revisión visual ni la medición de FPS en el equipo del jugador.
