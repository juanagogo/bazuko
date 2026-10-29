// src/systems/PsychosisSystem.js
import * as THREE from 'three';

const _forward = new THREE.Vector3();
const _toGhost = new THREE.Vector3();

const PARANOIA_WHISPERS = [
  '¿QUIÉN ESTÁ AHÍ?',
  'TE ESTÁN SIGUIENDO',
  'NO MIRES ATRÁS',
  'TODOS TE ESTÁN MIRANDO',
  '¡VIENEN POR TI!',
  'ESTÁN EN LAS PAREDES',
  'NO CONFÍES EN NADIE',
  '¡ESOS CARROS TE VIGILAN!',
  '¡CORRE!'
];

const PARANOIA_MUTTERINGS = [
  '🗣️ "¡¡Dejen de vigilarme, sé quiénes son!!"',
  '🗣️ "¡¡Están en las sombras... nos tienen acorralados!!"',
  '🗣️ "¡¡No me toquen, aléjense de mí!!"',
  '🗣️ "¿Quién anda susurrando mi nombre?"',
  '🗣️ "¡¡Esos peatones son policías encubiertos!!"'
];

export class PsychosisSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} player
   * @param {object} stats
   * @param {object} audio
   * @param {object} world
   */
  constructor(scene, player = null, stats = null, audio = null, world = null) {
    this.scene = scene;
    this.player = player;
    this.stats = stats;
    this.audio = audio;
    this.world = world;

    this.shadowPeople = [];
    this.whisperTimer = 5;
    this.heartbeatTimer = 0.8;
    this.spasmTimer = 10;
    this.paranoiaUtteranceTimer = 15;
    this.active = false;
    this.induced = null; // { left, severity }: paranoia por consumo (basuco), sin abstinencia

    // Elementos DOM
    this.overlayEl = null;
    this.warningEl = null;
    this.voicesEl = null;
    this._initDOM();
  }

  _initDOM() {
    if (typeof document === 'undefined') return;
    this.overlayEl = document.getElementById('psychosis-overlay');
    this.warningEl = document.getElementById('psychosis-warning');
    this.voicesEl = document.querySelector('.psychosis-voices');
  }

  /**
   * Crea una figura espectral de 'Gente Sombra'
   */
  _createShadowPerson(position) {
    if (!this.scene) return null;
    const group = new THREE.Group();

    // Material espectral negro translúcido
    const mat = new THREE.MeshBasicMaterial({
      color: 0x050508,
      transparent: true,
      opacity: 0.78
    });

    // Cabeza
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 7, 7), mat);
    head.position.y = 1.6;
    group.add(head);

    // Ojos rojizos brillantes
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 1 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 5), eyeMat);
    eyeL.position.set(-0.07, 1.62, 0.18);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 5), eyeMat);
    eyeR.position.set(0.07, 1.62, 0.18);
    group.add(eyeL);
    group.add(eyeR);

    // Torso encorvado
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.75, 7), mat);
    torso.position.y = 1.1;
    torso.rotation.x = 0.18;
    group.add(torso);

    // Cuernos curvos hacia atrás
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.26, 6), mat);
      horn.position.set(side * 0.12, 1.8, -0.02);
      horn.rotation.set(-0.5, 0, side * -0.45);
      group.add(horn);
    }

    // Boca rasgada que brilla como los ojos
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.018, 0.02), eyeMat);
    mouth.position.set(0, 1.5, 0.185);
    group.add(mouth);

    // Brazos largos colgando, con garras
    for (const side of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.95, 5), mat);
      arm.position.set(side * 0.27, 0.95, 0.05);
      arm.rotation.z = side * 0.12;
      group.add(arm);
      for (let f = -1; f <= 1; f++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.12, 4), mat);
        claw.position.set(side * 0.33 + f * 0.025, 0.42, 0.06);
        claw.rotation.x = Math.PI;
        group.add(claw);
      }
    }

    // Sin piernas: flota sobre una cola rasgada que se deshace hacia el piso
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.85, 7, 1, true), mat);
    tail.position.y = 0.38;
    tail.rotation.x = Math.PI;
    group.add(tail);

    group.position.copy(position);
    this.scene.add(group);

    return {
      group,
      position: group.position,
      baseY: position.y,
      phase: Math.random() * Math.PI * 2,
      lifetime: 18 + Math.random() * 12,
      dissolving: false
    };
  }

  _spawnFloatingWhisper() {
    if (typeof document === 'undefined') return;
    if (!this.voicesEl && !this.overlayEl) return;
    const container = this.voicesEl ?? this.overlayEl;

    const wordEl = document.createElement('div');
    wordEl.className = 'hallucination-word';
    wordEl.textContent = PARANOIA_WHISPERS[Math.floor(Math.random() * PARANOIA_WHISPERS.length)];

    const x = 10 + Math.random() * 75;
    const y = 15 + Math.random() * 65;
    wordEl.style.left = `${x}vw`;
    wordEl.style.top = `${y}vh`;

    container.appendChild(wordEl);
    setTimeout(() => {
      wordEl.remove();
    }, 3400);
  }

  _clearShadowPeople() {
    for (const sp of this.shadowPeople) {
      this.scene?.remove(sp.group);
      sp.group.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    }
    this.shadowPeople = [];
  }

  /**
   * Paranoia sin abstinencia (p. ej. después del basuco): `seconds` de alucinaciones con esta
   * intensidad (0 a 1). Un segundo consumo alarga la que ya está.
   */
  induce(seconds, severity = 0.7) {
    this.induced = {
      left: Math.max(this.induced?.left ?? 0, seconds),
      severity: Math.max(this.induced?.severity ?? 0, severity)
    };
    // los primeros susurros y frases llegan enseguida
    this.whisperTimer = Math.min(this.whisperTimer, 1.5);
    this.paranoiaUtteranceTimer = Math.min(this.paranoiaUtteranceTimer, 5);
  }

  /** Corta la paranoia inducida (dormir, morir, recuperarse) */
  clearInduced() { this.induced = null; }

  /**
   * Actualiza el sistema de psicosis y alucinaciones por abstinencia o por consumo.
   * @param {number} dt
   * @param {object} cameraRig
   */
  update(dt, cameraRig = null) {
    const abstinencia = this.stats?.abstinencia ?? 0;
    if (this.induced && (this.induced.left -= dt) <= 0) this.induced = null;
    const fromWithdrawal = abstinencia >= 50 ? Math.min(1, (abstinencia - 50) / 50) : null;
    // la paranoia inducida se apaga en sus últimos 8 s
    const fromDrug = this.induced ? this.induced.severity * Math.min(1, this.induced.left / 8) : null;
    const isHigh = fromWithdrawal != null || fromDrug != null;

    if (!isHigh) {
      if (this.player) { this.player.paranoia = 0; this.player.paranoiaFocus = null; }
      if (this.active) {
        this.active = false;
        this._clearShadowPeople();
        if (typeof document !== 'undefined') {
          this.overlayEl?.classList.remove('active');
          if (this.warningEl) this.warningEl.style.display = 'none';
          const canvas = document.getElementById('game-canvas');
          if (canvas) canvas.style.filter = '';
        }
        if (cameraRig?.camera) {
          cameraRig.camera.fov = cameraRig.baseFov ?? 55;
          cameraRig.camera.updateProjectionMatrix();
        }
      }
      return;
    }

    this.active = true;
    const severity = Math.max(fromWithdrawal ?? 0, fromDrug ?? 0); // 0 a 1

    // 1. Efectos DOM y distorsión cromática visual
    if (typeof document !== 'undefined') {
      if (!this.overlayEl) this._initDOM();
      this.overlayEl?.classList.add('active');
      if (this.warningEl) {
        this.warningEl.style.display = abstinencia >= 80 ? 'block' : 'none';
      }

      // la imagen de la paranoia inducida la pone su efecto de consumo (SubstanceEffects)
      const canvas = fromWithdrawal != null ? document.getElementById('game-canvas') : null;
      if (canvas) {
        const time = performance.now();
        const hue = Math.sin(time * 0.003) * 14 * severity;
        const contrast = 100 + 40 * severity;
        const sat = 100 + 45 * severity;
        canvas.style.filter = `contrast(${contrast.toFixed(1)}%) saturate(${sat.toFixed(1)}%) hue-rotate(${hue.toFixed(1)}deg)`;
      }
    }

    // 2. Distorsión de cámara: respiración de FOV y temblor
    if (cameraRig?.camera) {
      const time = performance.now();
      const fovPulse = Math.sin(time * 0.0045) * 3.2 * severity;
      cameraRig.camera.fov = (cameraRig.baseFov ?? 55) + fovPulse;
      if (severity > 0.6) {
        cameraRig.camera.rotation.z += (Math.random() - 0.5) * 0.007 * severity;
      }
      cameraRig.camera.updateProjectionMatrix();
    }

    // 3. Alucinaciones auditivas: latidos cardíacos taquicárdicos y susurros
    this.heartbeatTimer -= dt;
    if (this.heartbeatTimer <= 0) {
      this.audio?.playHeartbeat?.(severity);
      this.heartbeatTimer = 0.95 - 0.42 * severity;
    }

    this.whisperTimer -= dt;
    if (this.whisperTimer <= 0) {
      this.audio?.playPsychosisWhisper?.();
      this._spawnFloatingWhisper();
      this.whisperTimer = 6.5 + Math.random() * 7;
    }

    // 4. Sombras espectrales (Gente Sombra)
    const playerPos = this.player?.position;
    if (playerPos && this.scene) {
      // Generar sombra si hay menos de 3. Con la paranoia del basuco aparecen más cerca, a los
      // lados o detrás de la cámara: de reojo.
      const camera = cameraRig?.camera;
      if (camera) camera.getWorldDirection(_forward);
      if (this.shadowPeople.length < 3 && Math.random() < 0.025) {
        const sideways = fromDrug != null && camera;
        const angle = sideways
          ? Math.atan2(_forward.z, _forward.x) + (Math.random() < 0.5 ? 1 : -1) * (Math.PI / 2 + Math.random() * Math.PI / 2)
          : Math.random() * Math.PI * 2;
        const dist = sideways ? 7 + Math.random() * 6 : 14 + Math.random() * 9;
        const spawnX = playerPos.x + Math.cos(angle) * dist;
        const spawnZ = playerPos.z + Math.sin(angle) * dist;
        const spawnY = this.world?.active?.getGroundHeight?.(spawnX, spawnZ) ?? 0;
        const sp = this._createShadowPerson(new THREE.Vector3(spawnX, spawnY, spawnZ));
        if (sp) this.shadowPeople.push(sp);
      }

      // Actualizar sombras existentes
      for (let i = this.shadowPeople.length - 1; i >= 0; i--) {
        const sp = this.shadowPeople[i];
        sp.lifetime -= dt;

        // Flota meciéndose y mira al jugador
        if (!sp.dissolving) sp.group.position.y = sp.baseY + 0.15 + Math.sin(performance.now() * 0.0013 + sp.phase) * 0.08;
        sp.group.lookAt(playerPos.x, sp.position.y + 1.6, playerPos.z);

        const distToPlayer = sp.position.distanceTo(playerPos);
        // Si el jugador se acerca demasiado, la sombra expira o la mira de frente un momento, se desvanece
        if (camera && !sp.dissolving) {
          _toGhost.copy(sp.position).setY(sp.position.y + 1.4).sub(camera.position).normalize();
          sp.stared = _toGhost.dot(_forward) > 0.985 ? (sp.stared ?? 0) + dt : 0;
        }
        if (distToPlayer < 5.5 || sp.lifetime <= 0 || sp.stared > 1) {
          sp.dissolving = true;
        }

        if (sp.dissolving) {
          sp.group.position.y += dt * 0.4;
          let allFaded = true;
          sp.group.traverse((o) => {
            if (o.material?.opacity !== undefined) {
              o.material.opacity = Math.max(0, o.material.opacity - dt * 2.5);
              if (o.material.opacity > 0.02) allFaded = false;
            }
          });
          if (allFaded) {
            this.scene.remove(sp.group);
            sp.group.traverse((o) => {
              o.geometry?.dispose?.();
              o.material?.dispose?.();
            });
            this.shadowPeople.splice(i, 1);
          }
        }
      }
    }

    // 4b. El personaje mira nervioso a los lados y voltea hacia la sombra más cercana
    if (this.player) {
      this.player.paranoia = severity;
      let nearest = null, best = Infinity;
      for (const sp of this.shadowPeople) {
        const d = playerPos ? sp.position.distanceToSquared(playerPos) : Infinity;
        if (!sp.dissolving && d < best) { best = d; nearest = sp.position; }
      }
      this.player.paranoiaFocus = nearest;
    }

    // 5. Comportamientos extraños del personaje: espasmos motores involuntarios
    this.spasmTimer -= dt;
    if (this.spasmTimer <= 0) {
      this.player?.playAction?.('temblor', 0.55);
      this.audio?.playPsychosisWhisper?.();
      this.spasmTimer = 10 + Math.random() * 8;
    }

    // 6. Delirios verbales involuntarios
    this.paranoiaUtteranceTimer -= dt;
    if (this.paranoiaUtteranceTimer <= 0) {
      const msg = PARANOIA_MUTTERINGS[Math.floor(Math.random() * PARANOIA_MUTTERINGS.length)];
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('toast', { detail: { text: msg, type: 'warn' } }));
      }
      this.paranoiaUtteranceTimer = 16 + Math.random() * 12;
    }
  }

  dispose() {
    this._clearShadowPeople();
    if (typeof document !== 'undefined') {
      this.overlayEl?.classList.remove('active');
      const canvas = document.getElementById('game-canvas');
      if (canvas) canvas.style.filter = '';
    }
  }
}
