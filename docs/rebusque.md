# Rebusque en el semáforo

Malabares, limpiar el parabrisas y vender dulces a los carros quietos en rojo, con B (la tecla de la limosna). Lo lleva `src/systems/RebusqueSystem.js`; los datos están en `src/data/rebusque.js` y `src/data/rebusqueReacciones.js`. El bus troncal y cuidar carros parqueados siguen como antes (ver `AGENTS.md`).

## Piezas

| Archivo | Qué hace |
| --- | --- |
| `systems/rebusque/semaforo.js` | Reloj del rojo (copia de `signalState`: ciclo de 36 s, ejes desfasados 18 s, verde por debajo de 14), cruces, zonas de un carro (nariz, flanco, banda, fuera) y puntos de trabajo. Puro. |
| `systems/rebusque/despeje.js` | El freno de cortesía al verde, la paciencia del conductor y el paso atrás al andén. Solo usa `TrafficSystem.hold`. |
| `systems/rebusque/reacciones.js` | Qué hace cada conductor al terminar y cuánto da. Puro. |
| `systems/rebusque/ritmo.js` | Calendario de la cascada de tres pelotas y mini-juego de ritmo. Puro y sin dt. |
| `systems/rebusque/jornadaRebusque.js` | Cansancio, repetición por esquina, esquinas quemadas y la furia del día. Se guarda en la partida (clave `rebusque`). |
| `systems/rebusque/RebusqueVisual.js` | Pelotas, rodillo y espuma, chaza y dulce, mano del conductor con la moneda. Lee `game.rebusque.escena`. |
| `character/rebusquePose.js` | Poses `malabares`, `limpiar`, `ofrecer` y `apartarse` sobre el cuerpo realista (las aplica `ActionPose`). |

## Dónde se trabaja

- **Malabares:** frente a la cola, a 2,5 m o más de cualquier carro y sin pegarse a ninguna puerta. Frente a la trompa del primero de la cola (la «nariz») el show paga un 15 % más.
- **Parabrisas:** parado frente al capó, a 1,6 m o menos del punto de trabajo. Las motos no tienen parabrisas.
- **Dulces:** en la ventana del conductor (el lado del puesto, `driverAnchor`, no el de la puerta: la buseta se sube por la derecha y se maneja por la izquierda), a 1,4 m o menos; el carro de al lado también ve la chaza. Pegado al costado del bus detenido (a 1,5 m o menos), el bus va primero.
- **Motos:** el rebusque las busca con `stoppedAtRed(pos, 9, { motos: true })`. Compran dulces (a 1,6 m o menos de la moto, `ALCANCE_MOTO`) y miran los malabares como público; no se les limpia el parabrisas.
- **Robando no se trabaja.** Con la barra del cosquilleo, un raponazo, un atraco o la pose del robo, B no ofrece ni empieza el rebusque (`_puedeTrabajar`). Si el robo empieza en pleno trabajo, el trabajo se deja sin paga («Dejé el trabajo a medias: así nadie me va a pagar.») y el despeje sigue armado, porque el verde puede encontrar al jugador delante del carro. Del otro lado, con un trabajo activo o durante el paso atrás no hay aviso de robo ni E/Q.
- **Nunca dentro del cruce.** Dentro de la caja del cruce, encogida 1 m, sale el aviso «Aquí en el cruce me atropellan: me hago antes de la cebra.»
- **Solo con rojo de sobra.** Se empieza si quedan al menos `máx(2,5 s, mitad del trabajo + 1,5 s)`, y el trabajo se acorta para terminar 1,5 s antes del verde. El aviso lleva la cuenta: «rojo 12 s», y a 2 s del cambio, «¡Ya cambia! Me quito de la vía».
- **Una esquina se cansa.** Hay que esperar 40 s entre shows de malabares en el mismo cruce, y 12 s entre parabrisas o dulces. El mismo carro no se repite en 60 s.

## El verde (decisión del dueño)

El despeje vale solo después de un trabajo en el semáforo. Desde 0,6 s antes del verde de cada carro hasta 8 s después, un carro quieto que tenga al jugador en su nariz, su flanco o la banda junto al costado se queda quieto con `traffic.hold`. Ese carro no le pita al jugador por estorbar (`rebusqueTolera`, que lee `VehicleAudio`). Después:

1. A los 1,5 s el conductor dice `semaforo_verde`.
2. A los 12 s pita un poco: `car-honk`, −2 de ánimo, −1 de fama y el aviso «Me están pitando…».
3. A los 20 s el jugador se quita: 0,6 s quieto, mirando al carro con las manos en alto («ya, ya, me quito»), y después camina de verdad, con las piernas al paso, hasta el andén más cercano al que se llega derecho sin cruzar un carro ni el camino de un vehículo que viene andando (carros, motos y bus) (entre 1,4 y 3 m/s, unos 2,2 s de camino; 3 m/s es el paso normal del jugador). Se prefiere el andén del lado del carro sostenido: el del otro lado de su carril cuenta 4 m más lejos (`LADO_OPUESTO_M`). Mientras tanto `Game` no corre `Player.update` (`RebusqueSystem.controlaJugador`): el despeje mueve al jugador, lo apoya en el suelo y anima el cuerpo una vez por cuadro con `Player.animateScripted`, como al subirse a un carro, y B no hace nada (ni cuidar carros ni pedir limosna). Si en el camino se atraviesa uno andando, el jugador espera quieto; cada espera dura como mucho 1,5 s y todas juntas como mucho 3 s (un carro que tapa y destapa a ratos no lo deja sin mando). Pasado eso, el paso se acaba y el jugador vuelve a mandar. No hay daño. El aviso sale al terminar el paso y cuenta lo que de verdad pasó: «Me hice para atrás hasta el andén: el man ya iba a arrancar.» si llegó; «Me quité de adelante: el man ya iba a arrancar.» si se movió un trecho y ya no está frente a la trompa; y «El man ya arranca: me toca quitarme de la vía.» si no se movió o sigue frente a la trompa. Si no hay andén a 12 m, no se arrastra a nadie: sale este último aviso, se sueltan los carros y el tráfico cede como siempre.
4. Ningún carro queda sostenido más de 25 s. Cada sostenido se suelta 0,3 s después de que el jugador sale de las zonas. También se sueltan todos al cancelar (morir, dormir, caer preso, importar una partida), y cancelar quita además la escena del cobro: las pelotas que caen y la mano con la moneda no siguen en el sitio adonde llevaron al jugador. Se sueltan en `dispose()` y si el jugador queda aturdido, se cae, nada o maneja. Si el vehículo sale de la circulación (se lo roban o lo retiran), se olvida sin tocarlo. El del conductor bravo es de `RoadRageSystem` y nunca se suelta desde aquí.

Mientras se sostiene un carro, B no empieza otro trabajo y el aviso dice «Estoy estorbando: me quito de adelante del carro». Con un verde de 14 s, el que se queda los 20 s completos hace que el carro pierda su verde; arranca en el siguiente.

## Reacciones y plata

Cada conductor tira una vez (la paga va primero: `random() = 0` siempre cobra el mínimo). Las reacciones son paga, propina, comida regalada (pan, agua o refresco al costal), excusa, subir el vidrio, no mirar, pito, insulto, bravo o furia. Una moto no sube vidrio: el que no quiere, no mira.

- **Modificadores:** la franja de `JornadaSystem` (limosna, golpe), la fama, la calidad del show, la mugre, la lluvia (sobre todo al parabrisas), la repetición en la esquina (×0,9 por trabajo en la última hora de juego, con piso de 0,6), la esquina quemada y el cansancio. Lo positivo tiene tope de ×1,4.
- **Balance de día, con fama 0 y show normal:** unos $1.000 por show de malabares a cuatro carros (unos $1.130 frente al primero), unos $670 por parabrisas y unos $1.000 por dos dulces. Un trabajo recortado por el rojo paga en proporción.
- **Techo:** en un minuto real no entran más de $3.000 sumando los tres trabajos. Pasado el techo, el siguiente «no tiene sencillo». El primer pago del minuto siempre pasa entero, así que todavía puede salir el billete de $5.000 (8 % de las propinas). El billete se paga a su valor de cara: no se recorta por un show corto ni sube frente a la cola, y el aviso lo dice («¡Uno me dio un billete de…!»). Las demás propinas son monedas y se escalan.
- **Cansancio:** desde el show número 11 del día (malabares y parabrisas), cada uno cuesta 1,5 veces la energía y lo bueno baja un 20 %. Lo avisa una vez: «Tengo los brazos molidos…».
- **Esquina quemada:** si el jugador roba un espejo o a un peatón a 30 m de un cruce o menos, ese cruce no le da nada bueno el resto del día y los insultos se doblan.
- **Fama:** cada tres trabajos pagados, +1.
- **Furia:** solo tras un parabrisas no pedido que el conductor rechaza, como mucho una vez por día de juego, con `RoadRageSystem` libre y sin patrulla a 25 m o menos. Si no se puede, queda en insulto. Antes de que el carro grite, `VehicleAudio.recastDriver` le pone un conductor del sexo de quien se baja con la varilla, salvo que ya se le haya oído la voz: entonces la conserva, como en el robo del espejo (ver `docs/voces.md`, «Conductor bravo»).
- **Voz:** una sola por trabajo, la de la reacción más fuerte que tenga audio. Las claves nuevas (`semaforo_propina`, `semaforo_compra`, `semaforo_madrazo`, `semaforo_aplauso`) se usan solo si tienen audio en `vocesCalle.js`; si no, suenan las de siempre (`semaforo_si`, `semaforo_no`, `semaforo_bravo`). `semaforo_bravo` solo dice frases del vidrio («No, no, no, no me limpie el vidrio.»), así que el insulto cae en ella solo en el parabrisas (`clavesVoz` y `VOZ_REACCION_TRABAJO`); en malabares y dulces el insulto no tiene voz mientras no haya `semaforo_madrazo` grabado, y habla el siguiente conductor (el que pagó, el que se excusó). No hay grabaciones nuevas, y los insultos van entre comillas en el aviso.

El evento `rebusque` sigue siendo `{ id, pesos, carros }`. El objetivo `rebusque-semaforo` cuenta solo `dulces`, `vidrios` y `malabares`; cuidar carros y el bus tienen sus propios objetivos.

## El mini-juego (opcional)

La cascada lanza una pelota cada 0,32 s. Desde el segundo 1,5, uno de cada tres lanzamientos va alto (siempre la misma pelota). Oprimir B cuando la alta baja a la mano (±0,22 s) es acierto: sube la calidad y aparece «¡Eso!». Oprimirla a destiempo es error, y dos errores seguidos tumban la próxima pelota, que cae, rebota y rueda. La calidad empieza en 0,5, que paga como un show normal; con 0,85 o más los carros aplauden. El aviso lo parte en tarjetas: «[B] cuando baje la alta» y las estrellas de la calidad (★★ es normal; sin ninguna, «sin ritmo»).

## Lo que se ve

- **Pelotas:** salen de la palma de la mano que lanza (el hueso de la mano más el dedo medio) y vuelan en parábola hacia la palma de la otra. La alta sube 1,8 veces más en el mismo tiempo. Al cobrar ya no sale ninguna: las que iban en el aire terminan su vuelo en la mano que las recibe (las manos siguen arriba 1 s), y se guardan a los 1,02 s.
- **Parabrisas:** la espuma es una malla de 11×7 sobre la superficie del parabrisas del modelo (`getCarBody(model).spec.windshield`, `topY`, `edgeZ`) y copia la matriz de la carrocería sin tocar el carro. El rodillo baja de arriba a abajo con el mismo barrido del brazo (`barrido` de `rebusquePose.js`) y deja limpio lo que toca. El palo va de la mano al rodillo.
- **Dulces:** la chaza va en la mano izquierda y el dulce en la derecha.
- **Cobro:** hasta tres brazos de conductor salen por su ventana, a media ventana (`belt` + 0,17 m, `sideZ`), uno tras otro (sus reacciones van cada 0,35 s): la manga y el antebrazo nacen en el codo, adentro de la cabina, y la mano sigue su línea hacia afuera. La moneda (2,4 cm, dorada con brillo propio para que se lea de noche) o el billete vuela a la mano del jugador; la excusa se mueve de lado a lado y el insulto sacude el puño. Antes de que salga la mano, el vidrio del puesto baja en 0,35 s: el primero que reacciona espera a que baje, el segundo se corre la mitad (sale a los 0,525 s, no a la vez que el primero ni tan tarde que se pase del cobro) y del tercero en adelante su turno ya alcanza para bajarlo. Cuando la mano entra, el vidrio sube en 0,6 s, aunque el cobro ya haya terminado. Es `Car.setDriverWindow`: los vidrios de ese carro pasan a la geometría del modelo sin esa ventana y la ventana sola, con el mismo material de la flota, se corre hacia abajo dentro de la puerta (`getDriverWindowGlass` en `VehicleBody.js`, que comparte los búferes del vidrio entero). Los carros que no están en el cobro no hacen nada por cuadro.
- **Costo:** como mucho 3 pelotas, rodillo, palo, espuma, chaza, dulce y 3 brazos (manga, antebrazo y mano) con su moneda y su billete. Las geometrías y los materiales se crean una vez, ninguna malla da ni recibe sombra, y sin escena no existe ninguna. `RebusqueVisual.preloadables` es un grupo apagado que cuelga de la escena, con una malla por material (la espuma con color RGBA por vértice, como la de verdad): `game.js` lo pasa a `Renderer.prepare` para compilar esos programas en la carga, y como está en la escena también lo alcanzan las compilaciones que siguen a un cambio de sombras, en vez de quedar para el primer show.

## Pruebas

- **Unitarias:** `rebusque.test.js` (las de siempre), `rebusque-semaforo.test.js` (reloj contra `signalState`, sitios, cruce, rojo corto, esquina, bus primero), `rebusque-trafico.test.js` (ciudad y tráfico reales: nadie atropella, espera, pito, andén caminando con las piernas, cancelar, robo, conductor bravo, tope), `rebusque-reacciones.test.js` (reparto, modificadores, balance, techo, furia, voz del insulto por trabajo), `rebusque-ritmo.test.js`, `rebusque-jornada.test.js` (también que `sanearPartida` conserve la clave), `rebusque-pose.test.js` (esqueleto real), `rebusque-visual.test.js` (también que la precarga compile los programas de la espuma con sombras prendidas y apagadas) y `rebusque-arreglos.test.js` (motos, voz del carro que ya habló, cobro que no sigue al sitio nuevo, robo y rebusque excluyentes, lado del andén, esperas con tope, avisos que no dicen que se quitó si no se quitó, billete entero y B quieta durante el paso).
- **E2E:** `tests/e2e/rebusque.spec.js` hace malabares frente al primero de la cola, comprueba las pelotas en el aire, el cobro, el carro sostenido al verde y el paso atrás al andén (caminando: `Player.speed` entre 0,8 y 3,2 m/s y termina en el andén), y que no haya ningún atropello. Las otras dos pruebas cubren la franela y el bus.
