"""Repara las ruedas del Mercedes (public/models/vehiculos/mercedes_wheel*.glb):
- la llanta de banda dentada (material emitter_ch1, 850 vertices de baja resolucion) se cambia por una llanta lisa generada por revolucion;
- la rueda delantera derecha traia piezas sueltas del chasis y estaba descentrada: se rehace como espejo de la delantera izquierda.
Uso: python neumaticos.py <carpeta vehiculos>
"""
import json, math, struct, sys, pathlib

folder = pathlib.Path(sys.argv[1])


def load(path):
    data = path.read_bytes()
    jlen = struct.unpack('<I', data[12:16])[0]
    gltf = json.loads(data[20:20 + jlen])
    off = 20 + jlen
    blen = struct.unpack('<I', data[off:off + 4])[0]
    blob = bytearray(data[off + 8:off + 8 + blen])
    return gltf, blob


def save(path, gltf, blob):
    while len(blob) % 4: blob.append(0)
    gltf['buffers'][0]['byteLength'] = len(blob)
    js = json.dumps(gltf, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    total = 12 + 8 + len(js) + 8 + len(blob)
    out = struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(blob), 0x004E4942) + bytes(blob)
    path.write_bytes(out)


def accessor_view(gltf, blob, index):
    acc = gltf['accessors'][index]
    view = gltf['bufferViews'][acc['bufferView']]
    return acc, view['byteOffset'] + acc.get('byteOffset', 0), view.get('byteStride')


def mirror_x(gltf, blob):
    """Espejo en X: posiciones, normales (y tangentes) y orden de los triangulos."""
    for mesh in gltf['meshes']:
        for prim in mesh['primitives']:
            for name in ('POSITION', 'NORMAL', 'TANGENT'):
                if name not in prim['attributes']: continue
                acc, start, stride = accessor_view(gltf, blob, prim['attributes'][name])
                size = 16 if name == 'TANGENT' else 12
                step = stride or size
                for i in range(acc['count']):
                    o = start + i * step
                    x = struct.unpack_from('<f', blob, o)[0]
                    struct.pack_into('<f', blob, o, -x)
                    if name == 'TANGENT':
                        w = struct.unpack_from('<f', blob, o + 12)[0]
                        struct.pack_into('<f', blob, o + 12, -w)
                if name == 'POSITION' and 'min' in acc:
                    acc['min'][0], acc['max'][0] = -acc['max'][0], -acc['min'][0]
            if 'indices' in prim:
                acc, start, stride = accessor_view(gltf, blob, prim['indices'])
                fmt = {5123: '<H', 5125: '<I', 5121: '<B'}[acc['componentType']]
                size = struct.calcsize(fmt)
                for t in range(acc['count'] // 3):
                    o = start + t * 3 * size
                    b = struct.unpack_from(fmt, blob, o + size)[0]
                    c = struct.unpack_from(fmt, blob, o + 2 * size)[0]
                    struct.pack_into(fmt, blob, o + size, c)
                    struct.pack_into(fmt, blob, o + 2 * size, b)


def prim_bbox(gltf, prim):
    acc = gltf['accessors'][prim['attributes']['POSITION']]
    return acc['min'], acc['max']


def add_tire(gltf, blob, centre, radius, half_width, inner):
    """Llanta lisa por revolucion alrededor del eje X, con hombros redondeados."""
    profile = [(inner, 0.93), (inner + 0.03, 1.0), (radius - 0.045, 0.97), (radius - 0.016, 0.86), (radius, 0.55), (radius, 0.0)]
    profile = [(r, u * half_width) for r, u in profile]
    full = [(r, u) for r, u in profile] + [(r, -u) for r, u in reversed(profile[:-1])]
    segments = 56
    positions, normals, uvs, indices = [], [], [], []
    for pi, (r, u) in enumerate(full):
        prev_r, prev_u = full[max(pi - 1, 0)]
        next_r, next_u = full[min(pi + 1, len(full) - 1)]
        tr, tu = next_r - prev_r, next_u - prev_u   # tangente del perfil
        length = math.hypot(tr, tu) or 1.0
        nr, nu = tu / length, -tr / length   # normal en el plano (radio, eje)
        for s in range(segments + 1):
            a = s / segments * 2 * math.pi
            ca, sa = math.cos(a), math.sin(a)
            positions.append((centre[0] + u, centre[1] + r * ca, centre[2] + r * sa))
            normals.append((nu, nr * ca, nr * sa))
            uvs.append((s / segments, pi / (len(full) - 1)))
    rows = len(full)
    for pi in range(rows - 1):
        for s in range(segments):
            a = pi * (segments + 1) + s
            b = a + 1
            c = a + segments + 1
            d = c + 1
            indices += [a, c, b, b, c, d]

    def pack(fmt, items):
        out = bytearray()
        for item in items:
            out += struct.pack(fmt, *item) if isinstance(item, tuple) else struct.pack(fmt, item)
        return out

    def append(data, target):
        while len(blob) % 4: blob.append(0)
        offset = len(blob)
        blob.extend(data)
        gltf['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(data), 'target': target})
        return len(gltf['bufferViews']) - 1

    pv = append(pack('<fff', positions), 34962)
    nv = append(pack('<fff', normals), 34962)
    tv = append(pack('<ff', uvs), 34962)
    iv = append(pack('<I', indices), 34963)
    mins = [min(p[i] for p in positions) for i in range(3)]
    maxs = [max(p[i] for p in positions) for i in range(3)]

    def acc(view, ctype, count, typ, **extra):
        gltf['accessors'].append({'bufferView': view, 'componentType': ctype, 'count': count, 'type': typ, **extra})
        return len(gltf['accessors']) - 1

    pa = acc(pv, 5126, len(positions), 'VEC3', min=mins, max=maxs)
    na = acc(nv, 5126, len(normals), 'VEC3')
    ta = acc(tv, 5126, len(uvs), 'VEC2')
    ia = acc(iv, 5125, len(indices), 'SCALAR')
    gltf.setdefault('materials', []).append({'name': 'neumatico_liso', 'pbrMetallicRoughness': {'baseColorFactor': [0.025, 0.025, 0.028, 1.0], 'metallicFactor': 0.0, 'roughnessFactor': 0.92}})
    gltf['meshes'][0]['primitives'].append({'attributes': {'POSITION': pa, 'NORMAL': na, 'TEXCOORD_0': ta}, 'indices': ia, 'material': len(gltf['materials']) - 1, 'mode': 4})


def process(source_name, dest_name, mirror):
    gltf, blob = load(folder / source_name)
    if mirror: mirror_x(gltf, blob)
    mesh = gltf['meshes'][0]
    keep, tire_box = [], None
    for prim in mesh['primitives']:
        material = gltf['materials'][prim['material']]['name'] if 'material' in prim else ''
        if 'emitter_ch1' in material:
            tire_box = prim_bbox(gltf, prim)   # la banda dentada: su caja da el centro y el radio de la llanta
        else:
            keep.append(prim)
    mesh['primitives'] = keep
    lo, hi = tire_box
    centre = [(lo[i] + hi[i]) / 2 for i in range(3)]
    radius = (hi[1] - lo[1]) / 2
    half = (hi[0] - lo[0]) / 2
    add_tire(gltf, blob, centre, radius, half, radius - 0.1)
    save(folder / dest_name, gltf, blob)
    print(dest_name, 'centro', [round(c, 3) for c in centre], 'radio', round(radius, 3), 'ancho', round(half * 2, 3))
    return centre


process('mercedes_wheelLF.glb', 'mercedes_wheelLF.glb', False)
process('mercedes_wheelLR.glb', 'mercedes_wheelLR.glb', False)
process('mercedes_wheelRR.glb', 'mercedes_wheelRR.glb', False)
# la delantera derecha se rehace como espejo de la delantera izquierda (ya reparada)
gltf, blob = load(folder / 'mercedes_wheelLF.glb')
mirror_x(gltf, blob)
gltf['nodes'][0]['name'] = 'mercedes_wheelRF'
save(folder / 'mercedes_wheelRF.glb', gltf, blob)
print('mercedes_wheelRF.glb espejo de la LF')
