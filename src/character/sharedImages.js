// src/character/sharedImages.js
// Los glTF de cuerpos y prendas apuntan a las mismas imágenes de personaje/texturas/. Este complemento
// hace que cada imagen se descargue, se decodifique y se suba a la GPU una sola vez, sin importar cuántos
// archivos la usen. Cada glTF sigue recibiendo su propia Texture, porque el cargador le pone encima sus
// ajustes (flipY, filtros, repetición, espacio de color); lo único que comparten es la imagen.
import * as THREE from 'three';

// URL normalizada → promesa de una textura que nadie dibuja: es el molde del que sale la copia de cada glTF.
const images = new Map();

/** Clonar marca la imagen como cambiada, y eso la volvería a subir a la GPU sin que nada haya cambiado. */
function copyOf(original) {
  const { source } = original, { version } = source;
  const copy = original.clone();
  source.version = version;
  return copy;
}

/**
 * Complemento de GLTFLoader, para `loader.register(shareImages)`. Va por delante del cargador de imágenes
 * que eligió el parser, así que da igual cuál sea según el navegador. Las imágenes embebidas en el archivo
 * no tienen nombre que compartir y siguen su camino normal.
 */
export function shareImages(parser) {
  const inner = parser.textureLoader;
  // El parser espera recibir una textura de este cargador; ImageBitmapLoader entrega la imagen sola.
  const toTexture = (image) => {
    if (!inner.isImageBitmapLoader) return image;
    const texture = new THREE.Texture(image);
    texture.needsUpdate = true;
    return texture;
  };
  parser.textureLoader = {
    load(url, onLoad, onProgress, onError) {
      if (/^(blob|data):/.test(url)) {
        inner.load(url, image => onLoad(toTexture(image)), onProgress, onError);
        return;
      }
      // Desde el cuerpo y desde lod/ la misma imagen llega con rutas distintas (../ y ../../).
      const key = new URL(url, 'http://imagen/').href;
      let image = images.get(key);
      if (!image) {
        image = new Promise((resolve, reject) => inner.load(url, loaded => resolve(toTexture(loaded)), undefined, reject));
        images.set(key, image);
        image.catch(() => images.delete(key)); // un fallo de red no se queda para toda la partida
      }
      image.then(original => onLoad(copyOf(original)), onError);
    }
  };
  return { name: 'BAZUKO_shared_images' };
}
