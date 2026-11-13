// La vida de calle: caleta, comida que se daña, armas que se gastan, fama, cuidar carros, transporte y hogar de paso.
// Lógica pura, sin ciudad: cada regla se prueba con lo que el jugador ve que pasa.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { ITEMS } from '../src/data/items.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { Caleta, CALETA_KG } from '../src/systems/Caleta.js';
import { FreshnessSystem, freshness, freshnessLabel } from '../src/systems/Freshness.js';
import { wearWeapon, usesLeft } from '../src/systems/WeaponWear.js';
import { Reputation, FAMA, FAMA_ACCION, famaNivel, famaEfecto, avisoDeFama } from '../src/systems/Reputation.js';
import { CarGuarding, GUARD } from '../src/systems/CarGuarding.js';
import { resolveTrip, sneakRisk, travelMinutes, PASAJE } from '../src/systems/Transit.js';
import { HOGAR, checkIn, checkOut, contraband, hasRoom, isOpen, nightEffects } from '../src/systems/Shelter.js';
import { StreetLife, foodToShare } from '../src/systems/StreetLife.js';
import { openShop } from '../src/ui/placeMenus.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

const seq = (...values) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };
const inventoryAt = (hour) => { const inv = new InventorySystem(); inv.now = () => hour.value; return inv; };

test('la caleta crece con el cambuche y sin base no existe', () => {
  const caleta = new Caleta();
  assert.equal(caleta.capacity({}), 0);
  assert.equal(caleta.capacity({ base: true }), CALETA_KG.base);
  assert.equal(caleta.capacity({ base: true, paredes: true, techo: true }), CALETA_KG.base + CALETA_KG.paredes + CALETA_KG.techo);
});

test('guardar y sacar respeta los kilos de los dos lados', () => {
  const inv = new InventorySystem(), caleta = new Caleta(), built = { base: true };
  inv.add(ITEMS.chatarra, 10); // 10 kg
  assert.equal(caleta.store(inv, 'chatarra', 10, built), CALETA_KG.base, 'solo cabe lo que da la base');
  assert.equal(inv.count('chatarra'), 10 - CALETA_KG.base);
  assert.equal(caleta.store(inv, 'chatarra', 1, built), 0, 'llena');
  inv.maxWeight = inv.totalWeight + 2;
  assert.equal(caleta.take(inv, 'chatarra', 6), 2, 'saca lo que cabe en el costal');
  assert.equal(caleta.count('chatarra'), CALETA_KG.base - 2);
});

test('la caleta se guarda con la partida y no deja pasar objetos que ya no existen', () => {
  const caleta = new Caleta();
  caleta.deserialize({ items: [{ id: 'pan', qty: 2, vence: [30, 31] }, { id: 'nada', qty: 3 }, { id: 'lata', qty: 0 }] });
  assert.deepEqual(caleta.items.map((e) => e.id), ['pan']);
  const otra = new Caleta();
  otra.deserialize(caleta.serialize());
  assert.deepEqual(otra.items, caleta.items);
});

test('sin paredes, a veces dan con la caleta y se llevan la mitad', () => {
  const caleta = new Caleta();
  caleta.items = [{ id: 'lata', qty: 4 }, { id: 'moneda', qty: 1 }];
  assert.deepEqual(caleta.robOnSleep(() => .99), [], 'casi siempre no la encuentran');
  const lost = caleta.robOnSleep(() => 0);
  assert.deepEqual(lost, [{ id: 'lata', qty: 2 }, { id: 'moneda', qty: 1 }]);
  assert.deepEqual(caleta.items, [{ id: 'lata', qty: 2 }]);
});

test('lo perecible entra con su hora de vencimiento y se come primero lo más viejo', () => {
  const hour = { value: 10 };
  const inv = inventoryAt(hour);
  inv.add(ITEMS.empanada, 1);
  hour.value = 12;
  inv.add(ITEMS.empanada, 1);
  const entry = inv.items[0];
  assert.deepEqual(entry.vence, [10 + ITEMS.empanada.perece, 12 + ITEMS.empanada.perece]);
  inv.remove('empanada', 1);
  assert.deepEqual(entry.vence, [12 + ITEMS.empanada.perece]);
  // lo que no se daña no lleva hora
  inv.add(ITEMS.lataComida, 1);
  assert.equal(inv.items.find((e) => e.id === 'lataComida').vence, undefined);
});

test('vencimientos y desgaste sobreviven al guardar el costal', () => {
  const hour = { value: 5 };
  const inv = inventoryAt(hour);
  inv.add(ITEMS.pan, 2);
  inv.add(ITEMS.cuchillo, 1);
  inv.items.find((e) => e.id === 'cuchillo').usos = 7;
  const copia = new InventorySystem();
  copia.deserialize(JSON.parse(JSON.stringify(inv.serialize())));
  assert.deepEqual(copia.items.find((e) => e.id === 'pan').vence, [5 + ITEMS.pan.perece, 5 + ITEMS.pan.perece]);
  assert.equal(copia.items.find((e) => e.id === 'cuchillo').usos, 7);
});

test('la caleta conserva la hora de lo que guardo: no rejuvenece al sacarlo', () => {
  const hour = { value: 0 };
  const inv = inventoryAt(hour), caleta = new Caleta(), built = { base: true };
  inv.add(ITEMS.empanada, 2);
  hour.value = 5;
  caleta.store(inv, 'empanada', 2, built);
  assert.equal(inv.count('empanada'), 0);
  assert.deepEqual(caleta.items[0].vence, [ITEMS.empanada.perece, ITEMS.empanada.perece]);
  caleta.take(inv, 'empanada', 1);
  assert.deepEqual(inv.items[0].vence, [ITEMS.empanada.perece], 'sale con la hora con que entró');
  assert.deepEqual(caleta.items[0].vence, [ITEMS.empanada.perece]);
});

test('al pasar su hora la comida se vuelve comida dañada, en el costal y en la caleta', () => {
  const hour = { value: 0 };
  const inv = inventoryAt(hour), caleta = new Caleta();
  inv.add(ITEMS.empanada, 2);
  inv.add(ITEMS.pan, 1);
  caleta.items = [{ id: 'papaCriolla', qty: 1, vence: [3] }];
  const fresh = new FreshnessSystem({ inventory: inv, caleta, now: () => hour.value });
  hour.value = ITEMS.empanada.perece + .1;
  const result = fresh.check();
  assert.deepEqual(result.bag, { empanada: 2 });
  assert.equal(inv.count('empanada'), 0);
  assert.equal(inv.count('comidaDanada'), 2);
  assert.equal(inv.count('pan'), 1, 'el pan dura más');
  assert.deepEqual(caleta.items, [{ id: 'comidaDanada', qty: 1 }]);
});

test('con el costal pasado de peso, lo que se daña también queda como comida dañada: no desaparece', () => {
  const hour = { value: 0 };
  const inv = inventoryAt(hour);
  inv.add(ITEMS.chatarra, 15);
  inv.add(ITEMS.empanada, 4);
  inv.maxWeight = 10; // llevo más de lo que aguanto, como al perder capacidad con todo encima
  const fresh = new FreshnessSystem({ inventory: inv, now: () => hour.value });
  hour.value = ITEMS.empanada.perece + .1;
  assert.deepEqual(fresh.check().bag, { empanada: 4 });
  assert.equal(inv.count('empanada'), 0);
  assert.equal(inv.count('comidaDanada'), 4);
  assert.equal(inv.add(ITEMS.lata, 1), false, 'lo demás sigue sin caber');
});

test('la comida avisa una vez antes de dañarse y su barra baja con el reloj', () => {
  const hour = { value: 0 };
  const inv = inventoryAt(hour);
  inv.add(ITEMS.morcilla, 1);
  const fresh = new FreshnessSystem({ inventory: inv, now: () => hour.value });
  assert.equal(freshness(inv.items[0], 0), 1);
  assert.equal(freshnessLabel(inv.items[0], 0), `Se daña en ${ITEMS.morcilla.perece} h`);
  hour.value = ITEMS.morcilla.perece - 1;
  assert.deepEqual(fresh.check().soon, ['Morcilla criolla']);
  assert.deepEqual(fresh.check().soon, [], 'el aviso no se repite');
  assert.equal(freshnessLabel(inv.items[0], hour.value), 'Se daña en 1 h');
});

test('lo que entró sin hora (partidas viejas) empieza a contar al revisarlo', () => {
  const inv = new InventorySystem();
  inv.add(ITEMS.empanada, 1); // sin reloj: sin vencimiento
  const fresh = new FreshnessSystem({ inventory: inv, now: () => 100 });
  fresh.check();
  assert.deepEqual(inv.items[0].vence, [100 + ITEMS.empanada.perece]);
});

test('el arma se gasta con cada golpe, avisa al quedar poca y al final se parte', () => {
  const inv = new InventorySystem();
  inv.add(ITEMS.botella_picada, 2);
  const max = ITEMS.botella_picada.durabilidad;
  const results = [];
  for (let i = 0; i < max; i++) results.push(wearWeapon(inv, 'botella_picada'));
  assert.ok(results.some((r) => r.warn), 'avisa antes de partirse');
  assert.equal(results.filter((r) => r.warn).length, 1, 'una sola vez');
  assert.deepEqual(results.at(-1), { broke: true, name: 'Botella picada', left: 1 });
  assert.equal(inv.count('botella_picada'), 1);
  assert.equal(usesLeft(inv.items[0]), max, 'la siguiente sale entera');
  assert.deepEqual(wearWeapon(inv, 'punos'), {}, 'los puños no se gastan');
});

test('la fama sube y baja por lo que hago, y cada nivel cambia algo que se ve', () => {
  const fama = new Reputation();
  assert.equal(famaNivel(fama.chazas), 'normal');
  assert.equal(fama.priceMult(), 1);
  let cambios = [];
  for (let i = 0; i < 5; i++) cambios.push(...fama.apply('comprarChaza'));
  assert.equal(fama.chazas, FAMA.inicio + 10);
  assert.deepEqual(cambios.map((c) => c.despues), ['buena']);
  assert.match(avisoDeFama(cambios[0]), /fían/);
  assert.ok(fama.canCredit(2000));
  for (let i = 0; i < 4; i++) fama.apply('pegarVendedor');
  assert.equal(famaNivel(fama.chazas), 'mala');
  assert.equal(fama.priceMult(), 1.2);
  assert.ok(!fama.canCredit(100));
  assert.match(famaEfecto('calle', 10), /fogata/);
});

test('el fiado se paga al comprar y, si no, quedo mal pasado un día', () => {
  const fama = new Reputation();
  fama.chazas = FAMA.buena;
  fama.credit(2500, 10);
  assert.equal(fama.debtHoursLeft(20), FAMA.fiadoHoras - 10);
  const stats = { dinero: 1000 };
  assert.equal(fama.payDebt(stats), 1000);
  assert.equal(fama.deuda, 1500);
  assert.equal(fama.checkDebt(20), null, 'todavía hay tiempo');
  const mal = fama.checkDebt(10 + FAMA.fiadoHoras);
  assert.equal(mal.perdida, 1500);
  assert.equal(fama.deuda, 0);
  assert.ok(fama.chazas < FAMA.buena);
  const otra = new Reputation();
  otra.deserialize(JSON.parse(JSON.stringify(fama.serialize())));
  assert.deepEqual(otra.serialize(), fama.serialize());
});

/** Lo mínimo del DOM para armar un menú sin navegador: cada nodo guarda sus hijos, su texto y su clic. */
function domDePrueba() {
  const nodo = (tag) => ({
    tag, className: '', textContent: '', children: [], attributes: {},
    addEventListener(evento, fn) { this[`on${evento}`] = fn; },
    setAttribute(k, v) { this.attributes[k] = v; },
    append(...hijos) { for (const h of hijos) { if (typeof h === 'string') this.textContent += h; this.children.push(h); } },
  });
  globalThis.document = { createElement: nodo };
}
const botonesDe = (n, todos = []) => {
  if (n?.tag === 'button') todos.push(n);
  for (const h of n?.children ?? []) botonesDe(h, todos);
  return todos;
};

test('comprar fiado no sube la fama con las chazas: sube al pagar lo que debo y al comprar de contado', () => {
  domDePrueba();
  try {
    const fama = new Reputation();
    fama.chazas = 80;
    const game = { totalGameHours: 30, stats: { dinero: 0 }, inventory: new InventorySystem(1e6), costal: false,
      audio: { play() {} }, street: { fama }, menu: { open(o) { this.o = o; }, refresh() {} } };
    const chaza = { title: 'Chaza de la Mona', items: ['papaCriolla'] };
    const boton = (texto) => botonesDe(game.menu.o.render().body).find((b) => b.textContent === texto && !('disabled' in b.attributes));
    openShop(game, chaza);
    let fiadas = 0;
    for (let b = boton('Fiado'); b; b = boton('Fiado')) { b.onclick(); fiadas++; }
    assert.ok(fiadas >= 5, `me fiaron ${fiadas} veces`);
    assert.ok(fama.deuda > 0);
    assert.equal(fama.chazas, 80, 'lo fiado todavía no es una compra');
    game.stats.dinero = 20000;
    openShop(game, chaza); // al volver se paga solo
    assert.equal(fama.deuda, 0);
    assert.equal(fama.chazas, 80 + FAMA_ACCION.pagarFiado.chazas);
    boton('Comprar').onclick();
    assert.equal(fama.chazas, 80 + FAMA_ACCION.pagarFiado.chazas + FAMA_ACCION.comprarChaza.chazas);
  } finally { delete globalThis.document; }
});

test('al quedar mal con el fiado, «ya no me creen» solo si de verdad dejaron de fiarme', () => {
  const quedarMal = (famaAntes) => {
    const avisos = [];
    window.addEventListener('toast', (e) => avisos.push(e.detail.text));
    const game = { inventory: new InventorySystem(), totalGameHours: 10, player: { position: { x: 0, z: 0 } } };
    const calle = new StreetLife(game);
    calle.fama.chazas = famaAntes;
    calle.fama.credit(2000, 10);
    game.totalGameHours += FAMA.fiadoHoras;
    calle.update(.1);
    return { aviso: avisos.find((t) => t.startsWith('No pagué el fiado')), meFian: calle.fama.canCredit(1) };
  };
  const todaviaMeFian = quedarMal(90);
  assert.equal(todaviaMeFian.meFian, true);
  assert.match(todaviaMeFian.aviso, /quedé mal con los de las chazas/);
  const yaNoMeFian = quedarMal(70);
  assert.equal(yaNoMeFian.meFian, false);
  assert.match(yaNoMeFian.aviso, /ya no me creen/);
});

test('cuidar un carro paga cuando vuelve el dueño si no me alejo', () => {
  const car = { position: { x: 0, z: 0 }, traffic: null, used: false };
  const guard = new CarGuarding({ random: seq(0, .5, .5) });
  assert.ok(guard.canGuard(car));
  assert.ok(!guard.canGuard({ ...car, traffic: {} }), 'al que va andando no');
  assert.ok(guard.start(car));
  assert.equal(guard.wait, GUARD.waitMin);
  let event = null;
  for (let t = 0; t < GUARD.waitMin + 1 && !event; t += 1) event = guard.update(1, { x: 1, z: 0 });
  assert.equal(event.type, 'paid');
  assert.ok(event.amount >= GUARD.tipMin && event.amount <= GUARD.tipMax);
  assert.ok(!guard.active);
  assert.ok(!guard.canGuard(car), 'el mismo carro espera un rato');
});

test('al alejarme avisa una vez, y si sigo lejos pierdo el turno', () => {
  const car = { position: { x: 0, z: 0 }, traffic: null, used: false };
  const guard = new CarGuarding({ random: () => .5 });
  guard.start(car);
  assert.deepEqual(guard.update(1, { x: GUARD.stay + 1, z: 0 }), { type: 'far', seconds: GUARD.graceSeconds });
  assert.equal(guard.update(1, { x: GUARD.stay + 1, z: 0 }), null);
  guard.update(1, { x: 0, z: 0 });
  assert.equal(guard.away, 0, 'al volver se perdona');
  assert.deepEqual(guard.update(1, { x: GUARD.leave + 1, z: 0 }), { type: 'left' });
  assert.ok(!guard.active);
  guard.start({ position: { x: 0, z: 0 }, used: false });
  guard.car.used = true;
  assert.deepEqual(guard.update(1, { x: 0, z: 0 }), { type: 'spoiled' }, 'si le roban, se acaba');
});

test('el transporte: pagar cuesta el pasaje, colarse es gratis pero arriesgado', () => {
  assert.deepEqual(resolveTrip({ modo: 'pagar', dinero: PASAJE - 1 }).motivo, 'plata');
  assert.deepEqual(resolveTrip({ modo: 'pagar', dinero: PASAJE, random: () => .9 }), { ok: true, pagado: PASAJE, ganado: 0, pillado: false });
  assert.ok(sneakRisk(3) > sneakRisk(0), 'fichado, más fácil que lo pillen');
  assert.equal(resolveTrip({ modo: 'colarse', random: () => 0 }).pillado, true);
  assert.equal(resolveTrip({ modo: 'colarse', random: () => .99 }).pagado, 0);
  const pidiendo = resolveTrip({ modo: 'colarse', pedir: true, random: seq(.99, .99, .5) });
  assert.ok(pidiendo.ganado > 0);
  assert.equal(resolveTrip({ modo: 'colarse', pedir: true, malOlor: true, random: () => .99 }).ganado, 0, 'con mal olor nadie da');
  assert.ok(travelMinutes({ x: 0, z: 0 }, { x: 0, z: 200 }) > travelMinutes({ x: 0, z: 0 }, { x: 0, z: 50 }));
});

test('el hogar de paso: horario, cupo estable por noche y reglas en la puerta', () => {
  assert.ok(isOpen(HOGAR.abre) && isOpen(22) && !isOpen(HOGAR.cierra) && !isOpen(3) && !isOpen(12));
  assert.equal(hasRoom(7), hasRoom(7), 'preguntar otra vez no cambia el cupo');
  const noches = Array.from({ length: 200 }, (_, d) => hasRoom(d + 1)).filter(Boolean).length;
  assert.ok(noches > 120 && noches < 180, `cupo casi todas las noches (${noches} de 200)`);

  const inv = new InventorySystem();
  inv.add(ITEMS.pegante, 2);
  inv.add(ITEMS.cuchillo, 1);
  inv.add(ITEMS.pan, 1);
  inv.items.find((e) => e.id === 'cuchillo').usos = 9;
  assert.equal(contraband(inv, 'cuchillo').armas[0].enMano, true);
  const { entregadas, porteria } = checkIn(inv, 'cuchillo');
  assert.deepEqual(entregadas.map((s) => s.id), ['pegante']);
  assert.equal(inv.count('pegante') + inv.count('cuchillo'), 0);
  assert.equal(inv.count('pan'), 1);
  assert.deepEqual(checkOut(inv, porteria), []);
  assert.equal(inv.count('cuchillo'), 1);
  assert.equal(inv.items.find((e) => e.id === 'cuchillo').usos, 9, 'sale como entró');
  assert.equal(inv.count('pegante'), 0, 'las sustancias no vuelven');

  const stats = { energia: 10, salud: 50, hambre: 20, sed: 20, animo: 30, higiene: 5, vicio: 40 };
  nightEffects(stats);
  assert.equal(stats.higiene, HOGAR.higiene);
  assert.equal(stats.vicio, 40 - HOGAR.vicio);
  assert.equal(stats.energia, 10 + HOGAR.energia);
});

test('se comparte primero lo que se va a dañar antes, nunca lo dañado', () => {
  const hour = { value: 0 };
  const inv = inventoryAt(hour);
  inv.add(ITEMS.lataComida, 1);
  inv.add(ITEMS.pan, 1);
  inv.add(ITEMS.empanada, 1);
  inv.add(ITEMS.comidaDanada, 3);
  assert.equal(foodToShare(inv).id, 'empanada');
  const solo = new InventorySystem();
  solo.add(ITEMS.comidaDanada, 1);
  assert.equal(foodToShare(solo), null);
});

test('el catálogo nuevo: agua de la calle y comida dañada pueden caer mal; la botella se usa', () => {
  assert.equal(ITEMS.aguaCalle.consumable, 'sed');
  assert.equal(ITEMS.aguaCalle.riesgo.enfermedad, 'intoxicacion');
  assert.ok(ITEMS.comidaDanada.riesgo.prob >= .5);
  assert.ok(ITEMS.botella.usable);
  for (const id of ['cuchillo', 'botella_picada', 'arma']) assert.ok(ITEMS[id].durabilidad > 0, id);
});

test('la tecla de contexto dice qué hace cada lugar nuevo', async () => {
  const { textoDelPrompt } = await import('../src/ui/HUD.js');
  const inv = new InventorySystem();
  const guard = new CarGuarding();
  const street = { guard };
  const parked = { stealable: true, cleanable: true, traffic: null, used: false, position: { x: 0, z: 0 } };
  assert.equal(textoDelPrompt({ currentTarget: parked, currentTargetType: 'car', street }, inv), '[E] Robar retrovisor del carro · [Q] Cuidarlo (propina del dueño)');
  guard.start(parked);
  assert.match(textoDelPrompt({ currentTarget: parked, currentTargetType: 'car', street }, inv), /Lo estoy cuidando/);
  const moving = { ...parked, traffic: {} };
  assert.match(textoDelPrompt({ currentTarget: moving, currentTargetType: 'car', street }, inv), /Limpiar parabrisas/);
  assert.match(textoDelPrompt({ currentTarget: {}, currentTargetType: 'pila' }, inv), /^\[E\] Lavarme en la pila · Con una botella/);
  inv.add(ITEMS.botella, 1);
  assert.equal(textoDelPrompt({ currentTarget: {}, currentTargetType: 'pila' }, inv), '[E] Lavarme en la pila · [Q] Llenar la botella');
  assert.match(textoDelPrompt({ currentTarget: {}, currentTargetType: 'fireBarrel' }, inv), /da confianza/);
  inv.add(ITEMS.pan, 1);
  assert.equal(textoDelPrompt({ currentTarget: {}, currentTargetType: 'fireBarrel' }, inv), '[E] Calentarme en la fogata · [Q] Compartir comida');
  assert.equal(textoDelPrompt({ currentTarget: { stop: { name: 'Portal del Centro' } }, currentTargetType: 'transit' }, inv), '[E] Portal del Centro: viajar');
  assert.equal(textoDelPrompt({ currentTarget: {}, currentTargetType: 'hogar' }, inv), '[E] Hogar de paso: dormir bajo techo');
});
