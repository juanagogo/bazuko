#!/usr/bin/env python3
"""Retoques que necesitan las texturas exportadas de MakeHuman antes de entrar al juego.

El juego no muestra marcas. Aquí se quitan el logo del pecho de las camisetas, la etiqueta de cuero
del jean, la hebilla con letra del overol y, en los tenis, la marca de la puntera y la etiqueta de la
lengüeta. Cada zona se rellena con el tono de alrededor más el grano de la misma prenda tomado de otro
lugar. También pasa a café el iris de los ojos, que en la textura es de un óxido que con la luz del
juego se ve rojo. Las notas de licencia de las esquinas de los atlas se quedan.

WebP guarda con pérdida: cada pasada degrada la imagen entera, también lo que no se retoca. Por eso hay
que partir siempre de las texturas recién exportadas. tools/personaje/texturas-limpias.json anota el
sha256 de cada original y de cada resultado: lo que ya está limpio se deja como está, y lo que no
coincide con ninguno de los dos se trata como exportación nueva y se avisa, porque hay que mirarlo. La
prueba de marcas compara esa tabla con los archivos del juego, así que olvidar este paso la hace caer.

    python3 tools/personaje/limpiar_marcas.py [carpeta de originales] [carpeta de destino]

Sin argumentos, origen y destino son las texturas del juego; con un solo argumento, destino y origen
son esa carpeta.
"""
import hashlib
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageDraw

RAIZ = pathlib.Path(__file__).resolve().parents[2]
TEXTURAS = RAIZ / 'public/models/personaje/texturas'
TABLA = RAIZ / 'tools/personaje/texturas-limpias.json'

# Logos sobre tela lisa. (x0, y0, x1, y1, dx, dy, umbral): rectángulo con la marca, en píxeles de la
# imagen de 1024, de cuánto se aparta el lugar del que se copia el grano y cuánto debe apartarse un
# píxel del tono local para contar como marca. El rectángulo no debe tocar ni el cuello ni un ribete.
LOGOS = {
    'male_casualsuit02_diffuse.webp': [(505, 100, 645, 240, 0, 150, 18)],
    'male_casualsuit06_diffuse.webp': [(450, 120, 640, 215, 0, 110, 18), (195, 120, 300, 165, 0, 80, 18), (745, 150, 775, 185, 0, 70, 18)],
    'female_casualsuit01_diffuse.webp': [(722, 156, 902, 320, -170, 0, 18)],
    'female_casualsuit02_diffuse.webp': [(722, 156, 902, 320, -170, 0, 18)],
}

# Etiqueta de cuero del jean. (x0, y0, x1, y1, dx, dy): rectángulo y origen del grano. La marca son los
# píxeles más rojos que azules del rectángulo: el jean es azul y el cuero no.
ETIQUETAS = {
    'male_casualsuit02_diffuse.webp': [(500, 426, 580, 470, 0, 24)],
    'male_casualsuit03_diffuse.webp': [(540, 12, 622, 56, 0, 24), (192, 38, 236, 54, 0, 10)],
    'male_casualsuit05_diffuse.webp': [(380, 578, 448, 614, 0, 20)],
    'male_casualsuit06_diffuse.webp': [(492, 458, 566, 498, 0, 24)],
    'female_casualsuit01_diffuse.webp': [(492, 458, 566, 498, 0, 24)],
}

# Placa de la hebilla del overol, una isla gris sobre el negro del atlas: (x0, y0, x1, y1).
HEBILLAS = {'male_worksuit01_diffuse.webp': [(200, 812, 246, 880)]}

# Parches a mano: polígono con la marca, de dónde se toma el relleno (dx, dy), radio del detalle que se
# copia (el resto del tono sale de alrededor) y tope de ese detalle.
PARCHES = {
    'shoes06_diffuse.webp': [
        ([(476, 432), (560, 397), (578, 410), (494, 450)], -10, -30, 14, 40),
        ([(472, 826), (482, 822), (492, 830), (510, 820), (534, 810), (538, 820), (512, 836), (492, 850), (474, 846)], 12, 32, 6, 60),
    ],
}

# Los dos iris de brown_eye.webp: centro x, y y radio en la imagen de 1024; color por unidad de brillo.
OJOS = 'brown_eye.webp'
IRIS = [(722, 305, 122), (296, 727, 122)]
CAFE = np.array([1.40, .92, .52])

CALIDAD = 90
CALIDAD_OJOS = 92


def desenfocar(canales, radio):
    """Tres pasadas de caja: basta para sacar el tono de fondo y no pide más que numpy."""
    salida = canales.astype(np.float64)
    ancho = radio * 2 + 1
    for _ in range(3):
        for eje in (0, 1):
            suma = np.cumsum(np.concatenate([np.take(salida, [0] * (radio + 1), axis=eje), salida, np.take(salida, [-1] * radio, axis=eje)], axis=eje), axis=eje)
            salida = (np.take(suma, range(ancho, suma.shape[eje]), axis=eje) - np.take(suma, range(0, suma.shape[eje] - ancho), axis=eje)) / ancho
    return salida


def plano(mascara, radio):
    return desenfocar(mascara.astype(np.float64)[..., None], radio)[..., 0]


def tono_alrededor(pixeles, libre, radios):
    """Convolución normalizada: promedia solo lo libre, con el radio más corto que alcance a ver tela."""
    libre = libre.astype(np.float64)[..., None]
    tono = None
    for radio in radios:
        peso = desenfocar(libre, radio)
        estimado = desenfocar(pixeles * libre, radio) / np.maximum(peso, 1e-6)
        tono = estimado if tono is None else np.where(peso > .3, estimado, tono)
    return tono


def difundir(pixeles, marca, libre, pasos=2500):
    """Tono de la marca por difusión desde lo que la rodea: va de un borde al otro sin escalones."""
    filas, columnas = np.nonzero(marca)
    y0, y1 = max(0, filas.min() - 2), filas.max() + 3
    x0, x1 = max(0, columnas.min() - 2), columnas.max() + 3
    caja = desenfocar(pixeles, 1)[y0:y1, x0:x1]
    dentro = marca[y0:y1, x0:x1]
    conocido = (libre[y0:y1, x0:x1] & ~dentro).astype(np.float64)[..., None]
    caja[dentro] = (caja * conocido).sum(axis=(0, 1)) / max(conocido.sum(), 1)
    conocido = np.where(dentro[..., None], 1., conocido)
    cuenta = np.zeros_like(conocido)
    cuenta[1:] += conocido[:-1]
    cuenta[:-1] += conocido[1:]
    cuenta[:, 1:] += conocido[:, :-1]
    cuenta[:, :-1] += conocido[:, 1:]
    for _ in range(pasos):
        pesada = caja * conocido
        suma = np.zeros_like(caja)
        suma[1:] += pesada[:-1]
        suma[:-1] += pesada[1:]
        suma[:, 1:] += pesada[:, :-1]
        suma[:, :-1] += pesada[:, 1:]
        caja[dentro] = (suma / np.maximum(cuenta, 1))[dentro]
    tono = pixeles.copy()
    tono[y0:y1, x0:x1] = caja
    return tono


def grano(pixeles, dx, dy, radio, tope):
    """El detalle de otro lugar de la prenda: lo que se aparte de más ya no es grano."""
    origen = np.roll(np.roll(pixeles, -dy, axis=0), -dx, axis=1)
    return np.clip(origen - desenfocar(origen, radio), -tope, tope)


def fundir(pixeles, peso, relleno):
    # Se escribe en toda la imagen: el peso ya se apaga solo, así que no queda el borde de un rectángulo.
    pixeles[:] = pixeles * (1 - peso[..., None]) + relleno * peso[..., None]


def quitar_logo(pixeles, zona):
    x0, y0, x1, y1, dx, dy, umbral = zona
    # Máscara: lo que se aparta del tono de la tela dentro del rectángulo, ampliado para llevarse el borde suave.
    margen = 24
    alrededor = pixeles[max(0, y0 - margen):y1 + margen, max(0, x0 - margen):x1 + margen].reshape(-1, 3)
    tela = np.median(alrededor, axis=0)
    fondo = desenfocar(pixeles, 28)
    distancia = np.abs(pixeles - np.where(np.abs(fondo - tela).sum(axis=2, keepdims=True) < 60, fondo, tela)).sum(axis=2)
    marca = np.zeros(pixeles.shape[:2])
    marca[y0:y1, x0:x1] = distancia[y0:y1, x0:x1] > umbral
    marca = plano(marca, 3) > .03
    # El tono se toma sin lo que se va a tapar ni lo que no es esa tela (el fondo del atlas o el cuello).
    libre = ~marca & (np.abs(pixeles - tela).sum(axis=2) < 70)
    relleno = tono_alrededor(pixeles, libre, (90, 40, 16)) + grano(pixeles, dx, dy, 6, 16)
    fundir(pixeles, np.clip(plano(marca, 2) * 1.8, 0, 1), relleno)


def quitar_etiqueta(pixeles, zona):
    x0, y0, x1, y1, dx, dy = zona
    rojo, azul, suma = pixeles[..., 0], pixeles[..., 2], pixeles.sum(axis=2)
    calido = np.zeros(pixeles.shape[:2], dtype=bool)
    calido[y0:y1, x0:x1] = ((rojo - azul > 10) & (suma > 150))[y0:y1, x0:x1]
    # Se abre para soltar píxeles sueltos y se amplía para llevarse el filo claro del cuero.
    calido = plano(calido, 1) > .35
    marca = plano(calido, 2) > .12
    jean = (azul - rojo > 6) & (suma > 150)
    # Lo que no es jean ni cuero (el negro del atlas, otra prenda) se queda como estaba.
    marca &= jean | calido | (np.abs(rojo - azul) < 12) & (suma > 150) & (suma < 620)
    relleno = difundir(pixeles, marca, jean) + grano(pixeles, dx, dy, 2, 6)
    fundir(pixeles, np.clip(plano(marca, 1) * 1.6, 0, 1) * (suma > 110), relleno)


def alisar_hebilla(pixeles, zona):
    x0, y0, x1, y1 = zona
    isla = np.zeros(pixeles.shape[:2], dtype=bool)
    isla[y0:y1, x0:x1] = pixeles[y0:y1, x0:x1].sum(axis=2) > 120
    # Un radio ancho se lleva el relieve de la letra y deja el degradado de la placa. El peso se queda
    # dentro de la isla para no tocar su borde contra el negro.
    relleno = tono_alrededor(pixeles, isla, (12,))
    fundir(pixeles, np.clip((plano(isla, 2) - .55) * 3.5, 0, 1), relleno)


def poner_parche(pixeles, parche):
    vertices, dx, dy, radio, tope = parche
    alto, ancho = pixeles.shape[:2]
    lienzo = Image.new('L', (ancho, alto), 0)
    ImageDraw.Draw(lienzo).polygon(vertices, fill=255)
    marca = np.asarray(lienzo) > 0
    relleno = difundir(pixeles, plano(marca, 2) > .02, np.ones(marca.shape, dtype=bool)) + grano(pixeles, dx, dy, radio, tope)
    fundir(pixeles, np.clip(plano(marca, 2) * 1.5, 0, 1), relleno)


def iris_cafe(entrada):
    pixeles = entrada[..., :3].astype(np.float64)
    alto, ancho = pixeles.shape[:2]
    y, x = np.mgrid[0:alto, 0:ancho]
    peso = np.zeros((alto, ancho))
    for cx, cy, radio in IRIS:
        peso = np.maximum(peso, np.clip((radio - np.hypot(x - cx, y - cy)) / 8, 0, 1))
    brillo = (pixeles * [.299, .587, .114]).sum(axis=2, keepdims=True)
    pixeles = pixeles * (1 - peso[..., None]) + brillo * CAFE / (CAFE * [.299, .587, .114]).sum() * peso[..., None]
    return np.dstack([np.clip(pixeles + .5, 0, 255).astype(np.uint8), entrada[..., 3]])


def retocar(nombre, ruta):
    """Devuelve la imagen retocada."""
    if nombre == OJOS:
        return Image.fromarray(iris_cafe(np.asarray(Image.open(ruta).convert('RGBA'))), 'RGBA'), CALIDAD_OJOS
    pixeles = np.asarray(Image.open(ruta).convert('RGB')).astype(np.float64)
    for zona in LOGOS.get(nombre, ()):
        quitar_logo(pixeles, zona)
    for zona in ETIQUETAS.get(nombre, ()):
        quitar_etiqueta(pixeles, zona)
    for zona in HEBILLAS.get(nombre, ()):
        alisar_hebilla(pixeles, zona)
    for parche in PARCHES.get(nombre, ()):
        poner_parche(pixeles, parche)
    return Image.fromarray(np.clip(pixeles + .5, 0, 255).astype(np.uint8), 'RGB'), CALIDAD


def sha256(ruta):
    return hashlib.sha256(ruta.read_bytes()).hexdigest()


def main():
    origen = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else TEXTURAS
    destino = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else origen
    tabla = json.loads(TABLA.read_text()) if TABLA.exists() else {}
    nombres = sorted({OJOS, *LOGOS, *ETIQUETAS, *HEBILLAS, *PARCHES})
    for nombre in nombres:
        ruta = origen / nombre
        huella = sha256(ruta)
        anotada = tabla.get(nombre, {})
        if huella == anotada.get('limpia'):
            print(nombre, 'ya está limpia')
            continue
        if huella != anotada.get('original'):
            print(nombre, 'exportación nueva: hay que mirarla en grande antes de darla por buena')
        imagen, calidad = retocar(nombre, ruta)
        salida = destino / nombre
        imagen.save(salida, quality=calidad, method=6)
        tabla[nombre] = {'original': huella, 'limpia': sha256(salida)}
        print(nombre, salida.stat().st_size, 'bytes')
    TABLA.write_text(json.dumps(tabla, indent=2, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    main()
