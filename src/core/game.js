// src/core/Game.js
import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SceneManager } from './Scene.js';
import { CameraRig } from './Camera.js';
import { Clock } from './Clock.js';
import { Input } from './Input.js';
import { XRay } from './XRay.js';
import { updateFarolLights } from '../world/props/Farol.js';

import { World } from '../world/World.js';
import { TileFactory } from '../world/tiles/TileFactory.js';
import { Player } from '../entities/Player.js';
import { Pickup } from '../entities/Pickup.js';
import { Tienda } from '../entities/Tienda.js';
import { Contenedores } from '../entities/Contenedor.js';
import { Bed } from '../entities/Bed.js';

const BED_FACING = Math.PI / 2; // +90° (antihorario visto desde arriba) // giro Y del cambuche (ajustar según el frente del modelo)
import { DrugDealer } from '../entities/DrugDealer.js';
import { TransMilenio } from '../entities/BusTM.js';
import { EstacionesTM } from '../entities/EstacionTM.js';
import { Traffic } from '../entities/Traffic.js';
import { Semaforos } from '../entities/Semaforos.js';
import { buildTrafficNet } from '../systems/TrafficNet.js';
import { CraftingStation } from '../entities/CraftingStation.js';

import { StatsSystem } from '../systems/StatsSystem.js';
import { TimeSystem } from '../systems/TimeSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { DiseaseSystem } from '../systems/DiseaseSystem.js';
import { TalentSystem } from '../systems/TalentSystem.js';
import { CraftingSystem } from '../systems/CraftingSystem.js';

import { HUD } from '../ui/HUD.js';
import { PlayerOverhead } from '../ui/PlayerOverhead.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { MinijuegoLimosna } from '../ui/MinijuegoLimosna.js';

import {
  MENTAL_DECAY, MENTAL_DECAY_NIGHT, MENTAL_DECAY_SICK,
  MENTAL_DECAY_HUNGER, MENTAL_RESTORE_SLEEP, MENTAL_LOW_THRESHOLD,
  INVENTORY_MAX_WEIGHT, WORLD_COLS, WORLD_ROWS, WORLD_MIN_X, WORLD_MAX_X, WORLD_MIN_Z, WORLD_MAX_Z,
  XRAY_COLOR, XRAY_COLOR_INTERACT, XRAY_RANGE
} from '../utils/constants.js';

const MAX_DT = 0.05;
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _axisX = new THREE.Vector3(1, 0, 0);
const _axisY = new THREE.Vector3(0, 1, 0);
const num0 = (v) => Number.isFinite(v);
const DEBUG = new URLSearchParams(location.search).has('debug');

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.sceneMgr = new SceneManager();
    this.cameraRig = new CameraRig(this.sceneMgr.scene, canvas);
    this.clock = new Clock();
    this.input = new Input();

    // Sistemas
    this.collisions = new CollisionSystem();
    this.inventory = new InventorySystem();
    this.audio = new AudioSystem();
    this.stats = new StatsSystem();
    this.time = new TimeSystem();
    this.save = new SaveSystem();
    this.diseases = new DiseaseSystem();
    this.talents = new TalentSystem();
    this.crafting = new CraftingSystem();

    // Mundo + jugador
    this.world = new World(this.sceneMgr.scene);
    this.player = new Player(this.sceneMgr.scene, this.input, this.stats);
    this.player.onFootstep = (running, foot) => this.audio.playStep(running, foot);
    // Silueta rayos X: el jugador siempre registrado (solo se pinta donde queda tapado)
    this.xray = new XRay();
    this.xray.register(this.player.root, { color: XRAY_COLOR, maxDistance: Infinity, exempt: true, position: this.player.position });
    // Interacción
    this.interaction = new InteractionSystem(
      this.player, this.inventory, this.stats, this.audio,
      this.diseases, this.talents, this.crafting
    );

    // HUD
    this.hud = new HUD();
    this.overhead = new PlayerOverhead();
    this.inventoryUI = new InventoryUI(this.inventory, this); // panel I/Tab + barra rápida 1-5
    this.inventory.onChange(() => this._queueSave()); // autoguardado diferido al cambiar el inventario
    this.limosna = new MinijuegoLimosna(this); // minijuego "colarse y pedir limosna" en estaciones TM

    // Entidades
    this.pickups = [];
    this.contenedores = null; // contenedores de basura de calle (loot mejor, cooldown largo)
    this.tienda = null; // reemplaza al antiguo SellPoint (punto de venta)
    this.bed = null;
    this.traffic = null; // autos (car1/car2) que circulan por las calles
    this.semaforos = null; // semáforos + líneas de pare
    this.net = null;     // red de tráfico (nodos semaforizados y rutas)
    this.buses = null; // flota TransMilenio (carriles exclusivos de la avenida)
    this.estaciones = null; // estaciones TM (GLB) sobre la zona verde
    this._runOver = null;   // animación de atropello en curso
    this._invuln = 0;       // s de invulnerabilidad a buses tras reaparecer
    this.dealer = null;
    this.craftingStation = null;

    // Estado
    this.isSleeping = false;
    this.deathCount = 0;
    this._wasNight = null;

    this._lastTime = performance.now();
    this._running = false;

    window.__game = this;
  }

  /** @param {object|null} saveData - estado ya cargado (SaveSystem.load) o null = partida nueva */
  start(saveData = null) {
    this._running = true;
    this.world.loadDistrict('ZonaCero', this.collisions);
    this._spawnEntities();

    const district = this.world.active;
    if (district?.reserved) {
      this.player.position.set(
        district.reserved.spawn.x, 0, district.reserved.spawn.z
      );
      this.player.root.position.copy(this.player.position);
    }

    this._loadIfSave(saveData);
    this._startAutosave();
    this.audio.startAmbient();
    this._loop();
  }

  _spawnEntities() {
    this.xray.unregisterTag('ent'); // antes de disponer las entidades (los fantasmas cuelgan de sus meshes)
    this.pickups.forEach((p) => p.dispose());
    this.pickups = [];
    this.contenedores?.dispose();
    this.contenedores = null;
    this.traffic?.dispose();
    this.traffic = null;
    this.semaforos?.dispose();
    this.semaforos = null;
    this.buses?.dispose();
    this.buses = null;
    this.estaciones?.dispose();
    this.estaciones = null;
    this.interaction.targets = [];

    const district = this.world.active;
    if (!district || !district.isWalkableAt) {
      console.warn('[Game] Distrito sin isWalkableAt');
      return;
    }

    const findValidSpawn = (exclude = null, minDist = 4) => {
      const TILE_SIZE = 2;
      for (let attempt = 0; attempt < 200; attempt++) {
        const tx = 3 + Math.floor(Math.random() * (WORLD_COLS - 6));
        const tz = 3 + Math.floor(Math.random() * (WORLD_ROWS - 6));
        const x = tx * TILE_SIZE;
        const z = tz * TILE_SIZE;
        if (!district.isWalkableAt(x, z)) continue;
        if (district.isRestrictedForCars?.(x, z)) continue; // carriles TM / avenida: solo buses
        if (district.reserved) {
          const r = district.reserved;
          const nearReserved =
            Math.hypot(x - r.sell.x, z - r.sell.z) < 6 ||
            Math.hypot(x - r.bed.x, z - r.bed.z) < 6 ||
            Math.hypot(x - r.spawn.x, z - r.spawn.z) < 6 ||
            Math.hypot(x - r.dealer.x, z - r.dealer.z) < 6 ||
            Math.hypot(x - r.craft.x, z - r.craft.z) < 6;
          if (nearReserved) continue;
        }
        let tooClose = false;
        for (const other of this.pickups) {
          if (other === exclude) continue;
          if (other.position.distanceTo(new THREE.Vector3(x, 0, z)) < minDist) {
            tooClose = true; break;
          }
        }
        if (tooClose) continue;
        return new THREE.Vector3(x, 0, z);
      }
      const sp = district.reserved?.spawn;
      return new THREE.Vector3((sp?.x ?? 16) + 4, 0, sp?.z ?? 16);
    };

    // ===== Basura (solo sobre andenes, pegada a la pared) =====
    const spots = district.getSidewalkSpots ? district.getSidewalkSpots() : [];
    const PICKUP_MIN_DIST = 4;
    // Elige un punto de andén libre (lejos de otras bolsas y de la que se reubica)
    const pickSidewalkSpot = (exclude = null) => {
      for (let attempt = 0; attempt < 60 && spots.length; attempt++) {
        const s = spots[Math.floor(Math.random() * spots.length)];
        let ok = true;
        for (const o of this.pickups) {
          if (o === exclude) continue;
          const dx = o.position.x - s.x, dz = o.position.z - s.z;
          if (dx * dx + dz * dz < PICKUP_MIN_DIST * PICKUP_MIN_DIST) { ok = false; break; }
        }
        if (ok) return s;
      }
      return spots.length ? spots[Math.floor(Math.random() * spots.length)] : findValidSpawn(exclude);
    };
    const desired = 24; // 14 en el mundo de 32 tiles; escalado por área (x1.68)
    for (let i = 0; i < desired; i++) {
      const pos = pickSidewalkSpot();
      const p = new Pickup(this.sceneMgr.scene, pos, this.collisions);
      p.onRespawn = (pickup) => pickup.relocate(pickSidewalkSpot(pickup));
      this.pickups.push(p);
      this.interaction.register(p);
      this._xrayInteract(p.mesh, p.position, () => !p.used); // bolsa (no la vaciada)
    }

    // ===== Red de tráfico: buses TM (2 avenidas), semáforos y autos =====
    if (district.avenues) {
      this.net = buildTrafficNet(district.layout, district.avenues);
      this.estaciones = new EstacionesTM(this.sceneMgr.scene, [...district.avenues.H.stations, ...district.avenues.V.stations], this.collisions);
      this.buses = new TransMilenio(this.sceneMgr.scene, district.avenues.all, this.collisions, this.net);
      this.buses.onHit = (bus) => this._startRunOver(bus);
      this.semaforos = new Semaforos(this.sceneMgr.scene, this.net, this.buses.lanes, this.collisions);
      this.traffic = new Traffic(this.sceneMgr.scene, this.net, this.collisions, 16);
      this.traffic.onHit = (car) => this._startRunOver(car);
      for (const c of this.traffic.cars) this.interaction.register(c); // robo de retrovisores a autos detenidos
    }

    // ===== Contenedores de basura (andén, pegados a la pared; loot mejor que las bolsas, cooldown largo) =====
    this.contenedores = new Contenedores(this.sceneMgr.scene, this.collisions);
    for (const c of this.contenedores.build(district, this.pickups.map((p) => p.position), this.semaforos?.poles ?? [])) {
      this.interaction.register(c);
      this._xrayInteract(c.proxy, c.position, () => c.isFull);
    }

    // ===== Tienda (venta): reserved.sell = punto frente a la entrada; el edificio queda detrás (-Z) =====
    this.tienda?.dispose();
    this.tienda = new Tienda(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.sell.x ?? 55, 0,
        district.reserved?.sell.z ?? 8
      )
    );
    this.tienda.addCollision(this.collisions);
    this.interaction.register(this.tienda);
    this._xrayInteract(this.tienda.group, this.tienda.position, null, (m) => this.tienda.xrayParts.includes(m)); // fachada + umbral

    // ===== Dealer de sustancias =====
    this.dealer = new DrugDealer(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.dealer?.x ?? 56, 0,
        district.reserved?.dealer?.z ?? 56
      )
    );
    this.interaction.register(this.dealer);
    this._xrayInteract(this.dealer.group, this.dealer.position);

    // ===== Mesa de crafteo =====
    this.craftingStation = new CraftingStation(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.craft?.x ?? 8, 0,
        district.reserved?.craft?.z ?? 8
      )
    );
    this.interaction.register(this.craftingStation);
    this._xrayInteract(this.craftingStation.group, this.craftingStation.position);

    // ===== Cama / refugio =====
    this.bed = new Bed(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.bed.x ?? 16, 0,
        district.reserved?.bed.z ?? 44
      ),
      // Frente del cambuche hacia el interior del mapa (arriba-derecha desde la esquina)
      BED_FACING
    );
    this.interaction.register(this.bed);
    this._xrayInteract(this.bed.group, this.bed.position);

    this.collisions.add(
      this.bed.group,
      new THREE.Vector3(7.4, 4.2, 7.6),
      new THREE.Vector3(0, 2.1, 0)
    );
  }

  // Silueta amarilla para un interactuable oculto tras obstaculos (solo cerca y mientras sea interactuable)
  _xrayInteract(object, position, isActive = null, filter = null) {
    this.xray.register(object, { color: XRAY_COLOR_INTERACT, maxDistance: XRAY_RANGE, position, isActive, filter, tag: 'ent' });
  }

  // Restaura el estado guardado. Cada bloque es independiente: uno corrupto no impide el resto.
  _loadIfSave(data) {
    if (!data || typeof data !== 'object') return;
    const num = (v) => Number.isFinite(v);
    const tryDo = (name, fn) => { try { fn(); } catch (err) { console.warn('[Save] no se pudo restaurar', name, err); } };

    tryDo('stats', () => this.stats.deserialize(data.stats));
    tryDo('reloj', () => {
      if (data.clock && num(data.clock.day) && num(data.clock.hour)) this.clock.deserialize(data.clock);
    });
    tryDo('inventario', () => this.inventory.deserialize(data.inventory ?? {}));
    tryDo('talentos', () => this.talents.deserialize(data.talents ?? {}));
    tryDo('enfermedades', () => this.diseases.deserialize(data.diseases ?? {}));
    // Un guardado de un mundo de otro tamaño (o anterior a la avenida) no sirve para posiciones
    // (bolsas, autos, jugador): se ignoran y el jugador reaparece en el spawn.
    const sameWorld = data.world?.cols === WORLD_COLS && data.world?.rows === WORLD_ROWS;
    if (!sameWorld) console.info('[Save] guardado de otro tamaño de mundo: posiciones descartadas');
    tryDo('bolsas', () => {
      if (!sameWorld || !Array.isArray(data.pickups)) return;
      this.pickups.forEach((p, i) => p.restoreState(data.pickups[i]));
    });
    tryDo('contenedores', () => {
      if (sameWorld && Array.isArray(data.contenedores)) this.contenedores?.restoreState(data.contenedores);
    });
    tryDo('jugador', () => {
      const pos = data.player?.pos;
      if (sameWorld && Array.isArray(pos) && num(pos[0]) && num(pos[2])) this._placePlayer(pos[0], pos[2], data.player.rot);
    });
  }

  // Coloca al jugador; si la posición guardada ya no es válida (muro/colisión) usa el punto de spawn
  _placePlayer(x, z, rot) {
    const d = this.world.active;
    let ok = d?.isWalkableAt ? d.isWalkableAt(x, z) : true;
    const p = this.player.position;
    if (ok) {
      const fixed = this.collisions.resolveMove(_v0.set(x, 0, z), _v1.set(0, 0, 0), this.player.radius);
      if (d?.isWalkableAt && !d.isWalkableAt(fixed.x, fixed.z)) ok = false;
      else p.set(fixed.x, 0, fixed.z);
    }
    if (!ok && d?.reserved) p.set(d.reserved.spawn.x, 0, d.reserved.spawn.z);
    this.player.root.position.copy(p);
    if (num0(rot)) this.player.root.rotation.y = rot;
  }

  _buildState() {
    return {
      world: { cols: WORLD_COLS, rows: WORLD_ROWS },
      player: { pos: this.player.position.toArray(), rot: this.player.root.rotation.y },
      stats: this.stats.serialize(),
      clock: this.clock.serialize(),
      inventory: this.inventory.serialize(),
      talents: this.talents.serialize(),
      diseases: this.diseases.serialize(),
      pickups: this.pickups.map((p) => p.serialize()),
      contenedores: this.contenedores?.serialize() ?? []
    };
  }

  // Agrupa cambios seguidos del inventario en un solo guardado (silencioso)
  _queueSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => { this._saveTimer = 0; this._save(true); }, 800);
  }

  /** Guarda (IndexedDB + localStorage). No guarda muerto ni durante "Nueva partida". */
  _save(silent = false) {
    if (this._resetting || !this._running || this.stats.salud <= 0) return;
    this.save.save(this._buildState()).then((ok) => {
      if (ok && !silent) window.dispatchEvent(new Event('game-saved'));
    }).catch((err) => console.warn('[Save] fallo al guardar', err));
  }

  _startAutosave() {
    this._autoTimer = setInterval(() => { if (!document.hidden) this._save(false); }, 30000);
    // Al ocultar/cerrar la pestaña: localStorage se escribe de forma síncrona dentro de save()
    this._onHide = () => this._save(true);
    window.addEventListener('pagehide', this._onHide);
    document.addEventListener('visibilitychange', this._onHide);
  }

  /** Borra el guardado y reinicia (el HUD pide confirmación antes). */
  async newGame() {
    this._resetting = true; // evita que autosave/pagehide lo vuelvan a escribir
    clearTimeout(this._saveTimer);
    await this.save.clear();
    location.reload();
  }

  _sleep() {
    if (this.isSleeping) return;
    if (!this.clock.isNight) {
      window.dispatchEvent(new CustomEvent('sleep-fail', {
        detail: { reason: 'day' }
      }));
      return;
    }

    this.isSleeping = true;
    window.dispatchEvent(new CustomEvent('sleep-start'));

    this.clock.hour = 6;
    this.clock.day += 1;

    this.stats.energia = Math.min(100, this.stats.energia + 60);
    this.stats.salud = Math.min(100, this.stats.salud + 20);
    this.stats.saludMental = Math.min(100, this.stats.saludMental + MENTAL_RESTORE_SLEEP);

    this._save(false);

    setTimeout(() => {
      this.isSleeping = false;
      window.dispatchEvent(new CustomEvent('sleep-end'));
    }, 1200);
  }

  _updateMentalHealth(dt) {
    const mentalDecayMult = this.talents.getEffect('mentalDecayMult', 1);
    let decay = MENTAL_DECAY;

    if (this.clock.isNight) decay += MENTAL_DECAY_NIGHT;
    if (this.diseases.hasAny) decay += MENTAL_DECAY_SICK;
    if (this.stats.hambre < 20) decay += MENTAL_DECAY_HUNGER;

    decay *= mentalDecayMult;
    this.stats.saludMental = Math.max(0, this.stats.saludMental - decay * dt);
  }

  _handleDeath() {
    if (this.stats.salud > 0) return;

    this.deathCount++;
    window.dispatchEvent(new CustomEvent('death'));

    const half = Math.floor(this.inventory.items.length / 2);
    for (let i = 0; i < half; i++) {
      const it = this.inventory.items[0];
      if (it) this.inventory.remove(it.id, it.qty);
    }

    this.stats.salud = 30;
    this.stats.hambre = Math.max(20, this.stats.hambre);
    this.stats.sed = Math.max(20, this.stats.sed);
    this.diseases.cureAll();

    const district = this.world.active;
    if (district?.reserved) {
      const spot = district.reserved.bedExit ?? district.reserved.bed;
      this.player.position.set(spot.x, 0, spot.z);
    }
  }

  // ===== Atropello por un bus TransMilenio =====
  // (Distinto de _handleDeath: aquí no baja la salud; el jugador sale despedido, y reaparece junto al
  // cambuche con todo al 100 %, sin enfermedades y con el inventario vacío. El dinero se conserva.)
  _startRunOver(veh) {
    if (this._runOver || this.isSleeping) return;
    const p = this.player.position;
    const hx = veh.hx, hz = veh.hz; // rumbo unitario del vehículo (bus o auto)
    // Lado (perpendicular al rumbo) hacia el que sale despedido: el de su posición respecto al eje del vehículo
    const side = ((p.x - veh.x) * -hz + (p.z - veh.z) * hx) >= 0 ? 1 : -1;
    const sx = Math.max(WORLD_MIN_X + 1, Math.min(WORLD_MAX_X - 1, p.x + hx * 3.5 + -hz * side * 3.2));
    const sz = Math.max(WORLD_MIN_Z + 1, Math.min(WORLD_MAX_Z - 1, p.z + hz * 3.5 + hx * side * 3.2));
    this._runOver = {
      t: 0, dur: 1.6,
      x0: p.x, z0: p.z, x1: sx, z1: sz,
      yaw: Math.atan2(-hx, -hz), // mira hacia el vehículo: cae de espaldas en el sentido del golpe
      label: veh.label || 'el Transmilenio'
    };
    this._prevLocked = this.input.locked;
    this.input.locked = true;
    this.audio.playHit();
    window.dispatchEvent(new CustomEvent('run-over-hit'));
  }

  _updateRunOver(dt) {
    const r = this._runOver;
    r.t += dt;
    const u = Math.min(1, r.t / r.dur);
    const f = Math.min(1, u / 0.55);              // fase de vuelo (parábola) y luego deslizamiento
    const ease = 1 - (1 - f) * (1 - f);
    const root = this.player.root;
    this.player.position.set(r.x0 + (r.x1 - r.x0) * ease, 0, r.z0 + (r.z1 - r.z0) * ease);
    const y = 1.3 * 4 * f * (1 - f);              // arco parabólico (altura máx 1.3)
    const tilt = -(Math.PI / 2) * Math.min(1, u / 0.5); // se tumba boca arriba
    _qYaw.setFromAxisAngle(_axisY, r.yaw);
    _qTilt.setFromAxisAngle(_axisX, tilt);
    root.quaternion.copy(_qYaw).multiply(_qTilt);
    root.position.set(this.player.position.x, y + (u > 0.5 ? 0.15 : 0), this.player.position.z);
    if (r.t >= r.dur) this._finishRunOver();
  }

  _finishRunOver() {
    const label = this._runOver?.label || 'el Transmilenio';
    this._runOver = null;
    const root = this.player.root;
    root.rotation.set(0, 0, 0);
    const d = this.world.active;
    const spot = d?.reserved?.bedExit ?? d?.reserved?.bed ?? d?.reserved?.spawn;
    if (spot) this.player.position.set(spot.x, 0, spot.z);
    root.position.copy(this.player.position);
    // Todo al máximo, sin enfermedades, inventario vacío (el dinero se mantiene)
    const st = this.stats;
    st.hambre = st.sed = st.energia = st.salud = st.higiene = st.animo = 100;
    this.diseases.cureAll();
    this.inventory.clear();
    this.input.locked = !!this._prevLocked;
    this._invuln = 3;
    window.dispatchEvent(new CustomEvent('run-over', { detail: { message: `Te atropelló ${label}... despiertas junto al cambuche, sin tus cosas` } }));
    this._save(false);
  }

  _loop = () => {
    if (!this._running) return;
    requestAnimationFrame(this._loop);

    const now = performance.now();
    // Clamp: tras una pausa/pestaña en segundo plano no hay salto gigante de simulación
    const dt = Math.min((now - this._lastTime) / 1000, MAX_DT);
    this._lastTime = now;

    if (this.isSleeping) {
      this.renderer.render(this.sceneMgr.scene, this.cameraRig.camera);
      this.input.endFrame();
      return;
    }

    // 1. Tiempo
    this.clock.update(dt);
    this.time.update(dt, this.clock);

    // 2. Día/noche: ilumina la escena y atenúa/enciende luces artificiales gradualmente
    const lampLevel = this.sceneMgr.setTimeOfDay(this.clock.hour);
    const activeDistrict = this.world.active;
    if (Math.abs(lampLevel - (this._lampLevel ?? -1)) > 0.003 || this._lampDistrict !== activeDistrict) {
      this._lampLevel = lampLevel;
      this._lampDistrict = activeDistrict;
      TileFactory.setNightLevel(lampLevel);
      this.world.active?.setLampLevel?.(lampLevel);
      this.bed?.setNightLevel(lampLevel);
      this.tienda?.setNightLevel(lampLevel);
      this.semaforos?.setNightLevel(lampLevel);
      this.dealer?.setNightLevel(lampLevel);
    }
    const isNight = this.clock.isNight;
    if (this._wasNight !== isNight) {
      this._wasNight = isNight;
      this.world.active?.setNightMode?.(isNight);
      this.dealer?.setNight(isNight);
    }

    // 3. Jugador (durante el atropello: animación propia, sin control)
    if (this._runOver) this._updateRunOver(dt);
    else this.player.update(dt, this.cameraRig.camera, this.collisions);

    // 4. Stats
    this.stats.update(dt, this.player, this.diseases, this.clock, this.talents);

    // 4b. Aplicar bono de peso por talentos
    const maxWeightBonus = this.talents.getEffect('maxWeightBonus', 0);
    this.inventory.maxWeight = INVENTORY_MAX_WEIGHT + maxWeightBonus;

    // 5. Salud mental
    this._updateMentalHealth(dt);

    // 5b. Debuff por salud mental baja
    if (this.stats.saludMental < MENTAL_LOW_THRESHOLD) {
      this.player.speedMult = 0.6;
    } else {
      this.player.speedMult = 1;
    }

    // 6. Enfermedades
    this.diseases.update(dt);

    // 6b. Estaciones TM: prompt + minijuego de limosna (antes de interaction: esta consume la E)
    this.limosna?.update(dt);

    // 7. Dormir (cerca de la cama)
    const nearBed = this.bed && this.bed.isNear(this.player.position);
    if (nearBed && this.input.consumePress('KeyE')) {
      this._sleep();
    } else {
      this.interaction.update(dt, this.input, this.clock);
    }

    // 8. Mundo
    this.world.update(dt, this.player.position);

    // 9. Entidades
    for (const p of this.pickups) p.update(dt);
    this.contenedores?.update(dt);
    if (this._invuln > 0) this._invuln -= dt;
    const canHit = !this._runOver && this._invuln <= 0;
    this.traffic?.update(dt, this.player.position.x, this.player.position.z, this.player.radius, canHit);
    this.buses?.update(
      dt, this.player.position.x, this.player.position.z, this.player.radius, canHit, this.traffic?.t ?? 0
    );
    this.semaforos?.update(this.traffic?.t ?? 0);
    this.bed?.update(dt);
    this.dealer?.update(dt);

    // 10. Audio
    // (los pasos los dispara Player.onFootstep en cada contacto de pie)
    this.audio.updateBoost(this.interaction.boostActive);

    // 11. Cámara + sombra del sol centrada en el jugador
    this.sceneMgr.followShadow(this.player.position);
    this.cameraRig.follow(this.player.position);
    updateFarolLights(this.player.position, dt); // reparte el pool de luces entre los faroles cercanos
    this.xray.update(this.cameraRig.camera, this.player.position);

    // 12. Render
    this.renderer.render(this.sceneMgr.scene, this.cameraRig.camera);

    // 12b. Diagnostico opcional (?debug en la URL): draw calls / geometrias cada 2 s
    if (DEBUG) this._debugStats(dt);

    // 13. UI
    this.overhead.update(
      this.player.position, this.cameraRig.camera, this.canvas,
      this.interaction.activeView, this.diseases
    );
    this.hud.update(
      this.stats, this.clock, this.interaction, this.inventory,
      this.diseases, this.talents, this.crafting
    );

    // 14. Muerte
    this._handleDeath();

    // 15. Fin de frame
    this.input.endFrame();
  };

  _debugStats(dt) {
    this._dbgT = (this._dbgT || 0) + dt;
    this._dbgF = (this._dbgF || 0) + 1;
    if (this._dbgT < 2) return;
    const i = this.renderer.instance.info;
    console.log(`[debug] fps~${(this._dbgF / this._dbgT).toFixed(0)} calls=${i.render.calls} tris=${i.render.triangles} geos=${i.memory.geometries} tex=${i.memory.textures} progs=${i.programs?.length}`);
    this._dbgT = 0; this._dbgF = 0;
  }

  stop() { this._running = false; }

  dispose() {
    this.stop();
    clearTimeout(this._saveTimer);
    clearInterval(this._autoTimer);
    window.removeEventListener('pagehide', this._onHide);
    document.removeEventListener('visibilitychange', this._onHide);
    this.inventoryUI?.dispose();
    this.limosna?.dispose();
  }
}
