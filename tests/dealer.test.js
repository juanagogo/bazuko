// tests/dealer.test.js

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DrugDealer, DEALER_LOOK } from '../src/entities/DrugDealer.js';
import { ITEMS } from '../src/data/items.js';

test('DrugDealer tiene apariencia seria, humana y de calle con ruana bogotana y puesto detallado', () => {
  const scene = new THREE.Scene();
  const dealer = new DrugDealer(scene, new THREE.Vector3(10, 0, 20));

  assert.equal(dealer.group.parent, scene);
  assert.equal(dealer.position.x, 10);
  assert.equal(dealer.position.z, 20);

  // Verificar que cuenta con la ruana/capa de paño y rostro visible
  assert.ok(dealer.cloakGroup, 'Debe tener grupo de ruana/capa');
  assert.ok(dealer.capeMesh, 'Debe tener malla de ruana sobre hombros');
  assert.ok(dealer.eyeLeft && dealer.eyeRight, 'Debe tener ojos y facciones humanas');
  assert.ok(dealer.stallGroup, 'Debe tener puesto de contrabandista detallado');

  // Verificar que el look definido es serio y humano
  assert.equal(DEALER_LOOK.sexo, 'hombre');
  assert.equal(DEALER_LOOK.ropa, 'chaqueta');
  assert.equal(DEALER_LOOK.calzado, 'botas');
  assert.equal(DEALER_LOOK.barba, 'candado');
  assert.equal(DEALER_LOOK.piel, 2);

  dealer.dispose();
});

test('DrugDealer sellSubstances rechaza de día y vende de noche con bonificación', () => {
  const scene = new THREE.Scene();
  const dealer = new DrugDealer(scene, new THREE.Vector3(0, 0, 0));

  const inventory = {
    items: [
      { id: 'tintico', qty: 2 },
      { id: 'carton', qty: 5 }
    ],
    remove(id, qty) {
      const idx = this.items.findIndex(it => it.id === id);
      if (idx !== -1) {
        this.items[idx].qty -= qty;
        if (this.items[idx].qty <= 0) this.items.splice(idx, 1);
      }
    }
  };

  // De día no compra
  const dayRes = dealer.sellSubstances(inventory, false);
  assert.equal(dayRes.earned, 0);
  assert.equal(dayRes.reason, 'day');
  assert.equal(inventory.items.length, 2);

  // De noche sí compra
  const nightRes = dealer.sellSubstances(inventory, true);
  assert.ok(nightRes.earned > 0);
  assert.equal(nightRes.reason, null);
  // El tintico (sustancia) fue removido, el cartón sigue en el inventario
  assert.equal(inventory.items.some(it => it.id === 'tintico'), false);
  assert.equal(inventory.items.some(it => it.id === 'carton'), true);

  dealer.dispose();
});

test('DrugDealer buySubstance valida dinero e inventario', () => {
  const scene = new THREE.Scene();
  const dealer = new DrugDealer(scene, new THREE.Vector3(0, 0, 0));

  const stats = { dinero: 500 };
  const inventory = {
    items: [],
    totalWeight: 0,
    maxWeight: 10,
    add(item, qty) {
      this.items.push({ id: item.id, qty });
      this.totalWeight += item.weight * qty;
    }
  };

  // Dinero insuficiente para tintico (cuesta 1000)
  const failRes = dealer.buySubstance(inventory, stats, 'tintico');
  assert.equal(failRes.bought, null);
  assert.equal(failRes.reason, 'insufficient_money');

  // Con dinero suficiente
  stats.dinero = 5000;
  const okRes = dealer.buySubstance(inventory, stats, 'tintico');
  assert.ok(okRes.bought);
  assert.equal(okRes.bought.id, 'tintico');
  assert.equal(stats.dinero, 4000);
  assert.equal(inventory.items.length, 1);

  // Inventario lleno
  inventory.totalWeight = 10;
  const fullRes = dealer.buySubstance(inventory, stats, 'pegante');
  assert.equal(fullRes.bought, null);
  assert.equal(fullRes.reason, 'inventory_full');

  dealer.dispose();
});

test('DrugDealer update y setNight alteran luz, marcador y animaciones sin error', () => {
  const scene = new THREE.Scene();
  const dealer = new DrugDealer(scene, new THREE.Vector3(0, 0, 0));

  const initialRotZ = dealer.marker.rotation.z;
  dealer.update(0.1);
  assert.ok(dealer.marker.rotation.z !== initialRotZ);

  dealer.setNight(true);
  assert.equal(dealer.isNight, true);
  assert.equal(dealer.marker.material.opacity, 0.70);

  dealer.setNight(false);
  assert.equal(dealer.isNight, false);
  assert.equal(dealer.marker.material.opacity, 0.35);

  dealer.dispose();
  assert.equal(dealer.group.parent, null);
});
