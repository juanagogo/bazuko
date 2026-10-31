"""Extrae solo esqueleto y clips usados; no duplica ropa ni texturas del juego."""
import json
from pathlib import Path
import struct

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'work/exportaciones/animaciones-actionforge.glb'
OUTPUT = ROOT / 'public/models/animaciones-actionforge.glb'
CLIPS = {'idle_loop_fit', 'walk_loop_fit', 'sprint_loop_fit', 'fixing_kneeling_fit',
         'idle_talking_loop_fit', 'consume_fit', 'crouch_idle_loop_fit', 'overhandthrow_fit', 'dance_loop_fit',
         'idle_foldarms_loop_fit', 'idle_talkingphone_loop_fit'}
raw = SOURCE.read_bytes()
assert struct.unpack_from('<II', raw) == (0x46546C67, 2)
size = struct.unpack_from('<I', raw, 12)[0]
g = json.loads(raw[20:20 + size])
original_binary = raw[28 + size:]
out = {'asset': {'version': '2.0', 'generator': 'Vagabundo animation bank'},
       'scene': 0, 'scenes': g['scenes'], 'nodes': g['nodes'], 'skins': g['skins'],
       'animations': [], 'accessors': [], 'bufferViews': []}
for node in out['nodes']:
    node.pop('mesh', None)
    node.pop('skin', None)
    node.pop('weights', None)
binary = bytearray()
accessors = {}


def copy_accessor(index):
    if index in accessors:
        return accessors[index]
    a = dict(g['accessors'][index])
    assert 'sparse' not in a
    view = dict(g['bufferViews'][a['bufferView']])
    assert view['buffer'] == 0
    start = view.get('byteOffset', 0)
    binary.extend(b'\0' * (-len(binary) % 4))
    view['byteOffset'] = len(binary)
    binary.extend(original_binary[start:start + view['byteLength']])
    a['bufferView'] = len(out['bufferViews'])
    out['bufferViews'].append(view)
    accessors[index] = len(out['accessors'])
    out['accessors'].append(a)
    return accessors[index]


for skin in out['skins']:
    skin['inverseBindMatrices'] = copy_accessor(skin['inverseBindMatrices'])
for clip in g['animations']:
    if clip['name'] not in CLIPS:
        continue
    for sampler in clip['samplers']:
        sampler['input'] = copy_accessor(sampler['input'])
        sampler['output'] = copy_accessor(sampler['output'])
    out['animations'].append(clip)
assert {c['name'] for c in out['animations']} == CLIPS
out['buffers'] = [{'byteLength': len(binary)}]
metadata = json.dumps(out, separators=(',', ':')).encode()
metadata += b' ' * (-len(metadata) % 4)
binary.extend(b'\0' * (-len(binary) % 4))
total = 28 + len(metadata) + len(binary)
OUTPUT.write_bytes(struct.pack('<III', 0x46546C67, 2, total)
                   + struct.pack('<II', len(metadata), 0x4E4F534A) + metadata
                   + struct.pack('<II', len(binary), 0x004E4942) + binary)
print(f'{OUTPUT}: {len(out["animations"])} clips, {total / 1024:.0f} KiB')
