// src/world/bogota/MetroBogota.js
// Viaducto de la Caracas en la ciudad del juego, con un tramo habilitado para rodaje de pruebas.

import * as THREE from 'three';
import { vestirDeConcreto, vestirCaja, vestirPilaRedonda, vestirBloque, cubiertaDeEstacion, polisombraDeObra } from './concretoViaducto.js';
import { piezasDeMaletin, geometriaDeMaletin, pinturaDeMaletines, giroDeMaletin } from './maletinesObra.js';
import { addMetroTrain } from './MetroTrain.js';
import { metroTrainMaterials } from './MetroTrainTextures.js';
import { metroBoxes, metroCivilMaterials, metroPortalSpan, metroStationEdges, metroTrackFurniture,
  metroPierBearings } from './MetroCivilWorks.js';
import { COLPATRIA } from './Colpatria.js';
import { SMALL_BUILDING } from './SmallBuilding.js';

export const METRO = Object.freeze({
  x: 75,                // Eje central sobre el separador de la Av. Caracas
  zStart: -74,          // Estribo sobre el límite norte del Portal
  zEnd: 310,            // Extremo sur del viaducto
  trackHeight: 13.25,   // Cota del tablero (metros sobre el suelo)
  deckWidth: 8.4,       // Ancho del viaducto para doble vía
  deckThickness: .60,   // Deja gálibo sobre el bus y sus climatizadores en el viaducto inferior
  pillarSpacing: 24,    // Distancia entre pilas de concreto
  pillarRadius: 1.1     // Radio de las columnas cilíndricas
});

export const METRO_SPANS = Object.freeze([
  Object.freeze([METRO.zStart, SMALL_BUILDING.z - SMALL_BUILDING.depth / 2 - 1]),
  Object.freeze([COLPATRIA.z + COLPATRIA.depth / 2 + 2.5, METRO.zEnd])
]);

const STATIONS = [
  { z: 115, name: 'EstacionMetroCalle72', platform: [58, 117], canopy: [64, 116.8], eastAccess: { width: 2.25, depth: 2, shift: 1.25 } },
  { z: 193, name: 'EstacionMetroCalle26', platform: [188, 220], canopy: [188, 220] }
];
const FIRST_PIER = 16;

export function buildMetroBogota({ pavement, waterBottomAt } = {}) {
  const group = new THREE.Group();
  group.name = 'MetroBogota';
  const colliders = [];

  // Materiales PBR
  // El mismo concreto gastado del viaducto del bus; las dovelas, un tono más oscuras.
  const concreteMat = vestirDeConcreto(new THREE.MeshLambertMaterial({ color: 0x9e9e9a, name: 'ConcretoMetro' }));
  const darkConcreteMat = vestirDeConcreto(new THREE.MeshLambertMaterial({ color: 0x5c5d5a, name: 'ConcretoDovelas' }), '#9d9c96');
  const railMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.85, roughness: 0.25, name: 'RielAcero' });
  const ballastMat = new THREE.MeshLambertMaterial({ color: 0x3a3b3a, name: 'Balasto' });
  const trainMaterials = metroTrainMaterials();
  const steel = metroCivilMaterials();
  const polisombraMat = new THREE.MeshLambertMaterial({ color: 0x1d5a3a, side: THREE.DoubleSide, name: 'PolisombraVerde' });
  // Tela tejida que cuelga entre parales, con barro y rotos; los maletines, quemados por el sol.
  const tela = polisombraDeObra();
  if (tela) { polisombraMat.map = tela; polisombraMat.color.set('#ffffff'); polisombraMat.alphaTest = .5; }
  const maletinOrangeMat = new THREE.MeshLambertMaterial({ color: 0xa85424, name: 'MaletinNaranja' });
  const maletinWhiteMat = new THREE.MeshLambertMaterial({ color: 0xbdb9ac, name: 'MaletinBlanco' });
  const pinturaMaletin = pinturaDeMaletines();
  if (pinturaMaletin) {
    maletinOrangeMat.map = pinturaMaletin.naranja; maletinOrangeMat.color.set('#ffffff');
    maletinWhiteMat.map = pinturaMaletin.blanco; maletinWhiteMat.color.set('#ffffff');
  }

  // 1. VIADUCTO ELEVADO Y PILAS DE CONCRETO
  const centerZ = (METRO.zStart + METRO.zEnd) / 2;
  const longitudinal = (segments, w, h) => segments.map(([a, b]) => [w, h, b - a, 0, 0, (a + b) / 2 - centerZ]);

  // El vano entre las dos obras deja libres el Edificio Cinco Pisos y la Torre Colpatria.
  const deckGeo = metroBoxes(longitudinal(METRO_SPANS, METRO.deckWidth, METRO.deckThickness), { concrete: true, slab: true });
  const deck = new THREE.Mesh(deckGeo, darkConcreteMat);
  deck.name = 'Tablero del Metro';
  deck.userData.rainCover = true;
  deck.position.set(METRO.x, METRO.trackHeight - METRO.deckThickness / 2, centerZ);
  group.add(deck);

  // Barandas de protección lateral del viaducto
  const parapetHeight = 1.2;
  const parapetThickness = 0.35;
  const [north, south] = METRO_SPANS;
  const parapets = [[FIRST_PIER, STATIONS[0].platform[0]], [STATIONS[0].platform[1], north[1]],
    [south[0], STATIONS[1].platform[0]], [STATIONS[1].platform[1], south[1]]];
  const lowCurb = .34;
  const lowered = [parapetThickness, lowCurb, FIRST_PIER - north[0], 0,
    (lowCurb - parapetHeight) / 2, (FIRST_PIER + north[0]) / 2 - centerZ];
  const parapetGeo = metroBoxes([...longitudinal(parapets, parapetThickness, parapetHeight), lowered], { concrete: true });
  const leftParapet = new THREE.Mesh(parapetGeo, concreteMat);
  leftParapet.name = 'Pretil occidental del Metro';
  leftParapet.position.set(METRO.x - METRO.deckWidth / 2 + parapetThickness / 2, METRO.trackHeight + parapetHeight / 2, centerZ);
  group.add(leftParapet);

  const rightParapet = new THREE.Mesh(parapetGeo, concreteMat);
  rightParapet.name = 'Pretil oriental del Metro';
  rightParapet.position.set(METRO.x + METRO.deckWidth / 2 - parapetThickness / 2, METRO.trackHeight + parapetHeight / 2, centerZ);
  group.add(rightParapet);

  // Lecho de vías (balasto) y rieles dobles
  const ballastGeo = metroBoxes(longitudinal(METRO_SPANS, METRO.deckWidth - 1.2, .15));
  const ballast = new THREE.Mesh(ballastGeo, ballastMat);
  ballast.name = 'Lecho de vías del Metro';
  ballast.position.set(METRO.x, METRO.trackHeight + 0.08, centerZ);
  group.add(ballast);

  // 4 Rieles de acero (vía norte y vía sur)
  const railPositionsX = [-2.6, -1.2, 1.2, 2.6];
  for (const rX of railPositionsX) {
    const railGeo = metroBoxes(longitudinal(METRO_SPANS, .10, .18));
    const rail = new THREE.Mesh(railGeo, railMat);
    rail.name = 'Riel del Metro';
    rail.position.set(METRO.x + rX, METRO.trackHeight + 0.22, centerZ);
    group.add(rail);
  }

  // Columnas / Pilas monumentales en el separador
  const pillarHeight = METRO.trackHeight - METRO.deckThickness - .15;
  const pillarGeo = new THREE.CylinderGeometry(METRO.pillarRadius, METRO.pillarRadius * 1.15, pillarHeight, 16);
  const capHeight = .43, capGeo = new THREE.BoxGeometry(METRO.deckWidth * .95, capHeight, 3.2);
  vestirPilaRedonda(pillarGeo, 16);
  vestirCaja(capGeo, METRO.deckWidth * 0.95, 3.2);
  const piers = [];

  for (let site = FIRST_PIER; site <= METRO.zEnd - 6; site += METRO.pillarSpacing) {
    // Dos fustes sostienen los andenes en Z112. La pila que antes caía dentro de Colpatria sostiene el oriental.
    const sharedPier = site === 112 || site === 160;
    const z = sharedPier ? 112 : site;
    const side = site === 112 ? -1 : 1;
    const interrupted = z > north[1] && z < south[0];
    const height = interrupted ? 3 : pillarHeight;
    // Columna cilíndrica
    const pillar = new THREE.Mesh(pillarGeo, concreteMat);
    const waterBottom = waterBottomAt?.(METRO.x, z);
    const base = Number.isFinite(waterBottom) ? Math.min(0, waterBottom - .15) : 0;
    pillar.name = interrupted ? 'Pila de la obra interrumpida' : 'Pila del Metro';
    pillar.scale.set(sharedPier ? .55 : 1, (height - base) / pillarHeight, sharedPier ? .85 : 1);
    pillar.position.set(METRO.x + (sharedPier ? side * .51 : 0), (height + base) / 2, z);
    group.add(pillar);

    // Capitel de apoyo en martillo
    const cap = new THREE.Mesh(capGeo, darkConcreteMat);
    cap.name = 'Capitel del Metro';
    cap.position.set(METRO.x + (sharedPier ? side * 1.99 : 0), height + capHeight / 2, z);
    if (sharedPier) cap.scale.x = .5;
    if (interrupted) cap.scale.set(.33, 1, .76);
    group.add(cap);

    // Colisión sólida del pilar en el suelo
    if (site === 160) continue;
    if (!interrupted) piers.push(z);
    colliders.push({
      box: new THREE.Box3(
        new THREE.Vector3(METRO.x - METRO.pillarRadius, 0, z - METRO.pillarRadius),
        new THREE.Vector3(METRO.x + METRO.pillarRadius, interrupted ? height + capHeight : height, z + METRO.pillarRadius)
      ),
      mesh: pillar
    });
  }

  // 2. TREN DE PRUEBAS DE LA LÍNEA 1
  group.userData.train = addMetroTrain(group, trainMaterials, ballastMat, METRO);

  // 3. ESTACIONES ELEVADAS INTERMODALES DEL METRO DE BOGOTÁ (LÍNEA 1)
  // - Estación Calle 72 (Terminal norte de la Línea 1, Caracas con Calle 72)
  // - Estación Central / Calle 26 (Intercambio multimodal con TransMilenio y Centro Internacional)
  const buildStation = station => {
    const stationWidth = 14;
    const inner = 3.61, outer = 7.35, floor = METRO.trackHeight + .77, spring = METRO.trackHeight + 4.8;
    const [from, to] = station.platform, [roofFrom, roofTo] = station.canopy;
    const stationGroup = new THREE.Group();
    stationGroup.name = station.name;

    // Los andenes quedan a los costados. El hueco del centro deja paso al perfil del convoy.
    const platGeo = metroBoxes([-1, 1].map(side => [outer - inner, .87, to - from,
      side * (inner + outer) / 2, floor - .435, (from + to) / 2 - station.z]), { concrete: true, slab: true });
    const plat = new THREE.Mesh(platGeo, concreteMat);
    plat.name = 'Andenes laterales del Metro';
    plat.userData.rainCover = true;
    stationGroup.add(plat);

    // Cubierta abovedada de vidrio y acero
    const roofCurveGeo = new THREE.CylinderGeometry(stationWidth * 0.6, stationWidth * 0.6, roofTo - roofFrom, 16, 1, false, 0, Math.PI);
    // Cubierta de vidrio sucio sobre arcos y correas de acero, con cumbrera y canales de zinc.
    const roofMat = new THREE.MeshStandardMaterial({
      color: 0x7f8c8d, roughness: 0.38, metalness: 0.3, transparent: true, opacity: 0.6, side: THREE.DoubleSide
    });
    const roofMap = cubiertaDeEstacion();
    if (roofMap) { roofMat.map = roofMap; roofMat.color.set('#ffffff'); roofMat.opacity = 1; }
    const stationRoof = new THREE.Mesh(roofCurveGeo, roofMat);
    stationRoof.name = 'Cubierta de la estación';
    stationRoof.rotation.z = Math.PI / 2;
    stationRoof.rotation.y = Math.PI / 2;
    stationRoof.position.set(0, spring, (roofFrom + roofTo) / 2 - station.z);
    stationGroup.add(stationRoof);

    // Pasarelas y escaleras de acceso peatonal desde la calle
    const stairsGeo = new THREE.BoxGeometry(3.5, floor, 4.5);
    vestirBloque(stairsGeo);
    const stairsWest = new THREE.Mesh(stairsGeo, concreteMat);
    stairsWest.name = 'Acceso occidental del Metro';
    stairsWest.position.set(-stationWidth / 2 - 1.8, floor / 2, 0);
    stationGroup.add(stairsWest);

    const stairsEast = new THREE.Mesh(stairsGeo, concreteMat);
    stairsEast.name = 'Acceso oriental del Metro';
    const { width, depth, shift } = station.eastAccess ?? { width: 3.5, depth: 4.5, shift: 0 };
    stairsEast.scale.set(width / 3.5, 1, depth / 4.5);
    // La curva del bus pasa por el costado oriental. El acceso se retrasa hasta que queda libre el borde de su tablero.
    stairsEast.position.set(stationWidth / 2 + .05 + width / 2, floor / 2, shift);
    stationGroup.add(stairsEast);

    metroStationEdges(stationGroup, station, inner, outer, floor, spring, steel);
    stationGroup.position.set(METRO.x, 0, station.z);
    return stationGroup;
  };

  for (const station of STATIONS) group.add(buildStation(station));
  metroPortalSpan(group, METRO, FIRST_PIER, concreteMat, steel);
  metroPierBearings(group, METRO.x, piers, steel);
  metroTrackFurniture(group, METRO, METRO_SPANS, steel);

  // 4. CERRAMIENTOS DE OBRA REAL DE BOGOTÁ EN SUPERFICIE
  // Polisombra verde y maletines naranjas de desvío a lo largo de la Av. Caracas
  const workZoneZ = [65, 95, 125, 160, 200];
  const piezasMaletin = piezasDeMaletin();
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
      const malGeo = geometriaDeMaletin(piezasMaletin);
      const maletin = new THREE.Mesh(malGeo, maletinMat);
      maletin.position.set(METRO.x - 3.4, 0.38, wZ + mz);
      maletin.rotation.y = giroDeMaletin(maletin.position.x, maletin.position.z);
      group.add(maletin);
    }
  }

  group.userData.colliders = colliders;
  return group;
}
