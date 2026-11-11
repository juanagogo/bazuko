// tools/fetch-bogota-real-map.mjs
// Extractor de Cartografía Oficial de Bogotá D.C. desde el servidor ArcGIS REST de
// IDECA / Unidad Administrativa Especial de Catastro Distrital (UAECD):
// https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer
//
// Capas oficiales consumidas:
// - Capa 39: Construcción (CONCODIGO, CONNPISOS, CONALTURA, geometría poligonal exacta)
// - Capa 40: Manzana Catastral (MANCODIGO, SECCODIGO, geometría poligonal exacta)
// - Capa 13: Malla Vial Integral (MVINOMBRE, MVIETIQUET, MVITIPO, ejes viales oficiales)
// - Capa 9:  Estaciones Troncales TransMilenio (NOMBRE_EST, UBICACION, TRONCAL, LATITUD, LONGITUD)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'src/data/bogota-real');

const IDECA_MAPSERVER = 'https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer';

const ZONAS_BOGOTA = {
  centroInternacional: {
    nombre: 'Centro Internacional, San Diego y Torre Colpatria',
    bbox: [4.6102, -74.0722, 4.6156, -74.0676], // [minLat, minLon, maxLat, maxLon]
    gameOrigin: { x: 160, z: 168, scale: 0.38 },
    hitos: ['Torre Colpatria', 'Planetario de Bogotá', 'Plaza La Santamaría', 'Museo Nacional', 'Hotel Tequendama'],
    tipo: 'centro_financiero_historico'
  },
  sanVictorinoCartucho: {
    nombre: 'San Victorino, Santa Inés (El Cartucho) y Av. Caracas',
    bbox: [4.5995, -74.0802, 4.6042, -74.0752],
    gameOrigin: { x: 95, z: 115, scale: 0.38 },
    hitos: ['Av. Caracas Metro L1', 'Plaza de La Mariposa', 'Santa Inés / El Cartucho', 'Carrera 10'],
    tipo: 'centro_popular_comercial'
  },
  zonaT: {
    nombre: 'Zona T (Zona Rosa, Calle 82)',
    bbox: [4.6652, -74.0558, 4.6682, -74.0522],
    gameOrigin: { x: 38, z: 75, scale: 0.35 },
    hitos: ['Centro Andino', 'Calle Peatonal T', 'El Retiro', 'Atlantis'],
    tipo: 'comercial_peatonal'
  },
  zonaG: {
    nombre: 'Zona G (Distrito Gourmet, Rosales)',
    bbox: [4.6522, -74.0575, 4.6555, -74.0538],
    gameOrigin: { x: 295, z: 115, scale: 0.35 },
    hitos: ['Calle 69 Gourmet', 'Casas de Conservación', 'Carrera 5', 'Mansión Reyes'],
    tipo: 'gastronomico_patrimonial'
  },
  parque93: {
    nombre: 'Parque de la 93 (Chicó)',
    bbox: [4.6752, -74.0528, 4.6782, -74.0492],
    gameOrigin: { x: 38, z: 25, scale: 0.35 },
    hitos: ['Parque Central de la 93', 'Pérgolas y Escultura', 'Edificios Corporativos'],
    tipo: 'parque_corporativo'
  }
};

// Conversión de coordenadas GPS (WGS84) a metros locales usando proyección Equirectangular
export function gpsToLocalMeters(lat, lon, refLat, refLon) {
  const DEG_TO_RAD = Math.PI / 180;
  const EARTH_RADIUS = 6371000;
  const x = (lon - refLon) * DEG_TO_RAD * Math.cos(refLat * DEG_TO_RAD) * EARTH_RADIUS;
  const z = (refLat - lat) * DEG_TO_RAD * EARTH_RADIUS;
  return { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 };
}

/** Consulta una capa oficial de IDECA Catastro Bogotá en formato GeoJSON (WGS84 / EPSG:4326) */
async function queryIdecaLayer(layerId, bbox, { outFields = '*', where = '1=1', maxRecords = 180 } = {}) {
  const [minLat, minLon, maxLat, maxLon] = bbox;
  const params = new URLSearchParams({
    geometry: `${minLon},${minLat},${maxLon},${maxLat}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    where,
    outFields,
    resultRecordCount: String(maxRecords),
    f: 'geojson'
  });
  const url = `${IDECA_MAPSERVER}/${layerId}/query?${params.toString()}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'BazukoBogotaOfficialCartography/1.0' }
  });
  if (!res.ok) throw new Error(`IDECA HTTP ${res.status} en capa ${layerId}`);
  return await res.json();
}

/** Convierte un anillo de coordenadas GeoJSON [[lon, lat], ...] a metros locales [[x, z], ...] */
function ringToMeters(ring, refLat, refLon) {
  if (!Array.isArray(ring)) return [];
  const pts = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon, lat] = ring[i];
    const m = gpsToLocalMeters(lat, lon, refLat, refLon);
    // Evitar vértices consecutivos duplicados tras redondeo
    if (!pts.length || Math.hypot(m.x - pts.at(-1)[0], m.z - pts.at(-1)[1]) >= 0.4) {
      pts.push([m.x, m.z]);
    }
  }
  return pts;
}

/** Extrae la cartografía oficial de IDECA (Manzanas, Construcciones, Vías y Estaciones) para un sector */
async function fetchIdecaSector(key, def) {
  const [minLat, minLon, maxLat, maxLon] = def.bbox;
  const refLat = (minLat + maxLat) / 2;
  const refLon = (minLon + maxLon) / 2;

  const [construccionesGeo, manzanasGeo, viasGeo, estacionesGeo] = await Promise.all([
    queryIdecaLayer(39, def.bbox, {
      outFields: 'CONCODIGO,CONNPISOS,CONALTURA,CONELEVACI',
      where: 'CONNPISOS >= 2',
      maxRecords: 200
    }),
    queryIdecaLayer(40, def.bbox, {
      outFields: 'MANCODIGO,SECCODIGO',
      maxRecords: 80
    }),
    queryIdecaLayer(13, def.bbox, {
      outFields: 'MVINOMBRE,MVIETIQUET,MVITIPO,MVICCALZAD',
      maxRecords: 120
    }),
    queryIdecaLayer(9, def.bbox, {
      outFields: 'NUMERO_EST,NOMBRE_EST,UBICACION,TRONCAL,LATITUD,LONGITUD',
      maxRecords: 30
    })
  ]);

  const buildings = [];
  for (const feat of construccionesGeo.features ?? []) {
    const coords = feat.geometry?.type === 'Polygon'
      ? feat.geometry.coordinates[0]
      : feat.geometry?.type === 'MultiPolygon'
        ? feat.geometry.coordinates[0]?.[0]
        : null;
    const footprint = ringToMeters(coords, refLat, refLon);
    if (footprint.length < 3) continue;
    const pisos = Math.max(1, Number(feat.properties?.CONNPISOS) || 2);
    const altura = Number(feat.properties?.CONALTURA) > 0
      ? Number(feat.properties.CONALTURA)
      : Math.round(pisos * 3.4 * 10) / 10;
    buildings.push({
      id: feat.properties?.CONCODIGO || `con-${buildings.length}`,
      levels: pisos,
      height: Math.min(196, altura),
      footprint
    });
  }

  const blocks = [];
  for (const feat of manzanasGeo.features ?? []) {
    const coords = feat.geometry?.type === 'Polygon'
      ? feat.geometry.coordinates[0]
      : feat.geometry?.type === 'MultiPolygon'
        ? feat.geometry.coordinates[0]?.[0]
        : null;
    const footprint = ringToMeters(coords, refLat, refLon);
    if (footprint.length < 3) continue;
    blocks.push({
      id: feat.properties?.MANCODIGO || `man-${blocks.length}`,
      sectorCode: feat.properties?.SECCODIGO || '',
      footprint
    });
  }

  const streets = [];
  for (const feat of viasGeo.features ?? []) {
    const lines = feat.geometry?.type === 'LineString'
      ? [feat.geometry.coordinates]
      : feat.geometry?.type === 'MultiLineString'
        ? feat.geometry.coordinates
        : [];
    for (const line of lines) {
      const path = line.map(([lon, lat]) => {
        const m = gpsToLocalMeters(lat, lon, refLat, refLon);
        return [m.x, m.z];
      });
      if (path.length < 2) continue;
      const name = feat.properties?.MVINOMBRE && feat.properties.MVINOMBRE !== 'SIN_NMG'
        ? feat.properties.MVINOMBRE
        : feat.properties?.MVIETIQUET || 'Vía Bogotá';
      streets.push({
        name: name.trim(),
        label: (feat.properties?.MVIETIQUET || '').trim(),
        type: (feat.properties?.MVITIPO || '').trim(),
        path
      });
    }
  }

  const stations = [];
  for (const feat of estacionesGeo.features ?? []) {
    const p = feat.properties ?? {};
    const lon = p.LONGITUD ?? feat.geometry?.coordinates?.[0];
    const lat = p.LATITUD ?? feat.geometry?.coordinates?.[1];
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const m = gpsToLocalMeters(lat, lon, refLat, refLon);
    stations.push({
      id: p.NUMERO_EST,
      name: p.NOMBRE_EST,
      location: p.UBICACION,
      corridor: p.TRONCAL,
      lat,
      lon,
      x: m.x,
      z: m.z
    });
  }

  return {
    key,
    nombre: def.nombre,
    bbox: def.bbox,
    refLat,
    refLon,
    gameOrigin: def.gameOrigin,
    counts: {
      buildings: buildings.length,
      blocks: blocks.length,
      streets: streets.length,
      stations: stations.length
    },
    buildings,
    blocks,
    streets,
    stations
  };
}

function getFallbackLandmarkCatalog() {
  return [
    {
      id: 'osm-colpatria-1',
      name: 'Torre Colpatria (Sede Grupo GER)',
      type: 'skyscraper',
      sector: 'Centro Internacional',
      lat: 4.6110, lon: -74.0703,
      levels: 50, height: 196,
      color: '#c1beb0',
      gamePos: { x: 81, z: 168 },
      footprint: [[-12, -13], [12, -13], [12, 13], [-12, 13]]
    },
    {
      id: 'osm-santamaria-2',
      name: 'Plaza de Toros de Santamaría',
      type: 'civic_heritage',
      sector: 'Parque de la Independencia',
      lat: 4.6128, lon: -74.0686,
      levels: 5, height: 16.5,
      color: '#9e3d2b',
      gamePos: { x: 248, z: 164 },
      footprint: [
        [11, 0], [7.8, 7.8], [0, 11], [-7.8, 7.8],
        [-11, 0], [-7.8, -7.8], [0, -11], [7.8, -7.8]
      ]
    },
    {
      id: 'osm-planetario-3',
      name: 'Planetario Distrital de Bogotá',
      type: 'cultural',
      sector: 'Parque de la Independencia',
      lat: 4.6121, lon: -74.0692,
      levels: 3, height: 12.0,
      color: '#d4cfc4',
      gamePos: { x: 232, z: 176 },
      footprint: [
        [8, 0], [5.6, 5.6], [0, 8], [-5.6, 5.6],
        [-8, 0], [-5.6, -5.6], [0, -8], [5.6, -5.6]
      ]
    },
    {
      id: 'osm-tequendama-4',
      name: 'Hotel y Residencias Tequendama',
      type: 'commercial_tower',
      sector: 'Centro Internacional',
      lat: 4.6143, lon: -74.0699,
      levels: 30, height: 102,
      color: '#b8b1a3',
      gamePos: { x: 146, z: 184 },
      footprint: [[-10, -6], [10, -6], [10, 6], [3, 6], [3, 12], [-10, 12]]
    },
    {
      id: 'osm-museo-nacional-5',
      name: 'Museo Nacional de Colombia (El Panóptico)',
      type: 'museum',
      sector: 'Centro Internacional',
      lat: 4.6155, lon: -74.0684,
      levels: 4, height: 14.5,
      color: '#a38f78',
      gamePos: { x: 202, z: 148 },
      footprint: [
        [-14, -4], [-4, -4], [-4, -12], [4, -12], [4, -4], [14, -4],
        [14, 4], [4, 4], [4, 12], [-4, 12], [-4, 4], [-14, 4]
      ]
    },
    {
      id: 'osm-torres-parque-6',
      name: 'Torres del Parque (Rogelio Salmona)',
      type: 'residential_heritage',
      sector: 'La Macarena / Independencia',
      lat: 4.6132, lon: -74.0674,
      levels: 37, height: 117,
      color: '#8f3a29',
      gamePos: { x: 355, z: 295 },
      footprint: [[-9, -5], [0, -8], [9, -5], [11, 4], [0, 7], [-11, 4]]
    },
    {
      id: 'osm-mansion-reyes-7',
      name: 'Mansión de la Familia Reyes (Zona G / Rosales)',
      type: 'mansion_heritage',
      sector: 'Zona G (Rosales)',
      lat: 4.6538, lon: -74.0558,
      levels: 3, height: 11.2,
      color: '#8b3a2b',
      gamePos: { x: 295, z: 108 },
      footprint: [[-9, -7], [9, -7], [9, 7], [3, 7], [3, 10], [-3, 10], [-3, 7], [-9, 7]]
    },
    {
      id: 'osm-centro-andino-8',
      name: 'Centro Comercial Andino y Tarima Zona T',
      type: 'mall',
      sector: 'Zona T (Calle 82)',
      lat: 4.6668, lon: -74.0536,
      levels: 5, height: 19.5,
      color: '#d9ccb8',
      gamePos: { x: 38, z: 62 },
      footprint: [[-14, -9], [14, -9], [14, 9], [-14, 9]]
    }
  ];
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  console.log('=== Extractor de Cartografía Oficial de Bogotá D.C. (IDECA / Catastro Distrital) ===\n');

  const idecaSectors = {};
  let totalBuildings = 0;
  let totalBlocks = 0;
  let totalStreets = 0;

  for (const [key, def] of Object.entries(ZONAS_BOGOTA)) {
    process.stdout.write(`Descargando cartografía oficial IDECA para ${def.nombre}... `);
    try {
      const sectorData = await fetchIdecaSector(key, def);
      idecaSectors[key] = sectorData;
      totalBuildings += sectorData.counts.buildings;
      totalBlocks += sectorData.counts.blocks;
      totalStreets += sectorData.counts.streets;
      console.log(
        `✔ ${sectorData.counts.blocks} manzanas, ${sectorData.counts.buildings} construcciones con altura real, ${sectorData.counts.streets} tramos viales.`
      );
    } catch (err) {
      console.log(`⚠ Error (${err.message})`);
    }
  }

  const officialPayload = {
    source: 'Unidad Administrativa Especial de Catastro Distrital (UAECD) — IDECA Mapa de Referencia Oficial de Bogotá D.C.',
    endpoint: IDECA_MAPSERVER,
    crs: 'EPSG:4326 (WGS84) -> Proyección Métrica Local Bazuko',
    generatedAt: new Date().toISOString(),
    totals: {
      sectors: Object.keys(idecaSectors).length,
      blocks: totalBlocks,
      buildings: totalBuildings,
      streets: totalStreets
    },
    landmarks: getFallbackLandmarkCatalog(),
    sectors: idecaSectors
  };

  const idecaPath = resolve(outDir, 'ideca-cartografia-oficial.json');
  writeFileSync(idecaPath, JSON.stringify(officialPayload, null, 2) + '\n');
  console.log(`\n✔ Cartografía Oficial IDECA guardada en: ${idecaPath}`);

  // Actualizar también osm-centro-internacional.json con las construcciones reales descargadas de IDECA
  const centro = idecaSectors.centroInternacional;
  const osmCompat = {
    refLat: centro?.refLat ?? 4.614,
    refLon: centro?.refLon ?? -74.07,
    source: officialPayload.source,
    buildings: getFallbackLandmarkCatalog(),
    idecaBuildings: centro?.buildings?.slice(0, 120) ?? [],
    idecaBlocks: centro?.blocks ?? [],
    idecaStreets: centro?.streets ?? [],
    idecaStations: centro?.stations ?? [],
    highways: [
      { id: 'way-caracas', name: 'Avenida Caracas (AK 14 - Viaducto Metro L1)', kind: 'primary', lanes: 6, path: [[75, 10], [75, 310]] },
      { id: 'way-calle26', name: 'Avenida Jorge Eliécer Gaitán (AC 26)', kind: 'primary', lanes: 6, path: [[10, 193], [380, 193]] },
      { id: 'way-cra10', name: 'Avenida Fernando Mazuera (KR 10)', kind: 'primary', lanes: 4, path: [[127, 10], [127, 310]] },
      { id: 'way-cra7', name: 'Avenida Alberto Lleras Camargo (KR 7)', kind: 'secondary', lanes: 4, path: [[217, 10], [217, 310]] }
    ]
  };
  writeFileSync(resolve(outDir, 'osm-centro-internacional.json'), JSON.stringify(osmCompat, null, 2) + '\n');
  console.log(`✔ Resumen general: ${totalBlocks} manzanas catastrales, ${totalBuildings} edificios con pisos reales y ${totalStreets} vías oficiales de Bogotá.`);
}

main().catch(console.error);
