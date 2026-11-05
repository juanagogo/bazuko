# Materiales de calle del personaje

`src/character/streetMaterials.js` es el material de todos los personajes realistas: el jugador, los peatones y quien salga en el creador, con su modelo completo y con el liviano. Se aplica sobre las texturas existentes y no cambia la forma de nadie, salvo el pequeño margen de la ropa que se cuenta abajo. Todas las marcas se calculan en coordenadas de reposo (1 es la estatura), así que siguen a la superficie al animar. La semilla sale de la apariencia: la misma persona conserva sus marcas al volver a cargar.

`look.desgaste` manda sobre casi todo: 0 es limpio, 1 lleva tiempo en la calle y 2 mucho. `look.real.desgaste`, si está, tiene prioridad. Sin ninguno de los dos se usa 2, y un 0 explícito se respeta.

## Piel

- **Tono.** `SKIN_ALBEDO` guarda el color que debe verse en cada tono de la paleta, y `streetSkinColor` corrige la textura de cada cuerpo para llegar a él. Así el tono no se vuelve naranja al multiplicar por una textura ya rojiza. La cara de estas texturas es más oscura que los brazos: `streetFaceTint` la acerca a la mitad de camino y se funde en el cuello. Los dos tonos más oscuros están medidos para que a la sombra de un edificio la cara conserve su forma, y el más claro, para que no parezca porcelana.
- **De cerca.** La piel lleva un moteado fino y manchas suaves en el color y en la aspereza, que se funden de lejos, y los poros del mapa normal. Sin ellos se lee como cera.
- **Sol de altura.** Nariz, pómulos y frente se curten, y más con el desgaste. Cuanto más oscura la piel, menos pesa ese desgaste en la cara: si pesara igual, la piel más oscura perdería la forma de la cara a la sombra.
- **Mugre.** Manos y cuello, según el desgaste. Los pies descalzos siempre, porque nadie camina sin zapatos y se salva de ensuciarse.
- **Barba de días.** Los hombres sin barba llevan una sombra en mandíbula y bigote que crece con el desgaste. De lejos es un tono; solo de muy cerca se ve el grano.
- **Rojo y sombras.** Orejas algo más rojas y ojeras. Los labios ya vienen rojos en la textura: se apagan un poco, más en piel clara, para que no salgan color salmón.
- **Cejas.** El modelo liviano no tiene malla de cejas: se pintan sobre la piel para que no salten al cambiar de modelo.

Los poros son el único detalle exclusivo del modelo completo. Colores, marcas, semilla y tonos son los mismos en los dos, de modo que el cambio de modelo no se nota. `tests/street-clothes.test.js` lo comprueba por valores, y la vista con los dos modelos juntos se revisa a ojo.

## Ropa

`look.real.tonos = { arriba, abajo, patron, patronColor }` pinta la prenda de cada persona. Los colores son `#rrggbb` y `patron` es `liso`, `rayas` o `franela`. `tonos.calzado`, opcional, es el color del zapato de cuero. Sin tonos, o con un color roto, la prenda conserva su textura: el jugador y los estilos del creador no cambian de color. Un patrón desconocido queda liso y sin `patronColor` se usa el de abajo. `normalizeReal` deja el dato limpio con `normalizeTonos`. `look.uniforme` manda sobre los tonos: la escuadra y otros uniformes siguen siendo de un solo color.

- **Qué es arriba y qué es abajo.** Una prenda trae camisa y pantalón en el mismo archivo. No se puede cortar con un plano, porque el dobladillo de la camisa queda por debajo de la pretina del pantalón que tapa. Se separan por islas de la malla (`markGarmentZones`, una vez por geometría compartida) según su altura media, con la `cintura` de cada prenda en `GARMENTS`. En el overol, arriba es la camiseta, que se reconoce por su sitio en la textura, y todo lo demás toma el color de abajo. Una prenda nueva necesita su fila en `GARMENTS`, con la luminancia media (`luz`) de sus dos zonas para que el tono elegido sea el que se ve.
- **Recoloreado.** La textura aporta pliegues, costuras y grano por luminancia; el color es de la persona. Recolorear no copia ninguna textura, y cada imagen se descarga, se decodifica y se sube a la GPU una sola vez aunque la usen varios archivos (`src/character/sharedImages.js`).
- **Patrones.** Solo arriba. Las rayas dan la vuelta al cuerpo y a la manga, y la franela cruza bandas anchas con una línea fina clara. Se filtran con el tamaño del píxel: de lejos se funden con su promedio en vez de vibrar. A 22 m o más, una camisa de rayas andando parpadea lo mismo que una lisa.
- **Asiento.** La textura del pantalón trae el asiento oscurecido: en la ropa nueva se aclara y vuelve con el desgaste, para que solo lo lleve quien lleva tiempo en la calle.
- **Desgaste.** Decolorado en codos, rodillas y puños, y polvo en los bajos. Las manchas grandes solo aparecen por encima de desgaste 1: es la marca de quien lleva mucho tiempo en la calle.
- **Capas.** La tela sale un poco sobre el cuerpo para tapar la piel que se asoma por lo justo. El pantalón ancho (`/pants/`) sale menos, baja la pretina lo que la camisa tapa y, con el saco, la mete hacia adentro para no atravesarlo en la cadera.

## Pelo, barba y zapatos

El pelo y la barba toman el color elegido, con la textura solo como detalle de mechones (`addHairTone`, en `src/character/weathering.js`), y el `rapado` baja ese detalle porque sus parches se verían como camuflado en las canas. Las láminas de pelo se iluminan con la normal de la cabeza, para que las que quedan al revés no se apaguen en parches negros, y escriben profundidad para que no las atraviesen las pestañas. El `crespo` lleva un grano fino y mate que se funde de lejos, y la barba otro, para que de cerca no sea una mancha plana. Los zapatos pierden color con el polvo y el desgaste, y se oscurecen en suela y puntera. El zapato de cuero (`zapatos`) trae en la textura un naranja que nadie lleva: se recolorea por luminancia con `tonos.calzado` y, sin tono, sale café oscuro. La planta de todo calzado sale como caucho oscuro: clara, con el pie en el aire, se leía como la planta de un pie descalzo. Se reconoce por la cara que mira hacia abajo en el cuerpo de pie, sin textura ni uniforme nuevos: el empeine no se toca, y la pared vertical del tacón sigue clara.

## Lluvia

`streetWetness` es un solo objeto compartido por todos los materiales, y `Game` le pasa la humedad del clima en cada cuadro. Mojar a alguien no cuesta nada por persona. La ropa se oscurece bastante y brilla poco; la piel, el pelo y la barba brillan algo más, sin llegar a verse como plástico.

Es una aproximación global: no se calcula quién está bajo techo, y quien está debajo de un puente o entrando a un portal también se ve mojado. En la sala, **Mojar con lluvia** lo activa sin cambiar el clima.

## Coste

Los programas se comparten entre personas: el `customProgramCacheKey` no depende de quién sea, y lo que distingue a cada una son uniformes. Son 13 variantes para cinco tipos de superficie: piel 2, con poros en el modelo completo y sin ellos en el liviano; tela 2 y zapatos 2, según su archivo traiga mapa normal o no; pelo 4, dos para las cejas, que se dibujan en dos pasadas, una para las láminas y otra para las láminas recortadas por un sombrero; y barba 3, dos para el modelo completo, también en dos pasadas, y una para el liviano, en una sola. Aparecen desde la entrada y vestir a alguien no añade ninguna. No se añaden luces, polígonos ni llamadas por persona. Quitar las medias bajo el pantalón largo y las láminas del crespo incluso ahorra triángulos.

Contra los materiales anteriores, en las paradas del recorrido de medida (al entrar, cambuche, avenida y estación) suman 6 programas netos, en calidad baja y en media: las 13 variantes sustituyen a 7 programas que ya no hacen falta. Quien además compila la otra variante, con sombras y sin ellas, guarda las dos, y la diferencia queda entre 8 y 14 según por dónde haya andado. Las llamadas quedan entre −2,0 % y +3,4 % y los triángulos entre −5,3 % y +4,2 %, porque los peatones cambian en cada partida. El primer peatón que se ve de cerca enlaza los mismos programas de sombra que antes, de modo que no hace falta precompilar nada más. Estas cifras describen ese recorrido; la cuenta de programas vale para cualquier partida.

Cada imagen ocupa una sola textura en la GPU, y el detalle de la memoria y de la carga está en [rendimiento.md](../../docs/rendimiento.md).

## Microdetalle de piel

`public/models/preview/skin/skin-micro-normal.png` es un mapa normal procedural de **512 × 512**, generado y horneado en Blender 5.2.1. Añade poros suaves y pequeñas variaciones de superficie sobre la textura de color existente. No modifica la malla, las coordenadas UV ni los colores originales del cuerpo.

### Reconstruir el recurso

Desde la raíz de `bazuko`:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/personaje/preparar_materiales_calle.py -- \
  public/models/preview/skin/skin-micro-normal.png work/skin/materiales.blend
```

El proceso se ejecuta en una sesión independiente de Blender. `work/skin/materiales.blend` conserva el material fuente editable, el material que utiliza la imagen horneada, la imagen empaquetada y una esfera de muestra. El color de la esfera es solo una muestra de material, no reemplaza la textura del personaje. `work/skin/materiales.json` registra parámetros y tamaño del recurso.

La fuente utiliza Voronoi F1 para depresiones redondeadas, una transición suave hasta la superficie y un aporte de Noise de amplitud reducida. Ambos se evalúan en las coordenadas periódicas `(cos(2πu), sin(2πu), cos(2πv), sin(2πv))`. Así el patrón se repite en ambos ejes sin introducir una unión visible. Un nodo Bump convierte la altura en normales; Cycles hornea la salida a espacio tangente.

### Parámetros de integración

| Propiedad | Valor inicial |
|---|---|
| Convención | Tangente OpenGL, **+Y en verde** |
| Espacio de color | Datos lineales / `NoColorSpace` en Three.js |
| Repetición | `18 × 18` por cuadro UV |
| Intensidad de normal | `0.5` en ambos ejes; con mucho menos la piel se lee como cera |
| Filtrado | Lineal con mipmaps y repetición en ambos ejes |
| Textura base del cuerpo | Se conserva, con sus UV originales |

La repetición se expresa en coordenadas UV, no en metros: la densidad física depende de las islas del modelo. El recurso se aplica solo a la piel del modelo completo: el liviano no lo usa, porque a esa distancia no se ve. La intensidad final se revisa de cerca y a distancia de juego para evitar que el detalle domine la forma del rostro.

El PNG RGB ocupa **292.661 bytes**. Su asignación estimada como RGBA8 con la cadena completa de mipmaps es **1.398.100 bytes** (1,33 MiB). Se descarga una sola vez y durante la carga, porque la pantalla de carga ya prepara modelos completos: está en toda partida.

La imagen horneada mantiene longitudes de normal entre 0,995 y 1,005 tras cuantizar a 8 bits. Con la intensidad 0,5 que usa el juego, la desviación angular mediana es 0,66° y el percentil 99 es 7,35°. El salto medio de píxeles al repetir los bordes es comparable al de píxeles vecinos interiores. Estas comprobaciones confirman un recurso de detalle sutil y repetible; la iluminación y el tono de piel requieren además revisión visual en la sala.

## Revisar en la sala

Abrir `sala.html?prueba=personaje`. **Ver rostro** y **Cuerpo completo** sirven para inspeccionar ambos encuadres, y en una ventana estrecha ocultan el panel para dejar visible al personaje; **Mostrar controles** lo recupera. **Mojar con lluvia** alterna seco y mojado.

`?aspecto=realista`, en la sala o en `/`, se sigue aceptando: solo fuerza el modelo realista, sin otro material con el cual comparar.

La verificación funcional está en `tests/street-materials.test.js`, `tests/street-clothes.test.js`, `tests/mixamo-preview.test.js` y `tests/e2e/street-appearance.spec.js`. Las capturas de rostro y cuerpo permiten revisar el resultado visual.
