// src/world/bogota/vehicles.js
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { radialSprite } from './textures.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { VehicleBodyBuilder, addCarBody, makeWipers } from './VehicleBody.js';

// Texturas compartidas en caché para evitar regeneración y consumo de memoria
const texCache = new Map();

function createSafeCanvasTexture(w, h, drawFn) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture(); texture.colorSpace = THREE.SRGBColorSpace; return texture;
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
  { code: 'WDD 512', city: 'BOGOTÁ D.C.' },
  { code: 'VEP 384', city: 'BOGOTÁ D.C.' },
  { code: 'TLX 709', city: 'BOGOTÁ D.C.' },
  { code: 'SPO 192', city: 'SOACHA' },
  { code: 'SKM 463', city: 'BOGOTÁ D.C.' },
  { code: 'WPD 204', city: 'BOGOTÁ D.C.' },
  { code: 'STP 827', city: 'CHÍA' },
  { code: 'TET 351', city: 'BOGOTÁ D.C.' },
  { code: 'WDA 940', city: 'BOGOTÁ D.C.' },
  { code: 'UPB 628', city: 'ENVIGADO' },
  { code: 'VEE 175', city: 'BOGOTÁ D.C.' },
];

export const PRIVATE_PLATES = [
  { code: 'BGO 418', city: 'BOGOTÁ D.C.' },
  { code: 'CKM 890', city: 'BOGOTÁ D.C.' },
  { code: 'DKS 214', city: 'BOGOTÁ D.C.' },
  { code: 'FKB 719', city: 'BOGOTÁ D.C.' },
  { code: 'RNY 531', city: 'ENVIGADO' },
  { code: 'KLY 672', city: 'BOGOTÁ D.C.' },
  { code: 'ZNT 108', city: 'CHÍA' },
  { code: 'HWK 345', city: 'BOGOTÁ D.C.' },
  { code: 'MHO 962', city: 'MEDELLÍN' },
  { code: 'NCX 803', city: 'BOGOTÁ D.C.' },
];

/** Placas colombianas: amarilla para particular, blanca para público/taxi */
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
    const displayCode = code.includes('·') ? code : code.replace(' ', ' · ');
    ctx.fillText(displayCode, 128, 54);

    ctx.font = '800 17px "Arial Black", sans-serif';
    ctx.fillText(city, 128, 96);
  });

  texCache.set(key, t);
  return t;
}

/** Calcomanía obligatoria de puertas en taxis colombianos */
function getTaxiDoorTexture(code, city = 'BOGOTÁ D.C.') {
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
    ctx.fillText('SERVICIO PÚBLICO', 128, 190);
    ctx.font = '700 17px sans-serif';
    ctx.fillText('RADIO TAXI', 128, 222);
  });

  texCache.set(key, t);
  return t;
}

/** Placa pintada en el techo del taxi para control aéreo */
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

/** Tabla clásica de buseta bogotana en el panorámico */
function getBusetaRouteBoardTexture(routeIndex = 0) {
  const routes = [
    { num: '14-2', dest: 'CRA 10 · SOACHA', via: 'SAN MATEO · BOSA', bg: '#1b5e20', numBg: '#fbc02d' },
    { num: '314', dest: 'CL 80 · ENGATIVÁ', via: 'VÍA CORINTO · MINUTO', bg: '#0d47a1', numBg: '#d32f2f' },
    { num: 'E25', dest: 'SUBA · CENTRO', via: 'CALLE 100 · CRA 7MA', bg: '#b71c1c', numBg: '#ffffff' },
    { num: '496', dest: 'FONTIBÓN · CL 26', via: 'SALITRE · GERMANIA', bg: '#e65100', numBg: '#1b5e20' },
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

/** Livery lateral de buseta tradicional de Bogotá */
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
    ctx.fillText('SITP PROVISIONAL · CAPACIDAD 19 PASAJEROS', 40, 95);

    ctx.fillStyle = '#ffffff';
    ctx.font = '900 28px sans-serif';
    ctx.fillText(route, 40, 242);
  });

  texCache.set(key, t);
  return t;
}

/** Livery blanco y verde institucional de la Policía Nacional de Colombia */
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
    ctx.fillText('POLICÍA', 512, 104);
    ctx.font = '800 20px Overpass, "Arial Black", sans-serif';
    ctx.fillText('NACIONAL · DIOS Y PATRIA', 512, 138);

    ctx.font = '900 28px sans-serif';
    ctx.fillText('CAI', 110, 116);
    ctx.font = '800 18px sans-serif';
    ctx.fillText('123', 910, 116);
  });

  texCache.set(key, t);
  return t;
}

/** Las etiquetas de un coche comparten un atlas: placas, parrilla, taxi y librea policial. */
function getDecalAtlas(plate, kind, badge) {
  const key = `decals_${kind}_${plate.code}_${plate.city}_${badge}`;
  if (texCache.has(key)) return texCache.get(key);
  const labels = {
    plate: { rect:[0,0,256,128], texture:getPlateTexture(plate.code,plate.city,kind!=='carro') },
    grille: { rect:[0,128,256,64], texture:getGrilleTexture(badge) }
  };
  if (kind==='taxi') {
    labels.door={rect:[256,0,256,256],texture:getTaxiDoorTexture(plate.code,plate.city)};
    labels.roof={rect:[0,192,256,128],texture:getTaxiRoofPlateTexture(plate.code)};
    labels.sign={rect:[0,320,256,128],texture:getTaxiSignTexture()};
  }
  if (kind==='police') labels.police={rect:[0,256,512,128],texture:getPoliceLiveryTexture()};
  const atlas = createSafeCanvasTexture(512,512,ctx=>{
    ctx.fillStyle='#171c1d'; ctx.fillRect(0,0,512,512);
    for (const label of Object.values(labels)) ctx.drawImage(label.texture.image,...label.rect);
  });
  atlas.name=`Identificación ${plate.code}`; atlas.anisotropy=4;
  atlas.userData.labelRects=Object.fromEntries(Object.entries(labels).map(([name,{rect}])=>[name,rect]));
  texCache.set(key,atlas); return atlas;
}

function wheelGeometry() {
  const parts=[];
  const add=(geometry,color)=>{
    const g=geometry.index?geometry.toNonIndexed():geometry;
    if (g!==geometry) geometry.dispose();
    const c=new THREE.Color(color), colors=new Float32Array(g.attributes.position.count*3);
    for(let i=0;i<colors.length;i+=3) colors.set([c.r,c.g,c.b],i);
    g.setAttribute('color',new THREE.BufferAttribute(colors,3)); parts.push(g);
  };
  const points=[[.18,-.12],[.275,-.12],[.32,-.09],[.33,-.045],[.33,.045],[.32,.09],[.275,.12],[.18,.12]];
  const tire=new THREE.LatheGeometry(points.map(([x,y])=>new THREE.Vector2(x,y)),16);
  tire.rotateX(Math.PI/2); add(tire,'#171b1c');
  for(const side of [-1,1]) {
    const ring=new THREE.RingGeometry(.19,.255,16); if(side<0) ring.rotateY(Math.PI); ring.translate(0,0,side*.121); add(ring,'#a9adac');
    for(let i=0;i<5;i++) {
      const angle=i*Math.PI*2/5, spoke=new THREE.BoxGeometry(.048,.19,.018);
      spoke.translate(0,.135,side*.125); spoke.rotateZ(angle); add(spoke,'#929b9d');
    }
    const hub=new THREE.CircleGeometry(.073,12); if(side<0) hub.rotateY(Math.PI);
    hub.translate(0,0,side*.138); add(hub,'#afb5b4');
  }
  const geometry=mergeGeometries(parts,false); for(const part of parts) part.dispose();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
}

const cache = {};
function shared() {
  if (cache.ready) return cache;
  cache.dark=new THREE.MeshStandardMaterial({color:'#242b2c',roughness:.84}); cache.dark.name='Cauchos e interior';
  cache.chrome=new THREE.MeshStandardMaterial({color:'#b6bfbe',metalness:.78,roughness:.29}); cache.chrome.name='Metal satinado';
  cache.wheel=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.72,metalness:.12,side:THREE.DoubleSide});
  cache.wheelGeo=wheelGeometry();
  cache.beamTex=radialSprite(128,'rgba(255,240,215,0.9)','rgba(255,240,215,0)');
  cache.flareTex=radialSprite(64,'rgba(255,255,255,1)','rgba(255,255,255,0)');
  cache.ready=true; return cache;
}

export const PAINTS=['#e8e8e6','#b9bec4','#1d1f22','#7a1414','#1f3d6b','#4d5a3a','#8c8f93','#d9d4c7'];
const MODEL_PAINTS={
  zapatico:['#a72d27','#dadad2','#8c9c9e','#303739','#37688b','#b76539'],
  huevito:['#55714d','#426987','#aa3934','#cfb253','#9caeb0','#e3e1d6'],
  amigofiel:['#d5cdb3','#507889','#904b39','#52644b','#bd9a58','#e0ddd0'],
  sedan:['#798d93','#dddeda','#354b62','#743b38','#343b3e','#9b8771']
};

function label(batch,material,name,size,position,rotation) {
  const [x,y,w,h]=material.map.userData.labelRects[name], g=new THREE.PlaneGeometry(...size), uv=g.attributes.uv;
  for(let i=0;i<uv.count;i++) uv.setXY(i,(x+2+uv.getX(i)*(w-4))/512,1-(y+h-2-uv.getY(i)*(h-4))/512);
  batch.add(g,material,position,rotation);
}

/** Frente +X. El volumen físico se conserva; todas las piezas visuales comparten ese eje. */
export function makeVehicle(kind='carro',seedColor=0,{beams=true}={}) {
  const seed=Number.isFinite(seedColor)?Math.abs(Math.trunc(seedColor)):0, s=shared(), g=new THREE.Group();
  const isBus=kind==='buseta', isTaxi=kind==='taxi', isPolice=kind==='police';
  const model=isBus?'buseta':isPolice?'sedan':isTaxi?(seed%3===0?'sedan':'zapatico'):['zapatico','huevito','amigofiel','sedan'][seed%4];
  const L=isBus?7.6:4.3,W=isBus?2.3:1.76, color=isTaxi?'#e8b929':isPolice?'#e4e8e3':isBus?'#f0ede6':MODEL_PAINTS[model][seed%6];
  const bodyMat=new THREE.MeshPhysicalMaterial({color,metalness:.18,roughness:.36,clearcoat:.65,clearcoatRoughness:.2});
  bodyMat.name='Esmalte';
  if(!isBus) { bodyMat.vertexColors=true; bodyMat.userData.roadDust=true; }
  const glass=new THREE.MeshPhysicalMaterial({color:'#6e8789',metalness:.12,roughness:.18,clearcoat:.6,
    transparent:true,opacity:.72,depthWrite:false}); glass.name='Vidrio ahumado';
  const batch=new VehicleBodyBuilder();
  let bodyInfo;
  if(isBus) {
    bodyMat.color.set('#ffffff'); bodyMat.map=getBusetaLiveryTexture('CENTRO · TERMINAL · SOACHA');
    batch.add(new RoundedBoxGeometry(L,2.6,W,2,.12),bodyMat,[0,1.7,0]);
    batch.box([.04,1.0,W-.25],[L/2+.002,2,0],glass);
    for(const side of [-1,1]) for(let i=0;i<6;i++) {
      batch.box([.82,.75,.025],[-2.6+i*.99,2.15,side*(W/2+.008)],glass);
      batch.box([.12,.71,.028],[-2.95+i*.99,2.14,side*(W/2+.023)],s.dark);
    }
    const board=new THREE.MeshStandardMaterial({map:getBusetaRouteBoardTexture(seed),roughness:.8});
    batch.add(new THREE.PlaneGeometry(1.5,.36),board,[L/2+.025,2.62,0],[0,Math.PI/2,0]);
    bodyInfo={profile:{roofY:3},windshield:{bottom:[L/2+.03,1.52,0],top:[L/2+.03,2.50,0]},mirrorAnchors:[new THREE.Vector3(3.3,1.9,-1.25),new THREE.Vector3(3.3,1.9,1.25)]};
  } else bodyInfo=addCarBody(batch,model,{paint:bodyMat,glass,dark:s.dark,chrome:s.chrome});
  const p=bodyInfo.profile;
  const plateData=isPolice?{code:'WPD 204',city:'BOGOTÁ D.C.'}:(isTaxi||isBus?PUBLIC_PLATES:PRIVATE_PLATES)[seed%(isTaxi||isBus?PUBLIC_PLATES:PRIVATE_PLATES).length];
  const decalMat=new THREE.MeshStandardMaterial({map:getDecalAtlas(plateData,kind,model==='amigofiel'?'rombo':seed%2?'ovalo':'alas'),roughness:.72});
  decalMat.name='Placas y distintivos';
  for(const sign of [-1,1]) label(batch,decalMat,'plate',[.44,.22],[sign*(L/2-.002),isBus?.58:.43,0],[0,sign*Math.PI/2,0]);
  if(!isBus) label(batch,decalMat,'grille',[model==='amigofiel'?.94:.83,.16],[2.119,.70,0],[0,Math.PI/2,0]);
  if(isTaxi) {
    for(const side of [-1,1]) label(batch,decalMat,'door',[.32,.32],[.12,.78,side*.874],[0,side<0?Math.PI:0,0]);
    label(batch,decalMat,'roof',[.62,.28],[-.62,p.roofY+.025,0],[-Math.PI/2,0,Math.PI/2]);
    batch.box([.30,.14,.60],[-.07,p.roofY+.08,0],s.dark);
    for(const sign of [-1,1]) label(batch,decalMat,'sign',[.55,.13],[-.07+sign*.152,p.roofY+.08,0],[0,sign*Math.PI/2,0]);
  }
  if(isPolice) {
    for(const side of [-1,1]) label(batch,decalMat,'police',[1.90,.46],[-.04,.77,side*.875],[0,side<0?Math.PI:0,0]);
    const green=new THREE.MeshStandardMaterial({color:'#235b3b',roughness:.43});
    batch.box([.78,.018,.54],[1.46,.942,0],green);
  }
  // Intermitentes y frenos son materiales exclusivos: un coche nunca enciende los del vecino.
  const signalMaterials={};
  for(const [name,side] of [['left',-1],['right',1]]) {
    const mat=new THREE.MeshStandardMaterial({color:'#c96c23',emissive:'#ff8a24',emissiveIntensity:.12,roughness:.3});
    mat.name=`Direccional ${name}`; signalMaterials[name]=mat;
    for(const end of [-1,1]) batch.box([.03,.09,.12],[end*(L/2-.026),isBus?.92:.66,side*(W/2-.16)],mat);
    if(!isBus) batch.box([.09,.04,.015],[.93,.82,side*.875],mat);
  }
  const headTexture=getHeadlightTexture(model==='amigofiel');
  const headMat=new THREE.MeshStandardMaterial({map:headTexture,emissiveMap:headTexture,emissive:'#fff1d3',emissiveIntensity:.55,roughness:.22}); headMat.name='Faros';
  const tailMat=new THREE.MeshBasicMaterial({map:getTaillightTexture(),color:new THREE.Color('#ff1a12').multiplyScalar(1.4)}); tailMat.name='Stops';
  const hy=isBus?.95:model==='amigofiel'?.80:.74;
  for(const side of [-1,1]) {
    batch.add(new THREE.PlaneGeometry(model==='amigofiel'?.27:.34,model==='amigofiel'?.27:.16),headMat,[L/2-.028,hy,side*(W/2-.34)],[0,Math.PI/2,0]);
    batch.add(new THREE.PlaneGeometry(.28,.16),tailMat,[-L/2+.028,model==='zapatico'?.78:hy,side*(W/2-.28)],[0,-Math.PI/2,0]);
  }
  let policeLights=null;
  if(isPolice) {
    batch.box([.30,.07,1.18],[-.24,p.roofY+.06,0],s.dark);
    const blue=new THREE.MeshBasicMaterial({color:new THREE.Color('#1a6cff').multiplyScalar(3)});
    const red=new THREE.MeshBasicMaterial({color:new THREE.Color('#ff1a2a').multiplyScalar(3)});
    batch.box([.26,.09,.46],[-.24,p.roofY+.13,.30],blue);
    batch.box([.26,.09,.46],[-.24,p.roofY+.13,-.30],red); policeLights={blue,red};
  }
  const bodyVisual=batch.build(bodyMat); g.add(bodyVisual);
  // Vidrio y pequeñas lámparas no proyectan bloques negros sobre el habitáculo.
  bodyVisual.traverse(mesh=>{if(mesh.isMesh&&(mesh.material===glass||mesh.material===decalMat||mesh.material===headMat||mesh.material===tailMat)) mesh.castShadow=false;});
  const wipers=makeWipers(bodyInfo.windshield,s.dark); for(const wiper of wipers) bodyVisual.add(wiper.parent);
  const wx=isBus?L/2-1.3:1.33,wz=W/2-.13,wheels=[],frontWheelPivots=[];
  for(const [x,z] of [[wx,-wz],[wx,wz],[-wx,-wz],[-wx,wz]]) {
    const pivot=new THREE.Group(); pivot.position.set(x,.33,z); pivot.name=x>0?'Eje delantero dirigible':'Eje trasero';
    const wheel=new THREE.Mesh(s.wheelGeo,s.wheel); wheel.name='Rueda'; wheel.castShadow=wheel.receiveShadow=true;
    wheel.userData.radius=.33; wheel.userData.front=x>0; pivot.add(wheel); g.add(pivot); wheels.push(wheel);
    if(x>0) frontWheelPivots.push(pivot);
  }
  const flares=[];
  const flareMaterial=new THREE.SpriteMaterial({map:s.flareTex,color:'#fff1d6',blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:.65});
  for(const side of [-1,1]) {
    const flare=new THREE.Sprite(flareMaterial); flare.name='Resplandor de faro'; flare.userData.vehicleGlow=true;
    flare.scale.set(.44,.28,1); flare.position.set(L/2+.025,hy,side*(W/2-.34)); bodyVisual.add(flare); flares.push(flare);
  }
  let beam=null;
  if(beams) {
    beam=new THREE.Mesh(new THREE.PlaneGeometry(8,3.6),new THREE.MeshBasicMaterial({map:s.beamTex,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,opacity:.32,color:'#ffe8c8'}));
    beam.name='Haz sobre el pavimento'; beam.userData.vehicleGlow=true; beam.rotation.x=-Math.PI/2;
    beam.position.set(L/2+4.0,.03,0); beam.renderOrder=2; g.add(beam);
  }
  let disposed=false;
  const dispose=()=>{
    if(disposed)return; disposed=true;
    const sharedResources=new Set([...Object.values(s),...texCache.values()]);
    const geometries=new Set(),materials=new Set(),textures=new Set();
    g.traverse(o=>{
      if(o.geometry&&!sharedResources.has(o.geometry))geometries.add(o.geometry);
      for(const mat of Array.isArray(o.material)?o.material:o.material?[o.material]:[]) if(!sharedResources.has(mat))materials.add(mat);
    });
    for(const mat of materials) {
      for(const value of Object.values(mat)) if(value?.isTexture&&!sharedResources.has(value))textures.add(value);
      mat.dispose();
    }
    for(const geometry of geometries)geometry.dispose(); for(const texture of textures)texture.dispose();
  };
  return {group:g,length:L,width:W,model,wheels,tailMat,beam,flares,policeLights,dispose,
    frontWheelPivots,bodyVisual,signalMaterials,wipers,visualManaged:true,wheelRadius:.33,wheelbase:wx*2,
    mirrorAnchors:bodyInfo.mirrorAnchors,driverAnchor:new THREE.Vector3(.03,0,-.36),driverHeight:p.roofY-.06,
    wetMaterials:[bodyMat,glass],headlightMaterial:headMat};
}
