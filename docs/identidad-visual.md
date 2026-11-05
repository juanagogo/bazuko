# Identidad visual de BAZUKO

Cartón y marcador. La interfaz está hecha de lo que el personaje tiene a mano: se reconoce sin logo y sale de quien juega. Lo primero es leerse sin apartar la vista de la calle.

**La regla: la mano y la imprenta.** La mano escribe casi todo: cartón, marcador, cinta. La imprenta sale solo cuando la ciudad habla de ti, y son dos pantallas: la primera plana cuando te coge la tomba y un recorte de periódico cuando te mata la limpieza social. Nada más lleva amarillo. El semitono sale además en el afiche de la carga, a una tinta sobre cartón, y no sale en ninguna otra parte.

## Materiales

| Variable | Valor | Uso |
| --- | --- | --- |
| `--carton` | `#CBA26C` | Toda pieza de información |
| `--carton-mojado` | `#BA8D56` | La misma pieza bajo la lluvia; el marcador sigue por encima de 6:1 |
| `--canto` | `#3B2913` | El grueso del cartón, en lugar de sombra |
| `--marcador` | `#14110C` | Toda letra y trazo sobre cartón |
| `--cinta` | `#E9DBB4` | Solo lo que se oprime, y la letra sobre rojo |
| `--rojo` | `#AB1D17` | Elegido, destino, ruta, tombos, peligro. Sobre cartón mojado, solo como placa, nunca como letra |

La cara de cada pieza es `--cara`. Cuando la calle se moja (humedad de 0,4 o más, y hasta que baja de 0,25) el cuerpo de la página lleva `.mojado` y `--cara` pasa a cartón mojado, de golpe y sin transición.

Las piezas no llevan imágenes de textura, ni filtros en vivo, ni desenfoque de fondo, ni sombras animadas. Ningún color, brillo ni posición oscila a más de 0,5 Hz: la urgencia la da el tamaño, nada parpadea.

## Separarse del fondo

El cartón es del color del ladrillo y del andén con luz de sodio. Por eso toda pieza que va sobre el mundo lleva, además del canto, un filo oscuro alrededor. Con los dos tonos pegados, si la calle es oscura se ve la cara, y si es clara se ve el filo. No es perfecto: de noche, en la avenida y en El Cartucho, entre 3 % y 15 % de lo que rodea a las piezas queda del mismo tono que su borde según el ancho de pantalla, por el filo oscuro sobre lo oscuro y por las muescas del corte; a 1440 en la avenida es de 14 %. La meta era bajar de 6 % y en la mayoría de los casos no se alcanza. Aclarar el canto o cambiarlo con el filo no lo bajó, y engordar el filo le quita sitio a todo.

El corte, el canto y el filo salen de una sola imagen cortada por partes (`border-image`) que se sale de la caja sin ocupar sitio. No hay `clip-path` ni seudoelementos: cada pieza es una sola cosa que pintar, y las esquinas no se estiran por grande que sea.

## Una marca, un significado

| Significa | Marca | Clase |
| --- | --- | --- |
| Información | Cartón con corte y filo | `.carton`, y `.corte-b`, `.corte-c`, `.corte-d` para que dos piezas juntas no salgan iguales |
| Hacer | Cinta | `.cinta` |
| El verbo principal de la pantalla | Cinta con extremos en zigzag, una por pantalla | `.cinta .cinta--verbo` |
| Elegir | Círculo rojo a mano, que sigue la forma de la palabra | `.elegido` |
| No disponible | Tachado | `.tachado`; una cinta `disabled` se tacha sola |
| Hecho | Chulo | `.chulo` |
| Peligro | Rojo con letra de cinta | `.placa` |
| Lo más urgente | Retazo chico con letra grande | `.retazo` |
| Cantidad | Masa rayada, nunca conteo | `.masa`; sobre placa, en cinta |
| Tecla | Celda de marcador | `kbd`, `.tecla` |

Ninguna cinta sale en la muerte. Las demás marcas de la mano están en `src/ui/css/marcas.css`: `--m-tres`, una raya por nivel de fichado; `--m-marco`, el marco del radar; `--m-regla` y `.regla`, una línea; y para el radar y el mapa, `--m-tapa`, `--m-aro`, `--m-olas` y `--m-matas`.

## La letra

**Dios Le Pague**, Grueso y Fino, dibujada por un programa del repositorio que imita una punta biselada: `npm run fuente`, repetido en un mismo equipo, da los mismos bytes. Escribe en `src/ui/fuentes/` los dos cortes, la tabla de dibujos y el manifiesto de lo que traen, en `src/ui/css/marcas.css` los trazos y en `src/ui/marcaBazuko.js` la palabra BAZUKO, trazo por trazo. Cada palabra rota tres formas de cada letra, así que nada sale idéntico dos veces seguidas.

| Uso | Medida |
| --- | --- |
| En menús | 14 px o más (`--letra-menu`) |
| En juego, Grueso o Fino | 16 px o más (`--letra-juego`) |
| Cifras | 20 px o más (`--letra-cifra`, `.cifra`), con dígitos de ancho fijo en todas sus formas |
| Tecla de contexto | 22 px (`--letra-verbo`) |
| Títulos | 28 px (`--letra-titulo`) |
| Lo más urgente | 40 px (`--letra-retazo`) |
| Plata | 44 px (`--letra-plata`) |
| ¡PILAS! y ¡CÓRRALE! | 46 px o más (`--letra-grito`) |

Coma decimal, `5,9 de 20 kg`, y punto de miles en la plata. La pantalla de carga espera a los dos cortes antes de crear el juego, hasta cinco segundos, para que el radar no pinte sin ellos. Los lienzos de la interfaz usan `LETRA` de `src/ui/letra.js`. Lo impreso en la ciudad, como buses y avisos, no usa esta letra.

## Dibujos

Los iconos y los emojis de la interfaz son dibujos de la letra: se tiñen con el color del texto y salen de la misma mano.

- `icon(nombre)` y `setIcon` (`src/ui/icons.js`) ponen un dibujo por nombre. No entra en el texto del botón que lo lleva.
- `pasarTexto(texto)` (`src/ui/pictos.js`) cambia cada emoji de un texto por su dibujo; es la única tabla, y lo que no está en ella sale como el cartón, nunca como emoji.
- Los objetos conservan su arte de `src/ui/item-art/`, teñido con `mask-image`. Los que no lo tienen usan su dibujo (`itemIcon` en `src/data/items.js`).

Un carácter nuevo en un texto del juego tiene que estar en la letra o en la tabla: `tests/letra.test.js` falla si no, para que nada caiga en silencio a una letra del sistema.

## Las tres voces

El cartón habla en primera persona, la calle habla en usted, y el sistema dice lo mínimo. Sin imitar un acento, sin faltas de ortografía de chiste, sin burlarse de nadie. Nunca se tutea, salvo en las frases de abajo.

| Quién habla | Cuándo | Cómo | Ejemplos |
| --- | --- | --- | --- |
| El cartón | Lo que le pasa al personaje, lo que lleva, lo que hizo y lo que sabe | Primera persona | «Me curé», «No me cabe en el costal», «Aprendí a no darle vueltas», «Me atropellaron» |
| La calle | Consejos, órdenes, voces, boletines de la radio | Usted | «Pida limosna (B)», «La próxima, despístelos», «Córrale», «Vuelva de noche» |
| El sistema | Rótulos, botones, ajustes y errores | Sustantivo o infinitivo, sin persona; usted si tiene que pedir algo | «Comprar», «Volumen general», «No alcanza: agua desde $ 1.200», «Revise la conexión» |

Una frase lleva una sola voz. Si hay motivo y orden, el motivo va sin persona: «No alcanza: … Venda material o pida limosna».

Se tutea en seis frases, que la calle le dice al personaje en los momentos duros: «Te tienen fichado», «Se cansaron de perseguirte», «TE CASCARON», «Te cascaron», «Te atrapó la Policía» y «Te mató la limpieza social». Lo que gritan los matones va aparte, porque es de ellos.

**Signos.** Un solo signo de menos (−), coma decimal (98,5; 1,2 km) y un espacio antes de % y de la unidad. Sin puntos medios en lo que dice el juego: se separa con coma o con punto. Quedan en lo impreso de la ciudad (paraderos, tiendas, destinos de los buses) y como separador interno de los avisos con tecla, que nunca se ve. El botón que no se puede usar dice la acción, porque se tacha; el motivo va al lado, sin tachar: «Poner pilas» y «No tengo pilas», nunca «Pilas llenas».

**Nombres.** Las emisoras, el mercado del barrio (Doña Inés), los grafitis y los equipos de los boletines son inventados: ninguno imita uno de verdad. El origen del personaje se cuenta en dos líneas que no se explican entre sí: la historia, sobria, y lo que cambia en el juego. Nadie gana una ventaja por lo que le pasó. Las mañas son cosas aprendidas en la calle: sin rangos, sin títulos y sin experiencia a la vista.

## Foco, dedo y movimiento

- Hay un solo foco, en `base.css`: dos rayas de color contrario, que se ven sobre cartón, sobre cinta y sobre la calle de noche. Ninguna otra hoja lo escribe ni lo apaga.
- Nada se oprime con menos de 44 px bajo 900 de ancho o con puntero grueso.
- Con movimiento reducido ninguna hoja anima nada. El estado nunca depende solo del color.

## Hojas

`src/ui/css/`, en este orden de carga: `marcas` (generada), `base` (letra, materiales y marcas), `hud`, `radar`, `avisos`, `momentos`, `pausa`, `mapa`, `costal`, `mesa`, `paneles`, `entrada`, `foto`, `tactil`.

## El HUD

Radar y necesidades abajo a la izquierda, plata y hora arriba a la derecha, la tecla de contexto abajo al centro. Se lee por posición, masa y cifra: la posición dice qué es, la masa cuánto queda y la cifra exacta solo sale de negro cuando ya importa.

**Filas.** Siempre a la vista: Salud, un poco más alta, Hambre, Sed y Energía. Cada fila es dibujo, nombre en mayúsculas, masa rayada y cifra en columna fija. La letra nunca va sobre el relleno. Bajo 30 la cifra se invierte, de cinta sobre marcador. Bajo 15 la fila entera pasa a rojo con letra de cinta, la masa se vuelve una raya y aparece qué hacer: «a comer», «a beber», «a dormir». Por eso el estado se lee con cualquier vista de color: cambian la forma y la orden, no solo el tono.

Higiene, Ánimo y Vicio van recogidas en **H** y suben a la columna cuando bajan de 30, con su orden cuando están críticas si cabe. Calor sube cuando se está acabando el que ya tienes; mientras no, una línea chica debajo de las filas, «Calientito 2:59», dice cuánto dura. A 844 y a 320 lo que sube se vuelve ficha: dibujo y cifra. El botón de **H** no dice nada: su dibujo cambia de nivel con la peor de las recogidas.

**Lo más urgente.** Un retazo con la frase en primera persona y lo que se va a hacer: TENGO SED, Busco agua; TENGO HAMBRE; TENGO FRÍO; NO DOY MÁS; ESTOY MUY MAL; TENGO MALILLA. Solo hay uno. Sale el de mayor peso, y otro tiene que ganarle por 8 puntos para quitarle el sitio, así que dos parecidos no se turnan. A 320 cede su lugar mientras hay un aviso.

**Arriba a la derecha.** Plata con punto de miles: desde un millón baja un punto de tamaño, y desde diez millones otro, para que siga en una línea. Debajo, hora, día y clima con una palabra, la misma en todos los anchos: Soleado, Sereno, Medio nublado, Nublado, Neblina, Llovizna, Aguacero, Tormenta. Nombre y nivel van debajo y ceden su sitio a la placa durante una persecución.

**Búsqueda.** Cuatro estados, y en cero no se ve nada:

| Estado | Cuándo | Qué se ve |
| --- | --- | --- |
| Nada | Sin fichar y sin patrulla | Nada |
| Fichado | Robaste hace poco y nadie te sigue | Un cartón chico: «Te tienen fichado» y una raya por nivel |
| Patrulla detrás | Persecución a 18 m o más | Placa roja: ¡PILAS!, «Patrulla a 40 m» y barra de cercanía |
| Patrulla encima | A menos de 18 m, y se suelta a 21 | La placa crece: ¡CÓRRALE!, con la misma barra |

El cambio de tamaño es lo que avisa; nada parpadea. La barra de cercanía va en cinta porque está sobre placa.

**Tecla de contexto.** Una cinta por acción, abajo al centro, con la celda de la tecla y un verbo a 22 px. Si hay dos, la segunda es menor. Mantener una tecla llena la cinta a medida que se sostiene. Con el dedo va a la derecha, encima de Pegar y Brincar, una pieza sobre la otra y nunca delante del personaje, que va en el centro: no pasa del 60 % del ancho, y el verbo va en corto («Robar retrovisor», «Comprar», «Darle comida»), sin la nota de al lado. La mesa también tiene la suya, «Fabricar», como cualquier otro lugar.

**El Envión** queda fuera del camino de la tecla: en escritorio sobre los botones de la derecha, y en el celular bajo la plata. La carreta va debajo.

**La gente que habla.** Hablan dos en el celular y tres con pantalla grande, los más cercanos. Cada frase sube sobre la cabeza; si algo estorba, busca el hueco más cercano, por encima o por debajo. No se pisan, no se montan en el cartón y no se salen de la pantalla. Si no hay hueco, esa no se ve.

**Avisos.** `src/ui/avisos.js` es el único que los crea. Se apilan por su altura real debajo de lo que haya arriba y, en celular de pie, nunca bajan del 40 % de la pantalla, donde empieza el personaje. A la vista caben 3 en escritorio, 2 con el celular acostado y 1 de pie; los demás esperan en cola, y el más viejo se apura cuando alguien espera. En la cola el peligro pasa primero: la muerte, luego lo que advierte, luego lo raro y lo vendido, y al final la información. La información que lleva 8 s esperando, o que espera en plena persecución, se bota: ya no es de ahora. El mismo aviso otra vez reemplaza al anterior en lugar de apilarse.

**Radar: qué hacer.** La fila de arriba del radar dice a dónde ir, con flecha y metros, y cuando hay una sugerencia, una segunda línea dice cuánto vale y qué hacer: «Agua $ 1.200», y si no alcanza, «Sin plata: pida limosna» con su tecla. Sin plata la flecha sigue apuntando, al más cercano que vende lo que hace falta. Si lo lleva encima no hay flecha: «Llevas» y «Usar desde el costal». Con el dedo no sale tecla. A 320, si no cabe todo, queda lo que hay que hacer.

**Radar.** Los cinco lugares fijos (el cambuche, la recicladora, la tienda, la mesa y el jíbaro) que queden fuera de alcance son un trazo mínimo anclado al borde, sin letra: dicen hacia dónde quedan sin amontonar nada. Lo demás lejano no se pinta. El plano es un dibujo a marcador de las calles reales, horneado una sola vez y pegado encima del cartón, seco o mojado. Cada cuadro pinta cartón, plano, ruta, dibujos y flecha. No dibuja nada hasta que la letra está lista. Dos lugares que se pisan no se escriben los dos: el que ya estaba escrito conserva su sitio, y la distancia entre ellos se mide en círculo para que girar la cámara no los turne. La ruta lleva halo de cinta para leerse sin ver el rojo. Las herramientas de zoom y cierre están en la columna del lado, y en escritorio se ven siempre; en celular se abren con el botón del destino.

**Misión.** Una tira corta durante 4 s cuando cambia lo que toca hacer, arriba al centro en escritorio y bajo el radar en celular; nunca en una persecución.

**Las cinco composiciones.**

| Pantalla | Reparto |
| --- | --- |
| 1440 y 1280 | Columna abajo a la izquierda; plata y placa arriba a la derecha; botones y barra rápida abajo a la derecha |
| 844×390 | Arriba, radar y filas lado a lado con el destino a todo el ancho, y a la derecha la plata; barra rápida abajo |
| 375×812 | Hoja de plata en una línea, destino, radar y filas juntos arriba; barra rápida abajo y el personaje libre en medio |
| 320×568 | Lo mismo con filas de 22 px; el retazo se oculta mientras hay aviso. Con ¡CÓRRALE! el cartón se pliega a destino y cuatro cifras, sin radar ni barras, para que se vea la calle |

Un celular grande acostado (915×412, 932×430) se compone como 844×390 aunque pase de 900 de ancho: lo que manda es que no llegue a 500 de alto. Bajo 900 de ancho, o así acostado, radio, sonido, cámara, foto y ayuda no están a la vista; salen de «Más». Con los dedos, los pulgares ocupan lo de abajo y el resto se corre: ver Táctil.

**Costo.** El DOM se escribe solo cuando cambia lo que se ve, sin filtros en vivo ni animaciones de pintura. La única excepción son los efectos de consumo: pegante, pastilla y hierba llevan un filtro sobre el lienzo del mundo mientras duran, nunca sobre las piezas, y va más lento que 0,5 Hz. Su costo se paga solo con el efecto activo, y es parte de lo que se juega: por eso se quedó. Con todo moviéndose, el HUD gasta en el hilo principal unos 35 ms por segundo a 1440, con 11 capas pintadas.

## Momentos grandes

Se lo hicieron o le pasó: cartón quieto. Hizo algo y lo pagó: la plana. Lo que pasa a pantalla completa usa `#menu` con `data-momento`, sin las piezas de la ventana genérica; los textos y las cuentas están en `src/ui/momentosTextos.js`, sin DOM.

**La primera plana.** Te coge la tomba: «¡LO COGIÓ LA TOMBA EN LA CARACAS!», o LA COGIÓ si es mujer, con la vía más cercana de verdad (`calleCercana`), en la letra Titular, ajustada al ancho línea por línea: dos líneas con ancho de sobra, tres en celular, con la foto al lado si está acostado. Debajo, una foto del personaje de frente en semitono de una tinta, de punto fino (de 4,5 a 5 px) para que la cara alcance a tener ojos, impresa una sola vez, con un redondel rojo en la cabeza y «Este es Jairo.» al lado, sin pisar el redondel. La tira de abajo es cartón a mano: lo perdido tachado, «Lo sueltan en otro lado. La próxima, despístelos.» y el botón «Continuar». `#menu-title` dice «Te atrapó la Policía», discreto. No se cierra con Escape. Es lo único de todo el juego con amarillo.

Va sobre amarillo y no sobre papel periódico: con el mismo cuadro, de noche, la pantalla entera promedia L* 54 en amarillo y 52 en papel, así que el papel no deslumbra menos; y en papel se parece al recorte, que tiene que ser otra cosa.

La foto la toma una cámara aparte, parada a unos 3 m enfrente de la persona, o corrida si hay una pared; si no hay dónde pararse, queda el último cuadro del juego. La cámara del juego no se mueve. El personaje se dibuja aparte de la calle, con su propio contraste y un aire claro alrededor, y la calle queda clarita de fondo: de noche, de día, con lluvia y en El Cartucho se lee como persona. Cuesta dos dibujos y una impresión, una sola vez y con el juego en pausa. Después es una página quieta: el juego deja de dibujar por detrás.

**Las muertes calladas.** Atropello, golpe, hambre, sed y frío: cartón quieto sobre la ciudad oscurecida, título en marcador sin exclamación («Me atropellaron», «Me mató la sed»), lo perdido tachado, un consejo corto en usted y «Volver al cambuche». Sin cinta y sin semitono.

**La limpieza social.** Cartón vacío y un recorte derecho, en Titular Tira: «Hallan muerto a Jairo, habitante de calle, en la Calle 8. Nadie vio nada.» Sin cabecera, amarillo, rojo, óvalo ni zigzag, y sin exclamaciones. `#menu-title` dice «Te mató la limpieza social», discreto, y las consecuencias van en una línea. El consejo no va aquí: sale como aviso al anochecer siguiente, una sola vez. No hay contadores ni logros de esto. Es el tono más delicado del juego.

**Tirado en el piso.** En el suelo, sin que alcance para morir, baja un cartón que dice qué pasó, y «Ya me levanto», y deja ver al personaje: «Me llevó un carro» si fue un atropello, «TE CASCARON» si fue una golpiza. No lleva botón ni pausa, y se va solo. Un golpe suelto es un tambaleo; un golpe con la salud en 35 o menos deja tirado de verdad, con 8 s de respiro antes de que otro golpe pueda volver a tumbarlo. Mientras está en el piso la limpieza social no le pega: el siguiente golpe es cuando se pare. En celular va justo debajo del HUD, donde estaría la misión: no tapa las cifras.

**El cosquilleo.** Una barra sobre un cartón chico, con la zona buena a marcador y la marca que corre en rojo. Debajo, en su propia línea y a marcador, qué oprimir: Espacio para detener y Esc para cancelar; con el dedo, «Toque la barra en lo negro».

**La partida dañada.** Si lo guardado no se puede leer, no se queda en la carga: se aparta sin borrarlo, y se empieza sin ello, con un aviso que lo dice.

**Dormir.** «CERRADO / ABRIMOS A LAS 6:00», con la hora real de despertar. Se queda medio segundo después.

**La misión.** Una línea arriba: «TOCA ARMAR EL CAMBUCHE». Sale al cambiar de misión, dura 4 s o menos y no sale en persecución. Juntar un cartón más no la vuelve a sacar.

**Malilla y psicosis.** Voces a marcador rojo con filete de cinta sobre la escena: «No mire atrás», «¿Quién está ahí?». Salen de una en una, nunca sobre las cifras y en persecución tampoco en el centro: si no hay sitio, se calla (`sitioParaVoz`). El HUD se corre unos píxeles. No hay filtro en el lienzo ni aberración de color. La cámara no tiembla: solo una respiración y una deriva lentas, por debajo de 0,5 Hz, y con movimiento reducido se queda quieta.

**Los avisos.** El aviso dura según su largo, para alcanzar a leerlo. Lo que me pasa o hice va en primera persona (`Compré`, `Me dio malilla`); lo que aconseja la calle, en usted (`Córrale`); lo demás, lo mínimo (`Partida guardada`). Sin emojis en el texto. En el celular, con un menú abierto, el aviso sube a lo más alto del menú, bajo las pestañas si las tiene: tapa el título y no lo que se está leyendo.

## Menús

**La pausa es una caja aplanada.** Pantalla completa, fondo de marcador y cuatro solapas de cartón arriba: Mapa, Estado, Ajustes y Controles. La solapa elegida empata con la cara de la caja y su palabra va en círculo. Q y E pasan de solapa. El título es «Un momentico» y el único verbo, «Continuar jugando». De pie, las solapas llenan el ancho y el verbo baja, donde alcanza el pulgar. Acostado, el título queda solo para el lector de pantalla: arriba solapas y verbo, y lo demás es contenido. Lo que no cabe se desplaza en `#menu-body`, y cada ventana abre desde arriba.

**El mapa grande es el mismo plano del radar,** con las mismas líneas y sobre el mismo cartón, seco o mojado. Fuera de la ciudad no hay nada que pintar: queda el cartón, y si la ciudad no cabe en la vista, arrastrar no enseña más que un borde de cartón; volver al jugador lo deja lo más cerca del centro que permita ese borde. Los lugares son dibujos a marcador con su halo; con un filtro, lo que no coincide baja a 35 % de opacidad y queda debajo. Se lee La mesa y El jíbaro; por dentro siguen llamándose como los busca el GPS.

**El costal es una rejilla a marcador,** con una regla por celda: sale igual con 20 objetos que con 40. Son siempre 5 columnas y se desplaza solo la rejilla. Bajo 760 de ancho y con el celular acostado, la celda no lleva el nombre: está en el detalle, y el lector lo lee de la casilla. Acostado, a cualquier ancho, rejilla y detalle van lado a lado a toda la altura, y con menos de 340 de alto el detalle deja el pedestal.

**La mesa escribe las recetas como sumas:** «Botella + Cartón = Curita ×2». Lo que falta va tachado, lo que sale subrayado, lo elegido en círculo y lo que ya se puede hacer lleva chulo. Si no cabe en el costal, lo dice con palabras.

**Mañas.** Lo que se puede aprender es cinta, porque se oprime. Lo aprendido lleva chulo. Lo que aún no, tachado y con lo que pide primero.

**La radio** tiene el dial a escala: la AM va de 500 a 1100 en el 78 % del ancho, la FM en el resto, y la aguja señala donde está de verdad la emisora. Mover el deslizador no vuelve a dibujar la ventana, para no soltarlo a mitad del arrastre. Pocas pilas se dicen invirtiendo la cifra.

**Las filas de los lugares,** el jíbaro, la tienda, la recicladora y el cambuche son la misma pieza: reglas a marcador, nombre en Grueso, detalle en Fino y precio como cifra. La plata se llama Plata, y los kilos llevan coma: `5,9 de 20 kg`.

**Un cierre y una cabecera.** Todo menú, el costal, la mesa, las mañas, el jíbaro y los de los lugares, cierra con la misma pieza arriba a la derecha: una equis en cinta y la tecla de ese menú, I, C, T, R o Esc. Con el dedo queda la equis, y con mando dice B. A la izquierda el título, a su lado lo que la ventana dice de sí misma, la plata o la carga, y debajo la regla. La pausa, la plana y los momentos grandes tienen su propio formato, y el creador su equis sin tecla.

**Las cifras se escriben de una manera.** La hora en `06:00`, la distancia en `109 m` o `1,2 km`, el porcentaje en `70 %`. Las necesidades van en el mismo orden en el cartón y en la pausa: salud, hambre, sed y energía primero.

Bajo la lluvia el círculo de elegir sale a marcador: el rojo sobre cartón mojado no se lee.

## Entrada

Carga, creador de personaje, modo foto y panel de rendimiento, en `entrada.css` y `foto.css`.

**Carga.** Un afiche sobre cartón: una de las parejas de `public/images/pantalla-carga/` impresa en semitono, con una sola tinta y a 45°, en una sola pasada de lienzo, con el mismo `src/ui/impresion.js` de la primera plana. Los niveles salen de cada imagen. El personaje queda debajo de la palabra, nunca con la cara detrás de una letra. Se imprime una vez por carga y solo se reimprime si cambia el tamaño de la pantalla: no hay cambio de pareja ni movimiento. Las imágenes se piden con prioridad baja y si no llegan queda el cartón con la palabra; el juego no las espera.

BAZUKO es el avance: se escribe trazo por trazo, en el orden de la mano, con cada etapa terminada. Sale de los mismos esqueletos y la misma punta que el corte Grueso, pero no pasa por el archivo de la letra, así que se escribe antes de que la letra llegue. Debajo dice siempre «Un momentico». No hay barra, cifras ni consejos. El lector de pantalla recibe la etapa y el avance en `#loading-progress`. Si falla: «No se pudo cargar. Revisa la conexión y vuelve a intentar.» y **Reintentar**. Con movimiento reducido los trazos aparecen sin recorrido y el arte sin fundido.

**Creador.** El personaje está parado sobre el cartón, sin ventana ni piso, con su sombra a marcador; nada se le pone encima. A la derecha, o abajo si el celular está de pie, un pedazo de cartón con las pestañas y las opciones: palabras sueltas escritas a marcador, y la elegida lleva su círculo rojo. El verbo de la pantalla es **Empezar**, o **Guardar** al editar en plena partida.

| Tamaño | Reparto |
| --- | --- |
| 1440 y 1280 | Personaje a la izquierda, con BAZUKO y «Otra noche. Mi historia.»; hoja a la derecha |
| 844×390 | Personaje a la izquierda; pestañas y cierre en una sola fila, y el título queda para el lector de pantalla |
| 375×812 y 320×568 | Personaje arriba, hoja abajo; los botones de girar a los lados del personaje |

El nombre baja de letra lo justo para caber: 16 W se leen enteras. Pedir empezar sin nombre muestra `#creator-error` sobre las acciones, y se va apenas hay nombre. El foco no se pierde al redibujar las opciones, Tab no se sale del diálogo, las flechas recorren las pestañas y al cerrar el foco vuelve a donde estaba. El personaje se gira con el dedo, con el ratón o con los botones. A un cuerpo joven solo se le ofrece la ropa que lo cubre (`garmentAllowed`).

**Foto.** Una tira de cartón abajo, con girar, acercar, esconder, **Guardar foto** y volver. La imagen sale del lienzo del juego: ninguna pieza de la página entra en el archivo, con la tira a la vista o escondida. Lo que orienta dentro del mundo, como la baliza del GPS y las marcas de objetos, tampoco: se esconde al entrar y vuelve como estaba al salir. `H` o el botón del ojo esconden la tira para mirar el encuadre, y queda un solo botón en la esquina para traerla. El archivo es `Bazuko-Bogota-<fecha>.png`. La ciudad está en pausa mientras tanto.

**Panel de rendimiento.** `F3`. Un cartón chico que no recibe el puntero salvo en **Reiniciar medición**: en escritorio al centro, debajo de la misión, con todas las cifras; bajo 900 de ancho, dos líneas al borde derecho, a media pantalla, donde no pisa radar ni plata.

## Táctil

Pulgares abajo, solo Pausa arriba, y lo demás en «Más».

**Cuándo sale.** Con puntero grueso o con el primer toque en cualquier parte de la pantalla: entonces `body.tactil` se pone y salen los controles. Gana lo último que se usó. Una tecla física con ningún dedo puesto los quita, y el ratón también; una tecla con un dedo en la pantalla no, porque en un portátil con pantalla táctil se pueden usar las dos cosas a la vez. El mando, al usarse, pone su propio modo. `?tactil=1` y `?tactil=0` lo dejan fijo. Con ratón y teclado no aparece nada ni cambia ningún texto.

**Palanca.** Un aro fino de `--m-aro` en la esquina izquierda, con palanca redonda. Solo el aro recibe el dedo: lo demás de esa esquina sigue siendo calle para mirar. Tiene zona muerta en el centro y llega a tope antes del borde. El dedo se la lleva aunque se salga del aro.

**Mirar.** Un dedo en cualquier parte libre del lienzo gira la cámara con `CameraRig.orbit`. Cada dedo va por su lado: mover y mirar a la vez funciona, y un botón se puede oprimir con otro dedo mientras tanto, también los de los paneles: si el navegador no le da clic al segundo dedo, el botón responde igual al levantarlo, una sola vez. Si otro dedo espera libre cuando el que miraba se levanta, ese sigue mirando desde donde está, sin saltar. En la vista isométrica la palanca es la pantalla: arriba es arriba, con el dedo; con teclado sigue el eje de la calle.

**Botones sueltos.** Tres cintas a la mano sobre `#acciones`, sin caja detrás: Pegar, Brincar y Correr. Inyectan las mismas teclas que el mando (`BUTTON_KEYS`), así que el juego no distingue quién las oprime. Correr: un toque corto lo deja puesto, marcado con el círculo y `aria-pressed`, hasta soltar la palanca; sostenido dura lo que dure el dedo. Con la tomba, la camioneta o una pelea encima se pone roja y dice «Corra». El costal y Fabricar siguen en la fila de siempre.

**Soltar.** Una acción cuenta al levantar el dedo sobre su botón, con 8 px de gracia. Soltar afuera, o que el sistema interrumpa el toque, suelta lo que estaba oprimido y no hace nada más. Tras detener la barra, Brincar no salta durante 250 ms: es el mismo gesto. Entre lo que cuesta caro tocar por error hay 8 px: la palanca y Más, las casillas, las casillas y el costal; a 320 no caben cinco casillas separadas y se conserva la distancia al costal.

**El verbo es el aviso.** Lo que el juego ofrece hacer («Recoger», «Hablar») no tiene botón aparte: el mismo aviso se toca. Donde el juego pide sostener, se sostiene: suelta la tecla cuando se levanta el dedo.

**Más.** Una hoja de cartón con Pedir, Envión, Lanzar, Popó, Robar, Mantener, Detener, Mañas, Cámara, Foto, Radio, Sonido y Ayuda, de 44 px o más. Lo que hoy no se puede queda tachado y no hace nada (Lanzar sin popó, Robar sin nadie cerca, Detener sin minijuego). Ayuda abre la pestaña Controles. Se cierra con Más o tocando fuera. Abierta, nada pasa por encima ni por debajo: la cinta se aparta hasta que se cierre, para que ningún toque le caiga a lo de atrás. Al abrirse no quita la palanca: quien va corriendo sigue corriendo.

**Robar a contrarreloj.** Mientras corre la barra, Brincar pasa a decir Detener y Pegar a decir Cancelar, y tocar la barra también detiene. Abrir un menú en ese momento no tiene sentido. El aviso se esconde para que la barra quepa.

**Textos.** Un texto con tecla nunca llega a la pantalla con el dedo: `sinTeclas` lo cambia al entrar por `pasarTexto` y `el`. «WASD para nadar, Shift para acelerar» dice «La palanca mueve, Correr acelera», y con mando «El stick mueve, RT acelera». En la foto dice «Arrastre para girar», y el detalle de cada objeto va sin teclas. La pestaña Controles se reescribe para el dedo. Las `kbd`, las teclas de las casillas y los pies de panel que hablan de teclas no se muestran.

**Gestos del navegador.** El lienzo tiene `touch-action: none`, y la página no hace zoom con doble toque, no rebota y no selecciona texto. Los menús sí dejan desplazar su contenido.

**Composición con los dedos.**

| Pantalla | Reparto |
| --- | --- |
| 844×390 y celular grande acostado | Palanca a la izquierda, Más a su lado, luego barra rápida y costal; a la derecha las tres cintas. El aviso, sobre esa fila |
| 667×375 | Lo mismo, con las cintas subidas a la derecha porque la fila no cabe; «Más» abierta las tapa mientras está abierta |
| 375×812 | Palanca abajo a la izquierda y cintas abajo a la derecha, encima de la barra rápida; el personaje libre en medio |
| 320×568 | Lo mismo con palanca y cintas más chicas |
| Acostado con menos de 340 de alto, por las barras del navegador | Filas y radar más bajos, palanca de 104, retazo en una línea; nada se pisa. Bajo 620 de ancho, junto al radar queda dibujo, barra y cifra |
| Tableta y portátil con pantalla, 900 o más | Palanca de 160, barra rápida y costal a su lado, cintas de a dos, y las herramientas arriba |

El mapa se pellizca: el punto entre los dedos se queda entre los dedos, y al quedar uno, ese arrastra desde donde está, sin marcar destino.

Las zonas seguras se suman a cada pulgar. Con los dedos, en estado normal, queda tapado a 844 de 33,0 a 36,2 %, a 375 de 34,6 a 42,7 % y a 320 de 48,2 a 54,8 %. En la zona del personaje a 375, de 1,6 a 2,6 %.

## Mando

Oprime lo mismo que el teclado, y lo que dice en pantalla es su botón: A, X, Y, B, LB, RB, LT, RT, View, R3 y la cruceta. Lo que no cabe en un botón se alcanza sosteniendo LB: Y abre la mesa, X las mañas, la cruceta es las casillas 1 a 4 y A la casilla 5. LB tocado solo cambia la cámara, al soltarlo. Una tecla escrita en la pantalla sin botón no se muestra. Popó y Foto no tienen botón.

## Comprobación

`tests/voz.test.js` lee todos los textos del juego y se cae con un tuteo, un punto medio, un signo de menos corriente, un nombre de marca o una palabra ajena. `tests/letra.test.js` comprueba la letra, las cifras, la cobertura de los textos y que el programa dé lo que está guardado. `tests/pictos.test.js`, la tabla de dibujos. `tests/menus.test.js` y `tests/e2e/menus.spec.js`, los menús: T y C cierran, 34 tipos de objeto en el costal a cinco tamaños, el mapa sobre el cartón, el dial a 375 y que no vuelvan los emojis ni las clases viejas. `tests/materiales.test.js`, los seis colores, el contraste, el foco único, los 44 px, que nada parpadee y la lluvia. `tests/e2e/identity.spec.js` comprueba la separación de controles con saldo largo y acceso rápido visible, la navegación de paneles y la ausencia de desbordamiento horizontal a 1440, 375, 320 y 844. `tests/hud-estados.test.js` comprueba los cuatro estados de búsqueda, el retazo, las órdenes, el decaimiento del fichado, el alcance de vista por nivel, el creador único de avisos y su cola por ancho. `tests/momentos.test.js`, los textos de los momentos, la calle, lo perdido, el consejo una sola vez, el encuadre y que el amarillo, el semitono y la imprenta no salgan de la plana. `tests/e2e/momentos.spec.js`, la plana impresa, la muerte, el recorte, las voces, CERRADO, TE CASCARON, y la limpieza social de punta a punta con el juego real. `tests/e2e/hud.spec.js`, en los cinco anchos con el juego real: filas sin letra sobre el relleno, retazo, persecución de verdad, área de la placa, avisos fuera de la zona del personaje, plata y nombres largos, y los contenedores táctiles. `tests/entrada.test.js` comprueba que la palabra guardada sea la del programa, el orden de los trazos, el semitono, el encuadre del personaje, el ajuste del nombre y que no vuelvan barra ni consejos. `tests/e2e/entrada.spec.js`, en los cinco tamaños con el juego real: una sola tinta, escritura a medias, fallo y reintento, 16 W, personaje sin tapar, error, teclado, ropa de cuerpo joven, giro con el dedo, foto limpia con tira escondida, nombre del archivo y panel de rendimiento sin pisar el HUD. `tests/tactil.test.js` comprueba la palanca, cuándo se activa el modo, qué teclas inyecta cada botón, qué se tacha, que los textos no nombren teclas con el dedo y salgan idénticos con teclado, y que nada táctil exista sin `body.tactil`. `tests/e2e/tactil.spec.js`, con toques de verdad: mover y mirar a la vez, sostener, tocar con otro dedo, volver de la pausa, la cinta del aviso, y que con ratón y teclado todo siga igual.
