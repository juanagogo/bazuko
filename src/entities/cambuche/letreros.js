// src/entities/cambuche/letreros.js
// Lo pintado a mano y lo impreso en las cajas: el nombre en la tabla y dos marcas inventadas. Es solo la tinta,
// en una textura pequeña con fondo transparente, que se pega encima de la tabla o del cartón.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ANCHO = 512, ALTO = 256;
/** Recortes de la textura, en fracciones: [u0, v0, u1, v1] con v hacia arriba. */
export const TINTAS = Object.freeze({
  nombre: [0, .5, 1, 1],
  panela: [0, 0, .5, .5],
  galletas: [.5, 0, 1, .5],
});
const LETRA = '"Dios Le Pague", "Arial Narrow", Arial, sans-serif';

function pintar(ctx) {
  ctx.clearRect(0, 0, ANCHO, ALTO);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // El nombre, a brocha: blanco hueso con un trazo debajo.
  ctx.fillStyle = '#f1ead6';
  ctx.font = `800 88px ${LETRA}`;
  ctx.fillText('MI RANCHO', 256, 62, 470);
  ctx.fillRect(96, 112, 320, 7);
  // Marcas de caja que no existen: «Panela La Tulia» y «Galletas Mirlita».
  ctx.fillStyle = '#8f2a1c';
  ctx.fillRect(14, 142, 228, 12); ctx.fillRect(14, 230, 228, 12);
  ctx.font = `800 40px ${LETRA}`;
  ctx.fillText('PANELA', 128, 176, 210);
  ctx.font = `800 34px ${LETRA}`;
  ctx.fillText('LA TULIA', 128, 210, 210);
  ctx.fillStyle = '#1d2a3f';
  ctx.beginPath(); ctx.arc(300, 172, 22, 0, Math.PI * 2); ctx.fill();
  ctx.font = `800 36px ${LETRA}`;
  ctx.fillText('GALLETAS', 412, 160, 170);
  ctx.fillText('MIRLITA', 384, 204, 220);
  ctx.font = `400 22px ${LETRA}`;
  ctx.fillText('CAJA DE 24 PAQUETES', 384, 238, 236);
}

/** Textura y material de la tinta. En pruebas sin navegador queda una textura vacía. */
export function crearTinta() {
  let texture;
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const canvas = document.createElement('canvas');
    canvas.width = ANCHO; canvas.height = ALTO;
    const ctx = canvas.getContext?.('2d');
    if (ctx) {
      pintar(ctx);
      texture = new THREE.CanvasTexture(canvas);
      // La letra de marcador puede llegar después del primer cuadro: se vuelve a pintar con ella.
      document.fonts?.load?.(`800 40px ${LETRA}`).then(() => { if (texture.image) { pintar(ctx); texture.needsUpdate = true; } }).catch(() => {});
    }
  }
  texture ??= new THREE.Texture();
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, alphaTest: .4, roughness: .95, side: THREE.DoubleSide,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return { texture, material };
}

const _matrix = new THREE.Matrix4(), _quaternion = new THREE.Quaternion(), _euler = new THREE.Euler();
const _position = new THREE.Vector3(), _scale = new THREE.Vector3(1, 1, 1);

/** Une varios rótulos planos: cada uno es { tinta, ancho, alto, en: [x, y, z], giro: [x, y, z] }. */
export function rotulos(lista) {
  const parts = lista.map(({ tinta, ancho, alto, en, giro = [0, 0, 0] }) => {
    const part = new THREE.PlaneGeometry(ancho, alto), [u0, v0, u1, v1] = TINTAS[tinta], uv = part.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
    return part.applyMatrix4(_matrix.compose(_position.set(...en), _quaternion.setFromEuler(_euler.set(...giro)), _scale));
  });
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}
