"""Genera public/models/perro.glb: El Chato, perro criollo con esqueleto para animación procedural.

Uso: blender -b --factory-startup --python tools/modelos/generar_perro.py

La malla se arma por código, pieza por pieza, con anillos de pocos lados: tronco de pecho hondo y cintura
metida, cuello, cabeza de hocico corto, una oreja parada y otra caída, patas con codo y corvejón, cola en
gancho y mechones. Va con sombreado suave y filo solo en las aristas marcadas (ARISTA). El esqueleto (BONES) es el de siempre: la animación
de src/entities/Dog.js depende de sus nombres y de su pose de reposo, así que no se toca.
Los pesos se asignan por distancia a los huesos de cada pieza, sin la heurística de Blender.
Los colores de vértice del material «pelaje» son tonos relativos: el juego los multiplica por el pelaje
elegido. El material «detalle» no se tiñe: trufa, ojos con su brillo y lengua.
En Blender el perro mira a −Y; al exportar con Y arriba queda mirando a +Z, como en el juego.
"""
from math import cos, pi, radians, sin
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector
from mathutils.geometry import intersect_point_line

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'public/models/perro.glb'

# Articulaciones del esqueleto: nombre -> posición. De aquí salen los huesos; no cambiar.
NODES = {
    'cola_punta': (0, .60, .66), 'cola_media': (0, .49, .59), 'cola_base': (0, .36, .50), 'pelvis': (0, .26, .44),
    'vientre': (0, .03, .43), 'pecho': (0, -.18, .45), 'cuello': (0, -.29, .56), 'cabeza': (0, -.35, .65),
    'hocico': (0, -.47, .625), 'trufa': (0, -.53, .62),
}
for side, s in (('L', 1), ('R', -1)):
    NODES.update({
        f'hombro_{side}': (s * .07, -.18, .39), f'codo_{side}': (s * .08, -.19, .24),
        f'muneca_{side}': (s * .08, -.18, .07), f'mano_{side}': (s * .08, -.215, .028),
        f'cadera_{side}': (s * .07, .26, .39), f'rodilla_{side}': (s * .08, .20, .25),
        f'corvejon_{side}': (s * .08, .28, .11), f'pie_{side}': (s * .08, .245, .028),
        f'oreja_{side}': (s * .055, -.33, .73), f'oreja_punta_{side}': (s * .11, -.355, .615),
    })

# Huesos: nombre -> (cabeza, cola, padre). Los nombres sin puntos sobreviven a three.js.
P = {name: Vector(position) for name, position in NODES.items()}
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

# Tonos del pelaje (se multiplican por el color elegido en el juego).
CLARO, BASE, LOMO, PARCHE = 1, .78, .55, .38
# Colores sin teñir del material «detalle».
TRUFA, OJO, BRILLO, LENGUA = (.035, .03, .03), (.05, .035, .025), (1, 1, 1), (.86, .36, .4)
BLANCO = (.9, .86, .78)  # dedos, pechera y punta de la cola: blancos con cualquier pelaje
PELAJE, DETALLE = 0, 1
OJO_PARCHE = Vector((-.047, -.428, .683))  # el ojo derecho lleva el parche
CABEZA_CENTRO, CABEZA_ESCALA = Vector((0, -.31, .60)), 1.15
# Dos caras que se doblan más de este ángulo llevan filo; las demás se funden en un sombreado suave.
# Es el mismo ángulo de los accesorios (CREASE en src/entities/Dog.js).
ARISTA = radians(40)


class Malla:
    """Vértices y caras de todas las piezas; cada vértice recuerda con qué huesos se mueve."""

    def __init__(self):
        self.verts, self.huesos, self.caras = [], [], []

    def pieza(self, huesos):
        return Pieza(self, huesos)


class Pieza:
    def __init__(self, malla, huesos):
        self.malla, self.huesos, self.inicio, self.caras = malla, huesos, len(malla.verts), []

    def puntos(self, puntos, huesos=None):
        primero = len(self.malla.verts)
        for punto in puntos:
            self.malla.verts.append(Vector(punto))
            self.malla.huesos.append(huesos or self.huesos)
        return list(range(primero, primero + len(puntos)))

    def cara(self, indices):
        self.caras.append(list(indices))

    def tubo(self, anillos, tapa_inicio=True, tapa_fin=True, huesos_inicio=None):
        """Une anillos consecutivos con caras de cuatro lados; un anillo de un punto cierra en pico."""
        filas = [self.puntos(a, huesos_inicio if i == 0 else None) for i, a in enumerate(anillos)]
        for a, b in zip(filas, filas[1:]):
            n = max(len(a), len(b))
            for k in range(n):
                k2 = (k + 1) % n
                if len(b) == 1:
                    self.cara([a[k], a[k2], b[0]])
                elif len(a) == 1:
                    self.cara([a[0], b[k2], b[k]])
                else:
                    self.cara([a[k], a[k2], b[k2], b[k]])
        if tapa_inicio and len(filas[0]) > 2:
            self.cara(reversed(filas[0]))
        if tapa_fin and len(filas[-1]) > 2:
            self.cara(filas[-1])
        return filas

    def pintar(self, tono, material=PELAJE):
        """Cierra la pieza: `tono` es un valor o una función del centro de cada cara."""
        for cara in self.caras:
            centro = sum((self.malla.verts[i] for i in cara), Vector()) / len(cara)
            valor = tono(centro) if callable(tono) else tono
            # Un color completo (no un tono) va siempre al material sin teñir.
            self.malla.caras.append((cara, DETALLE if isinstance(valor, tuple) else material, valor))


def seccion(y, alto, bajo, ancho, n=10, cuadrado=1.0, quilla=0.0):
    """Corte del cuerpo en el plano XZ: vértice arriba en el lomo, más cuadrado o con quilla hacia abajo."""
    centro, medio = (alto + bajo) / 2, (alto - bajo) / 2
    puntos = []
    for k in range(n):
        a = 2 * pi * k / n
        lado = sin(a)
        x = ancho * (abs(lado) ** cuadrado) * (1 if lado >= 0 else -1)
        x *= 1 - quilla * max(0, -cos(a))
        puntos.append((x, y, centro + medio * cos(a)))
    return puntos


def aro(centro, u, v, ru, rv, n=6, fase=0.0):
    """Anillo en el plano de los ejes u y v."""
    centro, u, v = Vector(centro), Vector(u).normalized(), Vector(v).normalized()
    return [centro + u * ru * cos(2 * pi * k / n + fase) + v * rv * sin(2 * pi * k / n + fase) for k in range(n)]


def plano(z, y, x, rx, ry, n=6):
    """Anillo horizontal de una pata."""
    return aro((x, y, z), (1, 0, 0), (0, 1, 0), rx, ry, n, pi / n)


def mechon(malla, base, direccion, largo, ancho, huesos, tono):
    """Mechón de pelo: una pirámide de tres caras clavada en la pieza."""
    base, direccion = Vector(base), Vector(direccion).normalized()
    u = direccion.cross(Vector((1, 0, 0)))
    u = (u if u.length > .2 else direccion.cross(Vector((0, 0, 1)))).normalized()
    v = direccion.cross(u).normalized()
    pieza = malla.pieza(huesos)
    pieza.tubo([aro(base - direccion * .012, u, v, ancho, ancho * .55, 3), [base + direccion * largo]], tapa_inicio=False)
    pieza.pintar(tono)


def tronco(malla):
    pieza = malla.pieza(['pelvis', 'pecho', 'cuello'])
    pieza.tubo([
        seccion(.352, .512, .425, .046),                       # grupa
        seccion(.300, .548, .362, .102),
        seccion(.220, .552, .335, .118, quilla=.15),           # caderas
        seccion(.105, .534, .378, .096, quilla=.3),            # cintura metida
        seccion(-.030, .540, .300, .124, quilla=.3),           # costillas
        seccion(-.150, .556, .250, .136, quilla=.38),          # pecho hondo
        seccion(-.240, .566, .268, .120, quilla=.3),           # cruz y hombros
        seccion(-.298, .540, .335, .080, quilla=.2),           # antepecho
        seccion(-.328, .498, .398, .038),
    ])

    def tono(c):
        lomo = .498 + (.012 if c.y < -.1 else 0)
        if c.z > lomo and abs(c.x) < .095 and c.y > -.27:
            return LOMO
        if c.z > lomo - .05 and c.y > .16:      # la silla baja por la grupa
            return LOMO
        if c.y < -.255 and c.z < .5:            # pechera
            return CLARO
        if c.z < .33 and abs(c.x) < .11:        # panza
            return CLARO
        if c.z < .37 and c.y > 0 and abs(c.x) < .07:
            return CLARO
        return BASE
    pieza.pintar(tono)


def cuello(malla):
    eje = Vector((0, -.75, .66)).normalized()
    arriba = Vector((0, .66, .75))
    pieza = malla.pieza(['pecho', 'cuello', 'cabeza'])
    pieza.tubo([
        aro((0, -.185, .455), (1, 0, 0), arriba, .106, .116, 8, pi / 2),
        aro((0, -.262, .548), (1, 0, 0), arriba, .076, .088, 8, pi / 2),
        aro((0, -.322, .618), (1, 0, 0), arriba, .066, .074, 8, pi / 2),
    ])
    pieza.pintar(lambda c: CLARO if (c - Vector((0, -.26, .55))).dot(arriba) < -.035 else
                 LOMO if (c - Vector((0, -.26, .55))).dot(arriba) > .05 and abs(c.x) < .05 else BASE)
    return eje


def cabeza(malla):
    pieza = malla.pieza(['cabeza'])
    pieza.tubo([
        seccion(-.272, .705, .605, .046, 8),
        seccion(-.305, .738, .572, .086, 8, cuadrado=.8),
        seccion(-.368, .744, .560, .094, 8, cuadrado=.75),     # cráneo y cachetes
        seccion(-.414, .722, .566, .082, 8, cuadrado=.8),      # frente
        seccion(-.432, .668, .572, .059, 8, cuadrado=.6),      # el hocico arranca de golpe: es chato
        seccion(-.474, .656, .582, .053, 8, cuadrado=.6),
        seccion(-.490, .644, .596, .038, 8, cuadrado=.6),
    ])

    def tono(c):
        if c.y < -.425:                                         # hocico
            return CLARO
        if c.z < .6 and c.y < -.33:                             # quijada
            return CLARO
        if c.x < .012 and (c - OJO_PARCHE).length < .062:       # parche del ojo derecho
            return PARCHE
        if abs(c.x) < .03 and c.y < -.36 and c.z > .66:         # lista clara entre los ojos
            return CLARO
        return BASE
    pieza.pintar(tono)

    # Trufa: cuña oscura que remata el hocico.
    trufa = malla.pieza(['cabeza'])
    trufa.tubo([
        aro((0, -.480, .636), (1, 0, 0), (0, 0, 1), .027, .020, 6),
        aro((0, -.498, .638), (1, 0, 0), (0, 0, 1), .024, .017, 6),
        [(0, -.506, .636)],
    ], tapa_inicio=False)
    trufa.pintar(TRUFA, DETALLE)

    # Lengua: apenas la punta, asomada bajo la trufa.
    lengua = malla.pieza(['cabeza'])
    lengua.tubo([
        aro((0, -.476, .590), (1, 0, 0), (0, 0, 1), .014, .006, 4, pi / 4),
        aro((0, -.491, .588), (1, 0, 0), (0, 0, 1), .013, .005, 4, pi / 4),
        [(0, -.497, .584)],
    ])
    lengua.pintar(LENGUA, DETALLE)

    for s in (1, -1):
        centro = Vector((s * .047, -.428, .683))
        mira = Vector((s * .35, -1, .12)).normalized()
        lado = mira.cross(Vector((0, 0, 1))).normalized()
        alto = lado.cross(mira).normalized()
        ojo = malla.pieza(['cabeza'])
        ojo.tubo([
            aro(centro - mira * .004, lado, alto, .0215, .0215, 8),
            aro(centro + mira * .010, lado, alto, .0175, .0175, 8),
            [centro + mira * .019],
        ], tapa_inicio=False)
        ojo.pintar(OJO, DETALLE)
        luz = (mira * .75 + alto * .5 + Vector((.3, 0, 0))).normalized()
        brillo = malla.pieza(['cabeza'])
        brillo.tubo([aro(centro + luz * .013, luz.cross(alto), luz.cross(luz.cross(alto)), .0085, .0085, 3),
                     [centro + luz * .0245]], tapa_inicio=False)
        brillo.pintar(BRILLO, DETALLE)
        # Ceja: la derecha más alta, que le da cara de pícaro.
        ceja = malla.pieza(['cabeza'])
        sube = .010 if s < 0 else 0
        dentro = Vector((s * .022, -.424, .708 + sube + (.007 if s < 0 else -.001)))
        fuera = Vector((s * .070, -.409, .706 + sube - (.004 if s < 0 else -.005)))
        largo = (fuera - dentro)
        ceja.tubo([
            [dentro],
            aro(dentro + largo * .4, (0, 1, 0), (0, 0, 1), .008, .008, 4, pi / 4),
            aro(dentro + largo * .8, (0, 1, 0), (0, 0, 1), .007, .006, 4, pi / 4),
            [fuera],
        ])
        ceja.pintar(CLARO)

    # Patillas que rompen el contorno de la cara.
    for s in (1, -1):
        mechon(malla, (s * .080, -.350, .590), (s * .8, .3, -.6), .04, .034, ['cabeza'], CLARO)
    mechon(malla, (0, -.290, .715), (0, 1, .7), .035, .03, ['cabeza'], BASE)        # remolino de la nuca


def orejas(malla):
    # Las dos van relajadas: cuando el perro se pone alerta el juego las echa atrás y las junta,
    # y es entonces cuando la derecha queda derecha y la izquierda se levanta a medias.
    # Izquierda, caída: sale del costado del cráneo, dobla arriba y la punta cuelga hacia delante.
    caida = malla.pieza(['oreja_L'])
    eje = Vector((.25, -1, 0))
    fino = Vector((.8, .2, .55))
    caida.tubo([
        aro((.066, -.335, .726), eje, fino, .042, .016, 4),
        aro((.109, -.341, .716), eje, (.5, .1, .85), .050, .015, 4),
        aro((.142, -.366, .705), eje, (1, .2, .1), .042, .013, 4),
        [(.128, -.394, .621)],
    ], huesos_inicio=['cabeza'])
    caida.pintar(lambda c: PARCHE if c.z < .70 else LOMO)
    # Derecha, parada: un triángulo que mira al frente, ladeado hacia fuera y hacia delante.
    parada = malla.pieza(['oreja_R'])
    base = Vector((-.080, -.326, .716))
    sube = Vector((-.42, -.47, .78)).normalized()
    ancho = Vector((.7, -.7, 0))
    parada.tubo([
        aro(base, ancho, (-.7, -.7, 0), .044, .030, 4),
        aro(base + sube * .054, ancho, ancho.cross(sube), .035, .021, 4),
        [base + sube * .112],
    ], huesos_inicio=['cabeza'])
    parada.pintar(PARCHE)


def pata_delantera(malla, side, s):
    x = s * .081
    pieza = malla.pieza(['pecho', f'brazo_{side}', f'antebrazo_{side}', f'mano_{side}'])
    pieza.tubo([
        plano(.440, -.185, s * .074, .054, .080),
        plano(.340, -.182, x, .050, .070),
        plano(.262, -.158, x, .041, .062),      # el codo asoma hacia atrás
        plano(.215, -.178, x, .036, .045),
        plano(.140, -.184, x, .031, .036),
        plano(.072, -.180, x, .028, .032),      # muñeca
        plano(.040, -.198, x, .037, .050),
        plano(.000, -.206, x, .041, .058),
    ])
    media = .17 if side == 'L' else .085        # una media más alta que la otra
    pieza.pintar(lambda c: BLANCO if c.z < .045 else CLARO if c.z < media else BASE)


def pata_trasera(malla, side, s):
    x = s * .081
    pieza = malla.pieza(['pelvis', f'muslo_{side}', f'pierna_{side}', f'pie_{side}'])
    pieza.tubo([
        plano(.470, .250, s * .070, .056, .090),
        plano(.385, .248, x, .064, .104),       # muslo ancho
        plano(.305, .226, x, .056, .084),
        plano(.245, .212, x, .046, .062),       # rodilla
        plano(.180, .250, x, .036, .045),
        plano(.115, .287, x, .031, .041),       # corvejón
        plano(.062, .268, x, .028, .032),
        plano(.036, .244, x, .037, .050),
        plano(.000, .238, x, .041, .058),
    ])
    pieza.pintar(lambda c: BLANCO if c.z < .045 else CLARO if c.z < .085 else LOMO if c.z > .43 else BASE)


def cola(malla):
    recorrido = [((0, .325, .500), .045), ((0, .388, .552), .044), ((0, .432, .618), .041), ((0, .442, .688), .037),
                 ((0, .418, .742), .032), ((0, .372, .758), .026)]
    pieza = malla.pieza(['pelvis', 'cola_1', 'cola_2', 'cola_3'])
    anillos = []
    for i, (centro, radio) in enumerate(recorrido):
        antes = Vector(recorrido[max(0, i - 1)][0])
        despues = Vector(recorrido[min(len(recorrido) - 1, i + 1)][0])
        eje = (despues - antes).normalized()
        anillos.append(aro(centro, (1, 0, 0), eje.cross(Vector((1, 0, 0))), radio, radio, 5, pi / 2))
    anillos.append([(0, .336, .732)])
    pieza.tubo(anillos)
    pieza.pintar(lambda c: BLANCO if c.y < .40 and c.z > .70 else LOMO if c.z < .6 else BASE)
    # Mechones de la cola, por fuera de la curva.
    mechon(malla, (0, .468, .640), (0, 1, .1), .034, .05, ['cola_2', 'cola_3'], BASE)


def mechones(malla):
    # Lomo: cresta sobre la cruz y remolino en la grupa.
    mechon(malla, (0, -.215, .560), (0, 1, .8), .034, .044, ['pecho'], LOMO)
    mechon(malla, (0, -.125, .550), (0, 1, .7), .030, .040, ['pecho'], LOMO)
    mechon(malla, (0, .270, .546), (0, 1, .7), .030, .040, ['pelvis'], LOMO)
    # Pechera y codos.
    mechon(malla, (0, -.308, .392), (0, -.6, -1), .034, .044, ['pecho'], BLANCO)
    for side, s in (('L', 1), ('R', -1)):
        mechon(malla, (s * .081, .340, .340), (0, 1, -.7), .03, .036, [f'muslo_{side}'], BASE)


def construir():
    malla = Malla()
    tronco(malla)
    cuello(malla)
    primero = len(malla.verts)
    cabeza(malla)
    orejas(malla)
    for i in range(primero, len(malla.verts)):
        malla.verts[i] = CABEZA_CENTRO + (malla.verts[i] - CABEZA_CENTRO) * CABEZA_ESCALA
    for side, s in (('L', 1), ('R', -1)):
        pata_delantera(malla, side, s)
        pata_trasera(malla, side, s)
    cola(malla)
    mechones(malla)

    mesh = bpy.data.meshes.new('perro')
    mesh.from_pydata([tuple(v) for v in malla.verts], [], [cara for cara, _, _ in malla.caras])
    body = bpy.data.objects.new('perro', mesh)
    bpy.context.collection.objects.link(body)
    mesh.materials.append(material('pelaje', (1, 1, 1, 1), .9))
    mesh.materials.append(material('detalle', (1, 1, 1, 1), .5))
    attribute = mesh.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
    for polygon, (_, indice, valor) in zip(mesh.polygons, malla.caras):
        polygon.material_index = indice
        polygon.use_smooth = True
        rgb = valor if isinstance(valor, tuple) else (valor,) * 3
        # El atributo se exporta lineal: se convierte el tono para que el contraste se vea en pantalla.
        for loop in polygon.loop_indices:
            attribute.data[loop].color = (*[min(1, canal) ** 2.2 for canal in rgb], 1)
    mesh.color_attributes.active_color = attribute
    # Cada pieza es una cáscara cerrada: las normales hacia fuera se calculan solas.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.set_sharp_from_angle(angle=ARISTA)
    return body, malla


def material(name, color, roughness):
    """El exportador toma el color del nodo Principled, no el color de vista."""
    result = bpy.data.materials.new(name)
    result.use_nodes = True
    bsdf = result.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = color
    bsdf.inputs['Roughness'].default_value = roughness
    return result


def rig(body, malla):
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
    groups = {name: body.vertex_groups.new(name=name) for name in BONES if name != 'raiz'}
    for vertex in body.data.vertices:
        distances = []
        for name in malla.huesos[vertex.index]:
            a, b = BONES[name][0], BONES[name][1]
            point, t = intersect_point_line(vertex.co, a, b)
            point = a if t < 0 else b if t > 1 else point
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
body, malla = construir()
rig(body, malla)
body.data.calc_loop_triangles()
print(f'El Chato: {len(body.data.vertices)} vértices, {len(body.data.loop_triangles)} triángulos')
bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', export_skins=True, export_animations=False,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_yup=True,
                          export_texcoords=False, export_cameras=False, export_lights=False)
print(f'Exportado {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size // 1024} KiB)')
