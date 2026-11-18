"""Separa las cuatro puertas de la Hilux, cuya carroceria venia en una sola pieza, para que la limpieza social pueda abrirlas al bajarse
(y la del conductor del trafico tambien). Cada puerta es un prisma lateral con el perfil (y, z) medido sobre la vista de lado del modelo,
entre la lamina y el panel interior (|x| de 0,63 a 1,03 en Blender): las caras de la carroceria cuyo centro cae adentro pasan a su pieza
(cortadas antes sobre los planos del prisma para que el borde quede recto). Escribe hilux_door.glb (conductor), hilux_doorFR/RL/RR.glb,
la carroceria sin puertas y hilux.json con "door" y "doors" (bisagras como convert_puertas.py); el ultimo asiento trasero pasa a la izquierda.
Uso (desde la carroceria y el json originales, de una sola pieza):
  blender --background --python cortar_puertas_hilux.py -- <hilux_body.glb original> <hilux.json original> <carpeta de salida>
"""
import bpy, bmesh, json, os, sys
import numpy as np
from mathutils import Vector
ARGS = sys.argv[sys.argv.index('--') + 1:]
SRC, JSRC, OUT = ARGS[0], ARGS[1], ARGS[2]
X0, X1 = 0.63, 1.03
FRONT = [(-0.915, 0.50), (0.118, 0.50), (0.118, 1.69), (-0.29, 1.69), (-0.87, 1.38), (-0.915, 1.30)]
REAR = [(0.124, 0.50), (0.93, 0.50), (0.99, 0.60), (0.99, 1.69), (0.124, 1.69)]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
for o in [o for o in bpy.data.objects if o.type == 'MESH']:
    mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world.identity()
for o in list(bpy.data.objects):
    if o.type != 'MESH': bpy.data.objects.remove(o)
body = [o for o in bpy.data.objects if o.type == 'MESH'][0]

def inside_poly(y, z, poly):
    res = np.zeros(len(y), bool); n = len(poly)
    for i in range(n):
        y1, z1 = poly[i]; y2, z2 = poly[(i + 1) % n]
        cross = ((z1 > z) != (z2 > z)) & (y < (y2 - y1) * (z - z1) / (z2 - z1 + 1e-12) + y1)
        res ^= cross
    return res

def take(poly, side, name):
    me = body.data
    xlo, xhi = (X0, X1) if side > 0 else (-X1, -X0)
    ys = [p[0] for p in poly]; zs = [p[1] for p in poly]
    lo = np.array([xlo, min(ys), min(zs)]); hi = np.array([xhi, max(ys), max(zs)])
    planes = [((xlo, 0, 0), (1, 0, 0)), ((xhi, 0, 0), (-1, 0, 0))]
    for i in range(len(poly)):
        (y1, z1), (y2, z2) = poly[i], poly[(i + 1) % len(poly)]
        planes.append(((0, y1, z1), (0, -(z2 - z1), (y2 - y1))))
    for co, no in planes:
        b = bmesh.new(); b.from_mesh(me)
        near = [f for f in b.faces if any(all(lo[i] - 0.03 <= v.co[i] <= hi[i] + 0.03 for i in range(3)) for v in f.verts)]
        geom = list(near) + list({e for f in near for e in f.edges}) + list({v for f in near for v in f.verts})
        bmesh.ops.bisect_plane(b, geom=geom, plane_co=co, plane_no=Vector(no).normalized())
        b.to_mesh(me); b.free()
    n = len(me.polygons)
    c = np.empty(n * 3, dtype=np.float32); me.polygons.foreach_get('center', c); c = c.reshape(n, 3)
    keep = (c[:, 0] >= xlo - 1e-4) & (c[:, 0] <= xhi + 1e-4) & inside_poly(c[:, 1], c[:, 2], poly)
    keep = set(np.nonzero(keep)[0].tolist())
    b = bmesh.new(); b.from_mesh(me); b.faces.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[f for f in b.faces if f.index not in keep], context='FACES')
    pm = bpy.data.meshes.new(name); b.to_mesh(pm); b.free()
    for m in me.materials: pm.materials.append(m)
    piece = bpy.data.objects.new(name, pm); bpy.context.scene.collection.objects.link(piece)
    b = bmesh.new(); b.from_mesh(me); b.faces.ensure_lookup_table()
    bmesh.ops.delete(b, geom=[f for f in b.faces if f.index in keep], context='FACES')
    for v in [v for v in b.verts if not v.link_faces]: b.verts.remove(v)
    b.to_mesh(me); b.free()
    print("PIEZA", name, len(keep), "caras")
    return piece

def hinge(piece, side):
    pts = np.array([v.co[:] for v in piece.data.vertices])
    xs = np.sort(np.abs(pts[:, 0])); skin = xs[int(len(xs) * 0.9)]
    return [round(float(side * (skin - 0.02)), 5), round(float((pts[:, 2].min() + pts[:, 2].max()) / 2), 5), round(float(-(pts[:, 1].min() + 0.02)), 5)]

def export(o, path):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=False, export_animations=False,
                              export_yup=True, export_image_format='AUTO')

info = json.load(open(JSRC, encoding='utf-8'))
fl = take(FRONT, 1, 'hilux_door')
pieces = [('doorFR', take(FRONT, -1, 'hilux_doorFR'), -1, 0), ('doorRL', take(REAR, 1, 'hilux_doorRL'), 1, 1), ('doorRR', take(REAR, -1, 'hilux_doorRR'), -1, 1)]
export(fl, os.path.join(OUT, 'hilux_door.glb'))
pts = np.array([v.co[:] for v in fl.data.vertices])
info['door'] = {'hinge': hinge(fl, 1), 'length': round(float(pts[:, 1].max() - pts[:, 1].min()), 4), 'zmin': round(float(pts[:, 2].min()), 4), 'zmax': round(float(pts[:, 2].max()), 4)}
info['doors'] = []
for part, piece, side, row in pieces:
    export(piece, os.path.join(OUT, 'hilux_' + part + '.glb'))
    info['doors'].append({'part': part, 'hinge': hinge(piece, side), 'side': side, 'row': row})
export(body, os.path.join(OUT, 'hilux_body.glb'))
# los dos asientos traseros: el json traia el derecho dos veces; el ultimo pasa a la izquierda (+x en glTF)
if len(info.get('seats', [])) >= 4: info['seats'][3]['pos'][0] = abs(info['seats'][3]['pos'][0])
json.dump(info, open(os.path.join(OUT, 'hilux.json'), 'w', encoding='utf-8'))
print("LISTO", info['door'], info['doors'])
