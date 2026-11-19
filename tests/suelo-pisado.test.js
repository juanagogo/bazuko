// Lo que no se mueve al ensuciar la tierra de El Cartucho y los andenes: el azar del juego, lo que cada
// textura ya pintaba con su semilla, las demás texturas y las mallas del suelo y del sardinel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import * as TX from '../src/world/bogota/textures.js';
import { Bogota } from '../src/world/districts/Bogota.js';
import { addStreetDetails } from '../src/world/bogota/StreetDetails.js';
import { activateSunField } from '../src/world/bogota/SunField.js';

// Lienzo que anota cada orden de dibujo, para comparar lo pintado sin pintar nada.
function recordingDocument() {
  return {
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
      return { width: 0, height: 0, getContext: () => context, log };
    }
  };
}

function recorded(build) {
  const previous = globalThis.document, random = Math.random;
  let draws = 0;
  globalThis.document = recordingDocument();
  Math.random = () => { draws++; return random(); };
  try { return { maps: build(), draws }; } finally { globalThis.document = previous; Math.random = random; }
}

const huella = entries => createHash('sha256').update(JSON.stringify(entries)).digest('hex').slice(0, 16);
const sinEstilo = log => log.filter(entry => entry[0] !== '=');
const comienzo = (log, length) => {
  assert.ok(log.length >= length, `se pinta al menos lo de antes (${log.length} de ${length})`);
  return huella(log.slice(0, length));
};

test('los andenes se apagan y se ensucian contra el sardinel y la fachada, sin tocar la Candelaria', () => {
  const city = new Bogota();
  city.map = city._layout();
  city._buildGround(city.map);
  for (const key of ['sidewalk', 'sidewalk_cambuche', 'sidewalk_comercio', 'sidewalk_lago', 'sidewalk_chapinero']) {
    assert.equal(city.groundMaterials[key].color.getHexString(), 'cdc8bc', key);
  }
  const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '#include <map_fragment>\n#include <lights_fragment_begin>' };
  city.groundMaterials.sidewalk.onBeforeCompile(shader);
  const glsl = shader.fragmentShader;
  assert.match(glsl, /1\. - smoothstep\( \.2, \.3, pavingCurbSide \)/, '25 cm contra el sardinel');
  assert.match(glsl, /1\. - smoothstep\( \.28, \.42, pavingFromWall \)/, '35 cm contra la fachada');
  assert.match(glsl, /1\. - \.2 \* pavingGrime \* step\( \.5, uPavingKind \) \* step\( uPavingKind, 3\.5 \)/, 'un 20 % menos, ni en la Candelaria ni en la tierra');
  const sinChicles = recorded(() => TX.sidewalk(11)).maps.map.image.log.filter(entry => entry[0] === 'createRadialGradient').length;
  assert.ok(sinChicles > 120, `el andén pinta sus chicles (${sinChicles} manchas)`);
});
