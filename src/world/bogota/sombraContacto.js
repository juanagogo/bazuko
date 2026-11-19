// Sombra de contacto: la franja de penumbra y mugre al pie de cada muro y la mancha bajo lo que está clavado al andén.
// No es sombra del sol ni luz: es lo que hace que un edificio o un poste se posen en el piso en vez de flotar sobre él.
// Todo va en un lote propio, por trozos grandes, sin colisión y sin gastar el azar con que se arma la ciudad.
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { STATIC_CHUNK_SIZE, freezeStaticTransforms } from './StaticGeometry.js';
import { StreetBatch, unit } from './StreetBatch.js';
import { inLakeTerrain } from './LakePark.js';
import { scanCityEdge } from './CityEdge.js';

const T = TILE_SIZE;
const UP = [0, 1, 0];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAGONALES = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
/** Lo que levanta un muro hasta el piso. La ruina queda fuera: sus muros están rotos y la franja se vería sola. */
const MUROS = new Set(['building', 'wall', 'smallBuilding', 'storeD69', 'colpatria', 'colpatriaAnnex']);
const PISOS = new Set(['road', 'busway', 'sidewalk', 'plaza', 'floor', 'dirt', 'grass']);

export const CONTACTO = {
  ancho: 1.15,    // m que la franja se aleja del muro
  dentro: .14,    // m que se mete bajo el muro: tapa la rendija si la fachada no cae justo en el borde del tile
  alto: .024,     // m sobre el piso
  dia: .6,        // opacidad con el sol arriba
  noche: .4       // de noche el piso ya está oscuro: menos, para no abrir huecos negros
};
const V_BORDE = CONTACTO.dentro / (CONTACTO.dentro + CONTACTO.ancho);

/** Azar propio: Three sortea un identificador por malla, geometría, material y textura, y ese sorteo no puede salir del juego. */
function azarPropio(semilla = 0x50c0a7) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Caída de la penumbra con la distancia (0 pegado al muro, 1 donde se acaba): llena al pie y luego se apaga suave. */
export const caidaContacto = d => d <= .12 ? 1 : d >= 1 ? 0 : (1 - (d - .12) / .88) ** 1.7;

/**
 * Un cuarto de mancha: la distancia se mide desde la esquina (0,0). Las franjas la leen con u = 0 (solo cuenta v), las
 * esquinas con el cuarto entero y las manchas redondas con uv de −1 a 1, que el espejo de la textura completa.
 */
function texturaContacto() {
  const size = 64, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + .5, y + .5) / size, i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(caidaContacto(d) * 255);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  texture.name = 'Sombra de contacto';
  return texture;
}

function materialContacto() {
  // Pardo casi negro: al pie de los muros se junta hollín y agua sucia, no una sombra limpia.
  const material = new THREE.MeshBasicMaterial({ color: '#0d0b0a', map: texturaContacto(), vertexColors: true, transparent: true,
    opacity: CONTACTO.dia, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  material.name = 'Calle: sombra de contacto';
  return material;
}

/** La altura del piso si todos los puntos están al mismo nivel; `null` en rampas, escalones y orillas. */
function pisoPlano(district, puntos) {
  let y = null;
  for (const [x, z] of puntos) {
    const h = district.getGroundHeight(x, z);
    if (!Number.isFinite(h)) return null;
    if (y === null) y = h;
    else if (Math.abs(h - y) > .004) return null;
  }
  return y;
}

/** Qué tan cargada está la franja en cada esquina de tile: sale de la posición, así dos tramos vecinos empatan. */
const carga = (x, z) => .7 + .3 * unit(Math.round(x * 2), Math.round(z * 2), 311);

/** Franja al pie de cada muro que da a un piso plano, y un cuarto de mancha en las esquinas que salen. */
function franjasDeMuro(batch, district) {
  const { map } = district, { ancho, dentro, alto } = CONTACTO;
  const tipo = (tx, tz) => map[tz]?.[tx];
  // En la orilla, el tile `wall` frente a un parque o una plaza es una reja: deja ver el piso y no lo oscurece.
  const rejas = new Set();
  for (const { side, kind, a, b } of scanCityEdge(map)) if (kind === 'fence') for (let t = a; t <= b; t++) rejas.add(side.edge(map, t).join());
  const muro = (tx, tz) => MUROS.has(tipo(tx, tz)) && !rejas.has(`${tx},${tz}`);
  for (let tz = 0; tz < map.length; tz++) for (let tx = 0; tx < map[0].length; tx++) {
    if (!PISOS.has(tipo(tx, tz))) continue;
    const x = tx * T, z = tz * T;
    if (inLakeTerrain(x, z)) continue;
    for (const [dx, dz] of DIRS) {
      if (!muro(tx + dx, tz + dz)) continue;
      const ex = x + dx * T / 2, ez = z + dz * T / 2, ax = Math.abs(dz), az = Math.abs(dx), medio = T / 2;
      const hacia = (lado, lejos) => [ex + ax * lado - dx * lejos, ez + az * lado - dz * lejos];
      const piso = pisoPlano(district, [hacia(0, .1), hacia(-medio + .1, .1), hacia(medio - .1, .1), hacia(-medio + .1, ancho - .05), hacia(medio - .1, ancho - .05)]);
      if (piso === null) continue;
      const y = piso + alto, punto = ([px, pz]) => [px, y, pz];
      const a0 = carga(ex - ax * medio, ez - az * medio), a1 = carga(ex + ax * medio, ez + az * medio);
      batch.quad(punto(hacia(-medio, -dentro)), punto(hacia(medio, -dentro)), punto(hacia(medio, ancho)), punto(hacia(-medio, ancho)), UP,
        [0, 0, 0, 1], [[1, 1, 1, a0], [1, 1, 1, a1], [1, 1, 1, a1], [1, 1, 1, a0]]);
    }
    for (const [sx, sz] of DIAGONALES) {
      if (!muro(tx + sx, tz + sz) || muro(tx + sx, tz) || muro(tx, tz + sz)) continue;
      const cx = x + sx * T / 2, cz = z + sz * T / 2;
      const piso = pisoPlano(district, [[cx - sx * .1, cz - sz * .1], [cx - sx * (ancho - .05), cz - sz * .1], [cx - sx * .1, cz - sz * (ancho - .05)]]);
      if (piso === null) continue;
      const y = piso + alto;
      batch.quad([cx, y, cz], [cx - sx * ancho, y, cz], [cx - sx * ancho, y, cz - sz * ancho], [cx, y, cz - sz * ancho], UP,
        [V_BORDE, V_BORDE, 1, 1], [1, 1, 1, carga(cx, cz)]);
    }
  }
}

/** Mancha blanda centrada en (cx, cz), partida por tiles para que baje del andén a la calzada sin quedar en el aire. */
function mancha(batch, district, cx, cz, hw, hd, fuerza) {
  const { map } = district, color = [1, 1, 1, fuerza];
  for (let tz = Math.round((cz - hd) / T); tz <= Math.round((cz + hd) / T); tz++) {
    for (let tx = Math.round((cx - hw) / T); tx <= Math.round((cx + hw) / T); tx++) {
      if (!PISOS.has(map[tz]?.[tx]) || inLakeTerrain(tx * T, tz * T)) continue;
      const x0 = Math.max(tx * T - T / 2, cx - hw), x1 = Math.min(tx * T + T / 2, cx + hw);
      const z0 = Math.max(tz * T - T / 2, cz - hd), z1 = Math.min(tz * T + T / 2, cz + hd);
      if (x0 >= x1 || z0 >= z1) continue;
      const piso = pisoPlano(district, [[(x0 + x1) / 2, (z0 + z1) / 2], [x0 + .01, z0 + .01], [x1 - .01, z1 - .01]]);
      if (piso === null) continue;
      const y = piso + CONTACTO.alto + .004;
      const uv = [(x0 - cx) / hw, (z1 - cz) / hd, (x1 - cx) / hw, (z0 - cz) / hd];
      batch.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], UP, uv, color);
    }
  }
}


/** Lo clavado al piso: postes de cables, semáforos, faroles, bancas y puestos de venta. */
function manchasDeMobiliario(batch, district, poles) {
  for (const pole of poles ?? []) mancha(batch, district, pole.x, pole.z, .8, .8, 1);
  for (const pole of district.signals?.poles ?? []) mancha(batch, district, pole.x, pole.z, .85, .85, 1);
  for (const prop of district.props ?? []) {
    const base = prop.instance?.group?.position;
    if (base) mancha(batch, district, base.x, base.z, .85, .85, 1);
  }
  for (const spot of district.benchSpots ?? []) {
    const { x, z, rot = 0 } = spot;
    const girada = Math.abs(Math.sin(rot)) > .7;
    mancha(batch, district, x, z, girada ? .85 : 1.4, girada ? 1.4 : .85, .24);
  }
  for (const { position } of district.vendors ?? []) if (position) mancha(batch, district, position.x, position.z, 1.7, 1.7, .9);
}

/**
 * Arma el lote y lo cuelga del barrio. `poles` son los postes de cables que acaba de plantar la calle.
 * La opacidad sigue la hora que publica la escena (`environmentDay`: 1 de día, 0 de noche).
 */
export function addContactShade(district, poles = []) {
  const delJuego = Math.random;
  Math.random = azarPropio();
  try {
    const material = materialContacto();
    const batch = new StreetBatch({ material, name: 'Sombra de contacto', alpha: true, receiveShadow: false, renderOrder: 0, chunkSize: STATIC_CHUNK_SIZE * 4 });
    franjasDeMuro(batch, district);
    manchasDeMobiliario(batch, district, poles);
    const group = new THREE.Group();
    group.name = 'Calle: sombra de contacto';
    group.userData.noMerge = true;
    for (const mesh of batch.finish(group)) {
      mesh.onBeforeRender = (_renderer, scene) => {
        material.opacity = CONTACTO.noche + (CONTACTO.dia - CONTACTO.noche) * (scene?.userData?.environmentDay ?? 1);
      };
    }
    district.group.add(group);
    freezeStaticTransforms(group);
    return group;
  } finally {
    Math.random = delJuego;
  }
}
