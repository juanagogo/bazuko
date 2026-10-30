"""Resuelve los brazos contra la malla real del cuerpo: para cada fotograma busca el giro del codo y un pequeño desplazamiento de la mano que dejan los
brazos fuera del torso, la cadera y las piernas. Las poses del rig de animaciones se pasan al esqueleto del cuerpo como hace el juego."""
import bpy, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
P = 'mixamorig:'
MARGIN = 0.012   # la ropa y la piel necesitan holgura: un brazo a menos de esto de la superficie ya cuenta como choque

class Solver:
    def __init__(self, anim, rig, rig_lib, body_path):
        self.anim, self.rig, self.rig_lib = anim, rig, rig_lib
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=body_path)
        new = [o for o in bpy.data.objects if o not in before]
        self.arm = next(o for o in new if o.type == 'ARMATURE')
        self.body = next(o for o in new if o.type == 'MESH' and o.name.startswith('personaje.body'))
        for o in new:
            if o.type == 'MESH' and o is not self.body: o.hide_viewport = True
        self.rig2 = rig_lib.Rig(self.arm)
        for pb in self.arm.pose.bones: pb.rotation_mode = 'QUATERNION'
        self.order = []
        def visit(b):
            self.order.append(b)
            for c in b.children: visit(c)
        for b in self.arm.data.bones:
            if b.parent is None: visit(b)
        self.src_rest = {n: anim.data.bones[n].matrix_local.to_3x3() for n in anim.data.bones.keys()}
        self.hips_ratio = self.arm.data.bones[P + 'Hips'].head_local.z / anim.data.bones[P + 'Hips'].head_local.z
        names = {vg.index: vg.name.replace(P, '') for vg in self.body.vertex_groups}
        def dom(v):
            if not v.groups: return 'none'
            return names.get(max(v.groups, key=lambda x: x.weight).group, 'none')
        groups = [dom(v) for v in self.body.data.vertices]
        self.arm_idx = {'L': [], 'R': []}; torso = set(); legs = set()
        for i, g in enumerate(groups):
            if g.startswith('Left') and ('ForeArm' in g or g.startswith('LeftHand')): self.arm_idx['L'].append(i)
            elif g.startswith('Right') and ('ForeArm' in g or g.startswith('RightHand')): self.arm_idx['R'].append(i)
            elif g in ('Hips', 'Spine', 'Spine1', 'Spine2'): torso.add(i)
            elif 'UpLeg' in g or g.endswith('Leg'): legs.add(i)
        polys = self.body.data.polygons
        self.f_torso = [tuple(p.vertices) for p in polys if all(v in torso for v in p.vertices)]
        self.f_legs = [tuple(p.vertices) for p in polys if all(v in legs for v in p.vertices)]
        self.f_arms = {s: set(self.arm_idx[s]) for s in ('L', 'R')}

    def retarget(self):
        rig2 = self.rig2
        for b in self.order:
            n = b.name
            if n not in self.src_rest: continue
            src = self.anim.pose.bones[n]
            delta = src.matrix.to_3x3() @ self.src_rest[n].inverted()
            want = delta @ rig2.restR[n]
            pbt = self.arm.pose.bones[n]
            if b.parent is None:
                pos = b.head_local + (src.head - self.anim.data.bones[n].head_local) * self.hips_ratio
                pbt.matrix_basis = rig2.rest[n].inverted() @ (Matrix.Translation(pos) @ want.to_4x4())
            else:
                par = b.parent.name
                Rp = self.arm.pose.bones[par].matrix.to_3x3() @ rig2.restR[par].inverted() @ rig2.restR[n]
                pbt.rotation_quaternion = (Rp.inverted() @ want).to_quaternion()
                pbt.location = (0, 0, 0)
            bpy.context.view_layer.update()

    def points(self):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.body.evaluated_get(dg); me = ev.to_mesh()
        mw = ev.matrix_world
        pts = [mw @ v.co for v in me.vertices]
        ev.to_mesh_clear()
        return pts

    def trees(self, pts):
        return BVHTree.FromPolygons(pts, self.f_torso), BVHTree.FromPolygons(pts, self.f_legs)

    def penalty(self, side, pts, trees):
        """Suma de cuanto entra (o se acerca a menos de MARGIN) cada vertice del antebrazo/mano en el torso o las piernas, en metros."""
        total = 0.0; worst = 0.0
        for i in self.arm_idx[side]:
            for tree in trees:
                loc, nor, fi, d = tree.find_nearest(pts[i], 0.30)
                if loc is None: continue
                sgn = (pts[i] - loc).dot(nor)
                if sgn < MARGIN:
                    dep = MARGIN - sgn
                    total += dep; worst = max(worst, dep)
        return total, worst

    def evaluate(self, t):
        self.rig.pose_all(t); self.retarget()
        pts = self.points()
        return pts

    def solve(self, t, thr=0.20):
        """Devuelve (phi_L, off_L, phi_R, off_R) para el fotograma `t` (diccionario de objetivos)."""
        out = {}
        pts = self.evaluate(t)
        trees = self.trees(pts)       # torso y piernas no dependen del brazo: se reutilizan
        for side, key in (('L', 'L'), ('R', 'R')):
            base_pen, base_worst = self.penalty(side, pts, trees)
            best = (base_pen, 0.0, (0.0, 0.0, 0.0))
            if base_pen > thr:
                hand = Vector(t[key + 'hand'])
                chest = self.rig.head_pos('Spine1')
                outward = Vector((hand.x - chest.x, hand.y - chest.y, 0.0))
                outward = outward.normalized() if outward.length > 1e-4 else Vector((1 if key == 'L' else -1, 0, 0))
                for push in (0.0, 0.07, 0.14):
                    for phi in (0.0, 40.0, -40.0, 80.0, -80.0):
                        if push == 0.0 and phi == 0.0: continue
                        tt = dict(t); tt[key + 'phi'] = phi; tt[key + 'off'] = tuple(outward * push)
                        p2 = self.evaluate(tt)
                        pen, _ = self.penalty(side, p2, trees)
                        score = pen + 0.002 * abs(phi) / 30.0 + 0.4 * push
                        if score < best[0] + 0.0 and pen < best[0]:
                            best = (pen, phi, tuple(outward * push))
                        if pen < thr * 0.25: break
                    else:
                        continue
                    break
            if best[0] > thr:
                # ultimo recurso: la mano suelta su objetivo y se acerca a una posicion colgante junto al costado, con distintos giros del codo
                hand = Vector(t[key + 'hand'])
                sgn = 1.0 if key == 'L' else -1.0
                root = self.rig.head_pos(('Left' if key == 'L' else 'Right') + 'Arm')
                safes = (root + self.rig.D_chest @ Vector((sgn * 0.20, -0.28, -0.38)),      # codo flexionado, mano algo al frente (nunca el brazo recto y pegado)
                         root + self.rig.D_chest @ Vector((sgn * 0.26, -0.40, -0.22)),      # codo flexionado al frente, fuera del torso y de las piernas
                         root + self.rig.D_chest @ Vector((sgn * 0.34, -0.12, -0.34)))      # abierto hacia el costado
                done = False
                for safe in safes:
                    for lam in (0.5, 0.8, 1.0):
                        for phi in (0.0, 40.0, -40.0, 80.0):
                            tt = dict(t); tt[key + 'phi'] = phi; tt[key + 'off'] = tuple((safe - hand) * lam)
                            p2 = self.evaluate(tt)
                            pen, _ = self.penalty(side, p2, trees)
                            if pen < best[0] - 1e-6: best = (pen, phi, tuple((safe - hand) * lam))
                            if pen < thr * 0.25: done = True; break
                        if done: break
                    if done: break
            out[side] = (best[1], best[2], base_pen, best[0])
            if best[1] or any(best[2]):
                t = dict(t); t[key + 'phi'] = best[1]; t[key + 'off'] = best[2]
                pts = self.evaluate(t); trees = self.trees(pts)
        return out
