"""Hornea los pliegues, la oclusión y la rugosidad de las dos prendas de manga larga.

blender -b --factory-startup -t 2 --python tools/personaje/hornear_ropa.py

Las coordenadas de cada curva siguen el patrón UV de MakeHuman. El ancho y la altura
del lomo están en milímetros. El azul del mapa ORM queda a cero en toda la tela.
"""
import json
from pathlib import Path

import bpy
import numpy as np


BASE = Path(__file__).resolve().parents[2] / 'public/models/personaje'
TEXTURES = BASE / 'texturas'
SIZE = 1024
AO_SIZE = 512

# Dos extremos y un punto de control sobre cada paño, ancho y altura. La chaqueta
# se sostiene en los hombros. La espalda y los delanteros ceden sobre la pretina.
JACKET_BACK = [
    (.03, .28, .22, .34, .46, .45, 13, 6),
    (.94, .29, .72, .36, .56, .51, 15, 8),
    (.13, .43, .32, .47, .40, .53, 9, 3.5),
    (.74, .39, .67, .56, .71, .72, 24, 7),
    (.30, .43, .26, .57, .32, .71, 20, 5),
    (.00, .79, .21, .69, .53, .62, 15, 9),
    (.07, .87, .33, .76, .60, .78, 13, 7),
    (.94, .83, .73, .76, .54, .78, 14, 7),
    (.14, .94, .43, .87, .78, .93, 10, 5),
]
JACKET_FRONT = [
    (.09, .28, .39, .36, .73, .36, 11, 5),
    (.09, .58, .33, .53, .62, .57, 14, 5),
    (.98, .72, .67, .69, .39, .64, 12, 6),
    (.15, .90, .38, .82, .71, .83, 11, 5),
]
# Punto más blando en el buzo. Los pliegues se abren bajo la sisa y se juntan
# sobre el elástico de la cintura y en la cara comprimida del codo.
SWEATSHIRT_BACK = [
    (.01, .32, .24, .36, .46, .51, 14, 8),
    (.96, .31, .76, .36, .56, .48, 16, 9),
    (.92, .43, .73, .45, .64, .53, 10, 4.5),
    (.36, .07, .33, .24, .40, .36, 23, 5),
    (.28, .49, .23, .64, .28, .74, 22, 7.5),
    (.72, .49, .68, .57, .62, .68, 20, 5),
    (.01, .78, .19, .67, .41, .64, 13, 8),
    (.03, .83, .27, .78, .51, .81, 13, 8.5),
    (.95, .72, .72, .66, .50, .69, 16, 8),
    (.96, .83, .70, .76, .46, .83, 12, 7),
    (.10, .94, .39, .86, .60, .91, 11, 5),
]
SWEATSHIRT_FRONT = [
    (.03, .29, .22, .34, .38, .45, 12, 7),
    (.96, .32, .79, .38, .65, .48, 13, 6),
    (.19, .51, .36, .49, .58, .54, 23, 6),
    (.03, .70, .21, .63, .44, .64, 15, 7.5),
    (.97, .74, .76, .70, .56, .75, 13, 8),
    (.94, .85, .70, .79, .37, .86, 14, 10),
    (.02, .87, .23, .80, .41, .83, 10, 5.5),
    (.12, .94, .39, .91, .68, .95, 10, 5),
]
SLEEVE = [
    (.06, .19, .26, .24, .44, .41, 12, 5),
    (.96, .35, .73, .43, .50, .43, 11, 5),
    (.04, .51, .34, .49, .58, .57, 11, 8),
    (.13, .62, .44, .58, .72, .65, 10, 6.5),
    (.96, .58, .81, .59, .64, .62, 10, 4),
    (.09, .80, .29, .77, .48, .80, 9, 4.5),
    (.88, .85, .63, .82, .37, .90, 10, 6),
]


def image_array(image):
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(image.size[1], image.size[0], 4)[::-1].copy()


def data_texture(name):
    image = bpy.data.images.load(str(TEXTURES / name), check_existing=False)
    image.colorspace_settings.name = 'Non-Color'
    return image_array(image)[:, :, :3]


def save_texture(path, rgb):
    height, width = rgb.shape[:2]
    image = bpy.data.images.new(path.stem, width, height, alpha=False, is_data=True)
    rgba = np.ones((height, width, 4), dtype=np.float32)
    rgba[:, :, :3] = rgb
    image.pixels.foreach_set(rgba[::-1].flatten())
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()


def bake_occlusion(garment):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(BASE / 'hombre-adulto' / (garment + '.gltf')))
    mesh = next(obj for obj in bpy.context.scene.objects if obj.type == 'MESH')
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 4
    scene.render.bake.margin = 12

    material = bpy.data.materials.new('Contacto de la tela')
    material.use_nodes = True
    mesh.data.materials.clear()
    mesh.data.materials.append(material)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    ao = nodes.new('ShaderNodeAmbientOcclusion')
    ao.only_local = True
    ao.samples = 48
    ao.inputs['Distance'].default_value = .035
    emission = nodes.new('ShaderNodeEmission')
    links.new(ao.outputs['AO'], emission.inputs['Color'])
    links.new(emission.outputs[0], nodes.get('Material Output').inputs['Surface'])
    image = bpy.data.images.new(garment + ' AO', AO_SIZE, AO_SIZE, alpha=False, is_data=True)
    # En los mipmaps lejanos entra parte del fondo del atlas. Mantenerlo sin oclusión.
    image.generated_color = (1, 1, 1, 1)
    target = nodes.new('ShaderNodeTexImage')
    target.image = image
    nodes.active = target
    bpy.ops.object.bake(type='EMIT', use_clear=False)
    return image_array(image)[:, :, 0]


def add_panel(height, box, mm_per_texel, curves, mirror=False):
    left, top, right, bottom = box
    scale = np.array([right - left, bottom - top], dtype=np.float32)
    y, x = np.mgrid[0:bottom - top, 0:right - left].astype(np.float32)
    field = height[top:bottom, left:right]
    for x0, y0, cx, cy, x1, y1, width, peak in curves:
        if mirror:
            x0, cx, x1 = 1 - x0, 1 - cx, 1 - x1
        a, b, c = np.array([[x0, y0], [cx, cy], [x1, y1]]) * scale
        line, bend = 2 * (b - a), a - 2 * b + c
        chord = c - a
        t = np.clip(((x - a[0]) * chord[0] + (y - a[1]) * chord[1]) / np.dot(chord, chord), 0, 1)
        # Punto más cercano de la curva cuadrática en el patrón.
        for _ in range(3):
            px = a[0] + line[0] * t + bend[0] * t * t - x
            py = a[1] + line[1] * t + bend[1] * t * t - y
            tx, ty = line[0] + 2 * bend[0] * t, line[1] + 2 * bend[1] * t
            t = np.clip(t - (px * tx + py * ty) / np.maximum(1, tx * tx + ty * ty + 2 * (px * bend[0] + py * bend[1])), 0, 1)
        tx, ty = line[0] + 2 * bend[0] * t, line[1] + 2 * bend[1] * t
        dx = x - (a[0] + line[0] * t + bend[0] * t * t)
        dy = y - (a[1] + line[1] * t + bend[1] * t * t)
        across = (dy * tx - dx * ty) / np.hypot(tx, ty) * mm_per_texel / width
        if mirror:
            across = -across
        envelope = np.sin(np.pi * t).clip(0, 1) ** 1.35
        profile = np.exp(-.70 * across**2) - .30 * np.exp(-1.3 * (across - 1.45)**2)
        field += envelope * profile * (peak / mm_per_texel)


def blur(image):
    # Separa una costura del color medio de la misma isla, también junto al borde.
    kernel = np.array([1, 4, 7, 9, 10, 9, 7, 4, 1], dtype=np.float32) / 52
    for axis in (0, 1):
        image = sum(w * np.roll(image, i - 4, axis=axis) for i, w in enumerate(kernel))
    return image


def bake_finish(garment, source, geometry_ao):
    original = data_texture(source + '_normal.webp') * 2 - 1
    color = data_texture(source + '_diffuse.webp')
    luma = color @ np.array([.2126, .7152, .0722], dtype=np.float32)
    height = np.zeros((SIZE, SIZE), dtype=np.float32)
    roughness = np.full_like(height, .96)
    if garment == 'chaqueta':
        back = (16, 248, 232, 550)
        fronts = [(632, 698, 796, 1009), (826, 698, 989, 1009)]
        add_panel(height, back, 2.04, JACKET_BACK)
        for side, box in enumerate(fronts):
            add_panel(height, box, 2.05, JACKET_FRONT, mirror=bool(side))
        canvas = np.zeros_like(height)
        for left, top, right, bottom in [back, *fronts, (326, 304, 840, 550)]:
            canvas[top:bottom, left:right] = 1
        # Las costuras oscuras del atlas son un surco en el paño. El fondo negro
        # sin UV queda fuera del filtro y no dibuja un canal en el borde.
        cloth = (luma > .09).astype(np.float32)
        local = blur(luma * cloth) / np.maximum(.001, blur(cloth))
        seam = np.clip((luma - local) / np.maximum(local, .08), -.6, .32) * canvas * cloth
        height += seam * 1.45
        roughness -= .075 * canvas + np.maximum(0, -seam) * .26
        for left, top, right, bottom in [(326, 62, 405, 274), (731, 88, 810, 300)]:
            roughness[top:bottom, left:right] = .77   # vuelta de la solapa
        for left, top, right, bottom in [(185, 116, 257, 164), (842, 590, 913, 638),
                                         (434, 142, 513, 194), (434, 222, 513, 274)]:
            roughness[top:bottom, left:right] = .86   # tapetas de los bolsillos
    else:
        add_panel(height, (10, 15, 338, 415), 1.50, SWEATSHIRT_BACK)
        add_panel(height, (428, 39, 721, 414), 1.60, SWEATSHIRT_FRONT)
        add_panel(height, (732, 82, 985, 407), 1.46, SLEEVE)
        add_panel(height, (756, 631, 1011, 954), 1.46, SLEEVE, mirror=True)
        # El cuello acanalado y el vivo satinado están dibujados en el albedo;
        # esta máscara se ajusta a cada punto de la cinta, incluso en las mangas.
        piping = np.clip((color[:, :, 0] - color[:, :, 2] - .22) * 3., 0, 1)
        roughness -= piping * .24
        for left, top, right, bottom in [(52, 0, 310, 85), (450, 23, 692, 120)]:
            region = np.s_[top:bottom, left:right]
            collar = np.clip((.25 - luma[region]) * 12, 0, 1)
            roughness[region] -= .12 * collar

    jeans_width = 610 if garment == 'chaqueta' else 794
    jeans_top = 572 if garment == 'chaqueta' else 420
    jeans = np.s_[jeans_top:, :jeans_width]
    roughness[jeans] = .89 + .10 * np.clip((luma[jeans] - .12) * 2.4, 0, 1)

    dy, dx = np.gradient(height)
    normals = original.copy()
    normals[:, :, 0] -= dx * original[:, :, 2]
    normals[:, :, 1] += dy * original[:, :, 2]  # +Y OpenGL mira hacia arriba en la imagen.
    normals /= np.maximum(.001, np.linalg.norm(normals, axis=2, keepdims=True))
    save_texture(TEXTURES / (garment + '-relieve.png'), normals * .5 + .5)

    # Solo el hueco del pliegue retiene ambiente. El sombreado direccional viene
    # de la normal y de las luces del juego. El radio es de pocos centímetros.
    hollow = np.zeros_like(height)
    for sy, sx in [(0, 1), (1, 0), (0, -1), (-1, 0), (1, 1), (-1, -1), (1, -1), (-1, 1)]:
        horizon = np.zeros_like(height)
        for offset in (4, 9, 18):
            rise = np.roll(height, (sy * offset, sx * offset), axis=(0, 1)) - height
            horizon = np.maximum(horizon, rise / (np.hypot(sy, sx) * offset))
        hollow += horizon**2 / (1 + horizon**2)
    cavity = 1 - hollow / 8
    def half(image):
        return image.reshape(AO_SIZE, 2, AO_SIZE, 2).mean(axis=(1, 3))

    packed = np.stack((geometry_ao * half(cavity), half(roughness), np.zeros_like(geometry_ao)), axis=2)
    save_texture(TEXTURES / (garment + '-orm.png'), packed)


def bind_maps(garment):
    for path in sorted(BASE.glob('hombre-*/**/' + garment + '.gltf')):
        model = json.loads(path.read_text(encoding='utf-8'))
        material = model['materials'][0]
        normal = model['textures'][material['normalTexture']['index']]
        source = normal['extensions']['EXT_texture_webp']['source'] if 'extensions' in normal else normal['source']
        normal.pop('extensions', None)
        normal['source'] = source
        image = model['images'][source]
        folder = image['uri'].rsplit('/', 1)[0]
        image.update(mimeType='image/png', name=garment + '-relieve', uri=f'{folder}/{garment}-relieve.png')
        orm_uri = f'{folder}/{garment}-orm.png'
        texture = next((i for i, item in enumerate(model['textures'])
                        if 'source' in item and model['images'][item['source']]['uri'] == orm_uri), None)
        if texture is None:
            texture = len(model['textures'])
            model['textures'].append({'sampler': normal['sampler'], 'source': len(model['images'])})
            model['images'].append({'mimeType': 'image/png', 'name': garment + '-orm', 'uri': orm_uri})
        material['occlusionTexture'] = {'index': texture, 'strength': .76}
        material['pbrMetallicRoughness']['metallicRoughnessTexture'] = {'index': texture}
        updated = json.dumps(model, ensure_ascii=False, indent='\t', separators=(',', ':')) + '\n'
        if updated != path.read_text(encoding='utf-8'):
            path.write_text(updated, encoding='utf-8')


for garment, source in [('chaqueta', 'male_casualsuit05'), ('buzo', 'male_casualsuit02')]:
    ao = bake_occlusion(garment)
    bake_finish(garment, source, ao)
    bind_maps(garment)
