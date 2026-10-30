"""Convierte el Renault Duster de Sketchfab (ANDREO12, CC BY 4.0) en la patrulla de policia del juego: cuerpo con la pintura de la
Policia Nacional (blanco metalizado, franja azul con cuadros verde limon y la palabra POLICIA), cuatro ruedas, puerta del conductor
articulada y barra de luces.
Uso: blender --background --python convert_patrulla.py
Entrada: public/models/vehiculos animados/duster.glb (el archivo trae dos Duster; se usa el de la izquierda, con las puertas cerradas).
Salida:  public/models/vehiculos/patrulla_body.glb, patrulla_door.glb, patrulla_wheel{LF,LR,RF,RR}.glb y patrulla.json
"""
import bpy, bmesh, json, math, os, re, sys
import numpy as np
from mathutils import Vector

ROOT = r"C:\Users\raull\Documentos\Proyectos\bazuko\public\models"
OUT = os.path.join(ROOT, "vehiculos")
SRC = os.path.join(ROOT, "vehiculos animados", "duster.glb")
TEX_PATH = os.path.join(os.environ.get('TEMP', '.'), 'patrulla_pintura.png')
LENGTH = 4.4            # metros: el largo de la patrulla del juego
BUDGET = 70000          # triangulos del cuerpo
KEY = 'patrulla'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# --- 1. hornear transformaciones y quedarse con un solo carro -------------------------------------------------------------
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = o.matrix_world.__class__.Identity(4)
for o in list(bpy.data.objects):
    if o.type != 'MESH' or o.name in ('Object_11', 'Object_2', 'Object_8'): bpy.data.objects.remove(o)   # suelo y plataforma

def components(bm):
    seen = set(); result = []
    for v0 in bm.verts:
        if v0.index in seen: continue
        stack = [v0]; seen.add(v0.index); comp = []
        while stack:
            v1 = stack.pop(); comp.append(v1)
            for e in v1.link_edges:
                v2 = e.other_vert(v1)
                if v2.index not in seen: seen.add(v2.index); stack.append(v2)
        result.append(comp)
    return result

def bounds(comp):
    a = np.array([[v.co.x, v.co.y, v.co.z] for v in comp]); return a.min(0), a.max(0)

for o in list(bpy.data.objects):
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    drop = [v for comp in components(bm) if sum(v.co.x for v in comp) / len(comp) > 0.0 for v in comp]
    bmesh.ops.delete(bm, geom=drop, context='VERTS'); bm.to_mesh(o.data); bm.free()
    if not o.data.vertices: bpy.data.objects.remove(o)

# centrar: x e y al centro del carro, suelo en z = 0
allp = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in bpy.data.objects])
cx = (allp[:, 0].min() + allp[:, 0].max()) / 2; cy = (allp[:, 1].min() + allp[:, 1].max()) / 2; floor = allp[:, 2].min()
for o in bpy.data.objects:
    for v in o.data.vertices: v.co.x -= cx; v.co.y -= cy; v.co.z -= floor
    o.data.update()
allp[:, 0] -= cx; allp[:, 1] -= cy; allp[:, 2] -= floor
# El frente del Duster del archivo mira a +y (el capo y el parabrisas estan hacia +y; hacia -y quedan el portaon y las luces traseras): se gira
# 180 grados sobre z para que mire a -y, como esperan las piezas del juego, y el lado izquierdo (conductor, volante a la izquierda) quede en +x.
for o in bpy.data.objects:
    for v in o.data.vertices: v.co.x = -v.co.x; v.co.y = -v.co.y
    o.data.update()
allp[:, 0] = -allp[:, 0]; allp[:, 1] = -allp[:, 1]
SX = LENGTH / (allp[:, 1].max() - allp[:, 1].min())   # el largo real del modelo es ~4,45 m: se escala a LENGTH
for o in bpy.data.objects:
    for v in o.data.vertices: v.co *= SX
    o.data.update()
allp *= SX
amn, amx = allp.min(0), allp.max(0)
print("LIMITES (m)", np.round(amn, 2), np.round(amx, 2))
HALF_W = float(amx[0])

def obj_by_mat(pattern):
    return [o for o in bpy.data.objects if any(m.material and re.search(pattern, m.material.name) for m in o.material_slots)]

def split_where(obj, predicate, name):
    """Saca de `obj` las partes sueltas que cumplen predicate(min, max) y las devuelve como un objeto nuevo (o None)."""
    bm = bmesh.new(); bm.from_mesh(obj.data); bm.verts.ensure_lookup_table()
    take = [c for c in components(bm) if predicate(*bounds(c))]
    if not take: bm.free(); return None
    nb = bmesh.new(); nb.from_mesh(obj.data); nb.verts.ensure_lookup_table(); nb.faces.ensure_lookup_table()
    keep = {v.index for c in take for v in c}
    bmesh.ops.delete(nb, geom=[f for f in nb.faces if not all(v.index in keep for v in f.verts)], context='FACES')
    for v in [v for v in nb.verts if not v.link_faces]: nb.verts.remove(v)
    new_mesh = bpy.data.meshes.new(name); nb.to_mesh(new_mesh); nb.free()
    for m in obj.data.materials: new_mesh.materials.append(m)
    no = bpy.data.objects.new(name, new_mesh); bpy.context.scene.collection.objects.link(no)
    geom = [v for c in take for v in c]
    bmesh.ops.delete(bm, geom=geom, context='VERTS'); bm.to_mesh(obj.data); bm.free()
    return no

# --- 2. pintura de la Policia: UV lateral para la textura -----------------------------------------------------------------
paint_objs = obj_by_mat(r'FFCC0000')
assert paint_objs, "no se encontro la pintura roja"
paint = paint_objs[0]
TEX_W, TEX_H = 2048, 1024
Z_TOP = 2.3     # la textura cubre z de 0 a Z_TOP y de punta a punta del carro en y
def side_uv(x, y, z):
    u = (y / LENGTH) + 0.5 if x > 0 else 0.5 - (y / LENGTH)   # lado del conductor (+x): el frente a la izquierda; lado opuesto, espejado, para que el texto se lea bien
    return (min(max(u, 0.003), 0.997), min(max(z / Z_TOP, 0.003), 0.997))
WHITE_UV = (0.012, 0.985)   # esquina de la textura siempre blanca: capo, techo, frente y atras
bm = bmesh.new(); bm.from_mesh(paint.data); bm.faces.ensure_lookup_table()
uv_layer = bm.loops.layers.uv.verify()
for f in bm.faces:
    n = f.normal
    lateral = abs(n.x) > 0.45 and abs(n.x) >= abs(n.y) * 0.8
    for l in f.loops:
        co = l.vert.co
        l[uv_layer].uv = side_uv(n.x if abs(n.x) > 0.05 else co.x, co.y, co.z) if lateral else WHITE_UV
bm.to_mesh(paint.data); bm.free()

# --- 3. textura: blanco, franja azul con cuadros verde limon, POLICIA y bandera -------------------------------------------
W = np.array([0.94, 0.95, 0.97, 1.0], dtype=np.float32)
BLUE = np.array([0.02, 0.07, 0.36, 1.0], dtype=np.float32)
LIME = np.array([0.64, 0.90, 0.10, 1.0], dtype=np.float32)
px_per_m_x = TEX_W / LENGTH            # el eje u cubre el largo del carro
px_per_m_y = TEX_H / Z_TOP
img_arr = np.tile(W, (TEX_H, TEX_W, 1))
def rect(arr, u0, u1, z0, z1, color):
    x0 = int(u0 * TEX_W); x1 = int(u1 * TEX_W); y0 = int(z0 / Z_TOP * TEX_H); y1 = int(z1 / Z_TOP * TEX_H)
    arr[max(y0, 0):min(y1, TEX_H), max(x0, 0):min(x1, TEX_W)] = color
# bandas (z en metros sobre el suelo): linea azul inferior, franja de cuadros, banda azul superior
rect(img_arr, 0.0, 1.0, 0.66, 0.705, BLUE)
rect(img_arr, 0.0, 1.0, 0.705, 0.88, BLUE)
SQ = 0.082                              # lado de cada cuadro (m)
cols = int(LENGTH / SQ) + 1
for row in range(2):
    z0 = 0.712 + row * SQ + 0.002
    for c in range(cols):
        if (c + row) % 2: continue
        u0 = (c * SQ) / LENGTH
        rect(img_arr, u0, u0 + SQ / LENGTH, z0, z0 + SQ - 0.004, LIME)
rect(img_arr, 0.0, 1.0, 0.88, 0.915, BLUE)
# arriba de la banda azul: el costado queda blanco hasta la ventanilla (z 0,95)
img = bpy.data.images.new('patrulla_pintura', TEX_W, TEX_H, alpha=True)
img.pixels.foreach_set(img_arr.reshape(-1)); img.update()

# texto: se dibuja con un objeto de texto de Blender, se renderiza y se compone sobre la textura
def render_text(text, font_h_m, color, extrude, bevel=0.0):
    sc = bpy.data.scenes.new('txt'); sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.film_transparent = True
    sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'SINGLE'; sc.display.shading.single_color = color[:3]
    sc.view_settings.view_transform = 'Standard'
    curve = bpy.data.curves.new('t', 'FONT'); curve.body = text; curve.size = 1.0; curve.extrude = extrude; curve.bevel_depth = bevel
    curve.align_x = 'CENTER'; curve.align_y = 'CENTER'
    ob = bpy.data.objects.new('t', curve); sc.collection.objects.link(ob)
    cam_d = bpy.data.cameras.new('c'); cam_d.type = 'ORTHO'
    cam = bpy.data.objects.new('c', cam_d); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0, 0, 5); cam.rotation_euler = (0, 0, 0)
    return sc, ob, cam_d, cam, curve
sc_txt, txt_ob, cam_d, cam, curve = render_text("POLICÍA", 0.2, (0.02, 0.07, 0.36), 0.045, 0.012)
text_w_m, text_h_m = 1.40, 0.27         # tamano del texto en la textura (m): ocupa la franja blanca inferior de las puertas
bbox = [txt_ob.matrix_world @ Vector(c) for c in txt_ob.bound_box]
tw = max(v.x for v in bbox) - min(v.x for v in bbox); th = max(v.y for v in bbox) - min(v.y for v in bbox)
scale = text_w_m / tw
txt_ob.scale = (scale, scale, 1.0)
bpy.context.view_layer.update()
cam_d.ortho_scale = 4.0
RENDER_W = 2048; RENDER_H = 1024
sc_txt.render.resolution_x = RENDER_W; sc_txt.render.resolution_y = RENDER_H
sc_txt.render.image_settings.file_format = 'PNG'; sc_txt.render.image_settings.color_mode = 'RGBA'
sc_txt.render.filepath = os.path.join(os.environ.get('TEMP', '.'), 'patrulla_texto.png')
bpy.ops.render.render(write_still=True, scene=sc_txt.name)
txt_img = bpy.data.images.load(sc_txt.render.filepath)
t_arr = np.array(txt_img.pixels[:], dtype=np.float32).reshape(RENDER_H, RENDER_W, 4)   # filas de abajo hacia arriba, como la textura
ys, xs = np.nonzero(t_arr[:, :, 3] > 0.02)
if len(xs):
    x_lo, x_hi, y_lo, y_hi = xs.min(), xs.max(), ys.min(), ys.max()
    crop = t_arr[y_lo:y_hi + 1, x_lo:x_hi + 1]
    # tamano deseado en pixeles de la textura
    want_w = int(text_w_m * px_per_m_x); want_h = int(text_h_m * px_per_m_y)   # la altura total (con el acento) cabe en la franja blanca de la puerta
    ix = (np.linspace(0, crop.shape[1] - 1, want_w)).astype(int); iy = (np.linspace(0, crop.shape[0] - 1, want_h)).astype(int)
    crop = crop[np.ix_(iy, ix)]
    crop[:, :, :3] = BLUE[:3]   # azul institucional liso: el render lo aclara
    cx_px = int(0.5 * TEX_W); z_center = 0.515
    y_px = int(z_center / Z_TOP * TEX_H) - want_h // 2
    x_px = cx_px - want_w // 2 - int(0.05 * px_per_m_x)
    a = crop[:, :, 3:4]
    region = img_arr[y_px:y_px + want_h, x_px:x_px + want_w]
    region[:] = region * (1 - a) + crop * a
    print("TEXTO px", want_w, want_h, "en", x_px, y_px)
# bandera de Colombia (amarillo, azul, rojo) a la derecha del texto
flag_w, flag_h = 0.24, 0.16
fu0 = 0.5 + (text_w_m / 2 + 0.10 - 0.05) / LENGTH; fz0 = 0.515 - flag_h / 2 - 0.01
rect(img_arr, fu0, fu0 + flag_w / LENGTH, fz0 + flag_h * 0.5, fz0 + flag_h, np.array([0.99, 0.80, 0.07, 1.0], dtype=np.float32))
rect(img_arr, fu0, fu0 + flag_w / LENGTH, fz0 + flag_h * 0.25, fz0 + flag_h * 0.5, np.array([0.03, 0.14, 0.60, 1.0], dtype=np.float32))
rect(img_arr, fu0, fu0 + flag_w / LENGTH, fz0, fz0 + flag_h * 0.25, np.array([0.80, 0.07, 0.10, 1.0], dtype=np.float32))
img.pixels.foreach_set(img_arr.reshape(-1)); img.update()
for ob in (txt_ob, cam): bpy.data.objects.remove(ob)
bpy.data.scenes.remove(sc_txt)
img.filepath_raw = TEX_PATH; img.file_format = 'PNG'; img.save()
mat_paint = bpy.data.materials.new('metal_pintura_policia'); mat_paint.use_nodes = True
nt = mat_paint.node_tree; bsdf = nt.nodes.get('Principled BSDF')
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Metallic'].default_value = 0.55; bsdf.inputs['Roughness'].default_value = 0.32
paint.data.materials.clear(); paint.data.materials.append(mat_paint)

# --- 4. puerta del conductor (lado +x, la de adelante): partes sueltas de todos los objetos dentro de su caja ---------------
# la caja de la puerta en coordenadas del carro ya centradas y escaladas (en el modelo original: x[-0.97,-0.28] y[-1.15,-0.07] con centro -1.36, 0.03)
def door_box(mn, mx):
    # puerta delantera del conductor (lado +x, ya girado el modelo): caja en coordenadas del carro centradas y escaladas
    x0, x1 = 0.44 * SX, 1.24 * SX
    y0, y1 = -1.17 * SX, 0.33 * SX
    z0, z1 = 0.30 * SX, 1.70 * SX
    return mn[0] >= x0 and mx[0] <= x1 and mn[1] >= y0 and mx[1] <= y1 and mn[2] >= z0 and mx[2] <= z1
door_parts = []
for o in list(bpy.data.objects):
    if o.name == 'Object_14' or 'tread' in ' '.join(m.material.name for m in o.material_slots if m.material): continue
    d = split_where(o, door_box, o.name + '_door')
    if d: door_parts.append(d)
print("PUERTA partes", len(door_parts), "caras", sum(len(d.data.polygons) for d in door_parts))

# --- 5. cristales y luces: el material 'trans' del modelo mezcla ventanas y faros -------------------------------------------
def solid(name, rgba, emit=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF'); b.inputs['Base Color'].default_value = rgba; b.inputs['Roughness'].default_value = 0.5
    if emit > 0:
        b.inputs['Emission Color'].default_value = rgba; b.inputs['Emission Strength'].default_value = emit
    return m
glass = bpy.data.materials.new('Cristal'); glass.use_nodes = True
gb = glass.node_tree.nodes.get('Principled BSDF'); gb.inputs['Base Color'].default_value = (0.05, 0.09, 0.11, 1.0); gb.inputs['Alpha'].default_value = 0.28
if hasattr(glass, 'surface_render_method'): glass.surface_render_method = 'BLENDED'
if hasattr(glass, 'blend_method'):
    try: glass.blend_method = 'BLEND'
    except Exception: pass
headlamp = solid('Faro', (0.92, 0.93, 0.86, 1.0)); taillamp = solid('Luz_trasera', (0.75, 0.04, 0.04, 1.0))
for o in list(bpy.data.objects):
    if not any(m.material and 'trans' in m.material.name for m in o.material_slots): continue
    lamp_f = split_where(o, lambda mn, mx: (mn[1] + mx[1]) / 2 < -1.4 * SX and mx[2] - mn[2] > 0.1, o.name + '_faro')
    lamp_r = split_where(o, lambda mn, mx: (mn[1] + mx[1]) / 2 > 1.4 * SX and mx[2] < 1.3 * SX and mx[2] - mn[2] > 0.1, o.name + '_trasera')
    if lamp_f: lamp_f.data.materials.clear(); lamp_f.data.materials.append(headlamp)
    if lamp_r: lamp_r.data.materials.clear(); lamp_r.data.materials.append(taillamp)
    o.data.materials.clear(); o.data.materials.append(glass)
for d in door_parts:
    if any(m.material and 'trans' in m.material.name for m in d.material_slots): d.data.materials.clear(); d.data.materials.append(glass)

# --- 6. ruedas (circulo ajustado a los neumaticos) -------------------------------------------------------------------------
all_objs = [o for o in bpy.data.objects if o.type == 'MESH']
tires = [o for o in all_objs if any(m.material and 'tread' in m.material.name for m in o.material_slots)]
pts = np.concatenate([np.array([v.co[:] for v in o.data.vertices]) for o in tires])
midY = 0.0
def kasa(y, z):
    A = np.column_stack([y, z, np.ones_like(y)]); b = y * y + z * z
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    cy, cz = sol[0] / 2, sol[1] / 2; return cy, cz
wheels = {}
for sx in (1, -1):
    for front in (True, False):
        sel = pts[(np.sign(pts[:, 0]) == sx) & ((pts[:, 1] < midY) == front)]
        cy, cz = kasa(sel[:, 1], sel[:, 2])
        r = float(np.percentile(np.hypot(sel[:, 1] - cy, sel[:, 2] - cz), 99.5))
        wheels[(sx, front)] = dict(cy=float(cy), cz=float(cz), r=r, x0=float(sel[:, 0].min()), x1=float(sel[:, 0].max()))
print("RUEDAS", {k: (round(v['cy'], 3), round(v['cz'], 3), round(v['r'], 3)) for k, v in wheels.items()})

def labels_for(o):
    me = o.data; n = len(me.polygons)
    c = np.empty(n * 3, dtype=np.float32); me.polygons.foreach_get('center', c); c = c.reshape(n, 3)
    lab = np.full(n, -1, dtype=np.int32)
    for i, ((sx, front), w) in enumerate(wheels.items()):
        d = np.hypot(c[:, 1] - w['cy'], c[:, 2] - w['cz'])
        lo, hi = min(abs(w['x0']), abs(w['x1'])), max(abs(w['x0']), abs(w['x1']))
        inside = (d <= w['r'] * 1.02) & (c[:, 0] * sx > 0) & (c[:, 0] * sx >= lo - 0.03) & (c[:, 0] * sx <= hi + 0.03)
        lab[inside & (lab < 0)] = i
    return lab

def extract_faces(o, lab, which):
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
    if o.type != 'MESH': continue
    if o.name.endswith('_door'): continue                      # la puerta ya esta aparte
    if o.name.endswith(('_faro', '_trasera')): body_objs.append(o); continue
    lab = labels_for(o)
    for i in range(4):
        w = extract_faces(o, lab, i)
        if w: wheel_objs[i].append(w)
    if (lab >= 0).all(): bpy.data.objects.remove(o); continue
    if (lab >= 0).any():
        b = bmesh.new(); b.from_mesh(o.data); b.faces.ensure_lookup_table()
        bmesh.ops.delete(b, geom=[f for f in b.faces if lab[f.index] >= 0], context='FACES')
        for v in [v for v in b.verts if not v.link_faces]: b.verts.remove(v)
        b.to_mesh(o.data); b.free()
    body_objs.append(o)

# --- 7. barra de luces en el techo ---------------------------------------------------------------------------------------------
def box(name, cx_, cy_, cz_, sx_, sy_, sz_, mat):
    me = bpy.data.meshes.new(name); bmx = bmesh.new()
    bmesh.ops.create_cube(bmx, size=1.0)
    for v in bmx.verts: v.co = Vector((v.co.x * sx_ + cx_, v.co.y * sy_ + cy_, v.co.z * sz_ + cz_))
    bmx.to_mesh(me); bmx.free(); me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); return ob
roof_top = max(v.co.z for o in paint_objs for v in o.data.vertices)
bar_y = (0.12 * SX)   # sobre el centro del techo, a la altura de los asientos delanteros
bar_base = solid('Barra_base', (0.06, 0.06, 0.07, 1.0)); bar_blue = solid('Barra_azul', (0.05, 0.22, 1.0, 1.0), 1.5); bar_red = solid('Barra_roja', (1.0, 0.05, 0.05, 1.0), 1.5)
light_base = box('bar_base', 0, bar_y, roof_top + 0.03, 1.05, 0.30, 0.06, bar_base)
# los lentes son piezas aparte (patrulla_barRed y patrulla_barBlue): el juego los enciende y apaga como estroboscopicas
light_red = box('bar_red', 0.26, bar_y, roof_top + 0.095, 0.48, 0.26, 0.07, bar_red)
light_blue = box('bar_blue', -0.26, bar_y, roof_top + 0.095, 0.48, 0.26, 0.07, bar_blue)
light_bar = [light_base]
body_objs.extend(light_bar)

# --- 8. materiales sin texturas (menos la pintura), adelgazar, unir ------------------------------------------------------------
# llantas plateadas y neumaticos oscuros: las texturas originales salen muy oscuras a este tamano
for m in bpy.data.materials:
    if not m.node_tree: continue
    b = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if b is None: continue
    if m.name.startswith('rim__') or m.name.startswith('wheel__') or m.name.startswith('tread__'):
        for l in list(b.inputs['Base Color'].links): m.node_tree.links.remove(l)
        if m.name.startswith('rim__'): b.inputs['Base Color'].default_value = (0.62, 0.64, 0.67, 1.0)
        elif m.name.startswith('wheel__'): b.inputs['Base Color'].default_value = (0.07, 0.07, 0.075, 1.0)
        else: b.inputs['Base Color'].default_value = (0.03, 0.03, 0.03, 1.0)

def strip(mat):
    if mat.name in ('metal_pintura_policia', 'Cristal') or not mat.node_tree: return
    if hasattr(mat, 'surface_render_method'): mat.surface_render_method = 'DITHERED'
    if hasattr(mat, 'blend_method'):
        try: mat.blend_method = 'OPAQUE'
        except Exception: pass
    for n in mat.node_tree.nodes:
        if n.type == 'BSDF_PRINCIPLED':
            for sock in n.inputs:
                if sock.name in ('Base Color', 'Emission Color', 'Emission Strength'): continue
                for l in list(sock.links): mat.node_tree.links.remove(l)
            n.inputs['Alpha'].default_value = 1.0; n.inputs['Metallic'].default_value = 0.0; n.inputs['Roughness'].default_value = 0.7
for m in bpy.data.materials: strip(m)

def tri_count(objs): return sum(len(o.data.polygons) for o in objs)
door_objs = list(door_parts)
total = tri_count(body_objs)
ratio = min(1.0, BUDGET / max(1, total))
print("TRIANGULOS cuerpo", total, "razon", round(ratio, 3))
def decimate(o, r):
    if r >= 0.98 or len(o.data.polygons) < 80: return
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True)
    md = o.modifiers.new('d', 'DECIMATE'); md.ratio = max(0.02, r)
    bpy.ops.object.modifier_apply(modifier='d')
INTERIOR = re.compile(r'seats|wood|misc', re.I)
for o in body_objs + door_objs:
    if o.name.startswith('bar_'): continue
    nm = o.name + ' ' + ' '.join(m.material.name for m in o.material_slots if m.material)
    decimate(o, ratio * (0.5 if INTERIOR.search(nm) else (1.0 if 'FFCC0000' in nm or 'metal_pintura' in nm else 0.85)))

def join(objs, name):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    objs[0].name = name; objs[0].data.name = name; return objs[0]

door_info = None
if door_objs:
    panel = [o for o in door_objs if any(m and m.name == 'metal_pintura_policia' for m in o.data.materials)] or door_objs   # bisagra y largo salen de la lamina de pintura, no del espejo que sobresale
    dm = [v.co for o in panel for v in o.data.vertices]
    xs = sorted(c.x for c in dm); ys_d = [c.y for c in dm]; zs_d = [c.z for c in dm]
    skin_x = xs[int(len(xs) * 0.9)]
    door_info = {'hinge': [round(float(skin_x - 0.02), 5), round(float(min(zs_d) + max(zs_d)) / 2, 5), round(float(-(min(ys_d) + 0.02)), 5)],
                 'length': round(float(max(ys_d) - min(ys_d)), 4), 'zmin': round(float(min(zs_d)), 4), 'zmax': round(float(max(zs_d)), 4)}
    door_part = join(door_objs, KEY + '_door')
body = join([o for o in body_objs], KEY + '_body')
body_tris = len(body.data.polygons)
print("TRIANGULOS cuerpo final", body_tris, "materiales", len(body.data.materials))
for img_ in list(bpy.data.images):
    if img_.name == 'patrulla_pintura': continue
    if max(img_.size) > 512: s = 512 / max(img_.size); img_.scale(max(1, int(img_.size[0] * s)), max(1, int(img_.size[1] * s)))

# --- 9. exportar -------------------------------------------------------------------------------------------------------------
def g(v): return [round(float(v[0]), 5), round(float(v[2]), 5), round(-float(v[1]), 5)]
def export(o, fname):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname), export_format='GLB', use_selection=True, export_apply=False,
                              export_animations=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=90)
info = {'wheels': [], 'seats': [], 'targetLength': LENGTH}
mn_a = Vector((1e9,) * 3); mx_a = Vector((-1e9,) * 3)
def grow(o):
    global mn_a, mx_a
    for v in o.data.vertices:
        mn_a = Vector(min(mn_a[i], v.co[i]) for i in range(3)); mx_a = Vector(max(mx_a[i], v.co[i]) for i in range(3))
tag = {(1, True): 'LF', (1, False): 'LR', (-1, True): 'RF', (-1, False): 'RR'}
for i, ((sx, front), w) in enumerate(wheels.items()):
    objs = wheel_objs[i]
    if not objs: continue
    wo = join(objs, '%s_wheel%s' % (KEY, tag[(sx, front)]))
    for m in wo.data.materials:
        if m: strip(m)
    decimate(wo, 0.5 if len(wo.data.polygons) > 6000 else 1.0)
    grow(wo)
    xs_w = [v.co.x for v in wo.data.vertices]; cx_w = (min(xs_w) + max(xs_w)) / 2
    export(wo, '%s_wheel%s.glb' % (KEY, tag[(sx, front)]))
    info['wheels'].append({'part': 'wheel' + tag[(sx, front)], 'center': g((cx_w, w['cy'], w['cz'])), 'radius': round(w['r'], 4), 'front': bool(front)})
grow(body); export(body, KEY + '_body.glb')
export(light_red, KEY + '_barRed.glb'); export(light_blue, KEY + '_barBlue.glb')
if door_info:
    grow(door_part); export(door_part, KEY + '_door.glb'); info['door'] = door_info
height = mx_a.z - mn_a.z
seat_x, seat_y, seat_z = 0.40 * SX, -0.02 * SX, 0.84   # altura de la cadera sentado: el piso queda alto y asi los pies no asoman bajo el umbral   # cadera a la altura del pilar central, no del parabrisas
for who, row in [('driver', 0), ('pass', 0), ('pass', 1), ('pass', 1)]:
    x = seat_x if who == 'driver' else -seat_x
    y = seat_y + 0.95 * row
    info['seats'].append({'pos': g((x, y, seat_z)), 'yaw': 0.0, 'driver': who == 'driver'})
info['steering'] = g((seat_x, seat_y - 0.46, 0.98))
lo, hi = g(mn_a), g(mx_a)
info['min'] = [min(lo[i], hi[i]) for i in range(3)]; info['max'] = [max(lo[i], hi[i]) for i in range(3)]
info['tris'] = body_tris
json.dump(info, open(os.path.join(OUT, KEY + '.json'), 'w'), indent=1)
print("LISTO", KEY, body_tris, "triangulos de cuerpo; escala", round(SX, 4))
