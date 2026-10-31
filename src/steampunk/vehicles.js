// src/steampunk/vehicles.js
// Asset B — Vehículo industrial steampunk (estilo PS1).
// Presupuesto: 800 - 1.500 triángulos.
// Variantes: "industrial_cart", "hauler", "drone_rig".

import * as THREE from 'three';
import { PALETTE, makeMaterial, makeMetalMaterial, makeGlassMaterial } from './materials.js';
import { beveledBox, lowPolyCylinder, pipe, boiler, industrialWheel } from './core.js';
import { mulberry32 } from '../utils/random.js';

const VEHICLE_CONFIG = {
  industrial_cart: {
    bodyColor: PALETTE.rust, accentColor: PALETTE.brass,
    wheelCount: 4, wheelRadius: 0.35, hasBoiler: true, hasCabin: false
  },
  hauler: {
    bodyColor: PALETTE.iron, accentColor: PALETTE.copper,
    wheelCount: 6, wheelRadius: 0.5, hasBoiler: true, hasCabin: true
  },
  drone_rig: {
    bodyColor: PALETTE.patina, accentColor: PALETTE.steel,
    wheelCount: 0, wheelRadius: 0, hasBoiler: false, hasCabin: true, drone: true
  }
};

/**
 * Crea un vehículo industrial.
 * @param {object} opts
 * @param {number} opts.seed
 * @param {string} opts.type - "industrial_cart" | "hauler" | "drone_rig"
 * @param {number} opts.detail - 1 o 2
 * @returns {THREE.Group}
 */
export function createVehicle({ seed = 1, type = 'industrial_cart', detail = 1 } = {}) {
  const rand = mulberry32(seed);
  const cfg = VEHICLE_CONFIG[type] ?? VEHICLE_CONFIG.industrial_cart;

  const group = new THREE.Group();
  group.name = `vehicle_${type}_${seed}`;

  const bodyMat = makeMaterial(cfg.bodyColor);
  const accentMat = makeMaterial(cfg.accentColor);
  const metalMat = makeMetalMaterial(cfg.accentColor, { shininess: 25 });
  const darkMat = makeMaterial(PALETTE.baseDark);
  const glassMat = makeGlassMaterial();

  // ============================================================
  // CHASIS / CARROCERÍA PRINCIPAL
  // ============================================================
  const bodyWidth = type === 'hauler' ? 1.6 : 1.2;
  const bodyHeight = type === 'drone_rig' ? 0.6 : 0.5;
  const bodyLength = type === 'hauler' ? 3.2 : 2.4;

  const chassisGeo = beveledBox(bodyWidth, bodyHeight, bodyLength, 0.08);
  const chassis = new THREE.Mesh(chassisGeo, bodyMat);
  chassis.position.y = type === 'drone_rig' ? 1.2 : 0.55;
  group.add(chassis);

  // Caja de carga (solo cart y hauler)
  if (type !== 'drone_rig') {
    const cargoGeo = beveledBox(bodyWidth * 0.95, 0.5, bodyLength * 0.6, 0.06);
    const cargo = new THREE.Mesh(cargoGeo, accentMat);
    cargo.position.set(0, chassis.position.y + bodyHeight / 2 + 0.25, -bodyLength * 0.1);
    group.add(cargo);

    // Refuerzos diagonales en la caja
    if (detail >= 2) {
      for (const sx of [-1, 1]) {
        const braceGeo = new THREE.BoxGeometry(0.04, 0.5, 0.04);
        const brace = new THREE.Mesh(braceGeo, metalMat);
        brace.position.set(sx * bodyWidth * 0.45, cargo.position.y, -bodyLength * 0.1);
        brace.rotation.z = sx * 0.3;
        group.add(brace);
      }
    }
  }

  // ============================================================
  // GUARDABARROS DELANTEROS
  // ============================================================
  if (type !== 'drone_rig') {
    const fenderGeo = beveledBox(bodyWidth * 0.55, 0.15, 0.3, 0.04);
    const fenderL = new THREE.Mesh(fenderGeo, metalMat);
    fenderL.position.set(-bodyWidth * 0.28, chassis.position.y - bodyHeight / 2 + 0.05, bodyLength * 0.35);
    group.add(fenderL);

    const fenderR = fenderL.clone();
    fenderR.position.x = bodyWidth * 0.28;
    group.add(fenderR);
  }

  // ============================================================
  // CABINA DE CONDUCCIÓN (asímétrica)
  // ============================================================
  if (cfg.hasCabin) {
    const cabinWidth = bodyWidth * 0.7;
    const cabinHeight = type === 'drone_rig' ? 0.4 : 0.55;
    const cabinLength = bodyLength * 0.35;

    const cabinGeo = beveledBox(cabinWidth, cabinHeight, cabinLength, 0.05);
    const cabin = new THREE.Mesh(cabinGeo, bodyMat);
    cabin.position.set(
      type === 'drone_rig' ? 0 : bodyWidth * 0.15, // asimétrica en hauler
      chassis.position.y + bodyHeight / 2 + cabinHeight / 2,
      bodyLength * 0.35
    );
    group.add(cabin);

    // Ventana enrejada
    const windowW = cabinWidth * 0.5;
    const windowH = cabinHeight * 0.5;

    const winFrame = new THREE.Mesh(
      new THREE.BoxGeometry(windowW + 0.04, windowH + 0.04, 0.04),
      metalMat
    );
    winFrame.position.set(
      cabin.position.x,
      cabin.position.y + 0.05,
      cabin.position.z + cabinLength / 2 + 0.02
    );
    group.add(winFrame);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(windowW, windowH),
      glassMat
    );
    glass.position.copy(winFrame.position);
    glass.position.z += 0.03;
    group.add(glass);

    // Barrotes
    const barCount = 3;
    const barGeo = new THREE.BoxGeometry(0.02, windowH, 0.02);
    for (let i = 0; i < barCount; i++) {
      const bar = new THREE.Mesh(barGeo, metalMat);
      bar.position.set(
        winFrame.position.x - windowW / 2 + (windowW / (barCount + 1)) * (i + 1),
        winFrame.position.y,
        winFrame.position.z + 0.02
      );
      group.add(bar);
    }
  }

  // ============================================================
  // CALDERA / PROPULSIÓN
  // ============================================================
  if (cfg.hasBoiler) {
    const boilerRadius = type === 'hauler' ? 0.35 : 0.28;
    const boilerHeight = type === 'hauler' ? 0.9 : 0.7;

    const boilerGeo = boiler(boilerRadius, boilerHeight, 3);
    const boilerMesh = new THREE.Mesh(boilerGeo, metalMat);
    boilerMesh.position.set(0, chassis.position.y + bodyHeight / 2 + boilerHeight / 2 - 0.1, -bodyLength * 0.35);
    group.add(boilerMesh);

    // Manómetro
    if (detail >= 2) {
      const gaugeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.02, 8);
      const gauge = new THREE.Mesh(gaugeGeo, accentMat);
      gauge.rotation.z = Math.PI / 2;
      gauge.position.set(boilerRadius + 0.02, boilerMesh.position.y, boilerMesh.position.z);
      group.add(gauge);
    }

    // Tubos de escape verticales (2-3)
    const stackCount = type === 'hauler' ? 3 : 2;
    const stackGeo = pipe(0.06, 0.5, 6);
    for (let i = 0; i < stackCount; i++) {
      const stack = new THREE.Mesh(stackGeo, metalMat);
      const offset = (i - (stackCount - 1) / 2) * 0.15;
      stack.position.set(
        offset,
        boilerMesh.position.y + boilerHeight / 2 + 0.25,
        boilerMesh.position.z
      );
      group.add(stack);

      // Boca del tubo (ensanchada)
      const mouthGeo = lowPolyCylinder(0.09, 0.06, 0.08, 6);
      const mouth = new THREE.Mesh(mouthGeo, darkMat);
      mouth.position.copy(stack.position);
      mouth.position.y += 0.25;
      group.add(mouth);
    }
  }

  // ============================================================
  // RUEDAS INDUSTRIALES (componente modular)
  // ============================================================
  if (cfg.wheelCount > 0) {
    const wheelGeo = industrialWheel(cfg.wheelRadius, 0.18, 8, true);
    const wheelMat = makeMaterial(PALETTE.baseDark);
    const hubMat = metalMat;

    const wheelY = cfg.wheelRadius;
    const axleWidth = bodyWidth * 0.55;

    const positions = [];
    if (cfg.wheelCount === 4) {
      positions.push(
        [-axleWidth, wheelY, bodyLength * 0.3],
        [axleWidth, wheelY, bodyLength * 0.3],
        [-axleWidth, wheelY, -bodyLength * 0.3],
        [axleWidth, wheelY, -bodyLength * 0.3]
      );
    } else if (cfg.wheelCount === 6) {
      positions.push(
        [-axleWidth, wheelY, bodyLength * 0.35],
        [axleWidth, wheelY, bodyLength * 0.35],
        [-axleWidth, wheelY, 0],
        [axleWidth, wheelY, 0],
        [-axleWidth, wheelY, -bodyLength * 0.35],
        [axleWidth, wheelY, -bodyLength * 0.35]
      );
    }

    for (const [x, y, z] of positions) {
      const wheel = new THREE.Mesh(wheelGeo, wheelMat);
      wheel.position.set(x, y, z);
      wheel.rotation.y = Math.PI / 2;
      group.add(wheel);
    }
  }

  // ============================================================
  // DRONE RIG: hélices y turbinas
  // ============================================================
  if (type === 'drone_rig') {
    const rotorCount = 4;
    const rotorPositions = [
      [-bodyWidth * 0.5, 1.6, bodyLength * 0.4],
      [bodyWidth * 0.5, 1.6, bodyLength * 0.4],
      [-bodyWidth * 0.5, 1.6, -bodyLength * 0.4],
      [bodyWidth * 0.5, 1.6, -bodyLength * 0.4]
    ];

    for (const [x, y, z] of rotorPositions) {
      // Brazo
      const armGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
      const arm = new THREE.Mesh(armGeo, metalMat);
      arm.position.set(x * 0.5, y - 0.3, z * 0.5);
      group.add(arm);

      // Soporte del rotor
      const supportGeo = lowPolyCylinder(0.08, 0.08, 0.1, 6);
      const support = new THREE.Mesh(supportGeo, metalMat);
      support.position.set(x, y - 0.1, z);
      group.add(support);

      // Rotor (3 palas)
      const bladeGeo = new THREE.BoxGeometry(0.5, 0.02, 0.06);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(bladeGeo, darkMat);
        blade.position.set(x, y, z);
        blade.rotation.y = (i / 3) * Math.PI * 2;
        group.add(blade);
      }
    }
  }

  // ============================================================
  // FAROS DELANTEROS
  // ============================================================
  if (type !== 'drone_rig' && detail >= 1) {
    const lightGeo = new THREE.SphereGeometry(0.06, 6, 6);
    const lightMat = makeMaterial(PALETTE.brassLight);
    for (const sx of [-1, 1]) {
      const light = new THREE.Mesh(lightGeo, lightMat);
      light.position.set(sx * bodyWidth * 0.35, chassis.position.y + 0.05, bodyLength * 0.48);
      group.add(light);
    }
  }

  return group;
}
