# Contrato de los clips del banco

Lo que debe cumplir todo clip que entre a `cpp/public/models/animaciones-cpp.glb` para que el juego lo use sin cambios.

## Esqueleto

- 52 huesos con los nombres `mixamorig:*` del banco actual. Ni se añaden ni se quitan huesos.
- El clip anima solo huesos que existen en ese esqueleto. Los dedos pueden quedarse en reposo.

## Tiempo

- Banco a **24 cuadros por segundo**. Un clip de otra frecuencia se remuestrea sin cambiar su duración real.
- Los clips cíclicos (caminar, correr, nadar, agachado sostenido) cierran el bucle: la pose del primer y el último cuadro coinciden, sin salto visible.
- Los clips de una sola vez (golpes, saltos, agarrar el retrovisor) empiezan y terminan en una pose desde la que el juego puede mezclar con reposo.

## Movimiento en el sitio

- La cadera **no avanza**: el desplazamiento horizontal (los dos ejes del suelo) de la cadera es 0 en todos los cuadros.
- La altura de la cadera sí se anima, relativa a la altura de reposo del esqueleto (agacharse, saltar, estocadas), para que los pies no atraviesen el suelo ni floten.

## Nombres

- Los clips existentes conservan su nombre, porque el juego los busca por nombre.
- Los clips que sustituyen a uno existente reutilizan el nombre del actual. Mientras el lote está en revisión, el clip nuevo se llama con el sufijo `_nuevo` y el actual sigue activo; al aprobarse, el nuevo toma el nombre original.
- Los clips nuevos usan nombres en inglés en `CamelCase` sin acentos, como los actuales (por ejemplo `PoliceGrab`, `PoliceRestrained`).
- Los clips de dos personajes (captura policial) se entregan como dos clips con el mismo prefijo y la misma duración, uno por personaje.

## Fuera de contrato

- Sin mallas, texturas ni materiales dentro del banco.
- Sin marcas ni logos en ningún nombre o metadato.
- Sin clips para los modelos de vehículo restringidos del proyecto.

## Tamaño

- El banco completo, con los clips nuevos, pesa menos de 10 MB.

## Verificación

Se comprueba con una prueba automática que recorre el banco: huesos, frecuencia, cadera en el sitio, bucle cerrado en los cíclicos y tamaño total.
