"""Genera public/models/perro.glb: El Chato, perro criollo con esqueleto para animación procedural.

Uso: blender -b --factory-startup --python tools/modelos/generar_perro.py

La malla sale de un modificador Skin sobre un esqueleto de aristas y se subdivide una vez. Los pesos
se asignan por distancia a los huesos, así el resultado no depende de la heurística de Blender.
Los colores de vértice son tonos relativos: el juego multiplica el pelaje por el color elegido.
En Blender el perro mira a −Y; al exportar con Y arriba queda mirando a +Z, como en el juego.
"""
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'public/models/perro.glb'
SUBSURF_GROWTH = 1.35

# Nodos del esqueleto de la malla: nombre -> (posición, radio x, radio y)
NODES = {
    'cola_punta': ((0, .60, .66), .016, .016), 'cola_media': ((0, .49, .59), .026, .026),
    'cola_base': ((0, .36, .50), .038, .038), 'pelvis': ((0, .26, .44), .10, .115),
    'vientre': ((0, .03, .43), .105, .12), 'pecho': ((0, -.18, .45), .12, .15),
    'cuello': ((0, -.29, .56), .075, .08), 'cabeza': ((0, -.35, .65), .095, .09),
    'hocico': ((0, -.47, .625), .055, .05), 'trufa': ((0, -.53, .62), .034, .03),
}
EDGES = [('cola_punta', 'cola_media'), ('cola_media', 'cola_base'), ('cola_base', 'pelvis'),
         ('pelvis', 'vientre'), ('vientre', 'pecho'), ('pecho', 'cuello'), ('cuello', 'cabeza'),
         ('cabeza', 'hocico'), ('hocico', 'trufa')]
for side, s in (('L', 1), ('R', -1)):
    NODES.update({
        f'hombro_{side}': ((s * .07, -.18, .39), .055, .06), f'codo_{side}': ((s * .08, -.19, .24), .042, .044),
        f'muneca_{side}': ((s * .08, -.18, .07), .032, .034), f'mano_{side}': ((s * .08, -.215, .028), .038, .028),
        f'cadera_{side}': ((s * .07, .26, .39), .07, .08), f'rodilla_{side}': ((s * .08, .20, .25), .05, .05),
        f'corvejon_{side}': ((s * .08, .28, .11), .032, .034), f'pie_{side}': ((s * .08, .245, .028), .038, .028),
        f'oreja_{side}': ((s * .055, -.33, .73), .035, .035), f'oreja_punta_{side}': ((s * .11, -.355, .615), .045, .013),
    })
    EDGES += [('pecho', f'hombro_{side}'), (f'hombro_{side}', f'codo_{side}'), (f'codo_{side}', f'muneca_{side}'),
              (f'muneca_{side}', f'mano_{side}'), ('pelvis', f'cadera_{side}'), (f'cadera_{side}', f'rodilla_{side}'),
              (f'rodilla_{side}', f'corvejon_{side}'), (f'corvejon_{side}', f'pie_{side}'),
              ('cabeza', f'oreja_{side}'), (f'oreja_{side}', f'oreja_punta_{side}')]

# Huesos: nombre -> (cabeza, cola, padre). Los nombres sin puntos sobreviven a three.js.
P = {name: Vector(node[0]) for name, node in NODES.items()}
BONES = {
    'raiz': (Vector((0, 0, 0)), Vector((0, 0, .2)), None),
    'pelvis': (P['pelvis'], P['vientre'], 'raiz'),
    'pecho': (P['vientre'], P['pecho'], 'pelvis'),
    'cuello': (P['pecho'] + Vector((0, 0, .04)), P['cuello'] + Vector((0, -.02, .03)), 'pecho'),
    'cabeza': (P['cuello'] + Vector((0, -.02, .03)), P['hocico'], 'cuello'),
    'cola_1': (P['pelvis'] + Vector((0, .03, .02)), P['cola_base'], 'pelvis'),
    'cola_2': (P['cola_base'], P['cola_media'], 'cola_1'),
    'cola_3': (P['cola_media'], P['cola_punta'], 'cola_2'),
}
for side in 'LR':
    BONES.update({
        f'oreja_{side}': (P[f'oreja_{side}'], P[f'oreja_punta_{side}'], 'cabeza'),
        f'brazo_{side}': (P[f'hombro_{side}'], P[f'codo_{side}'], 'pecho'),
        f'antebrazo_{side}': (P[f'codo_{side}'], P[f'muneca_{side}'], f'brazo_{side}'),
        f'mano_{side}': (P[f'muneca_{side}'], P[f'mano_{side}'] + Vector((0, -.03, 0)), f'antebrazo_{side}'),
        f'muslo_{side}': (P[f'cadera_{side}'], P[f'rodilla_{side}'], 'pelvis'),
        f'pierna_{side}': (P[f'rodilla_{side}'], P[f'corvejon_{side}'], f'muslo_{side}'),
        f'pie_{side}': (P[f'corvejon_{side}'], P[f'pie_{side}'] + Vector((0, -.03, 0)), f'pierna_{side}'),
    })


def skin_body():
    names = list(NODES)
    mesh = bpy.data.meshes.new('perro')
    mesh.from_pydata([NODES[n][0] for n in names], [(names.index(a), names.index(b)) for a, b in EDGES], [])
    body = bpy.data.objects.new('perro', mesh)
    bpy.context.collection.objects.link(body)
    skin = body.modifiers.new('skin', 'SKIN')
    skin.use_smooth_shade = True
    for i, name in enumerate(names):
        # La subdivisión encoge el volumen del Skin; los radios se compensan.
        mesh.skin_vertices[0].data[i].radius = [r * SUBSURF_GROWTH for r in NODES[name][1:]]
    mesh.skin_vertices[0].data[names.index('pecho')].use_root = True
    sub = body.modifiers.new('sub', 'SUBSURF')
    sub.levels = 1
    bpy.context.view_layer.objects.active = body
    for modifier in list(body.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    return body


def material(name, color, roughness):
    """El exportador toma el color del nodo Principled, no el color de vista."""
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    bsdf = result.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    return result


def details(body):
    """Ojos y trufa: piezas aparte con el material sin teñir, unidas a la malla del cuerpo."""
    parts = []
    for s in (1, -1):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=.017, location=(s * .056, -.425, .70))
        parts.append(bpy.context.object)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=.026, location=(0, -.532, .635))
    nose = bpy.context.object
    nose.scale = (1.15, .8, .85)
    parts.append(nose)
    detail = material('detalle', (.02, .016, .012, 1), .35)
    for part in parts:
        part.data.materials.append(detail)
        part.data.polygons.foreach_set('use_smooth', [True] * len(part.data.polygons))
    coat = material('pelaje', (1, 1, 1, 1), .9)
    body.data.materials.append(coat)
    body.data.materials.append(detail)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts + [body]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    return body


def shade(co):
    """Tono relativo del pelaje: lomo oscuro, pecho, vientre y patas claros, hocico y orejas oscuros."""
    x, y, z = co
    if co.y < -.455 or (abs(x) > .05 and z > .63 and -.4 < y < -.3):  # hocico y orejas
        return .32
    if z < .07:  # medias blancas
        return 1.15
    spine = .44 + max(0, -y - .18) * .9 if y < -.18 else .44
    if -.3 < y < .3 and z > spine + .06 and abs(x) < .09:  # silla del lomo
        return .55
    if (y < -.2 and z < .50 and abs(x) < .07) or (-.2 < y < .25 and z < .35 and abs(x) < .08):  # pecho y vientre
        return 1.1
    if y > .5:  # punta de la cola
        return 1.1
    return .85


def color(body):
    attribute = body.data.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for loop in body.data.loops:
        vertex = body.data.vertices[loop.vertex_index]
        # El atributo se exporta lineal: se convierte el tono para que el contraste se vea en pantalla.
        value = min(1, shade(vertex.co) / 1.15) ** 2.2
        attribute.data[loop.index].color = (value, value, value, 1)
    # Ojos y trufa usan su propio material; el tono no les afecta.
    body.data.color_attributes.active_color = attribute


def rig(body):
    armature = bpy.data.armatures.new('esqueleto')
    rig_object = bpy.data.objects.new('esqueleto', armature)
    bpy.context.collection.objects.link(rig_object)
    bpy.context.view_layer.objects.active = rig_object
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (head, tail, parent) in BONES.items():
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        bone.roll = 0
        if parent:
            bone.parent = armature.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    skinned = [name for name in BONES if name != 'raiz']
    groups = {name: body.vertex_groups.new(name=name) for name in skinned}
    segments = {name: (BONES[name][0], BONES[name][1]) for name in skinned}
    for vertex in body.data.vertices:
        distances = []
        for name, (a, b) in segments.items():
            point, t = intersect_point_line(vertex.co, a, b)
            point = a if t < 0 else b if t > 1 else point
            # Patas y orejas solo toman vértices de su propio lado.
            side = name[-1] if name[-2:] in ('_L', '_R') else None
            if side and (vertex.co.x > 0) != (side == 'L'):
                continue
            distances.append(((vertex.co - point).length + 1e-4, name))
        distances.sort()
        nearest = distances[:2]
        weights = [1 / d ** 6 for d, _ in nearest]
        total = sum(weights)
        for (d, name), w in zip(nearest, weights):
            groups[name].add([vertex.index], w / total, 'REPLACE')
    body.parent = rig_object
    modifier = body.modifiers.new('esqueleto', 'ARMATURE')
    modifier.object = rig_object
    return rig_object


bpy.ops.wm.read_factory_settings(use_empty=True)
body = details(skin_body())
color(body)
rig(body)
body.data.calc_loop_triangles()
print(f'El Chato: {len(body.data.vertices)} vértices, {len(body.data.loop_triangles)} triángulos')
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', export_skins=True, export_animations=False,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_yup=True,
                          export_cameras=False, export_lights=False)
print(f'Exportado {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size // 1024} KiB)')
