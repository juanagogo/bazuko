// src/systems/BusExhaust.js
// Humo negro de las busetas viejas, en una sola malla instanciada y con un presupuesto fijo de partículas.
// El tráfico solo presta sus carros (kind, group, speed y acceleration) y el humo no le añade un dibujo por bus.
import * as THREE from 'three';

export const MAX_PARTICLES = 512;  // tope fijo: la nube nunca pide memoria ni otro dibujo
const OLD_EVERY = 3;               // una de cada tres busetas es vieja
export const PUFF_COUNT = 16;      // bocanada al arrancar
const PUFF_ACCELERATION = 1.1;     // m/s² de subida que dispara la bocanada
const PUFF_SPEED = 3.5;            // pasada esta velocidad ya no es arrancar
const PUFF_COOLDOWN = 1.2;
const SLOW_SPEED = .6;             // por debajo de esto la buseta está arrancando, no subiendo
const LIFE = 3.4;                  // segundos que dura una partícula
const RATE = 5.5;                  // partículas por segundo del hilo sucio
const CRUISE_SHARE = .16;          // lo que suelta yendo parejo
const FULL_ACCELERATION = 1.6;     // aceleración que ya cuenta como subida a tope
const DENSE = 2.2;                 // el hilo de subida, sobre lo que suelta parejo
const MAX_SPEED_STOP = .25;        // parada o casi no humea: el humo es de la combustión al trabajar

// El escape de la buseta, en ejes del carro (frente +X): el tubo que dibuja carModels.js.
const EXHAUST = new THREE.Vector3(-3.72, .58, -.82);

/** ¿Es una buseta vieja? La primera de cada `OLD_EVERY` que aparece lo es, y lo sigue siendo siempre. */
export const isOldBus = (index) => index % OLD_EVERY === 0;

/** Partículas por segundo: arrancando > acelerando > yendo parejo, y nada detenido. */
export function exhaustRate(speed, acceleration) {
  if (!(speed > MAX_SPEED_STOP)) return 0;
  const climb = Math.min(1, Math.max(0, acceleration) / FULL_ACCELERATION);
  return RATE * (CRUISE_SHARE + DENSE * climb);
}

// Cuadro que mira a la cámara en el sombreador: se mueve la instancia, nunca la malla.
const VERTEX = `
  attribute vec3 aCenter;
  attribute vec2 aParam;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
    mv.xy += position.xy * aParam.x;
    gl_Position = projectionMatrix * mv;
    vUv = position.xy + .5;
    vAlpha = aParam.y;
  }
`;
// Hollín cuando está fresco y gris al diluirse, con el borde suave. Sin luz: el humo es negro también de noche.
const FRAGMENT = `
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    float d = length(vUv - .5);
    float a = vAlpha * smoothstep(.5, .16, d);
    if (a <= .002) discard;
    gl_FragColor = vec4(mix(vec3(.30), vec3(.02), min(1., vAlpha * 1.8)), a);
  }
`;

const WIND_PUSH = .35;  // m/s² de empuje por unidad de viento, para que la columna se incline

/** Un dibujo para todas las busetas: el humo se compone de partículas recicladas y se dibuja una sola vez. */
export class BusExhaust {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'Humo de las busetas viejas';
    // Raíz dinámica directa: no participa de la geometría estática de la ciudad.
    scene.add(this.group);

    const geometry = new THREE.InstancedBufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    this.centers = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.params = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aCenter', this.centers);
    geometry.setAttribute('aParam', this.params);
    geometry.instanceCount = 0;
    this.geometry = geometry;

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX, fragmentShader: FRAGMENT, transparent: true, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.name = 'Humo de escape';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.visible = false;
    this.group.add(this.mesh);

    this.particles = Array.from({ length: MAX_PARTICLES }, () => ({
      active: false, age: 0, life: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, radius: 0, grow: 0, alpha: 0
    }));
    this._next = 0;
    this._states = new WeakMap();
    this._busesSeen = 0;
    this._exhaust = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._disposed = false;
  }

  /** Estado por buseta, que muere con ella: si ya humeaba, sigue humeando. */
  _stateOf(car) {
    let state = this._states.get(car);
    if (!state) {
      state = { old: isOldBus(this._busesSeen++), emission: 0, armed: true, cooldown: 0 };
      this._states.set(car, state);
    }
    return state;
  }

  /** Suelta una partícula en el escape; `back` es la dirección trasera de la buseta en el plano. */
  _emit(x, y, z, backX, backZ, puff) {
    const p = this.particles[this._next];
    this._next = (this._next + 1) % this.particles.length;
    const speed = puff ? 1.7 + Math.random() : .45 + Math.random() * .5;
    const spread = puff ? .7 : .2;
    const jitter = puff ? .9 : .4;
    p.active = true; p.age = 0;
    p.life = LIFE * (.7 + Math.random() * .6);
    p.x = x + (Math.random() - .5) * spread;
    p.y = y + (Math.random() - .5) * spread * .6;
    p.z = z + (Math.random() - .5) * spread;
    p.vx = backX * speed + (Math.random() - .5) * jitter;
    p.vz = backZ * speed + (Math.random() - .5) * jitter;
    p.vy = puff ? .3 + Math.random() * .7 : .22 + Math.random() * .3;
    p.radius = (puff ? .8 : .5) * (.55 + Math.random());
    p.grow = (puff ? 3.6 : 3) * (.7 + Math.random() * .6);
    p.alpha = puff ? .62 : .42;
  }

  /**
   * Avanza el humo y lo emite desde cada buseta vieja que se vea. Solo lee la flota que le pasa el juego
   * (car.kind, car.group, speed y acceleration) y el viento del clima; no toca nada del tráfico.
   */
  update(dt, { vehicles = [], camera = null, wind = null } = {}) {
    if (this._disposed) return;
    dt = Number.isFinite(dt) ? Math.min(.1, Math.max(0, dt)) : 0;
    if (dt === 0) return;

    const windX = (wind?.x ?? 0) * WIND_PUSH, windZ = (wind?.y ?? 0) * WIND_PUSH;
    const reach = (this.scene.fog?.far ?? 180) * .95, reachSq = reach * reach;
    // Vista: la posición y hacia dónde mira. Lo que queda detrás de la cámara no gasta partículas.
    let viewX = 0, viewZ = 0, forwardX = 0, forwardZ = 0;
    if (camera) {
      camera.getWorldDirection(this._forward);
      viewX = camera.position.x; viewZ = camera.position.z;
      const flat = Math.hypot(this._forward.x, this._forward.z) || 1;
      forwardX = this._forward.x / flat; forwardZ = this._forward.z / flat;
    }

    for (const vehicle of vehicles) {
      const car = vehicle?.car;
      if (car?.kind !== 'buseta') continue;
      const state = this._stateOf(car);
      if (!state.old) continue;
      const group = car.group;
      const acceleration = vehicle.acceleration;
      const speed = vehicle.speed;
      let visible = !!group && group.visible !== false;
      if (visible && camera) {
        const dx = group.position.x - viewX, dz = group.position.z - viewZ;
        // Fuera de la niebla, o detrás de la cámara con margen para el humo del costado, no se ve el escape.
        visible = dx * dx + dz * dz <= reachSq && forwardX * dx + forwardZ * dz > -8;
      }
      state.cooldown = Math.max(0, state.cooldown - dt);
      if (!visible) {
        // Al volver a la vista arranca limpio: sin la cuenta atrasada ni una bocanada falsa.
        state.emission = 0; state.armed = speed < SLOW_SPEED;
        continue;
      }
      const yaw = group.rotation.y, cos = Math.cos(yaw), sin = Math.sin(yaw);
      const backX = -cos, backZ = sin;
      const p = this._exhaust.set(
        group.position.x + EXHAUST.x * cos + EXHAUST.z * sin,
        group.position.y + EXHAUST.y,
        group.position.z - EXHAUST.x * sin + EXHAUST.z * cos
      );
      // Bocanada al arrancar de un pare o un semáforo, una sola vez por arranque. La aceleración sube de a poco,
      // así que la señal es haber estado lento y pasar el umbral, no un salto entre dos cuadros.
      if (speed < SLOW_SPEED) state.armed = true;
      if (state.armed && state.cooldown === 0 && acceleration >= PUFF_ACCELERATION && speed < PUFF_SPEED) {
        state.armed = false; state.cooldown = PUFF_COOLDOWN;
        for (let i = 0; i < PUFF_COUNT; i++) this._emit(p.x, p.y, p.z, backX, backZ, true);
      }
      state.emission += exhaustRate(speed, acceleration) * dt;
      while (state.emission >= 1) {
        state.emission -= 1;
        this._emit(p.x, p.y, p.z, backX, backZ, false);
      }
    }

    const drag = Math.exp(-1.1 * dt);
    let count = 0;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.age += dt;
      if (p.age >= p.life) { p.active = false; continue; }
      p.vx = p.vx * drag + windX * dt;
      p.vz = p.vz * drag + windZ * dt;
      p.vy = p.vy * drag + .4 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const progress = p.age / p.life;
      this.centers.setXYZ(count, p.x, p.y, p.z);
      this.params.setXY(count, p.radius + p.grow * Math.sqrt(progress),
        p.alpha * (1 - progress) ** 1.5 * Math.min(1, p.age * 6));
      count++;
    }
    this.geometry.instanceCount = count;
    this.mesh.visible = count > 0;
    if (count > 0) this.centers.needsUpdate = this.params.needsUpdate = true;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.group.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
