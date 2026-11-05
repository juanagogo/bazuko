import * as THREE from 'three';

// Un mercado de barrio inventado: su nombre y sus colores no se parecen a los de ninguna cadena.
const VERDE = '#1f5e3a';
export const D69_STORE = Object.freeze({ x0: 43, x1: 53, z0: 159, z1: 173, height: 5, name: 'Doña Inés' });

export function paintD69Store(map) {
  for (let z = 80; z <= 86; z++) for (let x = 22; x <= 26; x++) map[z][x] = 'storeD69';
}

/** Fachada comercial propia; el acceso principal mira al andén oriental. */
export function buildD69Store({ createSign }) {
  const group = new THREE.Group(); group.name = 'Tienda D69';
  const white = new THREE.MeshStandardMaterial({ color: '#eeeadf', roughness: .85 });
  const red = new THREE.MeshStandardMaterial({ color: VERDE, roughness: .6 });
  const frame = new THREE.MeshStandardMaterial({ color: '#b6bab8', roughness: .45, metalness: .45 });
  const glass = new THREE.MeshStandardMaterial({ color: '#29474c', roughness: .25, metalness: .25 });
  const roof = new THREE.MeshStandardMaterial({ color: '#777a77', roughness: .9 });
  const box = (w, h, d, x, y, z, material, name = '') => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = name; group.add(mesh); return mesh;
  };
  box(10, 5, 14, 48, 2.5, 166, white, 'Edificio D69');
  box(10.12, 1.1, 14.12, 48, 4.4, 166, red, 'Franja roja');
  box(9.8, .12, 13.8, 48, 5.02, 166, roof);
  // Pórticos rojos en las esquinas, sin ocupar la anchura del andén.
  for (const z of [159.3, 172.7]) box(.16, 3.85, .6, 53.06, 1.925, z, red);
  for (const z of [161.8, 166, 170]) {
    box(.12, 2.9, 3.2, 53.05, 1.57, z, frame);
    box(.04, 2.65, 2.95, 53.13, 1.57, z, glass, z === 161.8 ? 'Puertas de vidrio' : 'Vitrina');
    box(.06, 2.7, .055, 53.17, 1.57, z, frame);
    if (z === 161.8) for (const side of [-1, 1]) box(.08, .55, .035, 53.22, 1.5, z + side * .13, frame);
  }
  // Frente lateral visible desde la esquina de la calle.
  box(5.7, 2.9, .1, 48, 1.57, 158.96, frame);
  box(5.45, 2.65, .04, 48, 1.57, 158.89, glass);
  const sign = (x, z, yaw) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3.4, .95),
      new THREE.MeshBasicMaterial({ map: createSign({ title: 'DOÑA INÉS', sub: 'MERCADO DEL BARRIO', bg: VERDE, fg: '#fff3da', border: false, w: 512, h: 160 }) }));
    mesh.position.set(x, 4.4, z); mesh.rotation.y = yaw; group.add(mesh);
  };
  sign(53.13, 162, Math.PI / 2);
  sign(48, 158.87, Math.PI);
  return group;
}
