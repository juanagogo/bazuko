import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PropertyBinding } from 'three';
import { createRetargeter } from './retarget.js';
import { ACTIONFORGE_CLIPS } from './actionforge.js';

const PREVIEW_FILE = 'preview/animaciones-mixamo.glb';
export const MIXAMO_PREVIEW_CLIPS = Object.freeze([
  'idle', 'walk', 'run', 'buscar', 'pedir', 'comer', 'beber', 'cagar', 'lanzar', 'saludo', 'dormir'
]);
const REQUIRED_CLIPS = ['idle', 'walk', 'run'];
const REQUIRED_BONES = ['hips', 'leftupleg', 'leftleg', 'leftfoot', 'rightupleg', 'rightleg', 'rightfoot', 'spine', 'leftarm', 'rightarm'];
const boneKey = name => name.replace(/[^a-z0-9]/gi, '').toLowerCase().replace(/^mixamorig/, '');
export const isMixamoProfile = id => id === 'mixamo-preview' || id === 'mixamo-game-preview';

/** La sala elige un perfil explícito. Nunca se aceptan URLs o rutas del navegador. */
export function resolveAnimationProfile(animaciones = 'default', modelBase = '/models/') {
  if (animaciones === 'default') return { id: 'default', url: null };
  if (isMixamoProfile(animaciones)) return { id: animaciones, url: modelBase + PREVIEW_FILE };
  throw new Error(`Perfil de animaciones desconocido: ${animaciones}`);
}

/** Banco de prueba independiente: un fallo no se sustituye por ActionForge. */
export function buildMixamoPreviewClips(body, bank) {
  if (!bank?.scene || !bank.animations?.length) throw new Error('Mixamo preview: el banco no contiene animaciones.');
  const clips = new Map();
  for (const clip of bank.animations) {
    const name = clip.name.toLowerCase();
    if (!MIXAMO_PREVIEW_CLIPS.includes(name)) continue;
    if (clips.has(name)) throw new Error(`Mixamo preview: clip duplicado «${name}».`);
    if (!Number.isFinite(clip.duration) || clip.duration <= 0 || !clip.tracks.length
      || clip.tracks.some(track => ![...track.times, ...track.values].every(Number.isFinite))) {
      throw new Error(`Mixamo preview: clip inválido «${name}».`);
    }
    clips.set(name, clip);
  }
  const missing = REQUIRED_CLIPS.filter(name => !clips.has(name));
  if (missing.length) throw new Error(`Mixamo preview: faltan clips obligatorios: ${missing.join(', ')}.`);

  // El importador GLTF elimina ':' de los nombres Mixamo. Unificar en las copias
  // permite también exportaciones de Blender que conservan o eliminan el prefijo.
  const source = clone(bank.scene), target = clone(body.scene);
  const targetNames = new Map(), sourceNames = new Map(), sourceBoneNames = new Set();
  target.traverse(node => { if (node.isBone) targetNames.set(boneKey(node.name), node.name); });
  source.traverse(node => {
    if (!node.isBone) return;
    sourceBoneNames.add(node.name);
    const key = boneKey(node.name), name = targetNames.get(key);
    if (name) sourceNames.set(node.name, name);
  });
  const sourceKeys = new Set([...sourceNames.keys()].map(boneKey));
  const missingBones = REQUIRED_BONES.filter(name => !sourceKeys.has(name));
  if (missingBones.length) throw new Error(`Mixamo preview: esqueleto incompatible; faltan ${missingBones.join(', ')}.`);
  source.traverse(node => { if (node.isBone && sourceNames.has(node.name)) node.name = sourceNames.get(node.name); });
  const retarget = createRetargeter(source, target, { preserveHipHeight: true, hipSpace: 'world' });
  const result = {};
  for (const [name, original] of clips) {
    const clip = original.clone();
    clip.name = name;
    for (const track of clip.tracks) {
      const binding = PropertyBinding.parseTrackName(track.name);
      const rawName = track.name.slice(0, track.name.lastIndexOf('.'));
      const targetName = sourceNames.get(rawName) ?? sourceNames.get(binding.nodeName)
        ?? (sourceBoneNames.has(rawName) ? rawName : sourceBoneNames.has(binding.nodeName) ? binding.nodeName : null);
      if (!targetName || !['position', 'quaternion', 'scale'].includes(binding.propertyName)) {
        throw new Error(`Mixamo preview: pista incompatible «${track.name}» en ${name}.`);
      }
      track.name = `${targetName}.${binding.propertyName}`;
    }
    result[name] = retarget(clip);
    result[name].userData.source = 'mixamo-preview';
    result[name].userData.loop = typeof original.userData?.loop === 'boolean'
      ? original.userData.loop : ['idle', 'walk', 'run', 'pedir', 'cagar', 'dormir'].includes(name);
  }
  return result;
}

/** Solo la prueba en juego permite estos dos complementos, con fuente explícita. */
export function buildMixamoGameComplements(body, actionforge, existing = {}) {
  const needed = ['comer', 'cagar'].filter(name => !existing[name]);
  if (!needed.length) return {};
  if (!actionforge?.scene) throw new Error('Mixamo en juego: falta el banco complementario ActionForge.');
  const retarget = createRetargeter(clone(actionforge.scene), clone(body.scene), { preserveHipHeight: true, hipSpace: 'world' });
  const result = {};
  for (const name of needed) {
    const clip = actionforge.animations.find(item => item.name === ACTIONFORGE_CLIPS[name]);
    if (!clip) throw new Error(`Mixamo en juego: falta el complemento «${name}» de ActionForge.`);
    result[name] = retarget(clip);
    result[name].name = name;
    result[name].userData.source = 'actionforge';
    result[name].userData.loop = name === 'cagar';
  }
  return result;
}
