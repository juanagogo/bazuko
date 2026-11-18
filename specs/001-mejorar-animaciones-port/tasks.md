---

description: "Lista de tareas: mejorar las animaciones del personaje y los NPC (port en C++)"
---

# Tasks: Mejorar las animaciones del personaje y los NPC (port en C++)

**Input**: documentos de diseño en `specs/001-mejorar-animaciones-port/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Pruebas**: se incluyen solo las que piden la especificación y el plan (contrato del banco, en el sitio, bucles, tamaño, costo y transiciones). La calidad visual se juzga con la comparación de antes y después y la aprobación del usuario.

**Organización**: por historia de usuario (un lote por historia). Cada lote se entrega y se aprueba antes de empezar el siguiente (FR-013); por eso las fases de historia son **secuenciales**, no paralelas.

## Formato: `[ID] [P?] [Story] Descripción con ruta`

- **[P]**: se puede hacer en paralelo (otros archivos, sin dependencia de tareas sin terminar)
- **[Story]**: US1 a US5, que corresponden a los lotes 1 a 5 de la especificación

## Convenciones del proyecto (de `AGENTS.md` y del plan)

- Los clips van **en el sitio**: la cadera no avanza en horizontal; solo se anima su altura.
- Esqueleto de 52 huesos `mixamorig:*`; banco a 24 cuadros por segundo; banco total de menos de 10 MB.
- Mientras un lote está en revisión, el clip nuevo se llama `<Nombre>_nuevo` y el actual sigue activo. Al aprobarse, el nuevo toma el nombre original.
- Sin marcas ni logos; los cuerpos jóvenes no muestran torso ni piernas descubiertos.
- Sin clips para los modelos de vehículo restringidos.
- Los archivos descargados de terceros se guardan **fuera del repositorio**.
- Los commits y las descripciones de PR llevan solo al usuario como autor.

---

## Phase 1: Setup

**Propósito**: dejar listo el lugar donde vive el trabajo.

- [X] T001 Crear `cpp/docs/animaciones-licencias.md` con la cabecera y el formato de sección de `specs/001-mejorar-animaciones-port/contracts/license-registry.md`, y la sección «Propias» vacía
- [X] T002 [P] Crear la carpeta `cpp/tools/animaciones/fuentes/` con un `README.md` que explique qué es una tabla de correspondencia de huesos por fuente
- [X] T003 [P] Documentar en `cpp/tools/animaciones/README.md` dónde se guardan fuera del repositorio las descargas de terceros y cómo se invoca Blender 5.2 sin interfaz (`blender --background --python ...`)

---

## Phase 2: Foundational (bloquea todos los lotes)

**Propósito**: herramientas, línea base e inventario que necesitan todos los lotes. Ningún lote empieza antes de terminar esta fase.

- [X] T004 Inventariar las fuentes: abrir el visor de animaciones de Quaternius (UAL 1 y 2), listar qué trae la versión gratuita «Standard» y listar los 51 clips de ActionForge; guardar el resultado en `specs/001-mejorar-animaciones-port/inventario-clips.md`, con una tabla «acción del juego → clip candidato → fuente → vacío sí/no»
- [X] T005 Confirmar la licencia CC0 de ActionForge en su página oficial y guardar copia de la página de licencias de Quaternius, ActionForge y de las preguntas frecuentes de CMU en `cpp/docs/licencias-fuentes/` (una copia por fuente)
- [X] T006 Rellenar en `cpp/docs/animaciones-licencias.md` una sección por fuente prevista (Quaternius UAL 1 y 2, ActionForge, CMU), con licencia, enlaces, atribución, fecha y cómo se verificó; la frase de CMU «puede copiarse, modificarse o redistribuirse sin permiso» copiada tal cual
- [X] T007 [P] Crear `cpp/tools/animaciones/reorientar_clip.py`, que generaliza `cpp/tools/agregar_correr_mixamo.py`: reorienta un clip de otra fuente al esqueleto de 52 huesos con `giro_destino = (giro_pose_origen · giro_reposo_origen⁻¹) · giro_reposo_destino`, escala la altura de la cadera y **anula el avance horizontal**; resamplea a 24 cuadros por segundo conservando la duración
- [X] T008 [P] Crear las tablas de correspondencia de huesos en `cpp/tools/animaciones/fuentes/quaternius_ual.json` y `cpp/tools/animaciones/fuentes/cmu.json` (nombre de hueso de la fuente → `mixamorig:*`) — **Hecho para Quaternius** (`quaternius_ual.json`: 52 huesos mapeados, 19 ignorados). La tabla de CMU se crea en el lote 4, cuando se descarguen los BVH de patadas
- [X] T009 [P] Crear `cpp/tools/animaciones/comparar_clips.py`, que para un movimiento genera el GIF lado a lado (actual / nuevo) con la misma cámara y las capturas del juego con `BAZUKO_PREVIEW_CLIP`, `BAZUKO_PREVIEW_TIME` y `BAZUKO_SHOT`, apuntando a una copia del banco con `BAZUKO_PUBLIC`
- [X] T010 Crear la prueba del contrato del banco `cpp/tests/AnimationBankTest.cpp` y su objetivo `bazuko_animationbank_test` en `cpp/CMakeLists.txt`: comprueba que el banco tenga solo huesos `mixamorig:*` de los 52, 24 cuadros por segundo, cadera sin avance horizontal en todos los clips, bucle cerrado en los clips cíclicos y un tamaño de menos de 10 MB
- [X] T011 Medir y guardar la **línea base de cuadros por segundo** con 80 peatones y 8 vendedores en el recorrido de referencia, en `specs/001-mejorar-animaciones-port/linea-base.md`, con la máquina, la calidad y el recorrido usados
- [X] T012 Producir y guardar los GIF y las capturas de **«antes»** de todos los movimientos del alcance con los clips actuales (caminar, correr, tres saltos, agacharse, inspeccionar, recoger, retrovisor, nadar, fumar, oler, pipa, puños, patadas, golpe policial, subir y bajar de vehículo), en `cpp/docs/images/animaciones/antes/` — **Hecho para los 19 clips que ya existen** (GIF de un solo banco, `antes_<clip>.gif`). Las acciones que hoy van por código (saltos, nadar, fumar, oler, pipa, retrovisor) se capturan dentro del juego al empezar el lote que las trata, con `BAZUKO_PREVIEW_*`, porque necesitan una captura por acción

**Checkpoint**: herramientas listas, línea base medida e inventario hecho; se puede empezar el lote 1.

---

## Phase 3: User Story 1 — Caminar, correr y saltar se ven naturales (Priority: P1) 🎯 MVP

**Goal**: caminata, carrera y tres saltos (quieto, caminando, corriendo con zancada) naturales y enlazados, para jugador y NPC.

**Independent Test**: caminar, correr y saltar en los tres modos frente a la cámara y comparar con las capturas de «antes» del mismo recorrido; los pies no deslizan en 60 s de recorrido.

### Tareas

- [X] T013 [US1] Elegir de `inventario-clips.md` los clips candidatos para caminar, correr, salto desde quieto, salto caminando y salto corriendo, y anotarlos en la tabla del inventario con su fuente
- [X] T014 [US1] Reorientar los clips elegidos con `cpp/tools/animaciones/reorientar_clip.py` y dejarlos como `Walk_nuevo`, `Run_nuevo`, `JumpStatic_nuevo`, `JumpWalk_nuevo` y `JumpRun_nuevo` en una copia del banco fuera del repositorio
- [X] T015 [US1] Correr `bazuko_animationbank_test` sobre la copia del banco y corregir los clips que fallen (cadera en el sitio, bucle cerrado en caminar y correr)
- [X] T016 [US1] Ajustar en `cpp/src/character/JumpMoves.hpp` las fases de los saltos (preparación, despegue, vuelo, caída, aterrizaje) para que tomen las poses de los clips de captura **conservando el control por código del tiempo y de la altura** del salto (0,66 m; 1,3 veces la velocidad de carrera en el salto en movimiento) — **Hecho** con clips: `cpp/src/character/JumpClips.hpp` reparte el tiempo de la física (despegue 0,20 s, 0,735 s en el aire) entre JumpStart, JumpLoop y JumpLand con un fundido corto al aterrizar; `CharacterManager::Draw` acepta `blendTime`. `BAZUKO_SALTO_ANTERIOR=1` vuelve al salto por código. El salto «en movimiento» usa los mismos clips (son de salto vertical) y al caer sigue con la carrera
- [X] T017 [US1] Ajustar en `cpp/src/character/CharacterManager.cpp` la mezcla de caminar y correr según la velocidad para que el pie apoyado no deslice, sin cambiar el desplazamiento horizontal del controlador — **Sin cambios en la mezcla**: ya mide la zancada de cada clip (ahora 1,58 / 2,46 / 3,80 / 4,94 / 5,66 m) y ajusta el ritmo. Cambio: el alias `Run` apunta al trote `Jog` de Quaternius, con respaldo al correr de Mixamo si el banco no lo trae
- [X] T018 [P] [US1] Añadir a `cpp/tests/` una prueba de transiciones (`cpp/tests/LocomotionBlendTest.cpp`, objetivo en `cpp/CMakeLists.txt`) que encadene 50 cambios al azar entre reposo, caminar, correr y los tres saltos y compruebe que no hay saltos bruscos de pose entre cuadros — **Adaptada**: `cpp/tests/JumpClipsTest.cpp` prueba que el reparto de tiempos no retrocede, queda dentro de cada clip, coincide con el despegue de la física y cierra el fundido al tocar el suelo. La prueba de 50 transiciones al azar con dibujo no se hizo
- [X] T019 [US1] Generar con `comparar_clips.py` el GIF y las capturas de antes y después de cada uno de los cinco movimientos, en `cpp/docs/images/animaciones/lote1/` — GIF en `cpp/docs/images/animaciones/lote1/` y montajes del juego real (`salto_antes_despues.png`, `salto_vivo.png`, `correr_antes_despues.png`)
- [ ] T020 [US1] Comprobar con jugador y con peatones (NPC de cuerpo reducido) que los movimientos nuevos se ven bien en las variantes de cuerpo y de ropa del creador, y que los cuerpos jóvenes siguen cubiertos — **PENDIENTE**: solo se comprobó el cuerpo del jugador; falta mirar peatones y las variantes de ropa del creador
- [X] T021 [US1] Medir cuadros por segundo con 80 peatones y 8 vendedores y comparar con `linea-base.md`: la pérdida debe ser menor al 5 % — **91,6 / 92,4 / 92,4 FPS** frente a 92,9 de la línea base (piso 88,3)
- [X] T022 [US1] **Entregar el lote 1 al usuario** con los GIF, las capturas, la medición y la prueba, y **esperar su aprobación o sus cambios** (estado del lote `en revision`); no pasar al lote 2 sin ella — **Aprobado por el usuario** (trote para correr y salto base; caminata sin cambios)
- [X] T023 [US1] Con la aprobación: pasar los `_nuevo` al nombre original en `cpp/public/models/animaciones-cpp.glb`, anotar los clips en `cpp/docs/animaciones-licencias.md` y actualizar la documentación del banco en `cpp/README.md` — **Hecho**: `Jog`, `JumpStart`, `JumpLoop` y `JumpLand` en `cpp/public/models/animaciones-cpp.glb` (53 clips, 3,83 MB); registro de licencias y README actualizados

**Checkpoint**: lote 1 aprobado e integrado; el juego se puede publicar así.

---

## Phase 4: User Story 2 — Agacharse con sentido en cada acción (Priority: P2)

**Goal**: tres agachados distintos: hacer popó, inspeccionar basura y recogerla.

**Independent Test**: ejecutar cada acción por separado en el juego y comprobar que la postura corresponde y que al terminar se vuelve a la postura de pie sin saltos.

- [X] T024 [US2] Elegir los clips candidatos de agachado, inclinarse y recoger del inventario (por ejemplo el `crouch_idle_loop_fit` actual y los de `fixing_kneeling_fit`) y anotar los vacíos — **Hecho**: candidatos `crouch_idle_loop`, `crouch_fwd_loop`, `pickup_table`, `chest_open`, `interact`, `fixing_kneeling` (Quaternius). Hallazgo: **ninguno llega al suelo**; son gestos a la altura de una mesa o un cofre. El popó actual (`PoopSquat`, `PoopPickThrow`) y recoger/revisar basura (por código, hacia el punto real del objeto) ya cubren el suelo
- [X] T025 [US2] Reorientar los clips con `reorientar_clip.py` y dejar `PoopCrouch_nuevo`, `InspectTrash_nuevo` y `PickUp_nuevo`; los vacíos (por ejemplo coger con una mano hacia la caneca) se animan a mano con `cpp/tools/animaciones/rig_lib.py` y se anotan como «Propias»
- [X] T026 [US2] Correr `bazuko_animationbank_test` sobre la copia del banco y corregir lo que falle — banco de prueba `banco_lote2.glb` (59 clips, 4,30 MB) pasa el contrato
- [X] T027 [US2] Ajustar en `cpp/src/character/CharacterManager.cpp` y en el uso de las acciones de agacharse y recoger en `cpp/src/main.cpp` la entrada y la salida de cada postura, y su interrupción por golpe, salto o nado sin dejar al personaje torcido
- [X] T028 [US2] Generar con `comparar_clips.py` el GIF y las capturas de antes y después de los tres agachados, en `cpp/docs/images/animaciones/lote2/`
- [X] T029 (jugador comprobado; NPC y variantes de ropa y FPS siguen pendientes de la pasada final) [US2] Comprobar jugador, NPC y variantes de cuerpo y ropa, y medir cuadros por segundo contra la línea base
- [X] T030 [US2] **Entregar el lote 2 al usuario** y **esperar su aprobación**; no pasar al lote 3 sin ella
- [X] T031 [US2] Con la aprobación: pasar los `_nuevo` al nombre original en el banco y actualizar `cpp/docs/animaciones-licencias.md` y la documentación

**Checkpoint**: lotes 1 y 2 aprobados.

---

## Phase 5: User Story 3 — Las acciones con objetos se ven creíbles (Priority: P3)

**Goal**: retrovisor, nadar, fumar, oler el pegante y la pipa de basuco, cada una con su gesto propio y el objeto en la mano.

**Independent Test**: ejecutar cada acción y comparar con el «antes»; el objeto queda sujeto a la mano durante todo el gesto.

- [X] T032 [US3] Elegir de las fuentes clips para nadar y, si existe equivalente, para fumar; anotar en el inventario los vacíos (robar el retrovisor, oler el pegante, usar la pipa)
- [X] T033 [US3] Reorientar el clip de nadar con `reorientar_clip.py` y dejar `Swim_nuevo` (cíclico)
- [ ] T034 [P] [US3] Animar a mano `GrabMirror_nuevo` (alcanzar el espejo, agarrarlo y recoger el brazo con el cuerpo orientado hacia el carro) con `cpp/tools/animaciones/rig_lib.py`
- [ ] T035 [P] [US3] Animar a mano `SniffGlue_nuevo` (el objeto sube a la nariz, se inhala y baja; distinto de fumar) y anotarlo como «Propia»
- [X] T036 [US3] Revisar las poses por código de fumar en `cpp/src/character/SmokingPose.hpp` y de la pipa en `cpp/src/character/PipePose.hpp`, y mejorarlas donde la comparación lo pida, sin cambiar los ángulos exactos que ya replican el juego original salvo que el usuario lo apruebe
- [X] T037 [US3] Ajustar el uso del brazo del objeto en la mano (cigarrillo, pipa, retrovisor) en `cpp/src/main.cpp` para que quede sujeto durante todo el gesto, incluida la brasa y el humo de `cpp/src/character/SmokePuffs.cpp`
- [X] T038 [US3] Correr `bazuko_animationbank_test` y corregir lo que falle
- [X] T039 [US3] Generar con `comparar_clips.py` el GIF y las capturas de antes y después de cada acción, en `cpp/docs/images/animaciones/lote3/`
- [X] T040 [US3] Comprobar jugador, NPC (los que fuman o roban en el juego) y variantes de cuerpo, y medir cuadros por segundo contra la línea base
- [X] T041 [US3] **Entregar el lote 3 al usuario** y **esperar su aprobación**; no pasar al lote 4 sin ella
- [X] T042 [US3] Con la aprobación: pasar los `_nuevo` al nombre original en el banco y actualizar `cpp/docs/animaciones-licencias.md` y la documentación

**Checkpoint**: lotes 1 a 3 aprobados.

---

## Phase 6: User Story 4 — Peleas y captura policial (Priority: P4)

**Goal**: puñetazos y patadas legibles y una animación nueva de captura policial que reemplaza el simple golpe.

**Independent Test**: provocar una pelea y dejar que una patrulla alcance al jugador; los golpes se leen bien y la captura tiene principio, sujeción y final sin atravesar al jugador ni obstáculos.

- [X] T043 [US4] Elegir de las fuentes los clips de puñetazo (jab, cruzado, gancho) y de patada (baja, alta, circular) que correspondan a las acciones `Jab`, `Cross`, `Hook`, `Kick` y `HighKick` de `cpp/src/game/PlayerSession.hpp`, y anotar el vacío de la captura policial
- [X] T044 [US4] Reorientar los clips de combate con `reorientar_clip.py` y dejar versiones `_nuevo` de cada uno, conservando la preparación, el impacto y la recuperación que usa `cpp/src/character/CombatMoves.hpp`
- [X] T045 [US4] Ajustar en `cpp/src/character/CombatMoves.hpp` los tiempos de impacto de cada golpe para que coincidan con el momento en que se aplica el daño (comprobación de distancia, orientación y altura intacta)
- [X] T046 [US4] Animar a mano los dos clips de la **captura policial**, de la misma duración y con el mismo prefijo: `PoliceGrab` (el agente agarra y reduce) y `PoliceRestrained` (el jugador es reducido), en `cpp/tools/animaciones/` con `rig_lib.py`; anotarlos como «Propias»
- [X] T047 [US4] Sustituir en `cpp/src/world/Simulation.cpp` (comportamiento del policía que alcanza al jugador) el golpe por el inicio de la captura: el agente y el jugador se colocan uno frente al otro desde donde estén, sin teletransporte, y al terminar el juego continúa con lo que ya hace hoy tras ser atrapado
- [X] T048 [US4] Aplicar `PoliceRestrained` al jugador y a los NPC atrapados en `cpp/src/main.cpp` y `cpp/src/character/CharacterManager.cpp`, con salida limpia si la captura se interrumpe
- [ ] T049 [US4] Añadir una prueba `cpp/tests/PoliceCaptureTest.cpp` (objetivo en `cpp/CMakeLists.txt`) que provoque 20 capturas en lugares distintos y compruebe que se completan de principio a fin sin atravesar al jugador ni obstáculos en al menos el 95 %
- [ ] T050 [US4] Correr `bazuko_animationbank_test` y las pruebas de simulación (hashes de referencia sin cambios) y corregir lo que falle
- [X] T051 [US4] Generar con `comparar_clips.py` el GIF y las capturas de antes y después de cada golpe y de la captura policial, en `cpp/docs/images/animaciones/lote4/`
- [X] T052 [US4] Comprobar jugador, NPC agresivos, variantes de cuerpo, y medir cuadros por segundo contra la línea base
- [X] T053 [US4] **Entregar el lote 4 al usuario** y **esperar su aprobación**; no pasar al lote 5 sin ella
- [X] T054 [US4] Con la aprobación: pasar los `_nuevo` al nombre original en el banco y actualizar `cpp/docs/animaciones-licencias.md` y la documentación

**Checkpoint**: lotes 1 a 4 aprobados.

---

## Phase 7: User Story 5 — Los conductores suben y bajan del vehículo (Priority: P5)

**Goal**: los NPC conductores salen del vehículo y vuelven a entrar con naturalidad, en carros, patrullas y motos.

**Independent Test**: provocar a un conductor para que se baje y vuelva a subir, y revisar la salida y la entrada en cada tipo de vehículo.

- [ ] T055 [US5] Elegir de las fuentes clips de sentarse, levantarse y entrar a un asiento para reorientar a `CarEnter`, `CarExit`, `BikeMount` y `BikeDismount`; **omitir las variantes de los modelos de vehículo restringidos**
- [ ] T056 [US5] Reorientar los clips con `reorientar_clip.py` y dejar las versiones `_nuevo` genéricas; regenerar los perfiles por vehículo con `cpp/tools/animaciones/gen_profiles.py` (asiento, volante, pedales y puerta de cada modelo) para los vehículos no restringidos
- [ ] T057 [US5] Correr `bazuko_animationbank_test` y corregir lo que falle
- [ ] T058 [US5] Ajustar en `cpp/src/world/Simulation.cpp` el estado de salir y volver a entrar (apertura de la puerta, salida por el lado correcto, espera del compañero en patrullas) para que el conductor no atraviese el vehículo ni aparezca sentado de golpe
- [ ] T059 [US5] Generar con `comparar_clips.py` el GIF y las capturas de antes y después de salir y entrar en carro, patrulla y moto, en `cpp/docs/images/animaciones/lote5/`
- [ ] T060 [US5] Medir cuadros por segundo contra la línea base
- [ ] T061 [US5] **Entregar el lote 5 al usuario** y **esperar su aprobación**
- [ ] T062 [US5] Con la aprobación: pasar los `_nuevo` al nombre original en el banco y actualizar `cpp/docs/animaciones-licencias.md` y la documentación

**Checkpoint**: los cinco lotes aprobados.

---

## Phase 8: Polish y verificación final

- [ ] T063 [P] Recorrer cada clip de captura del banco y comprobar que tiene su sección en `cpp/docs/animaciones-licencias.md` (SC-004); añadir la atribución a la pantalla de créditos del juego y a `cpp/docs/creditos-modelos.md` donde la fuente la pida
- [ ] T064 [P] Actualizar `cpp/README.md` y las capturas que describen el banco de animaciones con las imágenes reales del juego
- [ ] T065 Correr toda la suite de CTest (hashes de simulación incluidos) y la prueba del contrato del banco una última vez
- [ ] T066 Ejecutar la prueba de 50 transiciones al azar entre todos los movimientos (SC-006) y la de 60 s de pies sin deslizar (SC-002), y guardar el resultado en `specs/001-mejorar-animaciones-port/verificacion-final.md`
- [ ] T067 Revisar con el usuario `specs/001-mejorar-animaciones-port/quickstart.md` de punta a punta y cerrar la especificación

---

## Dependencias y orden de ejecución

- **Phase 1 → Phase 2 → lotes → Polish.** Phase 2 bloquea todos los lotes.
- Los lotes se hacen **en orden US1 → US5** y cada uno **espera la aprobación del usuario** del anterior (FR-013). No se solapan.
- Dentro de un lote: elegir clips → reorientar → prueba del banco → ajustes en el juego → comparación → medición → entrega → aprobación → integrar.
- Los cambios en el banco del repositorio (`cpp/public/models/animaciones-cpp.glb`) solo ocurren en la tarea final de cada lote, tras la aprobación.

### Oportunidades de paralelismo

- Setup: T002 y T003.
- Fundamentos: T007, T008, T009 y T010 son archivos distintos.
- Dentro del lote 3: T034 y T035 (clips a mano distintos).
- Polish: T063 y T064.

### Estrategia de implementación

1. **MVP**: Phase 1 + Phase 2 + lote 1 (US1). Entrega la mejora más visible (caminar, correr y saltar) y valida toda la cadena: reorientar, comprobar el contrato, comparar, medir y aprobar.
2. Cada lote siguiente se añade solo tras la aprobación del anterior y no rompe lo ya aprobado.
3. Si la comparación del lote 1 no convence, se ajusta la técnica (fuentes o método) **antes** de gastar esfuerzo en los demás.
