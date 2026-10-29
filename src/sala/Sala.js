// src/sala/Sala.js
// Sala de pruebas: el jugador sobre un piso plano, con la misma cámara, controles y render del juego,
// pero sin ciudad, tráfico ni guardado. Cada prueba (pruebas.js) monta encima solo lo que necesita.
import * as THREE from 'three';
import { Renderer } from '../core/Renderer.js';
import { SceneManager } from '../core/Scene.js';
import { CameraRig } from '../core/Camera.js';
import { Input } from '../core/Input.js';
import { Player } from '../entities/Player.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { normalizeLook } from '../character/look.js';
import { SubstanceEffects } from '../systems/SubstanceEffects.js';
import { PsychosisSystem } from '../systems/PsychosisSystem.js';
import { SUBSTANCE_EFFECTS } from '../data/substanceEffects.js';

// Necesidades llenas; el resto de sistemas que el jugador consulta no existen en la sala.
export function createStats() {
  return {
    hambre: 100, sed: 100, energia: 100, salud: 100, higiene: 100, animo: 100, vicio: 100, saludMental: 100, dinero: 0,
    getSpeedMultiplier: () => 1
  };
}

// Cualquier sonido que pidan el jugador o las entidades se ignora.
const silentAudio = new Proxy({}, { get: () => () => {} });

export class Sala {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.sceneMgr = new SceneManager();
    this.scene = this.sceneMgr.scene;
    this.scene.environment = this.renderer.createEnvironment();
    this.cameraRig = new CameraRig(this.scene, canvas);
    this.cameraRig.mode = 'third-person';
    this._lastTime = 0;
    this.input = new Input();
    this.audio = silentAudio;
    this.stats = createStats();
    this.timeScale = 1;
    this.hour = 13;
    this.npcs = [];
    this.updaters = new Set(); // funciones (dt) que agregan las pruebas
    this.beforeRender = new Set();
    this.afterRender = new Set();

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.92 })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    const grid = new THREE.GridHelper(80, 80, 0x6d737a, 0x4a4f55);
    grid.position.y = 0.002;
    this.scene.add(grid);

    this.player = new Player(this.scene, this.input, this.stats, this.audio);
    this.player.game = this;
    this.player.position.set(0, 0, 0);
    this.player.root.position.copy(this.player.position);
    this.setHour(this.hour);

    // Lo que se consume se ve igual que en el juego: efectos de sustancias y la paranoia del basuco
    this.effects = new SubstanceEffects({ canvas, audio: null });
    this.psychosis = new PsychosisSystem(this.scene, this.player, this.stats, null, null);
    window.addEventListener('substance-consumed', (e) => {
      const paranoia = SUBSTANCE_EFFECTS[e.detail?.id]?.paranoia;
      if (paranoia) this.psychosis.induce(paranoia.seconds, paranoia.severity);
    });
  }

  /** Corta efectos y paranoia (como al dormir en el juego) */
  calm() {
    this.effects.end();
    this.psychosis.clearInduced();
  }

  /** 13 = mediodía, 22 = noche */
  setHour(hour) {
    this.hour = hour;
    this.sceneMgr.setTimeOfDay(hour, { cloudCover: 0.3, rainIntensity: 0, fogDensity: 0.6, flash: 0, wind: null });
  }

  /** Tu personaje de la partida guardada (o el de siempre si no hay partida) */
  async loadSavedLook() {
    let look = null;
    try { look = new SaveSystem().load()?.look ?? null; } catch { /* sin partida */ }
    if (look) await this.player.setLook(normalizeLook({ ...look, v: 2 }));
  }

  /** Cambia el modelo solo en la sala: el del juego (bazuko.modelo) no se toca */
  setModel(kind) {
    try { localStorage.setItem('bazuko.sala.modelo', kind); } catch { /* sin almacenamiento */ }
    return this.player.setModel(kind);
  }

  /** Vuelve al centro de la sala mirando a la cámara */
  resetPlayer() {
    this.player.position.set(0, 0, 0);
    this.player.root.position.copy(this.player.position);
    this.player.velocity?.set(0, 0, 0);
    this.cameraRig._snap = true;
  }

  start() {
    this.cameraRig.follow(this.player.position, 0);
    this._lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }

  _loop = () => {
    requestAnimationFrame(this._loop);
    const now = performance.now();
    const real = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;
    const dt = real * this.timeScale;

    this.cameraRig.updateControls(real, this.input);
    this.cameraRig.prepareMovement();
    // Las caladas, el combo y los efectos corren con `timeScale`; con x30 un cigarrillo dura 20 s.
    this.player.update(dt, this.cameraRig.camera, null, () => 0, this.npcs);
    if (!this.player.isStunned) { this.player.position.y = 0; this.player.root.position.y = 0; }
    for (const npc of this.npcs) npc.update(dt, { player: this.player });
    for (const update of this.updaters) update(dt);
    this.cameraRig.follow(this.player.position, real, null, this.player.speed, this.input.isRunning);
    this.psychosis.update(dt, this.cameraRig);
    this.effects.update(dt);
    this.sceneMgr.followTarget?.(this.player.position, this.hour);
    this.sceneMgr.update?.(dt);
    this.input.endFrame();

    const camera = this.cameraRig.camera;
    for (const fn of this.beforeRender) fn(camera);
    this.effects.beforeRender(camera);
    this.renderer.render(this.scene, camera, this.player.root, [this.sceneMgr.sun]);
    this.effects.afterRender(camera);
    for (const fn of this.afterRender) fn(camera);
  };
}
