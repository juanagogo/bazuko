"""Claves de pose para entrar, conducir y salir de un automovil, parametricas por vehiculo.
Marco del carro: frente +X, lado del conductor +Y, suelo Z=0. El personaje mira a -Y y se para frente a la puerta.
`configure(spec)` fija las medidas del vehiculo (asiento, volante, pedales, puerta) y las claves se calculan a partir de ellas,
de modo que las manos y los pies caen donde esta cada pieza del modelo."""
import math
from rig_lib import neutral

# --- medidas del vehiculo (por defecto: carro de referencia) -----------------------------------------------------------
SPEC = {
    'hinge': (0.78, 0.92), 'door_len': 1.05, 'seat': (0.0, 0.42), 'hips_z': 0.66,
    'wheel': (0.40, 0.42, 0.93), 'wheel_r': 0.18, 'ped_l': (0.44, 0.59, 0.12), 'ped_r': (0.48, 0.32, 0.13),
    'handle_z': 0.96, 'roof_z': 1.40,
}
HINGE = SPEC['hinge']; DOOR_LEN = SPEC['door_len']; SEAT = SPEC['seat']; E0 = (-0.46, 1.20)

def configure(spec):
    global SPEC, HINGE, DOOR_LEN, SEAT, E0
    SPEC = dict(SPEC); SPEC.update(spec)
    HINGE = SPEC['hinge']; DOOR_LEN = SPEC['door_len']; SEAT = SPEC['seat']
    # la entidad se para detras del borde trasero de la puerta, cerca del costado
    E0 = (HINGE[0] - 0.9 * DOOR_LEN - 0.35, HINGE[1] + 0.66)
    return E0

def door_point(theta_deg, frac=0.9, z=None, off=0.03):
    th = math.radians(theta_deg)
    z = SPEC['handle_z'] if z is None else z
    return (HINGE[0] - DOOR_LEN * frac * math.cos(th), HINGE[1] + DOOR_LEN * frac * math.sin(th) + off, z)

def handle_xy(theta_deg, frac=0.9):
    th = math.radians(theta_deg)
    return (HINGE[0] - DOOR_LEN * frac * math.cos(th), HINGE[1] + DOOR_LEN * frac * math.sin(th))

def outside_xy(theta_deg, off=0.62, along=0.0):
    """Punto fuera de la puerta (del lado de su cara exterior) a `off` metros de la manija: el cuerpo no la atraviesa."""
    th = math.radians(theta_deg); hx_, hy_ = handle_xy(theta_deg)
    return (hx_ + math.sin(th) * off + math.cos(th) * along, hy_ + math.cos(th) * off - math.sin(th) * along)

def standing(hips_xy, hips_z=0.99, yaw=0.0, **kw):
    t = neutral()
    t['hips_pos'] = (hips_xy[0], hips_xy[1], hips_z)
    t['hips_rot'] = (0, 0, yaw)
    c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    def rot(x, y): return (hips_xy[0] + x * c - y * s, hips_xy[1] + x * s + y * c)
    for side, sx in (('L', 0.11), ('R', -0.11)):
        fx, fy = rot(sx, 0.0)
        t[side + 'foot'] = (fx, fy, 0.08)
        kx, ky = rot(0.0, -1.0)
        t[side + 'knee'] = (kx - hips_xy[0], ky - hips_xy[1], 0.0)
        fdx, fdy = rot(0.0, -1.0)
        t[side + 'foot_dir'] = (fdx - hips_xy[0], fdy - hips_xy[1], -0.25)
    for side, sx in (('L', 0.36), ('R', -0.36)):
        hx, hy = rot(sx, -0.04)
        t[side + 'hand'] = (hx, hy, 0.84)
        ex, ey = rot(sx * 1.5, 0.4)
        t[side + 'elbow'] = (ex - hips_xy[0], ey - hips_xy[1], 0.0)
    t.update(kw)
    return t

def seated(wheel_turn=0.0, bob=0.0, look=0.0, lean=0.0):
    """Sentado al volante, de cara a +X (marco del carro). `wheel_turn` en grados gira el volante."""
    t = neutral()
    hx, hy = SEAT
    hz = SPEC['hips_z']
    t['hips_pos'] = (hx, hy, hz + bob)
    t['hips_rot'] = (-6.0, 0, 90.0)
    t['torso'] = (-4.0, lean, 0)
    t['head'] = (4.0, 0, look)
    wc = SPEC['wheel']; wr = SPEC['wheel_r']
    for side, sgn in (('L', 1.0), ('R', -1.0)):
        a = math.radians(wheel_turn)
        gy = sgn * wr * math.cos(a)
        gz = -sgn * wr * math.sin(a) * 0.9
        t[side + 'hand'] = (wc[0] - 0.02, wc[1] + gy, wc[2] + gz)
        t[side + 'hand_dir'] = (0.6, 0.0, -0.4)
        t[side + 'grip'] = 0.85
        t[side + 'elbow'] = (0.0, sgn * 1.0, -0.6)
    pl, pr = SPEC['ped_l'], SPEC['ped_r']
    t['Lfoot'] = pl; t['Rfoot'] = pr
    t['Lknee'] = (0.3, 0.2, 1.0); t['Rknee'] = (0.3, -0.2, 1.0)
    t['Lfoot_dir'] = (1.0, 0.0, -0.35); t['Rfoot_dir'] = (1.0, 0.0, -0.45)
    return t

def to_entity(t, origin_xy):
    ox, oy = origin_xy
    out = dict(t)
    for k in ('hips_pos', 'Lhand', 'Rhand', 'Lfoot', 'Rfoot'):
        v = t[k]; out[k] = (v[0] - ox, v[1] - oy, v[2])
    return out

def car_rotate(t, origin_xy):
    """Marco del carro -> marco de la entidad que mira a -Y con el frente del carro hacia -Y (rotacion de -90 grados)."""
    ox, oy = origin_xy
    def p(v):
        x, y = v[0] - ox, v[1] - oy
        return (y, -x, v[2])
    def d(v): return (v[1], -v[0], v[2])
    out = dict(t)
    for k in ('hips_pos', 'Lhand', 'Rhand', 'Lfoot', 'Rfoot'): out[k] = p(t[k])
    for k in ('Lelbow', 'Relbow', 'Lknee', 'Rknee', 'Lhand_dir', 'Rhand_dir', 'Lfoot_dir', 'Rfoot_dir'): out[k] = d(t[k])
    hr = t['hips_rot']
    out['hips_rot'] = (hr[0], hr[1], hr[2] - 90.0)
    return out

# ----------------------------------------------------------------------------------------------------------------------
def _frame_top(zoff=0.0):
    """Punto del marco de la puerta (junto al pilar delantero) donde se apoya la mano izquierda al entrar."""
    return (HINGE[0] - 0.52, HINGE[1] - 0.04, SPEC['hips_z'] + 0.56 + zoff)

def _step(base_xy, yaw, stride, side_gap=0.11):
    """Pies de una zancada: `stride` metros de diferencia entre el pie izquierdo y el derecho en la direccion en que mira el cuerpo."""
    c, s = math.cos(math.radians(yaw)), math.sin(math.radians(yaw))
    fx, fy = s, -c
    sx_, sy_ = c, s
    out = {}
    for side, sgn, st in (('L', 1.0, stride * 0.5), ('R', -1.0, -stride * 0.5)):
        out[side + 'foot'] = (base_xy[0] + sx_ * side_gap * sgn + fx * st, base_xy[1] + sy_ * side_gap * sgn + fy * st, 0.08)
        out[side + 'foot_dir'] = (fx, fy, -0.25)
        out[side + 'knee'] = (fx, fy, 0.15 if abs(st) > 0.05 else 0.0)
    return out

def _smooth(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)

def _mix(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

def _gait(p, face, move_deg, phase, speed_gain=1.0, arm_swing=0.16):
    """Pose de caminata: `p` cadera, `face` hacia donde mira el cuerpo, `move_deg` direccion de avance (0 = -Y), `phase` en radianes (un paso por pi).
    Si el avance es hacia atras o de lado respecto del cuerpo, los pasos son mas cortos y bajos y las piernas los dan en esa direccion: hacia atras
    el pie avanza primero con el dedo, la rodilla se flexiona poco y nunca se hiperextiende."""
    c, s = math.cos(math.radians(move_deg)), math.sin(math.radians(move_deg))
    fx, fy = s, -c                     # direccion de avance
    lx, ly = c, s
    cf, sf = math.cos(math.radians(face)), math.sin(math.radians(face))
    bx, by = sf, -cf                   # hacia donde mira el cuerpo
    along = fx * bx + fy * by          # +1 camina de frente, -1 hacia atras, 0 de lado
    t = standing(p, hips_z=0.99 - 0.012 * abs(math.sin(phase)), yaw=face)
    t['hips_rot'] = (0, 0, face + 5.0 * math.sin(phase))
    backward = max(0.0, -along)        # 0..1
    side = 1.0 - abs(along)
    a = (0.27 - 0.09 * backward - 0.07 * side) * speed_gain      # zancada
    lift_max = 0.14 - 0.05 * backward - 0.02 * side
    for side_name, sgn, ph in (('L', 1.0, phase), ('R', -1.0, phase + math.pi)):
        off = a * math.sin(ph)
        lift = lift_max * max(0.0, math.cos(ph))
        t[side_name + 'foot'] = (p[0] + lx * 0.10 * sgn + fx * off, p[1] + ly * 0.10 * sgn + fy * off, 0.08 + lift)
        # rodilla: apunta hacia donde mira el cuerpo; flexiona menos al ir hacia atras
        t[side_name + 'knee'] = (bx, by, 0.15 + (0.45 - 0.25 * backward) * (lift / max(lift_max, 1e-4)))
        t[side_name + 'foot_dir'] = (bx, by, -0.25 - lift * (1.0 - 0.5 * backward))
    t['torso'] = (4 - 3 * backward, 0, -6.0 * math.sin(phase))
    t['head'] = (0, 0, 0)
    for side_name, sgn, ph in (('L', 1.0, phase + math.pi), ('R', -1.0, phase)):
        sw = arm_swing * (1.0 - 0.4 * backward) * math.sin(ph)
        t[side_name + 'hand'] = (p[0] + lx * 0.37 * sgn + fx * sw, p[1] + ly * 0.37 * sgn + fy * sw, 0.92)
        t[side_name + 'grip'] = 0.35
    return t

def _walk(keys, f0, f1, p0, p1, face0, face1, move_deg=None, extra=None, step_every=2, steps_per_m=1.7, phase0=0.0, gain=1.0):
    """Claves densas de una caminata entre dos puntos. La direccion del avance sale de p0 -> p1 (se puede dar a mano); hacia atras usa pasos mas cortos."""
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    dist = math.hypot(dx, dy)
    if move_deg is None: move_deg = math.degrees(math.atan2(dx, -dy)) if dist > 1e-6 else face0
    f = f0
    while f <= f1:
        t = (f - f0) / max(1, (f1 - f0)); e = _smooth(t)
        p = _mix(p0, p1, e)
        face = face0 + (face1 - face0) * e
        k = _gait(p, face, move_deg, phase0 + math.pi * steps_per_m * dist * e, gain)
        if extra: k = extra(k, t)
        keys.append((f, k))
        f += step_every

def _inner_handle(theta_deg, drop=0.16):
    """Manija interior: cerca de la bisagra, por dentro de la puerta y a la altura de la cadera (el codo la alcanza sin plegarse)."""
    th = math.radians(theta_deg)
    return (HINGE[0] - DOOR_LEN * 0.45 * math.cos(th), HINGE[1] + DOOR_LEN * 0.45 * math.sin(th) - 0.12 * math.cos(th), SPEC['hips_z'] + drop)

def _tip():
    th = math.radians(OPEN)
    return (HINGE[0] - DOOR_LEN * math.cos(th), HINGE[1] + DOOR_LEN * math.sin(th))

def _safe_rear(dist=0.70):
    """Donde espera quien no quiere ser tocado por el borde de la puerta al cerrarse: detras de su arco completo."""
    return (HINGE[0] - DOOR_LEN - dist, HINGE[1] + 0.75)

def exit_keys():
    """Salir (120 fotogramas = 5 s): abre, saca una pierna y luego la otra (con elevacion del pie), se levanta apoyandose, camina al costado
    para salir del recorrido de la puerta, gira con las piernas para verla, tira del borde un instante y retrocede mientras se cierra sola,
    se gira hacia la calle y echa a andar. Velocidades humanas: nunca mas de ~1,6 m/s."""
    hx, hy = HINGE; sx, sy = SEAT
    hz = SPEC['hips_z']; pl, pr = SPEC['ped_l'], SPEC['ped_r']
    hz_in = SPEC['handle_z'] - 0.10
    keys = [(0, seated())]
    # 1. mano a la manija interior (gira torso y cabeza), empuja la puerta
    k = seated(); k['torso'] = (-2, 24.0, 8.0); k['head'] = (2, 0, 20)
    k['Lhand_roll'] = -25.0; k['Lhand'] = _inner_handle(0); k['Lhand_dir'] = (0.3, 1.0, -0.2); k['Lgrip'] = 0.9; k['Lelbow'] = (0.3, -0.4, -0.8)
    keys.append((6, k))
    k = seated(); k['torso'] = (4, 30.0, 14.0); k['head'] = (0, 0, 24)
    k['Lhand_roll'] = -25.0; k['Lhand'] = _inner_handle(40, 0.20); k['Lhand_dir'] = (0.3, 1.0, -0.1); k['Lgrip'] = 0.8; k['Lelbow'] = (0.3, -0.2, -0.7)
    k['Rhand'] = (sx + 0.10, sy - 0.30, hz - 0.02); k['Rhand_dir'] = (0.3, 0.0, -0.4); k['Rgrip'] = 0.5; k['Relbow'] = (0.0, -1.0, -0.4)
    keys.append((13, k))
    # 2. gira la cadera hacia la puerta y saca la pierna izquierda: el pie sube, pasa el umbral y baja al suelo
    base = dict(seated())
    gx, gy = sx + 0.10, hy + 0.16                                 # donde pisa fuera
    for f, t, hipy, rot, lean in ((18, 0.15, 0.06, 78, 10), (22, 0.5, 0.12, 70, 16), (26, 0.85, 0.16, 62, 20), (29, 1.0, 0.17, 58, 22)):
        k = seated()
        e = _smooth(t)
        k.update(hips_pos=(sx + 0.02, sy + hipy, hz + 0.02), hips_rot=(-2, 0, rot), torso=(lean, 14, 8), head=(-4, 0, 14),
                 Lhand=_frame_top(-0.10), Lgrip=0.8, Lhand_dir=(0.0, -1.0, -0.2), Lelbow=(0.2, 0.8, 0.2),
                 Rhand=(sx + 0.08, sy + hipy - 0.30, hz - 0.02), Rgrip=0.6, Rhand_dir=(0.3, 0.0, -0.8), Relbow=(0.0, -1.0, -0.3),
                 Lfoot=(pl[0] + (gx - pl[0]) * e, pl[1] + (gy - pl[1]) * e, pl[2] + (0.08 - pl[2]) * e + 0.34 * math.sin(math.pi * t)),
                 Lknee=(0.4, 0.4 + 0.3 * e, 1.0), Lfoot_dir=(0.7, 0.6, -0.3 - 0.4 * math.sin(math.pi * t)),
                 Rfoot=(pr[0] - 0.04, pr[1] + 0.22, pr[2] + 0.06), Rknee=(0.3, 0.2, 1.0), Rfoot_dir=(1.0, 0.2, -0.3))
        keys.append((f, k))
    # 3. saca la pierna derecha: el pie izquierdo carga el peso, el derecho sube y baja afuera
    gx2, gy2 = sx - 0.12, hy + 0.26
    for f, t, hipy in ((34, 0.2, 0.20), (38, 0.55, 0.24), (42, 0.9, 0.28), (45, 1.0, 0.30)):
        k = seated()
        e = _smooth(t)
        k.update(hips_pos=(sx - 0.02 * t, sy + hipy, hz + 0.04 + 0.10 * e), hips_rot=(0, 0, 58 - 6 * e), torso=(22 + 8 * e, 10, 6), head=(-6, 0, 12),
                 Lhand=_frame_top(-0.06), Lgrip=0.8, Lhand_dir=(0.0, -1.0, -0.2), Lelbow=(0.2, 0.8, 0.3),
                 Rhand=(sx + 0.05, sy + hipy - 0.30, hz - 0.02 + 0.20 * e), Rgrip=0.7, Rhand_dir=(0.3, 0.0, -0.8), Relbow=(0.0, -1.0, -0.3),
                 Lfoot=(gx, gy, 0.08), Lknee=(0.5, 0.5, 1.0), Lfoot_dir=(0.8, 0.5, -0.3),
                 Rfoot=(pr[0] + (gx2 - pr[0]) * e, pr[1] + (gy2 - pr[1]) * e, pr[2] + (0.08 - pr[2]) * e + 0.30 * math.sin(math.pi * t)),
                 Rknee=(0.2, 0.3 + 0.3 * e, 1.0), Rfoot_dir=(0.6, 0.6, -0.3 - 0.4 * math.sin(math.pi * t)))
        keys.append((f, k))
    # 4. se levanta: empuja con la mano sobre el marco, la cadera sube, el torso pasa de inclinado a erguido
    pst = (sx - 0.12, hy + 0.30)
    for f, t in ((52, 0.2), (60, 0.55), (68, 1.0)):
        e = _smooth(t)
        k = standing(_mix((sx + 0.02, sy + 0.30), pst, e), hips_z=hz + 0.14 + (0.99 - hz - 0.14) * e, yaw=96 - 20 * e)
        free = k['Lhand']; frame = _frame_top(0.0); w = _smooth(min(1.0, t / 0.55))
        k['Lhand'] = tuple(frame[i] + (free[i] - frame[i]) * w for i in range(3))
        k.update(hips_rot=(0, 0, 52 + 20 * e), torso=(34 - 24 * e, 6 - 6 * e, 8), head=(-8 + 8 * e, 0, 12),
                 Lgrip=0.6, Lhand_dir=(0.0, -1.0, -0.2), Lelbow=(0.2, 0.8, 0.3),
                 Rhand=(_mix((sx + 0.02, sy + 0.30), pst, e)[0] + 0.05, _mix((sx + 0.02, sy + 0.30), pst, e)[1] - 0.30, 0.58 + 0.30 * e), Rgrip=0.5, Rhand_dir=(0.0, 0.0, -1.0), Relbow=(0.0, -1.0, -0.3),
                 Lfoot=(gx, gy, 0.08), Lknee=(0.5, 0.4, 1.0 - 0.9 * e), Lfoot_dir=(0.8, 0.5, -0.3),
                 Rfoot=(gx2, gy2, 0.08), Rknee=(0.3, 0.3, 1.0 - 0.9 * e), Rfoot_dir=(0.6, 0.6, -0.3))
        keys.append((f, k))
    # 5. camina hacia atras, al costado, hasta quedar fuera del arco de la puerta (mirando la puerta)
    rear = _safe_rear()
    _walk(keys, 72, 94, pst, rear, 76, 112, None, step_every=2, steps_per_m=2.0,
          extra=lambda k, t: {**k, 'head': (0, 0, 20 * _smooth(t)), 'torso': (6, 8 * _smooth(t), -4 + 12 * _smooth(t))})
    # 6. se acerca un paso con el cuerpo girado de lado, toma el borde de la puerta y tira de ella un instante
    near = (HINGE[0] - DOOR_LEN * math.cos(math.radians(OPEN)) - 0.80, HINGE[1] + DOOR_LEN * math.sin(math.radians(OPEN)) - 0.05)
    ed = _edge(OPEN)
    k = _gait(rear, 112, 112, 0.0, 0.0); k.update(torso=(8, 10, 14), head=(0, 0, 22))
    k.update(Rhand=(rear[0] + 0.30, rear[1] - 0.10, 1.05), Rgrip=0.3, Rhand_dir=(0.4, -0.3, -0.5), Relbow=(0.0, -0.4, -0.8))
    keys.append((94, k))
    k = standing(near, yaw=112)
    k.update(hips_rot=(0, 0, 112), torso=(10, 14, 14), head=(0, 0, 22), Rhand_roll=-25.0, Rhand=ed, Rgrip=0.7, Rhand_dir=(0.4, -0.3, -0.5), Relbow=(0.0, -0.4, -0.8),
             Lhand=(near[0] - 0.1, near[1] + 0.2, 0.9), Lgrip=0.3, Lhand_dir=(0.0, -1.0, -0.3), Lelbow=(0.5, 0.6, 0.0))
    k.update(_step(near, 112, 0.30))
    keys.append((104, k))
    # tira (cadera y hombro) y suelta: la puerta sigue cerrandose sola
    th = 50.0
    ed2 = _edge(th)
    k = standing((near[0] - 0.08, near[1] + 0.02), hips_z=0.97, yaw=118)
    k.update(hips_rot=(0, 0, 118), torso=(14, 12, 16), head=(2, 0, 24), Rhand_roll=-25.0, Rhand=ed2, Rgrip=0.6, Rhand_dir=(0.4, -0.3, -0.5), Relbow=(0.0, -0.4, -0.8),
             Lhand=(near[0] - 0.2, near[1] + 0.2, 0.9), Lgrip=0.3, Lhand_dir=(0.0, -1.0, -0.3), Lelbow=(0.5, 0.6, 0.0))
    k.update(_step((near[0] - 0.08, near[1] + 0.02), 118, 0.18))
    keys.append((109, k))
    # 7. retrocede de inmediato (recule del brazo) mientras la puerta se cierra
    _walk(keys, 112, 124, (near[0] - 0.15, near[1] + 0.05), (rear[0] - 0.05, rear[1] + 0.10), 120, 140, None, step_every=2, steps_per_m=2.0,
          extra=lambda k, t: {**k, 'Rhand': (k['Rhand'][0] - 0.1, k['Rhand'][1] + 0.2, 1.0), 'torso': (2, 4, 8 - 8 * t), 'head': (0, 0, 16 - 12 * t)})
    # 8. se gira con las piernas y el tronco hacia la calle y echa a andar
    p = (rear[0] - 0.05, rear[1] + 0.10)
    e0 = E0
    _walk(keys, 126, 138, p, e0, 140, 178, None, step_every=2, steps_per_m=1.4,
          extra=lambda k, t: {**k, 'head': (0, 0, 10 * (1 - t)), 'torso': (2, 0, -4 * t)})
    return keys

def enter_keys():
    """Entrar (96 fotogramas = 4 s): se acerca caminando, jala la puerta retrocediendo con ella, se aparta, vuelve por el hueco, se gira de
    espaldas al vehiculo, levanta una pierna y luego la otra sobre el umbral, se sienta, gira las piernas hacia adentro y cierra."""
    hx, hy = HINGE; sx, sy = SEAT
    hz = SPEC['hips_z']; pl, pr = SPEC['ped_l'], SPEC['ped_r']
    hz_in = SPEC['handle_z'] - 0.10
    top = _frame_top()
    tip = _tip()
    keys = []
    # 1. se acerca a la puerta (E0 -> junto a la manija), mirando de lado
    near0 = outside_xy(0, 0.62, -0.02)
    _walk(keys, 0, 10, E0, near0, 170, 30, None, step_every=2, steps_per_m=1.6,
          extra=lambda k, t: {**k, 'head': (0, 0, 14 * t), 'Lhand': (k['Lhand'][0], k['Lhand'][1], 0.84 + 0.18 * t) if t > 0.8 else k['Lhand']})
    # 2. toma la manija y retrocede jalando la puerta, que sigue abriendose; la suelta a 28 grados
    for f, th, back in ((14, 8.0, 0.0), (18, 18.0, 0.12), (22, 28.0, 0.24)):
        p = outside_xy(th, 0.62, -0.02 - back)
        k = standing(p, yaw=24)
        k.update(hips_rot=(0, 0, 24 - 14 * back / 0.24), torso=(10 + 4 * back / 0.24, 6, 8 + 6 * back / 0.24), head=(0, 0, 16), Lhand_roll=25.0, Lhand=door_point(th), Lgrip=0.9,
                 Lhand_dir=(0.3, -1.0, -0.2), Lelbow=(0.3, 0.4, -0.8))
        k.update(_step(p, 24, 0.30 * (1 - back / 0.3)))
        keys.append((f, k))
    # 3. se aparta caminando hacia atras por fuera del recorrido de la puerta
    q = (tip[0] - 0.75, tip[1] + 0.30)
    p0 = outside_xy(28, 0.62, -0.26)
    _walk(keys, 26, 40, p0, q, 24, 70, None, step_every=2, steps_per_m=2.0,
          extra=lambda k, t: {**k, 'Lhand': (k['Lhand'][0], k['Lhand'][1], 0.84 + 0.1 * (1 - t))})
    # 4. rodea la punta por detras y entra caminando por el hueco hasta la altura del asiento
    r = (tip[0] - 0.75, tip[1] - 0.55)
    gp = (sx + 0.02, hy + 0.36)
    _walk(keys, 40, 58, q, r, 70, 100, None, step_every=2, steps_per_m=1.8)
    _walk(keys, 58, 70, r, gp, 100, 175, None, step_every=2, steps_per_m=1.6,
          extra=lambda k, t: {**k, 'Lhand': (top[0], top[1], top[2]) if t > 0.7 else k['Lhand'], 'Lgrip': 0.8 if t > 0.7 else 0.3})
    # 5. de espaldas al vehiculo: baja la cadera, se sienta en el borde, sube la pierna sobre el umbral y la desliza al espacio de los pies
    for f, t in ((74, 0.2), (78, 0.45), (82, 0.7), (86, 1.0)):
        e = _smooth(t)
        k = seated()
        k.update(hips_pos=(sx + 0.02, hy + 0.36 + (sy + 0.28 - hy - 0.36) * e, 0.95 + (hz + 0.18 - 0.95) * e), hips_rot=(-2 * e, 0, 175 - 25 * e),
                 torso=(8 + 16 * e, -8, 0), head=(-6 * e, 0, -8 + 4 * e),
                 Lhand=top, Lgrip=0.8, Lhand_dir=(0.0, -1.0, -0.2), Lelbow=(0.2, 0.8, 0.3),
                 Rhand=(sx + 0.08, sy + 0.14 + 0.10 * (1 - e), hz + 0.34 * e + 0.5 * (1 - e)), Rgrip=0.7, Rhand_dir=(0.3, -1.0, -0.3), Relbow=(-0.6, 0.6, 0.0),
                 Rfoot=(pl[0] - 0.22 - 0.28 * (1 - e), hy - 0.22 + 0.34 * (1 - e), pl[2] + 0.34 * math.sin(math.pi * min(1, t * 1.3)) + 0.08 * (1 - e)),
                 Rknee=(0.3, 0.1, 1.0), Rfoot_dir=(1.0, -0.2, -0.3),
                 Lfoot=(sx + 0.02, hy + 0.30, 0.08), Lknee=(0.1, 0.6, 1.0), Lfoot_dir=(0.2, 0.9, -0.3))
        keys.append((f, k))
    # 6. sentado: sube la otra pierna y gira la cadera y las piernas hacia adentro
    for f, t in ((92, 0.5), (96, 1.0)):
        e = _smooth(t)
        k = seated()
        k.update(hips_pos=(sx + 0.02, sy + 0.10, hz + 0.08 - 0.06 * e), hips_rot=(-5, 0, 150 - 38 * e - 22 * e), torso=(24 - 10 * e, 6, 0), head=(-4, 0, 6),
                 Lhand=_frame_top(-0.06), Lgrip=0.8, Lhand_dir=(0.0, -1.0, -0.2), Lelbow=(0.2, 0.8, 0.3),
                 Rhand=(sx + 0.10, sy - 0.02, hz + 0.34), Rgrip=0.7, Rhand_dir=(0.3, -1.0, -0.3), Relbow=(-0.6, 0.6, 0.0),
                 Rfoot=(pr[0] + 0.05, pr[1] + 0.25 * (1 - e), pr[2] + 0.12 * (1 - e)), Rfoot_dir=(1.0, 0.0, -0.3),
                 Lfoot=(sx + 0.02 + (pl[0] - 0.06 - sx - 0.02) * e, hy + 0.30 + (hy - 0.12 - hy - 0.30) * e, 0.08 + (pl[2] + 0.10 - 0.08) * e + 0.28 * math.sin(math.pi * t)),
                 Lknee=(0.4, 0.4, 1.0), Lfoot_dir=(0.8, 0.4, -0.3))
        keys.append((f, k))
    # 7. se acomoda, alcanza la manija interior y cierra
    k = seated(); k['torso'] = (-2, 22.0, 8.0); k['head'] = (2, 0, 20)
    k['Lhand_roll'] = -25.0; k['Lhand'] = _inner_handle(30); k['Lhand_dir'] = (0.3, 1.0, -0.2); k['Lgrip'] = 0.9; k['Lelbow'] = (0.3, -0.4, -0.8)
    keys.append((100, k))
    k = seated(); k['torso'] = (0, 12.0, 6.0); k['head'] = (2, 0, 12)
    k['Lhand_roll'] = -25.0; k['Lhand'] = _inner_handle(8); k['Lhand_dir'] = (0.3, 1.0, -0.2); k['Lgrip'] = 0.9; k['Lelbow'] = (0.0, -0.3, -0.8)
    keys.append((105, k))
    k = seated(); k['torso'] = (-4, 0, 0); k['head'] = (4, 0, 0)
    keys.append((108, k))
    return keys

def swap_keys():
    """Acompanante -> asiento del conductor (60 fotogramas): se inclina apoyandose en la consola y el respaldo, levanta la cadera y las piernas por
    encima de la consola, se desliza sobre el asiento del conductor y se sienta. Marco del carro; arranca sentado en el asiento del acompanante."""
    sx, sy = SEAT; hz = SPEC['hips_z']; pl, pr = SPEC['ped_l'], SPEC['ped_r']
    wc = SPEC['wheel']
    keys = []
    def at(y, z, rot=90.0, torso=(-4, 0, 0)):
        k = seated(); k.update(hips_pos=(sx, y, z), hips_rot=(-6, 0, rot), torso=torso)
        return k
    k = at(-sy, hz); k.update(Lhand=(sx + 0.25, -sy + 0.20, hz + 0.34), Rhand=(sx + 0.25, -sy - 0.20, hz + 0.34), Lgrip=0.4, Rgrip=0.4,
                              Lfoot=(pl[0], -pl[1], pl[2]), Rfoot=(pr[0], -pr[1], pr[2]), Lelbow=(0.3, 0.8, -0.8), Relbow=(0.3, -0.8, -0.8))
    keys.append((0, k))
    k = at(-sy + 0.06, hz + 0.05, torso=(24, 10, 4)); k.update(head=(-6, 0, 24), Lhand=(sx + 0.10, -0.02, hz + 0.26), Lgrip=0.8, Lhand_dir=(0.2, 0.0, -1.0),
                              Rhand=(sx - 0.22, -sy - 0.12, hz + 0.55), Rgrip=0.7, Rhand_dir=(0.0, 1.0, 0.0),
                              Lfoot=(pl[0] - 0.10, -pl[1] + 0.05, pl[2] + 0.06), Rfoot=(pr[0] - 0.10, -pr[1], pr[2] + 0.04), Lelbow=(0.3, 0.5, -0.8), Relbow=(-0.2, -0.8, -0.4))
    keys.append((12, k))
    k = at(-0.02, hz + 0.28, rot=84, torso=(30, 8, 0)); k.update(head=(-8, 0, 20), Lhand=(sx + 0.10, 0.06, hz + 0.28), Lgrip=0.8, Lhand_dir=(0.2, 0.0, -1.0),
                              Rhand=(sx + 0.02, 0.18, hz + 0.50), Rgrip=0.7, Rhand_dir=(0.0, 1.0, 0.0),
                              Lfoot=(pl[0] - 0.05, sy * 0.55, pl[2] + 0.28), Rfoot=(pr[0] - 0.05, -0.15, pr[2] + 0.36), Lknee=(0.5, 0.3, 1.0), Rknee=(0.5, -0.1, 1.0))
    keys.append((26, k))
    k = at(sy - 0.06, hz + 0.20, rot=88, torso=(24, -6, 0)); k.update(head=(-4, 0, -10), Lhand=(sx + 0.10, sy + 0.24, hz + 0.34), Lgrip=0.8, Lhand_dir=(0.2, 0.0, -1.0),
                              Rhand=(wc[0] - 0.10, wc[1], wc[2]), Rgrip=0.8, Rhand_dir=(0.6, 0.0, -0.4),
                              Lfoot=(pl[0], pl[1], pl[2] + 0.08), Rfoot=(pr[0] - 0.05, pr[1] - 0.10, pr[2] + 0.22), Lknee=(0.4, 0.3, 1.0), Rknee=(0.4, -0.1, 1.0))
    keys.append((40, k))
    k = at(sy, hz + 0.05, torso=(10, 0, 0)); k.update(head=(2, 0, 0), Lfoot=pl, Rfoot=pr)
    keys.append((50, k))
    keys.append((60, seated()))
    return keys

def drive_keys():
    keys = []
    for i, (turn, look, bob, lean) in enumerate([(0, 0, 0.000, 0), (6, 6, 0.004, 1), (0, 10, 0.000, 0), (-6, 0, 0.004, -1), (0, -8, 0.000, 0)]):
        keys.append((i * 12, seated(turn, bob, look, lean)))
    keys[-1] = (48, keys[0][1])
    return keys

def _edge(theta_deg, frac=1.0, z=0.95):
    th = math.radians(theta_deg)
    return (HINGE[0] - DOOR_LEN * frac * math.cos(th), HINGE[1] + DOOR_LEN * frac * math.sin(th), z)

def _puller(theta_deg, dist=0.70, min_y=0.50):
    """Donde se para quien tira del borde de la puerta: a `dist` metros del borde, hacia atras y adentro (nunca dentro de su arco)."""
    th = math.radians(theta_deg)
    ex_, ey_, _ = _edge(theta_deg)
    x = ex_ - math.sin(th) * dist; y = ey_ - math.cos(th) * dist
    return (min(x, E0[0] + 0.15 * (1 - theta_deg / OPEN)), max(y, HINGE[1] + min_y))

OPEN = 62.0   # apertura total: el hueco entre la puerta y la carroceria deja pasar el cuerpo sin rozarla

def door_angle_enter(f):
    if f < 12: return 0.0
    if f < 22: return 28.0 * (f - 12) / 10.0         # la jala con la mano mientras retrocede
    if f < 34: return 28.0 + (OPEN - 28.0) * (f - 22) / 12.0   # la suelta y termina de abrirse sola
    if f < 92: return OPEN
    if f < 108: return OPEN * (1 - (f - 92) / 16.0)
    return 0.0

def door_angle_exit(f):
    if f < 4: return 0.0
    if f < 16: return OPEN * (f - 4) / 12.0
    if f < 104: return OPEN
    if f < 109: return OPEN - 12.0 * (f - 104) / 5.0   # tira del borde
    if f < 130: return (OPEN - 12.0) * (1 - (f - 109) / 21.0)   # se cierra sola mientras el cuerpo se aleja
    return 0.0
