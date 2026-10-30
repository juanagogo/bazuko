"""Separa las demas puertas de cada vehiculo con puerta del conductor articulada, para que las cuatro puedan abrirse y cerrarse (hasta 4 ocupantes).
Para cada <modelo>_body.glb y <modelo>_door.glb de public/models/vehiculos:
  - puerta delantera del acompanante: imagen espejo (x -> -x) de la del conductor (<modelo>_doorFR.glb);
  - puertas traseras (solo modelos de cuatro puertas): la caja de la puerta delantera corrida hacia atras, con `rear` veces su largo (<modelo>_doorRL.glb y <modelo>_doorRR.glb).
Las caras de la carroceria cuyo centro cae dentro de cada caja pasan a su pieza y se quitan de la carroceria. Se anade al json del modelo la lista "doors"
con la bisagra (borde delantero, eje vertical) de cada una. Si el json ya trae "doors" el modelo se omite.
Uso: blender --background --python convert_puertas.py
"""
import bpy, bmesh, json, os
import numpy as np

OUT = r"C:\Users\raull\Documentos\Proyectos\bazuko\public\models\vehiculos"
# modelo: largo de la puerta trasera como fraccion de la delantera (None = dos puertas)
MODELS = {'mercedes': None, 'patrulla': 0.57, 'raptor': 0.85, 'renault6': 0.8}


def bake_and_clean():
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = o.matrix_world.__class__.Identity(4)
    for o in list(bpy.data.objects):
        if o.type != 'MESH': bpy.data.objects.remove(o)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    bake_and_clean()
    return [o for o in objs if o.name in bpy.data.objects and o.type == 'MESH']


def join(objs, name):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    objs[0].name = name; objs[0].data.name = name
    return objs[0]


def export(o, path):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_animations=False,
                              export_yup=True, export_image_format='JPEG', export_jpeg_quality=90)


def take_faces(body, box_lo, box_hi, name):
    """Mueve a una pieza nueva las caras de `body` cuyo centro cae en la caja; devuelve (pieza, caras)."""
    me = body.data
    # los triangulos grandes de la lamina cruzan los bordes de la caja: se cortan exactamente sobre sus seis planos, para que el borde de la puerta quede recto (sin sierra)
    b = bmesh.new(); b.from_mesh(me)
    for axis in range(3):
        for sign, limit in ((1.0, box_lo[axis]), (-1.0, box_hi[axis])):
            near = [f for f in b.faces if all(-0.02 <= v.co[i] - box_lo[i] and v.co[i] - box_hi[i] <= 0.02 for v in f.verts for i in range(3)) or
                    any(all(box_lo[i] - 0.02 <= v.co[i] <= box_hi[i] + 0.02 for i in range(3)) for v in f.verts)]
            geom = list(near) + list({e for f in near for e in f.edges}) + list({v for f in near for v in f.verts})
            no = [0.0, 0.0, 0.0]; no[axis] = sign; co = [0.0, 0.0, 0.0]; co[axis] = float(limit)
            bmesh.ops.bisect_plane(b, geom=geom, plane_co=co, plane_no=no)
    b.to_mesh(me); b.free()
    n = len(me.polygons)
    centers = np.empty(n * 3, dtype=np.float32); me.polygons.foreach_get('center', centers); centers = centers.reshape(n, 3)
    eps = 1e-4
    inside = np.all((centers >= box_lo - eps) & (centers <= box_hi + eps), axis=1)
    if inside.sum() < 20: return None, int(inside.sum())
    keep = set(np.nonzero(inside)[0].tolist())
    b = bmesh.new(); b.from_mesh(me); b.faces.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[f for f in b.faces if f.index not in keep], context='FACES')
    for v in [v for v in b.verts if not v.link_faces]: b.verts.remove(v)
    piece_mesh = bpy.data.meshes.new(name); b.to_mesh(piece_mesh); b.free()
    for m in me.materials: piece_mesh.materials.append(m)
    piece = bpy.data.objects.new(name, piece_mesh); bpy.context.scene.collection.objects.link(piece)
    b = bmesh.new(); b.from_mesh(me); b.faces.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[f for f in b.faces if f.index in keep], context='FACES')
    for v in [v for v in b.verts if not v.link_faces]: b.verts.remove(v)
    b.to_mesh(me); b.free()
    return piece, int(inside.sum())


def hinge_of(piece, side):
    """Bisagra en coordenadas glTF (x, y, z): borde delantero de la puerta (el frente del carro es -y en Blender), a la altura media y pegada a la lamina."""
    pts = np.array([v.co[:] for v in piece.data.vertices])
    xs = np.sort(np.abs(pts[:, 0])); skin = xs[int(len(xs) * 0.9)]
    return [round(float(side * (skin - 0.02)), 5), round(float((pts[:, 2].min() + pts[:, 2].max()) / 2), 5), round(float(-(pts[:, 1].min() + 0.02)), 5)]


for stem, rear_ratio in MODELS.items():
    body_path = os.path.join(OUT, stem + '_body.glb'); door_path = os.path.join(OUT, stem + '_door.glb'); json_path = os.path.join(OUT, stem + '.json')
    if not (os.path.exists(body_path) and os.path.exists(door_path) and os.path.exists(json_path)):
        print("OMITIDO", stem, "(faltan archivos)"); continue
    info = json.load(open(json_path, encoding='utf-8'))
    if 'doors' in info:
        print("YA HECHO", stem); continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body = join(import_glb(body_path), stem + '_body')
    door_objs = import_glb(door_path)
    pts = np.array([v.co[:] for o in door_objs for v in o.data.vertices])
    lo, hi = pts.min(0), pts.max(0)           # puerta del conductor (+x)
    pad = np.array([0.0, 0.0, 0.0])
    pieces = []                                # (parte, pieza, lado, fila)
    # delantera del acompanante: espejo
    piece, count = take_faces(body, np.array([-hi[0], lo[1], lo[2]]) - pad, np.array([-lo[0], hi[1], hi[2]]) + pad, stem + '_doorFR')
    print(stem, "puerta delantera del acompanante:", count, "caras")
    if piece: pieces.append(('doorFR', piece, -1, 0))
    if rear_ratio:
        length = hi[1] - lo[1]
        y0, y1 = hi[1] - 0.01, hi[1] + rear_ratio * length             # la parte de atras es +y
        for part, side in (('doorRL', 1), ('doorRR', -1)):
            x0, x1 = (lo[0], hi[0]) if side > 0 else (-hi[0], -lo[0])
            piece, count = take_faces(body, np.array([x0, y0, lo[2]]) - pad, np.array([x1, y1, hi[2]]) + pad, stem + '_' + part)
            print(stem, "puerta trasera", part, ":", count, "caras")
            if piece: pieces.append((part, piece, side, 1))
    doors = []
    for part, piece, side, row in pieces:
        export(piece, os.path.join(OUT, stem + '_' + part + '.glb'))
        doors.append({'part': part, 'hinge': hinge_of(piece, side), 'side': side, 'row': row})
    export(body, body_path)
    info['doors'] = doors
    json.dump(info, open(json_path, 'w', encoding='utf-8'), indent=1)
    print("LISTO", stem, [d['part'] for d in doors], "carroceria", len(body.data.polygons), "caras")
