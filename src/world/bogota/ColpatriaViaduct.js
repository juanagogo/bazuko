import * as THREE from 'three';
import { busPathX, bridgeCenter, bridgeNormal } from './Colpatria.js';
import { BRIDGE_RISE, BRIDGE_DECK_HEIGHT } from './BridgeElevation.js';
import { LAKE_BRIDGE, bridgeHeight } from './LakePark.js';

export const VIADUCT = Object.freeze({ start: 15.43, crestStart: 39, rampEase: 1, crestEnd: 280, join: 220, end: LAKE_BRIDGE.z1, rise: BRIDGE_RISE, connectionHeight: BRIDGE_DECK_HEIGHT, width: 14, landingWidth: 14, thickness: .65 });
export function viaductHeight(z) {
  const b = VIADUCT;
  if (z <= b.start) return .02;
  if (z >= b.join) return bridgeHeight(z);
  if (z >= b.crestStart) return b.connectionHeight;
  // Pendiente constante entre transiciones suaves: deja gálibo sobre Calle 10.
  const distance = z - b.start, length = b.crestStart - b.start, ease = b.rampEase;
  const grade = b.rise / (length - ease);
  const eased = d => grade * (d / 2 - ease * Math.sin(Math.PI * d / ease) / (2 * Math.PI));
  if (distance < ease) return .02 + eased(distance);
  if (distance > length - ease) return b.connectionHeight - eased(length - distance);
  return .02 + grade * (distance - ease / 2);
}

// Anchura real constante, medida perpendicularmente al eje del puente.
function edge(z,side) {
  const normal=bridgeNormal(z),offset=side*VIADUCT.width/2;
  return new THREE.Vector3(bridgeCenter(z)+normal.x*offset,viaductHeight(z),z+normal.z*offset);
}

export function paintViaductGardens(map) {
  // La troncal que ya no circula a nivel de calle se convierte en zona verde.
  // No alterar calles transversales, edificios, rampas ni el agua del lago.
  for(let z=Math.ceil(VIADUCT.crestStart/2);z<VIADUCT.join/2;z++) {
    for(let x=1;x<map[z].length-1;x++) if(map[z][x]==='busway') map[z][x]='grass';
  }
}

export function paintViaductClearance(map) {
  for (let z = VIADUCT.start; z <= VIADUCT.end; z += .5) {
    const a = edge(z, -1), b = edge(z, 1);
    for (let t = 0; t <= 1; t += .04) {
      const x = Math.round(THREE.MathUtils.lerp(a.x, b.x, t) / 2);
      const row = Math.round(THREE.MathUtils.lerp(a.z, b.z, t) / 2);
      if (['building', 'ruin'].includes(map[row]?.[x])) map[row][x] = 'floor';
    }
  }
}

const SURFACE_CELL = 8;
let surfaceCells;

// El trazado es estático: guardar los mismos triángulos evita reconstruir bordes,
// vectores y funciones trigonométricas en cada apoyo de ambos buses y del jugador.
function indexSurface() {
  const cells = new Map();
  for (let t = Math.floor(VIADUCT.start); t < VIADUCT.end; t++) {
    const a = edge(Math.max(t, VIADUCT.start), -1), b = edge(Math.max(t, VIADUCT.start), 1);
    const c = edge(Math.min(t + 1, VIADUCT.end), -1), d = edge(Math.min(t + 1, VIADUCT.end), 1);
    for (const [p, q, r] of [[a, b, c], [b, d, c]]) {
      const den = (q.z - r.z) * (p.x - r.x) + (r.x - q.x) * (p.z - r.z);
      if (Math.abs(den) < 1e-9) continue;
      const triangle = { p, q, r, den, station: t,
        minX: Math.min(p.x, q.x, r.x) - 1e-4, maxX: Math.max(p.x, q.x, r.x) + 1e-4,
        minZ: Math.min(p.z, q.z, r.z) - 1e-4, maxZ: Math.max(p.z, q.z, r.z) + 1e-4 };
      for (let cell = Math.floor(triangle.minZ / SURFACE_CELL); cell <= Math.floor(triangle.maxZ / SURFACE_CELL); cell++) {
        if (!cells.has(cell)) cells.set(cell, []);
        cells.get(cell).push(triangle);
      }
    }
  }
  return cells;
}

/** Cota de los triángulos dibujados, con el mismo orden y tolerancia de bordes. */
export function viaductSurface(x, z) {
  if (z < VIADUCT.start - 16 || z > VIADUCT.end + 16 || Math.abs(x - busPathX(z)) > 24) return null;
  surfaceCells ??= indexSurface();
  const candidates = surfaceCells.get(Math.floor(z / SURFACE_CELL));
  if (!candidates) return null;
  const first = Math.max(Math.floor(VIADUCT.start), Math.floor(z - 16)), end = Math.min(VIADUCT.end, z + 16);
  for (const triangle of candidates) {
    if (triangle.station < first || triangle.station >= end || x < triangle.minX || x > triangle.maxX || z < triangle.minZ || z > triangle.maxZ) continue;
    const { p, q, r, den } = triangle;
    const u = ((q.z - r.z) * (x - r.x) + (r.x - q.x) * (z - r.z)) / den;
    const v = ((r.z - p.z) * (x - r.x) + (p.x - r.x) * (z - r.z)) / den;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) return u * p.y + v * q.y + (1 - u - v) * r.y;
  }
  return null;
}

export function buildColpatriaViaduct(map, { pavement: streetAsphalt = null, groundHeight = null } = {}) {
  const group = new THREE.Group(); group.name = 'Puente continuo Colpatria–Lago';
  const concrete = new THREE.MeshStandardMaterial({ color: '#a5aaa5', roughness: .9 });
  const pavement = streetAsphalt ?? new THREE.MeshStandardMaterial({ color: '#343434', roughness: .82 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#d9b735', roughness: .7 });
  const colliders = [];
  const beam = (a, b, w, h, material, name, solid = true) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, a.distanceTo(b)), material);
    mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.lookAt(b);
    mesh.castShadow = mesh.receiveShadow = true; mesh.name = name; group.add(mesh);
    if (solid) colliders.push(new THREE.Box3().setFromObject(mesh));
    return mesh;
  };
  for (let z = VIADUCT.start; z < VIADUCT.end; z = Math.min(Math.floor(z) + 1, VIADUCT.end)) {
    const next = Math.min(Math.floor(z) + 1, VIADUCT.end);
    const a = edge(z, -1), b = edge(z, 1), c = edge(next, -1), d = edge(next, 1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([a.x,a.y,a.z,b.x,b.y,b.z,c.x,c.y,c.z,d.x,d.y,d.z], 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([a.x/14,a.z/14,b.x/14,b.z/14,c.x/14,c.z/14,d.x/14,d.z/14], 2));
    geometry.setIndex([0,2,1,1,2,3]); geometry.computeVertexNormals();
    const surface = new THREE.Mesh(geometry, pavement); surface.receiveShadow = true;
    surface.name = 'Superficie del puente'; surface.userData.stationStart = z; group.add(surface);
    // Prisma extruido del mismo contorno: una caja inclinada puede atravesar la
    // calzada cuando varían simultáneamente el ancho, la pendiente y el eje.
    const prism = new THREE.BufferGeometry(), vertices = [];
    for (const depth of [.06, .06 + VIADUCT.thickness]) for (const p of [a,b,c,d]) vertices.push(p.x,p.y-depth,p.z);
    prism.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    prism.setAttribute('uv', new THREE.Float32BufferAttribute(vertices.flatMap((value, i) => i % 3 === 0 ? [value / 14, vertices[i + 2] / 14] : []), 2));
    prism.setIndex([0,2,1,1,2,3,4,5,6,5,7,6,0,1,4,1,5,4,2,6,3,3,6,7,0,4,2,2,4,6,1,3,5,3,7,5]);
    prism.computeVertexNormals();
    const deck = new THREE.Mesh(prism, concrete); deck.castShadow = deck.receiveShadow = true;
    deck.name = 'Tablero de concreto'; deck.userData.stationStart = z; group.add(deck);
    for (const [p, q] of [[a,c],[b,d]]) {
      beam(p.clone().add(new THREE.Vector3(0,.38,0)), q.clone().add(new THREE.Vector3(0,.38,0)), .24, .7, concrete, 'Barrera lateral');
      beam(p.clone().add(new THREE.Vector3(0,1.05,0)), q.clone().add(new THREE.Vector3(0,1.05,0)), .11, .11, yellow, 'Baranda amarilla', false);
    }
  }
  for (let z = 50; z < VIADUCT.end - 8; z += 14) {
    // Apoyos fuera de las calzadas inferiores.
    const x = busPathX(z) - 4;
    if (map?.[Math.round(z/2)]?.[Math.round(x/2)] === 'road') continue;
    const top = viaductHeight(z) - .7;
    // La cubeta del lago queda por debajo de la calle: prolongar únicamente
    // el apoyo, conservando techo, huella y trayecto del tablero.
    const bottom = Math.min(0, groundHeight?.(x, z) ?? 0);
    const h = top - bottom;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.3, h, 1.3), concrete);
    mesh.position.set(x,bottom+h/2,z); mesh.castShadow = mesh.receiveShadow = true; mesh.name = 'Pilar'; group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
  }
  for (let z = VIADUCT.start + 4; z < VIADUCT.end - 3; z += 4) {
    const a = edge(z - .8, -1).add(edge(z - .8, 1)).multiplyScalar(.5);
    const b = edge(z + .8, -1).add(edge(z + .8, 1)).multiplyScalar(.5);
    a.y += .035; b.y += .035;
    beam(a, b, .14, .02, yellow, 'Marca de carril', false);
  }
  group.userData.colliders = colliders;
  return group;
}
