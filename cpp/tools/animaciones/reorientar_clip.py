"""Reorienta clips de otra fuente al esqueleto de 52 huesos del banco de animaciones del port y los añade al banco, en el sitio.

Generaliza cpp/tools/agregar_correr_mixamo.py. Para cada clip: la cadera solo sube y baja (el juego controla el avance horizontal), los brazos
se apuntan hacia donde apuntan los del original (los reposos de los esqueletos son distintos) y el resultado queda a 24 cuadros por segundo
conservando la duracion real. El banco se exporta completo: los clips que ya tenia mas los nuevos.

Uso:
  blender --background --python cpp/tools/animaciones/reorientar_clip.py -- \
      --banco cpp/public/models/animaciones-cpp.glb --origen <fuente.glb|.fbx|.bvh> \
      --clip <accion_de_la_fuente>=<NombreNuevo> [--clip ...] [--mapa fuentes/<fuente>.json] [--fps-origen 30] --salida <banco_nuevo.glb>

  --mapa      tabla de correspondencia de huesos (fuentes/README.md). Sin ella, la fuente ya usa los nombres mixamorig:*.
  --fps-origen  cuadros por segundo del clip de la fuente. Por defecto (0): en glTF/FBX Blender ya convierte el tiempo a cuadros de la escena (24),
                asi que no se reescala; en BVH se lee "Frame Time" de la cabecera del archivo.
  --bvh-y-arriba  el BVH tiene Y hacia arriba (ACCAD); sin esto se supone Z.
  --prefijo   texto que se antepone al nombre de cada clip nuevo (opcional).
Un clip nuevo con el nombre de uno del banco lo sustituye. Los huesos de la fuente que no estan en el mapa ni en `ignorar` detienen el proceso, para no perder movimiento sin notarlo.
"""
import bpy, sys, os, json, argparse
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--banco', required=True)
parser.add_argument('--origen', required=True)
parser.add_argument('--clip', action='append', required=True, help='accion_de_la_fuente=NombreNuevo')
parser.add_argument('--mapa')
parser.add_argument('--fps-origen', type=float, default=0.0)
parser.add_argument('--salida', required=True)
parser.add_argument('--prefijo', default='')
parser.add_argument('--referencia', help='BVH de la misma fuente con un personaje de pie y neutro: su primer cuadro hace de pose de reposo de la fuente (hace falta cuando el esqueleto del BVH viene en una pose que no es de pie, como el de ACCAD)')
parser.add_argument('--bvh-y-arriba', action='store_true', help='el BVH tiene el eje Y hacia arriba (ACCAD, MotionBuilder); por defecto se supone Z hacia arriba')
args = parser.parse_args(argv)
for _campo in ('banco', 'origen', 'salida', 'mapa'):   # Blender no resuelve bien las rutas relativas: se pasan absolutas
    if getattr(args, _campo):
        setattr(args, _campo, os.path.abspath(getattr(args, _campo)))

FPS = 24            # el banco del port va a 24 cuadros por segundo
SOURCE_FPS = args.fps_origen   # se resuelve mas abajo, cuando se sabe el formato de la fuente
AIMED = ('Shoulder', 'Arm', 'ForeArm')   # huesos que se apuntan (los de la mano heredan su giro)
CLIPS = [tuple(item.split('=', 1)) for item in args.clip]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.banco)
target = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bank_actions = list(bpy.data.actions)
before = set(bpy.data.objects)

ext = os.path.splitext(args.origen)[1].lower()
if ext in ('.glb', '.gltf'):
    bpy.ops.import_scene.gltf(filepath=args.origen)
elif ext == '.fbx':
    bpy.ops.import_scene.fbx(filepath=args.origen)
elif ext == '.bvh':
    bpy.ops.import_anim.bvh(filepath=args.origen, axis_forward='-Z' if args.bvh_y_arriba else '-Y', axis_up='Y' if args.bvh_y_arriba else 'Z', rotate_mode='NATIVE', use_fps_scale=False)
else:
    sys.exit(f'formato de origen no soportado: {ext}')
source = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o not in before)
if not SOURCE_FPS:
    if ext == '.bvh':
        import re
        m = re.search(r'Frame Time:\s*([0-9.eE+-]+)', open(args.origen, errors='ignore').read(4000000))
        SOURCE_FPS = 1.0 / float(m.group(1)) if m else 30.0
    else:
        SOURCE_FPS = float(FPS)   # el importador de glTF/FBX ya deja los cuadros a la frecuencia de la escena
for o in list(bpy.data.objects):
    if o.type == 'MESH': bpy.data.objects.remove(o)

REF = None   # pose de reposo de la fuente tomada del primer cuadro del BVH de referencia: {hueso: giro de mundo} y posiciones de cadera y piernas
if args.referencia:
    if ext != '.bvh': sys.exit('--referencia solo vale con BVH')
    before_ref = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=os.path.abspath(args.referencia), axis_forward='-Z' if args.bvh_y_arriba else '-Y', axis_up='Y' if args.bvh_y_arriba else 'Z', rotate_mode='NATIVE', use_fps_scale=False)
    ref_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE' and o not in before_ref and o is not source)
    REF_PENDING = ref_arm

# nombres de hueso de la fuente -> los del banco
if args.mapa:
    table = json.load(open(args.mapa, encoding='utf-8'))
    mapping, ignored = table['huesos'], set(table.get('ignorar', []))
    unknown = [b.name for b in source.data.bones if b.name not in mapping and b.name not in ignored and not b.name.startswith('mixamorig:')]
    if unknown:
        sys.exit('huesos de la fuente sin correspondencia (anadirlos a "huesos" o a "ignorar"): ' + ', '.join(unknown))
    for old, new in mapping.items():
        if old in source.data.bones and old != new:
            source.data.bones[old].name = new
        if args.referencia and old in REF_PENDING.data.bones and old != new:
            REF_PENDING.data.bones[old].name = new

source_actions = {a.name.lower(): a for a in bpy.data.actions if a not in bank_actions}

if args.referencia:
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    REF = {'rot': {pb.name: (REF_PENDING.matrix_world @ pb.matrix).to_quaternion() for pb in REF_PENDING.pose.bones},
           'pos': {pb.name: (REF_PENDING.matrix_world @ pb.head).copy() for pb in REF_PENDING.pose.bones}}
    bpy.data.objects.remove(REF_PENDING)

def rest_world(arm, bone_name):
    if REF is not None and arm is source:   # el reposo de la fuente es la pose de pie de la referencia, no la del esqueleto del archivo
        return REF['rot'][bone_name]
    return (arm.matrix_world @ arm.data.bones[bone_name].matrix_local).to_quaternion()

def side_vector(arm):
    if REF is not None and arm is source:
        left, right = REF['pos']['mixamorig:LeftUpLeg'], REF['pos']['mixamorig:RightUpLeg']
    else:
        left = arm.matrix_world @ arm.data.bones['mixamorig:LeftUpLeg'].head_local
        right = arm.matrix_world @ arm.data.bones['mixamorig:RightUpLeg'].head_local
    v = left - right
    v.z = 0
    return v.normalized()

# giro global entre los dos esqueletos (hacia donde mira cada uno)
facing = side_vector(source).rotation_difference(side_vector(target))

names = [b.name for b in target.data.bones if b.name in source.data.bones]
hips = 'mixamorig:Hips'
src_hip_height = REF['pos'][hips].z if REF is not None else (source.matrix_world @ source.data.bones[hips].head_local).z
dst_hip_height = (target.matrix_world @ target.data.bones[hips].head_local).z
scale = dst_hip_height / src_hip_height if src_hip_height > 1e-4 else 1.0

def bake(action, new_name):
    source.animation_data_create()
    source.animation_data.action = action
    first, last = int(action.frame_range[0]), int(action.frame_range[1])

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
        correction = {}   # giro extra de cada hueso de los brazos (y de lo que cuelga de ellos) sobre el calculado por diferencia
        for name in order:
            spb, tpb = source.pose.bones[name], target.pose.bones[name]
            src_pose = (source.matrix_world @ spb.matrix).to_quaternion()
            delta = src_pose @ rest_world(source, name).inverted()
            wanted = facing @ delta @ facing.inverted() @ rest_world(target, name)
            parent = target.data.bones[name].parent
            if any(key in name for key in AIMED):
                # los dos esqueletos parten de reposos distintos en los brazos: girar el hueso igual que el original solo lo torceria sobre su
                # eje. Se apunta el hueso hacia donde apunta el del original en ese cuadro.
                y = Vector((0.0, 1.0, 0.0))
                direction = facing @ (src_pose @ y)
                rest_dir = rest_world(target, name) @ y
                aimed = rest_dir.rotation_difference(direction) @ rest_world(target, name)
                correction[name] = aimed @ wanted.inverted()
                wanted = aimed
            elif parent is not None and parent.name in correction:
                correction[name] = correction[parent.name]
                wanted = correction[name] @ wanted
            # al espacio del armazon del destino
            wanted_local = (target.matrix_world.to_quaternion().inverted() @ wanted)
            m = tpb.matrix.copy()
            new = wanted_local.to_matrix().to_4x4()
            new.translation = m.translation
            if name == hips:   # solo sube y baja con el paso: el juego controla el avance
                delta_pos = ((source.matrix_world @ spb.head) - (REF['pos'][hips] if REF is not None else (source.matrix_world @ source.data.bones[hips].head_local))) * scale
                rest_head = target.data.bones[hips].head_local
                new.translation = Vector((rest_head.x, rest_head.y, rest_head.z + delta_pos.z))
            tpb.matrix = new
            bpy.context.view_layer.update()
        for name in order:
            tpb = target.pose.bones[name]
            key = 1 + (frame - first) * FPS / SOURCE_FPS
            tpb.keyframe_insert('rotation_quaternion', frame=key)
            if name == hips:
                tpb.keyframe_insert('location', frame=key)

    return clip

# Los clips se hornean primero con un nombre provisorio y, solo despues, los que se llaman como uno del banco lo SUSTITUYEN (no queda dos con
# el mismo nombre). Quitar el clip viejo ANTES de hornear dejaba el nuevo vacio: el esqueleto perdia su accion y su ranura.
new_clips = []
for src_name, dst_name in CLIPS:
    action = source_actions.get(src_name.lower())
    if action is None:
        sys.exit(f'no hay una accion "{src_name}" en la fuente; acciones: {sorted(source_actions)}')
    new_clips.append(bake(action, '__nuevo_' + args.prefijo + dst_name))
target.animation_data.action = None
replaced = [clip.name[len('__nuevo_'):] for clip in new_clips if clip.name[len('__nuevo_'):] in {a.name for a in bank_actions}]
for name in replaced:
    old = next(a for a in bank_actions if a.name == name)
    bank_actions.remove(old)
    bpy.data.actions.remove(old)
if replaced: print('SUSTITUIDOS', replaced)
for clip in new_clips:
    clip.name = clip.name[len('__nuevo_'):]

# se exportan el banco original y los clips nuevos juntos, cada accion en su pista (NLA): asi el exportador conserva todas y no el esqueleto de origen
target.animation_data.action = None
bpy.data.objects.remove(source)
for old_track in list(target.animation_data.nla_tracks):   # las pistas que dejo el importador (una por clip, incluso la del clip sustituido)
    target.animation_data.nla_tracks.remove(old_track)
for action in bank_actions + new_clips:
    track = target.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, int(action.frame_range[0]), action)
bpy.ops.export_scene.gltf(filepath=args.salida, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_force_sampling=True, export_skins=True, export_apply=False)
print('REORIENTAR_LISTO', [c.name for c in new_clips], len(bank_actions) + len(new_clips))
