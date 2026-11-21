import { MISSION_TEMPLATES } from './DailyMissionSystem.js';
import { canReachCombatTarget } from './CombatGeometry.js';
import { cop } from '../utils/money.js';
import { ITEMS } from '../data/items.js';

export const DELIVERY_GEAR = Object.freeze({ progress: .6, price: 50000 });
export const DELIVERY_ITEMS = [ITEMS.maletinRappi, ITEMS.chaquetaRappi, ITEMS.gorraRappi];
export const DELIVERY_STRIKE_LIMIT = 3;
export const DELIVERY_FINE = 18000;
export const DELIVERY_TIP = 1000;
const PAY = { person: { cash: 3000, xp: 25 }, building: { cash: 4000, xp: 35 } };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export class DeliverySystem {
  constructor(game) {
    this.game = game;
    this.owned = false;
    this.equipped = [];
    this.completed = 0;
    this.strikes = 0;
    this.order = null;
    this.shops = [];
    this.clients = [];
    this.routeUpdateAt = 0;
  }

  setPlaces({ shops, clients }) {
    this.shops = shops;
    this.clients = clients;
  }

  get missionCount() { return this.game.dailyMissions.completedTypes.size; }
  get requiredMissions() { return Math.ceil(MISSION_TEMPLATES.length * DELIVERY_GEAR.progress); }
  get canBuy() {
    return !this.owned && !this.suspended && this.missionCount >= this.requiredMissions && this.game.stats.dinero >= DELIVERY_GEAR.price;
  }

  get suspended() { return this.strikes >= DELIVERY_STRIKE_LIMIT; }
  get canPayFine() { return this.suspended && this.game.stats.dinero >= DELIVERY_FINE; }

  get ready() { return this.owned && this.equipped.includes('bag') && this.game.inventory.count(ITEMS.maletinRappi.id) > 0; }

  toggleGear(piece) {
    return this.setGear(this.equipped.includes(piece)
      ? this.equipped.filter(item => item !== piece) : [...this.equipped, piece]);
  }

  setGear(gear, { applyLook = true, save = true } = {}) {
    if (!this.owned) return false;
    const equipped = DELIVERY_ITEMS.filter(item => gear.includes(item.deliveryGear) && this.game.inventory.count(item.id) > 0)
      .map(item => item.deliveryGear);
    if (equipped.join() === this.equipped.join()) return false;
    const wasReady = this.ready;
    if (wasReady && !equipped.includes('bag')) this._clearRoute();
    this.equipped = equipped;
    if (applyLook) this.game.player.setDeliveryGear?.(equipped);
    this.game._poiCache = null;
    if (!wasReady && this.ready) this.markRoute();
    if (save) this.game._save();
    return true;
  }

  _giveGear() {
    for (const item of DELIVERY_ITEMS) if (!this.game.inventory.count(item.id)) this.game.inventory.add(item);
  }

  get purchaseRequirements() {
    return `Cuesta ${cop(DELIVERY_GEAR.price)}. Se requieren ${this.requiredMissions} tipos distintos de misiones de Calle. Ya ha completado ${this.missionCount}.`;
  }

  purchase() {
    if (!this.canBuy) return false;
    this.game.stats.dinero -= DELIVERY_GEAR.price;
    this.owned = true;
    this._giveGear();
    this.setGear(DELIVERY_ITEMS.map(item => item.deliveryGear), { save: false });
    this._notify('Compré el maletín de Rappi. Pulse J para aceptar el primer pedido.');
    this.game._save();
    return true;
  }

  get offer() {
    if (!this.ready || this.order || !this.shops.length) return null;
    const shift = this.completed + this.strikes;
    const shop = this.shops[shift % this.shops.length];
    const type = shift % 2 === 0 ? 'person' : 'building';
    const fromShop = client => distance(shop.position, client.npc?.home ?? client.position);
    const options = this.clients.filter(client => client.type === type && fromShop(client) >= 25);
    options.sort((a, b) => fromShop(a) - fromShop(b));
    const nearby = options.slice(0, 3);
    const client = nearby[Math.floor(shift / 2) % nearby.length];
    return client ? { shop, client, pay: PAY[client.type] } : null;
  }

  get job() {
    if (!this.order) return null;
    const shop = this.shops.find(item => item.id === this.order.shop);
    const client = this.clients.find(item => item.id === this.order.client);
    return shop && client ? { shop, client, pay: PAY[client.type] } : null;
  }

  get destination() {
    if (!this.ready) return null;
    const job = this.job;
    return job ? this.order.pickedUp ? job.client : job.shop : null;
  }

  get poi() {
    const destination = this.destination;
    if (!destination) return null;
    const { x, z } = destination.position;
    const action = this.order.pickedUp ? 'Entregar pedido' : 'Recoger pedido';
    return { x, z, name: `${action} — ${destination.name}`, icon: '📦', color: '#ed6430', fijo: true };
  }

  get equipmentPoi() {
    const shop = this.shops[0];
    if (!shop) return null;
    return { ...shop.position, name: 'La Esquinita — Equipo de Rappi', icon: '🏪', color: '#2ecc71', fijo: true };
  }

  get objective() {
    const destination = this.destination;
    if (!destination) return null;
    return this.order.pickedUp ? `ENTREGAR PEDIDO — ${destination.name}` : `RECOGER PEDIDO — ${destination.name}`;
  }

  get secondsLeft() { return this.order?.pickedUp ? this.order.secondsLeft : null; }

  _timeFor({ shop, client }) {
    const meters = this.game.gps?.routeLengthTo?.(shop.position, client.position)
      ?? distance(shop.position, client.position);
    // Incluye margen para semáforos y cruces a pie, también en un trayecto corto.
    return Math.min(240, Math.max(45, Math.ceil(30 + meters / 2.6)));
  }

  update(dt) {
    const left = this.secondsLeft;
    if (left > 0) this.order.secondsLeft = Math.max(0, left - dt);
  }

  markRoute() {
    const poi = this.poi;
    return poi ? this.game.setGpsWaypoint(poi, { silent: true }) : false;
  }

  updateRoute(now) {
    if (!this.order?.pickedUp || now < this.routeUpdateAt) return;
    this.routeUpdateAt = now + 1500;
    const waypoint = this.game.gps?.waypoint;
    if (!waypoint) return;
    const poi = this.poi;
    if (poi && waypoint.name === poi.name && distance(waypoint, poi) >= 6) this.markRoute();
  }

  accept() {
    const offer = this.offer;
    if (!offer) return false;
    this.order = { shop: offer.shop.id, client: offer.client.id, pickedUp: false };
    this._changed();
    return true;
  }

  cancel() {
    if (!this.order) return false;
    this._clearRoute();
    this.order = null;
    this._changed(false);
    this._notify('Pedido cancelado.');
    return true;
  }

  keepOrder() {
    if (!this.ready || !this.order?.pickedUp || !this.job) return false;
    if (!this.game.inventory.add(ITEMS.empanada)) {
      this._notify('El pedido no cabe en el costal.', 'warn');
      return false;
    }
    this._clearRoute();
    this.order = null;
    this.strikes++;
    if (this.suspended) {
      this.setGear([], { save: false });
      for (const item of DELIVERY_ITEMS) this.game.inventory.remove(item.id, this.game.inventory.count(item.id));
      this.owned = false;
      this._notify(`Tercera falta. Rappi retiró el equipo de reparto. Paga ${cop(DELIVERY_FINE)} en La Esquinita para volver.`, 'warn');
    } else {
      this._notify(`Me quedé con el pedido. ${this.strikes} de ${DELIVERY_STRIKE_LIMIT} faltas.`, 'warn');
    }
    this._changed(false);
    return true;
  }

  payFine() {
    if (!this.canPayFine) return false;
    this.game.stats.dinero -= DELIVERY_FINE;
    this.strikes = 0;
    this.owned = true;
    this._giveGear();
    this.setGear(['bag'], { save: false });
    this._changed(false);
    this._notify('Multa pagada. Recuperé el equipo. Los pedidos están en Misiones (J).');
    return true;
  }

  get nearbyStop() {
    const p = this.game.player;
    if (!this.order || p.isGrounded === false || p.isSwimming || p.isStunned || p.sorting || p.benchSeat ||
      this.game.steal?.minigameActive || (p.bicycle && Math.abs(p.bicycle.speed) > 1.5)) return null;
    const stop = this.destination;
    if (!stop || stop.npc?.koState || stop.npc?.fleeTimer > 0) return null;
    return canReachCombatTarget({ from: p.position, to: stop.position, collisions: this.game.collisions,
      maxDistance: 1.8, maxHeightDifference: .65 }) ? stop : null;
  }

  interact(stop) {
    if (!stop || this.nearbyStop !== stop) return false;
    if (!this.order.pickedUp) {
      this.order.secondsLeft = this._timeFor(this.job);
      this.order.pickedUp = true;
      this._changed();
      this._notify(`Pedido recogido en ${this.destination.name}.`);
    } else {
      const { cash, xp } = this.job.pay;
      const tip = this.secondsLeft > 0 ? DELIVERY_TIP : 0;
      this._clearRoute();
      this.order = null;
      this.completed++;
      this.game.stats.dinero += cash + tip;
      this.game.stats.addXP?.(xp, this.game.talents);
      this._changed(false);
      const bonus = tip ? ` más propina de ${cop(tip)}` : '';
      this._notify(`Domicilio entregado. +${cop(cash)}${bonus}. Hay otro pedido en J.`, 'rare');
    }
    return true;
  }

  _clearRoute() {
    const waypoint = this.game.gps?.waypoint;
    if (waypoint && waypoint.name === this.poi?.name) this.game.clearGpsWaypoint();
  }

  _changed(mark = true) {
    this.game._poiCache = null;
    if (mark) this.markRoute();
    this.game._save();
  }

  _notify(text, type = 'info') {
    globalThis.window?.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));
  }

  serialize() {
    return { owned: this.owned, equipped: [...this.equipped], completed: this.completed, strikes: this.strikes, order: this.order && { ...this.order } };
  }

  deserialize(data) {
    this.strikes = Number.isSafeInteger(data?.strikes) ? Math.max(0, Math.min(data.strikes, DELIVERY_STRIKE_LIMIT)) : 0;
    this.owned = data?.owned === true && !this.suspended;
    this.completed = Number.isSafeInteger(data?.completed) ? Math.max(0, data.completed) : 0;
    this.order = this.owned && data?.order ? { ...data.order, pickedUp: data.order.pickedUp === true } : null;
    if (this.order && !this.job) this.order = null;
    if (this.order?.pickedUp) {
      this.order.secondsLeft = Number.isFinite(this.order.secondsLeft) ? Math.max(0, this.order.secondsLeft) : this._timeFor(this.job);
    }
    this.equipped = [];
    if (this.owned) {
      this._giveGear();
      this.setGear(Array.isArray(data.equipped) ? data.equipped : DELIVERY_ITEMS.map(item => item.deliveryGear), { applyLook: false, save: false });
    }
    this.game.player.setDeliveryGear?.(this.equipped);
  }
}
