# Rap en el vagón

En el torniquete del Portal del Centro o de las estaciones del Metro, la ventana del viaje ofrece **Rapear en el vagón**, al lado de pedir plata (es una o la otra). Si se elige, el viaje no es un fundido directo: el personaje se sube a rapear, como cualquiera que se gana la vida en el bus, y la gente da según cómo le salga.

## Cómo se juega

1. La calle funde a negro, suenan los tres pitos de las puertas y arranca el ronroneo del bus.
2. Dos compases de saludo, según la hora del juego: «Buenas noches, señores pasajeros, disculpen la molestia: no vengo a robarles, vengo a rimarles.» La marca roja ya cruza la barra, sin golpes, para mostrar cómo va.
3. Dos estrofas al azar entre siete (el cambuche, el bus lleno, la carreta, El Chato, el clima, el trancón y la fama) y el cierre, «Gracias, señores pasajeros, ¡que Dios les pague!».
4. En cada compás la marca cruza la barra una vez, de izquierda a derecha. Cada trazo negro es un golpe de la caja (el 2 y el 4): se oprime **Espacio** (A con mando, un toque en cualquier parte de la pantalla con el dedo) cuando la marca pasa por él. La segunda estrofa pide un golpe más en dos de sus líneas.
5. El pedazo que pega se escribe en grueso y su trazo queda con chulo. El que no, sale tachado y al lado lo que dijo el personaje al trabarse («eh… eh… ¿cómo era?», «se me olvidó la letra»).
6. Abajo va la gente del vagón: cinco al azar entre diez (la señora del mercado, el estudiante, el celador que sale de turno, el de corbata, la abuela de la camándula, el parcero de gorra, el de los dulces, la turista, el maestro de obra y la enfermera del turno de noche). Cada uno tiene sus ganas, en masa rayada, y lo que hace mientras tanto («Ya está grabando», «Subió el volumen»).
7. Al final, la cuenta: cómo me fue, lo que dijo o hizo cada uno, lo que dio y el total. «Bajarme del bus» (o del vagón) lleva a la estación de llegada.

Esc (B con mando) calla al personaje a mitad del rap: no cobra y llega igual. Machacar la tecla no sirve: cada pulsación sin golpe cerca resta. Si se cambia de pestaña, el rap espera y retoma desde el principio del compás en que iba.

## Lo que cuenta

| Resultado | Flow | Qué pasa |
| --- | --- | --- |
| ¡Me lucí! | 85 % o más | La mayoría da de $ 600 a $ 1.800; el de corbata y la turista a veces dan un billete de $ 5.000. Unos $ 5.900 en promedio |
| Me fue bien | 60 % o más | Más de la mitad da de $ 300 a $ 900. Unos $ 1.750 |
| Más o menos | 35 % o más | Unos pocos dan de $ 100 a $ 400. Unos $ 370 |
| Qué oso | 15 % o más | Casi nadie da nada |
| Me bajaron | Menos de 15 % | Nadie da; en la siguiente estación me piden que me baje y llego a pie, 12 minutos más tarde |

Un golpe justo (a 80 ms o menos) vale 1; uno bien (a 160 ms o menos), 0,6; uno perdido, 0. Cada pasajero tiene su gusto: a la abuela y al parcero les gusta más, al de los dulces casi nada, porque le quitaron el turno. Lo que dice cuadra con lo que dio: «Tome» solo sale si dio algo. Con mal olor las ganas de dar bajan a la mitad, y la cuenta lo dice. Todo va en múltiplos de $ 100.

Rapear cuesta 6 de energía y 6 de sed, y deja el ánimo entre +8 (lucirse) y −6 (que lo bajen); callarse quita 2 y no cansa. Con menos de 10 de energía la opción sale tachada: «Estoy muy cansado para rapear». El pasaje se paga al subir, como siempre, y colarse tiene el riesgo de siempre: si lo pillan no hay rap.

## El sonido

El beat es un boom bap a 92 por minuto, sintetizado en el navegador: bombo, caja en el 2 y el 4, platillos con swing, un bajo que da la vuelta cada cuatro compases (La, Fa, Do, Sol) y un rayón de disco al empezar las estrofas, sobre el ronroneo del bus. Nada se descarga.

Como el viaje pausa el juego, el beat no usa el canal de efectos (`_fx()`), que calla en pausa: tiene su propio nodo, conectado al volumen general de Howler, con el nivel de Efectos encima. El silencio y el volumen general lo apagan como a todo lo demás. Mientras suena, Howler no puede suspender el audio (lo hace a los 30 s sin sonidos suyos, y un rap dura más); al terminar queda como estaba. Los golpes se programan con el reloj del audio y se juzgan contra lo que se oye, descontando la latencia de salida y el retraso del evento de la tecla.

## La pantalla

Sobre marcador, como la pausa: arriba la ruta («En el articulado, rumbo a…» o «En el vagón del Metro, rumbo a…», según la estación donde se sube), la letra escrita en un cartón grande, la barra del cosquilleo y la gente. La marca cruza la barra a 0,38 Hz, por debajo del límite de 0,5 Hz de la identidad, y nada parpadea. Mientras la escena tapa la pantalla, el juego deja de dibujar la ciudad detrás. En celular la gente queda en dibujo y ganas; acostado, la letra y la barra mandan, y el verbo de la cuenta queda siempre a la vista.

## Dónde está

- `src/data/rapLetras.js`: saludo, estrofas, trabadas, veredictos y la gente del vagón. Solo datos.
- `src/systems/rap/ritmo.js`: la canción, el juicio de cada golpe, el flow y el nivel.
- `src/systems/rap/pago.js`: quién va, sus ganas y cuánto da; lo que cuesta rapear.
- `src/systems/rap/RapAudio.js`: el beat.
- `src/ui/RapEnElBus.js`: la escena, el reloj y la entrada (teclado, mando y dedo).
- `src/systems/StreetLife.js` (`travel`, `_llegarRapeando`) y `src/ui/streetMenus.js`: el viaje y la ventana.
- `tests/rap.test.js` y `tests/e2e/rap.spec.js`.

Al llegar sale el evento `transit-trip` (con `rap` y lo ganado) y además `transit-rap` con el nivel, el flow, lo ganado y cuántos pagaron, por si una misión quiere usarlo.
