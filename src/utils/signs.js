// src/utils/signs.js
// Letreros de lugares (estilo señal informativa colombiana) y su malla iluminada.
import * as THREE from 'three';

export function signTexture({ title, sub = '', bg = '#0b4fa3', fg = '#ffffff', accent = '#f6c400', w = 1024, h = 256, border = true }) {
  if (typeof document === 'undefined') return new THREE.Texture();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, w, h); }
  x.strokeStyle = fg;
  x.lineWidth = 10;
  if (border) x.strokeRect(18, 18, w - 36, h - 36);
  x.fillStyle = fg;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `900 ${Math.round(h * (sub ? 0.36 : 0.5))}px system-ui, sans-serif`;
  x.fillText(title, w / 2, sub ? h * 0.42 : h * 0.54, w * 0.9);
  if (sub) {
    x.fillStyle = accent;
    x.font = `800 ${Math.round(h * 0.15)}px system-ui, sans-serif`;
    x.fillText(sub, w / 2, h * 0.76, w * 0.88);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Letrero de doble cara que se ve de noche (no recibe luz). */
export function signMesh(opts, width = 2.4) {
  const map = signTexture(opts);
  const mat = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), mat);
}
