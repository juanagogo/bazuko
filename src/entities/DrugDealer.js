
 // src/entities/DrugDealer.js

import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';
import { ITEMS, LOOT_SUBSTANCE } from '../data/items.js';

export class DrugDealer {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.scene.add(this.group);

    // Cuerpo
    const bodyMat = new THREE.MeshLambertMaterial({
      color: COLORS.DEALER,
      flatShading: true
    });

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.0, 0.4),
      bodyMat
    );
    body.position.y = 0.9;
    body.castShadow = true;
    this.group.add(body);

    // Cabeza
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 0.3),
      bodyMat
    );
    head.position.y = 1.55;
    head.castShadow = true;
    this.group.add(head);

    // Sombrero
    const hat = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.3, 6),
      new THREE.MeshLambertMaterial({
        color: 0x111111,
        flatShading: true
      })
    );
    hat.position.y = 1.85;
    this.group.add(hat);

    // Mesa
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.1, 0.8),
      new THREE.MeshLambertMaterial({
        color: 0x3a2a1a,
        flatShading: true
      })
    );
    table.position.set(0.8, 0.6, 0);
    table.castShadow = true;
    table.receiveShadow = true;
    this.group.add(table);

    // Decoración de mesa (botella y caja)
    const bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8),
      new THREE.MeshLambertMaterial({ color: 0x9b59b6 })
    );
    bottle.position.set(0.7, 0.75, 0.15);
    this.group.add(bottle);

    const pillBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.08, 0.12),
      new THREE.MeshLambertMaterial({ color: 0xecf0f1 })
    );
    pillBox.position.set(0.9, 0.68, -0.15);
    this.group.add(pillBox);

    // Luz de ambiente del puesto del dealer
    const light = new THREE.PointLight(0x9b59b6, 2.5, 8);
    light.position.set(0.8, 1.2, 0);
    this.group.add(light);

    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x9b59b6 })
    );
    lantern.position.set(0.8, 1.2, 0);
    this.group.add(lantern);

    // Marcador
    const markerGeo = new THREE.RingGeometry(1.0, 1.3, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: COLORS.ACCENT_PURPLE,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });

    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.05;
    this.group.add(this.marker);

    this.isNight = false;
  }

  get position() {
    return this.group.position;
  }

  /**
   * Vende las sustancias del inventario durante la noche.
   * @param {InventorySystem} inventory
   * @param {boolean} isNight
   * @param {number} priceMult
   */
  sellSubstances(inventory, isNight, priceMult = 1) {
    if (!isNight) {
      return { earned: 0, reason: 'day' };
    }

    if (!inventory?.items || typeof inventory.remove !== 'function') {
      return { earned: 0, reason: 'invalid_inventory' };
    }

    let total = 0;

    // Copia para evitar problemas si el inventario cambia al retirar objetos.
    const substances = inventory.items
      .filter((entry) => ITEMS[entry.id]?.substance)
      .map((entry) => ({ id: entry.id, qty: entry.qty }));

    for (const substance of substances) {
      const item = ITEMS[substance.id];
      const qty = Number(substance.qty) || 0;

      if (!item || qty <= 0) continue;

      let price = item.value * qty;
      price *= 1.8;      // Valor base de reventa
      price *= 1.3;      // Bonificación nocturna
      price *= priceMult;

      total += price;
      inventory.remove(substance.id, qty);
    }

    return {
      earned: Math.round(total),
      reason: null
    };
  }

  /**
   * Compra una sustancia al dealer (específica o aleatoria).
   * @param {InventorySystem} inventory
   * @param {object} stats
   * @param {string|null} specificItemId
   */
  buySubstance(inventory, stats, specificItemId = null) {
    if (
      !inventory ||
      !Array.isArray(inventory.items) ||
      typeof inventory.add !== 'function' ||
      !stats ||
      !Number.isFinite(stats.dinero)
    ) {
      return { bought: null, cost: 0, reason: 'invalid_data' };
    }

    let itemId = specificItemId;

    if (!itemId) {
      if (!Array.isArray(LOOT_SUBSTANCE) || LOOT_SUBSTANCE.length === 0) {
        return { bought: null, cost: 0, reason: 'empty_loot' };
      }

      // Selección aleatoria ponderada.
      const validLoot = LOOT_SUBSTANCE.filter(
        (entry) => ITEMS[entry.item] && entry.weight > 0
      );

      const totalWeight = validLoot.reduce(
        (sum, entry) => sum + entry.weight,
        0
      );

      if (totalWeight <= 0) {
        return { bought: null, cost: 0, reason: 'empty_loot' };
      }

      let random = Math.random() * totalWeight;
      itemId = validLoot[validLoot.length - 1].item;

      for (const entry of validLoot) {
        random -= entry.weight;

        if (random < 0) {
          itemId = entry.item;
          break;
        }
      }
    }

    const item = ITEMS[itemId];

    if (!item) {
      return { bought: null, cost: 0, reason: 'invalid_item' };
    }

    const cost = item.value;

    if (stats.dinero < cost) {
      return { bought: null, cost, reason: 'insufficient_money' };
    }

    if (
      inventory.totalWeight + item.weight >
      inventory.maxWeight
    ) {
      return { bought: null, cost, reason: 'inventory_full' };
    }

    stats.dinero -= cost;
    inventory.add(item, 1);

    return {
      bought: item,
      cost,
      reason: null
    };
  }

  getProducts() {
    return [
      ITEMS.tintico,
      ITEMS.pegante,
      ITEMS.pastilla,
      ITEMS.basuco
    ];
  }

  update(dt) {
    if (this.marker) {
      this.marker.rotation.z += dt * 0.6;
    }
  }

  setNight(isNight) {
    this.isNight = isNight;

    if (this.marker) {
      this.marker.material.opacity = isNight ? 0.9 : 0.3;
    }
  }

  dispose() {
    this.scene.remove(this.group);

    this.group.traverse((object) => {
      object.geometry?.dispose?.();

      if (Array.isArray(object.material)) {
        object.material.forEach((material) => material.dispose());
      } else {
        object.material?.dispose?.();
      }
    });
  }
}
