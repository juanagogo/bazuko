"""Modela el uniforme de la Policia Nacional como una prenda con piel (la misma malla ajustada al cuerpo de los peatones) y le pinta la tela
con letras, insignias y distintivos. Una prenda por cuerpo: hombres desde la chaqueta (camisa y pantalon de manga y pierna largas) y mujeres
desde el saco (jersey de manga larga y pantalon cargo). El resultado queda junto a las demas prendas: public/models/personaje/<cuerpo>/policia.gltf.
Uso: blender --background --python convert_uniforme.py
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector

ROOT = r"C:\Users\raull\Documentos\Proyectos\bazuko\public\models\personaje"
TMP = os.environ.get('TEMP', '.')
BASES = [('hombre-adulto', ['chaqueta']), ('hombre-joven', ['chaqueta']), ('mujer-adulta', ['saco']), ('mujer-joven', ['saco'])]
SIZE = 2048

NAVY = np.array([0.030, 0.050, 0.150, 1.0], dtype=np.float32)     # azul oscuro de la tela
NAVY_LIGHT = np.array([0.045, 0.072, 0.200, 1.0], dtype=np.float32)
LIME = np.array([0.66, 0.92, 0.07, 1.0], dtype=np.float32)        # verde limon reflectivo
BLACK = np.array([0.015, 0.015, 0.018, 1.0], dtype=np.float32)
SILVER = np.array([0.62, 0.64, 0.68, 1.0], dtype=np.float32)
GOLD = np.array([0.82, 0.66, 0.20, 1.0], dtype=np.float32)

def render_text(text, color, aspect_pad=0.0):
    """Renderiza `text` con la fuente de Blender y devuelve un arreglo RGBA recortado (filas de abajo hacia arriba)."""
    sc = bpy.data.scenes.new('txt'); sc.render.engine = 'BLENDER_WORKBENCH'; sc.render.film_transparent = True
    sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'SINGLE'; sc.display.shading.single_color = color[:3]
    sc.view_settings.view_transform = 'Standard'
    curve = bpy.data.curves.new('t', 'FONT'); curve.body = text; curve.size = 1.0; curve.extrude = 0.0
    curve.align_x = 'CENTER'; curve.align_y = 'CENTER'
    ob = bpy.data.objects.new('t', curve); sc.collection.objects.link(ob)
    cd = bpy.data.cameras.new('c'); cd.type = 'ORTHO'; cd.ortho_scale = max(4.0, len(text) * 0.9)
    cam = bpy.data.objects.new('c', cd); sc.collection.objects.link(cam); sc.camera = cam
    cam.location = (0, 0, 5)
    sc.render.resolution_x = 2048; sc.render.resolution_y = 512
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.render.filepath = os.path.join(TMP, 'txt_uniforme.png')
    bpy.ops.render.render(write_still=True, scene=sc.name)
    img = bpy.data.images.load(sc.render.filepath); arr = np.array(img.pixels[:], dtype=np.float32).reshape(512, 2048, 4)
    bpy.data.images.remove(img)
    for o in (ob, cam): bpy.data.objects.remove(o)
    bpy.data.scenes.remove(sc)
    ys, xs = np.nonzero(arr[:, :, 3] > 0.05)
    crop = arr[ys.min():ys.max() + 1, xs.min():xs.max() + 1].copy()
    crop[:, :, :3] = np.array(color[:3], dtype=np.float32)
    return crop

def stamp(canvas, crop, x0, y0, w, h, flip=False):
    """Pega `crop` escalado a w x h pixeles con su esquina inferior izquierda en (x0, y0)."""
    ix = np.linspace(0, crop.shape[1] - 1, max(1, int(w))).astype(int); iy = np.linspace(0, crop.shape[0] - 1, max(1, int(h))).astype(int)
    c = crop[np.ix_(iy, ix)]
    if flip: c = c[:, ::-1]
    x0 = int(x0); y0 = int(y0); hh, ww = c.shape[:2]
    x1 = min(canvas.shape[1], x0 + ww); y1 = min(canvas.shape[0], y0 + hh)
    if x1 <= x0 or y1 <= y0: return
    c = c[:y1 - y0, :x1 - x0]; a = c[:, :, 3:4]
    canvas[y0:y1, x0:x1] = canvas[y0:y1, x0:x1] * (1 - a) + c * a

def rect(canvas, x0, y0, x1, y1, color):
    canvas[max(int(y0), 0):min(int(y1), canvas.shape[0]), max(int(x0), 0):min(int(x1), canvas.shape[1])] = color

def checker(canvas, x0, y0, x1, y1, cell, color_a, color_b):
    for j, y in enumerate(np.arange(y0, y1, cell)):
        for i, x in enumerate(np.arange(x0, x1, cell)):
            rect(canvas, x, y, min(x + cell, x1), min(y + cell, y1), color_a if (i + j) % 2 == 0 else color_b)

text_police = None; text_name = None; text_number = None

def paint_texture(xmin, xmax, zmin, zmax, name):
    """Dibuja la tela del uniforme. Tres zonas: frente (u 0-1/3), espalda (1/3-2/3) y costados (2/3-1: +x a la izquierda, -x a la derecha)."""
    global text_police, text_name, text_number
    if text_police is None:
        text_police = render_text("POLICÍA", LIME); text_name = render_text("PATRULLERO", LIME); text_number = render_text("137605", LIME)
    img = np.tile(NAVY, (SIZE, SIZE, 1))
    # tela con trama sutil
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 0.006, (SIZE, SIZE, 1)).astype(np.float32)
    img[:, :, :3] += noise; img[:, :, :3] = np.clip(img[:, :, :3], 0, 1)
    third = SIZE / 3.0
    def px(x, zone):  # metros en x -> pixel
        return zone * third + (x - xmin) / (xmax - xmin) * (third - 2) + 1
    def py(zf):       # fraccion de altura -> pixel
        return zf * (SIZE - 2) + 1
    mx = lambda m: m / (xmax - xmin) * third          # metros -> pixeles en x
    my = lambda m: m / (zmax - zmin) * SIZE           # metros -> pixeles en y
    for zone in (0, 1):                                # frente y espalda comparten hombreras, cinturon y muslos
        # hombreras: yugo reflectivo sobre los hombros y la parte alta de las mangas
        rect(img, px(xmin, zone), py(0.935), px(xmax, zone), py(1.0), LIME)
        rect(img, px(-0.13, zone), py(0.935), px(0.13, zone), py(1.0), NAVY)                    # el cuello queda azul
        rect(img, px(xmin, zone), py(0.928), px(xmax, zone), py(0.935), BLACK)                    # costura bajo la hombrera
        # cinturon negro
        rect(img, px(xmin, zone), py(0.575), px(xmax, zone), py(0.62), BLACK)
        # cuadros reflectivos en los muslos (parches con bolsillo cargo)
        for sx in (-1, 1):
            cx = sx * 0.145
            rect(img, px(cx - 0.052, zone), py(0.355), px(cx + 0.052, zone), py(0.43), NAVY_LIGHT)
            checker(img, px(cx - 0.052, zone), py(0.405), px(cx + 0.052, zone), py(0.43), mx(0.0125), LIME, BLACK)
    # frente: cierre central, bolsillos con solapa, parche POLICIA, placa de nombre, escudo, hebilla
    rect(img, px(-0.004, 0), py(0.62), px(0.004, 0), py(0.915), BLACK)
    for sx in (-1, 1):
        cx = sx * 0.095
        rect(img, px(cx - 0.055, 0), py(0.735), px(cx + 0.055, 0), py(0.80), NAVY_LIGHT)         # solapa del bolsillo
        rect(img, px(cx - 0.055, 0), py(0.732), px(cx + 0.055, 0), py(0.737), BLACK)
        rect(img, px(cx - 0.055, 0), py(0.80), px(cx + 0.055, 0), py(0.803), BLACK)
    rect(img, px(-0.185, 0), py(0.825), px(-0.04, 0), py(0.875), BLACK)                           # placa POLICIA (lado derecho del policia, izquierda de la imagen)
    stamp(img, text_police, px(-0.178, 0), py(0.838), mx(0.126), my(0.026))
    rect(img, px(-0.185, 0), py(0.815), px(-0.04, 0), py(0.825), BLACK)
    checker(img, px(-0.185, 0), py(0.815), px(-0.04, 0), py(0.825), mx(0.008), LIME, BLACK)
    rect(img, px(0.04, 0), py(0.825), px(0.185, 0), py(0.87), BLACK)                              # placa del nombre
    stamp(img, text_name, px(0.047, 0), py(0.8365), mx(0.13), my(0.0215))
    rect(img, px(-0.012, 0), py(0.585), px(0.012, 0), py(0.61), SILVER)                           # hebilla
    stamp(img, text_number, px(0.04, 0), py(0.872), mx(0.075), my(0.012))
    # espalda: POLICIA grande con la franja de cuadros debajo
    stamp(img, text_police, px(-0.115, 1), py(0.830), mx(0.23), my(0.036))
    checker(img, px(-0.115, 1), py(0.808), px(0.115, 1), py(0.826), mx(0.0095), LIME, BLACK)
    # costados (mangas y piernas): zona 2 +x (izquierda del policia) y zona 3 -x. Aqui u = coordenada y (adelante-atras) del cuerpo.
    half = third / 2
    def side(zone, flag):
        x0 = 2 * third + zone * half
        # franja reflectiva en el brazalete y manga: bandas inclinadas sobre la parte alta de la manga
        if flag:   # bandera de Colombia en la manga
            for k, col in enumerate(((0.99, 0.80, 0.07, 1.0), (0.03, 0.14, 0.60, 1.0), (0.80, 0.07, 0.10, 1.0))):
                h = 0.016 if k == 0 else 0.008
                y0 = 0.885 - (0.016 if k > 0 else 0.0) - (0.008 if k > 1 else 0.0)
                rect(img, x0 + half * 0.3, py(y0), x0 + half * 0.7, py(y0 + h), col)
        # franja lateral de los pantalones
        rect(img, x0 + half * 0.47, py(0.0), x0 + half * 0.53, py(0.34), NAVY_LIGHT)
    side(0, True); side(1, False)
    img[:, :, 3] = 1.0
    image = bpy.data.images.new('policia_uniforme', SIZE, SIZE, alpha=True)
    image.pixels.foreach_set(np.clip(img, 0, 1).reshape(-1)); image.update()
    return image

def assign_uv(me, xmin, xmax, zmin, zmax, ymin, ymax):
    while len(me.uv_layers): me.uv_layers.remove(me.uv_layers[0])   # solo queda el mapa del uniforme: el de la prenda original no se exporta
    uv = me.uv_layers.new(name='UniformeUV')
    me.uv_layers.active = uv
    third = 1.0 / 3.0
    for poly in me.polygons:
        n = poly.normal
        if abs(n.y) >= abs(n.x) * 0.9:
            zone = 0 if n.y < 0 else 1             # el frente del personaje mira a -y
        else:
            zone = 2 if n.x > 0 else 3
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            vv = 1.0 - (v.z - zmin) / (zmax - zmin)   # el juego carga la textura sin voltear: v crece hacia abajo
            if zone < 2:
                uu = zone * third + ((v.x - xmin) / (xmax - xmin)) * third
                if zone == 1: uu = zone * third + (1 - (v.x - xmin) / (xmax - xmin)) * third   # la espalda se ve desde el otro lado
            else:
                t = (v.y - ymin) / (ymax - ymin)
                uu = 2 * third + (zone - 2) * (third / 2) + (t if zone == 2 else 1 - t) * (third / 2)
            uv.data[li].uv = (min(max(uu, 0.001), 0.999), min(max(vv, 0.001), 0.999))

def export_body(body, cloth):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, body, cloth + '.gltf'))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and len(o.data.vertices) > 100]
    for o in [o for o in bpy.data.objects if o.type == 'MESH' and o not in meshes]: bpy.data.objects.remove(o)
    for o in meshes:   # solo las caras con un material: se unifican y se reasignan despues
        o.data.materials.clear()
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1: bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active; obj.name = 'policia'; obj.data.name = 'policia'
    me = obj.data
    pts = np.array([v.co[:] for v in me.vertices])
    xmin, xmax = float(pts[:, 0].min()), float(pts[:, 0].max()); zmin, zmax = float(pts[:, 2].min()), float(pts[:, 2].max()); ymin, ymax = float(pts[:, 1].min()), float(pts[:, 1].max())
    xmid = (xmin + xmax) / 2; half = max(xmax - xmid, xmid - xmin); xmin, xmax = xmid - half, xmid + half   # simetrico respecto al eje del cuerpo
    image = paint_texture(xmin, xmax, zmin, zmax, body)
    assign_uv(me, xmin, xmax, zmin, zmax, ymin, ymax)
    mat = bpy.data.materials.new('policia_uniforme'); mat.use_nodes = True
    nt = mat.node_tree; b = nt.nodes.get('Principled BSDF')
    tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = image; nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85; b.inputs['Metallic'].default_value = 0.0
    me.materials.append(mat)
    for p in me.polygons: p.material_index = 0
    image.filepath_raw = os.path.join(ROOT, body, 'policia_uniforme.png'); image.file_format = 'PNG'; image.save()
    for ob in bpy.context.selected_objects: ob.select_set(False)
    obj.select_set(True); arm.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=os.path.join(ROOT, body, 'policia.gltf'), export_format='GLTF_SEPARATE', use_selection=True, export_apply=False,
                              export_animations=False, export_image_format='AUTO')
    print("LISTO", body, cloth, len(me.vertices), "vertices; x", round(xmin, 2), round(xmax, 2), "z", round(zmin, 2), round(zmax, 2))

for body, cloths in BASES:
    export_body(body, cloths[0])
