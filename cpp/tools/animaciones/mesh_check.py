"""Comprueba sobre la malla real del personaje (cuerpo de hombre adulto) si los brazos atraviesan el torso, la cadera o las piernas.
Las poses del rig de animaciones se pasan al esqueleto del cuerpo igual que hace el juego (giro mundial = delta respecto del reposo)."""
import bpy, sys, json, math, os
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
S = os.path.dirname(os.path.abspath(__file__)) + os.sep
sys.path.insert(0, S[:-1])
import rig_lib, car_clips
P = 'mixamorig:'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=S + "animaciones-cpp.original.glb")
anim = next(o for o in bpy.data.objects if o.type == 'ARMATURE'); anim.name = 'anim'
for o in list(bpy.data.objects):
    if o.type == 'MESH': bpy.data.objects.remove(o)
anim.animation_data_clear()
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath="C:/Users/raull/Documentos/Proyectos/bazuko/public/models/personaje/hombre-adulto/cuerpo.gltf")
new = [o for o in bpy.data.objects if o not in before]
body_arm = next(o for o in new if o.type == 'ARMATURE')
body = next(o for o in new if o.type == 'MESH' and o.name.startswith('personaje.body'))
for o in new:
    if o.type == 'MESH' and o is not body: o.hide_viewport = True
rig = rig_lib.Rig(anim)
rig2 = rig_lib.Rig(body_arm)
for pb in body_arm.pose.bones: pb.rotation_mode = 'QUATERNION'

order = []
def visit(b):
    order.append(b)
    for c in b.children: visit(c)
for b in body_arm.data.bones:
    if b.parent is None: visit(b)

src_rest = {n: anim.data.bones[n].matrix_local.to_3x3() for n in anim.data.bones.keys()}
hips_ratio = body_arm.data.bones[P + 'Hips'].head_local.z / anim.data.bones[P + 'Hips'].head_local.z

def retarget():
    """Copia la pose del rig de animaciones al esqueleto del cuerpo (giros mundiales relativos al reposo + altura de cadera escalada)."""
    for b in order:
        n = b.name
        if n not in src_rest: continue
        pb_src = anim.pose.bones[n]
        delta = pb_src.matrix.to_3x3() @ src_rest[n].inverted()
        want = delta @ rig2.restR[n]
        pbt = body_arm.pose.bones[n]
        if b.parent is None:
            hips_delta = pb_src.head - anim.data.bones[n].head_local
            pos = b.head_local + hips_delta * hips_ratio
            M = Matrix.Translation(pos) @ want.to_4x4()
            pbt.matrix_basis = rig2.rest[n].inverted() @ M
        else:
            par = b.parent.name
            Rp = body_arm.pose.bones[par].matrix.to_3x3() @ rig2.restR[par].inverted() @ rig2.restR[n]
            pbt.rotation_quaternion = (Rp.inverted() @ want).to_quaternion()
            pbt.location = (0, 0, 0)
        bpy.context.view_layer.update()

# clasificacion de vertices por hueso dominante
vg_names = {vg.index: vg.name.replace(P, '') for vg in body.vertex_groups}
def group_of(v):
    if not v.groups: return 'none'
    g = max(v.groups, key=lambda x: x.weight)
    return vg_names.get(g.group, 'none')
groups = [group_of(v) for v in body.data.vertices]
arm_idx = {'L': [], 'R': []}; torso_vs = set(); leg_vs = set()
for i, g in enumerate(groups):
    if g.startswith('Left') and ('ForeArm' in g or g.startswith('LeftHand')) : arm_idx['L'].append(i)
    elif g.startswith('Right') and ('ForeArm' in g or g.startswith('RightHand')): arm_idx['R'].append(i)
    elif g in ('Hips', 'Spine', 'Spine1', 'Spine2'): torso_vs.add(i)
    elif 'UpLeg' in g or g.endswith('Leg'): leg_vs.add(i)
faces_torso = [p.index for p in body.data.polygons if all(v in torso_vs for v in p.vertices)]
faces_leg = [p.index for p in body.data.polygons if all(v in leg_vs for v in p.vertices)]
print('vertices brazo L/R', len(arm_idx['L']), len(arm_idx['R']), 'caras torso', len(faces_torso), 'piernas', len(faces_leg))

def build_tree(face_ids):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg); me = ev.to_mesh()
    mw = ev.matrix_world
    verts = [mw @ v.co for v in me.vertices]
    polys = [tuple(me.polygons[i].vertices) for i in face_ids]
    normals = {tuple(me.polygons[i].vertices): (mw.to_3x3() @ me.polygons[i].normal).normalized() for i in face_ids}
    tree = BVHTree.FromPolygons(verts, polys)
    pts = verts
    ev.to_mesh_clear()
    return tree, pts

def depth_for(tree, pts, idxs):
    worst = 0.0; cnt = 0
    for i in idxs:
        loc, nor, fi, d = tree.find_nearest(pts[i], 0.35)
        if loc is None: continue
        sgn = (pts[i] - loc).dot(nor)
        if sgn < 0:
            dep = -sgn
            if dep > 0.012: cnt += 1
            worst = max(worst, dep)
    return worst, cnt

profiles = json.load(open(S + 'profiles.json')); profiles['ref'] = {}
for stem in sys.argv[sys.argv.index('--') + 1:]:
    car_clips.configure({k: (tuple(v) if isinstance(v, list) else v) for k, v in profiles[stem].items()})
    for name, keys, n in (('enter', car_clips.enter_keys(), 108), ('exit', car_clips.exit_keys(), 138)):
        bad_frames = []; worst_all = 0.0
        for f in range(0, n + 1, 3):
            rig.pose_all(rig_lib.sample(keys, f))
            retarget()
            tt, pts = build_tree(faces_torso)
            tl, _ = build_tree(faces_leg)
            for side in ('L', 'R'):
                d1, c1 = depth_for(tt, pts, arm_idx[side])
                d2, c2 = depth_for(tl, pts, arm_idx[side])
                worst_all = max(worst_all, d1, d2)
                if os.environ.get('DETAIL') and name == os.environ['DETAIL'] and max(d1, d2) > 0.03: print('DET', stem, name, f, side, 'torso', round(d1*100,1), 'piernas', round(d2*100,1))
                if c1 + c2 > 3: bad_frames.append((f, side, round(max(d1, d2) * 100, 1), c1 + c2))
        print((stem, name), 'penetracion max cm:', round(worst_all * 100, 1), '| fotogramas con brazo dentro del cuerpo:', len(bad_frames), bad_frames[:8])
