// src/features/steal.js
import { ITEMS } from '../data/items.js';
import { cop } from '../utils/money.js';
import { LOW_STANCES } from '../character/archetypes.js';
import { modoEntrada, teclaVisible } from '../core/modoEntrada.js';
import { XP_STEAL } from '../utils/constants.js';
import { ventajaDeRobo, probabilidadDeAviso, avisoDeRobo, botinDe, esDeLosSuyos, zonaDeCosquilleo } from './stealOdds.js';
import { CoreografiaDeHurto, alarmarVictima, armarContragolpe, tipoDeTiron } from './stealReactions.js';
import { TEXTOS_ZORRA } from '../data/zorra.js';

export const CONFIG = {
  stealDistance: 1.8,
  globalCooldown: 3.0,
  npcCooldown: 30.0,
  markerSpeed: 1.8,
  baseZoneSize: 0.35,
  lootMoneyCosquilleo: [800, 4000],
  lootMoneyDirect: [12000, 45000],
  lootItems: ['pan', 'lataComida', 'cigarrillo', 'tintico', 'moneda', 'reloj'],
  crowdRadius: 12,
  crowdMaxAttackers: 6,
  crowdWitnessChance: 0.72,
  crowdChancePerWitness: 0.15,
  crowdBravery: 0.3,
  directDamageMin: 6,
  directDamageMax: 16
};

/** Segundos de juego sin robar y sin persecución para que «te tienen fichado» baje un nivel. */
export const WANTED_DECAY_SECONDS = 120;

/** Objetivos con los que la Q ya hace otra cosa. */
const QUIET_Q_TARGETS = new Set(['pickup', 'dealer']);

/** Lo que paga un raponazo en experiencia: menos que un cosquilleo limpio, que es oficio. */
const XP_RAPONAZO = 4;

/** Segundos mínimos entre dos avisos de «primero suelto»: el machaque de E no llena la pantalla. */
const AVISO_MANOS_CADA = 1.5;

const HISTORIAL_VACIO = () => ({ limpios: 0, pillados: 0, raponazos: 0, fallidos: 0 });
const entero = v => Number.isInteger(v) && v >= 0;

export class StealSystem {
  constructor(game) {
    this.game = game;
    this.cooldown = 0;
    this.buscado = 0;
    this._calma = 0;      // segundos sin robar y sin persecución
    this._nivelVisto = 0; // para notar que subió por cualquier vía: también lo sube pelear con peatones
    this.targetNpc = null;
    this.minigameActive = false;
    this.markerPos = 0;
    this.markerDir = 1;
    this.zoneStart = 0.35;
    this.zoneSize = CONFIG.baseZoneSize;
    this._spaceOwned = false;
    this._avisoManos = 0; // s para poder repetir «primero suelto la zorra»
    if (typeof window !== 'undefined') window.addEventListener('keyup', (e) => { if (e.code === 'Space') this._spaceOwned = false; }, true);
    this._strongLanguageWarningShown = false;
    this.assaultScene = null;
    // El cuerpo del robo y la reacción de la víctima (stealReactions.js); sus ajustes son los de stealOdds.js.
    this.coreo = new CoreografiaDeHurto(game);
    this.ajustes = this.coreo.ajustes;
    this.raponazo = null;  // el tirón va en camino: se resuelve al contacto
    this._ventaja = null;  // cómo se le llegó a quien tiene la barra abierta
    this._ventajaAviso = {}; // la del aviso, que se recalcula cada cuadro sin crear objetos
    this._opcionesVentaja = { playerSpeed: 0, playerYaw: null, odds: null, out: null };
    this.historial = HISTORIAL_VACIO(); // se guarda en la partida como `robo`
    this._dom = null;
    this._buildUI();
    // En captura, como los paneles: el jugador gasta Espacio antes de que la barra se actualice y Esc abriría la pausa.
    globalThis.window?.addEventListener?.('keydown', (e) => this._onMinigameKey(e), true);
    // El retrovisor se roba en InteractionSystem: también cuenta como robar.
    globalThis.window?.addEventListener?.('steal', () => { this._calma = 0; });
  }

  _buildUI() {
    if (typeof document === 'undefined') return;
    const box = document.createElement('div');
    box.id = 'steal-minigame';
    box.className = 'carton corte-d';
    box.hidden = true;
    box.innerHTML = `
      <div id="steal-track"><i id="steal-zone"></i><i id="steal-marker"></i></div>
      <p id="steal-ayuda"></p>
    `;
    document.body.appendChild(box);
    this._dom = {
      box,
      zone: box.querySelector('#steal-zone'),
      marker: box.querySelector('#steal-marker'),
      ayuda: box.querySelector('#steal-ayuda')
    };
    const impact = document.createElement('div');
    impact.id = 'assault-impact-overlay';
    impact.className = 'assault-impact';
    document.body.appendChild(impact);
    this._dom.impact = impact;
  }

  update(dt) {
    const hit = this.game.player?.lastCombatHit;
    if (hit && hit.sequence !== this._lastHitSequence) {
      this._lastHitSequence = hit.sequence;
      if (hit.direction) this._flashImpact(hit.direction);
    }
    this._flashTime = Math.max(0, (this._flashTime ?? 0) - dt);
    if (this._dom?.impact) this._dom.impact.style.opacity = String(Math.min(1, this._flashTime / .16));
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    if (this._avisoManos > 0) this._avisoManos = Math.max(0, this._avisoManos - dt);
    this._enfriarFichado(dt);
    const npcs = this.game?.world?.active?.npcs ?? [];
    for (const n of npcs) {
      if (n._robadoTimer > 0) n._robadoTimer = Math.max(0, n._robadoTimer - dt);
    }
    // Un tirón en vuelo no llega si las manos se fueron al manubrio o al forcejeo: se suelta sin robo ni alarma.
    if (this.raponazo && (this._manosOcupadas() || this._forcejeando())) {
      this.raponazo = null;
      this.coreo.cancelar();
    }
    this.coreo.update(dt);
    // Un tirón que ya no está en el cuerpo (arresto, muerte, golpe) no queda esperando.
    if (this.raponazo && this.coreo.fase !== 'raponazo') this.raponazo = null;
    if (this.assaultScene) { this._updateAssaultScene(dt); return; }
    if (this.raponazo) return;
    if (this.minigameActive) {
      // Tirado por un carro, forcejeando o con las manos en la zorra o la carreta, no se le mete la mano a nadie.
      if (this.game.player?.isStunned || this._manosOcupadas() || this._forcejeando()) this._endMinigame(false, 'cancel');
      else this._updateMinigame(dt);
      return;
    }
    this._checkProximity(npcs);
  }

  /**
   * Lo que corre con el tiempo aunque no camine: manejando o nadando no se roba a nadie, pero «fichado» se enfría,
   * el enfriamiento entre robos baja y cada peatón robado vuelve a ser robable. El juego lo llama cuando `update` no
   * (también mientras el despeje del rebusque lo lleva al andén).
   */
  tick(dt) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt);
    this._enfriarFichado(dt);
    for (const n of this.game?.world?.active?.npcs ?? []) {
      if (n._robadoTimer > 0) n._robadoTimer = Math.max(0, n._robadoTimer - dt);
    }
    // Lo que quedó a medias no espera a que vuelva a pie: un tirón en vuelo se suelta sin robo ni alarma y la
    // mano sale. El palpado tarde y el radio de la víctima siguen su reloj: ya lejos, el robo queda limpio.
    if (this.raponazo || this.coreo.fase) {
      this.raponazo = null;
      this.coreo.cancelar();
    }
    this.coreo.update(dt);
  }

  // «Te tienen fichado» baja solo con el tiempo, y mientras dura alarga lo que ve una patrulla (ver TrafficSystem).
  _enfriarFichado(dt) {
    const traffic = this.game?.traffic;
    if (this.buscado > this._nivelVisto || this.buscado <= 0 || traffic?.inPursuit) this._calma = 0;
    else if ((this._calma += dt) >= (this.game?.reputation?.segundosDeCalma?.(WANTED_DECAY_SECONDS) ?? WANTED_DECAY_SECONDS)) {
      this._calma = 0;
      this.buscado--;
    }
    this._nivelVisto = this.buscado;
    if (traffic) traffic.wantedLevel = this.buscado;
  }

  // Encuentra el NPC más cercano y procesa las teclas de interacción E y Q.
  _checkProximity(npcs) {
    const playerPos = this.game?.player?.position;
    // Haciendo un rebusque, o mientras el despeje lo lleva al andén, las manos están en otra cosa: ni aviso ni E/Q.
    // Forcejeando por una zorra, tampoco: la E es de la barra y una Q de más no le tira la mano al reciclador.
    const rebusque = this.game?.rebusque;
    if (!playerPos || this.game.paused || this.game.player?.isStunned || rebusque?.activo || rebusque?.controlaJugador ||
      this._forcejeando()) {
      this.targetNpc = null;
      return;
    }
    let nearest = null;
    let minD = CONFIG.stealDistance;
    for (const n of npcs) {
      // Ni al desmayado ni a quien atiende un puesto: su aviso es la tienda.
      if (!n?.position || (n._robadoTimer ?? 0) > 0 || n.koState || n.isVendor || n._disposed) continue;
      const d = playerPos.distanceTo(n.position);
      if (d < minD) {
        minD = d;
        nearest = n;
      }
    }
    // Empujando la zorra o la carreta las dos manos van en el manubrio: ni aviso ni cosquilleo ni tirón. La E o la Q
    // junto a alguien dicen con qué se suelta, para no quedarse sin saber cómo.
    const ocupadas = nearest && this._manosOcupadas();
    if (ocupadas) {
      this.targetNpc = null;
      const input = this.game.input;
      const tecla = input.consumePress('KeyE') ||
        (!QUIET_Q_TARGETS.has(this.game.interaction?.currentTargetType) && input.consumePress('KeyQ'));
      if (tecla && this._avisoManos <= 0) {
        this._toast(ocupadas, 'warn');
        this._avisoManos = AVISO_MANOS_CADA;
      }
      return;
    }
    this.targetNpc = nearest;
    if (!nearest || this.cooldown > 0) return;
    if (this.game.interaction) {
      // El aviso dice cómo está la cosa: de espaldas, de frente o distraída.
      this.game.interaction.stealPrompt = avisoDeRobo(this._ventajaCon(nearest, this._ventajaAviso));
    }
    if (this.game.input.consumePress('KeyE')) this.startCosquilleo(nearest);
    // Junto a basura o al dealer, Q ya tiene otro uso: no se le roba al que justo va pasando.
    else if (!QUIET_Q_TARGETS.has(this.game.interaction?.currentTargetType) && this.game.input.consumePress('KeyQ')) this.startRaponazo(nearest);
  }

  /** Lo que dice el aviso si las manos van en la zorra o en la carreta de balineras; `null` si están libres. */
  _manosOcupadas() {
    if (this.game?.zorra?.empujando) return TEXTOS_ZORRA.sueltaPrimero;
    if (this.game?.cart?.isAttached) return TEXTOS_ZORRA.sueltaCarreta;
    return null;
  }

  _forcejeando() { return !!this.game?.zorraCtl?.forcejeo; }

  /** `out` reutiliza un objeto: el aviso se calcula cada cuadro que hay alguien cerca (las opciones también se reusan). */
  _ventajaCon(npc, out = undefined) {
    const player = this.game.player, o = this._opcionesVentaja;
    o.playerSpeed = player?.speed ?? 0;
    o.playerYaw = player?.root?.rotation?.y;
    o.odds = this.ajustes;
    o.out = out ?? {};
    return ventajaDeRobo(player?.position, npc, o);
  }

  // Dice si hay a quién hacerle cosquilleo a menos de esa distancia: un carro más lejano le cede el aviso y la tecla.
  personCloserThan(distance) {
    if (!this.targetNpc || this.cooldown > 0) return false;
    return this.game.player.position.distanceTo(this.targetNpc.position) < distance;
  }

  startCosquilleo(npc) {
    this.minigameActive = true;
    this.targetNpc = npc;
    npc.alerta ??= 0.35 + Math.random() * 0.4;
    // De espaldas o a uno distraído la zona crece; de frente o llegando a la carrera, se achica. La práctica la agranda.
    const ventaja = this._ventaja = this._ventajaCon(npc);
    this.zoneSize = zonaDeCosquilleo(Math.max(0.18, CONFIG.baseZoneSize * (1.1 - npc.alerta * 0.4)), ventaja, this.historial.limpios, this.ajustes);
    this.zoneStart = 0.15 + Math.random() * Math.max(0, 0.85 - this.zoneSize - 0.15);
    // La mano va al bolsillo: en el mundo se ve lo mismo que en la barra.
    this.coreo.jugador('meter', ventaja.lado, { victima: npc });
    this.markerPos = 0;
    this.markerDir = 1;
    if (this._dom) {
      this._dom.zone.style.left = `${this.zoneStart * 100}%`;
      this._dom.zone.style.width = `${this.zoneSize * 100}%`;
      // Lo que se dice, según con qué se esté jugando: la letra va abajo, a marcador, y nunca cruza la barra.
      this._dom.ayuda.innerHTML = modoEntrada() === 'tactil'
        ? 'Toque la barra en lo negro'
        : `<kbd>${teclaVisible('Espacio')}</kbd> Detener <kbd>${teclaVisible('Esc')}</kbd> Cancelar`;
      this._dom.box.hidden = false;
    }
  }

  // Mientras dura la barra, Espacio la detiene sin saltar y Esc la cancela sin abrir la pausa.
  _onMinigameKey(e) {
    // El Espacio que detuvo la barra sigue siendo suyo hasta soltarlo: su repetición no es un salto.
    if (this._spaceOwned && e.code === 'Space' && e.repeat) {
      e.preventDefault?.();
      e.stopImmediatePropagation();
      return;
    }
    if (!this.minigameActive || this.game.paused) return;
    if (e.code === 'Escape') {
      e._panelHandled = true;
      this._endMinigame(false, 'cancel');
    } else if (e.code === 'Space') {
      e.preventDefault?.();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      this._spaceOwned = true;
      const success = this.markerPos >= this.zoneStart && this.markerPos <= (this.zoneStart + this.zoneSize);
      this._endMinigame(success, 'play');
    }
  }

  // Actualiza la oscilación del marcador; si el jugador y la persona se separan, ya no hay a quién robarle.
  _updateMinigame(dt) {
    const npc = this.targetNpc, player = this.game.player?.position;
    if (npc?.position && player && player.distanceTo(npc.position) > CONFIG.stealDistance * 2) {
      this._endMinigame(false, 'cancel');
      return;
    }
    // Iba andando y no la seguí: la mano se queda en el aire, así que se acabó.
    if (this.coreo.seFue) {
      this._endMinigame(false, 'seFue');
      return;
    }
    const speed = CONFIG.markerSpeed * (1 + (this.targetNpc?.alerta ?? 0.3) * 0.5) * (this._ventaja?.marcadorMult ?? 1);
    this.markerPos += this.markerDir * speed * dt;
    if (this.markerPos >= 1) {
      this.markerPos = 1;
      this.markerDir = -1;
    } else if (this.markerPos <= 0) {
      this.markerPos = 0;
      this.markerDir = 1;
    }
    // Dentro de la zona los dedos se hunden en el bolsillo; fuera, esperan en la boca.
    this.coreo.hondura = this.markerPos >= this.zoneStart && this.markerPos <= this.zoneStart + this.zoneSize ? 1 : 0;
    if (this._dom) {
      this._dom.marker.style.left = `${this.markerPos * 100}%`;
    }
  }

  _endMinigame(success, reason) {
    this.minigameActive = false;
    if (this._dom) this._dom.box.hidden = true;
    if (reason === 'cancel' || reason === 'seFue') {
      if (this.coreo.fase === 'meter') this.coreo.jugador('soltar');
      if (reason === 'seFue') this._toast('Se me fue: siguió derecho y me dejó con la mano estirada.', 'warn');
      return;
    }
    const npc = this.targetNpc;
    this.cooldown = CONFIG.globalCooldown;
    this._calma = 0;
    if (npc) npc._robadoTimer = CONFIG.npcCooldown;
    if (success) {
      const botin = botinDe(npc, CONFIG.lootItems);
      this._giveLoot(this._rango(CONFIG.lootMoneyCosquilleo, botin.plata), true, botin.objetos ?? CONFIG.lootItems);
      this.coreo.jugador('sacar');
      this.game.audio?.play?.('pickup');
      this.game.stats?.addXP?.(XP_STEAL, this.game.talents);
      const miron = this._miron(npc);
      if (miron) {
        this._pillado(npc, '¡Un mirón me vio meter la mano!', { conLaMano: false });
        return;
      }
      // La práctica es de los limpios de verdad: el que vio un mirón no cuenta.
      this.historial.limpios++;
      this._toast(this._ventaja?.posicion === 'espalda' ? 'Por la espalda, limpio: ni lo sintió.' : 'Cosquilleo limpio: nadie se dio cuenta.', 'rare');
      this._emitir('cosquilleo-limpio', { arquetipo: npc?.person?.arquetipo ?? null });
      // Si me quedo cerca, a los segundos se puede palpar el bolsillo y verme. Irse rápido lo deja limpio.
      const d = this.ajustes.descubre;
      if (npc && Math.random() < d.chance) {
        this.coreo.programarDescubrimiento(npc, d.min + Math.random() * (d.max - d.min), {
          cerca: () => this._descubierto(npc),
          lejos: () => this._toast('A lo lejos alguien se palpa el bolsillo: ya no me alcanza.', 'info')
        });
      }
    } else {
      const bonus = this.game?.dog?.distractionBonus?.(this.game.player?.position) ?? 0;
      const noticeChance = probabilidadDeAviso({
        alerta: npc?.alerta ?? 0.5, perro: bonus, fama: this.game?.reputation?.alertaExtra ?? 0,
        franja: this.game?.jornada?.franja?.alerta ?? 0, ventaja: this._ventaja,
        talento: this.game?.talents?.getEffect?.('stealCaughtMult', 1) ?? 1, odds: this.ajustes
      });
      if (Math.random() < noticeChance) {
        this._pillado(npc, '¡Me pillaron con las manos en la masa! El peatón gritó.');
      } else {
        this.historial.fallidos++;
        // Saco la mano y me rasco la nuca; la persona para y mira, más pilas que antes.
        this.coreo.jugador('disimular');
        this.coreo.reaccionar(npc, 'mirar', { segundos: .8 });
        if (npc) npc.alerta = Math.min(1, (npc.alerta ?? .5) + .2);
        this._toast('Fallé el cosquilleo, pero disimulé.', 'warn');
      }
    }
  }

  /**
   * Me vieron: la víctima se voltea (o se queda helada) y grita, la Policía que esté mirando viene y los
   * valientes de alrededor se meten. Sin nadie que se meta, una persona brava me persigue ella misma.
   */
  _pillado(npc, texto, { conLaMano = true } = {}) {
    this.historial.pillados++;
    const player = this.game.player;
    if (conLaMano) this.coreo.jugador('pillado');
    const helada = (npc?.valentia ?? .5) < .35;
    this.coreo.reaccionar(npc, helada ? 'helado' : 'sobresalto', { segundos: helada ? 1.2 : .5 });
    alarmarVictima(npc, player.position, 'pillado');
    this._toast(texto, 'death');
    // De último: los avisos caen uno encima del otro y este es el que hay que alcanzar a leer.
    this._alertPolice();
    const turba = this._triggerCrowdConsequence(npc, 'cosquilleo');
    if (!turba && npc && !helada && (npc.valentia ?? 0) > .8 && npc.look?.real?.edad === 'adulto' &&
        !LOW_STANCES.has(npc.stance) && typeof npc.beginAssault === 'function') {
      this.coreo.soltarVictima(npc);
      npc.beginAssault(player, 'golpe_jab', .5, true);
    }
    this.game.witnesses?.report?.('robo', npc);
    this._emitRobo(false, npc);
  }

  /** La víctima se palpó el bolsillo y todavía me tiene a la vista. */
  _descubierto(npc) {
    // Ya no fue limpio: la práctica que se contó al sacar la mano se devuelve.
    this.historial.limpios = Math.max(0, this.historial.limpios - 1);
    npc.alerta = Math.min(1, (npc.alerta ?? .5) + .3);
    alarmarVictima(npc, this.game.player.position, 'descubre');
    this._toast('¡Se palpó el bolsillo y me vio! A perderme.', 'death');
    this._alertPolice();
    this.game.witnesses?.report?.('robo', npc);
    this._emitRobo(false, npc);
  }

  /** Alguien de frente y cerca que alcanzó a ver la mano: a lo sumo uno grita. */
  _miron(victim) {
    const playerPos = this.game.player?.position;
    const lista = this.game.witnesses?._witnesses?.(playerPos, victim);
    if (!playerPos || !lista?.length) return null;
    const { chance, radio, mira } = this.ajustes.miron;
    for (const npc of lista) {
      const dx = playerPos.x - npc.position.x, dz = playerPos.z - npc.position.z;
      const d = Math.hypot(dx, dz);
      if (d > radio || d < 1e-3) continue;
      const yaw = npc.root?.rotation?.y;
      if (Number.isFinite(yaw) && (Math.sin(yaw) * dx + Math.cos(yaw) * dz) / d < mira) continue;
      if (Math.random() >= chance) continue;
      if (!npc.speakScenario?.('witnessTheft', true)) npc.say?.('¡Ladrón!', 3);
      return npc;
    }
    return null;
  }

  /** El tirón: el cuerpo arranca ya y el robo se resuelve cuando la mano llega (CONTACTO_RAPONAZO). */
  startRaponazo(npc) {
    this.cooldown = CONFIG.globalCooldown;
    npc._robadoTimer = CONFIG.npcCooldown;
    this._calma = 0;
    const player = this.game.player;
    player.faceTowards?.(npc.position);
    this.raponazo = { npc };
    // Para en seco un instante: la mano encuentra el bolso donde estaba.
    this.coreo.reaccionar(npc, 'mirar', { segundos: .3 });
    this.coreo.jugador('raponazo', this._ventajaCon(npc).lado, { victima: npc, alContacto: () => this._contactoRaponazo(npc) });
  }

  _contactoRaponazo(npc) {
    this.raponazo = null;
    const player = this.game.player;
    if (player.isStunned || npc._disposed || npc.koState || player.position.distanceTo(npc.position) > this.ajustes.raponazoAlcance) {
      // Se me fue: nada en la mano y todo el mundo se dio cuenta.
      this.historial.fallidos++;
      this.coreo.jugador('soltar');
      this.coreo.soltarVictima(npc);
      this.game.audio?.play?.('empty');
      alarmarVictima(npc, player.position, 'raponazo-fallido');
      this._toast('Se me escapó: agarré puro aire.', 'warn');
      this._alertPolice();
      this._emitRobo(true, npc);
      return;
    }
    this.game.audio?.playWhoosh?.();
    // Si la mano fue al bolso, se lo lleva: deja de verse en ella y queda en mi mano hasta guardarlo.
    const bolsa = this.coreo.arrancarBolsa(npc);
    // La víctima grita por lo que se le llevaron: «mi bolso» solo si era un bolso.
    this.executeRoboDirecto(npc, tipoDeTiron(bolsa));
  }

  executeRoboDirecto(npc, tipo = 'raponazo') {
    this.cooldown = CONFIG.globalCooldown;
    npc._robadoTimer = CONFIG.npcCooldown;
    this._calma = 0;
    this.buscado = Math.min(3, this.buscado + 1);
    this.historial.raponazos++;
    this._giveLoot(this._rango(CONFIG.lootMoneyDirect, botinDe(npc).plata), false);
    this.game.audio?.play?.('pickup');
    this.game.stats?.addXP?.(XP_RAPONAZO, this.game.talents);
    // Quien está en el piso o en la banca no alcanza a defenderse: bastante hace con pararse.
    const down = LOW_STANCES.has(npc.stance);
    const player = this.game.player;
    alarmarVictima(npc, player.position, tipo);
    const isStrong = !down && (npc.look?.real?.edad === 'adulto' || Math.random() < 0.45);
    if (isStrong && this.game.stats) {
      const dmg = Math.floor((CONFIG.directDamageMin + Math.random() * (CONFIG.directDamageMax - CONFIG.directDamageMin))
        * (this.game?.jornada?.franja?.golpe ?? 1));
      // El puño se anuncia y llega a los 0,35 s: correr ya lo esquiva (Npc._counterAttack).
      if (armarContragolpe(npc, player, dmg)) {
        this.coreo.soltarVictima(npc);
        this._toast('¡Se me vino encima! A correr.', 'warn');
      } else {
        this.game.stats.salud = Math.max(0, this.game.stats.salud - dmg);
        this._toast(`¡El peatón se defendió! −${dmg} de salud.`, 'death');
      }
    } else {
      if (!down) this.coreo.reaccionar(npc, 'sobresalto', { segundos: .45 });
      this._toast('¡Raponazo! El peatón se asustó.', 'warn');
    }
    this._alertPolice();
    this._triggerCrowdConsequence(npc, 'robo directo');
    this.game.witnesses?.report?.('robo', npc);
    this._emitRobo(true, npc);
  }

  /** El rango de plata según lo que carga cada quien, en cientos. */
  _rango([min, max], factor = 1) {
    const f = Number.isFinite(factor) ? factor : 1;
    return [Math.max(100, Math.round(min * f / 100) * 100), Math.max(100, Math.round(max * f / 100) * 100)];
  }

  /** Para guardar: lo que lleva robado, que es también la mano que tiene. «Te tienen fichado» no se guarda. */
  serialize() { return { historial: { ...this.historial } }; }

  /** Una partida sin `robo` (anterior a esto) o con basura empieza de cero. */
  deserialize(data) {
    this.historial = HISTORIAL_VACIO();
    const h = data?.historial;
    if (!h || typeof h !== 'object') return;
    for (const k of Object.keys(this.historial)) if (entero(h[k])) this.historial[k] = h[k];
  }

  /** Cancela lo que esté a medias: barra, mano y tirón (arresto, muerte, recuperarse). */
  reiniciar() {
    if (this.minigameActive) this._endMinigame(false, 'cancel');
    this.raponazo = null;
    this.coreo.cancelar();
    this.coreo.olvidar();
  }

  /** Un robo a una persona que el barrio se entera (ver ReputationSystem). */
  _emitRobo(directo, victim = null) {
    // Robarle a un habitante de calle o a un reciclador lo cobra más el barrio (ver ReputationSystem).
    this._emitir('robo-peaton', { directo, deLosSuyos: esDeLosSuyos(victim) });
  }

  _emitir(name, detail) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
  }

  // Una patrulla que lo ve lo persigue, igual que por un retrovisor robado.
  _alertPolice() {
    // Con el truco de invisibilidad, ningún robo llama a la patrulla.
    if (this.game.cheats?.invisible) return;
    if (this.game.traffic) this.game.traffic.wantedLevel = this.buscado; // el robo de ahora ya cuenta
    if (this.game.traffic?.alertForTheft?.(this.game.player.position) && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('police-chase', {}));
    }
  }

  _triggerCrowdConsequence(victim, kind) {
    const player = this.game?.player;
    const playerPos = player?.position;
    const npcs = this.game?.world?.active?.npcs ?? [];
    if (!playerPos || !this.game?.stats) return false;

    // La víctima ya salió corriendo: los que se le vienen encima son los testigos con ganas de pelea.
    const witnesses = npcs.filter(npc => npc !== victim && npc?.position && !(npc.hp <= 0) && !npc._disposed &&
      !npc.isVendor && !LOW_STANCES.has(npc.stance) && (npc.valentia ?? 1) > CONFIG.crowdBravery &&
      Math.abs(npc.position.y - playerPos.y) < 1.2 && npc.position.distanceTo(playerPos) <= CONFIG.crowdRadius)
      .sort((a, b) => a.position.distanceToSquared(playerPos) - b.position.distanceToSquared(playerPos));
    const chance = Math.min(.9, CONFIG.crowdWitnessChance + witnesses.length * CONFIG.crowdChancePerWitness);
    if (!witnesses.length) return false;
    if (Math.random() >= chance && kind !== 'robo directo') return false;

    if (!this._strongLanguageWarningShown) {
      this._strongLanguageWarningShown = true;
      this._toast('⚠️ Aviso: la siguiente escena contiene lenguaje fuerte.', 'warn');
    }

    const assaultNpcs = witnesses.slice(0, CONFIG.crowdMaxAttackers);
    assaultNpcs.forEach((npc, index) => npc.beginAssault?.(player, 'golpe_jab', index * .15, true));
    assaultNpcs[0]?.speakScenario?.('theftChase', true);

    this.assaultScene = { time: 0, kind, assaultNpcs };
    return true;
  }

  _updateAssaultScene(dt) {
    // Los NPC resuelven el impacto una única vez al alcanzar hitAt.
    const scene = this.assaultScene;
    scene.time += dt;
    if (scene.time < 25 && this.game.stats.salud > 0 &&
        scene.assaultNpcs.some(npc => npc.combatAI?.state !== 'libre' && npc.combatAI?.objetivo)) return;
    if (this.game.stats.salud <= 0) this.game._deathCause = 'agresión colectiva';
    this.assaultScene = null;
  }

  _flashImpact(direction) {
    const overlay = this._dom?.impact;
    if (!overlay) return;
    // La dirección de entrada se convierte a los ejes de la cámara.
    const matrix = this.game.cameraRig?.camera?.matrixWorld?.elements;
    const x = matrix ? -(direction.x * matrix[0] + direction.z * matrix[2]) : -direction.x;
    const z = matrix ? -(direction.x * matrix[8] + direction.z * matrix[10]) : -direction.z;
    const side = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'right' : 'left') : (z > 0 ? 'bottom' : 'top');
    const positions = { left: '0% 50%', right: '100% 50%', top: '50% 0%', bottom: '50% 100%' };
    overlay.style.background = `radial-gradient(ellipse at ${positions[side]},rgba(255,0,0,.88) 0%,rgba(145,0,0,.34) 28%,transparent 67%)`;
    overlay.style.opacity = '1';
    this._flashTime = .26;
  }

  _giveLoot(moneyRange, includeItemChance, itemPool = CONFIG.lootItems) {
    // De noche y de madrugada la gente que queda en la calle carga más plata (y se defiende peor o con más rabia).
    const botin = this.game?.jornada?.franja?.botin ?? 1;
    const money = Math.round((moneyRange[0] + Math.random() * (moneyRange[1] - moneyRange[0])) * botin / 100) * 100;
    if (this.game.stats) this.game.stats.dinero += money;
    this._toast(`+${cop(money)}`, 'sell');
    if (includeItemChance && Math.random() < 0.4 && this.game.inventory) {
      const pool = itemPool?.length ? itemPool : CONFIG.lootItems;
      const itemId = pool[Math.floor(Math.random() * pool.length)];
      if (ITEMS[itemId]) {
        if (this.game.inventory.add(ITEMS[itemId], 1)) this._toast(`Robé: ${ITEMS[itemId].name}`, 'info');
        else this._toast(`No me cabe más en el costal: dejé ${ITEMS[itemId].name}.`, 'warn');
      }
    }
  }

  _toast(text, type = 'info') {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
    }
  }
}
