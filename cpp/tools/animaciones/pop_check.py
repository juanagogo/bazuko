import bpy, sys, json, math, os
from mathutils import Vector, Quaternion
S = os.path.dirname(os.path.abspath(__file__)) + os.sep
sys.path.insert(0, S[:-1])
import rig_lib, car_clips
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=S + "animaciones-cpp.original.glb")
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o.type == 'MESH': bpy.data.objects.remove(o)
arm.animation_data_clear()
rig = rig_lib.Rig(arm)
profiles = json.load(open(S + 'profiles.json')); profiles['ref'] = {}
which = sys.argv[sys.argv.index('--') + 1:]
LIM = {'Leg': 150.0, 'ForeArm': 150.0}
for stem in which:
    spec = {k: (tuple(v) if isinstance(v, list) else v) for k, v in profiles[stem].items()}
    car_clips.configure(spec)
    for name, keys, n in (('enter', car_clips.enter_keys(), 108), ('exit', car_clips.exit_keys(), 138)):
        prev = {}; pops = []; bends = []; stretch = 0
        for f in range(n + 1):
            t = rig_lib.sample(keys, f)
            rig.pose_all(t)
            for pb in rig.pose:
                q = pb.rotation_quaternion.copy() if pb.parent else None
                nm = pb.name.replace('mixamorig:', '')
                if q is None or 'Hand' in nm and nm[-1:].isdigit(): continue
                if nm in prev:
                    a = math.degrees(prev[nm].rotation_difference(q).angle)
                    if a > 180: a = 360 - a
                    if a > 28: pops.append((f, nm, round(a)))
                prev[nm] = q
            # angulos de articulacion
            for side in ('Left', 'Right'):
                for up, lo, nmj in (('UpLeg', 'Leg', 'knee'), ('Arm', 'ForeArm', 'elbow')):
                    b1 = rig.pose[f'mixamorig:{side}{up}']; b2 = rig.pose[f'mixamorig:{side}{lo}']
                    d1 = (b1.tail - b1.head).normalized(); d2 = (b2.tail - b2.head).normalized()
                    ang = math.degrees(math.acos(max(-1, min(1, d1.dot(d2)))))
                    if nmj == 'knee':
                        # la rodilla solo flexiona hacia atras: signo del giro respecto del eje lateral del muslo
                        side_axis = Vector((1, 0, 0)) @ b1.matrix.to_3x3().transposed() if False else b1.x_axis
                        bend = d1.cross(d2).dot(b1.x_axis)
                        if ang > 25 and bend > 0.15: bends.append((f, side + 'Knee-hiperextendida', round(ang)))
                    if ang > 160: bends.append((f, side + nmj + ' muy cerrado', round(ang)))
        print((stem, name), 'saltos>28deg/f:', len(pops), pops[:10], '| articulaciones:', len(bends), bends[:6])
