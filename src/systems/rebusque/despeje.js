// src/systems/rebusque/despeje.js
// El despeje de la vía después del rebusque: el freno de cortesía de los carros que el artista todavía tiene enfrente
// cuando se pone el verde, la paciencia del conductor y, si no se quita, el paso atrás hasta el andén.
//
// Reglas (decisión del dueño):
//  - Desde 0,6 s antes de SU verde (el eje del carro, no el del trabajo), un carro quieto con el jugador en su nariz, su flanco o la banda junto al costado se
//    queda quieto (TrafficSystem.hold). Se suelta en cuanto el jugador sale de esas zonas (0,3 s de histéresis).
//  - Al verde el conductor le dice que se quite; a los 12 s pita un poco; a los 20 s el jugador da un paso atrás hasta el
//    andén, sin daño y con un aviso, y el carro se va. Ningún carro arranca encima del jugador por esto.
//  - Ningún sostenido se olvida: cada uno tiene tope (TOPE_S) y se suelta al cancelar, al liberar el sistema, si el jugador
//    queda aturdido, nada o maneja, y si el vehículo sale de la circulación. Nunca se suelta uno que no esté en la lista
//    propia ni el del conductor bravo (RoadRage lo sostiene para bajarse).
//  - Durante el rojo, los carros quietos cerca llevan `rebusqueTolera`: VehicleAudio no le pita al artista por estorbar.
//  - El paso atrás no se mete en el camino de nadie: el andén se busca por donde no viene un carro (o el bus) andando
//    dentro de lo que necesita para frenar, mejor del lado del carro sostenido que cruzando el carril contrario. Si en
//    el camino se atraviesa uno andando, el jugador espera; si sigue tapado, el paso se acaba y él vuelve a mandar.
// El rebusque solo usa `traffic.hold`: nunca escribe velocidad, ruta ni distancia, ni retira o mueve vehículos.
import { zonaDeCarro, localDe, faseDe, ejeDe, rumbo, CICLO_S, VERDE_S } from './semaforo.js';

/** Segundos desde que se le puso el verde al carro (negativo: le falta eso para el verde; Infinity sin reloj). */
export function desdeVerde(time, car) {
  if (!Number.isFinite(time)) return Infinity;
  const fase = faseDe(time, ejeDe(car));
  return fase < VERDE_S ? fase : fase - CICLO_S;
}

export const DESPEJE = Object.freeze({
  ANTES_S: .6,       // el freno empieza antes del verde: los carros tardan .18-.53 s en reaccionar
  VENTANA_S: 8,      // después del verde ya no se frena a nadie nuevo
  VOZ_S: 1.5,        // «¡Ya, que cambió el semáforo, quítese!»
  PITO_S: 12,        // pita un poco
  APARTAR_S: 20,     // paso atrás hasta el andén
  TOPE_S: 25,        // ningún carro queda sostenido más que esto
  HISTERESIS_S: .3,
  TOLERA_M: 12,
  FIN_S: 40          // la ventana se cierra sola, pase lo que pase
});
// El paso atrás: primero las manos en alto mirando al carro («ya, ya, me quito»), sin moverse; después camina de verdad
// hasta el andén, con las piernas al paso (Player.animateScripted, como al subirse a un carro). PLAYER_SPEED_WALK es 3 m/s.
const PASO_GESTO_S = .6;
const PASO_VEL_MIN = 1.4, PASO_VEL_MAX = 3, PASO_CAMINO_S = 2.2;
const ANDEN_MAX_M = 12;
const DIRECCIONES = 16;
// El tráfico que sigue andando: más rápido que ANDANDO va andando; frena a FRENADA (BRAKING de TrafficSystem) y mira
// adelante lo mismo que el tráfico (v²/2b + 0,8 v + 2 m). Tapado más que PASO_ESPERA_S, el paso se acaba.
const ANDANDO = .5, FRENADA = 2, MARGEN_M = .45, PASO_MIRA_M = .8, PASO_ESPERA_S = 1.5;
// Sumando todas las esperas (un carro que frena y arranca tapa y destapa a ratos), el paso tampoco pasa de esto.
const PASO_ESPERA_TOTAL_S = 3;
const LADO_OPUESTO_M = 4;    // el andén al otro lado del carro sostenido cuenta así de más lejos

const emitir = (name, detail) => globalThis.window?.dispatchEvent?.(new CustomEvent(name, { detail }));
const avisar = (text, type = 'info') => emitir('toast', { text, type });
// El carro que un conductor bravo tiene sostenido es suyo. `vehicle` queda para los dobles de las pruebas.
const sostieneRoadRage = (rage, v) => !!v && (rage?.holds ? rage.holds(v) : v === rage?.vehicle);

export class Despeje {
  constructor(game) {
    this.game = game;
    this.sostenidos = new Map(); // vehículo → { desde, fuera, verdeEn }
    this.tolerados = new Set();
    this.ventana = null;         // { verdeEn, voz, pito, apartado }
    this.paso = null;            // { desde, hasta, t, dur, mira, rumbo, nuevo, espera, esperado, k, car }: mientras dura, el despeje mueve al jugador
    this._t = 0;
    this._delta = { x: 0, y: 0, z: 0 };
    this._l = { a: 0, s: 0 };
    this._siguiente = { x: 0, z: 0 };
    this._andandoAhora = [];
    this.apartados = 0;          // veces que tocó quitarse (para las pruebas y el E2E)
  }

  get sostiene() { return this.sostenidos.size > 0; }
  get activo() { return !!this.ventana || this.sostiene || !!this.paso || this.tolerados.size > 0; }

  /** Empieza un trabajo en el rojo: el verde llega en `verdeEn` (reloj de los semáforos). */
  armar(verdeEn) {
    if (!Number.isFinite(verdeEn)) return;
    this.ventana = { verdeEn, voz: false, pito: false, apartado: false };
  }

  /** Los carros quietos alrededor no le pitan al artista mientras dura el rojo. */
  tolerar(pos) {
    for (const v of this.game.traffic?.vehicles ?? []) {
      if (v.police || (v.speed ?? 0) > .5 || !v.car?.position) continue;
      const dx = v.car.position.x - pos.x, dz = v.car.position.z - pos.z;
      if (dx * dx + dz * dz > DESPEJE.TOLERA_M * DESPEJE.TOLERA_M) continue;
      v.rebusqueTolera = true;
      this.tolerados.add(v);
    }
  }

  _soltar(v) {
    if (!this.sostenidos.delete(v)) return;
    // El del conductor bravo lo sigue sosteniendo RoadRage; los demás, de vuelta a su vida.
    if (!sostieneRoadRage(this.game.roadRage, v)) {
      if (this.game.traffic?.hold) this.game.traffic.hold(v.car, false);
      else v.hold = false;
    }
    v.rebusqueTolera = false;
    this.tolerados.delete(v);
  }

  /** Suelta todo lo propio y cierra la ventana. Lo llaman cancelar(), dispose() y los cortes del juego. */
  soltarTodo() {
    for (const v of [...this.sostenidos.keys()]) this._soltar(v);
    for (const v of this.tolerados) v.rebusqueTolera = false;
    this.tolerados.clear();
    this.ventana = null;
    this.paso = null;
  }

  _quitarTolerancia() {
    for (const v of this.tolerados) if (!this.sostenidos.has(v)) v.rebusqueTolera = false;
    for (const v of [...this.tolerados]) if (!this.sostenidos.has(v)) this.tolerados.delete(v);
  }

  update(dt) {
    if (!this.activo) return;
    this._t += dt;
    const game = this.game, traffic = game.traffic, player = game.player;
    if (!player?.position || player.isStunned || player.isRagdollActive || player.isSwimming || game.carjack?.driving) {
      this.soltarTodo();
      return;
    }
    const pos = player.position, vivos = traffic?.vehicles ?? [];
    const reloj = traffic?.signals?.time;
    const tVerde = this.ventana && Number.isFinite(reloj) ? reloj - this.ventana.verdeEn : Infinity;
    if (tVerde >= 0 && this.tolerados.size) this._quitarTolerancia();

    // Freno de cortesía: carros quietos con el jugador en su camino o pegado al costado, justo cuando les toca arrancar.
    if (this.ventana && tVerde < DESPEJE.FIN_S && traffic?.hold) {
      for (const v of vivos) {
        if (this.sostenidos.has(v) || v.hold || v.police || v.state !== 'patrol' || v.rejoinTarget || (v.speed ?? 0) >= .5) continue;
        const car = v.car;
        if (!car?.position || sostieneRoadRage(game.roadRage, v)) continue;
        const dx = car.position.x - pos.x, dz = car.position.z - pos.z, r = (car.length ?? 4.2) / 2 + 6;
        if (dx * dx + dz * dz > r * r || Math.abs((car.position.y ?? 0) - (pos.y ?? 0)) > 1.5) continue;
        const suyo = desdeVerde(reloj, car);
        if (suyo < -DESPEJE.ANTES_S || suyo >= DESPEJE.VENTANA_S || zonaDeCarro(car, pos) === 'fuera') continue;
        traffic.hold(car, true);
        v.rebusqueTolera = true;
        this.tolerados.add(v);
        this.sostenidos.set(v, { desde: this._t, fuera: 0, verdeEn: reloj - suyo });
      }
    }

    for (const [v, s] of this.sostenidos) {
      // Salió de la circulación (lo robaron, lo retiraron): no hay nada que soltar.
      if (!vivos.includes(v)) { this.sostenidos.delete(v); this.tolerados.delete(v); v.rebusqueTolera = false; continue; }
      // Lo tomó el conductor bravo: es suyo, no se suelta.
      if (sostieneRoadRage(game.roadRage, v)) { this.sostenidos.delete(v); this.tolerados.delete(v); v.rebusqueTolera = false; continue; }
      s.fuera = zonaDeCarro(v.car, pos) === 'fuera' ? s.fuera + dt : 0;
      if (s.fuera >= DESPEJE.HISTERESIS_S || this._t - s.desde >= DESPEJE.TOPE_S) this._soltar(v);
    }

    if (this.sostiene && this.ventana && !this.paso) this._paciencia(reloj);
    if (this.paso) this._dandoPaso(dt);
    if (this.ventana && !this.sostiene && !this.paso && (tVerde >= DESPEJE.VENTANA_S || tVerde > DESPEJE.FIN_S)) {
      this._quitarTolerancia();
      this.ventana = null;
    }
    if (this.ventana && tVerde > DESPEJE.FIN_S) this.soltarTodo();
  }

  _primero() { return this.sostenidos.keys().next().value ?? null; }

  /** El conductor espera, se impacienta y al final el jugador se quita. Cuenta desde el verde del primer sostenido. */
  _paciencia(reloj) {
    const w = this.ventana, v = this._primero(), game = this.game;
    if (!v) return;
    const tVerde = reloj - this.sostenidos.get(v).verdeEn;
    if (!w.voz && tVerde >= DESPEJE.VOZ_S) {
      w.voz = true;
      game.audio?.playDriverLine?.(v.car, 'semaforo_verde');
    }
    if (!w.pito && tVerde >= DESPEJE.PITO_S) {
      w.pito = true;
      emitir('car-honk', { x: v.car.position.x, z: v.car.position.z });
      const stats = game.stats;
      if (stats) stats.animo = Math.max(0, (stats.animo ?? 0) - 2);
      game.reputation?.sumar?.(-1);
      avisar('Me están pitando: el conductor no me va a esperar mucho más.', 'warn');
    }
    if (!w.apartado && tVerde >= DESPEJE.APARTAR_S) {
      w.apartado = true;
      this.apartados++;
      this._empezarPaso(v.car);
    }
  }

  /** ¿El segmento del jugador a `p` cruza algún vehículo (con el radio del jugador)? */
  _caminoLibre(pos, p, carros) {
    const dx = p.x - pos.x, dz = p.z - pos.z, largo = Math.hypot(dx, dz), pasos = Math.max(1, Math.ceil(largo / .3));
    const punto = this._delta;
    for (let i = 1; i <= pasos; i++) {
      punto.x = pos.x + dx * i / pasos; punto.z = pos.z + dz * i / pasos;
      for (const car of carros) {
        const { a, s } = localDe(car, punto, this._l);
        if (Math.abs(a) < (car.length ?? 4.2) / 2 + .45 && Math.abs(s) < (car.width ?? 1.8) / 2 + .45) return false;
      }
    }
    return true;
  }

  /**
   * Los vehículos que siguen andando (no los sostenidos): carros, motos y el bus. Cada uno con su caja hacia adelante,
   * de la cola hasta lo que necesita para frenar más `extra`, en sus coordenadas: `{ car, h, a0, a1, s }`.
   */
  _andando(pos, extra = 0, out = []) {
    out.length = 0;
    const traffic = this.game.traffic;
    const meter = (car, speed, h) => {
      if (!car?.position || !(speed > ANDANDO)) return;
      const L = car.length ?? 4.2, frena = speed * speed / (2 * FRENADA) + speed * .8 + 2 + extra;
      if (Math.hypot(car.position.x - pos.x, car.position.z - pos.z) > ANDEN_MAX_M + L + frena) return;
      out.push({ car, h, a0: -L / 2 - MARGEN_M, a1: L / 2 + MARGEN_M + frena, s: (car.width ?? 1.8) / 2 + MARGEN_M });
    };
    for (const v of traffic?.vehicles ?? []) if (!v.hold && !this.sostenidos.has(v)) meter(v.car, v.speed, null);
    // El bus trae su rumbo en `heading`.
    for (const b of traffic?.busVehicles ?? []) meter(b.car, b.car?.speed, b.car?.heading ?? b.heading ?? null);
    return out;
  }

  /** ¿El punto queda en el camino de alguno de los que van andando? */
  _tapado(p, andando) {
    for (const { car, h: dado, a0, a1, s } of andando) {
      const h = dado ?? rumbo(car), dx = p.x - car.position.x, dz = p.z - car.position.z;
      const a = dx * h.x + dz * h.z;
      if (a > a0 && a < a1 && Math.abs(dx * -h.z + dz * h.x) < s) return true;
    }
    return false;
  }

  /** ¿El segmento del jugador a `p` atraviesa el camino de alguno de los que van andando? */
  _cruzaAndando(pos, p, andando) {
    if (!andando.length) return false;
    const dx = p.x - pos.x, dz = p.z - pos.z, pasos = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .3));
    const punto = this._delta;
    for (let i = 1; i <= pasos; i++) {
      punto.x = pos.x + dx * i / pasos; punto.z = pos.z + dz * i / pasos;
      if (this._tapado(punto, andando)) return true;
    }
    return false;
  }

  /**
   * El andén más cercano al que se llega derecho sin atravesar un carro ni el camino de uno que viene andando. El del
   * otro lado del carro sostenido `car` (cruzando el carril contrario) cuenta LADO_OPUESTO_M más lejos.
   */
  buscarAnden(pos, car = null) {
    const tipo = this.game.world?.active?.getGroundTypeAt?.bind(this.game.world.active);
    if (!tipo) return null;
    const carros = [];
    for (const v of this.game.traffic?.vehicles ?? []) {
      const c = v.car?.position;
      if (c && Math.hypot(c.x - pos.x, c.z - pos.z) < ANDEN_MAX_M + 6) carros.push(v.car);
    }
    for (const car of this.game.cars ?? []) if (car?.position && Math.hypot(car.position.x - pos.x, car.position.z - pos.z) < ANDEN_MAX_M + 6) carros.push(car);
    // Lo que avanza el que viene mientras dura el paso: se le alarga el camino lo que mide el paso más largo.
    const andando = this._andando(pos, ANDEN_MAX_M);
    const p = { x: 0, z: 0 };
    let mejor = null, costo = Infinity;
    for (let r = .5; r <= ANDEN_MAX_M && r < costo; r += .5) {
      for (let i = 0; i < DIRECCIONES; i++) {
        const ang = i / DIRECCIONES * Math.PI * 2;
        p.x = pos.x + Math.cos(ang) * r; p.z = pos.z + Math.sin(ang) * r;
        // `s` negativo: a la izquierda del carro, del otro lado de su carril (en Bogotá se anda por la derecha).
        const c = r + (car?.position && localDe(car, p, this._l).s < -(car.width ?? 1.8) / 2 ? LADO_OPUESTO_M : 0);
        if (c >= costo || tipo(p.x, p.z) !== 'sidewalk' || !this._caminoLibre(pos, p, carros) || this._cruzaAndando(pos, p, andando)) continue;
        mejor = { x: p.x, z: p.z };
        costo = c;
      }
    }
    return mejor;
  }

  _empezarPaso(car) {
    const player = this.game.player, pos = player.position;
    const hasta = this.buscarAnden(pos, car);
    if (!hasta) {
      // Sin andén a la vista no se arrastra a nadie: se sueltan los carros y el tráfico cede como siempre. El aviso no
      // dice que se quitó, porque sigue ahí.
      avisar('El man ya arranca: me toca quitarme de la vía.', 'warn');
      for (const v of [...this.sostenidos.keys()]) this._soltar(v);
      return;
    }
    const largo = Math.hypot(hasta.x - pos.x, hasta.z - pos.z);
    const vel = Math.min(PASO_VEL_MAX, Math.max(PASO_VEL_MIN, largo / PASO_CAMINO_S));
    // `nuevo`: en este cuadro Player.update ya animó el cuerpo; el paso empieza en el siguiente.
    this.paso = { desde: { x: pos.x, z: pos.z }, hasta, t: 0, dur: largo / vel, mira: { x: car.position.x, z: car.position.z },
      rumbo: Math.atan2(hasta.x - pos.x, hasta.z - pos.z), nuevo: true, espera: 0, esperado: 0, k: 0, car };
  }

  /** Se acaba el paso y Player.update vuelve a mandar. El aviso cuenta lo que de verdad pasó. */
  _terminarPaso() {
    const paso = this.paso, pos = this.game.player.position;
    this.paso = null;
    const movido = Math.hypot(pos.x - paso.desde.x, pos.z - paso.desde.z);
    const largo = Math.hypot(paso.hasta.x - paso.desde.x, paso.hasta.z - paso.desde.z);
    if (movido >= .5 && movido >= largo - .3) avisar('Me hice para atrás hasta el andén: el man ya iba a arrancar.', 'warn');
    // Un trecho que todavía lo deja frente a la trompa no es quitarse de adelante.
    else if (movido >= .5 && !(paso.car?.position && zonaDeCarro(paso.car, pos) === 'nariz')) avisar('Me quité de adelante: el man ya iba a arrancar.', 'warn');
    else avisar('El man ya arranca: me toca quitarme de la vía.', 'warn');
  }

  /**
   * Mientras hay paso, Game no llama a Player.update (RebusqueSystem.controlaJugador): el despeje mueve al jugador, lo
   * apoya en el suelo y anima el cuerpo una sola vez por cuadro con la velocidad que de verdad lleva.
   */
  _dandoPaso(dt) {
    const paso = this.paso, game = this.game, player = game.player, pos = player.position;
    if (paso.nuevo) { paso.nuevo = false; return; }
    if (!(dt > 0)) return;
    paso.t += dt;
    player.velocity?.set?.(0, 0, 0);
    if (paso.t < PASO_GESTO_S) {
      this._animar(dt, 0, 'apartarse', paso.t / PASO_GESTO_S, Math.atan2(paso.mira.x - pos.x, paso.mira.z - pos.z));
      return;
    }
    const k = paso.dur > 0 ? Math.min(1, paso.k + dt / paso.dur) : 1;
    // Un carro (o el bus) andando tapa lo que sigue: espera quieto; si no se quita, el paso se acaba aquí.
    const largo = Math.hypot(paso.hasta.x - paso.desde.x, paso.hasta.z - paso.desde.z);
    const sig = this._siguiente, ks = largo > 0 ? Math.min(1, k + PASO_MIRA_M / largo) : 1;
    sig.x = paso.desde.x + (paso.hasta.x - paso.desde.x) * ks; sig.z = paso.desde.z + (paso.hasta.z - paso.desde.z) * ks;
    const andando = this._andando(pos, 0, this._andandoAhora);
    if (this._cruzaAndando(pos, sig, andando)) {
      paso.espera += dt;
      paso.esperado += dt;
      if (paso.espera >= PASO_ESPERA_S || paso.esperado >= PASO_ESPERA_TOTAL_S) { this._terminarPaso(); return; }
      this._animar(dt, 0, null, 0, paso.rumbo);
      return;
    }
    paso.espera = 0;
    paso.k = k;
    const x0 = pos.x, z0 = pos.z, d = this._delta;
    d.x = paso.desde.x + (paso.hasta.x - paso.desde.x) * k - pos.x;
    d.y = 0;
    d.z = paso.desde.z + (paso.hasta.z - paso.desde.z) * k - pos.z;
    if (game.collisions?.resolveMove) game.collisions.resolveMove(pos, d, player.radius ?? .4, pos);
    else { pos.x += d.x; pos.z += d.z; }
    this._apoyar(pos);
    this._animar(dt, Math.hypot(pos.x - x0, pos.z - z0) / dt, null, 0, paso.rumbo);
    if (k >= 1) this._terminarPaso();
  }

  _animar(dt, speed, action, actionProgress, yaw) {
    const player = this.game.player;
    player.animateScripted?.(dt, { speed, action, actionProgress, yaw });
    player.root?.position?.copy?.(player.position);
  }

  /** Los pies en el suelo del sitio (el andén está un poco más alto que la calzada). */
  _apoyar(pos) {
    const player = this.game.player, district = this.game.world?.active;
    const s = district?.getPlayerGroundSurface?.(pos.x, pos.z, { from: pos, grounded: true, surface: player.groundSurface ?? null });
    const h = typeof s === 'number' ? s : s?.height ?? district?.getGroundHeight?.(pos.x, pos.z);
    if (!Number.isFinite(h)) return;
    pos.y = h;
    if (s && typeof s === 'object') player.groundSurface = s;
  }
}
