// src/entities/StreetLifeProps.js
// Tres lugares nuevos de la calle, hechos por código y sin luces propias:
// - La pila pública: un lavadero de concreto con su llave, en los parques. Ahí me lavo y lleno la botella.
// - El hogar de paso: una puerta con reja, letrero y timbre contra una fachada.
// - La entrada al transporte: lector junto a la rampa del Portal y puntos de pasajes del Metro.
// Los materiales se comparten entre todas las copias; al cerrar el distrito cada objeto suelta su geometría.
import * as THREE from 'three';
import { signMesh } from '../utils/signs.js';
import { INTERACT_RANGE } from '../utils/constants.js';
import { MeshKit, canvasTexture, rgb } from '../world/bogota/MeshKit.js';
import { addCalle72Access } from './Calle72Access.js';

let shared = null;
function mats() {
  shared ??= {
    concreto: new THREE.MeshLambertMaterial({ color: 0x9a968c }),
    concretoOscuro: new THREE.MeshLambertMaterial({ color: 0x6f6b63 }),
    agua: new THREE.MeshLambertMaterial({ color: 0x4d7287, emissive: 0x0b1a22 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x8c9196 }),
    reja: new THREE.MeshLambertMaterial({ color: 0x2b2f33 }),
    puerta: new THREE.MeshLambertMaterial({ color: 0x5b3a25 }),
    rojo: new THREE.MeshLambertMaterial({ color: 0xb3261e }),
    verde: new THREE.MeshLambertMaterial({ color: 0x2f7d4a }),
  };
  for (const m of Object.values(shared)) m.userData.shared = true;
  return shared;
}

function box(w, h, d, mat, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

class Prop {
  constructor(scene, position, kind) {
    this.scene = scene;
    this.kind = kind;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);
  }
  get position() { return this.group.position; }
  update() {}
  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material && !o.material.userData?.shared) { o.material.map?.dispose?.(); o.material.dispose?.(); }
    });
    this.group.clear();
  }
}

/** Pila pública: lavadero con llave. E me lava; Q llena la botella. */
export class PilaPublica extends Prop {
  constructor(scene, position, rot = 0) {
    super(scene, position, 'pila');
    const m = mats();
    this.group.rotation.y = rot;
    this.group.add(box(1.4, .8, .8, m.concreto, 0, .4, 0));
    this.group.add(box(1.2, .06, .6, m.agua, 0, .78, 0));
    this.group.add(box(1.5, .1, .9, m.concretoOscuro, 0, .83, 0));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .9, 8), m.metal);
    post.position.set(0, 1.25, -.32);
    this.group.add(post);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, .3, 6), m.metal);
    spout.rotation.x = Math.PI / 2;
    spout.position.set(0, 1.62, -.2);
    this.group.add(spout);
    this.approach = new THREE.Vector3(0, 0, 1.3).applyQuaternion(this.group.quaternion).add(position);
    this.collider = { size: new THREE.Vector3(1.5, 1, .9), offset: new THREE.Vector3(0, .5, 0) };
  }
}

/** Hogar de paso: puerta con reja, letrero y timbre contra la fachada. */
export class HogarDePaso extends Prop {
  constructor(scene, position, rot = 0) {
    super(scene, position, 'hogar');
    const m = mats();
    this.group.rotation.y = rot;
    // La puerta va contra la fachada (hacia +Z local) y la gente se para del lado de -Z.
    const fachada = new THREE.Group();
    fachada.position.z = .9;
    fachada.add(box(1.5, 2.3, .12, m.puerta, 0, 1.15, 0));
    for (let i = -3; i <= 3; i++) fachada.add(box(.04, 2.2, .04, m.reja, i * .2, 1.15, -.1));
    fachada.add(box(1.6, .06, .06, m.reja, 0, .3, -.1));
    fachada.add(box(1.6, .06, .06, m.reja, 0, 2.1, -.1));
    fachada.add(box(.12, .12, .05, m.rojo, .9, 1.3, -.06));
    const sign = signMesh({ title: 'HOGAR DE PASO', sub: 'NOCHE, DUCHA Y COMIDA', bg: '#1f4f7a', fg: '#ffffff', accent: '#ffd166' }, 2.2);
    sign.position.set(0, 2.75, -.12);
    sign.rotation.y = Math.PI;
    fachada.add(sign);
    this.group.add(fachada);
  }
}

function addPortalFareReader(group) {
  // El anclaje de uso queda en X 74. El mueble cabe entre la baranda y la guía táctil.
  const x = -.58, y = 1.16, tilt = -.28, depth = .36;
  const kit = new MeshKit();
  kit.box(x, .016, 0, .34, .10, .40, rgb('#35393d'), { bottom: .6 });
  kit.frustum(x, 0, .055, 1.05, .28, .28, .22, .22, rgb('#838d92'), { bottom: .69, skipTop: true });
  kit.box(x, y, 0, .61, .32, depth, rgb('#a02531'), { bottom: .66, top: 1.12, rotation: [tilt, 0, 0] });
  const housing = new THREE.Mesh(kit.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .57, metalness: .24 }));
  housing.name = 'Lector de pasajes';
  housing.castShadow = housing.receiveShadow = true;

  const screen = canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#242e30'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#eeeee4'; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('PASAJES', w / 2, 40);
    // Tarjeta y ondas junto al visor de lectura.
    ctx.strokeStyle = '#a3d5cb'; ctx.lineWidth = 4;
    ctx.strokeRect(44, 78, 42, 30);
    for (const r of [9, 17]) {
      ctx.beginPath(); ctx.arc(90, 93, r, -.78, .78); ctx.stroke();
    }
    ctx.fillStyle = '#476563'; ctx.fillRect(127, 75, 85, 36);
    ctx.fillStyle = '#a3d5cb'; ctx.fillRect(139, 91, 59, 4);
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(.55, .267), new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }));
  face.rotation.x = tilt;
  const surface = depth / 2 + .002;
  face.position.set(x, y - Math.sin(tilt) * surface, Math.cos(tilt) * surface);
  group.add(housing, face);
}

/** Entrada al transporte. */
export class TransitStop extends Prop {
  constructor(scene, position, stop) {
    super(scene, position, 'transit');
    this.stop = stop;
    if (stop.id === 'portal') {
      addPortalFareReader(this.group);
      return;
    }
    const m = mats();
    if (stop.id === 'metro72') {
      addCalle72Access(this.group, m.metal);
      return;
    }
    const color = stop.sistema === 'Metro' ? m.verde : m.rojo;
    this.group.add(box(.25, 1, .9, m.metal, -.6, .5, 0));
    this.group.add(box(.25, 1, .9, m.metal, .6, .5, 0));
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, 1, 6), m.metal);
    arm.rotation.z = Math.PI / 2;
    arm.position.set(0, .85, 0);
    this.group.add(arm);
    const post = box(.1, 2.6, .1, m.reja, -1.1, 1.3, 0);
    this.group.add(post);
    const sign = signMesh({ title: stop.sistema.toUpperCase(), sub: stop.name.toUpperCase(), bg: stop.sistema === 'Metro' ? '#2f7d4a' : '#b3261e', fg: '#ffffff', accent: '#ffffff' }, 1.6);
    sign.position.set(-1.1, 2.9, 0);
    this.group.add(sign);
    this.group.add(box(.12, .12, .12, color, -1.1, 2.3, 0));
  }
  get title() { return this.stop.name; }
  get gpsWaypoint() {
    if (this.stop.id !== 'metro72') return null;
    return { x: this.position.x, z: this.position.z, arrivalDistance: INTERACT_RANGE };
  }
  acceptsGpsArrival(_position, target) { return target === this; }
}
