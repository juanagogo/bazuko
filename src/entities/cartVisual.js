import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function surfaceTexture(kind) {
  if (!globalThis.document?.createElement) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  const ctx = canvas.getContext?.('2d');
  if (!ctx) return null;
  let state = 173;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  ctx.fillStyle = kind === 'wood' ? '#968678' : kind === 'cloth' ? '#b19b72' : '#55504a';
  ctx.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 850; i++) {
    const x = random() * 256, y = random() * 128;
    ctx.strokeStyle = random() < .5 ? 'rgba(38,29,22,.18)' : 'rgba(238,222,193,.17)';
    ctx.lineWidth = random() * 1.2 + .3;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + (kind === 'wood' ? 25 + random() * 100 : random() * 5), y + random() * 2);
    ctx.stroke();
  }
  if (kind === 'wood') {
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = 'rgba(33,26,19,.34)';
      ctx.beginPath(); ctx.ellipse(random() * 256, random() * 128, 8 + random() * 15, 1.7, 0, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (kind === 'cloth') {
    ctx.strokeStyle = 'rgba(60,43,25,.2)'; ctx.lineWidth = .6;
    for (let i = 0; i < 256; i += 4) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke(); }
    for (let i = 0; i < 128; i += 4) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke(); }
  } else {
    for (let i = 0; i < 65; i++) {
      ctx.fillStyle = `rgba(143,71,35,${.1 + random() * .35})`;
      ctx.beginPath(); ctx.arc(random() * 256, random() * 128, 2 + random() * 11, 0, Math.PI * 2); ctx.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 2;
  texture.name = `carreta-${kind}`;
  return texture;
}

/** Solo apariencia: la posición, acople, carga y animación los sigue controlando Cart. */
export function createCartVisual(root) {
  const woodMap = surfaceTexture('wood'), clothMap = surfaceTexture('cloth'), metalMap = surfaceTexture('metal');
  const material = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .93, ...options });
  const wood = [0xb4a799, 0x8e7b65, 0xa89a83, 0x746d61].map(color => material(color, { map: woodMap }));
  const green = material(0x6e8069, { map: woodMap });
  const iron = material(0x56514a, { map: metalMap, metalness: .35, roughness: .85 });
  const rim = material(0x9b978a, { map: metalMap, metalness: .55, roughness: .78 });
  const rubber = material(0x292c2a), dark = material(0x3b352c);
  const cardboard = [material(0xb3935c), material(0x9c7b49), material(0xc5ab77)];
  const rope = material(0xbaa77e), sack = material(0xc7b38a, { map: clothMap });
  const cloth = material(0x71807c, { map: clothMap, side: THREE.DoubleSide });
  const glass = [material(0x71917d), material(0x94b7b5), material(0x54785a)];
  const cap = material(0xb45e44), label = material(0xddd5b2);
  const batches = new Map();

  // Cada pieza aporta su transformación a un lote por material.
  function part(geometry, mat, position = [0, 0, 0], rotation = [0, 0, 0], target = batches) {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)), new THREE.Vector3(1, 1, 1));
    geometry.applyMatrix4(matrix);
    if (!target.has(mat)) target.set(mat, []);
    target.get(mat).push(geometry);
  }
  const box = (w, h, d, mat, x, y, z, rotation = [0, 0, 0], target = batches) =>
    part(new THREE.BoxGeometry(w, h, d), mat, [x, y, z], rotation, target);
  function rod(from, to, radius, mat, target = batches) {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), delta = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 6);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
    part(geometry, mat, a.add(b).multiplyScalar(.5).toArray(), [0, 0, 0], target);
  }
  function cord(points, radius = .012) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
    part(new THREE.TubeGeometry(curve, 16, radius, 4, false), rope);
  }
  function finish(target, parent, name) {
    for (const [mat, geometries] of target) {
      // Unificar los atributos permite mezclar cajas, cilindros y superficies de tela.
      const plain = geometries.map(g => g.index ? g.toNonIndexed() : g.clone());
      const geometry = mergeGeometries(plain, false);
      for (const g of [...geometries, ...plain]) g.dispose();
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.name = name;
      mesh.castShadow = mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }

  // Plataforma y tablones separados, con reparaciones y pintura verde envejecida.
  for (let i = 0; i < 6; i++) box(.18, .065, 1.67, wood[i % 4], -.47 + i * .188, .43, 0);
  for (const side of [-1, 1]) {
    box(.055, .075, 1.72, iron, side * .43, .365, 0);
    for (let row = 0; row < 3; row++) {
      box(.045, .145, 1.67, row === 1 && side === 1 ? green : wood[(row + (side === 1 ? 1 : 0)) % 4], side * .555, .56 + row * .16, 0, [row % 2 ? .008 : -.008, 0, 0]);
    }
    for (const z of [-.78, 0, .78]) {
      box(.06, .59, .055, iron, side * .588, .72, z);
      for (const y of [.55, .72, .89]) {
        part(new THREE.SphereGeometry(.012, 6, 4), rim, [side * .623, y, z]);
      }
    }
    box(.016, .1, .38, green, side * .584, .63, .30, [.15 * side, 0, 0]);
  }
  for (const z of [-.825, .825]) for (let row = 0; row < 3; row++) {
    box(1.12, .145, .045, wood[(row + 1) % 4], 0, .56 + row * .16, z, [0, 0, row % 2 ? .006 : -.006]);
  }
  for (const x of [-.51, .51]) box(.07, .6, .05, iron, x, .72, .86);
  for (const z of [-.64, .64]) box(1.14, .06, .065, iron, 0, .36, z);
  rod([-.66, .32, 0], [.66, .32, 0], .038, iron);

  // Conserva el agarre a la misma altura y distancia del modelo original.
  for (const side of [-1, 1]) {
    rod([side * .45, .43, -.65], [side * .45, .94, -.92], .024, iron);
    rod([side * .52, .45, -.72], [side * .45, .8, -.86], .016, iron);
    rod([side * .29, .94, -.92], [side * .47, .94, -.92], .035, dark);
    for (let i = 0; i < 5; i++) {
      rod([side * (.3 + i * .035), .94, -.92], [side * (.315 + i * .035), .94, -.92], .037, rope);
    }
  }
  rod([-.49, .94, -.92], [.49, .94, -.92], .026, iron);

  // Cartón aplanado en capas y sujeto con dos vueltas de cuerda.
  for (let i = 0; i < 8; i++) {
    box(.67 + (i % 3) * .025, .022, .68 - (i % 2) * .04, cardboard[i % 3], -.12 + (i % 2) * .018, .94 + i * .026, .24, [0, (i % 3 - 1) * .035, 0]);
    box(.65, .006, .008, dark, -.12, .94 + i * .026, .585);
  }
  for (const x of [-.32, .08]) cord([[x, .93, -.12], [x, 1.13, -.12], [x, 1.145, -.06],
    [x, 1.145, .2], [x, 1.145, .55], [x, 1.13, .60], [x, .93, .61]]);

  // Botellas y latas reconocibles por encima del borde; no son objetos interactivos nuevos.
  for (let i = 0; i < 4; i++) {
    const x = .29 + (i % 2) * .13, z = -.38 + Math.floor(i / 2) * .20;
    const bottle = new THREE.Group();
    const bottleParts = new Map();
    part(new THREE.CylinderGeometry(.065, .075, .22, 10), glass[i % 3], [0, .11, 0], [0, 0, 0], bottleParts);
    part(new THREE.CylinderGeometry(.028, .065, .06, 10), glass[i % 3], [0, .25, 0], [0, 0, 0], bottleParts);
    part(new THREE.CylinderGeometry(.028, .028, .07, 10), glass[i % 3], [0, .315, 0], [0, 0, 0], bottleParts);
    part(new THREE.CylinderGeometry(.033, .033, .025, 10), cap, [0, .36, 0], [0, 0, 0], bottleParts);
    part(new THREE.CylinderGeometry(.077, .077, .07, 10), label, [0, .13, 0], [0, 0, 0], bottleParts);
    bottle.position.set(x, .90, z); bottle.rotation.set(.1 * i, 0, (i % 2 ? -.12 : .13));
    bottle.updateMatrix();
    for (const [mat, geometries] of bottleParts) for (const geometry of geometries) {
      geometry.applyMatrix4(bottle.matrix);
      if (!batches.has(mat)) batches.set(mat, []);
      batches.get(mat).push(geometry);
    }
  }
  for (let i = 0; i < 3; i++) part(new THREE.CylinderGeometry(.075, .065, .13, 10), rim, [-.32 + i * .13, .98, -.48], [.25, 0, .2 * i]);

  // Costal lateral: volumen irregular, cuello recogido y tirantes de cuerda.
  const sackGeometry = new THREE.SphereGeometry(1, 12, 10);
  const vertices = sackGeometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const y = vertices.getY(i), gather = y > .5 ? 1 - (y - .5) * 1.4 : 1;
    vertices.setXYZ(i, vertices.getX(i) * .18 * gather, y * .25, vertices.getZ(i) * .17 * gather);
  }
  sackGeometry.computeVertexNormals();
  part(sackGeometry, sack, [-.66, .71, .29]);
  part(new THREE.TorusGeometry(.045, .014, 5, 12), rope, [-.66, .92, .29], [Math.PI / 2, 0, 0]);
  cord([[-.66, .93, .29], [-.59, 1.02, .16], [-.54, 1.0, .12]]);
  cord([[-.66, .93, .29], [-.60, 1.02, .4], [-.54, 1.0, .43]]);

  // Tela plegada sobre el borde opuesto, con caída y arrugas suaves.
  const drape = new THREE.PlaneGeometry(1, 1, 12, 10);
  const v = drape.attributes.position;
  for (let i = 0; i < v.count; i++) {
    const u = v.getX(i) + .5, t = v.getY(i) + .5;
    v.setXYZ(i, .22 + u * .52, 1.0 - Math.max(0, u - .62) * .93 + Math.sin(t * 20 + u * 5) * .015, -.13 + t * .65);
  }
  drape.computeVertexNormals();
  part(drape, cloth);
  finish(batches, root, 'carreta-estructura-carga');

  // Ruedas completas sobre grupos que conservan el eje X de la animación existente.
  function wheel(side) {
    const group = new THREE.Group(), wheelBatches = new Map();
    group.name = side < 0 ? 'rueda-izquierda' : 'rueda-derecha';
    group.position.set(side * .65, .32, 0);
    part(new THREE.TorusGeometry(.245, .065, 8, 24), rubber, [0, 0, 0], [0, Math.PI / 2, 0], wheelBatches);
    part(new THREE.CylinderGeometry(.21, .21, .11, 20), rim, [0, 0, 0], [0, 0, Math.PI / 2], wheelBatches);
    part(new THREE.CylinderGeometry(.145, .145, .116, 16), dark, [0, 0, 0], [0, 0, Math.PI / 2], wheelBatches);
    part(new THREE.CylinderGeometry(.065, .065, .17, 12), rim, [0, 0, 0], [0, 0, Math.PI / 2], wheelBatches);
    for (let i = 0; i < 20; i++) {
      const a = i * Math.PI / 10;
      box(.1, .018, .048, rubber, 0, Math.cos(a) * .303, Math.sin(a) * .303, [a, 0, .15 * (i % 2 ? 1 : -1)], wheelBatches);
    }
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 2 / 5;
      part(new THREE.CylinderGeometry(.014, .014, .014, 6), rim, [side * .09, Math.cos(a) * .1, Math.sin(a) * .1], [0, 0, Math.PI / 2], wheelBatches);
    }
    finish(wheelBatches, group, 'carreta-neumatico-llanta');
    root.add(group);
    return group;
  }
  const leftWheel = wheel(-1), rightWheel = wheel(1);
  const kickstand = new THREE.Mesh(new THREE.BoxGeometry(.065, .4, .065), iron);
  kickstand.position.set(0, .20, .72);
  kickstand.castShadow = true; root.add(kickstand);
  let disposed = false;
  return { leftWheel, rightWheel, kickstand, _disposeVisual() {
    if (disposed) return;
    disposed = true;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    root.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.material) materials.add(o.material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const mat of materials) { if (mat.map) textures.add(mat.map); mat.dispose(); }
    for (const texture of textures) texture.dispose();
  } };
}
