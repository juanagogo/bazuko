// src/world/bogota/MetroBogota.js
// Recreación 3D interactiva de la Primera Línea del Metro de Bogotá (PLMB).
// Incluye viaducto elevado caminable sobre la Av. Caracas, tres estaciones elevadas con
// torniquetes y pantallas LED, y tren oficial rojo carmesí, blanco y amarillo oro en movimiento.

import * as THREE from 'three';

export const METRO = Object.freeze({
  x: 75,                // Eje central sobre el separador de la Av. Caracas
  zStart: 10,           // Extremo norte del viaducto en la ciudad
  zEnd: 310,            // Extremo sur del viaducto
  trackHeight: 12.5,    // Cota base del tablero del viaducto (metros sobre el suelo)
  deckSurfaceY: 12.65,  // Cota caminable sobre el balasto y rieles del viaducto
  platSurfaceY: 12.85,  // Cota caminable sobre los andenes de las estaciones
  deckWidth: 8.4,       // Ancho del viaducto para doble vía
  deckThickness: 1.4,   // Espesor de la viga cajón
  pillarSpacing: 24,    // Distancia entre pilas de concreto
  pillarRadius: 1.1     // Radio de las columnas en superficie
});

export const METRO_STATIONS = Object.freeze([
  { id: 'san_victorino', name: 'EstacionMetroSanVictorino', title: 'Estación San Victorino', shortName: 'San Victorino', z: 95 },
  { id: 'calle_26', name: 'EstacionMetroCalle26', title: 'Estación Calle 26', shortName: 'Calle 26', z: 135 },
  { id: 'calle_72', name: 'EstacionMetroCalle72', title: 'Estación Calle 72', shortName: 'Calle 72', z: 210 }
]);

const STATION_HALF_LEN = 16;
const STATION_HALF_WIDTH = 7.2;

/**
 * Superficie caminable elevada del Metro de Bogotá (andenes de estación y tablero del viaducto).
 * Devuelve `null` fuera de la huella elevada para no interferir con el tráfico a nivel de calle.
 */
export function metroSurface(x, z) {
  if (z < METRO.zStart || z > METRO.zEnd) return null;
  const dx = Math.abs(x - METRO.x);
  if (dx > STATION_HALF_WIDTH + 2.2) return null;

  for (const st of METRO_STATIONS) {
    const dz = Math.abs(z - st.z);
    // Pasarela de acceso y mirador lateral de la estación
    if (dz <= 4.5 && dx <= STATION_HALF_WIDTH + 2.0) {
      return METRO.platSurfaceY;
    }
    // Andenes laterales y cruce de vías dentro de la estación
    if (dz <= STATION_HALF_LEN && dx <= STATION_HALF_WIDTH) {
      return dx >= 3.3 ? METRO.platSurfaceY : METRO.deckSurfaceY + 0.1;
    }
  }

  // Tablero continuo del viaducto entre estaciones
  if (dx <= METRO.deckWidth / 2 - 0.3) {
    return METRO.deckSurfaceY;
  }
  return null;
}

/** ¿Hay cubierta de estación o tablero del viaducto encima? */
export function underMetroRoof(x, z) {
  if (z < METRO.zStart || z > METRO.zEnd) return false;
  const dx = Math.abs(x - METRO.x);
  for (const st of METRO_STATIONS) {
    if (Math.abs(z - st.z) <= STATION_HALF_LEN && dx <= STATION_HALF_WIDTH) return true;
  }
  return dx <= METRO.deckWidth / 2;
}

export function buildMetroBogota() {
  const group = new THREE.Group();
  group.name = 'MetroBogota';
  const colliders = [];

  // Materiales inspirados en los diseños oficiales y renders de referencia
  const concreteMat = new THREE.MeshLambertMaterial({ color: 0x9e9e9a, name: 'ConcretoMetro' });
  const darkConcreteMat = new THREE.MeshLambertMaterial({ color: 0x5c5d5a, name: 'ConcretoDovelas' });
  const platformFloorMat = new THREE.MeshStandardMaterial({ color: 0xb0b3b8, roughness: 0.4, metalness: 0.15, name: 'PisoAndenMetro' });
  const tactileYellowMat = new THREE.MeshBasicMaterial({ color: 0xf2a900, name: 'FranjaTactilAmarilla' });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd0d4dc, metalness: 0.85, roughness: 0.25, name: 'RielAcero' });
  const ballastMat = new THREE.MeshLambertMaterial({ color: 0x3a3b3a, name: 'Balasto' });
  const catenaryMat = new THREE.MeshStandardMaterial({ color: 0x3b424c, metalness: 0.7, roughness: 0.4, name: 'AceroCatenaria' });

  // Paleta del tren según blueprint (Rojo Carmesí #D9232A, Blanco Hueso #F4EFE6, Amarillo Oro #F2A900)
  const trainRedMat = new THREE.MeshStandardMaterial({ color: 0xd9232a, roughness: 0.3, metalness: 0.2, name: 'RojoMetroBogota' });
  const trainWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf4efe6, roughness: 0.25, metalness: 0.1, name: 'BlancoMetroBogota' });
  const trainYellowMat = new THREE.MeshStandardMaterial({ color: 0xf2a900, roughness: 0.35, metalness: 0.15, name: 'AmarilloMetroBogota' });
  const trainGlassMat = new THREE.MeshStandardMaterial({
    color: 0x16222f, roughness: 0.1, metalness: 0.8, transparent: true, opacity: 0.38, name: 'VidrioMetro'
  });
  const trainInteriorMat = new THREE.MeshBasicMaterial({ color: 0xfff3d1, name: 'LuzInteriorMetro' });
  const lightGlowMat = new THREE.MeshBasicMaterial({ color: 0xfff6c2, name: 'FarosLedMetro' });
  const tailLightMat = new THREE.MeshBasicMaterial({ color: 0xff2a2a, name: 'FarosTraserosMetro' });
  const pidBoardMat = new THREE.MeshBasicMaterial({ color: 0x151922, name: 'TableroLedFondo' });
  const pidAmberMat = new THREE.MeshBasicMaterial({ color: 0xffb300, name: 'TableroLedTexto' });
  const turnstileGreenMat = new THREE.MeshBasicMaterial({ color: 0x00e676, name: 'TorniqueteLuzVerde' });

  const polisombraMat = new THREE.MeshLambertMaterial({ color: 0x145a32, side: THREE.DoubleSide, name: 'PolisombraVerde' });
  const maletinOrangeMat = new THREE.MeshLambertMaterial({ color: 0xe65100, name: 'MaletinNaranja' });
  const maletinWhiteMat = new THREE.MeshLambertMaterial({ color: 0xf5f5f5, name: 'MaletinBlanco' });

  // 1. VIADUCTO ELEVADO Y PILAS EN Y SOBRE LA AV. CARACAS
  const length = METRO.zEnd - METRO.zStart;
  const centerZ = (METRO.zStart + METRO.zEnd) / 2;

  // Tablero principal (viga cajón continua)
  const deckGeo = new THREE.BoxGeometry(METRO.deckWidth, METRO.deckThickness, length);
  const deck = new THREE.Mesh(deckGeo, darkConcreteMat);
  deck.position.set(METRO.x, METRO.trackHeight - METRO.deckThickness / 2, centerZ);
  group.add(deck);

  // Lecho de vías (balasto) y pasillo central técnico caminable
  const ballastGeo = new THREE.BoxGeometry(METRO.deckWidth - 0.8, 0.16, length);
  const ballast = new THREE.Mesh(ballastGeo, ballastMat);
  ballast.position.set(METRO.x, METRO.trackHeight + 0.08, centerZ);
  group.add(ballast);

  // Pasarela peatonal central en concreto claro a lo largo de todo el viaducto
  const walkwayGeo = new THREE.BoxGeometry(1.5, 0.18, length);
  const walkway = new THREE.Mesh(walkwayGeo, platformFloorMat);
  walkway.position.set(METRO.x, METRO.trackHeight + 0.1, centerZ);
  group.add(walkway);

  // 4 Rieles de acero (vía norte y vía sur)
  const railPositionsX = [-2.6, -1.2, 1.2, 2.6];
  for (const rX of railPositionsX) {
    const railGeo = new THREE.BoxGeometry(0.1, 0.18, length);
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.position.set(METRO.x + rX, METRO.trackHeight + 0.19, centerZ);
    group.add(rail);
  }

  // Postes de catenaria a lo largo del eje central del viaducto
  const mastGeo = new THREE.CylinderGeometry(0.12, 0.14, 4.6, 8);
  const armGeo = new THREE.BoxGeometry(5.6, 0.12, 0.12);
  for (let z = METRO.zStart + 10; z <= METRO.zEnd - 10; z += 24) {
    const mast = new THREE.Mesh(mastGeo, catenaryMat);
    mast.position.set(METRO.x, METRO.trackHeight + 2.3, z);
    group.add(mast);
    const arm = new THREE.Mesh(armGeo, catenaryMat);
    arm.position.set(METRO.x, METRO.trackHeight + 4.3, z);
    group.add(arm);
  }

  // Barandas laterales del viaducto por tramos (se abren en las estaciones para pasar al andén)
  const parapetHeight = 1.25;
  const parapetThickness = 0.35;
  const stationRanges = METRO_STATIONS.map(s => [s.z - STATION_HALF_LEN, s.z + STATION_HALF_LEN]).sort((a, b) => a[0] - b[0]);
  const segments = [];
  let cursorZ = METRO.zStart;
  for (const [s0, s1] of stationRanges) {
    if (s0 > cursorZ) segments.push([cursorZ, s0]);
    cursorZ = Math.max(cursorZ, s1);
  }
  if (cursorZ < METRO.zEnd) segments.push([cursorZ, METRO.zEnd]);

  for (const [z0, z1] of segments) {
    const segLen = z1 - z0;
    const segCenterZ = (z0 + z1) / 2;
    const parapetGeo = new THREE.BoxGeometry(parapetThickness, parapetHeight, segLen);
    for (const side of [-1, 1]) {
      const px = METRO.x + side * (METRO.deckWidth / 2 - parapetThickness / 2);
      const py = METRO.trackHeight + parapetHeight / 2;
      const parapet = new THREE.Mesh(parapetGeo, concreteMat);
      parapet.position.set(px, py, segCenterZ);
      group.add(parapet);

      // Colisión layered: protege al jugador sobre el viaducto sin bloquear la calle abajo
      colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(px - parapetThickness / 2, METRO.trackHeight, z0),
          new THREE.Vector3(px + parapetThickness / 2, METRO.trackHeight + parapetHeight + 0.4, z1)
        ),
        mesh: parapet,
        layered: true
      });
    }
  }

  // Columnas / Pilas monumentales en Y en el separador de la Av. Caracas
  const pillarHeight = METRO.trackHeight - METRO.deckThickness;
  const pillarGeo = new THREE.CylinderGeometry(METRO.pillarRadius, METRO.pillarRadius * 1.15, pillarHeight - 2.0, 16);
  const capGeo = new THREE.BoxGeometry(METRO.deckWidth * 0.96, 1.3, 3.2);
  const branchGeo = new THREE.BoxGeometry(1.2, 2.8, 1.8);

  for (let z = METRO.zStart + 6; z <= METRO.zEnd - 6; z += METRO.pillarSpacing) {
    const pillar = new THREE.Mesh(pillarGeo, concreteMat);
    pillar.position.set(METRO.x, (pillarHeight - 2.0) / 2, z);
    group.add(pillar);

    // Brazos inclinados de la pila en Y
    for (const side of [-1, 1]) {
      const branch = new THREE.Mesh(branchGeo, concreteMat);
      branch.position.set(METRO.x + side * 1.65, pillarHeight - 1.1, z);
      branch.rotation.z = -side * 0.48;
      group.add(branch);
    }

    const cap = new THREE.Mesh(capGeo, darkConcreteMat);
    cap.position.set(METRO.x, pillarHeight + 0.55, z);
    group.add(cap);

    // Colisión sólida del pilar en el suelo (layered para no estorbar arriba en el viaducto)
    colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(METRO.x - METRO.pillarRadius, 0, z - METRO.pillarRadius),
        new THREE.Vector3(METRO.x + METRO.pillarRadius, METRO.trackHeight - 0.5, z + METRO.pillarRadius)
      ),
      mesh: pillar,
      layered: true
    });
  }

  // 2. EL TREN DEL METRO DE BOGOTÁ EN MOVIMIENTO (3 VAGONES ACOPLADOS)
  const trainGroup = new THREE.Group();
  trainGroup.name = 'TrenMetroBogota';
  trainGroup.userData.noMerge = true;

  const carLength = 15.5;
  const carWidth = 2.95;
  const carHeight = 3.35;
  const numCars = 3;
  const carGap = 0.65;
  const trackOffsetX = 1.9;

  for (let i = 0; i < numCars; i++) {
    const cZ = (1 - i) * (carLength + carGap);
    const carGroup = new THREE.Group();

    // Piso y techo del vagón con pasillo interior despejado
    const floorMesh = new THREE.Mesh(new THREE.BoxGeometry(carWidth, 0.22, carLength), trainRedMat);
    floorMesh.position.y = -carHeight / 2 + 0.11;
    carGroup.add(floorMesh);

    // Falda inferior amarillo oro oficial de Bogotá en ambos costados
    for (const side of [-1, 1]) {
      const sideX = side * (carWidth / 2);
      const skirtMesh = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.36, carLength + 0.04), trainYellowMat);
      skirtMesh.position.set(sideX, -carHeight / 2 + 0.22, 0);
      carGroup.add(skirtMesh);

      const lowerWall = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.85, carLength), trainRedMat);
      lowerWall.position.set(sideX, -carHeight / 2 + 0.82, 0);
      carGroup.add(lowerWall);

      const whiteBelt = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.24, carLength + 0.02), trainWhiteMat);
      whiteBelt.position.set(sideX, -0.35, 0);
      carGroup.add(whiteBelt);

      const upperWhite = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, carLength + 0.02), trainWhiteMat);
      upperWhite.position.set(sideX, carHeight / 2 - 0.35, 0);
      carGroup.add(upperWhite);

      const winMesh = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.18, carLength * 0.92), trainGlassMat);
      winMesh.position.set(sideX, 0.42, 0);
      carGroup.add(winMesh);

      for (const dz of [-5.2, -1.7, 1.7, 5.2]) {
        const doorMesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 2.15, 1.35), trainWhiteMat);
        doorMesh.position.set(sideX, -0.08, dz);
        carGroup.add(doorMesh);
        const doorWin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.95, 1.05), trainGlassMat);
        doorWin.position.set(sideX, 0.35, dz);
        carGroup.add(doorWin);
      }
    }

    // Techo rojo carmesí con equipos de aire acondicionado grises
    const roofMesh = new THREE.Mesh(new THREE.BoxGeometry(carWidth - 0.1, 0.34, carLength), trainRedMat);
    roofMesh.position.y = carHeight / 2 - 0.12;
    carGroup.add(roofMesh);

    const hvacMesh = new THREE.Mesh(new THREE.BoxGeometry(carWidth * 0.65, 0.22, carLength * 0.55), concreteMat);
    hvacMesh.position.y = carHeight / 2 + 0.14;
    carGroup.add(hvacMesh);

    // Iluminación interior cálida y pasamanos amarillos
    const ceilingLight = new THREE.Mesh(new THREE.BoxGeometry(carWidth * 0.5, 0.08, carLength * 0.88), trainInteriorMat);
    ceilingLight.position.y = carHeight / 2 - 0.32;
    carGroup.add(ceilingLight);

    for (let pz = -carLength * 0.36; pz <= carLength * 0.36; pz += 3.6) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, carHeight - 0.5, 6), trainYellowMat);
      pole.position.set(0.55, 0, pz);
      carGroup.add(pole);
    }

    // Fuelle de acople entre vagones
    if (i < numCars - 1) {
      const fuelle = new THREE.Mesh(new THREE.BoxGeometry(carWidth * 0.86, carHeight * 0.88, carGap + 0.1), ballastMat);
      fuelle.position.set(0, 0, -carLength / 2 - carGap / 2);
      carGroup.add(fuelle);
    }

    // Cabina aerodinámica en ambos extremos del tren (vagón norte y vagón sur)
    if (i === 0 || i === numCars - 1) {
      const signDir = i === 0 ? 1 : -1;
      const noseGroup = new THREE.Group();
      noseGroup.position.set(0, 0, signDir * (carLength / 2 + 0.85));
      if (signDir < 0) noseGroup.rotation.y = Math.PI;

      const noseBase = new THREE.Mesh(new THREE.BoxGeometry(carWidth, carHeight * 0.88, 1.7), trainRedMat);
      noseBase.position.y = -0.1;
      noseGroup.add(noseBase);

      const noseSkirt = new THREE.Mesh(new THREE.BoxGeometry(carWidth + 0.04, 0.48, 1.75), trainYellowMat);
      noseSkirt.position.y = -carHeight / 2 + 0.26;
      noseGroup.add(noseSkirt);

      const windshield = new THREE.Mesh(new THREE.BoxGeometry(carWidth * 0.82, 1.25, 0.18), trainGlassMat);
      windshield.position.set(0, 0.45, 0.82);
      windshield.rotation.x = -0.22;
      noseGroup.add(windshield);

      // Rótulo electrónico frontal "PORTAL - CENTRO"
      const destBg = new THREE.Mesh(new THREE.BoxGeometry(carWidth * 0.62, 0.28, 0.12), pidBoardMat);
      destBg.position.set(0, 1.18, 0.82);
      noseGroup.add(destBg);
      const destGlow = new THREE.Mesh(new THREE.BoxGeometry(carWidth * 0.52, 0.12, 0.14), pidAmberMat);
      destGlow.position.set(0, 1.18, 0.83);
      noseGroup.add(destGlow);

      // Faros LED frontales
      const headlightGeo = new THREE.SphereGeometry(0.2, 10, 8);
      const hMat = i === 0 ? lightGlowMat : tailLightMat;
      for (const sx of [-0.95, 0.95]) {
        const hl = new THREE.Mesh(headlightGeo, hMat);
        hl.position.set(sx, -0.58, 0.85);
        noseGroup.add(hl);
      }
      carGroup.add(noseGroup);
    }

    carGroup.position.set(0, 0, cZ);
    trainGroup.add(carGroup);
  }

  const trainBaseY = METRO.trackHeight + 0.28 + carHeight / 2;
  const trainState = {
    group: trainGroup,
    x: METRO.x + trackOffsetX,
    y: trainBaseY,
    z: 95,
    speed: 0,
    maxSpeed: 13.5,
    dir: 1,
    dwell: 3.5,
    currentStation: METRO_STATIONS[0],
    nextStation: METRO_STATIONS[1],
    setAtStation(targetZ) {
      this.z = targetZ;
      this.speed = 0;
      this.dwell = 5.0;
      trainGroup.position.set(this.x, this.y, this.z);
    }
  };

  trainGroup.position.set(trainState.x, trainState.y, trainState.z);

  trainGroup.userData.update = (dt) => {
    const clampedDt = Math.min(dt, 0.1);
    if (trainState.dwell > 0) {
      trainState.dwell = Math.max(0, trainState.dwell - clampedDt);
      trainState.speed = 0;
      return;
    }

    // Encontrar próxima estación en la dirección de marcha
    let upcoming = null;
    for (const st of METRO_STATIONS) {
      const dist = (st.z - trainState.z) * trainState.dir;
      if (dist > 0.2 && (!upcoming || dist < (upcoming.z - trainState.z) * trainState.dir)) {
        upcoming = st;
      }
    }
    trainState.nextStation = upcoming ?? (trainState.dir > 0 ? METRO_STATIONS.at(-1) : METRO_STATIONS[0]);

    // Aceleración y frenado suave al aproximarse a una estación
    const distToStation = upcoming ? Math.abs(upcoming.z - trainState.z) : 999;
    const targetSpeed = distToStation < 18
      ? Math.max(2.2, trainState.maxSpeed * (distToStation / 18))
      : trainState.maxSpeed;
    trainState.speed += (targetSpeed - trainState.speed) * Math.min(1, clampedDt * 3.5);

    const prevZ = trainState.z;
    trainState.z += trainState.dir * trainState.speed * clampedDt;

    // Parada automática en cada estación
    if (upcoming && (prevZ - upcoming.z) * (trainState.z - upcoming.z) <= 0) {
      trainState.z = upcoming.z;
      trainState.speed = 0;
      trainState.dwell = 5.5;
      trainState.currentStation = upcoming;
    } else {
      trainState.currentStation = null;
    }

    // Cambio de sentido en las cabeceras del viaducto (cola de maniobras)
    if (trainState.z >= 272) {
      trainState.z = 272;
      trainState.dir = -1;
      trainState.speed = 0;
      trainState.dwell = 2.5;
    } else if (trainState.z <= 38) {
      trainState.z = 38;
      trainState.dir = 1;
      trainState.speed = 0;
      trainState.dwell = 2.5;
    }

    trainGroup.position.set(trainState.x, trainState.y, trainState.z);
  };

  group.add(trainGroup);

  // 3. ESTACIONES ELEVADAS INTERMODALES DEL METRO DE BOGOTÁ (LÍNEA 1)
  const stationTargets = [];

  const buildStation = (station) => {
    const { z: stationZ, name: stationName, title } = station;
    const stationWidth = STATION_HALF_WIDTH * 2;
    const stationLength = STATION_HALF_LEN * 2;
    const stationGroup = new THREE.Group();
    stationGroup.name = stationName;

    // Andenes laterales elevados (oriente y occidente) + piso de conexión
    for (const side of [-1, 1]) {
      const sidePlat = new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.45, stationLength), platformFloorMat);
      sidePlat.position.set(side * 5.45, METRO.trackHeight + 0.18, 0);
      stationGroup.add(sidePlat);

      // Franja podotáctil amarilla de seguridad al borde del andén
      const tactile = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.47, stationLength - 1.2), tactileYellowMat);
      tactile.position.set(side * 3.95, METRO.trackHeight + 0.18, 0);
      stationGroup.add(tactile);

      // Cerramiento exterior en malla microperforada y baranda de vidrio templado
      const outerWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, stationLength), trainGlassMat);
      outerWall.position.set(side * (STATION_HALF_WIDTH - 0.1), METRO.trackHeight + 1.6, 0);
      stationGroup.add(outerWall);

      // Colisión exterior layered del andén para evitar caídas accidentales
      colliders.push({
        box: new THREE.Box3(
          new THREE.Vector3(METRO.x + side * (STATION_HALF_WIDTH + 0.9) - 0.25, METRO.trackHeight, stationZ - STATION_HALF_LEN),
          new THREE.Vector3(METRO.x + side * (STATION_HALF_WIDTH + 0.9) + 0.25, METRO.trackHeight + 2.4, stationZ + STATION_HALF_LEN)
        ),
        mesh: outerWall,
        layered: true
      });

      // Torniquetes de acero inoxidable TuLlave en el acceso central de cada andén
      for (const tz of [-2.2, 0, 2.2]) {
        const turnstile = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.05, 0.28), railMat);
        turnstile.position.set(side * 5.8, METRO.trackHeight + 0.88, tz);
        stationGroup.add(turnstile);
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.3), turnstileGreenMat);
        led.position.set(side * 5.3, METRO.trackHeight + 1.15, tz);
        stationGroup.add(led);
      }

      // Pantallas LED suspendidas (PID) de información al pasajero
      for (const pz of [-7.5, 7.5]) {
        const pidBox = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.65, 0.18), pidBoardMat);
        pidBox.position.set(side * 4.8, METRO.trackHeight + 3.45, pz);
        stationGroup.add(pidBox);
        const pidStrip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.2), pidAmberMat);
        pidStrip.position.set(side * 4.8, METRO.trackHeight + 3.52, pz);
        stationGroup.add(pidStrip);
        const pidAccent = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 0.2), tactileYellowMat);
        pidAccent.position.set(side * 4.8, METRO.trackHeight + 3.12, pz);
        stationGroup.add(pidAccent);
      }

      // Escaleras peatonales escalonadas desde el andén hasta la calle
      const numSteps = 12;
      const stairX = side * (STATION_HALF_WIDTH + 1.35);
      for (let s = 0; s < numSteps; s++) {
        const frac = (s + 0.5) / numSteps;
        const stepH = METRO.platSurfaceY * frac;
        const stepZ = -10 + s * 1.45;
        const stepMesh = new THREE.Mesh(new THREE.BoxGeometry(2.4, stepH, 1.5), concreteMat);
        stepMesh.position.set(stairX, stepH / 2, stepZ);
        stationGroup.add(stepMesh);
      }

      // Pórtico de entrada al Metro a nivel de calle (con franja roja y amarilla oficial)
      const portalTotem = new THREE.Mesh(new THREE.BoxGeometry(0.65, 3.4, 0.65), trainRedMat);
      portalTotem.position.set(stairX, 1.7, -11.5);
      stationGroup.add(portalTotem);
      const portalTop = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.45, 0.75), trainYellowMat);
      portalTop.position.set(stairX, 3.5, -11.5);
      stationGroup.add(portalTop);
    }

    // Cubierta abovedada translúcida y estructura metálica
    const roofCurveGeo = new THREE.CylinderGeometry(stationWidth * 0.62, stationWidth * 0.62, stationLength, 16, 1, false, 0, Math.PI);
    const stationRoof = new THREE.Mesh(roofCurveGeo, new THREE.MeshStandardMaterial({
      color: 0x263238, roughness: 0.25, metalness: 0.65, transparent: true, opacity: 0.88, side: THREE.DoubleSide
    }));
    stationRoof.rotation.z = Math.PI / 2;
    stationRoof.rotation.y = Math.PI / 2;
    stationRoof.position.set(0, METRO.trackHeight + 4.6, 0);
    stationGroup.add(stationRoof);

    stationGroup.position.set(METRO.x, 0, stationZ);

    // Puntos de interacción [E]: en los accesos a nivel de calle y arriba en el andén
    stationTargets.push({
      kind: 'metro',
      stationId: station.id,
      title,
      shortName: station.shortName,
      stationZ,
      level: 'street',
      position: new THREE.Vector3(METRO.x + 8.5, 0.12, stationZ - 11.5),
      interactDistance(playerPos) {
        // Alcanzable desde ambos accesos peatonales de la estación o desde el andén elevado
        const dEast = Math.hypot(playerPos.x - (METRO.x + 8.5), playerPos.z - (stationZ - 11.5));
        const dWest = Math.hypot(playerPos.x - (METRO.x - 8.5), playerPos.z - (stationZ - 11.5));
        const dCenter = Math.hypot(playerPos.x - METRO.x, playerPos.z - stationZ) * 0.45;
        return Math.min(dEast, dWest, dCenter);
      }
    });

    return stationGroup;
  };

  for (const st of METRO_STATIONS) {
    group.add(buildStation(st));
  }

  // 4. CERRAMIENTOS DE OBRA REAL DE BOGOTÁ EN SUPERFICIE
  const workZoneZ = [65, 95, 125, 160, 200];
  for (const wZ of workZoneZ) {
    const poliGeo = new THREE.PlaneGeometry(16, 2.2);
    const poliLeft = new THREE.Mesh(poliGeo, polisombraMat);
    poliLeft.position.set(METRO.x - 3.2, 1.1, wZ);
    poliLeft.rotation.y = Math.PI / 2;
    group.add(poliLeft);

    const poliRight = new THREE.Mesh(poliGeo, polisombraMat);
    poliRight.position.set(METRO.x + 3.2, 1.1, wZ);
    poliRight.rotation.y = -Math.PI / 2;
    group.add(poliRight);

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
  group.userData.train = trainState;
  group.userData.stations = stationTargets;
  return group;
}
