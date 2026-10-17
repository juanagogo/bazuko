// src/utils/TextureCache.js
// Texturas del suelo (pasto, calle, andén) en public/textures/*.jpg. Se cargan una vez antes de crear
// el mundo (el splash las espera, con tope). Si alguna falla, TileFactory usa las procedurales.
import * as THREE from 'three';

const FILES = {
  pasto: 'pasto.jpg',
  calle: 'calle.jpg',
  anden: 'anden.jpg'
};

const textures = new Map(); // nombre -> THREE.Texture (solo las que cargaron bien)
let loading = null;

function configure(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 8; // three lo limita al máximo del GPU
  return tex;
}

/** Precarga las texturas de suelo. onProgress(0..1). Nunca rechaza: las que fallan quedan sin cargar. */
export function loadWorldTextures(onProgress) {
  if (loading) return loading;
  const names = Object.keys(FILES);
  let done = 0;
  const loader = new THREE.TextureLoader();
  loading = Promise.all(names.map((n) => new Promise((resolve) => {
    const url = `${import.meta.env.BASE_URL}textures/${FILES[n]}`;
    loader.load(
      url,
      (tex) => { textures.set(n, configure(tex)); resolve(); },
      undefined,
      (err) => { console.warn(`[TextureCache] No se pudo cargar ${url}`, err); resolve(); }
    );
  }).then(() => { done++; onProgress?.(done / names.length); })));
  return loading;
}

/** Textura ya cargada o null (el llamador usa su fallback procedural). */
export function getWorldTexture(name) {
  return textures.get(name) || null;
}
