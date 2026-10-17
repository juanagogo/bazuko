// src/entities/BusTM.js
// Buses articulados TransMilenio que circulan en bucle por los carriles exclusivos de las dos avenidas
// (H a lo largo de X, V a lo largo de Z). Cada bus = 1 clon del GLB (comparte geometría y material =>
// 1 draw call por bus). Respetan los semáforos de los cruces (líneas de pare antes de cada intersección).
import * as THREE from 'three';
import { loadModel, cloneModel } from '../utils/ModelCache.js';
import { getWorldClipPlanes } from '../utils/WorldClip.js';
import { gateLimit } from '../systems/TrafficNet.js';

const BUS_LEN = 19;        // largo (unidades de mundo) del articulado
const BUS_W = 3.4;         // ancho (carril TM = 4 u; margen 0.3 u a cada lado)
const BUS_H = 4.4;         // alto (el jugador mide 1.85)
const SPEED = 4;           // u/s crucero ("despacio"; menor que caminar 3 / correr 6 del jugador)
const ACC = 1.2;           // u/s2 aceleración suave
const DEC = 1.5;           // u/s2 frenado suave (parada desde crucero ~5.3 u)
const DEC_EMG = 4;         // u/s2 frenado firme (cuando la salida de la plaza no está despejada)
const DWELL_MIN = 4, DWELL_MAX = 6; // s detenido en cada estación
const MIN_GAP = BUS_LEN + 6;        // distancia mínima entre buses del mismo carril (centro a centro)
const HIT_SPEED = 1.0;     // solo atropella si va a más de esto (u/s)
const HIT_STOP = 3.5;      // s detenido tras atropellar
const HIT_PAD = 0.2;       // margen de contacto con el volumen del bus
// Estados del controlador por bus
const MOVE = 0, STOP = 1, HIT = 2;
const BUSES_PER_LANE = 2;
// Giro Y para que el frente del modelo apunte a +X (el GLB tiene su eje largo en X)
const MODEL_FRONT_YAW = Math.PI; // el frente del GLB mira a -X

let _basePromise = null;
function getBusBase() {
  if (!_basePromise) {
    _basePromise = loadModel('tm.glb', BUS_LEN).then((base) => {
      if (!base) return null;
      const box = new THREE.Box3().setFromObject(base);
      const size = box.getSize(new THREE.Vector3());
      const planes = getWorldClipPlanes();
      base.traverse((o) => {
        if (!o.isMesh) return;
        const m = o.material;
        // Sin envmap un material metálico se ve negro: mate, sin mapas de metal/rugosidad/normal
        m.metalnessMap = null; m.roughnessMap = null; m.normalMap = null;
        m.metalness = 0.1; m.roughness = 0.85;
        m.clippingPlanes = planes; m.clipShadows = true;
        m.needsUpdate = true;
      });
      return { base, size };
    });
  }
  return _basePromise;
}

export class TransMilenio {
  /**
   * @param avenues    [{ axis:'x'|'z', min, max, lanes:[{axis,c,dir}], stations:[{along}] }] (ZonaCero.avenues.all)
   * @param collisions CollisionSystem (cajas móviles)
   * @param net        red de tráfico (TrafficNet.buildTrafficNet): puertas de semáforo por carril
   */
  constructor(scene, avenues, collisions, net = null) {
    this.scene = scene;
    this.collisions = collisions;
    this.buses = [];
    this.lanes = [];
    this._disposed = false;
    this.BUS_LEN = BUS_LEN;
    const planes = getWorldClipPlanes();

    // Fallback (caja roja) hasta que cargue el GLB o si falla
    this._fbMat = new THREE.MeshLambertMaterial({
      color: 0xb3261e, flatShading: true, clippingPlanes: planes, clipShadows: true
    });
    this._fbGeo = new THREE.BoxGeometry(BUS_LEN, BUS_H, BUS_W);
    this.onHit = null; // (bus) => void: el bus golpeó al jugador

    let laneIdx = 0;
    for (const av of avenues) {
      // Recorrido: el bus sale entero del mundo antes de reaparecer por el otro extremo
      const A0 = av.min - BUS_LEN / 2, A1 = av.max + BUS_LEN / 2;
      const span = (av.max - av.min) + BUS_LEN;
      for (const lane of av.lanes) {
        const L = { ...lane, A0, A1, span };
        // Posición de parada (progreso s) de cada estación en este carril, de menor a mayor
        L.stops = (av.stations || [])
          .map((st) => (lane.dir > 0 ? st.along - A0 : A1 - st.along))
          .sort((a, b) => a - b);
        L.gates = net ? net.busGates(lane, A0, A1) : [];
        this.lanes.push(L);
        const li = laneIdx++;
        // Rumbo (unitario) y giro del grupo: el frente del modelo (ya girado MODEL_FRONT_YAW dentro) mira a +X local
        const hx = lane.axis === 'x' ? lane.dir : 0, hz = lane.axis === 'z' ? lane.dir : 0;
        for (let k = 0; k < BUSES_PER_LANE; k++) {
          const group = new THREE.Group();
          group.rotation.y = Math.atan2(-hz, hx);
          const fb = new THREE.Mesh(this._fbGeo, this._fbMat);
          fb.position.y = BUS_H / 2;
          fb.castShadow = true;
          group.add(fb);
          scene.add(group);
          const bhx = lane.axis === 'x' ? BUS_LEN / 2 : BUS_W / 2, bhz = lane.axis === 'x' ? BUS_W / 2 : BUS_LEN / 2;
          const collider = collisions?.addMovingBox(0, 0, bhx, bhz) ?? null;
          // Fase repartida: buses de un mismo carril separados, y carriles desfasados entre sí
          const s = ((k + 0.25 + li * 0.37) / BUSES_PER_LANE) % 1 * span;
          const bus = {
            group, fb, collider, lane: L, s, v: SPEED, state: MOVE, timer: 0, next: 0, stops: L.stops,
            hx, hz, bhx, bhz, commit: null, label: 'el Transmilenio', x: 0, z: 0
          };
          // Nunca nace con el cuerpo dentro (o cruzando) una intersección regulada, ni pegado al otro bus del
          // carril: busca la posición libre más cercana a la deseada
          const okS = (sv) => {
            for (const g of L.gates) if (sv + BUS_LEN / 2 > g.sEntry - 1 && sv - BUS_LEN / 2 < g.sExit + 1) return false;
            for (const o of this.buses) {
              if (o.lane !== L) continue;
              let dd = Math.abs(o.s - sv); dd = Math.min(dd, span - dd);
              if (dd < MIN_GAP) return false;
            }
            return true;
          };
          let s0 = bus.s;
          for (let dlt = 0; dlt < span / 2; dlt += 1) {
            const a = (s + dlt) % span, b2 = (s - dlt + span) % span;
            if (okS(a)) { s0 = a; break; }
            if (okS(b2)) { s0 = b2; break; }
          }
          bus.s = s0;
          // Primera parada pendiente: la primera estación que aún queda por delante
          while (bus.next < bus.stops.length && bus.stops[bus.next] < bus.s - 0.5) bus.next++;
          this._place(bus);
          this.buses.push(bus);
        }
      }
    }

    getBusBase().then((res) => {
      if (!res || this._disposed) return; // sin GLB: queda la caja roja
      for (const bus of this.buses) {
        const model = cloneModel(res.base); // comparte geometría y material
        const body = new THREE.Group();
        body.add(model);
        body.rotation.y = MODEL_FRONT_YAW;
        // Escala casi uniforme: largo = BUS_LEN (ya normalizado), alto y ancho a tamaño de bus real
        body.scale.set(1, BUS_H / res.size.y, BUS_W / res.size.z);
        bus.group.remove(bus.fb);
        bus.group.add(body);
        bus.fb = null;
      }
      this._fbGeo.dispose();
      this._fbMat.dispose();
    });
  }

  _place(bus) {
    const l = bus.lane;
    const a = l.dir > 0 ? l.A0 + bus.s : l.A1 - bus.s; // coordenada a lo largo del carril
    const x = l.axis === 'x' ? a : l.c, z = l.axis === 'x' ? l.c : a;
    bus.x = x; bus.z = z;
    bus.group.position.set(x, 0, z);
    if (bus.collider) { bus.collider.x = x; bus.collider.z = z; }
  }

  /**
   * Controlador por bus (sin allocations): crucero -> frena suave -> parada 4-6 s frente a la estación ->
   * acelera suave. Frena también si el bus de adelante está cerca/parado y ante la luz roja/ámbar de los cruces.
   * @param px,pz,pr posición y radio del jugador; canHit false = invulnerable; t = reloj global de semáforos
   */
  update(dt, px = 0, pz = 0, pr = 0.4, canHit = false, t = 0) {
    const buses = this.buses;
    for (let i = 0; i < buses.length; i++) {
      const bus = buses[i];
      const lane = bus.lane;
      if (bus.state === HIT) {
        bus.v = 0; bus.timer -= dt;
        if (bus.timer <= 0) bus.state = MOVE;
      } else if (bus.state === STOP) {
        bus.v = 0; bus.timer -= dt;
        if (bus.timer <= 0) { bus.state = MOVE; bus.next++; }
      }
      if (bus.state === MOVE) {
        let vmax = SPEED;
        const stops = bus.stops;
        if (bus.next < stops.length) {
          const raw = stops[bus.next] - bus.s;
          if (raw < -3) {
            bus.next++; // ya la pasó (p. ej. tras un atropello)
          } else {
            const d = raw > 0 ? raw : 0;
            const va = Math.sqrt(2 * DEC * d);
            if (va < vmax) vmax = va;
            if (d < 0.08 && bus.v < 0.5) { // llegó: alineado con la estación
              bus.s = stops[bus.next]; bus.v = 0; bus.state = STOP;
              bus.timer = DWELL_MIN + Math.random() * (DWELL_MAX - DWELL_MIN);
            }
          }
        }
        // Semáforos: frena antes de la línea de pare si la luz no está en verde
        if (lane.gates.length) {
          const sf = bus.s + BUS_LEN / 2;
          let vg = gateLimit(lane.gates, t, sf, bus.v, DEC, bus);
          let emg = false;
          // "No bloquear el cruce": antes de pasar la línea de pare, si el bus de adelante está detenido (estación)
          // y no queda espacio libre para todo el largo de este bus más allá de la salida, espera como si fuera rojo
          for (let k = 0; k < lane.gates.length; k++) {
            const g = lane.gates[k];
            if (g.sEntry < sf - 0.15) continue; // ya pasó la línea
            let ahead = null, gapC = Infinity;
            for (let j = 0; j < buses.length; j++) {
              const o = buses[j];
              if (o === bus || o.lane !== lane) continue;
              let gp = o.s - bus.s; if (gp < 0) gp += lane.span;
              if (gp < gapC) { gapC = gp; ahead = o; }
            }
            if (ahead && ahead.v < 0.5 && (gapC - BUS_LEN / 2) - (g.sExit - bus.s) < BUS_LEN + 1.2) {
              const d = g.sEntry - sf;
              const vb = Math.sqrt(2 * DEC_EMG * Math.max(0, d)) * 0.95; // frenada firme: no se cuela con el cuerpo en la plaza
              if (vb < vg) vg = vb;
              bus.commit = null;
              emg = true;
            }
            break; // solo la próxima puerta
          }
          if (vg < vmax) vmax = vg;
          bus._emg = emg;
        }
        // Distancia al bus de adelante en el mismo carril (progreso circular)
        for (let j = 0; j < buses.length; j++) {
          const o = buses[j];
          if (o === bus || o.lane !== lane) continue;
          let gap = o.s - bus.s;
          if (gap < 0) gap += lane.span;
          const g = gap - MIN_GAP;
          const va = Math.sqrt(2 * DEC * (g > 0 ? g : 0));
          if (va < vmax) vmax = va;
        }
        if (bus.state === MOVE) {
          if (bus.v < vmax) bus.v = Math.min(vmax, bus.v + ACC * dt);
          else bus.v = Math.max(vmax, bus.v - (bus._emg ? DEC_EMG : DEC * 1.2) * dt);
          bus.s += bus.v * dt;
          if (bus.s >= lane.span) { bus.s -= lane.span; bus.next = 0; bus.commit = null; } // bucle (wrap-around)
        }
      }
      this._place(bus);

      // Atropello: solo si va rápido (parado/estación = no daña; la colisión lo empuja fuera)
      if (canHit && bus.v > HIT_SPEED && this.onHit) {
        const gx = bus.x - px;
        const gz = bus.z - pz;
        if ((gx < 0 ? -gx : gx) < bus.bhx + pr + HIT_PAD && (gz < 0 ? -gz : gz) < bus.bhz + pr + HIT_PAD) {
          bus.v = 0; bus.state = HIT; bus.timer = HIT_STOP; // frenazo en seco
          this.onHit(bus);
          canHit = false;
        }
      }
    }
  }

  dispose() {
    this._disposed = true;
    for (const bus of this.buses) {
      this.scene.remove(bus.group);
      if (bus.collider) this.collisions?.removeMovingBox(bus.collider);
    }
    this.buses = [];
    this._fbGeo.dispose();
    this._fbMat.dispose();
  }
}
