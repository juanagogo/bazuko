// Gente de mentira para las pruebas: un grupo con personajes falsos que cuentan sus actualizaciones.
import * as THREE from 'three';
import { PeoplePool } from '../src/systems/PeoplePool.js';

export async function fakePool(size = 60) {
  const pool = new PeoplePool(new THREE.Scene(), {
    size,
    factory: async () => {
      const character = { updates: 0, last: null, snaps: 0, update(dt, state) { this.updates++; this.last = state; }, snapPose() { this.snaps++; }, dispose() {} };
      return { character, group: new THREE.Group() };
    }
  });
  await Promise.all(pool.tasks().map(task => task()));
  return pool;
}
