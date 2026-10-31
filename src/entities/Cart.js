// src/entities/Cart.js
// Carreta de Balineras de Reciclaje Bogotana
// Vehículo rústico de tracción humana que aumenta drásticamente la capacidad de carga (+120 kg).
import * as THREE from 'three';
import { createCartVisual } from './cartVisual.js';

export class Cart {
  constructor(scene, position = new THREE.Vector3(25, 0, 31)) {
    this.scene = scene;
    this.kind = 'cart';
    this.title = 'Carreta de balineras';
    this.isAttached = false;
    this.capacityBonus = 120; // kg extra de capacidad
    this.position = position.clone();

    this._wheelRotation = 0;
    this._rumbleTimer = 0;

    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    this._buildModel();
    scene.add(this.group);
  }

  _buildModel() {
    Object.assign(this, createCartVisual(this.group));
  }

  toggleGrab(player, inventory) {
    if (!this.isAttached) {
      this.isAttached = true;
      if (player) player.hasCart = true;
      if (inventory) inventory.maxWeight += this.capacityBonus;

      if (typeof document !== 'undefined') {
        const ind = document.getElementById('cart-indicator');
        if (ind) ind.classList.remove('hidden');
      }

      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: '🛒 Carreta acoplada (+120 kg de capacidad). Movimiento con peso de carga.', kind: 'info' }
        }));
      }
    } else {
      this.isAttached = false;
      if (player) player.hasCart = false;
      if (inventory) inventory.maxWeight = Math.max(10, inventory.maxWeight - this.capacityBonus);

      if (typeof document !== 'undefined') {
        const ind = document.getElementById('cart-indicator');
        if (ind) ind.classList.add('hidden');
      }

      if (typeof window !== 'undefined' && window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: '🛒 Carreta desenganchada y estacionada.', kind: 'info' }
        }));
      }
    }
    return this.isAttached;
  }

  update(dt, player, audio) {
    if (this.isAttached && player) {
      const angle = player.root ? player.root.rotation.y : 0;
      const forwardX = Math.sin(angle);
      const forwardZ = Math.cos(angle);

      // Posicionada 1.4 m al frente del jugador
      this.position.set(
        player.position.x + forwardX * 1.4,
        player.position.y,
        player.position.z + forwardZ * 1.4
      );
      this.group.position.copy(this.position);
      this.group.rotation.y = angle;

      const speed = player.speed ?? 0;
      if (speed > 0.2) {
        this._wheelRotation += dt * speed * 4.5;
        if (this.leftWheel) this.leftWheel.rotation.x = this._wheelRotation;
        if (this.rightWheel) this.rightWheel.rotation.x = this._wheelRotation;

        this._rumbleTimer += dt;
        if (this._rumbleTimer > 0.22) {
          this._rumbleTimer = 0;
          if (audio?.playCartRumble) audio.playCartRumble();
        }
      }
    } else {
      this.group.position.copy(this.position);
    }
  }

  saveState() {
    return {
      x: this.position.x,
      y: this.position.y,
      z: this.position.z,
      rotation: this.group.rotation.y,
      isAttached: this.isAttached
    };
  }

  loadState(state, player, inventory) {
    if (!state) return;
    if (typeof state.x === 'number') this.position.x = state.x;
    if (typeof state.y === 'number') this.position.y = state.y;
    if (typeof state.z === 'number') this.position.z = state.z;
    this.group.position.copy(this.position);
    if (typeof state.rotation === 'number') this.group.rotation.y = state.rotation;

    if (state.isAttached && !this.isAttached) {
      this.toggleGrab(player, inventory);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this._disposeVisual();
  }
}
