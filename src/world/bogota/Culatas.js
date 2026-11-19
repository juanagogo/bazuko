import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { PIEZAS, uvDe, proporcion, texturaDeCulatas } from './culatasAtlas.js';
import { chainSunField } from './SunFieldShader.js';

/**
 * Culatas: murales, avisos a brocha, firmas y carteles en los costados ciegos de las casas y en los pilares
 * del viaducto. Solo se ven: no chocan ni cambian el mapa. Qué muro lleva qué pieza sale de un sorteo propio
 * por posición, y todo se crea con azar propio, así que el azar sembrado del juego no gasta un número de más.
 */
const SEMILLA = 0xc01a7a;
const NORMAL = { 0: [1, 0], 1: [-1, 0], 4: [0, 1], 5: [0, -1] };
const SEPARA = .02;      // del plano del muro
const TROZO = 64;        // una malla por zona
const ZOCALO = 1.0;      // por debajo no se pinta: ahí va el zócalo sucio
const MURALES = Object.keys(PIEZAS).filter((nombre) => PIEZAS[nombre].tipo === 'mural');
const AVISOS = Object.keys(PIEZAS).filter((nombre) => ['aviso', 'tapada'].includes(PIEZAS[nombre].tipo));
/** La misma pieza no se repite tan cerca: de una a otra hay por lo menos esto, en metros. */
export const SIN_REPETIR = 80;

function azarDe(semilla) {
  let s = semilla >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sorteo estable de un muro: depende de dónde está, no del orden en que se arma la ciudad. */
export function sorteo(sal, ...numeros) {
  let h = (SEMILLA ^ sal) >>> 0;
  for (const n of numeros) {
    h ^= Math.round(n * 8) | 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Decide las piezas de los costados ciegos.
 * `lotes`: { x0, x1, z0, z1, alto, ciegas: [cara] } con las caras de la caja (0 +x, 1 −x, 4 +z, 5 −z).
 * `ocupado(x, z)`: hay algo construido que no está en `lotes` (no se pinta contra eso).
 */
export function planCulatas(lotes, ocupado = () => false) {
  const piezas = [], puestas = [];
  const cercania = (nombre, x, z) => puestas.reduce((menor, p) => p.nombre === nombre ? Math.min(menor, Math.hypot(p.x - x, p.z - z)) : menor, Infinity);
  // Se recorre la lista desde donde cae el sorteo y se toma la primera que no esté ya a menos de SIN_REPETIR.
  const elegir = (lista, desde, x, z) => {
    for (let k = 0; k < lista.length; k++) {
      const nombre = lista[(desde + k) % lista.length];
      if (cercania(nombre, x, z) >= SIN_REPETIR) return nombre;
    }
    return null;
  };
  const altoEn = (x, z, propio) => {
    let alto = 0;
    for (const l of lotes) if (l !== propio && x > l.x0 && x < l.x1 && z > l.z0 && z < l.z1) alto = Math.max(alto, l.alto);
    return alto;
  };
  for (const lote of lotes) for (const cara of lote.ciegas ?? []) {
    const [nx, nz] = NORMAL[cara], miraEnX = nx !== 0;
    const ancho = miraEnX ? lote.z1 - lote.z0 : lote.x1 - lote.x0;
    const plano = miraEnX ? (nx > 0 ? lote.x1 : lote.x0) : (nz > 0 ? lote.z1 : lote.z0);
    const medio = miraEnX ? (lote.z0 + lote.z1) / 2 : (lote.x0 + lote.x1) / 2;
    let vecino = 0, tapada = false;
    for (const t of [-.4, -.2, 0, .2, .4]) for (const lejos of [.7, 2.2]) {
      const a = medio + t * ancho, x = miraEnX ? plano + nx * lejos : a, z = miraEnX ? a : plano + nz * lejos;
      const alto = altoEn(x, z, lote);
      if (!alto && ocupado(x, z)) tapada = true;
      if (lejos < 1) vecino = Math.max(vecino, alto);
      // Un muro a dos metros deja un callejón sin vista: no vale la pena pintarlo.
      else if (alto && !vecino) tapada = true;
    }
    if (tapada) continue;
    const abierta = vecino === 0;
    const y0 = abierta ? ZOCALO : vecino + .4, y1 = lote.alto - .45, franja = y1 - y0;
    if (ancho < 3.6 || franja < 1.3) continue;
    const u = sorteo(1, plano, medio, cara), v = sorteo(2, plano, medio, cara), w = sorteo(3, plano, medio, cara);
    const poner = (nombre, anchoPieza, altoPieza, abajo, corre) => {
      const a = medio + (corre - .5) * Math.max(0, ancho - anchoPieza - .6);
      piezas.push({ nombre, ancho: anchoPieza, alto: altoPieza, y: abajo + altoPieza / 2, nx, nz, lote, cara,
        x: miraEnX ? plano + nx * SEPARA : a, z: miraEnX ? a : plano + nz * SEPARA });
      puestas.push({ nombre, x: miraEnX ? plano : a, z: miraEnX ? a : plano });
    };
    const muroX = miraEnX ? plano : medio, muroZ = miraEnX ? medio : plano;
    // Un muro grande y a la vista siempre lleva algo; los demás, uno de cada dos.
    const grande = abierta && ancho >= 8;
    const ladoMural = Math.min(ancho - .9, franja - .3, 6.4);
    let abajoPrincipal = Infinity;
    const mural = ladoMural >= 2.7 && (grande || u < .34) ? elegir(MURALES, Math.floor(v * MURALES.length), muroX, muroZ) : null;
    if (mural) {
      abajoPrincipal = y0 + (franja - ladoMural) * (abierta ? .78 : .5);
      poner(mural, ladoMural, ladoMural, abajoPrincipal, w);
    } else if (grande || u < .56) {
      // El negocio con nombre propio sale poco: los demás avisos se reparten por la ciudad sin repetirse cerca.
      const nombre = v < .07 ? elegir(AVISOS, 0, muroX, muroZ) : elegir(AVISOS.slice(1), Math.floor((v - .07) / .93 * (AVISOS.length - 1)), muroX, muroZ);
      const forma = nombre ? proporcion(nombre) : 1;
      const anchoAviso = nombre ? Math.min(ancho - .8, PIEZAS[nombre].maximo ?? 7.2, (franja - .25) * forma) : 0;
      if (anchoAviso >= 3) {
        abajoPrincipal = y0 + (franja - anchoAviso / forma) * (abierta ? .82 : .5);
        poner(nombre, anchoAviso, anchoAviso / forma, abajoPrincipal, w);
      }
    }
    // Firmas a la altura de la mano, solo donde se llega a pie y no pisan la pieza grande.
    if (abierta && abajoPrincipal >= 2.3 && sorteo(4, plano, medio, cara) < .42) {
      const anchoFirma = Math.min(ancho - .6, 3.4), altoFirma = anchoFirma / proporcion('firmas');
      if (ZOCALO + altoFirma <= Math.min(abajoPrincipal, y1)) poner('firmas', anchoFirma, altoFirma, ZOCALO, sorteo(5, plano, medio, cara));
    }
  }
  return piezas;
}

/** Carteles en dos caras opuestas de cada pilar: { x, z, lado, base }. */
export function planPilares(pilares) {
  const piezas = [];
  for (const { x, z, lado, base = 0 } of pilares) {
    if (base < -.5 || sorteo(6, x, z) >= .8) continue;
    const ancho = lado - .12, alto = ancho / proporcion('carteles');
    const caras = sorteo(7, x, z) < .5 ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    caras.forEach(([nx, nz], i) => piezas.push({ nombre: 'carteles', ancho, alto, nx, nz,
      y: base + .4 + sorteo(8 + i, x, z) * .45 + alto / 2,
      x: x + nx * (lado / 2 + SEPARA), z: z + nz * (lado / 2 + SEPARA) }));
  }
  return piezas;
}

const RAYONES = Object.keys(PIEZAS).filter((nombre) => PIEZAS[nombre].tipo === 'rayon');

/**
 * Un rayón de aerosol por pilar, en una cara sin carteles y a la altura que le toque: dos pilares
 * seguidos nunca llevan el mismo, y el pilar hundido en el lago no lleva.
 */
export function planRayones(pilares) {
  const piezas = [];
  let anterior = -1;
  for (const { x, z, lado, base = 0 } of pilares) {
    if (base < -.5 || sorteo(10, x, z) >= .78) continue;
    let cual = Math.floor(sorteo(11, x, z) * RAYONES.length);
    if (cual === anterior) cual = (cual + 1) % RAYONES.length;
    anterior = cual;
    const conCarteles = sorteo(6, x, z) < .8, carteles = sorteo(7, x, z) < .5 ? 'x' : 'z';
    const eje = conCarteles ? (carteles === 'x' ? 'z' : 'x') : (sorteo(12, x, z) < .5 ? 'x' : 'z');
    const signo = sorteo(13, x, z) < .5 ? 1 : -1, [nx, nz] = eje === 'x' ? [signo, 0] : [0, signo];
    const ancho = lado - .25, alto = ancho / proporcion(RAYONES[cual]);
    piezas.push({ nombre: RAYONES[cual], ancho, alto, nx, nz, y: base + 1.05 + sorteo(14, x, z) * 2.1 + alto / 2,
      x: x + nx * (lado / 2 + SEPARA), z: z + nz * (lado / 2 + SEPARA) });
  }
  return piezas;
}

/** Casas de cuadra registradas: su caja y las caras de ladrillo sin nada colgado. */
function lotesDe(edificios) {
  const lotes = [];
  for (const edificio of edificios) {
    const caja = edificio.baseBounds;
    if (!caja || !edificio.walls) continue;
    const lote = { x0: caja.min.x, x1: caja.max.x, z0: caja.min.z, z1: caja.max.z, alto: edificio.height, ciegas: [], edificio };
    lotes.push(lote);
    // La fachada de una casa lleva por dentro una cara de ladrillo: los costados son de ese mismo ladrillo.
    let interior = null;
    for (const pared of edificio.walls.values()) for (const malla of pared.children) {
      if (malla.isMesh && malla.userData.visibilitySide === THREE.BackSide) interior = malla;
    }
    if (!interior) continue;
    for (const [cara, pared] of edificio.walls) {
      const [malla] = pared.children;
      if (pared.children.length === 1 && malla.isMesh && !malla.material.emissiveMap && malla.material.map === interior.material.map) lote.ciegas.push(cara);
    }
  }
  return lotes;
}

function pilaresDe(grupo) {
  const pilares = [];
  grupo?.traverse?.((malla) => {
    const medidas = malla.geometry?.parameters;
    if (!malla.isMesh || malla.name !== 'Pilar' || !medidas?.width) return;
    pilares.push({ x: malla.position.x, z: malla.position.z, lado: medidas.width, base: malla.position.y - medidas.height / 2 });
  });
  return pilares;
}

let MATERIAL = null;
export function material() {
  if (!MATERIAL) {
    // Pintura mezclada sobre el muro: el ladrillo se alcanza a ver debajo. Se dibuja antes que lo demás
    // transparente (vidrios, humo, paredes atenuadas), porque siempre queda pegada a un muro opaco.
    MATERIAL = new THREE.MeshStandardMaterial({ map: texturaDeCulatas(), transparent: true, depthWrite: false,
      roughness: .96, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
    MATERIAL.name = 'Pintura de culata';
    // La cal y los fondos claros no pasan del valor de un muro pañetado: de noche no brillan sobre el ladrillo.
    MATERIAL.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
        '#include <map_fragment>\n\tdiffuseColor.rgb = min(diffuseColor.rgb, vec3(.4, .37, .33));');
    };
    MATERIAL.customProgramCacheKey = () => 'pintura-culata';
    chainSunField(MATERIAL);
  }
  return MATERIAL;
}

/** Una malla por zona con todas sus piezas: dos triángulos por pieza y un solo material. */
function mallasDe(piezas, pintura) {
  const zonas = new Map();
  for (const pieza of piezas) {
    const clave = `${Math.floor(pieza.x / TROZO)},${Math.floor(pieza.z / TROZO)}`;
    if (!zonas.has(clave)) zonas.set(clave, []);
    zonas.get(clave).push(pieza);
  }
  return [...zonas.values()].map((lista) => {
    const posiciones = new Float32Array(lista.length * 12), normales = new Float32Array(lista.length * 12);
    const uvs = new Float32Array(lista.length * 8), indices = [];
    lista.forEach((p, i) => {
      // Derecha de quien mira el muro de frente.
      const dx = p.nz, dz = -p.nx, a = p.ancho / 2, b = p.alto / 2, [u0, v0, u1, v1] = uvDe(p.nombre);
      const esquinas = [[-a, -b, u0, v0], [a, -b, u1, v0], [a, b, u1, v1], [-a, b, u0, v1]];
      esquinas.forEach(([lado, alto, u, v], k) => {
        posiciones.set([p.x + dx * lado, p.y + alto, p.z + dz * lado], i * 12 + k * 3);
        normales.set([p.nx, 0, p.nz], i * 12 + k * 3);
        uvs.set([u, v], i * 8 + k * 2);
      });
      indices.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    });
    const geometria = new THREE.BufferGeometry();
    geometria.setAttribute('position', new THREE.BufferAttribute(posiciones, 3));
    geometria.setAttribute('normal', new THREE.BufferAttribute(normales, 3));
    geometria.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometria.setIndex(indices);
    geometria.computeBoundingSphere();
    geometria.computeBoundingBox();
    const malla = new THREE.Mesh(geometria, pintura);
    malla.name = 'Culatas pintadas';
    malla.receiveShadow = true;
    malla.renderOrder = -1;
    malla.matrixAutoUpdate = false;
    malla.userData.piezas = lista;
    malla.userData.reposo = posiciones.slice();
    return malla;
  });
}

/** La pieza se recoge mientras la cámara atenúa su pared y vuelve con ella. */
function seguirParedes(raiz) {
  for (const malla of raiz.children) {
    const { piezas, reposo } = malla.userData, posicion = malla.geometry.attributes.position;
    let cambio = false;
    for (let i = 0; i < piezas.length; i++) {
      const pieza = piezas[i], oculta = !!pieza.parte && pieza.parte.opacity < .6;
      if (oculta === !!pieza.oculta) continue;
      pieza.oculta = oculta;
      cambio = true;
      for (let k = 0; k < 12; k++) posicion.array[i * 12 + k] = reposo[i * 12 + (oculta ? k % 3 : k)];
    }
    if (cambio) posicion.needsUpdate = true;
  }
}

/** Pinta las culatas de la ciudad ya armada. Se llama una vez, con las casas y el viaducto ya en su sitio. */
export function agregarCulatas(distrito) {
  const delJuego = Math.random;
  Math.random = azarDe(SEMILLA);
  try {
    const mapa = distrito.map;
    const ocupado = (x, z) => {
      const suelo = mapa?.[Math.round(z / TILE_SIZE)]?.[Math.round(x / TILE_SIZE)];
      return suelo === 'building' || suelo === 'ruin';
    };
    const piezas = planCulatas(lotesDe(distrito.buildingVisibility?.buildings ?? []), ocupado);
    for (const pieza of piezas) {
      const { edificio } = pieza.lote, pared = edificio.walls.get(pieza.cara);
      pieza.parte = edificio.wallParts?.find((parte) => parte.object === pared) ?? null;
    }
    const pilares = pilaresDe(distrito.group);
    piezas.push(...planPilares(pilares), ...planRayones(pilares));
    const raiz = new THREE.Group();
    raiz.name = 'Culatas';
    raiz.userData.piezas = piezas;
    for (const malla of mallasDe(piezas, material())) raiz.add(malla);
    // Con `update` queda fuera del fundido y de los sectores de la ciudad, y sigue cada cuadro a sus paredes.
    raiz.userData.update = () => seguirParedes(raiz);
    distrito.group.add(raiz);
    distrito.animated?.push(raiz);
    return raiz;
  } finally {
    Math.random = delJuego;
  }
}
