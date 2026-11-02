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

Al iniciar o continuar una partida se mantienen las 22:00 con llovizna inmediata; después el clima sigue su ciclo.

## Sol, luna y cielo

`sunDirection` calcula el sol para la latitud de Bogotá (4,6° N) con la declinación de la época del año: sale por los cerros orientales (−X) hacia las 6:00 y pasa casi por el cenit. La luna tiene fases de 29,5 días y sale más tarde según su fase. Una sola luz direccional con sombra hace de sol o de luna; con ambos bajo el horizonte queda una luz nocturna mínima para que la ciudad siga siendo legible. Con la luna a ras del piso esa luz baja hasta un cuarto y se recupera a medida que sube, sin saltos: si no, rebota en la calzada como una franja blanca de borde duro, y se nota sobre todo hacia las 5:30. El sol no tiene ese límite, porque su hora dorada es rasante a propósito. La luz ambiente y los reflejos salen de un mapa de entorno de día y otro de noche, que se funden sobre una misma textura (`EnvironmentMix`) mientras el sol cruza el horizonte: cerca de un minuto real en cada amanecer y atardecer, sin saltos en el brillo del piso.

El shader de la cúpula (`src/core/Scene.js`) dibuja degradado, disco solar, luna con fase, estrellas y nubes procedurales que derivan con el viento. Se dibuja en el plano lejano, por eso funciona con la distancia de cámara de cualquier calidad. Con cielo cubierto baja la luz directa y sube la ambiental; de noche las nubes reflejan el tono anaranjado de la ciudad. El fondo usa el color del horizonte. La niebla toma el color de la cúpula en la dirección en que se mira, con la misma curva del degradado: un edificio lejano se funde con el cielo que tiene detrás o queda como silueta apenas más oscura, nunca más clara. Suelo y cielo siguen empalmando sin franja.

## Lluvia, rayos y sonido

- La lluvia es un búfer fijo de 1.400 segmentos animados en el vertex shader, anclados al mundo e inclinados por el viento. La CPU solo actualiza uniformes. La calidad baja dibuja el 40 % de las gotas y la media el 70 %.
- Las ondas en el piso aumentan con la intensidad (hasta 36 instancias).
- En tormenta y, a veces, en aguacero, los relámpagos iluminan nubes, cielo y escena con un doble destello. El evento `weather-lightning` dispara un trueno sintetizado con el retraso del sonido según la distancia; pasa por `_fx()` y el volumen maestro.
- El bucle de lluvia ajusta su volumen según la intensidad.
- Los bordes de la pantalla se enfrían mientras el jugador se está congelando: el frío entra de a poco, pesa más con lluvia y se va en un par de segundos junto al fuego.

## Interfaz

El reloj muestra el icono del tiempo (🌙 con la noche despejada) y su título indica el estado y la temporada. La pestaña Estado de la pausa añade las tarjetas Clima y Temporada.

## Rendimiento

Sol, luna y nubes no añaden draw calls. Las nubes usan entre dos y cuatro octavas de ruido según la calidad. Los colores se mezclan sobre objetos reutilizados, sin crear colores en cada cuadro, y la humedad solo se envía a los materiales cuando cambia de forma visible. Las pruebas están en `tests/climate.test.js` y `tests/weather.test.js`; no sustituyen la revisión visual ni la medición de FPS en el equipo del jugador.
