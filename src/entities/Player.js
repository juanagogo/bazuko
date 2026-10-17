// src/entities/Player.js
import * as THREE from 'three';
import { loadGLTFCached } from '../utils/ModelCache.js';
import {
  PLAYER_RADIUS,
  PLAYER_SPEED_WALK,
  PLAYER_SPEED_RUN
} from '../utils/constants.js';
import { ExhaustedGait, GAIT } from './ExhaustedGait.js';
import { FootstepDetector } from './FootstepDetector.js';

export class Player {
  constructor(scene, input, stats=null) {
    this.input = input;
    this.scene = scene;
    this.stats = stats;
    this.position = new THREE.Vector3(16, 0, 16); // zona reservada spawn
    this.radius = PLAYER_RADIUS;
    this.baseWalk = PLAYER_SPEED_WALK;
    this.baseRun = PLAYER_SPEED_RUN;
    this.speedWalk = PLAYER_SPEED_WALK;
    this.speedRun = PLAYER_SPEED_RUN;
    this.speedMult = 1; // debuff por salud mental baja

    // Contenedor raíz
    this.root = new THREE.Group();
    this.root.position.copy(this.position);
    scene.add(this.root);

    this._buildBody();
    this._loadGLB();

    this.animTime = 0;
    this.state = 'idle';
    this._boostActive = false;
    this._boostPulse = 0;
    this.beggingTimer = 0;
    this.onFootstep = null; // (running: boolean, foot: 1|2) => void, disparado en cada contacto de pie
    this._dir = new THREE.Vector3();
    this._delta = new THREE.Vector3();
  }

  _buildBody() {
    const mat = new THREE.MeshLambertMaterial({
      color: 0x9a9a9a,
      flatShading: true
    });

    this._originalColors = new Map();
this.root.traverse((o) => {
  if (o.isMesh && o.material?.color) {
    this._originalColors.set(o, o.material.color.clone());
  }
});

    const box = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      return m;
    };

    this.parts = {
      hips:  box(0.35, 0.25, 0.25,  0,    0.95, 0),
      torso: box(0.40, 0.55, 0.25,  0,    1.35, 0),
      head:  box(0.25, 0.28, 0.25,  0,    1.75, 0),
      armL:  box(0.14, 0.55, 0.14, -0.28, 1.30, 0),
      armR:  box(0.14, 0.55, 0.14,  0.28, 1.30, 0),
      legL:  box(0.16, 0.75, 0.16, -0.10, 0.40, 0),
      legR:  box(0.16, 0.75, 0.16,  0.10, 0.40, 0)
    };

    Object.values(this.parts).forEach((p) => this.root.add(p));

    // Pivotes: mover origen del mesh al extremo superior
    [this.parts.armL, this.parts.armR].forEach((arm) => {
      arm.geometry.translate(0, -0.275, 0);
      arm.position.y += 0.275;
    });
    [this.parts.legL, this.parts.legR].forEach((leg) => {
      leg.geometry.translate(0, -0.375, 0);
      leg.position.y += 0.375;
    });
  }

  // Carga async del modelo GLB; reemplaza el procedural al terminar
  _loadGLB() {
    // Cache compartida: usa la version optimizada (vagabundo2.opt.glb) y se puede precargar
    loadGLTFCached('vagabundo2.glb').then((gltf) => {
        if (!gltf || this._disposed) return;
        const model = gltf.scene;

        // Escala a la altura del personaje procedural y pies en y=0, centrado en XZ
        const TARGET_HEIGHT = 1.85;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        if (!isFinite(size.y) || size.y <= 0) return;
        const s = TARGET_HEIGHT / size.y;
        model.scale.setScalar(s);
        box.setFromObject(model);
        const c = box.getCenter(new THREE.Vector3());
        model.position.x -= c.x;
        model.position.z -= c.z;
        model.position.y -= box.min.y;

        model.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
            o.frustumCulled = false;
          }
        });

        // Retirar procedural
        Object.values(this.parts).forEach((p) => {
          this.root.remove(p);
          p.geometry?.dispose?.();
        });
        this.parts = null;

        this.model = model;
        this.root.add(model);

        // Animaciones (si las trae)
        if (gltf.animations?.length) {
          // Quitar movimiento de raíz (Hips.position) para que no se desplace el modelo
          gltf.animations.forEach((clip) => {
            clip.tracks = clip.tracks.filter((t) => !/hips\.position$/i.test(t.name));
          });
          this.mixer = new THREE.AnimationMixer(model);
          const find = (re) => gltf.animations.find((a) => re.test(a.name));
          const walk = find(/walk|camin/i) || find(/run|corr/i);
          const run = find(/run|corr|sprint/i) || walk;
          // Quieto = pose estática congelada del propio clip Walking (sin idle).
          // 0.25 del ciclo ~ pose de paso (piernas juntas, erguido), no T-pose ni zancada.
          const STILL_PHASE = 0.25;
          this._stillTime = walk ? walk.duration * STILL_PHASE : 0;
          this.actions = {
            idle: walk && this.mixer.clipAction(walk.clone()),
            walk: walk && this.mixer.clipAction(walk),
            run: run && this.mixer.clipAction(run)
          };
          if (this.actions.idle) {
            this.actions.idle.timeScale = 0; // congelada
            this.actions.idle.time = this._stillTime;
          }
          if (this.actions.walk) this.actions.walk.timeScale = GAIT.WALK_TIMESCALE;
          if (this.actions.run) this.actions.run.timeScale = GAIT.RUN_TIMESCALE;
          this._currentAction = null;

          // Marcha agotada con cojera (capa procedural sobre el clip Walking)
          this.gait = new ExhaustedGait(model);
          this.footsteps = new FootstepDetector(model);
          if (this.actions.idle) {
            // Pose neutra (quieta) para amortiguar balanceos
            this.actions.idle.play();
            this.mixer.update(0);
            this.gait.captureNeutral();
            this.actions.idle.stop();
          }
        }
    });
  }

  _playAction(name) {
    const next = this.actions?.[name] || this.actions?.idle;
    if (!next || next === this._currentAction) return;
    const prev = this._currentAction;
    const locomo = (a) => a === this.actions.walk || a === this.actions.run;
    const swap = !!(prev && prev !== next && locomo(prev) && locomo(next) && this.actions.walk !== this.actions.run);
    const FADE = swap ? GAIT.RUN_FADE : 0.15;
    const phase = swap ? (prev.time / (prev.getClip().duration || 1)) % 1 : 0;
    next.reset();
    if (name === 'idle') {
      next.timeScale = 0;
      next.time = this._stillTime || 0;
    } else if (name === 'walk' && this._currentAction === this.actions.idle) {
      next.time = this._stillTime || 0; // arrancar desde la misma fase: sin salto
    } else if (swap) {
      next.time = phase * next.getClip().duration; // caminar<->correr con la misma fase de pasos
    }
    next.fadeIn(FADE).play();
    this._currentAction?.fadeOut(FADE);
    this._currentAction = next;
  }

  playBeg() {
    this.beggingTimer = 1.0;
  }

  update(dt, camera, collisions) {
    if (this.beggingTimer > 0) {
      this.beggingTimer -= dt;
    }

    const { x, z } = this.input.axis;
    const moving = (x !== 0 || z !== 0);
    const running = this.input.isRunning && moving;
    let speed = running ? this.speedRun : this.speedWalk;
    if (this.stats?.getSpeedMultiplier) {
      speed *= this.stats.getSpeedMultiplier();
    }
    // Marcha agotada: velocidad sincronizada con el timeScale del clip y el ritmo irregular
    // (pausas al caminar, tropiezos al correr) para que los pies no patinen.
    if (this.gait && this.mixer && moving) {
      speed *= (running ? GAIT.RUN_SPEED_SCALE : GAIT.WALK_SPEED_SCALE) * this.gait.rate;
    }
    // Movimiento
    const dir = this._dir.set(x, 0, z);
    if (moving) dir.normalize();
    const delta = this._delta.copy(dir).multiplyScalar(moving ? speed * dt : 0);

    if (collisions) {
      // Substeps: paso max ~0.15 u por resolución para no atravesar colliders finos al correr
      const len = delta.length();
      const n = Math.min(4, Math.max(1, Math.ceil(len / 0.15)));
      if (n > 1) delta.multiplyScalar(1 / n);
      for (let i = 0; i < n; i++) {
        this.position.copy(
          collisions.resolveMove(this.position, delta, this.radius)
        );
      }
    } else {
      this.position.add(delta);
    }

    this.root.position.copy(this.position);

    // Rotación suave
    if (moving) {
      const targetAngle = Math.atan2(dir.x, dir.z);
      let diff = targetAngle - this.root.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.root.rotation.y += diff * Math.min(1, 12 * dt);
    }

    // Animación procedural
    this.state = !moving ? 'idle' : (running ? 'run' : 'walk');
    this.animTime += dt * (
      this.state === 'run' ? 10 : this.state === 'walk' ? 6 : 1.5
    );

    if (this.model) {
      if (this.mixer) {
        this._playAction(this.state);
        const g = this.gait;
        const gMode = this.state === 'idle' ? null : this.state;
        if (g && (gMode || g.active)) {
          g.update(dt, gMode);
          if (this.actions.walk && this.state === 'walk') {
            this.actions.walk.timeScale = GAIT.WALK_TIMESCALE * g.rate;
          } else if (this.actions.run && this.state === 'run') {
            this.actions.run.timeScale = GAIT.RUN_TIMESCALE * g.rate;
          }
        }
        this.mixer.update(dt);
        if (g && g.active) g.apply();
        // Pasos: contacto de pie detectado en la pose final (respeta pausas y ritmo irregular)
        const fs = this.footsteps;
        if (fs) {
          if (this.state === 'idle') fs.reset();
          else {
            const foot = fs.update(dt, this.root.position.y);
            if (foot && this.onFootstep) this.onFootstep(this.state === 'run', foot);
          }
        }
      } else {
        // Sin animaciones: bob/balanceo simple al caminar
        const moveAmt = this.state === 'idle' ? 0 : 1;
        const t = this.animTime;
        this.model.rotation.z = Math.sin(t) * 0.05 * moveAmt;
        this.model.rotation.x = Math.sin(t * 2) * 0.02 * moveAmt;
      }
      return;
    }
    this._animateProcedural();
  }

  _animateProcedural() {
    const t = this.animTime;
    const { armL, armR, legL, legR, torso, head } = this.parts;

    if (this.beggingTimer > 0) {
      torso.position.y = 1.25;
      head.position.y = 1.65;
      armL.rotation.x = -1.1;
      armR.rotation.x = -1.1;
      armL.rotation.z = -0.15;
      armR.rotation.z = 0.15;
      legL.rotation.x = 0;
      legR.rotation.x = 0;
      return;
    }

    armL.rotation.z = 0;
    armR.rotation.z = 0;

    if (this.state === 'idle') {
      const breathe = Math.sin(t) * 0.03;
      torso.position.y = 1.35 + breathe;
      head.position.y = 1.75 + breathe;
      armL.rotation.x = Math.sin(t) * 0.05;
      armR.rotation.x = Math.sin(t) * 0.05;
      legL.rotation.x = 0;
      legR.rotation.x = 0;
    } else {
      const amp = this.state === 'run' ? 0.9 : 0.5;
      const swing = Math.sin(t);
      legL.rotation.x = swing * amp;
      legR.rotation.x = -swing * amp;
      armL.rotation.x = -swing * amp * 0.8;
      armR.rotation.x = swing * amp * 0.8;
      torso.position.y = 1.35 + Math.abs(Math.sin(t)) * 0.04;
      head.position.y = 1.75 + Math.abs(Math.sin(t)) * 0.04;
    }
  }

  dispose() {
    this._disposed = true;
    this.mixer?.stopAllAction();
    this.root.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.scene.remove(this.root);
  }
}