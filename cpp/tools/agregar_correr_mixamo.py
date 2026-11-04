"""Agrega al banco de animaciones del port (public/models/animaciones-cpp.glb) el correr nuevo del juego original (clip `run` de
public/models/andar-cansado.glb, Mixamo «Running») con el esqueleto del banco, y lo exporta con el nombre `run_mixamo`.

Los dos esqueletos usan los mismos huesos `mixamorig:*` pero parten de posturas de reposo distintas, asi que el clip se reorienta hueso por
hueso en el espacio del armazon: giro_del_mundo_destino = (giro_pose_origen * giro_reposo_origen^-1) * giro_reposo_destino. La cadera conserva
su altura relativa (escala de la altura de reposo) y no avanza: el juego controla el movimiento horizontal.

Uso: blender --background --python cpp/tools/agregar_correr_mixamo.py -- <banco.glb> <andar-cansado.glb> <salida.glb>
"""
import bpy, sys, math
from mathutils import Matrix, Quaternion, Vector

args = sys.argv[sys.argv.index('--') + 1:]
bank_path, source_path, out_path = args[:3]
FPS = 24          # el banco del port va a 24 cuadros por segundo; el clip de Mixamo (30) se reparte sobre ese reloj para conservar su duracion real
SOURCE_FPS = 30

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=bank_path)
target = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bank_actions = list(bpy.data.actions)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=source_path)
source = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o not in before)
CLIPS = [('run', 'run_mixamo'), ('walk', 'walk_mixamo')]   # (accion en andar-cansado.glb, nombre en el banco)
source_actions = {a.name.lower(): a for a in bpy.data.actions if a not in bank_actions}
for o in list(bpy.data.objects):
    if o.type == 'MESH': bpy.data.objects.remove(o)

def rest_world(arm, bone_name):
    return (arm.matrix_world @ arm.data.bones[bone_name].matrix_local).to_quaternion()

def side_vector(arm):
    left = arm.matrix_world @ arm.data.bones['mixamorig:LeftUpLeg'].head_local
    right = arm.matrix_world @ arm.data.bones['mixamorig:RightUpLeg'].head_local
    v = left - right
    v.z = 0
    return v.normalized()

# giro global entre los dos esqueletos (hacia donde mira cada uno)
facing = side_vector(source).rotation_difference(side_vector(target))

names = [b.name for b in target.data.bones if b.name in source.data.bones]
hips = 'mixamorig:Hips'
src_hip_height = (source.matrix_world @ source.data.bones[hips].head_local).z
dst_hip_height = (target.matrix_world @ target.data.bones[hips].head_local).z
scale = dst_hip_height / src_hip_height if src_hip_height > 1e-4 else 1.0

def bake(run, new_name):
    source.animation_data_create()
    source.animation_data.action = run
    first, last = int(run.frame_range[0]), int(run.frame_range[1])

    # orden de padres a hijos
    order = []
    def visit(bone):
        if bone.name in names: order.append(bone.name)
        for child in bone.children: visit(child)
    for root in [b for b in target.data.bones if b.parent is None]: visit(root)

    clip = bpy.data.actions.new(new_name)
    target.animation_data_create()
    target.animation_data.action = clip
    for pb in target.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.render.fps_base = 1.0

    for frame in range(first, last + 1):
        bpy.context.scene.frame_set(frame)
        for name in order:
            spb, tpb = source.pose.bones[name], target.pose.bones[name]
            src_pose = (source.matrix_world @ spb.matrix).to_quaternion()
            delta = src_pose @ rest_world(source, name).inverted()
            wanted = facing @ delta @ facing.inverted() @ rest_world(target, name)
            # al espacio del armazon del destino
            wanted_local = (target.matrix_world.to_quaternion().inverted() @ wanted)
            m = tpb.matrix.copy()
            new = wanted_local.to_matrix().to_4x4()
            new.translation = m.translation
            if name == hips:   # solo sube y baja con el paso: el juego controla el avance
                delta = ((source.matrix_world @ spb.head) - (source.matrix_world @ source.data.bones[hips].head_local)) * scale   # en metros del mundo (el origen de Mixamo viene en centimetros con escala 0,01)
                rest_head = target.data.bones[hips].head_local
                new.translation = Vector((rest_head.x, rest_head.y, rest_head.z + delta.z))
            tpb.matrix = new
            bpy.context.view_layer.update()
        for name in order:
            tpb = target.pose.bones[name]
            key = 1 + (frame - first) * FPS / SOURCE_FPS
            tpb.keyframe_insert('rotation_quaternion', frame=key)
            if name == hips:
                tpb.keyframe_insert('location', frame=key)

    return clip


new_clips = [bake(source_actions[src], dst) for src, dst in CLIPS]

# se exportan el banco original y el clip nuevo juntos, cada accion en su pista (NLA): asi el exportador conserva todas y no el esqueleto de origen
target.animation_data.action = None
bpy.data.objects.remove(source)
for action in bank_actions + new_clips:
    track = target.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, int(action.frame_range[0]), action)
bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_force_sampling=True, export_skins=True, export_apply=False)
print('CORRER_LISTO', [c.name for c in new_clips], len(bank_actions) + len(new_clips))
