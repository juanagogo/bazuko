// src/features/stealReactions.js
// La coreografía del robo: lo que hace el cuerpo del jugador (arrimarse, meter la mano, sacar y guardar,
// disimular, quedar pillado, el raponazo) y lo que hace la víctima (sobresaltarse, quedarse helada,
// mirar, palparse el bolsillo cuando ya es tarde). La pose del jugador va en `player.stealPose`, que
// Player le pasa al cuerpo como `hurto` (ver character/hurto.js); la de la víctima va en
// `npc.poseParams.hurto`, y la quietud en `npc.scriptedHold`, que Npc.update llama cada cuadro.
// La víctima se suelta sola: su temporizador corre dentro de Npc.update, no aquí.
import { Box3, Vector3 } from 'three';
import { HURTO, CONTACTO_RAPONAZO, GUARDA_RAPONAZO, terminada, muestraDeHurto, nuevaMuestra } from '../character/hurto.js';
import { LOW_STANCES } from '../character/archetypes.js';
import { hasClearCombatLine } from '../systems/CombatGeometry.js';
import { NPC_VOICE_BANK } from '../data/npcVoices.js';
import { decirFrase, vozOcupada } from '../systems/voces/hablar.js';
import { vocalizarFaltante } from '../systems/voces/Vocalizador.js';
import { ROBO_ODDS } from './stealOdds.js';
import { BolsoArrancado } from './bolsoArrancado.js';

const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
const any = list => list[Math.floor(Math.random() * list.length)];

/**
 * Dónde está el bolsillo. Con el modelo completo cargado se mide desde la cadera de verdad (hueso Hips),
 * así el sentado o el que está en el piso tiene el bolsillo donde lo tiene; sin él, en fracción de la
 * estatura del modelo (1,08 × talla). `fondo`: cuánto sale del centro hacia el jugador.
 */
const CUERPO = { bolsillo: 1.0, escala: 1.08, cadera: .06, fondo: .13, fondoTiron: .16, aLaMano: .08,
  // Agacharse: con el bolsillo a menos de `comodo` del piso del jugador dobla rodillas y espalda; del todo a `comodo - rango`.
  comodo: 1.05, rango: .45 };
/** Arrimarse: a qué distancia del centro de la víctima queda el jugador, y lo que se deja encimar. */
const ARRIMO = { cosquilleo: .52, raponazo: .62, recular: .95, radioVictima: .1, paso: 1.6, estiron: 4.2, reculada: 1.1,
  // Si la víctima va andando, el jugador la sigue con la mano adentro; si se le despega, se le fue.
  seFue: 1.25, alcanzar: .8, ganancia: 9, ritmoMax: 3, agachado: .12 };
/** Lo que se le arranca en un raponazo, y a qué altura del objeto (0 abajo, 1 arriba) va la mano. */
const BOLSAS = [['bolso', .2], ['bolsa', .75], ['maletin', .8]];
const NOMBRES_DE_BOLSA = new Map(BOLSAS.map(([id, alto]) => [`prop-${id}`, alto]));
/** Lo que cada quien lleva en una mano: con esa mano no se cubre ni se palpa. */
const EN_LA_MANO = { maletin: 'izquierda', bolsa: 'izquierda', 'baston-calle': 'derecha' };
/** Fases del jugador que el que se va corriendo corta de una. */
const SE_CORTAN_CORRIENDO = new Set(['sacar', 'disimular', 'pillado']);
const _caja = new Box3();

/** Lo que se dice sin grabación: al descubrir el robo y, sin frase que cuadre, al pillar. */
const SIN_GRABAR = {
  descubre: ['¿Y mi billetera?', '¿Dónde está mi plata?', '¡Me robaron!'],
  pillado: ['¡Quieto! ¿Qué hace?', '¡Ey! ¡La mano!'],
  raponazo: ['¡Ladrón!', '¡Me robaron!'],
  'raponazo-sin-bolso': ['¡Ladrón!', '¡Me robaron!'],
  'raponazo-fallido': ['¡Ey! ¿Qué le pasa?', '¡Ladrón!']
};

// Qué grabaciones de «robado» cuadran con cada robo. Pillado con la mano adentro todavía no se llevó
// nada: no dice «me robó el celular». Descubierto tarde ya no le agarra la mano: no dice «suelte eso»; y el
// cosquilleo va al bolsillo, así que tampoco «mi bolso». El tirón que no se llevó un bolso (fue al bolsillo, a
// la bolsa del mercado o al maletín) no nombra el bolso; el que agarró puro aire no se llevó nada ni la tocó.
const NO_CUADRA = {
  pillado: /me robó|mi bolso|devuélvamelo/i,
  descubre: /quite la mano|suelte|suélteme|me va a robar|me están robando|bolso/i,
  raponazo: /quite la mano/i,
  'raponazo-sin-bolso': /quite la mano|bolso/i,
  'raponazo-fallido': /me robó|bolso|devuélvamelo|quite la mano|suelte|suélteme/i
};

/** El tipo de robo de un tirón que llegó: solo un bolso de verdad deja que la víctima diga «mi bolso». */
export function tipoDeTiron(bolsa) {
  return bolsa === 'bolso' ? 'raponazo' : 'raponazo-sin-bolso';
}

export class CoreografiaDeHurto {
  constructor(game) {
    this.game = game;
    this.ajustes = structuredClone(ROBO_ODDS);
    this._pose = { fase: null, t: 0, lado: 1, hondura: 0, agachar: 0, objetivo: null, velocidad: 1, desde: null };
    this._desdes = [nuevaMuestra(), nuevaMuestra()]; // de dónde sale la fase nueva: dos, para no leer y escribir el mismo
    this._objetivo = new Vector3();
    this._paso = new Vector3();
    // El paso de la víctima, para seguirla con la mano adentro.
    this._antes = new Vector3();
    this._ritmo = new Vector3();
    this._seguida = null;
    // Los huesos y la bolsa de la víctima: se buscan una vez por robo, no cada cuadro.
    this._cuerpo = { npc: null, modelo: null, cadera: null, bolsa: null, bolsaLocal: new Vector3() };
    this._punto = new Vector3();
    this._centro = new Vector3(); // de dónde se mide el arrimo: la cadera si la hay (el sentado no está sobre sus pies)
    this._hondura = 0;
    this._victima = null;
    this._alContacto = null;
    this._contacto = false;
    this._arrimada = null; // la víctima a la que se le bajó el radio para dejar arrimarse
    this._arrimoLibre = false; // ya no hace falta: se le devuelve cuando el jugador se aparte
    this._arrimoT = 0;
    this._descubrimientos = [];
    this._retenidas = new Set(); // víctimas quietas por el robo
    this.bolso = new BolsoArrancado(); // lo que se llevó el raponazo, en la mano hasta guardarlo
  }

  get fase() { return this.game.player?.stealPose?.fase ?? null; }

  /**
   * Empieza una fase del jugador. `victima` da el bolsillo (o el bolso) al que va la mano; sin ella la
   * pose es la fija de hurto.js. `alContacto` se llama una vez, cuando el raponazo llega al bolso.
   */
  jugador(fase, lado = this._pose.lado, { alContacto = null, victima = undefined } = {}) {
    const player = this.game.player;
    if (!player) return null;
    if (victima !== undefined) this._victima = victima;
    const p = this._pose;
    if (player.stealPose === p && p.fase) {
      const desde = this._desdes[p.desde === this._desdes[0] ? 1 : 0];
      p.desde = muestraDeHurto(p, desde);
    } else p.desde = null;
    p.fase = fase; p.t = 0; p.lado = lado < 0 ? -1 : 1;
    if (fase === 'meter') { p.hondura = 0; this._hondura = 0; }
    if (fase === 'meter' || fase === 'raponazo') { p.agachar = 0; this._seguida = null; }
    // El tirón va a la mano del lado del bolso.
    if (fase === 'raponazo' && this._victima) p.lado = this._ladoDeLaBolsa(this._victima) ?? p.lado;
    p.velocidad = fase === 'meter' ? this.ajustes.velocidadConLaMano : 1;
    p.objetivo = this._victima?.position ? this._objetivo : null;
    this._alContacto = fase === 'raponazo' ? alContacto : null;
    this._contacto = false;
    if (fase === 'meter' || fase === 'raponazo') this._dejarArrimar(this._victima);
    else this._soltarArrimo();
    if (p.objetivo) this._apuntar(0);
    player.stealPose = p;
    return p;
  }

  /** Lo que la barra quiere: dedos adentro (1) o quietos en la boca del bolsillo (0). */
  set hondura(valor) { this._hondura = Math.min(1, Math.max(0, valor)); }

  update(dt) {
    const player = this.game.player;
    const p = player?.stealPose === this._pose ? this._pose : null;
    if (p) this._avanzar(p, player, dt);
    else this._soltarArrimo();
    // Lo arrancado va en la mano mientras dura el tirón; al final del gesto, o si algo lo corta, se guarda.
    if (this.bolso.enLaMano) {
      const sigue = player?.stealPose === this._pose && this._pose.fase === 'raponazo' && this._pose.t < GUARDA_RAPONAZO;
      if (sigue) this.bolso.update(dt, player.root);
      else this.bolso.guardar();
    }
    if (this._arrimada && this._arrimoLibre) this._recuperarRadio(player, dt);
    if (this._descubrimientos.length) this._esperarDescubrimientos(dt);
    // Mientras la sacude un golpe o se defiende, Npc no llama a su quietud: aquí se suelta de una.
    for (const npc of this._retenidas) {
      if (npc._disposed || npc.koState || npc._hitReactionRemaining > 0 || npc._counter) this.soltarVictima(npc);
    }
  }

  _avanzar(p, player, dt) {
    p.t += dt;
    p.hondura += (this._hondura - p.hondura) * Math.min(1, dt * 12);
    // El que se va corriendo no espera a que termine el gesto: lo suelta de una.
    const fin = HURTO[p.fase];
    if (player.state === 'run' && SE_CORTAN_CORRIENDO.has(p.fase) && p.t < fin - .2) p.t = fin - .2;
    if (p.fase === 'raponazo') {
      if (!this._contacto && p.t >= CONTACTO_RAPONAZO) {
        this._contacto = true;
        this._soltarArrimo();
        const alContacto = this._alContacto;
        this._alContacto = null;
        alContacto?.();
        if (player.stealPose !== p) return; // el contacto pudo cancelar todo
      }
      // Con lo robado contra el pecho no se pelea: un golpe lo suelta.
      if (p.t > .49 && player.melee?.active) { this.cancelar(); return; }
    }
    if (p.objetivo && this._victima?.position && !this._victima._disposed) {
      this._medirRitmo(this._victima, dt);
      this._apuntar(dt);
      this._arrimar(p, player, dt);
    } else p.objetivo = null;
    if (terminada(p)) {
      player.stealPose = null;
      p.fase = null;
      this._victima = null;
      this._soltarArrimo();
    }
  }

  /**
   * El punto del mundo al que va la mano: el bolsillo de la víctima del lado del jugador o, en el raponazo,
   * el bolso o la bolsa que carga (sin bolsa, el bolsillo). Medido desde la cadera de verdad si la hay.
   */
  _apuntar(dt = 0) {
    const v = this._victima, player = this.game.player, p = this._pose;
    const tiron = p.fase === 'raponazo';
    const cuerpo = this._huesos(v);
    if (cuerpo.cadera) cuerpo.cadera.getWorldPosition(this._centro);
    else this._centro.copy(v.position);
    if (tiron && cuerpo.bolsa) {
      this._objetivo.copy(cuerpo.bolsaLocal);
      cuerpo.bolsa.localToWorld(this._objetivo);
    } else {
      const base = this._punto;
      if (cuerpo.cadera) {
        base.copy(this._centro);
        base.y += CUERPO.cadera;
      } else base.set(v.position.x, v.position.y + CUERPO.escala * (v.look?.real?.talla?.alto ?? 1) * CUERPO.bolsillo, v.position.z);
      let ux = player.position.x - base.x, uz = player.position.z - base.z;
      const d = Math.hypot(ux, uz) || 1;
      ux /= d; uz /= d;
      // Un poco corrido hacia la mano que roba: la derecha del jugador queda a (-cos, sin) de su rumbo.
      const yaw = player.root?.rotation?.y ?? Math.atan2(-ux, -uz);
      const lado = CUERPO.aLaMano * p.lado;
      const hondura = tiron ? 0 : p.hondura;
      const fondo = (tiron ? CUERPO.fondoTiron : CUERPO.fondo) - hondura * .05;
      this._objetivo.set(
        base.x + ux * fondo - Math.cos(yaw) * lado,
        base.y - hondura * .04,
        base.z + uz * fondo + Math.sin(yaw) * lado);
    }
    // Un bolsillo bajo (sentado, en el piso) pide doblarse: rodillas y espalda, con los pies donde están.
    const bajo = Math.min(1, Math.max(0, (CUERPO.comodo - (this._objetivo.y - player.position.y)) / CUERPO.rango));
    p.agachar = dt > 0 ? p.agachar + (bajo - p.agachar) * Math.min(1, dt * 6) : p.agachar;
  }

  /**
   * El modelo que se ve de la víctima: su cadera y, si carga una, la bolsa. Se busca una vez por robo y
   * otra si cambia de modelo (el de lejos no tiene huesos que valgan).
   */
  _huesos(v) {
    const c = this._cuerpo, modelo = v?.character?.group ?? null;
    if (c.npc === v && c.modelo === modelo) return c;
    c.npc = v; c.modelo = modelo; c.cadera = null; c.bolsa = null;
    if (!modelo?.traverse || v.character !== v.fullChar) return c;
    let alto = 0;
    modelo.traverse(o => {
      if (!c.cadera && o.isBone && /(?:mixamorig|:)Hips$|^Hips$/.test(o.name)) c.cadera = o;
      if (!c.bolsa && o.visible !== false && NOMBRES_DE_BOLSA.has(o.name) && o.geometry) { c.bolsa = o; alto = NOMBRES_DE_BOLSA.get(o.name); }
    });
    if (c.bolsa) {
      const g = c.bolsa.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const caja = _caja.copy(g.boundingBox);
      c.bolsaLocal.set((caja.min.x + caja.max.x) / 2, caja.min.y + (caja.max.y - caja.min.y) * alto, (caja.min.z + caja.max.z) / 2);
    }
    return c;
  }

  /**
   * El tirón llegó y se la lleva: la bolsa a la que fue la mano deja de verse en la víctima, en su modelo
   * completo y en el liviano, y pasa a la mano del tirón hasta guardarla. Devuelve qué se llevó ('bolso',
   * 'bolsa', 'maletin') o null si la mano fue al bolsillo. Sin bolsa ya no la vuelve a buscar.
   */
  arrancarBolsa(npc) {
    const p = this._pose, player = this.game.player;
    if (!npc || this._victima !== npc || p.fase !== 'raponazo' || player?.stealPose !== p) return null;
    const cuerpo = this._huesos(npc), prop = cuerpo.bolsa;
    if (!prop) return null;
    const id = prop.name.slice(5);
    this.bolso.agarrar(prop, player.character, p.lado);
    npc.quitarCarga?.(id);
    prop.visible = false;
    cuerpo.npc = null; // la próxima vez se busca otra vez, y esta ya no está
    return id;
  }

  /** Con qué mano va el tirón: la del lado en que el jugador ve la bolsa. Sin bolsa, null. */
  _ladoDeLaBolsa(v) {
    const cuerpo = this._huesos(v), player = this.game.player;
    if (!cuerpo.bolsa || !player?.position) return null;
    const punto = cuerpo.bolsa.localToWorld(this._punto.copy(cuerpo.bolsaLocal));
    const dx = punto.x - player.position.x, dz = punto.z - player.position.z;
    // El jugador va a mirar a la víctima: su derecha, en ese rumbo, es (-cos, sin).
    const yaw = Math.atan2(v.position.x - player.position.x, v.position.z - player.position.z);
    return Math.cos(yaw) * dx - Math.sin(yaw) * dz > .04 ? -1 : 1;
  }

  /** Lo que anda la víctima por segundo (cero si está quieta o si se teletransportó). */
  _medirRitmo(v, dt) {
    if (this._seguida === v && dt > 0) {
      this._ritmo.set((v.position.x - this._antes.x) / dt, 0, (v.position.z - this._antes.z) / dt);
      if (this._ritmo.lengthSq() > ARRIMO.ritmoMax * ARRIMO.ritmoMax) this._ritmo.set(0, 0, 0);
    } else this._ritmo.set(0, 0, 0);
    this._seguida = v;
    this._antes.copy(v.position);
  }

  /** La víctima se le despegó con la mano adentro: va andando y el jugador no la siguió. */
  get seFue() {
    const p = this._pose, v = this._victima, player = this.game.player;
    if (player?.stealPose !== p || p.fase !== 'meter' || p.t < ARRIMO.alcanzar || !v?.position) return false;
    return Math.hypot(v.position.x - player.position.x, v.position.z - player.position.z) > ARRIMO.seFue;
  }

  /**
   * Mientras la mano está adentro, el jugador va pegado a la víctima: se arrima con su andar y, si ella
   * camina, camina a su paso. Nunca contra lo que el jugador mande.
   */
  _arrimar(p, player, dt) {
    const arrimando = p.fase === 'meter' || (p.fase === 'raponazo' && p.t < CONTACTO_RAPONAZO);
    // Pillado, «tranquilo, tranquilo»: medio paso atrás con las manos arriba.
    const reculando = p.fase === 'pillado' && p.t < .5;
    const v = this._victima;
    if ((!arrimando && !reculando) || !player.velocity || !v) return;
    const axis = this.game.input?.axis;
    if (axis && (axis.x || axis.z)) return;
    const c = this._centro;
    const dx = c.x - player.position.x, dz = c.z - player.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return;
    player.faceTowards?.(c);
    // Agachado se queda un poco más atrás: las rodillas no se le meten encima al que está en el piso.
    const meta = reculando ? ARRIMO.recular : p.fase === 'raponazo' ? ARRIMO.raponazo : ARRIMO.cosquilleo + ARRIMO.agachado * p.agachar;
    const falta = d - meta;
    if (reculando) {
      if (falta >= -.02) return;
      const rapidez = -Math.min(ARRIMO.reculada, -falta * 9);
      player.velocity.x = dx / d * rapidez;
      player.velocity.z = dz / d * rapidez;
      return;
    }
    // Player.update frena la inercia sin entrada: esta velocidad es un paso corto, con piernas. Al paso de
    // la víctima se le suma lo que falta para quedar encima; nunca se echa para atrás.
    const tope = p.fase === 'raponazo' ? ARRIMO.estiron : ARRIMO.paso;
    const extra = falta > .02 ? Math.min(tope, falta * ARRIMO.ganancia) : 0;
    const vx = this._ritmo.x + dx / d * extra, vz = this._ritmo.z + dz / d * extra;
    if (vx * vx + vz * vz < 1e-4) return;
    player.velocity.x = vx;
    player.velocity.z = vz;
  }

  // Player empuja a quien tenga a menos de su radio más el del peatón: para meter la mano hay que encimarse.
  _dejarArrimar(npc) {
    if (this._arrimada === npc) return;
    this._devolverRadio();
    if (!npc || typeof npc !== 'object') return;
    this._arrimada = npc;
    this._arrimoLibre = false;
    this._radioPrevio = Object.prototype.hasOwnProperty.call(npc, 'radius') ? npc.radius : undefined;
    npc.radius = ARRIMO.radioVictima;
  }

  _soltarArrimo() {
    if (this._arrimada && !this._arrimoLibre) { this._arrimoLibre = true; this._arrimoT = 0; }
  }

  // Devolverle el radio de golpe empujaría al jugador medio metro en un cuadro: se espera a que se aparte
  // (o a que la víctima se vaya) y, si se quedan pegados, el radio vuelve despacio.
  _recuperarRadio(player, dt) {
    const npc = this._arrimada, original = this._radioPrevio ?? .4;
    this._arrimoT += dt;
    const lejos = !player?.position || !npc.position || npc._disposed ||
      player.position.distanceTo(npc.position) >= (player.radius ?? .4) + original - .02;
    if (lejos) { this._devolverRadio(); return; }
    if (this._arrimoT < 4) return;
    npc.radius = Math.min(original, (npc.radius ?? original) + dt * .15);
    if (npc.radius >= original - 1e-3) this._devolverRadio();
  }

  _devolverRadio() {
    const npc = this._arrimada;
    if (!npc) return;
    if (this._radioPrevio === undefined) delete npc.radius;
    else npc.radius = this._radioPrevio;
    this._arrimada = null;
    this._arrimoLibre = false;
    this._radioPrevio = undefined;
  }

  /** Corta todo lo del jugador (arresto, muerte, cambio de zona). Las víctimas se sueltan solas. */
  cancelar() {
    const player = this.game.player;
    if (player?.stealPose === this._pose) player.stealPose = null;
    this._pose.fase = null;
    this._victima = null;
    this._alContacto = null;
    this.bolso.guardar();
    this._soltarArrimo();
  }

  /**
   * La víctima reacciona con el cuerpo: 'sobresalto' (se voltea con las manos arriba), 'helado' (se queda
   * así más rato), 'mirar' (para y mira de reojo) o 'palparse' (se toca el bolsillo y busca). Quien está
   * sentado o en el piso no hace nada de esto: ya bastante tiene con pararse. `eventos` son [segundo, fn].
   */
  reaccionar(npc, tipo, { segundos = HURTO[tipo] ?? .8, girar = tipo === 'sobresalto' || tipo === 'helado', eventos = [], onFin = null } = {}) {
    if (!npc || npc._disposed || npc.koState || LOW_STANCES.has(npc.stance)) return false;
    this.soltarVictima(npc);
    const tieneProp = Object.prototype.hasOwnProperty.call(npc, 'poseParams');
    const prev = npc.poseParams;
    // Con el paraguas, el bastón o la bolsa en una mano, se cubre o se palpa con la otra; con las dos ocupadas, solo se voltea.
    const manos = manosOcupadas(npc);
    const libre = !manos.derecha ? 1 : !manos.izquierda ? -1 : 0;
    const pose = tipo === 'mirar' || !libre ? null
      : { fase: tipo, t: 0, lado: libre, unaMano: manos.derecha || manos.izquierda };
    const params = { ...(prev ?? {}), hurto: pose, look: 0 };
    npc.poseParams = params;
    const game = this.game;
    let t = 0, siguiente = 0, terminado = false;
    const pendientes = [...eventos].sort((a, b) => a[0] - b[0]);
    const fin = () => {
      if (terminado) return;
      terminado = true;
      if (npc.poseParams === params) {
        if (tieneProp) npc.poseParams = prev;
        else delete npc.poseParams;
      }
      if (npc.scriptedHold === hold) delete npc.scriptedHold;
      this._retenidas.delete(npc);
      onFin?.();
    };
    const hold = (dt) => {
      if (terminado) return false;
      if (npc._disposed || npc.koState || npc._hitReactionRemaining > 0 || (npc.combatAI && npc.combatAI.state !== 'libre')) { fin(); return false; }
      t += Math.max(0, dt);
      if (pose) pose.t = t;
      npc.moving = false;
      const player = game.player?.position;
      if (player) {
        const yaw = Math.atan2(player.x - npc.position.x, player.z - npc.position.z);
        const rel = wrapAngle(yaw - (npc.root?.rotation?.y ?? 0));
        if (girar && npc.root) npc.root.rotation.y += rel * Math.min(1, dt * 12);
        // Mirar de reojo; palparse primero mira el bolsillo y luego busca alrededor.
        params.look = tipo === 'palparse' ? (t < .5 ? 0 : Math.sin(t * 6) * .8)
          : tipo === 'mirar' ? Math.max(-1, Math.min(1, rel / 1.2)) : 0;
      }
      while (siguiente < pendientes.length && t >= pendientes[siguiente][0]) {
        pendientes[siguiente++][1]();
        if (terminado) return false;
      }
      if (t >= segundos) { fin(); return false; }
      return true;
    };
    hold.terminar = fin;
    npc.scriptedHold = hold;
    this._retenidas.add(npc);
    return true;
  }

  /** Suelta a la víctima ya mismo: deja su pose y su quietud como estaban. */
  soltarVictima(npc) { npc?.scriptedHold?.terminar?.(); }

  /**
   * Un cosquilleo limpio que se descubre tarde: a los `segundos`, la víctima se palpa el bolsillo, dice
   * algo y, si el jugador sigue cerca y a la vista, `cerca()`; si no, `lejos()`.
   */
  programarDescubrimiento(npc, segundos, { cerca = null, lejos = null } = {}) {
    if (!npc) return;
    this._descubrimientos.push({ npc, falta: segundos, cerca, lejos });
  }

  _esperarDescubrimientos(dt) {
    const lista = this._descubrimientos;
    for (let i = lista.length - 1; i >= 0; i--) {
      const d = lista[i];
      if (d.npc._disposed || d.npc.koState) { lista.splice(i, 1); continue; }
      if ((d.falta -= dt) > 0) continue;
      lista.splice(i, 1);
      this._descubrir(d);
    }
  }

  _descubrir({ npc, cerca, lejos }) {
    const decir = () => decirRobo(npc, 'descubre');
    const mirar = () => {
      const player = this.game.player?.position;
      const radio = this.ajustes.descubre.radio;
      const visto = !!player && npc.position.distanceTo(player) <= radio &&
        hasClearCombatLine({ from: npc.position, to: player, collisions: this.game.collisions ?? null });
      if (visto) { this.soltarVictima(npc); cerca?.(); } else lejos?.();
    };
    // El sentado o el que está en el piso no se para a buscar: solo se da cuenta.
    if (!this.reaccionar(npc, 'palparse', { segundos: HURTO.palparse, eventos: [[.6, decir], [1.0, mirar]] })) { decir(); mirar(); }
  }

  /** Cuántos descubrimientos esperan (para pruebas y depuración). */
  get pendientes() { return this._descubrimientos.length; }

  /** Al cambiar de zona o reiniciar: nadie se acuerda del robo. */
  olvidar() { this._descubrimientos.length = 0; }
}

/** Qué manos tiene ocupadas un peatón: el paraguas abierto va en la derecha; la bolsa y el maletín, en la izquierda. */
export function manosOcupadas(npc) {
  const manos = { derecha: false, izquierda: false };
  // La postura del paraguas no queda en `stance`: se ve en el paraguas abierto en la mano.
  if (npc?.stance === 'paraguas' || npc?.umbrella?.visible === true || npc?._stanceNow?.() === 'paraguas') manos.derecha = true;
  for (const item of npc?.look?.real?.accesorios ?? npc?.person?.real?.accesorios ?? []) {
    if (npc._sinCarga?.has(item?.id)) continue; // se lo arrancaron: esa mano quedó libre
    const mano = EN_LA_MANO[item?.id];
    if (mano) manos[mano] = true;
  }
  return manos;
}

/**
 * Dice una grabación de «robado» que cuadre con el robo ('pillado', 'descubre' o los del tirón), con la
 * voz que esa persona ya tiene y por el canal de voces con el peso del robo (decirFrase): calla la charla
 * de la calle y al testigo, y la turba no la pisa. Sin una que cuadre devuelve false y no dice nada.
 * Si el canal lo tiene una voz que pesa igual o más, no suena ni deja burbuja, y devuelve true: la frase
 * existía, no hay que cambiarla por una sin grabar.
 */
export function hablarRobo(npc, tipo) {
  if (!npc || npc._disposed || typeof npc.say !== 'function') return false;
  const bank = NPC_VOICE_BANK.robbed ?? [];
  const sexo = npc.look?.real?.sexo ?? npc.person?.sexo;
  npc._voz ??= npc._castVoice?.() ?? null;
  const veta = NO_CUADRA[tipo];
  const mismoSexo = e => (e.gender === 'mujer') === (sexo === 'mujer');
  let pool = bank.filter(e => mismoSexo(e) && (!npc._voz || e.voz === npc._voz));
  if (!pool.length && npc._voz) pool = bank.filter(e => mismoSexo(e) && !e.voz);
  pool = pool.filter(e => !veta?.test(e.text));
  if (!pool.length) return false;
  // Como speakScenario: si no se va a oír, ni se escoge la frase ni cuenta como dicha.
  if (vozOcupada(npc, 'robbed')) return true;
  const entry = any(pool);
  npc._voz ??= entry.voz ?? null;
  npc._lastVoiceTime = globalThis.performance?.now?.() ?? 0;
  decirFrase(npc, entry, 'robbed');
  return true;
}

/** La frase del robo; sin grabación que cuadre, el «¡ey!» del vocalizador y una sin grabar en la burbuja. */
function decirRobo(npc, tipo) {
  if (!npc || npc._disposed) return false;
  if (hablarRobo(npc, tipo)) return true;
  vocalizarFaltante(npc, 'robbed');
  npc.say?.(any(SIN_GRABAR[tipo] ?? SIN_GRABAR.pillado), 3);
  return true;
}

/**
 * La víctima se entera: huye gritando como siempre (Npc.alarmedByTheft), pero la frase grabada es la
 * del robo que fue. Si ninguna cuadra, hace su «¡ey!», dice una sin grabar y huye igual.
 */
export function alarmarVictima(npc, desde, tipo) {
  if (typeof npc?.alarmedByTheft !== 'function') return;
  const propia = Object.prototype.hasOwnProperty.call(npc, 'speakScenario') ? npc.speakScenario : undefined;
  if (typeof npc.speakScenario === 'function') {
    const original = npc.speakScenario;
    npc.speakScenario = (category, force) => category === 'robbed'
      ? decirRobo(npc, tipo)
      : original.call(npc, category, force);
  }
  try { npc.alarmedByTheft(desde, tipo); } finally {
    if (propia === undefined) delete npc.speakScenario;
    else npc.speakScenario = propia;
  }
}

/**
 * La defensa animada de Npc (_counterAttack): se anuncia, tira el puño a los 0,35 s y se esquiva
 * alejándose. Si esa persona ya se defendió una vez en una pelea, igual se defiende del robo. El daño
 * es el del robo directo de siempre. Devuelve false si el peatón no sabe defenderse (mocks).
 */
export function armarContragolpe(npc, atacante, damage) {
  if (typeof npc?._counterAttack !== 'function' || typeof atacante?.stats?.salud !== 'number' || npc.koState) return false;
  npc._counterAttack(atacante);
  if (!npc._counter) {
    npc._defenseUsed = true;
    npc._counter = { attacker: atacante, phase: 'wait', elapsed: 0, struck: false, damage };
    npc._counterPose = null;
  }
  npc._counter.damage = damage;
  return true;
}
