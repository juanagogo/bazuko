"""Claves de pose para subirse, conducir y bajarse de una motocicleta de referencia.
Marco de la moto: frente +X, lado izquierdo +Y, suelo Z=0. El personaje llega por el lado izquierdo mirando a -Y."""
import math
from mathutils import Matrix, Euler, Vector
from rig_lib import neutral
from car_clips import standing

SEAT = (-0.15, 0.0)          # cadera sentada (x, y)
SEAT_Z = 0.95                # altura del origen de la cadera sentado (asiento a 0.80 m)
GRIP_L = (0.52, 0.34, 1.06)
GRIP_R = (0.52, -0.34, 1.06)
PEG_L = (0.10, 0.27, 0.30)
PEG_R = (0.10, -0.27, 0.30)
KEY = (0.40, -0.02, 0.98)    # llave de encendido
M0 = (-0.10, 1.08)           # donde se para el personaje junto a la moto (entidad del juego)

def configure(spec):
    global SEAT, SEAT_Z, GRIP_L, GRIP_R, PEG_L, PEG_R, KEY, M0
    SEAT = tuple(spec.get('seat', SEAT)); SEAT_Z = spec.get('seat_z', SEAT_Z)
    GRIP_L = tuple(spec.get('grip_l', GRIP_L)); GRIP_R = tuple(spec.get('grip_r', GRIP_R))
    PEG_L = tuple(spec.get('peg_l', PEG_L)); PEG_R = tuple(spec.get('peg_r', PEG_R)); KEY = tuple(spec.get('key', KEY))
    M0 = tuple(spec.get('m0', (SEAT[0] + 0.05, SEAT[1] + 1.08)))
    return M0

def lean_targets(t, deg):
    """Inclina todo el conjunto (moto y cuerpo) `deg` grados alrededor del eje X de la moto (el piso es el eje)."""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    def rp(v): return (v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c)
    out = dict(t)
    for k in ('hips_pos', 'Lhand', 'Rhand', 'Lfoot', 'Rfoot'): out[k] = rp(t[k])
    for k in ('Lelbow', 'Relbow', 'Lknee', 'Rknee', 'Lhand_dir', 'Rhand_dir', 'Lfoot_dir', 'Rfoot_dir'): out[k] = rp(t[k])
    hips = Euler([math.radians(x) for x in t['hips_rot']], 'XYZ').to_matrix()
    R = Matrix.Rotation(a, 3, 'X') @ hips
    e = R.to_euler('XYZ')
    out['hips_rot'] = tuple(math.degrees(x) for x in e)
    return out

def riding(bob=0.0, look=0.0, steer=0.0):
    """Sentado, manos en el manubrio, pies en los posapies, tronco inclinado hacia delante. Marco de la moto."""
    t = neutral()
    hx, hy = SEAT
    t['hips_pos'] = (hx, hy, SEAT_Z + bob)
    t['hips_rot'] = (-14.0, 0, 90.0)     # pelvis inclinada hacia delante
    t['torso'] = (24.0, 0, 0)            # tronco hacia delante
    t['head'] = (-18.0, 0, look)         # mirada al frente
    for side, sgn, grip in (('L', 1.0, GRIP_L), ('R', -1.0, GRIP_R)):
        t[side + 'hand'] = (grip[0], grip[1] + sgn * 0.0 + steer * (-0.02 if sgn > 0 else 0.02), grip[2])
        t[side + 'hand_dir'] = (0.3, sgn * 0.5, -0.4)
        t[side + 'grip'] = 0.95
        t[side + 'elbow'] = (0.0, sgn * 1.0, -0.5)
    t['Lfoot'] = PEG_L; t['Rfoot'] = PEG_R
    t['Lknee'] = (0.5, 0.35, 0.6); t['Rknee'] = (0.5, -0.35, 0.6)       # rodillas flexionadas hacia delante y afuera
    t['Lfoot_dir'] = (1.0, 0.2, -0.2); t['Rfoot_dir'] = (1.0, -0.2, -0.2)
    return t

def mount_keys():
    keys = []
    keys.append((0, standing(M0)))
    # 8: se acerca; mano izquierda al manubrio, derecha al asiento
    keys.append((8, standing((M0[0] + 0.05, M0[1] - 0.10), torso=(14, 0, 0), hips_rot=(0, 0, 18),
                             Lhand=(0.40, 0.30, 1.05), Lgrip=0.9, Lhand_dir=(0.3, 0.2, -0.4), Lelbow=(0.4, 0.7, 0.2),
                             Rhand=(-0.30, -0.05, 0.92), Rgrip=0.6, Rhand_dir=(0.0, -1.0, -0.2), Relbow=(-0.4, 0.5, 0.0))))
    # 16: carga el peso en la pierna izquierda y levanta la derecha hacia atras
    keys.append((16, standing((-0.05, 0.80), hips_z=1.0, torso=(26, 0, 0), hips_rot=(0, 0, 40),
                             Lhand=(0.48, 0.32, 1.06), Lgrip=0.9, Lhand_dir=(0.3, 0.2, -0.4), Lelbow=(0.4, 0.7, 0.2),
                             Rhand=(-0.30, -0.05, 0.94), Rgrip=0.6, Rhand_dir=(0.0, -1.0, -0.2), Relbow=(-0.4, 0.5, 0.0),
                             Lfoot=(0.05, 0.62, 0.06), Lknee=(0.5, 0.2, 0.6), Lfoot_dir=(1.0, 0.1, -0.2),
                             Rfoot=(-0.55, 0.20, 0.55), Rknee=(0.0, 0.4, 1.0), Rfoot_dir=(-0.2, 1.0, -0.3))))
    # 24: la pierna derecha pasa por encima del asiento
    keys.append((24, standing((-0.10, 0.40), hips_z=1.08, torso=(30, 0, 0), hips_rot=(0, 0, 70),
                             Lhand=(0.50, 0.32, 1.06), Lgrip=0.9, Lhand_dir=(0.3, 0.2, -0.4), Lelbow=(0.4, 0.7, 0.2),
                             Rhand=(0.10, -0.05, 0.96), Rgrip=0.6, Rhand_dir=(0.3, -0.5, -0.4), Relbow=(-0.4, 0.5, 0.0),
                             Lfoot=(0.05, 0.55, 0.06), Lknee=(0.5, 0.2, 0.6), Lfoot_dir=(1.0, 0.1, -0.2),
                             Rfoot=(-0.40, -0.45, 0.95), Rknee=(0.2, 0.0, 1.0), Rfoot_dir=(-0.1, -1.0, -0.3))))
    # 32: se sienta, el pie derecho baja al posapies, el izquierdo sigue en el piso
    k = riding(); k['hips_pos'] = (SEAT[0], SEAT[1] + 0.02, SEAT_Z + 0.05); k['hips_rot'] = (-8, 0, 88); k['torso'] = (18, 0, 0)
    k['Lfoot'] = (0.10, 0.50, 0.04); k['Lfoot_dir'] = (1.0, 0.1, -0.15)
    k['Rfoot'] = (0.20, -0.36, 0.34); k['Rfoot_dir'] = (1.0, -0.2, -0.3)
    keys.append((32, k))
    # 40: ambos pies en los posapies, manos en el manubrio
    k = riding(); k['torso'] = (20, 0, 0)
    keys.append((40, k))
    keys.append((48, riding()))
    return keys

def ride_keys():
    """Ciclo de conduccion (36 fotogramas): se inclina a un lado y al otro, con vibracion leve."""
    keys = []
    frames = [(0, 0.0, 0.0, 0.0), (9, 9.0, 4.0, 0.004), (18, 0.0, 0.0, 0.0), (27, -9.0, -4.0, 0.004), (36, 0.0, 0.0, 0.0)]
    for f, lean, look, bob in frames:
        t = riding(bob, look, steer=lean / 9.0)
        t['torso'] = (24.0, -lean * 0.5, 0)            # el tronco se inclina un poco menos que la moto
        keys.append((f, lean_targets(t, lean)))
    return keys

def dismount_keys():
    keys = []
    keys.append((0, riding()))
    # 8: la moto se detiene; el pie izquierdo baja al piso
    k = riding(); k['torso'] = (12, 0, 0); k['hips_rot'] = (-8, 0, 90)
    k['Lfoot'] = (0.15, 0.52, 0.04); k['Lfoot_dir'] = (1.0, 0.1, -0.15); k['Lknee'] = (0.5, 0.4, 0.5)
    keys.append((8, k))
    # 16: apaga el encendido con la mano derecha
    k = riding(); k['torso'] = (8, 0, 0); k['hips_rot'] = (-6, 0, 90)
    k['Lfoot'] = (0.15, 0.52, 0.04); k['Lfoot_dir'] = (1.0, 0.1, -0.15); k['Lknee'] = (0.5, 0.4, 0.5)
    k['Rhand'] = KEY; k['Rhand_dir'] = (0.3, 0.6, -0.5); k['Rgrip'] = 0.7; k['Relbow'] = (0.0, -1.0, 0.3); k['Rhand_roll'] = 40.0
    keys.append((16, k))
    # 24: se levanta apoyado en la mano izquierda y el pie izquierdo; levanta la pierna derecha
    k = riding(); k['hips_pos'] = (SEAT[0] + 0.05, SEAT[1] + 0.10, 1.05); k['hips_rot'] = (-2, 0, 80); k['torso'] = (10, 0, 0)
    k['Lfoot'] = (0.10, 0.55, 0.04); k['Lfoot_dir'] = (1.0, 0.1, -0.15); k['Lknee'] = (0.5, 0.4, 0.5)
    k['Rhand'] = (-0.05, -0.05, 0.98); k['Rhand_dir'] = (0.0, -1.0, -0.3); k['Rgrip'] = 0.6
    k['Rfoot'] = (-0.30, -0.35, 0.70); k['Rfoot_dir'] = (-0.2, -1.0, -0.3); k['Rknee'] = (0.0, -0.6, 1.0)
    keys.append((24, k))
    # 34: la pierna derecha pasa por encima del asiento hacia atras
    keys.append((34, standing((-0.10, 0.45), hips_z=1.06, torso=(24, 0, 0), hips_rot=(0, 0, 60),
                             Lhand=(0.45, 0.32, 1.06), Lgrip=0.8, Lhand_dir=(0.3, 0.2, -0.4), Lelbow=(0.4, 0.7, 0.2),
                             Rhand=(-0.05, -0.05, 0.98), Rgrip=0.6, Rhand_dir=(0.0, -1.0, -0.3), Relbow=(-0.4, 0.5, 0.0),
                             Lfoot=(0.05, 0.55, 0.04), Lknee=(0.5, 0.2, 0.6), Lfoot_dir=(1.0, 0.1, -0.2),
                             Rfoot=(-0.55, -0.15, 0.85), Rknee=(0.0, 0.2, 1.0), Rfoot_dir=(-0.2, 0.8, -0.3))))
    # 44: el pie derecho baja al piso junto a la moto
    keys.append((44, standing((-0.10, 0.80), hips_z=1.0, torso=(14, 0, 0), hips_rot=(0, 0, 25),
                             Lhand=(0.40, 0.32, 1.05), Lgrip=0.6, Lhand_dir=(0.3, 0.2, -0.4), Lelbow=(0.4, 0.7, 0.2),
                             Rhand=(-0.28, 0.05, 0.9), Rgrip=0.4, Rhand_dir=(0.0, -1.0, -0.3), Relbow=(-0.4, 0.5, 0.0),
                             Lfoot=(0.05, 0.62, 0.06), Lknee=(0.5, 0.2, 0.6), Lfoot_dir=(1.0, 0.1, -0.2),
                             Rfoot=(-0.30, 0.55, 0.06), Rknee=(0.0, -0.4, 1.0), Rfoot_dir=(0.3, 0.5, -0.3))))
    # 54: suelta el manubrio y se aparta
    keys.append((54, standing((M0[0] - 0.05, M0[1] + 0.05), torso=(4, 0, 0), hips_rot=(0, 0, 6))))
    keys.append((60, standing(M0)))
    return keys
