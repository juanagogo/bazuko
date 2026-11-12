# Registro de licencias de las animaciones

Cada clip del banco `public/models/animaciones-cpp.glb` que no se creó desde cero para el juego tiene aquí su fuente, su licencia y la atribución que esa fuente exige o pide. Un clip de captura sin su sección completa no entra al banco. El formato y las reglas están en `specs/001-mejorar-animaciones-port/contracts/license-registry.md`.

Condiciones comunes: solo licencias que permitan uso comercial y redistribución dentro de un juego. Quedan fuera las de solo evaluación, las no comerciales, las de investigación y las que prohíban redistribuir el archivo de animación como recurso suelto.

## Fuentes externas

### Quaternius, Universal Animation Library 1 y 2

- Licencia: CC0 (dominio público).
- Enlace de la fuente: https://quaternius.com/packs/universalanimationlibrary.html (y la 2: https://quaternius.com/packs/universalanimationlibrary2.html)
- Enlace de la licencia: https://creativecommons.org/publicdomain/zero/1.0/
- Atribución: ninguna exigida (se acredita por cortesía: «Animaciones de Quaternius, CC0»).
- Clips del juego que vienen de ella: ninguno todavía; los 8 clips de Quaternius que ya estaban en el banco (`*_fit`) vienen por ActionForge (ver más abajo).
- Verificado: 2026-11-09, en la página oficial; copia de la nota en `licencias-fuentes/quaternius-ual.md`.
- Notas: falta confirmar qué trae la versión gratuita («Standard»); se anota en el inventario de la especificación.

### ActionForge (Quaternius CC0 exportado sobre el esqueleto Mixamo)

- Licencia: CC0, según la ayuda de su cabecera («Animations CC0»).
- Enlace de la fuente: https://actionforge.app/
- Enlace de la licencia: https://creativecommons.org/publicdomain/zero/1.0/
- Atribución: ninguna exigida.
- Clips del juego que vienen de ella: `idle_loop_fit`, `walk_loop_fit`, `sprint_loop_fit`, `fixing_kneeling_fit`, `idle_talking_loop_fit`, `consume_fit`, `crouch_idle_loop_fit`, `overhandthrow_fit`.
- Clips añadidos con el trabajo de animaciones (lote 1, 2026-11-09), descargados directamente del catálogo público de ActionForge (archivos GLB de Quaternius, CC0) y reorientados con `cpp/tools/animaciones/reorientar_clip.py`: `Jog` (de `jog_fwd_loop`; es el correr del juego), `JumpStart` (`jump_start`), `JumpLoop` (`jump_loop`) y `JumpLand` (`jump_land`).
- Clips añadidos en el lote 2 (agacharse, 2026-11-09), mismo origen y mismo procedimiento: `CrouchWalk` (de `crouch_fwd_loop`, sustituye al anterior) y `ChestOpen` (de `chest_open`, para registrar canecas). El agachado para hacer popó usa `Crouch` mezclado por código.
- Clips añadidos en el lote 4 (golpes, 2026-11-09), mismo origen y procedimiento: `FightJab` (`punch_jab`) y `FightCross` (`punch_cross`).
- Clips añadidos en el lote 3 (nadar, 2026-11-09), mismo origen y procedimiento: `SwimFwd` (`swim_fwd_loop`) y `SwimIdle` (`swim_idle_loop`).
- Verificado: 2026-11-09, en la página oficial; copia de la nota en `licencias-fuentes/actionforge.md`.
- Notas: la página no escribe términos para los archivos exportados; como las animaciones son CC0 se asume que no añaden restricciones.

### ACCAD Open Motion Project (Ohio State University), Male 2

- Licencia: Creative Commons Attribution 3.0 Unported (CC BY 3.0): uso comercial permitido con atribución.
- Enlace de la fuente: https://accad.osu.edu/research/motion-lab/mocap-system-and-data
- Enlace de la licencia: https://creativecommons.org/licenses/by/3.0/
- Atribución exigida: «Motion capture data from the Open Motion Project, ACCAD, The Ohio State University (CC BY 3.0)».
- Clips del juego que vienen de ella (lote 4, 2026-11-09; BVH `Male2_G2_FrontKick` y `Male2_G9_RoundhouseRight`, reorientados con `reorientar_clip.py --bvh-y-arriba --referencia Male2_A1_Stand.bvh`): `FightKickFront` (patada), `FightRoundhouse` (patada alta) y `FightHook` (gancho, de `Male2_E6_HookRight`).
- Verificado: 2026-11-09, en la página oficial; los BVH se descargan fuera del repositorio.
- Notas: el esqueleto de estos BVH viene en una pose de reposo doblada; por eso se reorienta con la pose de pie de `Male2_A1_Stand.bvh` como referencia.

### CMU Graphics Lab Motion Capture Database

- Licencia: texto de sus preguntas frecuentes: los datos «pueden copiarse, modificarse o redistribuirse sin permiso».
- Enlace de la fuente: https://mocap.cs.cmu.edu/
- Enlace de la licencia: https://mocap.cs.cmu.edu/faqs.php
- Atribución: pedida (dar crédito a la fuente): «Datos de captura de movimiento de la CMU Graphics Lab Motion Capture Database».
- Clips del juego que vienen de ella: ninguno todavía.
- Verificado: 2026-11-09, en las preguntas frecuentes oficiales (certificado de la página sin verificar); copia de la nota en `licencias-fuentes/cmu-mocap.md`.
- Notas: se usan solo los BVH originales, nunca conversiones de terceros con otra licencia.

### Excluida: Mixamo

Mixamo permite uso comercial, pero prohíbe redistribuir los archivos de animación como recurso suelto, y este repositorio es público. **No se añaden clips nuevos de Mixamo.** Los clips `walk_mixamo` y `run_mixamo` que ya están en el banco, y los archivos `andar-erguido.glb` y `andar-cansado.glb` de las que salen, provienen de Mixamo y quedan **pendientes de revisión** por el propietario del proyecto (no los toca el trabajo de esta especificación).

## Propias

Clips animados a mano para el juego, sin material de terceros. No tienen licencia externa.

- `PoliceGrab` y `PoliceRestrained` (captura policial, lote 4, 2026-11-09): animados a mano con `cpp/tools/animaciones/policia_captura.py` y `rig_lib.py`, sin material de terceros.
