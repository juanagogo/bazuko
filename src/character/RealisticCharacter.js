// src/character/RealisticCharacter.js
// Personaje realista armado por piezas: cuerpo de MakeHuman/MPFB2 (esqueleto Mixamo) + pelo, barba,
// ropa y calzado exportados por tools/personaje/exportar_variantes.py, con animaciones Mixamo.
// Expone la misma interfaz que createCharacter(): { group, setLook, update }.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { buildCharacterClips } from './actionforge.js';
import { PALETTES } from './look.js';
import { addGrime, addHairTone } from './weathering.js';
import { attachAccessories } from './props.js';
import { addHatClip, hatEdgeProfile } from './hatFit.js';

const BASE = '/models/personaje/';
// Animaciones descargadas de Mixamo (tools/personaje/mixamo_a_glb.py); si no están, las de prueba
const ANIM_URLS = ['/models/animaciones.glb', '/models/animaciones-prueba.glb'];

// El modelo mide ~1,7 m; el mundo usa la escala del personaje procedural (~1,85 m)
export const REALISTIC_SCALE = 1.08;

const ACTIONFORGE_URL = '/models/animaciones-actionforge.glb';

export const REAL_DEFAULT = {
  sexo: 'hombre', edad: 'adulto', pelo: 'desordenado', barba: 'descuidada', ropa: 'chaqueta', calzado: 'tenis-rotos', cabeza: 'sin-sombrero'
};

const loader = new GLTFLoader();
const cache = new Map();
const load = (url) => {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
};

let catalogPromise = null;
/** Catálogo exportado: cuerpos (sexo × edad) y piezas con sus etiquetas. */
export function loadCatalog() {
  catalogPromise ??= fetch(BASE + 'catalogo.json').then((r) => r.json());
  return catalogPromise;
}

// Categorías de piezas; `cabeza` puede faltar en catálogos exportados antes de que existiera
const PART_CATS = ['pelo', 'barba', 'ropa', 'calzado', 'cabeza'];

/** Piezas válidas para un sexo */
export function optionsFor(catalog, cat, sexo) {
  return (catalog.piezas[cat] ?? []).filter((p) => !p.sexo || p.sexo === sexo);
}

/** Corrige una apariencia realista para que todas sus piezas existan en ese cuerpo. */
export function normalizeReal(catalog, raw = {}) {
  const r = { ...REAL_DEFAULT, ...(raw || {}) };
  if (!['hombre', 'mujer'].includes(r.sexo)) r.sexo = REAL_DEFAULT.sexo;
  if (!['joven', 'adulto', 'mayor'].includes(r.edad)) r.edad = REAL_DEFAULT.edad;
  for (const cat of PART_CATS) {
    const opts = optionsFor(catalog, cat, r.sexo);
    if (!opts.some((o) => o.id === r[cat])) r[cat] = opts[0]?.id ?? REAL_DEFAULT[cat];
  }
  if (r.sexo === 'mujer') r.barba = 'ninguna';
  return r;
}

/** Combinación al azar de piezas realistas */
export function randomReal(catalog, base = {}) {
  const any = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const sexo = base.sexo ?? any(['hombre', 'mujer']);
  const pick = (cat) => any(optionsFor(catalog, cat, sexo)).id;
  return normalizeReal(catalog, {
    sexo, edad: any(['joven', 'adulto', 'mayor']),
    pelo: pick('pelo'), barba: Math.random() < 0.3 ? 'ninguna' : pick('barba'), ropa: pick('ropa'), calzado: pick('calzado'),
    cabeza: Math.random() < 0.6 ? REAL_DEFAULT.cabeza : optionsFor(catalog, 'cabeza', sexo).length ? pick('cabeza') : REAL_DEFAULT.cabeza
  });
}

// ---------- animaciones (retargeteadas una vez por cuerpo) ----------

let animsPromise = null;
function loadAnimations() {
  animsPromise ??= (async () => {
    for (const url of ANIM_URLS) {
      try { return await loader.loadAsync(url); } catch { /* probar la siguiente */ }
    }
    throw new Error('No hay animaciones del personaje');
  })();
  return animsPromise;
}

const clipCache = new Map();
let actionforgePromise;
async function clipsForBody(bodyId, bodyGltf) { // bodyId incluye el nivel de detalle
  if (!clipCache.has(bodyId)) {
    clipCache.set(bodyId, (async () => {
      actionforgePromise ??= load(ACTIONFORGE_URL).catch(error => {
        console.warn('No se pudo cargar ActionForge; se usarán las animaciones anteriores.', error);
        return null;
      });
      const [anims, actionforge] = await Promise.all([loadAnimations(), actionforgePromise]);
      return buildCharacterClips(bodyGltf, anims, actionforge);
    })());
  }
  return clipCache.get(bodyId);
}

// ---------- materiales ----------

const HAIR_LIKE = /hair|short0|afro|long0|ponytail|bob0/;
const SOFT_ALPHA = /beard|moustache|eyebrow|eyelash/;

function setupMaterial(mesh, kind) {
  const m = mesh.material = mesh.material.clone();
  const name = mesh.name.toLowerCase();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // las mallas con skin se recortan mal al animar
  if (kind === 'pelo' || HAIR_LIKE.test(name)) {
    m.transparent = false;
    m.alphaTest = 0.08;
    m.side = THREE.DoubleSide;
  } else if (SOFT_ALPHA.test(name)) {
    m.transparent = true;
    m.depthWrite = false;
    m.alphaTest = 0.02;
    m.side = THREE.DoubleSide;
    mesh.renderOrder = 2;
  } else {
    m.transparent = false;
    m.alphaTest = 0;
    m.depthWrite = true;
    if (kind === 'ropa' || kind === 'calzado') {
      // la ropa gana a la piel cuando quedan muy pegadas
      m.polygonOffset = true;
      m.polygonOffsetFactor = -1;
      m.polygonOffsetUnits = -2;
    }
  }
  return m;
}

/** Copia una malla con skin de un archivo de pieza y la ata al esqueleto del cuerpo. */
function attachPart(srcMesh, bones, parent, kind) {
  const mesh = new THREE.SkinnedMesh(srcMesh.geometry, srcMesh.material);
  mesh.name = srcMesh.name;
  const skel = srcMesh.skeleton;
  mesh.bind(new THREE.Skeleton(skel.bones.map((b) => bones.get(b.name)), skel.boneInverses), srcMesh.bindMatrix);
  setupMaterial(mesh, kind);
  parent.add(mesh);
  return mesh;
}

/** Oculta los triángulos del cuerpo tapados por la ropa (vértices originales en `hidden`). */
function hideCovered(bodyMesh, baseIndex, hidden) {
  const src = bodyMesh.geometry;
  const geo = new THREE.BufferGeometry();
  // Esta geometría se libera por instancia: sus buffers no pueden pertenecer al caché.
  for (const [k, v] of Object.entries(src.attributes)) geo.setAttribute(k, v.clone());
  geo.morphAttributes = Object.fromEntries(Object.entries(src.morphAttributes).map(([key, values]) => [key, values.map(v => v.clone())]));
  geo.boundingSphere = src.boundingSphere;
  const vid = src.attributes._vid;
  if (!hidden.size || !vid) {
    geo.setIndex(baseIndex.clone());
  } else {
    const out = [];
    const idx = baseIndex.array;
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      if (hidden.has(Math.round(vid.getX(a))) || hidden.has(Math.round(vid.getX(b))) || hidden.has(Math.round(vid.getX(c)))) continue;
      out.push(a, b, c);
    }
    geo.setIndex(out);
  }
  bodyMesh.geometry = geo;
}

// ---------- instancia ----------

async function buildInstance(catalog, look, lod = false) {
  const real = normalizeReal(catalog, look.real);
  const body = catalog.cuerpos.find((c) => c.sexo === real.sexo && c.edad === real.edad) ?? catalog.cuerpos[0];
  const folder = `${BASE}${body.id}/`;
  // LOD: cuerpo proxy y piezas simplificadas (si el catálogo las trae)
  const useLod = lod && body.piezas[real.ropa]?.lod;
  const bodyGltf = await load(folder + (useLod ? 'lod/cuerpo.gltf' : 'cuerpo.gltf'));
  const parts = PART_CATS
    .map((cat) => ({ cat, info: body.piezas[real[cat]] }))
    .filter((p) => p.info?.file);
  const [clips, ...partGltfs] = await Promise.all([
    clipsForBody(body.id + (useLod ? ':lod' : ''), bodyGltf),
    ...parts.map((p) => load(folder + (useLod && p.info.lod ? p.info.lod : p.info.file)))
  ]);

  const root = cloneSkinned(bodyGltf.scene);
  const bones = new Map();
  let bodyMesh = null;
  root.traverse((o) => {
    if (o.isBone) bones.set(o.name, o);
    if (o.isSkinnedMesh) {
      if (o.name.toLowerCase().includes('body')) bodyMesh = o;
      setupMaterial(o, 'cuerpo');
    }
  });

  const skinTone = new THREE.Color(PALETTES.piel[look.piel] ?? PALETTES.piel[2]).lerp(new THREE.Color(1, 1, 1), 0.25);
  const hairTone = new THREE.Color(PALETTES.pelo[look.peloColor] ?? PALETTES.pelo[0]).lerp(new THREE.Color(1, 1, 1), 0.15);
  const wear = look.desgaste ?? 0;
  const seed = Math.random() * 100;
  if (bodyMesh) {
    bodyMesh.material.color.copy(skinTone);
    addGrime(bodyMesh.material, wear, { skin: true, seed });
  }

  const hidden = new Set();
  const hair = [], hatPositions = [];
  parts.forEach((p, i) => {
    if (!useLod) for (const v of p.info.oculta) hidden.add(v);
    partGltfs[i].scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const mesh = attachPart(o, bones, bodyMesh?.parent ?? root, p.cat);
      if (p.cat === 'pelo' || p.cat === 'barba') {
        mesh.material.color.copy(hairTone);
        addHairTone(mesh.material);
        if (p.cat === 'pelo') hair.push(mesh);
      } else {
        addGrime(mesh.material, wear, { seed });
      }
      if (p.cat === 'cabeza') for (const v of mesh.geometry.attributes.position.array) hatPositions.push(v);
    });
  });
  // el pelo que quedaría por fuera del sombrero se recorta en su borde
  if (hatPositions.length) {
    const profile = hatEdgeProfile(hatPositions);
    for (const mesh of hair) addHatClip(mesh.material, profile);
  }
  // cejas del color del pelo
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !/eyebrow/.test(o.name.toLowerCase())) return;
    o.material.color.copy(hairTone);
    addHairTone(o.material);
  });
  const accessories = useLod ? null : attachAccessories(root, bones, look.accesorios, wear);
  if (bodyMesh) hideCovered(bodyMesh, bodyGltf.scene.getObjectByName(bodyMesh.name)?.geometry.index ?? bodyMesh.geometry.index, hidden);

  const mixer = new THREE.AnimationMixer(root);
  const actions = {};
  for (const [name, clip] of Object.entries(clips)) {
    actions[name] = mixer.clipAction(clip);
    if (['comer', 'beber', 'lanzar', 'saludo'].includes(name)) {
      actions[name].setLoop(THREE.LoopOnce, 1);
      actions[name].clampWhenFinished = true;
    }
    actions[name].play();
    actions[name].setEffectiveWeight(name === 'idle' ? 1 : 0);
  }
  if (useLod) root.traverse((o) => { if (o.isMesh) o.castShadow = false; }); // lejos: sin sombra propia
  return { root, mixer, actions, real, accessories, ownedGeometries: bodyMesh ? [bodyMesh.geometry] : [] };
}

/** Solo recursos de instancia; los modelos y texturas del banco siguen compartidos. */
export function disposeRealisticInstance(instance) {
  if (!instance || instance.disposed) return;
  instance.disposed = true;
  instance.mixer.stopAllAction();
  instance.mixer.uncacheRoot(instance.root);
  const materials = new Set(), skeletons = new Set();
  instance.root.traverse(mesh => {
    if (!mesh.isMesh) return;
    for (const material of [mesh.material].flat()) materials.add(material);
    if (mesh.skeleton) skeletons.add(mesh.skeleton);
  });
  for (const material of materials) material.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of instance.ownedGeometries ?? []) geometry.dispose();
  instance.root.removeFromParent();
}

/**
 * Crea el personaje. `look` es la apariencia compartida con el procedural (nombre, piel, peloColor…)
 * más `look.real` con las piezas realistas.
 */
export async function createRealisticCharacter(look = {}, { lod = false } = {}) {
  const catalog = await loadCatalog();
  const group = new THREE.Group();
  group.scale.setScalar(REALISTIC_SCALE);
  let inst = null;
  let token = 0;
  let disposed = false;
  const weights = {};

  async function setLook(l) {
    if (disposed) return;
    const my = ++token;
    const next = await buildInstance(catalog, l, lod);
    if (my !== token || disposed) { disposeRealisticInstance(next); return; }
    disposeRealisticInstance(inst);
    inst = next;
    group.add(inst.root);
    for (const k of Object.keys(weights)) delete weights[k];
    for (const k of Object.keys(inst.actions)) weights[k] = k === 'idle' ? 1 : 0;
  }

  await setLook(look);

  return {
    group,
    get look() { return look; },
    setLook(l) { look = l; return setLook(l); },
    dispose() {
      if (disposed) return;
      disposed = true; token++;
      disposeRealisticInstance(inst); inst = null;
      group.removeFromParent();
    },
    update(dt, { speed = 0, running = false, action = null } = {}) {
      if (!inst) return;
      const a = inst.actions;
      // destino: acción especial si existe el clip; si no, idle / caminar / correr según la velocidad
      let target = speed < 0.15 ? 'idle' : running && a.run ? 'run' : 'walk';
      if (action && speed < 0.15) {
        if (a[action]) target = action;
        else if (action === 'cagar' && a.buscar) target = 'buscar';
        else if (action === 'lanzar' && a.pedir) target = 'pedir';
      }
      if (inst?.root) {
        const targetY = action === 'cagar' && !a.cagar ? -0.3 : 0;
        inst.root.position.y += (targetY - inst.root.position.y) * Math.min(1, dt * 10);
      }
      if (!a[target]) target = 'idle';
      if (target !== inst.previousTarget) {
        if (a[target] && !['idle', 'walk', 'run'].includes(target)) a[target].reset().play();
        inst.previousTarget = target;
      }
      const k = Math.min(1, dt * 8);
      for (const key of Object.keys(a)) {
        weights[key] += ((key === target ? 1 : 0) - weights[key]) * k;
        if (key !== target && weights[key] < .001) weights[key] = 0;
        a[key].enabled = weights[key] > 0 || key === target;
        a[key].setEffectiveWeight(weights[key]);
      }
      if (a.walk) a.walk.timeScale = THREE.MathUtils.clamp(speed / 1.4, 0.6, 1.6);
      if (a.run) a.run.timeScale = THREE.MathUtils.clamp(speed / 3.5, 0.7, 1.4);
      inst.mixer.update(dt);
      inst.accessories?.update();
    }
  };
}
