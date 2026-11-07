# Voces

Cómo hablan la gente, la Policía, los conductores y los vendedores. Aquí solo va lo que se puede comprobar en el
repositorio; `tests/voces-doc.test.js` revisa que las cifras y los nombres sigan siendo ciertos.

## Dónde está cada cosa

| Qué | Archivo |
| --- | --- |
| Reparto y frases grabadas (texto, situación, quién la dice) | `src/data/vocesCalle.js` |
| Banco de los peatones por categoría | `src/data/npcVoices.js` |
| Frases que ya había, usadas en situaciones nuevas | `src/data/vocesReuso.js` |
| Canal único de voz grabada, espera de carga, pausa | `src/systems/AudioSystem.js` |
| Quién corta a quién | `src/systems/voces/prioridad.js` |
| Patrulla (radio, gritos, arresto), jíbaro y voceador del bus | `src/systems/WorldVoices.js` |
| Frases de la calle | `src/systems/StreetVoices.js` |
| Conductores (pito, robo del espejo, rebusque) | `src/systems/VehicleAudio.js` |
| Voz por eventos del juego (limosna, tienda, atropello…) | `src/systems/voces/VoiceDirector.js` |
| Gestos sin palabras (¡ay!, ¡ey!, risa, murmullo, ronquido) | `src/systems/voces/gestosVocales.js`, `src/systems/voces/Vocalizador.js` |
| Burbuja del peatón al hablar | `src/systems/voces/hablar.js` |
| Subtítulos de quien no es peatón | `src/ui/burbujaVoz.js` |
| Vaivén de cabeza al hablar | `src/character/gestoHablar.js` |

## Reparto

`REPARTO` tiene 17 papeles y 15 voces distintas: dos voces hacen dos papeles cada una.

| Papel | Sexo | Voz |
| --- | --- | --- |
| `nero_viejo` | hombre | Santiago |
| `nero_pelado` | hombre | Charlee |
| `estudiante_h` | hombre | Charlee |
| `nera` | mujer | Angie |
| `reciclador` | hombre | Albeiro |
| `senora` | mujer | Virginia |
| `vendedora` | mujer | Virginia |
| `abuelo` | hombre | Oslo |
| `estudiante` | mujer | Carito |
| `conductor` | hombre | El Faraón |
| `conductora` | mujer | Valentina Medellín |
| `busetero` | hombre | Diego |
| `vendedor` | hombre | El Faraón 2 |
| `policia_a` | hombre | Zabra |
| `policia_b` | hombre | Murdock |
| `operadora` | mujer | Adriana |
| `jibaro` | hombre | Leon |

`FRASES` tiene 155 frases y `public/audio/voces/` tiene un mp3 por cada una. El encabezado de `vocesCalle.js` dice
que salen de `tools/voces/procesar.mjs` a -16 LUFS, en mono. Antes del reparto ya había otras grabaciones en
`public/audio/` (Roberto y Valentina en el carro, los gritos de pelea); siguen igual.

El id de cada frase es `<papel>_<situación>_<n>`, y `n` cuenta en el orden de `LINEAS`: reordenar las frases cambia
los ids. `tests/voces-reuso.test.js` guarda el texto de cada id reusado para que eso no pase en silencio.

## Una sola voz grabada a la vez

Hay un solo canal para la voz grabada: peatones, patrulla, jíbaro, bus, conductores y calle. Una frase nueva solo
corta la que suena si pesa más (`PRIORIDAD_VOZ`), o si entra a la fuerza (`force`, el arresto y la requisa). A igual
peso sigue la que ya estaba. Los que no pasan por `playNpcVoice` pesan lo de `PRIORIDAD_CANAL`: la voz del carro
90, una sin peso dicho 50, el reclamo del conductor 30 y la frase de la calle 30. Así la charla, el voceador del bus
y el jíbaro en voz baja no cortan una frase de la calle a media palabra; lo que le pasa al jugador (desde `smell`)
sí, y la burbuja de la frase cortada se va enseguida.

Las cinco frases de la calle (`calle_*`) las dice un hombre a quien todavía no se le oyó su voz del reparto. Decirlas
no le cambia esa voz: después habla con la suya (un cambio, una sola vez) y ya no vuelve a las de la calle. Quedarse
con una voz «de la calle» lo dejaría sin frase grabada al robarlo, de testigo o en la limosna, porque el banco no
tiene frases sin voz de hombre para esas situaciones.

| Peso | Situaciones |
| --- | --- |
| 100 | `arrest` |
| 90 | `robbed`, `carjacked` |
| 85 | `theftChase` |
| 80 | `hit`, `knockout`, `grabbed`, `runOver`, `raid` |
| 75 | `policeShout` |
| 70 | `witnessCall`, `witnessTheft`, `mob`, `flee` |
| 65 | `witnessFight`, `witnessRunOver`, `roadRage` |
| 60 | `radio`, `poop`, `taunt` |
| 50 | `begYes`, `begNo`, `begFood`, `shopGreet`, `shopDirty`, `dealerOpen`, `dealerDay`, `dealerBroke`, `recycler` |
| 45 | `witnessHangUp`, `witnessFilm` |
| 40 | `smell` |
| 30 | `dealerWhisper` |
| 25 | `busCaller` |
| 20 | `ambient`, `tomba` |

Las voces de `public/audio/voces/` se cargan al pedirlas (quedan en memoria las 40 más recientes). Si aún no cargó,
la frase espera hasta 1,2 s de juego; mientras espera, cuenta como si sonara: la calle y los conductores no hablan
encima y otra de menos peso no la reemplaza. Al reintentar conserva `force`, el peso y el aviso de inicio. Si un
archivo no cargó, `playNpcVoice` lo rechaza con `lastRefusal = 'error'` y lo vuelve a pedir pasados 20 s.

`lastRefusal` dice por qué no sonó: `mudo` (pausa o silencio), `ocupado` (otra pesa más), `lejos`, `error` o
`espera` (está cargando y saldrá sola).

Con el juego en pausa solo sigue lo que puede sonar en pausa (`allowPaused`): la muerte del jugador, el arresto y
las frases de la tienda, la recicladora, el jíbaro y la requisa, que pueden sonar con un menú abierto. El arresto que todavía no cargó sale al
cargar aunque el reloj del juego no corra, si no pasan más de 2 s reales.

## Burbujas

La burbuja del peatón sale cuando su voz empieza de verdad y dura lo que dura la grabación más 0,4 s (al menos
1,5 s). Si otra voz pesa más, no sale burbuja. Si la frase no se va a oír por distancia o silencio, la burbuja queda
de subtítulo 3,5 s.

Quien no es peatón también tiene subtítulo (`src/ui/burbujaVoz.js`): gritos, megáfono, radio (con «Radio:»
delante), arresto, voceador del bus y conductores. Como mucho hay tres a la vez; si sobra uno se va el más viejo.
La tienda, la recicladora, el jíbaro y la requisa no ponen subtítulo: suenan detrás de su menú.

## Frases que ya había, en situaciones nuevas

Nada se grabó para esto. Cada frase va con la voz de quien la grabó; al lado de cada id, en `vocesReuso.js`, va lo
que dice. La misma frase puede servir en dos situaciones si lo que dice le sirve a las dos.

| Categoría | Frases |
| --- | --- |
| `begYes` | `conductor_semaforo_si_1`, `conductora_semaforo_si_1`, `busetero_semaforo_si_1`, `abuelo_ambiente_2` |
| `begFood` | `abuelo_ambiente_3`, `abuelo_ambiente_2`, `conductora_semaforo_si_1` |
| `begNo` | `conductor_semaforo_no_1`, `conductora_semaforo_no_1`, `busetero_semaforo_no_1`, `conductor_ambiente_1`, `conductora_ambiente_1`, `estudiante_ambiente_2`, `estudiante_h_ambiente_2`, `senora_ambiente_2`, `senora_ambiente_3`, `nera_ambiente_2`, `nero_pelado_ambiente_1`, `nero_viejo_ambiente_1`, `reciclador_ambiente_3`, `abuelo_ambiente_1` |
| `grabbed` | `conductor_robado_1`, `senora_robado_2`, `nera_robado_1`, `busetero_robado_1`, `reciclador_pelea_1`, `nero_pelado_reto_1`, `nero_viejo_robado_1`, `conductora_robado_1` |
| `carjacked` | `conductor_testigo_robo_1`, `conductor_robado_1`, `conductora_robado_1`, `conductora_testigo_robo_1` |
| `roadRage` | `conductor_robo_espejo_1`, `conductor_robo_espejo_3`, `conductora_robo_espejo_1`, `conductora_robo_espejo_2` |
| `witnessRunOver` | `senora_testigo_pelea_1`, `abuelo_testigo_pelea_1`, `conductor_pito_3`, `nera_pelea_1`, `estudiante_testigo_graba_1`, `estudiante_h_testigo_graba_1` |
| `shopGreet` | `vendedora_ambiente_1`, `vendedora_ambiente_4` |
| `recycler` | `reciclador_ambiente_1` |
| `dealerOpen` | `jibaro_ofrece_1`, `jibaro_ofrece_4` |
| `dealerDay` | `jibaro_ofrece_3` |
| `dealerBroke` | `jibaro_ofrece_4` |
| `raid` | `policia_a_grito_1`, `policia_b_grito_1`, `policia_a_grito_5`, `policia_b_grito_5` |
| `tomba` | `nero_pelado_ambiente_2` |
| `witnessTheft` (además de las suyas) | `busetero_persecucion_1`, `nero_viejo_pelea_2`, `nera_pelea_2`, `nero_pelado_pelea_1`, `abuelo_testigo_pelea_1`, `reciclador_pelea_1` |
| `witnessFight` (además de las suyas) | `nera_pelea_1`, `reciclador_pelea_1`, `nero_pelado_pelea_1`, `estudiante_testigo_graba_1`, `estudiante_h_testigo_graba_1` |
| `witnessFilm` (además de las suyas) | `nero_pelado_ambiente_3` |

`PRESTADAS` pasa una frase de un papel a otro solo si los graba la misma voz: de `senora` a `vendedora` (Virginia)
y de `estudiante_h` a `nero_pelado` (Charlee). `HEREDADAS` suma al banco grabaciones de antes del reparto:
`mevaamatar.mp3` (`grabbed`), `policia.mp3` (`runOver`) y `roberto_robo_espejo_n1` a `n5` (`roadRage`, con la voz
de Roberto; usan el mismo Howl que el reclamo del carro, así que se cargan una sola vez).

## Quién dice qué (VoiceDirector)

| Pasa | Quién habla |
| --- | --- |
| `beg-result` | La persona más cercana a menos de 7 m que no sea vendedor: `begYes`, `begFood`, `begNo` o `smell`. Una vez cada 4 s. |
| `open-shop` | La vendedora: `shopGreet`, o `shopDirty` si la higiene está por debajo de 20. Una vez cada 20 s. |
| `open-recycler` | El reciclador (`recycler`), si el jugador está a menos de 6 m. Una vez cada 30 s. |
| `dealer-toggle` | El jíbaro: `dealerOpen` de noche, `dealerDay` de día. |
| `substance-buy-fail` sin plata | El jíbaro: `dealerBroke`. |
| `substance-fail` de día | El jíbaro: `dealerDay`. |
| `substance-raid` | Un policía (`raid`), a la fuerza. |
| `peaton-atropellado` | 0,6 s después, la persona más cercana a la víctima, a menos de 12 m: `witnessRunOver`. Si la víctima todavía grita, espera su turno hasta 3 s más y, si no le llega, hace su «uy». La víctima dice `runOver` o `knockout`. |
| `mirror-stolen` | Si del carro se baja alguien a pelear y a ese carro no se le había oído otra voz, el reclamo por el espejo vuelve a empezar en el mismo instante con una voz del sexo de quien se baja. Si nadie se baja, el reclamo queda con la voz del carro. |
| Conductor bravo | Al bajarse, el carro queda con un conductor del sexo de su cuerpo y él con esa voz. Si al carro ya se le oyó una voz del otro sexo, el carro la conserva y él grita con la pareja de esa voz (Roberto y Valentina, conductor y conductora). Persiguiendo, `roadRage` cada 4 a 7 s; al huir, `carjacked`; al alzar la varilla, «uf». La furia del rebusque sigue la misma regla: antes de que el carro grite, `RebusqueSystem` le pone con `recastDriver` un conductor del sexo de quien se baja, salvo que ya se le haya oído la voz. |
| Robo a un peatón | La víctima dice una frase de `robbed` que cuadre con el robo (pillado, raponazo o descubierto), con la voz que ya tiene, por `decirFrase` con el peso de `robbed` (`hablarRobo` en `src/features/stealReactions.js`): calla la charla y la frase de la calle, y la turba no la pisa. Si el canal lo tiene otra igual o más pesada (otro robo, la voz de un carro o el arresto), la víctima calla y no deja burbuja. Sin una grabación que cuadre, hace su «¡ey!» y sale una burbuja sin grabar. Solo el tirón que se llevó un bolso deja decir «mi bolso» (`tipoDeTiron`); si fue al bolsillo, a una bolsa o a un maletín cuenta como `raponazo-sin-bolso`, y quien se palpa el bolsillo después tampoco lo nombra. El tirón que agarró puro aire es `raponazo-fallido`: nada de «me robó», «suelte» ni «quite la mano». El grito del aviso también va con el robo (`GRITOS_DE_ROBO` en `src/entities/Npc.js`): solo quien tiene la mano adentro grita «quite la mano» o «el bolsillo». |
| Patrulla a menos de 30 m | El `nero_pelado` que esté a menos de 6 m avisa (`tomba`). Una vez cada 90 s. |

La patrulla no tiene conductor de civil: no dice frases de pito y, persiguiendo, no pita por quien tiene adelante.
La sirena se oye hasta donde la patrulla desiste (`TrafficSystem.giveUpRange`).

La persona más cercana (a menos de 5 m) empieza a cargar sus frases de `robbed`, `begYes` y `begNo`, de a dos por
segundo.

La limpieza social no tiene voz.

## Gestos sin palabras

Donde no hay frase grabada que sirva, la persona hace un gesto corto con su tono: el de su voz del reparto si
tiene (`VOZ_TIMBRE`), o uno de su sexo (hombre de 100 a 140 Hz, mujer de 180 a 240), con ±3 % de persona a persona y
más grave y temblón si es mayor. Se sintetiza con Web Audio (una fuente glotal por tres formantes); no usa muestras.

| Gesto | Cuándo (`GESTO_POR_CATEGORIA`) |
| --- | --- |
| `ay` | `hit` |
| `ay_fuerte` | `knockout`, `runOver` |
| `ey` | `grabbed`, `robbed`, `theftChase`, `mob`, `taunt`, `witnessTheft`, `carjacked`, `roadRage` |
| `uy` | `witnessFight`, `nearMiss`, `witnessRunOver` |
| `uf` | `poop`, `smell`, `shopDirty`, y el conductor bravo al alzar la varilla |
| `jaja` | `witnessFilm` |
| `mmm` | `begYes`, `begFood` |
| `mmm_no` | `begNo` |
| `murmullo` | La pareja que conversa, a menos de 7 m |
| `ronquido` | Quien duerme, a menos de 4 m |

El carro de Roberto que ya habló contesta el rebusque con un gesto (`mmm`, `mmm_no` o `ey`), porque Roberto no grabó
esas frases.

Límites (`LIMITE`): dos reacciones y un sonido de ambiente a la vez, y 1,2 s entre gesto y gesto de la misma
persona. Con una voz grabada sonando, el ambiente calla y las reacciones van más bajo. Suena por un canal propio
conectado a `Howler.masterGain`: sigue el volumen general, el silencio, la pausa y el volumen de «Voces». Se oye
completo hasta 3 m y nada a 14 m. No tiene interruptor en Ajustes; `?sinVocalizador` en la dirección lo apaga para
comparar.

Mientras habla (frase o gesto), la persona mueve un poco la cabeza: hasta 0,06 rad, solo con el modelo completo y a
menos de 10 m.

## Radio

Mientras alguien habla cerca, el radio baja igual que el tráfico (`AudioSystem._duck`). Una emisora en vivo que no
está sonando (sin datos, caída o en pausa) no sube la salud mental ni calma al perro.

## Pruebas

- `tests/voces-reuso.test.js`: la tabla de reuso, las prestadas, las heredadas y los pesos.
- `tests/voz-prioridad.test.js`: quién corta a quién, la espera de carga y el arresto en pausa.
- `tests/voces-hallazgos.test.js`: patrulla, calle, sirena, conductor bravo, subtítulos y radio.
- `tests/vocalizador.test.js`, `tests/burbuja-voz.test.js`, `tests/voice-director.test.js`, `tests/voces-doc.test.js`.
- `tests/steal-reactions.test.js`: la frase de la víctima del robo y su peso.
- `tests/rebusque-arreglos.test.js`: el carro al que ya se le oyó la voz la conserva en la furia del rebusque.
- `tests/e2e/voces.spec.js`: en el juego de verdad.

## Pendiente del dueño

- Licencia y permisos de uso de las voces grabadas: no está escrita en el repositorio.
- Transcripción de las grabaciones de Roberto (`roberto_n*`, `roberto_robo_espejo_n*`) y de Valentina
  (`valentina_n*`): no tienen texto en el repositorio, así que no tienen subtítulo.
