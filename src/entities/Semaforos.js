// src/entities/Semaforos.js
// Semáforos (semaforo.glb) en cada intersección semaforizada: un poste por acceso, en la esquina de andén de
// la derecha del conductor, de cara al tráfico que lo obedece. Todo instanciado:
//   - postes: 1 InstancedMesh (comparte geometría/material del GLB)
//   - luces: 1 InstancedMesh de discos (3 por semáforo) con color por instancia: las 3 luces pintadas en la textura
//     se tapan con discos oscuros y la activa se enciende (MeshBasicMaterial sin tone mapping, sin PointLights)
//   - líneas de pare: 1 InstancedMesh de franjas blancas (carriles TM y normales)
// Las luces dependen del eje (0 = viaja en X, 1 = viaja en Z): hay solo 2 estados globales que se reevalúan
// cada frame y se reescriben en el InstancedMesh únicamente cuando cambian.
import * as THREE from 'three';
import { loadModel } from '../utils/ModelCache.js';
import { signalState, GREEN, AMBER, STOP_LINE_OFFSET, TIMING_STREET, TIMING_PLAZA } from '../systems/TrafficNet.js';

const SEM_HEIGHT = 4.3;       // alto del poste (el jugador mide 1.85)
const POLE_R = 0.25;          // colisión circular del poste
const CORNER = 0.2;           // distancia del poste al borde de la intersección (sobre el andén)
// Luces en el modelo normalizado (alto = SEM_HEIGHT): fracciones de la altura de la cabeza (rojo arriba)
const LAMP_FRAC = [0.69, 0.436, 0.17]; // calibradas contra las luces pintadas en la textura
const LAMP_R = 0.3;
const ACTIVE = [new THREE.Color(0xff2a2a), new THREE.Color(0xffb000), new THREE.Color(0x2bff6b)];
const OFF = new THREE.Color(0x141414);

export class Semaforos {
  /**
   * @param net        TrafficNet (nodes, routes)
   * @param busLanes   carriles de buses con .gates (TransMilenio.lanes)
   */
  constructor(scene, net, busLanes, collisions) {
    this.scene = scene;
    this.collisions = collisions;
    this.group = new THREE.Group();
    scene.add(this.group);
    this._disposed = false;
    this._last = [-1, -1, -1, -1];
    this.level = 0; // 0 = día, 1 = noche

    // ----- Accesos (nodo + sentido) únicos -----
    const approaches = new Map(); // clave -> { node, hx, hz, axis, px, pz }
    const addGate = (g) => {
      const key = g.node.id + ':' + g.hx + ':' + g.hz + ':' + (g.axis === 0 ? Math.round(g.pz) : Math.round(g.px));
      if (!approaches.has(key)) approaches.set(key, g);
    };
    const addReg = (g) => { if (!g.node.yield) addGate(g); }; // los cruces con ceda el paso no llevan semáforo
    for (const r of net.routes) r.gates.forEach(addReg);
    for (const l of busLanes) l.gates.forEach(addReg);
    this.approaches = [...approaches.values()];

    // Un poste por (nodo, sentido)
    const poles = new Map();
    for (const g of this.approaches) {
      const k = g.node.id + ':' + g.hx + ':' + g.hz;
      if (!poles.has(k)) poles.set(k, g);
    }
    this.poles = [...poles.values()].map((g) => {
      const b = g.node;
      let x, z;
      if (g.hx > 0) { x = b.x0 - CORNER; z = b.z1 + CORNER; }
      else if (g.hx < 0) { x = b.x1 + CORNER; z = b.z0 - CORNER; }
      else if (g.hz > 0) { x = b.x0 - CORNER; z = b.z0 - CORNER; }
      else { x = b.x1 + CORNER; z = b.z1 + CORNER; }
      return { x, z, hx: g.hx, hz: g.hz, axis: g.axis, node: b };
    });

    // ----- Líneas de pare (siempre, incluso sin GLB) -----
    this._buildStopLines(approaches);
    for (const p of this.poles) collisions?.addCircle(p.x, p.z, POLE_R);

    this._buildLamps(); // discos (se ven aunque el GLB no haya cargado)
    loadModel('semaforo.glb', SEM_HEIGHT).then((base) => {
      if (!base || this._disposed) return;
      this._buildPoles(base);
    });
  }

  _buildStopLines(approaches) {
    const mats = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const seen = new Set();
    for (const g of approaches.values()) {
      const b = g.node;
      const kind = b.kind;
      const w = kind === 'ss' ? 2 : kind === 'plaza' ? 4 : (kind === 'ha' ? (g.axis === 0 ? 4 : 2) : (g.axis === 1 ? 4 : 2));
      let x, z;
      if (g.axis === 0) { z = g.pz; x = g.hx > 0 ? b.x0 - STOP_LINE_OFFSET : b.x1 + STOP_LINE_OFFSET; }
      else { x = g.px; z = g.hz > 0 ? b.z0 - STOP_LINE_OFFSET : b.z1 + STOP_LINE_OFFSET; }
      const key = Math.round(x * 2) + ':' + Math.round(z * 2) + ':' + g.axis;
      if (seen.has(key)) continue;
      seen.add(key);
      // Franja de 0.35 u de grosor y (w - 0.3) de ancho, perpendicular al sentido de marcha
      q.setFromEuler(e.set(0, g.axis === 0 ? 0 : Math.PI / 2, 0));
      s.set(1, 1, w - 0.3);
      p.set(x, 0.065, z);
      mats.push(new THREE.Matrix4().compose(p, q, s));
    }
    const mat = new THREE.MeshLambertMaterial({ color: 0xe8e8e0, flatShading: true });
    const geo = new THREE.BoxGeometry(0.35, 0.02, 1);
    const im = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.instanceMatrix.needsUpdate = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    this.group.add(im);
    this.stopLines = im;
  }

  // Parámetros del modelo (se calculan al cargar): posición del poste y de la cara de la cabeza (base normalizada)
  _buildPoles(base) {
    base.updateMatrixWorld(true);
    let mesh = null;
    base.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
    if (!mesh) return;
    const rel = mesh.matrixWorld.clone();
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    let sx = 0, sz = 0, cnt = 0, hy0 = Infinity, hy1 = -Infinity, faceX = Infinity, headZ0 = Infinity, headZ1 = -Infinity;
    const lowY = SEM_HEIGHT * 0.04, headY = SEM_HEIGHT * 0.4;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel);
      if (v.y < lowY) { sx += v.x; sz += v.z; cnt++; }
      if (v.y > headY) { hy0 = Math.min(hy0, v.y); hy1 = Math.max(hy1, v.y); faceX = Math.min(faceX, v.x); headZ0 = Math.min(headZ0, v.z); headZ1 = Math.max(headZ1, v.z); }
    }
    // Poste = centro de la base; la cara de las luces mira a -X local
    this.model = { poleX: cnt ? sx / cnt : 0, poleZ: cnt ? sz / cnt : 0, faceX, hy0, hy1, zc: (headZ0 + headZ1) / 2 };

    // Material: mate (sin envmap un metal se ve negro)
    const m = mesh.material;
    m.metalnessMap = null; m.roughnessMap = null; m.normalMap = null;
    m.metalness = 0.1; m.roughness = 0.8; m.needsUpdate = true;

    const im = new THREE.InstancedMesh(mesh.geometry, m, this.poles.length);
    const M = new THREE.Matrix4(), R = new THREE.Matrix4(), T = new THREE.Matrix4();
    this.poles.forEach((p, i) => {
      const th = Math.atan2(-p.hz, p.hx); // la cara (-X local) mira al conductor (-rumbo)
      p.th = th;
      const c = Math.cos(th), s = Math.sin(th);
      // origen del modelo = poste en la esquina: P - R * (poleX, poleZ)
      const ox = p.x - (this.model.poleX * c + this.model.poleZ * s);
      const oz = p.z - (-this.model.poleX * s + this.model.poleZ * c);
      p.ox = ox; p.oz = oz;
      R.makeRotationY(th);
      T.makeTranslation(ox, 0, oz);
      M.copy(T).multiply(R).multiply(rel);
      im.setMatrixAt(i, M);
    });
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true;
    im.frustumCulled = false;
    this.group.add(im);
    this.poleMesh = im;
    this._placeLamps();
  }

  _buildLamps() {
    const n = this.poles.length * 3;
    const geo = new THREE.CircleGeometry(LAMP_R, 14);
    const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.lamps = new THREE.InstancedMesh(geo, mat, n);
    this.lamps.frustumCulled = false;
    this.lamps.visible = false; // hasta que el modelo esté cargado (se necesita la posición de la cabeza)
    const c = new THREE.Color(0, 0, 0);
    for (let i = 0; i < n; i++) this.lamps.setColorAt(i, c);
    this.group.add(this.lamps);
  }

  _placeLamps() {
    const md = this.model;
    const M = new THREE.Matrix4(), R = new THREE.Matrix4();
    const hh = md.hy1 - md.hy0;
    this.poles.forEach((p, i) => {
      const c = Math.cos(p.th), s = Math.sin(p.th);
      const phi = Math.atan2(-c, s); // normal del disco (+Z local) -> cara del semáforo (-X local girada)
      for (let k = 0; k < 3; k++) {
        const lx = md.faceX - 0.03, ly = md.hy0 + hh * LAMP_FRAC[k], lz = md.zc + 0.05;
        const wx = p.ox + lx * c + lz * s, wz = p.oz - lx * s + lz * c;
        R.makeRotationY(phi).setPosition(wx, ly, wz);
        M.copy(R);
        this.lamps.setMatrixAt(i * 3 + k, M);
      }
    });
    this.lamps.instanceMatrix.needsUpdate = true;
    this.lamps.visible = true;
    this._last = [-1, -1, -1, -1];
  }

  /** Nivel de luz artificial 0..1 (día suave, noche a pleno) */
  setNightLevel(level) {
    this.level = level;
    this._last = [-1, -1, -1, -1]; // fuerza reescritura de colores
  }

  update(t) {
    if (!this.lamps || !this.lamps.visible) return;
    // 4 estados globales: [calle eje0, calle eje1, plaza eje0, plaza eje1]
    const st = [signalState(t, 0, TIMING_STREET), signalState(t, 1, TIMING_STREET), signalState(t, 0, TIMING_PLAZA), signalState(t, 1, TIMING_PLAZA)];
    const l = this._last;
    if (st[0] === l[0] && st[1] === l[1] && st[2] === l[2] && st[3] === l[3]) return;
    for (let i = 0; i < 4; i++) l[i] = st[i];
    const k = 0.7 + 0.3 * this.level;
    const col = new THREE.Color();
    this.poles.forEach((p, i) => {
      const s = st[(p.node.kind === 'plaza' ? 2 : 0) + p.axis]; // 0 verde, 1 ámbar, 2 rojo
      // lámparas: 0 = rojo, 1 = ámbar, 2 = verde
      const on = s === GREEN ? 2 : s === AMBER ? 1 : 0;
      for (let q = 0; q < 3; q++) {
        if (q === on) col.copy(ACTIVE[q]).multiplyScalar(k); else col.copy(OFF);
        this.lamps.setColorAt(i * 3 + q, col);
      }
    });
    this.lamps.instanceColor.needsUpdate = true;
  }

  dispose() {
    this._disposed = true;
    this.scene.remove(this.group);
    this.stopLines?.geometry.dispose(); this.stopLines?.material.dispose();
    this.lamps?.geometry.dispose(); this.lamps?.material.dispose();
  }
}
