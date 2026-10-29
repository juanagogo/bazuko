// src/world/bogota/suv.js
// Camioneta 4x4 negra de lujo, sin marca: pintura brillante, vidrios polarizados, parrilla y rines
// cromados, estribos y barras de techo. El frente apunta a +X local, como makeVehicle.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const SUV_SIZE = { length: 5, width: 2.02 };

const WHEEL_R = 0.42;

/** @returns {{ group: THREE.Group, length: number, width: number, wheels: THREE.Object3D[], setBraking(on:boolean):void, setLights(on:boolean):void, dispose():void }} */
export function makeSuv() {
  const { length: L, width: W } = SUV_SIZE;
  const paint = new THREE.MeshPhysicalMaterial({ color: '#07080a', metalness: 0.6, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.03 });
  const glass = new THREE.MeshPhysicalMaterial({ color: '#020304', metalness: 0.3, roughness: 0.05, clearcoat: 1 });
  const trim = new THREE.MeshStandardMaterial({ color: '#0c0c0d', roughness: 0.55 });
  const chrome = new THREE.MeshStandardMaterial({ color: '#e1e4e8', metalness: 1, roughness: 0.12 });
  const tire = new THREE.MeshStandardMaterial({ color: '#0e0e0e', roughness: 0.92 });
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color('#eaf3ff').multiplyScalar(2.6) });
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a12').multiplyScalar(1.3) });
  const materials = [paint, glass, trim, chrome, tire, head, tail];
  const geometries = [];
  const g = new THREE.Group();
  g.name = 'camioneta-negra';
  const add = (geometry, material, x, y, z, parent = g) => {
    geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // carrocería alta y cuadrada, con el capó largo
  add(new RoundedBoxGeometry(L, 0.95, W, 3, 0.16), paint, 0, 0.98, 0);
  // cabina: vidrios polarizados de lado a lado y techo plano
  add(new RoundedBoxGeometry(2.95, 0.66, W - 0.12, 3, 0.12), glass, -0.42, 1.76, 0);
  add(new RoundedBoxGeometry(2.85, 0.08, W - 0.1, 2, 0.04), paint, -0.47, 2.12, 0);
  // pilares que separan las ventanas
  for (const x of [0.62, -0.42, -1.5]) add(new THREE.BoxGeometry(0.11, 0.62, W - 0.1), paint, x, 1.76, 0);
  // barras de techo
  for (const z of [W / 2 - 0.2, -(W / 2 - 0.2)]) {
    add(new THREE.BoxGeometry(2.4, 0.04, 0.05), chrome, -0.47, 2.22, z);
    for (const x of [0.6, -1.55]) add(new THREE.BoxGeometry(0.08, 0.08, 0.06), trim, x, 2.17, z);
  }
  // parrilla cromada grande con barras horizontales
  add(new THREE.BoxGeometry(0.06, 0.48, 1.12), chrome, L / 2 + 0.01, 1.02, 0);
  for (let i = 0; i < 5; i++) add(new THREE.BoxGeometry(0.03, 0.035, 1.02), trim, L / 2 + 0.045, 0.85 + i * 0.085, 0);
  // farolas LED delgadas y stops
  const lightGeo = new THREE.PlaneGeometry(0.42, 0.09);
  geometries.push(lightGeo);
  for (const z of [W / 2 - 0.3, -(W / 2 - 0.3)]) {
    const h = new THREE.Mesh(lightGeo, head);
    h.rotation.y = Math.PI / 2;
    h.position.set(L / 2 + 0.012, 1.22, z);
    g.add(h);
    const t = new THREE.Mesh(lightGeo, tail);
    t.rotation.y = -Math.PI / 2;
    t.position.set(-L / 2 - 0.012, 1.25, z);
    g.add(t);
  }
  // defensas negras y bocel cromado bajo las puertas
  add(new THREE.BoxGeometry(0.16, 0.26, W + 0.02), trim, L / 2 - 0.02, 0.6, 0);
  add(new THREE.BoxGeometry(0.16, 0.26, W + 0.02), trim, -L / 2 + 0.02, 0.6, 0);
  for (const side of [1, -1]) {
    add(new THREE.BoxGeometry(2.6, 0.035, 0.02), chrome, -0.25, 0.75, side * (W / 2 + 0.008));
    // estribo
    add(new THREE.BoxGeometry(2.5, 0.05, 0.22), trim, -0.25, 0.47, side * (W / 2 + 0.09));
    // espejos
    add(new THREE.BoxGeometry(0.16, 0.14, 0.24), paint, 0.8, 1.55, side * (W / 2 + 0.12));
  }
  // llanta de repuesto atrás
  const spare = add(new THREE.CylinderGeometry(0.36, 0.36, 0.22, 20), tire, -L / 2 - 0.12, 1.12, 0);
  spare.rotation.z = Math.PI / 2;
  // ruedas grandes con rin cromado
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 22).rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.27, 0.27, 0.31, 10).rotateX(Math.PI / 2);
  geometries.push(wheelGeo, rimGeo);
  const wheels = [];
  for (const [x, z] of [[1.55, W / 2 - 0.16], [1.55, -(W / 2 - 0.16)], [-1.55, W / 2 - 0.16], [-1.55, -(W / 2 - 0.16)]]) {
    const w = new THREE.Mesh(wheelGeo, tire);
    w.position.set(x, WHEEL_R, z);
    w.castShadow = true;
    w.add(new THREE.Mesh(rimGeo, chrome));
    g.add(w);
    wheels.push(w);
  }

  return {
    group: g, length: L, width: W, wheels,
    setBraking(on) { tail.color.set('#ff1a12').multiplyScalar(on ? 3.5 : 1.3); },
    setLights(on) { head.color.set(on ? '#eaf3ff' : '#9aa3ad').multiplyScalar(on ? 2.6 : 0.6); },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      g.removeFromParent();
    }
  };
}

/** Las ruedas giran con lo recorrido */
export const rollWheels = (suv, distance) => { for (const w of suv.wheels) w.rotation.z -= distance / WHEEL_R; };
