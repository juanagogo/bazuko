import * as THREE from 'three';
import { GRAPHICS_PROFILES } from './GraphicsQuality.js';

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
    this._drag = null;
    this.baseFov = 55;
    this.targetFov = 55;
    this.roll = 0;
    this._targetRoll = 0;
    this._bobTime = 0;
    this._bobAmount = 0;


    try {
      if (localStorage.getItem('bazuko.camera') === 'isometric') this.mode = 'isometric';
    } catch { /* sin almacenamiento */ }
    this.camera.userData.cameraMode = this.mode;

    this.camera.position.copy(this.offset);
    this.camera.lookAt(0, 0, 0);

    this._bindControls(canvas);

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
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
      if (!active()) return;
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();

      // En clic izquierdo solicita Pointer Lock para control fluido estilo juego 3D
      if (e.button === 0 && (typeof document === 'undefined' || document.pointerLockElement !== canvas) && canvas.requestPointerLock) {
        try { canvas.requestPointerLock()?.catch?.(() => {}); } catch { /* sin permiso */ }
      }

      this._drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture?.(e.pointerId); } catch { /* sin captura */ }
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

  follow(targetPos, dt = 1 / 60, collisions = null, speed = 0, isRunning = false) {
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
      this._direction.set(
        Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(this.yaw) * Math.cos(this.pitch)
      );
      // Acorta el brazo de cámara antes de una pared; el margen protege el plano cercano.
      this._ray.set(this._look, this._direction);
      let distance = this.driving?Math.max(8.5,this.distance):this.distance;
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
      // Se acerca de inmediato ante obstáculos y vuelve suavemente al alejarse.
      if (this._snap || distance < this._armDistance) this._armDistance = distance;
      else this._armDistance = THREE.MathUtils.lerp(this._armDistance, distance, 1 - Math.exp(-8 * dt));
      this.camera.position.copy(this._look).addScaledVector(this._direction, this._armDistance);
    }
    // Orientación definida incluso si un obstáculo obliga a acercarse hasta el punto de mira.
    this._desired.copy(this._look);
    if (this.mode === 'third-person') this._desired.addScaledVector(this._direction, -1);
    this.camera.lookAt(this._desired);
    if (this.mode === 'third-person' && dt > 0) {
      this._targetRoll = THREE.MathUtils.lerp(this._targetRoll, 0, 1 - Math.exp(-7 * dt));
      this.roll = THREE.MathUtils.lerp(this.roll, this._targetRoll, 1 - Math.exp(-12 * dt));
      this.camera.rotation.z = this.roll;
    }
    this.camera.updateMatrixWorld();
    this._snap = false;
  }
}
