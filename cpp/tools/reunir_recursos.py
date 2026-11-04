"""Reune en cpp/public/ los recursos del juego original que usa el port C++ (modelos, texturas, sonidos e imagenes).

El port busca sus archivos con rutas relativas "public/..." (Paths::Find) y la primera carpeta donde las encuentra, subiendo desde el
ejecutable, es cpp/public/: asi el juego compila y funciona sin tocar nada fuera de cpp/.

Reglas:
  * Solo se copian archivos que Git rastrea: los modelos sin permiso de redistribucion (Pitbull, Raptor, Renault 6, Model X y Transmilenio
    articulado, ver docs/creditos-modelos.md) estan en .gitignore y por tanto nunca llegan aqui.
  * De cada modelo se copia el archivo y lo que el cargador (Model.cpp) resuelve para el: .bin de los glTF, texturas por nombre
    (primero junto al modelo y luego en su arbol de carpetas, como resolveTexturePath) y las imagenes de su misma carpeta.
  * No se copian fuentes de Blender (.blend, .blend1), proyectos de Maya (.ma), mallas alternativas (.stl, .dae, .obj duplicados) ni
    versiones pesadas que el port no carga.

Uso (desde cualquier carpeta):  python cpp/tools/reunir_recursos.py [--simular]
"""
import argparse
import posixpath
import re
import shutil
import subprocess
import sys
from pathlib import Path

CPP = Path(__file__).resolve().parent.parent
REPO = CPP.parent
SRC = REPO / "public"
DST = CPP / "public"

IMAGES = {".png", ".jpg", ".jpeg", ".tga", ".webp", ".bmp", ".tif", ".tiff"}
SKIP_SUFFIXES = {".blend", ".blend1", ".ma", ".stl", ".dae", ".swatches"}

# Archivos sueltos de public/models/ que carga el port
MODEL_FILES = [
    "animaciones-cpp.glb", "animaciones-actionforge.glb", "animaciones-prueba.glb",
    "vehiculo1.opt.glb", "vehiculo2.opt.glb", "tm.opt.glb", "cambuche.opt.glb", "bolsa.opt.glb", "contenedor.opt.glb",
    "lamparas.opt.glb", "semaforo.opt.glb", "ambulancia.opt.glb", "vehiculo_policia.opt.glb", "moto_policia.opt.glb",
    "perro.glb", "labrador.glb", "labrador.json", "mascota.fbx", "pasto.fbx", "arma/cuchillo.glb",
]
# Carpetas completas (solo lo rastreado por Git)
MODEL_DIRS = ["personaje", "vehiculos", "bus-articulado"]
# Modelos con dependencias: el archivo mas lo que su cargador resuelve
MODEL_WITH_DEPENDENCIES = [
    "Edificio 1/Only_Building.fbx",
    "Edificio 3/highrise.fbx",
    "Edificio 2/Models/FBX/Building_LevelModularShell_Bottom.fbx",
    "Edificio 2/Models/FBX/Building_LevelModularShell_Mid.fbx",
    "Edificio 2/Models/FBX/Building_LevelModularShell_Top.fbx",
    "Arbol 1/FBX format/conifer_macedonian_pine.fbx",
    "Silla plastica/plastic+chair.obj",
    "Ave 1/Woodpecker.gltf", "Ave 2/Seagull.gltf", "Rata/Rat.gltf",
    "comida rapida/food+cart.fbx", "luminaria/street+light.fbx",
    "pez1/scene.gltf", "pez2/source/Fish/Fish.FBX",
]
EXTRA_FILES = ["models/agua/textures/Water_Diffuse.png"]
# Piezas de las aves (Woodpecker_body.gltf, ...): cada una con su .bin
BIRD_PARTS = ["Ave 1/Woodpecker", "Ave 2/Seagull"]
BIRD_SUFFIXES = ["_body", "_head", "_legL", "_legR", "_L_in", "_L_out", "_R_in", "_R_out"]
OTHER_DIRS = ["audio", "images/pantalla-carga"]


def tracked():
    out = subprocess.run(["git", "-C", str(REPO), "ls-files", "-z", "public"], capture_output=True, check=True).stdout
    return {Path(p.decode("utf-8")).relative_to("public") for p in out.split(b"\0") if p}


def normalized(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def texture_names(path):
    """Nombres de imagen citados dentro de un modelo (FBX/OBJ/MTL/glTF); sirve para buscar sus archivos."""
    data = path.read_bytes()
    pattern = rb"[\w\-\./\\: +()@]{2,200}\.(?:png|jpe?g|tga|webp|bmp|tif)"
    return {m.group(0).decode("latin1").replace("\\", "/") for m in re.finditer(pattern, data, re.I)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--simular", action="store_true", help="solo lista lo que se copiaria")
    args = parser.parse_args()
    files = tracked()
    chosen = set()

    def add(rel):
        rel = Path(rel)
        if rel in files and rel.suffix.lower() not in SKIP_SUFFIXES:
            chosen.add(rel)
            return True
        return False

    for name in MODEL_FILES:
        if not add(Path("models") / name):
            print("aviso: no esta rastreado", name)
    for folder in MODEL_DIRS:
        for rel in files:
            if rel.parts[:2] == ("models", folder):
                add(rel)
    for folder in OTHER_DIRS:
        for rel in files:
            if rel.as_posix().startswith(f"{folder}/"):
                add(rel)
    for name in EXTRA_FILES:
        add(name)
    for stem in BIRD_PARTS:
        for suffix in BIRD_SUFFIXES:
            add(Path("models") / f"{stem}{suffix}.gltf")
            add(Path("models") / f"{stem}{suffix}.bin")

    for name in MODEL_WITH_DEPENDENCIES:
        model = Path("models") / name
        if not add(model):
            print("aviso: no esta rastreado", model)
            continue
        folder = model.parent
        siblings = [r for r in files if r.parent == folder]
        subtree = [r for r in files if folder in r.parents or r.parent == folder]
        if model.suffix.lower() == ".gltf":   # .bin y texturas citados por el JSON
            for ref in re.findall(r'"uri"\s*:\s*"([^"]+)"', (SRC / model).read_text(encoding="utf-8")):
                if not ref.startswith("data:"):
                    add(folder / ref.replace("%20", " "))
        elif model.suffix.lower() == ".obj":
            for sibling in siblings:   # su .mtl y las imagenes de su carpeta
                if sibling.suffix.lower() in IMAGES | {".mtl"}:
                    add(sibling)
        else:
            references = texture_names(SRC / model)
            for reference in references:   # rutas relativas al modelo ("../../Textures/Brick_A.tga"), tal como las abre el cargador
                if not re.match(r"^([A-Za-z]:|/)", reference):
                    add(Path(posixpath.normpath((folder / reference).as_posix())))
            wanted = {normalized(Path(n).name) for n in references}
            for candidate in subtree:   # igual que resolveTexturePath: por nombre dentro del arbol del modelo
                if candidate.suffix.lower() in IMAGES and normalized(candidate.name) in wanted:
                    add(candidate)
        for sibling in siblings:   # la carpeta del modelo tambien se explora buscando una textura de color de respaldo
            if sibling.suffix.lower() in IMAGES:
                add(sibling)

    total = 0
    for rel in sorted(chosen):
        size = (SRC / rel).stat().st_size
        total += size
        if args.simular:
            print(f"{size / 1024:10.0f} KB  {rel.as_posix()}")
            continue
        target = DST / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.stat().st_size != size:
            shutil.copy2(SRC / rel, target)
    print(f"{len(chosen)} archivos, {total / 1048576:.1f} MB -> {DST}")


if __name__ == "__main__":
    sys.exit(main())
