// src/world/bogota/motos.js
// Motos parqueadas contra el andén: un lote instanciado por cada grupo de la acera, una llamada de dibujo por grupo a la vista.
// Sin marcas: moto urbana de 125 cc, la silueta que se repite en cualquier cuadra de Bogotá.
import * as THREE from 'three';
import { Batch, COLOR, addGeo, addGrid, bar, box, tube } from './carParts.js';
import { chainSunField } from './SunFieldShader.js';

export const MOTO_SIZE = Object.freeze({ length: 2, width: .72, height: 1.08 });
export const MOTO_COLORS = ['#c21d1a', '#1a1c20', '#e6e6e4', '#1d3f7a', '#6d7377', '#b98a1b', '#20262c'];

// Franja de la moto que circula, a su izquierda y hacia el centro de la calzada: el andén y los parqueados quedan al
// otro lado, así que en esa línea la moto pasa la cola sin tocarla y llega al frente del semáforo.
export const MOTO_LATERAL = 1.4;

// El alfa del lote dice qué es cada pieza: 1 toma el color de la moto, .3 es metal; el resto, plástico y caucho.
const PAINTED = 1, METAL = .3;
const WHITE = [1, 1, 1], SEAT = [.03, .03, .033], STEEL = [.62, .64, .66], ENGINE = [.028, .028, .03], ALU = [.14, .145, .15];

let material = null;
// El puesto de cada persona va en `aRider` (asiento + 1, y si es la cabeza con casco); el lote trae quién va sentado
// y con qué casco. Lo que no se ve se encoge a cero: sin vértices no hay relleno ni sombra.
const RIDER_ATTRIBUTES = 'attribute vec2 aRider;\nattribute vec3 aRiderOn;\nattribute vec3 aHelmetOn;\n';
const RIDER_HIDE = `#include <begin_vertex>
  float motoSlot = aRider.x - 1.;
  float motoOn = motoSlot < -.5 ? 1. : motoSlot < .5 ? aRiderOn.x : motoSlot < 1.5 ? aRiderOn.y : aRiderOn.z;
  float motoHead = aRider.y > .5 ? (motoSlot < .5 ? aHelmetOn.x : motoSlot < 1.5 ? aHelmetOn.y : aHelmetOn.z) : 1.;
  transformed *= clamp(motoOn * motoHead, 0., 1.);`;

function motoMaterial() {
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .46, metalness: .05 });
  material.name = 'Motos';
  material.onBeforeCompile = shader => {
    shader.vertexShader = (RIDER_ATTRIBUTES + shader.vertexShader)
      .replace('#include <begin_vertex>', RIDER_HIDE)
      .replace('#include <color_vertex>', `vColor = color;
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb *= mix(vec3(1.), instanceColor.rgb, step(.5, color.a));
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        float motoMetal = step(.15, vColor.a) * (1. - step(.5, vColor.a));
        metalnessFactor = mix(metalnessFactor, .9, motoMetal);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .3, step(.15, vColor.a) * (1. - step(.5, vColor.a)));`);
  };
  material.customProgramCacheKey = () => 'motos-pintura';
  return chainSunField(material);
}

let depthMaterial = null;
/** La sombra esconde a quien no va: el pase de profundidad no usa el material de la moto y si no, dibujaría los tres. */
function motoDepthMaterial() {
  if (depthMaterial) return depthMaterial;
  depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.name = 'Sombra de motos';
  depthMaterial.onBeforeCompile = shader => {
    shader.vertexShader = (RIDER_ATTRIBUTES + shader.vertexShader).replace('#include <begin_vertex>', RIDER_HIDE);
  };
  depthMaterial.customProgramCacheKey = () => 'motos-sombra';
  return depthMaterial;
}

/**
 * Perfil lateral con volumen: el contorno al centro y encogido a cada lado, como un cuerpo inflado.
 * El contorno va en sentido antihorario visto desde +Z; así salen el tanque, el asiento y las tapas sin cajas.
 */
function pillow(points, halfWidth, shrink = .74) {
  const n = points.length;
  let cx = 0, cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= n; cy /= n;
  const position = [], index = [];
  for (const side of [1, -1]) for (const [x, y] of points) position.push(cx + (x - cx) * shrink, cy + (y - cy) * shrink, side * halfWidth);
  for (const [x, y] of points) position.push(x, y, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, c = 2 * n;
    index.push(i, c + i, c + j, i, c + j, j, c + i, n + i, n + j, c + i, n + j, c + j);
  }
  for (let i = 1; i < n - 1; i++) index.push(0, i, i + 1, n, n + i + 1, n + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Guardabarros: lámina curva sobre la rueda, visible por encima y por debajo. */
function fender(b, cx, cy, radius, a0, a1, halfWidth, color, metal = 0) {
  const point = (i, j) => {
    const a = a0 + (a1 - a0) * i / 6, z = (j - 1) * halfWidth, r = radius - (j === 1 ? 0 : .018);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  };
  addGrid(b, 6, 2, point, { color, metal, mirror: false, out: [0, 1, 0] });
  addGrid(b, 6, 2, point, { color: COLOR.dark, mirror: false, out: [0, -1, 0] });
}

function wheel(b, x, r) {
  const tire = new THREE.TorusGeometry(r - .042, .042, 4, 12);
  addGeo(b, tire, { position: [x, r, 0], color: COLOR.rubber });
  const rim = new THREE.TorusGeometry(r - .092, .012, 3, 12);
  addGeo(b, rim, { position: [x, r, 0], color: STEEL, metal: METAL });
  const hub = new THREE.CylinderGeometry(.05, .05, .1, 7);
  hub.rotateX(Math.PI / 2);
  addGeo(b, hub, { position: [x, r, 0], color: ALU, metal: METAL });
  // Tres radios cruzados: dan la rueda de alambre sin tapar lo que hay detrás.
  for (let k = 0; k < 3; k++) {
    const a = Math.PI * k / 3 + .3, s = r - .095;
    bar(b, [x - s * Math.cos(a), r - s * Math.sin(a), 0], [x + s * Math.cos(a), r + s * Math.sin(a), 0], .008, .008, { color: STEEL, metal: METAL });
  }
}

/** La moto urbana de 125 cc: la silueta que comparte lo parqueado y lo que circula. */
function addStreetBike(b) {
  const r = .3, front = .66, rear = -.66;
  wheel(b, front, r); wheel(b, rear, r);
  fender(b, front, r, r + .035, .55, 2.5, .055, WHITE, PAINTED);
  fender(b, rear, r, r + .035, .55, 2.2, .06, COLOR.dark);

  // Tanque, asiento, colín y tapa lateral: el perfil que la hace reconocible.
  addGeo(b, pillow([[-.13, .84], [.10, .76], [.31, .75], [.37, .81], [.30, .91], [.12, .965], [-.07, .94]], .135), { color: WHITE, metal: PAINTED });
  addGeo(b, pillow([[-.72, .875], [-.62, .825], [-.10, .825], [-.05, .90], [-.07, .935], [-.35, .925], [-.62, .925]], .118, .8), { color: SEAT });
  addGeo(b, pillow([[-.87, .83], [-.72, .77], [-.44, .73], [-.44, .83], [-.74, .875]], .09), { color: WHITE, metal: PAINTED });
  addGeo(b, pillow([[-.40, .655], [-.20, .62], [-.07, .72], [-.12, .81], [-.40, .80]], .105), { color: WHITE, metal: PAINTED });
  box(b, [.05, .05, .13], [-.86, .825, 0], { color: [.6, .03, .03] });

  // Motor con cilindro inclinado y tapa de embrague; es lo que se ve bajo el tanque.
  addGeo(b, pillow([[-.18, .28], [.02, .22], [.22, .30], [.23, .49], [-.02, .54], [-.20, .46]], .125, .86), { color: ENGINE });
  addGeo(b, pillow([[.06, .50], [.20, .48], [.33, .62], [.24, .70], [.09, .63]], .075, .9), { color: ALU });
  const clutch = new THREE.CylinderGeometry(.095, .095, .03, 9);
  clutch.rotateX(Math.PI / 2);
  addGeo(b, clutch, { position: [.03, .37, -.135], color: ALU, metal: METAL });

  // Chasis: bajante, basculante, amortiguadores y cadena.
  bar(b, [.40, .86, 0], [.20, .50, 0], .05, .05, { color: COLOR.dark });
  bar(b, [-.10, .42, .08], [rear, r, .08], .03, .03, { color: COLOR.dark, mirror: true });
  bar(b, [-.52, .34, .095], [-.38, .72, .095], .026, .026, { color: STEEL, metal: METAL, mirror: true });
  bar(b, [-.06, .41, -.098], [-.60, .325, -.098], .07, .018, { color: COLOR.dark });

  // Escape: codo desde la culata y silenciador cromado hacia atrás, al lado derecho.
  tube(b, [.25, .46, .08], [.14, .25, .12], .022, 6, { color: COLOR.exhaust, metal: METAL });
  tube(b, [.14, .25, .12], [-.20, .27, .15], .022, 6, { color: COLOR.exhaust, metal: METAL });
  tube(b, [-.20, .27, .15], [-.70, .38, .15], .047, 7, { color: STEEL, metal: METAL });

  // Horquilla, faro, tablero y manubrio.
  bar(b, [front, r, .062], [.415, .93, .062], .032, .032, { color: STEEL, metal: METAL, mirror: true });
  box(b, [.09, .03, .17], [.42, .90, 0], { color: COLOR.dark });
  const head = new THREE.SphereGeometry(.085, 7, 5);
  head.scale(.85, 1, 1);
  addGeo(b, head, { position: [.51, .95, 0], color: [.82, .83, .8], metal: METAL });
  box(b, [.07, .05, .13], [.40, 1.01, 0], { color: COLOR.dark });
  bar(b, [.40, 1.02, 0], [.37, 1.06, .34], .02, .02, { color: COLOR.dark, mirror: true });
  bar(b, [.375, 1.055, .24], [.367, 1.062, .36], .033, .033, { color: COLOR.rubber, mirror: true });
  // Espejos con su vástago.
  bar(b, [.38, 1.05, .20], [.35, 1.20, .25], .009, .009, { color: COLOR.dark, mirror: true });
  const mirror = new THREE.CylinderGeometry(.052, .052, .012, 7);
  mirror.rotateZ(Math.PI / 2);
  addGeo(b, mirror, { position: [.35, 1.23, .255], color: COLOR.dark, mirror: true });

  // Gato lateral y estriberas.
  bar(b, [-.12, .28, -.11], [-.20, .01, -.21], .02, .02, { color: COLOR.dark });
  bar(b, [-.06, .28, .10], [-.06, .28, .20], .022, .022, { color: COLOR.rubber, mirror: true });
}

let geometry = null;
function motoGeometry() {
  if (geometry) return geometry;
  const b = new Batch();
  addStreetBike(b);
  geometry = b.toGeometry('Moto parqueada');
  return geometry;
}

/**
 * Motos parqueadas: cada posición es { x, z, rot, seed, group }; `rot` orienta el frente (+X local) como en los carros.
 * Quedan apoyadas en el gato, ladeadas a la izquierda. Devuelve un grupo con un lote instanciado por cada `group`:
 * geometría y material son los mismos, y como cada lote ocupa unos pocos metros, el que no se ve no se envía a la tarjeta.
 */
export function makeParkedMotos(placements) {
  const root = new THREE.Group(), byGroup = new Map();
  root.name = 'Motos parqueadas';
  for (const placement of placements) {
    const key = placement.group ?? 0;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(placement);
  }
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  for (const list of byGroup.values()) {
    const mesh = new THREE.InstancedMesh(motoGeometry(), motoMaterial(), list.length);
    mesh.name = 'Grupo de motos';
    mesh.castShadow = true; mesh.receiveShadow = true;
    list.forEach(({ x, z, rot, seed = 0 }, i) => {
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, rot, .0);
      dummy.rotateX(-.12);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(MOTO_COLORS[seed % MOTO_COLORS.length]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    root.add(mesh);
  }
  // Solo es propio de cada lote lo instanciado; geometría y material siguen compartidos.
  root.dispose = () => { for (const mesh of root.children) mesh.dispose(); };
  return root;
}

/**
 * Lote de moto: además del vértice guarda a qué persona pertenece (0 el vehículo, 1 a 3 los puestos) y si es su
 * cabeza con casco. El lote decide por instancia quién va sentado y con qué, sin duplicar geometría.
 */
class MotoBatch extends Batch {
  constructor() {
    super();
    this.R = [];
    this.slot = 0;
    this.head = 0;
  }
  v(x, y, z, nx, ny, nz, u, v, r, g, b, a, lamp) {
    this.R.push(this.slot, this.head);
    return super.v(x, y, z, nx, ny, nz, u, v, r, g, b, a, lamp);
  }
  rider(slot, head) { this.slot = slot; this.head = head; }
}

const SKIN = [.72, .53, .4];
const HELMET_VISOR = [.05, .06, .07];
// Chaquetas fijas: el color de la moto pinta el casco, no a quien la maneja, que así no sale de un solo tono.
const JACKETS = [[.09, .10, .13], [.34, .13, .10], [.13, .22, .28]];

/** Persona sentada: piernas al estribo, torso y brazos hasta donde agarra, y cabeza con casco que puede no ponerse. */
function addRider(b, seat, { x, y, hands, feet, kid = false }) {
  const s = kid ? .74 : 1, jacket = JACKETS[seat % JACKETS.length];
  b.rider(seat + 1, 0);
  bar(b, [x, y + .02, .13 * s], [feet[0], feet[1], feet[2] * s], .13 * s, .14 * s, { color: COLOR.dark, mirror: true });
  box(b, [.30 * s, .12, .34 * s], [x, y + .06, 0], { color: COLOR.dark });
  bar(b, [x, y + .10, 0], [x + .04 * s, y + .44 * s, 0], .26 * s, .36 * s, { color: jacket });
  bar(b, [x + .03 * s, y + .40 * s, .14 * s], [hands[0], hands[1], hands[2]], .09 * s, .09 * s, { color: jacket, mirror: true });
  const neck = new THREE.SphereGeometry(.05 * s, 6, 5);
  addGeo(b, neck, { position: [x + .05 * s, y + .50 * s, 0], color: SKIN, scale: [1, 1.3, 1] });
  const head = new THREE.SphereGeometry(.085 * s, 7, 6);
  addGeo(b, head, { position: [x + .06 * s, y + .56 * s, 0], color: SKIN });
  // El casco va marcado aparte: el lote lo esconde cuando esa persona no lo lleva.
  b.rider(seat + 1, 1);
  const helmet = new THREE.SphereGeometry(.105 * s, 8, 6);
  addGeo(b, helmet, { position: [x + .05 * s, y + .57 * s, 0], color: WHITE, metal: PAINTED, scale: [1, 1, 1.06] });
  box(b, [.06 * s, .04 * s, .19 * s], [x + .15 * s, y + .55 * s, 0], { color: HELMET_VISOR });
  b.rider(seat + 1, 0);
}

/** Scooter: paso bajo entre las piernas, carenado frontal y cola abultada sobre la rueda pequeña. */
function addScooter(b) {
  const r = .23, front = .62, rear = -.60;
  wheel(b, front, r); wheel(b, rear, r);
  fender(b, front, r, r + .03, .6, 2.4, .05, WHITE, PAINTED);
  fender(b, rear, r, r + .03, .6, 2.2, .05, COLOR.dark);
  box(b, [.64, .05, .34], [-.04, .35, 0], { color: COLOR.dark });
  addGeo(b, pillow([[.16, .36], [.34, .54], [.38, .80], [.28, .92], [.12, .76], [.08, .40]], .15, .84), { color: WHITE, metal: PAINTED });
  addGeo(b, pillow([[-.92, .52], [-.60, .40], [-.28, .44], [-.22, .70], [-.56, .82], [-.90, .76]], .17, .82), { color: WHITE, metal: PAINTED });
  addGeo(b, pillow([[-.72, .88], [-.62, .80], [-.20, .80], [-.16, .86], [-.24, .92], [-.64, .95]], .13, .84), { color: SEAT });
  bar(b, [front, r, .05], [.40, .98, .05], .028, .028, { color: STEEL, metal: METAL, mirror: true });
  const head = new THREE.SphereGeometry(.07, 7, 5);
  addGeo(b, head, { position: [.43, .97, 0], color: [.82, .83, .8], metal: METAL });
  box(b, [.07, .05, .16], [.37, 1.0, 0], { color: COLOR.dark });
  bar(b, [.36, 1.02, 0], [.34, 1.05, .30], .018, .018, { color: COLOR.dark, mirror: true });
  bar(b, [.345, 1.04, .22], [.34, 1.05, .32], .03, .03, { color: COLOR.rubber, mirror: true });
  bar(b, [-.10, .30, .06], [-.90, .50, .10], .028, .028, { color: COLOR.dark, mirror: true });
  bar(b, [-.14, .30, -.12], [-.22, .04, -.20], .018, .018, { color: COLOR.dark });
}

/** Canasta de alambre sobre la parrilla: se ve a través y no tapa la moto. */
function addBasket(b) {
  const y = .98, x0 = -1.06, x1 = -.76, h = .27, w = .17;
  for (const side of [1, -1]) {
    bar(b, [x0, y + h, side * w], [x1, y + h, side * w], .012, .012, { color: STEEL, metal: METAL });
    bar(b, [x0, y, side * w], [x1, y, side * w], .012, .012, { color: STEEL, metal: METAL });
  }
  for (const x of [x0, x1]) for (const z of [-w, w]) bar(b, [x, y, z], [x, y + h, z], .011, .011, { color: STEEL, metal: METAL });
  for (const z of [-w, 0, w]) for (const x of [x0, (x0 + x1) / 2, x1]) bar(b, [x, y, z], [x, y + h, z], .009, .009, { color: STEEL, metal: METAL });
  box(b, [.30, .02, .36], [(x0 + x1) / 2, y, 0], { color: COLOR.dark });
  bar(b, [-.84, .90, .12], [-.90, .97, 0], .016, .016, { color: COLOR.dark, mirror: true });
}

/** Caja de domicilio sobre la parrilla: solo el volumen y la tapa, sin marcas. */
function addDeliveryBox(b) {
  box(b, [.52, .48, .52], [-1.00, 1.06, 0], { color: [.13, .15, .18] });
  box(b, [.55, .05, .55], [-1.00, 1.32, 0], { color: [.30, .32, .35] });
  bar(b, [-.74, 1.20, .27], [-.74, 1.20, -.27], .02, .02, { color: COLOR.dark });
  bar(b, [-.84, .90, .12], [-.94, .96, 0], .016, .016, { color: COLOR.dark, mirror: true });
}

export const MOTO_VARIANTS = Object.freeze(['urbana', 'scooter', 'canasta', 'domicilio']);
/** Largo y ancho de colisión: la caja del domicilio y la canasta sobresalen de la moto. */
export const MOTO_SIZES = Object.freeze([
  { length: 2, width: .72 }, { length: 1.78, width: .7 }, { length: 2.1, width: .74 }, { length: 2.28, width: .78 }
]);
/** Quién cabe en cada variante: solo, con parrillero, o con el chico apretado en medio. */
export const MOTO_LAYOUTS = Object.freeze({
  urbana: [[0], [0, 2], [0, 1, 2]],
  scooter: [[0], [0, 2]],
  canasta: [[0], [0, 2], [0, 1, 2]],
  domicilio: [[0]]
});

const URBANA_SEATS = [
  { x: -.30, y: .92, hands: [.37, 1.06, .32], feet: [-.06, .30, .20] },
  { x: -.54, y: .96, hands: [-.34, 1.02, .16], feet: [-.44, .46, .24], kid: true },
  { x: -.74, y: .92, hands: [-.44, 1.00, .18], feet: [-.16, .32, .22] }
];
const SEATS = {
  urbana: URBANA_SEATS,
  scooter: [
    { x: -.34, y: .86, hands: [.34, 1.04, .30], feet: [-.06, .32, .18] },
    null,
    { x: -.70, y: .88, hands: [-.34, .96, .20], feet: [-.30, .40, .24] }
  ],
  canasta: URBANA_SEATS,
  domicilio: [{ x: -.30, y: .92, hands: [.37, 1.06, .32], feet: [-.06, .30, .20] }]
};

let variantGeometries = null;
/** Una geometría por variante, con sus tres puestos ya horneados; el lote esconde los que van vacíos. */
function motoVariantGeometries() {
  if (variantGeometries) return variantGeometries;
  variantGeometries = MOTO_VARIANTS.map((name, index) => {
    const b = new MotoBatch();
    if (name === 'scooter') addScooter(b); else addStreetBike(b);
    if (name === 'canasta') addBasket(b);
    else if (name === 'domicilio') addDeliveryBox(b);
    SEATS[name].forEach((seat, slot) => { if (seat) addRider(b, slot, seat); });
    const geometry = b.toGeometry(`Moto ${name}`);
    geometry.setAttribute('aRider', new THREE.BufferAttribute(new Float32Array(b.R), 2));
    return geometry;
  });
  return variantGeometries;
}

/** Cuántas motos de cada variante caben en el lote. La flota diaria más llena reparte unas ocho por variante. */
export const MOTO_CAPACITY = 16;

/**
 * Las motos que circulan: un lote instanciado por variante, con el asiento y el casco por instancia. Se sincroniza
 * desde los vehículos del tráfico y la esfera envolvente cubre lo vivo, para que el lote se descarte entero.
 */
export class MotoFleet {
  constructor(scene, capacity = MOTO_CAPACITY) {
    this.root = new THREE.Group();
    this.root.name = 'Motos en circulación';
    scene.add(this.root);
    const material = motoMaterial();
    this.batches = motoVariantGeometries().map(geometry => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.name = 'Lote de motos';
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.customDepthMaterial = motoDepthMaterial();
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // La esfera la lleva el lote, no la geometría: cubre solo lo vivo y el resto del tiempo se descarta.
      mesh.boundingSphere = new THREE.Sphere();
      const riders = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      const helmets = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      geometry.setAttribute('aRiderOn', riders);
      geometry.setAttribute('aHelmetOn', helmets);
      this.root.add(mesh);
      return { mesh, riders, helmets, capacity, count: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
    });
    this._dummy = new THREE.Object3D();
  }

  /** Coloca cada moto viva en su lote; la que va apagada no ocupa instancia. Devuelve cuántas se dibujan. */
  sync(vehicles) {
    for (const batch of this.batches) batch.count = 0;
    for (const vehicle of vehicles) {
      const moto = vehicle.car;
      if (!moto.isMoto || !moto.drawn) continue;
      const batch = this.batches[moto.variant], index = batch.count;
      if (index >= batch.capacity) continue;
      const x = moto.position.x, z = moto.position.z;
      this._dummy.position.copy(moto.position);
      this._dummy.rotation.set(0, moto.group.rotation.y, 0);
      this._dummy.updateMatrix();
      batch.mesh.setMatrixAt(index, this._dummy.matrix);
      batch.mesh.setColorAt(index, moto.color);
      const riders = batch.riders.array, helmets = batch.helmets.array;
      for (let seat = 0; seat < 3; seat++) {
        riders[index * 3 + seat] = moto.occupancy[seat] ? 1 : 0;
        helmets[index * 3 + seat] = moto.helmets[seat] ? 1 : 0;
      }
      if (!index) { batch.minX = batch.maxX = x; batch.minZ = batch.maxZ = z; }
      else {
        batch.minX = Math.min(batch.minX, x); batch.maxX = Math.max(batch.maxX, x);
        batch.minZ = Math.min(batch.minZ, z); batch.maxZ = Math.max(batch.maxZ, z);
      }
      batch.count = index + 1;
    }
    for (const batch of this.batches) {
      const { mesh, count } = batch;
      mesh.count = count;
      if (!count) {
        batch.mesh.boundingSphere.center.set(0, -1000, 0);
        batch.mesh.boundingSphere.radius = 0;
        continue;
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      batch.riders.needsUpdate = true;
      batch.helmets.needsUpdate = true;
      const sphere = mesh.boundingSphere;
      sphere.center.set((batch.minX + batch.maxX) / 2, 1, (batch.minZ + batch.maxZ) / 2);
      sphere.radius = Math.hypot(batch.maxX - batch.minX, batch.maxZ - batch.minZ) / 2 + 3;
    }
  }

  get drawn() { return this.batches.reduce((sum, batch) => sum + batch.count, 0); }

  dispose() {
    for (const batch of this.batches) { this.root.remove(batch.mesh); batch.mesh.dispose(); }
    this.root.removeFromParent();
  }
}
