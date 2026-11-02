// src/core/Game.js
import * as THREE from 'three';
import { Renderer } from './Renderer.js';
import { SceneManager } from './Scene.js';
import { CameraRig } from './Camera.js';
import { TouchControls } from './TouchControls.js';
import { Clock } from './Clock.js';
import { Input } from './Input.js';

import { World } from '../world/World.js';
import { Dog, DOG_DEFAULT_LOOK, legacyPetLook } from '../entities/Dog.js';
import { CompanionNavigation } from '../systems/CompanionNavigation.js';
import { Minimap, nombreALaVista } from '../ui/Minimap.js';
import { mojarCarton } from '../ui/mojado.js';
import { servicePlaces, needContext, SHOP_PRICES, SHOP_OFFERS } from '../ui/mapServices.js';
import { originEffect } from '../data/origins.js';
import { WaypointBeacon } from '../entities/WaypointBeacon.js';
import { cityMapPlan, cityLandmarks, streetLabels } from '../world/bogota/CityMapRaster.js';
import { WeatherSystem } from '../world/WeatherSystem.js';
import { openPauseMenu } from '../ui/PauseMenu.js';
import { Player } from '../entities/Player.js';
import { Pickup } from '../entities/Pickup.js';
import { TrashContainer } from '../entities/TrashContainer.js';
import { SellPoint } from '../entities/SellPoint.js';
import { Cambuche } from '../entities/Cambuche.js';
import { Shop } from '../entities/Shop.js';
import { Car } from '../entities/Car.js';
import { parkCar } from '../world/bogota/parkedCars.js';
import { DrugDealer } from '../entities/DrugDealer.js';
import { CraftingStation } from '../entities/CraftingStation.js';
import { Cart } from '../entities/Cart.js';
import { CinematicOverlays } from '../ui/CinematicOverlays.js';
import { Momentos, botonDeMuerte, cuerpoDeMuerte, cuerpoDeRecorte } from '../ui/Momentos.js';
import { PrimeraPlana } from '../ui/PrimeraPlana.js';
import { tomarFoto } from '../ui/fotoDeArresto.js';
import { actualizarFrases } from '../ui/frases.js';
import { TILE_SIZE } from '../utils/constants.js';
import {
  calleCercana, consejoDeMuerte, perdidoAlMorir, perdidoEnArresto, pieDeFoto, recorteDeLimpieza,
  sueltaDeArresto, titularDeArresto, tituloDeMuerte, CONSECUENCIAS_RECORTE,
} from '../ui/momentosTextos.js';

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
import { RoadRageSystem } from '../systems/RoadRageSystem.js';
import { LimpiezaSocialSystem } from '../systems/LimpiezaSocialSystem.js';
import { SubstanceEffects } from '../systems/SubstanceEffects.js';
import { SUBSTANCE_EFFECTS } from '../data/substanceEffects.js';
import { StealSystem } from '../features/steal.js';
import { openRadioModal } from '../ui/RadioModal.js';


import { HUD } from '../ui/HUD.js';
import { InventoryUI } from '../ui/InventoryUI.js';
import { createPanelDock } from '../ui/PanelDock.js';
import { PerformanceHUD } from '../ui/PerformanceHUD.js';
import { PhotoMode } from '../ui/PhotoMode.js';
import { WaterEffects } from '../systems/WaterEffects.js';
import { LocalLights } from './LocalLights.js';
import { ContactShadows } from './ContactShadows.js';
import { GRAPHICS_PROFILES } from './GraphicsQuality.js';
import { FrameProfiler } from './FrameProfiler.js';
import { loadTaskGroups, withLoadTimeout } from './Startup.js';
import { paintLoadingFrame } from '../ui/LoadingScreen.js';
import { el } from '../ui/dom.js';
import { Menu } from '../ui/Menu.js';
import { createCreator } from '../ui/Creator.js';
import { openRecycler, openShop, openCambuche } from '../ui/placeMenus.js';
import { DEFAULT_LOOK, normalizeLook } from '../character/look.js';
import { streetWetness } from '../character/streetMaterials.js';
import { ITEMS, COSTAL_BONUS, isForSale } from '../data/items.js';
import { SLEEP } from '../data/cambuche.js';
import { cop } from '../utils/money.js';
import { makeParkedMotos, MOTO_SIZE } from '../world/bogota/motos.js';

import {
  MENTAL_RESTORE_SLEEP, MENTAL_LOW_THRESHOLD,
  INVENTORY_MAX_WEIGHT, WITHDRAWAL
} from '../utils/constants.js';

// Destinos de partidas guardadas antes de que el mapa usara el nombre de cada letrero.
const RENAMED_PLACES = { Recicladora: 'Recicladora El Progreso', Tienda: 'Tienda La Esquinita' };

export class Game {
  constructor(canvas, { animaciones = 'default', modeloRealista = false } = {}) {
    this.modeloRealista = modeloRealista;
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
    window.addEventListener('weather-change', ({ detail }) => this.radio.onWeatherChange(detail));

    // Mundo + jugador
    this.world = new World(this.sceneMgr.scene);
    this.player = new Player(this.sceneMgr.scene, this.input, this.stats, this.audio, { animaciones });
    this.waterEffects = new WaterEffects(this.sceneMgr.scene);
    this.contactShadows = new ContactShadows(this.sceneMgr.scene);
    this._contactShadowFrame = {
      player: this.player,
      groundHeight: (x, z, y) => this.world.active?.getMovementGroundHeight?.(x, z, y) ?? 0,
      getWaterInfo: (x, z) => this.world.active?.getWaterInfo?.(x, z)
    };
    this.inventory.onChange(() => this.player.syncWeapon(this.inventory)); // sin el arma en el costal, vuelve a puños
    this.player.game = this;

    // Sistemas de nuevas mecánicas: Popó y Psicosis por abstinencia
    this.poopSystem = new PoopSystem(
      this.sceneMgr.scene, this.audio, this.inventory, this.stats, this.world
    );
    this.psychosis = new PsychosisSystem(
      this.sceneMgr.scene, this.player, this.stats, this.audio, this.world
    );
    // Conductores que se bajan con una varilla al robarles el retrovisor
    this.roadRage = new RoadRageSystem(this.sceneMgr.scene, { player: this.player, stats: this.stats, audio: this.audio });
    this.roadRage.onPlayerHurt = () => { if (this.stats.salud <= 0) this._deathCause = 'golpiza'; };
    window.addEventListener('mirror-stolen', (e) => this.roadRage?.trigger(e.detail?.car));
    // De noche, a veces, llega la camioneta negra de la «limpieza social»
    this.limpieza = new LimpiezaSocialSystem(this.sceneMgr.scene, { player: this.player, stats: this.stats, audio: this.audio });
    this.limpieza.onPlayerHurt = () => { if (this.stats.salud <= 0) this._deathCause = 'limpieza'; };
    // Imagen y sonido al consumir pegante, pastilla o hierba
    this.substanceEffects = new SubstanceEffects({ canvas, audio: this.audio });
    // el basuco además trae paranoia: sombras, susurros y mirar a los lados
    window.addEventListener('substance-consumed', (e) => {
      const paranoia = SUBSTANCE_EFFECTS[e.detail?.id]?.paranoia;
      if (paranoia) this.psychosis?.induce(paranoia.seconds, paranoia.severity);
    });
    // Interacción
    this.interaction = new InteractionSystem(
      this.player, this.inventory, this.stats, this.audio,
      this.diseases, this.talents, this.crafting
    );
    this.interaction.getTraffic = () => this.traffic;

    this.steal = new StealSystem(this);
    this.interaction.personCloserThan = (distance) => this.steal.personCloserThan(distance);

    // HUD, menús y creador de personaje
    this.hud = new HUD();
    this.tactil = new TouchControls(this);
    this.performanceHUD = new PerformanceHUD();
    this.profiler = new FrameProfiler();
    this.localLights = new LocalLights(this.sceneMgr.scene);
    this.renderer.overlayLights = [this.sceneMgr.ambient, this.sceneMgr.sun, ...this.localLights.pool];
    this.menu = new Menu();
    this.minimap = new Minimap();
    this.weather = new WeatherSystem(this.sceneMgr.scene);
    this.hud.weather = this.weather;
    window.addEventListener('weather-lightning', ({ detail }) => this.audio.playThunder?.(detail?.distance));
    let quality = 'baja';
    try { quality = localStorage.getItem('bazuko.graphics_quality') || quality; } catch { /* sin almacenamiento */ }
    this.setGraphicsQuality(quality, false);
    this.hud.setMuted(this.audio.isMuted());
    this.creator = createCreator({ audio: null });
    this.inventoryUI = new InventoryUI(this.inventory, this);
    this.panelDock = createPanelDock(this);
    this.cameraRig.canControl = () => this.photoMode?.active || (!this.paused && !this.isSleeping &&
      !this.hud._talentOpen && !this.hud._craftOpen && !this.hud._dealerOpen);
    this.cameraRig.allowPointerLock = () => !this.photoMode?.active;
    this.hud.setCameraMode(this.cameraRig.mode);
    window.addEventListener('open-pause-menu', (e) => openPauseMenu(this, e.detail?.tab));
    window.addEventListener('audio-toggle', () => this.audio.toggleMute());
    window.addEventListener('camera-toggle', () => this._toggleCamera());
    window.addEventListener('open-recycler', () => openRecycler(this));
    window.addEventListener('open-shop', (e) => openShop(this, e.detail?.target));
    window.addEventListener('open-cambuche', () => openCambuche(this));
    window.addEventListener('open-mesa', () => { if (!this.hud?._craftOpen) this.hud?.toggleCraftPanel(); });
    window.addEventListener('police-arrest', () => this._policeArrest());
    window.addEventListener('open-radio-modal', () => openRadioModal(this));
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'KeyN' && !this.paused) this.minimap.toggle();
      if (e.code === 'Escape' && !e._panelHandled && !this.paused && !this.isSleeping) openPauseMenu(this);
      if (e.code === 'KeyV') this._toggleCamera();
      if (e.code === 'KeyP' && !this.paused && this.look) this.editLook();
      // La pausa ya abierta atiende M con su propio listener; la marca evita cerrarla en la misma pulsación.
      if (e.code === 'KeyM' && !this.paused && !this.isSleeping) { e._pauseOpened = true; openPauseMenu(this, 'mapa'); }
      if (e.code === 'KeyK' && !this.paused) this._toggleModel();
      if (e.code === 'F3') { e.preventDefault(); this.performanceHUD.toggle(); }
      if ((e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+') && !this.paused) this.minimap.zoomStep(1);
      if ((e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-') && !this.paused) this.minimap.zoomStep(-1);
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
    this.cart = null;
    this.overlays = new CinematicOverlays();
    this.momentos = new Momentos();

    // Estado
    this.look = null;       // apariencia + nombre + origen (creador)
    this.built = {};        // piezas del cambuche
    this.costal = false;    // costal grande comprado
    this.isSleeping = false;
    this.deathCount = 0;
    this._deathPending = false;
    this._arrestPending = false;
    this._wasNight = null;

    this._lastTime = performance.now();
    this._running = false;
    this._loading = true;

    this.photoMode = new PhotoMode(this);

    window.__game = this;
  }

  start(loading) {
    return this._startPromise ??= this._initialize(loading);
  }

  async _initialize(loading) {
    await loading.stage('Construyendo la ciudad…', 1);
    this.world.loadDistrict('Bogota', this.collisions);
    this._spawnEntities();
    this._setupGps();

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

    this.weather?.update(0, this.player.position, this.renderer.quality === 'baja' ? null : district, this.clock);
    streetWetness.value = this.weather?.wetness ?? 0;

    if (!this.look) {
      await this._createCharacter(loading);
    }
    await loading.stage('Cargando personajes, vehículos y ciudad…', 2);
    let modelo = null;
    try { modelo = localStorage.getItem('bazuko.modelo'); } catch { /* sin almacenamiento */ }
    // La vista explícita de animaciones requiere el rig realista. La preferencia
    // guardada sigue disponible cuando se abre el juego con su URL habitual.
    if (this.player.realisticAnimationProfile === 'mixamo-game-preview' || this.modeloRealista) modelo = 'realista';
    const importedEntities = [
      ...(this.cars ?? []),
      ...(this.traffic?.vehicles ?? []).map(vehicle => vehicle.car),
      ...(district?.busServices ?? [district?.busService]), this.cambuche, this.dog, ...(this.pickups ?? [])
    ].filter(Boolean);
    let lastPaint = performance.now();
    await withLoadTimeout(loadTaskGroups([
      [() => modelo !== 'procedural' ? this.player.setModel('realista') : Promise.resolve(),
        () => this.audio.ready],
      [...(district?.npcs ?? []), ...(this.roadRage?.preloadables ?? []), ...(this.limpieza?.preloadables ?? [])].map(npc => () => npc.preload()),
      importedEntities.map(entity => () => entity.preloadModel()),
      [() => district?.preloadDetails?.()]
    ], (done, total) => {
      const text = `Cargando recursos… ${done} de ${total}`;
      const progress = 2 + 1.8 * done / total;
      // Repintar por presupuesto temporal, no dos fotogramas por cada instancia.
      if (performance.now() - lastPaint >= 50) {
        lastPaint = performance.now();
        return loading.stage(text, progress);
      }
      loading.update?.(text, progress);
    }), 'La carga de los recursos de la ciudad tardó demasiado.');
    if (this.traffic) this.traffic.signals = district?.signals;
    this.traffic?.setBus?.(district?.busServices ?? district?.busService);
    if (this.cambuche) this.cambuche.group.position.y = district?.getGroundHeightUnder?.(this.cambuche.group)
      ?? district?.getGroundHeight?.(this.cambuche.position.x, this.cambuche.position.z) ?? 0;
    // Calcular los límites después de preparar los modelos y sus piezas móviles.
    this._registerRenderGroups();

    if (this.cameraRig.mode === 'third-person') this.player.root.rotation.y = this.cameraRig.yaw + Math.PI;
    this.cameraRig.follow(this.player.position, 0, this.collisions);
    this.sceneMgr.setTimeOfDay(this.clock.hour, this.weather, this.clock.day);
    this.sceneMgr.followTarget(this.player.position);
    this._wasNight = this.clock.isNight;
    this._wasLights = this.clock.lightsOn;
    district?.setNightMode?.(this._wasLights);
    this.cambuche?.setNight(this._wasLights);
    for (const car of [...(this.cars ?? []), ...(this.traffic?.vehicles ?? []).map(vehicle => vehicle.car)]) {
      car.setNight?.(this._wasLights, this.weather?.isRaining ?? false, this.weather?.weather === 'niebla');
    }
    this.dealer?.setNight(this._wasNight);
    this.world.update(0, this.player.position, this.cameraRig.camera);
    this.localLights.update(0, this.player.position, (x, z) => district?.getGroundHeight?.(x, z) ?? 0, this.cameraRig.camera);
    await loading.stage('Preparando texturas, luces y shaders…', 4);
    const extraModels = [...(district?.npcs ?? []), ...(this.roadRage?.preloadables ?? []), ...(this.limpieza?.preloadables ?? [])].flatMap(npc => [npc.lodChar?.group, npc.fullChar?.group]).filter(Boolean);
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
    if (this.save?.fueApartada?.()) window.dispatchEvent(new CustomEvent('toast', { detail: { text: 'La partida estaba dañada: quedó aparte y se empieza de nuevo.', type: 'warn' } }));
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

  /** GPS a pie, plano del radar y haz del destino; solo para distritos con grilla de navegación. */
  _setupGps() {
    const district = this.world.active;
    if (!district?.createGpsNavigation) return;
    this.gps = district.createGpsNavigation();
    this.mapPlan = cityMapPlan(district);
    this.minimap?.setRaster(this.mapPlan);
    this.gpsBeacon = new WaypointBeacon(this.sceneMgr.scene);
    try { this.showGpsBeacon = localStorage.getItem('bazuko.gps_beacon') !== 'false'; } catch { this.showGpsBeacon = true; }
  }

  /** Marca un destino y calcula la ruta desde el jugador. */
  setGpsWaypoint(waypoint, { silent = false } = {}) {
    if (!this.gps) return false;
    const ok = this.gps.setWaypoint(waypoint, this.player.position);
    this._syncGpsBeacon();
    if (!silent) {
      const { name } = this.gps.waypoint ?? waypoint;
      window.dispatchEvent(new CustomEvent('toast', { detail: {
        text: ok ? `Ruta marcada: ${nombreALaVista(name ?? 'destino')}` : 'Destino marcado, pero no hay ruta a pie', type: 'info'
      } }));
    }
    return ok;
  }

  clearGpsWaypoint() {
    this.gps?.clear();
    this._syncGpsBeacon();
  }

  setGpsBeaconVisible(visible) {
    this.showGpsBeacon = !!visible;
    try { localStorage.setItem('bazuko.gps_beacon', String(this.showGpsBeacon)); } catch { /* sin almacenamiento */ }
    this._syncGpsBeacon();
  }

  _syncGpsBeacon() {
    const wp = this.showGpsBeacon !== false ? this.gps?.waypoint : null;
    this.gpsBeacon?.set(wp, wp ? this.world.active?.getGroundHeight?.(wp.x, wp.z) ?? 0 : 0);
  }

  /** Yaw de la cámara a partir de su matriz real; sirve en vista isométrica y de tercera persona. */
  _cameraYaw() {
    const e = this.cameraRig.camera.matrixWorld.elements;
    return Math.atan2(e[8], e[10]);
  }

  /** Tecla K: alterna personaje realista / procedural (liviano) y lo recuerda */
  async _toggleModel() {
    const next = this.player.modelKind === 'realista' ? 'procedural' : 'realista';
    try { localStorage.setItem('bazuko.modelo', next); } catch { /* sin almacenamiento */ }
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { text: next === 'realista' ? 'Personaje realista' : 'Personaje liviano (para equipos lentos)', type: 'info' }
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
    return this._loading || this._deathPending || this._arrestPending || !!this.photoMode?.active || this.menu.isOpen || this.creator.isOpen || !!this.inventoryUI?.isOpen || !!this.hud?._talentOpen || !!this.hud?._craftOpen || !!this.hud?._dealerOpen;
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
      // Cada modelo tiene su ancho: se aparta del andén lo que permita el paso de la buseta por el carril.
      if (spot) parkCar(car, spot);
      this.cars.push(car);
      this.interaction.register(car);
    }
    // Motos en batería contra el andén, solo donde no alcanzan el carril: la cola al andén y la trompa algo sesgada.
    this.parkedMotos?.removeFromParent();
    this.parkedMotos?.dispose();
    if (this._motoColliders) {
      const old = this._motoColliders;
      this.collisions.colliders = this.collisions.colliders.filter(entry => !old.has(entry));
      this.collisions.invalidateStaticIndex();
    }
    this._motoColliders = new Set();
    const lanes = [], lanePoint = new THREE.Vector3(), laneDirection = new THREE.Vector3();
    const motoRoutes = district.getTrafficRoutes?.() ?? [];
    for (const route of [...motoRoutes, ...(motoRoutes.alternatives ?? [])]) {
      for (let d = 0; d < route.length; d += 2) { route.sample(d, lanePoint, laneDirection); lanes.push(lanePoint.x, lanePoint.z); }
    }
    const clearOfLanes = (x, z, radius) => {
      for (let i = 0; i < lanes.length; i += 2) if ((lanes[i] - x) ** 2 + (lanes[i + 1] - z) ** 2 < radius * radius) return false;
      return true;
    };
    const motos = [], clusters = [];
    for (const spot of parking) {
      if (clusters.length >= 10) break;
      if (placed.some(q => Math.hypot(spot.x - q.x, spot.z - q.z) < 6) || clusters.some(q => Math.hypot(spot.x - q.x, spot.z - q.z) < 12)) continue;
      const alongZ = Math.abs(spot.rot - Math.PI / 2) < .01, side = Math.sign(alongZ ? spot.x - Math.round(spot.x / 2) * 2 : spot.z - Math.round(spot.z / 2) * 2);
      const curb = .6 - MOTO_SIZE.length / 2 - .12;
      if (!clearOfLanes(alongZ ? spot.x + side * curb : spot.x, alongZ ? spot.z : spot.z + side * curb, 2.2)) continue;
      clusters.push(spot);
      const count = 1 + (clusters.length * 7) % 3;
      for (let i = 0; i < count; i++) {
        const along = (i - (count - 1) / 2) * .95;
        const x = alongZ ? spot.x + side * curb : spot.x + along, z = alongZ ? spot.z + along : spot.z + side * curb;
        const tailToCurb = alongZ ? (side > 0 ? Math.PI : 0) : (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        motos.push({ x, z, rot: tailToCurb + .22, seed: motos.length * 3 + clusters.length, group: clusters.length });
        const holder = new THREE.Object3D();
        holder.position.set(x, 0, z);
        this.collisions.add(holder, new THREE.Vector3(alongZ ? MOTO_SIZE.length * .8 : MOTO_SIZE.width, MOTO_SIZE.height, alongZ ? MOTO_SIZE.width : MOTO_SIZE.length * .8));
        this._motoColliders.add(this.collisions.colliders.at(-1));
      }
    }
    this.parkedMotos = motos.length ? makeParkedMotos(motos) : null;
    if (this.parkedMotos) this.sceneMgr.scene.add(this.parkedMotos);
    if (district.getTrafficRoutes) {
      this.traffic = new TrafficSystem(this.sceneMgr.scene, district.getTrafficRoutes(), { policeCount: 2 });
      this.traffic.setParkedCars(this.cars);
      this.traffic.setEnvironment({
        collisions: this.collisions,
        getGroundHeight: (x, z, y) => district.getMovementGroundHeight?.(x, z, y) ?? district.getGroundHeight?.(x, z) ?? 0,
        getWaterInfo: (x, z) => district.getWaterInfo?.(x, z)
      });
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

    // ===== La mesa =====
    this.craftingStation = new CraftingStation(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.craft?.x ?? 8, 0,
        district.reserved?.craft?.z ?? 8
      )
    );
    this.interaction.register(this.craftingStation);

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
    this.dog = new Dog(this.sceneMgr.scene, new THREE.Vector3(bedX + 2, 0, bedZ + 3));
    this.dog.navigation = new CompanionNavigation(district, this.collisions);
    this.dog.resetNear(this.dog.position);
    this.interaction.register(this.dog);
    district.trafficPedestrians = [...(district.npcs ?? []), this.dog];
    // Pedir limosna requiere personas cerca; El Chato no cuenta.
    this.interaction.setPedestrians(district.npcs ?? []);
    if (this.traffic) this.roadRage?.setup(district, this.traffic, district.trafficPedestrians, { collisions: this.collisions });
    if (this.traffic) this.limpieza?.setup(district, this.traffic.routes, district.trafficPedestrians, { collisions: this.collisions });

    // ===== Tienda La Esquinita =====
    this.shop = new Shop(
      this.sceneMgr.scene,
      new THREE.Vector3(
        district.reserved?.shop?.x ?? 24, 0,
        district.reserved?.shop?.z ?? 28
      )
    );
    this.interaction.register(this.shop);

    // ===== Vendedores ambulantes del distrito (chazas, fritanga) y fogatas de El Cartucho =====
    for (const v of district.vendors ?? []) this.interaction.register(v);
    for (const fb of district.fireBarrels ?? []) this.interaction.register(fb);
    this.collisions.add(
      this.shop.group,
      new THREE.Vector3(2.4, 2, 1.5),
      new THREE.Vector3(0, 1, -0.7)
    );
  }

  /** Una partida que no se deja leer no detiene la carga: se aparta sin borrarla y se juega sin ella. */
  _loadIfSave() {
    try {
      this._aplicarPartida(this.save.load());
    } catch (error) {
      console.warn('[Partida] Dañada: queda aparte y se empieza sin ella.', error);
      this.save.apartar();
      // Lo que alcanzó a aplicarse no sirve: se vuelve a cargar, ya sin ella.
      globalThis.location?.reload?.();
    }
  }

  _aplicarPartida(data) {
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
      if (data.weapon && this.inventory.count(data.weapon) > 0) this.player.equipWeapon(data.weapon);
      this.cambuche?.setBuilt(this.built);
      if (data.look) this._applyLook(data.look);
      if (data.radio) {
        if (typeof data.radio.freq === 'number') this.radio.setFrequency(data.radio.freq);
        if (typeof data.radio.battery === 'number') this.radio.battery = data.radio.battery;
      }
      if (data.dog?.isFriend && this.dog) {
        this.dog.befriend();
      }
      // La apariencia de la antigua mascota personalizable se conserva si la partida aún no tiene una.
      this.dog?.setLook(data.dog?.look ?? legacyPetLook() ?? DOG_DEFAULT_LOOK);
      if (data.cart && this.cart) {
        this.cart.loadState(data.cart, this.player, this.inventory);
      }
      if (data.gps && this.gps) this.setGpsWaypoint({ ...data.gps, name: RENAMED_PLACES[data.gps.name] ?? data.gps.name }, { silent: true });

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
      weapon: this.player.equippedWeapon,
      radio: this.radio ? { isOn: this.radio.isOn, freq: this.radio.frequency, battery: this.radio.battery } : null,
      dog: { isFriend: !!this.dog?.isFriend, look: this.dog?.look ?? null },
      cart: this.cart ? this.cart.saveState() : null,
      gps: this.gps?.serialize() ?? null
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
    if (this.steal?.minigameActive) this.steal._endMinigame(false, 'cancel');
    this.substanceEffects?.end();
    this.psychosis?.clearInduced?.();
    const night = this.clock.isNight;
    const hours = night
      ? (this.clock.hour >= 6 ? 24 - this.clock.hour + 6 : 6 - this.clock.hour)
      : 3;
    window.dispatchEvent(new CustomEvent('sleep-start', { detail: { despierta: this.clock.hour + hours } }));
    this.dog?.restAt(this.player.position);
    this.player.stopSmoking?.();
    this.player.stopBasuco?.();
    this.player.settleForSleep?.();
    this.player.playAction('dormir', 1.6);

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
        if (isForSale(ITEMS[it.id] ?? it, this.player.equippedWeapon)) this.inventory.remove(it.id, Math.ceil(it.qty * SLEEP.roboMaterial));
      }
      robbed = lost;
    }

    // Dormir sucio en un colchón de la calle puede pegar sarna.
    const sarna = this.diseases?.tryInfectWhileSleeping?.(st.higiene, this.interaction?.diseaseResistance?.() ?? 1);

    this._save();

    setTimeout(() => {
      this.isSleeping = false;
      // Despierta y se levanta: lo que quedaba de la acción no debe tenerlo acostado con el juego en marcha.
      if (this.player.action === 'dormir') {
        this.player.action = null;
        this.player.actionTimer = this.player.actionProgress = 0;
      }
      this.dog?.wake();
      window.dispatchEvent(new CustomEvent('sleep-end', { detail: { hours: Math.round(hours) } }));
      if (robbed !== null) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: `Me robaron mientras dormía (${cop(robbed)} y material). Unas paredes ayudarían.`, type: 'death' }
        }));
      }
      if (sarna) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: 'Dormí sucio y me pegó la sarna. La pomada la quita.', type: 'warn' }
        }));
      }
    }, 1200);
  }

  /** ¿Está el jugador a menos de `radius` m del cambuche? */
  _nearCambuche(radius) {
    const c = this.cambuche?.position;
    return !!c && Math.hypot(this.player.position.x - c.x, this.player.position.z - c.z) < radius;
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
      detail: { text: `Me atropelló un carro: −${damage} de salud.`, type: 'death' }
    }));
  }

  _handleDeath() {
    if (this._deathPending || this._arrestPending) return true;
    if (this.stats.salud > 0) return false;
    if (this.player.isRagdollActive) return false;

    this._deathPending = true;
    if (this.steal?.minigameActive) this.steal._endMinigame(false, 'cancel');
    this.substanceEffects?.end();
    this.psychosis?.clearInduced?.();
    this.deathCount++;
    this.input.keys = {};
    this.input.endFrame();
    this.audio.updateSteps(false, false);
    this.audio.setPaused?.(true);
    if (this.interaction.boostActive) this.interaction._endBoost();
    const causa = this._deathCause;
    const salir = () => this._respawn();
    if (causa === 'limpieza') {
      const texto = recorteDeLimpieza(this.look, this._calleCercana());
      this.menu.open({
        title: tituloDeMuerte(causa, this.stats), ic: 'heart', dismissible: false, momento: 'recorte',
        render: () => ({
          body: cuerpoDeRecorte(texto),
          foot: [el('p', { class: 'momento__consecuencias', text: CONSECUENCIAS_RECORTE }), botonDeMuerte(salir)],
        }),
      });
    } else {
      const perdido = perdidoAlMorir(this.inventory?.items, ITEMS);
      this.menu.open({
        title: tituloDeMuerte(causa, this.stats), ic: 'heart', dismissible: false, momento: 'muerte',
        render: () => ({
          body: cuerpoDeMuerte({ perdido, consejo: consejoDeMuerte(causa, this.stats) }),
          foot: [botonDeMuerte(salir)],
        }),
      });
    }
    window.dispatchEvent(new CustomEvent('death'));
    return true;
  }

  _policeArrest() {
    if (this._arrestPending || this._deathPending || this.stats.salud <= 0) return;
    this._arrestPending = true;
    if (this.steal?.minigameActive) this.steal._endMinigame(false, 'cancel');
    this.input.keys = {};
    this.input.endFrame();
    this.audio.updateSteps(false, false);
    this.audio.setPaused?.(true);
    if (this.interaction.boostActive) this.interaction._endBoost();
    const titular = titularDeArresto(this.look, this._calleCercana());
    const perdido = perdidoEnArresto(this.stats.dinero, this.inventory?.items, ITEMS);
    let plana = null;
    this.menu.open({
      title: 'Te atrapó la Policía', ic: 'alert', dismissible: false, momento: 'plana',
      onClose: () => plana?.soltar(),
      render: () => {
        plana ??= new PrimeraPlana({
          titular, perdido, pie: pieDeFoto(this.look), suelta: sueltaDeArresto(this.look),
        });
        return {
          body: plana.nodo,
          foot: [plana.cuenta, el('button', { type: 'button', class: 'cinta cinta--verbo', onclick: () => this._finishArrest() }, 'Continuar')],
        };
      },
    });
    plana?.puesta();
    // El último cuadro, una sola vez: se copia justo después de dibujarlo.
    this._trasRender = () => {
      const foto = tomarFoto({ renderer: this.renderer, scene: this.sceneMgr.scene, jugador: this.player, collisions: this.collisions });
      plana?.capturar(foto?.calle ?? this.canvas, foto?.camara ?? this.cameraRig?.camera, this.player, foto?.figura);
    };
    this._nextPausedRender = 0;
  }

  /** La vía más cercana donde está el jugador, como se dice en la calle. */
  _calleCercana() {
    const district = this.world?.active;
    const { x, z } = this.player?.position ?? { x: 0, z: 0 };
    const esCalzada = district?.tileTypeAt
      ? (px, pz) => district.tileTypeAt(Math.round(px / TILE_SIZE), Math.round(pz / TILE_SIZE)) === 'road'
      : null;
    return calleCercana(x, z, streetLabels(TILE_SIZE), esCalzada);
  }

  _randomWalkablePosition() {
    const district = this.world.active;
    const fallback = district?.reserved?.respawn ?? district?.reserved?.spawn ?? { x: 32, z: 32 };
    // Andenes, plazas y parques lejos de los sitios reservados del barrio.
    const grid = district?.getSpawnGrid?.() ?? [];
    const spot = grid.length ? grid[Math.floor(Math.random() * grid.length)] : fallback;
    const y = district?.getMovementGroundHeight?.(spot.x, spot.z, 0)
      ?? district?.getGroundHeight?.(spot.x, spot.z) ?? 0;
    return new THREE.Vector3(spot.x, y, spot.z);
  }

  /** Muerte y arresto comparten la limpieza de acciones, agua y persecuciones. */
  _resetAfterRelocation() {
    if (this.hud?._dealerOpen) this.hud.toggleDealerPanel();
    this.player.stopSmoking?.();
    this.player.stopBasuco?.();
    this.player.clearVehicleImpact?.();
    this.player.resetGrounding?.();
    this.player.action = null;
    this.player.actionTimer = this.player.actionProgress = 0;
    this.waterEffects?.reset();
    this._swimSoundTimer = 0;
    this.traffic?.endPursuit?.();
    this.roadRage?.reset();
    this.limpieza?.reset();
    this.momentos?.reset();
    this.substanceEffects?.end();
    this.psychosis?.clearInduced?.();
    if (this.steal) {
      this.steal._endMinigame?.(false, 'cancel');
      this.steal.targetNpc = null;
      this.steal.buscado = 0;
    }
    this._vehicleImpactCooldown = 1.5;
  }

  _finishArrest() {
    if (!this._arrestPending) return;
    this.inventory.clear();
    this.stats.dinero = 0;
    const pos = this._randomWalkablePosition();
    this.player.position.copy(pos);
    this.player.root.position.copy(this.player.position);
    this._resetAfterRelocation();
    if (this.dog?.isFriend) { this.dog.wake(); this.dog.resetNear(this.player.position); }
    this.cameraRig._snap = true;
    this.cameraRig.follow(this.player.position, 0, this.collisions);
    this.interaction.currentTarget = null;
    this.interaction.currentTargetType = null;
    this.input.keys = {};
    this.input.endFrame();
    this._arrestPending = false;
    this.menu.close();
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
      const y = district.getMovementGroundHeight?.(spawn.x, spawn.z, 0)
        ?? district.getGroundHeight?.(spawn.x, spawn.z) ?? 0;
      this.player.position.set(spawn.x, y, spawn.z);
    }
    this.player.root.position.copy(this.player.position);
    this._resetAfterRelocation();
    if (this.dog?.isFriend) { this.dog.wake(); this.dog.resetNear(this.player.position); }
    this._vehicleImpactCooldown = 1.5;
    if (this._deathCause === 'limpieza') this.momentos?.guardarConsejoDeCamioneta();
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

  _loop = (stamp) => {
    if (!this._running) return;
    requestAnimationFrame(this._loop);

    const now = performance.now();
    // El intervalo entre cuadros se mide con el sello de rAF: el reloj al entrar aquí oscila y cuenta como lentitud lo que no lo es.
    this._frameStamp = stamp ?? now;
    const dt = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    this.radio?.setPaused(!!(this.isSleeping || globalThis.document?.hidden || (this.paused && !this._radioModalOpen)));
    if (this.photoMode?.active && !globalThis.document?.hidden) {
      this.audio.setPaused(true);
      this.audio.updateSteps(false, false);
      this.performanceHUD.metrics.sample(now, false);
      this.renderer.resolution.resetWindow();
      this.photoMode.update(dt);
      this._renderFrame(now, false);
      this.input.endFrame();
      return;
    }
    if (this.isSleeping || this.paused || globalThis.document?.hidden) {
      // La tienda del Dealer pausa la simulación, así que InteractionSystem ya no oye Q ni E.
      if (this.hud._dealerOpen && (this.input.consumePress('KeyE') || this.input.consumePress('KeyQ'))) this.hud.toggleDealerPanel();
      this.cameraRig.releaseControls();
      this.audio.setPaused(true);
      this.audio.updateSteps(false, false);
      // El mundo inmóvil detrás de un panel no necesita renderizar a la frecuencia
      // del monitor. Una pestaña oculta no envía trabajo a la GPU.
      this.performanceHUD.metrics.sample(now, false);
      this.renderer.resolution.resetWindow();
      // Dormir sí se ve: el cuerpo se acuesta aunque la simulación esté quieta.
      if (this.isSleeping && !globalThis.document?.hidden) this.player.updateSleepPose?.(dt);
      // Detrás de una página entera no hay nada que ver.
      const tapado = this.menu?.opaco && !this._trasRender;
      if (!globalThis.document?.hidden && !tapado && (this.isSleeping || now >= (this._nextPausedRender ?? 0))) {
        this._nextPausedRender = now + 1000 / 15;
        this._renderFrame(now, false);
      }
      this.input.endFrame();
      return;
    }
    this.momentos?.update(dt, this.player, this.stats, this.clock);
    // Deja ver el lanzamiento y la caída antes de abrir la recuperación fatal.
    if (this.stats.salud <= 0 && this.player.isRagdollActive) {
      if (this.steal?.minigameActive) this.steal._endMinigame(false, 'cancel');
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

    // 2. Día/noche: sol, luna, nubes y clima de Bogotá; la luz sigue al jugador (sombras nítidas)
    this.sceneMgr.setTimeOfDay(this.clock.hour, this.weather, this.clock.day);
    this.sceneMgr.followTarget(this.player.position, this.clock.hour);
    this.sceneMgr.update(dt);
    const isNight = this.clock.isNight;
    const isRainingNow = this.weather?.isRaining ?? false;
    const lights = this.clock.lightsOn, foggy = this.weather?.weather === 'niebla';
    if (this._wasNight !== isNight || this._wasRaining !== isRainingNow || this._wasLights !== lights || this._wasFoggy !== foggy) {
      this._wasNight = isNight;
      this._wasRaining = isRainingNow;
      this._wasLights = lights;
      this._wasFoggy = foggy;
      this.world.active?.setNightMode?.(lights);
      this.cambuche?.setNight(lights);
      this.dealer?.setNight(isNight);
      for (const car of this.cars) car.setNight?.(lights, isRainingNow, foggy);
      if (this.traffic) {
        for (const v of this.traffic.vehicles) v.car?.setNight?.(lights, isRainingNow, foggy);
      }
      if (typeof document !== 'undefined') {
        document.body?.classList?.toggle('night-mode', isNight);
      }
    }

    // 3. Jugador
    this.cameraRig.updateControls(dt, this.input);
    // Actualiza el rumbo antes de calcular WASD en relación con la cámara.
    this.cameraRig.prepareMovement();
    const previousX = this.player.position.x, previousZ = this.player.position.z;
    this._syncVehicleColliders?.();
    this._updatePlayerMovement(dt);
    this.waterEffects?.update(dt, this.player);
    if (this.player.waterFrame?.entered) this.audio.playWaterSplash?.(this.player.waterFrame.entryIntensity);
    this._swimSoundTimer = Math.max(0, (this._swimSoundTimer ?? 0) - dt);
    if (this.player.inWater && this.player.speed > .3 && this._swimSoundTimer === 0) {
      this.audio.playWaterSplash?.(.16);
      this._swimSoundTimer = this.input.isRunning ? .65 : .95;
    }
    this.profiler?.mark?.('jugadorCamaraColisiones');

    // 4. Stats
    this.stats.update(dt, this.player, this.diseases, this.clock, this.talents, this.weather);
    this.radio?.update(dt, this.stats, this.dog);
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
    if (!this.player.isStunned) {
      // Los temporizadores y la selección de basura terminan normalmente al entrar;
      // nadar no permite comerciar ni iniciar acciones terrestres bajo el agua.
      const controls = this.player.isSwimming
        ? (this._waterInput ??= { consumePress: () => false, isDown: () => false }) : this.input;
      this.interaction.update(dt, controls, this.clock);
      if (this.player.isSwimming) this.interaction.currentTarget = this.interaction.currentTargetType = null;
    }
    if (!this.player.isSwimming) this.steal?.update(dt);
    else if (this.steal?.minigameActive) this.steal._endMinigame(false, 'cancel');
    if (this._handleDeath()) return;

    // 7b. Mecánica de popó y lanzamiento a peatones
    if (!this.player.isStunned && !this.player.isSwimming && this.input.consumePress('KeyX')) {
      const hasPoop = this.inventory.count('popo') > 0;
      if (hasPoop) {
        this.poopSystem.throwPoop(this.player, this.cameraRig);
      } else {
        this.poopSystem.poop(this.player);
      }
    }
    if (!this.player.isStunned && !this.player.isSwimming && this.input.consumePress('KeyZ')) {
      this.poopSystem.poop(this.player);
    }
    this.poopSystem.update(dt);

    // 7c. Sistema de abstinencia, alucinaciones y psicosis inducida

    // 8. Mundo
    // La visibilidad de edificios usa la cámara del mismo cuadro.
    this.cameraRig.follow(this.player.position, dt, this.collisions, this.player.speed, this.input.isRunning);
    this.psychosis.update(dt, this.cameraRig);
    this.substanceEffects?.update(dt);
    this.profiler?.mark('sistemas');
    // Los peatones se tapan la nariz si el jugador huele mal.
    if (this.world.active) this.world.active.playerHygiene = this.stats.higiene;
    this.world.update(dt, this.player.position, this.cameraRig.camera, this.traffic?.vehicles ?? []);
    actualizarFrases(this.cameraRig.camera, this.player.position, now);
    this.profiler?.mark('mundoNPC');
    this.traffic?.update(dt, { player: this.player.position, pedestrians: this.world.active?.trafficPedestrians ?? this.world.active?.npcs ?? [], onPlayerHit: this._onVehicleImpact });
    this.roadRage?.update(dt);
    this.limpieza?.update(dt, {
      isNight: this.clock.isNight,
      canChase: !this.isSleeping,
      // en el cambuche no llegan: es lo único que el jugador tiene seguro
      allowSpawn: !this.isSleeping && !this._nearCambuche(15),
      camera: this.cameraRig.camera
    });
    this.profiler?.mark('trafico');
    if (this._handleDeath()) return;

    this.weather?.update(dt, this.player.position, this.world.active, this.clock);
    streetWetness.value = this.weather?.wetness ?? 0;
    mojarCarton(streetWetness.value);
    this.audio.setRainLevel?.(this.weather?.isRaining ? this.weather.rainIntensity : 0);

    // 9. Entidades
    this._updatePickups(dt);
    for (const c of this.cars) c.update(dt, this.player.position);
    for (const { car } of this.traffic?.vehicles ?? []) car.update(dt);
    this.cambuche?.update(dt);
    this.dealer?.update(dt);
    this.dog?.update(dt, this.player.position, this.pickups, this.world.active?.npcs ?? []);
    this.cart?.update(dt, this.player, this.audio);

    // 10. Audio
    const moving = !this.player.isStunned && (this.input.axis.x !== 0 || this.input.axis.z !== 0 || Math.hypot(this.player.position.x - previousX, this.player.position.z - previousZ) > .001);
    const groundType = this.world.active?.getGroundTypeAt?.(this.player.position.x, this.player.position.z) ?? 'sidewalk';
    const isRaining = !!this.weather?.isRaining;
    this.audio.updateWorld?.(dt, this.player.position, this.cameraRig.camera, this.traffic?.vehicles ?? [], this.world.active?.busServices ?? this.world.active?.busService);
    this.audio.setRaining?.(isRaining);
    // Las pisadas siguen la distancia recorrida en el suelo; en el aire no suenan.
    const travelled = this.player.isGrounded === false || this.player.inWater ? 0 : Math.hypot(this.player.position.x - previousX, this.player.position.z - previousZ);
    this.audio.updateSteps(moving, this.input.isRunning, groundType, isRaining, travelled, dt);
    this.audio.updateBoost(this.interaction.boostActive);
    this.overlays?.update?.(dt, this.weather, this.stats, this.psychosis);
    this.profiler?.mark?.('entidadesClimaAudio');

    // 12. Render
    this._renderFrame(now, true);
    this.profiler?.mark('envioRenderLucesCulling');

    if (this.gps?.update(this.player.position, now) === 'arrived') {
      this._syncGpsBeacon();
      const { name } = this.gps.lastArrival;
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: `Llegué a ${nombreALaVista(name)}`, type: 'info' } }));
    }
    this.gpsBeacon?.update(dt, this.player.position);
    this.minimap?.update(this.player.position, this._cameraYaw(), this._getPOIs(now), now,
      { gps: this.gps, needs: this._needs, running: this.input.isRunning && (this.input.axis.x !== 0 || this.input.axis.z !== 0) });

    // 13. UI
    this.hud.setMovementState?.(this.player);
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

  /** Las bolsas siguen funcionando lejos; el límite de dibujo solo existe en calidad baja. */
  _updatePickups(dt) {
    const farDetail = this.world.active?.farDetailDistance ?? Infinity;
    for (const p of this.pickups) { p.update(dt); p.limitDrawDistance(this.player.position, farDetail); }
  }

  _renderFrame(now, active) {
    const quality = this.renderer.effectiveQuality;
    if (this._effectiveQuality !== quality) {
      this._effectiveQuality = quality;
      this.sceneMgr.setQuality(quality);
      this.weather?.setQuality(quality);
      this.cameraRig.setQuality?.(quality);
      if (this.world.active) {
        this.world.active.animationBudget = GRAPHICS_PROFILES[quality].animationBudget;
        this.world.active.farDetailFog = GRAPHICS_PROFILES[quality].farDetailFog ?? 0;
        this.world.active.graphicsQuality = quality;
      }
      this.world.active?.setWetness?.(this.weather?.wetness ?? 0);
    }
    const elapsed = this._lastRenderTime === undefined ? 0 : (now - this._lastRenderTime) / 1000;
    this._lastRenderTime = now;
    this.localLights.update(elapsed, this.player.position, (x, z) => this.world.active?.getGroundHeight?.(x, z) ?? 0, this.cameraRig.camera);
    if (this.contactShadows) {
      const frame = this._contactShadowFrame;
      frame.npcs = this.world.active?.trafficPedestrians ?? this.world.active?.npcs ?? [];
      frame.dog = this.dog;
      frame.vehicles = this._contactVehicles;
      frame.quality = quality;
      frame.camera = this.cameraRig.camera;
      this.contactShadows.update(frame);
    }
    const showSilhouette = GRAPHICS_PROFILES[quality].silhouette &&
      (this.collisions.mayOccludePlayer?.(this.cameraRig.camera.position, this.player.position) ?? true);
    // El efecto de consumo mueve la cámara solo durante este render y captura su estela al terminar.
    this.substanceEffects?.beforeRender(this.cameraRig.camera, { quality, paused: !active });
    // De espaldas a una pared la cámara queda dentro del cuerpo y lo único que se vería es su interior.
    const insideBody = this.cameraRig.insideBody && this.player.root.visible;
    if (insideBody) this.player.root.visible = false;
    this.renderer.render(this.sceneMgr.scene, this.cameraRig.camera, this.player.root, [this.sceneMgr.sun], showSilhouette && !insideBody);
    if (insideBody) this.player.root.visible = true;
    if (this._trasRender) { const copiar = this._trasRender; this._trasRender = null; copiar(); }
    this.substanceEffects?.afterRender(this.cameraRig.camera);
    if (this.performanceHUD.update(this._frameStamp ?? now, this.player.position, this.renderer, active, this.localLights)) {
      this.renderer.adaptResolution(this.performanceHUD.metrics.frameMs, performance.now() - now);
    } else this.renderer.resolution.resetWindow();
  }

  _getPOIs(now = performance.now()) {
    const friend = !!this.dog?.isFriend;
    if (!this._poiCache || now - this._poiCacheTime >= 350 || this._poiDogFriend !== friend) {
      const district = this.world?.active;
      const reserved = district?.reserved ?? {};
      // Puestos y fogatas van primero para que los lugares fijos queden encima.
      const services = district?.vendors ? (this._services ??= servicePlaces(district)) : [];
      this._poiCache = [...services, ...[[this.cambuche, reserved.bed, 'Cambuche', '⛺', '#ffd166'],
        [this.sellPoint, reserved.sell, 'Recicladora El Progreso', '♻️', '#2ab7ca', { prices: { vender: 0 } }],
        [this.shop, reserved.shop, 'Tienda La Esquinita', '🏪', '#2ecc71', { prices: SHOP_PRICES, offers: SHOP_OFFERS }],
        [this.craftingStation, reserved.craft, 'Crafteo', '🔨', '#e67e22'],
        [this.dealer, reserved.dealer, 'Dealer', '💀', '#9b59b6', { dealer: true }]]
        .flatMap(([entity, fallback, name, icon, color, extra]) => {
          const pos = entity?.position ?? fallback;
          return pos ? [{ name, icon, color, x: pos.x, z: pos.z, fijo: true, ...extra }] : [];
        })];
      if (this.world?.active?.tileTypeAt) this._poiCache.push(...(this._landmarks ??= cityLandmarks()));
      if (this.cart) this._poiCache.push({ name: 'Carreta', icon: '🛒', x: this.cart.position.x, z: this.cart.position.z, color: '#f39c12' });
      this._dogPOI = friend ? { name: 'El Chato', icon: '🐕', color: '#e6b566' } : null;
      if (this._dogPOI) this._poiCache.push(this._dogPOI);
      this._needs = needContext({
        stats: this.stats, inventory: this.inventory, load: this.player?.load, night: this.clock?.isNight,
        sellMult: originEffect(this.look?.origen, 'sellMult'), substanceMult: this.talents?.getEffect?.('substancePriceMult', 1),
        equippedWeapon: this.player?.equippedWeapon,
      });
      this._poiCacheTime = now;
      this._poiDogFriend = friend;
    }
    if (this._dogPOI) Object.assign(this._dogPOI, { x: this.dog.position.x, z: this.dog.position.z });
    return this._poiCache;
  }

  setGraphicsQuality(level, notify = true) {
    const quality = ['baja', 'media', 'alta'].includes(level) ? level : 'alta';
    const shadows = quality !== 'baja', renderer = this.renderer;
    this.chosenQuality = quality;
    // Prender o apagar las sombras cambia el programa de todos los materiales: se compila sin bloquear
    // y se aplica al terminar. Lo elegido vale desde ya: se guarda ahora y Ajustes lo muestra.
    if (renderer._lastFrame && renderer.instance.shadowMap.enabled !== shadows) {
      renderer.rememberQuality(quality);
      const ticket = this._qualityTicket = {};
      renderer.prepareVariant(shadows).then(() => {
        if (this._qualityTicket !== ticket) return;
        this._applyGraphicsQuality(quality, notify);
        // Ajustes pudo quedar pintado con la calidad de antes; no se repinta bajo un control que se está arrastrando.
        if (this.menu?.isOpen && !globalThis.document?.querySelector?.('input[type="range"]:active')) this.menu.refresh();
      });
      return;
    }
    this._qualityTicket = null;
    this._applyGraphicsQuality(quality, notify);
  }

  _applyGraphicsQuality(quality, notify) {
    this.renderer.setQuality(quality);
    this.sceneMgr.setQuality(quality);
    this.cameraRig.setQuality?.(quality);
    this._effectiveQuality = null;
    if (this.world?.active) this.world.active.graphicsQuality = quality;
    this.world?.active?.setWetness?.(this.weather?.wetness ?? 0);
    if (notify) window.dispatchEvent(new CustomEvent('toast', { detail: { text: 'Calidad gráfica: ' + quality, type: 'info' } }));
  }

  _updatePlayerMovement(dt) {
    const district = this.world.active;
    this.player.update(dt, this.cameraRig.camera, this.collisions, (x, z, context) =>
      district?.getPlayerGroundSurface?.(x, z, context)
        ?? district?.getMovementGroundHeight?.(x, z, context.from.y)
        ?? district?.getGroundHeight?.(x, z) ?? 0,
    district?.trafficPedestrians ?? district?.npcs ?? [], (x, z) => district?.getWaterInfo?.(x, z) ?? null);
  }

  _registerRenderGroups() {
    // Las fuentes de la ciudad y del fogón no cambian de posición; sí de intensidad/visibilidad.
    this.localLights.refreshSources({ static: true });
    const culling = this.renderer.culling, district = this.world.active;
    this._contactVehicles = [...(this.cars ?? []), ...(this.traffic?.vehicles ?? []).map(({ car }) => car),
      ...(district?.busServices ?? []).map(vehicle => ({ vehicle, forwardAxis: 'z' })),
      this.limpieza?.suv].filter(Boolean);
    this.renderer.dynamicWorldRoots = [
      ...(district?.animated ?? []),
      ...(district?.busServices ?? [district?.busService].filter(Boolean)).map(bus => bus.group)
    ];
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
    for (const motos of this.parkedMotos?.children ?? []) culling.register(motos);
  }

  stop() {
    this._running = false;
    this.waterEffects?.dispose();
    this.contactShadows?.dispose();
    this.gpsBeacon?.dispose();
    this.psychosis?.dispose?.();
    this.substanceEffects?.dispose?.();
    this.poopSystem?.dispose?.();
    this.roadRage?.dispose?.();
    this.limpieza?.dispose?.();
    this.radio?.destroy?.();
  }
}
