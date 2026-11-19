// Bogota.js comparte entre barrios las imágenes de relieve, rugosidad y ventanas de las fachadas,
// y las de relieve y rugosidad de los andenes. Esta prueba lo justifica: graba cada operación de
// dibujo de cada lienzo y comprueba que esos lienzos reciben exactamente las mismas órdenes en
// todos los barrios. Si alguien hace que el barrio cambie uno de ellos, la prueba falla.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { facade, sidewalk, rng } from '../src/world/bogota/textures.js';
import { NEIGHBORHOODS } from '../src/world/bogota/NeighborhoodIdentity.js';
import { Bogota } from '../src/world/districts/Bogota.js';

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

test('la planta residencial comparte sus mapas físicos y de luz sin pintar avisos de tienda', () => {
  const build = (district, groundFloor) => withRecording(() => facade({ district, groundFloor,
    seed: 34, width: 8, floors: 3, pxPerM: 20 }));
  const home = build('centro', 'residential'), other = build('comercio', 'residential');
  const shop = build('centro', 'shop');
  assert.ok(!home.map.image.log.some(([operation]) => operation === 'fillText'));
  assert.notEqual(logOf(home.map), logOf(shop.map));
  for (const kind of ['bumpMap', 'roughnessMap', 'emissiveMap']) assert.equal(logOf(home[kind]), logOf(other[kind]));
});

// Lienzo de mentira para armar la ciudad en Node: cada textura queda con su propia imagen.
function canvasDocument() {
  return { createElement() {
    const context = new Proxy({
      measureText: () => ({ width: 0 }),
      createRadialGradient: () => ({ addColorStop() {} }),
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
    }, { get: (object, key) => object[key] ?? (() => {}) });
    return { width: 0, height: 0, getContext: () => context };
  } };
}

function buildCity(parts) {
  const random = Math.random, previous = globalThis.document;
  try {
    Math.random = rng(7);
    globalThis.document = canvasDocument();
    const city = new Bogota();
    city.map = city._layout();
    if (parts.includes('ground')) city._buildGround(city.map);
    if (parts.includes('blocks')) city._buildBlocks(city.map);
    return city;
  } finally { Math.random = random; globalThis.document = previous; }
}

test('la ciudad guarda una sola imagen de ventanas, relieve y rugosidad por variante de fachada', () => {
  const city = buildCity(['blocks']);
  const byVariant = new Map();
  for (const [key, maps] of city._facadeTextures) {
    const base = key.slice(0, key.lastIndexOf(':'));
    if (!byVariant.has(base)) byVariant.set(base, []);
    byVariant.get(base).push([key, maps]);
  }
  const shared = [...byVariant.values()].filter(list => list.length > 1);
  assert.ok(shared.length > 5, `hay variantes en varios barrios (${shared.length})`);
  for (const [[firstKey, first], ...others] of shared) {
    for (const [key, maps] of others) {
      for (const kind of ['emissiveMap', 'bumpMap', 'roughnessMap']) {
        if (!first[kind]) continue;
        assert.notEqual(maps[kind], first[kind], `${key} ${kind}: cada barrio conserva su textura y sus ajustes`);
        assert.equal(maps[kind].source, first[kind].source, `${key} ${kind} usa la imagen de ${firstKey}`);
      }
      assert.notEqual(maps.map.source, first.map.source, `${key}: el color sigue siendo del barrio`);
    }
  }
});

test('los andenes de los barrios usan el relieve y la rugosidad del andén común', () => {
  const mats = buildCity(['ground']).groundMaterials;
  for (const id of ['cambuche', 'comercio', 'lago', 'chapinero']) {
    const material = mats[`sidewalk_${id}`];
    for (const kind of ['bumpMap', 'roughnessMap']) {
      assert.notEqual(material[kind], mats.sidewalk[kind], `${id} ${kind}: textura propia`);
      assert.equal(material[kind].source, mats.sidewalk[kind].source, `andén ${id}: ${kind} con la imagen del andén común`);
    }
    assert.notEqual(material.map.source, mats.sidewalk.map.source, `andén ${id}: el color sigue siendo del barrio`);
  }
});

test('soltar la ciudad libera cada textura de fachada y de andén una sola vez', () => {
  const city = buildCity(['ground', 'blocks']);
  const facades = [...city._facadeTextures.values()].flatMap(maps => Object.values(maps)).filter(t => t?.isTexture);
  const ground = Object.values(city.groundMaterials).flatMap(m => [m.map, m.bumpMap, m.roughnessMap]).filter(t => t?.isTexture);
  const counts = new Map();
  const dispose = THREE.Texture.prototype.dispose;
  THREE.Texture.prototype.dispose = function () { counts.set(this, (counts.get(this) ?? 0) + 1); return dispose.call(this); };
  try { city.dispose(new THREE.Scene()); } finally { THREE.Texture.prototype.dispose = dispose; }
  for (const texture of [...facades, ...ground]) assert.equal(counts.get(texture), 1, `${texture.name || texture.uuid} se libera una vez`);
  assert.ok([...counts.values()].every(n => n === 1), 'ninguna textura se libera dos veces');
});
