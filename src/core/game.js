// src/core/Game.js
import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SceneManager } from './Scene.js';
import { CameraRig } from './Camera.js';
import { Clock } from './Clock.js';
import { Input } from './Input.js';

import { World } from '../world/World.js';
import { Player } from '../entities/Player.js';
import { Pickup } from '../entities/Pickup.js';
import { SellPoint } from '../entities/SellPoint.js';
import { Cambuche } from '../entities/Cambuche.js';
import { Shop } from '../entities/Shop.js';
import { Car } from '../entities/Car.js';
import { DrugDealer } from '../entities/DrugDealer.js';
import { CraftingStation } from '../entities/CraftingStation.js';
import { Dog } from '../entities/Dog.js';
import { Cart } from '../entities/Cart.js';
import { CinematicOverlays } from '../ui/CinematicOverlays.js';

import { StatsSystem, NEEDS } from '../systems/StatsSystem.js';
import { TimeSystem } from '../systems/TimeSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { TrafficSystem } from '../systems/TrafficSystem.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { DiseaseSystem } from '../systems/DiseaseSystem.js';
import { TalentSystem } from '../systems/TalentSystem.js';
import { CraftingSystem } from '../systems/CraftingSystem.js';
import { RadioSystem } from '../systems/RadioSystem.js';
import { PoopSystem } from '../systems/PoopSystem.js';
import { PsychosisSystem } from '../systems/PsychosisSystem.js';
import { openRadioModal } from '../ui/RadioModal.js';


import { HUD } from '../ui/HUD.js';
import { PerformanceHUD } from '../ui/PerformanceHUD.js';
import { LocalLights } from './LocalLights.js';
import { loadInBatches, withLoadTimeout } from './Startup.js';
import { paintLoadingFrame } from '../ui/LoadingScreen.js';
import { el, button } from '../ui/dom.js';
import { Menu } from '../ui/Menu.js';
import { createCreator } from '../ui/Creator.js';
import { openRecycler, openShop, openCambuche } from '../ui/placeMenus.js';
import { openPauseMenu } from '../ui/PauseMenu.js';
import { Minimap } from '../ui/Minimap.js';
import { WeatherSystem } from '../world/WeatherSystem.js';
import { DEFAULT_LOOK, normalizeLook } from '../character/look.js';
import { ITEMS, COSTAL_BONUS, isRecyclable } from '../data/items.js';
import { SLEEP } from '../data/cambuche.js';
import { cop } from '../utils/money.js';

import {
  MENTAL_RESTORE_SLEEP, MENTAL_LOW_THRESHOLD,
  INVENTORY_MAX_WEIGHT, WITHDRAWAL
} from '../utils/constants.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new Renderer(canvas);
    this.sceneMgr = new SceneManager();
    this.sceneMgr.scene.environment = this.renderer.createEnvironment();
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
    this.radio = new RadioSystem();

    // Mundo + jugador
    this.world = new World(this.sceneMgr.scene);
    this.player = new Player(this.sceneMgr.scene, this.input, this.stats, this.audio);

    // Sistemas de nuevas mecánicas: Popó y Psicosis por abstinencia
    this.poopSystem = new PoopSystem(
      this.sceneMgr.scene, this.audio, this.inventory, this.stats, this.world
    );
    this.psychosis = new PsychosisSystem(
      this.sceneMgr.scene, this.player, this.stats, this.audio, this.world
    );
    // Interacción
    this.interaction = new InteractionSystem(
      this.player, this.inventory, this.stats, this.audio,
      this.diseases, this.talents, this.crafting
    );

    // HUD, menús y creador de personaje
    this.hud = new HUD();
    this.performanceHUD = new PerformanceHUD();
    this.localLights = new LocalLights(this.sceneMgr.scene);
    this.menu = new Menu();
    this.minimap = new Minimap();
    this.weather = new WeatherSystem(this.sceneMgr.scene);
    this.creator = createCreator({ audio: null });
    try {
      const savedQ = localStorage.getItem('bazuko.graphics_quality');
      if (savedQ) {
        this.renderer.setQuality(savedQ);
        this.sceneMgr.setQuality(savedQ);
      }
    } catch { /* sin almacenamiento */ }
    this.cameraRig.canControl = () => !this.paused && !this.isSleeping &&
      !this.hud._talentOpen && !this.hud._craftOpen && !this.hud._dealerOpen;
    this.hud.setCameraMode(this.cameraRig.mode);
    window.addEventListener('camera-toggle', () => this._toggleCamera());
    window.addEventListener('open-recycler', () => openRecycler(this));
    window.addEventListener('open-shop', (e) => openShop(this, e.detail?.target));
    window.addEventListener('open-cambuche', () => openCambuche(this));
    window.addEventListener('open-pause-menu', () => openPauseMenu(this));
    window.addEventListener('open-radio-modal', () => openRadioModal(this));
    window.addEventListener('audio-toggle', () => this.audio?.toggleMute());
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'KeyV') this._toggleCamera();
      if (e.code === 'KeyP' && !this.paused && this.look) this.editLook();
      if (e.code === 'KeyM' && !this.paused) this._toggleModel();
      if (e.code === 'KeyN' && !this.paused) this.minimap?.toggle();
      if (e.code === 'KeyR' && !this.paused) openRadioModal(this);
      if (e.code === 'Escape' && !e._panelHandled && !this.paused && !this.isSleeping) {
        e._pauseMenuOpened = true;
        openPauseMenu(this);
      }
    });

    // Entidades
    this.pickups = [];
    this.sellPoint = null;
    this.cambuche = null;
    this.shop = null;
    this.cars = [];
    this.traffic = null;
    this.dealer = null;
    this.craftingStation = null;
    this.dog = null;
    this.cart = null;
    this.overlays = new CinematicOverlays();

    // Estado
    this.look = null;       // apariencia + nombre + origen (creador)
    this.built = {};        // piezas del cambuche
    this.costal = false;    // costal grande comprado
    this.isSleeping = false;
    this.deathCount = 0;
    this._deathPending = false;
    this._wasNight = null;

    this._lastTime = performance.now();
    this._running = false;
    this._loading = true;

    window.__game = this;
  }

  start(loading) {
    return this._startPromise ??= this._initialize(loading);
  }

  async _initialize(loading) {
    await loading.stage('Construyendo la ciudad…', 1);
    this.world.loadDistrict('Bogota', this.collisions);
    this._spawnEntities();
    this._registerRenderGroups();

    const district = this.world.active;
    if (district?.reserved) {
      this.player.position.set(
        district.reserved.spawn.x, 0, district.reserved.spawn.z
      );
      this.player.root.position.copy(this.player.position);
    }

    this._loadIfSave();
    if (!this.look) {
      await this._createCharacter(loading);
    }
    await loading.stage('Cargando personajes y sonidos…', 2);
    let modelo = null;
    try { modelo = localStorage.getItem('bazuko.modelo'); } catch { /* sin almacenamiento */ }
    await withLoadTimeout(Promise.all([
      modelo !== 'procedural' ? this.player.setModel('realista') : Promise.resolve(),
      loadInBatches(district?.npcs ?? [], npc => npc.preload(), (done, total) =>
        loading.stage(`Cargando personajes… ${done}/${total}`, 2 + done / total)),
      this.audio.ready
    ]), 'La carga de personajes tardó demasiado.');

    if (this.cameraRig.mode === 'third-person') this.player.root.rotation.y = this.cameraRig.yaw + Math.PI;
    this.cameraRig.follow(this.player.position, 0, this.collisions);
    this.sceneMgr.setTimeOfDay(this.clock.hour);
    this.sceneMgr.followTarget(this.player.position);
    this._wasNight = this.clock.isNight;
    district?.setNightMode?.(this._wasNight);
    this.dealer?.setNight(this._wasNight);
    this.world.update(0, this.player.position, this.cameraRig.camera);
    this.localLights.update(0, this.player.position, (x, z) => district?.getGroundHeight?.(x, z) ?? 0, this.cameraRig.camera);
    await loading.stage('Preparando texturas, luces y shaders…', 4);
    const extraModels = (district?.npcs ?? []).flatMap(npc => [npc.lodChar?.group, npc.fullChar?.group]).filter(Boolean);
    await withLoadTimeout(this.renderer.prepare(this.sceneMgr.scene, this.cameraRig.camera, extraModels), 'La preparación gráfica tardó demasiado.');
    await loading.stage('Preparando el primer fotograma…', 4.8);
    // Estas pasadas preparan sombras, geometría y silueta sin simular ni medir FPS.
    for (let frame = 0; frame < 3; frame++) {
      this.renderer.render(this.sceneMgr.scene, this.cameraRig.camera, this.player.root, [this.sceneMgr.sun]);
      await paintLoadingFrame();
    }
    await this.renderer.waitForGPU();
    await loading.stage('Todo listo', 5);
    this.performanceHUD.metrics.reset();
    this.performanceHUD.nextPaint = 0;
    this.renderer.resolution.resetWindow();
    this.input.keys = {};
    this.input.endFrame();
    this._lastTime = performance.now();
    this._lastRenderTime = undefined;
    this._loading = false;
    this._running = true;
    loading.finish();
    this.audio.startAmbient();
    requestAnimationFrame(this._loop);
  }

  /** Primera vez: abre el creador antes de jugar */
  async _createCharacter(loading = null) {
    const look = await this.creator.open(DEFAULT_LOOK, {
      doneLabel: 'Empezar', onReady: () => loading?.forCreator()
    });
    await this._applyLook(look ?? { ...DEFAULT_LOOK, nombre: 'Parcero' });
    this._save();
  }

  /** Tecla P: cambiar apariencia en cualquier momento */
  async editLook() {
    this.hud?.talentPanel?.classList.remove('open');
    this.hud?.craftPanel?.classList.remove('open');
    this.hud?.dealerPanel?.classList.remove('open');
    if (this.hud) {
      this.hud._talentOpen = false;
      this.hud._craftOpen = false;
      this.hud._dealerOpen = false;
    }
    const look = await this.creator.open(this.look, { doneLabel: 'Guardar' });
    if (look) {
      await this._applyLook(look);
      this._save();
    }
  }

  _applyLook(look) {
    this.look = normalizeLook({ ...look, v: 2 });
    const ready = this.player.setLook(this.look);
    this.interaction.originId = this.look.origen;
    return ready;
  }

  /** Tecla M: alterna personaje realista / procedural (liviano) y lo recuerda */
  async _toggleModel() {
    const next = this.player.modelKind === 'realista' ? 'procedural' : 'realista';
    try { localStorage.setItem('bazuko.modelo', next); } catch { /* sin almacenamiento */ }
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: next === 'realista' ? '🧍 Personaje realista' : '🧸 Personaje liviano (para equipos lentos)', type: 'info' }
    }));
    await this.player.setModel(next);
  }

  _toggleCamera() {
    if (!this.cameraRig.canControl()) return;
    const mode = this.cameraRig.toggle(this.player.root.rotation.y);
    this.cameraRig.follow(this.player.position, 0, this.collisions);
    this.hud.setCameraMode(mode);
  }

  /** El mundo se congela mientras hay un menú o el creador abierto */
  get paused() {
    return this._loading || this._deathPending || this.menu.isOpen || this.creator.isOpen;
  }

  _spawnEntities() {
    this.traffic?.dispose();
    this.traffic = null;
    this.pickups.forEach((p) => p.dispose());
    this.pickups = [];
    this.cars.forEach((c) => c.dispose());
    this.cars = [];
    this.interaction.targets = [];

    const district = this.world.active;
    if (!district || !district.isWalkableAt) {
      console.warn('[Game] Distrito sin isWalkableAt');
      return;
    }

    const findValidSpawn = (exclude = null, minDist = 4) => {
      const TILE_SIZE = 2;
      const mapWidth = district.width ?? district.size ?? 32;
      const mapHeight = district.height ?? district.size ?? 32;
      for (let attempt = 0; attempt < 200; attempt++) {
        const tx = 3 + Math.floor(Math.random() * (mapWidth - 6));
        const tz = 3 + Math.floor(Math.random() * (mapHeight - 6));
        const x = tx * TILE_SIZE;
        const z = tz * TILE_SIZE;
        if (!district.isWalkableAt(x, z)) continue;
        if (district.isNearReserved?.(x, z)) continue;
        let tooClose = false;
        for (const other of [...this.pickups, ...this.cars]) {
          if (other === exclude) continue;
          if (other.position.distanceTo(new THREE.Vector3(x, 0, z)) < minDist) {
            tooClose = true; break;
          }
        }
        if (tooClose) continue;
        return new THREE.Vector3(x, 0, z);
      }
      return new THREE.Vector3(district.reserved?.spawn.x ?? 32, 0, district.reserved?.spawn.z ?? 32);
    };

    // ===== Basura =====
    const grid = district.getSpawnGrid ? district.getSpawnGrid() : [];
    for (let i = grid.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [grid[i], grid[j]] = [grid[j], grid[i]];
    }
    const desired = Math.round(14 * (district.populationScale ?? 1));
    const usedPositions = [];
    for (let i = 0; i < desired; i++) {
      let pos;
      if (usedPositions.length < grid.length) {
        pos = grid[usedPositions.length];
        usedPositions.push(pos);
      } else {
        pos = findValidSpawn();
      }
      const p = new Pickup(this.sceneMgr.scene, pos);
      p.onRespawn = (pickup) => pickup.relocate(findValidSpawn(pickup));
      this.pickups.push(p);
      this.interaction.register(p);
    }

    // ===== Autos (robar retrovisores) =====
    const carCount = Math.round(5 * (district.populationScale ?? 1));
    // parqueados junto al andén y alineados con la calle si el distrito lo sabe; si no, donde se pueda
    const parking = district.getParkingSpots?.() ?? [];
    for (let i = parking.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [parking[i], parking[j]] = [parking[j], parking[i]];
    }
    const placed = [];
    for (let i = 0; i < carCount; i++) {
      let spot = parking.find((p) => placed.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > 8));
      if (spot) placed.push(spot);
      const pos = spot ? new THREE.Vector3(spot.x, 0, spot.z) : findValidSpawn(null, 6);
      const rot = spot ? spot.rot : Math.random() * Math.PI * 2;
      const car = new Car(this.sceneMgr.scene, pos, rot);
      this.cars.push(car);
      this.interaction.register(car);
    }
    if (district.getTrafficRoutes) {
      this.traffic = new TrafficSystem(this.sceneMgr.scene, district.getTrafficRoutes());
    }

    // ===== Puesto de venta =====
    this.sellPoint = new SellPoint(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.sell.x ?? 44, 0,
        district.reserved?.sell.z ?? 16
      )
    );
    this.interaction.register(this.sellPoint);

    // ===== Dealer de sustancias =====
    this.dealer = new DrugDealer(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.dealer?.x ?? 56, 0,
        district.reserved?.dealer?.z ?? 56
      )
    );
    this.interaction.register(this.dealer);

    // ===== Mesa de crafteo =====
    this.craftingStation = new CraftingStation(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.craft?.x ?? 8, 0,
        district.reserved?.craft?.z ?? 8
      )
    );
    this.interaction.register(this.craftingStation);
    // ===== Compañero canino "El Chato" =====
    this.dog = new Dog(this.sceneMgr.scene, new THREE.Vector3(26, 0, 32));
    this.interaction.register(this.dog);

    // ===== Carreta de balineras de reciclaje =====
    this.cart = new Cart(this.sceneMgr.scene, new THREE.Vector3(25, 0, 31));
    this.interaction.register(this.cart);


    // ===== Cambuche (refugio por piezas) =====
    const bedX = district.reserved?.bed.x ?? 16;
    const bedZ = district.reserved?.bed.z ?? 44;
    this.cambuche = new Cambuche(
      this.sceneMgr.scene,
      new THREE.Vector3(bedX, 0, bedZ)
    );
    this.cambuche.group.position.y = district.getGroundHeightUnder?.(this.cambuche.group)
      ?? district.getGroundHeight?.(bedX, bedZ) ?? 0;
    this.cambuche.setBuilt(this.built);
    this.interaction.register(this.cambuche);

    // ===== Tienda La Esquinita =====
    this.shop = new Shop(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.shop?.x ?? 24, 0,
        district.reserved?.shop?.z ?? 28
      )
    );
    this.interaction.register(this.shop);

    // ===== Vendedores ambulantes del distrito (chazas, fritanga) =====
    for (const v of district.vendors ?? []) this.interaction.register(v);
    this.collisions.add(
      this.shop.group,
      new THREE.Vector3(2.4, 2, 1.5),
      new THREE.Vector3(0, 1, -0.7)
    );
  }

  _loadIfSave() {
    const data = this.save.load();
    if (data) {
      this.stats.deserialize(data.stats);
      this.clock.deserialize(data.clock);
      this.inventory.deserialize(data.inventory ?? {});
      this.talents.deserialize(data.talents ?? {});
      this.diseases.deserialize(data.diseases ?? {});
      if (data.player) {
        // partidas de otro mapa: si la posición guardada no es transitable, vuelve al inicio
        const district = this.world.active;
        const position = district?.migrateSavedPosition?.(data.player.pos, data.worldLayoutVersion) ?? data.player.pos;
        const [px, , pz] = position;
        if (!district?.isWalkableAt || district.isWalkableAt(px, pz)) this.player.position.set(...position);
      }
      this.built = data.built ?? {};
      this.costal = !!data.costal;
      this.cambuche?.setBuilt(this.built);
      if (data.look) this._applyLook(data.look);
      if (data.radio) {
        if (typeof data.radio.freq === 'number') this.radio.setFrequency(data.radio.freq);
        if (typeof data.radio.battery === 'number') this.radio.battery = data.radio.battery;
      }
      if (data.dog?.isFriend && this.dog) {
        this.dog.befriend();
      }
      if (data.cart && this.cart) {
        this.cart.loadState(data.cart, this.player, this.inventory);
      }

    }
  }

  _save() {
    this.save.save({
      stats: this.stats.serialize(),
      clock: this.clock.serialize(),
      inventory: this.inventory.serialize(),
      talents: this.talents.serialize(),
      diseases: this.diseases.serialize(),
      player: { pos: this.player.position.toArray() },
      worldLayoutVersion: this.world.active?.layoutVersion ?? 0,
      look: this.look,
      built: this.built,
      costal: this.costal,
      radio: this.radio ? { isOn: this.radio.isOn, freq: this.radio.frequency, battery: this.radio.battery } : null,
      dog: { isFriend: !!this.dog?.isFriend },
      cart: this.cart ? this.cart.saveState() : null
    });
  }

  /** Dormir en el cambuche (requiere la base). De noche hasta las 6:00; de día, siesta de 3 h. */
  sleep() {
    if (this.isSleeping) return;
    if (!this.built.base) {
      window.dispatchEvent(new CustomEvent('sleep-fail', { detail: { reason: 'nobase' } }));
      return;
    }

    this.isSleeping = true;
    window.dispatchEvent(new CustomEvent('sleep-start'));
    this.player.playAction('dormir', 1.6);

    const night = this.clock.isNight;
    const hours = night
      ? (this.clock.hour >= 6 ? 24 - this.clock.hour + 6 : 6 - this.clock.hour)
      : 3;
    const factor = Math.min(1, hours / 8); // una siesta rinde menos
    this.clock.hour += hours;
    while (this.clock.hour >= 24) { this.clock.hour -= 24; this.clock.day += 1; }

    const b = this.built;
    const st = this.stats;
    st.energia = Math.min(100, st.energia + (SLEEP.energia + (b.cama ? SLEEP.energiaCama : 0)) * factor);
    st.salud = Math.min(100, st.salud + (SLEEP.salud + (b.techo ? SLEEP.saludTecho : 0)) * factor);
    st.saludMental = Math.min(100, st.saludMental + (MENTAL_RESTORE_SLEEP + (b.fogon ? SLEEP.animoFogon : 0)) * factor);
    st.vicio = b.vela
      ? Math.min(100, st.vicio + SLEEP.vicioVela)
      : Math.max(0, st.vicio - WITHDRAWAL.vicioDormir * factor);
    if (!b.fogon) st.hambre = Math.max(0, st.hambre - SLEEP.hambreFogon * factor);

    // Sin paredes te pueden robar si duermes de noche
    let robbed = null;
    if (night && !b.paredes && Math.random() < SLEEP.roboProb) {
      const lost = Math.floor(st.dinero * SLEEP.roboDinero);
      st.dinero -= lost;
      for (const it of [...this.inventory.items]) {
        if (isRecyclable(ITEMS[it.id] ?? it)) this.inventory.remove(it.id, Math.ceil(it.qty * SLEEP.roboMaterial));
      }
      robbed = lost;
    }

    this._save();

    setTimeout(() => {
      this.isSleeping = false;
      window.dispatchEvent(new CustomEvent('sleep-end', { detail: { hours: Math.round(hours) } }));
      if (robbed !== null) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: `🚨 Te robaron mientras dormías (${cop(robbed)} y material). Unas paredes ayudarían.`, type: 'death' }
        }));
      }
    }, 1200);
  }

  _handleDeath() {
    if (this._deathPending) return true;
    if (this.stats.salud > 0) return false;

    this._deathPending = true;
    this.deathCount++;
    this.input.keys = {};
    this.input.endFrame();
    this.audio.updateSteps(false, false);
    if (this.interaction.boostActive) this.interaction._endBoost();
    const causes = [];
    for (const [stat, name] of [['sed', 'deshidratación'], ['hambre', 'hambre'],
      ['energia', 'agotamiento'], ['higiene', 'higiene agotada'], ['animo', 'ánimo agotado']]) {
      if (this.stats[stat] <= 0) causes.push(name);
    }
    if (this.stats.inWithdrawal) causes.push('abstinencia');
    if (this.diseases.hasAny) causes.push('enfermedad');
    this.menu.open({
      title: 'Te quedaste sin salud',
      sub: 'La partida está en pausa.',
      ic: 'heart',
      dismissible: false,
      render: () => ({
        body: el('div', {},
          el('p', { text: causes.length ? `Estado al caer: ${causes.join(', ')}.` : 'Tu salud llegó a cero.' }),
          el('p', { text: 'Volverás al cambuche con salud y necesidades recuperadas al menos al 60 %. Perderás la mitad de los tipos de objetos del inventario.' }),
          el('p', { text: 'Come, bebe agua y descansa para mantener tus necesidades. Puedes consumir comida y agua haciendo clic en ellas en el inventario.' })),
        foot: [button('Volver al cambuche', { primary: true, onClick: () => this._respawn() })]
      })
    });
    window.dispatchEvent(new CustomEvent('death'));
    return true;
  }

  _respawn() {
    if (!this._deathPending) return;
    const half = Math.floor(this.inventory.items.length / 2);
    for (let i = 0; i < half; i++) {
      const it = this.inventory.items[0];
      if (it) this.inventory.remove(it.id, it.qty);
    }

    // Recuperar todas las necesidades evita seguir recibiendo daño al reaparecer.
    for (const need of NEEDS) this.stats[need] = Math.max(60, this.stats[need]);
    this.diseases.cureAll();
    this.psychosis?.dispose?.();
    this.poopSystem?.activeProjectiles?.forEach?.(p => p.dispose?.());
    if (this.poopSystem) this.poopSystem.activeProjectiles = [];

    const district = this.world.active;
    if (district?.reserved) {
      this.player.position.set(district.reserved.bed.x, 0, district.reserved.bed.z + 2);
    }
    this.player.root.position.copy(this.player.position);
    this.cameraRig._snap = true;
    this.cameraRig.follow(this.player.position, 0, this.collisions);
    this.interaction.currentTarget = null;
    this.interaction.currentTargetType = null;
    this.input.keys = {};
    this.input.endFrame();
    this._deathPending = false;
    this.menu.close();
  }

  _loop = () => {
    if (!this._running) return;
    requestAnimationFrame(this._loop);

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    if (this.isSleeping || this.paused) {
      this.cameraRig.cancelDrag();
      this.audio.updateSteps(false, false);
      this._renderFrame(now, false);
      this.input.endFrame();
      return;
    }
    if (this._handleDeath()) return;

    // 1. Tiempo
    this.clock.update(dt);
    this.time.update(dt, this.clock);

    // 2. Día/noche: cielo nublado de Bogotá y sol que sigue al jugador (sombras nítidas)
    this.sceneMgr.setTimeOfDay(this.clock.hour, this.weather?.isRaining, this.weather?.wetness);
    this.sceneMgr.followTarget(this.player.position, this.clock.hour);
    this.sceneMgr.update(dt);
    const isNight = this.clock.isNight;
    const isRainingNow = this.weather?.isRaining ?? false;
    if (this._wasNight !== isNight || this._wasRaining !== isRainingNow) {
      this._wasNight = isNight;
      this._wasRaining = isRainingNow;
      this.world.active?.setNightMode?.(isNight);
      this.dealer?.setNight(isNight);
      for (const car of this.cars) car.setNight?.(isNight, isRainingNow);
      if (this.traffic) {
        for (const v of this.traffic.vehicles) v.car?.setNight?.(isNight, isRainingNow);
      }
      if (typeof document !== 'undefined') {
        document.body?.classList?.toggle('night-mode', isNight);
      }
    }

    // 3. Jugador
    this.cameraRig.updateControls(dt, this.input);
    // Actualiza el rumbo antes de calcular WASD en relación con la cámara.
    this.cameraRig.prepareMovement();
    this.player.update(dt, this.cameraRig.camera, this.collisions, (x, z) => this.world.active?.getGroundHeight?.(x, z) ?? 0, this.world.active?.npcs ?? []);

    // 4. Stats
    this.stats.update(dt, this.player, this.diseases, this.clock, this.talents);
    this.radio.update(dt, this.stats, this.dog);
    if (this._handleDeath()) return;

    // 4b. Aplicar bono de peso por talentos
    const maxWeightBonus = this.talents.getEffect('maxWeightBonus', 0);
    const cartBonus = (this.cart?.isAttached) ? this.cart.capacityBonus : 0;
    this.inventory.maxWeight = INVENTORY_MAX_WEIGHT + maxWeightBonus + (this.costal ? COSTAL_BONUS : 0) + cartBonus;
    this.player.load = this.inventory.totalWeight / this.inventory.maxWeight;

    // 5. Debuff por salud mental baja (el desgaste se calcula en StatsSystem).
    if (this.stats.saludMental < MENTAL_LOW_THRESHOLD) {
      this.player.speedMult = 0.6;
    } else {
      this.player.speedMult = 1;
    }

    // 6. Enfermedades
    this.diseases.update(dt);

    // 7. Interacción (basura, autos, recicladora, tienda, cambuche, dealer)
    this.interaction.update(dt, this.input, this.clock);
    if (this._handleDeath()) return;

    // 7b. Mecánica de popó y lanzamiento a peatones
    if (this.input.consumePress('KeyX')) {
      const hasPoop = this.inventory.count('popo') > 0;
      if (hasPoop) {
        this.poopSystem.throwPoop(this.player, this.cameraRig);
      } else {
        this.poopSystem.poop(this.player);
      }
    }
    if (this.input.consumePress('KeyZ')) {
      this.poopSystem.poop(this.player);
    }
    this.poopSystem.update(dt);

    // 7c. Sistema de abstinencia, alucinaciones y psicosis inducida
    this.psychosis.update(dt, this.cameraRig);

    // 8. Mundo
    // La visibilidad de edificios usa la cámara del mismo cuadro.
    this.cameraRig.follow(this.player.position, dt, this.collisions, this.player.speed, this.input.isRunning);
    this.world.update(dt, this.player.position, this.cameraRig.camera);
    this.traffic?.update(dt, { player: this.player.position, pedestrians: this.world.active?.npcs ?? [] });
    this.weather?.update?.(dt, this.player.position, this.world.active);

    // 9. Entidades
    for (const p of this.pickups) p.update(dt);
    for (const c of this.cars) c.update(dt);
    this.cambuche?.update(dt);
    this.dealer?.update(dt);
    this.dog?.update(dt, this.player.position, this.pickups);
    this.cart?.update(dt, this.player, this.audio);

    // 10. Audio
    const moving = this.input.axis.x !== 0 || this.input.axis.z !== 0;
    const groundType = this.world.active?.getGroundTypeAt?.(this.player.position.x, this.player.position.z) ?? 'sidewalk';
    const isRaining = this.weather?.isRaining ?? false;
    this.audio.updateSteps(moving, this.input.isRunning, groundType, isRaining);
    this.audio.updateBoost(this.interaction.boostActive);
    this.overlays?.update?.(dt, this.weather, this.clock, this.psychosis);

    // 12. Render
    this._renderFrame(now, true);

    // 13. UI
    this.minimap?.update?.(this.player.position, this.cameraRig?.yaw ?? 0, this._getPOIs(now), now);
    this.hud.update(
      this.stats, this.clock, this.interaction, this.inventory,
      this.diseases, this.talents, this.crafting, dt
    );

    // 15. Fin de frame
    this.input.endFrame();
  };

  _renderFrame(now, active) {
    const elapsed = this._lastRenderTime === undefined ? 0 : (now - this._lastRenderTime) / 1000;
    this._lastRenderTime = now;
    this.localLights.update(elapsed, this.player.position, (x, z) => this.world.active?.getGroundHeight?.(x, z) ?? 0, this.cameraRig.camera);
    this.renderer.render(this.sceneMgr.scene, this.cameraRig.camera, this.player.root, [this.sceneMgr.sun]);
    if (this.performanceHUD.update(now, this.player.position, this.renderer, active, this.localLights)) {
      this.renderer.adaptResolution(this.performanceHUD.metrics.frameMs);
    } else this.renderer.resolution.resetWindow();
  }

  _getPOIs(now = performance.now()) {
    if (this._lastPOIs && (now - (this._lastPOITime ?? 0) < 350)) {
      if (this.dog?.isFriend && this._dogPOI) {
        this._dogPOI.x = this.dog.position.x;
        this._dogPOI.z = this.dog.position.z;
      }
      return this._lastPOIs;
    }
    this._lastPOITime = now;
    const district = this.world?.active;
    const reserved = district?.reserved;
    if (!reserved) return [];

    this._dogPOI = this.dog?.isFriend ? { name: 'El Chato', icon: '🐕', x: this.dog.position.x, z: this.dog.position.z, color: '#e67e22' } : null;
    this._lastPOIs = [
      { name: 'Cambuche', icon: '⛺', x: this.cambuche?.position?.x ?? this.cambuche?.group?.position?.x ?? reserved.bed.x, z: this.cambuche?.position?.z ?? this.cambuche?.group?.position?.z ?? reserved.bed.z, color: '#ffd166' },
      { name: 'Recicladora', icon: '♻️', x: this.sellPoint?.position?.x ?? this.sellPoint?.group?.position?.x ?? reserved.sell.x, z: this.sellPoint?.position?.z ?? this.sellPoint?.group?.position?.z ?? reserved.sell.z, color: '#2ab7ca' },
      { name: 'Tienda', icon: '🏪', x: this.shop?.position?.x ?? this.shop?.group?.position?.x ?? reserved.shop?.x ?? 34, z: this.shop?.position?.z ?? this.shop?.group?.position?.z ?? reserved.shop?.z ?? 29, color: '#2ecc71' },
      { name: 'Crafteo', icon: '🔨', x: this.craftingStation?.position?.x ?? this.craftingStation?.group?.position?.x ?? reserved.craft?.x ?? 16.5, z: this.craftingStation?.position?.z ?? this.craftingStation?.group?.position?.z ?? reserved.craft?.z ?? 24.5, color: '#e67e22' },
      { name: 'Dealer', icon: '💀', x: this.dealer?.position?.x ?? this.dealer?.group?.position?.x ?? reserved.dealer?.x ?? 56, z: this.dealer?.position?.z ?? this.dealer?.group?.position?.z ?? reserved.dealer?.z ?? 56, color: '#9b59b6' },
      ...(this._dogPOI ? [this._dogPOI] : []),
      ...(this.cart ? [{ name: 'Carreta', icon: '🛒', x: this.cart.position.x, z: this.cart.position.z, color: '#f39c12' }] : [])
    ];
    return this._lastPOIs;
  }

  _registerRenderGroups() {
    const culling = this.renderer.culling, district = this.world.active;
    culling.clear();
    for (const sector of district?.renderSectors ?? []) culling.register(sector);
    for (const object of district?.animated ?? []) culling.register(object, { margin: 1 });
    if (district?.busService) culling.register(district.busService.group, { dynamic: true, margin: .5 });
    for (const car of this.cars) culling.register(car.group, { dynamic: true, margin: .5 });
    for (const { car } of this.traffic?.vehicles ?? []) culling.register(car.group, { dynamic: true, margin: .5 });
  }

  setGraphicsQuality(level) {
    this.renderer.setQuality(level);
    this.sceneMgr.setQuality(level);
    if (level === 'baja') {
      this.world.active?.setWetness?.(0);
    } else if (this.weather) {
      this.world.active?.setWetness?.(this.weather.wetness);
    }
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: `⚡ Calidad gráfica cambiada a: ${level.toUpperCase()}`, type: 'info' }
    }));
  }

  stop() {
    this._running = false;
    this.psychosis?.dispose?.();
    this.poopSystem?.dispose?.();
  }
}
