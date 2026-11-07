// Bogota.js comparte entre barrios las imágenes de relieve, rugosidad y ventanas de las fachadas,
// y las de relieve y rugosidad de los andenes. Esta prueba lo justifica: graba cada operación de
// dibujo de cada lienzo y comprueba que esos lienzos reciben exactamente las mismas órdenes en
// todos los barrios. Si alguien hace que el barrio cambie uno de ellos, la prueba falla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { facade, sidewalk } from '../src/world/bogota/textures.js';
import { NEIGHBORHOODS } from '../src/world/bogota/NeighborhoodIdentity.js';

function recordingDocument() {
  const canvases = new Map();
  return {
    canvases,
    createElement() {
      const log = [];
      const gradient = () => ({ addColorStop: (...args) => log.push(['stop', ...args]) });
      const context = new Proxy({}, {
        get(_, key) {
          if (key === 'createLinearGradient' || key === 'createRadialGradient') return (...args) => { log.push([key, ...args]); return gradient(); };
          if (key === 'measureText') return text => ({ width: String(text).length * 7 });
          if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
          return (...args) => { log.push([key, ...args.map(a => typeof a === 'function' ? 'fn' : a)]); };
        },
        set(_, key, value) { log.push(['=', key, typeof value === 'object' ? 'gradiente' : value]); return true; }
      });
      const canvas = { width: 0, height: 0, getContext: () => context, log };
      return canvas;
    }
  };
}

function withRecording(build) {
  const previous = globalThis.document;
  const doc = recordingDocument();
  globalThis.document = doc;
  try { return build(); } finally { globalThis.document = previous; }
}

const logOf = texture => JSON.stringify([texture.image.width, texture.image.height, texture.image.log]);

test('ventanas, relieve y rugosidad de una fachada no cambian con el barrio', () => {
  const districts = Object.keys(NEIGHBORHOODS);
  assert.ok(districts.length > 1);
  for (const style of ['pintada', 'ladrillo', 'ruina']) {
    for (const [width, floors] of [[6, 3], [9.6, 4], [4.8, 2]]) {
      const seed = 2166136261 ^ Math.round(width * 10) ^ floors;
      const textures = districts.map(district => withRecording(() =>
        facade({ seed, width, floors, pxPerM: style === 'pintada' ? 36 : 48, shopFront: true, style, district })));
      for (const kind of ['emissiveMap', 'bumpMap', 'roughnessMap']) {
        const first = logOf(textures[0][kind]);
        assert.ok(textures[0][kind].image.log.length >= 2, `${style} ${kind} se pinta`);
        textures.slice(1).forEach((tex, i) => assert.equal(logOf(tex[kind]), first, `${style} ${width}×${floors} ${kind} en ${districts[i + 1]}`));
      }
      // El color sí cambia: si no, compartir también el mapa de color sería posible.
      assert.ok(textures.some(tex => logOf(tex.map) !== logOf(textures[0].map)), `${style}: el barrio cambia el color`);
    }
  }
});

test('relieve y rugosidad del andén no cambian con el barrio', () => {
  const maps = [undefined, 'cambuche', 'comercio', 'lago', 'chapinero'].map(district =>
    withRecording(() => district ? sidewalk(11, { district }) : sidewalk(11)));
  for (const kind of ['bumpMap', 'roughnessMap']) {
    for (const other of maps.slice(1)) assert.equal(logOf(other[kind]), logOf(maps[0][kind]), kind);
  }
});
