// src/world/bogota/motoRiders.js
// Quien va en las motos es la gente de la calle: los mismos modelos de peatón, sentados una sola vez y horneados.
// Cada apariencia se carga liviana, se pone en cada pose de moto, se funde en una malla pequeña con el color
// de sus texturas en los vértices y se dibuja instanciada. No hay esqueletos ni mezcladores en la calle.
import * as THREE from 'three';
import { createRealisticCharacter, loadCatalog, normalizeReal } from '../../character/RealisticCharacter.js';
import { personLook, rollPerson } from '../../character/archetypes.js';
import { chainSunField } from './SunFieldShader.js';

export const RIDER_LOOKS = { adult: 8, kid: 3 };
export const RIDER_CAPACITY = 512;
export const RIDER_ROLES = Object.freeze(['driver', 'tank', 'pillion']);
// Quien queda más lejos que esto no se mece: solo va con la moto.
export const RIDER_SWAY_RANGE = 45;

const ADULT_TYPES = ['oficinista', 'obrero', 'estudiante', 'vendedor', 'senora', 'oficinista', 'obrero', 'estudiante'];
const KID_SCALE = .72;
const CELL = .05;
// Posición de manos y pies respecto al punto del asiento (x adelante, y arriba, z a un lado), la cadera y cuánto se inclina el torso.
const POSES = {
  driver: { hips: [.06, .10], lean: 30, hands: [.67, .14, .30], feet: [.24, -.62, .20] },
  tank: { hips: [-.02, .10], lean: 10, hands: [.30, .12, .12], feet: [.21, -.44, .26] },
  pillion: { hips: [0, .10], lean: 12, hands: [.34, .14, .22], feet: [.10, -.48, .26] }
};
const CLOTH = [[.10, .12, .20], [.07, .07, .08], [.45, .09, .08], [.20, .34, .52], [.80, .80, .78], [.28, .30, .20], [.10, .30, .18], [.72, .30, .06]];

const PART = { body: 0, top: 1, shell: 2, visor: 3 };

// ---------- pintura: color por vértice, tinte por instancia y casco que se esconde ----------

const ATTRIBUTES = `attribute float aPart;
attribute vec4 aHelmet;
`;
const HIDE = `#include <begin_vertex>
  if (aPart > 1.5 && aHelmet.a < .5) transformed *= 0.;`;
let paint = null, shadow = null;

function riderMaterial() {
  if (paint) return paint;
  paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0, side: THREE.DoubleSide });
  paint.name = 'Gente en moto';
  paint.onBeforeCompile = shader => {
    shader.vertexShader = (ATTRIBUTES + shader.vertexShader)
      .replace('#include <begin_vertex>', HIDE)
      .replace('#include <color_vertex>', `#include <color_vertex>
      #ifdef USE_INSTANCING_COLOR
        if (aPart > .5 && aPart < 1.5) vColor.rgb *= instanceColor.rgb;
      #endif
      if (aPart > 1.5 && aPart < 2.5) vColor.rgb = aHelmet.rgb;`);
  };
  paint.customProgramCacheKey = () => 'motos-gente';
  return chainSunField(paint);
}

function riderShadow() {
  if (shadow) return shadow;
  shadow = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  shadow.name = 'Sombra de gente en moto';
  shadow.onBeforeCompile = shader => { shader.vertexShader = (ATTRIBUTES + shader.vertexShader).replace('#include <begin_vertex>', HIDE); };
  shadow.customProgramCacheKey = () => 'motos-gente-sombra';
  return shadow;
}

// ---------- el color de las texturas, una vez por vértice ----------

const texels = new WeakMap();
function sampler(texture) {
  if (!texture?.image) return null;
  let data = texels.get(texture);
  if (!data) {
    const size = 256, canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(texture.image, 0, 0, size, size);
    data = context.getImageData(0, 0, size, size).data;
    texels.set(texture, data);
  }
  return (u, v, target) => {
    const x = Math.min(255, Math.floor((u - Math.floor(u)) * 256)), y = Math.min(255, Math.floor((v - Math.floor(v)) * 256)), at = (y * 256 + x) * 4;
    return target.setRGB(data[at] / 255, data[at + 1] / 255, data[at + 2] / 255, THREE.SRGBColorSpace);
  };
}

const luminance = color => color.r * .2126 + color.g * .7152 + color.b * .0722;

/** Color y marca de cada vértice de una malla: la piel y el pelo, el calzado, el pantalón y la parte de arriba que tiñe cada persona. */
function paintMesh(mesh, real, restY, hipY) {
  const { material, geometry } = mesh, uv = geometry.attributes.uv, count = geometry.attributes.position.count;
  const sample = sampler(material.map), colors = new Float32Array(count * 3), parts = new Uint8Array(count), pixel = new THREE.Color();
  const garment = geometry.attributes.streetZone !== undefined;
  const tint = material.color, bottom = garment && real.tonos?.abajo ? new THREE.Color(real.tonos.abajo) : null;
  let mean = 0;
  const shade = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    if (sample) sample(uv.getX(i), uv.getY(i), pixel); else pixel.set(1, 1, 1);
    shade[i] = luminance(pixel);
    mean += shade[i];
    pixel.multiply(tint);
    colors.set([pixel.r, pixel.g, pixel.b], i * 3);
  }
  mean = Math.max(mean / count, .02);
  const hair = /hair|short|afro|long|ponytail|bob|beard|moustache/i.test(mesh.name);
  for (let i = 0; i < count; i++) {
    const relative = THREE.MathUtils.clamp(shade[i] / mean, .55, 1.45);
    if (garment && restY[i] > hipY - .06) {
      parts[i] = PART.top;
      colors.set([relative, relative, relative], i * 3);
    } else if (garment && bottom) colors.set([bottom.r * relative, bottom.g * relative, bottom.b * relative], i * 3);
    else if (hair) colors.set([tint.r * relative, tint.g * relative, tint.b * relative], i * 3);
  }
  return { colors, parts };
}

// ---------- la pose sentada ----------

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _q = new THREE.Quaternion(), _r = new THREE.Quaternion();

function aim(bone, child, direction) {
  bone.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  _q.setFromUnitVectors(_b.sub(_a).normalize(), _c.copy(direction).normalize());
  bone.getWorldQuaternion(_r).premultiply(_q);
  if (bone.parent) _r.premultiply(bone.parent.getWorldQuaternion(_q).invert());
  bone.quaternion.copy(_r);
  bone.updateMatrixWorld(true);
}

/** Dos huesos que llegan a un punto: el medio (rodilla o codo) cae hacia el lado que indica `pole`. */
function reach(upper, middle, end, target, pole) {
  upper.getWorldPosition(_a); middle.getWorldPosition(_b); end.getWorldPosition(_c);
  const first = _a.distanceTo(_b), second = _b.distanceTo(_c), from = _a.clone();
  const toward = _d.copy(target).sub(from), distance = THREE.MathUtils.clamp(toward.length(), Math.abs(first - second) + 1e-3, first + second - 1e-3);
  toward.normalize();
  const along = (first * first - second * second + distance * distance) / (2 * distance), height = Math.sqrt(Math.max(first * first - along * along, 0));
  const side = pole.clone().addScaledVector(toward, -pole.dot(toward)).normalize();
  const joint = from.clone().addScaledVector(toward, along).addScaledVector(side, height);
  aim(upper, middle, joint.clone().sub(from));
  aim(middle, end, from.clone().addScaledVector(toward, distance).sub(joint));
}

const boneNamed = (bones, suffix) => bones.find(bone => bone.name.endsWith(suffix));

function pose(character, bones, rest, spec, scale) {
  for (const [bone, position, quaternion] of rest) { bone.position.copy(position); bone.quaternion.copy(quaternion); }
  const { group } = character;
  group.position.set(0, 0, 0);
  group.updateMatrixWorld(true);
  const hips = boneNamed(bones, 'Hips');
  hips.getWorldPosition(_a);
  group.position.set(spec.hips[0] - _a.x, spec.hips[1] * scale - _a.y, -_a.z);
  group.updateMatrixWorld(true);
  const lean = THREE.MathUtils.degToRad(spec.lean), up = (angle) => new THREE.Vector3(Math.sin(angle), Math.cos(angle), 0);
  const chain = [['Hips', 'Spine', lean * .6], ['Spine', 'Spine1', lean * .8], ['Spine1', 'Spine2', lean], ['Spine2', 'Neck', lean], ['Neck', 'Head', lean * .35]];
  for (const [from, to, angle] of chain) aim(boneNamed(bones, from), boneNamed(bones, to), up(angle));
  for (const name of ['Left', 'Right']) {
    const leg = [boneNamed(bones, `${name}UpLeg`), boneNamed(bones, `${name}Leg`), boneNamed(bones, `${name}Foot`)];
    const arm = [boneNamed(bones, `${name}Arm`), boneNamed(bones, `${name}ForeArm`), boneNamed(bones, `${name}Hand`)];
    leg[0].getWorldPosition(_a);
    const side = Math.sign(_a.z) || 1;
    reach(...leg, new THREE.Vector3(spec.feet[0], spec.feet[1], side * spec.feet[2]), new THREE.Vector3(1, .15, side * .5));
    aim(leg[2], boneNamed(bones, `${name}ToeBase`), new THREE.Vector3(1, -.25, 0));
    reach(...arm, new THREE.Vector3(spec.hands[0], spec.hands[1], side * spec.hands[2]), new THREE.Vector3(-.4, -1, side * .6));
  }
  group.updateMatrixWorld(true);
}

// ---------- hornear ----------

function helmetParts(center, size) {
  const shell = new THREE.SphereGeometry(.13 * size, 10, 7);
  shell.scale(1, 1.04, 1.02);
  shell.translate(center.x, center.y, center.z);
  const visor = new THREE.BoxGeometry(.07 * size, .045 * size, .19 * size);
  visor.translate(center.x + .115 * size, center.y - .015 * size, center.z);
  return [[shell, PART.shell, [1, 1, 1]], [visor, PART.visor, [.05, .06, .07]]];
}

/** Funde en una malla las piezas posadas: los vértices de una misma celda y pieza se vuelven uno. */
function merge(pieces) {
  const cells = new Map(), position = [], color = [], part = [], index = [], seen = new Set();
  const unit = [];
  for (const { positions, colors, parts, indices } of pieces) {
    const map = new Int32Array(positions.length / 3);
    for (let i = 0; i < map.length; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2], p = parts[i];
      const key = `${p === PART.top ? 1 : 0}|${Math.round(x / CELL)}|${Math.round(y / CELL)}|${Math.round(z / CELL)}|${positions.piece}`;
      let at = cells.get(key);
      if (at === undefined) { at = unit.length; cells.set(key, at); unit.push({ n: 0, p: [0, 0, 0], c: [0, 0, 0], part: p }); }
      const cell = unit[at];
      cell.n++;
      for (let k = 0; k < 3; k++) { cell.p[k] += positions[i * 3 + k]; cell.c[k] += colors[i * 3 + k]; }
      map[i] = at;
    }
    for (let t = 0; t < indices.length; t += 3) {
      const a = map[indices[t]], b = map[indices[t + 1]], c = map[indices[t + 2]];
      if (a === b || b === c || a === c) continue;
      const id = a < b && a < c ? `${a},${b},${c}` : b < c ? `${b},${c},${a}` : `${c},${a},${b}`;
      if (seen.has(id)) continue;
      seen.add(id);
      index.push(a, b, c);
    }
  }
  for (const cell of unit) { position.push(cell.p[0] / cell.n, cell.p[1] / cell.n, cell.p[2] / cell.n); color.push(cell.c[0] / cell.n, cell.c[1] / cell.n, cell.c[2] / cell.n); part.push(cell.part); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function rider(index, kid, catalog) {
  const type = kid ? 'nino' : ADULT_TYPES[index % ADULT_TYPES.length];
  const person = rollPerson(type, { seed: `moto:${kid ? 'nino' : 'adulto'}:${index}`, sinCarga: true });
  person.real.accesorios = [];
  person.real.cabeza = 'sin-sombrero';
  if (kid) person.real.edad = 'joven';
  const alto = person.real.talla?.alto ?? 1;
  delete person.real.talla;
  const look = personLook(person);
  look.real = normalizeReal(catalog, person.real);
  look.alto = kid ? 1 : Math.min(1.06, Math.max(.94, alto));
  return look;
}

/** Una persona de la calle en cada pose de moto: { driver, pillion } los adultos, { tank, pillion } los niños. */
async function bakeLook(look, kid) {
  const size = kid ? KID_SCALE : 1;
  const character = await createRealisticCharacter(look, { lod: true });
  const { group } = character;
  group.scale.setScalar(size * (look.alto ?? 1));
  group.rotation.y = Math.PI / 2;
  group.updateMatrixWorld(true);
  const bones = [], skinned = [];
  group.traverse(object => {
    if (object.isBone) bones.push(object);
    if (object.isSkinnedMesh && !/low-poly/i.test(object.name)) skinned.push(object);
  });
  const rest = bones.map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
  const hipY = boneNamed(bones, 'Hips').getWorldPosition(new THREE.Vector3()).y;
  const painted = skinned.map(mesh => {
    const count = mesh.geometry.attributes.position.count, restY = new Float32Array(count), v = new THREE.Vector3();
    for (let i = 0; i < count; i++) restY[i] = mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).y;
    return paintMesh(mesh, look.real, restY, hipY);
  });
  const out = {};
  for (const role of kid ? ['tank', 'pillion'] : ['driver', 'pillion']) {
    pose(character, bones, rest, POSES[role], size);
    const pieces = skinned.map((mesh, at) => {
      mesh.skeleton.update();
      const count = mesh.geometry.attributes.position.count, positions = new Float32Array(count * 3), v = new THREE.Vector3();
      for (let i = 0; i < count; i++) mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3);
      positions.piece = at;
      return { positions, colors: painted[at].colors, parts: painted[at].parts, indices: mesh.geometry.index.array };
    });
    const head = boneNamed(bones, 'Head').getWorldPosition(new THREE.Vector3());
    head.y += .085 * size;
    helmetParts(head, size).forEach(([geometry, part, rgb], extra) => {
      const count = geometry.attributes.position.count;
      pieces.push({
        positions: Object.assign(Float32Array.from(geometry.attributes.position.array), { piece: 100 + extra }),
        colors: Float32Array.from({ length: count * 3 }, (_, i) => rgb[i % 3]), parts: new Uint8Array(count).fill(part),
        indices: geometry.index.array
      });
    });
    out[role] = merge(pieces);
  }
  character.dispose();
  return out;
}

let built = null;
/** Las personas de la calle ya sentadas: `{ adult: [...], kid: [...] }`, cada una con sus poses. Se hornea una sola vez. */
export function bakeRiders() {
  built ??= (async () => {
    const catalog = await loadCatalog();
    const result = { adult: [], kid: [] };
    for (const kind of ['adult', 'kid']) {
      for (let i = 0; i < RIDER_LOOKS[kind]; i++) result[kind].push(await bakeLook(rider(i, kind === 'kid', catalog), kind === 'kid'));
    }
    return result;
  })().catch(error => { built = null; throw error; });
  return built;
}

// ---------- dibujo instanciado ----------

const _m = new THREE.Matrix4(), _local = new THREE.Matrix4(), _pos = new THREE.Vector3(), _unit = new THREE.Vector3(1, 1, 1);
const _qy = new THREE.Quaternion(), _ey = new THREE.Vector3(0, 1, 0), _qx = new THREE.Quaternion(), _qz = new THREE.Quaternion(), _ex = new THREE.Vector3(1, 0, 0), _ez = new THREE.Vector3(0, 0, 1);
const _color = new THREE.Color();

/** Un lote instanciado por cada persona y pose; solo se dibujan los que tienen a alguien montado. */
export class MotoRiders {
  constructor(root, { capacity = RIDER_CAPACITY, bake = bakeRiders } = {}) {
    this.root = root;
    this.capacity = capacity;
    this.lots = new Map();
    this.ready = bake().then(set => {
      for (const kind of ['adult', 'kid']) set[kind].forEach((poses, look) => {
        for (const [role, geometry] of Object.entries(poses)) this.lots.set(`${kind}:${look}:${role}`, this._lot(geometry));
      });
      this.looks = { adult: set.adult.length, kid: set.kid.length };
    }).catch(error => console.warn('[Motos] la gente de las motos no se pudo preparar', error));
    this.looks = { adult: 0, kid: 0 };
  }

  _lot(geometry) {
    const { capacity } = this;
    const mesh = new THREE.InstancedMesh(geometry, riderMaterial(), capacity);
    mesh.name = 'Gente en moto';
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = riderShadow();
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    const helmet = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    geometry.setAttribute('aHelmet', helmet);
    mesh.boundingSphere = new THREE.Sphere();
    mesh.count = 0; mesh.visible = false;
    this.root.add(mesh);
    return { mesh, helmet, count: 0, box: new THREE.Box3() };
  }

  begin() { for (const lot of this.lots.values()) { lot.count = 0; lot.box.makeEmpty(); } }

  /** Pone a una persona: `moto` es su matriz, `seat` el punto del asiento y `sway` el cabeceo de la moto. */
  add(kind, look, role, motoMatrix, seat, sway, cloth, helmet) {
    const lot = this.lots.get(`${kind}:${look % this.looks[kind]}:${role}`);
    if (!lot || lot.count >= this.capacity) return;
    const index = lot.count++;
    _qx.setFromAxisAngle(_ex, sway.roll); _qz.setFromAxisAngle(_ez, sway.pitch);
    // `yaw`: el cuerpo gira sobre el asiento (quien espera mirando a todos lados).
    _qy.setFromAxisAngle(_ey, sway.yaw ?? 0);
    _local.compose(_pos.set(seat[0], seat[1], 0), _qy.multiply(_qx.multiply(_qz)), _unit);
    _m.multiplyMatrices(motoMatrix, _local);
    lot.mesh.setMatrixAt(index, _m);
    _color.setRGB(...CLOTH[cloth & 7], THREE.SRGBColorSpace);
    lot.mesh.setColorAt(index, _color);
    const data = lot.helmet.array, at = index * 4;
    if (helmet) { data[at] = helmet.r; data[at + 1] = helmet.g; data[at + 2] = helmet.b; data[at + 3] = 1; } else data[at + 3] = 0;
    lot.box.expandByPoint(_pos.setFromMatrixPosition(_m));
  }

  end() {
    for (const { mesh, helmet, count, box } of this.lots.values()) {
      mesh.count = count;
      mesh.visible = count > 0;
      if (!count) continue;
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; helmet.needsUpdate = true;
      box.getBoundingSphere(mesh.boundingSphere);
      mesh.boundingSphere.radius += 2.5;
    }
  }

  get drawn() { let sum = 0; for (const lot of this.lots.values()) sum += lot.count; return sum; }

  dispose() {
    for (const { mesh } of this.lots.values()) { this.root.remove(mesh); mesh.dispose(); }
    this.lots.clear();
  }
}
