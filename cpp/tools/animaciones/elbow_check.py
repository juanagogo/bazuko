import bpy, sys, json, math, os
from mathutils import Vector
S = os.path.dirname(os.path.abspath(__file__)) + os.sep
sys.path.insert(0, S[:-1])
import rig_lib, car_clips
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=S + "animaciones-cpp.original.glb")
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o.type == 'MESH': bpy.data.objects.remove(o)
arm.animation_data_clear(); rig = rig_lib.Rig(arm)
profiles = json.load(open(S + 'profiles.json')); profiles['ref'] = {}
def elbow(side):
    a = rig.pose[f'mixamorig:{side}Arm']; f = rig.pose[f'mixamorig:{side}ForeArm']
    d1 = (a.tail - a.head).normalized(); d2 = (f.tail - f.head).normalized()
    ang = math.degrees(math.acos(max(-1, min(1, d1.dot(d2)))))
    n = d1.cross(d2)
    # normal del plano del codo: debe apuntar "hacia abajo/atras" segun el lado; se compara con la del reposo de la pose neutral
    return ang, n
for stem in sys.argv[sys.argv.index('--') + 1:]:
    car_clips.configure({k: (tuple(v) if isinstance(v, list) else v) for k, v in profiles[stem].items()})
    rig.pose_all(car_clips.seated())
    ref = {s_: elbow(s_)[1].normalized() for s_ in ('Left', 'Right')}
    for name, keys, n in (('enter', car_clips.enter_keys(), 108), ('exit', car_clips.exit_keys(), 138)):
        res = {}
        for side in ('Left', 'Right'):
            wrong = []; maxbend = 0
            for f in range(n + 1):
                rig.pose_all(rig_lib.sample(keys, f))
                ang, nn = elbow(side)
                if ang > 15:
                    fa = rig.pose[f'mixamorig:{side}ForeArm']
                    hinge = (fa.matrix.to_3x3().inverted() @ nn).normalized()
                    rh = (rig.restR['mixamorig:' + side + 'ForeArm'].inverted() @ rig.hinge_rest[side]).normalized()
                    if hinge.dot(rh) < 0.8: wrong.append((f, round(ang), round(hinge.dot(rh), 2)))
                maxbend = max(maxbend, ang)
            res[side] = (round(maxbend), len(wrong), wrong[:6])
        print((stem, name), 'codo max flexion y fotogramas con giro al reves  izq:', res['Left'], ' der:', res['Right'])
