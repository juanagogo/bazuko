import * as THREE from 'three';
import { ITEMS } from '../data/items.js';
import { DroppedItem, DROP_LIFETIME } from '../entities/DroppedItem.js';

export const MAX_DROPPED_STACKS = 40;

/** Evita paredes, agua, vehículos y cambios de piso entre el jugador y el objeto. */
export function findDropPosition(player, district, collisions, occupied = []) {
  const origin = player.position, yaw = player.root?.rotation.y ?? 0;
  const offsets = [0, Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];
  for (const distance of [1.15, .75]) for (const offset of offsets) {
    const x = origin.x + Math.sin(yaw + offset) * distance;
    const z = origin.z + Math.cos(yaw + offset) * distance;
    if (!district.isWalkableAt(x, z)) continue;
    const y = district.getMovementGroundHeight?.(x, z, origin.y) ?? district.getGroundHeight(x, z);
    if (!Number.isFinite(y) || Math.abs(y - origin.y) > .4) continue;
    const position = new THREE.Vector3(x, y, z);
    if (occupied.some(item => item.position.distanceTo(position) < .55)) continue;
    const footprint = new THREE.Box3(new THREE.Vector3(x - .35, y + .03, z - .35), new THREE.Vector3(x + .35, y + .55, z + .35));
    const from = origin.clone().setY(origin.y + .3), to = position.clone().setY(y + .3);
    const direction = to.clone().sub(from), length = direction.length();
    const ray = new THREE.Ray(from, direction.normalize()), hit = new THREE.Vector3();
    const blocked = [...(collisions?.colliders ?? []), ...(collisions?.dynamicColliders ?? [])].some(({ box }) =>
      footprint.intersectsBox(box) || (ray.intersectBox(box, hit) && hit.distanceTo(from) <= length));
    if (!blocked) return position;
  }
  return null;
}

export class DroppedItemSystem {
  constructor(game) { this.game = game; this.items = []; }

  drop(id, quantity) {
    const g = this.game, stack = g.inventory.items.find(item => item.id === id);
    if (!ITEMS[id] || !stack || !Number.isSafeInteger(quantity) || quantity <= 0 || quantity > stack.qty)
      return { quantity: 0, error: 'No hay objetos para tirar.' };
    const existing = this.items.find(item => item.item.id === id && item.position.distanceTo(g.player.position) < 1.8);
    const position = existing?.position ?? findDropPosition(g.player, g.world.active, g.collisions, this.items);
    if (!position) return { quantity: 0, error: 'No hay espacio libre cerca para tirar el objeto.' };
    if (!existing && this.items.length >= MAX_DROPPED_STACKS)
      return { quantity: 0, error: 'Hay muchos objetos en el suelo. Recoge alguno o espera unos segundos.' };
    const dropped = existing ?? new DroppedItem(g.sceneMgr.scene, position, stack, quantity);
    const before = g.inventory.serialize().items.map(item => ({ ...item }));
    try {
      g.inventory.remove(id, quantity);
      g._save();
    } catch {
      g.inventory.items = before; g.inventory._notify();
      if (!existing) dropped.dispose();
      return { quantity: 0, error: 'No se pudo guardar. El objeto sigue en tu inventario.' };
    }
    if (existing) {
      dropped.quantity += quantity;
      dropped.remaining = DROP_LIFETIME;
      dropped.refreshLabel();
    } else {
      dropped.collect = () => this.collect(dropped);
      this.items.push(dropped);
      g.interaction.register(dropped);
    }
    return { quantity };
  }

  collect(dropped) {
    dropped.collectError = '';
    if (dropped.used || dropped.remaining <= 0 || !this.items.includes(dropped)) return 0;
    const g = this.game, inventory = g.inventory;
    // Recoge lo que cabe y conserva el resto con el plazo original.
    let quantity = Math.min(dropped.quantity, Math.floor((inventory.maxWeight - inventory.totalWeight + 1e-9) / dropped.item.weight));
    while (quantity > 0 && inventory.totalWeight + dropped.item.weight * quantity > inventory.maxWeight) quantity--;
    if (quantity <= 0 || !inventory.add(dropped.item, quantity)) {
      dropped.collectError = 'Costal sin espacio: el objeto sigue en el suelo.';
      return 0;
    }
    try { g._save(); }
    catch {
      inventory.remove(dropped.item.id, quantity);
      dropped.collectError = 'No se pudo guardar. El objeto sigue en el suelo.';
      return 0;
    }
    dropped.quantity -= quantity;
    if (dropped.quantity === 0) this.remove(dropped);
    else dropped.refreshLabel();
    return quantity;
  }

  remove(dropped) {
    this.game.interaction.unregister(dropped);
    if (this.game.interaction.currentTarget === dropped) {
      this.game.interaction.currentTarget = null;
      this.game.interaction.currentTargetType = null;
    }
    dropped.dispose();
    const at = this.items.indexOf(dropped);
    if (at >= 0) this.items.splice(at, 1);
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      item.update(dt, this.game.player.position);
      if (item.remaining <= 0) this.remove(item);
    }
  }

  clear() { for (const item of [...this.items]) this.remove(item); }
}
