# Vehículos de Bogotá

La flota conserva los recorridos y las reglas de circulación del juego. Cada carro se reconoce por su silueta, sus proporciones y sus luces; ningún modelo lleva nombre, logo ni emblema de una marca real, y los identificadores del código describen el tipo de carro.

## Carros, taxis y patrullas

Por la ciudad circulan diez tipos de vehículo, los que más se ven en una calle de Bogotá:

| Identificador | Qué es | Caja física, largo × ancho × alto (m) | Rasgos |
| --- | --- | --- | --- |
| `citadino` | Citadino alto y corto | 3,64 × 1,60 × 1,52 | Guardabarros abultados, capó corto y bajo, faros envolventes, defensa de doble toma con exploradoras, portón con limpiabrisas y stops verticales. El taxi lleva capacete curvo de acrílico |
| `sedanPopular` | Sedán familiar sencillo | 4,35 × 1,73 × 1,52 | Cabina vertical, capó alto, baúl largo, faro rectangular de esquinas suaves con dos reflectores, barra cromada en la parrilla, bocel lateral |
| `hatchPopular` | Compacto de cinco puertas de los ochenta | 4,06 × 1,73 × 1,55 | Techo bajo, cintura recta y luneta inclinada, faros trapezoidales con traviesa de esmalte, defensas envolventes oscuras, bocel y rines de acero |
| `sedanDeportivo` | Sedán bajo y largo | 4,46 × 1,79 × 1,44 | Techo que cae como cupé, faro en ranura fina con punta hacia atrás, parrilla de cinco lados con marco negro y ala cromada debajo, cola angosta y labio sobre el baúl |
| `suv` | Camioneta compacta | 4,34 × 1,82 × 1,68 | Más alta sobre sus ruedas, parte baja y arcos de plástico negro, protectores plateados adelante y atrás, parrilla hexagonal, faro cuadrado con tira diurna, barras de techo |
| `pickup` | Pick-up de doble cabina | 5,30 × 1,85 × 1,80 | Alta sobre un chasis a la vista, llantas grandes, platón hondo con costados altos y compuerta con líneas y manija, barras gruesas de cromo en la parrilla, faro escalonado, estribo tubular |
| `cajaSetentera` | Caja de los años 70 | 3,67 × 1,51 × 1,55 | Techo largo con canaletas, tres cristales por costado, guardabarros delanteros salientes, faros redondos con bisel metálico, parrilla de aluminio y defensas con topes de caucho |
| `sedanNoventero` | Sedán cuadrado de los 90 | 4,20 × 1,65 × 1,40 | Aristas, faros rectangulares, parachoques de plástico gris |
| `furgon` | Furgoneta pequeña de carga | 4,05 × 1,60 × 1,90 | Cara corta y plana, faro alto y vertical, stop vertical, parte baja sin pintar, puerta corrediza, puertas traseras ciegas |
| `buseta` | Buseta de ruta | 7,60 × 2,30 × 3,00 | Parabrisas enorme, ventanas seguidas, tablero de ruta inventada, franjas, puerta adelante del eje |

Los particulares salen de una mezcla con mucho blanco, plata, gris y negro, algo de rojo vino, azul oscuro y rojo. Los taxis son amarillos, casi siempre citadinos y a veces sedanes, con capacete, placa blanca, franja de damero y calcomanía en la puerta. Las patrullas siguen siendo blancas y verdes, sobre sedán o camioneta. Una de cada doce unidades del tráfico es una buseta y va un poco más despacio. Las placas colombianas y las rutas son inventadas.

Las ruedas giran según la distancia recorrida; el eje delantero acompaña las curvas. El cabeceo y la suspensión afectan solo a la carrocería visual. En los carros que circulan, los faros y los stops se encienden al ponerse el sol, a las 18:00, y con lluvia o neblina; de día quedan las lámparas apagadas, salvo al frenar o al poner una direccional, y cada carro enciende únicamente las suyas. Los limpiaparabrisas dependen del clima y barren sobre el vidrio de cada modelo: en reposo y al final del recorrido la plumilla se queda dentro de él. Un carro parqueado está vacío: de noche no enciende faros, stops ni capacete y con lluvia no mueve las plumillas. Estas animaciones usan tiempo de simulación y se detienen al pausar.

Los espejos siguen siendo los objetos que se pueden robar y cada modelo los tiene donde corresponde, con la luna a la vista desde atrás. El aviso de robo sale cerca del centro del carro o a un metro de un espejo, para que en una buseta baste con pararse al lado del retrovisor. Una patrulla o un carro ya sin espejos no dan aviso ni le quitan el turno a lo que tengan al lado, y con una persona más cerca que el carro el aviso y la E son del cosquilleo. Al acercarse a unos 4 m de un parqueado se enciende en el piso un contorno rojo, sin luz propia, que sube al andén por el sardinel; se apaga al alejarse o al robarle los espejos. Cuando un conductor se baja a reclamar, sale a la altura de su asiento; el de la buseta sale por su única puerta, adelante y del lado de la acera. Si un parqueado o una pared tapan la puerta, se baja por el lado contrario, y si el carro paró tan lejos que ya no alcanzaría al jugador, no se baja y sigue su camino. Los carros del tráfico muestran un conductor sentado, y a través del vidrio ahumado se alcanzan a ver el tablero, los asientos y el volante. El conductor es una malla compartida con el material de las molduras: tronco que se oscurece hacia las piernas, hombros, brazos, cuello, cabeza con mandíbula y pelo, todo en color por vértice, sin luces ni materiales propios. El platón de la pick-up está abierto de verdad y los pasos de rueda son huecos oscuros.

Contra el andén, además de los carros parqueados, hay grupos de una a tres motos urbanas sin marca. Quedan en un espacio que no alcanza el carril y tienen una colisión sencilla. Comparten geometría y material, con un lote instanciado por grupo: cada grupo a la vista suma una llamada y uno fuera de cámara no se dibuja.
Con aguacero el esmalte pierde del 30 % (blanco y negro) al 45 % (color vivo) de su luz y un 60 % de su rugosidad, el reflejo del cielo crece 2,2 veces de canto y el del vidrio 2,2 veces, y el agua baja en hilos de polvo por costados y puertas. Los niveles de mugre son 0,9, 1,1, 1,25 y 1,5, y capó, techo y tapa llevan gotas secas.
Las placas se reparten por turno: 48 particulares y 16 públicas, en una rejilla de 16 × 4 celdas de 64 × 32, así que ningún vehículo de la calle repite la placa de otro. Las motos llevan ocho placas por turno, con la placa de cada una en los bits bajos del rojo de su color por instancia.

## Cómo está hecha una carrocería

Cada modelo es un juego de curvas: techo, cantos, cintura, hombro, piso y planta. Con ellas se arma una rejilla de secciones (`carLoft.js`) y sobre esa rejilla se decide qué es chapa, vidrio, pilar o moldura. Los faros, parrillas, stops y franjas son piezas proyectadas sobre la chapa (`carParts.js`, `carModels.js`). Se dibujan con la profundidad un poco adelantada hacia la cámara: así la chapa no los atraviesa en las esquinas y no parpadean de lejos. Las placas son láminas rectas para que no se vean torcidas sobre una nariz curva. Sobre el eje central la carrocería es su propio espejo: la normal de la chapa y la de las piezas en espejo no tienen allí componente lateral, y las estaciones que cierran nariz y cola salen exactamente en el eje, de modo que capó, techo y cola no se parten en dos tonos ni dejan rendija.

Las juntas de puertas, capó y baúl, las sombras de los pasos de rueda y las franjas de la buseta van en una textura por modelo que multiplica el esmalte (`carDetail.js`); con mipmaps se funden a la distancia sin titilar. Las líneas son finas y de poco contraste: una junta real se ve por su sombra, no por un trazo negro. Rines, placas y tableros salen de un solo atlas (`carAtlas.js`).




Las ópticas y parrillas proyectadas de `carLamps.js` usan el mismo contorno para el dibujo y la malla. El citadino y el sedán familiar llevan dos reflectores de distinto tamaño. En el compacto, el vidrio prismático cubre un reflector ancho y la direccional ámbar dobla la esquina. Sus stops traseros son horizontales. El carro clásico lleva farolas redondas de vidrio tallado con cerco de acero y una parrilla de aluminio perforado. Las tomas de plástico tienen lamas o panales con fondo oscuro para marcar su profundidad.

Los faros tienen dos dibujos a la misma escala. Al encenderse aparece el reflector claro. La direccional ámbar y el stop rojo conservan sus propios canales y la reversa queda apagada. El dibujo del faro apagado conserva el reflejo del cielo sobre el vidrio. Ese dibujo permanece también en los carros parqueados de noche. Los contornos bajos se mantienen por encima del piso de la carrocería y antes del arco de rueda.

La tapicería usa cuatro celdas del mismo atlas (`carUpholstery.js`). A través del panorámico se distinguen el vinilo del citadino, la tela gris del sedán, el tejido jaspeado del compacto y el paño listado color miel del clásico. Los asientos siguen en el lote de molduras e interior.

La carrocería tiene filas muy juntas en la línea de hombro y en el pliegue bajo de la puerta: el cambio de normal es lo que la luz lee como un doblez de la lámina. Una curva opcional dibuja también el escalón de cada parachoques y la costura sale de la propia malla, sombreada.

El capó del sedán noventero, el sedán popular, el citadino y la camioneta negra tiene dos nervaduras estampadas. El canal sigue la chapa y se desvanece antes de la junta delantera. Al pasar un farol, la laca recoge un reflejo más definido en el panel limpio y más ancho sobre el polvo.

Las defensas del noventero envuelven las esquinas hasta el costado. Sus rines de acero tienen ocho perforaciones que dejan ver el disco del freno detrás de la copa y cuatro tuercas en relieve. Los taxis llevan una tapa abombada con aberturas curvas. En ambas ruedas el caucho conserva su tono oscuro junto al piso, con polvo en el flanco y dos nervios de molde.

El esmalte cambia de acabado según el tono, siempre con el mismo material por carro: el blanco es sólido y no llega a 1,0 para no quemarse, la plata y el gris son metálicos, el negro vive de su reflejo y los colores llevan algo de metal bajo la laca. Todo debe leerse igual en calidad baja, sin mapas de sombra. Todo se genera por código; en Node las texturas quedan vacías y los modelos se pueden construir y medir igual.

Los reflejos del entorno conservan su luz y solo parte de su color: la ciudad es de ladrillo, y reflejada tal cual teñía capós y vidrios de naranja.

La laca devuelve además un entorno falso (`REFLEJO_CALLE` en `carUso.js`): cielo con nubes, una banda de cuadras y, de noche, una banda cálida de faroles. Su fuerza sale de la laca del material, el polvo del mapa la apaga y el carro recién lavado la aviva; de noche los esmaltes vivos aguantan más la luz de los faroles. Los vidrios son ahumados, con el panorámico más claro, y reflejan el mismo entorno; de noche su reflejo baja a la mitad para que el panorámico no se vea encendido por dentro.

El panorámico de los automóviles lleva una franja de tinte verdoso que se degrada hacia el centro. El reflejo cambia de dirección en los bordes curvos. Los hilos de cobre del desempañador quedan sobre el vidrio trasero y se funden a distancia. La camioneta negra conserva su polarizado más oscuro.


## Buses de la troncal

Los articulados se generan por código (dos secciones, fuelle y seis ruedas), con las medidas de `public/models/bus-articulado/bus.json`, y se arman en `ArticulatedBusRig.js`. Ambos sentidos conservan su parada de cuatro segundos, la adaptación a las rampas y el desvanecimiento de los extremos.

El detalle del bus y de la estación está en [TransMilenio: el bus y el Portal del Centro](transmilenio.md).

## Recursos y compatibilidad

Las carrocerías animadas conservan sus piezas durante la precarga. Los GLB anteriores siguen en el repositorio con sus créditos y pruebas de dimensiones; sus ruedas forman parte de una malla indivisible y no sustituyen a la flota animada nueva.


La geometría se construye una vez por modelo y se comparte; por carro solo existen los materiales que cambian de estado (esmalte, vidrio mojado y lámparas) y el del haz en quien circula. El contorno de los parqueados (`src/world/bogota/carMarker.js`) comparte su geometría por modelo y ocho niveles de opacidad para el fundido. En los carros que circulan, ruedas y limpiaparabrisas permanecen separados para poder animarlos. Un parqueado no los anima nunca y los lleva unidos a sus molduras, en una malla por modelo que se ladea con la carrocería: se dibuja en 5 llamadas en vez de 11. Cada vehículo, con conductor y espejos, cabe en 7.000 triángulos y 14 llamadas de dibujo; los espejos, el conductor y las plumillas se ocultan a partir de unos 40 metros. La liberación de un vehículo conserva los recursos compartidos que usa el resto.

Cada modelo tiene su propia huella, y tráfico, colisiones y colas leen `length` y `width` del vehículo. Todas caben en los carriles, buseta incluida: pasa junto a un parqueado con unos 5 cm de holgura, porque los parqueados se apartan del andén solo lo que le deja ese paso (`src/world/bogota/parkedCars.js`) y los más anchos montan hasta 20 cm en el sardinel: su carrocería se ladea y sube, con las llantas de ese lado sobre él y las otras en la calzada, mientras la raíz física y su caja de colisión siguen a nivel de calle. Sus animaciones no trasladan la raíz física. Se conservan los carriles, las prioridades, el frenado progresivo, las partidas guardadas y el presupuesto de audio. La camioneta negra de la limpieza social (`camionetaNegra`) usa el mismo sistema, no entra en la mezcla del tráfico y solo llega por el jugador.

## Comprobación

Ejecutar `npm test`, `npm run build` y `PLAYWRIGHT_GPU=1 npm run test:e2e:headed`. La prueba `vehiculos` de `sala.html` muestra toda la flota en fila y las motos: se pasa de un modelo a otro, con vistas de frente, cola y lado del mismo carro, y botones de noche y lluvia; se comporta como un carro que circula, detenido. La prueba `carros` compara un particular y una patrulla con conductor. Una prueba falla si aparece el nombre o el apodo de una marca o de un modelo real en los archivos de la flota, y otra si un modelo lleva en la nariz o la cola una pieza suelta y centrada con forma de emblema; esta mide la malla, no lo que se pinte dentro del atlas. Revisar en el juego las curvas, una cola ante un semáforo, las luces de noche, la lluvia y una parada de bus. Comparar cámaras y calidades gráficas, y comprobar que abrir un menú detenga las animaciones.

Las mediciones de rendimiento corresponden al equipo y al recorrido comprobados; no garantizan los FPS de otros dispositivos.
