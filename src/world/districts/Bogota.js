import { planUrbanBuildings, buildUrbanBuilding, URBAN_DESIGNS } from '../bogota/UrbanBuildings.js';
import { neighborhoodAt } from '../bogota/NeighborhoodIdentity.js';
import { addBuildingDetails } from '../bogota/BuildingDetails.js';
import { addStreetDetails } from '../bogota/StreetDetails.js';
import { buildStreetMarkings } from '../bogota/StreetMarkings.js';
import { planUrbanTrees } from '../bogota/UrbanPlanting.js';
import { planParkVegetation, buildParkVegetation } from '../bogota/ParkVegetation.js';
import { buildSmallBuilding, SMALL_BUILDING } from '../bogota/SmallBuilding.js';
// src/world/districts/Bogota.js
// Centro de Bogotá (inspirado en Santa Inés / El Cartucho y la Av. Caracas).
//
// Ciudad de 200 × 161 tiles de 2 m; conserva el centro de 74 × 60 y añade barrios al oriente y al sur.
// La Candelaria y Chapinero ocupan X desde 267 m hacia +X, sin mover nada de lo anterior.
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
import { buildGroundWear, dressGrass, dressPaving } from '../bogota/GroundDressing.js';
import * as TX from '../bogota/textures.js';
import * as P from '../bogota/props.js';
import { Npc } from '../../entities/Npc.js';
import { BuildingVisibility, CLOSED_CHUNK_SIZE, createBuildingShell } from '../bogota/BuildingVisibility.js';
import { PedestrianNavigation } from '../bogota/PedestrianNavigation.js';
import { GpsNavigation } from '../../systems/GpsNavigation.js';
import { TrafficRoute } from '../bogota/TrafficRoute.js';
import { BusService } from '../bogota/BusService.js';
import { skylineFloors, buildAvenueOverpass, AVENUE_OVERPASS } from '../bogota/AvenueLandmarks.js';
import { GAS_STATION, GAS_OBSTACLES, inGasStation, underGasCanopy, buildGasStation } from '../bogota/GasStation.js';
import { buildD69Store } from '../bogota/D69Store.js';
import { buildColpatria, COLPATRIA, COLPATRIA_ANNEX, BUS_DETOUR, busPathX, southBusPathX } from '../bogota/Colpatria.js';
import { VIADUCT, buildColpatriaViaduct, viaductHeight, viaductSurface } from '../bogota/ColpatriaViaduct.js';
import { TERMINAL, inTerminal, terminalGroundHeight, buildTransitTerminal, crossesIslandEdge, crowdsIslandPole, islandAisleX, underTerminalRoof } from '../bogota/TransitTerminal.js';
import { LAKE_BRIDGE, LAKE_PARK, onLakeBridge, bridgeHeight, buildLakeWater, buildLakeTerrain,
  inLakeTerrain, lakeTerrainHeight, lakeWaterInfo } from '../bogota/LakePark.js';
import { createLakeWaterMaterial } from '../bogota/LakeWaterMaterial.js';
import { PigeonFlock } from '../../entities/PigeonFlock.js';
import { geometryChunk, mergeByChunk, freezeStaticTransforms, createRenderSectors, instanceStaticModels } from '../bogota/StaticGeometry.js';
import { CITY_WIDTH, CITY_HEIGHT, CITY_AREA_MULTIPLIER, CITY_CARRERAS as CARRERAS,
  CITY_CALLES as CALLES, ORIGINAL_CITY_WIDTH, ORIGINAL_CITY_HEIGHT, EXTENSION_PARKS,
  expandCity } from '../bogota/CityLayout.js';
import { EAST_SEAM, EAST_CITY_WIDTH, CARRERA_3, CARRERA_4, CALLE_6, CALLE_5, CANDELARIA_END_Z, COMMERCIAL_STREET,
  CHURCH_FRONT_COLLIDER, FOUNTAIN, MARKET, NARROW_CALLES, PLAZA, TEUSAQUILLO_PARK, TOWERS, TOWERS_LOT, churchStepHeight, eastCrossing, inTowerLot, insideTower, towerColliderBoxes } from '../bogota/EastZones.js';
import { cobblestones, flagstones, forgetZoneTextures } from '../bogota/ZoneTextures.js';
import { Batch, ALL_FACES, FACES, createZoneMaterials } from '../bogota/ZoneGeometry.js';
import { planEastLots, buildColonialHouse, buildEnglishHouse, buildShopHouse } from '../bogota/EastBuildings.js';
import { buildChurch, buildCurvedTower, towerSilhouette, buildFountain, buildMarket } from '../bogota/EastLandmarks.js';
import { buildCityEdge, buildTerminalEdge } from '../bogota/CityEdge.js';
import { buildCityBackdrop } from '../bogota/CityBackdrop.js';

import { ORIGINAL_SIZE as S, ORIGINAL_CARRERAS, ORIGINAL_CARACAS, ORIGINAL_CALLES,
  CARACAS, STREET_X, STREET_Z, expandStreets,
  migrateStreetPosition, WORLD_LAYOUT_VERSION, SIDEWALK_TILES } from '../bogota/StreetLayout.js';
const T = TILE_SIZE;
const TERMINAL_CITY_GAP = 13;
// Tierra pisada alrededor del cambuche y las dos trochas que salen de él hacia el andén.
const CAMP_WEAR = {
  spots: [{ x: 112.98, z: 94.64, radius: 5.5, amount: .24 }],
  trails: [{ from: [112.6, 91.5], to: [113.8, 88.2], width: 1.5, amount: .3 }, { from: [115.6, 96], to: [117.6, 98.4], width: 1.4, amount: .26 }],
};
const WALKABLE = new Set(['road', 'busway', 'sidewalk', 'dirt', 'grass', 'plaza', 'floor']);
const SOLID = new Set(['building', 'ruin', 'wall', 'storeD69', 'colpatria', 'colpatriaAnnex', 'smallBuilding']);
const SIDEWALK_Y = 0.12;
// La colocación de objetos debe usar las mismas cotas que la malla del terreno.
const GROUND_HEIGHTS = Object.freeze({
  road: 0, busway: 0.02, sidewalk: SIDEWALK_Y, floor: SIDEWALK_Y,
  dirt: 0.04, grass: 0.06, plaza: SIDEWALK_Y, water: -.18
});

// Las torres son curvas y sus tiles no: en las esquinas que sobran se pisa el mismo piso que se dibuja.
const tileGroundHeight = (type, tileX, tileZ) => type === 'building' && inTowerLot(tileX, tileZ) ? SIDEWALK_Y : GROUND_HEIGHTS[type] ?? 0;

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

// Del tablero del puente al piso, para que quepa una persona debajo: la losa mide .71 m.
const DECK_HEADROOM = 2.8;
const EAST_PEDESTRIANS = 14;
// Peatones de la ciudad, sin contar a los vendedores.
const TOTAL_PEDESTRIANS = 80;
// Posturas de quien atiende un puesto.
const VENDOR_POSES = ['atender', 'atender', 'atender', 'brazos-cruzados', 'celular'];
// Posturas de quien conversa con alguien.
const TALK = ['hablar', 'hablar', 'hablar', 'brazos-cruzados', 'bolsillos'];
// Posturas de quien espera el bus.
const WAIT = ['celular', 'mirar-izquierda', 'celular', 'mirar-derecha', 'cambiar-peso'];
// Lo que se queda quieto ocupa el andén y el prado, no la calle (ver tests/fixed-people.test.js).
const BENCH_FRONT = .1;  // m del centro de la banca a la raíz de quien se sienta
const benchFootprint = ({ x, z, rot }) => { // medio largo .83 m, medio fondo .3 m: por ahí no pasa la red de peatones
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)), hx = c * .83 + s * .3, hz = s * .83 + c * .3;
  return { minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz };
};
const FIXED_REACH = 4;   // m: lo que se le permite alejarse de la red a quien vuelve a su sitio
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
const repeatAll = (t) => { if (!t) return t; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); t.anisotropy = 8; t.needsUpdate = true; return t; };
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
    // Más basura y carros parqueados para los barrios nuevos, sin que la ciudad se llene.
    // Basura y parqueados se reparten por toda la ciudad: con 3 el centro se quedaría con un tercio menos.
    this.populationScale = Math.min(4.6, CITY_AREA_MULTIPLIER);
    this.size = Math.max(this.width, this.height);
    this.layoutVersion = WORLD_LAYOUT_VERSION;
    this.props = [];          // { instance } con setNight/update (faroles de bazuko)
    this.benchSpots = [];     // bancas puestas: { x, y, z, rot }
    this.animated = [];       // grupos con userData.update
    this.facadeMats = [];
    this._facadeTextures = new Map();
    this._facadeSeeds = new Map();
    this._facadeMaterials = new Map();
    this.npcs = [];
    this.vendors = [];
    this.fireBarrels = [];
    this._roomBoxes = [];
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
    this._buildEastSquares(map, collisions);
    this._buildBorder(map, collisions);
    const viaduct = buildColpatriaViaduct(map, { pavement: this.groundMaterials.road,
      groundHeight: (x, z) => this.getWaterInfo(x, z)?.bottomY ?? 0 });
    this.group.add(viaduct);
    for (const box of viaduct.userData.colliders) collisions?.colliders.push({ box, mesh: new THREE.Object3D(), layered: true });
    this.stationGroup = buildTransitTerminal({ createSign: signTexture, asphalt: this.groundMaterials.road });
    this.group.add(this.stationGroup);
    for (const entry of this.stationGroup.userData.colliders) collisions?.colliders.push(entry);
    // Los límites de la terminal son solo colisión: fusionados con lo demás se verían como una pared gris.
    for (const mesh of [...this.stationGroup.children]) if (!mesh.visible) this.stationGroup.remove(mesh);
    this._buildStreetProps(map);
    this._buildCartucho();
    this._buildPark();
    this._buildExtensions();
    this._buildLakePark();
    this._buildGreenery();
    this.group.add(buildAvenueOverpass());
    this.group.add(buildGasStation({ createSign: signTexture }));
    this.group.add(buildD69Store({ createSign: signTexture }));
    this.group.add(buildSmallBuilding({ brickTextures: TX.brick(53) }));
    const tower = buildColpatria({ createSign: signTexture });
    this.towerLights = tower.userData.lightMaterials;
    this.group.add(tower);
    const parks = [
      { x0: WX(29.5), x1: WX(37.5), z0: WZ(33.5), z1: WZ(44.5) },
      ...EXTENSION_PARKS.map(park => ({ x0: W(park.x0 + .5), x1: W(park.x1 - .5), z0: W(park.z0 + .5), z1: W(park.z1 - .5) })),
      { x0: W(PLAZA.x0 + 2), x1: W(PLAZA.x0 + 16), z0: W(PLAZA.z0 + 2), z1: W(PLAZA.z1 - 2) }
    ];
    this.pigeonFlocks = parks.map(bounds => new PigeonFlock(scene, bounds, {
      groundHeight: (x, z) => this.getGroundHeight(x, z),
      isGround: (x, z) => ['grass', 'plaza'].includes(map[Math.round(z / T)]?.[Math.round(x / T)]) &&
        Math.hypot(x - SHELTER_LOCATION.x, z - SHELTER_LOCATION.z) > 6
    }));

    this._mergeStatic();
    this.group.add(this.buildingVisibility.buildClosedView());
    // Las torres se ven desde todo el barrio: su material lo permite, y aquí tampoco las corta Three.
    this.group.traverse(mesh => { if (mesh.material?.userData?.pastFar) mesh.frustumCulled = false; });
    const closedView = this.buildingVisibility.closedView;
    this.renderSectors = [
      ...createRenderSectors(this.group, new Set([closedView, this.cerros, ...this.busServices.map(bus => bus.group)]), CLOSED_CHUNK_SIZE),
      ...createRenderSectors(closedView, undefined, CLOSED_CHUNK_SIZE)
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
          // En el oriente tampoco sobre la fuente, los puestos del mercado ni detrás de un cierre.
          if (tx >= EAST_SEAM && this._pedestrianRules().isBlocked(tx, tz)) continue;
          // Ni donde un cuerpo no cabe: pegado a una caja sólida, o dentro de ella.
          const y = this.getGroundHeight(x, z), r = .4;
          if (collisions.queryStatic(x - r, z - r, x + r, z + r, []).some(({ box, layered }) => !(layered && (y > box.max.y || y + 1.6 < box.min.y))
            && x > box.min.x - r && x < box.max.x + r && z > box.min.z - r && z < box.max.z + r)) continue;
          grid.push(new THREE.Vector3(x, 0, z));
        }
      }
      return grid;
    };

    this._collisions = collisions;
    this._noteFallRoom(collisions);
    this._spawnPeople();
    addStreetDetails(this, collisions);
    if (collisions) this.pedestrianNavigation.cutSolidEdges(collisions, undefined, this.benchSpots.map(benchFootprint));
  }

  /**
   * Puestos de parqueo: calzada pegada al andén, lejos de cruces y de la troncal.
   * El carro mira a lo largo de la calle (su frente es +x local).
   */
  getParkingSpots() {
    const m = this.map;
    const spots = [];
    // La Calle 6 no está en CALLES, pero el enlace de Chapinero dobla en ella: un carro en esa esquina le corta la curva.
    const nearCross = (x, z) => [...CALLES, CALLE_6].some(([a, b]) => z >= a - 2 && z <= b + 2) && [...CARRERAS, ...CARACAS.lanes.map(([a, b]) => [a, b])].some(([a, b]) => x >= a - 2 && x <= b + 2);
    for (let z = 2; z < m.length - 2; z++) {
      // Los circuitos centrales quedan libres; se conserva el parqueo en los extremos.
      if (z >= CALLES[0][0] - 2 && z <= CALLES[1][1] + 2) continue;
      for (let x = 2; x < m[0].length - 2; x++) {
        if (m[z][x] !== 'road' || nearCross(x, z) || this._noParking(x, z)) continue;
        if (x >= CARACAS.lanes[0][0] && x <= CARACAS.lanes[1][1]) continue; // la Caracas no se parquea
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (m[z + dz][x + dx] !== 'sidewalk') continue;
          // andén a los lados en x → la calle corre a lo largo de z
          const alongZ = dx !== 0;
          const spot = { x: W(x) + dx * 0.4, z: W(z) + dz * 0.4, rot: alongZ ? Math.PI / 2 : 0 };
          if (this._spotOnPavement(spot)) spots.push(spot);
        }
      }
    }
    return spots;
  }

  /** El carro entero cabe en calzada y andén: con media carrocería sobre el pasto quedaba enterrado de un lado. */
  _spotOnPavement({ x, z, rot }) {
    const [alongX, alongZ] = rot ? [0, 1] : [1, 0];
    for (const along of [-2.7, 0, 2.7]) for (const across of [-1.15, 1.15]) {
      const tile = this.map[Math.round((z + alongZ * along + alongX * across) / T)]?.[Math.round((x + alongX * along + alongZ * across) / T)];
      if (tile !== 'road' && tile !== 'sidewalk') return false;
    }
    return true;
  }

  /** Calles de cuatro tiles: un carro parqueado invadiría el único carril de su sentido. */
  _noParking(x, z) {
    if (x < EAST_SEAM) return false;
    if (x <= 133) return x <= 127;
    if (z <= CANDELARIA_END_Z) return true;
    const narrow = [CARRERA_4, CARRERA_3].some(([a, b]) => x >= a - 3 && x <= b + 3);
    return narrow || z <= 66;
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
    // Circuitos del oriente: giran siempre a la derecha, por la Carrera 5 y el carril occidental
    // de la Carrera 3. Así las calles de cuatro tiles nunca cruzan el sentido contrario.
    const carrera5 = lane(CARRERAS.at(-1), 1), carrera3 = lane(CARRERA_3, -1);
    const narrow = ([a, b], side) => lane([a + 1, b - 1], side);
    const candelaria = new TrafficRoute(carrera5, carrera3, narrow(NARROW_CALLES[0], 1), narrow(NARROW_CALLES[1], -1), 3.2);
    const chapinero = new TrafficRoute(carrera5, carrera3, lane(CALLES[2], 1), lane(CALLES[3], -1), 3.2);
    routes.push(candelaria, chapinero);
    // Combinar calles y carreras permite continuar por otros barrios en los cruces.
    // Solo las ocho rutas de partida generan carros; las demás son alternativas.
    // La Carrera 5 queda fuera: si los carros del centro pasaran al oriente y volvieran, los
    // cruces anchos de Caracas recibirían más de los que pueden despachar y se atascarían.
    const vertical = [CARRERAS[0], ...CARACAS.lanes, ...CARRERAS.slice(1, -1)];
    const alternatives = new Map(routes.map(route => [route.key, route]));
    for (let left = 0; left < vertical.length - 1; left++) for (let right = left + 1; right < vertical.length; right++) {
      for (let north = 0; north < CALLES.length - 1; north++) for (let south = north + 1; south < CALLES.length; south++) {
        const route = circuit(lane(vertical[left], 1), lane(vertical[right], -1), lane(CALLES[north], 1), lane(CALLES[south], -1));
        if (!route) continue;
        if (!alternatives.has(route.key)) alternatives.set(route.key, route);
      }
    }
    // Alternativas sin carros propios: el resto de Chapinero y el enlace entre los dos barrios.
    for (const route of [
      new TrafficRoute(carrera5, carrera3, lane(CALLES[3], 1), lane(CALLE_6, -1), 3.2),
      new TrafficRoute(carrera5, carrera3, narrow(NARROW_CALLES[0], 1), lane(CALLES[3], -1), 3.2)
    ]) if (!alternatives.has(route.key)) alternatives.set(route.key, route);
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
    const grass = TX.grass(61);
    const concrete = TX.concrete(41);
    const tex = (t, scale) => { if (!t) return t; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData = { scale }; return t; };
    const mats = {
      // Relieve y rugosidad independientes del color: las reparaciones no son agujeros.
      road: new THREE.MeshStandardMaterial({
        map: tex(asphalt.map, 14),
        bumpMap: tex(asphalt.bumpMap, 14),
        roughnessMap: tex(asphalt.roughnessMap, 14),
        bumpScale: 0.025,
        roughness: 0.82,
        color: '#dededb'
      }),
      busway: new THREE.MeshStandardMaterial({
        map: tex(asphalt.map, 14),
        bumpMap: tex(asphalt.bumpMap, 14),
        roughnessMap: tex(asphalt.roughnessMap, 14),
        bumpScale: 0.025,
        roughness: 1,
        color: '#b9a29c'
      }),
      sidewalk: new THREE.MeshStandardMaterial({
        map: tex(walk.map, 6),
        bumpMap: tex(walk.bumpMap, 6),
        roughnessMap: tex(walk.roughnessMap, 6),
        bumpScale: 0.035,
        roughness: 0.75,
        color: '#e2dfd5'
      }),
      floor: new THREE.MeshStandardMaterial({ map: tex(concrete.map, 6), bumpMap: tex(concrete.bumpMap, 6), bumpScale: .025, roughnessMap: concrete.roughnessMap, roughness: 0.95, color: '#dedbd2' }),
      dirt: new THREE.MeshStandardMaterial({ map: tex(dirt.map, 8), bumpMap: tex(dirt.bumpMap, 8), bumpScale: .035, roughnessMap: dirt.roughnessMap, roughness: 1, color: '#d8cbb4' }),
      grass: new THREE.MeshStandardMaterial({ map: tex(grass.map, 8), bumpMap: tex(grass.bumpMap, 8), bumpScale: .05, roughnessMap: grass.roughnessMap, roughness: 1, color: '#c2c7ac' }),
      plaza: new THREE.MeshStandardMaterial({ map: tex(walk.map, 6), bumpMap: walk.bumpMap, bumpScale: .035, roughnessMap: walk.roughnessMap, roughness: 0.85, color: '#dfd6be' }),
      water: createLakeWaterMaterial()
    };
    // Cuatro acabados compartidos para todo el mapa, sin una textura por baldosa.
    for (const id of ['cambuche', 'comercio', 'lago']) {
      const paving = TX.sidewalk(11, { district: id });
      const material = new THREE.MeshStandardMaterial({ map: tex(paving.map, 6),
        bumpMap: tex(paving.bumpMap, 6), bumpScale: .035, roughnessMap: paving.roughnessMap,
        roughness: .85, color: '#e2dfd5' });
      material.name = `Andén · ${id}`;
      material.userData.surface = 'sidewalk';
      mats[`sidewalk_${id}`] = material;
    }
    // Candelaria: adoquín sin pintura y andén angosto de losa. Chapinero: andén propio y más ancho.
    const zoneMaterial = (name, maps, scale, parameters) => {
      const material = new THREE.MeshStandardMaterial({ map: tex(maps.map, scale), bumpMap: tex(maps.bumpMap, scale),
        roughnessMap: tex(maps.roughnessMap, scale), ...parameters });
      material.name = name;
      return material;
    };
    const cobbles = cobblestones(), slabs = flagstones(3381, { tint: '#8f8878' }), plazaSlabs = flagstones(5581, { tint: '#a39b8a', slabW: 170, slabH: 112 });
    mats.road_cobbles = zoneMaterial('Adoquín', cobbles, 2.6, { bumpScale: .05, roughness: .95, color: '#d8d2c6' });
    mats.sidewalk_candelaria = zoneMaterial('Andén de la Candelaria', slabs, 6, { bumpScale: .035, roughness: .85, color: '#e9e4d8' });
    mats.sidewalk_candelaria.userData.surface = 'sidewalk';
    mats.plaza_candelaria = zoneMaterial('Plaza de la Candelaria', plazaSlabs, 6, { bumpScale: .03, roughness: .85, color: '#eee8dc' });
    const chapineroPaving = TX.sidewalk(11, { district: 'chapinero' });
    mats.sidewalk_chapinero = zoneMaterial('Andén de Chapinero', chapineroPaving, 6, { bumpScale: .035, roughness: .85, color: '#e2dfd5' });
    mats.sidewalk_chapinero.userData.surface = 'sidewalk';
    const scaleOf = { road: 14, busway: 14, sidewalk: 6, floor: 6, dirt: 8, grass: 8, plaza: 6, water: 16,
      road_cobbles: 2.6, sidewalk_candelaria: 6, sidewalk_chapinero: 6, plaza_candelaria: 6,
      sidewalk_cambuche: 6, sidewalk_comercio: 6, sidewalk_lago: 6 };
    dressGrass(mats.grass, buildGroundWear(map, CAMP_WEAR));
    for (const key of ['sidewalk', 'plaza', 'sidewalk_cambuche', 'sidewalk_comercio', 'sidewalk_lago',
      'sidewalk_candelaria', 'sidewalk_chapinero', 'plaza_candelaria']) dressPaving(mats[key]);
    const heightOf = GROUND_HEIGHTS;
    const quads = {};
    for (let z = 0; z < map.length; z++) {
      for (let x = 0; x < map[0].length; x++) {
        // Las torres son curvas y sus tiles no: en las esquinas que sobran sigue el piso del lote.
        const underTower = map[z][x] === 'building' && x >= TOWERS_LOT.x0 && x <= TOWERS_LOT.x1 && z >= TOWERS_LOT.z0 && z <= TOWERS_LOT.z1;
        const t = underTower ? 'sidewalk' : map[z][x];
        if (!mats[t] || t === 'water' || inLakeTerrain(W(x), W(z))) continue;
        // Bajo el puente también hay piso: sus tiles sobran un metro a cada lado del tablero y se camina junto al estribo.
        // Queda por debajo de donde nace la rampa, para no pelear con ella.
        const underBridge = onLakeBridge(W(x), W(z));
        const g = new THREE.PlaneGeometry(T, T, underBridge ? 2 : 1);
        g.rotateX(-Math.PI / 2);
        g.translate(W(x), underBridge ? 0 : heightOf[t], W(z));
        const uv = g.attributes.uv, pos = g.attributes.position;
        // Al norte sube hasta el terreno del lago, metro a metro, para no dejar una rendija abierta al cielo.
        if (underBridge) for (let i = 0; i < pos.count; i++) {
          if (inLakeTerrain(pos.getX(i), pos.getZ(i))) pos.setY(i, this._lakeGroundHeight(pos.getX(i), pos.getZ(i)));
        }
        const neighborhood = neighborhoodAt(W(x), W(z));
        const materialKey = neighborhood.id === 'candelaria' && t === 'road' ? 'road_cobbles'
          : neighborhood.id === 'candelaria' && t === 'plaza' ? 'plaza_candelaria'
            : t === 'sidewalk' && neighborhood.id !== 'centro' ? `sidewalk_${neighborhood.id}` : t;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i) / scaleOf[materialKey], pos.getZ(i) / scaleOf[materialKey]);
        (quads[materialKey] ??= []).push(g);
        // Contra el pasto, que queda más alto, una cara cierra la rendija por donde se vería el cielo.
        if (underBridge) for (const dx of [-1, 1]) {
          const side = heightOf[map[z][x + dx]];
          if (onLakeBridge(W(x + dx), W(z)) || !side || side >= SIDEWALK_Y) continue;
          const c = new THREE.PlaneGeometry(T, side);
          c.rotateY(dx > 0 ? -Math.PI / 2 : Math.PI / 2);
          c.translate(W(x) + dx * T / 2, side / 2, W(z));
          quads[materialKey].push(c);
        }
        // bordillo: cara vertical hacia la calle
        if (heightOf[t] >= SIDEWALK_Y && !onLakeBridge(W(x), W(z))) {
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = map[z + dz]?.[x + dx];
            if (n !== 'road' && n !== 'busway') continue;
            const c = new THREE.PlaneGeometry(T, SIDEWALK_Y);
            c.rotateY(dx ? (dx > 0 ? Math.PI / 2 : -Math.PI / 2) : (dz > 0 ? 0 : Math.PI));
            c.translate(W(x) + dx * T / 2, SIDEWALK_Y / 2, W(z) + dz * T / 2);
            (quads[neighborhood.id === 'candelaria' ? 'curb_stone' : 'curb'] ??= []).push(c);
          }
        }
      }
    }
    mats.curb = new THREE.MeshStandardMaterial({
      color: '#d8d4c8',
      roughness: 0.8,
      map: tex(concrete.map, 4),
      bumpMap: tex(concrete.bumpMap, 4),
      bumpScale: 0.025
    });
    mats.curb_stone = new THREE.MeshStandardMaterial({ color: '#8a8478', roughness: .9, map: tex(concrete.map, 4), bumpMap: tex(concrete.bumpMap, 4), bumpScale: .03 });
    this.groundMaterials = mats;
    const landHeightAt = (x, z) => this._lakeLandHeight(x, z);
    const lakePaving = mats.sidewalk_lago;
    this.lakeTerrain = buildLakeTerrain(landHeightAt, { groundMap: mats.grass.map,
      groundBumpMap: mats.grass.bumpMap, groundTint: mats.grass.color,
      plazaMap: lakePaving.map, plazaBumpMap: lakePaving.bumpMap, plazaTint: lakePaving.color });
    this.lakeWater = buildLakeWater(mats.water, landHeightAt);
    this.group.add(this.lakeTerrain, this.lakeWater);
    this.animated.push(this.lakeWater);
    for (const [t, list] of Object.entries(quads)) {
      this.group.add(mergeByChunk(list, mats[t], { receiveShadow: true }));
    }
  }

  /** Cebras en los cruces, líneas amarillas y separadores de la troncal */

  /** Ajusta el acabado del asfalto y andenes según la lluvia o humedad ambiental */
  setWetness(amount = 0) {
    this.wetness = amount;
    this.signals?.setWetness(amount);
    Farol.setWetness(amount);
    this.isRaining = amount > 0.05;
    if (!this.groundMaterials) return;
    const wet = THREE.MathUtils.clamp(amount, 0, 1) * (this.graphicsQuality === 'baja' ? .65 : 1);
    this.stationGroup?.userData.setWetness?.(wet);
    if (this.groundMaterials.road) {
      this.groundMaterials.road.roughness = THREE.MathUtils.lerp(0.82, 0.48, wet);
      this.groundMaterials.road.metalness = 0;
      this.groundMaterials.road.envMapIntensity = THREE.MathUtils.lerp(0.3, 1.05, wet);
    }
    if (this.groundMaterials.busway) {
      this.groundMaterials.busway.roughness = THREE.MathUtils.lerp(1.0, 0.6, wet);
      this.groundMaterials.busway.metalness = 0;
      this.groundMaterials.busway.envMapIntensity = THREE.MathUtils.lerp(0.25, .85, wet);
    }
    for (const [name, material] of Object.entries(this.groundMaterials)) {
      const pavement = name.startsWith('sidewalk') || name.startsWith('plaza') || name === 'floor';
      if (name === 'road_cobbles') {
        // El adoquín mojado brilla más que el asfalto: es lo que hace reconocible una calle de piedra.
        material.roughness = THREE.MathUtils.lerp(.95, .4, wet);
        material.metalness = 0;
        material.envMapIntensity = THREE.MathUtils.lerp(.25, 1.1, wet);
      }
      if (pavement) {
        material.roughness = THREE.MathUtils.lerp(.85, .63, wet);
        material.metalness = 0;
        material.envMapIntensity = THREE.MathUtils.lerp(.2, .65, wet);
      }
      if (pavement || name === 'road' || name === 'busway' || name === 'road_cobbles') {
        // Conservar el acabado seco para que alternar lluvia no acumule oscurecimiento.
        material.userData.dryColor ??= material.color.clone();
        material.color.copy(material.userData.dryColor).multiplyScalar(1 - wet * .09);
      }
    }
  }

  _buildMarkings() { buildStreetMarkings(this); }

  /** Fachadas continuas: casas de 2 a 4 tiles de frente, con fachada pintada, ladrillo o en ruina */
  _buildBlocks(map) {
    const isB = (x, z) => map[z]?.[x] === 'building' || map[z]?.[x] === 'ruin';
    // Lo viejo se reparte como si la columna X 119 siguiera siendo muro: nada cambia de solar.
    const walk = (x, z) => x < EAST_SEAM && WALKABLE.has(map[z]?.[x]);
    const brick = TX.brick(3);
    const sideMat = new THREE.MeshStandardMaterial({ map: repeatAll(brick.map), bumpMap: repeatAll(brick.bumpMap), bumpScale: 0.045, roughnessMap: brick.roughnessMap, roughness: 0.95, color: '#e0d3c6' });
    const slab = TX.slab(13), tiles = TX.roofTiles(9);
    const roofMat = new THREE.MeshStandardMaterial({ map: repeatAll(slab.map), bumpMap: repeatAll(slab.bumpMap),
      bumpScale: .025, roughnessMap: repeatAll(slab.roughnessMap), roughness: .95 });
    const tileRoof = new THREE.MeshStandardMaterial({ map: repeatAll(tiles.map), bumpMap: repeatAll(tiles.bumpMap),
      bumpScale: .035, roughnessMap: repeatAll(tiles.roughnessMap), roughness: .85 });
    this._interiorMat = new THREE.MeshStandardMaterial({ map: roofMat.map, color: '#675e50', roughness: 1 });
    this._uvUnits = { brick: [TX.BRICK_TILE.w, TX.BRICK_TILE.h], slab: [4, 4], tiles: [2, 2] };
    const covered = new Set();
    for (let z = 0; z < map.length; z++) for (let x = EAST_SEAM; x < map[z].length; x++) covered.add(`${x},${z}`);
    this.urbanBuildings = planUrbanBuildings(map);
    const urbanPalette = {
      facades: URBAN_DESIGNS.map((design,i)=>{
        const tex=TX.facade({seed:170+i,width:6,floors:3,pxPerM:32,shopFront:false,style:i===0?'ladrillo':'concreto',wallColor:['#975c40','#b6b3a8','#c3b8a5','#857c70','#687d81'][i]});
        return new THREE.MeshStandardMaterial({map:repeatAll(tex.map),emissiveMap:repeatAll(tex.emissiveMap),emissive:'#ffffff',emissiveIntensity:0,bumpMap:repeatAll(tex.bumpMap),bumpScale:.04,roughnessMap:repeatAll(tex.roughnessMap),roughness:i===4?.7:.95});
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
      for(const part of building.parts)for(const material of part.materials)if(material.emissiveMap || material.userData.windowGlow)this.facadeMats.push(material);
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
          if (!run.length) return;
          // Partición propia por tramo: crear texturas, UUID o adornos no mueve solares.
          const widthRandom = TX.rng((Math.imul(run[0][0] + 17, 73856093)
            ^ Math.imul(run[0][1] + 31, 19349663) ^ Math.imul(face + 1, 83492791) ^ 0x4b4f474f) >>> 0);
          let i = 0;
          while (i < run.length) {
            const wTiles = Math.min(run.length - i, 2 + Math.floor(widthRandom() * 3));
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

    // El relleno también se divide por sectores para poder ocultarlo por separado.
    for (let z = 0; z < map.length; z++) for (let x = 0; x < map[0].length; x++) {
      const type = map[z][x];
      if (!isB(x, z) || covered.has(`${x},${z}`)) continue;
      let width = 1, depth = 1;
      const available = (tx, tz) => map[tz]?.[tx] === type && !covered.has(`${tx},${tz}`);
      while (width < 4 && available(x + width, z)) width++;
      while (depth < 4 && Array.from({ length: width }, (_, i) => available(x + i, z + depth)).every(Boolean)) depth++;
      for (let dz = 0; dz < depth; dz++) for (let dx = 0; dx < width; dx++) covered.add(`${x + dx},${z + dz}`);
      const h = type === 'ruin' ? 4.5 : 6.5;
      const material = roofMat;
      const sx = width * T, sz = depth * T;
      const geometry = worldUVs(new THREE.BoxGeometry(sx, h, sz), sx, h, sz, Array(6).fill(this._uvUnits.slab));
      const shell = createBuildingShell(geometry, Array(6).fill(material), {
        x: W(x) + (width - 1) * T / 2, z: W(z) + (depth - 1) * T / 2, height: h, interiorMaterial: this._interiorMat
      });
      this.group.add(shell.root);
      this.buildingVisibility.register(shell);
    }
    this._buildEastBlocks(map);
  }

  /** Casas del oriente: variantes de muro, ladrillo y detalles compartidas por barrio. */
  _buildEastBlocks(map) {
    const m = this.zoneMaterials = createZoneMaterials();
    this.facadeMats.push(m.detail, m.tower);
    const { lots, patios } = this.eastPlan = planEastLots(map);
    const registerShell = shell => {
      this.group.add(shell.root);
      const building = this.buildingVisibility.register(shell);
      for (const part of building.parts) for (const material of part.materials) {
        if (material.emissiveMap || material.userData.windowGlow) this.facadeMats.push(material);
      }
    };
    const murals = [[.02, .52, .48, .98], [.52, .52, .98, .98], [.02, .02, .48, .48], [.52, .02, .98, .48]];
    let lastLamp = null;
    for (const lot of lots) {
      const built = lot.zone === 'colonial' ? buildColonialHouse(lot, m, murals)
        : lot.commercial ? buildShopHouse(lot, m) : buildEnglishHouse(lot, m);
      registerShell(built.shell);
      // Faroles coloniales: la casa propone, la distancia decide; el grupo de luces local solo enciende los cercanos.
      if (built.lantern && (!lastLamp || lastLamp.distanceTo(built.lantern) > 9)) {
        this._addLanternLight(built.lantern);
        lastLamp = built.lantern;
      }
    }
    registerShell(buildChurch(m).shell);
    for (const tower of TOWERS) for (const shell of buildCurvedTower(tower, m)) registerShell(shell);
    // Patios y traspatios: cerrados, se ven solo desde la isométrica.
    const cover = new Batch(), f = cover.frame(4, 0);
    for (const { x0, x1, z0, z1 } of patios) {
      const cx = (W(x0) + W(x1)) / 2, cz = (W(z0) + W(z1)) / 2, w = (x1 - x0 + 1) * T, d = (z1 - z0 + 1) * T;
      f.box(m.detail, cx, 0, cz, w, 2.4, d, 'plasterCream', FACES.front | FACES.back | FACES.left | FACES.right);
      f.box(m.detail, cx, 0, cz, w, 2.4, d, z0 < CANDELARIA_END_Z ? 'stoneLight' : 'grass', FACES.top);
    }
    const covers = new THREE.Group();
    covers.name = 'Patios interiores';
    cover.finish(covers, { name: 'Patios interiores', castShadow: false });
    this.group.add(covers);
  }

  /** Luz del farol colonial: el mismo tipo de fuente que los faroles de calle, sin luces nuevas en la escena. */
  _addLanternLight(position) {
    const light = new THREE.PointLight(0xffd29a, 0, 9);
    light.position.copy(position);
    light.userData.noMerge = true;
    this.group.add(light);
    (this.lanternSpots ??= []).push(position.clone());
    // Más baja que un poste de la avenida: con la misma potencia quemaría el empedrado mojado.
    this.props.push({ instance: { setNight: isNight => { light.intensity = isNight ? 8 : 0; } } });
  }

  /** Plaza, fuente, mercado y parque del oriente; sus colisiones son bajas para que no parezcan muros. */
  _buildEastSquares(map, collisions) {
    const m = this.zoneMaterials;
    const fountain = buildFountain(m);
    this.group.add(fountain);
    const addCollider = ({ x, z, w, d, h }) => {
      if (!collisions) return;
      const object = new THREE.Object3D();
      object.position.set(x, .12, z);
      collisions.add(object, new THREE.Vector3(w, h, d));
    };
    addCollider({ x: FOUNTAIN.x, z: FOUNTAIN.z, w: (FOUNTAIN.radius + .4) * 2, d: (FOUNTAIN.radius + .4) * 2, h: 1.1 });
    addCollider(CHURCH_FRONT_COLLIDER);
    const market = buildMarket(m);
    this.group.add(market.group);
    market.colliders.forEach(addCollider);
    // Faroles de poste alrededor de la fuente: misma pieza que los de pared, sobre una columna.
    const posts = new Batch(), f = posts.frame(4, 0);
    const lampSpots = [[-13, -13], [13, -13], [-13, 13], [13, 13], [-26, 0], [24, -15], [24, 15]];
    for (const [dx, dz] of lampSpots) {
      const x = FOUNTAIN.x + dx, z = FOUNTAIN.z + dz;
      f.box(m.detail, x, .12, z, .34, .34, .34, 'stoneGray', ALL_FACES & ~FACES.bottom);
      f.box(m.detail, x, .46, z, .13, 3, .13, 'iron', ALL_FACES & ~FACES.bottom & ~FACES.top);
      f.box(m.detail, x, 3.46, z, .24, .05, .24, 'iron', ALL_FACES);
      f.box(m.detail, x, 3.51, z, .28, .42, .28, 'lampGlass', ALL_FACES & ~FACES.bottom & ~FACES.top);
      f.box(m.detail, x, 3.93, z, .36, .06, .36, 'iron', ALL_FACES);
      f.box(m.detail, x, 3.99, z, .14, .12, .14, 'iron', ALL_FACES & ~FACES.bottom);
      this._addLanternLight(new THREE.Vector3(x, 3.5, z));
    }
    const postGroup = new THREE.Group();
    postGroup.name = 'Faroles de plaza';
    posts.finish(postGroup, { name: 'Faroles de plaza' });
    this.group.add(postGroup);
    // Bancas en las tres caras abiertas de la plaza y en el parque.
    for (const [x, z, r] of [[FOUNTAIN.x - 9, FOUNTAIN.z - 16, 0], [FOUNTAIN.x + 9, FOUNTAIN.z - 16, 0],
      [FOUNTAIN.x - 9, FOUNTAIN.z + 16, Math.PI], [FOUNTAIN.x + 9, FOUNTAIN.z + 16, Math.PI], [FOUNTAIN.x - 19, FOUNTAIN.z - 6, Math.PI / 2], [FOUNTAIN.x - 19, FOUNTAIN.z + 6, Math.PI / 2]]) {
      this._placeBench(x, SIDEWALK_Y, z, r);
    }
    const park = TEUSAQUILLO_PARK;
    for (const z of [132, 150]) for (const x of [park.x0 + 5, park.x1 - 5]) {
      this._placeBench(W(x), this.getGroundHeight(W(x), W(z)), W(z), x === park.x0 + 5 ? Math.PI / 2 : -Math.PI / 2);
    }
    this._add(P.streetSign([PLAZA.name, 'Candelaria']), W(PLAZA.x0), W(PLAZA.z1), .4);
    this._add(P.streetSign([park.name, 'Teusaquillo']), W(park.x0 + 2), W(park.z0 + 2), .4);
    this._add(P.streetSign([TOWERS_LOT.name, 'Carrera 3']), W(TOWERS_LOT.x0 + 1), W(TOWERS_LOT.z0 + 1), .4);
    this._add(P.streetSign([MARKET.name, COMMERCIAL_STREET.name]), W(MARKET.x0 - 1), W(MARKET.z1 + 1), .4);
    this._eastMarket = market;
  }

  /** Perímetro: cierres de obra y rejas donde hay calle o parque, y ciudad de fondo detrás. */
  _buildBorder(map, collisions) {
    const edge = buildCityEdge(map, { detail: this.zoneMaterials.detail, collisions });
    this.edge = edge;
    this.group.add(edge.group);
    this.group.add(buildTerminalEdge({ x0: TERMINAL.x0, x1: TERMINAL.x1, z0: TERMINAL.z0, z1: TERMINAL.z1 - 4, lanes: [TERMINAL.southLane - 3.2, TERMINAL.northLane + 3.2] },
      { detail: this.zoneMaterials.detail, collisions }));
    // Alrededor de la terminal también se ve ciudad, con su propio margen para no tapar el Portal.
    const terminal = { x0: TERMINAL.x0 - 3, x1: TERMINAL.x1 + 3, z0: TERMINAL.z0 - 3, z1: 0 };
    const blocks = [...edge.blocks];
    const hash = (a, b) => (Math.imul(a + 91, 73856093) ^ Math.imul(b + 17, 19349663)) >>> 0;
    // Una fachada pegada a la reja se lee como pared pintada: la primera fila queda a media cuadra,
    // con retiros y calles entre bloques por donde se ven los de atrás.
    const fill = (x0, x1, z0, z1, alongZ, outward) => {
      for (let t = alongZ ? z0 : x0, i = 0; t < (alongZ ? z1 : x1); i++) {
        // El último de la fila no se pasa de la esquina: la ciudad jugable empieza ahí.
        const length = Math.min(16 + hash(t | 0, x0 | 0) % 10, (alongZ ? z1 : x1) - t), h = 11 + hash(i, z0 | 0) % 16;
        if (length < 8) break;
        const color = [[.54, .34, .26], [.62, .60, .55], [.57, .47, .38], [.70, .67, .60]][hash(t | 0, 3) % 4];
        const street = 3 + hash(t | 0, 7) % 6, setback = hash(t | 0, 11) % 8;
        const across = (alongZ ? x1 - x0 : z1 - z0) - setback, middle = (alongZ ? x0 + x1 : z0 + z1) / 2 + outward * setback / 2;
        blocks.push(alongZ ? { x: middle, z: t + length / 2, w: across, d: length, h, color }
          : { x: t + length / 2, z: middle, w: length, d: across, h, color });
        t += length + street;
      }
    };
    const gap = TERMINAL_CITY_GAP, deep = gap + 16;
    fill(terminal.x0 - deep, terminal.x0 - gap, terminal.z0 - deep, 0, true, -1);
    fill(terminal.x1 + gap, terminal.x1 + deep, terminal.z0 - deep, 0, true, 1);
    fill(terminal.x0 - gap, terminal.x1 + gap, terminal.z0 - deep, terminal.z0 - gap, false, -1);
    for (const tower of TOWERS) blocks.push(...towerSilhouette(tower));
    this.cerros = buildCityBackdrop({ width: W(EAST_CITY_WIDTH), height: W(CITY_HEIGHT),
      corridors: edge.corridors, blocks, excluded: [{ x0: terminal.x0 - deep, x1: terminal.x1 + deep, z0: terminal.z0 - deep, z1: 3 }] });
    this.group.add(this.cerros);
    this.backdrop = this.cerros;
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
    const [x0, z0] = tiles[0], [x1, z1] = tiles[tiles.length - 1];
    const cx = (W(x0) + W(x1)) / 2 - dx * (depth - 1) * T / 2;
    const cz = (W(z0) + W(z1)) / 2 - dz * (depth - 1) * T / 2;
    const neighborhood = neighborhoodAt(cx, cz);
    // Detalles estables por solar, separados tanto de la partición como del azar del juego.
    const houseSeed = (Math.imul(x0 + 17, 73856093) ^ Math.imul(z0 + 31, 19349663)
      ^ Math.imul(tiles.length, 83492791) ^ Math.imul(depth, 2654435761) ^ Math.imul(face + 1, 97531)) >>> 0;
    const random = TX.rng(houseSeed);
    const choose = values => values[Math.floor(random() * values.length)];
    const floors = skylineFloors(x0, z0, ruin, random());
    const h = floors * 3;
    const style = ruin ? 'ruina' : random() < 0.55 ? 'ladrillo' : 'pintada';
    // el ladrillo necesita más resolución para que cada ladrillo (36 × 12 cm) se distinga
    // Variantes compartidas: ampliar el barrio no triplica las texturas de fachada en la GPU.
    const variant = Math.floor(random() * 2);
    const baseTextureKey = `${widthM}:${floors}:${style}:${variant}`;
    // La semilla de la textura depende de su clave, no del orden de llenado de la caché.
    if (!this._facadeSeeds.has(baseTextureKey)) {
      let seed = 2166136261;
      for (const character of baseTextureKey) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619);
      this._facadeSeeds.set(baseTextureKey, seed >>> 0);
    }
    const textureKey = `${baseTextureKey}:${neighborhood.id}`;
    let tex = this._facadeTextures.get(textureKey);
    if (!tex) {
      tex = TX.facade({ seed: this._facadeSeeds.get(baseTextureKey), width: widthM, floors, pxPerM: style === 'pintada' ? 36 : 48, shopFront: true, style, district: neighborhood.id });
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
        bumpScale: 0.045,
        roughness: 0.95
      });
      if (tex.roughnessMap) facadeMat.roughnessMap = tex.roughnessMap;
      this._facadeMaterials.set(textureKey, facadeMat);
      this.facadeMats.push(facadeMat);
    }

    const sx = alongX ? widthM : depth * T;
    const sz = alongX ? depth * T : widthM;
    const clay = random() < 0.4 || ruin;
    const mats = [sideMat, sideMat, clay ? tileRoof : roofMat, roofMat, sideMat, sideMat];
    mats[face] = facadeMat;
    const U = this._uvUnits;
    const units = [U.brick, U.brick, clay ? U.tiles : U.slab, U.slab, U.brick, U.brick];
    units[face] = null; // la fachada usa su textura completa
    const shell = createBuildingShell(worldUVs(new THREE.BoxGeometry(sx, h, sz), sx, h, sz, units), mats, {
      x: cx, z: cz, height: h, interiorMaterial: this._interiorMat,
      facadeFace: face, wallInteriorMaterial: sideMat, wallInteriorUV: U.brick
    });
    shell.root.userData.neighborhood = neighborhood.id;
    this.group.add(shell.root);

    // punto de la fachada (centro, al ras de la calle) y orientación hacia afuera
    const fx = (W(x0) + W(x1)) / 2 + dx * T / 2;
    const fz = (W(z0) + W(z1)) / 2 + dz * T / 2;
    const yaw = Math.atan2(dx, dz);

    // aviso de local en el primer piso
    if (!ruin && random() < 0.55) {
      const [title, sub] = choose(SHOP_NAMES);
      const signColor = new THREE.Color(choose(['#0b4fa3', '#c0392b', '#1f6b3a', '#f2c600', '#ffffff', '#6a1b9a']));
      signColor.lerp(new THREE.Color(neighborhood.palette.signBackground), .18);
      const luminance = .2126 * signColor.r + .7152 * signColor.g + .0722 * signColor.b;
      const map = signTexture({ title, sub, bg: `#${signColor.getHexString()}`, fg: luminance > .4 ? '#26302e' : '#fff3da', w: 768, h: 192 });
      if (map) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(widthM * 0.85, 3.6), Math.min(widthM * 0.85, 3.6) / 4),
          new THREE.MeshBasicMaterial({ map }));
        sign.position.set(fx + dx * 0.06 - cx, 3.05, fz + dz * 0.06 - cz);
        sign.rotation.y = yaw;
        shell.walls.get(face).add(sign);
      }
    }
    // balcón de madera en las casas viejas (Cartucho) o en algunas de ladrillo
    if ((ruin && random() < 0.6) || (style === 'ladrillo' && random() < 0.2)) {
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
    addBuildingDetails({ shell, width: sx, depth: sz, height: h, floors, face,
      seed: houseSeed, neighborhood: neighborhood.id, ruin, balconies: false });
    const building = this.buildingVisibility.register(shell);
    for (const part of building.parts) for (const material of part.materials) {
      if (material.emissiveMap || material.userData.windowGlow) this.facadeMats.push(material);
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
    // Las torres curvas llevan cajas que siguen su planta, no la de sus tiles.
    const hasTowers = map[0].length > TOWERS_LOT.x1;
    for (const tower of hasTowers ? TOWERS : []) {
      for (const { x, z, w, d } of towerColliderBoxes(tower)) {
        const object = new THREE.Object3D(); object.position.set(x, 0, z);
        collisions.add(object, new THREE.Vector3(w, 8, d));
      }
    }
    const towerTile = (x, z) => hasTowers && inTowerLot(x, z) && TOWERS.some(tower => insideTower(tower, W(x), W(z)));
    const obstacles = [...GAS_OBSTACLES,
      ...[AVENUE_OVERPASS.x0, AVENUE_OVERPASS.x1].map(x => ({ x, z: AVENUE_OVERPASS.z, w: 1.4, d: 4.6, h: 11.4 }))];
    for (const { x, z, w, d, h } of obstacles) {
      const object = new THREE.Object3D(); object.position.set(x, .12, z);
      collisions.add(object, new THREE.Vector3(w, h, d));
    }
    for (let z = 0; z < map.length; z++) {
      let x = 0;
      while (x < map[0].length) {
        if (!SOLID.has(map[z][x]) || urbanTiles.has(`${x},${z}`) || towerTile(x, z)) { x++; continue; }
        let x2 = x;
        while (x2 + 1 < map[0].length && !urbanTiles.has(`${x2+1},${z}`) && !towerTile(x2 + 1, z) && SOLID.has(map[z][x2 + 1]) &&
          (map[z][x2 + 1] === 'storeD69') === (map[z][x] === 'storeD69') &&
          (map[z][x2 + 1] === 'colpatria') === (map[z][x] === 'colpatria') &&
          (map[z][x2 + 1] === 'colpatriaAnnex') === (map[z][x] === 'colpatriaAnnex') &&
          (map[z][x2 + 1] === 'smallBuilding') === (map[z][x] === 'smallBuilding')) x2++;
        const o = new THREE.Object3D();
        o.position.set((W(x) + W(x2)) / 2, 0, W(z));
        collisions.add(o, new THREE.Vector3((x2 - x + 1) * T, map[z][x] === 'smallBuilding' ? SMALL_BUILDING.height : map[z][x] === 'storeD69' ? 5 : map[z][x] === 'colpatria' ? COLPATRIA.height : map[z][x] === 'colpatriaAnnex' ? COLPATRIA_ANNEX.height : 8, T));
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
    const lakeGround = this._lakeGroundHeight(x, z);
    if (lakeGround !== null) return lakeGround;
    const steps = churchStepHeight(x, z);
    if (steps !== null) return steps;
    const tileX = Math.round(x / T), tileZ = Math.round(z / T);
    return tileGroundHeight(this.map[tileZ]?.[tileX], tileX, tileZ);
  }

  _lakeLandHeight(x, z) {
    const type = this.map?.[Math.round(z / T)]?.[Math.round(x / T)];
    return type === 'water' || (type === 'busway' && onLakeBridge(x, z)) ? .06 : GROUND_HEIGHTS[type] ?? .06;
  }

  _lakeGroundHeight(x, z) {
    return lakeTerrainHeight(x, z, (sx, sz) => this._lakeLandHeight(sx, sz));
  }

  /** El agua existe también debajo del puente; el controlador decide si está sumergido. */
  getWaterInfo(x, z) {
    return lakeWaterInfo(x, z, (sx, sz) => this._lakeLandHeight(sx, sz));
  }

  getMovementGroundHeight(x, z, currentY) {
    if (inTerminal(x,z)) return terminalGroundHeight(x,z);
    const deck = viaductSurface(x, z);
    // Solo se entra por la rampa o desde el propio tablero; debajo se conserva la calle.
    if (deck !== null && Math.abs(deck - currentY) < .6) return deck;
    const lakeGround = this._lakeGroundHeight(x, z);
    if (lakeGround !== null) return lakeGround;
    if (onLakeBridge(x, z) && (deck === null || currentY < bridgeHeight(z) - .6)) {
      const type = this.map[Math.round(z / T)]?.[Math.round(x / T)];
      return GROUND_HEIGHTS[type] ?? 0;
    }
    return this.getGroundHeight(x, z);
  }

  /** Superficie de apoyo del jugador; el salto conserva la capa de despegue. */
  getPlayerGroundSurface(x, z, { from, grounded = true, surface = null } = {}) {
    const tileX = Math.round(x / T), tileZ = Math.round(z / T);
    const ground = { height: inTerminal(x, z) ? terminalGroundHeight(x, z)
      : this._lakeGroundHeight(x, z) ?? churchStepHeight(x, z) ?? tileGroundHeight(this.map[tileZ]?.[tileX], tileX, tileZ), layer: 'ground' };
    const deck = viaductSurface(x, z);
    const feetY = from?.y ?? surface?.height ?? ground.height;
    if (deck !== null) {
      // A pie se accede por una rampa cercana a los pies. En un salto desde
      // el tablero, comprobar también el apoyo anterior: al correr cuesta
      // arriba, la nueva pendiente puede superar los pies durante este paso.
      const entersOnFoot = grounded && Math.abs(deck - feetY) < .6;
      const previousDeck = from ? viaductSurface(from.x, from.z) : null;
      const abovePreviousDeck = previousDeck !== null && feetY >= previousDeck - 1e-7;
      const landsOnDeck = !grounded && surface?.layer === 'viaduct' &&
        (deck <= feetY + 1e-7 || abovePreviousDeck);
      if (entersOnFoot || landsOnDeck) return { height: deck, layer: 'viaduct' };
    }
    return ground;
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
    // Pegado a un semáforo o a otro farol, un poste igual de alto se ve como un error de obra.
    const signalPoles = new TrafficSignals().poles, lampSpots = [];
    const roomForLamp = (x, z) => signalPoles.every(pole => Math.hypot(W(x) - pole.x, W(z) - pole.z) > 3.5) &&
      lampSpots.every(([a, b]) => Math.hypot(W(x) - a, W(z) - b) > 8);
    for (let z = 2; z < map.length - 2; z += 7) {
      for (let x = 2; x < map[0].length - 2; x += 7) {
        let best = null;
        for (let dz = 0; dz < 7 && !best; dz++) for (let dx = 0; dx < 7 && !best; dx++) {
          const tx = x + dx, tz = z + dz;
          if (map[tz]?.[tx] !== 'sidewalk' || !roomForLamp(tx, tz)) continue;
          if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => map[tz + b]?.[tx + a] === 'road')) best = [tx, tz];
        }
        if (!best) continue;
        // La Candelaria se alumbra con faroles de pared; un poste moderno rompería la calle de piedra.
        if (neighborhoodAt(W(best[0]), W(best[1])).streets?.cobbles) continue;
        // En los andenes anchos del oriente, un poste de cada dos: los árboles ya llenan esa línea.
        if (best[0] > 133 && (x + z - 4) % 14) continue;
        lampSpots.push([W(best[0]), W(best[1])]);
        // El brazo sale hacia la calzada que lo justifica.
        const [roadX, roadZ] = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([a, b]) => map[best[1] + b]?.[best[0] + a] === 'road');
        const farol = new Farol(new THREE.Vector3(W(best[0]), SIDEWALK_Y, W(best[1])), { yaw: Math.atan2(-roadZ, roadX) });
        farol.group.userData.noMerge = true; // cambia de material de noche
        this.group.add(farol.group);
        this.props.push({ instance: farol });
      }
    }
    // placas en las esquinas
    for (const [za, zb, calle] of CALLES) {
      for (const [xa, xb, carrera] of [...CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1], 'Av. Caracas']]) {
        this._add(P.streetSign([calle, carrera]), W(xa - 1), W(za - 1));
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
    this._vendor(WX(21), WZ(18.5), Math.PI / 2, 'chaza', 'Chaza de don Efraín', ['cigarrillo', 'cafe', 'pan', 'agua', 'empanada']);
    this._vendor(WX(28), WZ(29), 0, 'fritanga', 'Fritanga La Mona', ['empanada', 'morcilla', 'papaCriolla', 'aguapanela', 'refresco']);
    this._vendor(WX(39), WZ(36), -Math.PI / 2, 'chaza', 'Dulces y minutos', ['cigarrillo', 'refresco', 'agua', 'empanada']);
  }

  /** Vendedor ambulante: puesto + persona; se le puede comprar (lo atiende la tienda con otro catálogo) */
  _vendor(x, z, rotY, kind, title, items) {
    const stall = kind === 'fritanga' ? P.fritanga() : P.chaza();
    this._takesRoom(this._add(stall, x, z, rotY));
    if (stall.userData.setNight) this.props.push({ instance: { setNight: stall.userData.setNight } });
    const back = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).multiplyScalar(-0.9);
    const seller = new Npc(this.scene, new THREE.Vector3(x + back.x, this.getGroundHeight(x, z), z + back.z), {
      facing: rotY, isWalkable: () => false,
      arquetipo: 'vendedor', fijo: { stance: 'atender', alternas: VENDOR_POSES }
    });
    seller.isVendor = true;
    this.npcs.push(seller);
    this.vendors.push({ kind: 'shop', stall: kind, title, items, position: new THREE.Vector3(x, 0, z) });
  }

  /** El Cartucho: humo, fuego, carretas, cambuches, ropa colgada y basura */
  _buildCartucho() {
    const cx = WX, cz = WZ;
    // canecas con fuego en la olla y el callejón
    // Las fogatas también sirven para calentarse en las noches frías.
    this.fireBarrels = [];
    for (const [x, z] of [[13, 19], [14.75, 24.5], [10, 21.5], [19.5, 22]]) {
      const barrel = P.fireBarrel();
      this._takesRoom(this._add(barrel, cx(x), cz(z)));
      this.props.push({ instance: { setNight: barrel.userData.setNight } });
      this.fireBarrels.push({ kind: 'fireBarrel', position: new THREE.Vector3(cx(x), 0, cz(z)), title: 'Fogata de caneca' });
    }
    // zorras de reciclaje
    for (const [x, z, r] of [[9.5, 22.5, 0.3], [12.5, 24.5, 1.9], [18.5, 21, -0.8], [20.5, 15, 1.2]]) this._takesRoom(this._add(P.zorra(), cx(x), cz(z), r));
    // cambuches ajenos contra las paredes
    for (const [x, z, r] of [[12.5, 18.3, 0], [15, 18.3, 0], [17.4, 20, Math.PI / 2], [12.3, 25.5, Math.PI], [11, 22.5, Math.PI / 2]]) this._takesRoom(this._add(P.shack(), cx(x), cz(z), r));
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

  /** Banca de la ciudad; queda anotada para quien se siente en ella. Su frente mira a (sin r, cos r). */
  _placeBench(x, y, z, rot) {
    this.group.add(new Banca(new THREE.Vector3(x, y, z), rot).group);
    this.benchSpots.push({ x, y, z, rot });
  }

  /** Mide el objeto ya: al fundir la geometría estática se queda sin mallas. */
  _takesRoom(object) { this._roomBoxes.push(new THREE.Box3().setFromObject(object)); }

  /** Lo que un cuerpo que cae no debe atravesar y a nadie detiene. El mobiliario de la calle lo anota `addStreetDetails`. */
  _noteFallRoom(collisions) {
    if (!collisions?.addFallObstacle) return;
    const round = (x, z, r, height = 3) => {
      const y = this.getGroundHeight(x, z);
      collisions.addFallObstacle(x - r, z - r, x + r, z + r, y, y + height);
    };
    for (const spot of this.benchSpots) {
      const { minX, minZ, maxX, maxZ } = benchFootprint(spot);
      collisions.addFallObstacle(minX, minZ, maxX, maxZ, spot.y, spot.y + .9);
    }
    for (const { min, max } of this._roomBoxes) collisions.addFallObstacle(min.x, min.z, max.x, max.z, min.y, max.y);
    this._roomBoxes = [];
    for (const tree of this.treePlan ?? []) round(tree.x, tree.z, .25);
    for (const prop of this.props) if (prop.instance instanceof Farol) round(prop.instance.group.position.x, prop.instance.group.position.z, .12);
    for (const pole of this.signals?.poles ?? []) round(pole.x, pole.z, .12);
  }

  _buildPark() {
    for (const [x, z, r] of [[32, 37, Math.PI / 2], [35, 41, -Math.PI / 2], [31, 39.8, 0], [36.5, 38.2, Math.PI]]) {
      if (Math.hypot(WX(x) - SHELTER_LOCATION.x, WZ(z) - SHELTER_LOCATION.z) < 5) continue;
      this._placeBench(WX(x), 0.06, WZ(z), r);
    }
    // cartel del parque
    const sign = P.streetSign(['Parque', 'Tercer Milenio']);
    this._add(sign, WX(29), WZ(33), -0.6);
  }

  _buildExtensions() {
    for (const park of EXTENSION_PARKS) {
      const pathZ=Math.floor((park.z0+park.z1)/2);
      for (const x of [park.x0+2,park.x1-2]) {
        this._placeBench(W(x), this.getGroundHeight(W(x),W(pathZ)), W(pathZ), 0);
      }
      this._add(P.streetSign([park.name, 'Bogotá']), W(park.x0), W(pathZ));
    }
    this._vendor(W(CARRERAS[2][0]-1.5), W(55), Math.PI/2, 'chaza', 'Chaza de la Carrera 8', ['agua','pan','cafe','empanada']);
    this._vendor(W(52), W(CALLES[2][0]-1.5), 0, 'fritanga', 'Fritanga del Sur', ['empanada', 'morcilla', 'papaCriolla', 'aguapanela', 'refresco']);
    // Oriente: tinto en la plaza y fritanga en la calle comercial.
    this._vendor(FOUNTAIN.x - 14, FOUNTAIN.z + 18, Math.PI, 'chaza', 'Tinto de la plaza', ['cafe', 'pan', 'agua', 'cigarrillo']);
    this._vendor(W(144), W(COMMERCIAL_STREET.z0 - 1.5), 0, 'fritanga', 'Fritanga de la Calle 7', ['empanada', 'morcilla', 'papaCriolla', 'aguapanela', 'refresco']);
  }

  _buildLakePark() {
    for (const [x, z] of [[20, 226], [132, 236], [134, 288], [20, 310], [156, 310]]) {
      this._placeBench(x, this.getGroundHeight(x, z), z, 0);
    }
    this._add(P.streetSign([LAKE_PARK.name, 'Lago · Puente TransMilenio']), 150, 226);
  }

  _buildGreenery() {
    // El arbolado y los jardines comparten reservas, sin cambiar tiles ni navegación.
    const benches = this.group.children.filter(object => object.children.some(child =>
      child.material?.userData?.staticMergeKey === 'banca:madera')).map(object => object.position);
    const isReserved = (x, z, radius = 0) =>
      Math.hypot(x - SHELTER_LOCATION.x, z - SHELTER_LOCATION.z) < 7 + radius ||
      Math.hypot(x - SHELTER_RESPAWN.x, z - SHELTER_RESPAWN.z) < 5 + radius ||
      benches.some(p => Math.hypot(x - p.x, z - p.z) < 1.8 + radius) ||
      this.vendors.some(({ position: p }) => Math.hypot(x - p.x, z - p.z) < 2 + radius);
    // El arbolado anterior se calcula sobre el mapa viejo: nada cambia de sitio con la ampliación.
    const baseMap = this.map.map(row => [...row.slice(0, EAST_SEAM), 'wall']);
    const options = { map: baseMap, tileSize: T, isReserved,
      groundHeight: (x, z) => this.getGroundHeight(x, z),
      getWaterInfo: (x, z) => this.getWaterInfo(x, z) };
    this.treePlan = planUrbanTrees(options);
    for (const tree of this.treePlan) {
      const object = P.tree(tree.scale, { seed: tree.seed, species: tree.species });
      object.position.set(tree.x, tree.y, tree.z);
      object.rotation.y = tree.rotation;
      this.group.add(object);
    }
    this.vegetationPlan = planParkVegetation(options);
    const vegetation = buildParkVegetation(this.vegetationPlan, { windTime: P.foliageWind });
    // Hijos por sector: un contenedor de toda la ciudad impediría descartar jardines lejanos.
    this.group.add(...vegetation.children.slice());
    this._buildEastTrees();
  }

  /** Chapinero se reconoce por sus árboles grandes: andenes anchos y parque con su propio plan. */
  _buildEastTrees() {
    const map = this.map, trees = [];
    const tile = (x, z) => map[z]?.[x];
    const nearCorner = (x, z) => [[-3, 0], [3, 0], [0, -3], [0, 3]].filter(([a, b]) => ['road', 'busway'].includes(tile(x + a, z + b))).length > 1;
    for (const [a, b] of [...[[72, 77], [94, 99]], [CALLE_6[0], CALLE_6[1]], [CALLE_5[0], CALLE_5[1]]]) {
      for (const z of [a - 2, b + 2]) for (let x = 136; x < 198; x += 8) {
        if (tile(x, z) === 'sidewalk' && !nearCorner(x, z)) trees.push([x, z]);
      }
    }
    for (const [a, b] of [CARRERA_4, CARRERA_3]) for (const x of [a - 2, b + 2]) for (let z = 64; z < 158; z += 9) {
      if (tile(x, z) === 'sidewalk' && !nearCorner(x, z)) trees.push([x, z]);
    }
    const park = TEUSAQUILLO_PARK;
    for (let z = park.z0 + 5; z < park.z1; z += 7) for (const x of [park.x0 + 5, park.x0 + 11]) {
      if (tile(x, z) === 'grass') trees.push([x + (z % 3) * .3, z + .6]);
    }
    trees.forEach(([x, z], i) => {
      const seed = (Math.imul(Math.round(x * 10) + 7, 73856093) ^ Math.imul(Math.round(z * 10) + 3, 19349663)) >>> 0;
      const inPark = tile(Math.round(x), Math.round(z)) === 'grass';
      const scale = inPark ? 1.5 + (seed % 6) * .08 : 1.25 + (seed % 5) * .09;
      const object = P.tree(scale, { seed, species: ['urapan', 'eucalipto', 'urapan'][i % 3] });
      object.position.set(W(x), this.getGroundHeight(W(Math.round(x)), W(Math.round(z))), W(z));
      // En el plan: también dan sombra en el campo de sol y el mobiliario de la calle los esquiva.
      this.treePlan.push({ x: W(x), z: W(z), scale });
      object.rotation.y = (seed % 628) / 100;
      this.group.add(object);
    });
    this.eastTrees = trees;
  }

  /** Cruces y bloqueos peatonales compartidos por los NPC y el GPS. */
  _pedestrianRules() {
    const carreras = [...CARRERAS, [CARACAS.lanes[0][0], CARACAS.lanes[1][1]]];
    return {
      // Prolongación de los andenes en los cruces; no pasean por los carriles ni la estación.
      isCrossing: (x, z) => x > 133 ? eastCrossing(x, z) : CALLES.some(([a, b]) =>
        (z >= a - SIDEWALK_TILES && z < a) || (z > b && z <= b + SIDEWALK_TILES)) ||
        (z === 113 || z === 155 || z === 79 || z === 89) ||
        (viaductHeight(z * T) > 2 && Math.abs(x * T - busPathX(z * T)) < 16) ||
        carreras.some(([a, b]) =>
          (x >= a - SIDEWALK_TILES && x < a) || (x > b && x <= b + SIDEWALK_TILES)),
      isBlocked: (x, z) => (x === Math.round(this.reserved.shop.x / T) && z === Math.round(this.reserved.shop.z / T)) ||
        Math.hypot(x * T - FOUNTAIN.x, z * T - FOUNTAIN.z) < FOUNTAIN.radius + 1 ||
        this.edge?.blockedTiles.has(`${x},${z}`) || this._eastMarket?.blockedTiles.includes(`${x},${z}`) ||
        GAS_OBSTACLES.some(o => Math.abs(x * T - o.x) < o.w / 2 + .3 && Math.abs(z * T - o.z) < o.d / 2 + .3)
    };
  }

  /**
   * A pie por la ciudad se anda por el piso: bajo el puente del lago se pasa por debajo, como bajo el resto del
   * viaducto. El tablero es del bus. Por eso aquí no vale getGroundHeight, que debajo del puente da la cota de arriba.
   */
  _pedestrianGround(x, z) {
    return onLakeBridge(x, z) ? this.getMovementGroundHeight(x, z, 0) : this.getGroundHeight(x, z);
  }

  _createPedestrianNavigation() {
    const rules = this._pedestrianRules();
    return new PedestrianNavigation(this.map, T, {
      ...rules,
      // El GPS comparte las reglas y ya deja fuera lo alto. Esto es solo de los peatones: bajo el puente no se pasa
      // donde hay agua, ni donde el tablero ya viene bajando y no cabe una persona.
      isBlocked: (x, z) => rules.isBlocked(x, z) || (this.map[z][x] === 'busway' && !!this.getWaterInfo(W(x), W(z))) ||
        (onLakeBridge(W(x), W(z)) && bridgeHeight(W(z)) - this._pedestrianGround(W(x), W(z)) < DECK_HEADROOM),
      isUnderDeck: (x, z) => this.map[z][x] === 'busway' && W(z) >= LAKE_BRIDGE.z0,
      groundHeight: (x, z) => this._pedestrianGround(x, z)
    });
  }

  /** Tipo de suelo de un tile, incluida la extensión del Portal (filas con Z negativa). */
  tileTypeAt(tx, tz) {
    if (tz >= 0) return this.map[tz]?.[tx] ?? null;
    const x = tx * T, z = tz * T;
    if (!inTerminal(x, z)) return null;
    if (x >= 73 && x <= 77 && z >= -58 && z <= -2) return 'plaza';
    return x <= 59 || x >= 91 ? 'sidewalk' : 'road';
  }

  /** GPS a pie: andenes y parques cuestan 1, cruces 1,3 y calzada 8; el tablero elevado queda fuera. */
  createGpsNavigation() {
    const rules = this._pedestrianRules();
    return new GpsNavigation({
      width: this.map[0].length, zMin: Math.ceil(TERMINAL.z0 / T), zMax: this.map.length - 1, tileSize: T,
      // La isla de la estación solo se pisa por sus rampas: muros, barandas y postes no caben en la grilla.
      barrier: crossesIslandEdge, aisleX: islandAisleX,
      cost: (tx, tz) => {
        const type = this.tileTypeAt(tx, tz);
        if (!type || !WALKABLE.has(type)) return Infinity;
        if (tz < 0) {
          // Del centro de estos tiles no sale ningún tramo: el poste queda encima. Quien esté ahí parte del vecino.
          if (crowdsIslandPole(tx * T, tz * T)) return Infinity;
          return type !== 'road' ? 1 : tz === -29 || tz === -1 ? 1.3 : 8;
        }
        if (rules.isBlocked(tx, tz) || this.getGroundHeight(tx * T, tz * T) > 1.2) return Infinity;
        if (type === 'road' || type === 'busway') return rules.isCrossing(tx, tz) ? 1.3 : 8;
        return 1;
      }
    });
  }

  /** Zona de la ciudad en ese punto: decide qué gente anda por ahí (ver character/archetypes.js). */
  _zoneAt(x, z) {
    if (x >= WX(9) - 1 && x <= WX(21) + 1 && z >= WZ(17) && z <= WZ(26)) return 'cartucho';
    if (x >= WX(29) && x <= WX(38) && z >= WZ(33) && z <= WZ(45)) return 'parque';
    if (x >= W(EAST_SEAM)) return z < W(CANDELARIA_END_Z) ? 'candelaria' : 'chapinero';
    return x < W(ORIGINAL_CITY_WIDTH) && z < W(ORIGINAL_CITY_HEIGHT) ? 'andenes' : 'barrio';
  }

  /**
   * Quienes se quedan en su sitio toda la partida, en metros: `at`, hacia dónde miran y su postura. Los
   * de banca salen de `benchSpots` y solo existen si esa banca está. Ninguno queda en la red de los
   * caminantes más de lo inevitable: pegados a un muro, a un cambuche o en el prado.
   */
  _fixedPeople() {
    const list = [
      // El Cartucho: dormidos y sentados junto a cambuches y canecas.
      { at: [36.7, 51.6], facing: Math.PI, stance: 'dormido', arquetipo: 'habitante' },
      { at: [44.9, 50.3], facing: -2.4, stance: 'sentado', arquetipo: 'habitante' },
      { at: [33.6, 53.7], facing: 2.2, stance: 'acurrucado', arquetipo: 'habitante' },
      { at: [40.3, 60.2], facing: 1.1, stance: 'sentado', arquetipo: 'habitante' },
      { at: [45.6, 57.6], facing: Math.PI / 2, stance: 'dormido', arquetipo: 'reciclador' },
      // Parque Tercer Milenio: dos vecinos conversando en el prado.
      { at: [102.6, 94.2], facing: .9, stance: 'hablar', arquetipo: 'senora', alternas: TALK, pareja: 1 },
      { at: [103.5, 95], facing: .9 + Math.PI, stance: 'hablar', arquetipo: 'abuelo', alternas: TALK, pareja: -1 },
      // Entrada del Portal: quien pide contra el muro y dos que esperan en el andén de enfrente.
      { at: [54.6, 2.6], facing: Math.PI / 2, stance: 'pedir', arquetipo: 'habitante' },
      { at: [94.2, 3.2], facing: -.7, stance: 'hablar', arquetipo: 'oficinista', alternas: TALK, pareja: 1 },
      { at: [93.4, 4.1], facing: -.7 + Math.PI, stance: 'hablar', arquetipo: 'estudiante', alternas: TALK, pareja: -1 },
      // Andén del Portal, bajo techo: quien se sentó en la banca de acero y, en la otra mitad, quien espera con el
      // celular frente al mapa. Separados, nunca hay dos modelos completos a la vez en medio del andén.
      { at: [76.42, -19.76], facing: -Math.PI / 2, stance: 'banca', arquetipo: 'senora', anden: true },
      { at: [74.1, -38.6], facing: -Math.PI / 2, stance: 'celular', arquetipo: 'oficinista', alternas: WAIT, anden: true },
      // Plaza de la Candelaria: una pareja cerca de la fuente y quien pide al pie del atrio.
      { at: [FOUNTAIN.x - 7, FOUNTAIN.z + 7.2], facing: -Math.PI / 4, stance: 'hablar', arquetipo: 'estudiante', alternas: TALK, pareja: 1 },
      { at: [FOUNTAIN.x - 7.8, FOUNTAIN.z + 8], facing: Math.PI * .75, stance: 'hablar', arquetipo: 'estudiante', alternas: TALK, pareja: -1 },
      { at: [FOUNTAIN.x + 21.5, FOUNTAIN.z - 7], facing: -Math.PI / 2, stance: 'pedir', arquetipo: 'habitante' }
    ];
    // Sentados en bancas: el frente de la banca es (sin r, cos r) y la cadera cae sobre el asiento.
    const seated = [[104, 98, 'abuelo'], [110, 106, 'senora'], [285, 39, 'abuelo'], [303, 71, 'senora'], [188, 54, 'estudiante']];
    for (const [x, z, arquetipo] of seated) {
      const bench = this.benchSpots.find(spot => spot.x === x && spot.z === z);
      if (!bench) continue;
      const side = (list.length % 2 ? 1 : -1) * .36;
      list.push({ at: [bench.x + Math.sin(bench.rot) * BENCH_FRONT + Math.cos(bench.rot) * side, bench.z + Math.cos(bench.rot) * BENCH_FRONT - Math.sin(bench.rot) * side],
        facing: bench.rot, stance: 'banca', arquetipo });
    }
    return list;
  }

  /** Peatones que recorren la ciudad y los que se quedan en su sitio; los vendedores conservan su puesto. */
  _spawnPeople() {
    const navigation = this.pedestrianNavigation = this._createPedestrianNavigation();
    const vendors = this.npcs.length;
    const walk = (x, z) => navigation.isWalkableAt(x, z);
    const water = (x, z) => this.getWaterInfo(x, z);
    // Sin pisar el borde: el bus para si alguien queda a menos de medio metro de su costado.
    const onPlatform = (x, z) => x >= 73.5 && x <= 76.5 && z >= -57 && z <= -3;
    const walker = (position) => this.npcs.push(new Npc(this.scene, position, {
      navigation, groundHeight: navigation.groundHeight, isWalkable: walk, collisions: this._collisions, getWaterInfo: water, zona: this._zoneAt(position.x, position.z)
    }));
    const spots = [
      // El Cartucho y parque.
      [13.5, 20], [13, 23], [16, 23.5], [18, 22.4], [12.5, 21], [19.8, 21.5],
      [33.5, 36], [34, 43], [21, 30],
      // Andenes, incluyendo la calle donde empieza el jugador.
      [18, 11], [21, 11], [21, 16], [28, 19], [39, 20], [8, 27],
      [5, 18], [30, 29], [37, 32], [8, 37]
    ];
    for (const [x, z] of spots) {
      const position = navigation.nearestPoint(WX(x), WZ(z));
      if (position) walker(position);
    }
    // Fijos: mismos cuerpos, menos caminantes en los barrios. Huyen por la red como cualquiera: solo el último
    // tramo de vuelta a su sitio puede salirse de ella.
    const fixed = this._fixedPeople();
    for (const person of fixed) {
      const [x, z] = person.at;
      const home = new THREE.Vector3(x, this.getGroundHeight(x, z), z);
      const npc = new Npc(this.scene, home, {
        // La red no sube al andén: quien se asusta allá arriba se queda en él y vuelve en línea recta.
        navigation: person.anden ? null : navigation, groundHeight: (px, pz) => person.anden ? this.getGroundHeight(px, pz) : navigation.groundHeight(px, pz), isWalkable: person.anden ? onPlatform : walk, collisions: this._collisions, getWaterInfo: water, facing: person.facing,
        arquetipo: person.arquetipo, fijo: { stance: person.stance, alternas: person.alternas, techo: person.anden, reach: person.anden ? 0 : FIXED_REACH }
      });
      this.npcs.push(npc);
      // Cada pareja son dos entradas seguidas: el que se asusta se lleva al otro.
      if (person.pareja === -1) {
        const other = this.npcs.at(-2);
        npc.fijo.pareja = other;
        other.fijo.pareja = npc;
      }
    }
    // Mantiene la densidad del centro y distribuye peatones por los barrios nuevos.
    const candidates = navigation.nodes.filter(node => !node.crossing && node.x < EAST_SEAM &&
      (node.x >= ORIGINAL_CITY_WIDTH-1 || node.z >= ORIGINAL_CITY_HEIGHT-1));
    // Los barrios del oriente suman un grupo moderado, repartido por sus propios andenes.
    const east = navigation.nodes.filter(node => !node.crossing && node.x >= EAST_SEAM);
    const eastFixed = fixed.filter(person => person.at[0] >= W(EAST_SEAM)).length;
    const eastCount = Math.min(east.length, Math.max(0, EAST_PEDESTRIANS - eastFixed));
    // Siempre los mismos 80: quien se queda en su sitio no se suma, reemplaza a un caminante.
    const count = Math.min(candidates.length, Math.max(0, TOTAL_PEDESTRIANS - (this.npcs.length - vendors) - eastCount));
    const place = node => walker(new THREE.Vector3(W(node.x), this.getGroundHeight(W(node.x),W(node.z)), W(node.z)));
    for (let i=0;i<count;i++) place(candidates[Math.floor((i+0.5)*candidates.length/count)]);
    for (let i=0;i<eastCount;i++) place(east[Math.floor((i+0.5)*east.length/eastCount)]);
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
      if (o.isMesh && !Array.isArray(o.material) && !o.isSkinnedMesh && !o.isInstancedMesh) {
        if (!o.geometry.attributes.uv || !o.geometry.attributes.normal) return;
        // Conserva los índices: expandir cajas y planos duplicaba sus vértices.
        const g = o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'treeWind'].includes(name)) g.deleteAttribute(name);
        const attributes = Object.keys(g.attributes).sort().map(name => {
          const a = g.attributes[name];
          return `${name}:${a.itemSize}:${a.array.constructor.name}:${a.normalized}`;
        }).join(',');
        // Como los lotes cerrados, por trozos anchos: mobiliario y ladrillos pesan en llamadas, no en triángulos.
        const key = `${o.material.userData.staticMergeKey ?? o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${!!g.index}|${attributes}|${o.customDepthMaterial?.uuid ?? ''}|${geometryChunk(o.geometry, o.matrixWorld, CLOSED_CHUNK_SIZE)}`;
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
      if (merged.hasAttribute('treeWind')) {
        // Después de geometryChunk: el recálculo de bounds no debe borrar el margen de viento.
        merged.computeBoundingBox(); merged.boundingBox.expandByScalar(.25);
        merged.computeBoundingSphere(); merged.boundingSphere.radius += .25;
      }
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

  /** ¿Hay techo encima? La cubierta del Portal y la marquesina de la gasolinera. */
  isRoofedAt(x, z) { return underTerminalRoof(x, z) || underGasCanopy(x, z); }

  update(dt, playerPos, camera, trafficVehicles = []) {
    this.t += dt;
    P.foliageWind.value = this.t;
    this.signals?.update(this.t);
    if (camera) this.signals?.updateDetail(camera.position, !!this.farDetailFog);
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
    // La niebla cambia con la hora y el clima: el límite de lo chico la sigue. Media y alta no lo usan.
    const fog = this.scene?.fog;
    this.farDetailDistance = this.farDetailFog && fog ? fog.near + (fog.far - fog.near) * this.farDetailFog : Infinity;
    // Patrullas en persecución o de regreso: las únicas que no frenan por nadie, y la gente fija las esquiva.
    const chasers = this._chasers ??= [];
    chasers.length = 0;
    for (const vehicle of trafficVehicles) if (vehicle.state === 'chase' || vehicle.rejoinTarget) chasers.push(vehicle);
    const ctx = { player: playerPos, frustum, camera, isRaining: (this.wetness ?? 0) > 0.05, animationBudget: this.animationBudget ?? 1,
      drawDistance: this.farDetailDistance, skipHiddenMatrices: true, hygiene: this.playerHygiene ?? 100, chasers };
    for (const n of this.npcs) n.update(dt, ctx);
    for (const flock of this.pigeonFlocks ?? []) flock.update(dt, playerPos, this.npcs, camera);
  }

  setNightMode(isNight) {
    for (const material of this.towerLights ?? []) material.emissiveIntensity = isNight ? 1.8 : .05;
    for (const p of this.props) p.instance.setNight?.(isNight);
    for (const m of this.facadeMats) m.emissiveIntensity = isNight ? (m.userData.windowGlow ?? 1.2) : 0;
    this.cerros?.userData?.setNight?.(isNight);
    for (const bus of this.busServices ?? []) bus.setNight?.(isNight);
    this.stationGroup?.userData.setNight?.(isNight);
    for (const material of this.buildingVisibility.closedMaterials.values()) {
      if (material.emissiveMap || material.userData.windowGlow) material.emissiveIntensity = isNight ? (material.userData.windowGlow ?? 1.2) : 0;
    }
  }

  dispose(scene) {
    if (this._disposed) return;
    this._disposed = true;
    const textures = new Set(), ownedTextures = new Set();
    const rememberTexture = value => {
      if (value?.isTexture) textures.add(value);
      else if (Array.isArray(value)) value.forEach(rememberTexture);
    };
    const rememberTextures = material => {
      // El shader de ribera posee y libera su detalle; los mapas del parque son compartidos.
      const ownedDetail = material?.userData?.uniforms?.lakeShoreDetail?.value;
      if (ownedDetail) ownedTextures.add(ownedDetail);
      for (const value of Object.values(material ?? {})) rememberTexture(value);
      for (const uniforms of [material?.uniforms, material?.userData?.uniforms]) {
        for (const uniform of Object.values(uniforms ?? {})) rememberTexture(uniform?.value);
      }
    };
    const meshMaterials = object => [object.material, object.customDepthMaterial, object.customDistanceMaterial].flat().filter(Boolean);
    for (const material of Object.values(this.groundMaterials ?? {})) rememberTextures(material);
    for (const maps of this._facadeTextures.values()) for (const texture of Object.values(maps)) {
      rememberTexture(texture);
    }
    // BuildingVisibility sigue siendo dueño de estos materiales, incluidos los no usados por un lote.
    const closedMaterials = new Set(this.buildingVisibility.closedMaterials.values());
    for (const material of closedMaterials) rememberTextures(material);
    this.group.traverse(object => {
      for (const material of meshMaterials(object)) rememberTextures(material);
    });
    for (const flock of this.pigeonFlocks ?? []) flock.dispose();
    this.signals?.dispose();
    this.stationGroup?.userData.dispose?.();
    this.stationGroup?.clear();
    for (const prop of this.props) prop.instance.dispose?.();
    for (const bus of this.busServices ?? []) bus.dispose();
    this.buildingVisibility.dispose();
    this._facadeTextures.clear();
    this._facadeSeeds.clear();
    this._facadeMaterials.clear();
    scene.remove(this.group);
    for (const n of this.npcs) n.dispose();
    const geometries = new Set(), materials = new Set();
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) geometries.add(o.geometry);
      for (const material of meshMaterials(o)) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) if (!closedMaterials.has(material)) material.dispose();
    for (const texture of textures) if (!ownedTextures.has(texture)) texture.dispose();
    forgetZoneTextures();
  }
}
