// src/utils/signAtlas.js
// Letreros que comparten una textura: el texto en un atlas y el fondo de color plano.
import * as THREE from 'three';

/**
 * Atlas con solo el texto y el borde de varios letreros, sobre fondo transparente. El fondo de
 * cada letrero se pinta aparte con un color plano, así cien letreros comparten una textura y un
 * material en lugar de llevar cada uno su lienzo. Mismo trazo y tipografía que signTexture.
 * Devuelve la textura y el rectángulo UV [u0, v0, u1, v1] de cada entrada.
 */
export function signTextAtlas(entries, { w = 768, h = 192, columns = 4, pad = 8, accent = '#f6c400' } = {}) {
  const rows = Math.ceil(entries.length / columns);
  const cw = w + pad * 2, ch = h + pad * 2;
  const c = document.createElement('canvas');
  c.width = cw * columns;
  c.height = ch * rows;
  const x = c.getContext('2d');
  const cells = entries.map(({ title, sub = '', fg = '#ffffff', border = true }, index) => {
    const ox = (index % columns) * cw + pad, oy = Math.floor(index / columns) * ch + pad;
    x.save();
    x.translate(ox, oy);
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
    x.restore();
    return [ox / c.width, 1 - (oy + h) / c.height, (ox + w) / c.width, 1 - oy / c.height];
  });
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  // Premultiplicar evita el halo oscuro que dejaría el borde transparente en los mipmaps.
  texture.premultiplyAlpha = true;
  return { texture, cells };
}

/** Plano con UV ajustadas a un rectángulo [u0, v0, u1, v1] de un atlas. */
export function atlasPlane(width, height, [u0, v0, u1, v1]) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  return geometry;
}
