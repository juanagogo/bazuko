// src/world/bogota/carMarker.js
// Contorno rojo en el piso que señala el carro parqueado al que se está acercando el jugador.
// Geometría por modelo y materiales compartidos: un carro solo guarda en qué nivel de opacidad va.
import * as THREE from 'three';
import { COLORS } from '../../utils/constants.js';

const OPACITY = .7, LEVELS = 8;
/** Separación del contorno a la carrocería y ancho de la línea. */
const MARGIN = .3, BAND = .13;
/** Altura sobre la calzada y sobre el andén (12 cm), por encima también de la corona del sardinel. */
const ROAD_Y = .035, SIDEWALK_Y = .15;
/** La línea sube el sardinel justo delante de su cara, que sobresale 2,6 cm del borde del andén. */
const STEP_FROM = -.05, STEP_TO = -.03;
const CORNER_MAX = .45, CORNER_MIN = .15, CORNER_STEPS = 6;

/** Puntos de la línea, con su normal, recorriendo el rectángulo redondeado; arranca por el costado +X, en el lado de la calle. */
function outline(halfX, halfZ, radius, stepsZ) {
  const points = [];
  const corner = (cx, cz, from) => {
    for (let i = 0; i <= CORNER_STEPS; i++) {
      const angle = from + (i / CORNER_STEPS) * Math.PI / 2, nx = Math.cos(angle), nz = Math.sin(angle);
      points.push({ x: cx + nx * radius, z: cz + nz * radius, nx, nz });
    }
  };
  const x = halfX - radius, z = halfZ - radius;
  // De −Z a +Z por el costado +X, con los cortes del escalón en el orden en que se cruzan.
  for (const c of stepsZ) points.push({ x: halfX, z: c, nx: 1, nz: 0 });
  corner(x, z, 0);
  corner(-x, z, Math.PI / 2);
  for (const c of [...stepsZ].reverse()) points.push({ x: -halfX, z: c, nx: -1, nz: 0 });
  corner(-x, -z, Math.PI);
  corner(x, -z, Math.PI * 1.5);
  return points;
}

const geometries = new Map();

/**
 * Contorno de un carro en su Z local; con `curbZ` el lado +Z queda sobre el andén y la línea sube el sardinel en vez de atravesarlo.
 * La esquina se ajusta para que ese escalón caiga en el tramo recto, delante y detrás del carro.
 */
export function markerGeometry(length, width, curbZ = Infinity) {
  const key = `${length}|${width}|${curbZ}`;
  let geometry = geometries.get(key);
  if (geometry) return geometry;
  const halfX = length / 2 + MARGIN, halfZ = width / 2 + MARGIN, onCurb = Number.isFinite(curbZ);
  const radius = onCurb ? THREE.MathUtils.clamp(halfZ - curbZ - .02, CORNER_MIN, CORNER_MAX) : CORNER_MAX;
  const stepsZ = onCurb ? [curbZ + STEP_FROM, curbZ + STEP_TO] : [];
  const points = outline(halfX, halfZ, radius, stepsZ);
  const positions = [], index = [];
  points.forEach(({ x, z, nx, nz }, i) => {
    const y = onCurb && z >= curbZ + STEP_TO - 1e-6 ? SIDEWALK_Y : ROAD_Y;
    positions.push(x + nx * BAND / 2, y, z + nz * BAND / 2, x - nx * BAND / 2, y, z - nz * BAND / 2);
    const next = (i + 1) % points.length;
    index.push(i * 2, i * 2 + 1, next * 2, i * 2 + 1, next * 2 + 1, next * 2);
  });
  geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  geometry.name = 'Contorno del carro';
  geometries.set(key, geometry);
  return geometry;
}

let materials = null;

/** Material para una opacidad de 0 a 1: pocos niveles compartidos en vez de uno por carro; en un fundido de menos de medio segundo no se notan los saltos. */
export function markerMaterial(fade) {
  materials ??= Array.from({ length: LEVELS }, (_, i) => {
    const material = new THREE.MeshBasicMaterial({ color: COLORS.ACCENT_RED, side: THREE.DoubleSide, transparent: true, opacity: OPACITY * (i + 1) / LEVELS, depthWrite: false });
    material.name = 'Contorno del carro';
    return material;
  });
  return materials[THREE.MathUtils.clamp(Math.ceil(fade * LEVELS) - 1, 0, LEVELS - 1)];
}
