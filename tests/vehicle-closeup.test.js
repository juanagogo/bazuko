// De cerca: el eje de la carrocería, los faros apagados, el conductor y lo que cuesta dibujar un parqueado.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';

globalThis.window ??= new EventTarget();
const { Car } = await import('../src/entities/Car.js');
const { CAR_MODEL_IDS, LAMP } = await import('../src/world/bogota/carModels.js');
const { getCarBody, getCarGeometry, getDriverGeometry } = await import('../src/world/bogota/VehicleBody.js');
const { ATLAS_HEIGHT, ATLAS_SIZE, RECT, dayHeadRect, drawHeadDay } = await import('../src/world/bogota/carAtlas.js');
const { OPTICS, drawOptic } = await import('../src/world/bogota/carLamps.js');
const { ROW } = await import('../src/world/bogota/carLoft.js');

const MODELS = [...CAR_MODEL_IDS, 'camionetaNegra'];
const FLEET = MODELS.flatMap(id => ['carro', 'taxi', 'police'].map(kind => [id, kind]));
const OLD_HEADS = [[RECT.headRect, 'rect'], [RECT.headRedondo, 'redondo'], [RECT.headFino, 'fino'], [RECT.headCuadrado, 'cuadrado']];

/** Mayor ángulo, en grados, entre las normales de las dos mitades a lo largo del eje: cada vértice contra su gemelo, el espejo que más se le parece. */
function axisSplit(geometry, pick = () => true) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, points = new Map();
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getZ(i)) > 1e-3 || !pick(i)) continue;
    const key = `${p.getX(i).toFixed(3)}|${p.getY(i).toFixed(3)}`;
    if (!points.has(key)) points.set(key, []);
    points.get(key).push(new THREE.Vector3().fromBufferAttribute(n, i));
  }
  let worst = 0;
  for (const list of points.values()) for (const a of list) {
    const mirrored = new THREE.Vector3(a.x, a.y, -a.z);
    const twin = list.reduce((best, b) => (b.dot(mirrored) > best.dot(mirrored) ? b : best));
    worst = Math.max(worst, THREE.MathUtils.radToDeg(a.angleTo(twin)));
  }
  return { worst, points: points.size };
}

test('las dos mitades de la chapa tienen la misma normal a lo largo de todo el eje', () => {
  for (const [id, kind] of FLEET) {
    const { worst, points } = axisSplit(getCarGeometry(id, kind).paint);
    assert.ok(points > 30, `${id}: solo ${points} puntos sobre el eje`);
    assert.ok(worst < .01, `${id}/${kind}: las mitades difieren ${worst.toFixed(2)}° en el eje`);
  }
});

test('las piezas en espejo empatan en el eje: parrillas y franjas no se parten', () => {
  for (const [id, kind] of FLEET) {
    const { trim } = getCarGeometry(id, kind), color = trim.attributes.color;
    const { worst } = axisSplit(trim, i => color.getW(i) >= 1.5);
    assert.ok(worst < .5, `${id}/${kind}: un parche difiere ${worst.toFixed(2)}° en el eje`);
  }
});

test('el cierre de nariz y cola no abre rendija, y los parches siguen ubicándose con la misma curva', () => {
  for (const id of MODELS) {
    const body = getCarBody(id), last = body.ns - 1, p = getCarGeometry(id).paint.attributes.position;
    for (const si of [0, last]) {
      assert.ok(body.closes(si), `${id}: la estación ${si} no cierra`);
      assert.ok(body.z(si, ROW.BU) > .001, `${id}: la curva en planta perdió el relieve del que dependen faros y parrillas`);
    }
    for (let i = 0; i < p.count; i++) {
      const z = Math.abs(p.getZ(i));
      assert.ok(z < 1e-5 || z > .0025, `${id}: vértice a ${z.toFixed(4)} m del eje`);
    }
  }
});

// ===== Faros apagados =====

const dayCells = () => [...Object.values(OPTICS).map(o => o.day).filter(Boolean), ...OLD_HEADS.map(([rect]) => dayHeadRect(rect))];
const overlaps = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
const inRect = ([x, y, w, h], u, v) => {
  const e = 1e-4;
  return u >= x / ATLAS_SIZE - e && u <= (x + w) / ATLAS_SIZE + e && v >= 1 - (y + h) / ATLAS_HEIGHT - e && v <= 1 - y / ATLAS_HEIGHT + e;
};

test('el dibujo de día de cada faro tiene su celda, sin pisar nada del atlas', () => {
  const cells = dayCells(), taken = [...Object.values(RECT).filter(r => Array.isArray(r) && r.length === 4), ...Object.values(OPTICS).map(o => o.rect)];
  assert.equal(cells.length, Object.values(OPTICS).filter(o => o.end === 'nose' && o.parts.some(p => p.lamp === 'HEAD')).length + OLD_HEADS.length);
  cells.forEach((cell, i) => {
    assert.ok(cell[0] + cell[2] <= ATLAS_SIZE && cell[1] + cell[3] <= ATLAS_HEIGHT, `celda ${cell} fuera del atlas`);
    for (const rect of taken) assert.ok(!overlaps(cell, rect), `celda ${cell} pisa ${rect}`);
    for (const other of cells.slice(i + 1)) assert.ok(!overlaps(cell, other), `celdas ${cell} y ${other} se pisan`);
  });
});

test('solo los faros bajan al dibujo de día; stops, placas y parrillas no', () => {
  const cells = dayCells();
  for (const [id, kind] of FLEET) {
    const { lamp } = getCarGeometry(id, kind), { uv, color, lamp: channel } = lamp.attributes;
    let heads = 0;
    for (let i = 0; i < uv.count; i++) {
      const drop = Math.max(color.getW(i) - 2, 0), isHead = Math.round(channel.getX(i)) === LAMP.HEAD;
      if (isHead) { heads++; assert.ok(drop > 0, `${id}/${kind}: un vértice de faro sin dibujo de día`); }
      if (drop > 0) assert.ok(cells.some(cell => inRect(cell, uv.getX(i), uv.getY(i) - drop)), `${id}/${kind}: V ${uv.getY(i) - drop} cae fuera de los dibujos de día`);
      if (channel.getX(i) >= 10 || channel.getX(i) === LAMP.TAIL) assert.equal(drop, 0, `${id}/${kind}: una placa o un stop baja al dibujo de día`);
    }
    assert.ok(heads > 0, `${id}/${kind}: sin faros`);
  }
});

const compiled = () => {
  const car = new Car(new THREE.Scene(), new THREE.Vector3(), 0, { traffic: true, model: 'citadino' });
  const material = car.vehicle.bodyVisual.children.find(mesh => mesh.name === 'Lámparas y placas').material;
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  return { car, shader };
};

test('apagado se ve el dibujo de día; con la noche, la lluvia, la neblina o su propia luz, el de siempre', () => {
  const { car, shader } = compiled();
  assert.match(shader.fragmentShader, /mix\(texture2D\(map, vMapUv\), texture2D\(map, vDayUv\), vDayGlass\)/);
  // La emisión sale del color difuso: encendido es el dibujo de siempre, igual que antes de tener dos.
  assert.match(shader.fragmentShader, /totalEmissiveRadiance = vLampGlow \* diffuseColor\.rgb/);
  const [, lo, hi] = /smoothstep\(([\d.]+), ([\d.]+), max\(vLampGlow\.r, uLamps\[1\]\.r\)\)/.exec(shader.vertexShader);
  const head = car.vehicle.headlightMaterial, signal = car.vehicle.signalMaterials.left;
  car.setNight(false, false);
  assert.ok(head.color.r < +lo && signal.color.r < +lo, 'de día, faros y direccionales quietas deben dejar el vidrio');
  car.setNight(false, true); assert.ok(head.color.r >= +hi, 'con lluvia encendido debe verse el dibujo de siempre');
  car.setNight(true, false); assert.ok(head.color.r >= +hi, 'de noche encendido debe verse el dibujo de siempre');
  car.setNight(false, false, true); assert.ok(head.color.r >= +hi, 'con neblina encendido debe verse el dibujo de siempre');
  car.setNight(false, false);
  car.animateDrive(0, false, { dt: 0, turnSignal: 'left' });
  signal.emissiveIntensity = 2.5; assert.ok(signal.color.r >= +hi, 'una direccional prendida debe verse como siempre');
  // Un parqueado no enciende nada, ni de noche: su faro sigue siendo vidrio.
  const parked = new Car(new THREE.Scene(), new THREE.Vector3(), 0, { model: 'citadino' });
  parked.setNight(true, false); assert.ok(parked.vehicle.headlightMaterial.color.r < +lo);
  parked.setNight(false, false, true); assert.ok(parked.vehicle.headlightMaterial.color.r < +lo);
});

/** Contexto 2D que solo graba: en Node no hay canvas, pero sí se puede leer qué se dibuja. */
function recorder() {
  const ops = [], state = {};
  const gradient = () => { const g = { stops: [], addColorStop: (t, c) => g.stops.push(c) }; return g; };
  const ctx = new Proxy(state, {
    get: (s, k) => (k === 'createLinearGradient' || k === 'createRadialGradient' ? gradient : k in s ? s[k] : (...args) => { ops.push([k, ...args]); return { width: 10 }; }),
    set: (s, k, v) => { s[k] = v; ops.push(['=' + k, v]); return true; },
  });
  return { ctx, ops };
}
const paints = ops => ops.filter(([k]) => k === '=fillStyle' || k === '=strokeStyle').flatMap(([, v]) => (v?.stops ? v.stops : [v]));
function rgba(color) {
  const hex = /^#([\da-f]{6})$/i.exec(color);
  if (hex) return [0, 2, 4].map(i => parseInt(hex[1].slice(i, i + 2), 16)).concat(1);
  const m = /rgba?\(([^)]+)\)/.exec(color);
  const [r, g, b, a = 1] = m[1].split(',').map(Number);
  return [r, g, b, a];
}
const light = ([r, g, b]) => (.2126 * r + .7152 * g + .0722 * b) / 255;
const isGlint = ([r, g, b, a]) => r === 255 && g === 255 && b === 255 && a > .75;

test('un faro moderno apagado es una cavidad oscura sin facetas, con un brillo definido', () => {
  const drawn = Object.values(OPTICS).filter(o => o.day);
  assert.equal(drawn.length, 7);
  for (const o of drawn) {
    const night = recorder(), day = recorder();
    drawOptic(night.ctx, o); drawOptic(day.ctx, o, true);
    const strips = ({ ops }) => ops.filter(([k]) => k === 'fillRect').length;
    assert.ok(strips(day) < strips(night) * .5, `${o.name}: ${strips(day)} tiras de día contra ${strips(night)} de noche; las facetas se leen como cuadrícula`);
    const colors = paints(day.ops).map(rgba);
    assert.ok(colors.some(isGlint), `${o.name}: sin brillo definido`);
    assert.ok(light(colors[0]) < .25, `${o.name}: la carcasa no es oscura`);
    // Claro y sin color; la tira ámbar de la direccional sí puede serlo.
    const pale = colors.filter(c => c[3] > .5 && !isGlint(c) && light(c) > .7 && c[0] - c[2] < 40);
    assert.deepEqual(pale, [], `${o.name}: queda algo claro, como una placa`);
  }
});

test('solo los faros viejos llevan cuadrícula de día, y apenas se nota', () => {
  const grid = style => {
    const { ctx, ops } = recorder();
    drawHeadDay(ctx, [0, 0, 256, 128], style);
    return { colors: paints(ops).map(rgba), lines: ops.filter(([k, v]) => k === '=strokeStyle' && rgba(v)[3] < .2).length };
  };
  // sedanNoventero y cajaSetentera
  for (const style of ['rect', 'redondo']) {
    const { colors, lines } = grid(style);
    assert.ok(lines > 0, `${style}: sin cuadrícula`);
    assert.ok(colors.some(isGlint), `${style}: sin brillo definido`);
  }
  for (const style of ['fino', 'cuadrado']) assert.equal(grid(style).lines, 0, `${style}: no debería llevar cuadrícula`);
});

// ===== Conductor =====

const slice = (geometry, y0, y1) => {
  const p = geometry.attributes.position, c = geometry.attributes.color, res = { width: 0, light: [] };
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < y0 || y > y1) continue;
    res.width = Math.max(res.width, Math.abs(p.getZ(i)));
    res.light.push(.2126 * c.getX(i) + .7152 * c.getY(i) + .0722 * c.getZ(i));
  }
  res.mean = res.light.reduce((a, b) => a + b, 0) / res.light.length;
  return res;
};

test('el conductor tiene cuello y hombros, y la ropa se oscurece hacia abajo', () => {
  const geometry = getDriverGeometry('#2b4a8a', '#c68a5e');
  const shoulders = slice(geometry, -.6, -.47), neck = slice(geometry, -.42, -.36), head = slice(geometry, -.3, -.26);
  assert.ok(neck.width < head.width * .7, `cuello de ${neck.width.toFixed(3)} con cabeza de ${head.width.toFixed(3)}`);
  assert.ok(shoulders.width > head.width * 2, `hombros de ${shoulders.width.toFixed(3)} con cabeza de ${head.width.toFixed(3)}`);
  assert.ok(slice(geometry, -.9, -.84).mean < slice(geometry, -.6, -.47).mean * .75, 'la ropa debe caer en sombra hacia las piernas');
});

test('el conductor usa el material compartido, sin luces ni materiales por carro', () => {
  const [a, b] = [1, 2].map(() => new Car(new THREE.Scene(), new THREE.Vector3(), 0, { traffic: true, model: 'cajaSetentera' }));
  const figure = car => car.driver.children[0];
  assert.equal(figure(a).material, a.vehicle.trimMaterial);
  assert.equal(figure(a).material, figure(b).material);
  a.group.traverse(o => assert.ok(!o.isLight, `${o.name} es una luz`));
});

// ===== Llamadas de un parqueado =====

const meshes = car => { const list = []; car.group.traverseVisible(o => { if (o.isMesh) list.push(o); }); return list; };
const triangles = geometry => (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
const pose = () => [new THREE.Scene(), new THREE.Vector3(3, 0, -4), .6];
const pair = model => [new Car(...pose(), { model, kind: 'carro' }), new Car(...pose(), { model, kind: 'carro', traffic: true })];
const trimOf = car => car.vehicle.bodyVisual.children.find(mesh => mesh.name === 'Molduras e interior');

test('un parqueado se dibuja con cinco mallas; el que circula conserva sus piezas sueltas', () => {
  for (const model of CAR_MODEL_IDS) {
    const [parked, traffic] = pair(model);
    assert.equal(meshes(parked).length, 5, `${model} parqueado`);
    assert.equal(new Set(meshes(parked).map(mesh => mesh.material)).size, 4, `${model}: esmalte, molduras, lámparas y vidrio`);
    assert.equal(meshes(traffic).length, 12, `${model} en circulación`);
    assert.equal(traffic.vehicle.wheels.length, 4);
    assert.equal(traffic.vehicle.frontWheelPivots.length, 2);
    assert.equal(traffic.vehicle.wipers.length, 2);
    const loose = meshes(traffic).filter(mesh => mesh.material === traffic.vehicle.trimMaterial && mesh !== traffic.driver.children[0] && mesh !== traffic._mirrorMesh);
    assert.equal(triangles(trimOf(parked).geometry), loose.reduce((sum, mesh) => sum + triangles(mesh.geometry), 0), `${model}: la malla unida debe traer lo mismo que las piezas sueltas`);
  }
});

test('ruedas y plumillas quedan unidas justo donde las pone el tráfico', () => {
  for (const model of CAR_MODEL_IDS) {
    const [parked, traffic] = pair(model);
    parked.group.updateMatrixWorld(true); traffic.group.updateMatrixWorld(true);
    const trim = trimOf(parked), p = trim.geometry.attributes.position, world = new Float32Array(p.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) v.fromBufferAttribute(p, i).applyMatrix4(trim.matrixWorld).toArray(world, i * 3);
    for (const piece of [...traffic.vehicle.wheels, ...traffic.vehicle.wipers.map(pivot => pivot.children[0])]) {
      const q = piece.geometry.attributes.position;
      for (let i = 0; i < q.count; i += 7) {
        v.fromBufferAttribute(q, i).applyMatrix4(piece.matrixWorld);
        let best = Infinity;
        for (let k = 0; k < world.length && best > 1e-3; k += 3) best = Math.min(best, Math.hypot(world[k] - v.x, world[k + 1] - v.y, world[k + 2] - v.z));
        assert.ok(best <= 1e-3, `${model}: ${piece.name} no está en la malla unida (${best.toFixed(3)} m)`);
      }
    }
  }
});

test('un parqueado sigue perdiendo los espejos, no enciende de noche y comparte su malla unida', () => {
  const [a, b] = [1, 2].map(() => pair('sedanPopular')[0]);
  assert.equal(trimOf(a).geometry, trimOf(b).geometry);
  assert.equal(a.vehicle.wheels.length, 0);
  a.setNight(true, true);
  assert.equal(a.vehicle.headlightMaterial.emissiveIntensity, .02);
  a.setNight(false, false);
  a.animateDrive(1, false, { dt: .016, speed: 1 });
  a.setDriverInside(false);
  assert.ok(a.steal());
  assert.ok(a.mirrors.every(mirror => !mirror.visible));
  const door = a.driverDoor();
  assert.ok(door.distanceTo(a.position) > a.width / 2);
  let disposed = 0;
  trimOf(b).geometry.addEventListener('dispose', () => disposed++);
  a.dispose();
  assert.equal(disposed, 0, 'la malla unida es de todos los parqueados de ese modelo');
});
