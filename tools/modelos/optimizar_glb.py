"""Reduce la geometría de los GLB importados con Blender, partiendo siempre de los originales.

Uso: blender -b --factory-startup --python tools/modelos/optimizar_glb.py [-- modelo ...]

Los originales se extraen del commit en que se incorporó cada archivo (ver docs/modelos-importados.md),
así que volver a ejecutar el script no reduce dos veces el mismo archivo.
"""
import os
from pathlib import Path
import subprocess
import sys

import bpy

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'work/modelos-originales'
OUTPUT = ROOT / 'public/models'

# ratio: fracción de triángulos que se conserva.
# weld: soldar vértices antes de reducir. Sin soldar, las costuras UV quedan como bordes
#   y la textura no se desplaza (canecas, cambuche); con piezas finas eso abre grietas,
#   así que carros, bolsa y semáforo sí se sueldan.
# strip: entradas del material que el juego descarta (el semáforo usa su propio material).
# El bus y las lámparas se dejan como están: el fuelle del bus se abre al reducirlo.
MODELS = {
    'car1.opt.glb': dict(ratio=.5, weld=True),
    'car2.opt.glb': dict(ratio=.5, weld=True),
    'contenedor.opt.glb': dict(ratio=.35, weld=False),
    'bolsa.opt.glb': dict(ratio=.3, weld=True),
    'cambuche.opt.glb': dict(ratio=.5, weld=False),
    'semaforo.opt.glb': dict(ratio=.65, weld=True, strip=('Normal', 'Metallic', 'Roughness')),
}
# La base no se reduce: fitImportedModel y TrafficSignals ubican el poste con sus vértices.
BASE_FRACTION = .04


def original(name):
    path = SOURCE / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        git = lambda *args: subprocess.run(['git', *args], cwd=ROOT, check=True, capture_output=True).stdout
        added = git('log', '--diff-filter=A', '--format=%H', '--', f'public/models/{name}').split()[-1].decode()
        blob = git('show', f'{added}:public/models/{name}')
        path.write_bytes(blob)
    return path


def triangles(objects):
    total = 0
    for o in objects:
        o.data.calc_loop_triangles()
        total += len(o.data.loop_triangles)
    return total


def optimize(name, ratio, weld, strip=()):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(original(name)))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    before = triangles(meshes)
    for o in meshes:
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        if weld:
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.remove_doubles(threshold=max(o.dimensions) * 1e-5)
            bpy.ops.object.mode_set(mode='OBJECT')
        heights = [(o.matrix_world @ v.co).z for v in o.data.vertices]
        floor = min(heights) + (max(heights) - min(heights)) * BASE_FRACTION
        group = o.vertex_groups.new(name='reducible')
        group.add([i for i, z in enumerate(heights) if z >= floor], 1.0, 'REPLACE')
        modifier = o.modifiers.new('reducir', 'DECIMATE')
        modifier.decimate_type = 'COLLAPSE'
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        modifier.vertex_group = group.name
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        o.vertex_groups.clear()
    for material in bpy.data.materials:
        bsdf = material.node_tree and next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        for socket in (bsdf.inputs[s] for s in strip if bsdf):
            for link in list(socket.links):
                material.node_tree.links.remove(link)
    target = OUTPUT / name
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', export_image_format='AUTO',
                              export_apply=True, export_animations=False, export_cameras=False,
                              export_lights=False, export_tangents=False)
    after = triangles([o for o in bpy.data.objects if o.type == 'MESH'])
    size = os.path.getsize(original(name)), os.path.getsize(target)
    print(f'{name}: {before} -> {after} triángulos, {size[0] // 1024} -> {size[1] // 1024} KiB')


requested = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(MODELS)
for name in requested:
    optimize(name, **MODELS[name])
