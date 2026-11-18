# Inventario de clips (T004)

Fuente principal consultada: la biblioteca de ActionForge, que reúne los clips CC0 de Quaternius (Universal Animation Library, versión gratuita). Su catálogo público (`https://actionforge.app/assets/animation-library/manifests/library.json`, 89 clips, consultado el 2026-11-09) declara por clip su origen y licencia: **85 de Quaternius CC0**, 3 originales de ActionForge CC0 y 1 original sin licencia declarada (`a_tpose`, que no se usa). Cada clip es un archivo GLB estático; se descargan fuera del repositorio.

Esqueleto de origen: 71 huesos (UE-mannequin: `pelvis`, `spine_01..03`, `thigh_l`, etc.); la tabla `cpp/tools/animaciones/fuentes/quaternius_ual.json` lleva 52 a los 52 `mixamorig:*` del juego e ignora los 19 restantes (IK, accesorios, puntas de dedo).

Todos a 30 cuadros por segundo; el banco va a 24 (el script de reorientación remuestrea conservando la duración).

## Acción del juego → clip candidato

«Mueve» indica que el clip arrastra al personaje (movimiento de raíz); la reorientación lo deja **en el sitio** quitando el avance horizontal y conservando la altura de la cadera.

| Lote | Acción del juego | Clip candidato (Quaternius, CC0) | Duración | Ciclo | Mueve | ¿Cubierto? |
|---|---|---|---|---|---|---|
| 1 | Caminar | `walk_loop` (alternativas: `walk_formal_loop`, `walk_carry_loop`) | 1,33 s | sí | 1,3 m | Sí |
| 1 | Correr | `jog_fwd_loop` (trote) y `sprint_loop` (carrera) | 0,93 s / 0,67 s | sí | 5,0 m / 5,5 m | Sí |
| 1 | Reposo | `idle_loop` (y otros `idle_*`) | 2,5 s | sí | no | Sí |
| 1 | Saltar quieto | `jump_start` + `jump_loop` + `jump_land`; alternativa `ninjajump_start/idle_loop/land` | 1,33 / 2,5 / 1,27 s | partes | no | Sí |
| 1 | Saltar caminando y corriendo | No hay clips propios. Se reutilizan las fases de arriba (despegue, vuelo, caída) y el control por código del juego pone el tiempo y la altura | — | — | — | Parcial (poses sí, combinación con zancada hay que montarla) |
| 2 | Agacharse (popó) | `crouch_idle_loop` (ya está en el banco como `crouch_idle_loop_fit`) | 2,93 s | sí | no | Sí |
| 2 | Inspeccionar basura / recoger | `pickup_table` (recoger), `chest_open` (abrir e inspeccionar), `fixing_kneeling`, `interact` | 0,83 / 1,37 / 5,2 / 2,0 s | sí | no | Sí (a validar al verlos) |
| 2 | Agacharse caminando | `crouch_fwd_loop` | 2,0 s | sí | 1,5 m | Sí |
| 3 | Nadar | `swim_fwd_loop`, `swim_idle_loop` | 1,33 / 3,33 s | sí | 2,9 m / no | Sí |
| 3 | Retrovisor | — | — | — | — | **Vacío: animación propia** |
| 3 | Fumar (cigarrillo, porro) | `consume` (llevarse algo a la boca) como base | 1,33 s | sí | no | Parcial |
| 3 | Oler el pegante | — | — | — | — | **Vacío: animación propia** |
| 3 | Pipa de basuco | — | — | — | — | **Vacío: animación propia** |
| 4 | Puñetazos | `punch_jab`, `punch_cross`, `melee_hook` (+ `melee_hook_rec`) | 0,87 / 1,0 / 0,47 s | no | no / no / 0,35 m | Sí |
| 4 | Patadas | — | — | — | — | **Vacío: no hay patadas en Quaternius**. Se busca en CMU (artes marciales) o se anima a mano |
| 4 | Recibir golpes | `hit_chest`, `hit_head`, `hit_knockback` | 0,33 / 0,43 / 0,83 s | no | no / no / 3 m | Sí |
| 4 | Captura policial | — | — | — | — | **Vacío: animación propia** (dos personajes) |
| 5 | Subir/bajar de un vehículo (NPC) | `sitting_enter`, `sitting_exit`, `sitting_idle_loop`, `driving_loop` | 1,3 / 1,03 / 1,67 / 1,67 s | partes | no | Parcial (sentarse y conducir sí; abrir la puerta y el recorrido por el flanco hay que montarlos) |

## Lo que ya estaba en el banco

Ocho clips `*_fit` vienen de esta misma biblioteca vía ActionForge (ver `cpp/docs/animaciones-licencias.md`). Los clips `walk_mixamo` y `run_mixamo` vienen de Mixamo y quedan marcados para revisión de licencia.

## Vacíos y cómo se cubren

1. **Patadas**: base de captura de CMU (BVH; hay que añadir `fuentes/cmu.json` cuando se llegue al lote 4) o animación propia.
2. **Retrovisor, oler el pegante, pipa de basuco, captura policial**: animación propia (sección «Propias» del registro).
3. **Saltos caminando y corriendo**: combinar las fases de `jump_*` con el control por código (decisión R3 de `research.md`).
4. **Fumar**: probar `consume` como base y, si no convence, animar a mano.

## Dónde están los archivos

`C:\Users\raull\animaciones-fuentes\actionforge\` (fuera del repositorio): `library.json` (catálogo), `rig-human.glb` y `animations\*.glb`. Se descargan con `curl` desde `https://actionforge.app/assets/animation-library/animations/<clip>.glb`.
