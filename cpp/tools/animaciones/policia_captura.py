"""Anima a mano la captura policial y la anade al banco: PoliceGrab (el agente alcanza, agarra y reduce) y PoliceRestrained (el jugador, reducido por la espalda).
Los dos clips duran 3 s (72 cuadros a 24) para que el juego los reproduzca a la vez (Simulation::kCaptureSeconds). Los personajes miran a -Y (como en rig_lib) y el
agente queda detras del jugador, los dos mirando hacia el mismo lado: las manos del agente llegan a las muñecas del jugador, que van a su espalda. La cadera solo
sube y baja (el juego controla el avance): el alcance sale de inclinar el torso y de la IK de los brazos.

Uso: blender --background --python cpp/tools/animaciones/policia_captura.py -- --banco <banco.glb> --salida <banco_nuevo.glb> [--prueba <tiempo_s>]
Son clips «Propios» (sin material de terceros)."""
import bpy, sys, os, math, argparse
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import rig_lib

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--banco', required=True)
parser.add_argument('--salida', required=True)
args = parser.parse_args(argv)
args.banco, args.salida = os.path.abspath(args.banco), os.path.abspath(args.salida)

FPS, SECONDS = 24, 3.0
LAST = int(FPS * SECONDS)   # 72

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.banco)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
for o in list(bpy.data.objects):
    if o.type == 'MESH': bpy.data.objects.remove(o)
bank_actions = [a for a in bpy.data.actions if a.name not in ('PoliceGrab', 'PoliceRestrained')]
for a in [a for a in bpy.data.actions if a.name in ('PoliceGrab', 'PoliceRestrained')]: bpy.data.actions.remove(a)
arm.animation_data_create()
arm.animation_data.action = None
rig = rig_lib.Rig(arm)
bpy.context.scene.render.fps = FPS


def pose(**changes):
    t = rig_lib.neutral()
    t.update(changes)
    return t


def sway(base, seconds, amount):
    """Oscilacion lenta (< 0,5 Hz) para la forcejeo: sube y baja un poco, sin parpadeos."""
    return math.sin(2 * math.pi * 0.4 * seconds) * amount


# --- el jugador, reducido ------------------------------------------------------------------------------------------------------------------
def restrained(frame):
    s = frame / FPS
    keys = [
        (0, pose()),
        # sacudida al sentirse agarrado: el torso se va hacia delante y la cabeza se levanta
        (6, pose(torso=(10, 0, 0), head=(-8, 0, 0), hips_pos=(0.0, 0.0, 0.98))),
        # le llevan los brazos a la espalda y lo doblan hacia delante
        (20, pose(torso=(34, 0, 0), head=(14, 0, 0), hips_pos=(0.0, 0.0, 0.94),
                  Lhand=(0.10, 0.26, 0.86), Rhand=(-0.10, 0.26, 0.86), Lelbow=(0.6, 0.5, -0.1), Relbow=(-0.6, 0.5, -0.1),
                  Lhand_dir=(0.0, 0.5, -0.8), Rhand_dir=(0.0, 0.5, -0.8), Lgrip=0.9, Rgrip=0.9,
                  Lfoot=(0.15, 0.0, 0.08), Rfoot=(-0.15, 0.06, 0.08))),
        (40, pose(torso=(38, 6, 0), head=(18, 6, 0), hips_pos=(0.0, 0.0, 0.93),
                  Lhand=(0.10, 0.27, 0.84), Rhand=(-0.10, 0.27, 0.84), Lelbow=(0.6, 0.5, -0.1), Relbow=(-0.6, 0.5, -0.1),
                  Lhand_dir=(0.0, 0.5, -0.8), Rhand_dir=(0.0, 0.5, -0.8), Lgrip=0.9, Rgrip=0.9,
                  Lfoot=(0.16, 0.0, 0.08), Rfoot=(-0.15, 0.08, 0.08))),
        (60, pose(torso=(36, -6, 0), head=(16, -6, 0), hips_pos=(0.0, 0.0, 0.93),
                  Lhand=(0.10, 0.27, 0.84), Rhand=(-0.10, 0.27, 0.84), Lelbow=(0.6, 0.5, -0.1), Relbow=(-0.6, 0.5, -0.1),
                  Lhand_dir=(0.0, 0.5, -0.8), Rhand_dir=(0.0, 0.5, -0.8), Lgrip=0.9, Rgrip=0.9,
                  Lfoot=(0.15, 0.0, 0.08), Rfoot=(-0.16, 0.08, 0.08))),
        (LAST, pose(torso=(34, 0, 0), head=(14, 0, 0), hips_pos=(0.0, 0.0, 0.94),
                    Lhand=(0.10, 0.26, 0.86), Rhand=(-0.10, 0.26, 0.86), Lelbow=(0.6, 0.5, -0.1), Relbow=(-0.6, 0.5, -0.1),
                    Lhand_dir=(0.0, 0.5, -0.8), Rhand_dir=(0.0, 0.5, -0.8), Lgrip=0.9, Rgrip=0.9,
                    Lfoot=(0.15, 0.0, 0.08), Rfoot=(-0.15, 0.06, 0.08))),
    ]
    return rig_lib.sample(keys, frame)


# --- el agente, que alcanza y reduce ------------------------------------------------------------------------------------------------
def grab(frame):
    reach = dict(Lhand=(0.20, -0.78, 1.02), Rhand=(-0.20, -0.78, 1.02), Lelbow=(0.5, 0.6, 0.0), Relbow=(-0.5, 0.6, 0.0),
                 Lhand_dir=(0.0, -1.0, -0.4), Rhand_dir=(0.0, -1.0, -0.4), Lgrip=0.9, Rgrip=0.9)
    hold = dict(Lhand=(0.16, -0.72, 0.94), Rhand=(-0.16, -0.72, 0.94), Lelbow=(0.5, 0.6, 0.0), Relbow=(-0.5, 0.6, 0.0),
                Lhand_dir=(0.0, -1.0, -0.4), Rhand_dir=(0.0, -1.0, -0.4), Lgrip=0.9, Rgrip=0.9)
    stance = dict(Lfoot=(0.14, -0.32, 0.08), Rfoot=(-0.14, 0.18, 0.08), Lknee=(0.0, -1.0, 0.0), Rknee=(0.0, -1.0, 0.0))
    keys = [
        (0, pose()),
        (8, pose(torso=(30, 0, 0), head=(-10, 0, 0), hips_pos=(0.0, 0.0, 0.94), **reach, **stance)),
        (22, pose(torso=(34, 0, 0), head=(-12, 0, 0), hips_pos=(0.0, 0.0, 0.93), **hold, **stance)),
        (44, pose(torso=(30, 4, 0), head=(-10, 4, 0), hips_pos=(0.0, 0.0, 0.93), **hold, **stance)),
        (62, pose(torso=(33, -4, 0), head=(-11, -4, 0), hips_pos=(0.0, 0.0, 0.93), **hold, **stance)),
        (LAST, pose(torso=(34, 0, 0), head=(-12, 0, 0), hips_pos=(0.0, 0.0, 0.93), **hold, **stance)),
    ]
    return rig_lib.sample(keys, frame)


def build(name, targets):
    action = bpy.data.actions.new('__nuevo_' + name)
    arm.animation_data.action = action
    for frame in range(0, LAST + 1):
        rig.pose_all(targets(frame))
        rig.key(1 + frame)
    arm.animation_data.action = None
    action.name = name
    return action


new_clips = [build('PoliceGrab', grab), build('PoliceRestrained', restrained)]
for old_track in list(arm.animation_data.nla_tracks):
    arm.animation_data.nla_tracks.remove(old_track)
for action in bank_actions + new_clips:
    track = arm.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, int(action.frame_range[0]), action)
bpy.ops.export_scene.gltf(filepath=args.salida, export_format='GLB', export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_force_sampling=True, export_skins=True, export_apply=False)
print('POLICIA_LISTO', [c.name for c in new_clips], len(bank_actions) + len(new_clips))
