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

export const METRO_DETOUR = Object.freeze({
  z0: 130,              // Inicio del desvío al norte de Torre Colpatria
  z1: 210,              // Retorno al eje central al sur de Calle 26
  colpatriaStart: 154,  // Inicio del tramo que libra Torre Colpatria
  colpatriaEnd: 182,    // Fin del tramo que libra Torre Colpatria
  offset: -18           // Desvío al occidente (x = 75 - 18 = 57), librando Torre Colpatria (x = 69..93)
});

/** Devuelve la coordenada X del eje central del viaducto del Metro para cualquier cota Z. */
export function metroCenter(z) {
  const { z0, z1, colpatriaStart, colpatriaEnd, offset } = METRO_DETOUR;
  if (z <= z0 || z >= z1) return METRO.x;
  const t = z < colpatriaStart
    ? (z - z0) / (colpatriaStart - z0)
    : z > colpatriaEnd
      ? (z1 - z) / (z1 - colpatriaEnd)
      : 1;
  const clamped = Math.max(0, Math.min(1, t));
  const ease = clamped * clamped * (3 - 2 * clamped);
  return METRO.x + offset * ease;
}

/** Vector normal unitario horizontal perpendicular al eje del viaducto en Z. */
export function metroNormal(z) {
  const dx = (metroCenter(z + 0.1) - metroCenter(z - 0.1)) / 0.2;
  const len = Math.hypot(1, dx);
  return { x: 1 / len, z: -dx / len };
}

/** Construye una cinta geométrica extruida con ancho y cotas Y a lo largo del trazado. */
function createRibbonGeometry(offsetFromCenter, width, yTop, yBottom) {
  const step = 2;
  const zs = [];
  for (let z = METRO.zStart; z <= METRO.zEnd; z += step) zs.push(z);
  if (zs[zs.length - 1] < METRO.zEnd) zs.push(METRO.zEnd);

  const vertices = [];
  const indices = [];

  for (let i = 0; i < zs.length; i++) {
    const z = zs[i];
    const cx = metroCenter(z);
    const n = metroNormal(z);
    const centerX = cx + offsetFromCenter * n.x;
    const centerZ = z + offsetFromCenter * n.z;
    const halfW = width / 2;

    const lx = centerX - halfW * n.x, lz = centerZ - halfW * n.z;
    const rx = centerX + halfW * n.x, rz = centerZ + halfW * n.z;

    vertices.push(lx, yTop, lz);     // 4*i + 0
    vertices.push(rx, yTop, rz);     // 4*i + 1
    vertices.push(lx, yBottom, lz);  // 4*i + 2
    vertices.push(rx, yBottom, rz);  // 4*i + 3

    if (i < zs.length - 1) {
      const c = 4 * i;
      const next = 4 * (i + 1);

      // Cara superior
      indices.push(c + 0, next + 0, c + 1);
      indices.push(c + 1, next + 0, next + 1);

      // Cara inferior
      indices.push(c + 2, c + 3, next + 2);
      indices.push(c + 3, next + 3, next + 2);

      // Lateral izquierdo
      indices.push(c + 0, c + 2, next + 0);
      indices.push(c + 2, next + 2, next + 0);

      // Lateral derecho
      indices.push(c + 1, next + 1, c + 3);
      indices.push(c + 3, next + 1, next + 3);
    }
  }

  // Tapas frontal y posterior
  indices.push(0, 1, 2); indices.push(1, 3, 2);
  const last = 4 * (zs.length - 1);
  indices.push(last + 0, last + 2, last + 1); indices.push(last + 1, last + 2, last + 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

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

  // 1. VIADUCTO ELEVADO Y PILAS DE CONCRETO (Curvado para librar Torre Colpatria)
  // Tablero principal (viga cajón / dovelas)
  const deckGeo = createRibbonGeometry(0, METRO.deckWidth, METRO.trackHeight, METRO.trackHeight - METRO.deckThickness);
  const deck = new THREE.Mesh(deckGeo, darkConcreteMat);
  deck.name = 'TableroMetro';
  group.add(deck);

  // Barandas de protección lateral del viaducto
  const parapetHeight = 1.2;
  const parapetThickness = 0.35;
  const leftParapetOffset = -METRO.deckWidth / 2 + parapetThickness / 2;
  const rightParapetOffset = METRO.deckWidth / 2 - parapetThickness / 2;

  const leftParapetGeo = createRibbonGeometry(leftParapetOffset, parapetThickness, METRO.trackHeight + parapetHeight, METRO.trackHeight);
  const leftParapet = new THREE.Mesh(leftParapetGeo, concreteMat);
  leftParapet.name = 'BarandaMetroIzquierda';
  group.add(leftParapet);

  const rightParapetGeo = createRibbonGeometry(rightParapetOffset, parapetThickness, METRO.trackHeight + parapetHeight, METRO.trackHeight);
  const rightParapet = new THREE.Mesh(rightParapetGeo, concreteMat);
  rightParapet.name = 'BarandaMetroDerecha';
  group.add(rightParapet);

  // Lecho de vías (balasto)
  const ballastGeo = createRibbonGeometry(0, METRO.deckWidth - 1.2, METRO.trackHeight + 0.15, METRO.trackHeight);
  const ballast = new THREE.Mesh(ballastGeo, ballastMat);
  ballast.name = 'BalastoMetro';
  group.add(ballast);

  // 4 Rieles de acero (vía norte y vía sur)
  const railOffsets = [-2.6, -1.2, 1.2, 2.6];
  for (const rX of railOffsets) {
    const railGeo = createRibbonGeometry(rX, 0.1, METRO.trackHeight + 0.31, METRO.trackHeight + 0.13);
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.name = 'RielMetro';
    group.add(rail);
  }

  // Columnas / Pilas monumentales en el separador y pórticos donde cruza sobre el viaducto de buses
  const pillarHeight = METRO.trackHeight - METRO.deckThickness;
  const pillarGeo = new THREE.CylinderGeometry(METRO.pillarRadius, METRO.pillarRadius * 1.15, pillarHeight, 16);
  const capGeo = new THREE.BoxGeometry(METRO.deckWidth * 0.95, 1.2, 3.2);

  // Elementos para pórticos (straddle bents) donde el Metro pasa sobre el viaducto de buses (Issue #79)
  const porticoLegGeo = new THREE.CylinderGeometry(0.85, 0.95, pillarHeight, 16);
  const porticoBeamGeo = new THREE.BoxGeometry(17.5, 1.2, 3.0);

  for (let z = METRO.zStart + 6; z <= METRO.zEnd - 6; z += METRO.pillarSpacing) {
    const cx = metroCenter(z);
    const n = metroNormal(z);

    // Si coincide con la calzada del viaducto de buses (z < 95 o z > 250 donde el bus circula en x=75, calzada de 14m),
    // se construye un pórtico en herradura con dos apoyos laterales para no atravesar la vía de buses.
    const isBusViaductBelow = (z < 95 || z > 250);

    if (isBusViaductBelow) {
      const legDist = 8.2; // A 8.2m a cada lado del eje (x = 66.8 y 83.2, fuera de la calzada de 14m de buses)

      const leftPillar = new THREE.Mesh(porticoLegGeo, concreteMat);
      leftPillar.position.set(cx - legDist, pillarHeight / 2, z);
      leftPillar.name = `PorticoMetro_Izq_Z${z}`;
      group.add(leftPillar);

      const rightPillar = new THREE.Mesh(porticoLegGeo, concreteMat);
      rightPillar.position.set(cx + legDist, pillarHeight / 2, z);
      rightPillar.name = `PorticoMetro_Der_Z${z}`;
      group.add(rightPillar);

      const porticoBeam = new THREE.Mesh(porticoBeamGeo, darkConcreteMat);
      porticoBeam.position.set(cx, pillarHeight + 0.6, z);
      porticoBeam.name = `PorticoMetro_Dintel_Z${z}`;
      group.add(porticoBeam);

      // Colisionadores en las dos columnas laterales (dejando libre la calzada del bus al centro)
      colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(cx - legDist - 0.9, 0, z - 0.9),
          new THREE.Vector3(cx - legDist + 0.9, METRO.trackHeight, z + 0.9)
        ),
        mesh: leftPillar
      });
      colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(cx + legDist - 0.9, 0, z - 0.9),
          new THREE.Vector3(cx + legDist + 0.9, METRO.trackHeight, z + 0.9)
        ),
        mesh: rightPillar
      });
    } else {
      // Columna central cilíndrica estándar (sobre separador central o zona despejada)
      const pillar = new THREE.Mesh(pillarGeo, concreteMat);
      pillar.position.set(cx, pillarHeight / 2, z);
      pillar.name = `PilarMetro_Z${z}`;
      group.add(pillar);

      const cap = new THREE.Mesh(capGeo, darkConcreteMat);
      cap.position.set(cx, pillarHeight + 0.6, z);
      if (Math.abs(n.z) > 0.01) {
        cap.rotation.y = Math.atan2(-n.z, n.x);
      }
      cap.name = `CapitelMetro_Z${z}`;
      group.add(cap);

      colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(cx - METRO.pillarRadius, 0, z - METRO.pillarRadius),
          new THREE.Vector3(cx + METRO.pillarRadius, METRO.trackHeight, z + METRO.pillarRadius)
        ),
        mesh: pillar
      });
    }
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

    const trainX = metroCenter(cZ) + 1.9;
    carGroup.position.set(trainX, trainY, cZ);
    group.add(carGroup);
  }

  // 3. ESTACIONES ELEVADAS INTERMODALES DEL METRO DE BOGOTÁ (LÍNEA 1)
  // - Estación Calle 72 (Terminal norte de la Línea 1, Caracas con Calle 72, z=115)
  // - Estación Central / Calle 26 (Intercambio multimodal con TransMilenio y Centro Internacional, z=193)
  const buildStation = (stationZ, stationName) => {
    const stationX = metroCenter(stationZ);
    const stationWidth = 14;
    const stationLength = 32;
    const stationGroup = new THREE.Group();
    stationGroup.name = stationName;

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

    // Escaleras de acceso peatonal orientadas longitudinalmente sobre el separador
    // evitando invadir la calzada vehicular a los lados (x = 69..80)
    const stairWidth = 3.2;
    const stairLength = 5.0;
    const stairsGeo = new THREE.BoxGeometry(stairWidth, METRO.trackHeight, stairLength);

    const stairsNorth = new THREE.Mesh(stairsGeo, concreteMat);
    stairsNorth.position.set(0, METRO.trackHeight / 2, stationLength / 2 + stairLength / 2);
    stairsNorth.name = `${stationName}_EscaleraNorte`;
    stationGroup.add(stairsNorth);

    const stairsSouth = new THREE.Mesh(stairsGeo, concreteMat);
    stairsSouth.position.set(0, METRO.trackHeight / 2, -stationLength / 2 - stairLength / 2);
    stairsSouth.name = `${stationName}_EscaleraSur`;
    stationGroup.add(stairsSouth);

    // Colisionadores sólidos para las escaleras de acceso (evita atravesarlas como fantasma)
    colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(stationX - stairWidth / 2, 0, stationZ + stationLength / 2),
        new THREE.Vector3(stationX + stairWidth / 2, METRO.trackHeight, stationZ + stationLength / 2 + stairLength)
      ),
      mesh: stairsNorth
    });
    colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(stationX - stairWidth / 2, 0, stationZ - stationLength / 2 - stairLength),
        new THREE.Vector3(stationX + stairWidth / 2, METRO.trackHeight, stationZ - stationLength / 2)
      ),
      mesh: stairsSouth
    });

    stationGroup.position.set(stationX, 0, stationZ);
    return stationGroup;
  };

  group.add(buildStation(115, 'EstacionMetroCalle72'));
  group.add(buildStation(193, 'EstacionMetroCalle26'));

  // 4. CERRAMIENTOS DE OBRA REAL DE BOGOTÁ EN SUPERFICIE
  // Polisombra verde y maletines naranjas de desvío a lo largo de la Av. Caracas
  const workZoneZ = [65, 95, 125, 160, 200];
  for (const wZ of workZoneZ) {
    const wX = metroCenter(wZ);
    // Tela polisombra verde
    const poliGeo = new THREE.PlaneGeometry(16, 2.2);
    const poliLeft = new THREE.Mesh(poliGeo, polisombraMat);
    poliLeft.position.set(wX - 3.2, 1.1, wZ);
    poliLeft.rotation.y = Math.PI / 2;
    group.add(poliLeft);

    const poliRight = new THREE.Mesh(poliGeo, polisombraMat);
    poliRight.position.set(wX + 3.2, 1.1, wZ);
    poliRight.rotation.y = -Math.PI / 2;
    group.add(poliRight);

    // Maletines viales de plástico reflectantes
    for (let mz = -7; mz <= 7; mz += 2.4) {
      const isOrange = Math.abs(Math.round(mz)) % 2 === 0;
      const maletinMat = isOrange ? maletinOrangeMat : maletinWhiteMat;
      const malGeo = new THREE.BoxGeometry(0.5, 0.75, 1.2);
      const maletin = new THREE.Mesh(malGeo, maletinMat);
      maletin.position.set(wX - 3.4, 0.38, wZ + mz);
      group.add(maletin);
    }
  }

  group.userData.colliders = colliders;
  return group;
}
