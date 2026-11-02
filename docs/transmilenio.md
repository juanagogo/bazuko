# TransMilenio: el bus y el Portal del Centro

El articulado rojo y la estación Portal del Centro se generan por código, sin modelos de terceros; lo único que se descarga es `bus.json`, la ficha de medidas del bus. Los dos se dibujan con pocas llamadas: cada material es una sola geometría y el color por vértice hace de sombra horneada. En calidad baja no hay mapas de sombra, pero la sombra de la ciudad les cae igual que al piso.

## El bus

- **Carrocería.** Rojo profundo con franjas limpias, techo claro, dos unidades de aire y escotillas. La parte baja lleva una suciedad suave y se oscurece alrededor de los pasos de rueda. El nombre y el número de flota van pintados en el costado.
- **Ventanas.** Vidrio oscuro con reflejo del entorno y marcos negros. Por dentro se ven filas de asientos, tubos amarillos y pasajeros. De noche el interior se enciende con luz cálida y el vidrio deja ver más; no hay luces nuevas, todo es emisivo.
- **Puertas.** Son altas, de vidrio y quedan a la izquierda del sentido de marcha, del lado de la isla. Se abren cuando el bus lleva un momento detenido y se cierran antes de arrancar, siempre dentro de los cuatro segundos de parada.
- **Frente.** Parabrisas enorme de una sola pieza, inclinado y de esquinas muy redondeadas, que baja casi hasta el parachoques dentro de una máscara negra que nace de la banda de ventanas del costado. Arriba, el letrero LED integrado bajo una visera; a los lados, grupos de faros delgados con dos lentes, luz diurna, posición y direccional; abajo, parachoques liso en dos tonos, antinieblas y las franjas de la flota de lado a lado. Los retrovisores cuelgan de brazos largos tipo antena. El costado empalma con el frente sin escalón, porque la tapa sale tangente a la carrocería.
- **Limpiabrisas.** Quedan parqueados sobre la base del vidrio y barren mientras llueve; si escampa, terminan el barrido y se detienen. Giran en el mismo material del caucho con un valor por bus, sin geometría ni material de más, y siguen la curva del vidrio.
- **Cola.** El mismo lenguaje del frente: máscara negra alta con ventana y letrero LED, grupos verticales de luces (direccional, posición y stop, reversa y antiniebla), tercer stop, rejilla del motor y parachoques en dos tonos. Los stops se encienden al frenar y mientras está detenido.
- **Pasajeros.** Cada uno tiene su estatura, colores y postura: hombros, cuello y piernas si va sentado; si va de pie, con un brazo arriba.
- **Letrero.** Es de matriz de puntos y alterna cada cinco segundos entre la ruta y el destino: hacia el norte `B12 PORTAL CENTRO`, hacia el sur `B12 PARQUE DEL LAGO`, y `EXPRESO CARACAS` en los dos sentidos. Las rutas son inventadas.
- **Fuelle.** Caucho oscuro con pliegues y marcos de acero; se dobla entre las dos secciones en las curvas y en las rampas del viaducto.
- **Ruedas.** Neumático grande con banda, rin de acero oscuro con pernos y guardabarros en sombra.

Siguen igual el recorrido, la articulación, la parada de cuatro segundos, la adaptación a las rampas, el desvanecimiento de los extremos, las cajas de colisión y el audio. Cada bus usa como máximo 24 llamadas de dibujo y unos 28.000 triángulos, y la prueba no deja pasar de 25 y 30.000: 21 llamadas de día con el bus en marcha, una más por los stops, que solo lleva la sección trasera, y dos más por los destellos de los faros de noche.

## La estación

La isla sigue en X 75, Z −30, con 4 × 40 m a 0,92 m de altura, y se entra por las dos rampas de siempre.

- **Estructura.** Columnas y cerchas de acero repetidas, voladizos que pasan por encima del techo del bus, cubierta curva de lámina acanalada con canal y fascia roja. Desde adentro se ve un cielo raso de paneles con su propio tono, alguno manchado por goteras, rejillas de ventilación, bandeja de cables y dos filas de luminarias que se encienden de noche. Altavoces y cámaras son domos.
- **Muros y puertas.** Vidrio con reflejo, cada panel con su polvo y más sucio abajo, banda esmerilada a la altura de los ojos, parales, friso rojo que también se lee por dentro y puertas corredizas de marco rojo con línea amarilla en el piso. Cada puerta queda frente a una del bus de su carril: las de los dos costados no están a la misma altura porque los buses paran en sentidos contrarios. Se abren con el bus detenido; el jugador no las cruza, porque el muro sigue siendo sólido.
- **Andén.** Baldosa de tonos distintos con junta oscura, desgaste, manchas y chicles, que no se repite antes de 3,6 m; guía táctil amarilla a lo largo de las puertas y bordillo amarillo. Por fuera, la base es de vaciados de concreto de 4 m con su junta y salpicado de llantas, con un riel corrido contra el roce y bajantes. Bancas, canecas, mapas de ruta genéricos, letreros rojos de vagón y tres tableros de próximos buses.
- **Accesos.** Letrero del portal sobre cada entrada, molinetes de extremos redondos con zócalo, lector de tarjeta y una raya de luz de paso, con el paso central abierto, taquilla con taquillero y rampas con baranda de dos tubos.
- **La calle.** Carriles exclusivos de losa con juntas, huella de llantas y leyendas, separadores con prado, calzada mixta con líneas y flechas, cebras de orilla a orilla, cunetas con sumideros, andenes con cicloruta y cicloparqueadero, bolardos en las puntas de la isla, postes con cabeza emisiva y charco de luz fingido de noche, chazas, vallas del barrio y una barrera de fin de vía.

De noche todo se enciende con emisivos, sin luces nuevas: desde la calle se lee el vidrio iluminado, una línea de luz bajo el friso y la luz que cae por tramos sobre el andén y se escapa hasta los carriles. Lo que está bajo el techo tiene un rebote propio, de día y de noche, para que molinetes, bancas y columnas no se vean negros. Con lluvia brillan la losa, los andenes y la pintura, y el andén cubierto sigue seco.

La estación suma 16 llamadas de dibujo de día y 17 de noche cuando está a la vista, unos 19.000 triángulos, y la calzada se fusiona con el asfalto de la ciudad. Los árboles de los andenes se fusionan con los del distrito.

## Caminar por la estación

Los muros y las barandas son sólidos, así que a la plataforma solo se sube por las rampas, por el paso central de los molinetes.

- **GPS a pie.** Una grilla de 2 m no ve un muro de 12 cm, así que el planificador pregunta además si cada tramo cruza el borde de la isla o roza un poste del separador. Solo se entra a la isla por los dos pasos peatonales (Z −2 y Z −58), entre el fin de la baranda y los bolardos, y sobre la isla la ruta va por el eje, el único paso libre entre bancas, molinetes y taquillas. Desde el carril de al lado se da la vuelta por la rampa.
- **Peatones.** Su red de caminos no tiene nodos en las filas de Z negativa: no entran a la estación ni se traban en sus muros.
- **Sin encierros.** Cualquier punto de la isla y de los carriles, en una malla de 25 cm, tiene salida caminando, incluso uno dentro de una caja, por ejemplo cuando el bus empuja contra el muro a quien iba por el carril. Las cajas por capas, entre ellas las de la estación, solo limitan el eje por donde se sale de ellas, para que banca y muro no se prohíban la salida la una a la otra. Quedan sin salida unas rendijas de centímetros dentro de las cajas de la isla, como X 76,45, Z −45,88: el movimiento no deja entrar en ellas y cada entrada al juego empieza frente al cambuche.

## Lo que no cambió

`terminalGroundHeight` conserva las alturas de la isla, las rampas, los andenes y la calzada; la única altura nueva es la de los separadores, de 0,14 m, que se abren frente a los dos pasos peatonales. El pasillo central queda libre de punta a punta y las colisiones siguen siendo cajas por capas, así que los muros no estorban a quien pasa por debajo. Los costados del recinto siguen donde estaban. Al fondo, la barrera avanza hasta Z −73,3 para que nadie la atraviese: por los carriles, entre X 68,3 y X 81,7, se camina hasta ella, y a cada lado el cierre de obra detiene antes, en Z −71,6.

## Dónde está

- `src/world/bogota/BusBody.js`: geometría y texturas del bus, compartidas por todos.
- `src/world/bogota/ArticulatedBusRig.js`: arma el bus, sus materiales propios y la articulación.
- `src/world/bogota/BusService.js`: el recorrido y cuándo abren las puertas.
- `src/world/bogota/TransitTerminal.js`: la estación y su calle.
- `src/world/bogota/MeshKit.js`: acumula las piezas en una sola geometría y trae la fuente de los letreros.
