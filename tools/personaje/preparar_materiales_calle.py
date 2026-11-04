"""Bake a small, seamless skin micro-normal; keep the original body UV/color.

blender -b --factory-startup --python tools/personaje/preparar_materiales_calle.py -- \
  public/models/preview/skin/skin-micro-normal.png work/skin/materiales.blend

The editable source is a periodic 4D Noise/Voronoi shader, baked with Cycles.
Only the new normal-map asset is published. No character meshes are imported.
"""
import argparse
import json
import math
from pathlib import Path
import sys

import bpy


def math_node(nodes, operation, label, x, y, second=None):
    node = nodes.new('ShaderNodeMath')
    node.operation = operation
    node.label = label
    node.location = (x, y)
    if second is not None:
        node.inputs[1].default_value = second
    return node


def source_material():
    material = bpy.data.materials.new('Piel — fuente procedural periódica')
    material.use_nodes = True
    material.use_fake_user = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    uv = nodes.new('ShaderNodeTexCoord')
    uv.location = (-1100, 160)
    split = nodes.new('ShaderNodeSeparateXYZ')
    split.location = (-920, 160)
    links.new(uv.outputs['UV'], split.inputs[0])
    # (cos 2πu, sin 2πu, cos 2πv, sin 2πv) is exactly periodic in both UV axes.
    angles = []
    for channel, y in [('X', 240), ('Y', -100)]:
        angle = math_node(nodes, 'MULTIPLY', 'UV × 2π', -750, y, 2 * math.pi)
        links.new(split.outputs[channel], angle.inputs[0])
        angles.append(angle)
    signals = []
    for i, angle in enumerate(angles):
        for j, operation in enumerate(['COSINE', 'SINE']):
            signal = math_node(nodes, operation, 'Coordenada periódica', -560, 360 - 180 * (2*i+j))
            links.new(angle.outputs[0], signal.inputs[0])
            signals.append(signal)
    xyz = nodes.new('ShaderNodeCombineXYZ')
    xyz.location = (-340, 260)
    for i in range(3):
        links.new(signals[i].outputs[0], xyz.inputs[i])
    pores = nodes.new('ShaderNodeTexVoronoi')
    pores.voronoi_dimensions = '4D'
    pores.feature = 'F1'
    pores.distance = 'EUCLIDEAN'
    pores.location = (-100, 300)
    pores.label = 'Poros cóncavos: distancia F1'
    pores.inputs['Scale'].default_value = 6.8
    pores.inputs['Randomness'].default_value = 1
    links.new(xyz.outputs[0], pores.inputs['Vector'])
    links.new(signals[3].outputs[0], pores.inputs['W'])
    ramp = nodes.new('ShaderNodeMapRange')
    ramp.location = (140, 300)
    ramp.interpolation_type = 'SMOOTHSTEP'
    ramp.clamp = True
    ramp.label = 'Depresiones suaves; superficie plana entre poros'
    for name, value in [('From Min', .25), ('From Max', .62), ('To Min', 0), ('To Max', 1)]:
        ramp.inputs[name].default_value = value
    links.new(pores.outputs['Distance'], ramp.inputs['Value'])
    grain = nodes.new('ShaderNodeTexNoise')
    grain.noise_dimensions = '4D'
    grain.location = (-100, -120)
    grain.label = 'Microrrelieve secundario, amplitud reducida'
    grain.inputs['Scale'].default_value = 11
    grain.inputs['Detail'].default_value = 2
    grain.inputs['Roughness'].default_value = .45
    links.new(xyz.outputs[0], grain.inputs['Vector'])
    links.new(signals[3].outputs[0], grain.inputs['W'])
    grain_amount = math_node(nodes, 'MULTIPLY', 'Solo 8% de grano', 140, -100, .08)
    links.new(grain.outputs['Fac'], grain_amount.inputs[0])
    height = math_node(nodes, 'ADD', 'Altura sin alterar geometría', 350, 230)
    links.new(ramp.outputs[0], height.inputs[0])
    links.new(grain_amount.outputs[0], height.inputs[1])
    bump = nodes.new('ShaderNodeBump')
    bump.location = (550, 230)
    bump.inputs['Strength'].default_value = 1
    bump.inputs['Distance'].default_value = .0016
    links.new(height.outputs[0], bump.inputs['Height'])
    shader = nodes.new('ShaderNodeBsdfPrincipled')
    shader.location = (780, 250)
    shader.inputs['Base Color'].default_value = (.35, .19, .13, 1)
    shader.inputs['Roughness'].default_value = .72
    links.new(bump.outputs['Normal'], shader.inputs['Normal'])
    out = nodes.new('ShaderNodeOutputMaterial')
    out.location = (1080, 250)
    links.new(shader.outputs[0], out.inputs['Surface'])
    material['description'] = 'Fuente de micro-normal periódica. Color de muestra; no sustituye el diffuse del cuerpo.'
    material['tile_uv'] = 18
    material['runtime_normal_strength'] = .18
    return material


def baked_material(image):
    material = bpy.data.materials.new('Piel — microdetalle horneado 512')
    material.use_nodes = True
    material.use_fake_user = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.35, .19, .13, 1)
    shader.inputs['Roughness'].default_value = .72
    uv = nodes.new('ShaderNodeTexCoord')
    uv.location = (-700, 200)
    scale = nodes.new('ShaderNodeVectorMath')
    scale.operation = 'SCALE'
    scale.inputs['Scale'].default_value = 18
    scale.location = (-500, 200)
    links.new(uv.outputs['UV'], scale.inputs[0])
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.interpolation = 'Linear'
    texture.extension = 'REPEAT'
    texture.location = (-280, 200)
    links.new(scale.outputs['Vector'], texture.inputs['Vector'])
    normal = nodes.new('ShaderNodeNormalMap')
    normal.space = 'TANGENT'
    normal.convention = 'OPENGL'
    normal.inputs['Strength'].default_value = .18
    normal.location = (-10, 150)
    links.new(texture.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], shader.inputs['Normal'])
    return material


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('normal', type=Path)
    parser.add_argument('blend', type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    normal_path, blend_path = args.normal.resolve(), args.blend.resolve()
    normal_path.parent.mkdir(parents=True, exist_ok=True)
    blend_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 4
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 2
    scene.render.bake.margin = 0
    scene.render.bake.use_clear = True
    scene.render.bake.normal_space = 'TANGENT'
    scene.render.bake.normal_r = 'POS_X'
    scene.render.bake.normal_g = 'POS_Y'
    scene.render.bake.normal_b = 'POS_Z'
    bpy.ops.mesh.primitive_plane_add(size=1)
    plane = bpy.context.object
    plane.name = 'Fuente de bake — UV de un metro'
    material = source_material()
    plane.data.materials.append(material)
    image = bpy.data.images.new('skin-micro-normal', width=512, height=512, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    target = material.node_tree.nodes.new('ShaderNodeTexImage')
    target.name = 'Destino del bake'
    target.label = 'Normal tangente OpenGL +Y — 512 × 512'
    target.location = (350, -220)
    target.image = image
    material.node_tree.nodes.active = target
    target.select = True
    bpy.ops.object.bake(type='NORMAL')
    image.filepath_raw = str(normal_path)
    image.file_format = 'PNG'
    image.save()
    image.pack()
    baked = baked_material(image)
    plane.hide_render = True
    plane.hide_set(True)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=.1, location=(0, 0, .15))
    swatch = bpy.context.object
    swatch.name = 'Muestra de material — no es la malla del personaje'
    swatch.data.materials.append(baked)
    for face in swatch.data.polygons:
        face.use_smooth = True
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    report = {'blender': bpy.app.version_string, 'source': 'procedural shader: periodic 4D Voronoi + Noise, Cycles normal bake',
        'normal_map': str(normal_path), 'dimensions': [512, 512], 'color_space': 'Non-Color / linear',
        'normal_convention': 'tangent OpenGL +Y (green)', 'repeat_uv': [18, 18],
        'normal_scale_recommended': [.18, .18], 'normal_scale_range': [.15, .25],
        'base_color': 'preserve original texture and UV', 'mesh_geometry': 'unchanged',
        'bytes': normal_path.stat().st_size, 'gpu_rgba8_mip_chain_bytes': 1398100}
    blend_path.with_suffix('.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    print('SKIN_MATERIAL_READY', json.dumps(report))


if __name__ == '__main__':
    main()
