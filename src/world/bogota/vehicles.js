// src/world/bogota/vehicles.js
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { radialSprite } from './textures.js';

// Texturas compartidas en cach├⌐ para evitar regeneraci├│n y consumo de memoria
const texCache = new Map();

function createSafeCanvasTexture(w, h, drawFn) {
  if (typeof document === 'undefined') {
    return new THREE.Texture();
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (ctx) {
    drawFn(ctx, c);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const PUBLIC_PLATES = [
  { code: 'WDD 512', city: 'BOGOT├ü D.C.' },
  { code: 'VEP 384', city: 'BOGOT├ü D.C.' },
  { code: 'TLX 709', city: 'BOGOT├ü D.C.' },
  { code: 'SPO 192', city: 'SOACHA' },
  { code: 'SKM 463', city: 'BOGOT├ü D.C.' },
  { code: 'WPD 204', city: 'BOGOT├ü D.C.' },
  { code: 'STP 827', city: 'CH├ìA' },
  { code: 'TET 351', city: 'BOGOT├ü D.C.' },
  { code: 'WDA 940', city: 'BOGOT├ü D.C.' },
  { code: 'UPB 628', city: 'ENVIGADO' },
  { code: 'VEE 175', city: 'BOGOT├ü D.C.' },
];

export const PRIVATE_PLATES = [
  { code: 'BGO 418', city: 'BOGOT├ü D.C.' },
  { code: 'CKM 890', city: 'BOGOT├ü D.C.' },
  { code: 'DKS 214', city: 'BOGOT├ü D.C.' },
  { code: 'FKB 719', city: 'BOGOT├ü D.C.' },
  { code: 'RNY 531', city: 'ENVIGADO' },
  { code: 'KLY 672', city: 'BOGOT├ü D.C.' },
  { code: 'ZNT 108', city: 'CH├ìA' },
  { code: 'HWK 345', city: 'BOGOT├ü D.C.' },
  { code: 'MHO 962', city: 'MEDELL├ìN' },
  { code: 'NCX 803', city: 'BOGOT├ü D.C.' },
];

/** Placas colombianas: amarilla para particular, blanca para p├║blico/taxi */
function getPlateTexture(code, city, isPublic = false) {
  const key = `plate_${code}_${isPublic}_${city}`;
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = isPublic ? '#f4f4f4' : '#f5bc18';
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = isPublic ? '#d0d0d0' : '#d49b0e';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, 242, 114);

    ctx.strokeStyle = '#181818';
    ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 236, 108);

    ctx.lineWidth = 2;
    ctx.strokeRect(16, 16, 224, 96);

    ctx.fillStyle = '#222222';
    ctx.beginPath();
    ctx.arc(32, 28, 4, 0, Math.PI * 2);
    ctx.arc(224, 28, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 46px "Arial Black", Impact, sans-serif';
    const displayCode = code.includes('┬╖') ? code : code.replace(' ', ' ┬╖ ');
    ctx.fillText(displayCode, 128, 54);

    ctx.font = '800 17px "Arial Black", sans-serif';
    ctx.fillText(city, 128, 96);
  });

  texCache.set(key, t);
  return t;
}

/** Calcoman├¡a obligatoria de puertas en taxis colombianos */
function getTaxiDoorTexture(code, city = 'BOGOT├ü D.C.') {
  const key = `taxi_door_${code}`;
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 8;
    ctx.strokeRect(8, 8, 240, 240);

    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';

    ctx.font = '900 24px sans-serif';
    ctx.fillText(city, 128, 46);

    ctx.fillRect(20, 62, 216, 4);

    ctx.font = '900 42px "Arial Black", sans-serif';
    ctx.fillText(code, 128, 122);

    ctx.fillRect(20, 154, 216, 4);

    ctx.font = '800 20px sans-serif';
    ctx.fillText('SERVICIO P├ÜBLICO', 128, 190);
    ctx.font = '700 17px sans-serif';
    ctx.fillText('RADIO TAXI', 128, 222);
  });

  texCache.set(key, t);
  return t;
}

/** Placa pintada en el techo del taxi para control a├⌐reo */
function getTaxiRoofPlateTexture(code) {
  const key = `taxi_roof_${code}`;
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#f2ba06';
    ctx.fillRect(0, 0, 256, 128);

    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 58px "Arial Black", sans-serif';
    ctx.fillText(code, 128, 64);
  });

  texCache.set(key, t);
  return t;
}

/** Capacete de taxi iluminado */
function getTaxiSignTexture() {
  const key = 'taxi_sign';
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#ffe500';
    ctx.fillRect(0, 0, 256, 128);

    ctx.strokeStyle = '#222222';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 244, 116);

    ctx.fillStyle = '#111111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 68px "Arial Black", sans-serif';
    ctx.fillText('TAXI', 128, 64);
  });

  texCache.set(key, t);
  return t;
}

/** Parrilla frontal con insignia estilizada no comercial (geométrica / criolla) */
function getGrilleTexture(badge = 'rombo') {
  const key = `grille_${badge}`;
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(256, 64, (ctx) => {
    ctx.fillStyle = '#15171a';
    ctx.fillRect(0, 0, 256, 64);

    ctx.fillStyle = '#26292d';
    for (let y = 10; y < 58; y += 10) {
      ctx.fillRect(8, y, 240, 4);
    }

    ctx.strokeStyle = '#3a3e44';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 248, 56);

    ctx.save();
    ctx.translate(128, 32);
    if (badge === 'rombo') {
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 5;
      ctx.fillStyle = '#1e2023';
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(15, 0);
      ctx.lineTo(0, 20);
      ctx.lineTo(-15, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
    } else if (badge === 'alas') {
      ctx.fillStyle = '#d5d7db';
      ctx.fillRect(-24, -4, 48, 8);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-24, -4, 48, 8);
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 20, 11, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, 12, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  });

  texCache.set(key, t);
  return t;
}

/** Farola delantera texturizada */
function getHeadlightTexture(round = false) {
  const key = `headlight_${round}`;
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(128, 64, (ctx) => {
    if (round) {
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, 128, 64);
      ctx.strokeStyle = '#d5d7db';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(64, 32, 26, 0, Math.PI * 2);
      ctx.stroke();
      const g = ctx.createRadialGradient(64, 32, 3, 64, 32, 23);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.6, '#fff4dc');
      g.addColorStop(1, '#c4bda8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(64, 32, 23, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(0, 0, 128, 0);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.68, '#fff6e5');
      g.addColorStop(0.72, '#ff9800');
      g.addColorStop(1, '#e65100');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 64);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 2;
      for (let x = 8; x < 90; x += 12) {
        ctx.beginPath();
        ctx.moveTo(x, 4);
        ctx.lineTo(x, 60);
        ctx.stroke();
      }
    }
  });

  texCache.set(key, t);
  return t;
}

/** Luces traseras combinadas (freno, direccional, reversa) */
function getTaillightTexture() {
  const key = 'taillight';
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = '#d32f2f';
    ctx.fillRect(0, 0, 64, 58);
    ctx.fillStyle = '#ff9800';
    ctx.fillRect(0, 58, 64, 35);
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(0, 93, 64, 35);

    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    for (let y = 6; y < 124; y += 8) {
      ctx.fillRect(0, y, 64, 2);
    }
  });

  texCache.set(key, t);
  return t;
}

/** Tapacubos / rin con radios y tuercas */
function getRimTexture() {
  const key = 'wheel_rim';
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(0, 0, 128, 128);

    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 58, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(64, 64, 48, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#9ca3af';
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      ctx.save();
      ctx.translate(64, 64);
      ctx.rotate(a);
      ctx.fillRect(-6, -48, 12, 48);
      ctx.restore();
    }

    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(64, 64, 17, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f3f4f6';
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI * 2) / 4;
      ctx.beginPath();
      ctx.arc(64 + Math.cos(a) * 10, 64 + Math.sin(a) * 10, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  texCache.set(key, t);
  return t;
}

/** Tabla cl├ísica de buseta bogotana en el panor├ímico */
function getBusetaRouteBoardTexture(routeIndex = 0) {
  const routes = [
    { num: '14-2', dest: 'CRA 10 ┬╖ SOACHA', via: 'SAN MATEO ┬╖ BOSA', bg: '#1b5e20', numBg: '#fbc02d' },
    { num: '314', dest: 'CL 80 ┬╖ ENGATIV├ü', via: 'V├ìA CORINTO ┬╖ MINUTO', bg: '#0d47a1', numBg: '#d32f2f' },
    { num: 'E25', dest: 'SUBA ┬╖ CENTRO', via: 'CALLE 100 ┬╖ CRA 7MA', bg: '#b71c1c', numBg: '#ffffff' },
    { num: '496', dest: 'FONTIB├ôN ┬╖ CL 26', via: 'SALITRE ┬╖ GERMANIA', bg: '#e65100', numBg: '#1b5e20' },
  ];
  const r = routes[Math.abs(routeIndex) % routes.length];
  const key = `bus_board_${r.num}`;
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = '#111417';
    ctx.fillRect(0, 0, 512, 128);

    ctx.fillStyle = r.numBg;
    ctx.fillRect(8, 8, 100, 112);
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 40px sans-serif';
    ctx.fillText(r.num, 58, 64);

    ctx.fillStyle = r.bg;
    ctx.fillRect(116, 8, 388, 58);
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 26px sans-serif';
    ctx.fillText(r.dest, 310, 37);

    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(116, 72, 388, 48);
    ctx.fillStyle = '#1e1e1e';
    ctx.font = '800 21px sans-serif';
    ctx.fillText(r.via, 310, 96);
  });

  texCache.set(key, t);
  return t;
}

/** Livery lateral de buseta tradicional de Bogot├í */
function getBusetaLiveryTexture(route) {
  const key = `buseta_livery_${route}`;
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = '#f0ede6';
    ctx.fillRect(0, 0, 1024, 256);

    ctx.fillStyle = '#1b7339';
    ctx.fillRect(0, 156, 1024, 26);

    ctx.fillStyle = '#c0292b';
    ctx.fillRect(0, 184, 1024, 14);

    ctx.fillStyle = '#f5b025';
    ctx.fillRect(0, 200, 1024, 8);

    ctx.fillStyle = '#133a21';
    ctx.fillRect(0, 210, 1024, 46);

    ctx.fillStyle = '#143d22';
    ctx.font = '900 32px sans-serif';
    ctx.fillText('COOPCASUR LTDA.', 40, 60);

    ctx.fillStyle = '#444444';
    ctx.font = '800 20px sans-serif';
    ctx.fillText('SITP PROVISIONAL ┬╖ CAPACIDAD 19 PASAJEROS', 40, 95);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 28px sans-serif';
    ctx.fillText(route, 40, 242);
  });

  texCache.set(key, t);
  return t;
}

/** Livery blanco y verde institucional de la Polic├¡a Nacional de Colombia */
function getPoliceLiveryTexture() {
  const key = 'police_livery';
  if (texCache.has(key)) return texCache.get(key);

  const t = createSafeCanvasTexture(1024, 256, (ctx) => {
    ctx.fillStyle = '#f4f6f8';
    ctx.fillRect(0, 0, 1024, 256);

    ctx.fillStyle = '#0b5c2e';
    ctx.fillRect(0, 72, 1024, 88);

    ctx.fillStyle = '#ffd100';
    ctx.fillRect(0, 68, 1024, 5);
    ctx.fillRect(0, 159, 1024, 5);

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '900 48px Overpass, "Arial Black", sans-serif';
    ctx.fillText('POLIC├ìA', 512, 104);
    ctx.font = '800 20px Overpass, "Arial Black", sans-serif';
    ctx.fillText('NACIONAL ┬╖ DIOS Y PATRIA', 512, 138);

    ctx.font = '900 28px sans-serif';
    ctx.fillText('CAI', 110, 116);
    ctx.font = '800 18px sans-serif';
    ctx.fillText('123', 910, 116);
  });

  texCache.set(key, t);
  return t;
}

const cache = {};
function shared() {
  if (cache.ready) return cache;
  cache.glass = new THREE.MeshPhysicalMaterial({ color: '#0a0d12', metalness: 0.2, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
  cache.tire = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 });
  cache.rim = new THREE.MeshStandardMaterial({ map: getRimTexture(), metalness: 0.85, roughness: 0.35 });
  cache.dark = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.7 });
  cache.chrome = new THREE.MeshStandardMaterial({ color: '#d5d7db', metalness: 0.9, roughness: 0.15 });
  cache.head = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dc').multiplyScalar(3) });
  cache.tail = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a12').multiplyScalar(1.4) });
  cache.wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 18);
  cache.wheelGeo.rotateX(Math.PI / 2);
  cache.rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12);
  cache.rimGeo.rotateX(Math.PI / 2);
  cache.plateGeo = new THREE.PlaneGeometry(0.44, 0.22);
  cache.beamTex = radialSprite(128, 'rgba(255,240,215,0.9)', 'rgba(255,240,215,0)');
  cache.flareTex = radialSprite(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  cache.ready = true;
  return cache;
}

export const PAINTS = ['#e8e8e6', '#b9bec4', '#1d1f22', '#7a1414', '#1f3d6b', '#4d5a3a', '#8c8f93', '#d9d4c7'];

const HUEVITO_PAINTS = ['#2e7d32', '#1565c0', '#c62828', '#fbc02d', '#b0bec5', '#f5f5f5'];
const AMIGOFIEL_PAINTS = ['#ede8d5', '#35688a', '#8b261e', '#3e563d', '#c29440', '#ffffff'];
const ZAPATICO_PAINTS = ['#d32f2f', '#f5f5f5', '#90a4ae', '#1a1c1e', '#1976d2', '#e65100'];
const SEDAN_PAINTS = ['#78909c', '#f5f5f5', '#1a365d', '#5d1010', '#181a1c', '#a1887f'];

function paint(color) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
}

/**
 * Crea un veh├¡culo colombiano aut├⌐ntico. El frente apunta a +X local.
 * kind: 'taxi' | 'carro' | 'buseta' | 'police'
 */
export function makeVehicle(kind = 'carro', seedColor = 0, { beams = true } = {}) {
  const s = shared();
  const g = new THREE.Group();
  const isBus = kind === 'buseta';
  const isTaxi = kind === 'taxi';
  const isPolice = kind === 'police';

  // Selecci├│n de modelo reconocible de Colombia
  let model = 'zapatico';
  if (isBus) {
    model = 'buseta';
  } else if (isPolice) {
    model = 'sedan';
  } else if (isTaxi) {
    model = (Math.abs(seedColor) % 3 === 0) ? 'sedan' : 'zapatico';
  } else {
    const models = ['zapatico', 'huevito', 'amigofiel', 'sedan'];
    model = models[Math.abs(seedColor) % models.length];
  }

  // Dimensiones según el arquetipo (L=4.3, W=1.76 para carros garantiza compatibilidad total con tráfico)
  let L = 4.3, W = 1.76, H = 0.74, cabinY = 1.25, cabinL = 2.25, cabinW = 1.58, roofL = 1.75;
  if (model === 'buseta') {
    L = 7.6; W = 2.3; H = 2.6;
  } else if (model === 'huevito') {
    H = 0.72; cabinY = 1.22; cabinL = 2.35; cabinW = 1.58; roofL = 1.82;
  } else if (model === 'amigofiel') {
    H = 0.75; cabinY = 1.28; cabinL = 2.38; cabinW = 1.52; roofL = 1.95;
  } else if (model === 'sedan') {
    H = 0.76; cabinY = 1.26; cabinL = 2.35; cabinW = 1.62; roofL = 1.78;
  }

  // Color de carrocer├¡a aut├⌐ntico
  let color = '#f2ba06'; // Amarillo taxi Bogot├í
  if (isPolice) {
    color = '#f4f6f8';
  } else if (!isTaxi && !isBus) {
    if (model === 'huevito') color = HUEVITO_PAINTS[Math.abs(seedColor) % HUEVITO_PAINTS.length];
    else if (model === 'amigofiel') color = AMIGOFIEL_PAINTS[Math.abs(seedColor) % AMIGOFIEL_PAINTS.length];
    else if (model === 'sedan') color = SEDAN_PAINTS[Math.abs(seedColor) % SEDAN_PAINTS.length];
    else color = ZAPATICO_PAINTS[Math.abs(seedColor) % ZAPATICO_PAINTS.length];
  }

  let bodyMat = paint(color);
  if (isBus) {
    bodyMat = new THREE.MeshPhysicalMaterial({
      map: getBusetaLiveryTexture('CENTRO ┬╖ TERMINAL ┬╖ SOACHA'),
      metalness: 0.2,
      roughness: 0.4,
      clearcoat: 0.8
    });
  } else if (isPolice) {
    bodyMat = new THREE.MeshPhysicalMaterial({
      map: getPoliceLiveryTexture(),
      metalness: 0.25,
      roughness: 0.38,
      clearcoat: 0.9,
      clearcoatRoughness: 0.1
    });
  }

  // Carrocer├¡a principal (Debe ser g.children[0] para contrato de pruebas y eventos de dispose)
  const bodyRadius = isBus ? 0.18 : (model === 'amigofiel' ? 0.14 : 0.22);
  const bodyY = isBus ? 0.4 + H / 2 : (model === 'amigofiel' ? 0.63 : 0.59);
  const body = new THREE.Mesh(new RoundedBoxGeometry(L, H, W, 3, bodyRadius), bodyMat);
  body.position.y = bodyY;
  body.castShadow = true;
  g.add(body);

  if (isBus) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(L - 1.2, 0.75, W + 0.02), new THREE.MeshStandardMaterial({ color: '#1a1206', emissive: '#ffbf6e', emissiveIntensity: 0.9, roughness: 0.2 }));
    win.position.set(-0.2, 2.15, 0);
    g.add(win);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, W - 0.25), s.glass);
    wind.position.set(L / 2 + 0.005, 2.0, 0);
    g.add(wind);

    // Tabla de ruta en el panor├ímico superior
    const routeBoard = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.36), new THREE.MeshBasicMaterial({ map: getBusetaRouteBoardTexture(seedColor) }));
    routeBoard.position.set(L / 2 + 0.03, 2.62, 0);
    routeBoard.rotation.y = Math.PI / 2;
    g.add(routeBoard);
  } else {
    // Cabina acristalada
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(cabinL, 0.64, cabinW, 3, 0.18), s.glass);
    cabin.position.set(-0.22, cabinY, 0);
    if (model === 'huevito') cabin.rotation.z = -0.05; // Inclinaci├│n aerodin├ímica de cu├▒a
    g.add(cabin);

    // Techo
    const roofY = cabinY + 0.34;
    const roofMat = isPolice ? paint('#f4f6f8') : bodyMat;
    const roof = new THREE.Mesh(new RoundedBoxGeometry(roofL, 0.08, cabinW - 0.04, 2, 0.04), roofMat);
    roof.position.set(-0.28, roofY, 0);
    g.add(roof);

    // Pilar B (marco de ventana divisorio)
    const bPillar = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, cabinW + 0.01), s.dark);
    bPillar.position.set(-0.22, cabinY, 0);
    g.add(bPillar);

    // Ba├║l trasero para el modelo Sed├ín
    if (model === 'sedan') {
      const trunk = new THREE.Mesh(new RoundedBoxGeometry(0.75, 0.14, cabinW, 2, 0.04), bodyMat);
      trunk.position.set(-1.64, 0.97, 0);
      g.add(trunk);
    }

    // Boceles laterales negros protectores
    const bocelGeo = new THREE.BoxGeometry(2.3, 0.04, 0.02);
    for (const bz of [W / 2 + 0.008, -W / 2 - 0.008]) {
      const bocel = new THREE.Mesh(bocelGeo, s.dark);
      bocel.position.set(-0.15, 0.58, bz);
      g.add(bocel);
    }

    // Paragolpes cromados con topes de caucho para el clásico familiar
    if (model === 'amigofiel') {
      const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, W + 0.04), s.chrome);
      frontBumper.position.set(L / 2 + 0.06, 0.44, 0);
      g.add(frontBumper);
      const rearBumper = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, W + 0.04), s.chrome);
      rearBumper.position.set(-L / 2 - 0.06, 0.48, 0);
      g.add(rearBumper);
      for (const bz of [-0.45, 0.45]) {
        const topeF = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.20, 0.08), s.dark);
        topeF.position.set(L / 2 + 0.06, 0.44, bz);
        g.add(topeF);
        const topeR = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.20, 0.08), s.dark);
        topeR.position.set(-L / 2 - 0.06, 0.48, bz);
        g.add(topeR);
      }
    }

    // Tubo de escape trasero
    const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), s.dark);
    exhaust.rotation.z = Math.PI / 2;
    exhaust.position.set(-L / 2 + 0.06, 0.26, -W / 2 + 0.32);
    g.add(exhaust);
  }

  // Placas colombianas (delantera y trasera)
  const isPublic = isTaxi || isBus || isPolice;
  let plateData;
  if (isPolice) {
    plateData = { code: 'WPD 204', city: 'BOGOT├ü D.C.' };
  } else {
    const plateList = isPublic ? PUBLIC_PLATES : PRIVATE_PLATES;
    plateData = plateList[Math.abs(seedColor) % plateList.length];
  }
  const plateTex = getPlateTexture(plateData.code, plateData.city, isPublic);
  const plateMat = new THREE.MeshBasicMaterial({ map: plateTex, side: THREE.DoubleSide });

  const frontPlate = new THREE.Mesh(s.plateGeo, plateMat);
  frontPlate.rotation.y = Math.PI / 2;
  frontPlate.position.set(L / 2 + 0.015, isBus ? 0.55 : 0.44, 0);
  g.add(frontPlate);

  const rearPlate = new THREE.Mesh(s.plateGeo, plateMat);
  rearPlate.rotation.y = -Math.PI / 2;
  rearPlate.position.set(-L / 2 - 0.015, isBus ? 0.65 : 0.50, 0);
  g.add(rearPlate);

  // Detalles exclusivos de taxi
  if (isTaxi) {
    const doorTex = getTaxiDoorTexture(plateData.code, plateData.city);
    const doorMat = new THREE.MeshBasicMaterial({ map: doorTex, transparent: true });
    const leftDoorDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), doorMat);
    leftDoorDecal.position.set(0.15, 0.80, W / 2 + 0.012);
    g.add(leftDoorDecal);

    const rightDoorDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.36), doorMat);
    rightDoorDecal.rotation.y = Math.PI;
    rightDoorDecal.position.set(0.15, 0.80, -W / 2 - 0.012);
    g.add(rightDoorDecal);

    const roofTex = getTaxiRoofPlateTexture(plateData.code);
    const roofPlateMat = new THREE.MeshBasicMaterial({ map: roofTex, transparent: true });
    const roofDecal = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.30), roofPlateMat);
    roofDecal.rotation.x = -Math.PI / 2;
    roofDecal.position.set(-0.35, cabinY + 0.38 + 0.01, 0);
    g.add(roofDecal);

    const signMat = new THREE.MeshBasicMaterial({ map: getTaxiSignTexture() });
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.17, 0.26), signMat);
    sign.position.set(-0.15, cabinY + 0.38 + 0.13, 0);
    g.add(sign);
  }

  // Detalles exclusivos de patrulla de polic├¡a
  let policeLights = null;
  if (isPolice) {
    const roofY = cabinY + 0.34;
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.10, W - 0.35), new THREE.MeshStandardMaterial({ color: '#101214', roughness: 0.4, metalness: 0.65 }));
    bar.position.set(-0.2, roofY + 0.08, 0);
    g.add(bar);

    const blueMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a6cff').multiplyScalar(3) });
    const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a2a').multiplyScalar(3) });
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.10, 0.28), blueMat);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.10, 0.28), redMat);
    blue.position.set(-0.2, roofY + 0.14, 0.26);
    red.position.set(-0.2, roofY + 0.14, -0.26);
    g.add(blue, red);
    policeLights = { blue: blueMat, red: redMat };

    const green = paint('#0b5c2e');
    const hoodMark = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.03, 0.55), green);
    hoodMark.position.set(1.35, 0.96, 0);
    g.add(hoodMark);
  }

  // Parrilla frontal
  if (!isBus) {
    let badge = 'rombo';
    if (isTaxi || model === 'zapatico') badge = (Math.abs(seedColor) % 2 === 0) ? 'alas' : 'ovalo';
    else if (model === 'sedan') badge = (Math.abs(seedColor) % 2 === 0) ? 'rombo' : 'alas';
    const grilleMat = new THREE.MeshBasicMaterial({ map: getGrilleTexture(badge), side: THREE.DoubleSide });
    const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.20), grilleMat);
    grille.rotation.y = Math.PI / 2;
    grille.position.set(L / 2 + 0.012, 0.68, 0);
    g.add(grille);
  }

  // Ruedas
  const wx = isBus ? L / 2 - 1.3 : (L / 2 - 0.82);
  const wz = W / 2 - 0.12;
  const wheels = [];
  for (const [x, z] of [[wx, wz], [wx, -wz], [-wx, wz], [-wx, -wz]]) {
    const w = new THREE.Mesh(s.wheelGeo, s.tire);
    w.position.set(x, 0.33, z);
    const rim = new THREE.Mesh(s.rimGeo, s.rim);
    w.add(rim);
    g.add(w);
    wheels.push(w);
  }

  // Farolas delanteras
  const hy = isBus ? 0.95 : 0.66;
  const isRoundLight = model === 'amigofiel';
  const headMat = new THREE.MeshBasicMaterial({ map: getHeadlightTexture(isRoundLight) });
  const flares = [];
  for (const z of [W / 2 - 0.32, -(W / 2 - 0.32)]) {
    const h = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.16), headMat);
    h.rotation.y = Math.PI / 2;
    h.position.set(L / 2 + 0.012, hy, z);
    g.add(h);

    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: s.flareTex, color: '#fff1d6', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
    flare.scale.set(0.9, 0.6, 1);
    flare.position.set(L / 2 + 0.12, hy, z);
    g.add(flare);
    flares.push(flare);
  }

  // Luces traseras
  const tailMat = new THREE.MeshBasicMaterial({ map: getTaillightTexture(), color: new THREE.Color('#ff1a12').multiplyScalar(1.4) });
  const isVerticalTail = model === 'zapatico';
  const tailW = isVerticalTail ? 0.14 : 0.32;
  const tailH = isVerticalTail ? 0.42 : 0.16;
  const tailY = isVerticalTail ? 1.00 : hy;
  for (const z of [W / 2 - 0.25, -(W / 2 - 0.25)]) {
    const t = new THREE.Mesh(new THREE.PlaneGeometry(tailW, tailH), tailMat);
    t.rotation.y = -Math.PI / 2;
    t.position.set(-L / 2 - 0.012, tailY, z);
    g.add(t);
  }

  // Haz de luz en el suelo
  let beam = null;
  if (beams) {
    beam = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 3.6),
      new THREE.MeshBasicMaterial({ map: s.beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.32, color: '#ffe8c8' }),
    );
    beam.rotation.x = -Math.PI / 2;
    beam.position.set(L / 2 + 5.2, 0.03, 0);
    beam.renderOrder = 2;
    g.add(beam);
  }

  const dispose = () => {
    const sharedResources = new Set(Object.values(s));
    for (const t of texCache.values()) sharedResources.add(t);
    const geometries = new Set(), materials = new Set(), textures = new Set();
    g.traverse((o) => {
      if (o.geometry && !sharedResources.has(o.geometry)) geometries.add(o.geometry);
      if (o.material && !sharedResources.has(o.material)) materials.add(o.material);
    });
    for (const material of materials) {
      if (material.map && !sharedResources.has(material.map)) textures.add(material.map);
      material.dispose();
    }
    for (const geometry of geometries) geometry.dispose();
    for (const texture of textures) texture.dispose();
  };

  return { group: g, length: L, width: W, model, wheels, tailMat, beam, flares, policeLights, dispose };
}
