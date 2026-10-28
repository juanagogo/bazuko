import { planUrbanBuildings, buildUrbanBuilding, URBAN_DESIGNS } from '../bogota/UrbanBuildings.js';
import { buildSmallBuilding, SMALL_BUILDING } from '../bogota/SmallBuilding.js';
// src/world/districts/Bogota.js
// Centro de Bogotá (inspirado en Santa Inés / El Cartucho y la Av. Caracas).
//
// Ciudad de 120 × 161 tiles de 2 m; conserva el centro de 74 × 60 y añade barrios al oriente y al sur.
// Ejes: x = oriente↔occidente (los cerros quedan hacia −x,
// que es donde mira la cámara), z = norte↔sur. Carreras corren a lo largo de z, calles a lo largo de x.
//
//   Carrera 15 (x 6-7) · Av. Caracas (x 22-27, troncal en x 24-25) · Carrera 10 (x 40-41)
//   Calle 10 (z 12-13) · Calle 9 (z 30-31)
//
// Manzanas especiales: El Cartucho (x 8-21, z 14-29) con callejón y "olla" al aire libre,
// bodega de reciclaje (x 8-21, z 32-46), parque (x 28-39, z 32-46), lote baldío con el
// cambuche (x 42-46, z 32-46) y la tienda (frente a la Calle 9, x 34).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TILE_SIZE } from '../../utils/constants.js';
import { Farol } from '../props/Farol.js';
import { TrafficSignals } from '../bogota/TrafficSignals.js';
import { signTexture } from '../../utils/signs.js';
import { Banca } from '../props/Banca.js';
import * as TX from '../bogota/textures.js';
import * as P from '../bogota/props.js';
import { Npc } from '../../entities/Npc.js';
import { BuildingVisibility, createBuildingShell } from '../bogota/BuildingVisibility.js';
import { PedestrianNavigation } from '../bogota/PedestrianNavigation.js';
import { TrafficRoute } from '../bogota/TrafficRoute.js';
import { BusService } from '../bogota/BusService.js';
import { skylineFloors, buildAvenueOverpass, AVENUE_OVERPASS } from '../bogota/AvenueLandmarks.js';
import { GAS_STATION, GAS_OBSTACLES, inGasStation, buildGasStation } from '../bogota/GasStation.js';
import { buildD69Store } from '../bogota/D69Store.js';
import { buildColpatria, COLPATRIA, COLPATRIA_ANNEX, BUS_DETOUR, busPathX, southBusPathX } from '../bogota/Colpatria.js';
import { VIADUCT, buildColpatriaViaduct, viaductHeight, viaductSurface } from '../bogota/ColpatriaViaduct.js';
import { TERMINAL, inTerminal, terminalGroundHeight, buildTransitTerminal } from '../bogota/TransitTerminal.js';
import { LAKE_PARK, onLakeBridge, bridgeHeight, buildLakeWater } from '../bogota/LakePark.js';
import { PigeonFlock } from '../../entities/PigeonFlock.js';
import { geometryChunk, mergeByChunk, freezeStaticTransforms, createRenderSectors, instanceStaticModels } from '../bogota/StaticGeometry.js';
import { CITY_WIDTH, CITY_HEIGHT, CITY_AREA_MULTIPLIER, CITY_CARRERAS as CARRERAS,
  CITY_CALLES as CALLES, ORIGINAL_CITY_WIDTH, ORIGINAL_CITY_HEIGHT, EXTENSION_PARKS,
  expandCity } from '../bogota/CityLayout.js';

import { ORIGINAL_SIZE as S, ORIGINAL_CARRERAS, ORIGINAL_CARACAS, ORIGINAL_CALLES,
  CARACAS, STREET_X, STREET_Z, expandStreets,
  migrateStreetPosition, WORLD_LAYOUT_VERSION, SIDEWALK_TILES } from '../bogota/StreetLayout.js';
const T = TILE_SIZE;
const WALKABLE = new Set(['road', 'busway', 'sidewalk', 'dirt', 'grass', 'plaza', 'floor']);
const SOLID = new Set(['building', 'ruin', 'wall', 'water', 'storeD69', 'colpatria', 'colpatriaAnnex', 'smallBuilding']);
const SIDEWALK_Y = 0.12;
// La colocación de objetos debe usar las mismas cotas que la malla del terreno.
const GROUND_HEIGHTS = Object.freeze({
  road: 0, busway: 0.02, sidewalk: SIDEWALK_Y, floor: SIDEWALK_Y,
  dirt: 0.04, grass: 0.06, plaza: SIDEWALK_Y, water: -.18
});

const WX = STREET_X.world, WZ = STREET_Z.world;
export const SHELTER_LOCATION = Object.freeze({ x: 112.98, z: 94.64 });
export const SHELTER_RESPAWN = Object.freeze({ x: 112.98, z: 97.84 });

const CARTUCHO = { x0: 8, x1: 21, z0: 14, z1: 29 };
const SHOP_NAMES = [
  ['DROGUERÍA', 'SALUD Y VIDA'], ['PANADERÍA', 'EL TRIGAL'], ['CIGARRERÍA', 'LA 10'], ['ASADERO', 'POLLO DORADO'],
  ['MISCELÁNEA', 'TODO A MIL'], ['COMPRAVENTA', 'EL CENTAVO'], ['RESIDENCIAS', 'EL DORADO'], ['BILLARES', 'LA BOLA 8'],
  ['TIENDA', 'DONDE PACHO'], ['FERRETERÍA', 'EL TORNILLO'], ['SASTRERÍA', 'ARREGLOS'], ['CAFETERÍA', 'TINTO Y PAN'],
  ['CHATARRERÍA', 'COMPRAMOS'], ['MINUTOS', 'A TODO OPERADOR'], ['LAVANDERÍA', 'AL INSTANTE'], ['PAPELERÍA', 'FOTOCOPIAS']
];

const rand = (a, b) => a + Math.random() * (b - a);
const _frustum = new THREE.Frustum();
const _projView = new THREE.Matrix4();

/**
 * Ajusta los UV de cada cara de una BoxGeometry a metros reales: la textura de esa cara cubre
 * units[cara] = [ancho, alto] metros y se repite. Caras sin unidad (p. ej. la fachada) quedan 0..1.
 * Orden de caras de BoxGeometry: +x, −x, +y, −y, +z, −z.
 */
function worldUVs(geo, sx, sy, sz, units) {
  const uv = geo.attributes.uv;
  const dims = [[sz, sy], [sz, sy], [sx, sz], [sx, sz], [sx, sy], [sx, sy]];
  for (let f = 0; f < 6; f++) {
    const u = units[f];
    if (!u) continue;
    const [w, h] = dims[f];
    for (let i = f * 4; i < f * 4 + 4; i++) uv.setXY(i, uv.getX(i) * w / u[0], uv.getY(i) * h / u[1]);
  }
  return geo;
}
const repeatAll = (t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); t.anisotropy = 8; t.needsUpdate = true; return t; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const W = (t) => t * T; // tile → metros (centro del tile)

export class Bogota {
  constructor() {
    this.group = new THREE.Group();
    this.lakePark = LAKE_PARK;
    this.gasStation = GAS_STATION;
    this.colpatria = COLPATRIA;
    this.width = CITY_WIDTH;
    this.height = CITY_HEIGHT;
    this.populationScale = Math.min(3, CITY_AREA_MULTIPLIER);
    this.size = Math.max(this.width, this.height);
    this.layoutVersion = WORLD_LAYOUT_VERSION;
    this.props = [];          // { instance } con setNight/update (faroles de bazuko)
    this.animated = [];       // grupos con userData.update
    this.facadeMats = [];
    this._facadeTextures = new Map();
    this._facadeMaterials = new Map();
    this.npcs = [];
    this.buildingVisibility = new BuildingVisibility();
    this.t = 0;
  }

  // ---------- trazado ----------

  _layout() {
    const CARRERAS = ORIGINAL_CARRERAS, CARACAS = ORIGINAL_CARACAS, CALLES = ORIGINAL_CALLES;
    const m = Array.from({ length: S }, () => Array(S).fill('building'));
    const set = (x, z, v) => { if (x >= 0 && z >= 0 && x < S && z < S) m[z][x] = v; };
    for (let i = 0; i < S; i++) { set(i, 0, 'wall'); set(i, S - 1, 'wall'); set(0, i, 'wall'); set(S - 1, i, 'wall'); }

    for (let i = 1; i < S - 1; i++) {
      for (const [a, b] of CARRERAS) for (let x = a; x <= b; x++) set(x, i, 'road');
      for (const [a, b] of CARACAS.lanes) for (let x = a; x <= b; x++) set(x, i, 'road');
      for (let x = CARACAS.busway[0]; x <= CARACAS.busway[1]; x++) set(x, i, 'busway');
      for (const [a, b] of CALLES) for (let z = a; z <= b; z++) set(i, z, 'road');
    }
    // los cruces de la troncal con las calles son calzada normal
    for (const [a, b] of CALLES) for (let z = a; z <= b; z++) for (let x = CARACAS.busway[0]; x <= CARACAS.busway[1]; x++) set(x, z, 'road');

    // andén alrededor de cada manzana
    const isStreet = (v) => v === 'road' || v === 'busway';
    for (let z = 1; z < S - 1; z++) {
      for (let x = 1; x < S - 1; x++) {
        if (m[z][x] !== 'building') continue;
        let near = false;
        for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isStreet(m[z + dz][x + dx])) near = true;
        if (near) m[z][x] = 'sidewalk';
      }
    }

    // El Cartucho: casas en ruina, callejón (z 21-22) y la olla (x 12-17, z 18-25)
    for (let z = CARTUCHO.z0 + 1; z < CARTUCHO.z1; z++) {
      for (let x = CARTUCHO.x0 + 1; x < CARTUCHO.x1; x++) {
        if (m[z][x] === 'building') m[z][x] = 'ruin';
        if (z === 21 || z === 22) m[z][x] = 'dirt';
        if (x >= 12 && x <= 17 && z >= 18 && z <= 25) m[z][x] = 'dirt';
      }
    }
    // bodega de reciclaje: portón abierto frente a la Calle 9
    for (let z = 33; z <= 35; z++) for (let x = 13; x <= 16; x++) m[z][x] = 'floor';
    // parque
    for (let z = 33; z <= 45; z++) for (let x = 29; x <= 38; x++) m[z][x] = (x === 33 || x === 34 || z === 39) ? 'plaza' : 'grass';
    // lote baldío del cambuche
    for (let z = 33; z <= 45; z++) for (let x = 43; x <= 46; x++) m[z][x] = 'dirt';
    return expandCity(expandStreets(m));
  }

  migrateSavedPosition(position, version) { return migrateStreetPosition(position, version); }

  // ---------- construcción ----------

  build(scene, collisions) {
    this.scene = scene;
    const map = this.map = this._layout();
    this._buildGround(map);
    this._buildMarkings();
    this._buildBlocks(map);
    this._buildCollisions(map, collisions);
    const viaduct = buildColpatriaViaduct(map, { pavement: this.groundMaterials.road });
    this.group.add(viaduct);
    for (const box of viaduct.userData.colliders) collisions?.colliders.push({ box, mesh: new THREE.Object3D(), layered: true });
    this.stationGroup = buildTransitTerminal({ createSign: signTexture, asphalt: this.groundMaterials.road });
    this.group.add(this.stationGroup);
    for (const entry of this.stationGroup.userData.colliders) collisions?.colliders.push(entry);
    this._buildStreetProps(map);
    this._buildCartucho();
    this._buildPark();
    this._buildExtensions();
    this._buildLakePark();
    this.group.add(buildAvenueOverpass());
    this.group.add(buildGasStation({ createSign: signTexture }));
    this.group.add(buildD69Store({ createSign: signTexture }));
    this.group.add(buildSmallBuilding({ brickTextures: TX.brick(53) }));
    const tower = buildColpatria({ createSign: signTexture });
    this.towerLights = tower.userData.lightMaterials;
    this.group.add(tower);
    const parks = [
      { x0: WX(29.5), x1: WX(37.5), z0: WZ(33.5), z1: WZ(44.5) },
      ...EXTENSION_PARKS.map(park => ({ x0: W(park.x0 + .5), x1: W(park.x1 - .5), z0: W(park.z0 + .5), z1: W(park.z1 - .5) }))
    ];
    this.pigeonFlocks = parks.map(bounds => new PigeonFlock(scene, bounds, {
      groundHeight: (x, z) => this.getGroundHeight(x, z),
      isGround: (x, z) => ['grass', 'plaza'].includes(map[Math.round(z / T)]?.[Math.round(x / T)]) &&
        Math.hypot(x - SHELTER_LOCATION.x, z - SHELTER_LOCATION.z) > 6
    }));

    const cer = P.cerros();
    cer.userData.noMerge = true;
    cer.position.set(-130, 0, W(this.height / 2) - 30);
    cer.rotation.y = Math.PI / 2;
    this.group.add(cer);
    this.cerros = cer;
    this._mergeStatic();
    this.group.add(this.buildingVisibility.buildClosedView());
    const closedView = this.buildingVisibility.closedView;
    this.renderSectors = [
      ...createRenderSectors(this.group, new Set([closedView, ...this.busServices.map(bus => bus.group)])),
      ...createRenderSectors(closedView)
    ];
    scene.add(this.group);
    freezeStaticTransforms(this.group, new Set(this.busServices.map(bus => bus.group)));
    this.signals = new TrafficSignals();
    this.group.add(this.signals.group);
    for (const bus of this.busServices) bus.signals = this.signals;

    this.isWalkableAt = (wx, wz) => {
      if (inTerminal(wx,wz)) return true;
      const tx = Math.round(wx / T), tz = Math.round(wz / T);
      if (tx < 0 || tz < 0 || tx >= this.width || tz >= this.height) return false;
      return WALKABLE.has(map[tz][tx]);
    };

    // Zonas reservadas (en metros)
    this.reserved = {
      spawn:  { ...SHELTER_RESPAWN },
      respawn: { ...SHELTER_RESPAWN },
      sell:   { x: WX(14.5), z: WZ(34) },     // dentro del portón de la bodega
      bed:    { ...SHELTER_LOCATION },
      dealer: { x: WX(14.5), z: WZ(21.5) },   // la olla de El Cartucho
      craft:  { x: WX(16.5), z: WZ(24.5) },
      shop:   { x: WX(34), z: WZ(29) }        // andén de la Calle 9, de espaldas a la manzana
    };
    this.isNearReserved = (x, z, dist = 6) =>
      Object.values(this.reserved).some((r) => Math.hypot(x - r.x, z - r.z) < dist);

    this.getSpawnGrid = () => {
      const grid = [];
      for (let tz = 2; tz < this.height - 2; tz += 3) {
        for (let tx = 2; tx < this.width - 2; tx += 3) {
          const t = map[tz][tx];
          if (!['sidewalk', 'dirt', 'grass', 'plaza'].includes(t)) continue;
          const x = W(tx), z = W(tz);
          if (this.isNearReserved(x, z) || inGasStation(x, z)) continue;
          grid.push(new THREE.Vector3(x, 0, z));
        }
      }
      return grid;
    };

    this._spawnPeople();
  }

  /**
   * Puestos de parqueo: calzada pegada al andén, lejos de cruces y de la troncal.
   * El carro mira a lo largo de la calle (su frente es +x local).
   */
  getParkingSpots() {
    const m = this.map;
    const spots = [];
    const nearCross = (x, z) => CALLES.some(([a, b]) => z >= a - 2 && z <= b + 2) && [...CARRERAS, ...CARACAS.lanes.map(([a, b]) => [a, b])].some(([a, b]) => x >= a - 2 && x <= b + 2);
    for (let z = 2; z < m.length - 2; z++) {
      // Los circuitos centrales quedan libres; se conserva el parqueo en los extremos.
      if (z >= CALLES[0][0] - 2 && z <= CALLES[1][1] + 2) continue;
      for (let x = 2; x < m[0].length - 2; x++) {
        if (m[z][x] !== 'road' || nearCross(x, z)) continue;
        if (x >= CARACAS.lanes[0][0] && x <= CARACAS.lanes[1][1]) continue; // la Caracas no se parquea
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (m[z + dz][x + dx] !== 'sidewalk') continue;
          // andén a los lados en x → la calle corre a lo largo de z
          const alongZ = dx !== 0;
          spots.push({ x: W(x) + dx * 0.4, z: W(z) + dz * 0.4, rot: alongZ ? Math.PI / 2 : 0 });
        }
      }
    }
    return spots;
  }

  getTrafficRoutes() {
    const lane = ([a, b], side) => W((a + b) / 2 + side * (b - a + 1) / 4);
    const top = lane(CALLES[0], 1), bottom = lane(CALLES[1], -1);
    const circuit = (left, right, top, bottom) => {
      // El costado oriental ocupado por el conjunto deja de ser una vía de paso.
      // Los circuitos de ese costado giran en Calle 8; los demás siguen por los barrios.
      if ([left, right].some(x => x >= 83 && x <= 93) && bottom > 155) bottom = lane(CALLES[2], -1);
      if (bottom - top <= 6.4) return null;
      return new TrafficRoute(left, right, top, bottom, 3.2);
    };
    const routes = [
      circuit(lane(CARRERAS[0], 1), lane(CARACAS.lanes[0], -1), top, bottom),
      circuit(lane(CARACAS.lanes[1], 1), lane(CARRERAS[1], -1), top, bottom),
      circuit(lane(CARRERAS[1], 1), lane(CARRERAS[2], -1), top, lane(CALLES.at(-1), -1)),
      circuit(lane(CARRERAS[2], 1), lane(CARRERAS[3], -1), top, lane(CALLES.at(-1), -1)),
      circuit(lane(CARRERAS[0], 1), lane(CARACAS.lanes[0], -1), lane(CALLES[1], 1), lane(CALLES.at(-1), -1)),
      circuit(lane(CARACAS.lanes[1], 1), lane(CARRERAS[1], -1), lane(CALLES[1], 1), lane(CALLES.at(-1), -1))
    ].filter(Boolean);
    // Combinar calles y carreras permite continuar por otros barrios en los cruces.
    // Solo las seis rutas de partida generan carros; las demás son alternativas.
    const vertical = [CARRERAS[0], ...CARACAS.lanes, ...CARRERAS.slice(1)];
    const alternatives = new Map(routes.map(route => [route.key, route]));
    for (let left = 0; left < vertical.length - 1; left++) for (let right = left + 1; right < vertical.length; right++) {
      for (let north = 0; north < CALLES.length - 1; north++) for (let south = north + 1; south < CALLES.length; south++) {
        const route = circuit(lane(vertical[left], 1), lane(vertical[right], -1), lane(CALLES[north], 1), lane(CALLES[south], -1));
        if (!route) continue;
        if (!alternatives.has(route.key)) alternatives.set(route.key, route);
      }
    }
    routes.alternatives = [...alternatives.values()];
    return routes;
  }

  getBusRoute() {
    const centerX = (W(CARACAS.busway[0]) + W(CARACAS.busway[1])) / 2;
    return {
      x: centerX + 3.5,
      startZ: W(this.height - 2) - P.ARTICULATED_BUS_SIZE.length / 2,
      endZ: -62,
      groundHeight: (_x, z) => z >= VIADUCT.start && z <= VIADUCT.end ? viaductHeight(z) : bridgeHeight(z),
      pathX: busPathX,
      stationZ: TERMINAL.z
    };
  }

  /** Suelo: una malla por material, con UV en metros para que la textura no se repita por tile */
  _buildGround(map) {
    const asphalt = TX.asphalt(7, 1024);
    const walk = TX.sidewalk(11);
    const dirt = TX.dirt(31);
    const concrete = TX.concrete(41);
    const tex = (t, scale) => { if (!t) return t; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData = { scale }; return t; };
    const mats = {
      // sin roughnessMap: los charcos espejo se ven como huecos negros con cámara cenital
      road: new THREE.MeshStandardMaterial({
        map: tex(asphalt.map, 14),
        bumpMap: tex(asphalt.bumpMap, 14),
        bumpScale: 0.16,
        roughness: 0.82,
        color: '#b4b4b4'
      }),
      busway: new THREE.MeshStandardMaterial({
        map: tex(asphalt.map, 14),
        bumpMap: tex(asphalt.bumpMap, 14),
        bumpScale: 0.14,
        roughness: 1,
        color: '#a8726a'
      }),
      sidewalk: new THREE.MeshStandardMaterial({
        map: tex(walk.map, 6),
        bumpMap: tex(walk.bumpMap, 6),
        bumpScale: 0.28,
        roughness: 0.75,
        color: '#b9b4aa'
      }),
      floor: new THREE.MeshStandardMaterial({ map: tex(concrete.map, 6), roughness: 0.9, color: '#8a8a86' }),
      dirt: new THREE.MeshStandardMaterial({ map: tex(dirt.map, 8), roughness: 1, color: '#8a7a64' }),
      grass: new THREE.MeshStandardMaterial({ map: dirt.map, roughness: 1, color: '#3e5a2c' }),
      plaza: new THREE.MeshStandardMaterial({ map: tex(walk.map, 6), roughness: 0.8, color: '#c9b9a0' }),
      water: new THREE.MeshStandardMaterial({ color: '#267d8b', roughness: .24, metalness: .18 })
    };
    const scaleOf = { road: 14, busway: 14, sidewalk: 6, floor: 6, dirt: 8, grass: 8, plaza: 6, water: 16 };
    const heightOf = GROUND_HEIGHTS;
    const quads = {};
    for (let z = 0; z < map.length; z++) {
      for (let x = 0; x < map[0].length; x++) {
        const t = map[z][x];
        if (!mats[t] || t === 'water' || onLakeBridge(W(x), W(z))) continue;
        const g = new THREE.PlaneGeometry(T, T);
        g.rotateX(-Math.PI / 2);
        g.translate(W(x), heightOf[t], W(z));
        const uv = g.attributes.uv, pos = g.attributes.position;
        if (onLakeBridge(W(x), W(z))) {
          for (let i = 0; i < pos.count; i++) pos.setY(i, bridgeHeight(pos.getZ(i)));
          g.computeVertexNormals();
        }
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / scaleOf[t], pos.getZ(i) / scaleOf[t]);
        (quads[t] ??= []).push(g);
        // bordillo: cara vertical hacia la calle
        if (heightOf[t] >= SIDEWALK_Y && !onLakeBridge(W(x), W(z))) {
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = map[z + dz]?.[x + dx];
            if (n !== 'road' && n !== 'busway') continue;
            const c = new THREE.PlaneGeometry(T, SIDEWALK_Y);
            c.rotateY(dx ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dz > 0 ? 0 : Math.PI));
            c.translate(W(x) + dx * T / 2, SIDEWALK_Y / 2, W(z) + dz * T / 2);
            (quads.curb ??= []).push(c);
          }
        }
      }
    }
    mats.curb = new THREE.MeshStandardMaterial({
      color: '#d8d4c8',
      roughness: 0.8,
      bumpMap: tex(concrete.map, 4),
      bumpScale: 0.12
    });
    this.groundMaterials = mats;
    this.group.add(buildLakeWater(mats.water));
    for (const [t, list] of Object.entries(quads)) {
      this.group.add(mergeByChunk(list, mats[t], { receiveShadow: true }));
    }
    // muro perimetral bajo y oscuro (no se ve el borde del mundo)
  }

  /** Cebras en los cruces, líneas amarillas y separadores de la troncal */

  /** Ajusta el acabado del asfalto y andenes según la lluvia o humedad ambiental */
  setWetness(amount = 0) {
    this.wetness = amount;
    this.isRaining = amount > 0.05;
    if (!this.groundMaterials) return;
    const wet = THREE.MathUtils.clamp(amount, 0, 1);
    if (this.groundMaterials.road) {
      this.groundMaterials.road.roughness = THREE.MathUtils.lerp(0.82, 0.28, wet);
      this.groundMaterials.road.metalness = THREE.MathUtils.lerp(0.0, 0.24, wet);
      this.groundMaterials.road.envMapIntensity = THREE.MathUtils.lerp(0.3, 1.8, wet);
    }
    if (this.groundMaterials.busway) {
      this.groundMaterials.busway.roughness = THREE.MathUtils.lerp(1.0, 0.42, wet);
      this.groundMaterials.busway.metalness = THREE.MathUtils.lerp(0.0, 0.18, wet);
      this.groundMaterials.busway.envMapIntensity = THREE.MathUtils.lerp(0.25, 1.5, wet);
    }
    if (this.groundMaterials.sidewalk) {
      this.groundMaterials.sidewalk.roughness = THREE.MathUtils.lerp(0.75, 0.38, wet);
      this.groundMaterials.sidewalk.metalness = THREE.MathUtils.lerp(0.0, 0.15, wet);
      this.groundMaterials.sidewalk.envMapIntensity = THREE.MathUtils.lerp(0.2, 1.2, wet);
    }
  }

  _buildMarkings() {
    const busText = new THREE.MeshBasicMaterial({ map: signTexture({ title: 'SOLO BUS', bg: null, fg: '#f6d340', border: false }), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const busCenter = (W(CARACAS.busway[0]) + W(CARACAS.busway[1])) / 2;
    for (let z = 8; z < W(this.height) - 8; z += 22) {
      if (z >= VIADUCT.start && z <= VIADUCT.end) continue;
      if (CALLES.some(([a, b]) => z > W(a) - 7 && z < W(b) + 7)) continue;
      for (const side of [-1, 1]) {
        const label = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.4), busText);
        label.rotation.set(-Math.PI / 2, 0, side * Math.PI / 2);
        label.position.set(busCenter + side * 3.5, this.getGroundHeight(busCenter + side * 3.5, z) + .015, z);
        if (z > LAKE_PARK.z0) label.rotation.x -= Math.atan2(bridgeHeight(z + .1) - bridgeHeight(z - .1), .2);
        this.group.add(label);
      }
    }
    const white = [], yellow = [], curbs = [];
    const plane = (w, d, x, z) => {
      const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, .015, z);
      if (onLakeBridge(x, z)) {
        const p = g.attributes.position;
        for (let i = 0; i < p.count; i++) p.setY(i, bridgeHeight(p.getZ(i)) + .015);
        g.computeVertexNormals();
      }
      return g;
    };
    const paintWhite = (w, d, x, z) => {
      if (this.map[Math.round(z / T)]?.[Math.round(x / T)] !== 'grass') white.push(plane(w, d, x, z));
    };
    for (const z of [158, 178]) for (let x = 56; x <= 114; x += .9) {
      if (['road', 'busway'].includes(this.map[Math.round(z / T)]?.[Math.round(x / T)])) paintWhite(.5, 1.6, x, z);
    }
    const carrX = [...CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1]]];
    // línea amarilla al centro de las calles
    for (const [a, b] of CALLES) {
      const zc = (W(a) + W(b)) / 2;
      for (let x = 2; x < W(this.width) - 2; x += 3) yellow.push(plane(1.6, 0.12, x, zc));
    }
    for (const [a, b] of CARRERAS) {
      const xc = (W(a) + W(b)) / 2;
      for (let z = 2; z < LAKE_PARK.z0; z += 3) yellow.push(plane(0.12, 1.6, xc, z));
    }
    // cebras a ambos lados de cada cruce
    for (const [za, zb] of CALLES) {
      for (const [xa, xb] of carrX) {
        const x0 = W(xa) - T / 2, x1 = W(xb) + T / 2;
        for (const zEdge of [W(za) - T / 2 - SIDEWALK_TILES * T / 2, W(zb) + T / 2 + SIDEWALK_TILES * T / 2]) {
          for (let x = x0 + 0.4; x < x1; x += 0.9) paintWhite(0.5, SIDEWALK_TILES * T - 0.4, x, zEdge);
        }
        for (const xEdge of [W(xa) - T / 2 - SIDEWALK_TILES * T / 2, W(xb) + T / 2 + SIDEWALK_TILES * T / 2]) {
          for (let z = W(za) - T / 2 + 0.4; z < W(zb) + T / 2; z += 0.9) {
            paintWhite(SIDEWALK_TILES * T - 0.4, 0.5, xEdge, z);
          }
        }
      }
    }
    // separadores de concreto de la troncal
    for (const x of [W(CARACAS.busway[0]) - T / 2, W(CARACAS.busway[1]) + T / 2]) {
      for (let z = 1; z < this.height - 1; z++) {
        if (W(z) >= LAKE_PARK.z0) continue;
        if (W(z) >= VIADUCT.start && W(z) <= VIADUCT.end) continue;
        if (CALLES.some(([a, b]) => z >= a - 0.5 && z <= b + 0.5)) continue;
        const g = new THREE.BoxGeometry(0.3, 0.25, T);
        g.translate(x, 0.125, W(z));
        curbs.push(g);
      }
    }
    const markMat = new THREE.MeshStandardMaterial({ color: '#e2e2dc', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    const yelMat = new THREE.MeshStandardMaterial({ color: '#e0a800', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
    this.group.add(mergeByChunk(white, markMat));
    this.group.add(mergeByChunk(yellow, yelMat));
    const sep = mergeByChunk(curbs, new THREE.MeshStandardMaterial({ color: '#cfcac0', roughness: 0.8 }),
      { receiveShadow: true, castShadow: true });
    this.group.add(sep);
  }

  /** Fachadas continuas: casas de 2 a 4 tiles de frente, con fachada pintada, ladrillo o en ruina */
  _buildBlocks(map) {
    const isB = (x, z) => map[z]?.[x] === 'building' || map[z]?.[x] === 'ruin';
    const walk = (x, z) => WALKABLE.has(map[z]?.[x]);
    const brick = TX.brick(3);
    const sideMat = new THREE.MeshStandardMaterial({ map: repeatAll(brick.map), bumpMap: repeatAll(brick.bumpMap), bumpScale: 0.3, roughness: 0.9, color: '#c8b2a2' });
    const roofMat = new THREE.MeshStandardMaterial({ map: repeatAll(TX.slab(13).map), roughness: 0.95 });
    const tileRoof = new THREE.MeshStandardMaterial({ map: repeatAll(TX.roofTiles(9).map), roughness: 0.85 });
    this._interiorMat = new THREE.MeshStandardMaterial({ map: roofMat.map, color: '#675e50', roughness: 1 });
    this._uvUnits = { brick: [TX.BRICK_TILE.w, TX.BRICK_TILE.h], slab: [4, 4], tiles: [2, 2] };
    const covered = new Set();
    this.urbanBuildings = planUrbanBuildings(map);
    const urbanPalette = {
      facades: URBAN_DESIGNS.map((design,i)=>{
        const tex=TX.facade({seed:170+i,width:6,floors:3,pxPerM:32,shopFront:false,style:i===0?'ladrillo':'concreto',wallColor:['#975c40','#b6b3a8','#c3b8a5','#857c70','#687d81'][i]});
        return new THREE.MeshStandardMaterial({map:repeatAll(tex.map),emissiveMap:repeatAll(tex.emissiveMap),emissive:'#ffffff',emissiveIntensity:0,bumpMap:repeatAll(tex.bumpMap),bumpScale:.16,roughness:i===4?.55:.9});
      }),
      roof:roofMat,interior:this._interiorMat,
      concrete:new THREE.MeshStandardMaterial({color:'#686962',roughness:.95}),
      trim:new THREE.MeshStandardMaterial({color:'#c6bda9',roughness:.8}),
      rail:new THREE.MeshStandardMaterial({color:'#4e5552',roughness:.75}),
      glass:new THREE.MeshStandardMaterial({color:'#263a3e',roughness:.4,metalness:.2})
    };
    for(const plan of this.urbanBuildings) {
      for(let dz=0;dz<plan.tiles;dz++)for(let dx=0;dx<plan.tiles;dx++)covered.add((plan.tileX+dx)+','+(plan.tileZ+dz));
      const shell=buildUrbanBuilding(plan,urbanPalette);
      this.group.add(shell.root);
      const building=this.buildingVisibility.register(shell);
      for(const part of building.parts)for(const material of part.materials)if(material.emissiveMap)this.facadeMats.push(material);
    }

    // direcciones: [dx, dz, índice de cara de BoxGeometry]
    const DIRS = [[0, -1, 5], [0, 1, 4], [-1, 0, 1], [1, 0, 0]];
    for (const [dx, dz, face] of DIRS) {
      const alongX = dz !== 0; // la fachada corre a lo largo de x
      const outer = alongX ? map.length : map[0].length;
      for (let a = 1; a < outer - 1; a++) {
        // recorre la línea perpendicular buscando tramos de tiles con fachada hacia (dx, dz)
        let run = [];
        const flush = () => {
          let i = 0;
          while (i < run.length) {
            const wTiles = Math.min(run.length - i, 2 + Math.floor(Math.random() * 3));
            this._house(run.slice(i, i + wTiles), dx, dz, face, alongX, isB, map, sideMat, roofMat, tileRoof, covered);
            i += wTiles;
          }
          run = [];
        };
        for (let b = 1; b < (alongX ? map[0].length : map.length) - 1; b++) {
          const x = alongX ? b : a, z = alongX ? a : b;
          // Cada tile pertenece a una sola casa, también al recorrer otra fachada.
          const faces = isB(x, z) && !covered.has(`${x},${z}`) && walk(x + dx, z + dz);
          if (faces) run.push([x, z]); else flush();
        }
        flush();
      }
    }

    // El relleno y el perímetro también se dividen por sectores para poder ocultarlos por separado.
    const wallMat = new THREE.MeshStandardMaterial({ color: '#3a3532', roughness: 1 });
    for (let z = 0; z < map.length; z++) for (let x = 0; x < map[0].length; x++) {
      const type = map[z][x];
      if ((!isB(x, z) && type !== 'wall') || covered.has(`${x},${z}`)) continue;
      let width = 1, depth = 1;
      const available = (tx, tz) => map[tz]?.[tx] === type && !covered.has(`${tx},${tz}`);
      while (width < 4 && available(x + width, z)) width++;
      while (depth < 4 && Array.from({ length: width }, (_, i) => available(x + i, z + depth)).every(Boolean)) depth++;
      for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) covered.add(`${x + dx},${z + dz}`);
      const h = type === 'wall' ? 9 : type === 'ruin' ? 4.5 : 6.5;
      const material = type === 'wall' ? wallMat : roofMat;
      const sx = width * T, sz = depth * T;
      const geometry = worldUVs(new THREE.BoxGeometry(sx, h, sz), sx, h, sz, Array(6).fill(this._uvUnits.slab));
      const shell = createBuildingShell(geometry, Array(6).fill(material), {
        x: W(x) + (width - 1) * T / 2, z: W(z) + (depth - 1) * T / 2, height: h, interiorMaterial: this._interiorMat
      });
      shell.root.userData.perimeter = type === 'wall';
      this.group.add(shell.root);
      this.buildingVisibility.register(shell);
    }
  }

  _house(tiles, dx, dz, face, alongX, isB, map, sideMat, roofMat, tileRoof, covered) {
    const ruin = tiles.some(([x, z]) => map[z][x] === 'ruin');
    // Profundidad: hasta 3 tiles hacia adentro, sin invadir casas ya construidas.
    let depth = 1;
    while (depth < 3 && tiles.every(([x, z]) => {
      const tx = x - dx * depth, tz = z - dz * depth;
      return isB(tx, tz) && !covered.has(`${tx},${tz}`);
    })) depth++;
    for (const [x, z] of tiles) for (let d = 0; d < depth; d++) covered.add(`${x - dx * d},${z - dz * d}`);

    const widthM = tiles.length * T;
    const floors = skylineFloors(tiles[0][0], tiles[0][1], ruin);
    const h = floors * 3;
    const style = ruin ? 'ruina' : Math.random() < 0.55 ? 'ladrillo' : 'pintada';
    // el ladrillo necesita más resolución para que cada ladrillo (36 × 12 cm) se distinga
    // Variantes compartidas: ampliar el barrio no triplica las texturas de fachada en la GPU.
    const variant = Math.floor(Math.random() * 2);
    const textureKey = `${widthM}:${floors}:${style}:${variant}`;
    let tex = this._facadeTextures.get(textureKey);
    if (!tex) {
      tex = TX.facade({ seed: Math.floor(Math.random() * 1e6), width: widthM, floors, pxPerM: style === 'pintada' ? 36 : 48, shopFront: true, style });
      this._facadeTextures.set(textureKey, tex);
    }
    for (const t of [tex.map, tex.emissiveMap, tex.bumpMap, tex.roughnessMap]) {
      if (t) { t.anisotropy = 8; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
    }
    let facadeMat = this._facadeMaterials.get(textureKey);
    if (!facadeMat) {
      facadeMat = new THREE.MeshStandardMaterial({
        map: tex.map,
        emissiveMap: tex.emissiveMap,
        emissive: '#ffffff',
        emissiveIntensity: 0,
        bumpMap: tex.bumpMap,
        bumpScale: 0.35,
        roughness: 0.85
      });
      if (tex.roughnessMap) facadeMat.roughnessMap = tex.roughnessMap;
      this._facadeMaterials.set(textureKey, facadeMat);
      this.facadeMats.push(facadeMat);
    }

    const [x0, z0] = tiles[0], [x1, z1] = tiles[tiles.length - 1];
    const cx = (W(x0) + W(x1)) / 2 - dx * (depth - 1) * T / 2;
    const cz = (W(z0) + W(z1)) / 2 - dz * (depth - 1) * T / 2;
    const sx = alongX ? widthM : depth * T;
    const sz = alongX ? depth * T : widthM;
    const clay = Math.random() < 0.4 || ruin;
    const mats = [sideMat, sideMat, clay ? tileRoof : roofMat, roofMat, sideMat, sideMat];
    mats[face] = facadeMat;
    const U = this._uvUnits;
    const units = [U.brick, U.brick, clay ? U.tiles : U.slab, U.slab, U.brick, U.brick];
    units[face] = null; // la fachada usa su textura completa
    const shell = createBuildingShell(worldUVs(new THREE.BoxGeometry(sx, h, sz), sx, h, sz, units), mats, {
      x: cx, z: cz, height: h, interiorMaterial: this._interiorMat,
      facadeFace: face, wallInteriorMaterial: sideMat, wallInteriorUV: U.brick
    });
    this.group.add(shell.root);

    // punto de la fachada (centro, al ras de la calle) y orientación hacia afuera
    const fx = (W(x0) + W(x1)) / 2 + dx * T / 2;
    const fz = (W(z0) + W(z1)) / 2 + dz * T / 2;
    const yaw = Math.atan2(dx, dz);

    // aviso de local en el primer piso
    if (!ruin && Math.random() < 0.55) {
      const [title, sub] = pick(SHOP_NAMES);
      const map = signTexture({ title, sub, bg: pick(['#0b4fa3', '#c0392b', '#1f6b3a', '#f2c600', '#ffffff', '#6a1b9a']), fg: '#ffffff', w: 768, h: 192 });
      if (map) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(widthM * 0.85, 3.6), Math.min(widthM * 0.85, 3.6) / 4),
          new THREE.MeshBasicMaterial({ map }));
        sign.position.set(fx + dx * 0.06 - cx, 3.05, fz + dz * 0.06 - cz);
        sign.rotation.y = yaw;
        shell.walls.get(face).add(sign);
      }
    }
    // balcón de madera en las casas viejas (Cartucho) o en algunas de ladrillo
    if ((ruin && Math.random() < 0.6) || (style === 'ladrillo' && Math.random() < 0.2)) {
      const wood = new THREE.MeshStandardMaterial({ color: ruin ? '#4a3626' : '#5a3d24', roughness: 0.9 });
      const bal = new THREE.Group();
      const bw = Math.min(widthM * 0.7, 3.5);
      const floor = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.12, 0.7), wood);
      bal.add(floor);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.08, 0.06), wood);
      rail.position.set(0, 0.9, 0.32);
      bal.add(rail);
      for (let i = 0; i <= Math.floor(bw / 0.25); i++) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.9, 0.04), wood);
        post.position.set(-bw / 2 + i * 0.25, 0.45, 0.32);
        bal.add(post);
      }
      bal.position.set(fx + dx * 0.35 - cx, 3.1, fz + dz * 0.35 - cz);
      bal.rotation.y = yaw;
      bal.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      shell.walls.get(face).add(bal);
    }
    // tanque de agua negro en la terraza
    if (!ruin && Math.random() < 0.35) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.45, 0.9, 12), new THREE.MeshStandardMaterial({ color: '#1c1f22', roughness: 0.6 }));
      tank.position.set(rand(-0.5, 0.5), h + 0.45, rand(-0.5, 0.5));
      tank.castShadow = true;
      shell.roof.add(tank);
    }
    const building = this.buildingVisibility.register(shell);
    for (const part of building.parts) for (const material of part.materials) {
      if (material.emissiveMap) this.facadeMats.push(material);
    }
  }

  /** Colisiones: tramos horizontales de tiles sólidos unidos en una caja */
  _buildCollisions(map, collisions) {
    if (!collisions) return;
    const urbanTiles=new Set();
    for(const plan of planUrbanBuildings(map)) {
      for(let dz=0;dz<plan.tiles;dz++)for(let dx=0;dx<plan.tiles;dx++)urbanTiles.add((plan.tileX+dx)+','+(plan.tileZ+dz));
      const object=new THREE.Object3D();object.position.set(plan.x,0,plan.z);
      collisions.add(object,new THREE.Vector3(plan.width,plan.height,plan.depth));
    }
    const obstacles = [...GAS_OBSTACLES,
      ...[AVENUE_OVERPASS.x0, AVENUE_OVERPASS.x1].map(x => ({ x, z: AVENUE_OVERPASS.z, w: 1.4, d: 4.6, h: 11.4 }))];
    for (const { x, z, w, d, h } of obstacles) {
      const object = new THREE.Object3D(); object.position.set(x, .12, z);
      collisions.add(object, new THREE.Vector3(w, h, d));
    }
    for (let z = 0; z < map.length; z++) {
      let x = 0;
      while (x < map[0].length) {
        if (!SOLID.has(map[z][x]) || urbanTiles.has(`${x},${z}`)) { x++; continue; }
        const water = map[z][x] === 'water';
        let x2 = x;
        while (x2 + 1 < map[0].length && !urbanTiles.has(`${x2+1},${z}`) && SOLID.has(map[z][x2 + 1]) && (map[z][x2 + 1] === 'water') === water &&
          (map[z][x2 + 1] === 'storeD69') === (map[z][x] === 'storeD69') &&
          (map[z][x2 + 1] === 'colpatria') === (map[z][x] === 'colpatria') &&
          (map[z][x2 + 1] === 'colpatriaAnnex') === (map[z][x] === 'colpatriaAnnex') &&
          (map[z][x2 + 1] === 'smallBuilding') === (map[z][x] === 'smallBuilding')) x2++;
        const o = new THREE.Object3D();
        o.position.set((W(x) + W(x2)) / 2, water ? -.4 : 0, W(z));
        collisions.add(o, new THREE.Vector3((x2 - x + 1) * T, water ? .4 : map[z][x] === 'smallBuilding' ? SMALL_BUILDING.height : map[z][x] === 'storeD69' ? 5 : map[z][x] === 'colpatria' ? COLPATRIA.height : map[z][x] === 'colpatriaAnnex' ? COLPATRIA_ANNEX.height : 8, T));
        x = x2 + 1;
      }
    }

  }

  _add(obj, x, z, rotY = 0) {
    obj.position.set(x, obj.position.y, z);
    obj.rotation.y = rotY;
    obj.position.y += this.getGroundHeightUnder(obj);
    this.group.add(obj);
    if (obj.userData.update) this.animated.push(obj);
    return obj;
  }

  getGroundTypeAt(x, z) {
    if (!this.map) return 'sidewalk';
    const row = Math.round(z / T);
    const col = Math.round(x / T);
    return this.map[row]?.[col] ?? 'sidewalk';
  }

  getGroundHeight(x, z) {
    if (inTerminal(x,z)) return terminalGroundHeight(x,z);
    if (onLakeBridge(x, z)) return bridgeHeight(z);
    const t = this.map[Math.round(z / T)]?.[Math.round(x / T)];
    return GROUND_HEIGHTS[t] ?? 0;
  }

  getMovementGroundHeight(x, z, currentY) {
    if (inTerminal(x,z)) return terminalGroundHeight(x,z);
    const deck = viaductSurface(x, z);
    // Solo se entra por la rampa o desde el propio tablero; debajo se conserva la calle.
    if (deck !== null && Math.abs(deck - currentY) < .6) return deck;
    if (onLakeBridge(x, z) && (deck === null || currentY < bridgeHeight(z) - .6)) {
      const type = this.map[Math.round(z / T)]?.[Math.round(x / T)];
      return GROUND_HEIGHTS[type] ?? 0;
    }
    return this.getGroundHeight(x, z);
  }

  /** Cota máxima bajo la base completa, incluida su rotación y los tiles vecinos. */
  getGroundHeightUnder(obj) {
    obj.updateWorldMatrix(true, true);
    const origin = obj.getWorldPosition(new THREE.Vector3());
    const footprint = new THREE.Box3();
    const bounds = new THREE.Box3();
    obj.traverseVisible(mesh => {
      if (!mesh.isMesh || !mesh.visible) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      bounds.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      // Solo piezas cercanas al piso: un tejado o las ramas no deben levantar el objeto.
      if (bounds.min.y <= origin.y + 0.15) footprint.union(bounds);
    });
    if (footprint.isEmpty()) return this.getGroundHeight(origin.x, origin.z);
    // Los tiles se extienden medio tile desde su centro; el contacto de borde no cuenta como área.
    const epsilon = 1e-7;
    const x0 = Math.max(0, Math.floor((footprint.min.x + T / 2 + epsilon) / T));
    const x1 = Math.min(this.map[0].length - 1, Math.ceil((footprint.max.x + T / 2 - epsilon) / T) - 1);
    const z0 = Math.max(0, Math.floor((footprint.min.z + T / 2 + epsilon) / T));
    const z1 = Math.min(this.map.length - 1, Math.ceil((footprint.max.z + T / 2 - epsilon) / T) - 1);
    let height = this.getGroundHeight(origin.x, origin.z);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      height = Math.max(height, GROUND_HEIGHTS[this.map[z]?.[x]] ?? 0);
    }
    return height;
  }

  /** Faroles, placas de nomenclatura, estación y bus de la troncal */
  _buildStreetProps(map) {
    // faroles cada ~14 m en los andenes junto a la calzada
    for (let z = 2; z < map.length - 2; z += 7) {
      for (let x = 2; x < map[0].length - 2; x += 7) {
        let best = null;
        for (let dz = 0; dz < 7 && !best; dz++) for (let dx = 0; dx < 7 && !best; dx++) {
          const tx = x + dx, tz = z + dz;
          if (map[tz]?.[tx] !== 'sidewalk') continue;
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => map[tz + b]?.[tx + a] === 'road')) best = [tx, tz];
        }
        if (!best) continue;
        const farol = new Farol(new THREE.Vector3(W(best[0]), SIDEWALK_Y, W(best[1])));
        farol.group.userData.noMerge = true; // cambia de material de noche
        this.group.add(farol.group);
        this.props.push({ instance: farol });
      }
    }
    // placas en las esquinas
    for (const [za, zb, calle] of CALLES) {
      for (const [xa, xb, carrera] of [...CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1], 'Av. Caracas']]) {
        this._add(P.streetSign([calle, carrera]), W(xa - 1), W(za - 1), 0.4);
      }
    }
    // Bus sin estación ni parada programada mientras se ajusta el puente.
    this.busService = new BusService(this.getBusRoute());
    this.group.add(this.busService.group);
    const route = this.getBusRoute();
    this.reverseBusService = new BusService({ ...route, x: TERMINAL.southLane, pathX: southBusPathX, startZ: route.endZ, endZ: route.startZ });
    this.reverseBusService.group.name = 'TransMilenio hacia el sur';
    this.group.add(this.reverseBusService.group);
    this.busServices = [this.busService, this.reverseBusService];

    // Avisos de neón comerciales en esquinas principales
    const neons = [
      { title: 'DROGUERÍA', sub: '24 HORAS', color: '#00ff88', accent: '#ff2255', x: W(CARRERAS[0][0] - 1), z: W(CALLES[0][0] - 1), ry: 0 },
      { title: 'PANADERÍA', sub: 'Y PASTELERÍA', color: '#ffb020', accent: '#ffe066', x: W(CARRERAS[1][1] + 1), z: W(CALLES[1][0] - 1), ry: Math.PI / 2 },
      { title: 'CIGARRERÍA', sub: 'LICORES Y DULCES', color: '#00d4ff', accent: '#ff0077', x: W(CARACAS.lanes[1][1] + 2), z: W(CALLES[0][1] + 1), ry: -Math.PI / 2 },
      { title: 'BILLAR CLUB', sub: 'TRES BANDAS', color: '#ff00aa', accent: '#00ffee', x: W(CARRERAS[0][1] + 1), z: W(CALLES[1][1] + 1), ry: Math.PI }
    ];
    for (const n of neons) {
      const sign = P.neonSign(n);
      sign.position.set(n.x, 3.8, n.z);
      sign.rotation.y = n.ry;
      this.group.add(sign);
      if (sign.userData.update) this.animated.push(sign);
    }
    // cerca de la estación: vendedor de tinto y una chaza
    this.vendors = [];
    this._vendor(WX(21), WZ(18.5), Math.PI / 2, 'chaza', 'Chaza de don Efraín', ['cigarrillo', 'cafe', 'pan', 'agua']);
    this._vendor(WX(28), WZ(29), 0, 'fritanga', 'Fritanga La Mona', ['lataComida', 'pan', 'refresco']);
    this._vendor(WX(39), WZ(36), -Math.PI / 2, 'chaza', 'Dulces y minutos', ['cigarrillo', 'refresco', 'agua']);
  }

  /** Vendedor ambulante: puesto + persona; se le puede comprar (lo atiende la tienda con otro catálogo) */
  _vendor(x, z, rotY, kind, title, items) {
    const stall = kind === 'fritanga' ? P.fritanga() : P.chaza();
    this._add(stall, x, z, rotY);
    const back = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).multiplyScalar(-0.9);
    this.npcs.push(new Npc(this.scene, new THREE.Vector3(x + back.x, this.getGroundHeight(x, z), z + back.z), {
      facing: rotY, isWalkable: () => false
    }));
    this.vendors.push({ kind: 'shop', title, items, position: new THREE.Vector3(x, 0, z) });
  }

  /** El Cartucho: humo, fuego, carretas, cambuches, ropa colgada y basura */
  _buildCartucho() {
    const cx = WX, cz = WZ;
    // canecas con fuego en la olla y el callejón
    for (const [x, z] of [[13, 19], [16.5, 24.5], [10, 21.5], [19.5, 22]]) this._add(P.fireBarrel(), cx(x), cz(z));
    // zorras de reciclaje
    for (const [x, z, r] of [[9.5, 22.5, 0.3], [12.5, 24.5, 1.9], [18.5, 21, -0.8], [20.5, 15, 1.2]]) this._add(P.zorra(), cx(x), cz(z), r);
    // cambuches ajenos contra las paredes
    for (const [x, z, r] of [[12.5, 18.3, 0], [15, 18.3, 0], [17.4, 20, Math.PI / 2], [12.3, 25.5, Math.PI], [11, 22.5, Math.PI / 2]]) this._add(P.shack(), cx(x), cz(z), r);
    // basura y colchones
    for (let i = 0; i < 9; i++) {
      const x = rand(9.5, 20.5), z = Math.random() < 0.5 ? rand(21, 22.5) : rand(18.5, 25);
      if (Math.hypot(cx(x) - cx(14.5), cz(z) - cz(21.5)) < 3) continue;
      this._add(Math.random() < 0.75 ? P.trashPile(4 + Math.floor(Math.random() * 5)) : P.mattress(), cx(x), cz(z), rand(0, 3));
    }
    // ropa colgada atravesando el callejón
    for (const x of [10.5, 18.5]) {
      const line = P.clothesline({ x: 0, z: -2.4 }, { x: 0, z: 2.4 }, 3.2);
      this._add(line, cx(x), cz(21.5));
    }
    // chaza dentro del callejón
    this._vendor(cx(18.5), cz(21.5), 0, 'chaza', 'Chaza del callejón', ['cigarrillo', 'pan', 'agua']);
  }

  _buildPark() {
    for (let i = 0; i < 9; i++) {
      const x = rand(29.5, 38.5), z = rand(33.5, 45.5);
      if (Math.abs(x - 33.5) < 1.6 || Math.abs(z - 39) < 1.2) continue;
      if (Math.hypot(WX(x) - SHELTER_LOCATION.x, WZ(z) - SHELTER_LOCATION.z) < 6) continue;
      this._add(P.tree(rand(0.9, 1.3)), WX(x), WZ(z));
    }
    for (const [x, z, r] of [[32, 37, Math.PI / 2], [35, 41, -Math.PI / 2], [31, 39.8, 0], [36.5, 38.2, Math.PI]]) {
      if (Math.hypot(WX(x) - SHELTER_LOCATION.x, WZ(z) - SHELTER_LOCATION.z) < 5) continue;
      const banca = new Banca(new THREE.Vector3(WX(x), 0.06, WZ(z)), r);
      this.group.add(banca.group);
    }
    // cartel del parque
    const sign = P.streetSign(['Parque', 'Tercer Milenio']);
    this._add(sign, WX(29), WZ(33), -0.6);
  }

  _buildExtensions() {
    for (const park of EXTENSION_PARKS) {
      for (let z=park.z0+1;z<park.z1;z+=4) for (let x=park.x0+1;x<park.x1;x+=4) {
        if (this.map[z][x] === 'grass') this._add(P.tree(rand(0.9,1.3)), W(x), W(z));
      }
      const pathZ=Math.floor((park.z0+park.z1)/2);
      for (const x of [park.x0+2,park.x1-2]) {
        const bench = new Banca(new THREE.Vector3(W(x), this.getGroundHeight(W(x),W(pathZ)), W(pathZ)), 0);
        this.group.add(bench.group);
      }
      this._add(P.streetSign([park.name, 'Bogotá']), W(park.x0), W(pathZ));
    }
    this._vendor(W(CARRERAS[2][0]-1.5), W(55), Math.PI/2, 'chaza', 'Chaza de la Carrera 8', ['agua','pan','cafe']);
    this._vendor(W(52), W(CALLES[2][0]-1.5), 0, 'fritanga', 'Fritanga del Sur', ['lataComida','pan','refresco']);
  }

  _buildLakePark() {
    // Arbolado espaciado; solo crece en césped, nunca dentro del lago o sobre el puente.
    for (let z = 230; z < 314; z += 12) for (let x = 14; x < 230; x += 12) {
      if (this.map[Math.round(z / T)]?.[Math.round(x / T)] !== 'grass' || onLakeBridge(x, z)) continue;
      this._add(P.tree(1 + ((x + z) % 3) * .12), x, z);
    }
    for (const [x, z] of [[20, 226], [132, 236], [134, 288], [20, 310], [156, 310]]) {
      const bench = new Banca(new THREE.Vector3(x, this.getGroundHeight(x, z), z), 0);
      this.group.add(bench.group);
    }
    this._add(P.streetSign([LAKE_PARK.name, 'Lago · Puente TransMilenio']), 150, 226);
  }

  _createPedestrianNavigation() {
    const carreras = [...CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1]]];
    return new PedestrianNavigation(this.map, T, {
      // Prolongación de los andenes en los cruces; no pasean por los carriles ni la estación.
      isCrossing: (x, z) => CALLES.some(([a, b]) =>
        (z >= a - SIDEWALK_TILES && z < a) || (z > b && z <= b + SIDEWALK_TILES)) ||
        (z === 113 || z === 155 || z === 79 || z === 89) ||
        (viaductHeight(z * T) > 2 && Math.abs(x * T - busPathX(z * T)) < 16) ||
        carreras.some(([a, b]) =>
          (x >= a - SIDEWALK_TILES && x < a) || (x > b && x <= b + SIDEWALK_TILES)),
      isBlocked: (x, z) => (x === Math.round(this.reserved.shop.x / T) && z === Math.round(this.reserved.shop.z / T)) ||
        GAS_OBSTACLES.some(o => Math.abs(x * T - o.x) < o.w / 2 + .3 && Math.abs(z * T - o.z) < o.d / 2 + .3),
      groundHeight: (x, z) => this.getGroundHeight(x, z)
    });
  }

  /** Peatones que recorren la ciudad; los vendedores conservan su puesto. */
  _spawnPeople() {
    const navigation = this.pedestrianNavigation = this._createPedestrianNavigation();
    const walk = (x, z) => navigation.isWalkableAt(x, z);
    const spots = [
      // El Cartucho y parque.
      [13.5, 20], [15.5, 20.5], [13, 23], [16, 23.5], [11, 21.8], [18, 22.4],
      [17, 19], [12.5, 21], [19.8, 21.5], [33.5, 36], [34, 43], [21, 30],
      // Andenes, incluyendo la calle donde empieza el jugador.
      [18, 11], [21, 11], [21, 16], [28, 19], [39, 20], [8, 27],
      [5, 18], [30, 29], [37, 32], [8, 37]
    ];
    for (const [x, z] of spots) {
      const position = navigation.nearestPoint(WX(x), WZ(z));
      if (!position) continue;
      this.npcs.push(new Npc(this.scene, position, {
        navigation, groundHeight: navigation.groundHeight, isWalkable: walk, gastada: true
      }));
    }
    // Mantiene la densidad del centro y distribuye peatones por los barrios nuevos.
    const candidates = navigation.nodes.filter(node => !node.crossing &&
      (node.x >= ORIGINAL_CITY_WIDTH-1 || node.z >= ORIGINAL_CITY_HEIGHT-1));
    const count = Math.min(candidates.length, Math.round(spots.length * (this.populationScale-1)));
    for (let i=0;i<count;i++) {
      const node=candidates[Math.floor((i+0.5)*candidates.length/count)];
      const position = new THREE.Vector3(W(node.x), this.getGroundHeight(W(node.x),W(node.z)), W(node.z));
      this.npcs.push(new Npc(this.scene, position, {
        navigation, groundHeight: navigation.groundHeight, isWalkable: walk, gastada: true
      }));
    }
  }

  /**
   * Junta en una sola malla todo lo estático que comparte material (postes de balcón, dulces,
   * gajos de paraguas, bolsas…): pasa de miles de llamadas de dibujo a unos cientos.
   */
  _mergeStatic() {
    this.group.updateMatrixWorld(true);
    const buckets = new Map();
    const replacedGeometries = new Set();
    const replacedMaterials = new Set();
    const visit = (o) => {
      if (o.userData.update || o.userData.noMerge) return; // animados y faroles quedan aparte
      if (o.isMesh && !Array.isArray(o.material) && !o.isSkinnedMesh) {
        if (!o.geometry.attributes.uv || !o.geometry.attributes.normal) return;
        // Conserva los índices: expandir cajas y planos duplicaba sus vértices.
        const key = `${o.material.userData.staticMergeKey ?? o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${!!o.geometry.index}|${geometryChunk(o.geometry, o.matrixWorld)}`;
        const g = o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        g.applyMatrix4(o.matrixWorld);
        const bucket = buckets.get(key) ?? { mat: o.material, cast: o.castShadow, recv: o.receiveShadow, list: [], sources: [] };
        buckets.set(key, bucket);
        bucket.list.push(g);
        bucket.sources.push(o);
        return;
      }
      if (o.isMesh && !o.isSkinnedMesh) o.matrixAutoUpdate = false;
      for (const c of o.children) visit(c);
    };
    for (const c of this.group.children) visit(c);
    for (const { mat, cast, recv, list, sources } of buckets.values()) {
      const merged = mergeGeometries(list);
      for (const geometry of list) geometry.dispose();
      if (!merged) continue;
      for (const source of sources) {
        source.parent.remove(source);
        replacedGeometries.add(source.geometry);
        replacedMaterials.add(source.material);
      }
      const mesh = new THREE.Mesh(merged, mat);
      mesh.customDepthMaterial = sources[0].customDepthMaterial; // mismo material, misma sombra
      mesh.castShadow = cast;
      mesh.receiveShadow = recv;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
    // Una geometría compartida por objetos animados sigue en uso.
    this.group.traverse((o) => {
      replacedGeometries.delete(o.geometry);
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) replacedMaterials.delete(material);
    });
    for (const geometry of replacedGeometries) geometry.dispose();
    for (const material of replacedMaterials) material.dispose();
  }

  // ---------- ciclo ----------

  async preloadDetails() {
    await Promise.all([
      this.signals.preloadModel(),
      ...this.props.map(prop => prop.instance.preloadModel?.())
    ]);
    if (!this._lampInstances) {
      this._lampInstances = instanceStaticModels(this.props.map(prop => prop.instance.model).filter(Boolean), this.group);
      this.group.add(this._lampInstances);
      this.renderSectors.push(...createRenderSectors(this._lampInstances));
      freezeStaticTransforms(this._lampInstances);
    }
    // Actualizar los límites después de cargar el mobiliario.
    this.group.updateWorldMatrix(true, true);
  }

  update(dt, playerPos, camera, trafficVehicles = []) {
    this.t += dt;
    P.foliageWind.value = this.t;
    this.signals?.update(this.t);
    for (const bus of this.busServices ?? []) bus.update(dt, { player: playerPos, pedestrians: this.trafficPedestrians ?? this.npcs, vehicles: trafficVehicles });
    for (const o of this.animated) o.userData.update(dt, this.t);
    // vista de la cámara una vez por cuadro: los NPC fuera de ella no se dibujan ni se animan
    let frustum = null;
    if (camera) {
      camera.updateMatrixWorld();
      if (playerPos) this.buildingVisibility.update(dt, playerPos, camera);
      _projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum = _frustum.setFromProjectionMatrix(_projView);
    }
    const ctx = { player: playerPos, frustum, camera, isRaining: (this.wetness ?? 0) > 0.05, animationBudget: this.animationBudget ?? 1 };
    for (const n of this.npcs) n.update(dt, ctx);
    for (const flock of this.pigeonFlocks ?? []) flock.update(dt, playerPos, this.npcs);
  }

  setNightMode(isNight) {
    for (const material of this.towerLights ?? []) material.emissiveIntensity = isNight ? 1.8 : .05;
    for (const p of this.props) p.instance.setNight?.(isNight);
    for (const m of this.facadeMats) m.emissiveIntensity = isNight ? 1.2 : 0;
    this.cerros?.userData?.setNight?.(isNight);
    for (const material of this.buildingVisibility.closedMaterials.values()) {
      if (material.emissiveMap) material.emissiveIntensity = isNight ? 1.2 : 0;
    }
  }

  dispose(scene) {
    for (const flock of this.pigeonFlocks ?? []) flock.dispose();
    this.signals?.dispose();
    this.stationGroup?.clear();
    for (const prop of this.props) prop.instance.dispose?.();
    for (const bus of this.busServices ?? []) bus.dispose();
    this.buildingVisibility.dispose();
    this._facadeTextures.clear();
    this._facadeMaterials.clear();
    scene.remove(this.group);
    for (const n of this.npcs) n.dispose();
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) { m?.map?.dispose?.(); m?.dispose?.(); }
    });
  }
}
