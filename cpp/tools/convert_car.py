"""Convierte un modelo de vehiculo pesado de Sketchfab en piezas ligeras para el juego (cuerpo + 4 ruedas + json).
Uso: blender --background --python convert_car.py -- <clave>
"""
import bpy, bmesh, json, os, math, re, sys
import numpy as np
from mathutils import Vector

ROOT = r"C:\Users\raull\Documentos\Proyectos\bazuko\public\models"
OUT = os.path.join(ROOT, "vehiculos")
SRC = os.path.join(ROOT, "vehiculos animados")
DROP_RE = re.compile(r'engine|undercarriage|exhaust|suspension|spring|brakepump|caliper|rotor|disc_brake|wheelhouse|_mech|airbag|decal|sticker|logo_background|display|speedometer|tachometer|backfacing|screw|bolt|rivet', re.I)
GLASS_RE = re.compile(r'glass|window|windshield|cristal|vidrio', re.I)
NOGLASS_RE = re.compile(r'glow|lens|light|lamp|mirror|chrome|blk|rubber|trim|frame', re.I)
INTERIOR_RE = re.compile(r'int|seat|leather|dash|carpet|belt|cabin|steering|console|roof_lin|felt|fabric|pedal|stitch', re.I)

CARS = {
    'jetta': dict(src=r"volks_jetta\Volkswagen_Jetta_GLI_2025.glb", length=4.5, budget=70000, paint_re=r'^Gris Franela', tire_re='tire', steer_re='steering', seat_re='seat|leather',
                  rows=[('driver', 0), ('pass', 0), ('pass', 1), ('pass', 1)]),
    'hilux': dict(src=r"hilux\Toyota_Hilux_Revo_Prerunner_2021.glb", length=5.3, budget=80000, tire_re=r'_tire_0', steer_re='STEERING_WHEEL_MESH', seat_re='seat_leather|SEAT_MESH',
                  mirror_x=True, paint_re=r'^carpaint$', rows=[('driver', 0), ('pass', 0), ('pass', 1), ('pass', 1)]),
    'modelx': dict(src=r"model_x\Tesla_MODEL_X_Animation.glb", length=5.0, budget=80000, tire_re='tyre', steer_re='steeringwheel_detail', paint_re=r'^body$', seat_re='seat|leather',
                   rows=[('driver', 0), ('pass', 0), ('pass', 1), ('pass', 1)]),
    'crafter': dict(src=r"volks_crafter\Volkswagen_Crafter.glb", length=6.0, budget=90000, tire_re=r'rearview_mirror\.02[234]', steer_re='NO_STEERING_OBJECT', seat_re='leather|seat',
                    front_minus_y=True, driver_xy=(0.38, -0.95), paint_re=r'^Car Paint$', wheel_dark_re='rearview|window', rows=[('driver', 0), ('pass', 0)]),
    'mercedes': dict(src=r"mercedes_slk\Mercedes-Benz_SLK_55_AMG_2012.glb", length=4.1, budget=80000, tire_re='ridgescapsule', steer_re='NO_STEERING_OBJECT', seat_re='leather|seat_belt',
                     front_minus_y=True, driver_xy=(0.36, 0.40), paint_re=r'carpaint', door_vg=r'DoorLF_36', rows=[('driver', 0), ('pass', 0)]),
}

key = sys.argv[sys.argv.index('--') + 1]
cfg = CARS[key]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, cfg['src']))

# --- 1. hornear transformaciones, quitar lo que no se ve -------------------------------------------------------------
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = o.matrix_world.__class__.Identity(4)
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)

def mats_of(o): return ' '.join(m.material.name for m in o.material_slots if m.material)

def bbox(o):
    n = len(o.data.vertices); a = np.empty(n * 3, dtype=np.float32); o.data.vertices.foreach_get('co', a); a = a.reshape(n, 3)
    return a.min(axis=0), a.max(axis=0), a

# el suelo/planos grandes y piezas minusculas
for o in list(bpy.data.objects):
    if o.type != 'MESH' or len(o.data.vertices) == 0: bpy.data.objects.remove(o); continue
    mn, mx, _ = bbox(o)
    if o.name.startswith('Icosphere') or np.linalg.norm(mx - mn) < 0.04 or (mx[2] - mn[2]) < 0.002 and (mx[0] - mn[0]) > 5.0:
        bpy.data.objects.remove(o)

if cfg.get('mirror_x'):
    for o in bpy.data.objects:
        for v in o.data.vertices: v.co.x = -v.co.x
        o.data.flip_normals(); o.data.update()
# orientacion: el frente debe quedar en -Y (como el Raptor). El volante marca el frente (esta en la mitad delantera)
allmn = np.array([1e9] * 3); allmx = np.array([-1e9] * 3)
for o in bpy.data.objects:
    mn, mx, _ = bbox(o); allmn = np.minimum(allmn, mn); allmx = np.maximum(allmx, mx)
steer = [o for o in bpy.data.objects if re.search(cfg['steer_re'], o.name + ' ' + mats_of(o), re.I) and len(o.data.vertices) > 30]
steer.sort(key=lambda o: -len(o.data.polygons))
sc = None
if steer:
    mn, mx, _ = bbox(steer[0]); sc = (mn + mx) / 2
front_minus_y = cfg.get('front_minus_y')
if front_minus_y is None:
    front_minus_y = bool(sc is not None and sc[1] < (allmn[1] + allmx[1]) / 2)
if not front_minus_y:
    for o in bpy.data.objects:
        for v in o.data.vertices: v.co.x = -v.co.x; v.co.y = -v.co.y
    if sc is not None: sc = np.array([-sc[0], -sc[1], sc[2]])
    allmn = np.array([-allmx[0], -allmx[1], allmn[2]]); allmx = np.array([-allmn[0] * 0 + (-(-allmx[0])), 0, 0]) if False else allmx
    # recalcular limites
    allmn = np.array([1e9] * 3); allmx = np.array([-1e9] * 3)
    for o in bpy.data.objects:
        mn, mx, _ = bbox(o); allmn = np.minimum(allmn, mn); allmx = np.maximum(allmx, mx)
height = allmx[2] - allmn[2]; floor_z = allmn[2]
for o in bpy.data.objects: o.data.update()
print("ORIENTACION frente -Y; volante", sc, "limites", allmn, allmx)

# --- 2. ruedas: circulo por cuadrante a partir de los neumaticos -------------------------------------------------------
tires = [o for o in bpy.data.objects if re.search(cfg['tire_re'], o.name + ' ' + mats_of(o), re.I)]
pts = []
for o in tires:
    _, _, a = bbox(o); pts.append(a)
pts = np.concatenate(pts) if pts else None
midY = (allmn[1] + allmx[1]) / 2

def kasa(y, z):
    A = np.column_stack([y, z, np.ones_like(y)]); b = y * y + z * z
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    cy, cz = sol[0] / 2, sol[1] / 2; r = math.sqrt(max(sol[2] + cy * cy + cz * cz, 1e-6)); return cy, cz, r

wheels = {}
for sx in (1, -1):
    for front in (True, False):
        sel = pts[(np.sign(pts[:, 0]) == sx) & ((pts[:, 1] < midY) == front) & (pts[:, 2] < height * 0.45 + floor_z)]
        cy, cz, r = kasa(sel[:, 1], sel[:, 2])
        # el neumatico es un anillo: el borde exterior manda, se toma el radio maximo del conjunto
        r = float(np.percentile(np.hypot(sel[:, 1] - cy, sel[:, 2] - cz), 99.5))
        xs = sel[:, 0]
        wheels[(sx, front)] = dict(cy=float(cy), cz=float(cz), r=r, x0=float(xs.min()), x1=float(xs.max()))
print("RUEDAS", {k: (round(v['cy'], 3), round(v['cz'], 3), round(v['r'], 3)) for k, v in wheels.items()})

# --- 3. repartir las caras: ruedas / resto ----------------------------------------------------------------------------
def labels_for(o):
    me = o.data; n = len(me.polygons)
    c = np.empty(n * 3, dtype=np.float32); me.polygons.foreach_get('center', c); c = c.reshape(n, 3)
    lab = np.full(n, -1, dtype=np.int32)
    for i, ((sx, front), w) in enumerate(wheels.items()):
        d = np.hypot(c[:, 1] - w['cy'], c[:, 2] - w['cz'])
        inside = (d <= w['r'] * 1.02) & (c[:, 0] * sx > 0) & (c[:, 0] * sx >= min(abs(w['x0']), abs(w['x1'])) - 0.03) & (c[:, 0] * sx <= max(abs(w['x0']), abs(w['x1'])) + 0.03)
        lab[inside & (lab < 0)] = i
    return lab

def extract(o, lab, which):
    keep = set(np.nonzero(lab == which)[0].tolist())
    if not keep: return None
    b = bmesh.new(); b.from_mesh(o.data); b.faces.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[f for f in b.faces if f.index not in keep], context='FACES')
    for v in [v for v in b.verts if not v.link_faces]: b.verts.remove(v)
    nm = bpy.data.meshes.new(o.name + '_w%d' % which); b.to_mesh(nm); b.free()
    for m in o.data.materials: nm.materials.append(m)
    no = bpy.data.objects.new(nm.name, nm); bpy.context.scene.collection.objects.link(no); return no

wheel_objs = {i: [] for i in range(4)}
body_objs = []
for o in list(bpy.data.objects):
    nm = o.name + ' ' + mats_of(o)
    lab = labels_for(o)
    for i in range(4):
        w = extract(o, lab, i)
        if w: wheel_objs[i].append(w)
    if (lab >= 0).all():
        bpy.data.objects.remove(o); continue
    if (lab >= 0).any():
        b = bmesh.new(); b.from_mesh(o.data); b.faces.ensure_lookup_table()
        bmesh.ops.delete(b, geom=[f for f in b.faces if lab[f.index] >= 0], context='FACES')
        for v in [v for v in b.verts if not v.link_faces]: b.verts.remove(v)
        b.to_mesh(o.data); b.free()
    if DROP_RE.search(nm): bpy.data.objects.remove(o); continue
    body_objs.append(o)

# --- 3b. puerta del conductor: caras cuyos vertices pesan en el hueso de la puerta (solo modelos con esqueleto de puertas) ---------
door_objs = []
if cfg.get('door_vg'):
    for o in list(body_objs):
        idx = {vg.index for vg in o.vertex_groups if re.search(cfg['door_vg'], vg.name)}
        if not idx: continue
        me = o.data
        weight = np.zeros(len(me.vertices), dtype=np.float32)
        for v in me.vertices:
            for gr in v.groups:
                if gr.group in idx: weight[v.index] = max(weight[v.index], gr.weight)
        lab = np.array([1 if all(weight[i] >= 0.5 for i in p.vertices) else 0 for p in me.polygons], dtype=np.int32)
        if not lab.any(): continue
        d = extract(o, lab, 1)
        if d: door_objs.append(d)
        if lab.all(): body_objs.remove(o); bpy.data.objects.remove(o); continue
        b = bmesh.new(); b.from_mesh(me); b.faces.ensure_lookup_table()
        bmesh.ops.delete(b, geom=[f for f in b.faces if lab[f.index] == 1], context='FACES')
        for v in [v for v in b.verts if not v.link_faces]: b.verts.remove(v)
        b.to_mesh(me); b.free()
    print("PUERTA objetos", len(door_objs), "caras", sum(len(o.data.polygons) for o in door_objs))

# --- 4. materiales: vidrio translucido, resto opaco con solo el color base ---------------------------------------------
def make_glass():
    m = bpy.data.materials.new('Cristal'); m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF'); b.inputs['Base Color'].default_value = (0.05, 0.09, 0.11, 1.0); b.inputs['Alpha'].default_value = 0.28
    if hasattr(m, 'surface_render_method'): m.surface_render_method = 'BLENDED'
    if hasattr(m, 'blend_method'):
        try: m.blend_method = 'BLEND'
        except Exception: pass
    return m
glass = make_glass()

def strip(mat):
    if hasattr(mat, 'surface_render_method'): mat.surface_render_method = 'DITHERED'
    if hasattr(mat, 'blend_method'):
        try: mat.blend_method = 'OPAQUE'
        except Exception: pass
    if not mat.node_tree: return
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            for sock in n.inputs:
                if sock.name == 'Base Color': continue
                for l in list(sock.links): mat.node_tree.links.remove(l)
            n.inputs['Alpha'].default_value = 1.0
            n.inputs['Metallic'].default_value = 0.0; n.inputs['Roughness'].default_value = 0.8

for o in body_objs + door_objs:
    is_glass = GLASS_RE.search(o.name + ' ' + mats_of(o)) and not NOGLASS_RE.search(mats_of(o))
    if is_glass:
        o.data.materials.clear(); o.data.materials.append(glass)
def fix_colors(mat):
    """Los glTF de Sketchfab traen el color en el visor, no en el archivo: muchos materiales quedan blancos o grises sin textura.
    Se les da un color por nombre; la pintura se renombra a 'Paint' (blanca) para teñirla por carro en el juego."""
    if not mat.node_tree: return
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None or bsdf.inputs['Base Color'].links: return
    col = list(bsdf.inputs['Base Color'].default_value)
    name = mat.name.lower()
    if cfg.get('paint_re') and re.search(cfg['paint_re'], mat.name):
        bsdf.inputs['Base Color'].default_value = (1.0, 1.0, 1.0, 1.0); mat.name = 'Paint'; return
    neutral = (max(col[:3]) - min(col[:3])) < 0.08 and max(col[:3]) > 0.4
    if not neutral: return
    if re.search(r'chrome|metal|steel|alu|badge|emitter|mirror|silver|rim|grill|vent', name): c = 0.62
    elif re.search(r'leather|seat|belt|carpet|felt|fabric|textile|cloth|pedal|stitch', name): c = 0.07
    elif re.search(r'plastic|rubber|black|trim|dash|panel|tire|tyre|matte|ridge|screw', name): c = 0.05
    else: c = 0.3
    bsdf.inputs['Base Color'].default_value = (c, c, c * 1.03, 1.0)
for m in bpy.data.materials:
    if m != glass: strip(m); fix_colors(m)

# --- 5. adelgazar y unir por material ---------------------------------------------------------------------------------
def tri_count(objs): return sum(len(o.data.polygons) for o in objs)
total = tri_count(body_objs)
base_ratio = min(1.0, cfg['budget'] / max(1, total))
print("TRIANGULOS cuerpo", total, "ratio", round(base_ratio, 3))
def decimate(o, ratio):
    if ratio >= 0.98 or len(o.data.polygons) < 80: return
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True)
    md = o.modifiers.new('d', 'DECIMATE'); md.ratio = max(0.02, ratio)
    bpy.ops.object.modifier_apply(modifier='d')
for o in body_objs + door_objs:
    ratio = base_ratio * (0.5 if INTERIOR_RE.search(o.name + ' ' + mats_of(o)) else 1.0)
    decimate(o, ratio)

def join(objs, name):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    objs[0].name = name; objs[0].data.name = name; return objs[0]

door_info = None
if door_objs:
    dm = [v.co for o in door_objs for v in o.data.vertices]
    xs = sorted(c.x for c in dm); ys_d = [c.y for c in dm]; zs_d = [c.z for c in dm]
    skin_x = xs[int(len(xs) * 0.9)]
    door_info = {'hinge': [round(float(skin_x - 0.02), 5), round(float(min(zs_d) + max(zs_d)) / 2, 5), round(float(-(min(ys_d) + 0.02)), 5)],
                 'length': round(float(max(ys_d) - min(ys_d)), 4), 'zmin': round(float(min(zs_d)), 4), 'zmax': round(float(max(zs_d)), 4)}
    door_part = join(door_objs, key + '_door')
# unir todo el cuerpo en un solo objeto (un primitivo por material)
body = join(body_objs, key + '_body')
# fusionar ranuras de material repetidas
body_tris = len(body.data.polygons)
print("TRIANGULOS cuerpo final", body_tris, "materiales", len(body.data.materials))

# texturas: segun cuanto se ve cada material
tris_by_mat = {}
for p in body.data.polygons: tris_by_mat[p.material_index] = tris_by_mat.get(p.material_index, 0) + 1
img_cap = {}
for idx, count in tris_by_mat.items():
    mat = body.data.materials[idx]
    if not mat or not mat.node_tree: continue
    cap = 2048 if count > 12000 else 1024 if count > 3000 else 512 if count > 600 else 256
    for n in mat.node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image: img_cap[n.image.name] = max(img_cap.get(n.image.name, 0), cap)
for img in list(bpy.data.images):
    cap = img_cap.get(img.name, 64 if 'wheel' not in img.name.lower() else 512)
    if max(img.size) > cap:
        s = cap / max(img.size); img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))

# --- 6. exportar -----------------------------------------------------------------------------------------------------
def g(v): return [round(float(v[0]), 5), round(float(v[2]), 5), round(-float(v[1]), 5)]
def export(o, fname):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname), export_format='GLB', use_selection=True, export_apply=False,
                              export_animations=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=90)

info = {'wheels': [], 'seats': [], 'targetLength': cfg['length']}
amn = Vector((1e9, 1e9, 1e9)); amx = Vector((-1e9, -1e9, -1e9))
def grow(o):
    global amn, amx
    for v in o.data.vertices:
        amn = Vector(min(amn[i], v.co[i]) for i in range(3)); amx = Vector(max(amx[i], v.co[i]) for i in range(3))
tag = {(1, True): 'LF', (1, False): 'LR', (-1, True): 'RF', (-1, False): 'RR'}
for i, ((sx, front), w) in enumerate(wheels.items()):
    objs = wheel_objs[i]
    if not objs: continue
    wo = join(objs, '%s_wheel%s' % (key, tag[(sx, front)]))
    hub = bpy.data.materials.get('MoyuDark') or bpy.data.materials.new('MoyuDark')
    hub.use_nodes = True; hub.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.12, 0.12, 0.13, 1.0)
    for i, m in enumerate(wo.data.materials):
        if m and (GLASS_RE.search(m.name) or (cfg.get('wheel_dark_re') and re.search(cfg['wheel_dark_re'], m.name))): wo.data.materials[i] = hub   # bujes con material de ventana o espejo en algunos modelos
    for m in wo.data.materials:
        if m: strip(m)
    decimate(wo, 0.5 if len(wo.data.polygons) > 6000 else 1.0)
    grow(wo)
    xs = [v.co.x for v in wo.data.vertices]
    cx = (min(xs) + max(xs)) / 2
    export(wo, '%s_wheel%s.glb' % (key, tag[(sx, front)]))
    info['wheels'].append({'part': 'wheel' + tag[(sx, front)], 'center': g((cx, w['cy'], w['cz'])), 'radius': round(w['r'], 4), 'front': bool(front)})
grow(body)
export(body, key + '_body.glb')
if door_info:
    grow(door_part); export(door_part, key + '_door.glb'); info['door'] = door_info

# asientos: respecto al volante (delante) -> filas hacia atras (+Y). Altura de la cadera sobre el cojin
seat_objs = [o for o in bpy.data.objects if re.search(cfg['seat_re'], o.name + ' ' + mats_of(o), re.I)]
sx0 = float(sc[0]) if sc is not None else 0.4
sy0 = float(sc[1]) if sc is not None else -0.6
if cfg.get('driver_xy'): sx0, sy0 = cfg['driver_xy'][0], cfg['driver_xy'][1] - 0.58
seat_z = floor_z + height * 0.42
rows = cfg['rows']
for who, row in rows:
    x = sx0 if (who == 'driver') else -sx0
    y = sy0 + 0.58 + 0.95 * row
    info['seats'].append({'pos': g((x, y, seat_z)), 'yaw': 0.0, 'driver': who == 'driver'})
if sc is not None: info['steering'] = g((float(sc[0]), float(sc[1]), float(sc[2])))   # centro del volante (glTF)
lo, hi = g(amn), g(amx)
info['min'] = [min(lo[i], hi[i]) for i in range(3)]; info['max'] = [max(lo[i], hi[i]) for i in range(3)]
info['tris'] = body_tris
json.dump(info, open(os.path.join(OUT, key + '.json'), 'w'), indent=1)
print("LISTO", key, body_tris, "triangulos de cuerpo")
