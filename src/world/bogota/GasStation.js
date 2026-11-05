import * as THREE from 'three';
import { signTexture } from '../../utils/signs.js';

export const GAS_STATION = Object.freeze({ x0: 145, x1: 163, z0: 89, z1: 117,
  x: 154, z: 102, name: 'Estación de gasolina' });
export const inGasStation = (x, z) => x >= 145 && x <= 163 && z >= 89 && z <= 117;
export const underGasCanopy = (x, z) => x >= 145.25 && x <= 162.75 && z >= 92.5 && z <= 107.5;
export const GAS_OBSTACLES = [
  { x: 154, z: 114, w: 13, d: 4, h: 3.4 },
  ...[149, 159].flatMap(x => [97, 103].map(z => ({ x, z, w: .85, d: 1.1, h: 2 }))),
  ...[147, 161].flatMap(x => [94, 106].map(z => ({ x, z, w: .4, d: .4, h: 4.8 }))),
  { x: 146, z: 91, w: .6, d: .6, h: 9 }
];

export function paintGasStation(map) {
  for (let z = 45; z <= 58; z++) for (let x = 73; x <= 81; x++) map[z][x] = 'floor';
}

/** Geometría propia inspirada en la referencia: marquesina roja, surtidores y tótem. */
export function buildGasStation({ createSign = signTexture } = {}) {
  const group = new THREE.Group(); group.name = GAS_STATION.name;
  const red = new THREE.MeshStandardMaterial({ color: '#bc1726', roughness: .55 });
  const white = new THREE.MeshStandardMaterial({ color: '#e7e5df', roughness: .7 });
  const dark = new THREE.MeshStandardMaterial({ color: '#252c32', roughness: .7 });
  const yellow = new THREE.MeshStandardMaterial({ color: '#e9b82a', roughness: .8 });
  const glass = new THREE.MeshStandardMaterial({ color: '#467783', roughness: .3, metalness: .2 });
  const box = (w, h, d, x, y, z, material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  };
  const label = (text, sub, w, h, x, y, z, bg = '#bc1726') => {
    const texture = createSign({ title: text, sub, bg, fg: '#ffffff', border: false, w: 512, h: 128 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
    mesh.position.set(x, y, z); mesh.rotation.y = Math.PI; group.add(mesh); return mesh;
  };
  // Marquesina alta, con franja roja y cielo blanco; no bloquea la circulación bajo ella.
  box(17.5, .5, 15, 154, 5.05, 100, red);
  box(17, .08, 14.5, 154, 4.76, 100, white);
  for (const x of [147, 161]) for (const z of [94, 106]) box(.38, 4.65, .38, x, 2.44, z, white);
  label('TEXACO', 'SERVICIO · COMBUSTIBLES', 8, .42, 154, 5.07, 92.48);
  for (const x of [149, 159]) {
    box(2.1, .16, 10.6, x, .2, 100, yellow);
    for (const z of [97, 103]) {
      box(.85, 1.25, 1.1, x, .94, z, white);
      box(.9, .55, 1.12, x, 1.83, z, red);
      box(.58, .28, .04, x, 1.75, z - .58, dark);
      for (const side of [-1, 1]) {
        const points = [new THREE.Vector3(x + side * .48, 1.85, z),
          new THREE.Vector3(x + side * .7, 1.15, z), new THREE.Vector3(x + side * .65, .48, z),
          new THREE.Vector3(x + side * .48, .75, z)];
        const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 10, .035, 5, false), dark);
        group.add(hose);
      }
    }
  }
  box(13, 3.4, 4, 154, 1.82, 114, white);
  box(13.3, .3, 4.3, 154, 3.65, 114, red);
  for (const x of [150, 154, 158]) box(2.9, 1.9, .06, x, 1.72, 111.95, glass);
  label('TIENDA', 'CAFÉ · AGUA · VÍVERES', 8, .6, 154, 3.12, 111.9);
  box(.36, 8.8, .36, 146, 4.52, 91, dark);
  box(2, 3.2, .3, 146, 7.6, 91, red);
  label('TEXACO', 'ABIERTO 24 H', 1.9, .8, 146, 8.4, 90.83);
  label('CORRIENTE', 'EXTRA · DIÉSEL', 1.9, .8, 146, 7.1, 90.83, '#252c32');
  return group;
}
