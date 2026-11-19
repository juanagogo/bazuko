// src/world/bogota/carBeam.js
// La luz de un carro sobre el pavimento: por delante el charco cálido de los dos faros, fuerte junto al bómper y largo
// hasta perderse; por detrás, el rojo de los stops tendido en el piso. Va todo en la malla del haz que el carro ya
// tenía: una textura pintada una sola vez y dos cuadros por largo de carro, compartidos por la flota. No añade pedidos
// de dibujo, materiales ni luces.
import * as THREE from 'three';
import { streetWetness } from '../../character/streetMaterials.js';
import { alturaPorTrayecto } from '../../systems/apoyoCarro.js';
import { cortarSardineles, prepararCortes } from './carBeamCurb.js';

// El haz se cuelga 4 m delante de la trompa (`vehicles.js`); los cuadros se miden desde ahí.
const AHEAD = 4;
// Metros desde la trompa hacia adelante (desde, hasta) y ancho.
const FRONT = [-.35, 10.4, 4.8];
// Metros desde la cola hacia atrás (desde, hasta) y ancho.
const REAR = [-.3, 3.4, 3.1];
// La textura lleva los faros a la izquierda y los stops a la derecha, con una franja negra entre los dos.
const SIZE = [256, 128], FRONT_END = 168, REAR_START = 176;

let texture = null;
const geometries = new Map();

function paint() {
  if (typeof document === 'undefined') return new THREE.Texture();
  const canvas = document.createElement('canvas');
  canvas.width = SIZE[0]; canvas.height = SIZE[1];
  const ctx = canvas.getContext?.('2d');
  if (!ctx || typeof ctx.createRadialGradient !== 'function') return new THREE.Texture();
  // Fondo negro y mezcla que suma: el material es aditivo, así que el negro no pinta nada. Los valores se leen tal cual,
  // sin curva de color: son cantidad de luz, y el tono cálido lo pone el color del material.
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SIZE[0], SIZE[1]);
  ctx.globalCompositeOperation = 'lighter';
  const blob = (cx, cy, rx, ry, stops) => {
    ctx.save(); ctx.translate(cx, cy); ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [t, color] of stops) g.addColorStop(t, color);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  };
  const mid = SIZE[1] / 2;
  // Faros: dos manchas calientes junto al bómper, el tiro de cada uno y una cola ancha y tenue.
  for (const side of [-1, 1]) {
    blob(30, mid + side * 16, 28, 20, [[0, 'rgba(255,248,236,.34)'], [.5, 'rgba(255,246,230,.14)'], [1, 'rgba(255,246,230,0)']]);
    blob(70, mid + side * 9, 66, 40, [[0, 'rgba(255,246,230,.22)'], [.45, 'rgba(255,244,226,.11)'], [1, 'rgba(255,244,226,0)']]);
  }
  blob(100, mid, 66, 52, [[0, 'rgba(255,244,226,.1)'], [1, 'rgba(255,244,226,0)']]);
  // Stops: detrás de cada uno, un rojo alargado como reflejo en el piso, y su estela corta hacia atrás.
  // Rojo ladrillo: el rojo puro sobre el asfalto azulado de la noche se leía magenta.
  for (const side of [-1, 1]) {
    blob(REAR_START + 34, mid + side * 24, 32, 24, [[0, 'rgba(230,60,22,.3)'], [.5, 'rgba(226,56,20,.13)'], [1, 'rgba(226,56,20,0)']]);
  }
  blob(REAR_START + 40, mid, 38, 50, [[0, 'rgba(226,56,20,.14)'], [1, 'rgba(226,56,20,0)']]);
  const map = new THREE.CanvasTexture(canvas);
  map.name = 'Luz de carro sobre el pavimento';
  return map;
}

function geometryFor(length, sigueSuelo = false) {
  const key = Math.round(length * 100);
  let geometry = !sigueSuelo && geometries.get(key);
  if (geometry) return geometry;
  const position = [], uv = [], normal = [], index = [], tramos = [];
  const quad = (x0, x1, width, u0, u1, delante) => {
    const largo = sigueSuelo ? Math.ceil((x1 - x0) / .75) : 1;
    const ancho = sigueSuelo ? 2 : 1;
    for (let j = 0; j <= ancho; j++) {
      const inicio = position.length / 3;
      for (let i = 0; i <= largo; i++) {
        position.push(x0 + (x1 - x0) * i / largo, width * (j / ancho - .5), 0);
        uv.push(u0 + (u1 - u0) * i / largo, j / ancho);
        normal.push(0, 0, 1);
        if (i < largo && j < ancho) {
          const a = inicio + i, b = a + largo + 1;
          index.push(a, a + 1, b + 1, a, b + 1, b);
        }
      }
      if (sigueSuelo) tramos.push({ inicio: delante ? inicio : inicio + largo, largo, paso: delante ? 1 : -1 });
    }
  };
  const tail = -AHEAD - length;
  quad(-AHEAD + FRONT[0], -AHEAD + FRONT[1], FRONT[2], 0, FRONT_END / SIZE[0], true);
  quad(tail - REAR[1], tail - REAR[0], REAR[2], 1, REAR_START / SIZE[0], false);
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.name = 'Luz de carro sobre el pavimento';
  if (sigueSuelo) {
    geometry.userData.cortes = prepararCortes(geometry);
    geometry.userData.tramos = tramos;
  } else geometries.set(key, geometry);
  return geometry;
}

/** Viste el haz de un carro con el charco de sus faros y el rojo de sus stops. La geometría y la textura son compartidas. */
export function layCarLight(beam, length) {
  beam.geometry = geometryFor(length);
  texture ??= paint();
  beam.material.map = texture;
  rojoSegunPiso(beam.material);
}

/** Los faros del jugador siguen el pavimento aunque el chasis cabecee. Cada fila sigue la misma calzada desde el carro. */
export function proyectarHazJugador(carro, suelo, nivel) {
  const haz = carro.vehicle?.beam;
  if (!haz?.visible) return;
  if (!haz.geometry.userData.tramos) {
    haz.geometry = geometryFor(carro.length, true);
    carro.group.add(haz);
  }
  const p = carro.position, h = carro.group.rotation.y, estado = haz.userData;
  haz.position.y = .03 - p.y;
  if (p.x === estado.x && p.z === estado.z && h === estado.rumbo && nivel === estado.nivel) return;
  estado.x = p.x; estado.z = p.z; estado.rumbo = h; estado.nivel = nivel;
  const c = Math.cos(h), s = Math.sin(h), vertices = haz.geometry.attributes.position;
  let cambio = false, minima = Infinity, maxima = -Infinity;
  for (const { inicio, largo, paso } of haz.geometry.userData.tramos) {
    let px = p.x, pz = p.z, altura = nivel;
    for (let j = 0, i = inicio; j <= largo; j++, i += paso) {
      const lx = haz.position.x + vertices.getX(i), lz = -vertices.getY(i);
      const x = p.x + lx * c + lz * s, z = p.z - lx * s + lz * c;
      // La primera muestra puede caer metros más adelante en una rampa; las siguientes distan 75 cm o menos.
      altura = j === 0 ? alturaPorTrayecto(suelo, px, pz, altura, x - px, z - pz) : suelo(x, z, altura) ?? altura;
      minima = Math.min(minima, altura); maxima = Math.max(maxima, altura);
      if (Math.abs(vertices.getZ(i) - altura) > .0001) { vertices.setZ(i, altura); cambio = true; }
      px = x; pz = z;
    }
  }
  cortarSardineles(haz.geometry, (x, y, referencia) => {
    const lx = haz.position.x + x;
    return suelo(p.x + lx * c - y * s, p.z - lx * s - y * c, referencia) ?? referencia;
  }, maxima - minima);
  if (cambio) { vertices.needsUpdate = true; haz.geometry.computeBoundingSphere(); }
}

// Desde aquí, a lo largo de la textura, todo es el rojo de los stops.
const ROJO_DESDE = ((FRONT_END + REAR_START) / 2 / SIZE[0]).toFixed(4);
/** Con el piso seco el rojo de los stops apenas se refleja: va a la mitad, y entero con el piso mojado. */
function rojoSegunPiso(material) {
  if (material.userData.rojoSegunPiso) return;
  material.userData.rojoSegunPiso = true;
  const previo = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previo?.call(material, shader, renderer);
    shader.uniforms.uPisoMojado = streetWetness;
    shader.fragmentShader = `uniform float uPisoMojado;\n${shader.fragmentShader}`.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb *= mix( 1., mix( .5, 1., uPisoMojado ), step( ${ROJO_DESDE}, vMapUv.x ) );`);
  };
  material.customProgramCacheKey = () => 'luz-aditiva-niebla-stops';
}
