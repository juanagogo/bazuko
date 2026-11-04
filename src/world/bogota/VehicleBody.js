// src/world/bogota/VehicleBody.js
// Ensambla cada modelo: carrocería de rejilla, piezas proyectadas, interior, ruedas, espejos y limpiaparabrisas.
// El resultado se guarda por modelo y tipo: todos los carros iguales comparten los mismos buffers y solo sus
// materiales son propios. Ningún carro destruye lo compartido al desaparecer.
import * as THREE from 'three';
import { CarBody, ROW, lerp } from './carLoft.js';
import { Batch, COLOR, emitBody, box, bar, tube, addGeo, addGrid, addWheelWells, makeWheelGeometry } from './carParts.js';
import { CAR_MODELS, addKindParts, makeKit } from './carModels.js';

const bodies = new Map(), bases = new Map(), kinds = new Map();
const aoOf = (spec, body) => (x, y, r) => {
  // Polvo de la calle: los bajos pierden algo de brillo y tiran a tierra.
  const dust = Math.max(0, Math.min(1, (.62 - y) / .35));
  let shade = 1;
  // Delante y detrás de los arcos, la fila del pliegue es la costura del parachoques: oscurecerla dibuja la junta sin sumar triángulos.
  if (r === ROW.MID && body.lowLine) {
    const beyond = Math.max(x - spec.axleF, spec.axleR - x) - spec.archR * .78;
    shade = beyond > 0 ? .14 : 1;
  }
  return [(1 - dust * .12) * shade, (1 - dust * .13) * shade, (1 - dust * .16) * shade];
};

export function getCarBody(modelId) {
  let body = bodies.get(modelId);
  if (!body) bodies.set(modelId, body = new CarBody(CAR_MODELS[modelId]));
  return body;
}

function appendBatch(target, source) {
  const base = target.count;
  for (const key of ['P', 'N', 'U', 'C', 'L']) { const from = source[key], to = target[key]; for (let i = 0; i < from.length; i++) to.push(from[i]); }
  for (let i = 0; i < source.I.length; i++) target.I.push(source.I[i] + base);
  target.count += source.count;
}

const newBatches = () => ({
  paint: new Batch({ colorSize: 3 }), glass: new Batch({ color: false, uv: false, lamp: true }),
  trim: new Batch(), lamp: new Batch({ lamp: true }),
});

/**
 * Sombra de contacto bajo el carro, en el lote del vidrio para no sumar una llamada de dibujo. Sin ella, en calidad
 * baja (sin mapas de sombra) los carros parecen flotar. El canal `lamp` del vidrio vale 0; aquí, 1 más la opacidad.
 */
function addContactShadow(batch, { L, W }) {
  const N = 12, y = .04, ring = (a, b, shade) => {
    const first = batch.count;
    for (let i = 0; i < N; i++) {
      const t = (i + .5) / N * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
      batch.v(a * Math.sign(c) * Math.pow(Math.abs(c), .4), y, b * Math.sign(s) * Math.pow(Math.abs(s), .4), 0, 1, 0, 0, 0, 1, 1, 1, 0, shade);
    }
    return first;
  };
  const inner = ring(L / 2 - .32, W / 2 - .22, 1.72), outer = ring(L / 2 + .07, W / 2 + .08, 1);
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    batch.quad(inner + i, inner + j, outer + j, outer + i);
    if (i > 0 && i < N - 1) batch.tri(inner, inner + i + 1, inner + i);
  }
}

function buildBase(modelId) {
  const spec = CAR_MODELS[modelId], body = getCarBody(modelId), b = newBatches();
  addContactShadow(b.glass, spec);
  emitBody(body, body.classify(), b, aoOf(spec, body));
  addWheelWells(b.trim, body);
  const k = makeKit(body, b, spec);
  k.floorPlate();
  if (spec.interior) { k.liner(); k.interior(spec.interior); }
  spec.parts(k);
  const wheel = spec.wheel;
  const base = {
    spec, body, batches: b,
    paint: b.paint.toGeometry(`Carrocería ${modelId}`),
    glass: b.glass.toGeometry(`Vidrios ${modelId}`),
    wheelRight: makeWheelGeometry({ r: spec.r, ...wheel, outward: 1 }),
    wheelLeft: makeWheelGeometry({ r: spec.r, ...wheel, outward: -1 }),
    wiper: wiperGeometry(spec, body),
    mirror: mirrorGeometry(spec, body),
    mirrorAnchors: mirrorAnchors(spec, body),
    flares: flareGeometry(spec, body),
  };
  return base;
}

/** Geometrías del modelo; trim y lámparas llevan además los distintivos del tipo (taxi, patrulla). */
export function getCarGeometry(modelId, kind = 'carro') {
  let base = bases.get(modelId);
  if (!base) bases.set(modelId, base = buildBase(modelId));
  const distinct = kind === 'taxi' || kind === 'police';
  const key = `${modelId}:${distinct ? kind : 'base'}`;
  let entry = kinds.get(key);
  if (entry) return entry;
  let { trim, lamp } = base.batches;
  if (distinct) {
    const extra = newBatches();
    addKindParts(makeKit(base.body, extra, base.spec), kind);
    const merged = newBatches();
    appendBatch(merged.trim, trim); appendBatch(merged.trim, extra.trim);
    appendBatch(merged.lamp, lamp); appendBatch(merged.lamp, extra.lamp);
    trim = merged.trim; lamp = merged.lamp;
  }
  entry = { ...base, trimBatch: trim, trim: trim.toGeometry(`Molduras ${key}`), lamp: lamp.toGeometry(`Lámparas ${key}`) };
  kinds.set(key, entry);
  return entry;
}

/** Vuelca una geometría de molduras al lote con su transformación: es de un lote igual, así que trae color y UV. */
function appendGeometry(target, geometry, matrix) {
  const { position: p, normal: n, uv, color: c } = geometry.attributes, index = geometry.index, base = target.count;
  const P = new THREE.Vector3(), N = new THREE.Vector3(), normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  for (let i = 0; i < p.count; i++) {
    P.fromBufferAttribute(p, i).applyMatrix4(matrix); N.fromBufferAttribute(n, i).applyMatrix3(normalMatrix).normalize();
    target.v(P.x, P.y, P.z, N.x, N.y, N.z, uv.getX(i), uv.getY(i), c.getX(i), c.getY(i), c.getZ(i), c.getW(i));
  }
  for (let i = 0; i < index.count; i += 3) target.tri(base + index.getX(i), base + index.getX(i + 1), base + index.getX(i + 2));
}

/** Dónde va cada rueda: x del eje, centro en z y lado (−1 o +1). */
export function wheelSeats(spec, body) {
  const seat = (x, side) => [x, side * (body.hw(x) - spec.wheel.width / 2 - .012), side];
  return [seat(spec.axleF, -1), seat(spec.axleF, 1), seat(spec.axleR, -1), seat(spec.axleR, 1)];
}

/**
 * Molduras de un parqueado: nadie gira sus ruedas ni mueve sus plumillas, así que van en la misma malla y cuestan una sola llamada
 * en vez de siete. Se ladean con la carrocería (`parkCar` mueve el grupo que las contiene). Se arma la primera vez que hace falta.
 */
export function getParkedTrim(entry) {
  if (entry.parkedTrim) return entry.parkedTrim;
  const { spec, body } = entry, b = new Batch(), matrix = new THREE.Matrix4();
  appendBatch(b, entry.trimBatch);
  for (const [x, z, side] of wheelSeats(spec, body)) appendGeometry(b, side > 0 ? entry.wheelRight : entry.wheelLeft, matrix.makeTranslation(x, spec.r, z));
  for (const pivot of wiperPivots(spec, body)) {
    pivot.updateWorldMatrix(true, false);
    appendGeometry(b, entry.wiper, pivot.matrixWorld);
  }
  return entry.parkedTrim = b.toGeometry(`Molduras de parqueado ${spec.id}`);
}

// ===== Espejos =====

function mirrorAnchors(spec, body) {
  const { x, y, big } = spec.mirror, z = body.sideZ(x, Math.min(y, body.belt(x))) + (big ? .30 : .115);
  return [new THREE.Vector3(x, y, -z), new THREE.Vector3(x, y, z)];
}

/** Dos espejos en una sola malla: se roban y reaparecen juntos, y así solo cuestan una llamada de dibujo. */
function mirrorGeometry(spec, body) {
  const b = new Batch(), { x, y, big } = spec.mirror;
  const anchorZ = mirrorAnchors(spec, body)[1].z, baseZ = anchorZ - (big ? .30 : .115);
  const sx = big ? .055 : .058, sy = big ? .17 : .056, sz = big ? .085 : .095;
  const shell = new THREE.SphereGeometry(1, 7, 4);
  // Superelipse: carcasa de esquinas redondeadas, no una bola.
  const sp = shell.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const squash = v => Math.sign(v) * Math.pow(Math.abs(v), .62);
    // Plana por detrás, donde va la luna; por delante conserva la carcasa redondeada.
    sp.setXYZ(i, Math.max(squash(sp.getX(i)) * sx, -sx * .45), squash(sp.getY(i)) * sy, squash(sp.getZ(i)) * sz);
  }
  shell.computeVertexNormals();
  addGeo(b, shell, { position: [x + .006, y, anchorZ], color: COLOR.plastic, mirror: true });
  // Cara de espejo: mira hacia atrás del carro, un poco por fuera de la carcasa para que no la atraviese.
  const face = new THREE.PlaneGeometry(sz * 1.62, sy * 1.62);
  face.rotateY(-Math.PI / 2);
  addGeo(b, face, { position: [x + .006 - sx * .5, y, anchorZ], color: [.62, .68, .72], metal: 1, mirror: true });
  bar(b, [x + .01, big ? y + .15 : y - .05, anchorZ - sz * .55], [x + .02, big ? y + .05 : y - .065, baseZ], .03, big ? .03 : .022, { color: COLOR.plastic, mirror: true });
  if (big) bar(b, [x + .01, y - .15, anchorZ - sz * .55], [x + .02, y - .05, baseZ], .03, .03, { color: COLOR.plastic, mirror: true });
  return b.toGeometry(`Espejos ${spec.id}`);
}

// ===== Limpiaparabrisas =====

const WIPER_REST = -1.46, WIPER_SWEEP = 1.32, WIPER_PIVOTS = [.07, .86];

function wiperGeometry(spec, body) {
  const b = new Batch(), scale = wiperFit(spec, body).length / .72;
  box(b, [.014, .42 * scale, .010], [0, .21 * scale, .012], { color: COLOR.rubber });
  box(b, [.012, .56 * scale, .016], [0, .44 * scale, .016], { color: COLOR.rubber });
  return b.toGeometry(`Limpiaparabrisas ${spec.id}`);
}

/** Dónde nace la plumilla y cuánto mide: en reposo y al final del barrido debe quedarse sobre el vidrio. */
function wiperFit(spec, body) {
  const [x0, x1] = spec.windshield, rise = body.topY(x1, 0) + .06;
  let xb = x1 - .05;
  // 5 cm en X bastan en un parabrisas tendido; en uno casi vertical son media altura del vidrio. Allí se busca por altura.
  if (body.topY(xb, 0) > rise) {
    let a = xb, b = x1;
    for (let i = 0; i < 14; i++) { const m = (a + b) / 2; if (body.topY(m, 0) > rise) a = m; else b = m; }
    xb = b;
  }
  const nominal = .72 * 2 * body.edgeZ(x1) / 1.42 * (spec.wiper ? spec.wiper / 2 : 1);
  const glass = Math.hypot(x0 - xb, body.topY(x0, 0) - body.topY(xb, 0)), halfWidth = body.edgeZ(xb);
  // Topes: la punta no pasa del borde alto del vidrio al barrer, ni del pilar en reposo. El marco baja hacia los lados
  // y la plumilla flota unos centímetros sobre el vidrio curvo: con menos de 12 cm de margen la punta se ve por encima del marco.
  const length = Math.min(nominal, (glass - .12) / Math.cos(WIPER_REST + WIPER_SWEEP), ((1 + WIPER_PIVOTS[0]) * halfWidth - .03) / Math.sin(-WIPER_REST));
  return { xb, length, halfWidth, dirX: (x0 - xb) / glass };
}

/** El marco fijo alinea Z con la normal del vidrio; el hijo gira en Z sobre ese plano. Sin malla: el parqueado las lleva en sus molduras. */
function wiperPivots(spec, body) {
  const { xb, length, halfWidth, dirX } = wiperFit(spec, body), x0 = spec.windshield[0];
  const up = new THREE.Vector3(x0 - xb, body.topY(x0, 0) - body.topY(xb, 0), 0).normalize();
  return WIPER_PIVOTS.map(f => {
    const frame = new THREE.Group(); frame.name = 'Soporte de limpiaparabrisas';
    const z = halfWidth * f, origin = new THREE.Vector3(xb, body.topY(xb, z) + .004, z);
    // El vidrio es curvo y cada plumilla recorre una parte distinta. Su plano toca la chapa a tres cuartos del largo, en reposo y al
    // final del barrido: una plumilla recta sobre vidrio curvo reparte así lo poco que flota y lo poco que se hunde.
    const under = angle => {
      const reach = length * .75, x = xb + dirX * Math.cos(angle) * reach, zTip = z + Math.sin(angle) * reach;
      return new THREE.Vector3(x, body.topY(x, zTip), zTip).sub(origin);
    };
    const normal = under(WIPER_REST).cross(under(WIPER_REST + WIPER_SWEEP)).normalize();
    const along = up.clone().addScaledVector(normal, -up.dot(normal)).normalize();
    frame.position.copy(origin);
    frame.setRotationFromMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(along, normal), along, normal));
    const pivot = new THREE.Group(); pivot.name = 'Limpiaparabrisas';
    // En reposo quedan tumbados sobre la base del parabrisas, con la punta hacia el conductor.
    pivot.userData.restAngle = WIPER_REST; pivot.userData.sweepAngle = WIPER_SWEEP; pivot.rotation.z = pivot.userData.restAngle;
    frame.add(pivot);
    return pivot;
  });
}

export function makeWipers(spec, body, geometry, material) {
  return wiperPivots(spec, body).map(pivot => {
    const arm = new THREE.Mesh(geometry, material); arm.name = 'Brazo y plumilla'; arm.castShadow = false;
    pivot.add(arm);
    return pivot;
  });
}

// ===== Resplandores =====

/**
 * Cuatro cuadros en una malla: dos faros y dos stops. El sombreador los orienta a la cámara y apaga el que
 * no la mira; una sola llamada de dibujo en lugar de un sprite por lámpara.
 */
function flareGeometry(spec, body) {
  const { headFlare = [body.xNose - .02, spec.flareY ?? (body.shoulder(body.xNose - .1) + .02), body.halfW * .62], tailFlare = [body.xTail + .02, spec.tailFlareY ?? (body.shoulder(body.xTail + .1) + .1), body.halfW * .72] } = spec;
  const P = [], C = [], D = [], I = [];
  const add = ([x, y, z], dir, w, h) => {
    const base = P.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { P.push(x, y, z); C.push(cx * w, cy * h); D.push(dir); }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const s of [1, -1]) {
    add([headFlare[0], headFlare[1], headFlare[2] * s], 1, .46, .30);
    add([tailFlare[0], tailFlare[1], tailFlare[2] * s], -1, .26, .20);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('corner', new THREE.BufferAttribute(new Float32Array(C), 2));
  g.setAttribute('facing', new THREE.BufferAttribute(new Float32Array(D), 1));
  g.setIndex(I);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, spec.H * .5, 0), spec.L * .6);
  g.name = `Resplandores ${spec.id}`;
  return g;
}

let driverCache = null;
/**
 * Conductor sentado: tronco de una pieza que se angosta en los hombros, brazos hasta el volante, cabeza con mandíbula y pelo atrás.
 * Lo ven de cerca por el parabrisas, sin sombras en calidad baja: el color se oscurece hacia abajo, donde el techo y el tablero le quitan luz.
 */
export function getDriverGeometry(shirt, skin, hair = '#17110d') {
  driverCache ??= new Map();
  const key = `${shirt}:${skin}`;
  let g = driverCache.get(key);
  if (g) return g;
  const b = new Batch();
  const cs = new THREE.Color(shirt), ck = new THREE.Color(skin), ch = new THREE.Color(hair);
  const tone = ([r, g, c], k) => [r * k, g * k, c * k];
  const S = [cs.r, cs.g, cs.b], K = [ck.r, ck.g, ck.b], Hr = [ch.r, ch.g, ch.b];
  // La altura se mide desde la coronilla hacia abajo: el conductor se coloca con y = altura del modelo. X al frente.
  // Secciones del tronco, de la cadera al cuello: [y, centro en x, medio fondo, medio ancho]. Va recostado, con los hombros atrás.
  const trunk = [[-.86, .0, .115, .17], [-.72, -.02, .11, .17], [-.58, -.04, .115, .19], [-.49, -.05, .095, .195], [-.435, -.03, .06, .085]];
  addGrid(b, 4, trunk.length - 1, (i, j) => {
    const [y, cx, rx, rz] = trunk[j], a = Math.PI * i / 4;
    return [cx - Math.cos(a) * rx, y, Math.sin(a) * rz];
  }, { color: (u, v) => tone(S, lerp(.42, .86, v)), out: [0, 0, 1] });
  // Hombro, brazo con manga y antebrazo hasta el volante, que queda unos 40 cm al frente y 46 bajo la coronilla en toda la flota.
  const shoulder = new THREE.SphereGeometry(.058, 4, 2);
  addGeo(b, shoulder, { position: [-.05, -.5, .185], color: tone(S, .8), mirror: true });
  tube(b, [-.05, -.5, .19], [.1, -.66, .215], .048, 4, { color: tone(S, .62), mirror: true, open: true });
  tube(b, [.1, -.66, .215], [.33, -.5, .135], .036, 4, { color: tone(K, .68), mirror: true, open: true });
  const hand = new THREE.SphereGeometry(.04, 4, 2);
  hand.scale(1.25, .85, .85);
  addGeo(b, hand, { position: [.36, -.48, .125], color: tone(K, .78), mirror: true });
  tube(b, [-.02, -.45, 0], [-.005, -.37, 0], .044, 4, { color: tone(K, .62), open: true });
  // Cabeza: se angosta hacia la mandíbula, con la sombra de las cuencas sobre la mitad de adelante.
  const head = new THREE.SphereGeometry(1, 8, 5), hp = head.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const y = hp.getY(i), jaw = y < 0 ? 1 + y * .2 : 1;
    hp.setXYZ(i, hp.getX(i) * .098 * jaw, y * .116, hp.getZ(i) * .08 * jaw);
  }
  addGeo(b, head, { position: [.005, -.285, 0], color: (x, y) => tone(K, x > .03 && Math.abs(y + .27) < .03 ? .6 : y < -.33 ? .74 : .92) });
  // Pelo: casquete corrido hacia la nuca, que deja la frente y la cara libres.
  const cap = new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI * .56);
  // Se gira antes de escalar: así queda sobre el mismo elipsoide de la cabeza, un poco más grande, y esta nunca lo atraviesa.
  cap.rotateZ(.62); cap.scale(.105, .122, .087);
  addGeo(b, cap, { position: [.005, -.28, 0], color: Hr });
  g = b.toGeometry('Conductor');
  driverCache.set(key, g);
  return g;
}
