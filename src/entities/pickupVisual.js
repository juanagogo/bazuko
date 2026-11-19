import * as THREE from 'three';
import { withVisualRandom } from '../world/bogota/VisualRandom.js';
import { unit } from '../world/bogota/StreetBatch.js';
import { materialCarton, trozoCarton } from './cambuche/carton.js';
import { Piezas } from './puestoPiezas.js';

const point = new THREE.Vector3();
const supplies = new Map();

/** El vértice más próximo al pavimento da el apoyo, tanto en el GLB como antes de cargarlo. */
export function restOnPickupGround(model, floor, referenceY) {
  model.updateWorldMatrix(true, true);
  let lift = -Infinity;
  model.traverse(object => {
    const positions = object.geometry?.attributes.position;
    if (!positions) return;
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      const ground = floor(point.x, point.z, referenceY);
      if (Number.isFinite(ground)) lift = Math.max(lift, ground - point.y);
    }
  });
  if (Number.isFinite(lift)) model.position.y += lift;
}

function can() {
  const pieces = new Piezas(), silver = '#a6afb2', rim = '#c1bbb1';
  pieces.en([0, 0, 0], [Math.PI / 2, 0, 0], () => {
    pieces.tubo(.038, .038, .092, 12, '#456f66', [0, 0, 0], undefined, true);
    pieces.tubo(.0386, .0386, .018, 12, '#789489', [0, -.029, 0], undefined, true);
    pieces.tubo(.034, .038, .009, 12, silver, [0, -.050, 0]);
    pieces.tubo(.037, .038, .010, 12, silver, [0, .049, 0]);
    pieces.pieza(new THREE.TorusGeometry(.031, .003, 4, 12), rim, [0, .055, 0], [Math.PI / 2, 0, 0]);
    pieces.disco(.010, 8, '#343638', [.009, .055, 0], [.65, 1]);
    pieces.pieza(new THREE.TorusGeometry(.006, .0016, 4, 8), rim, [-.009, .057, 0], [Math.PI / 2, 0, .3], [1, .68, 1]);
  });
  return pieces.malla(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .51, metalness: .23 }));
}

function wood() {
  const pieces = new Piezas(), outline = new THREE.Shape();
  outline.moveTo(-.22, -.045);
  outline.lineTo(.13, -.048);
  outline.lineTo(.215, -.031);
  outline.lineTo(.16, -.018);
  outline.lineTo(.20, .035);
  outline.lineTo(-.192, .052);
  outline.lineTo(-.23, .025);
  outline.closePath();
  const board = new THREE.ExtrudeGeometry(outline, { depth: .024, bevelEnabled: false }).rotateX(-Math.PI / 2);
  pieces.pieza(board, '#86674d');
  pieces.caja(.245, .0008, .003, '#a08364', [-.034, .0242, .030]);
  pieces.caja(.307, .0008, .004, '#5b4737', [-.036, .0242, -.012]);
  pieces.caja(.16, .0008, .002, '#9b7756', [.005, .0242, -.030]);
  pieces.disco(.005, 6, '#53493d', [-.148, .0248, .017]);
  return pieces.malla(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93 }));
}

const visuals = {
  carton: () => new THREE.Mesh(trozoCarton(), materialCarton()),
  lata: can,
  madera: wood
};

export function pickupSupplyKind(items) {
  return items.find(id => Object.hasOwn(visuals, id));
}

export function makePickupSupply(kind) {
  return withVisualRandom(() => {
    if (!supplies.has(kind)) supplies.set(kind, visuals[kind]());
    const { geometry, material } = supplies.get(kind);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = kind;
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  });
}

/** Una pieza junto a la bolsa; el lado depende del lugar. */
export function placePickupSupply(mesh, position, floor) {
  const { x, y, z } = position;
  const angle = unit(x * 100, z * 100, 14) * Math.PI * 2;
  mesh.position.set(Math.sin(angle) * .6, 0, Math.cos(angle) * .6);
  mesh.rotation.y = angle + .35;
  restOnPickupGround(mesh, floor, y);
}
