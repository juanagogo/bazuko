// Pruebas de la calle: raspar ladrillo, el refugio de chamber, los bocadillos gigantes y dormir en un cartón.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { BOCADILLO, BRICK, CARTON_SLEEP, CHAMBER, CalleSystem, cartonSleepOutcome } from '../src/features/calle.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { ITEMS } from '../src/data/items.js';
import { fakePool } from './fakePool.js';

const toasts = [];
globalThis.window = Object.assign(globalThis.window ?? new EventTarget(), { dispatchEvent(e) { if (e.type === 'toast') toasts.push(e.detail.text); return true; } });
globalThis.CustomEvent ??= class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };

const points = Array.from({ length: 40 }, (_, i) => new THREE.Vector3((i % 8) * 30, 0, Math.floor(i / 8) * 30));

async function build({ random = () => .9, dinero = 10000, withPeople = true } = {}) {
  const player = { position: new THREE.Vector3(500, 0, 500), playAction() {} };
  const stats = { salud: 80, energia: 50, animo: 50, higiene: 80, dinero, calor: 0 };
  const inventory = new InventorySystem();
  const people = withPeople ? await fakePool(20) : null;
  const registered = [];
  const calle = new CalleSystem(new THREE.Scene(), { player, stats, inventory, people, random });
  calle.setup({ getGroundHeight: () => 0 }, points, { interaction: { register: t => registered.push(t), unregister: t => registered.splice(registered.indexOf(t), 1) }, avoid: new THREE.Vector3(0, 0, 0) });
  return { calle, player, stats, inventory, people, registered };
}

const run = (calle, seconds, ctx = {}, dt = .25) => { for (let t = 0; t < seconds; t += dt) calle.update(dt, ctx); };

test('dormir en cartón rinde +5 de energía y sin suerte mala no pasa nada más', () => {
  const out = cartonSleepOutcome({ random: () => .99 });
  assert.equal(out.energia, 5);
  assert.equal(out.salud, 0);
  assert.equal(out.robbed, 0);
  assert.equal(out.moved, false);
  assert.equal(out.ruined, false);
});

test('con lluvia rinde menos y se daña el cartón; el tombo lo mueve y el ladrón se lleva parte de la plata', () => {
  const rain = cartonSleepOutcome({ random: () => .99, raining: true });
  assert.equal(rain.energia, CARTON_SLEEP.rainEnergia);
  assert.ok(rain.salud < 0 && rain.ruined);
  const police = cartonSleepOutcome({ random: () => .01 });
  assert.ok(police.moved && police.energia < 5 && police.salud < 0);
  const seq = [.99, .01];
  const robbed = cartonSleepOutcome({ random: () => seq.shift() ?? .5 });
  assert.ok(robbed.robbed >= CARTON_SLEEP.robbed[0] && robbed.robbed <= CARTON_SLEEP.robbed[1]);
  assert.ok(robbed.energia <= 5 && robbed.energia >= 0);
});

test('las paredes y los refugios se reparten separados, lejos del cambuche, y se registran como objetivos', async () => {
  const { calle, registered } = await build();
  assert.equal(calle.walls.length, BRICK.walls);
  assert.equal(calle.shelters.length, CHAMBER.shelters);
  assert.equal(registered.length, BRICK.walls + CHAMBER.shelters);
  const all = [...calle.walls, ...calle.shelters];
  for (const a of all) {
    assert.equal(a.kind, 'calle');
    assert.ok(a.position.length() >= 30, 'lejos del cambuche');
    for (const b of all) if (a !== b && a.type === b.type) assert.ok(a.position.distanceTo(b.position) >= BRICK.minSpacing);
  }
  calle.setup({ getGroundHeight: () => 0 }, points, { interaction: { register() {}, unregister: t => registered.splice(registered.indexOf(t), 1) } });
  assert.equal(registered.length, 0, 'al armar de nuevo se sueltan los anteriores');
});

test('raspar ladrillo toma su tiempo, da polvo y la pared queda pelada hasta que pasa el enfriamiento', async () => {
  const { calle, player, inventory, stats, registered } = await build({ random: () => 0 });
  const wall = registered.find(t => t.type === 'ladrillo');
  player.position.copy(wall.position);
  assert.ok(wall.prompt().includes('Raspar'));
  wall.interact();
  run(calle, BRICK.scrapeTime - 1);
  assert.equal(inventory.count('polvoLadrillo'), 0, 'aún raspando');
  run(calle, 2);
  const got = inventory.count('polvoLadrillo');
  assert.ok(got >= BRICK.yield[0] && got <= BRICK.yield[1]);
  assert.ok(stats.higiene < 80);
  assert.ok(wall.cooldown > 0 && wall.prompt().includes('pelada'));
  assert.equal(wall.interact(), false);
  assert.equal(inventory.count('polvoLadrillo'), got, 'sin otro raspado hasta el enfriamiento');
  run(calle, BRICK.cooldown + 1);
  assert.ok(wall.prompt().includes('Raspar'));
  wall.interact();
  run(calle, BRICK.scrapeTime + .5);
  assert.ok(inventory.count('polvoLadrillo') > got);
});

test('si el jugador se aleja a medio raspar, no saca nada', async () => {
  const { calle, player, inventory, registered } = await build();
  const wall = registered.find(t => t.type === 'ladrillo');
  player.position.copy(wall.position);
  wall.interact();
  run(calle, 1);
  player.position.x += 10;
  run(calle, BRICK.scrapeTime);
  assert.equal(inventory.count('polvoLadrillo'), 0);
  assert.equal(wall.cooldown, 0);
});

test('el polvo de ladrillo se consume como sustancia con efecto y con costo', () => {
  const item = ITEMS.polvoLadrillo;
  assert.ok(item.substance && item.consumable === 'vicio');
  assert.ok(item.animo > 0 && item.energia > 0);
  assert.ok(item.salud < 0, 'el costo en salud');
});

test('en el refugio se echa chamber: paga, calienta y deja guayabo, con cooldown y límite de pocillos', async () => {
  const { calle, stats, registered } = await build();
  const shelter = registered.find(t => t.type === 'refugio');
  const before = { ...stats };
  assert.equal(shelter.interact(), true);
  assert.equal(stats.dinero, before.dinero - CHAMBER.price);
  assert.ok(stats.animo > before.animo && stats.energia > before.energia && stats.calor > 0);
  assert.equal(shelter.interact(), false, 'el pocillo tiene que dar la vuelta');
  const afterDrink = { ...stats };
  run(calle, CHAMBER.hangoverAfter + 1);
  assert.ok(stats.salud < afterDrink.salud && stats.energia < afterDrink.energia && stats.animo < afterDrink.animo, 'guayabo');
  for (let i = 0; i < CHAMBER.limit; i++) { run(calle, CHAMBER.cooldown + 1); shelter.interact(); }
  assert.equal(shelter.drinks, CHAMBER.limit);
  run(calle, CHAMBER.cooldown + 1);
  assert.equal(shelter.interact(), false);
  assert.ok(shelter.prompt().includes('Ya no queda'));
});

test('sin plata le convidan un traguito, que rinde la mitad', async () => {
  const { stats, registered } = await build({ dinero: 0 });
  const shelter = registered.find(t => t.type === 'refugio');
  const energy = stats.energia;
  shelter.interact();
  assert.equal(stats.dinero, 0);
  assert.equal(stats.energia, energy + CHAMBER.effect.energia / 2);
});

test('la gente del refugio se presta del grupo cerca y vuelve al grupo al alejarse', async () => {
  const { calle, player, people, registered } = await build();
  const shelter = registered.find(t => t.type === 'refugio');
  player.position.copy(shelter.position);
  calle.update(.1, {});
  assert.equal(people.inUse, CHAMBER.company);
  assert.equal(shelter.crowd.length, CHAMBER.company);
  calle.update(.1, {});
  assert.equal(people.inUse, CHAMBER.company, 'no pide más');
  player.position.set(9000, 0, 9000);
  calle.update(.1, {});
  assert.equal(people.inUse, 0);
});

test('chamber a veces trae bocadillos gigantes: pocos, persiguen, asustan una vez y se esfuman', async () => {
  const { calle, player, stats } = await build({ random: () => 0 });
  assert.ok(calle.summonBocadillos(10) <= BOCADILLO.max);
  assert.equal(calle.bocadillos.length, BOCADILLO.max);
  assert.equal(calle.summonBocadillos(2), 0, 'nunca más del tope');
  const first = calle.bocadillos[0].mesh.position;
  const d0 = Math.hypot(first.x - player.position.x, first.z - player.position.z);
  run(calle, 1.5);
  assert.ok(Math.hypot(first.x - player.position.x, first.z - player.position.z) < d0, 'se acerca');
  const animo = stats.animo;
  run(calle, 6);
  assert.ok(stats.animo < animo, 'el susto');
  assert.ok(stats.animo >= animo - 2 * BOCADILLO.scare - 1, 'sin matarlo de susto');
  run(calle, BOCADILLO.life);
  assert.equal(calle.bocadillos.length, 0);
  assert.equal(calle.root.children.filter(c => c.name === 'Bocadillo gigante').length, 0);
});

test('el chamber lanza visiones según la suerte', async () => {
  const lucky = await build({ random: () => 0 });
  lucky.registered.find(t => t.type === 'refugio').interact();
  assert.ok(lucky.calle.bocadillos.length >= 2);
  const calm = await build({ random: () => .99 });
  calm.registered.find(t => t.type === 'refugio').interact();
  assert.equal(calm.calle.bocadillos.length, 0);
});

test('morir o recargar borra visiones, guayabo pendiente y raspado, y deja volver a todos al grupo', async () => {
  const { calle, player, stats, people, registered } = await build({ random: () => 0 });
  const shelter = registered.find(t => t.type === 'refugio');
  player.position.copy(shelter.position);
  calle.update(.1, {});
  shelter.interact();
  registered.find(t => t.type === 'ladrillo').interact();
  assert.ok(calle.hangover && calle.bocadillos.length && people.inUse && calle.scrape);
  stats.salud = 0;
  calle.update(.1, {});
  assert.equal(calle.hangover, null);
  assert.equal(calle.bocadillos.length, 0);
  assert.equal(calle.scrape, null);
  assert.equal(people.inUse, 0);
  assert.equal(shelter.cooldown, 0);
});

test('el cartón se tiende bajo el jugador mientras duerme y se recoge al despertar o al reiniciar', async () => {
  const { calle, player } = await build();
  const sheet = calle.layCarton(player.position, 1);
  assert.equal(sheet.parent, calle.root);
  assert.equal(calle.layCarton(player.position, 2).parent, calle.root);
  assert.equal(calle.root.children.filter(c => c.name === 'Cartón tendido').length, 1, 'uno solo a la vez');
  calle.pickUpCarton();
  assert.equal(calle.root.children.filter(c => c.name === 'Cartón tendido').length, 0);
  calle.layCarton(player.position);
  calle.reset();
  assert.equal(calle.root.children.filter(c => c.name === 'Cartón tendido').length, 0);
});
