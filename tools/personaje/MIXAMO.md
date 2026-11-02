# Mixamo y Blender: banco de revisión del personaje

En la sala se selecciona **Mixamo + Blender** en el selector de animaciones o se abre:

```text
http://127.0.0.1:5188/sala.html?prueba=personaje&animaciones=mixamo-preview
```

El perfil explícito `mixamo-preview` carga `public/models/preview/animaciones-mixamo.glb`. La sala muestra los clips cargados y distingue un clip Mixamo de una pose procedural. Un error de carga del banco se presenta como error.

Para probarlo en la ciudad se abre `http://127.0.0.1:5188/?animaciones=mixamo-preview`. Esa entrada selecciona el perfil `mixamo-game-preview`, activa el personaje realista para esa carga y complementa comer/agacharse con los clips actuales de ActionForge. La preferencia de modelo guardada se conserva. La URL habitual del juego no carga este banco: la gente y el jugador andan con las familias de `docs/animaciones-actionforge.md`. Las velocidades, colisiones y tiempos de acciones del juego siguen controlando la simulación.

## Dónde se usa Mixamo en el juego

Adobe permite usar Mixamo dentro de un juego, pero no redistribuir los archivos sueltos. Por eso conviene saber dónde están:

- `public/models/preview/animaciones-mixamo.glb`: el banco de nueve clips de este documento, solo con el perfil `mixamo-preview` o `mixamo-game-preview`.
- `public/models/andar-cansado.glb`: tres de esos clips (`walk`, `run`, `pedir`), recortados sin mallas ni texturas. Es parte del juego normal: su `walk`, mezclado con el de `andar-erguido.glb`, da las familias de andar, y de él salen el correr y la pose de la que parte el reposo de todas las personas. Ver `docs/animaciones-actionforge.md`.
- `public/models/andar-erguido.glb`: un clip (`walk`), recortado sin mallas ni texturas del `Walk` de `public/models/animaciones-prueba.glb`. También es parte del juego normal. **Su origen no se conoce con certeza**: los huesos llevan el prefijo `mixamorig:`, el del esqueleto de Mixamo, pero el archivo de partida no dice de dónde salió, trae otro personaje (`vanguard_Mesh`, `vanguard_visor`) y su `Walk` no es el de la tabla de abajo. Mientras no se aclare, conviene tratarlo como si fuera de Mixamo y saber que cualquier duda sobre su licencia también toca al juego normal.
- `public/models/animaciones-prueba.glb`: el archivo de partida, con sus mallas y sus imágenes. Sigue en el paquete, pero el juego normal solo lo descarga si falta el banco de ActionForge.

El juego normal no carga el banco de revisión. Para rehacer los recortes:

```sh
node tools/personaje/recortar_banco.mjs public/models/preview/animaciones-mixamo.glb public/models/andar-cansado.glb walk run pedir
node tools/personaje/recortar_banco.mjs public/models/animaciones-prueba.glb public/models/andar-erguido.glb Walk:walk
```

`recortar_banco.mjs` deja solo el esqueleto y los clips pedidos, con las rotaciones de todos los huesos y la traslación de la cadera.

## Selección e identidad

La base de movimiento busca una postura cansada y contenida para el personaje de Vagabundo: **Old Man Idle** en reposo y **Sad Walk** al caminar. La elección evita un andar presumido o una pose de héroe. Las acciones de recoger, pedir y beber deben conservar su intención cotidiana y sus pausas. Correr es una acción de esfuerzo; no sustituye el andar lento durante la revisión.

Los nueve clips proceden de descargas reales del catálogo de [Mixamo](https://www.mixamo.com), sobre el mismo **Default Character**, en **FBX Binary, Without Skin, 30 FPS, Keyframe Reduction: None**. No son animaciones inventadas ni acciones procedurales renombradas.

| Clip / archivo FBX | Nombre y descripción del catálogo | Duración | Repetición |
|---|---|---:|---|
| `idle` / `idle.fbx` | Old Man Idle | 12,167 s | Sí |
| `walk` / `walk.fbx` | Sad Walk, **In Place** | 1,467 s | Sí |
| `run` / `run.fbx` | Running / Running With Intention | 0,700 s | Sí |
| `beber` / `beber.fbx` | Drinking / Male Drinking | 8,867 s | No |
| `saludo` / `saludo.fbx` | Waving | 0,533 s | No |
| `buscar` / `buscar.fbx` | Picking Up Object / Picking Up An Object With One Hand | 3,433 s | No |
| `pedir` / `pedir.fbx` | Talking / Asking A Question With One Hand | 3,767 s | Sí |
| `dormir` / `dormir.fbx` | Sleeping Idle / Sleeping Deeply | 6,867 s | Sí |
| `lanzar` / `lanzar.fbx` | Throw / Throwing An Object From A Standard Pose | 2,200 s | No |

Se usaron los parámetros predeterminados de 50, excepto **Attitude: 0** en `pedir` (Hand Height: 50). `buscar` conserva Weight: 50 y Object Height: 50. `run` contiene desplazamiento de origen; la adaptación de sala conserva la altura animada de la cadera y deja el movimiento horizontal al controlador. `comer` y `cagar` no forman parte de este banco: no se les asigna un gesto distinto bajo un nombre falso.

## Preparación reproducible en Blender

El manifiesto versionado [mixamo-preview.clips.json](mixamo-preview.clips.json) fija los nombres, procedencia y repetición. Los FBX originales permanecen en `work/mixamo/source/`.

Desde la raíz de `bazuko`, con Blender 5.2:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
  --python tools/personaje/preparar_mixamo_profesional.py -- \
  work/mixamo/source work/mixamo/animaciones-mixamo.glb \
  --manifest tools/personaje/mixamo-preview.clips.json --overwrite
```

En otra instalación, sustituir la ruta del ejecutable por `blender`. El proceso usa una sesión independiente de Blender. Genera:

- `work/mixamo/animaciones-mixamo.glb`: banco de esqueletos y animaciones, sin mallas ni texturas.
- `work/mixamo/animaciones-mixamo.blend`: esqueleto editable, acciones preparadas y originales `SOURCE_*` conservadas.
- `work/mixamo/animaciones-mixamo.json`: hashes SHA-256 de los FBX, duraciones, fotogramas y métricas de continuidad.

El archivo `.blend` contiene el esqueleto de trabajo, no el cuerpo vestido del personaje. El personaje y sus prendas se aplican en la sala mediante retargeting.

El script comprueba que todos los clips compartan el mismo esqueleto y pose de enlace; normaliza nombres `mixamorig:*`, hornea rotaciones con cuaterniones continuos y usa interpolación lineal para no añadir sobrepasos entre muestras. La optimización de exportación elimina claves repetidas. Los 65 huesos del recurso fuente se conservan; la adaptación del personaje utiliza los que tienen correspondencia.

La continuidad de los bucles se mide en rotación y desplazamiento, ignorando únicamente la traslación horizontal de la cadera que controla la simulación. Estos cinco bucles ya llegan continuos desde Mixamo: no se recortaron fotogramas ni se cambió su duración. El solapamiento opcional del script solo se aplica a futuros ciclos que lo necesiten y queda registrado en el informe; no sustituye la revisión visual del apoyo de los pies.

Después de validar el banco, copiar solamente el GLB a la ruta de revisión:

```sh
mkdir -p public/models/preview
cp work/mixamo/animaciones-mixamo.glb public/models/preview/animaciones-mixamo.glb
```

Cada animación incluye `extras.loop` como booleano. `GLTFLoader` lo expone en `clip.userData.loop`; la sala usa ese dato para distinguir ciclos de gestos de una sola ejecución. Los gestos mantienen la duración del archivo fuente. No convertir automáticamente un gesto largo como beber en una acción de tres segundos.

La adaptación al personaje vestido mide sus superficies de apoyo, incluidas suelas, manos y ropa. Corrige la altura visual de la pelvis en las copias de los clips y después de mezclar poses para mantenerlas sobre el piso. Conserva las fases de vuelo al correr y la posición física del jugador. Este ajuste pertenece únicamente al perfil de revisión; los FBX y el banco fuente conservan el movimiento original.

## Revisión en la sala

Elegir el banco **Mixamo + Blender**, comprobar los nueve nombres cargados y observar cada movimiento de frente, perfil y espalda a 1× y 0,25×. Comparar con **Actual** mediante el selector. Usar la entrada explícita de ciudad para revisar después el movimiento con desplazamiento, terreno e interacciones.

Revisar especialmente el apoyo de pies en Sad Walk, la transición entre reposo y locomoción, la mano cerca del rostro al beber, el alcance al recoger y la relación entre cadera, espalda y suelo al dormir. El retargeting debe conservar el cuerpo y las prendas; una carga correcta y valores finitos no certifican por sí solos estos contactos ni la calidad artística.

La lectura con `GLTFLoader` confirma clips, duraciones, valores finitos y metadata de repetición. La continuidad numérica y la compresión se verifican por separado de la revisión visual. `mixamo-room.spec.js` comprueba la sala y `mixamo-game.spec.js` cubre la entrada optativa del juego, su movimiento y las dos acciones complementarias.
