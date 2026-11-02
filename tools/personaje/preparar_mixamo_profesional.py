"""Banco de revisión Mixamo, Blender 5.2+. No modifica recursos del juego.

blender -b --factory-startup --python preparar_mixamo_profesional.py -- \
  carpeta_fbx work/mixamo/banco.glb [--manifest clips.json] [--overwrite]

El manifiesto opcional contiene {"clips": [{"file": "Walking.fbx", "name": "walk",
"loop": true, "seam_frames": 4, "source_label": "Walking / Mixamo"}]}.
Se guarda GLB sin mallas, .blend editable y un informe JSON. Los originales
permanecen intactos. El controlador del juego es dueño de la traslación horizontal.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys

import bpy
from mathutils import Matrix

LOOPS = {"idle", "walk", "run", "pedir", "dormir", "nadar", "flotar"}
ALIASES = {"walking": "walk", "running": "run", "standing_idle": "idle", "waving": "saludo"}


def canonical_bone(name):
    # Keep exactly the names consumed by the current character retargeter.
    match = re.match(r"mixamorig(?:\d*)[:_]?(.+)", name, re.IGNORECASE)
    return "mixamorig:" + match.group(1) if match else name


def curves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", ()):
                yield from bag.fcurves


def bind_action(rig, action):
    rig.animation_data_create()
    rig.animation_data.action = action
    if action.slots:
        rig.animation_data.action_slot = action.slots[0]


def sample_clip(rig, action, start, end, fps):
    bind_action(rig, action)
    source_fps = bpy.context.scene.render.fps / bpy.context.scene.render.fps_base
    seconds = (end - start) / source_fps
    steps = max(1, round(seconds * fps))
    samples = []
    for index in range(steps + 1):
        frame = start + (end - start) * index / steps
        bpy.context.scene.frame_set(math.floor(frame), subframe=frame % 1)
        samples.append({b.name: tuple(v.copy() for v in b.matrix_basis.decompose()) for b in rig.pose.bones})
    return samples, seconds


def seam_metrics(samples, rig):
    first, last = samples[0], samples[-1]
    position_deltas = []
    for name, values in first.items():
        delta = rig.matrix_world.to_3x3() @ rig.data.bones[name].matrix_local.to_3x3() @ (values[0] - last[name][0])
        # Blender world Z is up. The runtime owns the root's ground-plane motion.
        position_deltas.append(abs(delta.z) if name == 'mixamorig:Hips' else delta.length)
    return {
        "max_rotation_degrees": max(math.degrees(2 * math.acos(min(1, abs(a[1].normalized().dot(last[n][1].normalized()))))) for n, a in first.items()),
        "max_local_position_delta": max((a[0] - last[n][0]).length for n, a in first.items()),
        "max_loop_world_position_delta": max(position_deltas),
    }


def close_loop(samples, count, rig):
    """Overlap matching head/tail windows; never smooth the entire mocap clip."""
    before = seam_metrics(samples, rig)
    if count <= 0 or (before["max_rotation_degrees"] < .5 and before["max_loop_world_position_delta"] < .0001):
        return samples, {"before": before, "after": before, "overlap_frames": 0}
    count = min(count, max(1, (len(samples) - 1) // 5))
    result = list(samples)
    for i in range(count + 1):
        weight = i / count
        weight = weight * weight * (3 - 2 * weight)
        tail, head = samples[len(samples) - count - 1 + i], samples[i]
        result[len(samples) - count - 1 + i] = {
            name: (values[0].lerp(head[name][0], weight), values[1].slerp(head[name][1], weight), values[2].lerp(head[name][2], weight))
            for name, values in tail.items()
        }
        if 'mixamorig:Hips' in tail:
            name = 'mixamorig:Hips'
            basis = rig.matrix_world.to_3x3() @ rig.data.bones[name].matrix_local.to_3x3()
            original = basis @ tail[name][0]
            location, rotation, scale = result[len(samples) - count - 1 + i][name]
            adjusted = basis @ location
            adjusted.x, adjusted.y = original.x, original.y
            result[len(samples) - count - 1 + i][name] = (basis.inverted() @ adjusted, rotation, scale)
    result = result[count:]
    return result, {"before": before, "after": seam_metrics(result, rig), "overlap_frames": count}


def same_rig(main, candidate):
    if set(main.data.bones.keys()) != set(candidate.data.bones.keys()):
        raise ValueError("Los FBX deben usar el mismo personaje de Mixamo: los huesos difieren")
    for bone in main.data.bones:
        other = candidate.data.bones[bone.name]
        difference = max(abs(a - b) for row_a, row_b in zip(bone.matrix_local, other.matrix_local) for a, b in zip(row_a, row_b))
        if difference > .001:
            raise ValueError(f"Pose de enlace distinta en {bone.name}; descarga todos los clips sobre el mismo personaje")
    if max(abs(a-b) for ra, rb in zip(main.matrix_world, candidate.matrix_world) for a, b in zip(ra, rb)) > .001:
        raise ValueError("Los FBX tienen escalas/orientaciones de objeto distintas")


def bake_action(rig, name, samples, loop):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    bind_action(rig, action)
    previous = {}
    for frame, sample in enumerate(samples, start=1):
        for bone in rig.pose.bones:
            location, rotation, scale = sample[bone.name]
            rotation = rotation.copy()
            if bone.name in previous and rotation.dot(previous[bone.name]) < 0:
                rotation.negate()
            previous[bone.name] = rotation.copy()
            bone.rotation_mode = 'QUATERNION'
            bone.location = location
            bone.rotation_quaternion = rotation
            bone.scale = scale
            for channel in ('location', 'rotation_quaternion', 'scale'):
                bone.keyframe_insert(channel, frame=frame, group=bone.name)
    action.use_cyclic = loop
    action.use_frame_range = True
    action.frame_start, action.frame_end = 1, len(samples)
    # Dense sampled motion: linear values avoid Bézier overshoot at planted feet.
    for curve in curves(action):
        for point in curve.keyframe_points:
            point.interpolation = 'LINEAR'
    return action


def glb_report(path):
    import struct
    payload = path.read_bytes()
    length, kind = struct.unpack_from('<II', payload, 12)
    if kind != 0x4E4F534A:
        raise ValueError('GLB sin bloque JSON')
    data = json.loads(payload[20:20+length])
    if data.get('meshes') or data.get('images') or data.get('textures'):
        raise ValueError('El banco de animaciones contiene recursos visuales inesperados')
    names = [a.get('name') for a in data.get('animations', [])]
    if len(names) != len(set(names)):
        raise ValueError('Clips duplicados en el GLB')
    return {"animations": names, "node_count": len(data.get('nodes', [])), "size_bytes": len(payload)}


def annotate_glb(path, clips):
    """NLA exports omit Action extras; attach playback semantics to each clip."""
    import struct
    payload = path.read_bytes()
    length, kind = struct.unpack_from('<II', payload, 12)
    if kind != 0x4E4F534A:
        raise ValueError('GLB sin bloque JSON')
    data = json.loads(payload[20:20 + length])
    by_name = {clip['name']: clip for clip in clips}
    for animation in data.get('animations', []):
        clip = by_name[animation['name']]
        animation.setdefault('extras', {}).update({
            'loop': clip['loop'], 'source': 'Mixamo',
            'sourceLabel': clip['source_label'], 'preparedWith': 'Blender',
        })
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    encoded += b' ' * (-len(encoded) % 4)
    remaining_chunks = payload[20 + length:]
    header = struct.pack('<III', 0x46546C67, 2, 20 + len(encoded) + len(remaining_chunks))
    path.write_bytes(header + struct.pack('<II', len(encoded), kind) + encoded + remaining_chunks)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--overwrite', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if not 1 <= args.fps <= 120:
        raise ValueError('FPS fuera de rango: 1–120')
    output = args.output.resolve()
    blend = output.with_suffix('.blend')
    report_path = output.with_suffix('.json')
    if not args.overwrite and any(p.exists() for p in [output, blend, report_path]):
        raise FileExistsError('Ya existe una salida; usa otro nombre o --overwrite')
    entries = json.loads(args.manifest.read_text())["clips"] if args.manifest else [
        {"file": p.name, "name": ALIASES.get(p.stem.lower().replace(' ', '_'), p.stem.lower().replace(' ', '_'))}
        for p in sorted(args.source.glob('*.fbx'))
    ]
    if not entries:
        raise ValueError('No hay FBX ni entradas en el manifiesto')
    if len({e['name'] for e in entries}) != len(entries):
        raise ValueError('Nombres de clips repetidos')
    for entry in entries:
        if not (args.source / entry['file']).is_file():
            raise FileNotFoundError(entry['file'])
    # This script runs in its own background Blender process, never the live scene.
    bpy.ops.wm.read_factory_settings(use_empty=True)
    main_rig = None
    prepared = []
    report = {"blender": bpy.app.version_string, "fps": args.fps, "source": "Mixamo FBX", "root_motion": "preserved; horizontal translation belongs to runtime controller", "clips": []}
    for entry in entries:
        source = args.source / entry['file']
        before = set(bpy.data.objects)
        bpy.ops.import_scene.fbx(filepath=str(source.resolve()), automatic_bone_orientation=False)
        imported = [o for o in bpy.data.objects if o not in before]
        rigs = [o for o in imported if o.type == 'ARMATURE']
        if len(rigs) != 1:
            raise ValueError(f'{source.name}: se esperaba exactamente un esqueleto')
        rig = rigs[0]
        for bone in rig.data.bones:
            bone.name = canonical_bone(bone.name)
        action = rig.animation_data.action if rig.animation_data else None
        if action is None:
            raise ValueError(f'{source.name}: sin acción activa')
        action.name = 'SOURCE_' + entry['name']
        action.use_fake_user = True
        start = float(entry.get('start_frame', action.frame_range[0]))
        end = float(entry.get('end_frame', action.frame_range[1]))
        if end <= start:
            raise ValueError(f'{source.name}: rango de fotogramas vacío')
        samples, seconds = sample_clip(rig, action, start, end, args.fps)
        loop = entry.get('loop', entry['name'] in LOOPS)
        seam = None
        if loop:
            samples, seam = close_loop(samples, int(entry.get('seam_frames', 4)), rig)
        if main_rig is None:
            main_rig = rig
            main_rig.name = 'MixamoPreview'
        else:
            same_rig(main_rig, rig)
        # The source action remains editable, with original mocap samples.
        main_rig.animation_data.action = None
        for bone in main_rig.pose.bones:
            bone.matrix_basis = Matrix.Identity(4)
        baked = bake_action(main_rig, entry['name'], samples, loop)
        prepared.append(baked)
        report['clips'].append({"name": entry['name'], "source_file": source.name,
            "source_label": entry.get('source_label', source.stem),
            "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "source_seconds": seconds, "seconds": (len(samples) - 1) / args.fps,
            "frames": len(samples), "loop": loop, "seam": seam})
        for obj in imported:
            if obj != main_rig:
                bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.scene.render.fps = args.fps
    bpy.context.scene.render.fps_base = 1
    main_rig.animation_data.action = None
    for bone in main_rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    for action in prepared:
        track = main_rig.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, 1, action)
        strip.action_slot = action.slots[0]
        strip.extrapolation = 'NOTHING'
        track.mute = True
    bpy.ops.object.select_all(action='DESELECT')
    main_rig.select_set(True)
    bpy.context.view_layer.objects.active = main_rig
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = max(int(a.frame_range[1]) for a in prepared)
    bpy.context.scene.frame_set(1)
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
        export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=True,
        # Blender removes repeated keys; it does not decimate changing mocap.
        export_frame_step=1, export_yup=True, export_optimize_animation_size=True,
        export_anim_slide_to_zero=True)
    annotate_glb(output, report['clips'])
    exported = glb_report(output)
    if set(exported['animations']) != {e['name'] for e in entries}:
        raise ValueError(f"Clips exportados inesperados: {exported['animations']}")
    # Save an editable project with the first clip visible on the timeline.
    bind_action(main_rig, prepared[0])
    bpy.context.scene.frame_end = int(prepared[0].frame_range[1])
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    report['export'] = exported
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print('MIXAMO_PREVIEW_READY', json.dumps(report['export']))


if __name__ == '__main__':
    main()
