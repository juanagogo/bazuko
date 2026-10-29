import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Minimap } from '../src/ui/Minimap.js';
import * as THREE from 'three';

beforeEach(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, val) { store.set(key, String(val)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); }
  };
  globalThis.window = new EventTarget();
  globalThis.document = {
    getElementById(id) {
      if (id === 'minimap-container') return { classList: { toggle() {} } };
      if (id === 'minimap-canvas') return {
        width: 130, height: 130,
        getContext() {
          // Cualquier método del contexto 2D es un no-op; se registran las llamadas de dibujo.
          return new Proxy({ calls: [] }, {
            get(target, key) {
              if (key in target) return target[key];
              return (...args) => target.calls.push([key, args]);
            },
            set(target, key, value) { target[key] = value; return true; }
          });
        }
      };
      if (id === 'minimap-info') return { textContent: '' };
      return null;
    },
    createElement() {
      return { appendChild() {}, classList: { toggle() {} }, innerHTML: '' };
    },
    body: { appendChild() {} }
  };
});

test('Minimap alterna su visibilidad y persiste el estado', () => {
  const map = new Minimap();
  assert.equal(map.visible, true);

  const hidden = map.toggle();
  assert.equal(hidden, false);
  assert.equal(map.visible, false);
  assert.equal(localStorage.getItem('bazuko.minimap_visible'), 'false');

  const shown = map.toggle();
  assert.equal(shown, true);
  assert.equal(map.visible, true);
  assert.equal(localStorage.getItem('bazuko.minimap_visible'), 'true');
});

test('Minimap calcula y muestra el punto de interés más cercano', () => {
  const map = new Minimap();
  const player = { x: 30, z: 80 };
  const pois = [
    { name: 'Cambuche', icon: '⛺', x: 32, z: 88, color: '#ffd166' },
    { name: 'Recicladora', icon: '♻️', x: 88, z: 32, color: '#2ab7ca' }
  ];

  map.update(player, 0, pois, 1000);
  assert.match(map.infoEl.textContent, /Cambuche/);
  assert.match(map.infoEl.textContent, /⛺/);
});

test('el radar usa el frente real de la cámara tanto isométrica como de tercera persona', () => {
  const map = new Minimap(), camera = new THREE.PerspectiveCamera();
  let now = 1000;
  for (const [x, z] of [[0, 10], [10, 0], [12, 12], [-12, -12]]) {
    camera.position.set(x, 16, z); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements, yaw = Math.atan2(e[8], e[10]);
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const directions = [[forward, 'Al frente'], [right, 'Derecha'], [forward.clone().negate(), 'Atrás'], [right.clone().negate(), 'Izquierda']];
    for (const [direction, text] of directions) {
      map.update({ x: 0, z: 0 }, yaw, [{ name: 'Objetivo', icon: '⛺', x: direction.x * 10, z: direction.z * 10 }], now += 100);
      assert.ok(map.infoEl.textContent.includes(text), map.infoEl.textContent);
      assert.ok(map.infoEl.textContent.includes('10m'));
    }
  }
});

test('el zoom del radar se limita, se guarda y se amplía al correr', () => {
  const map = new Minimap();
  assert.equal(map.setZoomBase(10), 40);
  assert.equal(map.setZoomBase(500), 140);
  map.setZoomBase(80);
  assert.equal(localStorage.getItem('bazuko.minimap_zoom'), '80');
  assert.equal(new Minimap().zoomBase, 80);
  let now = 1000;
  for (let i = 0; i < 40; i++) map.update({ x: 0, z: 0 }, 0, [], now += 100, { running: true });
  assert.ok(map.range > 110, `alcance al correr: ${map.range}`);
  for (let i = 0; i < 40; i++) map.update({ x: 0, z: 0 }, 0, [], now += 100);
  assert.ok(Math.abs(map.range - 80) < 2);
});

test('con destino activo el radar muestra la distancia restante y el giro siguiente', () => {
  const map = new Minimap();
  const gps = {
    waypoint: { name: 'Recicladora', icon: '♻️', x: 0, z: -300 },
    route: [{ x: 0, z: 0 }, { x: 0, z: -300 }],
    remainingRoute: (p) => [{ x: p.x, z: p.z }, { x: 0, z: -300 }],
    remainingDistance: () => 1234,
    lookAhead: () => ({ x: 0, z: -12 })
  };
  // yaw 0: el frente de la cámara es −Z
  map.update({ x: 0, z: 0 }, 0, [{ name: 'Cambuche', icon: '⛺', x: 1, z: 1 }], 1000, { gps });
  assert.equal(map.infoEl.textContent, '♻️ Recicladora\n1.2km ∙ ↑ Al frente');
  map.update({ x: 0, z: 0 }, 0, [], 2000, { gps: { ...gps, route: [] } });
  assert.match(map.infoEl.textContent, /Sin ruta a pie/);
});

test('el tamaño del radar se limita a s, m o l, se guarda y se refleja en la columna', () => {
  const dock = { dataset: {} };
  const getById = document.getElementById;
  document.getElementById = (id) => id === 'hud-dock' ? dock : getById(id);
  const map = new Minimap();
  assert.equal(map.size, 'm');
  assert.equal(dock.dataset.radarSize, 'm');
  assert.equal(map.setSize('l'), 'l');
  assert.equal(dock.dataset.radarSize, 'l');
  assert.equal(localStorage.getItem('bazuko.minimap_size'), 'l');
  assert.equal(new Minimap().size, 'l');
  assert.equal(map.setSize('xl'), 'm');
});
