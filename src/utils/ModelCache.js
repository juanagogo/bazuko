// src/utils/ModelCache.js
// Carga GLB una sola vez (promesa cacheada) y entrega clones que
// comparten geometrías/materiales/texturas.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const cache = new Map(); // nombre -> Promise<THREE.Object3D|null>

// Versión optimizada (texturas reducidas / malla simplificada) en public/models/*.opt.glb.
// Si no existe se usa el original.
const OPT = {
  'bolsa.glb': 'bolsa.opt.glb',
  'vagabundo2.glb': 'vagabundo2.opt.glb',
  'lampara.glb': 'lamparas.opt.glb',
  'cambuche.glb': 'cambuche.opt.glb',
  'estacion.glb': 'estacion.opt.glb', // 35 MB / 864k tris -> ~1.4 MB / 22k tris
  'car1.glb': 'car1.opt.glb', // 28 MB / 746k tris -> 0.75 MB / 12k tris (el original queda en src/assets)
  'car2.glb': 'car2.opt.glb', // 22 MB / 477k tris -> 0.8 MB / 9.5k tris
  'semaforo.glb': 'semaforo.opt.glb', // 11 MB / 177k tris -> 0.33 MB / 3.5k tris
  'tm.glb': 'tm.opt.glb', // 16 MB / 275k tris -> ~1 MB / 16k tris (el original queda en src/assets, no en public)
  'contenedor.glb': 'contenedor.opt.glb' // 20.4 MB / 461k tris -> 1.1 MB / 18.6k tris (original en src/assets/CONTENEDOR.glb)
};

// Progreso de precarga: fracción por modelo (bytes si hay total; 1 al terminar)
const progress = new Map(); // nombre -> 0..1
let progressCb = null;
function report(name, f) {
  progress.set(name, Math.max(progress.get(name) || 0, f));
  if (!progressCb) return;
  let sum = 0;
  for (const v of progress.values()) sum += v;
  progressCb(sum / progress.size);
}

function loadGLTF(file, name) {
  const url = `${import.meta.env.BASE_URL}models/${file}`;
  return new Promise((resolve) => {
    const onProg = name && ((e) => {
      if (e.lengthComputable && e.total) report(name, Math.min(0.98, e.loaded / e.total));
    });
    new GLTFLoader().load(url, resolve, onProg, (err) => {
      console.warn(`[ModelCache] No se pudo cargar ${url}`, err);
      resolve(null);
    });
  });
}

/** GLTF crudo (con animaciones) de models/<name>, versión optimizada si existe. Cacheado. */
export function loadGLTFCached(name) {
  const key = `gltf:${name}`;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    const opt = OPT[name];
    const r = (opt && (await loadGLTF(opt, name))) || (await loadGLTF(name, name));
    report(name, 1);
    return r;
  })();
  cache.set(key, p);
  return p;
}

/**
 * Carga (una vez) models/<name> y devuelve una promesa con la escena base,
 * ya normalizada: base en y=0, centrada en XZ y con la dimensión mayor = targetSize.
 * opts.fit = 'height' usa la altura (Y) como dimensión a escalar.
 * opts.anchor = 'bottom' deja el centro XZ del tercio inferior (el poste) en el origen.
 * Resuelve null si falla (el llamador conserva su fallback procedural).
 */
export function loadModel(name, targetSize = 1, opts = {}) {
  const key = `${name}@${targetSize}@${opts.fit || 'max'}`;
  if (cache.has(key)) return cache.get(key);

  const p = loadGLTFCached(name).then((gltf) => {
    if (!gltf) return null;
    const src = gltf.scene;
    src.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.userData.sharedAsset = true;
      }
    });
    const box = new THREE.Box3().setFromObject(src);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const ref = opts.fit === 'height' ? size.y : Math.max(size.x, size.y, size.z);
    const s = targetSize / (ref || 1);
    const wrapper = new THREE.Group();
    src.scale.multiplyScalar(s);
    const cx = opts.centerX ?? center.x;
    const cz = opts.centerZ ?? center.z;
    src.position.set(-cx * s, -box.min.y * s, -cz * s);
    wrapper.add(src);
    return wrapper;
  });
  cache.set(key, p);
  return p;
}

/** Precarga en segundo plano (no bloquea): útil para que luego sea instantáneo. */
export function preloadModels(names, onProgress) {
  progressCb = onProgress || null;
  for (const n of names) if (!progress.has(n)) progress.set(n, 0);
  return Promise.all(names.map((n) => loadGLTFCached(n)));
}

/** Clon que comparte geometrías y materiales con el original. */
export function cloneModel(base) {
  return base.clone(true);
}
