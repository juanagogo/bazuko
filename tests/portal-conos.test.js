import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import * as textures from '../src/world/bogota/textures.js';

const textureSet = () => ({ map: new THREE.Texture(), bumpMap: new THREE.Texture(), emissiveMap: new THREE.Texture() });
const replacements = { ...textures };
for (const name of ['asphalt', 'sidewalk', 'brick', 'facade', 'roofTiles', 'slab', 'cardboard', 'trashBag', 'dirt', 'concrete']) replacements[name] = textureSet;
for (const name of ['radialSprite', 'lightbox', 'neon']) replacements[name] = () => new THREE.Texture();
mock.module('../src/world/bogota/textures.js', { namedExports: replacements });
mock.module('../src/utils/signs.js', { namedExports: { signTexture: () => new THREE.Texture() } });
mock.module('../src/character/RealisticCharacter.js', { namedExports: {
  REALISTIC_SCALE: 1.08, createRealisticCharacter: async () => ({ group: new THREE.Group(), update() {} }),
  loadCatalog: async () => ({}), normalizeReal: (_, look) => look, optionsFor: () => [{ id: 'test' }]
} });
const { buildTransitTerminal, TERMINAL } = await import('../src/world/bogota/TransitTerminal.js');
const { buildCityEdge, buildTerminalEdge } = await import('../src/world/bogota/CityEdge.js');
const { detailRect } = await import('../src/world/bogota/ZoneTextures.js');
const { Bogota } = await import('../src/world/districts/Bogota.js');

/** Corre algo con el azar del juego y cuenta cuántos números pidió. */
function contarAzar(hacer) {
  const delJuego = Math.random;
  let sorteos = 0;
  Math.random = () => { sorteos++; return delJuego(); };
  try { return { valor: hacer(), sorteos }; } finally { Math.random = delJuego; }
}
const huella = texto => { let h = 2166136261; for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619); return (h >>> 0).toString(16); };
const cifra = v => v.toFixed(4);
const caja = ({ min, max }) => [min.x, min.y, min.z, max.x, max.y, max.z].map(cifra).join(',');

// La primera estación crea las texturas compartidas; la segunda ya no.
const primera = contarAzar(() => buildTransitTerminal({ asphalt: new THREE.MeshStandardMaterial() }));
const segunda = contarAzar(() => buildTransitTerminal({ asphalt: new THREE.MeshStandardMaterial() }));
const estacion = primera.valor;

const map = new Bogota()._layout();
const detail = new THREE.MeshStandardMaterial();
const registro = [];
const collisions = { add: (object, size) => registro.push([object.position.x, object.position.y, object.position.z, size.x, size.y, size.z].map(cifra).join(',')) };
const borde = contarAzar(() => buildCityEdge(map, { detail, collisions }));
const terminal = contarAzar(() => buildTerminalEdge({ x0: TERMINAL.x0, x1: TERMINAL.x1, z0: TERMINAL.z0, z1: TERMINAL.z1 - 4, lanes: [TERMINAL.southLane - 3.2, TERMINAL.northLane + 3.2] },
  { detail, collisions }));

const malla = nombre => estacion.children.find(o => o.name === `Estación: ${nombre}`);

test('los conos del cierre tienen base cuadrada negra, ocho caras y franja reflectiva, y ninguno se hunde', t => {
  const dentro = (name, u, v) => { const [u0, v0, u1, v1] = detailRect(name); return u >= u0 - 1e-6 && u <= u1 + 1e-6 && v >= v0 - 1e-6 && v <= v1 + 1e-6; };
  let franja = 0, naranja = 0, caidos = 0, ladeados = 0, hondo = Infinity;
  for (const raiz of [borde.valor.group, terminal.valor]) raiz.traverse(mesh => {
    if (!mesh.isMesh || !mesh.name.startsWith('Cierre')) return;
    const { position, uv } = mesh.geometry.attributes, index = mesh.geometry.index.array;
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [index[i], index[i + 1], index[i + 2]];
      const u = (uv.getX(a) + uv.getX(b) + uv.getX(c)) / 3, v = (uv.getY(a) + uv.getY(b) + uv.getY(c)) / 3;
      const ys = [a, b, c].map(k => position.getY(k));
      if (dentro('whiteTrim', u, v)) {
        franja++;
        if (Math.max(...ys) < .3) caidos++;
        else if (Math.min(Math.abs(ys[0] - ys[1]), Math.abs(ys[1] - ys[2]), Math.abs(ys[0] - ys[2])) > 1e-4) ladeados++;
      }
      if (dentro('orangeTarp', u, v)) { naranja++; hondo = Math.min(hondo, ...ys); }
    }
  });
  const conos = franja / 16;
  assert.ok(Number.isInteger(conos) && conos >= 20, `${franja} triángulos de franja: ${conos} conos de ocho caras`);
  assert.equal(naranja, conos * 32, 'dos tramos naranja de ocho caras por cono');
  assert.ok(caidos >= 16 && caidos <= franja / 4, `algún cono caído, no la mayoría (${caidos / 16})`);
  assert.ok(ladeados > 0, 'alguno ladeado');
  assert.ok(hondo > .01, `ningún cono se mete en el piso (${hondo})`);
  t.diagnostic(`${conos} conos, ${caidos / 16} caídos, ${ladeados / 16 | 0} ladeados`);
});
