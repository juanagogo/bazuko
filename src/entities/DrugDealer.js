// src/entities/DrugDealer.js

import * as THREE from 'three';
import { COLORS } from '../utils/constants.js';
import { ITEMS, LOOT_SUBSTANCE } from '../data/items.js';
import { createRealisticCharacter, REALISTIC_SCALE } from '../character/RealisticCharacter.js';

export const DEALER_LOOK = {
  v: 2,
  nombre: 'El Patrón',
  sexo: 'hombre',
  edad: 'adulto',
  piel: 2, // Tono curtido bogotano
  pelo: 'corto', // Cabello corto oscuro
  peloColor: 0, // Negro
  ojos: 1, // Ojos oscuros y mirada fría
  cejas: 'gruesas',
  barba: 'candado', // Barba cerrada / candado recortada
  ropa: 'chaqueta', // Chaqueta de cuero / callejera oscura
  arriba: 'chaqueta',
  arribaColor: 6, // Negro
  abajo: 'jean',
  abajoColor: 6, // Negro
  calzado: 'botas', // Botas de cuero oscuras
  zapatos: 'botas',
  zapatoColor: 0, // Negro
  real: {
    sexo: 'hombre',
    edad: 'adulto',
    pelo: 'corto',
    barba: 'candado',
    ropa: 'chaqueta',
    calzado: 'botas'
  }
};

/**
 * Crea la ruana de paño bogotano oscuro: descansa sobre los hombros,
 * cae sobre pecho y espalda hasta la cintura, dejando cara, brazos y piernas visibles.
 */
function createRuanaMesh() {
  const ruanaGroup = new THREE.Group();

  const ruanaMat = new THREE.MeshLambertMaterial({
    color: 0x222026,
    side: THREE.DoubleSide,
    flatShading: false
  });

  const trimMat = new THREE.MeshLambertMaterial({
    color: 0x382635,
    flatShading: true
  });

  // Paño delantero con cuello en V
  const frontGeo = new THREE.PlaneGeometry(0.50, 0.48, 8, 6);
  const fPos = frontGeo.attributes.position;
  for (let i = 0; i < fPos.count; i++) {
    const x = fPos.getX(i);
    const y = fPos.getY(i);
    // V-neck central: baja la tela en el centro superior para mostrar el cuello y chaqueta
    if (Math.abs(x) < 0.08 && y > 0.08) {
      fPos.setY(i, 0.08);
    }
    // Ondulaciones sutiles de la tela
    fPos.setZ(i, Math.sin(x * 16) * 0.012);
  }
  frontGeo.computeVertexNormals();

  const frontMesh = new THREE.Mesh(frontGeo, ruanaMat);
  frontMesh.position.set(0, 1.22, 0.14);
  frontMesh.castShadow = true;
  ruanaGroup.add(frontMesh);

  // Ribete inferior del paño delantero
  const frontTrim = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.02, 0.015), trimMat);
  frontTrim.position.set(0, 0.98, 0.14);
  ruanaGroup.add(frontTrim);

  // Paño trasero
  const backGeo = new THREE.PlaneGeometry(0.50, 0.48, 8, 6);
  const bPos = backGeo.attributes.position;
  for (let i = 0; i < bPos.count; i++) {
    const x = bPos.getX(i);
    bPos.setZ(i, Math.sin(x * 16) * 0.012);
  }
  backGeo.computeVertexNormals();

  const backMesh = new THREE.Mesh(backGeo, ruanaMat);
  backMesh.position.set(0, 1.22, -0.14);
  backMesh.rotation.y = Math.PI;
  backMesh.castShadow = true;
  ruanaGroup.add(backMesh);

  // Ribete inferior del paño trasero
  const backTrim = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.02, 0.015), trimMat);
  backTrim.position.set(0, 0.98, -0.14);
  ruanaGroup.add(backTrim);

  // Caídas de hombros (izquierda y derecha)
  const leftShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.28), ruanaMat);
  leftShoulder.position.set(-0.17, 1.46, 0);
  leftShoulder.rotation.z = -0.06;
  leftShoulder.castShadow = true;

  const rightShoulder = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.035, 0.28), ruanaMat);
  rightShoulder.position.set(0.17, 1.46, 0);
  rightShoulder.rotation.z = 0.06;
  rightShoulder.castShadow = true;

  ruanaGroup.add(leftShoulder, rightShoulder);
  return ruanaGroup;
}

export class DrugDealer {
  constructor(scene, position) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.scene.add(this.group);

    this.animTimer = 0;
    this.isNight = false;
    this.realisticChar = null;
    this._disposed = false;

    // Grupo para el personaje humanoide
    this.characterGroup = new THREE.Group();
    this.group.add(this.characterGroup);

    // 1. Ruana / Capa de paño bogotana sobre los hombros
    this.cloakGroup = new THREE.Group();
    this.characterGroup.add(this.cloakGroup);

    this.capeMesh = createRuanaMesh();
    this.cloakGroup.add(this.capeMesh);

    // 2. Modelo humanoide procedimental inmediato (cuerpo completo visible, rostro realista)
    this._buildProceduralHumanoid();

    // 3. Puesto clandestino auténtico de El Cartucho (mesa rústica, termo de tinto, gramera digital, bichas)
    this._buildStall();

    // 4. Marcador de interacción en el suelo
    const markerGeo = new THREE.RingGeometry(1.0, 1.25, 24);
    const markerMat = new THREE.MeshBasicMaterial({
      color: 0x7c3aed,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45
    });

    this.marker = new THREE.Mesh(markerGeo, markerMat);
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.set(0, 0.03, 0.55);
    this.group.add(this.marker);

    // 5. Carga asíncrona del personaje realista MakeHuman si está en navegador
    this._loadRealisticSkin();
  }

  get position() {
    return this.group.position;
  }

  _buildProceduralHumanoid() {
    this.proceduralBody = new THREE.Group();
    this.characterGroup.add(this.proceduralBody);

    const skinMat = new THREE.MeshLambertMaterial({ color: 0xd49a75 });
    const darkHairMat = new THREE.MeshLambertMaterial({ color: 0x181412 });
    const jacketMat = new THREE.MeshLambertMaterial({ color: 0x222028, flatShading: true });
    const jeansMat = new THREE.MeshLambertMaterial({ color: 0x1b202a, flatShading: true });
    const bootMat = new THREE.MeshLambertMaterial({ color: 0x121214, flatShading: true });

    // Piernas con jeans oscuros
    const legGeo = new THREE.BoxGeometry(0.17, 0.72, 0.17);
    const leftLeg = new THREE.Mesh(legGeo, jeansMat);
    leftLeg.position.set(-0.12, 0.44, 0);
    leftLeg.castShadow = true;

    const rightLeg = new THREE.Mesh(legGeo, jeansMat);
    rightLeg.position.set(0.12, 0.44, 0);
    rightLeg.castShadow = true;

    // Botas de cuero pesadas
    const bootGeo = new THREE.BoxGeometry(0.19, 0.20, 0.26);
    const leftBoot = new THREE.Mesh(bootGeo, bootMat);
    leftBoot.position.set(-0.12, 0.10, 0.03);
    leftBoot.castShadow = true;

    const rightBoot = new THREE.Mesh(bootGeo, bootMat);
    rightBoot.position.set(0.12, 0.10, 0.03);
    rightBoot.castShadow = true;

    // Torso con chaqueta de cuero/calle
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.26), jacketMat);
    torso.position.set(0, 1.10, 0);
    torso.castShadow = true;

    // Cinturón
    const belt = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.05, 0.27),
      new THREE.MeshLambertMaterial({ color: 0x111111 })
    );
    belt.position.set(0, 0.81, 0);

    // Brazos con mangas oscuras y manos visibles
    const armGeo = new THREE.BoxGeometry(0.13, 0.56, 0.13);
    const leftArm = new THREE.Mesh(armGeo, jacketMat);
    leftArm.position.set(-0.28, 1.12, 0.02);
    leftArm.castShadow = true;

    const rightArm = new THREE.Mesh(armGeo, jacketMat);
    rightArm.position.set(0.28, 1.12, 0.02);
    rightArm.castShadow = true;

    const handGeo = new THREE.BoxGeometry(0.09, 0.10, 0.09);
    const leftHand = new THREE.Mesh(handGeo, skinMat);
    leftHand.position.set(-0.28, 0.80, 0.05);

    const rightHand = new THREE.Mesh(handGeo, skinMat);
    rightHand.position.set(0.28, 0.80, 0.05);

    // Cuello
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.14, 8), skinMat);
    neck.position.set(0, 1.45, 0);

    // Cabeza humana visible
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), skinMat);
    head.position.set(0, 1.63, 0.02);
    head.scale.set(0.95, 1.05, 0.95);
    head.castShadow = true;

    // Pelo corto oscuro
    const hairGeo = new THREE.SphereGeometry(0.136, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const hair = new THREE.Mesh(hairGeo, darkHairMat);
    hair.position.set(0, 1.65, 0.01);

    // Barba candado recortada
    const beard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.09, 0.12, 10, 1, false, 0, Math.PI),
      darkHairMat
    );
    beard.position.set(0, 1.57, 0.04);

    // Ojos realistas
    const eyeGeo = new THREE.SphereGeometry(0.016, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1f1a18 });
    this.eyeLeft = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeLeft.position.set(-0.048, 1.635, 0.135);

    this.eyeRight = new THREE.Mesh(eyeGeo, eyeMat);
    this.eyeRight.position.set(0.048, 1.635, 0.135);

    // Nariz
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.04, 0.03), skinMat);
    nose.position.set(0, 1.61, 0.145);

    this.proceduralBody.add(
      leftLeg, rightLeg, leftBoot, rightBoot,
      torso, belt, leftArm, rightArm, leftHand, rightHand,
      neck, head, hair, beard, this.eyeLeft, this.eyeRight, nose
    );
  }

  _buildStall() {
    this.stallGroup = new THREE.Group();
    this.group.add(this.stallGroup);

    const woodMat = new THREE.MeshLambertMaterial({ color: 0x3e2e1e, flatShading: true });
    const metalMat = new THREE.MeshLambertMaterial({ color: 0x334155, flatShading: true });

    // Mesa rústica de madera situada al frente del dealer
    const tableTop = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.07, 0.52), woodMat);
    tableTop.position.set(0, 0.75, 0.58);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    this.stallGroup.add(tableTop);

    // Patas de la mesa
    const legGeo = new THREE.BoxGeometry(0.08, 0.72, 0.08);
    for (const [lx, lz] of [[-0.52, 0.40], [0.52, 0.40], [-0.52, 0.76], [0.52, 0.76]]) {
      const leg = new THREE.Mesh(legGeo, woodMat);
      leg.position.set(lx, 0.36, lz);
      leg.castShadow = true;
      this.stallGroup.add(leg);
    }

    // 1. Termo de tinto tradicional (rojo con tapa blanca) y vasitos plásticos
    const thermosMat = new THREE.MeshLambertMaterial({ color: 0xb91c1c });
    const thermosCapMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
    const thermos = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.07, 0.24, 12), thermosMat);
    thermos.position.set(-0.38, 0.90, 0.60);
    thermos.castShadow = true;

    const thermosCap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 10), thermosCapMat);
    thermosCap.position.set(-0.38, 1.04, 0.60);

    const cupsMat = new THREE.MeshLambertMaterial({ color: 0xf1f5f9, transparent: true, opacity: 0.9 });
    const cups = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.026, 0.08, 8), cupsMat);
    cups.position.set(-0.27, 0.825, 0.60);

    this.stallGroup.add(thermos, thermosCap, cups);

    // 2. Gramera digital de bolsillo (escala electrónica moderna)
    const scaleBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.016, 0.08),
      new THREE.MeshLambertMaterial({ color: 0x1e293b })
    );
    scaleBody.position.set(0.02, 0.793, 0.58);

    const scalePlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.065, 0.005, 0.065),
      new THREE.MeshLambertMaterial({ color: 0xcbd5e1 })
    );
    scalePlate.position.set(0.04, 0.803, 0.58);

    const scaleLcd = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.002, 0.016),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    scaleLcd.position.set(-0.022, 0.803, 0.58);

    this.stallGroup.add(scaleBody, scalePlate, scaleLcd);

    // 3. Bichas / papeletas de bazuco (paquetes pequeños de papel doblado)
    const paperMat = new THREE.MeshLambertMaterial({ color: 0xf1f5f9 });
    for (let i = 0; i < 3; i++) {
      const bicha = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.032), paperMat);
      bicha.position.set(0.15 + i * 0.04, 0.791, 0.60 + (i % 2) * 0.02);
      bicha.rotation.y = (i - 1) * 0.18;
      this.stallGroup.add(bicha);
    }

    // 4. Blíster de pastillas (tarjeta de medicamento con píldoras)
    const blisterMat = new THREE.MeshLambertMaterial({ color: 0x94a3b8 });
    const blister = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.006, 0.07), blisterMat);
    blister.position.set(-0.13, 0.789, 0.60);
    blister.rotation.y = 0.15;
    this.stallGroup.add(blister);

    // 5. Caja de metal para dinero (lata de lata con billetes)
    const cashBox = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.10), metalMat);
    cashBox.position.set(0.38, 0.815, 0.58);
    cashBox.rotation.y = -0.12;

    const bills = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.015, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x86efac })
    );
    bills.position.set(0.38, 0.85, 0.58);
    this.stallGroup.add(cashBox, bills);

    // 6. Lámpara de taller / luz cálida de calle sobre la mesa
    const lampArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6),
      new THREE.MeshLambertMaterial({ color: 0x1f2937 })
    );
    lampArm.position.set(-0.46, 0.92, 0.46);

    const lampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.07, 0.08, 8, 1, true),
      new THREE.MeshLambertMaterial({ color: 0x1f2937, side: THREE.DoubleSide })
    );
    lampShade.position.set(-0.46, 1.05, 0.46);
    lampShade.rotation.x = Math.PI;

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd17a })
    );
    bulb.position.set(-0.46, 1.02, 0.46);

    // Luz cálida realista (ámbar suave de bombillo incandescente)
    this.light = new THREE.PointLight(0xffb040, 1.8, 6.5);
    this.light.position.set(-0.46, 0.98, 0.46);
    this.light.castShadow = false;

    this.stallGroup.add(lampArm, lampShade, bulb, this.light);
  }

  _loadRealisticSkin() {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;

    createRealisticCharacter(DEALER_LOOK, { lod: false })
      .then((character) => {
        if (this._disposed || !character) {
          character?.dispose?.();
          return;
        }
        this.realisticChar = character;
        // Ocultar completamente el cuerpo y la capa procedimentales para evitar que se solapen o generen cajas en el torso
        if (this.proceduralBody) {
          this.proceduralBody.visible = false;
        }
        if (this.cloakGroup) {
          this.cloakGroup.visible = false;
        }
        this.characterGroup.add(character.group);
        character.update?.(0, { speed: 0, action: 'idle' });
      })
      .catch((err) => {
        console.warn('[DrugDealer] Procedural figure active:', err?.message || err);
      });
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
      ITEMS.pastilla
    ];
  }

  update(dt) {
    this.animTimer += dt;

    if (this.marker) {
      this.marker.rotation.z += dt * 0.4;
    }

    // Parpadeo sutil y natural de la lámpara de taller
    if (this.light) {
      const flicker = Math.sin(this.animTimer * 7.5) * 0.06 + Math.cos(this.animTimer * 16.2) * 0.03;
      const baseIntensity = this.isNight ? 2.2 : 1.4;
      this.light.intensity = Math.max(0.5, baseIntensity + flicker);
    }

    // Animación del personaje realista
    if (this.realisticChar) {
      this.realisticChar.update(dt, { speed: 0, action: 'idle' });
    } else if (this.proceduralBody) {
      // Respiración sutil del modelo procedural
      this.proceduralBody.position.y = Math.sin(this.animTimer * 2.0) * 0.006;
    }
  }

  setNight(isNight) {
    this.isNight = isNight;

    if (this.marker) {
      this.marker.material.opacity = isNight ? 0.70 : 0.35;
    }

    if (this.light) {
      this.light.intensity = isNight ? 2.2 : 1.4;
      this.light.distance = isNight ? 7.5 : 5.0;
    }
  }

  dispose() {
    this._disposed = true;
    this.scene.remove(this.group);

    if (this.realisticChar) {
      this.realisticChar.dispose?.();
      this.realisticChar = null;
    }

    this.group.traverse((object) => {
      object.geometry?.dispose?.();

      if (Array.isArray(object.material)) {
        object.material.forEach((mat) => mat?.dispose?.());
      } else {
        object.material?.dispose?.();
      }
    });
  }
}
