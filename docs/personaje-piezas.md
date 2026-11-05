# Piezas del personaje realista

El personaje se arma con piezas de MakeHuman exportadas por `tools/personaje/exportar_variantes.py` a partir de `tools/personaje/catalogo.json`. El juego lee el resultado en `public/models/personaje/catalogo.json`.

## Qué funciona sin exportar

- **Descalzo** (`calzado`): no usa malla; se ve el pie del cuerpo.
- **Bastón y mochila** (`look.accesorios`): se construyen con geometría simple en `src/character/props.js` y se atan a los huesos `RightHand` y `Spine2`. No dependen de MakeHuman ni de licencias externas. Lo que carga la gente de la calle va aparte, en `look.real.accesorios` (ver *La gente de la calle*).
- **Desgaste, tonos de ropa y canas**: materiales de calle sobre las texturas existentes. Ver [tools/personaje/MATERIALES_CALLE.md](../tools/personaje/MATERIALES_CALLE.md).

## Sombreros (`cabeza`)

| Id | Asset | Pack | Licencia |
| --- | --- | --- | --- |
| `boina` | `jujube_newsboy_cap` (jujube) | [Hats 01](https://static.makehumancommunity.org/assets/assetpacks/hats01.html) | CC0 |
| `gorro-lana` | `mindfront_knitted_hat_01` (Mindfront) | [Hats 03](https://static.makehumancommunity.org/assets/assetpacks/hats03.html) | CC-BY |

Ambos están exportados para los seis cuerpos, con su versión liviana. El gorro de lana oculta el cuero cabelludo que tapa. Con cualquier sombrero, `src/character/hatFit.js` mide el borde inferior del sombrero alrededor de la cabeza y recorta el pelo que queda por encima, así el pelo largo sale por debajo sin atravesarlo.

El bastón no cuelga del hueso de la mano: en cada cuadro se coloca vertical en el puño y su palo se alarga hasta el suelo.

**CC-BY exige crédito.** El crédito a Mindfront está en el README (*Recursos de terceros*) y en la lista de `src/ui/DeveloperNote.js`. No quitarlo mientras el gorro siga en el juego.

Si MPFB no crea el material de una pieza (pasó con la boina), el exportador lo arma con la textura difusa y el normal map declarados en el `.mhmat` de la pieza.

## La gente de la calle

`src/character/archetypes.js` dice quién es cada peatón: oficinista, estudiante, señora con su bolsa de mercado, abuelo con bastón, obrero, vendedor, reciclador con su costal y habitante de calle. Son solo datos, sin Three ni catálogo; cada zona de la ciudad tiene sus pesos (`ZONE_WEIGHTS`): en El Cartucho casi todos viven de la calle y en los andenes se ve de todo. `gastada: true` significa habitante de calle. El jugador, los estilos del creador y quien recibe un `look` (escuadrón, conductor bravo) no pasan por aquí.

Una persona lleva en `look.real`, además de sus piezas:

| Campo | Qué es |
| --- | --- |
| `tonos` | `{ arriba, abajo, patron, patronColor, calzado }`: colores de la ropa. `patron` es `liso`, `rayas` o `franela`. `calzado` solo lo lleva quien va de `zapatos`: negro, café oscuro o gris (`SHOE_TONES`). Sin tonos queda la textura original |
| `desgaste` | 0 limpio, 1 gastado, 2 muy sucio |
| `talla` | `{ alto, ancho }`, de 0,94 a 1,06 y de 0,94 a 1,10. Es la escala del grupo; el jugador no la lleva. Quien se sienta en una banca la tiene en 1, porque la postura está medida para ese alto |
| `accesorios` | `[{ id, color }]`, los de la tabla de abajo |

Dos reglas valen para toda persona. Ningún tono de ropa, ni el de las rayas o la franela, se parece a su piel (`skinDistance`, con el margen `SKIN_CLEARANCE`): de lejos, una camisa de ese color se lee como un torso sin ropa. La regla mide solo la distancia de color: un ocre de matiz más cercano a la piel se sigue leyendo como camisa a 20 m, y un coral rojizo más lejano no, así que el matiz no separa esos casos y el coral se cambió por un frambuesa frío. Y **ningún cuerpo joven lleva prendas que dejen al aire el torso o las piernas** (`UNCOVERED_GARMENTS`: `short`, `sudadera` y `rota`), ni en la calle, ni en el creador, ni en una partida guardada, donde `normalizeReal` cambia la prenda. `tests/street-look.test.js` mide con la malla del cuerpo que la lista esté completa. Además, el pelo rubio solo sale en piel clara y el cobrizo nunca en la más oscura, porque el pelo y las cejas se veían amarillos.

El arquetipo también decide su paso (`andar`) y su velocidad, su forma de llevar el cuerpo (`estilo`), qué hace en una parada y al salir (`paradas`, `marcha`) y qué hace bajo la lluvia (`paraguas`, `lluvia`, `correr`). Quien lleva algo en una mano no pide posturas que la necesiten (`MANOS`).

### Accesorios

Son geometría simple en `src/character/props.js`, sin logotipos. Cada uno es una sola malla, y por tanto una sola llamada de dibujo, con geometría de módulo y material compartido por color (`sharedPropMaterial`). Ese material lleva `userData.shared` para que `disposeRealisticInstance` no lo libere. El hueso se lleva el objeto; lo único que se toca por cuadro es el giro local de la bolsa y el costal, que se mecen con el paso (`swayStreetProps`) y se quedan quietos cuando la persona no anda.

| Id | Cómo se lleva | Lejos |
| --- | --- | --- |
| `maletin`, `bolsa` | En la mano izquierda, con el marco que hornea `stances.js` (`holds`). La bolsa es de plástico floja, de unos 22 × 29 × 24 cm, recogida arriba con sus asas | Sí |
| `baston-calle` | En la mano derecha. Es de una pieza: a diferencia del `baston` del creador no se recoloca en cada cuadro, y su largo se ajusta al alto de la mano | Sí |
| `morral`, `bolso`, `costal` | Cuelgan de `Spine2`, medidos desde el cuello (`anchor`), desde donde el hombro queda casi a la misma altura en los seis cuerpos. Morral y costal tienen otra geometría de módulo para la espalda de las mujeres, 4,5 cm más adelante. El costal mide unos 36 × 50 × 27 cm, con pliegues que salen del nudo, y no pasa de la cabeza | Sí |
| `casco` | En `Head`, algo menor en las mujeres | Sí |

El paraguas y el celular los lleva `Npc`, que los muestra con la postura: una malla por persona, con todo lo demás compartido. Quien corre sigue con el paraguas en la mano; el bastón de calle cambia de agarre (`baston-correr`, horneado con las demás manos) y va atravesado en el puño, sin arrastrar. Al quedar noqueado, los dos caen al piso como objetos del mundo, con la misma geometría y el mismo material, donde va a apoyar la mano al pararse y contando con lo que lo empuje el golpe. Si ahí no caben, en el mismo piso y fuera de lo sólido, van más cerca, al otro lado o apuntando para otra parte; en el peor caso, a sus pies. No se mueven hasta que la mano llega: entonces se atan al hueso sin cambiar de sitio y en un momento quedan como se llevan, y el brazo va tomando la postura del paraguas en el último tramo de la subida. Lo que debe verse de lejos va en `FAR_ACCESSORIES`; lo demás solo lo lleva el modelo completo. Un chaleco de obra y un tapabocas rígidos se probaron y se quitaron: no siguen la ropa ni la cara, y se veían como una placa pegada.

### Conductas

En `src/entities/Npc.js`. Al terminar un recorrido, quien tiene arquetipo hace una parada de 4 a 20 s con una postura de su tabla, salvo en un cruce o fuera de la red, donde solo toma aire. A menos de 4,5 m mira al jugador, solo con el modelo completo. Con la higiene del jugador por debajo de 30 se tapa la nariz. Bajo la lluvia saca el paraguas o se cubre y apura el paso.

Entre 15 y 20 de los 80 peatones son fijos (`opts.fijo`, lista en `Bogota._fixedPeople`): dormidos y sentados en El Cartucho, parejas conversando, sentados en bancas, quien pide, y quien espera en el andén del Portal. No se suman a los 80, reemplazan a un caminante. Si los atacan o los asustan, se levantan, reaccionan como cualquiera y, pasado el susto y sin el jugador a menos de 8 m, vuelven a su sitio; si uno de una pareja se asusta, el otro también se va. Huyen por la red peatonal, sin entrar en nada sólido, y solo el último tramo de regreso puede salirse de ella. Quien huye derecho y se topa gira a un lado libre; si se topa otra vez a menos de 3 m, deja de rebotar: toma la ruta de la red que más lo aleja del susto y, si no la hay o le pasa por algo sólido, se agacha a esperar. Con algo en la mano espera de pie. Mientras esperan a poder volver están de pie, turnando sus alternas que no sean bajas o, si no tienen, mirando y cambiando el peso, en el centro de una baldosa de andén: nunca en un cruce ni en la calzada, aunque el jugador siga al lado, porque esos centros quedan a más de 2,5 m de cualquier carril. Si el jugador está parado en su sitio, esperan a un paso. Una patrulla en persecución o de regreso no frena por nadie: quien está en su camino se quita de lado, también desde la banca. Los vendedores son fijos que atienden y no dejan su puesto. Quien sigue en su sitio pasa al modelo completo a 4 m y vuelve al liviano a 6, para que un grupo no cambie todo a la vez, y el que entra sigue en la postura en que iba el que sale, también a media subida; lo que tiene en la mano se ve desde 7 m, con cualquiera de los dos.

Al armar la ciudad, `PedestrianNavigation.cutSolidEdges` corta los tramos de andén que atraviesan una caja sólida a la altura del cuerpo: una columna, un muro bajo, una caja. Las bancas no tienen colisión, pero también se le pasan: nadie cruza por encima de una, y quien vuelve a la suya llega por el último tramo libre. Los tramos que tocan un cruce no se cortan, porque cambiarían por dónde se reparte la gente al cruzar y con eso el paso del bus; por ahí todavía se puede rozar una columna. Para añadir un fijo, `tests/fixed-people.test.js` comprueba que no quede en un cruce, en la calzada, dentro de un muro ni tapando un paso, y que pueda volver.

La red solo une baldosas a menos de 0,6 m de desnivel, y eso vale también en los cruces: nadie sube de la calle a un tablero de un paso. El tablero del puente del lago es del bus. A pie se pasa por debajo, igual que bajo el resto del viaducto, y por eso los peatones miden el piso con `Bogota._pedestrianGround` y no con `getGroundHeight`, que debajo del puente da la cota de arriba. Sobre el agua no hay nodos, ni donde el tablero ya viene bajando y no cabe una persona, desde Z 304 hasta la orilla sur; el parque se cruza por debajo al norte y al sur del lago. Esos tramos sí los cortan los pilares, porque abajo no hay tráfico. El GPS y el jugador no cambian. Quien queda fuera de la red principal, el grupo más grande de nodos unidos (una banca, un rincón, un bolsillo suelto entre torres), sale a su nodo más cercano; los fijos siguen volviendo a su sitio por el último tramo libre.

## Retoques al armar el personaje

Estas piezas se ajustan al cargarlas, una vez por geometría compartida:

- **Medias.** Tenis y zapatos traen medias hasta media canilla, que atraviesan los pantalones. Debajo de un pantalón largo no se ven y se quitan; con `short` se quedan (`GARMENTS.short.piernasAlAire`). Las botas no tienen esa pieza.
- **Crespo.** Sobre sus dos capas trae cuadritos sueltos que de cerca forman una malla: se quitan y queda la mata, con un grano fino en el material.
- **Ropa.** Cada prenda necesita su fila en `GARMENTS` (`src/character/streetMaterials.js`) para poder recolorearse: `tests/street-clothes.test.js` falla si falta, y comprueba arriba y abajo en cada prenda de cada cuerpo, en los dos modelos.

Algunas prendas se llevan peor con los tonos. Una `chaqueta` con patrón también lo pinta en la camisa de adentro, la `rayas` conserva sus rayas finas de textura aunque el tono sea liso, y el dobladillo de la `rota` tiene dientes de tela rota. La `sudadera` es una prenda corta que deja ver el vientre: como el `short` y la `rota`, ningún cuerpo joven la lleva.

## Sin marcas

El juego no muestra marcas. `tools/personaje/limpiar_marcas.py` quita de las texturas el logo de camisetas y blusas, la etiqueta de cuero del jean, la hebilla con letra del overol, y la marca de la puntera y la etiqueta de la lengüeta de unos tenis, rellenando con la tela de alrededor. También pasa a café el iris de los ojos, que en la textura es de un óxido que con la luz del juego se ve rojo. Hay que correrlo después de exportar:

```sh
python3 tools/personaje/limpiar_marcas.py [carpeta de originales] [carpeta de destino]
```

Siempre debe partir de lo recién exportado. WebP guarda con pérdida, así que cada pasada degrada la imagen entera. `tools/personaje/texturas-limpias.json` anota el sha256 de cada original y de cada resultado: lo ya limpio se deja como está, lo que no coincide con ninguno se trata como exportación nueva y se avisa, y `tests/archetypes.test.js` compara esa tabla con los archivos del juego. Si una textura cambia, hay que mirarla en grande y puesta en un personaje antes de aceptarla.

Las notas de licencia en las esquinas de algunas texturas quedan como están: caen fuera de las prendas y no se dibujan.

## Exportar

1. Instalar en Blender 5.2 la extensión **MPFB** desde *Edit → Preferences → Get Extensions*.
2. En MPFB, cargar los *MakeHuman system assets* y los packs Hats 01 y Hats 03 (*Apply Assets → Library settings → Load pack from zip*).
3. Ejecutar desde la raíz del repositorio:

```sh
"D:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python tools/personaje/exportar_variantes.py
```

Para regenerar un solo cuerpo, añadir `-- hombre-mayor`. Para añadir piezas sin rehacer las demás (ni tener instalados sus assets), usar `-- --piezas=boina,gorro-lana`: solo exporta esas piezas y las suma al catálogo existente. Si un asset no está instalado, MPFB falla al buscar su `.mhclo`: revisar que el nombre de la carpeta coincida con el del catálogo.

Las texturas compartidas miden como máximo 1024 px (`MAX_TEX` del exportador). Trece texturas normales y de ropa que habían quedado en 2048 o 4096 px se redujeron a 1024: el personaje nunca ocupa suficiente pantalla para usarlas, y cada normal de 4096 px ocupaba unos 89 MB de memoria de video. Si una exportación vuelve a producir texturas mayores, revisar `shrink()`.

Después de exportar, ejecutar `node tools/personaje/tapar_cuerpo.mjs`, `python3 tools/personaje/limpiar_marcas.py` sobre las texturas recién exportadas y luego `npm test`: `tests/street-presets.test.js` comprueba que los estilos y ambos catálogos coincidan.

## Piel bajo la ropa

La piel que queda debajo de la ropa no se dibuja. Si se dibujara, las rodillas y la cadera atravesarían la tela al sentarse o arrodillarse. `oculta` lista los vértices del cuerpo completo (por `_VID`) que tapa cada prenda, y `ocultaLod` los del cuerpo liviano, que es otra malla, por su índice. Parten de los grupos de borrado de cada prenda y `tapar_cuerpo.mjs` completa lo demás: un vértice se da por tapado si todos los rayos que salen de él, en abanico alrededor de su normal, chocan con la prenda en su pose de atadura. El borde de una manga o un agujero de la camiseta rota dejan escapar algún rayo y esa piel se conserva. Del cuerpo liviano un triángulo solo se quita si la ropa lo tapa entero, porque son grandes. Además de quitar los parches, cada peatón lejano dibuja unos 800 triángulos menos, de los 3140 de su cuerpo.
