import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Minimap } from '../src/ui/Minimap.js';
import { pasarTexto } from '../src/ui/pictos.js';
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

test('sin destino el radar no pone flecha ni rumbo: el lugar más cercano es solo una referencia', () => {
  const map = new Minimap();
  const caja = () => ({ textContent: '' });
  map.flechaEl = caja(); map.nombreEl = caja(); map.metrosEl = caja();
  map.update({ x: 0, z: 0 }, 0, [{ name: 'Crafteo', icon: '🔨', x: 37, z: 0 }], 1000);
  assert.equal(map.flechaEl.textContent, '');
  assert.equal(map.nombreEl.textContent, 'Cerca: La mesa');
  assert.equal(map.metrosEl.textContent, '37 m');
  assert.doesNotMatch(map.infoEl.textContent, /[←→↑↓]|Derecha|Izquierda|Atrás|Al frente/);
});

test('Minimap calcula y muestra el punto de interés más cercano', () => {
  const map = new Minimap();
  const player = { x: 30, z: 80 };
  const pois = [
    { name: 'Cambuche', icon: '⛺', x: 32, z: 88, color: '#ffd166' },
    { name: 'Recicladora', icon: '♻️', x: 88, z: 32, color: '#2ab7ca' }
  ];

  map.update(player, 0, pois, 1000);
  assert.equal(map.infoEl.textContent, 'Cerca: Cambuche\n8 m', 'sin destino es una referencia: sin flecha ni rumbo');
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
      const target = { x: direction.x * 10, z: direction.z * 10 };
      const gps = { waypoint: { name: 'Objetivo', icon: '⛺', ...target }, route: [{ x: 0, z: 0 }, target], remainingRoute: () => [{ x: 0, z: 0 }, target], remainingDistance: () => 10, lookAhead: () => target };
      map.update({ x: 0, z: 0 }, yaw, [], now += 100, { gps });
      assert.ok(map.infoEl.textContent.includes(text), map.infoEl.textContent);
      assert.ok(map.infoEl.textContent.includes('10 m'));
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
  assert.equal(map.infoEl.textContent, '♻️ Recicladora\n1,2 km, ↑ Al frente');
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

const HERE = { x: 0, z: 0 };
const CHAZA = { name: 'Dulces y minutos', icon: '🍬', x: 6, z: 0, color: '#f78fb3', service: 'chaza', prices: { comida: 1200, agua: 2000, calor: 1200 } };
const FOGATA = { name: 'Fogata de caneca', icon: '🔥', x: -75, z: 0, color: '#ff6b35', service: 'fogata', prices: { calor: 0 } };
const COLD = { need: 'calor', money: 0, carriesRecyclables: false, carried: {} };
const arcs = (map) => map.ctx.calls.filter(([name]) => name === 'arc').length;
const painted = (map, text) => map.ctx.calls.some(([name, args]) => name === 'fillText' && args[0] === pasarTexto(text));

test('con frío y sin plata el radar nombra la fogata aunque haya una chaza más cerca; con plata, la chaza', () => {
  const map = new Minimap();
  map.update(HERE, 0, [CHAZA, FOGATA], 1000, { needs: COLD });
  assert.equal(map.infoEl.textContent, '🔥 Fogata de caneca\nCalor gratis, 75 m, ← Izquierda');
  map.update(HERE, 0, [CHAZA, FOGATA], 2000, { needs: { ...COLD, money: 1200 } });
  assert.equal(map.infoEl.textContent, '🍬 Dulces y minutos\nCalor $ 1.200, 6 m, → Derecha');
  map.update(HERE, 0, [CHAZA, FOGATA], 3000, { needs: { ...COLD, need: 'agua' } });
  assert.equal(map.infoEl.textContent, '💸 Sin plata para agua\nDesde $ 2.000, pida limosna (B)');
  map.update(HERE, 0, [CHAZA, FOGATA], 4000, { needs: { ...COLD, carried: { calor: 'Empanada con ají' } } });
  assert.equal(map.infoEl.textContent, '🎒 Llevo: Empanada con ají\nUsar desde el costal (I)');
  map.update({ x: -74, z: 0 }, 0, [CHAZA, FOGATA], 5000, { needs: COLD });
  assert.equal(map.infoEl.textContent, '🔥 Fogata de caneca\nCalor gratis, 1 m, 📍 Aquí');
  const stall = { ...CHAZA, offers: { agua: [{ price: 2000, weight: .5 }] } };
  map.update(HERE, 0, [stall], 6000, { needs: { ...COLD, need: 'agua', money: 5000, kg: 19.9, maxKg: 20 } });
  assert.equal(map.infoEl.textContent, '🎒 Sin espacio para agua\nTire algo del costal (I)');
});

test('con destino gana la ruta y sin necesidad se muestra el lugar más cercano, también si es un puesto', () => {
  const gps = {
    waypoint: { name: 'Recicladora', icon: '♻️', x: 0, z: -300 },
    route: [{ x: 0, z: 0 }, { x: 0, z: -300 }],
    remainingRoute: (p) => [{ x: p.x, z: p.z }, { x: 0, z: -300 }],
    remainingDistance: () => 1234,
    lookAhead: () => ({ x: 0, z: -12 })
  };
  const map = new Minimap();
  map.update(HERE, 0, [CHAZA, FOGATA], 1000, { gps, needs: COLD });
  assert.equal(map.infoEl.textContent, '♻️ Recicladora\n1,2 km, ↑ Al frente');
  assert.ok(!painted(map, FOGATA.icon), 'con destino no hay aro de sugerencia');
  map.update(HERE, 0, [CHAZA, FOGATA], 2000);
  assert.equal(map.infoEl.textContent, 'Cerca: Dulces y minutos\n6 m');
  map.update(HERE, 0, [CHAZA, FOGATA], 3000, { needs: { ...COLD, need: null } });
  assert.equal(map.infoEl.textContent, 'Cerca: Dulces y minutos\n6 m');
});

const trazos = (map) => map.ctx.calls.filter(([name]) => name === 'lineTo').length;

test('los lugares fijos siguen anclados', () => {
  const baseline = new Minimap();
  baseline.update(HERE, 0, [], 1000);
  const empty = trazos(baseline);
  const fixed = new Minimap();
  fixed.update(HERE, 0, [{ name: 'Recicladora', icon: '♻️', x: -300, z: 0, fijo: true }], 1000);
  assert.equal(trazos(fixed), empty + 1, 'los lugares fijos siguen anclados');
  const textos = (map) => map.ctx.calls.filter(([name]) => name === 'fillText').length;
  assert.equal(textos(fixed), textos(baseline), 'un trazo mínimo: no suma palabras ni signos');
  const [, [x, y]] = fixed.ctx.calls.filter(([name]) => name === 'lineTo').at(-1);
  assert.ok(Math.abs(x) <= fixed.canvas.width && Math.abs(y) <= fixed.canvas.height, `queda dentro: ${x}, ${y}`);
  const puesto = new Minimap();
  puesto.update(HERE, 0, [{ name: 'Una chaza', icon: '🍬', x: -300, z: 0 }], 1000);
  assert.equal(trazos(puesto), empty, 'un puesto cualquiera no se ancla');
  const cerca = new Minimap();
  cerca.update(HERE, 0, [{ name: 'Recicladora', icon: '♻️', x: 6, z: 0, fijo: true }], 1000);
  assert.equal(trazos(cerca), empty, 'cerca ya tiene su dibujo');
});

test('los puestos lejanos no se pintan; el lugar sugerido se ancla al borde con su aro', () => {
  const baseline = new Minimap();
  baseline.update(HERE, 0, [], 1000);
  const empty = arcs(baseline);
  const textos = (map) => map.ctx.calls.filter(([name]) => name === 'fillText').length;

  const far = new Minimap();
  far.update(HERE, 0, [{ ...FOGATA, x: 900 }], 1000);
  assert.equal(textos(far), textos(baseline), 'fuera de alcance no suma nada');

  const near = new Minimap();
  near.update(HERE, 0, [CHAZA], 1000);
  assert.equal(arcs(near), empty, 'un lugar cerca es un dibujo, sin aro');
  assert.ok(painted(near, CHAZA.icon));

  const suggested = new Minimap();
  suggested.update(HERE, 0, [FOGATA], 1000, { needs: COLD });
  assert.equal(arcs(suggested), empty + 1, 'el aro es solo del sugerido');
  assert.ok(painted(suggested, FOGATA.icon), 'el sugerido se ancla con su icono');
  // El aro queda dentro del lienzo aunque el lugar esté mucho más lejos que el alcance.
  const [, [, x, y]] = suggested.ctx.calls.find(([name, args]) => name === 'fillText' && args[0] === pasarTexto(FOGATA.icon));
  assert.ok(x > 0 && y > 0 && x < suggested.canvas.width && y < suggested.canvas.height, `${x}, ${y}`);
});

test('dos lugares que se pisan no se escriben los dos, y ninguno tapa la N', () => {
  const map = new Minimap();
  map.update(HERE, 0, [CHAZA, { ...CHAZA, name: 'Otra', icon: '🔥', x: CHAZA.x + .1 }], 1000);
  assert.equal(painted(map, CHAZA.icon) && painted(map, '🔥'), false);
});

test('el dibujo ya escrito conserva su sitio aunque el vecino quede más cerca', () => {
  const map = new Minimap();
  const a = { name: 'Una', icon: '🔨', x: 10, z: 0 }, b = { name: 'Otra', icon: '🔥', x: 12, z: 0 };
  map.update(new THREE.Vector3(0, 0, 0), 0, [a, b], 1000);
  assert.equal(painted(map, a.icon), true);
  assert.equal(painted(map, b.icon), false);
  map.ctx.calls.length = 0;
  map.update(new THREE.Vector3(30, 0, 0), 0, [a, b], 1100);
  assert.equal(painted(map, a.icon), true);
  assert.equal(painted(map, b.icon), false);
});

test('el lugar sugerido se dibuja encima de los demás', () => {
  const map = new Minimap();
  const crafteo = { name: 'Crafteo', icon: '🔨', x: -10, z: 0 };
  map.update(HERE, 0, [{ ...FOGATA, x: -10 }, crafteo], 1000, { needs: COLD });
  const texts = map.ctx.calls.filter(([name]) => name === 'fillText').map(([, [text]]) => text);
  assert.ok(texts.indexOf(pasarTexto('🔥')) > texts.indexOf(pasarTexto('🔨')), texts.join(' '));
});

test('si dos lugares están en el mismo punto, el radar nombra el fijo', () => {
  const map = new Minimap();
  map.update(HERE, 0, [{ ...FOGATA, x: 10 }, { name: 'Crafteo', icon: '🔨', x: 10, z: 0 }], 1000);
  assert.match(map.infoEl.textContent, /Crafteo/);
});

test('en tamaño Pequeño la dirección se reduce a la flecha', () => {
  const map = new Minimap();
  map.setSize('s');
  map.update(HERE, 0, [FOGATA], 1000, { needs: COLD });
  assert.equal(map.infoEl.textContent, '🔥 Fogata de caneca\nCalor gratis, 75 m, ←');
  map.update({ x: -74, z: 0 }, 0, [FOGATA], 2000, { needs: COLD });
  assert.equal(map.infoEl.textContent, '🔥 Fogata de caneca\nCalor gratis, 1 m, 📍');
});

test('la línea del radar se marca como necesidad solo mientras dura', () => {
  const map = new Minimap();
  const classes = {};
  map.infoEl.classList = { toggle(name, on) { classes[name] = on; } };
  map.update(HERE, 0, [FOGATA], 1000, { needs: COLD });
  assert.equal(classes['is-need'], true);
  assert.equal(classes['is-route'], false);
  map.update(HERE, 0, [FOGATA], 2000);
  assert.equal(classes['is-need'], false);
});

test('el radar oculto no calcula la sugerencia', () => {
  const map = new Minimap();
  map.visible = false;
  let read = false;
  map.update(HERE, 0, [FOGATA], 1000, { needs: { get need() { read = true; return 'calor'; } } });
  assert.equal(read, false);
});
