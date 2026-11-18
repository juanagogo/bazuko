// src/world/bogota/RealBogotaOSM.js
// Replicador 3D Open-Source de Edificaciones y Polígonos Reales de Bogotá (OpenStreetMap + IDECA).
// Convierte huellas poligonales reales (WGS84 -> metros locales) en geometrías 3D extruidas (THREE.ExtrudeGeometry)
// e integra hitos emblemáticos del Centro Internacional, Zona G (Mansión Reyes) y Zona T.

import * as THREE from 'three';
import osmBogotaData from '../../data/bogota-real/osm-centro-internacional.json' with { type: 'json' };

/**
 * Extruye una huella poligonal 2D de OpenStreetMap / IDECA (`[[x, z], ...]`) en un volumen 3D de Three.js.
 */
export function extrudeOsmFootprint(footprint, height, material) {
  const shape = new THREE.Shape();
  footprint.forEach(([px, pz], idx) => {
    if (idx === 0) shape.moveTo(px, -pz);
    else shape.lineTo(px, -pz);
  });
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    steps: 1,
    depth: height,
    bevelEnabled: false
  });
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.userData.noMerge = true;
  return mesh;
}

export function buildRealBogotaOSM() {
  const group = new THREE.Group();
  group.name = 'RealBogotaOSM_IDECA';
  group.userData.noMerge = true;

  const brickSantamariaMat = new THREE.MeshLambertMaterial({ color: 0x9e3d2b, name: 'LadrilloSantamaria' });
  const sandRingMat = new THREE.MeshLambertMaterial({ color: 0xd9b982, name: 'ArenaRuedo' });
  const planetarioStoneMat = new THREE.MeshLambertMaterial({ color: 0xd8d4cb, name: 'PiedraPlanetario' });
  const domeMat = new THREE.MeshStandardMaterial({ color: 0xeae6df, roughness: 0.35, metalness: 0.2, name: 'CupulaPlanetario' });
  const museoStoneMat = new THREE.MeshLambertMaterial({ color: 0xa38f78, name: 'PiedraMuseoNacional' });
  const mansionBrickMat = new THREE.MeshLambertMaterial({ color: 0x8b3a2b, name: 'LadrilloMansionReyes' });
  const goldTrimMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 0.85, name: 'DoradoReyes' });
  const stageDarkMat = new THREE.MeshStandardMaterial({ color: 0x1e2229, roughness: 0.4, metalness: 0.7, name: 'TarimaAcero' });
  const stageNeonMat = new THREE.MeshBasicMaterial({ color: 0x00f5d4, name: 'LuzTarimaZonaT' });

  // 1. PLAZA DE TOROS DE SANTAMARÍA (Huella poligonal octogonal/circular de ladrillo bogotano)
  const santamariaDef = osmBogotaData.buildings?.find(b => b.id === 'osm-santamaria-2');
  if (santamariaDef) {
    const smGroup = new THREE.Group();
    smGroup.name = santamariaDef.name;
    const outerMesh = extrudeOsmFootprint(santamariaDef.footprint, 9.5, brickSantamariaMat);
    smGroup.add(outerMesh);

    const ruedo = new THREE.Mesh(new THREE.CylinderGeometry(6.2, 6.2, 0.4, 16), sandRingMat);
    ruedo.position.y = 9.4;
    ruedo.userData.noMerge = true;
    smGroup.add(ruedo);

    smGroup.position.set(santamariaDef.gamePos.x, 0, santamariaDef.gamePos.z);
    group.add(smGroup);
  }

  // 2. PLANETARIO DISTRITAL DE BOGOTÁ (Base circular + Cúpula hemisférica junto a Torre Colpatria)
  const planetarioDef = osmBogotaData.buildings?.find(b => b.id === 'osm-planetario-3');
  if (planetarioDef) {
    const plGroup = new THREE.Group();
    plGroup.name = planetarioDef.name;
    const baseMesh = extrudeOsmFootprint(planetarioDef.footprint, 6.5, planetarioStoneMat);
    plGroup.add(baseMesh);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(5.8, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      domeMat
    );
    dome.position.y = 6.5;
    dome.userData.noMerge = true;
    plGroup.add(dome);

    plGroup.position.set(planetarioDef.gamePos.x, 0, planetarioDef.gamePos.z);
    group.add(plGroup);
  }

  // 3. MUSEO NACIONAL DE COLOMBIA (El Panóptico sobre la Carrera 7)
  const museoDef = osmBogotaData.buildings?.find(b => b.id === 'osm-museo-nacional-5');
  if (museoDef) {
    const muGroup = new THREE.Group();
    muGroup.name = museoDef.name;
    const panoptico = extrudeOsmFootprint(museoDef.footprint, 10.5, museoStoneMat);
    muGroup.add(panoptico);

    const centralRotunda = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.5, 13.5, 8), museoStoneMat);
    centralRotunda.position.y = 6.75;
    centralRotunda.userData.noMerge = true;
    muGroup.add(centralRotunda);

    muGroup.position.set(museoDef.gamePos.x, 0, museoDef.gamePos.z);
    group.add(muGroup);
  }

  // 4. MANSIÓN DE LA FAMILIA REYES EN ZONA G / ROSALES (x: 295, z: 108)
  const mansionDef = osmBogotaData.buildings?.find(b => b.id === 'osm-mansion-reyes-7');
  if (mansionDef) {
    const mrGroup = new THREE.Group();
    mrGroup.name = mansionDef.name;
    const body = extrudeOsmFootprint(mansionDef.footprint, mansionDef.height, mansionBrickMat);
    mrGroup.add(body);

    // Pórtico clásico y columnas doradas/blancas de entrada
    for (const cx of [-2.2, 2.2]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 6.5, 10), planetarioStoneMat);
      col.position.set(cx, 3.25, 10.2);
      col.userData.noMerge = true;
      mrGroup.add(col);
    }
    const crest = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.8, 0.8), goldTrimMat);
    crest.position.set(0, 6.8, 10.2);
    crest.userData.noMerge = true;
    mrGroup.add(crest);

    mrGroup.position.set(mansionDef.gamePos.x, 0, mansionDef.gamePos.z);
    group.add(mrGroup);
  }

  // 5. TARIMA MUSICAL DE LA ZONA T (x: 22, z: 75)
  const stageGroup = new THREE.Group();
  stageGroup.name = 'TarimaMusicalZonaT';
  const deck = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.85, 5.5), stageDarkMat);
  deck.position.y = 0.42;
  deck.userData.noMerge = true;
  stageGroup.add(deck);

  for (const sx of [-3.8, 3.8]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.8, 0.35), stageDarkMat);
    pillar.position.set(sx, 2.8, -2.2);
    pillar.userData.noMerge = true;
    stageGroup.add(pillar);
  }
  const topTruss = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.4, 0.4), stageDarkMat);
  topTruss.position.set(0, 5.1, -2.2);
  topTruss.userData.noMerge = true;
  stageGroup.add(topTruss);

  const ledScreen = new THREE.Mesh(new THREE.BoxGeometry(6.4, 2.8, 0.2), stageNeonMat);
  ledScreen.position.set(0, 3.1, -2.1);
  ledScreen.userData.noMerge = true;
  stageGroup.add(ledScreen);

  stageGroup.position.set(22, 0, 75);
  group.add(stageGroup);

  group.userData.osmDataset = osmBogotaData;
  return group;
}
