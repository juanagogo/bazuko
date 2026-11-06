// src/world/bogota/MetroBogota.js
// Recreación 3D de la Primera Línea del Metro de Bogotá (PLMB).
// Viaducto elevado de concreto armado sobre la Av. Caracas, tren verde y blanco oficial,
// estación intermodal elevada y cerramientos de obra en superficie (polisombra y maletines viales).

import * as THREE from 'three';

export const METRO = Object.freeze({
  x: 75,                // Eje central sobre el separador de la Av. Caracas
  zStart: 10,           // Extremo norte del viaducto en la ciudad
  zEnd: 310,            // Extremo sur del viaducto
  trackHeight: 12.5,    // Cota de vía elevada (metros sobre el suelo)
  deckWidth: 8.4,       // Ancho del viaducto para doble vía
  deckThickness: 1.4,   // Espesor de la viga en U
  pillarSpacing: 24,    // Distancia entre pilas de concreto
  pillarRadius: 1.1     // Radio de las columnas cilíndricas
});

export function buildMetroBogota({ pavement } = {}) {
  const group = new THREE.Group();
  group.name = 'MetroBogota';
  const colliders = [];

  // Materiales PBR
  const concreteMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9a, name: 'ConcretoMetro' });
  const darkConcreteMat = new THREE.MeshLambertMaterial({ color: 0x5c5d5a, name: 'ConcretoDovelas' });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.85, roughness: 0.25, name: 'RielAcero' });
  const ballastMat = new THREE.MeshLambertMaterial({ color: 0x3a3b3a, name: 'Balasto' });
  const trainGreenMat = new THREE.MeshStandardMaterial({ color: 0x1e7e48, roughness: 0.35, metalness: 0.2, name: 'VerdeMetroBogota' });
  const trainWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.25, metalness: 0.1, name: 'BlancoMetroBogota' });
  const trainGlassMat = new THREE.MeshStandardMaterial({ color: 0x11161a, roughness: 0.1, metalness: 0.9, name: 'VidrioMetro' });
  const lightGlowMat = new THREE.MeshBasicMaterial({ color: 0xfff6c2, name: 'FarosLedMetro' });
  const polisombraMat = new THREE.MeshLambertMaterial({ color: 0x145a32, side: THREE.DoubleSide, name: 'PolisombraVerde' });
  const maletinOrangeMat = new THREE.MeshLambertMaterial({ color: 0xe65100, name: 'MaletinNaranja' });
  const maletinWhiteMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5, name: 'MaletinBlanco' });

  // 1. VIADUCTO ELEVADO Y PILAS DE CONCRETO
  const length = METRO.zEnd - METRO.zStart;
  const centerZ = (METRO.zStart + METRO.zEnd) / 2;

  // Tablero principal (viga cajón / dovelas)
  const deckGeo = new THREE.BoxGeometry(METRO.deckWidth, METRO.deckThickness, length);
  const deck = new THREE.Mesh(deckGeo, darkConcreteMat);
  deck.position.set(METRO.x, METRO.trackHeight - METRO.deckThickness / 2, centerZ);
  group.add(deck);

  // Barandas de protección lateral del viaducto
  const parapetHeight = 1.2;
  const parapetThickness = 0.35;
  const parapetGeo = new THREE.BoxGeometry(parapetThickness, parapetHeight, length);
  const leftParapet = new THREE.Mesh(parapetGeo, concreteMat);
  leftParapet.position.set(METRO.x - METRO.deckWidth / 2 + parapetThickness / 2, METRO.trackHeight + parapetHeight / 2, centerZ);
  group.add(leftParapet);

  const rightParapet = new THREE.Mesh(parapetGeo, concreteMat);
  rightParapet.position.set(METRO.x + METRO.deckWidth / 2 - parapetThickness / 2, METRO.trackHeight + parapetHeight / 2, centerZ);
  group.add(rightParapet);

  // Lecho de vías (balasto) y rieles dobles
  const ballastGeo = new THREE.BoxGeometry(METRO.deckWidth - 1.2, 0.15, length);
  const ballast = new THREE.Mesh(ballastGeo, ballastMat);
  ballast.position.set(METRO.x, METRO.trackHeight + 0.08, centerZ);
  group.add(ballast);

  // 4 Rieles de acero (vía norte y vía sur)
  const railPositionsX = [-2.6, -1.2, 1.2, 2.6];
  for (const rX of railPositionsX) {
    const railGeo = new THREE.BoxGeometry(0.1, 0.18, length);
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(METRO.x + rX, METRO.trackHeight + 0.22, centerZ);
    group.add(rail);
  }

  // Columnas / Pilas monumentales en el separador
  const pillarHeight = METRO.trackHeight - METRO.deckThickness;
  const pillarGeo = new THREE.CylinderGeometry(METRO.pillarRadius, METRO.pillarRadius * 1.15, pillarHeight, 16);
  const capGeo = new THREE.BoxGeometry(METRO.deckWidth * 0.95, 1.2, 3.2);

  for (let z = METRO.zStart + 6; z <= METRO.zEnd - 6; z += METRO.pillarSpacing) {
    // Columna cilíndrica
    const pillar = new THREE.Mesh(pillarGeo, concreteMat);
    pillar.position.set(METRO.x, pillarHeight / 2, z);
    group.add(pillar);

    // Capitel de apoyo en martillo
    const cap = new THREE.Mesh(capGeo, darkConcreteMat);
    cap.position.set(METRO.x, pillarHeight + 0.6, z);
    group.add(cap);

    // Colisión sólida del pilar en el suelo
    colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(METRO.x - METRO.pillarRadius, 0, z - METRO.pillarRadius),
        new THREE.Vector3(METRO.x + METRO.pillarRadius, METRO.trackHeight, z + METRO.pillarRadius)
      ),
      mesh: pillar
    });
  }

  // 2. EL TREN DEL METRO DE BOGOTÁ (OFICIAL PLMB - VERDE Y BLANCO)
  const trainZ = 95; // Posicionado sobre la vía oriental junto a la estación y cerca al spawn
  const carLength = 18;
  const carWidth = 3.1;
  const carHeight = 3.4;
  const trainY = METRO.trackHeight + 0.3 + carHeight / 2;
  const numCars = 3;

  for (let i = 0; i < numCars; i++) {
    const cZ = trainZ - i * (carLength + 0.6);
    const carGroup = new THREE.Group();

    // Cuerpo principal blanco
    const bodyGeo = new THREE.BoxGeometry(carWidth, carHeight, carLength);
    const body = new THREE.Mesh(bodyGeo, trainWhiteMat);
    carGroup.add(body);

    // Franja verde inferior y techo verde esmeralda
    const stripeGeo = new THREE.BoxGeometry(carWidth + 0.04, 0.85, carLength + 0.02);
    const stripe = new THREE.Mesh(stripeGeo, trainGreenMat);
    stripe.position.y = -carHeight * 0.28;
    carGroup.add(stripe);

    const roofGeo = new THREE.BoxGeometry(carWidth - 0.2, 0.4, carLength);
    const roof = new THREE.Mesh(roofGeo, trainGreenMat);
    roof.position.y = carHeight / 2 + 0.15;
    carGroup.add(roof);

    // Ventanas panorámicas laterales oscuras
    const winGeo = new THREE.BoxGeometry(carWidth + 0.08, 1.1, carLength * 0.85);
    const windows = new THREE.Mesh(winGeo, trainGlassMat);
    windows.position.y = 0.2;
    carGroup.add(windows);

    // Fuelle de acople de goma negra si no es el último vagón
    if (i < numCars - 1) {
      const fuelleGeo = new THREE.BoxGeometry(carWidth * 0.9, carHeight * 0.9, 0.6);
      const fuelle = new THREE.Mesh(fuelleGeo, ballastMat);
      fuelle.position.set(0, 0, -carLength / 2 - 0.3);
      carGroup.add(fuelle);
    }

    // Cabina frontal aerodinámica y faros LED en el primer vagón
    if (i === 0) {
      const cabinGeo = new THREE.ConeGeometry(carWidth * 0.75, 1.8, 4);
      const cabin = new THREE.Mesh(cabinGeo, trainGreenMat);
      cabin.rotation.x = Math.PI / 2;
      cabin.rotation.y = Math.PI / 4;
      cabin.position.set(0, -0.1, carLength / 2 + 0.7);
      carGroup.add(cabin);

      // Faros LED frontales
      const headlightGeo = new THREE.SphereGeometry(0.22, 10, 8);
      const leftHeadlight = new THREE.Mesh(headlightGeo, lightGlowMat);
      leftHeadlight.position.set(-0.85, -0.6, carLength / 2 + 1.2);
      carGroup.add(leftHeadlight);

      const rightHeadlight = new THREE.Mesh(headlightGeo, lightGlowMat);
      rightHeadlight.position.set(0.85, -0.6, carLength / 2 + 1.2);
      carGroup.add(rightHeadlight);
    }

    carGroup.position.set(METRO.x + 1.9, trainY, cZ);
    group.add(carGroup);
  }

  // 3. ESTACIÓN ELEVADA INTERMODAL DEL METRO (AV. CARACAS / CALLE 10)
  const stationZ = 95;
  const stationWidth = 14;
  const stationLength = 34;
  const stationGroup = new THREE.Group();

  // Plataforma de abordaje elevada
  const platGeo = new THREE.BoxGeometry(stationWidth, 0.4, stationLength);
  const plat = new THREE.Mesh(platGeo, concreteMat);
  plat.position.set(0, METRO.trackHeight + 0.3, 0);
  stationGroup.add(plat);

  // Cubierta abovedada translúcida verde y acero
  const roofCurveGeo = new THREE.CylinderGeometry(stationWidth * 0.6, stationWidth * 0.6, stationLength, 16, 1, false, 0, Math.PI);
  const stationRoof = new THREE.Mesh(roofCurveGeo, new THREE.MeshStandardMaterial({
    color: 0x2e7d32, roughness: 0.2, metalness: 0.5, transparent: true, opacity: 0.85, side: THREE.DoubleSide
  }));
  stationRoof.rotation.z = Math.PI / 2;
  stationRoof.rotation.y = Math.PI / 2;
  stationRoof.position.set(0, METRO.trackHeight + 4.8, 0);
  stationGroup.add(stationRoof);

  // Pasarelas y escaleras de acceso peatonal desde la calle
  const stairsGeo = new THREE.BoxGeometry(3.5, METRO.trackHeight, 4.5);
  const stairsWest = new THREE.Mesh(stairsGeo, concreteMat);
  stairsWest.position.set(-stationWidth / 2 - 1.8, METRO.trackHeight / 2, 0);
  stationGroup.add(stairsWest);

  const stairsEast = new THREE.Mesh(stairsGeo, concreteMat);
  stairsEast.position.set(stationWidth / 2 + 1.8, METRO.trackHeight / 2, 0);
  stationGroup.add(stairsEast);

  stationGroup.position.set(METRO.x, 0, stationZ);
  group.add(stationGroup);

  // 4. CERRAMIENTOS DE OBRA REAL DE BOGOTÁ EN SUPERFICIE
  // Polisombra verde y maletines naranjas de desvío a lo largo de la Av. Caracas
  const workZoneZ = [65, 95, 125, 160, 200];
  for (const wZ of workZoneZ) {
    // Tela polisombra verde
    const poliGeo = new THREE.PlaneGeometry(16, 2.2);
    const poliLeft = new THREE.Mesh(poliGeo, polisombraMat);
    poliLeft.position.set(METRO.x - 3.2, 1.1, wZ);
    poliLeft.rotation.y = Math.PI / 2;
    group.add(poliLeft);

    const poliRight = new THREE.Mesh(poliGeo, polisombraMat);
    poliRight.position.set(METRO.x + 3.2, 1.1, wZ);
    poliRight.rotation.y = -Math.PI / 2;
    group.add(poliRight);

    // Maletines viales de plástico reflectantes
    for (let mz = -7; mz <= 7; mz += 2.4) {
      const isOrange = Math.abs(Math.round(mz)) % 2 === 0;
      const maletinMat = isOrange ? maletinOrangeMat : maletinWhiteMat;
      const malGeo = new THREE.BoxGeometry(0.5, 0.75, 1.2);
      const maletin = new THREE.Mesh(malGeo, maletinMat);
      maletin.position.set(METRO.x - 3.4, 0.38, wZ + mz);
      group.add(maletin);
    }
  }

  group.userData.colliders = colliders;
  return group;
}
