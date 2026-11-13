// src/systems/StreetLife.js
// La vida de calle que no es de un solo lugar: une la caleta, la fama, cuidar carros, la comida que se daña,
// las armas que se gastan, la pila pública, el agua de lluvia, el transporte y el hogar de paso con el juego.
// La lógica de cada cosa vive en su propio módulo; aquí solo se escucha, se decide y se avisa.
import { ITEMS } from '../data/items.js';
import { cop } from '../utils/money.js';
import { Caleta } from './Caleta.js';
import { Reputation, FAMA, avisoDeFama, famaNivel } from './Reputation.js';
import { CarGuarding } from './CarGuarding.js';
import { FreshnessSystem } from './Freshness.js';
import { wearWeapon } from './WeaponWear.js';
import { resolveTrip, travelMinutes, PASAJE } from './Transit.js';
import { HOGAR, checkIn, checkOut, hasRoom, isOpen, nightEffects } from './Shelter.js';
import { isFreeSpot } from '../world/bogota/streetLifePlaces.js';

export const PILA = {
  higiene: 35,
  higieneJabon: 30,   // lo que suma además si llevo jabón (y lo gasto)
  segundos: 4,        // lo que dura lavarse
  espera: 45,         // segundos antes de volver a lavarme
  frioNoche: { energia: 6, gripe: 0.2 }, // de noche o con lluvia el agua fría cobra
};
export const LLUVIA_MIN = 0.35; // intensidad desde la que una botella se llena con lluvia
export const COMPARTIR_ESPERA = 60;

const toast = (text, type = 'info') => window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));

/** La comida que menos falta me hace compartir: lo que se va a dañar primero. */
export function foodToShare(inventory) {
  const comida = inventory.items.filter((e) => ITEMS[e.id]?.consumable === 'hambre' && e.id !== 'comidaDanada');
  if (!comida.length) return null;
  return comida.sort((a, b) => (a.vence?.[0] ?? Infinity) - (b.vence?.[0] ?? Infinity) || ITEMS[a.id].value - ITEMS[b.id].value)[0];
}

export class StreetLife {
  constructor(game) {
    this.game = game;
    this.caleta = new Caleta();
    this.fama = new Reputation();
    this.guard = new CarGuarding();
    this.freshness = new FreshnessSystem({ inventory: game.inventory, caleta: this.caleta, now: () => game.totalGameHours });
    game.inventory.now = () => game.totalGameHours;
    this.simTime = 0;
    this._lastWash = -Infinity;
    this._lastShare = -Infinity;
    this.porteria = [];       // armas guardadas en el hogar de paso
    this.stops = [];
    this.pilas = [];
    this.hogar = null;
    this.task = null;         // lo que se muestra en el cartón de tarea: { label, progress, hint }
    this._listen();
  }

  _listen() {
    if (typeof window === 'undefined') return;
    window.addEventListener('street-fight', (e) => this._onFight(e.detail));
    window.addEventListener('pedestrian-robbed', (e) => this._onRobbed(e.detail));
    window.addEventListener('mirror-stolen', (e) => this._onMirror(e.detail?.car));
    window.addEventListener('steal', () => this._onMirror(null));
  }

  // ---------- fama ----------

  _fama(accion) {
    for (const cambio of this.fama.apply(accion)) toast(avisoDeFama(cambio), cambio.sube ? 'rare' : 'warn');
  }

  /** ¿Pasa esto a la vista de una chaza? */
  nearVendor(pos, radius = FAMA.cercaPuesto) {
    const vendors = this.game.world?.active?.vendors ?? [];
    return vendors.some((v) => Math.hypot(v.position.x - pos.x, v.position.z - pos.z) < radius);
  }

  _onFight({ hits = [], weapon = null } = {}) {
    const player = this.game.player;
    if (weapon && weapon !== 'punos') this._wear(weapon);
    let habitante = false, vendedor = false;
    for (const npc of hits) {
      if (npc?.isVendor) vendedor = true;
      else if (npc?.person?.arquetipo === 'habitante') habitante = true;
    }
    if (habitante) this._fama('pegarHabitante');
    if (vendedor) this._fama('pegarVendedor');
    else if (hits.length && player && this.nearVendor(player.position)) this._fama('pegarCercaChaza');
  }

  _onRobbed({ npc } = {}) {
    if (npc?.person?.arquetipo === 'habitante') this._fama('robarHabitante');
    const pos = npc?.position ?? this.game.player?.position;
    if (pos && this.nearVendor(pos)) this._fama('robarCercaChaza');
  }

  _onMirror(car) {
    const guarded = this.guard.car;
    // Le robé el espejo al carro que estaba cuidando.
    if (guarded && guarded.used) {
      this.guard.cancel();
      this._fama('robarCercaChaza');
      toast('Le robé al carro que estaba cuidando: así nadie me vuelve a dar trabajo.', 'warn');
    }
    if (car && this.nearVendor(car.position)) this._fama('espejoCercaChaza');
  }

  /** Lo llama la limpieza social cuando arranca: con buena fama, un parcero avisa. */
  onLimpiezaComing() {
    if (this.fama.calle < FAMA.buena) return false;
    toast('Un parcero avisa: viene la camioneta negra. Toca irse de aquí.', 'death');
    this.game.audio?.play?.('empty');
    return true;
  }

  /** ¿Me dejan arrimar a esta fogata? */
  canWarm() { return famaNivel(this.fama.calle) !== 'mala'; }

  /** Después de calentarme: con muy buena fama a veces me regalan algo. */
  afterWarm(random = Math.random) {
    if (famaNivel(this.fama.calle) !== 'muyBuena' || random() >= 0.25) return null;
    const regalo = random() < 0.5 ? ITEMS.pan : ITEMS.aguapanela;
    if (!this.game.inventory.add(regalo, 1)) return null;
    toast(`Un parcero me regaló ${regalo.name} en la candela.`, 'rare');
    return regalo.id;
  }

  /** Q en la fogata: compartir comida con los parceros. */
  shareFood() {
    const wait = COMPARTIR_ESPERA - (this.simTime - this._lastShare);
    if (wait > 0) { toast(`Ya compartí hace poco (${Math.ceil(wait)} s).`, 'info'); return false; }
    const entry = foodToShare(this.game.inventory);
    if (!entry) { toast('No llevo comida para compartir. En las chazas venden empanadas.', 'info'); return false; }
    const name = ITEMS[entry.id].name;
    this.game.inventory.remove(entry.id, 1);
    this._lastShare = this.simTime;
    this.game.stats.animo = Math.min(100, this.game.stats.animo + 6);
    this.game.player?.playAction?.('buscar', 1);
    this.game.audio?.play?.('pickup');
    toast(`Compartí ${name} con los parceros de la fogata (+ánimo).`, 'info');
    this._fama('compartir');
    return true;
  }

  // ---------- armas ----------

  _wear(weaponId) {
    const result = wearWeapon(this.game.inventory, weaponId);
    if (result.broke) {
      this.game.audio?.play?.('empty');
      toast(result.left > 0
        ? `Se me partió: ${result.name}. Saco la otra que tengo.`
        : `Se me partió: ${result.name}. En la mesa puedo hacer otra.`, 'death');
    } else if (result.warn) {
      toast(`${result.name}: ya está muy gastada, aguanta pocos golpes.`, 'warn');
    }
  }

  // ---------- cuidar carros ----------

  /** Q junto a un carro parqueado. */
  guardCar(car) {
    if (this.guard.active) {
      toast('Ya estoy cuidando un carro.', 'info');
      return false;
    }
    if (!this.guard.canGuard(car)) {
      const s = Math.ceil(this.guard.cooldownOf(car));
      toast(s > 0 ? `A este ya lo cuidé. El dueño todavía no vuelve a parquear (${s} s).` : 'Este carro no necesita que lo cuiden.', 'info');
      return false;
    }
    this.guard.start(car);
    this.game.player?.faceTowards?.(car.position);
    this.game.audio?.play?.('pickup');
    toast('Le cuido el carro mientras vuelve el dueño. No me alejo.', 'info');
    return true;
  }

  _updateGuard(dt) {
    const event = this.guard.update(dt, this.game.player.position);
    if (event?.type === 'paid') {
      if (event.amount > 0) {
        this.game.stats.dinero += event.amount;
        this.game.stats.addXP?.(8, this.game.talents);
        this.game.audio?.play?.('sell');
        toast(`Volvió el dueño: me dio ${cop(event.amount)} por cuidarle el carro.`, 'sell');
        this._fama('cuidarCarro');
      } else {
        this.game.audio?.play?.('empty');
        toast('Volvió el dueño y se fue sin dar nada.', 'warn');
      }
      window.dispatchEvent(new CustomEvent('car-guarded', { detail: { amount: event.amount } }));
    } else if (event?.type === 'left') toast('Me alejé del carro: perdí el turno de cuidarlo.', 'warn');
    else if (event?.type === 'far') toast('Me estoy alejando del carro que cuido.', 'warn');
  }

  // ---------- agua y pila ----------

  /** Usar la botella vacía del costal: con lluvia fuerte, o junto a una pila, se llena. */
  useBottle() {
    const g = this.game;
    const pila = this.pilaCerca();
    const lluvia = (g.weather?.isRaining && (g.weather.rainIntensity ?? 1) >= LLUVIA_MIN) ? g.weather.rainIntensity : 0;
    if (!pila && !lluvia) {
      toast('La botella está vacía. Se llena con lluvia fuerte o en una pila pública del parque.', 'info');
      return false;
    }
    return this.fillBottle(pila ? 'pila' : 'lluvia');
  }

  fillBottle(fuente) {
    const inv = this.game.inventory;
    if (inv.count('botella') <= 0) {
      toast('No llevo una botella vacía para llenar. En la basura salen.', 'info');
      return false;
    }
    inv.remove('botella', 1);
    if (!inv.add(ITEMS.aguaCalle, 1)) {
      inv.add(ITEMS.botella, 1);
      toast('No me cabe la botella llena en el costal.', 'warn');
      return false;
    }
    this.game.player?.playAction?.('buscar', fuente === 'lluvia' ? 2 : 1.2);
    this.game.audio?.play?.('pickup');
    toast(fuente === 'lluvia' ? 'Recogí agua de lluvia en la botella. No es potable, pero quita la sed.' : 'Llené la botella en la pila. No es potable, pero quita la sed.', 'info');
    return true;
  }

  pilaCerca(radius = 3) {
    const p = this.game.player?.position;
    return p ? this.pilas.find((pila) => Math.hypot(pila.position.x - p.x, pila.position.z - p.z) < radius) ?? null : null;
  }

  /** E en la pila: lavarse. Con jabón, mucho mejor; de noche o con lluvia, el agua fría cobra. */
  wash(pila) {
    const g = this.game, st = g.stats;
    const wait = PILA.espera - (this.simTime - this._lastWash);
    if (wait > 0) { toast(`Ya me lavé hace poco (${Math.ceil(wait)} s).`, 'info'); return false; }
    this._lastWash = this.simTime;
    const jabon = g.inventory.count('jabon') > 0;
    if (jabon) g.inventory.remove('jabon', 1);
    const sube = PILA.higiene + (jabon ? PILA.higieneJabon : 0);
    st.higiene = Math.min(100, st.higiene + sube); // el olor sale de la higiene
    g.player?.faceTowards?.(pila.position);
    g.player?.playAction?.('buscar', PILA.segundos);
    g.audio?.playWaterSplash?.(.25);
    const frio = g.clock?.isNight || g.weather?.isRaining;
    let texto = jabon ? `Me lavé con jabón en la pila (+${sube} de higiene).` : `Me lavé en la pila (+${sube} de higiene). Con jabón queda mejor.`;
    if (frio) {
      st.calor = 0;
      st.energia = Math.max(0, st.energia - PILA.frioNoche.energia);
      texto += ' El agua estaba helada.';
      g.diseases?.tryContract?.('gripe', PILA.frioNoche.gripe, g.interaction?.diseaseResistance?.() ?? 1);
    }
    toast(texto, 'info');
    window.dispatchEvent(new CustomEvent('washed', { detail: { soap: jabon } }));
    return true;
  }

  // ---------- transporte ----------

  /** Hace el viaje elegido en la ventana de la estación. Devuelve el resultado de `resolveTrip`. */
  travel(from, to, { modo, pedir = false }) {
    const g = this.game;
    const result = resolveTrip({
      modo, pedir, dinero: g.stats.dinero, buscado: g.steal?.buscado ?? 0,
      malOlor: g.stats.tieneMalOlor?.() ?? g.stats.higiene < 30,
    });
    if (!result.ok) {
      if (result.motivo === 'plata') toast(`No me alcanza para el pasaje (${cop(PASAJE)}).`, 'warn');
      else {
        g.stats.animo = Math.max(0, g.stats.animo - 6);
        if (g.steal) g.steal.buscado = Math.min(3, g.steal.buscado + 1);
        if (g.traffic) g.traffic.wantedLevel = g.steal?.buscado ?? 0;
        g.audio?.play?.('empty');
        toast('Me pillaron colándome: me sacaron de la estación y quedé fichado.', 'death');
      }
      return result;
    }
    g.stats.dinero -= result.pagado;
    g.stats.dinero += result.ganado;
    const minutos = travelMinutes(from, to);
    this.guard.cancel();
    g.relocatePlayer?.(this.arrivalSpot(to), { minutes: minutos, fade: true });
    const partes = [`Llegué a ${to.name} en ${minutos} min.`];
    if (pedir) partes.push(result.ganado > 0 ? `Pidiendo en el vagón me dieron ${cop(result.ganado)}.` : 'Pedí en el vagón, pero nadie me dio nada.');
    toast(partes.join(' '), result.ganado > 0 ? 'sell' : 'info');
    window.dispatchEvent(new CustomEvent('transit-trip', { detail: { from: from.id, to: to.id, modo, ganado: result.ganado } }));
    return result;
  }

  /** Se llega al lado del torniquete, no encima: el primer sitio libre a metro y medio. */
  arrivalSpot(stop) {
    const district = this.game.world?.active;
    for (const [dx, dz] of [[0, 1.6], [0, -1.6], [1.6, 0], [-1.6, 0], [1.2, 1.2], [-1.2, -1.2]]) {
      const x = stop.x + dx, z = stop.z + dz;
      if (!district?.tileTypeAt || isFreeSpot(district, this.game.collisions, x, z, .5)) return { x, z };
    }
    return { x: stop.x, z: stop.z };
  }

  // ---------- hogar de paso ----------

  /** Por qué no puedo entrar ahora, o null si puedo. */
  hogarBlocked() {
    // Game.sleep lo negaría después de entregar en la portería: con la tomba encima ni se entra.
    if (this.game.traffic?.inPursuit) return 'persecucion';
    const c = this.game.clock;
    if (!isOpen(c.hour)) return 'cerrado';
    if (!hasRoom(c.day)) return 'lleno';
    return null;
  }

  /** Entra y duerme en el hogar de paso. El juego reparte la noche con `game.sleep({ hogar })`. */
  enterHogar() {
    const g = this.game;
    const motivo = this.hogarBlocked();
    if (motivo) return false;
    const { entregadas, porteria } = checkIn(g.inventory, g.player?.equippedWeapon);
    this.porteria = porteria;
    if (entregadas.length) toast(`Entregué en la portería: ${entregadas.map((s) => `${s.name} ×${s.qty}`).join(', ')}.`, 'warn');
    this.guard.cancel();
    g.sleep({ hogar: this.hogar });
    return true;
  }

  /** Al despertar en el hogar: necesidades de una noche bajo techo y las armas de vuelta. */
  wakeAtHogar() {
    const g = this.game;
    nightEffects(g.stats);
    const quedan = checkOut(g.inventory, this.porteria);
    this.porteria = [];
    const devueltas = quedan.length ? ` No me cupo: ${quedan.map((q) => q.name).join(', ')}; la dejé ahí.` : '';
    toast(`Dormí en el hogar de paso: me bañé, comí caliente y nadie me robó.${devueltas}`, 'rare');
  }

  // ---------- cada cuadro ----------

  update(dt) {
    if (!(dt > 0)) return;
    this.simTime += dt;
    const fresh = this.freshness.update(dt);
    if (fresh) {
      const danadas = Object.keys(fresh.bag).map((id) => ITEMS[id]?.name).filter(Boolean);
      if (danadas.length) toast(`Se me dañó en el costal: ${danadas.join(', ')}.`, 'warn');
      if (fresh.soon.length) toast(`Toca comerme pronto: ${fresh.soon.join(', ')}. Se va a dañar.`, 'info');
    }
    this._updateGuard(dt);
    const mal = this.fama.checkDebt(this.game.totalGameHours);
    if (mal) {
      toast(`No pagué el fiado de ${cop(mal.perdida)}: los de las chazas ya no me creen.`, 'death');
      for (const c of mal.cambios) toast(avisoDeFama(c), 'warn');
    }
    this.task = this.guard.active ? {
      label: 'Cuidando el carro',
      progress: this.guard.progress,
      hint: this.guard.away > 0 ? 'Me estoy alejando: vuelvo junto al carro' : `El dueño vuelve en unos ${Math.ceil(this.guard.remaining)} s`,
      warn: this.guard.away > 0,
    } : null;
  }

  /** Muerte, arresto o recarga: se suelta lo que estaba en curso. */
  reset() {
    this.guard.cancel();
    this.task = null;
  }

  serialize() {
    return { caleta: this.caleta.serialize(), fama: this.fama.serialize(), porteria: this.porteria };
  }

  deserialize(d) {
    if (!d) return;
    this.caleta.deserialize(d.caleta);
    this.fama.deserialize(d.fama);
    // Si se cerró el juego con armas en la portería, vuelven al costal en la siguiente partida.
    if (Array.isArray(d.porteria) && d.porteria.length) {
      checkOut(this.game.inventory, d.porteria.filter((a) => ITEMS[a?.id]));
    }
  }
}

export { HOGAR, PASAJE };
