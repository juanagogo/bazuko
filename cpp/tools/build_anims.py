"""Genera los clips de vehiculos (carro y moto) sobre el banco de animaciones del port y los exporta.
Uso: blender --background --python build_anims.py -- [preview|export] [carro|moto|todo]"""
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix
S = r"C:\Users\raull\AppData\Local\Temp\claude\C--Users-raull-Documentos-Proyectos-bazuko\c1ddfc87-171b-4219-8267-ee9f6fcb8e2a\scratchpad\\"
sys.path.insert(0, S.rstrip('\\'))
import rig_lib, stick_lib, car_clips
import importlib
for m in (rig_lib, stick_lib, car_clips): importlib.reload(m)
try:
    import moto_clips; importlib.reload(moto_clips)
except ImportError:
    moto_clips = None

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
mode = args[0] if args else 'preview'
which = args[1] if len(args) > 1 else 'todo'
SRC = S + "animaciones-cpp.original.glb"   # banco original (27 clips): se parte siempre de el
FPS = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o.type == 'MESH': bpy.data.objects.remove(o)
old_actions = [a for a in bpy.data.actions]
arm.animation_data_clear()
rig = rig_lib.Rig(arm)
bpy.context.scene.render.fps = FPS

# --- vehiculos de referencia (solo para las renders de revision) ----------------------------------------------------
def car_proxy(door_angle):
    bm = bmesh.new()
    stick_lib.box(bm, Vector((0, 0, 0.47)), (4.4, 1.8, 0.7))              # carroceria
    stick_lib.box(bm, Vector((-0.1, 0, 1.18)), (2.2, 1.5, 0.45))          # cabina
    for sx in (1.35, -1.35):
        for sy in (0.85, -0.85):
            stick_lib.tube(bm, Vector((sx, sy - 0.12, 0.32)), Vector((sx, sy + 0.12, 0.32)), 0.32, 10)
    # asiento y respaldo
    stick_lib.box(bm, Vector((-0.02, 0.42, 0.40)), (0.5, 0.5, 0.16))
    stick_lib.box(bm, Vector((-0.30, 0.42, 0.68)), (0.12, 0.5, 0.55))
    # volante
    stick_lib.tube(bm, Vector((0.55, 0.42, 0.80)), Vector((0.40, 0.42, 0.93)), 0.02)
    th = math.radians(25)
    ring = [Vector((0.40 - 0.03 * math.sin(th) * 0, 0.42 + 0.18 * math.cos(a), 0.93 + 0.18 * math.sin(a))) for a in [i * math.pi / 8 for i in range(17)]]
    for a, b in zip(ring, ring[1:]): stick_lib.tube(bm, a, b, 0.012)
    body = stick_lib.make_obj('car', bm, (0.45, 0.55, 0.75, 1))
    wm = body.modifiers.new('w', 'WIREFRAME'); wm.thickness = 0.015; wm.use_replace = True
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier='w')
    # puerta
    bm2 = bmesh.new()
    th = math.radians(door_angle)
    hinge = Vector((car_clips.HINGE[0], car_clips.HINGE[1], 0.0))
    d = Vector((-math.cos(th), math.sin(th), 0)) * car_clips.DOOR_LEN
    a, b = hinge, hinge + d
    stick_lib.tube(bm2, a + Vector((0, 0, 0.45)), b + Vector((0, 0, 0.45)), 0.03)
    stick_lib.tube(bm2, a + Vector((0, 0, 1.15)), b + Vector((0, 0, 1.15)), 0.03)
    stick_lib.tube(bm2, a + Vector((0, 0, 0.45)), a + Vector((0, 0, 1.15)), 0.03)
    stick_lib.tube(bm2, b + Vector((0, 0, 0.45)), b + Vector((0, 0, 1.15)), 0.03)
    h = hinge + d * 0.9 + Vector((0, 0, 0.96)); stick_lib.tube(bm2, h, h + Vector((0, 0.06, 0)), 0.02)
    door = stick_lib.make_obj('door', bm2, (0.85, 0.35, 0.3, 1))
    return [body, door]

def moto_proxy():
    bm = bmesh.new()
    for sx in (0.75, -0.75):
        stick_lib.tube(bm, Vector((sx, 0, 0.32)), Vector((sx, 0.001, 0.32)), 0.32, 12)
        bmesh.ops.create_circle(bm, cap_ends=False, segments=1, radius=0.001)
    stick_lib.tube(bm, Vector((0.75, 0, 0.32)), Vector((0.62, 0, 0.95)), 0.03)       # horquilla
    stick_lib.tube(bm, Vector((0.62, 0, 0.95)), Vector((0.55, 0.35, 1.06)), 0.02)    # manubrio izq
    stick_lib.tube(bm, Vector((0.62, 0, 0.95)), Vector((0.55, -0.35, 1.06)), 0.02)   # manubrio der
    stick_lib.box(bm, Vector((0.25, 0, 0.78)), (0.5, 0.30, 0.25))                     # tanque
    stick_lib.box(bm, Vector((-0.15, 0, 0.80)), (0.55, 0.30, 0.06))                   # asiento
    stick_lib.box(bm, Vector((0.05, 0, 0.45)), (0.6, 0.25, 0.30))                     # motor
    stick_lib.tube(bm, Vector((0.10, 0.27, 0.30)), Vector((0.10, 0.36, 0.30)), 0.015)
    stick_lib.tube(bm, Vector((0.10, -0.27, 0.30)), Vector((0.10, -0.36, 0.30)), 0.015)
    stick_lib.tube(bm, Vector((-0.75, 0, 0.32)), Vector((0.05, 0, 0.45)), 0.03)
    ob = stick_lib.make_obj('moto', bm, (0.25, 0.3, 0.4, 1))
    return [ob]

def to_pose_targets(keys_car_frame, entity_origin=None, rotate=False):
    out = []
    for f, t in keys_car_frame:
        if rotate: out.append((f, car_clips.car_rotate(t, entity_origin)))
        else: out.append((f, car_clips.to_entity(t, entity_origin)))
    return out

def build_action(name, keys, length):
    act = bpy.data.actions.new(name)
    arm.animation_data_create(); arm.animation_data.action = act
    for f in range(0, length + 1):
        t = rig_lib.sample(keys, f)
        rig.pose_all(t)
        rig.key(f)
    arm.animation_data.action = None
    act.use_fake_user = True
    return act

def preview(name, keys_entity, origin, frames, door_fn, cam_data, moto=False):
    for f in frames:
        t = rig_lib.sample(keys_entity, f)
        # al marco del mundo para el render: se devuelve el origen de la entidad
        tw = dict(t)
        for k in ('hips_pos', 'Lhand', 'Rhand', 'Lfoot', 'Rfoot'):
            v = t[k]; tw[k] = (v[0] + origin[0], v[1] + origin[1], v[2])
        rig.pose_all(tw)
        fig = stick_lib.figure(rig)
        objs = (moto_proxy() if moto else car_proxy(door_fn(f))) if door_fn else []
        for tag, loc, tgt, sc in cam_data:
            stick_lib.shoot(cam, S + 'an_%s_f%02d_%s.png' % (name, f, tag), loc, tgt, sc)
        for o in objs + [fig]: bpy.data.objects.remove(o)

cam = stick_lib.setup_render(520, 420)
side = [('side', (0.0, 6.0, 1.0), (0.0, 0.0, 1.0), 3.6), ('top', (0.0, 0.5, 7.0), (0.0, 0.5, 0.0), 4.2)]

if mode == 'preview':
    if which in ('carro', 'todo'):
        enter = to_pose_targets(car_clips.enter_keys(), (0.0, 0.0))
        preview('enter', enter, (0.0, 0.0), [0, 8, 14, 20, 26, 34, 42, 50, 58, 66, 72], car_clips.door_angle_enter, side)
        exitk = to_pose_targets(car_clips.exit_keys(), (0.0, 0.0))
        preview('exit', exitk, (0.0, 0.0), [0, 8, 16, 24, 34, 42, 52, 60, 72], car_clips.door_angle_exit, side)
        drive = to_pose_targets(car_clips.drive_keys(), (0.0, 0.0))
        preview('drive', drive, (0.0, 0.0), [0, 12, 24, 36], lambda f: 0.0, side)
    if which in ('moto', 'todo') and moto_clips:
        mount = to_pose_targets(moto_clips.mount_keys(), (0.0, 0.0))
        preview('mmount', mount, (0.0, 0.0), [0, 8, 16, 24, 32, 40, 48], lambda f: 0.0, side, moto=True)
        ride = to_pose_targets(moto_clips.ride_keys(), (0.0, 0.0))
        preview('mride', ride, (0.0, 0.0), [0, 9, 18, 27], lambda f: 0.0, side, moto=True)
        dis = to_pose_targets(moto_clips.dismount_keys(), (0.0, 0.0))
        preview('mdis', dis, (0.0, 0.0), [0, 8, 16, 24, 34, 44, 54, 60], lambda f: 0.0, side, moto=True)

if mode == 'export':
    out_path = args[2] if len(args) > 2 else S + 'animaciones_nuevas.glb'
    profiles = json.load(open(S + 'profiles.json'))
    specs = []
    if which in ('carro', 'todo'):
        car_clips.configure({})   # carro de referencia
        specs += [
            ('CarEnter', to_pose_targets(car_clips.enter_keys(), car_clips.E0), 72),
            ('CarDrive', to_pose_targets(car_clips.drive_keys(), car_clips.SEAT, rotate=True), 48),
            ('CarExit', to_pose_targets(car_clips.exit_keys(), car_clips.E0), 72)]
        for stem, spec in profiles.items():
            sp = {k: (tuple(v) if isinstance(v, list) else v) for k, v in spec.items()}
            e0 = car_clips.configure(sp)
            specs += [
                ('CarEnter_' + stem, to_pose_targets(car_clips.enter_keys(), car_clips.E0), 72),
                ('CarDrive_' + stem, to_pose_targets(car_clips.drive_keys(), car_clips.SEAT, rotate=True), 48),
                ('CarExit_' + stem, to_pose_targets(car_clips.exit_keys(), car_clips.E0), 72)]
    if which in ('moto', 'todo') and moto_clips:
        moto_clips.configure({})
        specs += [
            ('BikeMount', to_pose_targets(moto_clips.mount_keys(), moto_clips.M0), 48),
            ('BikeRide', to_pose_targets(moto_clips.ride_keys(), moto_clips.SEAT, rotate=True), 36),
            ('BikeDismount', to_pose_targets(moto_clips.dismount_keys(), moto_clips.M0), 60)]
    new_actions = [build_action(n, k, l) for n, k, l in specs]
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    arm.animation_data_create()
    for act in old_actions + new_actions:
        tr = arm.animation_data.nla_tracks.new(); tr.name = act.name
        st = tr.strips.new(act.name, 0, act)
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='NLA_TRACKS', export_force_sampling=True, export_optimize_animation_size=True,
                              export_yup=True)
    print('EXPORTADO', out_path, len(specs))
