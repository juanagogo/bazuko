import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { ITEMS } from '../src/data/items.js';
import { InventorySystem } from '../src/systems/InventorySystem.js';
import { InteractionSystem } from '../src/systems/InteractionSystem.js';
import { InventoryUI } from '../src/ui/InventoryUI.js';
import { DroppedItemSystem, findDropPosition, MAX_DROPPED_STACKS } from '../src/systems/DroppedItemSystem.js';
import { createDroppedItemModel } from '../src/entities/droppedItemModel.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

function fixture() {
  const game = {
    sceneMgr: { scene: new THREE.Scene() },
    inventory: new InventorySystem(50),
    player: { position: new THREE.Vector3(), root: new THREE.Group(), playAction() {} },
    world: { active: { isWalkableAt: () => true, getGroundHeight: () => 0 } },
    collisions: { colliders: [], dynamicColliders: [] },
    _save() { this.saved = structuredClone(this.inventory.serialize()); }
  };
  game.interaction = new InteractionSystem(game.player, game.inventory,
    { addXP() { assert.fail('Recuperar un objeto no da XP'); } }, { play() {} },
    { tryInfect() { assert.fail('Recuperar un objeto no infecta'); } }, {});
  game.droppedItems = new DroppedItemSystem(game);
  return game;
}

test('Tirar 1 y Tirar todo generan cantidades exactas desde el panel, sin borrar otros tipos', () => {
  const game = fixture();
  game.inventory.add(ITEMS.lata, 3); game.inventory.add(ITEMS.pan, 2);
  const panel = Object.assign(Object.create(InventoryUI.prototype), { inv: game.inventory, game, selected: 0, _toast() {} });
  panel._drop(false);
  assert.equal(game.inventory.count('lata'), 2);
  assert.equal(game.droppedItems.items[0].quantity, 1);
  panel._drop(true);
  assert.equal(game.inventory.count('lata'), 0);
  assert.equal(game.inventory.count('pan'), 2);
  assert.equal(game.droppedItems.items[0].quantity, 3);
  assert.equal(game.saved.items.find(item => item.id === 'lata'), undefined);
  assert.equal(game.interaction.targets.length, 1);
  game.droppedItems.clear();
});

test('E recupera la cantidad exacta una sola vez sin botín, XP ni enfermedades', () => {
  const game = fixture(); game.inventory.add(ITEMS.anillo, 3);
  game.droppedItems.drop('anillo', 3);
  const dropped = game.droppedItems.items[0];
  const input = { isDown: () => false, consumePress: code => code === 'KeyE' };
  game.interaction.update(0, input, {});
  assert.equal(game.inventory.count('anillo'), 3);
  assert.equal(game.saved.items[0].qty, 3);
  assert.equal(dropped.collect(), 0);
  assert.equal(game.droppedItems.items.length, 0);
  assert.equal(game.interaction.targets.length, 0);
  assert.equal(dropped.group.parent, null);
});

test('Permanece antes de 10 segundos activos y desaparece al cumplir el plazo sin reaparecer', () => {
  const game = fixture(); game.inventory.add(ITEMS.pan);
  game.droppedItems.drop('pan', 1);
  const dropped = game.droppedItems.items[0];
  game.droppedItems.update(9.99);
  assert.equal(game.droppedItems.items.length, 1);
  game.interaction.currentTarget = dropped;
  game.droppedItems.update(.02);
  assert.equal(game.droppedItems.items.length, 0);
  assert.equal(game.interaction.currentTarget, null);
  assert.equal(game.interaction.targets.length, 0);
  assert.equal(game.sceneMgr.scene.children.length, 0);
  assert.equal(dropped.collect(), 0);
  game.droppedItems.update(100);
  assert.equal(game.inventory.count('pan'), 0);
});

test('Un costal lleno conserva el objeto y recoger parcialmente no renueva su plazo', () => {
  const game = fixture(); game.inventory.add(ITEMS.madera, 3);
  game.droppedItems.drop('madera', 3);
  const dropped = game.droppedItems.items[0];
  game.inventory.maxWeight = 0;
  assert.equal(dropped.collect(), 0);
  assert.equal(dropped.quantity, 3);
  game.inventory.maxWeight = 3;
  game.droppedItems.update(4);
  assert.equal(dropped.collect(), 1);
  assert.equal(game.inventory.count('madera'), 1);
  assert.equal(dropped.quantity, 2);
  assert.equal(dropped.remaining, 6);
  game.droppedItems.clear();
});

test('Rechaza cantidades inválidas y objetos desconocidos sin modificar el inventario', () => {
  const game = fixture(); game.inventory.add(ITEMS.lata, 3);
  for (const quantity of [0, -1, 1.5, NaN, Infinity, 4]) assert.equal(game.droppedItems.drop('lata', quantity).quantity, 0);
  assert.equal(game.droppedItems.drop('inventado', 1).quantity, 0);
  assert.equal(game.inventory.count('lata'), 3);
  assert.equal(game.sceneMgr.scene.children.length, 0);
});

test('Sin un suelo próximo transitable no se pierde ningún objeto', () => {
  const game = fixture(); game.inventory.add(ITEMS.radioTransistor);
  game.world.active.isWalkableAt = () => false;
  assert.equal(game.droppedItems.drop('radioTransistor', 1).quantity, 0);
  assert.equal(game.inventory.count('radioTransistor'), 1);
});

test('Tipos distintos se colocan separados para que sus modelos no se superpongan', () => {
  const game = fixture(); game.inventory.add(ITEMS.pan); game.inventory.add(ITEMS.agua);
  game.droppedItems.drop('pan', 1); game.droppedItems.drop('agua', 1);
  assert.equal(game.droppedItems.items.length, 2);
  assert.ok(game.droppedItems.items[0].position.distanceTo(game.droppedItems.items[1].position) >= .55);
  game.droppedItems.clear();
});

test('Busca a un lado si el frente está bloqueado y rechaza agua y otro piso', () => {
  const game = fixture();
  game.collisions.colliders.push({ box: new THREE.Box3(new THREE.Vector3(-.5, 0, .6), new THREE.Vector3(.5, 2, 2)) });
  const position = findDropPosition(game.player, game.world.active, game.collisions);
  assert.ok(position && Math.abs(position.x) > .5);
  game.world.active.getGroundHeight = () => -2;
  assert.equal(findDropPosition(game.player, game.world.active, game.collisions), null);
  game.world.active.getGroundHeight = () => 3;
  assert.equal(findDropPosition(game.player, game.world.active, game.collisions), null);
});

test('Conserva la altura del tablero elevado y evita vehículos', () => {
  const game = fixture(); game.player.position.y = 7.82;
  game.world.active.getMovementGroundHeight = (_x, _z, y) => y;
  assert.equal(findDropPosition(game.player, game.world.active, game.collisions).y, 7.82);
  game.collisions.dynamicColliders.push({ box: new THREE.Box3(new THREE.Vector3(-3, 7.8, -3), new THREE.Vector3(3, 10, 3)) });
  assert.equal(findDropPosition(game.player, game.world.active, game.collisions), null);
});

test('Un fallo al guardar el descarte restaura inventario, orden y escena', () => {
  const game = fixture(); game.inventory.add(ITEMS.pan); game.inventory.add(ITEMS.lata, 2);
  const before = structuredClone(game.inventory.items);
  game._save = () => { throw Error('Sin almacenamiento'); };
  assert.equal(game.droppedItems.drop('pan', 1).quantity, 0);
  assert.deepEqual(game.inventory.items, before);
  assert.equal(game.sceneMgr.scene.children.length, 0);
  assert.equal(game.interaction.targets.length, 0);
});

test('Un fallo al guardar la recogida no duplica objetos y permite reintentar', () => {
  const game = fixture(); game.inventory.add(ITEMS.pilas, 2);
  game.droppedItems.drop('pilas', 2);
  const dropped = game.droppedItems.items[0], save = game._save;
  game._save = () => { throw Error('Sin almacenamiento'); };
  assert.equal(dropped.collect(), 0);
  assert.equal(game.inventory.count('pilas'), 0);
  assert.equal(dropped.quantity, 2);
  game._save = save;
  assert.equal(dropped.collect(), 2);
  assert.equal(game.inventory.count('pilas'), 2);
});

test('Agrupar del mismo tipo conserva las unidades y renueva solo ese montón', () => {
  const game = fixture(); game.inventory.add(ITEMS.botella, 3); game.inventory.add(ITEMS.pan);
  game.droppedItems.drop('botella', 1); game.droppedItems.drop('pan', 1);
  game.droppedItems.update(4);
  game.droppedItems.drop('botella', 2);
  assert.equal(game.droppedItems.items[0].quantity, 3);
  assert.equal(game.droppedItems.items[0].remaining, 10);
  assert.equal(game.droppedItems.items[1].remaining, 6);
  game.droppedItems.clear();
});

test('El límite de montones no borra inventario y la limpieza libera modelos una sola vez', () => {
  const game = fixture(); game.inventory.add(ITEMS.lata, MAX_DROPPED_STACKS + 1);
  for (let i = 0; i < MAX_DROPPED_STACKS; i++) {
    game.player.position.x = i * 3;
    assert.equal(game.droppedItems.drop('lata', 1).quantity, 1);
  }
  game.player.position.x += 3;
  assert.equal(game.droppedItems.drop('lata', 1).quantity, 0);
  assert.equal(game.inventory.count('lata'), 1);
  const dropped = game.droppedItems.items[0];
  let disposed = 0; dropped.model.children[0].geometry.addEventListener('dispose', () => disposed++);
  game.droppedItems.clear(); game.droppedItems.clear(); dropped.dispose();
  assert.equal(disposed, 1);
  assert.equal(game.sceneMgr.scene.children.length, 0);
  assert.equal(game.interaction.targets.length, 0);
});

test('Todos los objetos del catálogo tienen geometría finita apoyada sobre el suelo', () => {
  for (const id of Object.keys(ITEMS)) {
    const model = createDroppedItemModel(id);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    assert.ok(!bounds.isEmpty() && Number.isFinite(bounds.max.y), id);
    assert.ok(Math.abs(bounds.min.y) < 1e-6, id);
    assert.ok(bounds.max.y > 0 && bounds.max.y < 1, id);
    const geometries = new Set(), materials = new Set();
    model.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) materials.add(o.material); });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
});
