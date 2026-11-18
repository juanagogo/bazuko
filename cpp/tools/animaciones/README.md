# Herramientas de animación del port

Scripts de Blender (sin interfaz) que preparan los clips del banco `public/models/animaciones-cpp.glb`.

## Cómo se invoca Blender

Blender 5.2 se usa sin interfaz. En Windows, por ejemplo:

```sh
"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" --background --python cpp/tools/animaciones/<script>.py -- <argumentos>
```

Todo lo que va después de `--` llega al script en `sys.argv`.

## Dónde se guardan las descargas de terceros

Las bibliotecas de captura de movimiento que se descargan (Quaternius, ActionForge, CMU) **se guardan fuera del repositorio**, por ejemplo en `C:\Users\<usuario>\animaciones-fuentes\<fuente>\`, y nunca se confirman en git. Solo entra al repositorio el banco final con los clips que se aprobaron, y su licencia queda en `cpp/docs/animaciones-licencias.md`.

## Scripts

| Script | Para qué |
|---|---|
| `reorientar_clip.py` | Reorienta un clip de otra fuente al esqueleto de 52 huesos, en el sitio y a 24 cuadros por segundo |
| `comparar_clips.py` | Genera el GIF lado a lado (actual / nuevo) y las capturas del juego para revisar un lote |
| `build_anims.py`, `rig_lib.py`, `stick_lib.py` | Generan los clips hechos a mano (vehículos, moto) sobre el banco |
| `fuentes/*.json` | Tablas de correspondencia de huesos por fuente |

Los contratos que cumplen los clips están en `specs/001-mejorar-animaciones-port/contracts/clip-contract.md`.
