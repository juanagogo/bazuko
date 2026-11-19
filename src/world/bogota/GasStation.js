import * as THREE from 'three';
import { signTexture } from '../../utils/signs.js';
import { caidaDeManguera, ensuciarTapa, luzPintada, piezasDeGasolinera, recortar, repetir, texturasDeGasolinera } from './gasolineraPiezas.js';

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

/** Estación sin marca: cubierta roja gastada, surtidores de lámina, tienda y tótem; lo menudo va en gasolineraPiezas. */
export function buildGasStation({ createSign = signTexture } = {}) {
  const group = new THREE.Group(); group.name = GAS_STATION.name;
  const tx = texturasDeGasolinera();
  const pintado = (color, map, opciones) => new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : color, map, ...opciones });
  const red = luzPintada(pintado('#7b2f2b', tx.rojo, { roughness: .72 }), tx.rojo, '#ffd9b0', .07);
  const white = luzPintada(pintado('#b3b1a8', tx.lamina, { roughness: .82 }), tx.lamina, '#ffe1b4', .12);
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2e31', roughness: .78 });
  const yellow = luzPintada(pintado('#978239', tx.amarillo, { roughness: .9 }), tx.amarillo, '#ffe1b4', .3);
  const glass = luzPintada(pintado('#27343a', tx.vidrio, { roughness: .3, metalness: .2 }), tx.vidrioLuz, '#ffdcae', 1);
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
  const canopy = ensuciarTapa(repetir(box(17.5, .5, 15, 154, 5.05, 100, red), 6));
  canopy.userData.rainCover = true;
  recortar(repetir(box(17, .08, 14.5, 154, 4.76, 100, white), 8), .3, .74);
  for (const x of [147, 161]) for (const z of [94, 106]) box(.38, 4.65, .38, x, 2.44, z, white);
  label('TEXACO', 'SERVICIO · COMBUSTIBLES', 8, .42, 154, 5.07, 92.48);
  for (const x of [149, 159]) {
    repetir(box(2.1, .16, 10.6, x, .2, 100, yellow), 7).castShadow = false;
    for (const z of [97, 103]) {
      box(.52, .88, .84, x, .86, z, white);
      ensuciarTapa(box(.62, .15, .94, x, 2.02, z, red));
      box(.56, .34, .3, x, 1, z - .2, dark);
      for (const side of [-1, 1]) {
        const hose = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(caidaDeManguera(x, z, side)), 16, .026, 6, false), dark);
        group.add(hose);
      }
    }
  }
  repetir(box(13, 3.4, 4, 154, 1.82, 114, white), 3);
  ensuciarTapa(repetir(box(13.3, .3, 4.3, 154, 3.65, 114, red), 5));
  for (const x of [150, 154, 158]) box(2.9, 1.9, .06, x, 1.72, 111.95, glass).castShadow = false;
  label('TIENDA', 'CAFÉ · AGUA · VÍVERES', 8, .6, 154, 3.12, 111.9);
  box(.36, 8.8, .26, 146, 4.52, 91, dark);
  box(2, 3.2, .3, 146, 7.6, 91, red);
  label('TEXACO', 'ABIERTO 24 H', 1.9, .8, 146, 8.4, 90.83);
  label('CORRIENTE', 'EXTRA · DIÉSEL', 1.9, .8, 146, 7.1, 90.83, '#252c32');
  group.add(piezasDeGasolinera(tx));
  return group;
}
