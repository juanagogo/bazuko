import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  sitpBusStop,
  bolardoBogotano,
  canecaDistrital,
  carritoTinto,
  cabinaTelefonica,
  kioscoRevistas
} from '../src/world/bogota/props.js';

test('sitpBusStop: paradero zonal del SITP con columnas, cubierta, banca y tótem informativo', () => {
  const stop = sitpBusStop({ title: 'PARADERO KR 10 - CL 13', code: '045A00', routes: ['T12', 'C15', '544A'] });
  assert.ok(stop.isGroup);
  assert.ok(stop.children.length >= 6);

  const meshes = [];
  stop.traverse(c => { if (c.isMesh) meshes.push(c); });
  assert.ok(meshes.length >= 8);
  assert.ok(meshes.every(m => m.castShadow && m.receiveShadow));
});

test('bolardoBogotano: bolardo cilíndrico de andén con base, fuste, franja reflectiva y remate', () => {
  const bolardo = bolardoBogotano();
  assert.ok(bolardo.isGroup);

  const meshes = [];
  bolardo.traverse(c => { if (c.isMesh) meshes.push(c); });
  assert.equal(meshes.length, 4); // base, fuste, anillo reflectivo, casquete esférico
  assert.ok(meshes.every(m => m.castShadow && m.receiveShadow));
});

test('canecaDistrital: papelera pública tubular de acero con poste y visera de lluvia', () => {
  const caneca = canecaDistrital();
  assert.ok(caneca.isGroup);

  const meshes = [];
  caneca.traverse(c => { if (c.isMesh) meshes.push(c); });
  assert.equal(meshes.length, 5); // poste, brazo, tambor, interior, visera
  assert.ok(meshes.every(m => m.castShadow && m.receiveShadow));
});

test('carritoTinto: carrito ambulante de café con ruedas, termos, vitrina de empanadas y sombrilla', () => {
  const cart = carritoTinto();
  assert.ok(cart.isGroup);

  const meshes = [];
  cart.traverse(c => { if (c.isMesh) meshes.push(c); });
  assert.ok(meshes.length >= 18); // mesa, ruedas, patas, manillar, termos, vitrina, pasteles, vasos, sombrilla
  assert.ok(meshes.every(m => m.castShadow && m.receiveShadow));
});

test('cabinaTelefonica: teléfono público con pedestal, capota acústica y consola', () => {
  const cabina = cabinaTelefonica();
  assert.ok(cabina.isGroup);

  const meshes = [];
  cabina.traverse(c => { if (c.isMesh) meshes.push(c); });
  assert.equal(meshes.length, 5); // poste, cúpula, consola, teclado, auricular
  assert.ok(meshes.every(m => m.castShadow && m.receiveShadow));
});

test('kioscoRevistas: caseta urbana de periódicos con mostrador, techo, revistas y letrero', () => {
  const kiosco = kioscoRevistas();
  assert.ok(kiosco.isGroup);

  const meshes = [];
  kiosco.traverse(c => { if (c.isMesh) meshes.push(c); });
  assert.ok(meshes.length >= 12); // cabina, mostrador, techo, revistas, letrero
  assert.ok(meshes.every(m => m.castShadow && m.receiveShadow));
});
