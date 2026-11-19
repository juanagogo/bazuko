import * as THREE from 'three';
import { GRAPHICS_PROFILES } from './GraphicsQuality.js';
import { criticalSpring, followSpring, snapSpring, spring } from '../character/springs.js';
import { hardDip, hardLanding, landingDepth, landingDrop, smoothstep } from '../character/jumpMotion.js';
import { prefiereMovimientoReducido } from '../utils/movimientoReducido.js';

// Brazo de cámara con el que el cuerpo tapa la vista; al salir pide más, para que no parpadee en el límite.
const INSIDE_BODY_IN = .75, INSIDE_BODY_OUT = 1;
// Distancia al cielo raso y franja exterior para recuperar la inclinación al dejar una cubierta.
const CEILING_CLEARANCE = .22, CEILING_APPROACH = 1.75;
const COVER_MARGIN = .14, COVER_MIN_ARM = INSIDE_BODY_OUT + .08;
// Altura: subiendo sigue solo parte del salto y con algo de retardo; cayendo rápido, todo el cuerpo y como
// mucho `maxFallLag` por encima; al aterrizar baja unos centímetros (de 6 a 8 en un golpe fuerte). Al caer al
// agua frena `waterBrake` s con el resorte de las caídas.
export const CAMERA_HEIGHT = Object.freeze({
  jumpShare: .7, reducedJumpShare: .35, groundOmega: 14, airOmega: 16,
  fallOmega: 22, fallFrom: -1.5, fallTo: -3.5, maxFallLag: .25, waterBrake: .3,
  dip: .02, dipPerImpact: .02, hardDip: .06, hardDipMore: .02, slopeSpeed: 3
});
// Subpaso del resorte en el aire (s): el retraso no cambia con los FPS.
const CAMERA_SUBSTEP = 1 / 240;

// Temblor por trauma: los golpes suman trauma (0–1) y el temblor crece con su cuadrado, así uno leve casi no se nota.
const TRAUMA_DECAY = 1.3;                 // trauma que se pierde por segundo: un golpe fuerte dura ~0,35 s
// Un atropello (~20 de salud) gira la vista ~1° en su pico; un puño, ~0,4°; un golpe dado, ~0,25°.
const SHAKE_MAX = { yaw: .095, pitch: .07125, roll: .095 }; // radianes con trauma 1
// Ruido suave y determinista: suma de senos con frecuencias que no se repiten pronto.
const shakeNoise = (t, seed) => (Math.sin(t * 1.0 + seed) + Math.sin(t * 2.31 + seed * 1.7) * .5 + Math.sin(t * 4.17 + seed * 2.9) * .25) / 1.75;

export class CameraRig {
  constructor(scene, canvas) {
    this.camera = new THREE.PerspectiveCamera(
      55, window.innerWidth / window.innerHeight, 0.1, 500
    );

    // Se conserva la vista original como segundo modo.
    this.offset = new THREE.Vector3(12, 16, 12);
    this.lookOffset = new THREE.Vector3(0, 1.5, 0);
    this.lerpSpeed = 6;
    this.mode = 'third-person';
    this.yaw = -Math.PI / 2; // Mira a lo largo de la calle al comenzar.
    this.pitch = 0.22;
    this.distance = 5.5;
    this._look = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._hit = new THREE.Vector3();
    this._box = new THREE.Box3();
    this._ray = new THREE.Ray();
    this._snap = true;
    this.insideBody = false;
    this._drag = null;
    this.baseFov = 55;
    this.targetFov = 55;
    this.roll = 0;
    this._targetRoll = 0;
    this._bobTime = 0;
    this._bobAmount = 0;
    this._height = spring();
    this._groundRef = null;
    this._lastY = 0;
    this._goal = 0;
    this._wasAirborne = false;
    this._fall = 0;
    this._vy = 0;
    // Lo que queda del frenazo de un chapuzón (s).
    this._brake = 0;


    try {
      if (localStorage.getItem('bazuko.camera') === 'isometric') this.mode = 'isometric';
    } catch { /* sin almacenamiento */ }
    this.camera.userData.cameraMode = this.mode;

    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);

    this._bindControls(canvas);

    this.trauma = 0;
    this._shakeTime = 0;
    // Interruptor del temblor; además, quien pide movimiento reducido no lo recibe (se mira en cada golpe).
    this.shakeEnabled = true;
    window.addEventListener('camera-shake', (event) => this.addTrauma(event?.detail?.amount));

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  /** Suma trauma (0–1). El temblor decae solo y no mueve la posición: no atraviesa paredes. */
  addTrauma(amount = 0) {
    if (!this.shakeEnabled || (this.reducedMotion ?? prefiereMovimientoReducido()) || !Number.isFinite(amount) || amount <= 0) return this.trauma;
    this.trauma = Math.min(1, this.trauma + amount);
    return this.trauma;
  }

  /**
   * Gira la cámara ya colocada: va al final de `follow`, sin tocar la posición ni el estado con que sigue al
   * jugador, y el `lookAt` del cuadro siguiente lo borra, así que no se acumula.
   */
  _applyShake(dt) {
    if (this.trauma <= 0) return;
    if (this.reducedMotion ?? prefiereMovimientoReducido()) { this.trauma = 0; return; }
    // Se resta antes de tomar el ruido: así el pico no depende de las imágenes por segundo.
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY * dt);
    this._shakeTime += dt * 28;
    const shake = this.trauma * this.trauma;
    this.camera.rotateY(SHAKE_MAX.yaw * shake * shakeNoise(this._shakeTime, 1.3));
    this.camera.rotateX(SHAKE_MAX.pitch * shake * shakeNoise(this._shakeTime, 7.1));
    this.camera.rotateZ(SHAKE_MAX.roll * shake * shakeNoise(this._shakeTime, 4.6));
  }

  toggle(facing = 0) {
    this.mode = this.mode === 'third-person' ? 'isometric' : 'third-person';
    // Al entrar, la cámara queda detrás de la dirección del personaje (+Z local).
    if (this.mode === 'third-person') this.yaw = facing + Math.PI;
    this.camera.userData.cameraMode = this.mode;
    this._snap = true;
    this.releaseControls();
    try { localStorage.setItem('bazuko.camera', this.mode); } catch { /* sin almacenamiento */ }
    return this.mode;
  }

  setQuality(level) {
    const far = GRAPHICS_PROFILES[level]?.far ?? 300;
    if (this.camera.far === far) return;
    this.camera.far = far;
    this.camera.updateProjectionMatrix();
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.005;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.005, 0.05, 0.65);
    this._targetRoll = THREE.MathUtils.clamp(-dx * 0.0004, -0.022, 0.022);
  }

  zoom(delta) {
    this.distance = THREE.MathUtils.clamp(this.distance + delta * 0.005, 2.5, 9);
  }

  cancelDrag() {
    if (this._drag && this.canvas?.hasPointerCapture?.(this._drag.id)) {
      try { this.canvas.releasePointerCapture(this._drag.id); } catch { /* sin captura */ }
    }
    this._drag = null;
  }

  releaseControls() {
    this.cancelDrag();
    if (globalThis.document?.pointerLockElement === this.canvas) {
      try { document.exitPointerLock(); } catch { /* no disponible */ }
    }
  }

  _bindControls(canvas) {
    this.canvas = canvas;
    const active = () => this.mode === 'third-person' && (this.canControl?.() ?? true);
    canvas.addEventListener('contextmenu', (e) => { if (active()) e.preventDefault(); });

    canvas.addEventListener('pointerdown', (e) => {
      // Al dedo lo atiende TouchControls: aquí pediría bloquear el puntero, que un toque no puede soltar.
      if (e.pointerType === 'touch' || e.pointerType === 'pen') return;
      if (!active()) return;
      if (e.button !== 0 && e.button !== 2) return;

      // En clic izquierdo solicita Pointer Lock para control fluido estilo juego 3D
      if (e.button === 0 && this.allowPointerLock?.() !== false &&
          (typeof document === 'undefined' || document.pointerLockElement !== canvas) && canvas.requestPointerLock) {
        try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* sin permiso */ }
      }

      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* sin captura */ }
    });

    // Sin seleccionar ni arrastrar nada al apretar el botón. Va aquí y no en el pointerdown: cancelar aquel cancela
    // también este mousedown, y entonces Input nunca se entera del clic y el ratón no pega.
    canvas.addEventListener('mousedown', (e) => {
      if (active() && (e.button === 0 || e.button === 2)) e.preventDefault();
    });

    const onPointerMove = (e) => {
      if (!active()) {
        if (this._drag) this.cancelDrag();
        return;
      }

      // 1. Si el cursor está bloqueado en el juego, rotar con el movimiento del mouse
      if (typeof document !== 'undefined' && document.pointerLockElement === canvas) {
        const mx = e.movementX ?? 0;
        const my = e.movementY ?? 0;
        if (Math.abs(mx) < 300 && Math.abs(my) < 300 && (mx !== 0 || my !== 0)) {
          this.orbit(mx, my);
        }
        return;
      }

      // 2. Arrastre con botón presionado (izquierdo o derecho)
      if (this._drag && this._drag.id === e.pointerId) {
        this.orbit(e.clientX - this._drag.x, e.clientY - this._drag.y);
        this._drag.x = e.clientX;
        this._drag.y = e.clientY;
      }
    };

    window.addEventListener('pointermove', e => {
      if (globalThis.document?.pointerLockElement !== canvas) onPointerMove(e);
    });
    window.addEventListener('mousemove', e => {
      if (globalThis.document?.pointerLockElement === canvas) onPointerMove(e);
    });


    const onRelease = () => this.cancelDrag();
    canvas.addEventListener('pointerup', onRelease);
    canvas.addEventListener('pointercancel', onRelease);
    canvas.addEventListener('lostpointercapture', onRelease);
    window.addEventListener('blur', () => this.releaseControls());
    window.addEventListener('keydown', e => { if (e.code === 'Escape') this.releaseControls(); });
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement !== canvas) {
          this.cancelDrag();
        } else if (!active()) {
          this.releaseControls();
        }
      });
    }

    canvas.addEventListener('wheel', (e) => {
      if (!active()) return;
      e.preventDefault();
      this.zoom(e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1));
    }, { passive: false });
  }

  updateControls(dt, input) {
    if (this.mode !== 'third-person' || !(this.canControl?.() ?? true)) return;
    const look = input.look ?? { x: 0, y: 0 };
    this.orbit(
      ((input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('ArrowLeft') ? 1 : 0) + look.x) * dt * 250,
      ((input.isDown('ArrowDown') ? 1 : 0) - (input.isDown('ArrowUp') ? 1 : 0) + look.y) * dt * 180
    );
  }

  /** Actualiza solo el rumbo para WASD; la colisión se calcula una vez, al seguir al jugador. */
  prepareMovement() {
    if (this.mode !== 'third-person') return;
    this.camera.rotation.set(-this.pitch, this.yaw, 0, 'YXZ');
    this.camera.updateMatrixWorld();
  }

  /**
   * Altura que sigue la cámara. `motion` es `player.movement`. Subiendo sigue el 70 % de lo que el cuerpo
   * sube sobre el suelo de despegue, con un resorte críticamente amortiguado. Cayendo rápido (vy < −1,5 a
   * −3,5 m/s) pasa a seguir todo el cuerpo con un resorte más rápido y nunca va más de `maxFallLag` por
   * encima: quien cae tiene que ver dónde va a caer y los pies no salen del cuadro. En el aire el resorte
   * sigue a la meta en movimiento (`followSpring`), así que el retraso es el mismo a cualquier FPS. Al
   * aterrizar no se pasa por debajo y baja de 2 a 4 cm según el golpe (de 6 a 8 cm con un golpe fuerte, con
   * un rebote pequeño hacia arriba). Al caer al agua conserva su velocidad y frena `waterBrake` s con el
   * resorte de las caídas, a cualquier FPS. En el suelo acompaña rampas y
   * escaleras (hasta `slopeSpeed` m/s) sin retraso y solo suaviza los cambios bruscos, como bajar un
   * bordillo. Con movimiento reducido sigue menos el salto y no baja. Sin `motion` (o con dt = 0, tras un
   * teletransporte) va pegada al personaje.
   */
  followHeight(y, dt, motion = null) {
    const h = this._height;
    if (!motion || this._snap || !(dt > 0) || this._groundRef === null || Math.abs(y - h.x) > 4) {
      this._groundRef = this._lastY = this._goal = y;
      this._wasAirborne = false;
      this._fall = this._vy = this._brake = 0;
      return snapSpring(h, y);
    }
    const airborne = motion.grounded === false && !motion.swimming;
    const landed = !airborne && this._wasAirborne;
    const y0 = this._lastY;
    this._lastY = y;
    const calm = this.reducedMotion ?? prefiereMovimientoReducido(); // la preferencia del sistema, salvo que se fije aquí
    let height;
    if (!airborne && !landed && motion.swimming && this._brake > 0) {
      // Sigue frenando del chapuzón.
      this._groundRef = this._goal = y;
      height = this._waterBrake(h, y, dt);
    } else if (!airborne && !landed) {
      const limit = CAMERA_HEIGHT.slopeSpeed * dt;
      h.x += Math.max(-limit, Math.min(limit, y - y0));
      this._groundRef = this._goal = y;
      this._fall = this._vy = this._brake = 0;
      height = criticalSpring(h, y, CAMERA_HEIGHT.groundOmega, dt);
    } else {
      // En el aire, y en el cuadro del aterrizaje hasta el contacto, en subpasos fijos y con el cuerpo en su
      // parábola dentro del cuadro: el retraso es el mismo a 20 o a 144 FPS.
      const since = landed ? Math.min(dt, Math.max(0, motion.landingTime ?? 0)) : 0;
      const flight = dt - since;
      let c1 = this._vy ?? 0, c2 = 0;
      if (airborne) {
        // Pasa por la altura de antes y por la de ahora con la velocidad de ahora (vale también al despegar).
        const vy = motion.verticalVelocity ?? 0;
        c2 = 2 * (y0 - y + vy * dt) / (dt * dt);
        c1 = vy - c2 * dt;
      } else if (flight > 0) {
        // Sale con la velocidad que traía y toca el suelo al final del vuelo.
        c2 = 2 * (y - y0 - c1 * flight) / (flight * flight);
      }
      const base = calm ? CAMERA_HEIGHT.reducedJumpShare : CAMERA_HEIGHT.jumpShare, most = CAMERA_HEIGHT.maxFallLag;
      const steps = flight > 0 ? Math.ceil(flight / CAMERA_SUBSTEP - 1e-9) : 0, sub = steps ? flight / steps : 0;
      let goal = this._goal, fall = this._fall ?? 0, vb = c1;
      for (let k = 1; k <= steps; k++) {
        const t = k * sub, yb = y0 + c1 * t + .5 * c2 * t * t;
        vb = c1 + c2 * t;
        // Cayendo rápido sigue todo el cuerpo y con un resorte más rápido.
        fall = smoothstep(CAMERA_HEIGHT.fallFrom, CAMERA_HEIGHT.fallTo, vb);
        const share = base * (1 - fall) + fall;
        const next = yb <= this._groundRef ? yb : this._groundRef + share * (yb - this._groundRef);
        followSpring(h, goal, next, CAMERA_HEIGHT.airOmega + (CAMERA_HEIGHT.fallOmega - CAMERA_HEIGHT.airOmega) * fall, sub);
        goal = next;
        // Tope duro: la cámara nunca va más de `maxFallLag` por encima del cuerpo.
        if (h.x > yb + most) { h.x = yb + most; h.v = Math.min(h.v, vb); }
      }
      if (airborne) {
        this._goal = goal; this._fall = fall; this._vy = motion.verticalVelocity ?? 0;
        height = h.x;
      } else if (motion.swimming) {
        // Al caer al agua el cuerpo frena de golpe; la cámara conserva su velocidad y frena con el resorte
        // rápido de las caídas durante `waterBrake` s (no un cuadro: lo mismo a cualquier FPS), pasándose
        // apenas por debajo del cuerpo.
        this._groundRef = this._goal = y;
        this._fall = this._vy = 0;
        this._brake = CAMERA_HEIGHT.waterBrake;
        height = this._waterBrake(h, y, dt);
      } else {
        // Desde el contacto frena con el cuerpo y baja hasta él sin pasarse por debajo.
        this._groundRef = this._goal = y;
        this._fall = this._vy = 0;
        if (h.x > y + most) h.x = y + most;
        h.v = Math.max(h.v, -CAMERA_HEIGHT.groundOmega * Math.max(0, h.x - y));
        height = since > 0 ? criticalSpring(h, y, CAMERA_HEIGHT.groundOmega, since) : h.x;
      }
    }
    this._wasAirborne = airborne;
    // La bajada del aterrizaje va encima del resorte: se nota aunque la cámara todavía esté llegando.
    const impact = motion.landingImpact ?? 0, since = motion.landingTime;
    if (airborne || calm || !(since >= 0) || !Number.isFinite(since)) return height;
    const soft = (CAMERA_HEIGHT.dip + CAMERA_HEIGHT.dipPerImpact * impact) * landingDrop(since, impact) / landingDepth(impact);
    // Un golpe fuerte (desde 10,3 m/s, completo desde 11,8) baja de 6 a 8 cm y vuelve pasándose un poco hacia arriba.
    const speed = motion.landingSpeed ?? 0, hard = hardLanding(speed);
    if (!hard) return height - soft;
    const deep = (CAMERA_HEIGHT.hardDip + CAMERA_HEIGHT.hardDipMore * smoothstep(12, 18, speed)) * hardDip(since);
    return height - soft * (1 - hard) - deep * hard;
  }

  /** Frenazo del chapuzón: resorte de las caídas lo que queda de `_brake` y, si el cuadro sigue, el del suelo. */
  _waterBrake(h, y, dt) {
    const brake = Math.min(dt, this._brake);
    this._brake -= brake;
    criticalSpring(h, y, CAMERA_HEIGHT.fallOmega, brake);
    return dt > brake ? criticalSpring(h, y, CAMERA_HEIGHT.groundOmega, dt - brake) : h.x;
  }

  _pitchBelowCeilings(target, ceilings) {
    if (!ceilings?.size) return this.pitch;
    let pitch = this.pitch;
    for (const { min, max } of ceilings) {
      if (target.y >= max.y) continue;
      const outside = Math.max(min.x - target.x, target.x - max.x, min.z - target.z, target.z - max.z, 0);
      if (outside >= CEILING_APPROACH) continue;
      const rise = max.y - CEILING_CLEARANCE - this._look.y;
      const limit = Math.asin(THREE.MathUtils.clamp(rise / this.distance, -1, 1));
      const influence = 1 - smoothstep(0, CEILING_APPROACH, outside);
      pitch = Math.min(pitch, THREE.MathUtils.lerp(this.pitch, limit, influence));
    }
    return pitch;
  }

  _cameraOcclusionAt(box, padding) {
    const volume = this._box.copy(box).expandByScalar(COVER_MARGIN);
    volume.min.x -= padding; volume.min.z -= padding;
    volume.max.x += padding; volume.max.z += padding;
    if (volume.containsPoint(this._look)) return Infinity;
    const hit = this._ray.intersectBox(volume, this._hit);
    return hit ? this._look.distanceTo(hit) : Infinity;
  }

  _distanceBeforeCovers(distance, covers) {
    if (!covers?.size) return distance;
    let visible = distance;
    const { x, z } = this._look;
    for (const { box, approach, minimumArm = COVER_MIN_ARM } of covers) {
      const outside = Math.max(box.min.x - x, x - box.max.x, box.min.z - z, z - box.max.z, 0);
      if (outside > distance + COVER_MARGIN + approach) continue;
      // Cada pieza deja margen para mantener visible al jugador. Las paredes sólidas conservan su distancia.
      const minimum = Math.min(distance, Math.max(minimumArm, INSIDE_BODY_IN));
      const hit = this._cameraOcclusionAt(box, 0);
      if (hit < distance) {
        visible = Math.min(visible, Math.max(minimum, hit - .05));
        continue;
      }
      let grazing = this._cameraOcclusionAt(box, approach);
      if (grazing >= distance) continue;
      // Al girar, empieza a recoger el brazo antes de alcanzar el borde de la lona.
      // La distancia converge al punto de contacto al desaparecer la holgura lateral.
      let low = 0, high = approach;
      for (let i = 0; i < 6; i++) {
        const middle = (low + high) / 2, next = this._cameraOcclusionAt(box, middle);
        if (next >= distance) low = middle;
        else { high = middle; grazing = next; }
      }
      const influence = 1 - smoothstep(0, approach, high);
      visible = Math.min(visible, Math.max(minimum, THREE.MathUtils.lerp(distance, grazing - .05, influence)));
    }
    return visible;
  }

  follow(targetPos, dt = 1 / 60, collisions = null, speed = 0, isRunning = false, motion = null) {
    // 1. FOV dinámico al correr
    if (this.mode === 'third-person' && dt > 0) {
      const wantFov = (isRunning && speed > 2.5) ? 61 : this.baseFov;
      if (Math.abs(this.camera.fov - wantFov) > 0.05) {
        this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, wantFov, 1 - Math.exp(-6 * dt));
        this.camera.updateProjectionMatrix();
      }
    } else if (this.camera.fov !== this.baseFov) {
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
    this._look.copy(targetPos).add(this.lookOffset);
    this._look.y = this.followHeight(targetPos.y, dt, motion) + this.lookOffset.y;
    if (this.mode === 'third-person' && dt > 0 && speed > 0.4) {
      this._bobTime += dt * (isRunning ? 13 : 8.5);
      const targetBob = isRunning ? 0.038 : 0.018;
      this._bobAmount = THREE.MathUtils.lerp(this._bobAmount, targetBob, 1 - Math.exp(-6 * dt));
      this._look.y += Math.sin(this._bobTime) * this._bobAmount;
    } else if (this._bobAmount > 0.001 && dt > 0) {
      this._bobAmount = THREE.MathUtils.lerp(this._bobAmount, 0, 1 - Math.exp(-8 * dt));
      this._look.y += Math.sin(this._bobTime) * this._bobAmount;
    }
    if (this.mode === 'isometric') {
      this._desired.copy(targetPos).add(this.offset);
      if (this._snap) this.camera.position.copy(this._desired);
      else this.camera.position.lerp(this._desired, 1 - Math.exp(-this.lerpSpeed * dt));
    } else {
      const pitch = this._pitchBelowCeilings(targetPos, collisions?.cameraCeilings);
      const horizontal = Math.cos(pitch);
      this._direction.set(Math.sin(this.yaw) * horizontal, Math.sin(pitch), Math.cos(this.yaw) * horizontal);
      // Acorta el brazo de cámara antes de una pared; el margen protege el plano cercano.
      this._ray.set(this._look, this._direction);
      let distance = this.distance;
      const endX = this._look.x + this._direction.x * distance, endZ = this._look.z + this._direction.z * distance;
      const candidates = collisions?.queryStatic?.(Math.min(this._look.x, endX) - .2, Math.min(this._look.z, endZ) - .2,
        Math.max(this._look.x, endX) + .2, Math.max(this._look.z, endZ) + .2) ?? collisions?.colliders ?? [];
      for (const { box } of candidates) {
        this._box.copy(box).expandByScalar(0.2);
        if (this._box.containsPoint(this._look)) { distance = 0; break; }
        if (this._ray.intersectBox(this._box, this._hit)) {
          distance = Math.min(distance, Math.max(0, this._look.distanceTo(this._hit) - 0.05));
        }
      }
      distance = this._distanceBeforeCovers(distance, collisions?.cameraOccluders);
      // Se acerca de inmediato ante obstáculos y vuelve suavemente al alejarse.
      if (this._snap || distance < this._armDistance) this._armDistance = distance;
      else this._armDistance = THREE.MathUtils.lerp(this._armDistance, distance, 1 - Math.exp(-8 * dt));
      this.camera.position.copy(this._look).addScaledVector(this._direction, this._armDistance);
    }
    this.insideBody = this.mode === 'third-person' && this._armDistance < (this.insideBody ? INSIDE_BODY_OUT : INSIDE_BODY_IN);
    // Orientación definida incluso si un obstáculo obliga a acercarse hasta el punto de mira.
    this._desired.copy(this._look);
    if (this.mode === 'third-person') this._desired.addScaledVector(this._direction, -1);
    this.camera.lookAt(this._desired);
    if (this.mode === 'third-person' && dt > 0) {
      this._targetRoll = THREE.MathUtils.lerp(this._targetRoll, 0, 1 - Math.exp(-7 * dt));
      this.roll = THREE.MathUtils.lerp(this.roll, this._targetRoll, 1 - Math.exp(-12 * dt));
      this.camera.rotation.z = this.roll;
    }
    if (dt > 0) this._applyShake(dt);
    this.camera.updateMatrixWorld();
    this._snap = false;
  }
}
