// src/entities/GroundPoops.js
// Las popós del piso: un montón de trozos con su mancha húmeda, el charquito de chichi y el chorrito.
// Todo comparte geometría y materiales; cada montón solo tiene su propio rango de dibujo para ir
// apareciendo trozo a trozo. Las moscas y el olor (PoopFlies, PoopStink) se apoyan en esta lista.
import * as THREE from 'three';
import { PoopFlies } from './PoopFlies.js';
import { PoopStink } from './PoopStink.js';

export const MAX_GROUND_POOPS = 8;
export const POOP_LIFETIME = 45;
export const POOP_FADE = 1.5;
export const PEE_LIFETIME = 25;
export const PEE_DRY = 6;
export const POOP_PIECES = 5;
/** Metros: más lejos que esto no se animan moscas ni olor. */
export const POOP_RANGE = 30;

const POOP_COLOR = new THREE.Color(0x5a3417);
// Trozos del montón: posición, radio, largo, giro y caída, como la maqueta B aprobada.
const PIECES = [
  [0, .045, 0, .055, .2, .2, .08],
  [.07, .055, .07, .046, .15, 1.9, -.12],
  [-.07, .06, .05, .042, .13, 2.8, .1],
  [-.01, .12, .015, .04, .12, 1.1, .18],
  [.03, .165, -.01, .032, .07, 2.4, -.25]
];
const CRUMBS = 9;
const TOP = new THREE.Vector3(.03, .2, -.01);
const UNDER_SCALE = .16, RING_SCALE = .24, PEE_SCALE = .19;
const SPHERE = .6; // radio con el que se prueba si un montón entra en cámara

/** Superficie irregular con manchas más oscuras y más claras, siempre igual para la misma forma. */
function lumpy(geo, amp, f) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * f + 1.3) * Math.sin(y * f * 1.7 + .4) * Math.sin(z * f * 1.3 + 2.1)
      + .5 * Math.sin(x * f * 2.9 + .7) * Math.sin(z * f * 2.3 + 1.9) * Math.sin(y * f * 3.1);
    pos.setXYZ(i, x + nor.getX(i) * n * amp, y + nor.getY(i) * n * amp, z + nor.getZ(i) * n * amp);
    const k = .78 + .22 * n + .08 * Math.sin(y * f * .7);
    col[i * 3] = POOP_COLOR.r * k; col[i * 3 + 1] = POOP_COLOR.g * k; col[i * 3 + 2] = POOP_COLOR.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Une geometrías en una sola, conservando el orden de sus triángulos. */
function merge(geometries) {
  let vertices = 0, indices = 0;
  for (const g of geometries) { vertices += g.attributes.position.count; indices += g.index ? g.index.count : g.attributes.position.count; }
  const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), color = new Float32Array(vertices * 3);
  const index = new Uint32Array(indices);
  let v = 0, k = 0;
  for (const g of geometries) {
    position.set(g.attributes.position.array, v * 3);
    normal.set(g.attributes.normal.array, v * 3);
    color.set(g.attributes.color.array, v * 3);
    const count = g.index ? g.index.count : g.attributes.position.count;
    for (let i = 0; i < count; i++) index[k++] = (g.index ? g.index.getX(i) : i) + v;
    v += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  return out;
}

/** Charco de borde irregular, acostado sobre el piso, de radio ~1. */
function wetGeometry(seed) {
  const shape = new THREE.Shape(), n = 48;
  for (let i = 0; i <= n; i++) {
    const a = i / n * Math.PI * 2;
    const r = 1 + .18 * Math.sin(a * 3 + seed) + .1 * Math.sin(a * 5 + seed * 2) + .05 * Math.sin(a * 9 + seed);
    const x = Math.cos(a) * r * 1.35, y = Math.sin(a) * r;
    i ? shape.lineTo(x, y) : shape.moveTo(x, y);
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

const wetMaterial = (color, opacity, roughness = .9, extra = {}) => new THREE.MeshStandardMaterial({
  color, transparent: true, opacity, roughness, metalness: 0, depthWrite: false,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, ...extra
});

function buildShared() {
  // Las migajas salen de una semilla fija: el montón es el mismo en cada partida.
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pieceGeometries = [], pieceOffsets = [], parts = [];
  const m = new THREE.Matrix4(), turn = new THREE.Matrix4();
  for (const [x, y, z, r, l, yaw, tilt] of PIECES) {
    const geo = lumpy(new THREE.CapsuleGeometry(r, l, 8, 14), r * .18, 38);
    geo.deleteAttribute('uv');
    geo.applyMatrix4(m.makeRotationY(yaw).multiply(turn.makeRotationZ(Math.PI / 2 + tilt)));
    pieceGeometries.push(geo);
    pieceOffsets.push(new THREE.Vector3(x, y, z));
    parts.push([geo.clone().translate(x, y, z)]);
  }
  for (let i = 0; i < CRUMBS; i++) {
    const a = rnd() * Math.PI * 2, d = .17 + rnd() * .12, r = .008 + rnd() * .014;
    const geo = lumpy(new THREE.SphereGeometry(r, 8, 6), r * .12, 40);
    geo.deleteAttribute('uv');
    parts[parts.length - 1].push(geo.translate(Math.cos(a) * d, r * .6, Math.sin(a) * d));
  }
  const pieceEnds = [];
  let end = 0;
  for (const group of parts) {
    for (const g of group) end += g.index ? g.index.count : g.attributes.position.count;
    pieceEnds.push(end);
  }
  const pile = merge(parts.flat());
  for (const g of parts.flat()) g.dispose();
  const stream = new THREE.CylinderGeometry(.006, .009, 1, 6);
  stream.translate(0, .5, 0);
  stream.rotateX(Math.PI / 2);
  return {
    pile, pieceEnds, pieceGeometries, pieceOffsets,
    under: wetGeometry(1.7), pee: wetGeometry(4.2), stream,
    materials: {
      poop: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .42, metalness: 0 }),
      under: wetMaterial(0x140d08, .5),
      ring: wetMaterial(0x101010, .45),
      pee: wetMaterial(0xd2b03a, .55, .04),
      stream: wetMaterial(0xe2c24a, .6, .1, { emissive: 0x3a2e00, polygonOffset: false })
    }
  };
}

export class GroundPoops {
  constructor(scene, { random = Math.random } = {}) {
    this.scene = scene;
    this.random = random;
    this.shared = buildShared();
    this.pieceEnds = this.shared.pieceEnds;
    this._piles = [];
    this._views = []; // geometrías de montón libres: comparten atributos, cada una con su rango
    this.flies = new PoopFlies(scene, { maxPiles: MAX_GROUND_POOPS + 1 });
    this.stink = new PoopStink(scene, { maxPiles: MAX_GROUND_POOPS + 1 });
    const { materials } = this.shared;
    this.falling = new THREE.Mesh(this.shared.pieceGeometries[0], materials.poop);
    this.falling.visible = false;
    this.stream = new THREE.Mesh(this.shared.stream, materials.stream);
    this.stream.visible = false;
    scene.add(this.falling, this.stream);
    this._frustum = new THREE.Frustum();
    this._matrix = new THREE.Matrix4();
    this._sphere = new THREE.Sphere(new THREE.Vector3(), SPHERE);
    this._tmp = new THREE.Vector3();
  }

  get piles() { return this._piles; }
  get activeCount() { return this._piles.reduce((n, pile) => n + (pile._fading ? 0 : 1), 0); }

  _view() {
    const view = this._views.pop() ?? new THREE.BufferGeometry();
    if (!view.index) {
      for (const [name, attribute] of Object.entries(this.shared.pile.attributes)) view.setAttribute(name, attribute);
      view.setIndex(this.shared.pile.index);
      view.boundingSphere = this.shared.pile.boundingSphere;
    }
    return view;
  }

  /** Deja un montón en `position` (a ras del piso). `pieces` cuántos trozos se ven ya. */
  spawn(position, { pieces = 0, pee = false, peeAt = null } = {}) {
    if (this.activeCount >= MAX_GROUND_POOPS) {
      const oldest = this._piles.find(pile => !pile._fading);
      if (oldest) oldest._fading = true;
    }
    const { materials } = this.shared;
    const yaw = this.random() * Math.PI * 2;
    const group = new THREE.Group();
    group.position.copy(position);
    group.userData.baseY = position.y;
    const mesh = new THREE.Mesh(this._view(), materials.poop);
    mesh.rotation.y = yaw;
    const under = new THREE.Mesh(this.shared.under, materials.under);
    under.scale.setScalar(UNDER_SCALE);
    under.position.y = .0015;
    group.add(mesh, under);
    let peeMesh = null, ringMesh = null;
    if (pee) {
      const local = (peeAt ?? position).clone().sub(position);
      ringMesh = new THREE.Mesh(this.shared.pee, materials.ring);
      ringMesh.position.set(local.x, .002, local.z);
      peeMesh = new THREE.Mesh(this.shared.pee, materials.pee);
      peeMesh.position.set(local.x, .003, local.z);
      group.add(ringMesh, peeMesh);
    }
    this.scene.add(group);
    const top = TOP.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw).add(position);
    const pile = {
      position: position.clone(), top, yaw, age: 0, fade: 0, settledAge: null, pieces: 0, pee: 0,
      peeAt: peeAt ? peeAt.clone() : null, seed: this.random() * 100, visible: true,
      group, mesh, peeMesh, ringMesh, _fading: false
    };
    this._piles.push(pile);
    this.reveal(pile, pieces);
    this.setPee(pile, 0, null);
    return pile;
  }

  /** Muestra los primeros `pieces` trozos; el último trae las migajas. */
  reveal(pile, pieces) {
    const count = Math.max(0, Math.min(POOP_PIECES, Math.floor(pieces)));
    pile.pieces = count;
    pile.mesh.geometry.setDrawRange(0, count ? this.pieceEnds[count - 1] : 0);
    pile.mesh.visible = count > 0;
  }

  /** El trozo `index` cayendo desde `from` hasta su sitio; con `index` null o ya en el piso se oculta. */
  dropPiece(pile, index, from, progress) {
    if (index == null || !(progress < 1) || index >= POOP_PIECES) { this.falling.visible = false; return; }
    const p = Math.max(0, progress);
    const rest = this._tmp.copy(this.shared.pieceOffsets[index]).applyAxisAngle(THREE.Object3D.DEFAULT_UP, pile.yaw).add(pile.position);
    this.falling.geometry = this.shared.pieceGeometries[index];
    this.falling.position.copy(from).lerp(rest, p * p);
    this.falling.rotation.y = pile.yaw;
    this.falling.scale.setScalar(.4 + .6 * Math.min(1, p / .6));
    this.falling.visible = true;
  }

  /** Charquito de chichi de 0 a 1 y, mientras orina, el chorrito desde `streamFrom`. */
  setPee(pile, amount, streamFrom) {
    pile.pee = Math.max(0, Math.min(1, amount));
    this._layoutPee(pile);
    if (!streamFrom || !pile.peeAt) { this.stream.visible = false; return; }
    const target = this._tmp.copy(pile.peeAt).setY(pile.peeAt.y + .004);
    this.stream.position.copy(streamFrom);
    this.stream.scale.set(1, 1, Math.max(.01, streamFrom.distanceTo(target)));
    this.stream.lookAt(target);
    this.stream.visible = true;
  }

  _layoutPee(pile) {
    if (!pile.peeMesh) return;
    const dry = 1 - Math.max(0, Math.min(1, (pile.age - (PEE_LIFETIME - PEE_DRY)) / PEE_DRY));
    const k = pile.pee * dry;
    pile.peeMesh.visible = pile.ringMesh.visible = k > 0;
    pile.peeMesh.scale.setScalar(k > 0 ? (.04 + .15 * pile.pee) * dry : 0);
    pile.ringMesh.scale.setScalar(k > 0 ? (.05 + .19 * pile.pee) * dry : 0);
  }

  /** La escena terminó: desde ahora pueden llegar las moscas y salir el olor. */
  settle(pile) {
    if (pile.settledAge == null) pile.settledAge = 0;
  }

  /** Quita un montón en el acto (la escena se cortó antes del primer trozo). */
  remove(pile) {
    const i = this._piles.indexOf(pile);
    if (i < 0) return;
    this._piles.splice(i, 1);
    pile.group.removeFromParent();
    this._views.push(pile.mesh.geometry);
  }

  update(dt, { camera = null, listener = null, time = 0, quality = 'alta' } = {}) {
    if (camera) {
      camera.updateMatrixWorld();
      this._frustum.setFromProjectionMatrix(this._matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    }
    for (let i = this._piles.length - 1; i >= 0; i--) {
      const pile = this._piles[i];
      pile.age += dt;
      if (pile.settledAge != null) pile.settledAge += dt;
      if (pile.age >= POOP_LIFETIME - POOP_FADE) pile._fading = true;
      if (pile._fading) pile.fade = Math.min(1, pile.fade + dt / POOP_FADE);
      if (pile.fade >= 1) { this.remove(pile); continue; }
      pile.group.scale.setScalar(1 - pile.fade);
      pile.group.position.y = pile.group.userData.baseY - .05 * pile.fade;
      this._layoutPee(pile);
      const near = !listener || pile.position.distanceTo(listener) <= POOP_RANGE;
      this._sphere.center.copy(pile.position);
      pile.visible = near && (!camera || this._frustum.intersectsSphere(this._sphere));
    }
    this.flies?.update(dt, this._piles, { time, quality });
    this.stink?.update(dt, this._piles, { time, camera });
  }

  /** Distancia a la popó más cercana, o Infinity si no hay ninguna. */
  nearestDistance(point) {
    let best = Infinity;
    for (const pile of this._piles) best = Math.min(best, pile.position.distanceTo(point));
    return best;
  }

  dispose() {
    for (const pile of [...this._piles]) this.remove(pile);
    this.falling.removeFromParent();
    this.stream.removeFromParent();
    this.flies?.dispose();
    this.stink?.dispose();
    // Con todos los montones fuera ya se pueden liberar los atributos compartidos.
    for (const view of this._views) view.dispose();
    this._views = [];
    const { materials, ...geometries } = this.shared;
    for (const material of Object.values(materials)) material.dispose();
    for (const geometry of [geometries.pile, geometries.under, geometries.pee, geometries.stream, ...geometries.pieceGeometries]) geometry.dispose();
  }
}
