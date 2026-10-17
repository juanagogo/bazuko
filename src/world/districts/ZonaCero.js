// src/world/districts/ZonaCero.js
import * as THREE from 'three';
import { TileFactory, hasRoadTexture } from '../tiles/TileFactory.js';
import { generateDistrict, getPropSpawnPoints, getLayout, blockOrigin, getSpawnPoints } from '../tiles/RoadGenerator.js';
import { createRandomProp } from '../props/index.js';
import { buildAvenueDecor } from '../AvenidaTM.js';
import {
  TILE_SIZE, DISTRICT_SIZE, COLORS, AVENUE_N_TILES,
  WORLD_MIN_X, WORLD_MAX_Z
} from '../../utils/constants.js';
import { isSolid } from '../tiles/tileTypes.js';

// Tiles de calzada (para orientar el brazo de los faroles hacia la calle más cercana)
const ROADISH = new Set(['road', 'roadV', 'avN', 'avP']);

export class ZonaCero {
  constructor() {
    this.group = new THREE.Group();
    this.tiles = [];
    this.props = [];
    this.propUpdatables = [];
    this.map = null;
  }

  build(scene, collisions) {
    const size = DISTRICT_SIZE;
    const layout = getLayout(size);
    const cols = layout.cols, rows = layout.rows;
    const map = generateDistrict(size);
    this.layout = layout;
    this.cols = cols;
    this.rows = rows;

    // ===== Tiles =====
    // Un InstancedMesh por tipo de tile (antes: 1024 meshes = ~1000 draw calls)
    const byType = new Map(); // clave de tipo -> [x, z, ángulo, ...]
    const roadTex = hasRoadTexture();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const type = map[y][x];
        let key = type === 'floor' ? 'sidewalk' : type; // 'floor' usa el mismo mesh que 'sidewalk'
        // Calles con textura: un solo mesh 'road' orientado por instancia (media calzada con la raya
        // en el borde que toca a la otra mitad); intersecciones ('roadX') sin raya.
        let angle = 0;
        if (type === 'avP') {
          key = 'roadX'; // plaza donde se cruzan las dos avenidas: asfalto liso
        } else if (type === 'avN' || type === 'avTM' || type === 'avG') {
          // Avenida (12 filas/columnas a0..a11): la raya discontinua solo separa carril normal y exclusivo
          // (contiguos a1|a2 y a9|a10); el resto es asfalto liso, igual que en los cruces con calles
          // transversales. La zona verde = andén (bordillo) + parche de pasto.
          const vert = layout.xKinds[x].startsWith('av');   // avenida vertical (a lo largo de Z)
          const a = vert ? x - layout.avenueCol0 : y - layout.avenueRow0;  // 0..11
          const cross = vert ? layout.yKinds[y] === 'road' : layout.xKinds[x] === 'road';
          const last = layout.avenueRows - 1;
          const aPlus = vert ? Math.PI : Math.PI / 2;      // raya hacia +a (X en la vertical, Z en la horizontal)
          const aMinus = vert ? 0 : -Math.PI / 2;
          if (type === 'avG') {
            key = 'sidewalk';
          } else if (type === 'avN') {
            const edge = a === AVENUE_N_TILES - 1 || a === last - AVENUE_N_TILES + 1; // junto al carril TM
            key = cross || !edge ? 'roadX' : 'road';
            angle = a < 6 ? aPlus : aMinus;                // raya hacia el carril TM
          } else {
            const edge = a === AVENUE_N_TILES || a === last - AVENUE_N_TILES;       // junto al carril normal
            key = cross || !edge ? 'tmX' : 'tm';
            angle = a < 6 ? aMinus : aPlus;                // raya hacia el carril normal
          }
        } else if (roadTex && (type === 'road' || type === 'roadV')) {
          key = 'road';
          if (type === 'roadV') {
            angle = map[y][x + 1] === 'roadV' ? Math.PI : 0;
          } else if (map[y - 2]?.[x] === 'roadV' || map[y + 2]?.[x] === 'roadV') {
            key = 'roadX';
          } else {
            angle = map[y + 1]?.[x] === 'road' ? Math.PI / 2 : -Math.PI / 2;
          }
        }
        let arr = byType.get(key);
        if (!arr) byType.set(key, (arr = []));
        arr.push(x * TILE_SIZE, y * TILE_SIZE, angle);
        // Proxy minimo para el sistema de colisiones (solo lee position)
        const tile = { position: new THREE.Vector3(x * TILE_SIZE, 0, y * TILE_SIZE) };

        // Colisiones
        if (collisions && isSolid(type)) {
          if (type === 'building') {
            collisions.add(
              tile,
              new THREE.Vector3(TILE_SIZE, 8, TILE_SIZE),
              new THREE.Vector3(0, 4, 0)
            );
          } else if (type === 'buildingBrick') {
            collisions.add(
              tile,
              new THREE.Vector3(TILE_SIZE, 6, TILE_SIZE),
              new THREE.Vector3(0, 3, 0)
            );
          } else if (type === 'buildingLit') {
            collisions.add(
              tile,
              new THREE.Vector3(TILE_SIZE, 10, TILE_SIZE),
              new THREE.Vector3(0, 5, 0)
            );
          } else if (type === 'barrel') {
            collisions.add(tile, new THREE.Vector3(1, 1.2, 1));
          }
        }
      }
    }

    const _m = new THREE.Matrix4();
    for (const [key, arr] of byType) {
      const sample = TileFactory.create(key);
      const im = new THREE.InstancedMesh(sample.geometry, sample.material, arr.length / 3);
      im.castShadow = sample.castShadow;
      im.receiveShadow = sample.receiveShadow;
      im.frustumCulled = false; // un solo draw call; evita bounding sphere del conjunto
      for (let i = 0; i < arr.length / 3; i++) {
        _m.makeRotationY(arr[i * 3 + 2]).setPosition(arr[i * 3], 0, arr[i * 3 + 1]);
        im.setMatrixAt(i, _m);
      }
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
      this.tiles.push(im);
    }

    // ===== Props =====
    const spawnPoints = getPropSpawnPoints(map, size);
    for (const pt of spawnPoints) {
      const worldPos = new THREE.Vector3(pt.x * TILE_SIZE, 0, pt.z * TILE_SIZE);
      // Faroles: el brazo mira hacia la calzada mas cercana (suma de vecinos de calle; si no, diagonal)
      let opts;
      if (pt.type === 'farol') {
        let fx = 0, fz = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const t = map[pt.z + dz]?.[pt.x + dx];
          if (ROADISH.has(t)) { fx += dx; fz += dz; }
        }
        if (fx === 0 && fz === 0) {
          for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
            const t = map[pt.z + dz]?.[pt.x + dx];
            if (ROADISH.has(t)) { fx += dx; fz += dz; }
          }
        }
        if (fx !== 0 || fz !== 0) opts = { facing: { x: fx, z: fz } };
      }
      const result = createRandomProp(worldPos, pt.type, opts);
      if (!result) continue;

      this.group.add(result.group);
      this.props.push(result);

      if (result.updatable) this.propUpdatables.push(result.instance);
    }

    // ===== Avenida TransMilenio: pasto, cebras, "SOLO BUS", árboles, estaciones =====
    const decor = buildAvenueDecor(layout, collisions);
    this.group.add(decor.group);
    this.avenue = decor.avenue;   // avenida H (a lo largo de X): { axis, c, lanes:[{c,dir}], crossings, plaza, spans, stations }
    this.avenues = decor.avenues; // { H, V, all }

    scene.add(this.group);

    // ===== Helpers expuestos =====

    this.map = map;

    // Tienda 8x4: mitad norte de la plaza de la esquina superior-derecha (tiles ox..ox+3, oz..oz+1)
    const st = blockOrigin(-1, 0);
    // Cama/cambuche: esquina inferior-izquierda; los muros interiores están en x = WORLD_MIN_X, z = WORLD_MAX_Z
    const dealerO = blockOrigin(-1, -1);
    const spawnO = getSpawnPoints().player;
    const av = this.avenue;
    // ¿Zona exclusiva de buses (carriles TM + zona verde central, con margen)? Los autos no entran.
    const avH = this.avenues.H, avV = this.avenues.V;
    this.isRestrictedForCars = (worldX, worldZ) =>
      Math.abs(worldZ - avH.c) < avH.half + 3 || Math.abs(worldX - avV.c) < avV.half + 3;

    // ¿Es una posición transitable?
    this.isWalkableAt = (worldX, worldZ) => {
      const tx = Math.round(worldX / TILE_SIZE);
      const tz = Math.round(worldZ / TILE_SIZE);
      if (tx < 0 || tz < 0 || tx >= cols || tz >= rows) return false;
      if (tx >= st.x && tx <= st.x + 3 && tz >= st.y && tz <= st.y + 1) return false; // volumen de la Tienda
      const t = map[tz][tx];
      return (
        t === 'sidewalk' ||
        t === 'dirt' ||
        t === 'floor' ||
        t === 'road' ||
        t === 'roadV' ||
        t === 'avN' || t === 'avTM' || t === 'avG' || t === 'avP'
      );
    };

    // Zonas reservadas (spawn, venta, cama, dealer, crafteo)
    this.reserved = {
      // Spawn: centro de la plaza libre de la esquina superior-izquierda (antes una intersección: ahora hay tráfico)
      spawn:  { x: spawnO.x * TILE_SIZE, z: spawnO.z * TILE_SIZE },
      // Tienda 8x4 en la mitad norte de la plaza 'stall' (esquina superior-derecha), frente hacia +Z;
      // sell = punto de interacción frente a la entrada (sobre el andén). Antes: x 55, z 8 (mundo de 32 tiles).
      sell:   { x: (st.x + 1.5) * TILE_SIZE, z: (st.y + 2) * TILE_SIZE },
      // Cambuche (7.4x7.6, alto ~4.2) pegado a la esquina inferior-izquierda del mapa (muros en x=WORLD_MIN_X
      // y z=WORLD_MAX_Z); bedExit = punto libre junto a él al reaparecer
      bed:    { x: WORLD_MIN_X + 3.7, z: WORLD_MAX_Z - 3.8 },
      bedExit: { x: WORLD_MIN_X + 9, z: WORLD_MAX_Z - 8 },
      dealer: { x: (dealerO.x + 1) * TILE_SIZE, z: (dealerO.y + 1) * TILE_SIZE },
      // Crafteo: andén sobre la fila 6 (entre la 1ª manzana de la 2ª columna y la calle), derivado del layout
      craft:  { x: (blockOrigin(1, 0).x + 1) * TILE_SIZE, z: (blockOrigin(1, 0).y + 4) * TILE_SIZE }
    };

    // Puntos de andén para bolsas de basura: tiles 'sidewalk' en tramo recto junto a un
    // edificio/muro (no esquinas), con la bolsa pegada a la pared. Alejados de faroles y otros props.
    // Todos son andenes alcanzables (RoadGenerator valida la conectividad); una bolsa pegada a la
    // pared siempre deja libre el lado de la calle del andén.
    const BUILDINGS = new Set(['building', 'buildingBrick', 'buildingLit']);
    const propTiles = spawnPoints.map((p) => [p.x, p.z]);
    this.getSidewalkSpots = () => {
      const spots = [];
      const SIDEWALK_TOP = 0.1; // alto del BoxGeometry(…, 0.2, …) centrado en y=0
      const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const r = this.reserved;
      for (let tz = 1; tz < rows - 1; tz++) {
        for (let tx = 1; tx < cols - 1; tx++) {
          if (map[tz][tx] !== 'sidewalk') continue;
          let wall = null, walls = 0;
          for (const [dx, dz] of DIRS) {
            if (BUILDINGS.has(map[tz + dz]?.[tx + dx])) { wall = [dx, dz]; walls++; }
          }
          if (walls !== 1) continue; // sin pared o esquina
          // tramo recto: los vecinos a lo largo de la pared también son andén
          const [wx, wz] = wall;
          if (map[tz + wx]?.[tx + wz] !== 'sidewalk' || map[tz - wx]?.[tx - wz] !== 'sidewalk') continue;
          // lejos de faroles/props (tile propio y vecinos)
          if (propTiles.some(([px, pz]) => Math.abs(px - tx) <= 1 && Math.abs(pz - tz) <= 1)) continue;
          const x = tx * TILE_SIZE + wx * 0.5;
          const z = tz * TILE_SIZE + wz * 0.5;
          if (
            Math.hypot(x - r.sell.x, z - r.sell.z) < 6 ||
            Math.hypot(x - r.bed.x, z - r.bed.z) < 6 ||
            Math.hypot(x - r.spawn.x, z - r.spawn.z) < 6 ||
            Math.hypot(x - r.dealer.x, z - r.dealer.z) < 6 ||
            Math.hypot(x - r.craft.x, z - r.craft.z) < 6
          ) continue;
          spots.push(new THREE.Vector3(x, SIDEWALK_TOP, z));
        }
      }
      return spots;
    };

    // Grid de spawn para basura (garantiza distribución)
    this.getSpawnGrid = () => {
      const grid = [];
      const step = 4;
      for (let tz = 4; tz < rows - 4; tz += step) {
        for (let tx = 4; tx < cols - 4; tx += step) {
          const x = tx * TILE_SIZE;
          const z = tz * TILE_SIZE;
          if (!this.isWalkableAt(x, z)) continue;

          // Evitar zonas reservadas
          const r = this.reserved;
          const tooCloseSell  = Math.hypot(x - r.sell.x,  z - r.sell.z)  < 6;
          const tooCloseBed   = Math.hypot(x - r.bed.x,   z - r.bed.z)   < 6;
          const tooCloseSpawn = Math.hypot(x - r.spawn.x, z - r.spawn.z) < 6;
          const tooCloseDealer = Math.hypot(x - r.dealer.x, z - r.dealer.z) < 6;
          const tooCloseCraft = Math.hypot(x - r.craft.x, z - r.craft.z) < 6;
          if (tooCloseSell || tooCloseBed || tooCloseSpawn || tooCloseDealer || tooCloseCraft) continue;

          grid.push(new THREE.Vector3(x, 0, z));
        }
      }
      return grid;
    };
  }

  update(dt, playerPos) {
    for (const p of this.propUpdatables) p.update(dt);
  }

  setNightMode(isNight) {
    for (const p of this.props) {
      if (p.instance.setNight) p.instance.setNight(isNight);
    }
  }

  /** Nivel 0..1 de luces artificiales (transición gradual) */
  setLampLevel(level) {
    for (const p of this.props) {
      if (p.instance.setNightLevel) p.instance.setNightLevel(level);
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    for (const p of this.props) p.instance.dispose?.();
    this.group.traverse((o) => {
      if (o.userData?.sharedAsset) return; // GLB compartido
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.tiles = [];
    this.props = [];
    this.propUpdatables = [];
  }
}