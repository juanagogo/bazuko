import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeVehicle } from '../src/world/bogota/vehicles.js';

// Tiradas de Math.random de cada vehículo de una fila fija de busetas, taxis, particulares y patrullas, contadas antes de
// que la buseta llevara pasajeros, claraboyas y cornetas y el taxi sus rótulos. Si un número cambia, el tráfico sembrado
// recibe otras tiradas y la ciudad sale distinta.
const TIRADAS = [244,244,236,196,92,272,40,240,96,56,96,224,72,116,92,68,92,92,68,96,92,56,92,96,36,92,96,36,92,92,36,92,92,36,96,280,36,92,92,196,92,92,36,92,92,56,92,96,36,92,92,40,92,92,36,96,92,36,92,92,36,92,92,40,92,92,40,96,92,36,92,96,36,92,92,60,92,92,36,96,92,36,96,92,36,92,92,56,92,92,36,92,92,36,92,92];

test('armar la flota gasta del azar del juego lo mismo que antes de los rótulos y las piezas nuevas del transporte público', () => {
  const random = Math.random, kinds = ['buseta', 'taxi', 'carro', 'carro', 'taxi', 'police', 'buseta', 'carro'], tiradas = [];
  let rolls = 0;
  Math.random = () => { rolls++; return random(); };
  try {
    for (let i = 0; i < TIRADAS.length; i++) {
      rolls = 0;
      makeVehicle(kinds[i % kinds.length], i * 37 + (i % 5), { parked: i % 3 === 0 }).dispose();
      tiradas.push(rolls);
    }
  } finally { Math.random = random; }
  assert.deepEqual(tiradas, TIRADAS);
});
