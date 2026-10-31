// src/steampunk/characters.js
// Asset A — Personaje mecánico estilizado (estilo PS1 steampunk).
// Presupuesto: 1.200 - 2.000 triángulos.
// Variantes: "mechanic", "engineer", "laborer".

import * as THREE from 'three';
import { PALETTE, makeMaterial, makeMetalMaterial, makeGlassMaterial } from './materials.js';
import { beveledBox, lowPolyCylinder, pipe } from './core.js';
import { mulberry32 } from '../utils/random.js';

const VARIANT_COLORS = {
  mechanic: { suit: PALETTE.brown, accent: PALETTE.rust, metal: PALETTE.brass },
  engineer: { suit: PALETTE.patina, accent: PALETTE.copper, metal: PALETTE.steel },
  laborer:  { suit: PALETTE.baseLight, accent: PALETTE.rustDark, metal: PALETTE.iron }
};

/**
 * Crea un personaje mecánico.
 * @param {object} opts
 * @param {number} opts.seed - semilla para variación determinista
 * @param {string} opts.variant - "mechanic" | "engineer" | "laborer"
 * @param {number} opts.detail - 1 (bajo) o 2 (alto)
 * @returns {THREE.Group}
 */
export function createCharacter({ seed = 1, variant = 'mechanic', detail = 1 } = {}) {
  const rand = mulberry32(seed);
  const colors = VARIANT_COLORS[variant] ?? VARIANT_COLORS.mechanic;

  const group = new THREE.Group();
  group.name = `character_${variant}_${seed}`;

  // Materiales
  const suitMat = makeMaterial(colors.suit);
  const accentMat = makeMaterial(colors.accent);
  const metalMat = makeMetalMaterial(colors.metal, { shininess: 15 });
  const leatherMat = makeMaterial(PALETTE.leather);
  const glassMat = makeGlassMaterial();
  const skinMat = makeMaterial(0xc9a88a);
  const darkMat = makeMaterial(PALETTE.baseDark);

  const prostheticArm = variant === 'mechanic'; // mecánico tiene prótesis

  // ============================================================
  // CABEZA / CASCO
  // ============================================================
  const head = new THREE.Group();

  // Casco base (polígono bajo)
  const helmetGeo = beveledBox(0.32, 0.32, 0.34, 0.04);
  const helmet = new THREE.Mesh(helmetGeo, metalMat);
  helmet.position.y = 1.68;
  head.add(helmet);

  // Visera / parte inferior del rostro
  const faceGeo = new THREE.BoxGeometry(0.28, 0.14, 0.3);
  const face = new THREE.Mesh(faceGeo, skinMat);
  face.position.y = 1.52;
  head.add(face);

  // Gafas de aviador (cilindros + cristal)
  const goggleFrameGeo = new THREE.TorusGeometry(0.07, 0.02, 6, 8);
  const goggleL = new THREE.Mesh(goggleFrameGeo, metalMat);
  goggleL.position.set(-0.08, 1.56, 0.16);
  goggleL.rotation.y = Math.PI / 2;
  head.add(goggleL);

  const goggleR = goggleL.clone();
  goggleR.position.x = 0.08;
  head.add(goggleR);

  // Cristales de las gafas
  const lensGeo = new THREE.CircleGeometry(0.055, 8);
  const lensL = new THREE.Mesh(lensGeo, glassMat);
  lensL.position.set(-0.08, 1.56, 0.175);
  head.add(lensL);
  const lensR = lensL.clone();
  lensR.position.x = 0.08;
  head.add(lensR);

  // Puente de las gafas
  const bridgeGeo = new THREE.BoxGeometry(0.06, 0.02, 0.02);
  const bridge = new THREE.Mesh(bridgeGeo, metalMat);
  bridge.position.set(0, 1.56, 0.17);
  head.add(bridge);

  // Tubo de respiración (variante engineer)
  if (variant === 'engineer') {
    const tubeGeo = pipe(0.025, 0.3, 6);
    const tube = new THREE.Mesh(tubeGeo, metalMat);
    tube.position.set(-0.14, 1.5, 0.1);
    tube.rotation.z = Math.PI / 6;
    head.add(tube);
  }

  group.add(head);

  // ============================================================
  // TORSO (trapecio invertido - hombros anchos)
  // ============================================================
  const torso = new THREE.Group();

  // Peto superior (ancho en hombros)
  const chestGeo = beveledBox(0.52, 0.42, 0.32, 0.04);
  const chest = new THREE.Mesh(chestGeo, suitMat);
  chest.position.y = 1.25;
  torso.add(chest);

  // Parte inferior del torso (más estrecha)
  const abdomenGeo = beveledBox(0.4, 0.28, 0.3, 0.04);
  const abdomen = new THREE.Mesh(abdomenGeo, suitMat);
  abdomen.position.y = 0.95;
  torso.add(abdomen);

  // Arnés / peto de cuero sintético
  const harnessGeo = new THREE.BoxGeometry(0.5, 0.3, 0.34);
  const harness = new THREE.Mesh(harnessGeo, leatherMat);
  harness.position.y = 1.2;
  torso.add(harness);

  // Placa metálica en el pecho (acento)
  const plateGeo = beveledBox(0.18, 0.18, 0.04, 0.02);
  const plate = new THREE.Mesh(plateGeo, metalMat);
  plate.position.set(0, 1.25, 0.18);
  torso.add(plate);

  // Cinturón con sachet de potenciador
  const beltGeo = new THREE.BoxGeometry(0.42, 0.06, 0.32);
  const belt = new THREE.Mesh(beltGeo, leatherMat);
  belt.position.y = 0.84;
  torso.add(belt);

  // Sachet / depósito en el cinturón
  const sachetGeo = beveledBox(0.1, 0.12, 0.08, 0.02);
  const sachet = new THREE.Mesh(sachetGeo, accentMat);
  sachet.position.set(0.16, 0.84, 0.18);
  torso.add(sachet);

  group.add(torso);

  // ============================================================
  // BRAZOS
  // ============================================================

  // Brazo izquierdo (normal)
  const armL = buildArm(false, suitMat, leatherMat, metalMat, skinMat, darkMat);
  armL.position.set(-0.32, 1.4, 0);
  group.add(armL);

  // Brazo derecho (prótesis si mechanic)
  const armR = buildArm(prostheticArm, suitMat, leatherMat, metalMat, skinMat, darkMat);
  armR.position.set(0.32, 1.4, 0);
  group.add(armR);

  // ============================================================
  // PIERNAS
  // ============================================================
  const legL = buildLeg(suitMat, leatherMat, metalMat, darkMat);
  legL.position.set(-0.12, 0.4, 0);
  group.add(legL);

  const legR = buildLeg(suitMat, leatherMat, metalMat, darkMat);
  legR.position.set(0.12, 0.4, 0);
  group.add(legR);

  // ============================================================
  // DETALLES SEGÚN VARIANTE (detail level 2)
  // ============================================================
  if (detail >= 2) {
    // Llave inglesa en el cinturón (mechanic)
    if (variant === 'mechanic') {
      const wrenchGeo = new THREE.BoxGeometry(0.03, 0.2, 0.04);
      const wrench = new THREE.Mesh(wrenchGeo, metalMat);
      wrench.position.set(-0.18, 0.84, 0.18);
      wrench.rotation.z = 0.3;
      group.add(wrench);
    }

    // Prismáticos (engineer)
    if (variant === 'engineer') {
      const scopeGeo = lowPolyCylinder(0.04, 0.04, 0.25, 6);
      const scope = new THREE.Mesh(scopeGeo, metalMat);
      scope.position.set(0.18, 1.0, 0.2);
      scope.rotation.z = Math.PI / 2;
      group.add(scope);
    }

    // Pala/pico (laborer)
    if (variant === 'laborer') {
      const handleGeo = new THREE.BoxGeometry(0.03, 0.6, 0.03);
      const handle = new THREE.Mesh(handleGeo, makeMaterial(PALETTE.wood));
      handle.position.set(-0.3, 1.1, 0.1);
      handle.rotation.z = 0.3;
      group.add(handle);
    }
  }

  // Variación aleatoria de altura (±5%)
  const heightVar = 1 + (rand() - 0.5) * 0.1;
  group.scale.y = heightVar;

  return group;
}

/**
 * Construye un brazo articulado.
 * @param {boolean} prosthetic - si es prótesis mecánica
 */
function buildArm(prosthetic, suitMat, leatherMat, metalMat, skinMat, darkMat) {
  const arm = new THREE.Group();

  if (prosthetic) {
    // Prótesis: segmentos metálicos articulados
    const upperGeo = lowPolyCylinder(0.06, 0.07, 0.35, 6);
    const upper = new THREE.Mesh(upperGeo, metalMat);
    upper.position.y = -0.2;
    arm.add(upper);

    // Articulación del codo
    const elbowGeo = new THREE.SphereGeometry(0.07, 6, 6);
    const elbow = new THREE.Mesh(elbowGeo, metalMat);
    elbow.position.y = -0.4;
    arm.add(elbow);

    // Antebrazo mecánico
    const forearmGeo = lowPolyCylinder(0.05, 0.06, 0.32, 6);
    const forearm = new THREE.Mesh(forearmGeo, metalMat);
    forearm.position.y = -0.6;
    arm.add(forearm);

    // Pinza / mano mecánica
    const handGeo = beveledBox(0.1, 0.1, 0.08, 0.02);
    const hand = new THREE.Mesh(handGeo, metalMat);
    hand.position.y = -0.8;
    arm.add(hand);

    // Dedos de la pinza
    const fingerGeo = new THREE.BoxGeometry(0.02, 0.08, 0.02);
    for (const sx of [-0.03, 0.03]) {
      const finger = new THREE.Mesh(fingerGeo, metalMat);
      finger.position.set(sx, -0.88, 0);
      arm.add(finger);
    }

    // Tubos en el brazo
    const tubeGeo = pipe(0.015, 0.35, 5);
    const tube = new THREE.Mesh(tubeGeo, metalMat);
    tube.position.set(0.06, -0.4, 0);
    arm.add(tube);
  } else {
    // Brazo normal (orgánico con ropa)
    const upperGeo = lowPolyCylinder(0.07, 0.06, 0.35, 6);
    const upper = new THREE.Mesh(upperGeo, suitMat);
    upper.position.y = -0.2;
    arm.add(upper);

    const forearmGeo = lowPolyCylinder(0.06, 0.05, 0.32, 6);
    const forearm = new THREE.Mesh(forearmGeo, suitMat);
    forearm.position.y = -0.6;
    arm.add(forearm);

    // Mano
    const handGeo = beveledBox(0.1, 0.1, 0.08, 0.02);
    const hand = new THREE.Mesh(handGeo, skinMat);
    hand.position.y = -0.82;
    arm.add(hand);

    // Puño / guante
    const gloveGeo = new THREE.BoxGeometry(0.11, 0.05, 0.09);
    const glove = new THREE.Mesh(gloveGeo, leatherMat);
    glove.position.y = -0.78;
    arm.add(glove);
  }

  return arm;
}

/**
 * Construye una pierna con bota de trabajo.
 */
function buildLeg(suitMat, leatherMat, metalMat, darkMat) {
  const leg = new THREE.Group();

  // Muslo
  const thighGeo = lowPolyCylinder(0.08, 0.07, 0.38, 6);
  const thigh = new THREE.Mesh(thighGeo, suitMat);
  thigh.position.y = -0.2;
  leg.add(thigh);

  // Rodilla (refuerzo)
  const kneeGeo = new THREE.SphereGeometry(0.075, 6, 6);
  const knee = new THREE.Mesh(kneeGeo, leatherMat);
  knee.position.y = -0.42;
  leg.add(knee);

  // Pantorrilla
  const shinGeo = lowPolyCylinder(0.07, 0.06, 0.35, 6);
  const shin = new THREE.Mesh(shinGeo, suitMat);
  shin.position.y = -0.65;
  leg.add(shin);

  // Bota
  const bootGeo = beveledBox(0.14, 0.12, 0.22, 0.02);
  const boot = new THREE.Mesh(bootGeo, darkMat);
  boot.position.set(0, -0.88, 0.04);
  leg.add(boot);

  // Suela metálica
  const soleGeo = new THREE.BoxGeometry(0.15, 0.03, 0.24);
  const sole = new THREE.Mesh(soleGeo, metalMat);
  sole.position.set(0, -0.95, 0.04);
  leg.add(sole);

  return leg;
}
