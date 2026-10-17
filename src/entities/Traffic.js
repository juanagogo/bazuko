// src/entities/Traffic.js
// Tráfico de autos (car1.glb / car2.glb) por las calles y los carriles normales de las avenidas.
// - Un InstancedMesh por modelo (2 draw calls para todos los autos), matrices actualizadas cada frame sin
//   allocations, tinte por instancia (instanceColor). Fallback: cajas instanciadas si los GLB no cargan.
// - Cada auto sigue una ruta de la red (TrafficNet): de muro a muro por la derecha, con giros a la derecha entre
//   calles y avenidas; al terminar reaparece en una ruta libre. No entran a los carriles TM ni a la zona verde
//   (solo cruzan los TM de la otra avenida dentro de la plaza, regulados por su semáforo).
// - Frenan ante el vehículo de adelante (autos y buses) y antes de la línea de pare con luz roja/ámbar.
// - Obstáculos móviles (addMovingBox): el jugador no los atraviesa. Atropello si van a más de HIT_SPEED.
import * as THREE from 'three';
import { loadModel } from '../utils/ModelCache.js';
import { getWorldClipPlanes } from '../utils/WorldClip.js';
import { pathAt, gateLimit, beginTrafficFrame } from '../systems/TrafficNet.js';

const CAR_LEN = 4.7;
const CAR_W = 1.9;                 // ancho de colisión/visual (carril de calle = 2 u)
const MODELS = [
  { file: 'car1.glb', h: 1.9, w: 2.0 },   // SUV/furgón boxy (modelo 4.7 x 2.25 x 3.03 -> se estrecha)
  { file: 'car2.glb', h: 1.55, w: 1.95 }  // taxi (modelo 4.7 x 1.51 x 2.24)
];
// Tintes por instancia (multiplican la textura del modelo)
const TINTS = [
  [1, 1, 1], [1.15, 0.8, 0.8], [0.75, 0.85, 1.15], [0.8, 1.05, 0.8], [1.15, 1.05, 0.7],
  [0.7, 0.7, 0.78], [1.05, 0.85, 1.15], [1.2, 0.95, 0.75]
];
const ACC = 3.5, DEC = 7;          // u/s2
const HIT_SPEED = 3;               // atropella solo si va a más de esto (u/s)
const HIT_STOP = 3.5;              // s detenido tras atropellar
const HIT_PAD = 0.15;
const ROB_COOLDOWN = 180;           // s de juego hasta que se puede robar de nuevo el mismo auto
const GAP_MIN = 1.2;               // distancia que dejan al de adelante

const _M = new THREE.Matrix4(), _T = new THREE.Matrix4(), _R = new THREE.Matrix4(), _S = new THREE.Matrix4();
const _o = { x: 0, z: 0, hx: 0, hz: 0 };
const _o2 = { x: 0, z: 0, hx: 0, hz: 0 };

export class Traffic {
  /**
   * @param net  red de tráfico (buildTrafficNet)
   * @param count número de autos (12-20)
   */
  constructor(scene, net, collisions, count = 16) {
    this.scene = scene;
    this.net = net;
    this.collisions = collisions;
    this.t = 0;                 // reloj global de semáforos (s)
    this.onHit = null;          // (car) => void
    this._disposed = false;
    this.cars = [];
    this.rel = [null, null];    // matriz base de cada modelo
    this.scl = [null, null];    // escala (sy, sz) de cada modelo
    this.meshes = [null, null];
    this.fallback = null;

    const routes = net.routes;
    const order = routes.map((_, i) => i).sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const car = {
        collider: collisions?.addMovingBox(0, 0, CAR_LEN / 2, CAR_W / 2) ?? null,
        route: routes[order[i % routes.length]], s: 0, v: 0, cruise: 6 + Math.random() * 2,
        cursor: { i: 0 }, cur2: { i: 0 }, x: 0, z: 0, hx: 1, hz: 0, yaw: 0, bhx: 1, bhz: 1,
        state: 0, timer: 0, stuck: 0, ghost: 0, commit: null,
        robbedT: 0, position: new THREE.Vector3(), model: i % 2, tint: TINTS[i % TINTS.length], label: 'un carro', idx: i
      };
      // Reparto inicial: s aleatorio sin solaparse con los ya colocados
      for (let tries = 0; tries < 30; tries++) {
        car.s = Math.random() * car.route.len * 0.85;
        pathAt(car.route, car.s, _o, car.cursor);
        let ok = true;
        for (const o of this.cars) if (Math.hypot(o.x - _o.x, o.z - _o.z) < 7) { ok = false; break; }
        if (ok) break;
        car.route = routes[(Math.random() * routes.length) | 0];
      }
      this._sync(car, 0, true);
      car.v = car.cruise;
      // Interfaz de objetivo de interacción (InteractionSystem, duck typing): robo de retrovisores a autos detenidos
      car.robMirrors = () => true;
      car.canRob = () => car.robbedT <= 0 && car.state === 0 && car.v < 0.3 && car.x > 3 && car.x < 95 && car.z > 3 && car.z < 95;
      car.edgeDistance = (p) => {
        const dx = Math.max(Math.abs(p.x - car.x) - car.bhx, 0), dz = Math.max(Math.abs(p.z - car.z) - car.bhz, 0);
        return Math.hypot(dx, dz);
      };
      car.markRobbed = () => { car.robbedT = ROB_COOLDOWN; };
      car.startNow = () => { car.ghost = 3; car.v = Math.max(car.v, 3); car.robbedT = 60; }; // arranca de inmediato (ignora al de adelante)
      this.cars.push(car);
    }
    this._buildFallback();
    this._loadModels();
  }

  _buildFallback() {
    const geo = new THREE.BoxGeometry(CAR_LEN, 1.5, CAR_W); geo.translate(0, 0.75, 0);
    const mat = new THREE.MeshLambertMaterial({ color: 0x6a7a8a, flatShading: true, clippingPlanes: getWorldClipPlanes() });
    const im = new THREE.InstancedMesh(geo, mat, this.cars.length);
    im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
    this.scene.add(im);
    this.fallback = im;
  }

  async _loadModels() {
    const planes = getWorldClipPlanes();
    const bases = await Promise.all(MODELS.map((m) => loadModel(m.file, CAR_LEN)));
    if (this._disposed) return;
    const okIdx = [];
    bases.forEach((base, k) => {
      if (!base) return;
      base.updateMatrixWorld(true);
      let mesh = null;
      base.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
      if (!mesh) return;
      const size = new THREE.Box3().setFromObject(base).getSize(new THREE.Vector3());
      this.rel[k] = mesh.matrixWorld.clone();
      this.scl[k] = [MODELS[k].h / size.y, MODELS[k].w / size.z];
      const m = mesh.material;
      m.metalnessMap = null; m.roughnessMap = null; m.normalMap = null;
      m.metalness = 0.1; m.roughness = 0.8;
      m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true;
      okIdx.push([k, mesh]);
    });
    if (!okIdx.length) return; // sin GLB: quedan las cajas
    const usable = okIdx.map(([k]) => k);
    for (const c of this.cars) if (!usable.includes(c.model)) c.model = usable[c.idx % usable.length];
    for (const [k, mesh] of okIdx) {
      const mine = this.cars.filter((c) => c.model === k);
      const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, Math.max(1, mine.length));
      mine.forEach((c, j) => { c.slot = j; im.setColorAt(j, new THREE.Color(c.tint[0], c.tint[1], c.tint[2])); });
      im.instanceColor.needsUpdate = true;
      im.count = mine.length;
      im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      this.scene.add(im);
      this.meshes[k] = im;
    }
    if (this.fallback) { this.scene.remove(this.fallback); this.fallback.geometry.dispose(); this.fallback.material.dispose(); this.fallback = null; }
    this._writeMatrices();
  }

  /** Posición/rumbo desde la ruta en s; actualiza caja de colisión y giro suavizado */
  _sync(car, dt, snap = false) {
    pathAt(car.route, car.s, _o, car.cursor);
    car.position.set(_o.x, 0, _o.z);
    car.x = _o.x; car.z = _o.z; car.hx = _o.hx; car.hz = _o.hz;
    const target = Math.atan2(_o.hz, -_o.hx); // el frente del modelo mira a -X local
    if (snap) car.yaw = target;
    else {
      let d = target - car.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      car.yaw += d * Math.min(1, dt * 12);
    }
    const ax = Math.abs(car.hx), az = Math.abs(car.hz);
    car.bhx = ax * CAR_LEN / 2 + az * CAR_W / 2;
    car.bhz = az * CAR_LEN / 2 + ax * CAR_W / 2;
    if (car.collider) { car.collider.x = car.x; car.collider.z = car.z; car.collider.hx = car.bhx; car.collider.hz = car.bhz; }
  }

  _respawn(car) {
    const routes = this.net.routes;
    for (let tries = 0; tries < 8; tries++) {
      const r = routes[(Math.random() * routes.length) | 0];
      let free = true;
      for (const o of this.cars) if (o !== car && o.route === r && o.s < 14) { free = false; break; }
      if (free || tries === 7) { car.route = r; break; }
    }
    car.s = 0; car.cursor.i = 0; car.commit = null; car.cruise = 6 + Math.random() * 2;
    car.v = car.cruise * 0.6; car.stuck = 0; car.ghost = 0;
    this._sync(car, 0, true);
  }

  /** @param px,pz,pr jugador; canHit false = invulnerable / en animación */
  update(dt, px = 0, pz = 0, pr = 0.4, canHit = false) {
    this.t += dt;
    const boxes = this.collisions ? this.collisions.boxes : [];
    beginTrafficFrame(boxes);
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (car.robbedT > 0) car.robbedT -= dt;
      if (car.state === 1) { // golpeó al jugador: frenazo y espera
        car.v = 0; car.timer -= dt;
        if (car.timer <= 0) car.state = 0;
      } else {
        let vmax = car.cruise;
        // 1) semáforos
        const vg = gateLimit(car.route.gates, this.t, car.s + CAR_LEN / 2, car.v, DEC, car);
        if (vg < vmax) vmax = vg;
        // 2) vehículo de adelante (cualquier caja móvil: autos y buses, salvo la propia). Se muestrean puntos de la
        // propia ruta por delante del parachoques (siguen las curvas) y se busca el primero que cae en una caja.
        let blocked = false;
        if (car.ghost <= 0) {
          const look = (car.v * car.v) / (2 * DEC) + 4;
          const hw = CAR_W / 2 - 0.15;
          const sFront = car.s + CAR_LEN / 2;
          outer:
          for (let ds = 1; ds <= look; ds += 1.5) {
            const sq = sFront + ds;
            if (sq > car.route.len) break;
            pathAt(car.route, sq, _o2, car.cur2);
            for (let j = 0; j < boxes.length; j++) {
              const b = boxes[j];
              if (b === car.collider || !b.enabled) continue;
              if (Math.abs(_o2.x - b.x) < b.hx + hw && Math.abs(_o2.z - b.z) < b.hz + hw) {
                const va = Math.sqrt(2 * DEC * Math.max(0, ds - 0.75 - GAP_MIN));
                if (va < vmax) vmax = va;
                blocked = true;
                break outer;
              }
            }
          }
        }
        // Anti-bloqueo: si lleva mucho parado por otro vehículo, lo ignora unos segundos
        if (car.ghost > 0) car.ghost -= dt;
        else if (blocked && car.v < 0.3) { car.stuck += dt; if (car.stuck > 30) { car.ghost = 3; car.stuck = 0; } }
        else car.stuck = 0;
        if (car.v < vmax) car.v = Math.min(vmax, car.v + ACC * dt);
        else car.v = Math.max(vmax, car.v - DEC * dt);
        car.s += car.v * dt;
        if (car.s >= car.route.len) this._respawn(car);
      }
      this._sync(car, dt);

      // Atropello: solo si va rápido; frena en seco como el bus
      if (canHit && car.v > HIT_SPEED && this.onHit) {
        const gx = car.x - px, gz = car.z - pz;
        if (Math.abs(gx) < car.bhx + pr + HIT_PAD && Math.abs(gz) < car.bhz + pr + HIT_PAD) {
          car.v = 0; car.state = 1; car.timer = HIT_STOP;
          this.onHit(car);
          canHit = false;
        }
      }
    }
    this._writeMatrices();
  }

  _writeMatrices() {
    if (this.fallback) {
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        _R.makeRotationY(c.yaw); _T.makeTranslation(c.x, 0, c.z);
        this.fallback.setMatrixAt(i, _M.copy(_T).multiply(_R));
      }
      this.fallback.instanceMatrix.needsUpdate = true;
    }
    for (let k = 0; k < 2; k++) {
      const im = this.meshes[k];
      if (!im) continue;
      const sc = this.scl[k], rel = this.rel[k];
      for (let i = 0; i < this.cars.length; i++) {
        const c = this.cars[i];
        if (c.model !== k) continue;
        _R.makeRotationY(c.yaw); _T.makeTranslation(c.x, 0, c.z); _S.makeScale(1, sc[0], sc[1]);
        im.setMatrixAt(c.slot, _M.copy(_T).multiply(_R).multiply(_S).multiply(rel));
      }
      im.instanceMatrix.needsUpdate = true;
    }
  }

  /** Reinicia el cooldown de robo de todos los autos */
  resetRob() { for (const c of this.cars) c.robbedT = 0; }

  dispose() {
    this._disposed = true;
    for (const c of this.cars) if (c.collider) this.collisions?.removeMovingBox(c.collider);
    this.cars = [];
    for (const im of [...this.meshes, this.fallback]) if (im) this.scene.remove(im);
    this.fallback?.geometry.dispose(); this.fallback?.material.dispose();
  }
}
