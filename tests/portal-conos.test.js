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

test('el Portal y los conos gastan el mismo azar de la ciudad y registran los mismos choques', () => {
  // Cifras de antes de vestir el andén y los conos: las texturas nuevas nacen con su propio azar.
  assert.deepEqual([primera.sorteos, segunda.sorteos, borde.sorteos, terminal.sorteos], [672, 580, 408, 28]);
  const choques = estacion.userData.colliders.map(c => caja(c.box) + (c.layered ? 'l' : '')).join(';');
  assert.deepEqual([estacion.userData.colliders.length, huella(choques)], [55, '58177f5e']);
  assert.deepEqual([registro.length, huella(registro.join(';'))], [22, 'a052efc9']);
});

test('el cielo raso del andén lleva juntas, goteras y polvo pintados, y el rojo es quemado', () => {
  const cielo = malla('ceiling'), hoja = cielo.material.map;
  assert.ok(hoja, 'el cielo raso tiene hoja de acabados');
  assert.equal(cielo.material.emissiveMap, hoja, 'las manchas también apagan el rebote de luz');
  for (const nombre of ['steel', 'inside']) assert.equal(malla(nombre).material.map, hoja, nombre);
  // Cada panel mira hacia abajo y toma su parte de la hoja: ninguno queda liso en la esquina blanca.
  const { position, uv, normal } = cielo.geometry.attributes;
  const usadas = new Set();
  let paneles = 0;
  for (let i = 0; i < position.count; i++) {
    if (normal.getY(i) > -.9 || Math.abs(position.getY(i) - 3.42) > 1e-6) continue;
    paneles++;
    assert.ok(uv.getX(i) > 0 || uv.getY(i) > 0, `panel en ${position.getX(i)}, ${position.getZ(i)}`);
    usadas.add(`${Math.floor(uv.getX(i) * 4)},${Math.floor(uv.getY(i) * 6)}`);
  }
  assert.ok(paneles >= 99 * 4, `${paneles} vértices de panel`);
  assert.ok(usadas.size >= 8, 'los paneles no repiten el mismo dibujo');
  // Ni un vértice del rojo puro de antes (#a8141c, con cualquier sombra): lo que es rojo va quemado hacia #8a2a26.
  const viejo = new THREE.Color('#a8141c'), puro = [];
  for (const mesh of estacion.children) {
    const color = mesh.geometry?.attributes.color;
    if (!color) continue;
    for (let i = 0; i < color.count; i++) {
      const r = color.getX(i);
      if (r > .01 && Math.abs(color.getY(i) / r - viejo.g / viejo.r) < 2e-3 && Math.abs(color.getZ(i) / r - viejo.b / viejo.r) < 2e-3) puro.push(mesh.name);
    }
  }
  assert.deepEqual([...new Set(puro)], []);
});

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

test('las columnas llevan el zócalo sucio de la hoja y de noche cada luminaria aclara el cielo raso', () => {
  const { position, uv } = malla('inside').geometry.attributes;
  let columnas = 0;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i);
    if ((Math.abs(x - 73.04) > 1e-3 && Math.abs(x - 73.2) > 1e-3 && Math.abs(x - 76.8) > 1e-3 && Math.abs(x - 76.96) > 1e-3) || y < 3.45) continue;
    if (uv.getX(i) > 0) columnas++;
  }
  assert.ok(columnas >= 18 * 8, `${columnas} vértices de columna con su parte de la hoja`);
  const charcos = malla('pools');
  assert.equal(charcos.material.visible, false, 'de día no hay halos');
  const { position: p, normal } = charcos.geometry.attributes;
  let halos = 0;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - (3.42 - .006)) < 1e-6 && normal.getY(i) < -.9) halos++;
  assert.equal(halos / 4, 34, 'un halo por luminaria, en las dos filas');
  estacion.userData.setNight(true);
  assert.equal(charcos.material.visible, true);
  estacion.userData.setNight(false);
  // La ciudad quita de la estación lo que nace oculto: los charcos tienen que seguir a la vista para llegar a la escena.
  assert.deepEqual(estacion.children.filter(mesh => !mesh.visible).map(mesh => mesh.name), []);
});

test('el bordillo amarillo del andén cambia de tono a lo largo, gastado a tramos', () => {
  const { position, color, normal } = malla('concrete').geometry.attributes, amarillo = new THREE.Color('#d8b62c');
  const tonos = new Set();
  for (let i = 0; i < position.count; i++) {
    if (Math.abs(position.getY(i) - (.92 + .002)) > 1e-6 || normal.getY(i) < .9) continue;
    const x = position.getX(i);
    if (Math.abs(x - 73) > .04 && Math.abs(x - 77) > .04) continue;
    assert.ok(color.getX(i) < amarillo.r, 'ningún tramo con el amarillo limpio');
    tonos.add(color.getX(i).toFixed(4));
  }
  assert.ok(tonos.size >= 20, `${tonos.size} tonos en el canto`);
});
