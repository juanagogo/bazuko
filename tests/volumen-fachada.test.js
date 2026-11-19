import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { addBuildingDetails } from '../src/world/bogota/BuildingDetails.js';
import { createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';
import { sumarVolumen, VOLUMEN } from '../src/world/bogota/volumenFachada.js';

const BASES = { 0: [0, -1, 1, 0], 1: [0, 1, -1, 0], 4: [1, 0, 0, 1], 5: [-1, 0, 0, -1] };
const material = new THREE.MeshStandardMaterial();

function mallas(shell) {
  const lista = [];
  shell.root.traverse(o => { if (o.isMesh) lista.push(o); });
  return lista;
}

/** Una casa de la cuadra como la arma `_house`: cascarón, detalles y, si se pide, el volumen. */
function casa({ width = 8, depth = 6, floors = 3, face = 4, seed = 318, neighborhood = 'comercio', ruin = false, volumen = true, colgar = null } = {}) {
  const height = floors * 3;
  const shell = createBuildingShell(new THREE.BoxGeometry(width, height, depth), Array(6).fill(material),
    { x: 10, z: 20, height, interiorMaterial: material });
  colgar?.(shell.walls.get(face));
  const opciones = { shell, width, depth, height, floors, face, seed, neighborhood, ruin };
  addBuildingDetails({ ...opciones, balconies: false });
  const antes = new Map(mallas(shell).map(m => [m, { material: m.material, vertices: m.geometry.attributes.position.count }]));
  const stats = volumen ? sumarVolumen(opciones) : null;
  return { shell, stats, antes, opciones };
}

/** Lo que el volumen sumó a cada malla, en coordenadas de la cara: `u` a lo largo, `y` arriba y `v` hacia fuera de la planta. */
function nuevos({ shell, antes, opciones }) {
  const [ux, uz, nx, nz] = BASES[opciones.face], plane = (opciones.face < 2 ? opciones.width : opciones.depth) / 2;
  const puntos = [];
  for (const [mesh, { vertices }] of antes) {
    const p = mesh.geometry.attributes.position;
    for (let i = vertices; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      puntos.push({ mesh, u: ux * x + uz * z, y: p.getY(i), v: nx * x + nz * z - plane, x, z, techo: mesh.parent === shell.roof });
    }
  }
  return puntos;
}

test('el volumen va en las mallas y los materiales que la casa ya tenía y no gasta azar', () => {
  for (const face of [0, 1, 4, 5]) {
    const sin = casa({ face, volumen: false }), con = casa({ face, volumen: false });
    const random = Math.random;
    let sorteos = 0;
    Math.random = () => { sorteos++; return random(); };
    try { sumarVolumen(con.opciones); } finally { Math.random = random; }
    assert.equal(sorteos, 0, 'sin Math.random');
    const a = mallas(sin.shell), b = mallas(con.shell);
    assert.equal(b.length, a.length);
    assert.deepEqual(b.map(m => m.name), a.map(m => m.name));
    assert.deepEqual(new Set(b.map(m => m.material)), new Set(a.map(m => m.material)));
    for (const [i, mesh] of b.entries()) {
      assert.equal(mesh.material, a[i].material);
      assert.deepEqual(Object.keys(mesh.geometry.attributes).sort(), Object.keys(a[i].geometry.attributes).sort(), 'sin atributos nuevos');
      if (!mesh.geometry.boundingBox) continue;
      const caja = mesh.geometry.boundingBox.clone();
      mesh.geometry.computeBoundingBox();
      assert.ok(caja.equals(mesh.geometry.boundingBox), `la caja de ${mesh.name} va al día`);
    }
  }
});

test('lo nuevo va arriba de 3,4 m, sale a lo sumo 42 cm de la planta y suma pocos triángulos', () => {
  for (const face of [0, 1, 4, 5]) for (const floors of [2, 3, 6]) for (const width of [4, 8, 12]) for (const ruin of [false, true]) {
    const datos = casa({ face, floors, width, depth: 6, seed: 1000 + floors * 31 + width + face, ruin });
    const length = face < 2 ? 6 : width;
    assert.ok(datos.stats.triangulos > 0 && datos.stats.triangulos <= 520, `${datos.stats.triangulos} triángulos en la fachada ${face}`);
    for (const punto of nuevos(datos).filter(p => !p.techo)) {
      assert.ok(punto.y >= 3.4 - 1e-6, `nada nuevo bajo 3,4 m (${punto.y.toFixed(2)})`);
      assert.ok(punto.v <= .42 + 1e-6, `sale ${punto.v.toFixed(2)} m`);
      assert.ok(Math.abs(punto.u) <= length / 2 + 1e-6, 'no pasa a la casa vecina');
      assert.ok(punto.y <= floors * 3 + 1e-6);
    }
  }
});

test('la misma semilla da las mismas piezas', () => {
  const geometria = shell => mallas(shell).map(m => [m.name, Array.from(m.geometry.attributes.position.array), Array.from(m.geometry.index.array)]);
  for (const face of [0, 4]) {
    const a = casa({ face, seed: 77 }), b = casa({ face, seed: 77 });
    assert.deepEqual(geometria(b.shell), geometria(a.shell));
  }
});

test('el alero vuela bajo el antepecho de la azotea en todo el frente', () => {
  for (const face of [0, 1, 4, 5]) {
    const datos = casa({ face, floors: 4 }), height = 12, length = face < 2 ? 6 : 8;
    assert.equal(datos.stats.alero, true);
    const { vuelo, grueso, bajoAzotea } = VOLUMEN.alero;
    const alero = nuevos(datos).filter(p => p.v > .3);
    assert.ok(alero.length >= 4);
    assert.ok(alero.every(p => Math.abs(p.v - vuelo) < 1e-6));
    assert.ok(Math.abs(Math.max(...alero.map(p => p.y)) - (height - bajoAzotea)) < 1e-6);
    assert.ok(Math.abs(Math.min(...alero.map(p => p.y)) - (height - bajoAzotea - grueso)) < 1e-6);
    assert.ok(Math.max(...alero.map(p => p.u)) - Math.min(...alero.map(p => p.u)) > length - .1, 'cubre el frente');
  }
  // Una casa de un piso no tiene placa ni ventanas: queda igual.
  const baja = casa({ floors: 1 });
  assert.equal(baja.stats.triangulos, 0);
  assert.deepEqual(nuevos(baja), []);
});

/** Los vidrios de cada vano, tal como los dejó `addBuildingDetails`: centro y bordes en coordenadas de la cara. */
function vanos({ shell, opciones }) {
  const [ux, uz, nx, nz] = BASES[opciones.face], plane = (opciones.face < 2 ? opciones.width : opciones.depth) / 2;
  const lista = [];
  for (const mesh of shell.walls.get(opciones.face).children) {
    if (!mesh.userData.buildingDetails) continue;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i + 3 < p.count; i += 4) {
      const esquinas = [0, 1, 2, 3].map(k => ({ u: ux * p.getX(i + k) + uz * p.getZ(i + k), y: p.getY(i + k), v: nx * p.getX(i + k) + nz * p.getZ(i + k) - plane }));
      if (!esquinas.every(e => Math.abs(e.v + .06) < 1e-6)) continue;
      const us = esquinas.map(e => e.u), ys = esquinas.map(e => e.y);
      lista.push({ u: (Math.min(...us) + Math.max(...us)) / 2, bottom: Math.min(...ys), top: Math.max(...ys) });
    }
  }
  return lista;
}

test('cada vano lleva dintel y alféizar centrados que salen de la pared', () => {
  for (const face of [0, 1, 4, 5]) for (const width of [4, 8, 12]) {
    const datos = casa({ face, width, floors: 4, seed: 9 + width });
    const lista = vanos(datos), puntos = nuevos(datos), techo = 12 - VOLUMEN.alero.bajoAzotea;
    assert.ok(lista.length >= 3);
    for (const { u, bottom, top } of lista) {
      const alfeizar = puntos.filter(p => Math.abs(p.v - VOLUMEN.alfeizar.sale) < 1e-6 && p.y > bottom - .2 && p.y < bottom - .05 && Math.abs(p.u - u) < 1.5);
      assert.ok(alfeizar.length >= 4, `alféizar bajo el vano en ${u.toFixed(2)}`);
      assert.ok(Math.abs((Math.min(...alfeizar.map(p => p.u)) + Math.max(...alfeizar.map(p => p.u))) / 2 - u) < 1e-6, 'alféizar centrado');
      assert.ok(Math.max(...alfeizar.map(p => p.y)) < bottom - .05, 'bajo el alféizar de antes');
      const dintel = puntos.filter(p => Math.abs(p.v - VOLUMEN.dintel.sale) < 1e-6 && p.y > top && p.y < top + .25 && Math.abs(p.u - u) < 1.5);
      if (top + VOLUMEN.dintel.alto > techo - VOLUMEN.alero.grueso) { assert.equal(dintel.length, 0, 'la última ventana termina en la placa'); continue; }
      assert.ok(dintel.length >= 4, `dintel sobre el vano en ${u.toFixed(2)}`);
      assert.ok(Math.abs((Math.min(...dintel.map(p => p.u)) + Math.max(...dintel.map(p => p.u))) / 2 - u) < 1e-6, 'dintel centrado');
    }
    assert.equal(datos.stats.alfeizares.length, lista.length);
  }
});

test('una pared sin mallas de detalle queda igual y no nace nada', () => {
  const shell = createBuildingShell(new THREE.BoxGeometry(8, 9, 6), Array(6).fill(material), { x: 0, z: 0, height: 9, interiorMaterial: material });
  const antes = mallas(shell).map(m => [m, m.geometry.attributes.position.count]);
  const stats = sumarVolumen({ shell, width: 8, depth: 6, height: 9, floors: 3, face: 4, seed: 5 });
  assert.equal(stats.triangulos, 0);
  assert.deepEqual(mallas(shell).map(m => [m, m.geometry.attributes.position.count]), antes);
});

/** Lo que `_house` cuelga de la fachada antes de detallarla: el aviso grande a 3,05 m o el balcón de madera a 3,1 m. */
const conAviso = ancho => wall => {
  const aviso = new THREE.Mesh(new THREE.PlaneGeometry(ancho, ancho / 4), material);
  aviso.position.y = 3.05;
  wall.add(aviso);
};
const conBalcon = wall => {
  const balcon = new THREE.Group();
  balcon.position.y = 3.1;
  wall.add(balcon);
};

test('la franja del entrepiso va sobre el aviso y bajo el primer alféizar, y nunca en ruina ni con balcón', () => {
  for (const face of [0, 4]) {
    const libre = casa({ face });
    assert.ok(libre.stats.franja, 'sin aviso cabe');
    const primerAlfeizar = Math.min(...libre.stats.alfeizares.map(([, bottom]) => bottom)) - VOLUMEN.alfeizar.bajo;
    assert.ok(libre.stats.franja[0] >= 3.4 && libre.stats.franja[1] <= primerAlfeizar - .05 + 1e-9);
    const angosto = casa({ face, colgar: conAviso(1.7) });
    assert.ok(angosto.stats.franja && angosto.stats.franja[0] >= 3.05 + 1.7 / 8 + .05 - 1e-9, 'sobre un aviso angosto');
    assert.equal(casa({ face, colgar: conAviso(3.6) }).stats.franja, null, 'con el aviso ancho no cabe');
    assert.equal(casa({ face, colgar: conBalcon }).stats.franja, null, 'con balcón de madera no va');
    assert.equal(casa({ face, ruin: true }).stats.franja, null, 'en ruina no va');
  }
});

test('alguna fachada lleva caja de aire bajo una ventana alta y alguna azotea antena en el antepecho, nunca en ruina', () => {
  let cajas = 0, antenas = 0;
  const veces = 240;
  for (let seed = 0; seed < veces; seed++) {
    const datos = casa({ seed: seed * 7919 + 13, floors: 4, face: [0, 1, 4, 5][seed % 4] });
    const lista = vanos(datos);
    if (datos.stats.caja) {
      cajas++;
      const [u, , y1] = datos.stats.caja;
      const vano = lista.find(v => Math.abs(v.u - u) < 1e-6 && v.bottom > 6 && Math.abs(v.bottom - VOLUMEN.caja.bajo + VOLUMEN.caja.alto / 2 - y1) < 1e-6);
      assert.ok(vano, 'colgada bajo una ventana del segundo piso para arriba');
      assert.ok(y1 < vano.bottom - VOLUMEN.alfeizar.bajo, 'sin tocar el alféizar');
    }
    if (datos.stats.antena) {
      antenas++;
      const techo = nuevos(datos).filter(p => p.techo);
      const [ancho, fondo] = [8, 6];
      assert.ok(techo.every(p => Math.abs(p.x) <= ancho / 2 + 1e-6 && Math.abs(p.z) <= fondo / 2 + 1e-6), 'dentro de la azotea');
      assert.ok(techo.every(p => p.y >= 12 - 1e-6 && p.y <= 12 + VOLUMEN.antena.mastil + 1e-6));
      const [x, z] = datos.stats.antena, s = datos.opciones.seed;
      assert.equal(Math.sign(x), s & 1 ? 1 : -1, 'lejos del tanque');
      assert.equal(Math.sign(z), (s >>> 1) & 1 ? 1 : -1, 'lejos del tanque');
    }
    const ruina = casa({ seed: seed * 7919 + 13, floors: 4, ruin: true });
    assert.equal(ruina.stats.caja, null);
    assert.equal(ruina.stats.antena, null);
  }
  assert.ok(cajas > veces / 6 * .55 && cajas < veces / 6 * 1.6, `${cajas} cajas de aire`);
  assert.ok(antenas > veces / 4 * .55 && antenas < veces / 4 * 1.6, `${antenas} antenas`);
});
