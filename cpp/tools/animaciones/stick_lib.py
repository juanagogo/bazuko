"""Render de figuras de palitos (y vehiculos de referencia) para revisar las animaciones sin malla de personaje."""
import bpy, bmesh, math
from mathutils import Vector, Matrix

def tube(bm, a, b, r, sides=6):
    d = b - a
    if d.length < 1e-5: return
    z = d.normalized()
    x = z.orthogonal().normalized(); y = z.cross(x)
    ring = []
    for end in (a, b):
        ring.append([bm.verts.new(end + (x * math.cos(2 * math.pi * i / sides) + y * math.sin(2 * math.pi * i / sides)) * r) for i in range(sides)])
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((ring[0][i], ring[0][j], ring[1][j], ring[1][i]))

def box(bm, center, size, rot=None):
    m = Matrix.Translation(center)
    if rot is not None: m = m @ rot.to_4x4()
    bmesh.ops.create_cube(bm, size=1.0, matrix=m @ Matrix.Diagonal((size[0], size[1], size[2], 1.0)))

def make_obj(name, bm, color):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.color = color
    return ob

def figure(rig, color=(0.95, 0.55, 0.2, 1)):
    bm = bmesh.new()
    for pb in rig.pose:
        n = pb.name.replace('mixamorig:', '')
        if 'Finger' in n or n.startswith(('LeftHandThumb', 'RightHandThumb')): pass
        r = 0.018 if 'Hand' in n and n[-1].isdigit() else 0.04 if n in ('Spine', 'Spine1', 'Spine2', 'Hips') else 0.03
        tube(bm, pb.head.copy(), pb.tail.copy(), r)
    head = rig.pose['mixamorig:Head']
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=8, radius=0.1, matrix=Matrix.Translation(head.tail + (head.tail - head.head) * 0.2))
    return make_obj('fig', bm, color)

def setup_render(w=640, h=480):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'OBJECT'
    sc.render.resolution_x = w; sc.render.resolution_y = h
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new('w') if sc.world is None else sc.world
    sc.world.color = (0.93, 0.94, 0.96)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.clip_start = 0.01; cam.data.clip_end = 100
    return cam

def shoot(cam, path, loc, target, scale):
    cam.location = loc
    d = Vector(target) - Vector(loc)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.ortho_scale = scale
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
