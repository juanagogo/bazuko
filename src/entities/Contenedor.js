// src/entities/Contenedor.js
// Contenedores de basura de calle: otra fuente de loot, mejor que las bolsas pero con cooldown largo.
// Todos se dibujan con UN InstancedMesh (modelo contenedor.glb, 1 draw call + 1 de sombra); la
// interacción, la colisión y la silueta (XRay) viven en objetos Contenedor ligeros por unidad.
// La lógica de búsqueda/inventario/enfermedad/XP la hace InteractionSystem (duck typing: isContainer).
import * as THREE from 'three';
import { ITEMS } from '../data/items.js';
import { loadModel } from '../utils/ModelCache.js';
import { WORLD_COLS, WORLD_ROWS } from '../utils/constants.js';

export const CONT_SEARCH_TIME = 4.5;  // s de búsqueda (la bolsa se recoge al instante / 1.5 s seleccionando)
export const CONT_COOLDOWN = 120;     // s de juego hasta que se rellena
export const CONT_RANGE = 1.6;        // u, medido al borde de su caja
const CONT_DISEASE_MULT = 1.5;        // riesgo de enfermedad respecto a una bolsa
const CONT_XP_MULT = 2;

// Tamaño final: el GLB mide 1.90 x 1.70 x 1.36 (largo x alto x fondo, frente = +Z local).
// Alto 1.4 => largo ~1.56, fondo ~1.12 (cabe en un andén de 2 u dejando paso)
const H = 1.4;
const L = 1.56;
const D = 1.12;
const FRONT_YAW = 0; // corrección del frente del modelo (rad) si el GLB mira hacia otro lado

const COUNT_BASE = 16;            // contenedores en el mundo de 50x50 tiles; escala con el área
const MIN_SEPARATION = 8;         // u entre contenedores
const MIN_PICKUP_DIST = 5;        // u a bolsas
const MIN_RESERVED_DIST = 8;      // u a tienda/cama/dealer/crafteo/spawn
const MIN_POLE_DIST = 5;          // u a semáforos
const FULL_COLOR = 0xffffff;
const EMPTY_COLOR = 0x6a6a6a;     // tinte del contenedor vaciado

// ===== Tablas de loot (solo ítems existentes) =====
// Más ítems y mejores que LOOT_COMMON/LOOT_RARE de la bolsa.
const LOOT_CONTENEDOR = [
  { item: 'lata', weight: 12 },
  { item: 'botella', weight: 12 },
  { item: 'carton', weight: 10 },
  { item: 'chatarra', weight: 14 },
  { item: 'cable', weight: 12 },
  { item: 'pan', weight: 8 },
  { item: 'agua', weight: 7 },
  { item: 'lataComida', weight: 7 },
  { item: 'vendaje', weight: 5 },
  { item: 'refresco', weight: 5 },
  { item: 'cafe', weight: 4 },
  { item: 'jabon', weight: 3 },
  { item: 'cepillo', weight: 2 },
  { item: 'jarabe', weight: 2 },
  { item: 'pomada', weight: 1.5 },
  { item: 'retrovisor', weight: 2 },
  { item: 'radio', weight: 1.5 }
].filter((e) => ITEMS[e.item]);

const LOOT_CONTENEDOR_RARE = [
  { item: 'reloj', weight: 40 },
  { item: 'moneda', weight: 35 },
  { item: 'anillo', weight: 25 }
].filter((e) => ITEMS[e.item]);

function weightedPick(table) {
  let total = 0;
  for (let i = 0; i < table.length; i++) total += table[i].weight;
  let r = Math.random() * total;
  for (let i = 0; i < table.length; i++) {
    r -= table[i].weight;
    if (r <= 0) return table[i].item;
  }
  return table[0].item;
}

const _m = new THREE.Matrix4();
const _mp = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _up = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();

/** Un contenedor concreto (interactuable). */
export class Contenedor {
  constructor(manager, index, x, z, yaw) {
    this.isContainer = true; // duck typing para InteractionSystem/HUD
    this.manager = manager;
    this.index = index;
    this.searchRange = CONT_RANGE;
    this.searchTime = CONT_SEARCH_TIME;
    this.cooldown = 0;       // s restantes hasta rellenarse (0 = lleno)
    this.leftover = null;    // ítems que no cupieron en el inventario (siguen dentro)
    this.searching = false;  // lo marca InteractionSystem mientras dura la búsqueda
    this.position = new THREE.Vector3(x, 0, z);
    this.yaw = yaw;
    this.hx = 0; this.hz = 0;
    this.box = null;         // handle de CollisionSystem.addMovingBox

    // Proxy invisible (material.visible=false => sin draw call) para la silueta XRay: una caja
    this.proxy = new THREE.Group();
    const mesh = new THREE.Mesh(manager.proxyGeo, manager.proxyMat);
    mesh.position.y = H / 2;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    this.proxy.add(mesh);
    this.place(x, z, yaw);
  }

  /** (Re)coloca: posición, giro, caja de colisión y proxy. */
  place(x, z, yaw) {
    this.position.set(x, 0, z);
    this.yaw = yaw;
    const alongX = Math.abs(Math.sin(yaw)) < 0.5; // frente en ±Z => el largo va en X
    this.hx = (alongX ? L : D) / 2;
    this.hz = (alongX ? D : L) / 2;
    this.proxy.position.set(x, 0, z);
    this.proxy.rotation.y = yaw;
    const cols = this.manager.collisions;
    if (cols) {
      if (!this.box) this.box = cols.addMovingBox(x, z, this.hx, this.hz);
      else { this.box.x = x; this.box.z = z; this.box.hx = this.hx; this.box.hz = this.hz; }
    }
  }

  get isFull() { return this.cooldown <= 0; }
  canSearch() { return this.cooldown <= 0; }

  /** Distancia en planta desde un punto al borde de la caja (0 si está dentro). */
  edgeDistance(p) {
    const dx = Math.max(Math.abs(p.x - this.position.x) - this.hx, 0);
    const dz = Math.max(Math.abs(p.z - this.position.z) - this.hz, 0);
    return Math.hypot(dx, dz);
  }

  /** Texto del prompt de interacción (HUD). */
  promptText() {
    if (this.searching) return 'Buscando en el contenedor… (muévete o Esc para cancelar)';
    if (this.cooldown > 0) {
      const s = Math.ceil(this.cooldown);
      const mm = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, '0');
      return `Vacío — vuelve más tarde (${String(mm).padStart(2, '0')}:${ss})`;
    }
    return '[E] Buscar en el contenedor';
  }

  /**
   * Resultado de la búsqueda (misma forma que Pickup.harvest). Deja el contenedor vacío en cooldown;
   * si luego no cupo todo en el inventario, restore() devuelve lo sobrante.
   */
  harvest(boostActive = false, sorted = false, fx = {}) {
    if (this.cooldown > 0) return null;
    if (this.leftover?.length) { // sobrantes de una búsqueda anterior: se entregan tal cual
      const items = this.leftover;
      this.leftover = null;
      const rare = items.find((id) => LOOT_CONTENEDOR_RARE.some((r) => r.item === id)) ?? null;
      this._empty();
      return { items, rare, sorted: false, diseaseMult: CONT_DISEASE_MULT, xpMult: CONT_XP_MULT };
    }
    const rareMult = fx.rareChanceMult ?? 1;
    const valueMult = fx.sortValueMult ?? 1;
    let rolls = 3 + Math.floor(Math.random() * 3); // 3..5
    if (boostActive) rolls += 1;
    if (valueMult > 1 && Math.random() < valueMult - 1) rolls += 1; // talento de selección
    const items = [];
    for (let i = 0; i < rolls; i++) items.push(weightedPick(LOOT_CONTENEDOR));
    let rare = null;
    if (Math.random() < (boostActive ? 0.42 : 0.3) * rareMult) {
      rare = weightedPick(LOOT_CONTENEDOR_RARE);
      items.push(rare);
    }
    this._empty();
    return { items, rare, sorted: false, diseaseMult: CONT_DISEASE_MULT, xpMult: CONT_XP_MULT };
  }

  /** Lo que no cupo en el inventario se queda dentro: vuelve a estar lleno (sin cooldown). */
  restore(leftoverIds) {
    if (!leftoverIds?.length) return;
    this.leftover = leftoverIds.slice();
    this.cooldown = 0;
    this.manager.setVisualFull(this, true);
  }

  _empty() {
    this.cooldown = CONT_COOLDOWN;
    this.searching = false;
    this.manager.setVisualFull(this, false);
  }

  serialize() {
    return {
      x: this.position.x, z: this.position.z, yaw: this.yaw, cooldown: this.cooldown,
      leftover: this.leftover?.length ? this.leftover.slice() : null
    };
  }

  restoreState(s) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) return;
    this.manager.relocate(this, s.x, s.z, Number.isFinite(s.yaw) ? s.yaw : this.yaw);
    const cd = Number(s.cooldown) || 0;
    this.cooldown = cd > 0 ? Math.min(cd, CONT_COOLDOWN) : 0;
    this.leftover = Array.isArray(s.leftover) && s.leftover.length
      ? s.leftover.filter((id) => ITEMS[id]) : null;
    this.manager.setVisualFull(this, this.cooldown <= 0);
  }
}

/** Gestor: coloca los contenedores, dibuja las instancias y gestiona cooldowns. */
export class Contenedores {
  constructor(scene, collisions) {
    this.scene = scene;
    this.collisions = collisions;
    this.items = [];
    this.meshes = []; // InstancedMesh (1 por malla del GLB; el modelo es una sola malla)
    this._parts = []; // { geometry, material, matrix } relativos al origen del contenedor
    this._disposed = false;
    this.proxyGeo = new THREE.BoxGeometry(L, H, D);
    this.proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  }

  /**
   * Elige los puntos y crea los contenedores.
   * @param {object} district  ZonaCero (getSidewalkSpots, reserved, isRestrictedForCars, isWalkableAt, map)
   * @param {{x:number,z:number}[]} pickups  bolsas (para separarse de ellas)
   * @param {{x:number,z:number}[]} poles  semáforos (para separarse de ellos)
   */
  build(district, pickups = [], poles = []) {
    const spots = district?.getSidewalkSpots ? district.getSidewalkSpots() : [];
    const map = district?.map;
    const r = district?.reserved;
    const reserved = r ? [r.sell, r.bed, r.bedExit, r.spawn, r.dealer, r.craft].filter(Boolean) : [];
    const T = 2; // TILE_SIZE
    const cand = [];
    for (const s of spots) {
      if (district.isRestrictedForCars?.(s.x, s.z)) continue; // avenidas TM / zona verde
      const tx = Math.round(s.x / T), tz = Math.round(s.z / T);
      const cx = tx * T, cz = tz * T;
      // Pared: el punto de bolsa viene desplazado 0.5 hacia ella; si no, se busca el vecino no transitable
      let wx = 0, wz = 0;
      const ox = s.x - cx, oz = s.z - cz;
      if (Math.abs(ox) > 0.2 && Math.abs(oz) < 0.2) wx = Math.sign(ox);
      else if (Math.abs(oz) > 0.2 && Math.abs(ox) < 0.2) wz = Math.sign(oz);
      else {
        let n = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (district.isWalkableAt && !district.isWalkableAt(cx + dx * 1.5, cz + dz * 1.5)) { wx = dx; wz = dz; n++; }
        }
        if (n !== 1) continue;
      }
      // Tramo recto de andén a ambos lados (no esquinas, cruces ni rampas)
      if (map) {
        let ok = true;
        for (const k of [-2, -1, 1, 2]) {
          if (map[tz + wx * k]?.[tx + wz * k] !== 'sidewalk') { ok = false; break; }
        }
        if (!ok || map[tz]?.[tx] !== 'sidewalk') continue;
      }
      // Pegado a la pared (el fondo D llega hasta el borde del tile) con 2 cm de holgura
      const off = T / 2 - D / 2 - 0.02;
      const x = cx + wx * off, z = cz + wz * off;
      if (reserved.some((q) => Math.hypot(x - q.x, z - q.z) < MIN_RESERVED_DIST)) continue;
      if (pickups.some((q) => Math.hypot(x - q.x, z - q.z) < MIN_PICKUP_DIST)) continue;
      if (poles.some((q) => Math.hypot(x - q.x, z - q.z) < MIN_POLE_DIST)) continue;
      // Frente (+Z local) hacia el andén/calle: opuesto a la pared
      cand.push({ x, z, yaw: Math.atan2(-wx, -wz) + FRONT_YAW });
    }

    // Selección aleatoria con separación mínima
    const want = Math.max(6, Math.round(COUNT_BASE * (WORLD_COLS * WORLD_ROWS) / 2500));
    for (let i = cand.length - 1; i > 0; i--) { // Fisher-Yates
      const j = Math.floor(Math.random() * (i + 1));
      [cand[i], cand[j]] = [cand[j], cand[i]];
    }
    const chosen = [];
    for (const c of cand) {
      if (chosen.length >= want) break;
      if (chosen.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < MIN_SEPARATION)) continue;
      chosen.push(c);
    }
    chosen.forEach((c, i) => {
      const it = new Contenedor(this, i, c.x, c.z, c.yaw);
      this.items.push(it);
      this.scene.add(it.proxy);
    });

    this._loadModel();
    return this.items;
  }

  _loadModel() {
    if (!this.items.length) return;
    loadModel('contenedor.glb', H, { fit: 'height' }).then((base) => {
      if (this._disposed) return;
      if (base) {
        base.updateMatrixWorld(true);
        base.traverse((o) => {
          if (o.isMesh) this._parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone() });
        });
      }
      if (!this._parts.length) { // fallback: caja verde simple
        const mat = new THREE.MeshLambertMaterial({ color: 0x2f6b3a, flatShading: true });
        this._parts.push({ geometry: this.proxyGeo, material: mat, matrix: new THREE.Matrix4().makeTranslation(0, H / 2, 0), own: true });
      }
      for (const part of this._parts) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, this.items.length);
        im.castShadow = true;
        im.receiveShadow = true;
        im.frustumCulled = false; // un draw call; evita la esfera envolvente del conjunto
        im.userData.noXRay = true;
        for (let i = 0; i < this.items.length; i++) im.setColorAt(i, _col.setHex(this.items[i].isFull ? FULL_COLOR : EMPTY_COLOR));
        this.meshes.push(im);
        this.scene.add(im);
      }
      this._writeAll();
    });
  }

  _writeOne(it) {
    _p.set(it.position.x, 0, it.position.z);
    _q.setFromAxisAngle(_up, it.yaw);
    _m.compose(_p, _q, _s);
    for (let k = 0; k < this.meshes.length; k++) {
      _mp.multiplyMatrices(_m, this._parts[k].matrix);
      this.meshes[k].setMatrixAt(it.index, _mp);
    }
  }

  _writeAll() {
    for (const it of this.items) this._writeOne(it);
    for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
  }

  /** Cambia la posición de un contenedor (carga de partida). */
  relocate(it, x, z, yaw) {
    it.place(x, z, yaw);
    if (this.meshes.length) {
      this._writeOne(it);
      for (const im of this.meshes) im.instanceMatrix.needsUpdate = true;
    }
  }

  /** Tinte: lleno = color normal; vaciado = más oscuro. */
  setVisualFull(it, full) {
    if (!this.meshes.length) return; // al cargar el modelo se aplica el estado actual
    _col.setHex(full ? FULL_COLOR : EMPTY_COLOR);
    for (const im of this.meshes) {
      im.setColorAt(it.index, _col);
      im.instanceColor.needsUpdate = true;
    }
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (it.cooldown > 0) {
        it.cooldown -= dt;
        if (it.cooldown <= 0) { it.cooldown = 0; this.setVisualFull(it, true); }
      }
    }
  }

  serialize() { return this.items.map((c) => c.serialize()); }

  restoreState(arr) {
    if (!Array.isArray(arr)) return;
    const n = Math.min(arr.length, this.items.length);
    for (let i = 0; i < n; i++) this.items[i].restoreState(arr[i]);
  }

  dispose() {
    this._disposed = true;
    for (const it of this.items) {
      if (it.box) this.collisions?.removeMovingBox(it.box);
      this.scene.remove(it.proxy);
    }
    for (const im of this.meshes) {
      this.scene.remove(im);
      im.dispose?.(); // libera el buffer de instancias (geometría/material son compartidos)
    }
    for (const part of this._parts) if (part.own) part.material.dispose();
    this.proxyGeo.dispose();
    this.proxyMat.dispose();
    this.items = [];
    this.meshes = [];
    this._parts = [];
  }
}
