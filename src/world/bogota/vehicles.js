import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { radialSprite } from './textures.js';

const cache = {};
function shared() {
  if (cache.ready) return cache;
  cache.glass = new THREE.MeshPhysicalMaterial({ color: '#0a0d12', metalness: 0.2, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
  cache.tire = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 });
  cache.rim = new THREE.MeshStandardMaterial({ color: '#8a8f96', metalness: 0.9, roughness: 0.35 });
  cache.dark = new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.7 });
  cache.head = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4dc').multiplyScalar(3) });
  cache.tail = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a12').multiplyScalar(1.4) });
  cache.wheelGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 18);
  cache.wheelGeo.rotateX(Math.PI / 2);
  cache.rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 12);
  cache.rimGeo.rotateX(Math.PI / 2);
  cache.beamTex = radialSprite(128, 'rgba(255,240,215,0.9)', 'rgba(255,240,215,0)');
  cache.flareTex = radialSprite(64, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  cache.ready = true;
  return cache;
}

export const PAINTS = ['#e8e8e6', '#b9bec4', '#1d1f22', '#7a1414', '#1f3d6b', '#4d5a3a', '#8c8f93', '#d9d4c7'];

function paint(color) {
  return new THREE.MeshPhysicalMaterial({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
}

function busTexture(route) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#efefe8';
  x.fillRect(0, 0, 1024, 256);
  x.fillStyle = '#1e8f4a';
  x.fillRect(0, 168, 1024, 26);
  x.fillStyle = '#d42b2b';
  x.fillRect(0, 200, 1024, 12);
  x.fillStyle = '#1e8f4a';
  x.font = '900 34px Overpass, sans-serif';
  x.fillText(route, 40, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Livrea blanca y verde de la Policía Nacional de Colombia. */
function policeTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#f4f6f8';
  x.fillRect(0, 0, 1024, 256);
  x.fillStyle = '#0b5c2e';
  x.fillRect(0, 72, 1024, 88);
  x.fillStyle = '#ffd100';
  x.fillRect(0, 68, 1024, 6);
  x.fillRect(0, 158, 1024, 6);
  x.fillStyle = '#ffffff';
  x.font = '900 52px Overpass, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('POLICÍA', 512, 118);
  x.font = '700 18px Overpass, sans-serif';
  x.fillText('NACIONAL', 512, 148);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Crea un vehículo. El frente apunta a +X local.
 * kind: 'taxi' | 'carro' | 'buseta' | 'police'
 */
export function makeVehicle(kind = 'carro', seedColor = 0, { beams = true } = {}) {
  const s = shared();
  const g = new THREE.Group();
  const isBus = kind === 'buseta';
  const isPolice = kind === 'police';
  const L = isBus ? 7.6 : 4.3;
  const W = isBus ? 2.3 : 1.76;
  const H = isBus ? 2.6 : 0.78;
  const color = kind === 'taxi' ? '#f2c300' : isPolice ? '#f4f6f8' : PAINTS[seedColor % PAINTS.length];

  let bodyMat = paint(color);
  if (isBus) {
    bodyMat = new THREE.MeshPhysicalMaterial({ map: busTexture('CENTRO · TERMINAL · LA PLAYITA'), metalness: 0.2, roughness: 0.4, clearcoat: 0.8 });
  } else if (isPolice) {
    const map = policeTexture();
    bodyMat = map
      ? new THREE.MeshPhysicalMaterial({ map, metalness: 0.25, roughness: 0.38, clearcoat: 0.9, clearcoatRoughness: 0.1 })
      : paint('#f4f6f8');
  }
  const body = new THREE.Mesh(new RoundedBoxGeometry(L, H, W, 3, isBus ? 0.18 : 0.22), bodyMat);
  body.position.y = isBus ? 0.4 + H / 2 : 0.62;
  body.castShadow = true;
  g.add(body);

  let policeLights = null;
  if (isBus) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(L - 1.2, 0.75, W + 0.02), new THREE.MeshStandardMaterial({ color: '#1a1206', emissive: '#ffbf6e', emissiveIntensity: 0.9, roughness: 0.2 }));
    win.position.set(-0.2, 2.15, 0);
    g.add(win);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.0, W - 0.25), s.glass);
    wind.position.set(L / 2 + 0.005, 2.0, 0);
    g.add(wind);
    const route = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.24), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb000').multiplyScalar(1.6) }));
    route.position.set(L / 2 + 0.03, 2.65, 0);
    route.rotation.y = Math.PI / 2;
    g.add(route);
  } else {
    const cabin = new THREE.Mesh(new RoundedBoxGeometry(2.25, 0.62, W - 0.14, 3, 0.2), s.glass);
    cabin.position.set(-0.25, 1.25, 0);
    g.add(cabin);
    const roofMat = isPolice ? paint('#f4f6f8') : bodyMat;
    const roof = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.08, W - 0.2, 2, 0.04), roofMat);
    roof.position.set(-0.3, 1.58, 0);
    g.add(roof);
    if (kind === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2b0').multiplyScalar(1.8) }));
      sign.position.set(-0.3, 1.72, 0);
      g.add(sign);
    }
    if (isPolice) {
      const green = paint('#0b5c2e');
      const yellow = paint('#ffd100');
      for (const z of [W / 2 + 0.015, -(W / 2 + 0.015)]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.42, 0.04), green);
        band.position.set(0.05, 0.7, z);
        g.add(band);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.06, 0.045), yellow);
        trim.position.set(0.05, 0.92, z);
        g.add(trim);
      }
      const hoodMark = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.55), green);
      hoodMark.position.set(1.35, 0.95, 0);
      g.add(hoodMark);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.14, W - 0.3), new THREE.MeshStandardMaterial({ color: '#101214', roughness: 0.4, metalness: 0.65 }));
      bar.position.set(-0.2, 1.72, 0);
      g.add(bar);
      const blueMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#1a6cff').multiplyScalar(3) });
      const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff1a2a').multiplyScalar(3) });
      const blue = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.3), blueMat);
      const red = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.11, 0.3), redMat);
      blue.position.set(-0.2, 1.84, 0.3);
      red.position.set(-0.2, 1.84, -0.3);
      g.add(blue, red);
      policeLights = { blue: blueMat, red: redMat };
    }
  }

  const wx = isBus ? L / 2 - 1.3 : 1.35;
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

  const headGeo = new THREE.BoxGeometry(0.06, 0.16, 0.36);
  const hy = isBus ? 0.95 : 0.66;
  for (const z of [W / 2 - 0.32, -(W / 2 - 0.32)]) {
    const h = new THREE.Mesh(headGeo, s.head);
    h.position.set(L / 2 + 0.01, hy, z);
    g.add(h);
    const flare = new THREE.Sprite(new THREE.SpriteMaterial({ map: s.flareTex, color: '#fff1d6', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
    flare.scale.set(0.9, 0.6, 1);
    flare.position.set(L / 2 + 0.12, hy, z);
    g.add(flare);
  }
  const tailMat = s.tail.clone();
  for (const z of [W / 2 - 0.25, -(W / 2 - 0.25)]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.34), tailMat);
    t.position.set(-L / 2 - 0.01, hy, z);
    g.add(t);
  }

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
    // Ruedas, vidrios y luces del caché siguen siendo usados por otros vehículos.
    const sharedResources = new Set(Object.values(s));
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
  return { group: g, length: L, width: W, wheels, tailMat, beam, policeLights, dispose };
}
