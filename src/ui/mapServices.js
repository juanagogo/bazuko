// src/ui/mapServices.js
// De la necesidad al lugar: puestos, fogatas y precios para el radar y el mapa. Sin DOM ni THREE.
import { ITEMS, SHOP_ITEMS, dealerOffer, isForSale } from '../data/items.js';
import { cop } from '../utils/money.js';

export const FILTERS = [['todo', 'Todo'], ['comida', 'Comida'], ['agua', 'Agua'], ['calor', 'Calor'], ['vender', 'Vender']];

export const NEED_COPY = {
  comida: { label: 'Comida', alert: '🍲 Tengo mucha hambre', cta: 'Ir a la comida más cercana' },
  agua: { label: 'Agua', alert: '💧 Tengo mucha sed', cta: 'Ir al agua más cercana' },
  calor: { label: 'Calor', alert: '🥶 Me estoy congelando', cta: 'Ir al calor más cercano' },
  vender: { label: 'Vender', alert: '🎒 El costal va casi lleno', cta: 'Ir a vender' },
};

const OFFERS = ['comida', 'agua', 'calor'];
const STALLS = { chaza: { icon: '🍬', color: '#f78fb3' }, fritanga: { icon: '🥟', color: '#ff9f43' } };

/** Compras de comida, agua y calor con su precio y sus kilos. Con `itemIds`, solo en ese catálogo (el mismo filtro de openShop). */
export function offersFor(itemIds = null) {
  const offers = {};
  const offer = (tag, price, weight) => { (offers[tag] ??= []).push({ price, weight }); };
  for (const { item, price, qty = 1 } of SHOP_ITEMS) {
    if (!item || (itemIds && !itemIds.includes(item))) continue;
    const { consumable, calor, weight = 0 } = ITEMS[item] ?? {};
    if (consumable === 'hambre') offer('comida', price, weight * qty);
    if (consumable === 'sed') offer('agua', price, weight * qty);
    if (calor > 0) offer('calor', price, weight * qty);
  }
  return offers;
}

/** Precio mínimo de comida, agua y calor. */
export function pricesFor(itemIds = null) {
  return Object.fromEntries(Object.entries(offersFor(itemIds)).map(([tag, list]) => [tag, Math.min(...list.map(({ price }) => price))]));
}

export const SHOP_PRICES = pricesFor();
export const SHOP_OFFERS = offersFor();

/** Un lugar por cada puesto y cada fogata del distrito. Un precio de 0 significa gratis. */
export function servicePlaces(district) {
  const stalls = (district?.vendors ?? []).map(({ stall = 'chaza', title, items, position }) => ({
    name: title, ...STALLS[stall], x: position.x, z: position.z, service: stall, prices: pricesFor(items), offers: offersFor(items),
  }));
  const fires = (district?.fireBarrels ?? []).map(({ title, position }) => ({
    name: title, icon: '🔥', color: '#ff6b35', x: position.x, z: position.z, service: 'fogata', prices: { calor: 0 },
  }));
  return [...stalls, ...fires];
}

/** La necesidad más urgente, con los mismos umbrales que los avisos del HUD. */
export function needFor({ isFreezing = false, sed = 100, hambre = 100, load = 0, carriesRecyclables = false } = {}) {
  if (sed <= 0) return 'agua';
  if (hambre <= 0) return 'comida';
  if (isFreezing) return 'calor';
  if (sed <= 20) return 'agua';
  if (hambre <= 20) return 'comida';
  if (load >= .9 && carriesRecyclables) return 'vender';
  return null;
}

/**
 * Lo que el radar y el mapa necesitan saber del jugador: `carried` guarda nombres de objeto; `kg` y `maxKg`, el costal;
 * `recycleValue`, `recycleKg` y `substanceValue`, lo que dejaría vender todo. Sin el impulso de adrenalina, que se acaba.
 */
export function needContext({ stats, inventory, load = 0, night = false, sellMult = 1, substanceMult = 1, equippedWeapon = null } = {}) {
  const carried = {};
  let carriesRecyclables = false, carriesSubstances = false, recycleValue = 0, recycleKg = 0, substanceValue = 0;
  for (const entry of inventory?.items ?? []) {
    const item = ITEMS[entry.id] ?? entry;
    const qty = entry.qty ?? 1, value = (item.value ?? 0) * qty;
    if (isForSale(item, equippedWeapon)) {
      carriesRecyclables = true;
      recycleValue += value * sellMult;
      recycleKg += (item.weight ?? 0) * qty;
    }
    if (item.substance) {
      carriesSubstances = true;
      substanceValue += dealerOffer(item, substanceMult) * qty;
    }
    if (item.consumable === 'hambre') carried.comida ??= item.name;
    if (item.consumable === 'sed') carried.agua ??= item.name;
    if (item.calor > 0) carried.calor ??= item.name;
  }
  const need = stats ? needFor({ isFreezing: stats.isFreezing, sed: stats.sed, hambre: stats.hambre, load, carriesRecyclables }) : null;
  return {
    need, money: stats?.dinero ?? 0, kg: inventory?.totalWeight ?? 0, maxKg: inventory?.maxWeight ?? Infinity,
    carriesRecyclables, recycleValue: Math.round(recycleValue), recycleKg,
    carriesSubstances, substanceValue: Math.round(substanceValue), night: !!night, carried,
  };
}

/** El Dealer no compra reciclaje: aparece en «Vender» por `dealer`, no por un precio. */
export const hasTag = (poi, tag) => poi.prices?.[tag] !== undefined || (tag === 'vender' && !!poi.dealer);

/** Lo más barato de `tag` que se puede pagar y que cabe en el costal, con la misma cuenta de openShop; Infinity si no hay nada. */
function cheapestFit(poi, tag, { money = 0, kg = 0, maxKg = Infinity } = {}) {
  const listed = poi.prices?.[tag];
  if (listed === undefined) return Infinity;
  let cheapest = Infinity;
  for (const { price, weight } of poi.offers?.[tag] ?? [{ price: listed, weight: 0 }]) {
    // Lo que no pesa siempre cabe: al soltar la carreta se puede llevar más de lo permitido.
    if (price <= money && (!weight || kg + weight <= maxKg) && price < cheapest) cheapest = price;
  }
  return cheapest;
}

/**
 * Dónde vender para poder resolver `need` después, solo si con lo cobrado alcanza y cabe: si no, el viaje no sirve.
 * Al Dealer no se le cuenta el peso: lo que compra apenas libera el costal.
 */
export function sellFirstPlaces(pois, need, { money = 0, kg = 0, maxKg = Infinity, recycleValue = 0, recycleKg = 0, substanceValue = 0, night = false } = {}) {
  const solvedWith = (after) => pois.some(poi => cheapestFit(poi, need, after) !== Infinity);
  const recycling = recycleValue > 0 && solvedWith({ money: money + recycleValue, kg: kg - recycleKg, maxKg });
  const dealing = night && substanceValue > 0 && solvedWith({ money: money + substanceValue, kg, maxKg });
  return pois.filter(poi => (poi.dealer ? dealing : poi.prices?.vender === 0 && recycling));
}

/**
 * Qué sugiere el radar para la necesidad actual, en línea recta porque corre a 20 Hz. Devuelve { tag, carried },
 * { tag, poi, price, dist }, { tag, poi, sellFirst, full, price, dist }, { tag, broke, price }, { tag, full, price } o null.
 */
export function suggestPlace(pois, from, needs = {}) {
  const { need = null, money = 0, carried = {} } = needs;
  if (!need) return null;
  if (carried[need]) return { tag: need, carried: carried[need] };
  const distance = (poi) => Math.hypot(poi.x - from.x, poi.z - from.z);
  let best = null, bestDist = Infinity, bestPrice = 0, cheapest = Infinity, full = false;
  for (const poi of pois) {
    const listed = poi.prices?.[need];
    if (listed === undefined) continue;
    cheapest = Math.min(cheapest, listed);
    const price = cheapestFit(poi, need, needs);
    if (price === Infinity) { full ||= cheapestFit(poi, need, { money }) !== Infinity; continue; }
    const dist = distance(poi);
    if (dist < bestDist) { bestDist = dist; best = poi; bestPrice = price; }
  }
  if (best) return { tag: need, poi: best, price: bestPrice, dist: bestDist };
  if (cheapest === Infinity) return null;
  const buyer = sellFirstPlaces(pois, need, needs).sort((a, b) => distance(a) - distance(b))[0];
  // Venderle al Dealer da plata, no espacio: quien va allá va por lo que sí cabe y aún no alcanza.
  if (buyer) return { tag: need, poi: buyer, sellFirst: true, full: full && !buyer.dealer, price: cheapest, dist: distance(buyer) };
  return { tag: need, [full ? 'full' : 'broke']: true, price: cheapest };
}

/** Las dos líneas del radar para una sugerencia. */
export function suggestionText(s, hint = '', distance = '') {
  if (s.carried) return `🎒 Llevo: ${s.carried}\nUsar desde el costal (I)`;
  const word = NEED_COPY[s.tag].label;
  if (s.broke) return `💸 Sin plata para ${word.toLowerCase()}\nDesde ${cop(s.price)}, pida limosna (B)`;
  if (s.full && !s.poi) return `🎒 Sin espacio para ${word.toLowerCase()}\nTire algo del costal (I)`;
  const reason = s.sellFirst ? (s.full ? 'Costal lleno: venda' : 'Sin plata: venda')
    : s.tag === 'vender' ? 'Costal lleno'
    : s.price === 0 ? `${word} gratis` : `${word} ${cop(s.price)}`;
  return `${s.poi.icon} ${s.poi.name}\n${[reason, distance, hint].filter(Boolean).join(', ')}`;
}

/**
 * Lo que el cartón escribe bajo el destino: el precio, si lo hay, y qué hacer. La tecla va entre paréntesis al final;
 * quien pinta decide si se ve. `precio` y `hacer` van aparte porque en la pantalla más angosta no caben los dos.
 */
export function ordenDeSugerencia(s) {
  if (!s) return null;
  if (s.carried) return { precio: '', hacer: 'Usar desde el costal (I)' };
  const word = NEED_COPY[s.tag].label;
  const valor = s.price === 0 ? `${word} gratis` : `${word} ${cop(s.price)}`;
  if (s.broke) return { precio: valor, hacer: 'Sin plata: pida limosna (B)' };
  if (s.full && !s.poi) return { precio: '', hacer: 'Tire algo del costal (I)' };
  if (s.sellFirst) return { precio: valor, hacer: s.full ? 'Costal lleno: venda' : 'Sin plata: venda' };
  if (s.tag === 'vender') return { precio: '', hacer: 'Costal lleno: venda' };
  return { precio: valor, hacer: '' };
}

/** Dónde queda lo más cercano que venda `tag`, aunque hoy no alcance la plata: sirve para saber a dónde ir después. */
export function masCercanoQueVende(pois, from, tag) {
  let mejor = null, distancia = Infinity;
  for (const poi of pois) {
    if (poi.prices?.[tag] === undefined) continue;
    const d = Math.hypot(poi.x - from.x, poi.z - from.z);
    if (d < distancia) { distancia = d; mejor = poi; }
  }
  return mejor ? { poi: mejor, dist: distancia } : null;
}

export function isUsable(poi, tag, needs = {}) {
  if (!tag) return true;
  const { carriesRecyclables = false, carriesSubstances = false, night = false } = needs;
  if (tag === 'vender') return poi.dealer ? night && carriesSubstances : carriesRecyclables;
  return cheapestFit(poi, tag, needs) !== Infinity;
}

/**
 * Filas de «Ir a…»: un lugar por nombre (las cuatro fogatas ocupan una fila, la más cercana a pie),
 * ordenadas por metros a pie. Con `tag`, primero las que se pueden usar. `walk` devuelve null si no hay camino.
 */
export function rankPlaces(pois, { tag = null, walk, needs = {}, from = null } = {}) {
  const straight = (poi) => from ? Math.hypot(poi.x - from.x, poi.z - from.z) : 0;
  const nearer = (a, b) => {
    if (a.meters === null || b.meters === null) {
      if (a.meters !== b.meters) return a.meters === null ? 1 : -1;
      return straight(a.poi) - straight(b.poi);
    }
    return a.meters - b.meters;
  };
  const byName = new Map();
  for (const poi of pois) {
    if (poi.name === 'El Chato' || (tag && !hasTag(poi, tag))) continue;
    const row = { poi, meters: walk(poi), usable: isUsable(poi, tag, needs) };
    const known = byName.get(poi.name);
    if (!known || nearer(row, known) < 0) byName.set(poi.name, row);
  }
  return [...byName.values()].sort((a, b) => (tag && a.usable !== b.usable ? (a.usable ? -1 : 1) : nearer(a, b)));
}

/** Segunda línea de cada fila: qué ofrece el lugar y desde qué precio. */
export function placeMeta(poi, tag = null, needs = {}) {
  const { money = 0, night = false } = needs;
  if (poi.service === 'fogata') return 'Calor gratis, El Cartucho';
  if (poi.name === 'Crafteo') return 'Se abre con C, desde cualquier sitio';
  if (poi.dealer) return `Vende siempre. Compra ${night ? 'hasta las 6:00' : 'desde las 20:00'}`;
  if (poi.prices?.vender === 0) return 'Compra reciclaje';
  if (poi.decor) return 'Solo referencia, no vende';
  if (!poi.prices) return null;
  if (tag) {
    const price = poi.prices[tag];
    const problem = price > money ? ', sin plata' : isUsable(poi, tag, needs) ? '' : ', no cabe';
    return `${NEED_COPY[tag].label} desde ${cop(price)}${problem}`;
  }
  const offers = OFFERS.filter(offer => poi.prices[offer] !== undefined);
  const names = offers.map((offer, i) => (i ? NEED_COPY[offer].label.toLowerCase() : NEED_COPY[offer].label));
  return `${names.join(', ')}, desde ${cop(Math.min(...offers.map(offer => poi.prices[offer])))}`;
}

/** Por qué ninguna fila se puede usar. `seller` es el lugar al que manda «Ir a vender»: el texto dice lo que se vende allá. */
export function noOptionText(tag, rows, { money = 0, carriesRecyclables = false, carriesSubstances = false, night = false } = {}, seller = null) {
  if (!rows.length) return null;
  if (tag === 'vender') return carriesSubstances && !night ? 'El jíbaro solo compra de noche, desde las 20:00.' : 'No llevo nada que me compren.';
  const cheapest = Math.min(...rows.map(row => row.poi.prices[tag]));
  if (cheapest <= money) {
    if (seller?.dealer) return 'Lo que alcanza no cabe: venda sustancias o tire algo.';
    return carriesRecyclables ? 'No cabe en el costal: venda material o tire algo.' : 'No cabe en el costal: tire algo.';
  }
  const sellsSubstances = seller ? seller.dealer : !carriesRecyclables && carriesSubstances && night;
  const beg = sellsSubstances ? 'Venda sustancias o pida' : seller || carriesRecyclables ? 'Venda material o pida' : 'Pida';
  return `No alcanza: ${NEED_COPY[tag].label.toLowerCase()} desde ${cop(cheapest)}. ${beg} limosna (B).`;
}
