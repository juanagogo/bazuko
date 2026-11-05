// TrafficSignals.blocks descarta primero los cruces lejos del punto: es lo más selectivo y lo
// que más se repite (cada carro, cada medio metro de su frenado). Esta prueba compara la versión
// actual con la anterior, que revisaba primero reservas y acceso, en miles de casos al azar.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { TrafficSignals, signalState } from '../src/world/bogota/TrafficSignals.js';

function previousBlocks(signals, point, direction, current, length = 0, vehicle = null) {
  const axis = Math.abs(direction.x) >= Math.abs(direction.z) ? 0 : 1;
  const red = signalState(signals.time, axis) !== 0;
  if (!red && !vehicle) return false;
  for (const node of signals.nodes) {
    const claim = signals.reservations.get(node);
    if (vehicle && claim?.owners.get(vehicle)?.entered) continue;
    if (current.x >= node.x0 && current.x <= node.x1 && current.z >= node.z0 && current.z <= node.z1) continue;
    const approaching = axis === 0
      ? (direction.x > 0 ? current.x < node.x0 : current.x > node.x1)
      : (direction.z > 0 ? current.z < node.z0 : current.z > node.z1);
    if (!approaching) continue;
    const padX = axis === 0 ? length / 2 + .8 : 0;
    const padZ = axis === 1 ? length / 2 + .8 : 0;
    if (point.x >= node.x0 - padX && point.x <= node.x1 + padX && point.z >= node.z0 - padZ && point.z <= node.z1 + padZ) {
      if (red || (vehicle && claim && !claim.owners.has(vehicle))) return true;
    }
  }
  return false;
}

test('blocks responde igual que antes con luces, reservas y carros al azar', () => {
  const signals = new TrafficSignals();
  let seed = 4242;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const vehicles = [{}, {}, {}];
  // Reservas variadas: dueño dentro, dueño por entrar y cruces reservados por otro.
  signals.nodes.forEach((node, i) => {
    if (i % 3 === 2) return;
    const owners = new Map([[vehicles[i % 3], { entered: i % 2 === 0 }]]);
    signals.reservations.set(node, { owners });
  });
  const bounds = signals.nodes.reduce((b, n) => ({ x0: Math.min(b.x0, n.x0), x1: Math.max(b.x1, n.x1), z0: Math.min(b.z0, n.z0), z1: Math.max(b.z1, n.z1) }),
    { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  const at = () => new THREE.Vector3(bounds.x0 - 10 + random() * (bounds.x1 - bounds.x0 + 20), 0, bounds.z0 - 10 + random() * (bounds.z1 - bounds.z0 + 20));
  let blocked = 0;
  for (let i = 0; i < 20000; i++) {
    signals.time = random() * 120;
    const current = at();
    // Puntos cerca del carro, como los de su sonda de frenado.
    const point = current.clone().add(new THREE.Vector3((random() - .5) * 30, 0, (random() - .5) * 30));
    const angle = random() * Math.PI * 2, direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const length = random() < .5 ? 0 : 3 + random() * 10;
    const vehicle = random() < .3 ? null : vehicles[Math.floor(random() * vehicles.length)];
    const expected = previousBlocks(signals, point, direction, current, length, vehicle);
    assert.equal(signals.blocks(point, direction, current, length, vehicle), expected, `caso ${i}`);
    if (expected) blocked++;
  }
  assert.ok(blocked > 200, `la prueba cubre casos bloqueados (${blocked})`);
});
