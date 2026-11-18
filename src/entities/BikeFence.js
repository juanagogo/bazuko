// src/entities/BikeFence.js
// Puesto clandestino de compra y desguace de bicicletas robadas en El Cartucho.
import * as THREE from 'three';
import { cop } from '../utils/money.js';
import { signMesh } from '../utils/signs.js';

export const STOLEN_BIKE_PRICE = 60000; // $ 60.000 COP

export class BikeFence {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'bikeFence';
    this.title = 'Compra de ciclas';

    this.position = position.clone();
    this.group = new THREE.Group();
    this.group.position.copy(this.position);

    this._buildVisual();
    scene.add(this.group);
  }

  _buildVisual() {
    const lam = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });

    // 1. Tarima de madera rústica
    const platform = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.12, 2.2), lam(0x3a2c1f));
    platform.position.set(0, 0.06, 0);
    platform.receiveShadow = true;
    this.group.add(platform);

    // 2. Banco de trabajo / Mesa de desguace
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.85, 0.8), lam(0x5c4033));
    bench.position.set(0, 0.485, 0.3);
    bench.castShadow = true;
    this.group.add(bench);

    // Prensa de banco y herramientas sobre la mesa
    const vise = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.22), lam(0x22252a));
    vise.position.set(-0.6, 0.98, 0.3);
    const toolBox = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.16, 0.25), lam(0x991b1b));
    toolBox.position.set(0.5, 0.97, 0.3);
    this.group.add(vise, toolBox);

    // 3. Toldo plástico improvisado (lona azul)
    for (const [x, z] of [[-1.2, -0.9], [1.2, -0.9], [-1.2, 0.9], [1.2, 0.9]]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.1, 6), lam(0x404040));
      post.position.set(x, 1.05, z);
      this.group.add(post);
    }
    const tarp = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.05, 2.0), lam(0x1e3a8a));
    tarp.position.set(0, 2.1, 0);
    tarp.rotation.x = 0.08;
    tarp.castShadow = true;
    this.group.add(tarp);

    // 4. Ruedas y rines apilados
    for (let i = 0; i < 3; i++) {
      const wheelStack = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 6, 16), lam(0x2d3748));
      wheelStack.rotation.x = Math.PI / 2;
      wheelStack.position.set(-0.95, 0.18 + i * 0.08, -0.3);
      this.group.add(wheelStack);
    }

    // Rueda colgada del poste
    const hungWheel = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.025, 6, 16), lam(0x4a5568));
    hungWheel.position.set(-1.18, 1.45, 0.2);
    hungWheel.rotation.y = Math.PI / 2;
    this.group.add(hungWheel);

    // 5. Cuadros desarmados de bicicletas recostados
    const scrapFrame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.8, 1.1), lam(0xd97706));
    scrapFrame.position.set(0.95, 0.5, -0.2);
    scrapFrame.rotation.z = -0.25;
    this.group.add(scrapFrame);

    // 6. Letrero de fachada
    const sign = signMesh({ title: 'COMPRA DE CICLAS', sub: 'TALLER DE REPUESTOS - EFECTIVO', bg: '#1c1917' }, 2.4);
    sign.position.set(0, 2.3, 0.95);
    this.group.add(sign);
  }

  interactDistance(point) {
    return this.position.distanceTo(point);
  }

  /**
   * Busca si hay una bicicleta cercana (montada o a menos de 4 metros)
   */
  getNearbyBike(game) {
    const player = game?.player;
    if (player?.ridingBike) return player.ridingBike;
    const bikes = game?.bicycles ?? [];
    let best = null, bestDist = 4.0;
    for (const b of bikes) {
      const d = b.position.distanceTo(this.position);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  /**
   * Vende una bicicleta robada
   */
  sellStolenBike(game) {
    const bike = this.getNearbyBike(game);
    if (!bike) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: 'No tiene ninguna bicicleta cerca para vender.', type: 'info' }
        }));
      }
      return false;
    }

    if (!bike.stolen) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { text: 'Aquí solo compro bicicletas robadas, patrón.', type: 'warn' }
        }));
      }
      return false;
    }

    // Desmontar si el jugador está montado
    if (bike.isRidden) {
      bike.dismount();
    }

    // Pagar al jugador
    const payout = STOLEN_BIKE_PRICE;
    if (game.stats) {
      game.stats.dinero = (game.stats.dinero || 0) + payout;
    }
    game.audio?.play?.('treasure');

    // Deshacerse de la bicicleta vendida
    const idx = (game.bicycles || []).indexOf(bike);
    if (idx >= 0) {
      game.bicycles.splice(idx, 1);
    }
    game.interaction?.unregister?.(bike);
    bike.dispose();

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { text: `Vendí la cicla robada por ${cop(payout)}. Negocio cerrado.`, type: 'rare' }
      }));
    }

    game._save?.();
    return true;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
  }
}
