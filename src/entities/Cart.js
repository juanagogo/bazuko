// src/entities/Cart.js
// Carreta de Balineras de Reciclaje Bogotana
// Vehículo rústico de tracción humana que aumenta drásticamente la capacidad de carga (+120 kg).
import * as THREE from 'three';

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
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x82542a, roughness: 0.85 });
    const ironMat = new THREE.MeshStandardMaterial({ color: 0x242628, metalness: 0.8, roughness: 0.4 });
    const silverMat = new THREE.MeshStandardMaterial({ color: 0x95a5a6, metalness: 0.9, roughness: 0.25 });
    const junkMat1 = new THREE.MeshStandardMaterial({ color: 0xb59265, roughness: 0.9 }); // cartón
    const junkMat2 = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.8 }); // lonas / costales

    // 1. Plataforma de madera
    const bedGeo = new THREE.BoxGeometry(1.15, 0.08, 1.7);
    const bed = new THREE.Mesh(bedGeo, woodMat);
    bed.position.y = 0.34;
    bed.castShadow = true;
    bed.receiveShadow = true;
    this.group.add(bed);

    // 2. Barandas laterales de madera (estacas rústicas)
    const sideGeo = new THREE.BoxGeometry(0.06, 0.38, 1.7);
    const leftRail = new THREE.Mesh(sideGeo, woodMat);
    leftRail.position.set(-0.55, 0.52, 0);
    this.group.add(leftRail);

    const rightRail = new THREE.Mesh(sideGeo, woodMat);
    rightRail.position.set(0.55, 0.52, 0);
    this.group.add(rightRail);

    const frontGeo = new THREE.BoxGeometry(1.15, 0.38, 0.06);
    const frontRail = new THREE.Mesh(frontGeo, woodMat);
    frontRail.position.set(0, 0.52, 0.82);
    this.group.add(frontRail);

    // 3. Eje y chasis de hierro
    const axleGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.35, 8);
    const axle = new THREE.Mesh(axleGeo, ironMat);
    axle.rotation.z = Math.PI / 2;
    axle.position.set(0, 0.25, 0);
    this.group.add(axle);

    // 4. Balineras metálicas (ruedas macizas)
    const wheelGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.09, 16);
    wheelGeo.rotateZ(Math.PI / 2);

    this.leftWheel = new THREE.Mesh(wheelGeo, silverMat);
    this.leftWheel.position.set(-0.64, 0.24, 0);
    this.leftWheel.castShadow = true;
    this.group.add(this.leftWheel);

    this.rightWheel = new THREE.Mesh(wheelGeo, silverMat);
    this.rightWheel.position.set(0.64, 0.24, 0);
    this.rightWheel.castShadow = true;
    this.group.add(this.rightWheel);

    // 5. Pata delantera (soporte al estacionar)
    const kickGeo = new THREE.BoxGeometry(0.08, 0.32, 0.08);
    this.kickstand = new THREE.Mesh(kickGeo, ironMat);
    this.kickstand.position.set(0, 0.16, 0.72);
    this.group.add(this.kickstand);

    // 6. Manubrio / Manillares traseros para empujar
    const handleBarMat = ironMat;
    const postGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8);
    const leftPost = new THREE.Mesh(postGeo, handleBarMat);
    leftPost.position.set(-0.45, 0.65, -0.8);
    leftPost.rotation.x = -0.25;
    this.group.add(leftPost);

    const rightPost = new THREE.Mesh(postGeo, handleBarMat);
    rightPost.position.set(0.45, 0.65, -0.8);
    rightPost.rotation.x = -0.25;
    this.group.add(rightPost);

    const gripGeo = new THREE.CylinderGeometry(0.028, 0.028, 1.05, 8);
    const gripBar = new THREE.Mesh(gripGeo, handleBarMat);
    gripBar.rotation.z = Math.PI / 2;
    gripBar.position.set(0, 0.94, -0.92);
    this.group.add(gripBar);

    // 7. Carga de reciclaje (cajas de cartón y bulto de plástico)
    const boxGeo = new THREE.BoxGeometry(0.48, 0.32, 0.55);
    const box = new THREE.Mesh(boxGeo, junkMat1);
    box.position.set(-0.22, 0.52, 0.2);
    box.rotation.y = 0.15;
    this.group.add(box);

    const sackGeo = new THREE.BoxGeometry(0.55, 0.38, 0.65);
    const sack = new THREE.Mesh(sackGeo, junkMat2);
    sack.position.set(0.2, 0.55, -0.25);
    sack.rotation.y = -0.1;
    this.group.add(sack);
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
    this.group.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
  }
}
