// src/world/props/Farol.js
import * as THREE from 'three';
import { COLORS } from '../../utils/constants.js';
import { loadModel, cloneModel } from '../../utils/ModelCache.js';

// ---- Luces: pool FIJO de SpotLights que se reubican en los faroles mas cercanos al jugador ----
// El numero de luces y de luces con sombra no cambia nunca (sin recompilar shaders): solo cambian
// posicion/intensidad. Spot hacia abajo = 1 pasada de sombra por luz (un PointLight serian 6).
const POOL_SIZE = 8;            // luces reales (el resto de faroles solo tiene bombilla emisiva)
const POOL_SHADOW = 3;          // de ellas, las que proyectan sombra (las 3 mas cercanas al jugador)
const LIGHT_COLOR = 0xffb866;   // calido
const LIGHT_INTENSITY = 4.8;    // antes 1.2 (x4)
const LIGHT_DISTANCE = 20;      // antes 8
const LIGHT_DECAY = 1.3;        // antes 2 (caida mas suave: alcanza la calzada)
const LIGHT_ANGLE = 1.25;       // semiapertura ~72 grados: disco de ~12 m en el suelo
const LIGHT_PENUMBRA = 0.65;
const SHADOW_MAP = 512;
const SHADOW_KEEP_RANK = 5;     // histeresis: una luz con sombra se mantiene mientras su farol este entre los 5 mas cercanos
const CAST_RANK = 12;           // postes de los N faroles mas cercanos proyectan sombra (53 postes = +60 draws por frame)
const POOL_RESELECT = 0.2;      // s entre re-evaluaciones de cercania
const POOL_FADE = 6;            // 1/s: velocidad del fundido al mover una luz a otro farol

// ---- Modelo GLB (lamparas.glb): poste en el origen, base en y=0, brazo hacia +X ----
const LAMP_HEIGHT = 4.2;     // similar al farol procedural (poste 4 m)
const LAMP_POLE_Z = -0.37;   // centro del poste en el GLB original (unidades del modelo)
let _lampPromise = null;
let _lampTip = null;         // { x, y }: punta del brazo (donde va la bombilla/luz), ya escalada

function getLampBase() {
  if (!_lampPromise) {
    _lampPromise = loadModel('lampara.glb', LAMP_HEIGHT, {
      fit: 'height', centerX: 0, centerZ: LAMP_POLE_Z
    }).then((base) => {
      if (!base) return null;
      // Material compartido: mate, sin mapas de metal/rugosidad/normal (menos VRAM y sin verse negro sin envmap)
      base.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false; // solo proyectan sombra los postes cercanos al jugador (Farol.setCasting, gestionado por el pool)
        const m = o.material;
        m.metalnessMap = null; m.roughnessMap = null; m.normalMap = null;
        m.metalness = 0.15; m.roughness = 0.85;
        m.needsUpdate = true;
      });
      const box = new THREE.Box3().setFromObject(base);
      // El brazo del GLB apunta a +Z; lo giramos a +X como el procedural
      _lampTip = { x: Math.max(0.6, box.max.z * 0.85), y: Math.max(3.0, box.max.y - 0.28) };
      return base;
    });
  }
  return _lampPromise;
}

// Recursos compartidos por todos los faroles
const _lampOn = new THREE.Color(COLORS.ACCENT_AMBER);
const _lampOff = new THREE.Color(0x2a2a30);
let _bulbMat = null;
let _bulbGeo = null;
let _metalMat = null;
let _boxGeo = null;
let _poleGeo = null;
let _lastLevel = -1;
let _level = 0;               // nivel 0..1 de luces artificiales (lo fija setNightLevel)
const _farols = [];           // faroles que pueden recibir una luz del pool
let _pool = null;

export class Farol {
  constructor(position, opts = {}) {
    this.group = new THREE.Group();
    this.group.position.copy(position);

    // Pivote orientable: dentro de el el brazo siempre apunta a +X; se gira para mirar a la calzada
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);
    if (opts.facing) this.setFacing(opts.facing.x, opts.facing.z);

    // Bombilla emisiva compartida (un solo material para todos: se enciende junta)
    if (!_bulbMat) {
      _bulbMat = new THREE.MeshBasicMaterial({ color: _lampOff.clone() });
      _bulbGeo = new THREE.SphereGeometry(0.13, 6, 4);
    }
    this.lampMat = _bulbMat;
    this._lampOn = _lampOn;
    this._lampOff = _lampOff;

    // Fallback procedural (visible mientras carga el GLB o si falla)
    this._proc = this._buildProcedural();
    this.pivot.add(this._proc);

    // Luz: ya no es propia; el pool (updateFarolLights) la presta al farol mas cercano al jugador.
    // _bulbWorld = posicion mundial de la bombilla (se recalcula al cargar el GLB o girar el farol)
    this._bulbLocal = new THREE.Vector3(0.6, 3.8, 0);
    this._bulbWorld = new THREE.Vector3();
    this._updateBulbWorld();
    if (opts.addLight !== false) _farols.push(this);

    getLampBase().then((base) => {
      if (!base || this._disposed) return; // sin GLB: queda el procedural
      const model = cloneModel(base);
      model.rotation.y = Math.PI / 2; // brazo +Z -> +X
      this.pivot.remove(this._proc);
      this._proc = null; // geometrías/materiales procedurales son compartidos: no se disponen
      this.pivot.add(model);
      this._poles = [];
      model.traverse((o) => { if (o.isMesh) this._poles.push(o); });
      if (this._casting) this.setCasting(true, true);
      const bulb = new THREE.Mesh(_bulbGeo, _bulbMat);
      bulb.position.set(_lampTip.x, _lampTip.y, 0);
      this.pivot.add(bulb);
      this._bulb = bulb;
      this._bulbLocal.set(_lampTip.x, _lampTip.y - 0.2, 0);
      this._updateBulbWorld();
    });
  }

  _buildProcedural() {
    if (!_metalMat) {
      _metalMat = new THREE.MeshLambertMaterial({ color: 0x2a2a30, flatShading: true });
      _poleGeo = new THREE.CylinderGeometry(0.06, 0.08, 4, 6);
      _boxGeo = new THREE.BoxGeometry(1, 1, 1);
    }
    const g = new THREE.Group();
    const pole = new THREE.Mesh(_poleGeo, _metalMat);
    pole.position.y = 2;
    this._poles = [pole];
    g.add(pole);
    const arm = new THREE.Mesh(_boxGeo, _metalMat);
    arm.scale.set(0.6, 0.08, 0.08);
    arm.position.set(0.3, 4, 0);
    g.add(arm);
    const lamp = new THREE.Mesh(_boxGeo, _bulbMat);
    lamp.scale.set(0.2, 0.15, 0.25);
    lamp.position.set(0.6, 3.9, 0);
    g.add(lamp);
    return g;
  }

  /** El poste solo proyecta sombra cuando el farol esta entre los mas cercanos al jugador (coste de las pasadas de sombra) */
  setCasting(on, force = false) {
    if (this._casting === on && !force) return;
    this._casting = on;
    if (this._poles) for (const m of this._poles) m.castShadow = on;
  }

  /** Gira el brazo/cabeza hacia la direccion (dx, dz) del mundo (hacia la calzada) */
  setFacing(dx, dz) {
    this.pivot.rotation.y = Math.atan2(-dz, dx); // +X local -> (dx, dz)
    if (this._bulbWorld) this._updateBulbWorld();
  }

  // El grupo del farol cuelga de un padre sin transformacion (grupo del distrito): world = pos + rotY(local)
  _updateBulbWorld() {
    const a = this.pivot.rotation.y, c = Math.cos(a), s = Math.sin(a), l = this._bulbLocal, p = this.group.position;
    this._bulbWorld.set(p.x + l.x * c + l.z * s, p.y + l.y, p.z - l.x * s + l.z * c);
  }

  /** Enciende/apaga gradualmente según nivel 0..1 (0 = apagado) */
  setNightLevel(level) {
    if (level !== _lastLevel) { // material compartido: se recalcula una sola vez por nivel
      _lastLevel = level;
      _bulbMat.color.copy(_lampOff).lerp(_lampOn, level);
    }
    _level = level; // el pool aplica la intensidad
  }

  dispose() {
    this._disposed = true;
    const i = _farols.indexOf(this);
    if (i >= 0) _farols.splice(i, 1);
    if (_farols.length === 0 && _pool) { _pool.dispose(); _pool = null; }
  }
}

// ===== Pool de luces =====
class FarolLightPool {
  constructor(parent) {
    this.parent = parent;
    this.slots = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const light = new THREE.SpotLight(LIGHT_COLOR, 0, LIGHT_DISTANCE, LIGHT_ANGLE, LIGHT_PENUMBRA, LIGHT_DECAY);
      light.visible = false;
      light.target.position.set(0, -1, 0); // hijo de la luz: siempre apunta recto hacia abajo
      light.add(light.target);
      if (i < POOL_SHADOW) {
        light.castShadow = true;
        light.shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
        light.shadow.camera.near = 0.6;     // la luz esta junto al poste/brazo
        light.shadow.bias = -0.0008;
        light.shadow.normalBias = 0.05;
      }
      parent.add(light);
      this.slots.push({ light, target: null, cur: null, fade: 0 });
    }
    this._rank = new Array(CAST_RANK).fill(null);
    this._rankD = new Float32Array(CAST_RANK);
    this._prev = new Array(CAST_RANK).fill(null);
    this._t = 99;
    this._lx = 1e9; this._lz = 1e9;
  }

  _reselect(px, pz) {
    const R = this._rank, RD = this._rankD, K = R.length;
    R.fill(null); RD.fill(Infinity);
    for (let i = 0; i < _farols.length; i++) {      // seleccion parcial: los K mas cercanos
      const f = _farols[i], b = f._bulbWorld;
      const dx = b.x - px, dz = b.z - pz, d = dx * dx + dz * dz;
      if (d >= RD[K - 1]) continue;
      let j = K - 1;
      while (j > 0 && RD[j - 1] > d) { RD[j] = RD[j - 1]; R[j] = R[j - 1]; j--; }
      RD[j] = d; R[j] = f;
    }
    // postes con sombra: solo los CAST_RANK mas cercanos
    for (let i = 0; i < K; i++) this._prev[i]?.setCasting(false);
    for (let i = 0; i < K; i++) { R[i]?.setCasting(true); this._prev[i] = R[i]; }
    const S = this.slots;
    // 1) liberar slots cuyo farol ya no es de los mas cercanos (con histeresis)
    for (let i = 0; i < S.length; i++) {
      const t = S[i].target;
      if (!t) continue;
      const r = R.indexOf(t);
      if (r < 0 || r >= (i < POOL_SHADOW ? SHADOW_KEEP_RANK : K)) S[i].target = null;
    }
    // 2) los POOL_SHADOW mas cercanos deben ocupar slots con sombra
    for (let r = 0; r < POOL_SHADOW; r++) {
      const f = R[r];
      if (!f) break;
      let have = false;
      for (let i = 0; i < POOL_SHADOW; i++) if (S[i].target === f) { have = true; break; }
      if (have) continue;
      for (let i = POOL_SHADOW; i < S.length; i++) if (S[i].target === f) S[i].target = null; // sale del slot sin sombra
      for (let i = 0; i < POOL_SHADOW; i++) if (!S[i].target) { S[i].target = f; break; }
    }
    // 3) el resto de cercanos, a slots sin sombra libres
    for (let r = 0; r < POOL_SIZE; r++) {
      const f = R[r];
      if (!f) break;
      let have = false;
      for (let i = 0; i < S.length; i++) if (S[i].target === f) { have = true; break; }
      if (have) continue;
      for (let i = POOL_SHADOW; i < S.length; i++) if (!S[i].target) { S[i].target = f; break; }
    }
  }

  update(px, pz, dt) {
    this._t += dt;
    const moved = Math.abs(px - this._lx) + Math.abs(pz - this._lz) > 1.5;
    if (this._t >= POOL_RESELECT && (moved || this._t > 1)) {
      this._t = 0; this._lx = px; this._lz = pz;
      this._reselect(px, pz);
    }
    const on = _level > 0.001;
    const S = this.slots;
    for (let i = 0; i < S.length; i++) {
      const s = S[i], L = s.light;
      if (L.visible !== on) L.visible = on; // dia: visible=false (sin coste de shader ni de sombra)
      if (!on) continue;
      // Fundido: si el slot cambia de farol, baja a 0, se mueve y vuelve a subir (sin saltos de luz)
      if (s.cur !== s.target) {
        s.fade -= dt * POOL_FADE;
        if (s.fade <= 0) {
          s.fade = 0; s.cur = s.target;
          if (s.cur) L.position.copy(s.cur._bulbWorld);
        }
      } else if (s.cur && s.fade < 1) {
        s.fade = Math.min(1, s.fade + dt * POOL_FADE);
      }
      L.intensity = LIGHT_INTENSITY * _level * (s.cur ? s.fade * s.fade * (3 - 2 * s.fade) : 0);
    }
  }

  dispose() {
    for (const s of this.slots) {
      this.parent.remove(s.light);
      s.light.dispose?.();
      s.light.shadow?.map?.dispose();
    }
    this.slots.length = 0;
  }
}

/** Llamar una vez por frame: reparte el pool de luces entre los faroles mas cercanos al jugador. */
export function updateFarolLights(playerPos, dt) {
  if (_farols.length === 0) return;
  if (!_pool) {
    const parent = _farols[0].group.parent;
    if (!parent) return; // aun no se ha montado el distrito
    _pool = new FarolLightPool(parent);
  }
  _pool.update(playerPos.x, playerPos.z, dt);
}
