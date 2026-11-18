"""Compara un clip actual con uno nuevo: GIF lado a lado (palitos, costado y frente) y, si se pide, capturas dentro del juego.

Uso (Python normal con Pillow, no dentro de Blender):
  python cpp/tools/animaciones/comparar_clips.py --actual <banco_actual.glb> --nuevo <banco_nuevo.glb> \
      --clip Walk=Walk_nuevo --salida cpp/docs/images/animaciones/lote1/caminar.gif
  --clip ACTUAL=NUEVO   nombre del clip en cada banco (se puede repetir; un GIF por clip, con el nombre del archivo de --salida como prefijo)
  --juego <bazuko.exe> --tiempos 0.3 0.8   ademas toma capturas del juego con cada banco (usa BAZUKO_PUBLIC y BAZUKO_PREVIEW_CLIP)
Mismas condiciones en las dos mitades: misma escala, misma cuadricula, el personaje centrado sobre su cadera (los clips van en el sitio).
"""
import argparse, json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw

BLENDER = os.environ.get('BLENDER', r'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe')
HERE = os.path.dirname(os.path.abspath(__file__))

parser = argparse.ArgumentParser()
parser.add_argument('--actual', required=True)
parser.add_argument('--nuevo', help='sin esto, genera solo el GIF del banco actual (los "antes" de un lote)')
parser.add_argument('--clip', action='append', required=True, help='ACTUAL=NUEVO (o solo ACTUAL cuando no hay --nuevo)')
parser.add_argument('--salida', required=True)
parser.add_argument('--juego')
parser.add_argument('--tiempos', type=float, nargs='*', default=[])
args = parser.parse_args()

def dump(banco, nombres):
    tmp = os.path.join(tempfile.gettempdir(), 'posiciones_' + os.path.basename(banco) + '.json')
    cmd = [BLENDER, '--background', '--python', os.path.join(HERE, 'posiciones_clip.py'), '--', '--banco', banco, '--salida', tmp]
    for n in nombres: cmd += ['--clip', n]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if 'POSICIONES_LISTO' not in r.stdout:
        sys.exit('Blender no pudo leer ' + banco + '\n' + r.stdout[-800:] + r.stderr[-800:])
    return json.load(open(tmp))['clips']

pairs = [tuple(c.split('=', 1)) if '=' in c else (c, c) for c in args.clip]
cur = dump(args.actual, [a for a, _ in pairs])
new = dump(args.nuevo, [b for _, b in pairs]) if args.nuevo else None

BONES = [('Hips', 'Spine'), ('Spine', 'Spine1'), ('Spine1', 'Spine2'), ('Spine2', 'Neck'), ('Neck', 'Head'),
         ('Spine2', 'LeftShoulder'), ('LeftShoulder', 'LeftArm'), ('LeftArm', 'LeftForeArm'), ('LeftForeArm', 'LeftHand'),
         ('Spine2', 'RightShoulder'), ('RightShoulder', 'RightArm'), ('RightArm', 'RightForeArm'), ('RightForeArm', 'RightHand'),
         ('Hips', 'LeftUpLeg'), ('LeftUpLeg', 'LeftLeg'), ('LeftLeg', 'LeftFoot'), ('LeftFoot', 'LeftToeBase'),
         ('Hips', 'RightUpLeg'), ('RightUpLeg', 'RightLeg'), ('RightLeg', 'RightFoot'), ('RightFoot', 'RightToeBase')]
M = 'mixamorig:'

def draw_panel(d, ox, oy, W, H, clip, f, view, title):
    d.rectangle([ox, oy, ox + W - 1, oy + H - 1], outline=(70, 62, 48))
    d.line([(ox + 10, oy + H - 40), (ox + W - 10, oy + H - 40)], fill=(90, 80, 60), width=2)
    h = clip['huesos']
    hx = 1 if view == 'costado' else 0          # costado: horizontal = Y; frente: horizontal = X
    cx = h[M + 'Hips'][f][hx]                   # centrado sobre la cadera
    pt = lambda n: (ox + W / 2 + (h[M + n][f][hx] - cx) * 170, oy + H - 40 - h[M + n][f][2] * 170)
    for a, b in BONES:
        col = (255, 209, 102) if 'Left' in b else (120, 200, 255) if 'Right' in b else (236, 230, 215)
        d.line([pt(a), pt(b)], fill=col, width=5)
    d.text((ox + 8, oy + 6), f'{title} - {view}', fill=(236, 230, 215))

os.makedirs(os.path.dirname(os.path.abspath(args.salida)), exist_ok=True)
base, ext = os.path.splitext(args.salida)
for a_name, b_name in pairs:
    A, B = cur[a_name], (new[b_name] if new else None)
    if A is None or (new and B is None):
        print('falta el clip', a_name if A is None else b_name); continue
    n = max(A['frames'], B['frames'], 48) if B else A['frames']   # al menos 2 s para que se aprecie el ritmo relativo
    W, H = 300, 380
    frames = []
    for f in range(n):
        im = Image.new('RGB', ((4 if B else 2) * W, H + 24), (28, 24, 18)); d = ImageDraw.Draw(im)
        fa = f % A['frames']   # cada mitad se repite a su propio ritmo: asi se ve si uno es mas rapido o mas lento que el otro
        draw_panel(d, 0, 0, W, H, A, fa, 'costado', 'ACTUAL: ' + a_name); draw_panel(d, W, 0, W, H, A, fa, 'frente', 'ACTUAL: ' + a_name)
        if B:
            fb = f % B['frames']
            draw_panel(d, 2 * W, 0, W, H, B, fb, 'costado', 'NUEVO: ' + b_name); draw_panel(d, 3 * W, 0, W, H, B, fb, 'frente', 'NUEVO: ' + b_name)
        d.text((8, H + 6), f'{(f + 1) / 24:.2f} s  |  actual: {A["frames"]} cuadros = {A["frames"] / 24:.2f} s' + (f'  |  nuevo: {B["frames"]} cuadros = {B["frames"] / 24:.2f} s' if B else ''), fill=(236, 230, 215))
        frames.append(im)
    out = args.salida if len(pairs) == 1 else (f'{base}_{a_name}_vs_{b_name}{ext or ".gif"}' if new else f'{base}_{a_name}{ext or ".gif"}')
    frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(1000 / 24), loop=0)
    print('GIF', out, n, 'cuadros')

if args.juego and args.tiempos:
    for etiqueta, banco, nombre_idx in (('actual', args.actual, 0),) + ((('nuevo', args.nuevo, 1),) if args.nuevo else ()):
        carpeta = os.path.dirname(os.path.abspath(banco))
        public = os.path.dirname(carpeta)     # <public>/models/<banco.glb>
        for pair in pairs:
            for t in args.tiempos:
                png = f'{base}_{pair[nombre_idx]}_{etiqueta}_{t}.png'
                env = dict(os.environ, BAZUKO_PUBLIC=public, BAZUKO_PREVIEW_CLIP=pair[nombre_idx], BAZUKO_PREVIEW_TIME=str(t),
                           BAZUKO_SHOT=png, BAZUKO_SHOT_DELAY='6', BAZUKO_YAW='0.9', BAZUKO_PITCH='0.12', BAZUKO_DIST='4.2')
                subprocess.run([args.juego], env=env, cwd=os.path.dirname(os.path.abspath(args.juego)), timeout=120)
                print('captura', png)
