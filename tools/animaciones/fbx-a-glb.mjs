// Convierte las animaciones de combate de Mixamo (.fbx) a .glb, el formato que el juego carga.
//   node tools/animaciones/fbx-a-glb.mjs [archivo.fbx ...]
// Sin argumentos convierte las de COMBAT_FBX. Cada .glb conserva el esqueleto (nombres, reposo y
// jerarquía) y la toma tal como la entrega FBXLoader; no reduce ni remuestrea claves. Un triángulo
// pesado a la cadera deja la piel para que GLTFLoader devuelva huesos y el retarget los encuentre.
// Así el navegador no descomprime ni interpreta FBX al cargar y la descarga baja a una fracción.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { esPrincipal } from '../esPrincipal.mjs';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

export const COMBAT_FBX = [
  'center-block', 'fallingdown', 'combat-jab-cross', 'combat-hit-head', 'combat-hit-body', 'combat-taunt',
  'assault-hook', 'assault-kick', 'assault-hit-react', 'assault-knockdown', 'assault-get-up'
];

// GLTFExporter lee el binario con FileReader, que Node no trae.
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(buffer => { this.result = buffer; this.onloadend?.(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onloadend?.(); }); }
};

export function parseFbx(bytes) {
  return new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

export async function fbxToGlb(bytes) {
  const group = parseFbx(bytes);
  const bones = [];
  group.traverse(object => { if (object.isBone) bones.push(object); });
  if (!bones.length || !group.animations.length) throw new Error('El FBX no trae esqueleto ni animación.');
  group.traverse(object => { if (object.isMesh) object.removeFromParent(); });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, .01, 0, 0, 0, .01, 0], 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  const skin = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  skin.name = 'esqueleto';
  group.add(skin);
  group.updateMatrixWorld(true);
  skin.bind(new THREE.Skeleton(bones), skin.matrixWorld);
  const glb = await new GLTFExporter().parseAsync(group, { binary: true, animations: group.animations });
  return Buffer.from(glb);
}

if (esPrincipal(import.meta.url)) {
  const files = process.argv.length > 2 ? process.argv.slice(2) : COMBAT_FBX.map(name => `public/models/${name}.fbx`);
  for (const file of files) {
    const bytes = readFileSync(file);
    const glb = await fbxToGlb(bytes);
    const out = file.replace(/\.fbx$/i, '.glb');
    writeFileSync(out, glb);
    console.log(`${basename(file)} ${(bytes.length / 1024).toFixed(0)} KB → ${basename(out)} ${(glb.length / 1024).toFixed(0)} KB`);
  }
}
