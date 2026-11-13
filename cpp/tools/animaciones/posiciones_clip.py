"""Ayudante de comparar_clips.py (corre dentro de Blender): vuelca a JSON la posicion de cada hueso del esqueleto, cuadro a cuadro, de uno o varios clips de un banco.

Uso: blender --background --python posiciones_clip.py -- --banco <banco.glb> --clip Nombre [--clip Otro] --salida <posiciones.json>
Salida: { "fps": 24, "clips": { "Nombre": { "frames": N, "huesos": { "mixamorig:Hips": [[x,y,z], ...] } } } }  (metros, Z arriba)
"""
import bpy, sys, os, json, argparse

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--banco', required=True)
parser.add_argument('--clip', action='append', required=True)
parser.add_argument('--salida', required=True)
args = parser.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.banco))
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
actions = {a.name: a for a in bpy.data.actions}
arm.animation_data_create()
out = {'fps': 24, 'clips': {}}
for name in args.clip:
    action = actions.get(name)
    if action is None:
        out['clips'][name] = None
        continue
    arm.animation_data.action = action
    first, last = int(round(action.frame_range[0])), int(round(action.frame_range[1]))
    bones = {pb.name: [] for pb in arm.pose.bones}
    for frame in range(first, last + 1):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for pb in arm.pose.bones:
            p = arm.matrix_world @ pb.head
            bones[pb.name].append([round(p.x, 4), round(p.y, 4), round(p.z, 4)])
    out['clips'][name] = {'frames': last - first + 1, 'huesos': bones}
json.dump(out, open(os.path.abspath(args.salida), 'w'))
print('POSICIONES_LISTO', {k: (v['frames'] if v else None) for k, v in out['clips'].items()})
