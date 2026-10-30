import bpy, bmesh, json, os, math, mathutils
from mathutils import Vector

ROOT = r"C:\Users\raull\Documentos\Proyectos\bazuko\public\models"
OUT = os.path.join(ROOT, "vehiculos")
CARS = {
    'raptor': dict(src=r"vehiculos animados\raptor\Ford_F150_Raptor.glb", length=5.2,
                   seats=[(0.46, -0.55, 0.95, True), (-0.46, -0.55, 0.95, False), (-0.46, 0.43, 0.90, False), (0.46, 0.43, 0.90, False), (0.0, 0.43, 0.90, False)]),
    'renault6': dict(src=r"vehiculos animados\renault_6\Renault_6.glb", length=4.2,
                     seats=[(0.92, -0.40, 1.45, True), (-0.92, -0.40, 1.45, False), (-0.92, 1.6, 1.5, False), (0.92, 1.6, 1.5, False)]),
}

def make_material(name, rgba, alpha=1.0, blend=False):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba
    bsdf.inputs['Alpha'].default_value = alpha
    bsdf.inputs['Roughness'].default_value = 0.3 if blend else 0.8
    if blend:
        if hasattr(m, 'surface_render_method'): m.surface_render_method = 'BLENDED'
        if hasattr(m, 'blend_method'):
            try: m.blend_method = 'BLEND'
            except Exception: pass
    return m

def opaque(mat):
    if hasattr(mat, 'surface_render_method'): mat.surface_render_method = 'DITHERED'
    if hasattr(mat, 'blend_method'):
        try: mat.blend_method = 'OPAQUE'
        except Exception: pass
    if mat.node_tree:
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                for l in list(n.inputs['Alpha'].links): mat.node_tree.links.remove(l)
                n.inputs['Alpha'].default_value = 1.0

def g(v): return [round(v.x, 5), round(v.z, 5), round(-v.y, 5)]   # Blender -> glTF (x, z, -y)

def export(o, fname):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname), export_format='GLB', use_selection=True, export_apply=False,
                              export_animations=False, export_yup=True, export_image_format='JPEG', export_jpeg_quality=88)

def join(objs, name):
    for ob in bpy.context.selected_objects: ob.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    objs[0].name = name; objs[0].data.name = name
    return objs[0]

def kasa(pts):
    n = len(pts); sx = sum(p[0] for p in pts) / n; sy = sum(p[1] for p in pts) / n
    suu = suv = svv = suuu = svvv = suvv = svuu = 0.0
    for a, b in pts:
        u = a - sx; w = b - sy
        suu += u * u; svv += w * w; suv += u * w; suuu += u ** 3; svvv += w ** 3; suvv += u * w * w; svuu += w * u * u
    det = suu * svv - suv * suv
    uc = (0.5 * (suuu + suvv) * svv - 0.5 * (svvv + svuu) * suv) / det
    vc = (0.5 * (svvv + svuu) * suu - 0.5 * (suuu + suvv) * suv) / det
    return uc + sx, vc + sy

glass = None
for stem, cfg in CARS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, cfg['src']))
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        mw = o.matrix_world.copy(); o.parent = None; o.data.transform(mw); o.matrix_world = mathutils.Matrix.Identity(4)
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or o.name.startswith('Box001'): bpy.data.objects.remove(o)
    for m in bpy.data.materials: opaque(m)
    glass = make_material('Cristal', (0.05, 0.09, 0.11, 1.0), 0.28, True)
    for img in bpy.data.images:
        lim = 512 if 'wheel' in img.name.lower() else 2048
        if max(img.size) > lim:
            s = lim / max(img.size); img.scale(max(1, int(img.size[0] * s)), max(1, int(img.size[1] * s)))
    wheels = [o for o in bpy.data.objects if '_WHEEL_' in o.name]
    body = [o for o in bpy.data.objects if o not in wheels]
    for o in body:
        if '_Glass_' in o.name:
            o.data.materials.clear(); o.data.materials.append(glass)
    door = [o for o in body if o.name.startswith('LF_DOOR')]      # puerta del conductor: pieza aparte que gira sobre su bisagra
    body = [o for o in body if o not in door]
    door_info = None
    if door:
        base_door = next(o for o in door if '_Base_' in o.name)
        xs = sorted(v.co.x for v in base_door.data.vertices)
        ys_d = [v.co.y for v in base_door.data.vertices]; zs_d = [v.co.z for v in base_door.data.vertices]
        skin_x = xs[int(len(xs) * 0.9)]
        hinge_b = Vector((skin_x - 0.02, min(ys_d) + 0.02, (min(zs_d) + max(zs_d)) / 2))   # borde delantero (-Y), a la altura media
        door_info = {'hinge': g(hinge_b), 'length': round(max(ys_d) - min(ys_d), 4), 'zmin': round(min(zs_d), 4), 'zmax': round(max(zs_d), 4)}
    info = {'wheels': [], 'seats': [], 'targetLength': cfg['length']}
    allmin = Vector((1e9, 1e9, 1e9)); allmax = Vector((-1e9, -1e9, -1e9))
    tris = 0
    for o in wheels:
        tag = o.name.split('_WHEEL_')[0]                      # LF, LR, RF, RR
        pts = [(v.co.y, v.co.z) for v in o.data.vertices]
        cy, cz = kasa(pts)
        radius = max(math.hypot(a - cy, b - cz) for a, b in pts)
        xs = [v.co.x for v in o.data.vertices]; cx = (min(xs) + max(xs)) / 2
        front = (sum(v.co.y for v in o.data.vertices) / len(o.data.vertices)) < 0   # el frente es -Y
        o.data.calc_loop_triangles(); tris += len(o.data.loop_triangles)
        for v in o.data.vertices:
            allmin = Vector(min(allmin[i], v.co[i]) for i in range(3)); allmax = Vector(max(allmax[i], v.co[i]) for i in range(3))
        part = 'wheel' + tag
        export(o, '%s_%s.glb' % (stem, part))
        info['wheels'].append({'part': part, 'center': g(Vector((cx, cy, cz))), 'radius': round(radius, 4), 'front': front})
    if door:
        d = join(door, stem + '_door'); d.data.calc_loop_triangles(); tris += len(d.data.loop_triangles)
        for v in d.data.vertices:
            allmin = Vector(min(allmin[i], v.co[i]) for i in range(3)); allmax = Vector(max(allmax[i], v.co[i]) for i in range(3))
        export(d, stem + '_door.glb')
        info['door'] = door_info
    b = join(body, stem + '_body')
    b.data.calc_loop_triangles(); tris += len(b.data.loop_triangles)
    for v in b.data.vertices:
        allmin = Vector(min(allmin[i], v.co[i]) for i in range(3)); allmax = Vector(max(allmax[i], v.co[i]) for i in range(3))
    export(b, stem + '_body.glb')
    for (x, y, z, driver) in cfg['seats']:
        info['seats'].append({'pos': g(Vector((x, y, z))), 'yaw': 0.0, 'driver': driver})
    lo, hi = g(allmin), g(allmax)
    info['min'] = [min(lo[i], hi[i]) for i in range(3)]; info['max'] = [max(lo[i], hi[i]) for i in range(3)]
    info['tris'] = tris
    json.dump(info, open(os.path.join(OUT, stem + '.json'), 'w'), indent=1)
    print("LISTO", stem, tris, "triangulos")
