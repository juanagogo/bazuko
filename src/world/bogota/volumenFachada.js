import * as THREE from 'three';
import { NEIGHBORHOODS } from './NeighborhoodIdentity.js';

// Lo que sale de la fachada de una casa: el alero de la placa, dinteles, alféizares, la franja del entrepiso, alguna caja
// de aire y alguna antena. Se suma a las mallas de detalle que la pared y la azotea ya tienen, así que la ciudad no gana
// mallas, materiales ni pedidos de dibujo, y no se gasta azar: nada de three nace aquí y lo sorteado sale de la semilla.
const FACE_BASIS = { 0: [0, -1, 1, 0], 1: [0, 1, -1, 0], 4: [1, 0, 0, 1], 5: [-1, 0, 0, -1] };
/** Caras de la caja unidad, la de atrás (la que da a la pared) de última para poder dejarla. */
const CARAS = [
  [[1, 0, 0], [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5]]],
  [[-1, 0, 0], [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5]]],
  [[0, 1, 0], [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5]]],
  [[0, -1, 0], [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5]]],
  [[0, 0, 1], [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]]],
  [[0, 0, -1], [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5]]]
];
const UV_CARA = [0, 0, 1, 0, 1, 1, 0, 1];
/** La pared queda 9,5 cm detrás de la planta; las piezas arrancan dentro de ella para no dejar rendija. */
const FONDO = -.12;
/** Medidas en metros; las alturas del dintel y el alféizar, desde el borde de su ventana. */
export const VOLUMEN = Object.freeze({
  alero: Object.freeze({ vuelo: .4, grueso: .18, bajoAzotea: .805 }),
  dintel: Object.freeze({ desde: .065, alto: .19, sobra: .34, sale: .07 }),
  alfeizar: Object.freeze({ bajo: .175, hasta: .1, sobra: .3, sale: .09 }),
  franja: Object.freeze({ desde: 3.4, alto: .15, sale: .12 }),
  caja: Object.freeze({ ancho: .72, alto: .48, sale: .3, bajo: .45, cada: 6 }),
  antena: Object.freeze({ mastil: 1.6, brazo: .9, cada: 4 })
});
const mezclar = valor => {
  let v = Math.imul(valor ^ (valor >>> 16), 0x7feb352d);
  v = Math.imul(v ^ (v >>> 15), 0x846ca68b);
  return (v ^ (v >>> 16)) >>> 0;
};

const coloresPorBarrio = new Map();
function colores(neighborhood) {
  const perfil = NEIGHBORHOODS[neighborhood] ?? NEIGHBORHOODS.centro;
  if (!coloresPorBarrio.has(perfil.id)) {
    const p = perfil.palette;
    coloresPorBarrio.set(perfil.id, { trim: new THREE.Color(p.trim), concrete: new THREE.Color(p.plinth), metal: new THREE.Color(p.metal) });
  }
  return coloresPorBarrio.get(perfil.id);
}

/** Las mallas agrupadas de un grupo, reconocidas por el color del barrio y la superficie de su material. */
function mallasDe(grupo, color) {
  const mallas = {};
  for (const mesh of grupo.children) {
    if (!mesh.isMesh || !mesh.userData.buildingDetails || !mesh.geometry.index) continue;
    const m = mesh.material, claves = Object.keys(mesh.geometry.attributes);
    if (claves.length !== 3 || !['position', 'normal', 'uv'].every(clave => claves.includes(clave))) continue;
    if (m.roughness === .86 && !m.map && m.color.equals(color.trim)) mallas.trim = mesh;
    else if (m.roughness === .94 && !m.map && m.color.equals(color.concrete)) mallas.concrete = mesh;
    else if (m.metalness === .25 && !m.map && m.color.equals(color.metal)) mallas.metal = mesh;
  }
  return mallas;
}

/** Cajas en la base de una cara: `u` a lo largo, `y` hacia arriba y `v` hacia fuera desde el plano de la planta. */
function cajas(face, plane) {
  const [ux, uz, nx, nz] = FACE_BASIS[face];
  const out = { position: [], normal: [], uv: [], index: [] };
  return {
    out,
    caja(u, y0, y1, ancho, v0, v1, completa = false) {
      const h = y1 - y0, d = v1 - v0, cy = (y0 + y1) / 2, cv = (v0 + v1) / 2 + plane;
      for (let k = 0; k < (completa ? 6 : 5); k++) {
        const [n, esquinas] = CARAS[k], base = out.position.length / 3;
        for (const [a, b, c] of esquinas) {
          const pa = a * ancho + u, pc = c * d + cv;
          out.position.push(ux * pa + nx * pc, b * h + cy, uz * pa + nz * pc);
          out.normal.push(ux * n[0] + nx * n[2], n[1], uz * n[0] + nz * n[2]);
        }
        out.uv.push(...UV_CARA);
        out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  };
}

/** Suma las cajas a la geometría de una malla que ya existe; devuelve los triángulos añadidos. */
function sumar(mesh, out) {
  if (!mesh || !out.index.length) return 0;
  const geometry = mesh.geometry, antes = geometry.attributes.position.count;
  for (const clave of ['position', 'normal', 'uv']) {
    const viejo = geometry.attributes[clave].array, nuevo = new Float32Array(viejo.length + out[clave].length);
    nuevo.set(viejo);
    nuevo.set(out[clave], viejo.length);
    geometry.setAttribute(clave, new THREE.Float32BufferAttribute(nuevo, clave === 'uv' ? 2 : 3));
  }
  const indice = Array.from(geometry.index.array);
  for (const i of out.index) indice.push(antes + i);
  geometry.setIndex(indice);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return out.index.length / 3;
}

/**
 * Da volumen a la fachada de una casa ya detallada por `addBuildingDetails`, antes de `BuildingVisibility.register`.
 * Las medidas son locales al cascarón, como allá. Si la pared no tiene la malla de una pieza, la pieza no va.
 */
export function sumarVolumen({ shell, width, depth, height, floors, face = 4, seed = 0, neighborhood = 'centro', ruin = false }) {
  const resultado = { triangulos: 0, alero: false, dinteles: [], alfeizares: [], franja: null, caja: null, antena: null };
  const wall = shell?.walls.get(face);
  if (!wall || !FACE_BASIS[face] || width <= 0 || depth <= 0 || height <= 0 || floors < 2) return resultado;
  const color = colores(neighborhood), mallas = mallasDe(wall, color);
  const length = face < 2 ? depth : width, plane = (face < 2 ? width : depth) / 2;
  const placa = cajas(face, plane), concreto = mallas.concrete ?? mallas.trim;
  if (!concreto) return resultado;
  // El borde de la placa de la azotea vuela sobre la calle y deja arriba el antepecho.
  const { vuelo, grueso, bajoAzotea } = VOLUMEN.alero, techo = height - bajoAzotea;
  placa.caja(0, techo - grueso, techo, length - .06, FONDO, vuelo);
  resultado.alero = true;
  // La planta de ventanas de `addBuildingDetails` en una casa, que tampoco usa azar.
  const floorHeight = height / floors;
  const bay = length / Math.max(1, Math.round(length / 3.2));
  const rows = Math.max(0, Math.min(5, Math.floor(height / floorHeight) - 1));
  const windowWidth = Math.min(1.8, bay * .51), windowHeight = Math.min(1.55, floorHeight * .48);
  const centers = [];
  for (let column = 0; column < Math.ceil(length / bay) && centers.length < 4; column++) {
    const center = -length / 2 + bay * (column + .5);
    if (Math.abs(center) + windowWidth / 2 + .11 <= length / 2) centers.push(center);
  }
  const { dintel, alfeizar } = VOLUMEN;
  for (let floor = 1; floor <= rows; floor++) {
    const y = (floor + .54) * floorHeight, bottom = y - windowHeight / 2, top = y + windowHeight / 2;
    for (const u of centers) {
      // Bajo el alero no cabe: la ventana del último piso termina en la placa.
      if (top + dintel.alto <= techo - grueso - .05) {
        placa.caja(u, top + dintel.desde, top + dintel.alto, windowWidth + dintel.sobra, FONDO, dintel.sale);
        resultado.dinteles.push([u, top]);
      }
      placa.caja(u, bottom - alfeizar.bajo, bottom - alfeizar.hasta, windowWidth + alfeizar.sobra, FONDO, alfeizar.sale);
      resultado.alfeizares.push([u, bottom]);
    }
  }
  resultado.triangulos += sumar(concreto, placa.out);
  // La franja del entrepiso va entre el aviso del local y el primer alféizar; si no cabe, o hay balcón de madera, no va.
  const { franja } = VOLUMEN;
  if (!ruin && rows >= 1 && centers.length && mallas.trim) {
    const aviso = wall.children.find(child => child.isMesh && child.position.y > 1 && child.geometry.attributes.position.count === 4);
    if (aviso && !aviso.geometry.boundingBox) aviso.geometry.computeBoundingBox();
    const balcon = wall.children.some(child => child.isGroup && Math.abs(child.position.y - 3.1) < 1e-6);
    const y0 = Math.max(franja.desde, aviso ? aviso.position.y + aviso.geometry.boundingBox.max.y + .05 : 0);
    const primerAlfeizar = (1 + .54) * floorHeight - windowHeight / 2 - alfeizar.bajo;
    if (!balcon && y0 + franja.alto <= primerAlfeizar - .05) {
      const banda = cajas(face, plane);
      banda.caja(0, y0, y0 + franja.alto, length - .1, FONDO, franja.sale);
      resultado.triangulos += sumar(mallas.trim, banda.out);
      resultado.franja = [y0, y0 + franja.alto];
    }
  }
  const suerte = mezclar((seed ^ 0x51a7) >>> 0), { caja, antena } = VOLUMEN;
  if (!ruin && rows >= 2 && centers.length && mallas.metal && suerte % caja.cada === 0) {
    // Colgada bajo una ventana del segundo piso para arriba, sobre dos ángulos.
    const altas = (rows - 1) * centers.length, k = (suerte >>> 8) % altas;
    const u = centers[k % centers.length], floor = 2 + Math.floor(k / centers.length);
    const y1 = (floor + .54) * floorHeight - windowHeight / 2 - caja.bajo + caja.alto / 2, y0 = y1 - caja.alto;
    const lata = cajas(face, plane);
    lata.caja(u, y0, y1, caja.ancho, FONDO, caja.sale);
    for (const lado of [-1, 1]) lata.caja(u + lado * (caja.ancho / 2 - .08), y0 - .04, y0, .04, FONDO, caja.sale + .02);
    resultado.triangulos += sumar(mallas.metal, lata.out);
    resultado.caja = [u, y0, y1];
  }
  const roofMetal = shell.root.userData.detailedRoof ? mallasDe(shell.roof, color).metal : null;
  if (!ruin && roofMetal && (suerte >>> 16) % antena.cada === 0) {
    // En la esquina del antepecho contraria al tanque, con el brazo y las varillas hacia adentro de la azotea.
    const sx = seed & 1 ? -1 : 1, sz = (seed >>> 1) & 1 ? -1 : 1;
    const x = -sx * (width / 2 - .07), z = -sz * (depth / 2 - .07), y = height + antena.mastil;
    const mastil = cajas(4, 0);
    mastil.caja(x, height, y, .035, z - .0175, z + .0175, true);
    mastil.caja(x + sx * antena.brazo / 2, y - .2, y - .18, antena.brazo, z - .01, z + .01, true);
    for (const [paso, largo] of [[.5, .3], [.85, .42]]) mastil.caja(x + sx * paso, y - .2, y - .18, .02, Math.min(z, z + sz * largo), Math.max(z, z + sz * largo), true);
    sumar(roofMetal, mastil.out);
    resultado.antena = [x, z];
  }
  return resultado;
}
