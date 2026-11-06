// src/systems/PsychosisSystem.js
import * as THREE from 'three';
import { hasClearCombatLine } from './CombatGeometry.js';
import { VOCES, sitioParaVoz } from '../ui/momentosTextos.js';

// Lo que una voz nunca tapa: las cifras y lo que se oprime.
const NO_TAPAR = '#hud-dock, #topbar, #wanted, #quickbar, #panel-dock, #interaction-prompt, #retazo, #acciones, #joystick';
const VOCES_A_LA_VEZ = 2;
// Lo que se mueve la cámara con la malilla o la paranoia. Nada pasa de 0,5 Hz: 0,003 rad/ms son 0,48 Hz y 0,0016, 0,25 Hz.
const RESPIRA_RAD_MS = 0.003;
const DERIVA_RAD_MS = 0.0016;

// Nivel alto de la paranoia: tras varias dosis seguidas los hombres sombra dejan de mirar y atacan.
export const ATAQUE = Object.freeze({
  dosis: 3,              // consumos seguidos, sin que se apague la paranoia, para llegar al nivel alto
  maxSimultaneos: 2,
  velocidad: 3.6,        // m/s: más que andar (3), menos que correr (6)
  alcance: 1.5,          // m
  preparacion: 0.55,     // s de anticipación antes de cada golpe
  enfriamiento: 1.8,     // s entre golpes de una misma sombra
  respiro: 1.2,          // s sin golpes de nadie después de herir al jugador
  danoMin: 4, danoMax: 7,
  saludMinima: 10,       // nunca lo dejan por debajo: lastiman, no matan
  espera: 6,             // s antes de que llegue otra tras disolverse una
  distancia: [9, 13],    // m de aparición
  rendicion: 35,         // m: si se les escapa corriendo, se disuelven
  vida: 25               // s
});

// Motos sombra: en el nivel de ataque cruzan la escena sin tocar a nadie ni hacer daño.
export const MOTO_SOMBRA = Object.freeze({
  maxSimultaneas: 2,
  espera: [4, 9],        // s entre una y otra
  salida: [55, 75],      // m del jugador a los que nacen, fuera de la vista
  velocidad: [20, 30],   // m/s
  vida: 9,               // s como máximo
  fundido: 0.5           // s de aparecer y de disolverse
});
let _motoSombraGeometrias = null;
function motoSombraGeometrias() {
  return _motoSombraGeometrias ??= {
    rueda: new THREE.CylinderGeometry(0.32, 0.32, 0.12, 10).rotateX(Math.PI / 2),
    cuerpo: new THREE.BoxGeometry(1.1, 0.35, 0.3),
    tanque: new THREE.BoxGeometry(0.5, 0.3, 0.3),
    horquilla: new THREE.BoxGeometry(0.08, 0.7, 0.08),
    torso: new THREE.CylinderGeometry(0.17, 0.2, 0.6, 7),
    cabeza: new THREE.SphereGeometry(0.17, 7, 7),
    ojo: new THREE.SphereGeometry(0.03, 5, 5)
  };
}
const _forward = new THREE.Vector3();
const _toGhost = new THREE.Vector3();

const PARANOIA_MUTTERINGS = [
  'Dejen de vigilarme, sé quiénes son',
  'Están en las sombras, me tienen acorralado',
  'No me toquen, aléjense de mí',
  '¿Quién anda diciendo mi nombre?',
  'Esos peatones son tombos encubiertos'
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
    this.motosSombra = [];
    this._esperaMoto = 3;
    this.whisperTimer = 5;
    this.heartbeatTimer = 0.8;
    this.spasmTimer = 10;
    this.paranoiaUtteranceTimer = 15;
    this.active = false;
    this.induced = null; // { left, severity, dosis }: paranoia por consumo (basuco), sin abstinencia
    this.ataque = false;  // nivel alto: los hombres sombra atacan
    this._esperaAtaque = 0;
    this._respiro = 0;
    this._ataquePuesto = false;

    // Elementos DOM
    this.overlayEl = null;
    this.voicesEl = null;
    this._initDOM();
  }

  _initDOM() {
    if (typeof document === 'undefined') return;
    this.overlayEl = document.getElementById('psychosis-overlay');
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

  /** Una voz escrita sobre la escena. Si no hay un sitio libre, se calla: nunca tapa cifras ni, en persecución, el centro. */
  _spawnFloatingWhisper() {
    if (typeof document === 'undefined') return;
    const container = this.voicesEl ?? this.overlayEl;
    if (!container || container.querySelectorAll('.hallucination-word').length >= VOCES_A_LA_VEZ) return;

    const wordEl = document.createElement('div');
    wordEl.className = 'hallucination-word';
    wordEl.textContent = VOCES[Math.floor(Math.random() * VOCES.length)];
    wordEl.style.visibility = 'hidden';
    container.appendChild(wordEl);

    const ocupado = [...document.querySelectorAll(NO_TAPAR)].flatMap((e) => {
      const r = e.getBoundingClientRect();
      return r.width && r.height ? [{ x: r.x, y: r.y, w: r.width, h: r.height }] : [];
    });
    const sitio = sitioParaVoz({
      ancho: innerWidth, alto: innerHeight, vozAncho: wordEl.offsetWidth, vozAlto: wordEl.offsetHeight,
      ocupado, persecucion: !!globalThis.window?.__game?.traffic?.inPursuit,
    });
    if (!sitio) { wordEl.remove(); return; }
    wordEl.style.left = `${sitio.x}px`;
    wordEl.style.top = `${sitio.y}px`;
    wordEl.style.visibility = '';
    setTimeout(() => wordEl.remove(), 3400);
  }

  /** Un hombre sombra que ataca: la misma figura, pero se acerca, golpea y se disuelve al recibir un golpe. */
  _createShadowMan(position) {
    const sp = this._createShadowPerson(position);
    if (!sp) return null;
    sp.isShadow = true;
    sp.ataca = true;
    sp.lifetime = ATAQUE.vida;
    sp.fase = 'acercando';
    sp.espera = ATAQUE.preparacion;
    sp.takeHit = () => {
      if (sp.dissolving) return false;
      sp.dissolving = true;
      this._esperaAtaque = ATAQUE.espera;
      return 0;
    };
    return sp;
  }

  _hurtPlayer(sp) {
    const player = this.player, stats = this.stats;
    if (!stats || !player || stats.invulnerable || player.isStunned || player.isSwimming || player.action === 'dormir') return;
    if (stats.salud <= ATAQUE.saludMinima) return;
    if (sp.position.distanceTo(player.position) > ATAQUE.alcance + 0.4) return;
    if (!hasClearCombatLine({ from: sp.position, to: player.position, collisions: player._lastCollisions })) return;
    const damage = Math.round(ATAQUE.danoMin + Math.random() * (ATAQUE.danoMax - ATAQUE.danoMin));
    stats.salud = Math.max(ATAQUE.saludMinima, stats.salud - damage);
    this._respiro = ATAQUE.respiro;
    this.audio?.playThud?.();
    player.receiveHit?.(player.position.clone().sub(sp.position), 1.6, { salud: stats.salud });
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: `Un hombre sombra me golpeó: −${damage} de salud.`, type: 'death' } }));
    }
  }

  /** Persigue y golpea. Devuelve sin hacer nada si el jugador no es un blanco válido. */
  _updateShadowMan(sp, dt, playerPos) {
    const dx = playerPos.x - sp.position.x, dz = playerPos.z - sp.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > ATAQUE.rendicion) { sp.dissolving = true; return; }
    const y = this.world?.active?.getGroundHeight?.(sp.position.x, sp.position.z) ?? sp.baseY;
    sp.baseY = y;
    if (sp.fase === 'acercando') {
      if (dist > ATAQUE.alcance * 0.8) {
        const step = Math.min(dist, ATAQUE.velocidad * dt) / dist;
        sp.position.x += dx * step;
        sp.position.z += dz * step;
      }
      if (dist <= ATAQUE.alcance) { sp.fase = 'preparando'; sp.espera = ATAQUE.preparacion; }
    } else if (sp.fase === 'preparando') {
      sp.espera -= dt;
      if (dist > ATAQUE.alcance + 0.8) sp.fase = 'acercando';
      else if (sp.espera <= 0 && this._respiro <= 0) {
        this._hurtPlayer(sp);
        sp.fase = 'enfriando'; sp.espera = ATAQUE.enfriamiento;
      }
    } else {
      sp.espera -= dt;
      if (sp.espera <= 0) sp.fase = 'acercando';
    }
  }

  /** La silueta de una moto con su jinete, del mismo material oscuro y translúcido que los hombres sombra. Frente hacia +X. */
  _createMotoSombra(playerPos) {
    if (!this.scene) return null;
    const g = motoSombraGeometrias();
    const mat = new THREE.MeshBasicMaterial({ color: 0x050508, transparent: true, opacity: 0 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff1a1a, transparent: true, opacity: 0 });
    const group = new THREE.Group();
    const add = (geometry, material, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    add(g.rueda, mat, 0.75, 0.32, 0); add(g.rueda, mat, -0.75, 0.32, 0);
    add(g.cuerpo, mat, 0, 0.62, 0); add(g.tanque, mat, 0.3, 0.88, 0);
    add(g.horquilla, mat, 0.72, 0.62, 0).rotation.z = -0.3;
    const torso = add(g.torso, mat, -0.1, 1.2, 0); torso.rotation.z = -0.35;
    add(g.cabeza, mat, 0.12, 1.62, 0);
    add(g.ojo, eyeMat, 0.28, 1.64, 0.07); add(g.ojo, eyeMat, 0.28, 1.64, -0.07);
    const angle = Math.random() * Math.PI * 2, [r0, r1] = MOTO_SOMBRA.salida;
    const radius = r0 + Math.random() * (r1 - r0), [v0, v1] = MOTO_SOMBRA.velocidad;
    const start = new THREE.Vector3(playerPos.x + Math.cos(angle) * radius, playerPos.y, playerPos.z + Math.sin(angle) * radius);
    // Cruza cerca de donde está el jugador, con un desvío al azar.
    const aim = (Math.random() - .5) * 24, dir = new THREE.Vector2(-Math.cos(angle), -Math.sin(angle));
    const side = new THREE.Vector2(-dir.y, dir.x).multiplyScalar(aim);
    const heading = new THREE.Vector2(playerPos.x + side.x - start.x, playerPos.z + side.y - start.z).normalize();
    group.position.copy(start);
    group.rotation.y = Math.atan2(-heading.y, heading.x);
    this.scene.add(group);
    return {
      group, mats: [mat, eyeMat], heading, speed: v0 + Math.random() * (v1 - v0), baseY: playerPos.y,
      age: 0, alpha: 0, fase: Math.random() * 6.28, bamboleo: 2 + Math.random() * 3, dissolving: false, origen: start.clone()
    };
  }

  _disposeMotoSombra(m) {
    this.scene?.remove(m.group);
    for (const mat of m.mats) mat.dispose();
  }

  _clearMotosSombra() {
    for (const m of this.motosSombra) this._disposeMotoSombra(m);
    this.motosSombra = [];
  }

  /** Motos sombra: solo en el nivel de ataque, de a una o dos, rápidas y erráticas; ni chocan ni hacen daño. */
  _updateMotosSombra(dt, playerPos) {
    if (this.ataque) {
      this._esperaMoto -= dt;
      if (this._esperaMoto <= 0 && this.motosSombra.length < MOTO_SOMBRA.maxSimultaneas) {
        const moto = this._createMotoSombra(playerPos);
        if (moto) this.motosSombra.push(moto);
        this._esperaMoto = MOTO_SOMBRA.espera[0] + Math.random() * (MOTO_SOMBRA.espera[1] - MOTO_SOMBRA.espera[0]);
      }
    }
    for (let i = this.motosSombra.length - 1; i >= 0; i--) {
      const m = this.motosSombra[i];
      m.age += dt;
      if (!this.ataque || m.age > MOTO_SOMBRA.vida || m.group.position.distanceTo(playerPos) > 120 && m.age > 1) m.dissolving = true;
      // Culebrea de lado a lado, sin mirar nada de lo que hay en el camino.
      const wobble = Math.sin(m.age * m.bamboleo + m.fase);
      const x = m.heading.x - m.heading.y * wobble * 0.6, z = m.heading.y + m.heading.x * wobble * 0.6;
      m.group.position.x += x * m.speed * dt;
      m.group.position.z += z * m.speed * dt;
      m.group.position.y = m.baseY;
      m.group.rotation.y = Math.atan2(-z, x);
      m.group.rotation.x = wobble * 0.25;
      const alpha = m.dissolving ? m.alpha - dt / MOTO_SOMBRA.fundido : Math.min(1, m.age / MOTO_SOMBRA.fundido);
      m.alpha = Math.max(0, alpha);
      m.mats[0].opacity = 0.7 * m.alpha;
      m.mats[1].opacity = m.alpha;
      if (m.dissolving && m.alpha <= 0) {
        this._disposeMotoSombra(m);
        this.motosSombra.splice(i, 1);
      }
    }
  }

  _clearShadowPeople() {
    this._clearMotosSombra();
    for (const sp of this.shadowPeople) {
      this.scene?.remove(sp.group);
      sp.group.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.dispose?.();
      });
    }
    this.shadowPeople = [];
    if (this.player) this.player.extraMeleeTargets = null;
  }

  /**
   * Paranoia sin abstinencia (p. ej. después del basuco): `seconds` de alucinaciones con esta
   * intensidad (0 a 1). Un segundo consumo alarga la que ya está.
   */
  induce(seconds, severity = 0.7) {
    const dosis = (this.induced?.dosis ?? 0) + 1;
    this.induced = {
      left: Math.max(this.induced?.left ?? 0, seconds),
      severity: Math.min(1, Math.max(this.induced?.severity ?? 0, severity) + (dosis > 1 ? 0.08 : 0)),
      dosis
    };
    // los primeros susurros y frases llegan enseguida
    this.whisperTimer = Math.min(this.whisperTimer, 1.5);
    this.paranoiaUtteranceTimer = Math.min(this.paranoiaUtteranceTimer, 5);
  }

  /** Corta la paranoia inducida (dormir, morir, recuperarse) */
  clearInduced() { this.induced = null; this.ataque = false; }

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
        this.ataque = false;
        this._ataquePuesto = false;
        if (typeof document !== 'undefined') {
          this.overlayEl?.classList.remove('active', 'sombras');
          document.body?.classList.remove('voces');
        }
        this._capasPuestas = false;
        if (cameraRig?.camera) {
          cameraRig.camera.fov = cameraRig.baseFov ?? 55;
          cameraRig.camera.updateProjectionMatrix();
        }
      }
      return;
    }

    this.active = true;
    const severity = Math.max(fromWithdrawal ?? 0, fromDrug ?? 0); // 0 a 1

    // Nivel alto: varias dosis seguidas. No arranca en los últimos 8 s, cuando la paranoia ya se apaga.
    const ataque = this.induced != null && this.induced.dosis >= ATAQUE.dosis && this.induced.left > 8;
    if (ataque && !this.ataque) {
      this._esperaAtaque = 2;
      this._respiro = 0;
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('toast', { detail: { text: 'Los hombres sombra vienen por mí.', type: 'warn' } }));
      }
    }
    this.ataque = ataque;
    this._esperaAtaque -= dt;
    this._respiro -= dt;
    if (typeof document !== 'undefined' && this._ataquePuesto !== ataque) {
      this.overlayEl?.classList.toggle('sombras', ataque);
      this._ataquePuesto = ataque;
    }

    // 1. La escena se oscurece por los bordes y el HUD se corre un poco. Sin filtros: la urgencia la dan las voces.
    // Se pone una vez: escribirlo en cada cuadro le pega al navegador aunque no cambie nada.
    if (typeof document !== 'undefined' && !this._capasPuestas) {
      if (!this.overlayEl) this._initDOM();
      this.overlayEl?.classList.add('active');
      document.body?.classList.add('voces');
      this._capasPuestas = true;
    }

    // 2. Distorsión de cámara: una respiración lenta. Nada tiembla: nada oscila a más de 0,5 Hz, y con movimiento reducido
    // la cámara se queda quieta.
    if (cameraRig?.camera) {
      this._movimiento ??= globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };
      const quieto = this._movimiento.matches;
      const time = performance.now();
      cameraRig.camera.fov = (cameraRig.baseFov ?? 55) + (quieto ? 0 : Math.sin(time * RESPIRA_RAD_MS) * 3.2 * severity);
      if (!quieto && severity > 0.6) cameraRig.camera.rotation.z += Math.sin(time * DERIVA_RAD_MS) * 0.012 * severity;
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
      if (this.ataque && this._esperaAtaque <= 0 && this.shadowPeople.filter((sp) => sp.ataca && !sp.dissolving).length < ATAQUE.maxSimultaneos) {
        const angle = Math.random() * Math.PI * 2;
        const [min, max] = ATAQUE.distancia;
        const dist = min + Math.random() * (max - min);
        const spawnX = playerPos.x + Math.cos(angle) * dist;
        const spawnZ = playerPos.z + Math.sin(angle) * dist;
        const spawnY = this.world?.active?.getGroundHeight?.(spawnX, spawnZ) ?? 0;
        const hombre = this._createShadowMan(new THREE.Vector3(spawnX, spawnY, spawnZ));
        if (hombre) { this.shadowPeople.push(hombre); this._esperaAtaque = 1.5; }
      }
      if (this.shadowPeople.filter((sp) => !sp.ataca).length < 3 && Math.random() < 0.025) {
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
        if (sp.ataca && !this.ataque) sp.dissolving = true;
        else if (sp.ataca && !sp.dissolving) this._updateShadowMan(sp, dt, playerPos);

        // Flota meciéndose y mira al jugador
        if (!sp.dissolving) sp.group.position.y = sp.baseY + 0.15 + Math.sin(performance.now() * 0.0013 + sp.phase) * 0.08;
        sp.group.lookAt(playerPos.x, sp.position.y + 1.6, playerPos.z);
        if (sp.fase === 'preparando') sp.group.rotateX(0.5 * Math.sin(Math.min(1, 1 - sp.espera / ATAQUE.preparacion) * Math.PI));

        const distToPlayer = sp.position.distanceTo(playerPos);
        // Si el jugador se acerca demasiado, la sombra expira o la mira de frente un momento, se desvanece
        if (camera && !sp.dissolving) {
          _toGhost.copy(sp.position).setY(sp.position.y + 1.4).sub(camera.position).normalize();
          sp.stared = _toGhost.dot(_forward) > 0.985 ? (sp.stared ?? 0) + dt : 0;
        }
        if (sp.lifetime <= 0 || (!sp.ataca && (distToPlayer < 5.5 || sp.stared > 1))) {
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

    if (playerPos && this.scene) this._updateMotosSombra(dt, playerPos);

    if (this.player) {
      const blancos = this.shadowPeople.filter((sp) => sp.ataca && !sp.dissolving);
      this.player.extraMeleeTargets = blancos.length ? blancos : null;
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
      document.body?.classList.remove('voces');
    }
  }
}
