"""Biblioteca de poses para el rig Mixamo del port: cinematica directa del torso + IK analitica de brazos y piernas.
Todo en espacio de armadura (Z arriba, el personaje mira a -Y en reposo). Una pose se describe con objetivos en el mundo."""
import bpy, math
from mathutils import Vector, Matrix, Quaternion, Euler

P = 'mixamorig:'
FINGERS = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb']

class Rig:
    def __init__(self, arm):
        self.arm = arm
        self.bones = arm.data.bones
        self.pose = arm.pose.bones
        self.rest = {b.name: b.matrix_local.copy() for b in self.bones}
        self.restR = {n: m.to_3x3() for n, m in self.rest.items()}
        self.head = {b.name: b.head_local.copy() for b in self.bones}
        self.tail = {b.name: b.tail_local.copy() for b in self.bones}
        self.dir = {n: (self.tail[n] - self.head[n]).normalized() for n in self.head}
        for pb in self.pose: pb.rotation_mode = 'QUATERNION'
        self.len = {}
        for side in ('Left', 'Right'):
            self.len[side + 'Arm'] = (self.head[P + side + 'ForeArm'] - self.head[P + side + 'Arm']).length
            self.len[side + 'ForeArm'] = (self.head[P + side + 'Hand'] - self.head[P + side + 'ForeArm']).length
            self.len[side + 'UpLeg'] = (self.head[P + side + 'Leg'] - self.head[P + side + 'UpLeg']).length
            self.len[side + 'Leg'] = (self.head[P + side + 'Foot'] - self.head[P + side + 'Leg']).length
        self.hips_rest = self.head[P + 'Hips']
        # eje de la bisagra del codo en reposo (normal del plano brazo-antebrazo): la flexion natural gira sobre el, siempre en el mismo sentido
        self.hinge_rest = {}
        for side in ('Left', 'Right'):
            n = self.dir[P + side + 'Arm'].cross(self.dir[P + side + 'ForeArm'])
            if n.length < 0.2: n = Vector((0, 0, -1 if side == 'Left' else 1))
            self.hinge_rest[side] = n.normalized()

    # --- utilidades -------------------------------------------------------------------------------------------------
    def update(self):
        bpy.context.view_layer.update()

    def world_rot(self, name):
        return self.pose[P + name].matrix.to_3x3() if not name.startswith(P) else self.pose[name].matrix.to_3x3()

    def set_rot(self, name, Rd):
        """Fija la rotacion de la armadura (3x3) del hueso `name` (sin prefijo)."""
        full = P + name
        b = self.bones[full]
        if b.parent is None:
            B = self.rest[full].inverted() @ (Matrix.Translation(self.pose[full].matrix.translation) @ Rd.to_4x4())
            self.pose[full].matrix_basis = B
        else:
            parent = b.parent.name
            Rp = self.pose[parent].matrix.to_3x3() @ self.restR[parent].inverted() @ self.restR[full]
            q = (Rp.inverted() @ Rd).to_quaternion()
            self.pose[full].rotation_quaternion = q
            self.pose[full].location = (0, 0, 0)
        self.update()

    def swing(self, name, new_dir):
        """Rotacion que lleva la direccion de reposo del hueso a `new_dir` conservando el giro de reposo."""
        full = P + name
        q = self.dir[full].rotation_difference(new_dir.normalized())
        return q.to_matrix() @ self.restR[full]

    def head_pos(self, name): return self.pose[P + name].head.copy()

    # --- IK de dos huesos -------------------------------------------------------------------------------------------
    @staticmethod
    def two_bone(root, target, a, b, pole, min_ratio=0.0):
        d = target - root
        axis = d.normalized() if d.length > 1e-6 else Vector((0, 0, -1))
        # la articulacion no se cierra mas de lo humano: el efector se aleja del cuerpo si el objetivo queda demasiado cerca
        dist = max(1e-4, min(max(d.length, min_ratio * (a + b)), (a + b) * 0.999))
        cos_a = (a * a + dist * dist - b * b) / (2 * a * dist)
        cos_a = max(-1.0, min(1.0, cos_a))
        along = a * cos_a
        height = a * math.sqrt(max(0.0, 1 - cos_a * cos_a))
        side = pole - axis * pole.dot(axis)
        side = side.normalized() if side.length > 1e-6 else axis.orthogonal().normalized()
        elbow = root + axis * along + side * height
        end = root + axis * dist
        return elbow, end


    @staticmethod
    def _robust_pole(axis, pole, fallback):
        """Pole que no se degenera: si es casi paralelo al eje del miembro se mezcla con el del cuerpo, evitando vueltas bruscas del codo/rodilla."""
        p = pole.normalized() if pole.length > 1e-6 else fallback
        par = abs(axis.dot(p))
        w = max(0.0, min(1.0, (par - 0.50) / 0.40)); w = w * w * (3 - 2 * w)
        mixed = p * (1 - w) + fallback * w
        mixed = mixed - axis * mixed.dot(axis)
        return mixed if mixed.length > 1e-5 else (fallback - axis * fallback.dot(axis))


    def _roll_aligned(self, bone, side, new_dir, new_hinge):
        """Orientacion del hueso con su eje largo hacia `new_dir` y su bisagra de reposo hacia `new_hinge`: el giro sobre su propio eje (torsion) sigue el plano
        del codo, asi el antebrazo nunca se tuerce ni se dobla al reves."""
        full = P + bone
        d0 = self.dir[full]
        n0 = self.hinge_rest[side] - d0 * self.hinge_rest[side].dot(d0)
        if n0.length < 1e-4: return self.swing(bone, new_dir)
        n0.normalize()
        d1 = new_dir.normalized()
        n1 = new_hinge - d1 * new_hinge.dot(d1)
        if n1.length < 1e-4: return self.swing(bone, new_dir)
        n1.normalize()
        F0 = Matrix((d0, n0, d0.cross(n0))).transposed()
        F1 = Matrix((d1, n1, d1.cross(n1))).transposed()
        return (F1 @ F0.inverted()) @ self.restR[full]

    # --- torso ------------------------------------------------------------------------------------------------------
    def pose_body(self, t):
        """t: dict de objetivos (ver `neutral`)."""
        hips_rot = Euler([math.radians(a) for a in t['hips_rot']], 'XYZ').to_matrix()
        self.D_hips = hips_rot
        Rh = hips_rot @ self.restR[P + 'Hips']
        Mh = Matrix.Translation(Vector(t['hips_pos'])) @ Rh.to_4x4()
        self.pose[P + 'Hips'].matrix_basis = self.rest[P + 'Hips'].inverted() @ Mh
        self.update()
        torso = Euler([math.radians(a) / 3.0 for a in t['torso']], 'XYZ').to_matrix()
        D = hips_rot
        for n in ('Spine', 'Spine1', 'Spine2'):
            D = D @ torso
            self.set_rot(n, D @ self.restR[P + n])
        self.D_chest = D
        neck = Euler([math.radians(a) / 2.0 for a in t['head']], 'XYZ').to_matrix()
        Dn = D @ neck
        self.set_rot('Neck', Dn @ self.restR[P + 'Neck'])
        Dh = Dn @ neck
        self.set_rot('Head', Dh @ self.restR[P + 'Head'])
        for side in ('Left', 'Right'):
            self.set_rot(side + 'Shoulder', D @ self.restR[P + side + 'Shoulder'])

    def pose_arm(self, side, target, pole, hand_dir, grip, hand_roll=0.0, phi=0.0, off=(0.0, 0.0, 0.0)):
        target = Vector(target) + Vector(off)
        # 1. hombro: el omoplato acompana al brazo (sube y se adelanta hacia el objetivo, hasta ~16 grados) para que el movimiento nazca en el hombro
        sh_name = P + side + 'Shoulder'
        sh_head = self.pose[sh_name].head.copy()
        d0 = (self.D_chest @ self.dir[sh_name]).normalized()
        toward = (target - sh_head)
        toward = toward.normalized() if toward.length > 1e-6 else d0
        ang = math.acos(max(-1.0, min(1.0, d0.dot(toward))))
        frac = min(0.30, math.radians(16.0) / max(ang, 1e-3))
        new_dir = d0.lerp(toward, frac).normalized()
        self.set_rot(side + 'Shoulder', d0.rotation_difference(new_dir).to_matrix() @ self.D_chest @ self.restR[sh_name])
        # 2. brazo y antebrazo por IK desde la nueva posicion del hombro
        root = self.head_pos(side + 'Arm')
        axis_ = (target - root).normalized() if (target - root).length > 1e-6 else Vector((0, 0, -1))
        lat = self.D_chest @ Vector((1.0 if side == 'Left' else -1.0, 0, 0)); back = self.D_chest @ Vector((0, 1, 0))
        pole_v = self._robust_pole(axis_, Vector(pole), (lat * 0.75 + back * 0.55 - Vector((0, 0, 0.35))).normalized())
        if phi: pole_v = Matrix.Rotation(math.radians(phi), 3, axis_) @ pole_v   # el codo gira alrededor del eje hombro-mano (busca un hueco libre)
        elbow, wrist = self.two_bone(root, target, self.len[side + 'Arm'], self.len[side + 'ForeArm'], pole_v, 0.45)
        plane_n = pole_v.normalized().cross((wrist - root).normalized())
        if plane_n.length < 1e-4: plane_n = self.hinge_rest[side]
        self.set_rot(side + 'Arm', self._roll_aligned(side + 'Arm', side, elbow - root, plane_n))
        self.set_rot(side + 'ForeArm', self._roll_aligned(side + 'ForeArm', side, wrist - elbow, plane_n))
        # 3. muneca: la mano sigue al antebrazo y solo se desvia hasta ~38 grados (flexion/extension y desviacion radial/cubital); a ese limite
        #    se mezcla con la direccion pedida, de modo que la muneca acompana el movimiento conjunto de hombro, brazo y antebrazo
        fore = (wrist - elbow).normalized()
        want = Vector(hand_dir).normalized()
        wang = math.acos(max(-1.0, min(1.0, fore.dot(want))))
        limit = math.radians(38.0)
        if wang > limit:
            want = fore.lerp(want, limit / wang).normalized()
        hand_vec = fore.lerp(want, 0.65).normalized()
        Rd = self.swing(side + 'Hand', hand_vec)
        # pronacion/supinacion: gira la mano sobre el eje del antebrazo (hasta 45 grados), proporcional al empuje o jalon
        if hand_roll:
            Rd = Matrix.Rotation(math.radians(max(-45.0, min(45.0, hand_roll))), 3, fore) @ Rd
        self.set_rot(side + 'Hand', Rd)
        Rh = self.pose[P + side + 'Hand'].matrix.to_3x3()
        D = Rh @ self.restR[P + side + 'Hand'].inverted()
        for f in FINGERS:
            curl = math.radians(grip * (50.0 if f != 'Thumb' else 30.0))
            Dc = D
            for k in (1, 2, 3):
                n = side + 'Hand' + f + str(k)
                axis_local = Vector((1, 0, 0))
                axis_world = (D @ self.restR[P + n]) @ axis_local
                Dc = Matrix.Rotation(curl * (0.8 if k == 1 else 1.0), 3, axis_world) @ Dc
                self.set_rot(n, Dc @ self.restR[P + n])

    def pose_leg(self, side, target, pole, foot_dir, toe_dir=None):
        root = self.head_pos(side + 'UpLeg')
        axis_ = (Vector(target) - root).normalized() if (Vector(target) - root).length > 1e-6 else Vector((0, 0, -1))
        fwd = self.D_hips @ Vector((0, -1, 0)); lat = self.D_hips @ Vector((1.0 if side == 'Left' else -1.0, 0, 0))
        pole_v = self._robust_pole(axis_, Vector(pole), (fwd + lat * 0.2).normalized())
        knee, ankle = self.two_bone(root, Vector(target), self.len[side + 'UpLeg'], self.len[side + 'Leg'], pole_v, 0.42)
        self.set_rot(side + 'UpLeg', self.swing(side + 'UpLeg', knee - root))
        self.set_rot(side + 'Leg', self.swing(side + 'Leg', ankle - knee))
        self.set_rot(side + 'Foot', self.swing(side + 'Foot', Vector(foot_dir)))
        self.set_rot(side + 'ToeBase', self.swing(side + 'ToeBase', Vector(toe_dir if toe_dir is not None else foot_dir)))

    def _arm_args(self, t, key):
        return (t[key + 'hand'], t[key + 'elbow'], t[key + 'hand_dir'], t[key + 'grip'], t.get(key + 'hand_roll', 0.0), t.get(key + 'phi', 0.0), t.get(key + 'off', (0.0, 0.0, 0.0)))

    def pose_all(self, t):
        self.pose_body(t)
        # Un objetivo del lado opuesto del cuerpo haria que el brazo atravesara el torso: lo toma la otra mano y la que cede cuelga a su lado
        c = self.head_pos('Spine2'); lat = self.D_chest @ Vector((1.0, 0.0, 0.0))
        l_left = (Vector(t['Lhand']) - c).dot(lat); l_right = (Vector(t['Rhand']) - c).dot(lat)
        left_crosses = l_left < -0.07 and l_left < l_right
        right_crosses = l_right > 0.07 and l_right > l_left
        for side, key in (('Left', 'L'), ('Right', 'R')):
            sgn = 1.0 if side == 'Left' else -1.0
            other = 'R' if key == 'L' else 'L'
            crosses = left_crosses if key == 'L' else right_crosses
            other_crosses = right_crosses if key == 'L' else left_crosses
            if crosses and other_crosses:
                args = list(self._arm_args(t, other)); args[1] = (0.0, 0.0, 0.0); args[4] = -args[4]; args[5] = 0.0
            elif crosses:
                # cuelga a su lado: hombro + (afuera, un poco adelante, abajo) en el marco del pecho
                hang = self.head_pos(side + 'Arm') + self.D_chest @ Vector((sgn * 0.17, -0.26, -0.36))
                args = [tuple(hang), (0.0, 0.0, 0.0), t[key + 'hand_dir'], 0.35, 0.0, 0.0, (0.0, 0.0, 0.0)]
            elif other_crosses:
                args = list(self._arm_args(t, other)); args[1] = (0.0, 0.0, 0.0); args[4] = -args[4]; args[5] = 0.0
            else:
                args = list(self._arm_args(t, key))
            self.pose_arm(side, *args)
            self.pose_leg(side, t[key + 'foot'], t[key + 'knee'], t[key + 'foot_dir'], t.get(key + 'toe_dir'))

    def key(self, frame):
        for pb in self.pose:
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            if pb.name == P + 'Hips': pb.keyframe_insert('location', frame=frame)


def neutral():
    """Pose de pie relajada, de cara a -Y."""
    return {
        'hips_pos': (0.0, 0.0, 0.99), 'hips_rot': (0, 0, 0), 'torso': (0, 0, 0), 'head': (0, 0, 0),
        'Lhand': (0.34, -0.13, 0.88), 'Rhand': (-0.34, -0.13, 0.88),
        'Lelbow': (0.4, 0.4, 0.0), 'Relbow': (-0.4, 0.4, 0.0),
        'Lhand_dir': (0.05, -0.1, -1.0), 'Rhand_dir': (-0.05, -0.1, -1.0), 'Lgrip': 0.35, 'Rgrip': 0.35,
        'Lfoot': (0.11, 0.0, 0.08), 'Rfoot': (-0.11, 0.0, 0.08),
        'Lknee': (0.0, -1.0, 0.0), 'Rknee': (0.0, -1.0, 0.0),
        'Lfoot_dir': (0.0, -1.0, -0.25), 'Rfoot_dir': (0.0, -1.0, -0.25),
        'Lhand_roll': 0.0, 'Rhand_roll': 0.0, 'Lphi': 0.0, 'Rphi': 0.0, 'Loff': (0.0, 0.0, 0.0), 'Roff': (0.0, 0.0, 0.0),
    }


# --- interpolacion de objetivos ----------------------------------------------------------------------------------------
def _flat(t):
    out = {}
    for k, v in t.items():
        if isinstance(v, (tuple, list)):
            for i, x in enumerate(v): out[(k, i)] = float(x)
        else: out[(k, -1)] = float(v)
    return out

def _unflat(flat, like):
    t = {}
    for k, v in like.items():
        if isinstance(v, (tuple, list)): t[k] = tuple(flat[(k, i)] for i in range(len(v)))
        else: t[k] = flat[(k, -1)]
    return t

def sample(keys, frame):
    """keys: lista de (frame, dict) ordenada. Catmull-Rom (con tangentes sobre los vecinos) por componente."""
    keys = sorted(keys, key=lambda k: k[0])
    if frame <= keys[0][0]: return keys[0][1]
    if frame >= keys[-1][0]: return keys[-1][1]
    for i in range(len(keys) - 1):
        if keys[i][0] <= frame <= keys[i + 1][0]: break
    f0, a = keys[i]; f1, b = keys[i + 1]
    pa = keys[i - 1] if i > 0 else keys[i]
    nb = keys[i + 2] if i + 2 < len(keys) else keys[i + 1]
    fa, fb, fp, fn = _flat(a), _flat(b), _flat(pa[1]), _flat(nb[1])
    s = (frame - f0) / (f1 - f0)
    out = {}
    for k in fa:
        p0, p1 = fa[k], fb[k]
        m0 = (p1 - fp[k]) / max(1e-6, (f1 - pa[0])) * (f1 - f0) if i > 0 else (p1 - p0)
        m1 = (fn[k] - p0) / max(1e-6, (nb[0] - f0)) * (f1 - f0) if i + 2 < len(keys) else (p1 - p0)
        h00 = 2 * s ** 3 - 3 * s ** 2 + 1; h10 = s ** 3 - 2 * s ** 2 + s; h01 = -2 * s ** 3 + 3 * s ** 2; h11 = s ** 3 - s ** 2
        out[k] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1
    return _unflat(out, a)
