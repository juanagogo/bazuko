// src/utils/signAtlas.js
// Letreros que comparten una textura: el texto en un atlas y el color de fondo en los vértices.
import * as THREE from 'three';

/**
 * Atlas con solo el texto y el borde de varios letreros, sobre fondo transparente. El color de
 * fondo de cada letrero va en los vértices de su plano (atlasPlane), así cien letreros comparten
 * una textura y un material en lugar de llevar cada uno su lienzo. Mismo trazo y tipografía que
 * signTexture.
 * Devuelve la textura y el rectángulo UV [u0, v0, u1, v1] de cada entrada. El lienzo no pasa de
 * maxSize de alto: las entradas que no caben quedan con celda null y su letrero lleva textura propia.
 * El margen de cada celda es más ancho a los lados (padX) que arriba y abajo (pad): a lo largo de la
 * calle los letreros se ven casi de lado, y el filtro anisótropo estira la muestra en horizontal
 * hasta alcanzar el borde de la celda vecina. Con 32 px la celda mide 832 de ancho, múltiplo de 64:
 * a lo ancho, hasta el mipmap 6 ningún texel junta dos celdas. A lo alto mide 208, múltiplo de 16,
 * y los vecinos de arriba y abajo se juntan desde el mipmap 5.
 */
export function signTextAtlas(entries, { w = 768, h = 192, columns = 4, pad = 8, padX = 32, maxSize = 4096 } = {}) {
  const cw = w + padX * 2, ch = h + pad * 2;
  const capacity = columns * Math.max(1, Math.floor(maxSize / ch));
  const rows = Math.max(1, Math.ceil(Math.min(entries.length, capacity) / columns));
  const c = document.createElement('canvas');
  c.width = cw * columns;
  c.height = ch * rows;
  const x = c.getContext('2d');
  const cells = entries.map(({ title, sub = '', fg = '#ffffff' }, index) => {
    if (index >= capacity) return null;
    const ox = (index % columns) * cw + padX, oy = Math.floor(index / columns) * ch + pad;
    x.save();
    x.translate(ox, oy);
    x.strokeStyle = fg;
    x.lineWidth = 10;
    x.strokeRect(18, 18, w - 36, h - 36);
    x.fillStyle = fg;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `900 ${Math.round(h * (sub ? 0.36 : 0.5))}px system-ui, sans-serif`;
    x.fillText(title, w / 2, sub ? h * 0.42 : h * 0.54, w * 0.9);
    if (sub) {
      x.fillStyle = '#f6c400';
      x.font = `800 ${Math.round(h * 0.15)}px system-ui, sans-serif`;
      x.fillText(sub, w / 2, h * 0.76, w * 0.88);
    }
    x.restore();
    return [ox / c.width, 1 - (oy + h) / c.height, (ox + w) / c.width, 1 - oy / c.height];
  });
  const texture = new THREE.CanvasTexture(c);
  // Se sube premultiplicada, para que los mipmaps promedien el color de la letra sin el negro del
  // fondo transparente, y sin decodificar: SignTextMaterial deshace el premultiplicado y luego
  // pasa de sRGB a lineal.
  texture.colorSpace = THREE.NoColorSpace;
  texture.premultiplyAlpha = true;
  texture.anisotropy = 8;
  return { texture, cells };
}

/**
 * Material opaco del letrero entero: toma el color de fondo de los vértices (atributo signBack, en
 * lineal) y lo mezcla con la letra del atlas en luz lineal, como el filtrado de una textura sRGB
 * con el letrero ya pintado. La opacidad que baja la vista isométrica funciona como en un
 * MeshBasicMaterial. Es una clase para que las copias de BuildingVisibility (clone) conserven el
 * cambio del shader; batchAttributes le pide a los lotes de tercera persona que no borren signBack.
 */
export class SignTextMaterial extends THREE.MeshBasicMaterial {
  constructor(parameters = {}) {
    super(parameters);
    this.userData.batchAttributes = ['signBack'];
  }

  onBeforeCompile(shader) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 signBack;\nvarying vec3 vSignBack;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n  vSignBack = signBack;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSignBack;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
  vec4 signTexel = texture2D( map, vMapUv );
  vec3 signLetter = sRGBTransferEOTF( vec4( signTexel.rgb / max( signTexel.a, 1e-4 ), 1.0 ) ).rgb;
  diffuseColor.rgb *= mix( vSignBack, signLetter, signTexel.a );
#endif`);
  }

  customProgramCacheKey() { return 'aviso-atlas'; }
}

/**
 * Plano con UV ajustadas a un rectángulo [u0, v0, u1, v1] de un atlas y, si se da, el color de
 * fondo del letrero en cada vértice (atributo signBack).
 */
export function atlasPlane(width, height, [u0, v0, u1, v1], background) {
  const geometry = new THREE.PlaneGeometry(width, height);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
  if (background) {
    const colors = new Float32Array(uv.count * 3);
    for (let i = 0; i < uv.count; i++) background.toArray(colors, i * 3);
    geometry.setAttribute('signBack', new THREE.BufferAttribute(colors, 3));
  }
  return geometry;
}
