/** Metros del mundo: position.y representa los pies de un personaje de 1,8 m. */
export const WATER_MOVEMENT = Object.freeze({
  bodyHeight: 1.8, floatDepth: 1.05, swimEnterDepth: 1.25, swimExitDepth: 1.10,
  swimContactDepth: .85, walkContactDepth: .015, swimSpeed: 1.65, fastSwimSpeed: 2.6,
  sprintEnergyPerSecond: .9, sprintEnergyReserve: 8, gravity: 17,
  buoyancyFrequency: 5.5, maxEntryFallSpeed: 3, maxRiseSpeed: 2.5
});

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

/**
 * Movimiento vertical del agua, independiente de THREE, DOM y necesidades.
 * Integración: después de resolver XZ y consultar el suelo, ANTES de gravedad.
 * Si handlesVertical es true, aplicar feetY/verticalVelocity/grounded y omitir
 * la gravedad normal. En otro caso, conservar salto y apoyo habituales.
 * El objeto frame se reutiliza; entered/exited son eventos de un solo update.
 */
export class WaterMovement {
  constructor() {
    this.frame = {};
    this.reset();
  }

  reset() {
    this.state = 'dry';
    this.depth = 0;
    this.swimBlend = 0;
    Object.assign(this.frame, {
      state: 'dry', inWater: false, swimming: false, wading: false,
      entered: false, exited: false, startedSwimming: false, stoppedSwimming: false,
      entryIntensity: 0, intensity: 0, immersion: 0, swimBlend: 0, depth: 0,
      surfaceY: null, bottomY: null, handlesVertical: false, feetY: 0,
      verticalVelocity: 0, grounded: true, energyDrain: 0, acceleration: null
    });
    return this.frame;
  }

  get swimming() { return this.state === 'swimming'; }
  get inWater() { return this.state !== 'dry'; }

  getSpeed({ walkSpeed = 3, runSpeed = 6, moving = true, running = false, energy = 100 } = {}) {
    if (!moving) return 0;
    if (this.swimming) {
      // La fatiga quita el sprint, nunca la posibilidad de alcanzar la orilla.
      return running && energy > WATER_MOVEMENT.sprintEnergyReserve
        ? WATER_MOVEMENT.fastSwimSpeed : WATER_MOVEMENT.swimSpeed;
    }
    const speed = running ? runSpeed : walkSpeed;
    if (!this.inWater) return speed;
    return Math.max(Math.min(speed, 1.4), speed * (1 - .45 * clamp(this.depth / WATER_MOVEMENT.swimEnterDepth, 0, 1)));
  }

  update(dt, {
    water = null, feetY = 0, verticalVelocity = 0, grounded = false,
    groundY = 0, surfaceLayer = 'ground', moving = false, running = false,
    energy = 100, speed = 0
  } = {}) {
    dt = clamp(finite(dt, 0), 0, .1);
    feetY = finite(feetY, 0);
    verticalVelocity = finite(verticalVelocity, 0);
    const previous = this.state;
    const validWater = water && Number.isFinite(water.surfaceY) && Number.isFinite(water.bottomY) &&
      Number.isFinite(water.depth) && water.depth > WATER_MOVEMENT.walkContactDepth && water.bottomY < water.surfaceY;
    const surfaceY = validWater ? water.surfaceY : null;
    const depth = validWater ? Math.min(water.depth, water.surfaceY - water.bottomY) : 0;
    const bottomY = validWater ? water.bottomY : null;
    const supportedAbove = validWater && grounded && surfaceLayer !== 'ground' &&
      groundY > surfaceY + .1 && feetY >= groundY - .2;
    const contact = validWater && !supportedAbove && feetY <= surfaceY - WATER_MOVEMENT.walkContactDepth;
    const enoughDepth = depth >= (previous === 'swimming' ? WATER_MOVEMENT.swimExitDepth : WATER_MOVEMENT.swimEnterDepth);
    const contactY = surfaceY - WATER_MOVEMENT.swimContactDepth;
    // Detectar una caída que cruzaría el nivel de nado en este cuadro evita
    // atravesar el lago por un frame largo, sin atraer saltos que lo sobrevuelan.
    const predictedY = feetY + (verticalVelocity - WATER_MOVEMENT.gravity * dt) * dt;
    const crossing = validWater && !supportedAbove && !grounded && verticalVelocity <= 0 &&
      feetY > contactY && predictedY <= contactY;
    const submerged = contact && (feetY <= contactY || previous === 'swimming');
    const swimming = enoughDepth && (submerged || crossing);
    this.state = swimming ? 'swimming' : contact ? 'wading' : 'dry';
    this.depth = this.inWater ? depth : 0;
    let resultY = feetY, resultVelocity = verticalVelocity;

    if (swimming) {
      let waterTime = dt;
      if (crossing) {
        const g = WATER_MOVEMENT.gravity;
        const untilContact = clamp((verticalVelocity + Math.sqrt(verticalVelocity ** 2 + 4 * g * (feetY - contactY))) / (2 * g), 0, dt);
        resultY = contactY;
        resultVelocity -= g * untilContact;
        waterTime -= untilContact;
      }
      resultVelocity = clamp(resultVelocity, -WATER_MOVEMENT.maxEntryFallSpeed, WATER_MOVEMENT.maxRiseSpeed);
      const target = Math.max(bottomY, surfaceY - WATER_MOVEMENT.floatDepth);
      const omega = WATER_MOVEMENT.buoyancyFrequency;
      // Solución analítica del resorte críticamente amortiguado: estable para
      // cualquier dt admitido y sin oscilaciones que sumerjan la cabeza al parar.
      const offset = resultY - target;
      const c = resultVelocity + omega * offset;
      const decay = Math.exp(-omega * waterTime);
      const nextY = target + (offset + c * waterTime) * decay;
      resultY += clamp(nextY - resultY, -WATER_MOVEMENT.maxEntryFallSpeed * waterTime, WATER_MOVEMENT.maxRiseSpeed * waterTime);
      resultVelocity = clamp((resultVelocity - omega * c * waterTime) * decay,
        -WATER_MOVEMENT.maxEntryFallSpeed, WATER_MOVEMENT.maxRiseSpeed);
      if (resultY < bottomY) { resultY = bottomY; resultVelocity = Math.max(0, resultVelocity); }
    }

    const inWater = this.inWater;
    const entered = previous === 'dry' && inWater;
    const fast = swimming && moving && running && energy > WATER_MOVEMENT.sprintEnergyReserve;
    this.swimBlend += ((swimming ? 1 : 0) - this.swimBlend) * (1 - Math.exp(-8 * dt));
    Object.assign(this.frame, {
      state: this.state, inWater, swimming, wading: this.state === 'wading',
      entered, exited: previous !== 'dry' && !inWater,
      startedSwimming: swimming && previous !== 'swimming', stoppedSwimming: !swimming && previous === 'swimming',
      entryIntensity: entered ? clamp(Math.abs(verticalVelocity) / 9 + .15, .15, 1) : 0,
      intensity: inWater ? clamp(Math.abs(finite(speed, 0)) / WATER_MOVEMENT.fastSwimSpeed, 0, 1) : 0,
      immersion: inWater ? clamp((surfaceY - resultY) / WATER_MOVEMENT.bodyHeight, 0, 1) : 0,
      swimBlend: this.swimBlend, depth: this.depth, surfaceY: inWater ? surfaceY : null, bottomY: inWater ? bottomY : null,
      handlesVertical: swimming, feetY: resultY, verticalVelocity: resultVelocity,
      grounded: swimming ? false : grounded,
      energyDrain: fast ? Math.min(WATER_MOVEMENT.sprintEnergyPerSecond * dt, energy - WATER_MOVEMENT.sprintEnergyReserve) : 0,
      acceleration: swimming ? (moving ? 5 : 4) : null
    });
    return this.frame;
  }
}
