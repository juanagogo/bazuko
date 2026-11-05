import { Euler, Quaternion } from 'three';

/** La misma transición a 30/60/144 FPS y con las actualizaciones espaciadas de los NPC. */
export const animationDamping = (dt, rate) => -Math.expm1(-Math.max(0, dt) * rate);

/**
 * Movimiento aditivo pequeño, sobre los huesos de UNA instancia. Se retira antes del
 * mezclador para no acumularse en pistas sin keyframes. No toca raíz, pelvis ni piernas:
 * la zancada y los apoyos siguen perteneciendo al clip y al controlador del personaje.
 */
export class SecondaryMotion {
  constructor(bones, phase = 0) {
    const find = (name) => [...bones.values()].find(bone => bone.name.replace(/[^a-z0-9]/gi, '').toLowerCase().endsWith(name));
    this.chest = find('spine2') ?? find('spine1');
    this.head = find('head');
    this.slots = [this.chest, this.head].filter(Boolean).map(bone => ({ bone, base: new Quaternion() }));
    this.time = phase;
    this.motion = 0;
    this.load = 0;
    this.turn = 0;
    this.active = false;
    this.euler = new Euler();
    this.offset = new Quaternion();
  }

  restore() {
    if (!this.active) return;
    for (const { bone, base } of this.slots) bone.quaternion.copy(base);
    this.active = false;
  }

  apply(dt, { speed = 0, load = 0, action = null, phase = 0, turnRate = 0 } = {}) {
    this.restore();
    this.time += dt;
    const k = animationDamping(dt, 6);
    const desiredMotion = Math.min(1, Math.max(0, speed) / 4);
    this.motion += (desiredMotion - this.motion) * k;
    const transfer = desiredMotion - this.motion;
    this.load += (Math.min(1, Math.max(0, load)) - this.load) * k;
    // Un giro rápido produce una torsión breve y limitada; se desvanece al enderezarse.
    // A velocidades bajas se reduce para no desplazar los pies de la pose de reposo.
    const turn = Number.isFinite(turnRate) ? Math.min(1, Math.max(-1, turnRate / 5)) : 0;
    this.turn += (turn * desiredMotion - this.turn) * animationDamping(dt, 10);
    // Los gestos, las acciones de cuerpo entero y su altura original tienen prioridad.
    if (action) return;

    const rest = 1 - this.motion;
    const breath = Math.sin(this.time * 2.05);
    const stride = Math.sin(phase * Math.PI * 2) * this.motion;
    for (const { bone, base } of this.slots) {
      base.copy(bone.quaternion);
      if (bone === this.chest) {
        this.euler.set(
          breath * .012 * rest + this.motion * .024 + this.load * .035 + transfer * .09,
          Math.sin(this.time * .61) * .009 * rest - stride * .018 - this.turn * .075,
          Math.sin(this.time * .79) * .008 * rest + stride * .009 - this.turn * .035
        );
      } else {
        this.euler.set(
          -breath * .008 * rest - this.load * .012 - transfer * .04,
          Math.sin(this.time * .47) * .035 * rest + stride * .009 + this.turn * .045,
          Math.sin(this.time * .67) * .007 * rest - stride * .006 + this.turn * .02
        );
      }
      bone.quaternion.multiply(this.offset.setFromEuler(this.euler));
    }
    this.active = true;
  }
}
