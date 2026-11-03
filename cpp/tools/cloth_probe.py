import bpy, sys, json, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
P = "C:/Users/raull/Documentos/Proyectos/bazuko/public/models/personaje/"
def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    pts = []; polys = []; nrm = []
    for o in new:
        base = len(pts); mw = o.matrix_world
        pts += [mw @ v.co for v in o.data.vertices]
        nrm += [(mw.to_3x3() @ v.normal).normalized() for v in o.data.vertices]
        polys += [tuple(base + i for i in p.vertices) for p in o.data.polygons]
    return pts, polys, nrm
for folder in ('hombre-adulto', 'mujer-adulta'):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bp, bpoly, bn = load(P + folder + "/cuerpo.gltf")
    tree = BVHTree.FromPolygons(bp, bpoly)
    for cloth in (['camisa', 'chaqueta', 'camiseta', 'botas'] if 'hombre' in folder else ['camisa', 'botas']):
        path = P + folder + '/' + cloth + '.gltf'
        if not os.path.exists(path): continue
        cp, cpoly, cn = load(path)
        dist = []; inside = 0
        for v, n in zip(cp, cn):
            loc, nor, idx, d = tree.find_nearest(v)
            if loc is None: continue
            sgn = (v - loc).dot(nor)
            dist.append(sgn)
        d = np.array(dist)
        print(folder, cloth, 'vertices', len(d), '| dentro del cuerpo (<0):', round(float((d < 0).mean()) * 100, 1), '% | < 2 mm:', round(float((d < 0.002).mean()) * 100, 1), '% | < 5 mm:', round(float((d < 0.005).mean()) * 100, 1), '% | mediana mm', round(float(np.median(d)) * 1000, 1))
