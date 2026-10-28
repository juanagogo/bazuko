# Animaciones del personaje

Las animaciones proceden de Quaternius, exportadas mediante [ActionForge](https://actionforge.app/), que identifica su biblioteca de animaciones como CC0. Se conserva el personaje modular existente: cuerpo, ropa, pelo, barba y zapatos no se sustituyen por la apariencia exportada.

El archivo original contiene 51 clips. El banco `public/models/animaciones-actionforge.glb` incluye solamente ocho clips usados por acciones existentes y un esqueleto de 52 huesos. Pesa aproximadamente 849 KiB, sin mallas ni texturas. Las demás animaciones se mantienen en el archivo original de trabajo; no se agregan automáticamente mecánicas de salto, combate, conducción o natación.

| Acción del juego | Clip exportado |
| --- | --- |
| Reposo | idle_loop_fit |
| Caminar | walk_loop_fit |
| Correr | sprint_loop_fit |
| Buscar | fixing_kneeling_fit |
| Pedir | idle_talking_loop_fit |
| Comer y beber | consume_fit |
| Agacharse para hacer popó | crouch_idle_loop_fit |
| Lanzar | overhandthrow_fit |

Cada cuerpo recibe clips adaptados y guardados en caché, también para su versión de detalle reducido. El cuerpo original no se modifica al preparar las animaciones. Se conserva la altura animada de la cadera, ajustada a cada cuerpo; el movimiento horizontal lo controla el juego. Comer, beber, lanzar y saludar se reinician al entrar en la acción y se reproducen una sola vez. Las transiciones mezclan los pesos de las animaciones.

Dormir y saludar mantienen las animaciones anteriores. Si el banco nuevo no carga, se utilizan los clips anteriores. El personaje liviano conserva su animación procedural y los atropellos mantienen el ragdoll.

El combate añade poses de puñetazo, impacto, guardia y protección sobre el personaje, sin incorporar clips al banco ni sustituir prendas. El progreso de la acción sincroniza la preparación, el contacto a los 0,22 segundos y la recuperación del puñetazo, que dura 0,6 segundos. Las poses también se aplican durante el movimiento y tienen su equivalente en el personaje liviano.

Para regenerar el banco, guardar la descarga como `work/exportaciones/animaciones-actionforge.glb` y ejecutar `tools/personaje/preparar_actionforge.py` con Python. `exportar_actionforge.py` genera el personaje para subirlo al editor y requiere Pillow. Los archivos grandes de intercambio en `work/` no se publican.

Las pruebas comprueban carga, esqueleto, selección de clips, ausencia de recursos visuales duplicados, valores finitos, movimiento en el sitio y conservación del cuerpo original. La apariencia y las transiciones deben revisarse jugando en el navegador.
