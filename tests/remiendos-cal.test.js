import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

const { Bogota, CollisionSystem } = await import('./helpers/traffic-world.js');
const { asphaltPatchAt, asphaltPatches, buildStreetMarkings, crossings } = await import('../src/world/bogota/StreetMarkings.js');
const { pedestrianCrossings } = await import('../src/world/bogota/StreetCrossings.js');
const { ANCHO, ALTO, PIEZAS, texturaDeCulatas, orillaDe, planEncalada, CAL } = await import('../src/world/bogota/culatasAtlas.js');

const sembrado = () => {
  let s = 0x2F6B1C3D >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const contando = (hacer, azar = Math.random) => {
  const delJuego = Math.random;
  let sorteos = 0;
  Math.random = () => { sorteos++; return azar(); };
  try { return [hacer(), sorteos]; } finally { Math.random = delJuego; }
};
const calle = () => {
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  return city;
};

test('pintar la calle gasta el mismo azar, en las mismas mallas y con un material, sin vértices ni triángulos de más', () => {
  const ciudad = calle();
  const [mallas, sorteos] = contando(() => buildStreetMarkings(ciudad));
  assert.equal(sorteos, 108);
  assert.equal(mallas.length, 12);
  assert.equal(new Set(mallas.map((m) => m.material)).size, 1);
  const vertices = mallas.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  const triangulos = mallas.reduce((n, m) => n + m.geometry.index.count / 3, 0);
  assert.equal(vertices, 46484); // Las cebras nuevas comparten los mismos doce sectores.
  assert.ok(triangulos <= 29002, `${triangulos} triángulos`);
});

test('los remiendos quedan en su sitio, con su tamaño y su carril: los charcos los encuentran igual', () => {
  const map = calle().map, cruces = crossings(), originales = [];
  for (let tz = 0; tz < map.length; tz++) for (let tx = 0; tx < map[tz].length; tx++) {
    const remiendo = asphaltPatchAt(map, tx, tz, undefined, cruces, []);
    if (remiendo) originales.push(remiendo);
  }
  assert.equal(originales.length, 216);
  const suma = originales.reduce((s, p) => s + p.x + p.z * 3 + p.length * 7 + p.width * 11 + p.lane * 13 + (p.trench ? 17 : 0), 0);
  assert.ok(Math.abs(suma - 147049.98528940944) < 1e-6, `${suma}`);

  // Solo se retiran los 15 remiendos cuyo contorno o sello ocupa una cebra.
  const pasos = pedestrianCrossings(map);
  const invade = remiendo => remiendo.outline.some(([x, z]) => pasos.some(p => {
    const avance = (x - p.x) * p.dx + (z - p.z) * p.dz;
    const lado = (x - p.x) * p.dz - (z - p.z) * p.dx;
    return avance >= -.03 && avance <= p.length + .03 && Math.abs(lado) <= p.width / 2 + .03;
  }));
  const compatibles = originales.filter(p => !invade(p));
  assert.equal(compatibles.length, 201);
  assert.deepEqual(asphaltPatches(map), compatibles);
});

test('el remiendo se lee por su tono: sello gris oscuro, de ancho desigual, cortado a tramos y desvanecido hacia afuera', () => {
  const lista = asphaltPatches(calle().map);
  const frescos = lista.filter((p) => p.fill[0] < .1), viejos = lista.filter((p) => p.fill[0] > .1);
  assert.ok(frescos.length > lista.length * .5 && viejos.length > lista.length * .3);
  for (const p of frescos) assert.ok(p.fill[3] >= .16 && p.fill[3] <= .22, `relleno fresco con alfa ${p.fill[3]}`);
  for (const p of viejos) assert.ok(p.fill[3] >= .08 && p.fill[3] <= .12, `relleno viejo con alfa ${p.fill[3]}`);
  const sinSello = lista.filter((p) => p.seamAlpha.every((a) => a === 0));
  assert.ok(sinSello.length > lista.length * .25 && sinSello.length < lista.length * .42, `${sinSello.length} sin sello de ${lista.length}`);
  for (const p of lista) {
    assert.deepEqual(p.seamColor, [.035, .035, .04]);
    assert.equal(p.seam.length, p.outline.length);
    assert.ok(Math.max(...p.seam) - Math.min(...p.seam) > .012, 'el ancho cambia a lo largo del contorno');
    if (sinSello.includes(p)) continue;
    for (const a of p.seamAlpha) assert.ok(a === 0 || (a >= .22 && a <= .38), `sello con alfa ${a}`);
    const n = p.seamAlpha.length, abiertos = p.seamAlpha.filter((a) => a === 0).length;
    assert.ok(abiertos >= n * .3 && abiertos <= n * .45, `${abiertos} de ${n} vértices sin sello`);
    const desde = p.seamAlpha.findIndex((a) => a > 0);
    let tramo = 0;
    for (let k = 1; k <= n; k++) {
      if (p.seamAlpha[(desde + k) % n] === 0) tramo++;
      else if (tramo) { assert.ok(tramo >= 3 && tramo <= 5, `tramo sin sello de ${tramo} vértices`); tramo = 0; }
    }
  }
});

test('el sello se desvanece: el anillo de afuera va sin tinta en los remiendos que quedan entre los pasos', () => {
  const mallas = buildStreetMarkings(calle());
  let afuera = 0;
  for (const malla of mallas) {
    const color = malla.geometry.attributes.color.array;
    for (let i = 0; i < color.length; i += 4) {
      if (Math.abs(color[i] - .035) < 1e-6 && Math.abs(color[i + 2] - .04) < 1e-6) {
        assert.ok(color[i + 3] === 0 || (color[i + 3] >= .22 && color[i + 3] <= .38), `tinta del sello ${color[i + 3]}`);
        if (color[i + 3] === 0) afuera++;
      }
    }
  }
  const lista = asphaltPatches(calle().map), vertices = lista.reduce((n, p) => n + p.outline.length, 0);
  assert.ok(afuera >= vertices, `${afuera} vértices del sello sin tinta`);
  assert.equal(mallas.reduce((n, m) => n + m.geometry.index.count / 3, 0), 28801);
});

test('la carta de culatas no cambia de tamaño ni de celdas y pintarla no toca más azar del juego que antes', () => {
  assert.deepEqual([ANCHO, ALTO], [2048, 1664]);
  assert.equal(JSON.stringify(Object.entries(PIEZAS).map(([n, { celda }]) => [n, ...celda])),
    '[["colibri",0,0,512,512],["frailejon",512,0,512,512],["cerros",1024,0,512,512],["copeton",1536,0,512,512],'
    + '["montallantas",0,512,1024,256],["lote",0,768,1024,256],["basura",1024,512,768,256],["firmas",1024,768,768,256],'
    + '["carteles",1792,512,256,512],["parquear",0,1024,1024,256],["casa",1024,1024,1024,256],["soldadura",0,1280,512,256],'
    + '["modista",512,1280,512,256],["bazar",1024,1280,512,256],["encalada",1536,1280,512,256],["rayonLavado",0,1536,256,128],'
    + '["rayonFirma",256,1536,256,128],["rayonCorona",512,1536,256,128],["rayonTapado",768,1536,256,128]]');
  const degradado = { addColorStop() {} };
  const ctx = new Proxy({}, {
    get: (_, clave) => /^create(Linear|Radial)Gradient$/.test(clave) ? () => degradado
      : clave === 'measureText' ? () => ({ width: 100 }) : () => {},
    set: () => true
  });
  const antes = globalThis.document;
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try {
    const [textura, sorteos] = contando(() => texturaDeCulatas());
    assert.ok(textura);
    assert.equal(sorteos, 8);
  } finally { globalThis.document = antes; }
});

test('en la ciudad armada: los mismos choques y las mismas mallas de culatas y de pintura', () => {
  globalThis.window ??= new EventTarget();
  const choques = new CollisionSystem(), ciudad = new Bogota();
  contando(() => ciudad.build(new THREE.Scene(), choques), sembrado());
  const culatas = [], pintura = [];
  ciudad.group.traverse((o) => {
    if (o.name === 'Culatas') culatas.push(o);
    if (o.isMesh && o.material?.name === 'Pintura y remiendos') pintura.push(o);
  });
  const pilaresMetro = new Set(ciudad.group.getObjectByName('MetroBogota').userData.colliders);
  assert.deepEqual([pilaresMetro.size, choques.colliders.filter(entry => !pilaresMetro.has(entry)).length], [12, 1691]);
  assert.deepEqual([choques.colliders.length, choques.dynamicColliders.length], [1703, 0]);
  const decoracion = new Set(pintura);
  culatas[0].traverse(o => decoracion.add(o));
  assert.ok(choques.colliders.every(({ mesh }) => !decoracion.has(mesh)));
  assert.deepEqual([culatas[0].children.length, culatas[0].userData.piezas.length], [17, 154]);
  assert.equal(pintura.length, 12);
});

const superficie = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; }
  return Math.abs(a) / 2;
};

test('el borde comido de las culatas es un trazo suave de 6 a 20 px, sin dientes de peine', () => {
  let comidas = 0;
  for (const nombre of Object.keys(PIEZAS)) {
    const orilla = orillaDe(nombre);
    if (!orilla) continue;
    comidas++;
    const [, , w, h] = PIEZAS[nombre].celda, arriba = [];
    for (let i = 0; i < orilla.length; i += 2) {
      const hondo = Math.min(orilla[i], w - orilla[i], orilla[i + 1], h - orilla[i + 1]);
      assert.ok(hondo >= 0 && hondo <= 20 + 1e-9, `${nombre}: se come ${hondo} px`);
    }
    for (let i = 0; i < Math.ceil(w / 4); i++) arriba.push(orilla[i * 2 + 1]);
    const saltos = arriba.slice(1).map((v, i) => Math.abs(v - arriba[i]));
    assert.ok(Math.max(...saltos) <= 4, `${nombre}: salto de ${Math.max(...saltos).toFixed(1)} px entre vecinos a 4 px`);
    if (PIEZAS[nombre].tipo !== 'carteles') {
      assert.ok(Math.min(...arriba) >= 6 - 1e-9 && Math.max(...arriba) - Math.min(...arriba) >= 5, `${nombre}: de ${Math.min(...arriba)} a ${Math.max(...arriba)} px`);
    }
  }
  assert.ok(comidas >= 14, `${comidas} piezas con borde comido`);
});

test('la cal tapa el aviso viejo en brochazos que se montan, con cerdas al final, ladrillo a la vista y un chorreón', () => {
  const [, , w, h] = PIEZAS.encalada.celda, { brochazos, huecos, chorreon } = planEncalada(w, h);
  assert.equal(CAL, '#b8b09c');
  assert.ok(brochazos.length >= 3 && brochazos.length <= 5, `${brochazos.length} brochazos`);
  brochazos.forEach((b, i) => {
    assert.ok(b.alfa >= .55 && b.alfa <= .8, `alfa ${b.alfa}`);
    assert.ok(b.cerdas.length >= 4 && b.cerdas.length <= 6);
    for (const cerda of b.cerdas) assert.ok(cerda.grueso >= 1 && cerda.grueso <= 2);
    const otro = brochazos[i + 1];
    if (otro) assert.ok(otro.y - b.y < (b.alto + otro.alto) / 2, 'se montan');
  });
  assert.ok(brochazos[0].y - brochazos[0].alto / 2 <= 0 && brochazos.at(-1).y + brochazos.at(-1).alto / 2 >= h, 'tapan de arriba abajo');
  const ladrillo = (w * h - superficie(orillaDe('encalada')) + huecos.reduce((s, p) => s + superficie(p), 0)) / (w * h);
  assert.ok(ladrillo >= .15 && ladrillo <= .25, `asoma el ladrillo en un ${(ladrillo * 100).toFixed(1)} %`);
  assert.ok(chorreon.largo >= h * .4 && chorreon.x > 0 && chorreon.x < w, 'el chorreón baja desde el remate');
});
