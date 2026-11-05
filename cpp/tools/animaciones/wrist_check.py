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
for stem in sys.argv[sys.argv.index('--') + 1:]:
    car_clips.configure({k: (tuple(v) if isinstance(v, list) else v) for k, v in profiles[stem].items()})
    for name, keys, n in (('enter', car_clips.enter_keys(), 108), ('exit', car_clips.exit_keys(), 138)):
        wmax = {'Left': 0.0, 'Right': 0.0}; smax = {'Left': 0.0, 'Right': 0.0}; prev = {}
        for f in range(n + 1):
            rig.pose_all(rig_lib.sample(keys, f))
            for side in ('Left', 'Right'):
                fa = rig.pose[f'mixamorig:{side}ForeArm']; hd = rig.pose[f'mixamorig:{side}Hand']
                d1 = (fa.tail - fa.head).normalized(); d2 = (hd.tail - hd.head).normalized()
                wmax[side] = max(wmax[side], math.degrees(math.acos(max(-1, min(1, d1.dot(d2))))))
                sh = rig.pose[f'mixamorig:{side}Shoulder'].rotation_quaternion
                if side in prev:
                    a = math.degrees(prev[side].rotation_difference(sh).angle); a = 360 - a if a > 180 else a
                    smax[side] = max(smax[side], a)
                prev[side] = sh.copy()
        print((stem, name), 'flexion muneca max (izq, der):', round(wmax['Left']), round(wmax['Right']), '| giro hombro max/f:', round(smax['Left']), round(smax['Right']))
