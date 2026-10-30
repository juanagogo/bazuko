import bpy, sys, json, math
from mathutils import Vector
S = r"C:\Users\raull\AppData\Local\Temp\claude\C--Users-raull-Documentos-Proyectos-bazuko\c1ddfc87-171b-4219-8267-ee9f6fcb8e2a\scratchpad\\"
import os; S = os.path.dirname(os.path.abspath(__file__)) + os.sep
sys.path.insert(0, S[:-1])
import rig_lib, car_clips
SRC = S + "animaciones-cpp.original.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o.type == 'MESH': bpy.data.objects.remove(o)
arm.animation_data_clear()
rig = rig_lib.Rig(arm)
profiles = json.load(open(S + 'profiles.json')); profiles['ref'] = {}
which = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else list(profiles)
def seg_dist(p, a, b):
    ab = b - a; t = max(0, min(1, (p - a).dot(ab) / max(1e-9, ab.dot(ab)))); return (p - (a + ab * t)).length
total = {}
for stem in which:
    spec = {k: (tuple(v) if isinstance(v, list) else v) for k, v in profiles[stem].items()}
    car_clips.configure(spec)
    for name, keys, angle in (('enter', car_clips.enter_keys(), car_clips.door_angle_enter), ('exit', car_clips.exit_keys(), car_clips.door_angle_exit)):
        worst = (9.0, None); bad = []; prev = None; vmax = 0.0
        for f in range(0, 139 if name == 'exit' else 109):
            rig.pose_all(rig_lib.sample(keys, f))
            hp = rig.pose['mixamorig:Hips'].head.copy()
            if prev is not None:
                sp = math.hypot(hp.x - prev.x, hp.y - prev.y) * 24
                vmax = max(vmax, sp)
                if sp > 1.8 and stem == 'ref': print('RAPIDO', name, f, round(sp, 2))
            prev = hp
            th = math.radians(angle(f))
            A = Vector(car_clips.HINGE); B = A + Vector((-math.cos(th), math.sin(th))) * car_clips.DOOR_LEN
            for pb in rig.pose:
                n = pb.name.replace('mixamorig:', '')
                if 'Finger' in n or (n[-1:].isdigit() and 'Hand' in n and 'Thumb' not in n and False): pass
                h, t = pb.head.copy(), pb.tail.copy()
                rr = 0.17 if n in ('Hips','Spine','Spine1','Spine2') else 0.09 if 'Leg' in n or 'Foot' in n or 'Toe' in n else 0.07
                for pt, rad in ((h, rr), ((h + t) / 2, rr), (t, rr)):
                    if not (0.30 <= pt.z <= 1.30): continue
                    # solo huesos que no son de la mano que sujeta la puerta (la mano toca la manija)
                    if 'Hand' in n and n[-1:].isdigit(): continue
                    if n.endswith('Hand') or n.endswith('ForeArm'):
                        pass
                    d = seg_dist(Vector((pt.x, pt.y)), Vector((A.x, A.y)), Vector((B.x, B.y))) - rad
                    if d < worst[0]: worst = (d, (f, n, round(pt.x, 2), round(pt.y, 2), round(pt.z, 2)))
                    if d < 0 and not n.endswith(('Hand', 'ForeArm')): bad.append((f, n))
        total[(stem, name)] = (round(worst[0], 3), worst[1], len(bad), bad[:4], 'v_max_cadera m/s', round(vmax, 2))
for k, v in total.items(): print(k, v)
