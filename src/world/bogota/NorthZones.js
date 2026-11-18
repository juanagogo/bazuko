// src/world/bogota/NorthZones.js
// Recreación 3D de los tres sectores icónicos del Norte de Bogotá:
// 1. Zona T (Zona Rosa, Calle 82): Peatonal en T con adoquines, terrazas, calentadores y boutiques.
// 2. Zona G (Rosales): Distrito Gourmet con casas inglesas de ladrillo y chimeneas.
// 3. Parque de la 93 (Chicó): Parque central verde con senderos, pérgolas y rascacielos corporativos de vidrio.

import * as THREE from 'three';
import { neighborhoodAt } from './NeighborhoodIdentity.js';

export function buildNorthZones() {
  const group = new THREE.Group();
  group.name = 'NorthZones_Bogota';
  const colliders = [];

  // Materiales de alta fidelidad
  const brickEnglishMat = new THREE.MeshLambertMaterial({ color: 0x8b3a2b, name: 'LadrilloInglesZonaG' });
  const woodTrimMat = new THREE.MeshLambertMaterial({ color: 0xd7c4b7, name: 'MaderaZonaG' });
  const glassCurtainMat = new THREE.MeshStandardMaterial({
    color: 0x1b263b, roughness: 0.1, metalness: 0.85, name: 'VidrioCorporativo93'
  });
  const grassParkMat = new THREE.MeshLambertMaterial({ color: 0x2d6a4f, name: 'PastoCuidado93' });
  const pavingTMat = new THREE.MeshLambertMaterial({ color: 0xbfb5af, name: 'AdoquinZonaT' });
  const heaterGlowMat = new THREE.MeshBasicMaterial({ color: 0xff7b00, name: 'FuegoCalentadorT' });
  const neonPinkMat = new THREE.MeshBasicMaterial({ color: 0xff007f, name: 'NeonZonaT' });
  const modernMetalMat = new THREE.MeshStandardMaterial({ color: 0x495057, roughness: 0.3, metalness: 0.8, name: 'MetalModerno' });

  // -------------------------------------------------------------------------
  // 1. ZONA T (Calle 82 / Zona Rosa) - Cuadrícula Urbana Diagonal a ~45°
  // Con manzanas diagonales, plazoletas comerciales y glorieta según el Plano Urbano
  // -------------------------------------------------------------------------
  const zonaTGroup = new THREE.Group();
  zonaTGroup.position.set(38, 0, 75);

  // Eje peatonal en "T" y plazoletas adoquinadas
  const tWalkHoriz = new THREE.Mesh(new THREE.BoxGeometry(60, 0.08, 14), pavingTMat);
  tWalkHoriz.position.set(0, 0.04, 0);
  zonaTGroup.add(tWalkHoriz);

  const tWalkVert = new THREE.Mesh(new THREE.BoxGeometry(14, 0.08, 40), pavingTMat);
  tWalkVert.position.set(0, 0.04, -20);
  zonaTGroup.add(tWalkVert);

  // Manzanas y edificios comerciales diagonales a ~45° (como en el Plano Urbano)
  const diagAngle = Math.PI / 4;
  const diagPositions = [
    { x: -22, z: -26, w: 16, d: 14, h: 14 },
    { x: 22, z: -26, w: 16, d: 14, h: 16 },
    { x: -26, z: 18, w: 14, d: 14, h: 12 },
    { x: 24, z: 20, w: 18, d: 14, h: 15 }
  ];

  for (const dp of diagPositions) {
    const diagBldg = new THREE.Mesh(new THREE.BoxGeometry(dp.w, dp.h, dp.d), brickEnglishMat);
    diagBldg.position.set(dp.x, dp.h / 2, dp.z);
    diagBldg.rotation.y = diagAngle;
    zonaTGroup.add(diagBldg);

    // Cornisa y remate de azotea comercial
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(dp.w + 0.4, 0.4, dp.d + 0.4), woodTrimMat);
    cornice.position.set(dp.x, dp.h + 0.2, dp.z);
    cornice.rotation.y = diagAngle;
    zonaTGroup.add(cornice);

    // Plazoleta peatonal anexa frente al edificio
    const plazaMesh = new THREE.Mesh(new THREE.BoxGeometry(dp.w + 4, 0.06, 6), pavingTMat);
    plazaMesh.position.set(dp.x, 0.05, dp.z + (dp.d / 2 + 3) * Math.cos(diagAngle));
    plazaMesh.rotation.y = diagAngle;
    zonaTGroup.add(plazaMesh);
  }

  // Glorieta Circular (Roundabout) en la intersección diagonal de la Calle 13 / Conidoc
  const glorietaGroup = new THREE.Group();
  glorietaGroup.position.set(-28, 0, -2);

  // Anillo de calzada circular vehicular
  const glorietaRoad = new THREE.Mesh(new THREE.RingGeometry(6.5, 12.5, 32), new THREE.MeshLambertMaterial({ color: 0x3a3835, side: THREE.DoubleSide }));
  glorietaRoad.rotation.x = -Math.PI / 2;
  glorietaRoad.position.y = 0.03;
  glorietaGroup.add(glorietaRoad);

  // Isla verde central de la glorieta con bordillo de concreto
  const glorietaIsland = new THREE.Mesh(new THREE.CylinderGeometry(6.4, 6.4, 0.35, 24), grassParkMat);
  glorietaIsland.position.y = 0.18;
  glorietaGroup.add(glorietaIsland);

  const glorietaCurb = new THREE.Mesh(new THREE.RingGeometry(6.3, 6.6, 24), woodTrimMat);
  glorietaCurb.rotation.x = -Math.PI / 2;
  glorietaCurb.position.y = 0.36;
  glorietaGroup.add(glorietaCurb);

  // Monumento / mástil central en la glorieta
  const monument = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 7.5, 8), modernMetalMat);
  monument.position.y = 3.75;
  glorietaGroup.add(monument);

  zonaTGroup.add(glorietaGroup);

  // Terrazas con sombrillas y calentadores de llama cilíndricos para el frío nocturno
  for (let s = -20; s <= 20; s += 14) {
    if (Math.abs(s) < 5) continue;
    // Sombrilla de restaurante
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), modernMetalMat);
    pole.position.set(s, 1.3, 4.5);
    zonaTGroup.add(pole);

    const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.4, 0.8, 8), new THREE.MeshLambertMaterial({ color: 0x1b4332 }));
    canopy.position.set(s, 2.7, 4.5);
    zonaTGroup.add(canopy);

    // Calentador de gas vertical con flama naranja visible
    const heaterBase = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 1.2, 8), modernMetalMat);
    heaterBase.position.set(s + 1.8, 0.6, 4.2);
    zonaTGroup.add(heaterBase);

    const heaterFlame = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), heaterGlowMat);
    heaterFlame.position.set(s + 1.8, 1.45, 4.2);
    zonaTGroup.add(heaterFlame);

    const heaterCap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.15, 8), modernMetalMat);
    heaterCap.position.set(s + 1.8, 1.8, 4.2);
    zonaTGroup.add(heaterCap);
  }

  // Letreros luminosos tipo neón y marquesinas de centros comerciales
  const neonSign = new THREE.Mesh(new THREE.BoxGeometry(10, 1.2, 0.4), neonPinkMat);
  neonSign.position.set(0, 7.5, 8.5);
  zonaTGroup.add(neonSign);

  group.add(zonaTGroup);

  // -------------------------------------------------------------------------
  // 2. ZONA G (Distrito Gourmet, Rosales) - Integrada en el sector oriental / Cerros (Calle 72 con Cra 4/5)
  // -------------------------------------------------------------------------
  const zonaGGroup = new THREE.Group();
  zonaGGroup.position.set(295, 0, 115);

  // Casas de conservación estilo inglés de ladrillo a la vista con chimeneas
  for (let b = -25; b <= 25; b += 22) {
    const houseHeight = 8.5;
    const house = new THREE.Mesh(new THREE.BoxGeometry(16, houseHeight, 14), brickEnglishMat);
    house.position.set(b, houseHeight / 2, -18);
    zonaGGroup.add(house);

    // Techo inclinado a dos aguas
    const roof = new THREE.Mesh(new THREE.ConeGeometry(12, 3.2, 4), new THREE.MeshLambertMaterial({ color: 0x3d261d }));
    roof.rotation.y = Math.PI / 4;
    roof.position.set(b, houseHeight + 1.6, -18);
    zonaGGroup.add(roof);

    // Chimenea tradicional de ladrillo
    const chimney = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.5, 1.2), brickEnglishMat);
    chimney.position.set(b + 3.5, houseHeight + 2.5, -16);
    zonaGGroup.add(chimney);

    // Molduras de ventanas y marquesina de restaurante
    const awning = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.4, 2.2), new THREE.MeshLambertMaterial({ color: 0x4a5759 }));
    awning.position.set(b, 2.8, -10.2);
    zonaGGroup.add(awning);
  }

  group.add(zonaGGroup);

  // -------------------------------------------------------------------------
  // 3. PARQUE DE LA 93 (Chicó) - Integrado en la zona norte (Calle 93, X: 160, Z: 50)
  // -------------------------------------------------------------------------
  const p93Group = new THREE.Group();
  p93Group.position.set(160, 0, 50);

  // Gran parque rectangular verde
  const parkW = 42, parkL = 34;
  const parkGrass = new THREE.Mesh(new THREE.BoxGeometry(parkW, 0.12, parkL), grassParkMat);
  parkGrass.position.set(0, 0.06, 0);
  p93Group.add(parkGrass);

  // Senderos peatonales de adoquín cruzados
  const mainPath = new THREE.Mesh(new THREE.BoxGeometry(6, 0.14, parkL), pavingTMat);
  mainPath.position.set(0, 0.07, 0);
  p93Group.add(mainPath);

  const crossPath = new THREE.Mesh(new THREE.BoxGeometry(parkW, 0.14, 6), pavingTMat);
  crossPath.position.set(0, 0.07, 0);
  p93Group.add(crossPath);

  // Pérgolas de madera para sombra y descanso
  const pergolaWoodMat = new THREE.MeshLambertMaterial({ color: 0x5c4033, name: 'MaderaPergola93' });
  for (const px of [-12, 12]) {
    for (const pz of [-8, 8]) {
      const pergolaPost = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), pergolaWoodMat);
      pergolaPost.position.set(px, 1.6, pz);
      p93Group.add(pergolaPost);
      const pergolaBeam = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 1.2), pergolaWoodMat);
      pergolaBeam.position.set(px, 3.2, pz);
      p93Group.add(pergolaBeam);
    }
  }

  // Árboles y vegetación cuidada del parque
  const foliageMat = new THREE.MeshLambertMaterial({ color: 0x1e4d2b, name: 'FollajeParque93' });
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3728, name: 'TroncoParque93' });
  const treeOffsets = [
    [-16, -12], [16, -12], [-16, 12], [16, 12],
    [-8, 13], [8, 13], [-8, -13], [8, -13]
  ];
  for (const [tx, tz] of treeOffsets) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 2.8, 6), trunkMat);
    trunk.position.set(tx, 1.4, tz);
    p93Group.add(trunk);
    const foliage = new THREE.Mesh(new THREE.DodecahedronGeometry(1.6), foliageMat);
    foliage.position.set(tx, 3.5, tz);
    p93Group.add(foliage);
  }

  // Escultura metálica icónica y fuente central
  const fountainBase = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 0.6, 16), modernMetalMat);
  fountainBase.position.set(0, 0.3, 0);
  p93Group.add(fountainBase);

  const sculpture = new THREE.Mesh(new THREE.TorusGeometry(2.5, 0.35, 8, 24), new THREE.MeshStandardMaterial({
    color: 0xd4af37, roughness: 0.2, metalness: 0.95, name: 'EsculturaDorada93'
  }));
  sculpture.rotation.x = Math.PI / 3;
  sculpture.position.set(0, 3.2, 0);
  p93Group.add(sculpture);

  // Torres corporativas de vidrio espejado en el perímetro norte
  const towerHeight = 36;
  const corporateTower1 = new THREE.Mesh(new THREE.BoxGeometry(22, towerHeight, 16), glassCurtainMat);
  corporateTower1.position.set(-18, towerHeight / 2, -parkL / 2 - 10);
  p93Group.add(corporateTower1);

  const corporateTower2 = new THREE.Mesh(new THREE.BoxGeometry(20, towerHeight * 0.85, 14), glassCurtainMat);
  corporateTower2.position.set(18, (towerHeight * 0.85) / 2, -parkL / 2 - 9);
  p93Group.add(corporateTower2);

  group.add(p93Group);

  group.userData.colliders = colliders;
  return group;
}
