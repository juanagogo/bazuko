// src/core/Game.js
import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SceneManager } from './Scene.js';
import { CameraRig } from './Camera.js';
import { Clock } from './Clock.js';
import { Input } from './Input.js';

import { World } from '../world/World.js';
import { Dog } from '../entities/Dog.js';
import { CompanionNavigation } from '../systems/CompanionNavigation.js';
import { Minimap } from '../ui/Minimap.js';
import { WorldMap } from '../ui/WorldMap.js';
import { buildCityMap, describeCity } from '../ui/CityMap.js';
import { RouteFinder, routeProgress } from '../systems/RouteFinder.js';
import { WeatherSystem } from '../world/WeatherSystem.js';
import { openPauseMenu } from '../ui/PauseMenu.js';
import { Player } from '../entities/Player.js';
import { Pickup } from '../entities/Pickup.js';
import { TrashContainer } from '../entities/TrashContainer.js';
import { SellPoint } from '../entities/SellPoint.js';
import { Cambuche } from '../entities/Cambuche.js';
import { Shop } from '../entities/Shop.js';
import { Car } from '../entities/Car.js';
import { DrugDealer } from '../entities/DrugDealer.js';
import { CraftingStation } from '../entities/CraftingStation.js';

import { StatsSystem, NEEDS } from '../systems/StatsSystem.js';
import { TimeSystem } from '../systems/TimeSystem.js';
import { SaveSystem } from '../systems/SaveSystem.js';
import { CollisionSystem } from '../systems/CollisionSystem.js';
import { TrafficSystem } from '../systems/TrafficSystem.js';
import { distributeShelterLoot, spreadPickupPositions } from '../systems/ShelterLoot.js';
import { InventorySystem } from '../systems/InventorySystem.js';
import { AudioSystem } from '../systems/AudioSystem.js';
import { InteractionSystem } from '../systems/InteractionSystem.js';
import { DiseaseSystem } from '../systems/DiseaseSystem.js';
import { TalentSystem } from '../systems/TalentSystem.js';
import { CraftingSystem } from '../systems/CraftingSystem.js';
import { RadioSystem } from '../systems/RadioSystem.js';
import { PoopSystem } from '../systems/PoopSystem.js';
import { PsychosisSystem } from '../systems/PsychosisSystem.js';
import { StealSystem } from '../features/steal.js';
import { Pet } from '../features/pet.js';
import { openRadioModal } from '../ui/RadioModal.js';


import { HUD } from '../ui/HUD.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { PerformanceHUD } from '../ui/PerformanceHUD.js';
import { LocalLights } from './LocalLights.js';
import { GRAPHICS_PROFILES } from './GraphicsQuality.js';
import { FrameProfiler } from './FrameProfiler.js';
import { loadInBatches, withLoadTimeout } from './Startup.js';
import { paintLoadingFrame } from '../ui/LoadingScreen.js';
import { el, button } from '../ui/dom.js';
import { Menu } from '../ui/Menu.js';
import { createCreator } from '../ui/Creator.js';
import { openRecycler, openShop, openCambuche } from '../ui/placeMenus.js';
import { DEFAULT_LOOK, normalizeLook } from '../character/look.js';
import { ITEMS, COSTAL_BONUS, isRecyclable } from '../data/items.js';
import { SLEEP, CAMBUCHE } from '../data/cambuche.js';
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
    this.radio.setMasterVolume(this.audio.volume, this.audio.muted);
    window.addEventListener('audio-settings-change', ({ detail }) => this.radio.setMasterVolume(detail.volume, detail.muted));

    // Mundo + jugador
    this.world = new World(this.sceneMgr.scene);
    this.player = new Player(this.sceneMgr.scene, this.input, this.stats);

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

    this.pet = new Pet(this.sceneMgr.scene, this.player);
    this.steal = new StealSystem(this);

    // HUD, menús y creador de personaje
    this.hud = new HUD();
    this.performanceHUD = new PerformanceHUD();
    this.profiler = new FrameProfiler();
    this.localLights = new LocalLights(this.sceneMgr.scene);
    this.renderer.overlayLights = [this.sceneMgr.ambient, this.sceneMgr.sun, ...this.localLights.pool];
    this.menu = new Menu();
    this.minimap = new Minimap();
    // Mapa completo con destino y ruta (K o clic en el radar); se registra antes que las
    // teclas del juego para que Escape y K lo cierren primero.
    this.waypoint = null;
    this.route = null;
    this.worldMap = new WorldMap({
      getState: () => ({
        player: this.player.position, heading: this.player.root.rotation.y, pois: this._getPOIs(),
        route: this.route, waypoint: this.waypoint, remaining: this._routeProgress?.remaining
      }),
      onSelect: (x, z, poi) => this.setWaypoint(x, z, poi?.name),
      onClear: () => this.clearWaypoint()
    });
    this.weather = new WeatherSystem(this.sceneMgr.scene);
    let quality = 'baja';
    try { quality = localStorage.getItem('bazuko.graphics_quality') || quality; } catch { /* sin almacenamiento */ }
    this.setGraphicsQuality(quality, false);
    this.hud.audioBtn?.setAttribute('aria-label', this.audio.isMuted() ? 'Activar sonido' : 'Silenciar sonido');
    if (this.hud.audioBtn) this.hud.audioBtn.textContent = this.audio.isMuted() ? '🔇' : '🔊';
    this.creator = createCreator({ audio: null });
    this.inventoryUI = new InventoryUI(this.inventory, this);
    this.cameraRig.canControl = () => !this.paused && !this.isSleeping &&
      !this.hud._talentOpen && !this.hud._craftOpen && !this.hud._dealerOpen;
    this.hud.setCameraMode(this.cameraRig.mode);
    window.addEventListener('open-pause-menu', () => openPauseMenu(this));
    window.addEventListener('audio-toggle', () => this.audio.toggleMute());
    window.addEventListener('camera-toggle', () => this._toggleCamera());
    window.addEventListener('open-recycler', () => openRecycler(this));
    window.addEventListener('open-shop', (e) => openShop(this, e.detail?.target));
    window.addEventListener('open-cambuche', () => openCambuche(this));
    window.addEventListener('open-radio-modal', () => openRadioModal(this));
    window.addEventListener('open-world-map', () => { if (!this.paused) this.worldMap.open(); });
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'KeyN' && !this.paused) this.minimap.toggle();
      if (e.code === 'KeyK' && !e._panelHandled && !this.paused) this.worldMap.open();
      if (e.code === 'Escape' && !e._panelHandled && !this.paused && !this.isSleeping) openPauseMenu(this);
      if (e.code === 'KeyV') this._toggleCamera();
      if (e.code === 'KeyP' && !this.paused) this.pet?.toggleCustomizationMenu();
      if (e.code === 'KeyM' && !this.paused) this._toggleModel();
      if (e.code === 'KeyR') {
        if (this._radioModalOpen) this.menu.close();
        else if (!this.paused) openRadioModal(this);
      }
    });

    // Entidades
    this.pickups = [];
    this.sellPoint = null;
    this.cambuche = null;
    this.shop = null;
    this.cars = [];
    this.traffic = null;
    this._onVehicleImpact = this._onVehicleImpact.bind(this);
    this.dealer = null;
    this.craftingStation = null;
    this.dog = null;

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
    this._setupMap(this.world.active);

    const district = this.world.active;
    this._loadIfSave();
    // Cada entrada comienza de noche y con lluvia, también al retomar un guardado.
    this.clock.hour = 22;
    if (this.weather) {
      this.weather.setWeather('llovizna', false);
      this.weather.timer = 0;
      this.weather.wetness = .6;
    }
    // Cada entrada a la partida comienza delante del cambuche, incluso si
    // la partida guardada conserva una ubicación anterior de exploración.
    if (district?.reserved) {
      this.player.position.set(
        district.reserved.spawn.x,
        district.getGroundHeight?.(district.reserved.spawn.x, district.reserved.spawn.z) ?? 0,
        district.reserved.spawn.z
      );
      this.player.root.position.copy(this.player.position);
    }

    this.weather?.update(0, this.player.position, this.renderer.quality === 'baja' ? null : district);

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

    await loading.stage('Cargando carros, TransMilenio y cambuche…', 3.2);
    const importedEntities = [
      ...(this.cars ?? []),
      ...(this.traffic?.vehicles ?? []).map(vehicle => vehicle.car),
      ...(district?.busServices ?? [district?.busService]), this.cambuche, ...(this.pickups ?? [])
    ].filter(Boolean);
    await withLoadTimeout(loadInBatches(importedEntities, entity => entity.preloadModel()), 'La carga de vehículos y refugio tardó demasiado.');
    await loading.stage('Preparando estación, lámparas y semáforos…', 3.7);
    await withLoadTimeout(district?.preloadDetails?.() ?? Promise.resolve(), 'La carga del mobiliario urbano tardó demasiado.');
    if (this.traffic) this.traffic.signals = district?.signals;
    this.traffic?.setBus?.(district?.busServices ?? district?.busService);
    if (this.cambuche) this.cambuche.group.position.y = district?.getGroundHeightUnder?.(this.cambuche.group)
      ?? district?.getGroundHeight?.(this.cambuche.position.x, this.cambuche.position.z) ?? 0;
    // Calcular los límites después de reemplazar las carrocerías por los GLB.
    this._registerRenderGroups();

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
    const rain = this.weather?.rainParticles;
    if (rain) rain.visible = true;
    try {
      await withLoadTimeout(this.renderer.prepare(this.sceneMgr.scene, this.cameraRig.camera, extraModels), 'La preparación gráfica tardó demasiado.');
    } finally { if (rain) rain.visible = this.weather.isRaining; }
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

  /** Imagen de calles para radar y mapa, y grilla de rutas a pie del mismo distrito. */
  _setupMap(district) {
    if (!district?.map) return;
    this.routeFinder = new RouteFinder(describeCity(district), (x, z) => district.isWalkableAt?.(x, z) ?? true);
    const cityMap = this.cityMap = buildCityMap(district);
    this.minimap?.setCityMap(cityMap);
    this.worldMap?.setCityMap(cityMap);
  }

  /** Marca un destino desde el mapa y traza la ruta desde el jugador. */
  setWaypoint(x, z, label = null) {
    const target = this.routeFinder?.isWalkable(x, z) ? { x, z } : this.routeFinder?.nearestWalkable(x, z) ?? { x, z };
    const place = this.cityMap?.describe?.(target.x, target.z);
    target.label = label ?? place?.zone ?? place?.street ?? 'Destino';
    this.waypoint = target;
    this._reroute(true);
  }

  clearWaypoint() {
    this.waypoint = null;
    this.route = null;
    this._routeProgress = null;
  }

  _reroute(force = false) {
    if (!this.waypoint) return;
    const now = performance.now();
    if (!force && now - (this._lastReroute ?? 0) < 1000) return;
    this._lastReroute = now;
    const p = this.player.position;
    this.route = this.routeFinder?.find({ x: p.x, z: p.z }, this.waypoint) ?? [{ x: p.x, z: p.z }, this.waypoint];
    this._routeProgress = routeProgress(this.route, p.x, p.z);
  }

  /** Sigue el avance por la ruta: recalcula si te desvías y la quita al llegar. */
  _updateWaypoint() {
    if (!this.waypoint || !this.route) return;
    const p = this.player.position;
    if (Math.hypot(p.x - this.waypoint.x, p.z - this.waypoint.z) < 4) {
      const label = this.waypoint.label;
      this.clearWaypoint();
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: `📍 Llegaste a ${label ?? 'tu destino'}.`, type: 'info' } }));
      return;
    }
    this._routeProgress = routeProgress(this.route, p.x, p.z);
    if (this._routeProgress.offRoute > 6) this._reroute();
  }

  /** El mundo se congela mientras hay un menú o el creador abierto */
  get paused() {
    return this._loading || !!this.worldMap?.isOpen || this._deathPending || this.menu.isOpen || this.creator.isOpen || !!this.inventoryUI?.isOpen || !!this.hud?._talentOpen || !!this.hud?._craftOpen || !!this.hud?._dealerOpen;
  }

  _spawnEntities() {
    this.dog?.destroy();
    this.audio.vehicles?.clear();
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
    const spawnPositions = spreadPickupPositions(grid, (district.width ?? district.size ?? 32) * 2, (district.height ?? district.size ?? 32) * 2);
    const usedPositions = [];
    for (let i = 0; i < desired; i++) {
      let pos;
      if (usedPositions.length < grid.length) {
        pos = spawnPositions[usedPositions.length];
        usedPositions.push(pos);
      } else {
        pos = findValidSpawn();
      }
      const p = new Pickup(this.sceneMgr.scene, pos);
      p.onRespawn = (pickup) => {
        // Reutilizar zonas de basura transitables; evita interiores de edificios.
        const available = grid.filter(point => [...this.pickups, ...this.cars].every(other =>
          other === pickup || point.distanceTo(other.position) >= 4));
        pickup.relocate(available.length ? available[Math.floor(Math.random() * available.length)] : pickup.position);
      };
      this.pickups.push(p);
      this.interaction.register(p);
    }

    distributeShelterLoot(this.pickups);
    // Canecas permanentes en puntos de basura separados de las bolsas y lugares reservados.
    const containerSpots = spawnPositions.filter(point => this.pickups.every(pickup => point.distanceTo(pickup.position) >= 4));
    for (const point of containerSpots.slice(0, 12)) {
      const position = point.clone();
      position.y = district.getGroundHeight?.(position.x, position.z) ?? 0;
      const container = new TrashContainer(this.sceneMgr.scene, position);
      this.pickups.push(container);
      this.interaction.register(container);
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
      this.traffic.setParkedCars(this.cars);
      for (const { car } of this.traffic.vehicles) this.interaction.register(car);
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
    this.dog = new Dog(this.sceneMgr.scene, new THREE.Vector3(bedX + 2, 0, bedZ + 3));
    this.dog.navigation = new CompanionNavigation(district, this.collisions);
    this.dog.resetNear(this.dog.position);
    this.interaction.register(this.dog);
    district.trafficPedestrians = [...(district.npcs ?? []), this.dog];

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
      if (this.dog && data.dog?.isFriend) this.dog.befriend();
      this.cambuche?.setBuilt(this.built);
      if (data.look) this._applyLook(data.look);
      if (data.radio) {
        if (typeof data.radio.freq === 'number') this.radio.setFrequency(data.radio.freq);
        if (typeof data.radio.battery === 'number') this.radio.battery = data.radio.battery;
      }
      if (data.dog?.isFriend && this.dog) {
        this.dog.befriend();
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
      dog: { isFriend: !!this.dog?.isFriend }
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
    this.dog?.restAt(this.player.position);
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
    if (this.dog?.isFriend) st.saludMental = Math.min(100, st.saludMental + 15);
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
      this.dog?.wake();
      window.dispatchEvent(new CustomEvent('sleep-end', { detail: { hours: Math.round(hours) } }));
      if (robbed !== null) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: `🚨 Te robaron mientras dormías (${cop(robbed)} y material). Unas paredes ayudarían.`, type: 'death' }
        }));
      }
    }, 1200);
  }

  _onVehicleImpact({ speed, direction }) {
    if (this._deathPending || this.stats.salud <= 0 || (this._vehicleImpactCooldown ?? 0) > 0) return;
    const damage = Math.min(100, Math.max(4, Math.round(.6 * speed ** 2 + 1.5 * speed)));
    this.stats.salud = Math.max(0, this.stats.salud - damage);
    this.stats.energia = Math.max(0, this.stats.energia - damage * .25);
    this._vehicleImpactCooldown = 1.5;
    this._syncVehicleColliders();
    this.player.receiveVehicleImpact(direction, speed, { collisions: this.collisions });
    if (this.stats.salud === 0) this._deathCause = 'atropello';
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: `Un carro te atropelló: −${damage} de salud.`, type: 'death' }
    }));
  }

  _handleDeath() {
    if (this._deathPending) return true;
    if (this.stats.salud > 0) return false;
    if (this.player.isRagdollActive) return false;

    this._deathPending = true;
    this.deathCount++;
    this.input.keys = {};
    this.input.endFrame();
    this.audio.updateSteps(false, false);
    this.audio.setPaused?.(true);
    if (this.interaction.boostActive) this.interaction._endBoost();
    const causes = [];
    if (this._deathCause) causes.push(this._deathCause);
    for (const [stat, name] of [['sed', 'deshidratación'], ['hambre', 'hambre'],
      ['energia', 'agotamiento'], ['higiene', 'higiene agotada'], ['animo', 'ánimo agotado']]) {
      if (this.stats[stat] <= 0) causes.push(name);
    }
    if (this.stats.inWithdrawal) causes.push('abstinencia');
    if (this.diseases.hasAny) causes.push('enfermedad');
    this.menu.open({
      title: this._deathCause === 'atropello' ? 'Te atropellaron' : 'Te quedaste sin salud',
      sub: 'La partida está en pausa.',
      ic: 'heart',
      dismissible: false,
      render: () => ({
        body: el('div', {},
          el('p', { text: causes.length ? `Estado al caer: ${causes.join(', ')}.` : 'Tu salud llegó a cero.' }),
          el('p', { text: 'Volverás al cambuche con salud y necesidades recuperadas al menos al 60 %. Perderás la mitad de los tipos de objetos del inventario.' }),
          el('p', { text: this._deathCause === 'atropello'
            ? 'Mira ambos sentidos y cruza con distancia: los carros necesitan espacio para frenar.'
            : 'Come, bebe agua y descansa para mantener tus necesidades. Puedes consumir comida y agua haciendo clic en ellas en el inventario.' })),
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
      const spawn = district.reserved.respawn ?? { x: district.reserved.bed.x, z: district.reserved.bed.z + 2 };
      this.player.position.set(spawn.x, district.getGroundHeight?.(spawn.x, spawn.z) ?? 0, spawn.z);
    }
    this.player.root.position.copy(this.player.position);
    this.player.clearVehicleImpact?.();
    if (this.dog?.isFriend) { this.dog.wake(); this.dog.resetNear(this.player.position); }
    this._vehicleImpactCooldown = 1.5;
    this._deathCause = null;
    this.cameraRig._snap = true;
    this.cameraRig.follow(this.player.position, 0, this.collisions);
    this.interaction.currentTarget = null;
    this.interaction.currentTargetType = null;
    this.input.keys = {};
    this.input.endFrame();
    this._deathPending = false;
    this.menu.close();
  }

  _syncVehicleColliders() {
    if (!this.collisions?.setVehicles) return;
    const cars = [...(this.cars ?? [])];
    for (const vehicle of this.traffic?.vehicles ?? []) cars.push(vehicle.car);
    this.collisions.setVehicles(cars, this.world.active?.busServices ?? this.world.active?.busService);
  }

  _loop = () => {
    if (!this._running) return;
    requestAnimationFrame(this._loop);

    const now = performance.now();
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    this.radio?.setPaused(!!(this.isSleeping || globalThis.document?.hidden || (this.paused && !this._radioModalOpen)));
    if (this.isSleeping || this.paused || globalThis.document?.hidden) {
      this.cameraRig.releaseControls();
      this.audio.setPaused(true);
      this.audio.updateSteps(false, false);
      this._renderFrame(now, false);
      this.input.endFrame();
      return;
    }
    // Deja ver el lanzamiento y la caída antes de abrir la recuperación fatal.
    if (this.stats.salud <= 0 && this.player.isRagdollActive) {
      this._syncVehicleColliders();
      this.player.update(dt, this.cameraRig.camera, this.collisions);
      this.world.update(dt, this.player.position, this.cameraRig.camera, this.traffic?.vehicles ?? []);
      this.traffic?.update(dt, { pedestrians: this.world.active?.trafficPedestrians ?? this.world.active?.npcs ?? [] });
      this.cameraRig.follow(this.player.position, dt, this.collisions);
      this.audio.updateSteps(false, false);
      this.audio.updateWorld(dt, this.player.position, this.cameraRig.camera, this.traffic?.vehicles ?? [], this.world.active?.busServices ?? this.world.active?.busService);
      this.audio.setRaining(!!this.weather?.isRaining);
      this._handleDeath();
      this._renderFrame(now, false); this.input.endFrame();
      return;
    }
    if (this._handleDeath()) return;

    this.profiler?.beginFrame();
    // 1. Tiempo
    this._vehicleImpactCooldown = Math.max(0, (this._vehicleImpactCooldown ?? 0) - dt);
    this.clock.update(dt);
    this.time.update(dt, this.clock);

    // 2. Día/noche: cielo nublado de Bogotá y sol que sigue al jugador (sombras nítidas)
    this.sceneMgr.setTimeOfDay(this.clock.hour);
    this.sceneMgr.followTarget(this.player.position);
    const isNight = this.clock.isNight;
    if (this._wasNight !== isNight) {
      this._wasNight = isNight;
      this.world.active?.setNightMode?.(isNight);
      this.dealer?.setNight(isNight);
    }

    // 3. Jugador
    this.cameraRig.updateControls(dt, this.input);
    // Actualiza el rumbo antes de calcular WASD en relación con la cámara.
    this.cameraRig.prepareMovement();
    const previousX = this.player.position.x, previousZ = this.player.position.z;
    this._syncVehicleColliders();
    this.player.update(dt, this.cameraRig.camera, this.collisions);
    if (!this.player.isStunned) {
      const district = this.world.active;
      const ground = district?.getMovementGroundHeight?.(this.player.position.x, this.player.position.z, this.player.position.y)
        ?? district?.getGroundHeight?.(this.player.position.x, this.player.position.z);
      if (Number.isFinite(ground)) this.player.position.y = ground;
      this.player.root.position.y = this.player.position.y;
    }
    this.profiler?.mark('jugadorCamaraColisiones');

    // 4. Stats
    this.stats.update(dt, this.player, this.diseases, this.clock, this.talents);
    this.radio?.update(dt, this.stats, this.dog);
    if (this._handleDeath()) return;

    // 4b. Aplicar bono de peso por talentos
    const maxWeightBonus = this.talents.getEffect('maxWeightBonus', 0);
    this.inventory.maxWeight = INVENTORY_MAX_WEIGHT + maxWeightBonus + (this.costal ? COSTAL_BONUS : 0);
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
    if (!this.player.isStunned) this.interaction.update(dt, this.input, this.clock);
    this.steal?.update(dt);
    this.pet?.update(dt, this.player.position, this.world.active?.npcs ?? []);
    if (this._handleDeath()) return;

    // 7b. Mecánica de popó y lanzamiento a peatones
    if (!this.player.isStunned && this.input.consumePress('KeyX')) {
      const hasPoop = this.inventory.count('popo') > 0;
      if (hasPoop) {
        this.poopSystem.throwPoop(this.player, this.cameraRig);
      } else {
        this.poopSystem.poop(this.player);
      }
    }
    if (!this.player.isStunned && this.input.consumePress('KeyZ')) {
      this.poopSystem.poop(this.player);
    }
    this.poopSystem.update(dt);

    // 7c. Sistema de abstinencia, alucinaciones y psicosis inducida

    // 8. Mundo
    // La visibilidad de edificios usa la cámara del mismo cuadro.
    this.cameraRig.follow(this.player.position, dt, this.collisions, this.player.speed, this.input.isRunning);
    this.psychosis.update(dt, this.cameraRig);
    this.profiler?.mark('sistemas');
    this.world.update(dt, this.player.position, this.cameraRig.camera, this.traffic?.vehicles ?? []);
    this.profiler?.mark('mundoNPC');
    this.traffic?.update(dt, { player: this.player.position, pedestrians: this.world.active?.trafficPedestrians ?? this.world.active?.npcs ?? [], onPlayerHit: this._onVehicleImpact });
    this.profiler?.mark('trafico');
    if (this._handleDeath()) return;

    this.weather?.update(dt, this.player.position, this.renderer.effectiveQuality === 'baja' ? null : this.world.active);

    // 9. Entidades
    for (const p of this.pickups) p.update(dt);
    for (const c of this.cars) c.update(dt);
    for (const { car } of this.traffic?.vehicles ?? []) car.update(dt);
    this.cambuche?.update(dt);
    this.dealer?.update(dt);
    this.dog?.update(dt, this.player.position, this.pickups);

    // 10. Audio
    const moving = !this.player.isStunned && Math.hypot(this.player.position.x - previousX, this.player.position.z - previousZ) > .001;
    this.audio.updateWorld(dt, this.player.position, this.cameraRig.camera, this.traffic?.vehicles ?? [], this.world.active?.busServices ?? this.world.active?.busService);
    this.audio.setRaining(!!this.weather?.isRaining);
    this.audio.updateSteps(moving, this.input.isRunning);
    this.audio.updateBoost(this.interaction.boostActive);
    this.profiler?.mark('entidadesClimaAudio');

    // 12. Render
    this._renderFrame(now, true);
    this.profiler?.mark('envioRenderLucesCulling');

    this._updateWaypoint();
    this.minimap?.update(this.player.position, Math.atan2(this.cameraRig.camera.matrixWorld.elements[8], this.cameraRig.camera.matrixWorld.elements[10]), this._getPOIs(now), now, {
      route: this.route, waypoint: this.waypoint, segment: this._routeProgress?.segment,
      remaining: this._routeProgress?.remaining, heading: this.player.root.rotation.y
    });

    // 13. UI
    this.hud.update(
      this.stats, this.clock, this.interaction, this.inventory,
      this.diseases, this.talents, this.crafting, dt
    );

    // 15. Fin de frame
    this.input.endFrame();
    this.profiler?.mark('interfaz');
    this.profiler?.endFrame();
  };

  getPerformanceReport() {
    return {
      cpu: this.profiler.report(), frames: this.performanceHUD.metrics.recentStats(),
      graphics: { selected: this.renderer.quality, effective: this.renderer.effectiveQuality,
        pixelRatio: this.renderer.instance.getPixelRatio(), ...this.renderer.instance.info.render }
    };
  }

  _renderFrame(now, active) {
    const quality = this.renderer.effectiveQuality;
    if (this._effectiveQuality !== quality) {
      this._effectiveQuality = quality;
      this.sceneMgr.setQuality(quality);
      this.cameraRig.setQuality?.(quality);
      if (this.world.active) this.world.active.animationBudget = GRAPHICS_PROFILES[quality].animationBudget;
      this.world.active?.setWetness?.(quality === 'baja' ? 0 : this.weather?.wetness ?? 0);
    }
    const elapsed = this._lastRenderTime === undefined ? 0 : (now - this._lastRenderTime) / 1000;
    this._lastRenderTime = now;
    this.localLights.update(elapsed, this.player.position, (x, z) => this.world.active?.getGroundHeight?.(x, z) ?? 0, this.cameraRig.camera);
    const showSilhouette = this.collisions.mayOccludePlayer?.(this.cameraRig.camera.position, this.player.position) ?? true;
    this.renderer.render(this.sceneMgr.scene, this.cameraRig.camera, this.player.root, [this.sceneMgr.sun], showSilhouette);
    if (this.performanceHUD.update(now, this.player.position, this.renderer, active, this.localLights)) {
      this.renderer.adaptResolution(this.performanceHUD.metrics.frameMs);
    } else this.renderer.resolution.resetWindow();
  }

  _getPOIs(now = performance.now()) {
    const friend = !!this.dog?.isFriend;
    if (!this._poiCache || now - this._poiCacheTime >= 350 || this._poiDogFriend !== friend) {
      const reserved = this.world?.active?.reserved ?? {};
      const built = CAMBUCHE.filter(piece => this.built?.[piece.id]).length;
      const night = !!this.clock?.isNight;
      // info y acción se muestran en el mapa completo (K) al pasar el ratón o en su lista.
      this._poiCache = [
        [this.cambuche, reserved.bed, 'Cambuche', '⛺', '#ffd166', 'Refugio',
          `Tu refugio: construye piezas con material reciclado y duerme para recuperarte. Piezas: ${built}/${CAMBUCHE.length}.`, 'E: construir o dormir'],
        [this.sellPoint, reserved.sell, 'Recicladora', '♻️', '#2ab7ca', 'Servicios',
          'Compra el cartón, las latas, el vidrio y la chatarra que cargas en el costal.', 'E: vender'],
        [this.shop, reserved.shop, 'Tienda La Esquinita', '🏪', '#2ecc71', 'Comercio',
          'Comida, agua y artículos básicos. Si estás muy sucio no te atienden.', 'E: comprar'],
        [this.craftingStation, reserved.craft, 'Mesa de crafteo', '🔨', '#e67e22', 'Servicios',
          'Fabrica objetos con las recetas que conoces.', 'C: abrir recetas'],
        [this.dealer, reserved.dealer, 'Dealer de El Cartucho', '💀', '#9b59b6', 'Comercio',
          night ? 'Es de noche: vende sustancias y también te las compra.' : 'Vende sustancias; de noche también te las compra.', 'E / Q: tratar']
      ].flatMap(([entity, fallback, name, icon, color, category, info, action]) => {
        const pos = entity?.position ?? fallback;
        return pos ? [{ name, icon, color, category, info, action, x: pos.x, z: pos.z }] : [];
      });
      for (const vendor of this.world?.active?.vendors ?? []) {
        const items = vendor.items.map(id => ITEMS[id]?.name ?? id).join(', ');
        this._poiCache.push({ name: vendor.title, icon: vendor.title.startsWith('Fritanga') ? '🍢' : '🛒', color: '#8fd16a',
          category: 'Comercio', info: `Vendedor ambulante: ${items}.`, action: 'E: comprar', x: vendor.position.x, z: vendor.position.z });
      }
      const active = this.world?.active;
      if (active?.gasStation) this._poiCache.push({ name: 'Gasolinera', icon: '⛽', x: 154, z: 94, color: '#f25b5b', category: 'Lugares',
        info: 'Estación de servicio con cubierta; se puede caminar por debajo.' });
      if (active?.stationGroup) this._poiCache.push({ name: 'Portal del Centro', icon: '🚏', x: 75, z: -2, color: '#e45960', category: 'Lugares',
        info: 'Estación del TransMilenio al norte. Los buses de ambos sentidos paran unos segundos en la isla.' });
      if (active?.colpatria) this._poiCache.push({ name: 'Torre Colpatria', icon: '🏙️', x: 81, z: 154, color: '#ffcb45', category: 'Lugares',
        info: 'Torre de 112 m; el viaducto del TransMilenio la rodea por el occidente.' });
      if (active?.lakePark) this._poiCache.push({ name: 'Parque del Lago', icon: '🌊', x: 138, z: 238, color: '#5ed4dc', category: 'Lugares',
        info: 'Parque grande al sur con lago y palomas. El agua no es transitable.' });
      this._dogPOI = friend ? { name: 'El Chato', icon: '🐕', color: '#e6b566', category: 'Compañero',
        info: 'Tu perro: te sigue y avisa cuando hay basura cerca. Le gusta el pan y el atún.', action: 'E: acariciar' } : null;
      if (this._dogPOI) this._poiCache.push(this._dogPOI);
      this._poiCacheTime = now;
      this._poiDogFriend = friend;
    }
    if (this._dogPOI) Object.assign(this._dogPOI, { x: this.dog.position.x, z: this.dog.position.z });
    return this._poiCache;
  }

  setGraphicsQuality(level, notify = true) {
    const quality = ['baja', 'media', 'alta'].includes(level) ? level : 'alta';
    this.renderer.setQuality(quality);
    this.sceneMgr.setQuality(quality);
    this.cameraRig.setQuality?.(quality);
    this._effectiveQuality = null;
    this.world?.active?.setWetness?.(quality === 'baja' ? 0 : this.weather?.wetness ?? 0);
    if (notify) window.dispatchEvent(new CustomEvent('toast', { detail: { text: 'Calidad gráfica: ' + quality, type: 'info' } }));
  }

  _registerRenderGroups() {
    // Las fuentes de la ciudad y del fogón no cambian de posición; sí de intensidad/visibilidad.
    this.localLights.refreshSources({ static: true });
    const culling = this.renderer.culling, district = this.world.active;
    culling.clear();
    if (this.dog) culling.register(this.dog.group, { dynamic: true, margin: 1 });
    for (const flock of district?.pigeonFlocks ?? []) culling.register(flock.group);
    for (const sector of district?.renderSectors ?? []) culling.register(sector);
    if (district?.signals) culling.register(district.signals.group);
    for (const pickup of this.pickups) culling.register(pickup.group, { dynamic: true, margin: .2 });
    for (const object of district?.animated ?? []) culling.register(object, { margin: 1 });
    for (const bus of district?.busServices ?? [district?.busService].filter(Boolean)) culling.register(bus.group, { dynamic: true, margin: .5 });
    for (const car of this.cars) culling.register(car.group, { dynamic: true, margin: .5 });
    for (const { car } of this.traffic?.vehicles ?? []) culling.register(car.group, { dynamic: true, margin: .5 });
  }

  stop() {
    this._running = false;
    this.pet?.dispose?.();
    this.psychosis?.dispose?.();
    this.poopSystem?.dispose?.();
    this.radio?.destroy?.();
  }
}
