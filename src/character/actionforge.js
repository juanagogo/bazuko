import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createRetargeter } from './retarget.js';

export const ACTIONFORGE_CLIPS = {
  idle: 'idle_loop_fit', walk: 'walk_loop_fit', run: 'sprint_loop_fit',
  buscar: 'fixing_kneeling_fit', pedir: 'idle_talking_loop_fit',
  comer: 'consume_fit', beber: 'consume_fit', cagar: 'crouch_idle_loop_fit',
  lanzar: 'overhandthrow_fit'
};

// Cada cuerpo recibe sus propios clips. Ropa y texturas siguen siendo las del juego.
export function buildCharacterClips(body, legacy, actionforge = null) {
  const out = {};
  if (actionforge) {
    const retarget = createRetargeter(actionforge.scene, clone(body.scene), { preserveHipHeight: true });
    const converted = new Map();
    for (const [action, name] of Object.entries(ACTIONFORGE_CLIPS)) {
      const source = actionforge.animations.find(c => c.name === name);
      if (!source) continue;
      if (!converted.has(name)) converted.set(name, retarget(source));
      out[action] = converted.get(name).clone();
      out[action].name = action;
    }
  }
  if (!legacy) return out;
  const retarget = createRetargeter(legacy.scene, clone(body.scene));
  for (const name of ['idle', 'walk', 'run', 'buscar', 'pedir', 'comer', 'dormir', 'saludo']) {
    if (out[name]) continue;
    const source = legacy.animations.find(c => c.name.toLowerCase() === name);
    if (source) out[name] = retarget(source);
  }
  return out;
}
