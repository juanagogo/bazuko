import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, '../src/data/bogota-real/ideca-cartografia-oficial.json');
const outSvgPath = path.resolve(__dirname, '../public/metro-assets/mapa_oficial_ideca_bogota.svg');

const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const W = 2400;
const H = 1650;

function colorByFloors(floors) {
  if (floors >= 25) return '#D9232A'; // Rascacielos / Torre Colpatria (Rojo Metro)
  if (floors >= 12) return '#F2A900'; // Edificios altos financieros (Oro Bogota)
  if (floors >= 6) return '#5C3A21';  // Edificios residenciales/comerciales medios
  if (floors >= 3) return '#8B5A2B';  // Ladrillo bogotano 3-5 pisos
  return '#A67B5B';                   // Casas / comercio 1-2 pisos
}

function renderSectorBox(sectorKey, sector, bx, by, bw, bh, title, subtitle, code) {
  const halfExtent = 215; // meters around center
  const scale = Math.min(bw, bh) / (halfExtent * 2);
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  const toX = (x) => (cx + x * scale).toFixed(1);
  const toY = (z) => (cy + z * scale).toFixed(1);

  const blocks = sector.blocks || [];
  const streets = sector.streets || [];
  const buildings = sector.buildings || [];
  const stations = sector.stations || [];

  let svg = `
  <g>
    <!-- Fondo recuadro sector -->
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="8" fill="#C49A65" stroke="#14110C" stroke-width="3.5"/>
    <rect x="${bx + 6}" y="${by + 6}" width="${bw - 12}" height="${bh - 12}" rx="4" fill="#BA8D56" stroke="#14110C" stroke-width="1" stroke-dasharray="6 4"/>
    <clipPath id="clip-${sectorKey}">
      <rect x="${bx + 8}" y="${by + 8}" width="${bw - 16}" height="${bh - 16}" rx="4"/>
    </clipPath>
    <g clip-path="url(#clip-${sectorKey})">
  `;

  // Grid lines every 50m
  for (let m = -250; m <= 250; m += 50) {
    svg += `<line x1="${toX(m)}" y1="${by}" x2="${toX(m)}" y2="${by + bh}" stroke="#14110C" stroke-opacity="0.12" stroke-width="1"/>`;
    svg += `<line x1="${bx}" y1="${toY(m)}" x2="${bx + bw}" y2="${toY(m)}" stroke="#14110C" stroke-opacity="0.12" stroke-width="1"/>`;
  }

  // 1. Manzanas Catastrales Oficiales (Layer 40)
  for (const blk of blocks) {
    const fp = blk.footprint || blk.points;
    if (!fp || fp.length < 3) continue;
    const pts = fp.map(([x, z]) => `${toX(x)},${toY(z)}`).join(' ');
    svg += `<polygon points="${pts}" fill="#D5B07C" stroke="#14110C" stroke-width="2" stroke-opacity="0.85"/>`;
  }

  // 2. Malla Vial Oficial (Layer 13)
  for (const st of streets) {
    const pathPts = st.path || st.points;
    if (!pathPts || pathPts.length < 2) continue;
    const pts = pathPts.map(([x, z]) => `${toX(x)},${toY(z)}`).join(' ');
    const isArterial = /AK|AC|CARACAS|CARRERA 7|CARRERA 10|CALLE 26|CALLE 19|CALLE 13/i.test(st.label || st.name || '');
    svg += `<polyline points="${pts}" fill="none" stroke="${isArterial ? '#1E1A17' : '#4A4036'}" stroke-width="${isArterial ? 4.8 : 2.2}" stroke-opacity="0.75" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  // 3. Construcciones Oficiales IDECA (Layer 39) con altura real CONNPISOS
  for (const b of buildings) {
    const fp = b.footprint || b.points;
    if (!fp || fp.length < 3) continue;
    const pts = fp.map(([x, z]) => `${toX(x)},${toY(z)}`).join(' ');
    const floors = b.levels || b.floors || 1;
    const fill = colorByFloors(floors);
    const sw = floors >= 12 ? 1.8 : 0.9;
    svg += `<polygon points="${pts}" fill="${fill}" fill-opacity="0.93" stroke="#14110C" stroke-width="${sw}"/>`;
  }

  // 4. Estaciones Troncales (Layer 9)
  for (const st of stations) {
    svg += `<circle cx="${toX(st.x)}" cy="${toY(st.z)}" r="7" fill="#D9232A" stroke="#FFF" stroke-width="2"/>`;
  }

  // Center crosshair
  svg += `
      <circle cx="${cx}" cy="${cy}" r="5" fill="none" stroke="#AB1D17" stroke-width="2"/>
      <line x1="${cx - 10}" y1="${cy}" x2="${cx + 10}" y2="${cy}" stroke="#AB1D17" stroke-width="1.5"/>
      <line x1="${cx}" y1="${cy - 10}" x2="${cx}" y2="${cy + 10}" stroke="#AB1D17" stroke-width="1.5"/>
    </g>

    <!-- Etiqueta estilo Cinta Enmascarar -->
    <rect x="${bx + 14}" y="${by + 12}" width="${Math.min(bw - 28, 430)}" height="54" rx="3" fill="#E9DBB4" stroke="#14110C" stroke-width="2"/>
    <text x="${bx + 24}" y="${by + 34}" font-family="Impact, Arial Black, sans-serif" font-size="18" fill="#14110C" letter-spacing="0.8">${code} · ${title}</text>
    <text x="${bx + 24}" y="${by + 54}" font-family="Consolas, monospace" font-size="12.5" font-weight="bold" fill="#4A3520">${subtitle} | ${blocks.length} Manzanas · ${buildings.length} Predios</text>
  </g>`;

  return svg;
}

function renderUnifiedMap(bx, by, bw, bh) {
  let svg = `
  <g>
    <!-- Marco Carton Principal -->
    <rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="10" fill="#CBA26C" stroke="#14110C" stroke-width="5"/>
    <rect x="${bx + 10}" y="${by + 10}" width="${bw - 20}" height="${bh - 20}" rx="6" fill="#C1955E" stroke="#14110C" stroke-width="2"/>
    <clipPath id="clip-unified">
      <rect x="${bx + 12}" y="${by + 12}" width="${bw - 24}" height="${bh - 24}" rx="6"/>
    </clipPath>
    <g clip-path="url(#clip-unified)">
  `;

  // Cerros Orientales (Costado Oriental = Derecha del plano)
  svg += `
    <polygon points="${bx + bw - 170},${by} ${bx + bw},${by} ${bx + bw},${by + bh} ${bx + bw - 140},${by + bh} ${bx + bw - 195},${by + bh * 0.7} ${bx + bw - 160},${by + bh * 0.4}" fill="#4A5D3F" fill-opacity="0.45" stroke="#2D3B24" stroke-width="3" stroke-dasharray="10 6"/>
    <text x="${bx + bw - 65}" y="${by + bh / 2}" transform="rotate(-90 ${bx + bw - 65} ${by + bh / 2})" font-family="Impact, Arial Black, sans-serif" font-size="26" fill="#23311A" fill-opacity="0.65" text-anchor="middle" letter-spacing="6">CERROS ORIENTALES · MONSERRATE (3152m)</text>
  `;

  const placements = [
    { key: 'parque93', cx: bx + 430, cy: by + 230, scale: 0.52, label: 'PARQUE DE LA 93 (NORTE)' },
    { key: 'zonaT', cx: bx + 480, cy: by + 510, scale: 0.56, label: 'ZONA T / CALLE 82' },
    { key: 'zonaG', cx: bx + 790, cy: by + 540, scale: 0.56, label: 'ZONA G / ROSALES (MANSIÓN REYES)' },
    { key: 'centroInternacional', cx: bx + 660, cy: by + 890, scale: 0.62, label: 'CENTRO INTERNACIONAL · TORRE COLPATRIA' },
    { key: 'sanVictorinoCartucho', cx: bx + 380, cy: by + 1150, scale: 0.68, label: 'SAN VICTORINO · EL CARTUCHO · AV. CARACAS' },
  ];

  const avCaracasX = bx + 360;
  const craSeptimaX = bx + 680;
  const calle26Y = by + 890;
  const calle13Y = by + 1210;
  const calle82Y = by + 510;
  const calle93Y = by + 230;

  // Background grid
  for (let gx = bx + 60; gx < bx + bw - 140; gx += 60) {
    svg += `<line x1="${gx}" y1="${by}" x2="${gx}" y2="${by + bh}" stroke="#14110C" stroke-opacity="0.1" stroke-width="1"/>`;
  }
  for (let gy = by + 60; gy < by + bh; gy += 60) {
    svg += `<line x1="${bx}" y1="${gy}" x2="${bx + bw}" y2="${gy}" stroke="#14110C" stroke-opacity="0.1" stroke-width="1"/>`;
  }

  for (const p of placements) {
    const sec = data.sectors[p.key];
    if (!sec) continue;
    const toX = (x) => (p.cx + x * p.scale).toFixed(1);
    const toY = (z) => (p.cy + z * p.scale).toFixed(1);

    svg += `<circle cx="${p.cx}" cy="${p.cy}" r="${210 * p.scale}" fill="#B3834C" fill-opacity="0.35" stroke="#14110C" stroke-width="1.5" stroke-dasharray="8 6"/>`;

    for (const blk of sec.blocks || []) {
      const fp = blk.footprint || blk.points;
      if (!fp || fp.length < 3) continue;
      const pts = fp.map(([x, z]) => `${toX(x)},${toY(z)}`).join(' ');
      svg += `<polygon points="${pts}" fill="#D8B584" stroke="#14110C" stroke-width="1.6"/>`;
    }
    for (const st of sec.streets || []) {
      const pathPts = st.path || st.points;
      if (!pathPts || pathPts.length < 2) continue;
      const pts = pathPts.map(([x, z]) => `${toX(x)},${toY(z)}`).join(' ');
      svg += `<polyline points="${pts}" fill="none" stroke="#3B322C" stroke-width="2.2" stroke-opacity="0.65"/>`;
    }
    for (const b of sec.buildings || []) {
      const fp = b.footprint || b.points;
      if (!fp || fp.length < 3) continue;
      const pts = fp.map(([x, z]) => `${toX(x)},${toY(z)}`).join(' ');
      svg += `<polygon points="${pts}" fill="${colorByFloors(b.levels || b.floors || 1)}" stroke="#14110C" stroke-width="0.8"/>`;
    }
  }

  // Carrera 7
  svg += `<line x1="${craSeptimaX}" y1="${by + 40}" x2="${craSeptimaX}" y2="${by + bh - 40}" stroke="#14110C" stroke-width="10" stroke-opacity="0.75"/>`;
  svg += `<line x1="${craSeptimaX}" y1="${by + 40}" x2="${craSeptimaX}" y2="${by + bh - 40}" stroke="#F2A900" stroke-width="2" stroke-dasharray="10 8"/>`;

  // Calle 26 (Av. El Dorado)
  svg += `<line x1="${bx + 30}" y1="${calle26Y}" x2="${bx + bw - 150}" y2="${calle26Y}" stroke="#14110C" stroke-width="12" stroke-opacity="0.8"/>`;
  svg += `<line x1="${bx + 30}" y1="${calle26Y}" x2="${bx + bw - 150}" y2="${calle26Y}" stroke="#FFFFFF" stroke-width="2" stroke-dasharray="14 10"/>`;

  // Calle 13 / Av Jimenez
  svg += `<line x1="${bx + 30}" y1="${calle13Y}" x2="${bx + bw - 150}" y2="${calle13Y}" stroke="#14110C" stroke-width="9" stroke-opacity="0.75"/>`;

  // Calle 82 & Calle 93
  svg += `<line x1="${bx + 120}" y1="${calle82Y}" x2="${bx + bw - 160}" y2="${calle82Y}" stroke="#14110C" stroke-width="7" stroke-opacity="0.65"/>`;
  svg += `<line x1="${bx + 120}" y1="${calle93Y}" x2="${bx + bw - 160}" y2="${calle93Y}" stroke="#14110C" stroke-width="7" stroke-opacity="0.65"/>`;

  // VIADUCTO LÍNEA 1 DEL METRO DE BOGOTÁ (Av. Caracas)
  svg += `<line x1="${avCaracasX}" y1="${by + 40}" x2="${avCaracasX}" y2="${by + bh - 30}" stroke="#14110C" stroke-width="18"/>`;
  svg += `<line x1="${avCaracasX}" y1="${by + 40}" x2="${avCaracasX}" y2="${by + bh - 30}" stroke="#D9232A" stroke-width="10"/>`;
  svg += `<line x1="${avCaracasX}" y1="${by + 40}" x2="${avCaracasX}" y2="${by + bh - 30}" stroke="#F2A900" stroke-width="2.5" stroke-dasharray="16 12"/>`;

  const metroStations = [
    { y: calle93Y, name: 'EST. CALLE 93 (NORTE)' },
    { y: calle82Y, name: 'EST. CALLE 72 / ZONA T' },
    { y: calle26Y, name: 'EST. CENTRO INTERNACIONAL (C.26)' },
    { y: calle13Y - 60, name: 'EST. SAN VICTORINO / AV. CARACAS' },
  ];
  for (const ms of metroStations) {
    svg += `
      <rect x="${avCaracasX - 22}" y="${ms.y - 14}" width="44" height="28" rx="5" fill="#2E7D32" stroke="#FFFFFF" stroke-width="3"/>
      <circle cx="${avCaracasX}" cy="${ms.y}" r="6" fill="#F2A900"/>
      <rect x="${avCaracasX - 210}" y="${ms.y - 13}" width="180" height="26" rx="3" fill="#14110C" fill-opacity="0.9"/>
      <text x="${avCaracasX - 120}" y="${ms.y + 5}" font-family="Arial Black, sans-serif" font-size="10.5" fill="#F2A900" text-anchor="middle">${ms.name}</text>
    `;
  }

  for (const p of placements) {
    svg += `
      <g transform="translate(${p.cx}, ${p.cy - 210 * p.scale - 18})">
        <rect x="-155" y="-18" width="310" height="32" rx="4" fill="#E9DBB4" stroke="#14110C" stroke-width="2.5"/>
        <text x="0" y="4" font-family="Impact, Arial Black, sans-serif" font-size="15" fill="#14110C" text-anchor="middle" letter-spacing="0.8">${p.label}</text>
      </g>
    `;
  }

  svg += `
    <g transform="translate(${bx + 90}, ${by + 110})">
      <circle cx="0" cy="0" r="42" fill="#E9DBB4" stroke="#14110C" stroke-width="3"/>
      <polygon points="0,-36 10,0 0,-10 -10,0" fill="#AB1D17" stroke="#14110C" stroke-width="1.5"/>
      <polygon points="0,36 10,0 0,10 -10,0" fill="#14110C"/>
      <text x="0" y="-46" font-family="Impact, sans-serif" font-size="18" fill="#14110C" text-anchor="middle">N</text>
    </g>
  `;

  svg += `
    <g transform="translate(${bx + 30}, ${by + bh - 185})">
      <rect x="0" y="0" width="560" height="155" rx="6" fill="#E9DBB4" stroke="#14110C" stroke-width="3"/>
      <text x="18" y="28" font-family="Impact, Arial Black, sans-serif" font-size="18" fill="#14110C" letter-spacing="1">LEYENDA CARTOGRÁFICA OFICIAL IDECA — BAZUKO</text>
      
      <rect x="18" y="42" width="22" height="14" fill="#D8B584" stroke="#14110C" stroke-width="2"/>
      <text x="48" y="54" font-family="Consolas, monospace" font-size="13" font-weight="bold" fill="#14110C">Manzana Catastral Oficial (Capa 40 IDECA)</text>

      <rect x="18" y="66" width="22" height="14" fill="#A67B5B" stroke="#14110C" stroke-width="1.5"/>
      <text x="48" y="78" font-family="Consolas, monospace" font-size="13" font-weight="bold" fill="#14110C">Construcción 1–2 Pisos (Comercio / Casa)</text>

      <rect x="18" y="90" width="22" height="14" fill="#8B5A2B" stroke="#14110C" stroke-width="1.5"/>
      <text x="48" y="102" font-family="Consolas, monospace" font-size="13" font-weight="bold" fill="#14110C">Construcción 3–11 Pisos (Ladrillo Bogotano)</text>

      <rect x="18" y="114" width="22" height="14" fill="#F2A900" stroke="#14110C" stroke-width="1.5"/>
      <text x="48" y="126" font-family="Consolas, monospace" font-size="13" font-weight="bold" fill="#14110C">Torres 12–24 Pisos (Financiero / Residencial)</text>

      <rect x="315" y="42" width="22" height="14" fill="#D9232A" stroke="#14110C" stroke-width="1.8"/>
      <text x="345" y="54" font-family="Consolas, monospace" font-size="13" font-weight="bold" fill="#14110C">Rascacielos +25 Pisos (Colpatria)</text>

      <line x1="315" y1="73" x2="339" y2="73" stroke="#D9232A" stroke-width="7"/>
      <text x="345" y="78" font-family="Consolas, monospace" font-size="13" font-weight="bold" fill="#14110C">Viaducto Metro Línea 1 (Y=12.65m)</text>

      <rect x="318" y="90" width="16" height="14" rx="3" fill="#2E7D32" stroke="#FFF" stroke-width="2"/>
      <text x="345" y="102" font-family="Consolas, monospace" font-size="13" font-weight="bold" fill="#14110C">Estación Elevada Metro / Troncal</text>

      <text x="18" y="145" font-family="Consolas, monospace" font-size="12" fill="#AB1D17" font-weight="bold">TOTAL GEOMETRÍA REAL DESCARGADA: 121 Manzanas · 1,000 Edificios con Pisos · 390 Tramos Viales</text>
    </g>
  `;

  svg += `
    </g>
  </g>`;
  return svg;
}

let fullSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <!-- Fondo General Mesa de Trabajo Carton Oscuro -->
  <rect width="${W}" height="${H}" fill="#1E1914"/>
  
  <!-- Header Banner -->
  <rect x="30" y="24" width="${W - 60}" height="96" rx="8" fill="#E9DBB4" stroke="#14110C" stroke-width="4"/>
  <rect x="42" y="34" width="14" height="76" fill="#D9232A"/>
  <rect x="62" y="34" width="8" height="76" fill="#F2A900"/>
  <text x="88" y="68" font-family="Impact, Arial Black, sans-serif" font-size="34" fill="#14110C" letter-spacing="1.5">PLANO DE SUPERVISIÓN — RÉPLICA EXACTA CARTOGRAFÍA OFICIAL IDECA BOGOTÁ (BAZUKO)</text>
  <text x="88" y="98" font-family="Consolas, monospace" font-size="16" font-weight="bold" fill="#4A3520">FUENTE OFICIAL: Unidad Administrativa Especial de Catastro Distrital (IDECA ArcGIS REST MapServer · EPSG:4326) · 121 Manzanas · 1,000 Construcciones · 390 Vías</text>

  <!-- Panel Izquierdo: Mapa Unificado del Juego con Polígonos Oficiales -->
  ${renderUnifiedMap(30, 140, 1140, 1480)}

  <!-- Panel Derecho: 5 Sectores Catastrales Oficiales a Escala -->
  ${renderSectorBox('centroInternacional', data.sectors.centroInternacional, 1200, 140, 570, 475, 'CENTRO INTERNACIONAL', 'Torre Colpatria · Cra 7 · Calle 26', 'SEC-01')}
  ${renderSectorBox('sanVictorinoCartucho', data.sectors.sanVictorinoCartucho, 1800, 140, 570, 475, 'SAN VICTORINO / EL CARTUCHO', 'Av. Caracas · Calle 12 · Plaza Mariposa', 'SEC-02')}
  ${renderSectorBox('zonaT', data.sectors.zonaT, 1200, 642, 570, 475, 'ZONA T / CALLE 82', 'Cra 13 · Calle 82 · Zona Rosa', 'SEC-03')}
  ${renderSectorBox('zonaG', data.sectors.zonaG, 1800, 642, 570, 475, 'ZONA G / ROSALES', 'Cra 5 · Calle 70 · Mansión Los Reyes', 'SEC-04')}
  ${renderSectorBox('parque93', data.sectors.parque93, 1200, 1145, 1170, 475, 'PARQUE DE LA 93 / CHICÓ NORTE', 'Cra 11A – Cra 13 · Calle 93A – Calle 93B · Trazado Catastral Completo', 'SEC-05')}
</svg>`;

fs.mkdirSync(path.dirname(outSvgPath), { recursive: true });
fs.writeFileSync(outSvgPath, fullSvg, 'utf8');
console.log('Saved SVG to', outSvgPath);
