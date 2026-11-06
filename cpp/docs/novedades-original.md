# Novedades del juego original que el port en C++ aún no tiene

Revisión hecha el 5 de noviembre de 2026 contra `juanagogo/bazuko` (`origin/main`, 437d0fe), comparando lo que hay en `src/` con lo que ya existe en `cpp/`.
Hay dos grupos: lo **anterior a la base del port** que nunca se pasó a C++ (fumar y las sustancias, del 28 de octubre) y lo **nuevo de esta semana** (4 y 5 de noviembre).

El port ya tiene: abstinencia y psicosis por vicio (`Simulation::UpdatePsychosis`), dealer, GPS a pie, radar, mapa grande y radio sintetizada.

## 1. Fumar y drogarse (28 de octubre en adelante) — **hecho en el port**

| Qué | En el original | En el port |
|---|---|---|
| **Fumar un cigarrillo o un porro** | `src/character/smoking.js`: el cigarrillo en la mano izquierda, calada cada 30 s (sube la mano a la boca, aspira 1,4 s, baja y bota el humo), dura 10 min, se puede fumar caminando; brasa que se aviva; humo en sprites (90 reutilizables) | No existe. Hay que modelar el cigarrillo (cilindros con brasa), la pose del brazo izquierdo sobre la animación (el port ya tiene giros de huesos por código: `Model::BoneTurn`) y el humo (partículas ya usadas por el fuego y la lluvia) |
| **El basuco en pipa** (agachado) | `src/character/pipe.js`: pipa, soplar la llama, aspirar; paranoia y alucinaciones al soltar | No existe (la psicosis del port viene solo de la abstinencia) |
| **«Soplar»** | No hay una acción aparte con ese nombre: es botar el humo de la calada (`isExhaling`) y soplar la pipa | — |
| **Efectos de consumo en cámara y visión** | `src/systems/SubstanceEffects.js` + `src/data/substanceEffects.js`: pastilla (euforia: el tono oscila y la imagen respira, FOV +4°), pegante (mareo: borroso, verdoso, bordes oscuros y visión doble), hierba (cálido, dorado, lento), basuco (túnel con pulso rojizo y paranoia). Subida de 3 s, bajada de 6 s, estela y movimiento de cámara, sin oscilaciones por encima de ~0,5 Hz; en calidad baja sin estela ni desenfoque | Existe el `SetColorGrade` y el balanceo de cámara de la abstinencia, pero no las recetas por sustancia, la estela ni el desvanecido. Hay que añadir un pase de posproceso (color, viñeta, desenfoque, estela) |
| **Sonido de consumo** | `src/systems/SubstanceAudio.js` (sintetizado): subida, pitido de oídos del pegante que atraviesa el pasa-bajos, etc. | No existe (el port sintetiza otros sonidos en `AudioManager`) |
| **Interacción con el costal** | `substance-consumed` lo emite `HUD._useItem`; lo fumado lo emite `Player` en cada calada | Falta el evento y los estados de jugador |

Esfuerzo estimado: **grande** (1 a 2 semanas): animación del brazo y la pipa, props, humo, posproceso con estela, recetas y sonido, más pruebas.

**Estado en el port (cigarrillo y porro):** `character/Smoking.hpp` (tiempos y reglas del original: primera calada a los 2 s, una cada 30 s, dura 10 min, el porro pega al botar el humo, se cae
al nadar, saltar o recibir un golpe; probado en `bazuko_smoking_test`), `character/SmokingPose.hpp` (la pose `SMOKE_POSE` con los mismos ángulos, compuesta como el `rotateInFrame` del original),
`character/SmokePuffs.*` (el hilo de la brasa y la bocanada de la boca, con el mismo reparto de tamaños, tiempos y velocidades) y el cigarrillo en la mano izquierda con la misma colocación. Se prende
al usar el objeto del costal o la barra rápida («Prendí un cigarrillo», «Ya tengo uno prendido.», «Se acabó el porro.»). `BAZUKO_PREVIEW_SMOKE=cigarrillo|hierba` con `BAZUKO_PREVIEW_TIME=<s>` fija la calada
para capturas. El evento `substance-consumed` del porro ya se emite en cada calada (registrado con `BAZUKO_LOG_AUDIO=1`); **falta conectarlo a los efectos de visión**, que es el siguiente paso.
Aún no se ve fumar a los otros jugadores en el multijugador.

**Estado en el port (pipa, efectos y sonido):** `character/Pipe.hpp` y `PipePose.hpp` (el basuco en pipa: agacharse, prender con el encendedor, aspirar y botar el humo; se queda quieto 5 s y el efecto llega a los 4,1 s; la pose
`BASUCO_POSE` con los ángulos del original; probado en `bazuko_pipe_test`), `effects/SubstanceEffects.*` (las cuatro recetas con sus tiempos: subida de 3 s, bajada de 6 s, desvanecido de 1 s en cortes y reemplazos; probado en
`bazuko_substanceeffects_test`), el filtro de color, la capa y la estela en `present.frag` (desenfoque, sepia, tono, saturación, brillo y contraste en el orden de CSS; capas `overlay`, `multiply` y `soft-light`; estela de media resolución),
el movimiento de cámara de cada sustancia sumado al de la psicosis, la paranoia inducida del basuco (`induce`: 50 s a severidad 0,8, se apaga en los últimos 8 s) y `audio/SubstanceSynth.*` (los sonidos de consumir y las capas
sostenidas, sintetizados con las mismas ondas, ruidos, filtros y envolventes del original; el pegante cierra los agudos de todo el juego menos de estos sonidos con un filtro entre un grupo maestro y los parlantes; probado en
`bazuko_substancesynth_test`). Con `BAZUKO_PREVIEW_SUBSTANCE=<id>`, `BAZUKO_PREVIEW_BASUCO=1` y `BAZUKO_PREVIEW_TIME=<s>` se fijan los efectos para capturas. **Sin verificar al oído**; en calidad baja no hay desenfoque ni estela.
También se adaptó la psicosis a lo nuevo del original: la cámara respira a 0,48 Hz y se quitó el filtro de color.

## 2. Voces de la calle (4 de noviembre) — **hecho en el port**

* `src/systems/StreetVoices.js` y cinco grabaciones nuevas en `public/audio/`: `calle_las_mejores_carechimba.mp3`, `calle_pirobito.mp3`, `calle_enano_gonorrea.mp3`, `calle_medallo.mp3`, `calle_un3snacional.mp3` (ya están en `origin/main`; hay que traerlas a `cpp/public`).
* Reglas: suena de quien está a menos de 18 m (volumen pleno hasta 5 m), **una a la vez**, enfriamiento de 25 s por persona y de 50 s por grabación, 6 a 13 s entre frases, elige entre los 4 más cercanos, no habla si hay otra voz (robo o conductor), la burbuja de conversación muestra el texto, tráfico y ambiente bajan mientras suena, y respeta el volumen de «Voces» y el silencio general.
* En el port ya existen burbujas (`Pedestrian::bubbleText`), voces de robo y de conductores y la mezcla por categoría: es la tarea **más pequeña** (un día).

**Estado en el port:** `audio/StreetVoices.hpp` (reglas: 18 m, una a la vez, enfriamientos por persona y por grabación, los 4 más cercanos; probadas en `bazuko_streetvoices_test`), cinco `mp3` en `public/audio/`,
`AudioManager::PlayStreetVoice` (cede ante un robo o un conductor, baja el tráfico y el ambiente, respeta «Voces» y el silencio) y la burbuja de quien habla (`Simulation::PedestrianSay`).
Con `BAZUKO_LOG_AUDIO=1` el juego escribe cuándo habla alguien. Con el mundo compartido cada jugador oye las voces de la calle de su propia copia.

## 3. Mapa y radar (4 de noviembre) — **hecho en el port**

* `src/ui/ZonaAviso.js`: cartel de cartón con el **nombre de la zona** al entrar a una nueva (3,4 s) y la **vía actual bajo el radar** (se revisa cada 0,4 s, con el mismo predicado que nombra la calle donde se muere o lo arrestan). Zonas: El Cartucho, Parque Tercer Milenio, La Candelaria, Chapinero, El centro, Los barrios y el lago con su propio nombre.
* En el port: el radar y el mapa grande existen, pero no hay zonas con nombre ni la calle bajo el radar; hay que exponer una función «zona de este punto» (el original usa `Bogota._zoneAt`) y los nombres de calle (`streetLabels`, `calleCercana`).
* Esfuerzo: **pequeño a mediano** (1 a 2 días), según cómo se defina la zona en la ciudad ampliada del port.

**Estado en el port:** `world/Zones.hpp` (los rectángulos de `_zoneAt` en metros, las vías con `StreetLabels` y `NearestStreetPhrase`; probado con las vías reales en `bazuko_zones_test`),
el cartel de zona bajo la tarjeta de la misión (3,4 s) y la vía bajo el plano del radar, revisada cada 0,4 s. Con captura del juego real en el centro y en El Cartucho.

## 4. Otras novedades

| Novedad (fecha) | Qué hace | En el port |
|---|---|---|
| **Sirena de las patrullas en persecución** (4 nov) | `PoliceSirenAudio`: vaivén sintetizado, máximo dos patrullas, solo las que persiguen, separado por distancia | El port tiene sirena de patrulla en su propio sistema; conviene comparar la regla de «máximo dos y solo persiguiendo» |
| **Tráfico por hora (pico de mañana y tarde, mediodía ocupado, madrugada floja)** y **densidad de tráfico en la pausa** (Baja, Normal, Alta, Máxima) (4 a 5 nov) | La flota sigue el reloj de la ciudad; los carros entran y salen de a poco lejos de la vista; techo de ~50 carros para que los cruces no se atasquen | El tráfico del port es fijo; podría tomar la misma curva horaria con el reloj del juego y su techo propio (las pruebas de atascos del port son más exigentes) |
| **Emisoras colombianas en vivo en la radio** (5 nov) | Dial con emisoras reales (frecuencia, región, señal, códec y crédito) por streaming HLS; estática sintetizada si falla | El port tiene radio sintetizada. Un streaming de internet exige decodificar audio por red en C++ (HLS/MP3): **no recomendado ahora**; se puede portar el dial y las emisoras inventadas |
| **Autoguardado cada minuto y al cerrar**, copia a archivo (5 nov) | Se salta momentos no firmes; guardar y restaurar archivo desde la pausa | El port ya guarda cada 5 s y al cerrar; falta guardar/restaurar archivo desde la pausa (opcional) |
| **Frases de la calle y burbujas** | ver sección 2 | |
| Calidad baja liviana, demo en GitHub Pages, descarga ligera, fuente escrita a mano | Cambios solo del juego web | No aplican al port |

## Orden propuesto

1. ~~**Voces de la calle**~~ (hecho).
2. ~~**Zona al entrar y vía bajo el radar**~~ (hecho).
3. ~~**Fumar** (cigarrillo y porro: props, calada, humo)~~ (hecho, con la pipa de basuco).
4. **Efectos de las sustancias** (posproceso, recetas, sonido), incluidos pastilla, pegante, hierba y basuco con pipa.
5. **Tráfico por hora y densidad** en la pausa, y la regla de sirenas.
6. Lo demás (radio en vivo, guardar archivo) si se quiere.

Todo con pruebas y capturas del juego real, sin tocar los hashes de referencia de la simulación (un jugador): los cambios de voces, zona y efectos viven en la presentación,
y el tráfico por hora sí cambia la simulación, así que ese punto actualizará los hashes y se hará aparte.

## Ajustes posteriores (voces de la calle, burbuja y tienda del Dealer)

- Voces de la calle: las reglas son las del original (`StreetVoices.js`): cualquier peaton a menos de 18 m, entre los 4 mas cercanos, sin otro filtro que tener ya una burbuja, estar inconsciente o ir en un carro (el que huye o reacciona tambien habla). Unico ajuste del port: una frase solo empieza si quien la dice esta a menos de 9 m (a 17 m sonaba a volumen casi cero y se perdia sin oirse).
- La burbuja de conversacion usa el aspecto de carton y marcador del original.
- El jibaro cobra 2,5 veces el valor y paga 1,8 por unidad (el +30 % solo con el talento Contactos).
- Pruebas nuevas: `bazuko_audiograph_test` (grupo + filtro hacia la salida) y `bazuko_audiofiles_test` (las voces reales llegan al motor).
