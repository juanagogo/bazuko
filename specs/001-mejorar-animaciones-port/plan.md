# Implementation Plan: Mejorar las animaciones del personaje y los NPC (port en C++)

**Branch**: `001-mejorar-animaciones-port` (solo nombre de la especificación; se trabaja en la rama actual) | **Date**: 2026-11-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-mejorar-animaciones-port/spec.md`

## Summary

Se sustituyen y amplían los clips del banco de animaciones del port (esqueleto Mixamo de 52 huesos, compartido por jugador y NPC) en cinco lotes que se aprueban uno a uno. El movimiento sale de bibliotecas libres (Quaternius CC0 y ActionForge CC0 como primera opción, captura de CMU para vacíos) reorientadas hueso por hueso al esqueleto del juego con el método que el proyecto ya usa, y de animación propia para lo que no existe en captura (captura policial, pipa de basuco, retrovisor, oler el pegante). Los saltos conservan su control por código y reciben poses de captura. Cada lote se entrega con un GIF de antes y después y capturas en el juego, junto con el registro de licencias de cada fuente.

## Technical Context

**Language/Version**: C++20 (CMake 3.22) para el juego; Python 3 con Blender 5.2 (sin interfaz) para preparar y reorientar clips.

**Primary Dependencies**: motor propio del port (OpenGL 4.5, glTF con cgltf), Blender 5.2 headless, scripts en `cpp/tools/`. Sin dependencias nuevas en el juego.

**Storage**: archivos: banco `cpp/public/models/animaciones-cpp.glb` y su documentación; registro de licencias en `cpp/docs/`.

**Testing**: ejecutables CTest del proyecto (`cpp/tests/`), pruebas de lógica sobre las poses y las transiciones; revisión visual con `BAZUKO_PREVIEW_CLIP`/`BAZUKO_PREVIEW_TIME` y capturas del juego; hashes de simulación sin cambios (la animación es presentación).

**Target Platform**: Windows (principal) y Linux/WSL; sin cambios de plataforma.

**Project Type**: juego de escritorio (el port en C++).

**Performance Goals**: con los 80 peatones y 8 vendedores en pantalla, pérdida menor al 5 % de cuadros por segundo respecto al estado actual en el mismo recorrido (SC-003).

**Constraints**: clips en el sitio (el desplazamiento horizontal lo calcula el juego); cuerpo de 52 huesos y banco a 24 cuadros por segundo; los NPC siguen con el cuerpo de detalle reducido que comparte clips; banco de menos de 10 MB (hoy 3,6 MB); sin marcas ni logos; los cuerpos jóvenes no muestran torso ni piernas descubiertos; sin clips para modelos de vehículo restringidos.

**Scale/Scope**: unas 25 acciones repartidas en 5 lotes; un banco compartido; dos tipos de cuerpo (completo y reducido).

## Constitution Check

*GATE: debe pasar antes de la Fase 0 y se revisa tras el diseño.*

`.specify/memory/constitution.md` es todavía la plantilla sin rellenar, así que no impone puertas. Se aplican como puertas efectivas las reglas de `AGENTS.md` pertinentes:

| Regla del proyecto | Cumple | Cómo |
|---|---|---|
| Movimiento horizontal en el controlador, clips en el sitio | Sí | Todo clip se reorienta sin avance horizontal (R2, FR-009) |
| Los NPC siguen ligeros; clips horneados una vez por cuerpo, no por instancia | Sí | Banco compartido; sin animación por instancia (R5, FR-010) |
| Sin marcas ni logos; cuerpos jóvenes cubiertos | Sí | Se comprueba en cada lote (FR-014) |
| Mantener los créditos de las contribuciones | Sí | Registro de licencias y atribuciones (FR-011) |
| No cargar ni publicar modelos restringidos | Sí | Sin clips para esos vehículos (R6) |
| Documentar y actualizar capturas cuando cambia lo que describen | Sí | Se actualiza la documentación del banco y las capturas por lote |
| Hashes de simulación sin cambios | Sí | Solo cambia la presentación |

Resultado: sin violaciones. Se revisa de nuevo tras el diseño (más abajo).

## Project Structure

### Documentation (this feature)

```text
specs/001-mejorar-animaciones-port/
├── plan.md              # Este archivo
├── research.md          # Fase 0: decisiones y licencias
├── data-model.md        # Fase 1: movimiento, lote, comparación y registro de licencias
├── quickstart.md        # Fase 1: cómo correr y revisar un lote
├── contracts/           # Fase 1: convenciones de nombre/formato y del registro de licencias
│   ├── clip-contract.md
│   └── license-registry.md
└── tasks.md             # Fase 2 (/speckit-tasks; no lo crea este comando)
```

### Source Code (repository root)

```text
cpp/
├── tools/animaciones/               # scripts de Blender: reorientación y generación de clips (se amplían)
│   ├── reorientar_clip.py           # nuevo: reorienta un clip de otra fuente al esqueleto de 52 huesos, en el sitio
│   ├── fuentes/                     # nuevo: tablas de correspondencia de huesos por fuente (Quaternius UAL, CMU)
│   ├── comparar_clips.py            # nuevo: genera el GIF y las capturas de antes y después de un lote
│   └── (build_anims.py, rig_lib.py existentes)
├── public/models/animaciones-cpp.glb  # banco compartido (crece con los clips nuevos)
├── src/character/                   # JumpMoves.hpp, CombatMoves.hpp, CharacterManager*, Pipe/Smoking*: poses y uso de clips
├── tests/                           # pruebas de transiciones, en-el-sitio y presupuesto del banco
└── docs/
    ├── animaciones-licencias.md     # nuevo: registro de licencias y atribuciones
    └── (README.md, creditos existentes se actualizan)
```

**Structure Decision**: se mantiene la estructura del port. El trabajo vive en `cpp/tools/animaciones/` (preparación fuera de línea, con Blender) y en `cpp/src/character/` (cómo se usan los clips), sin tocar la simulación ni la red.

## Complexity Tracking

> Rellenar solo si la comprobación de reglas tiene violaciones que justificar.

No hay violaciones.

## Re-evaluación tras el diseño (Fase 1)

Las mismas reglas siguen cumpliéndose: los contratos exigen clips en el sitio, el banco con presupuesto de tamaño y un registro de licencias por clip. El único riesgo nuevo detectado queda fuera de este alcance y se deja aviso en `research.md` (R1): clips de Mixamo ya presentes en el repositorio público.
