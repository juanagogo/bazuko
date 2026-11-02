// src/world/bogota/carModels.js
// La flota: cada modelo es un juego de curvas y piezas. Los identificadores describen el tipo de carro;
// ningún nombre, logo ni emblema de marca: lo que se reconoce es la silueta y las proporciones.
// Coordenadas en metros desde el centro de la huella: X hacia el frente, Y arriba.
import * as THREE from 'three';
import { lerp } from './carLoft.js';
import { BUS_BLUE, RECT, rectUv, dayDrop, dayHeadRect } from './carAtlas.js';
import { COLOR, PATCH_FLAG, patchAround, patchOutline, patchSide, patchTop, seamLine, box, bar, tube, addGrid } from './carParts.js';
import { OPTICS } from './carLamps.js';

// Canales de lámpara del material de luces.
// PLATE (10) desplaza la UV a la celda de placa del carro; ROUTE (27) al tablero de su ruta y se enciende como SIGN.
export const LAMP = Object.freeze({ OFF: 0, HEAD: 1, TAIL: 2, LEFT: 3, RIGHT: 4, BLUE: 5, RED: 6, SIGN: 7, PLATE: 10, ROUTE: 27 });
const signal = side => side < 0 ? LAMP.LEFT : LAMP.RIGHT;

/** Ayudas para que cada modelo describa sus piezas en pocas líneas. */
export function makeKit(body, b, spec, kind) {
  const nose = (o) => patchAround(b.trim, body, 'nose', o);
  const tail = (o) => patchAround(b.trim, body, 'tail', o);
  return {
    body, b, spec, kind,
    // En las lámparas el alfa del color no marca metal: lleva cuánto baja la V hasta el dibujo de día del faro (vehicles.js).
    head: o => patchAround(b.lamp, body, 'nose', { rect: RECT.headAncho, lamp: LAMP.HEAD, bulge: .006, off: .004, color: [1, 1, 1], metal: dayDrop(o.rect, dayHeadRect(o.rect)), ...o }),
    frontTurn: o => patchAround(b.lamp, body, 'nose', { rect: RECT.amber, lamp: signal, off: .006, rows: 1, color: [1, 1, 1], ...o }),
    fog: o => patchAround(b.lamp, body, 'nose', { rect: RECT.fog, lamp: LAMP.OFF, off: .006, rows: 1, color: [1, 1, 1], ...o }),
    stop: o => patchAround(b.lamp, body, 'tail', { rect: RECT.tailRojo, lamp: LAMP.TAIL, bulge: .004, off: .004, color: [1, 1, 1], ...o }),
    rearTurn: o => patchAround(b.lamp, body, 'tail', { rect: RECT.amber, lamp: signal, off: .006, rows: 1, color: [1, 1, 1], ...o }),
    reverse: o => patchAround(b.lamp, body, 'tail', { rect: RECT.white2, lamp: LAMP.OFF, off: .006, rows: 1, color: [1, 1, 1], ...o }),
    nose, tail,
    /** Óptica o parrilla de carLamps.js: una malla por parte, todas con el mismo dibujo del atlas. */
    optic(name, { rows = 2, off = null } = {}) {
      const o = OPTICS[name];
      for (const part of o.parts) {
        const lamp = part.lamp === 'signal' ? signal : LAMP[part.lamp];
        patchOutline(o.trim ? b.trim : b.lamp, body, o.end, {
          outline: part.outline, box: o.box, rect: o.rect, rows, off: off ?? o.off ?? (o.trim ? .004 : .005), bulge: o.bulge ?? 0,
          lamp, color: [1, 1, 1], metal: o.trim ? (o.metal ?? 0) : dayDrop(o.rect, o.day),
        });
      }
      // El resplandor nocturno nace donde está la lámpara que se ve, no en una altura genérica.
      if (o.flare) {
        const part = o.parts[0].outline, ma = part.reduce((sum, p) => sum + p[0], 0) / part.length, my = part.reduce((sum, p) => sum + p[1], 0) / part.length;
        const [x, y, z] = body.around(o.end, ma, my, .03);
        if (o.end === 'nose') spec.headFlare = [x, y, z]; else spec.tailFlare = [x, y, z];
      }
    },
    /** Lámina con contorno libre: plástico negro, protector plateado o chapa del color del carro. */
    panel(end, outline, { color = COLOR.plastic, metal = 0, off = .006, rows = 1, bulge = 0 } = {}) {
      patchOutline(b.trim, body, end, { outline, color, metal, off, rows, bulge });
    },
    /** Junta fina entre piezas de la nariz o la cola. */
    seam(end, pts, width = .005) { seamLine(b.trim, body, end, pts, { width }); },
    /** Filete cromado sobre la chapa. */
    chrome(end, pts, width = .014, off = .007) { seamLine(b.trim, body, end, pts, { width, off, color: COLOR.chrome, metal: 1 }); },
    /** Bocel lateral entre los arcos. */
    bocel(x0, x1, y, h = .04, color = COLOR.plastic) {
      patchSide(b.trim, body, { x0, x1, bot: y, top: y + h, off: .009, cols: 6, rows: 1, color });
    },
    /** Catadióptrico rojo del parachoques: de noche solo refleja, no enciende. */
    reflex(a0, a1, y0, y1) {
      patchOutline(b.lamp, body, 'tail', { outline: [[a0, y0], [a0, y1], [a1, y1], [a1, y0]], rect: RECT.tailRojo, rows: 1, off: .006, lamp: LAMP.OFF, color: [1, 1, 1] });
    },
    /** Limpiabrisas de la luneta: brazo corto en reposo sobre el vidrio. */
    rearWiper() {
      const [x0, x1] = spec.backlight, xa = lerp(x0, x1, .12), xb = lerp(x0, x1, .3), base = [xa, body.topY(xa, 0) + .012, 0];
      bar(b.trim, base, [xb, body.topY(xb, .3) + .012, .3], .016, .012, { color: COLOR.rubber });
      bar(b.trim, [xb, body.topY(xb, .34) + .014, .34], [lerp(x0, x1, .18), body.topY(lerp(x0, x1, .18), -.12) + .014, -.12], .018, .012, { color: COLOR.rubber });
    },
    /** Hueco de la placa: lámina oscura algo más grande que la placa, con su sombra. */
    platePocket(end, y, h, w) {
      const a = w / 2 + .05, y0 = y - .035, y1 = y + h + .035;
      patchOutline(b.trim, body, end, { outline: [[0, y0], [0, y1], [a, y1], [a + .02, y1 - .02], [a + .02, y0 + .02], [a, y0]], color: COLOR.pocket, off: .003, rows: 1 });
    },
    grille: o => nose({ rect: RECT.grilleLamas, color: [1, 1, 1], rows: 1, off: .004, ...o }),
    plateFront: (y, h = .17, w = .34, off = .012) => flatPlate(body, b, 'nose', y, h, w, off),
    plateRear: (y, h = .17, w = .34, off = .012) => flatPlate(body, b, 'tail', y, h, w, off),
    handle(x, y, color = 'paint', len = .16) {
      // Manija en relieve: arriba toma la luz y abajo queda en sombra. Bajo ella, el cuenco oscuro donde entran los dedos.
      const target = color === 'paint' ? b.paint : b.trim;
      const top = color === 'paint' ? [1, 1, 1] : color === 'chrome' ? COLOR.chrome : COLOR.trim;
      const under = color === 'paint' ? [.5, .5, .5] : color === 'chrome' ? [.42, .44, .46] : COLOR.dark;
      const metal = color === 'chrome' ? 1 : 0;
      (body.cups ??= []).push([x, y - .004]);
      patchSide(b.trim, body, { x0: x - len * .42, x1: x + len * .42, bot: y - .034, top: y - .006, off: .0035, cols: 3, rows: 1, color: COLOR.pocket });
      const fn = (i, j) => {
        const px = x + (i - 2) / 2 * len / 2, py = y + (j - 1) * .017;
        const end = i === 0 || i === 4, o = end ? .003 : j === 1 ? .024 : .016;
        return [px, py, body.sideZ(px, py) + o];
      };
      addGrid(target, 4, 2, fn, { color: (u, v) => v > .4 ? top : under, metal, out: [0, 0, 1], uv: target === b.paint ? () => [.0005, .0005] : null });
    },
    repeater(x, y) {
      patchSide(b.lamp, body, { x0: x - .04, x1: x + .04, bot: y - .012, top: y + .012, rect: RECT.amber, lamp: signal, off: .004, cols: 1, rows: 1, color: [1, 1, 1] });
    },
    skirt(x0, x1, h, color = COLOR.plastic, off = .006) {
      // Termina justo en los arcos: entre columnas tan separadas, seguir el labio del arco dejaría cuñas de chapa debajo.
      x0 = Math.max(x0, spec.axleR + spec.archR + .004); x1 = Math.min(x1, spec.axleF - spec.archR - .004);
      const bot = x => body.yBottom(x) + .004;
      patchSide(b.trim, body, { x0, x1, bot, top: x => body.bottom0(x) + h, cols: 7, rows: 1, off, color });
    },
    /** Moldura de arco en plástico negro: anillo proyectado sobre la chapa, no celdas dentadas. */
    archTrim(width = .07, color = COLOR.plastic, off = .012) {
      const { axleF, axleR, archR, archY } = spec;
      for (const ax of [axleF, axleR]) {
        addGrid(b.trim, 10, 1, (i, j) => {
          const a = Math.PI * (1 - i / 10), inner = archR - .004, outer = archR + width;
          const r = j === 0 ? inner : outer;
          const x = ax + r * Math.cos(a), y = archY + r * Math.sin(a);
          const o = j === 1 ? .001 : off;
          return [x, y, body.sideZ(x, Math.max(y, body.bottom0(x) + .02)) + o];
        }, { color, out: [0, 0, 1], metal: PATCH_FLAG });
      }
    },
    /** Interior sencillo: tablero, asientos y volante, visibles tras el vidrio ahumado. */
    interior({ dash, seat, rear = null, floor = .42, belt, hw, height = .5, wheelZ = .37 }) {
      const dark = COLOR.dash, cloth = COLOR.seat;
      box(b.trim, [.34, .14, hw * 1.86], [dash, belt - .06, 0], { color: dark });
      box(b.trim, [.20, .24, hw * 1.7], [dash + .08, belt - .22, 0], { color: dark });
      for (const z of [-wheelZ, wheelZ]) {
        box(b.trim, [.46, .12, .46], [seat - .02, floor + .10, z], { color: cloth });
        bar(b.trim, [seat - .22, floor + .12, z], [seat - .31, floor + height + .10, z], .10, .44, { color: cloth });
        box(b.trim, [.09, .16, .24], [seat - .33, floor + height + .23, z], { color: cloth });
      }
      if (rear !== null) {
        box(b.trim, [.46, .12, hw * 1.6], [rear, floor + .08, 0], { color: cloth });
        bar(b.trim, [rear - .22, floor + .10, 0], [rear - .28, floor + height + .02, 0], .10, hw * 1.6, { color: cloth });
      }
      // Volante: anillo inclinado hacia el conductor, al lado izquierdo (−Z).
      const wheel = new THREE.TorusGeometry(.15, .016, 3, 9);
      wheel.rotateY(Math.PI / 2); wheel.rotateZ(.42);
      wheel.translate(dash - .24, belt - .02, -wheelZ);
      addTorus(b.trim, wheel, COLOR.rubber);
      box(b.trim, [.04, .04, .24], [dash - .24, belt - .02, -wheelZ], { color: COLOR.rubber });
      bar(b.trim, [dash - .24, belt - .02, -wheelZ], [dash - .06, belt - .12, -wheelZ], .05, .05, { color: COLOR.rubber });
    },
    /** Forro del habitáculo: sin él, por el vidrio se vería el cielo a través de la chapa, que solo pinta su cara externa. */
    liner() {
      const it = spec.interior, x1 = it.front ?? spec.windshield[1] - .03, x0 = it.back ?? (spec.backlight ? spec.backlight[0] + .05 : spec.axleR);
      const floor = it.floor - .08;
      addGrid(b.trim, 7, 1, (i, j) => {
        const x = lerp(x0, x1, i / 7), y = j ? body.belt(x) - .01 : floor;
        return [x, y, Math.max(.2, body.sideZ(x, y) - .03)];
      }, { color: COLOR.dash, out: [0, 0, -1] });
      addGrid(b.trim, 5, 3, (i, j) => {
        const x = lerp(x0, x1, i / 5), z = lerp(-1, 1, j / 3) * body.edgeZ(x);
        return [x, Math.max(body.topY(x, z) - .04, body.belt(x)), z];
      }, { color: COLOR.headliner, mirror: false, out: [0, -1, 0] });
      for (const [x, s] of [[x0, 1], [x1, -1]]) {
        const yt = Math.max(body.topY(x, 0) - .03, body.belt(x));
        addGrid(b.trim, 2, 1, (i, j) => [x, j ? yt : floor, lerp(-1, 1, i / 2) * body.hw(x) * .93], { color: COLOR.dash, mirror: false, out: [s, 0, 0] });
      }
    },
    spoiler(x0, x1, zHalf, y, drop = .05) {
      const uv = () => [.0005, .0005], c = [.94, .94, .94];
      // Nace sobre la chapa y sigue su comba: una tabla recta y más ancha que el techo flota sobre el vidrio.
      const half = Math.min(zHalf, body.edgeZ(x0) * .96), root = z => Math.min(y, body.topY(x0, z) + .004);
      const zOf = i => lerp(-half, half, i / 6);
      // El borde de atrás se angosta para no asomarse por fuera de la chapa, que ya viene cerrando.
      const back = .9;
      addGrid(b.paint, 6, 1, (i, j) => [j ? x1 : x0, root(zOf(i)) - (j ? .018 : 0), zOf(i) * (j ? back : 1)], { color: c, mirror: false, out: [0, 1, 0], uv });
      addGrid(b.paint, 6, 1, (i, j) => [x1, root(zOf(i)) - .018 - (j ? drop : 0), zOf(i) * back], { color: c, mirror: false, out: [-1, 0, 0], uv });
      // Cara inferior negra y luz de freno alta bajo el alerón.
      addGrid(b.trim, 6, 1, (i, j) => [j ? x0 : x1, root(zOf(i) * .97) - .018 - (j ? 0 : drop) - .004, zOf(i) * .97 * (j ? 1 : back)], { color: COLOR.dark, mirror: false, out: [0, -1, 0] });
    },
    floorPlate() {
      const y = spec.floorY ?? spec.bottomMid + .02;
      const front = spec.axleF - spec.archR - .02, back = spec.axleR + spec.archR + .02, hw = body.hw(0) * .93;
      box(b.trim, [front - back, .02, hw * 2], [(front + back) / 2, y, 0], { color: COLOR.dark });
      box(b.trim, [spec.archR * 2, .02, hw * .9], [spec.axleF, spec.archY + .1, 0], { color: COLOR.dark });
      box(b.trim, [spec.archR * 2, .02, hw * .9], [spec.axleR, spec.archY + .1, 0], { color: COLOR.dark });
    },
    exhaust(x, y, z) {
      tube(b.trim, [x + .22, y, z], [x - .02, y, z], .028, 6, { color: COLOR.exhaust, metal: .6 });
    },
    antenna(x, y, z, h = .22) {
      bar(b.trim, [x, y, z], [x - h * .55, y + h, z], .007, .007, { color: COLOR.rubber });
    },
    roofRails(x0, x1, z, h = .04) {
      for (const side of [1, -1]) {
        const seg = 3, pts = [];
        // Las puntas bajan hasta el techo: la barra nace de él sin necesidad de patas aparte.
        for (let i = 0; i <= seg; i++) { const x = x0 + (x1 - x0) * i / seg, end = i === 0 || i === seg; pts.push([x, body.topY(x, z) + (end ? -.005 : h + .012), z * side]); }
        for (let i = 0; i < seg; i++) bar(b.trim, pts[i], pts[i + 1], .03, .035, { color: COLOR.plasticLight, metal: .3 });
      }
    },
  };
}

/** Una placa es una lámina recta con su marco oscuro: si envolviera la nariz se vería torcida. */
function flatPlate(body, b, end, y, h, w, off) {
  const nose = end === 'nose', sign = nose ? 1 : -1;
  const at = yy => body.around(end, 0, yy, off)[0];
  // Un solo plano para marco y placa: cada uno con su cuerda se cruzaban sobre lámina curva y el marco tapaba media placa.
  const x0 = at(y), x1 = at(y + h);
  const bulge = Math.max(0, sign * (at(y + h / 2) - (x0 + x1) / 2));
  const planeX = (yy, extra) => lerp(x0, x1, (yy - y) / h) + sign * (bulge + extra);
  const quad = (batch, half, y0, y1, extra, opts) => addGrid(batch, 1, 1, (i, j) => [planeX(lerp(y0, y1, j), extra), lerp(y0, y1, j), lerp(-half, half, i)], { mirror: false, out: [sign, 0, 0], ...opts });
  quad(b.trim, w / 2 + .012, y - .012, y + h + .012, 0, { color: COLOR.dark, metal: PATCH_FLAG });
  quad(b.lamp, w / 2, y, y + h, .006, { color: [1, 1, 1], lamp: LAMP.PLATE, uv: (u, v) => rectUv(RECT.plate, nose ? 1 - u : u, 1 - v) });
}

function addTorus(batch, geometry, color) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, base = batch.count;
  for (let i = 0; i < p.count; i++) batch.v(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), undefined, undefined, color[0], color[1], color[2], 0);
  const idx = geometry.index;
  for (let i = 0; i < idx.count; i += 3) batch.tri(base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2));
  geometry.dispose();
}

/** Distintivos que dependen del tipo: capacete y calcomanías de taxi, franja y luces de patrulla. */
export function addKindParts(k, kind) {
  const { body, b, spec } = k;
  if (kind === 'taxi') {
    const rx = spec.taxiRoofX ?? (spec.windshield[0] - .45);
    // Capacete con base negra sobre el techo; se ilumina de noche con el canal propio.
    const y = body.topY(rx, 0);
    box(b.trim, [.20, .03, .50], [rx, y + .02, 0], { color: COLOR.trim });
    const signFace = (sx) => {
      const x = rx + sx * .085;
      addGrid(b.lamp, 1, 1, (i, j) => [x, y + .035 + j * .13, (i - .5) * .46], {
        uv: (u, v) => rectUv(RECT.sign, sx > 0 ? 1 - u : u, 1 - v), color: [1, 1, 1], lamp: LAMP.SIGN, mirror: false, out: [sx, 0, 0],
      });
    };
    signFace(1); signFace(-1);
    // Tapa y costados de lámina: nunca se ven por dentro, así que bastan caras sueltas.
    const signColor = [.75, .62, .1];
    addGrid(b.lamp, 1, 1, (i, j) => [rx + (i - .5) * .17, y + .165, (j - .5) * .46], { color: signColor, mirror: false, out: [0, 1, 0] });
    addGrid(b.lamp, 1, 1, (i, j) => [rx + (i - .5) * .17, y + .035 + j * .13, .23], { color: signColor, out: [0, 0, 1] });
    const stripeY = spec.stripeY ?? (x => body.shoulder(x) - .05);
    // Calcomanía de la puerta delantera, sobre la chapa: termina bajo la franja de damero, que si no le tapa el número.
    const dx = spec.decalX ?? ((spec.windows.at(-1)[0] + spec.windows.at(-1)[1]) / 2 - .02), dy = spec.decalY ?? Math.min(stripeY(dx - .17), stripeY(dx + .17)) - .18;
    patchSide(b.lamp, body, { x0: dx - .17, x1: dx + .17, bot: dy, top: dy + .17, rect: RECT.door, lamp: LAMP.PLATE, off: .004, cols: 3, rows: 1, color: [1, 1, 1], flipU: false });
    // Placa pintada en el techo para que se lea desde arriba.
    patchTop(b.lamp, body, { x0: rx - .68, x1: rx - .22, z0: .19, z1: -.19, cols: 2, rows: 2, off: .005, color: [1, 1, 1], lamp: LAMP.PLATE,
      uvFn: (u, v) => rectUv(RECT.roof, v, u) });
    // Franja ajedrezada bajo las ventanas, parte de la imagen de los taxis urbanos.
    const { axleF, axleR, archR } = spec;
    patchSide(b.lamp, body, { x0: axleR + archR + .02, x1: axleF - archR - .02, bot: stripeY, top: x => stripeY(x) + .05, cols: 10, rows: 1, off: .003,
      color: [1, 1, 1], lamp: LAMP.OFF, uvRepeat: true, rect: RECT.taxiStripe });
  }
  if (kind === 'police') {
    // Franja verde con la leyenda, proyectada sobre la puerta: sigue la chapa, no es un plano suelto.
    const x0 = spec.axleR + spec.archR + .05, x1 = spec.axleF - spec.archR - .05;
    // Va bajo las manijas: encima de ellas, una manija oscura se come una letra de la leyenda.
    const mid = x => (spec.policeY ?? (body.shoulder(x) - .29));
    patchSide(b.lamp, body, { x0, x1, bot: mid, top: x => mid(x) + .22, rect: RECT.police, lamp: LAMP.OFF, off: .003, cols: 10, rows: 1, color: [1, 1, 1] });
    const rx = spec.windshield[0] - .55, y = body.topY(rx, 0);
    box(b.trim, [.26, .05, 1.12], [rx, y + .04, 0], { color: COLOR.trim });
    for (const [z, lamp] of [[.29, LAMP.BLUE], [-.29, LAMP.RED]]) {
      const g = new THREE.BoxGeometry(.22, .10, .50);
      g.translate(rx, y + .115, z);
      addLampGeo(b.lamp, g, lamp, lamp === LAMP.BLUE ? [.03, .08, .5] : [.42, .02, .02]);
    }
  }
}

function addLampGeo(batch, geometry, lamp, color) {
  const p = geometry.attributes.position, n = geometry.attributes.normal, base = batch.count, w = rectUv(RECT.white, .5, .5);
  for (let i = 0; i < p.count; i++) batch.v(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), w[0], w[1], color[0], color[1], color[2], 0, lamp);
  const idx = geometry.index;
  for (let i = 0; i < idx.count; i += 3) batch.tri(base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2));
  geometry.dispose();
}

// ===== Definición de la flota =====

function define(s) {
  s.axleF = s.L / 2 - s.front;
  s.axleR = s.axleF - s.wb;
  s.archR ??= s.r + (s.archGap ?? .055);
  s.archY ??= s.r + .012;
  s.bottomMid ??= s.bottom.reduce((min, [, y]) => Math.min(min, y), 9);
  const keys = [...(s.keys ?? [])];
  for (const [a, b] of s.windows ?? []) keys.push(a, b);
  if (s.windows?.length) {
    const m = s.frameMargin ?? .02;
    keys.push(s.windows[0][0] - m, s.windows[s.windows.length - 1][1] + m);
  }
  for (const [name, frit] of [['windshield', s.windshieldFrit ?? .03], ['backlight', s.backlightFrit ?? .025]]) {
    if (s[name]) keys.push(s[name][0], s[name][1], s[name][0] + frit, s[name][1] - frit);
  }
  if (s.bed) keys.push(...s.bed);
  s.keys = keys;
  return s;
}

const taxiYellow = ['#e8b321'];

export const CAR_MODELS = {
  // Citadino alto y corto: capó mínimo, faros grandes en flecha, cintura que sube, portón casi plano y stops en el pilar.
  citadino: define({
    sillCut: 0.079,
    noseRake: [.30, .48, .9], tailRake: [.04, .62, .55],
    noseSteps: [[.585, .014]], tailSteps: [[.60, .024]],
    id: 'citadino', L: 3.64, W: 1.60, H: 1.52, wb: 2.38, r: .29, front: .66, flare: .008,
    top: [[-1.82, 1.0], [-1.80, 1.06], [-1.74, 1.22], [-1.60, 1.41], [-1.50, 1.475], [-1.40, 1.505], [-1.25, 1.515], [-.70, 1.52], [-.2, 1.515], [.12, 1.49], [.24, 1.46], [.92, 1.02], [1.0, .995], [1.25, .945], [1.50, .90], [1.66, .87], [1.76, .84], [1.82, .80]],
    edge: [[-1.82, .97], [-1.79, 1.03], [-1.71, 1.19], [-1.55, 1.35], [-1.40, 1.405], [-1.1, 1.42], [-.5, 1.43], [0, 1.415], [.18, 1.38], [.82, .975], [.95, .955], [1.25, .90], [1.5, .85], [1.66, .82], [1.76, .79], [1.82, .76]],
    belt: [[-1.82, .95], [-1.66, 1.03], [-1.30, 1.04], [-.9, .995], [-.3, .95], [.3, .925], [.82, .93], [1.25, .87], [1.5, .83], [1.66, .80], [1.82, .745]],
    shoulder: [[-1.82, .78], [-1.5, .89], [-1.0, .86], [0, .79], [.8, .75], [1.3, .72], [1.82, .67]],
    lowLine: [[-1.82, .60], [-1.58, .60], [-1.2, .58], [-.8, .50], [.6, .47], [1.1, .56], [1.5, .585], [1.82, .585]],
    bottom: [[-1.82, .40], [-1.72, .30], [-1.5, .22], [-1.0, .19], [.7, .19], [1.4, .21], [1.7, .27], [1.82, .38]],
    plan: [[-1.82, .985], [-1.5, .995], [-1.22, 1], [0, 1], [1.16, 1], [1.5, .985], [1.82, .94]],
    noseLen: .62, noseN: 2.3, tailLen: .30, tailN: 4.4,
    edgeZ: [[-1.82, .66], [-1.6, .69], [-1.36, .64], [-.5, .64], [.18, .63], [.82, .71], [1.2, .72], [1.6, .70], [1.82, .6]],
    bow: [[-1.82, 0], [-1.70, -.03], [-1.5, -.04], [-1.2, -.02], [-.5, 0], [.1, .05], [.82, .10], [1.1, .06], [1.55, .02], [1.82, 0]],
    windows: [[-1.26, -1.03], [-.97, -.24], [-.16, .72]], windshield: [.18, .82], backlight: [-1.66, -1.43],
    keys: [-1.46, .95, 1.6],
    crease: .009, wheel: { rim: 'rimTapa', width: .165, depth: .018, spokes: 0 },
    mirror: { x: .66, y: .985 }, wiper: 2,
    gaps: { doors: [[-.20, .75], [-.98, -.20]], hood: 1.56, hatch: [-1.74, -1.28], fuel: [-1.32, .88] },
    interior: { dash: .60, seat: .02, rear: -.78, floor: .36, belt: .96, hw: .72, height: .55 },
    driver: { x: .03, z: -.34, h: 1.42 },
    parts(k) {
      k.optic('citadinoHead'); k.optic('citadinoGrille');
      // Toma baja grande, más ancha que la parrilla, y exploradoras en sus huecos.
      k.optic('citadinoIntake'); k.optic('citadinoFog');
      k.plateFront(.475);
      k.nose({ a0: -.72, a1: .72, top: .30, bot: .27, off: .006, color: COLOR.plastic, rows: 1 });
      k.optic('citadinoTail');
      // Portón plano: su junta baja junto a los stops y muere contra el parachoques.
      k.seam('tail', [[.455, 1.06], [.455, .625]]); k.seam('tail', [[0, 1.075], [.46, 1.06]]);
      k.platePocket('tail', .72, .17, .34); k.plateRear(.72);
      k.tail({ a0: -.78, a1: .78, top: .46, bot: .36, off: .008, color: COLOR.plastic, rows: 1 });
      k.reflex(.53, .68, .475, .50);
      k.rearWiper(); k.spoiler(-1.46, -1.56, .5, 1.50, .025);
      k.handle(.02, .86); k.handle(-.72, .89, 'paint', .13);
      k.repeater(.86, .80);
      k.skirt(-.86, .80, .075);
      k.exhaust(-1.74, .32, -.42); k.antenna(-1.15, 1.50, 0, .2);
    },
  }),

  // Sedán popular: cabina vertical, capó alto y plano, baúl largo y cuadrado, barra cromada en la parrilla.
  sedanPopular: define({
    sillCut: 0.079,
    noseRake: [.18, .52, .9], tailRake: [.10, .56, .6],
    noseSteps: [[.70, .016]], tailSteps: [[.625, .022]],
    id: 'sedanPopular', L: 4.35, W: 1.73, H: 1.52, wb: 2.63, r: .30, front: .82, flare: .007,
    top: [[-2.175, 1.035], [-2.13, 1.075], [-2.0, 1.095], [-1.40, 1.11], [-.82, 1.455], [-.72, 1.49], [-.4, 1.515], [.1, 1.52], [.35, 1.505], [.52, 1.47], [1.22, 1.03], [1.30, 1.02], [1.7, .985], [1.98, .955], [2.1, .93], [2.175, .90]],
    edge: [[-2.175, 1.01], [-2.12, 1.045], [-1.5, 1.07], [-1.35, 1.08], [-.79, 1.39], [-.5, 1.415], [.1, 1.425], [.475, 1.385], [1.12, .995], [1.3, .985], [1.7, .95], [1.98, .92], [2.1, .895], [2.175, .875]],
    belt: [[-2.175, .995], [-2.0, 1.02], [-1.3, 1.03], [-.5, 1.0], [.5, .975], [1.12, .975], [1.4, .96], [2.0, .905], [2.175, .865]],
    shoulder: [[-2.175, .90], [-1.8, .89], [0, .84], [1.3, .84], [2.0, .79], [2.175, .76]],
    lowLine: [[-2.175, .625], [-1.75, .625], [-1.3, .62], [-.85, .53], [.9, .51], [1.35, .62], [1.75, .70], [2.175, .70]],
    bottom: [[-2.175, .46], [-2.05, .30], [-1.7, .24], [-1.0, .2], [.9, .2], [1.7, .22], [2.05, .27], [2.175, .38]],
    noseLen: .60, noseN: 3.2, tailLen: .34, tailN: 4.2,
    edgeZ: [[-2.175, .66], [-1.8, .74], [-1.35, .74], [-.79, .655], [.475, .655], [1.12, .75], [1.6, .75], [2.0, .72], [2.175, .6]],
    bow: [[-2.175, 0], [-1.5, -.05], [-1.0, -.05], [-.4, 0], [.4, .04], [1.1, .10], [1.5, .05], [2.175, 0]],
    windows: [[-1.14, -.90], [-.82, -.02], [.05, 1.02]], windshield: [.475, 1.12], backlight: [-1.35, -.79],
    keys: [-2.06, -1.9, 1.98],
    crease: .007, wheel: { rim: 'rimTapa', width: .185, depth: .018, spokes: 0 },
    mirror: { x: .94, y: 1.03 }, wiper: 2,
    gaps: { doors: [[.02, 1.05], [-.86, .02]], hood: 1.96, trunk: -1.40, fuel: [-1.62, .96] },
    interior: { dash: .92, seat: .25, rear: -.62, floor: .36, belt: 1.0, hw: .78, height: .52 },
    driver: { x: .27, z: -.38, h: 1.40 },
    parts(k) {
      k.optic('sedanPopularHead'); k.optic('sedanPopularGrille');
      // La barra cromada ancha que cruza la parrilla y un filo fino abajo.
      k.chrome('nose', [[0, .805], [.372, .80]], .034, .012);
      k.chrome('nose', [[0, .736], [.31, .742]], .009, .008);
      k.optic('sedanPopularIntake'); k.optic('sedanPopularFog');
      k.plateFront(.505);
      k.nose({ a0: -.80, a1: .80, top: .345, bot: .285, off: .006, color: COLOR.plastic, rows: 1 });
      k.optic('sedanPopularTail');
      // Tapa del baúl: bajo los stops corre hasta el parachoques; el hueco de la placa lleva un filo cromado encima.
      k.seam('tail', [[.442, 1.02], [.442, .645]]);
      k.platePocket('tail', .665, .17, .34); k.plateRear(.665);
      k.chrome('tail', [[0, .875], [.44, .875]], .016, .007);
      k.tail({ a0: -.84, a1: .84, top: .48, bot: .38, off: .007, color: COLOR.plastic, rows: 1 });
      k.reflex(.60, .78, .505, .535);
      k.handle(.03, .89); k.handle(-.83, .90);
      k.repeater(1.18, .84);
      k.skirt(-.98, .98, .075);
      k.bocel(-.86, .96, .585, .026);
      k.exhaust(-2.1, .34, -.5); k.antenna(-.42, 1.51, 0, .22);
    },
  }),

  // Hatchback familiar: techo que cae hacia atrás, cola corta, alerón sobre la luneta y cintura que sube.
  hatchPopular: define({
    sillCut: 0.079,
    noseRake: [.22, .52, .9], tailRake: [.06, .58, .6],
    noseSteps: [[.725, .016]], tailSteps: [[.60, .024]],
    id: 'hatchPopular', L: 4.06, W: 1.73, H: 1.55, wb: 2.59, r: .31, front: .80, flare: .009,
    top: [[-2.03, 1.03], [-1.99, 1.08], [-1.94, 1.14], [-1.70, 1.44], [-1.62, 1.49], [-1.45, 1.515], [-.9, 1.54], [-.2, 1.55], [.25, 1.535], [.42, 1.495], [1.10, 1.04], [1.18, 1.025], [1.55, .985], [1.84, .955], [1.96, .925], [2.03, .89]],
    edge: [[-2.03, 1.0], [-1.98, 1.05], [-1.90, 1.12], [-1.66, 1.37], [-1.50, 1.43], [-1.0, 1.46], [-.2, 1.465], [.37, 1.42], [1.00, 1.0], [1.18, .985], [1.55, .945], [1.84, .91], [1.96, .885], [2.03, .86]],
    belt: [[-2.03, .98], [-1.9, 1.05], [-1.55, 1.075], [-.5, 1.01], [.4, .985], [1.00, .985], [1.3, .96], [1.85, .90], [2.03, .85]],
    shoulder: [[-2.03, .88], [-1.6, .89], [0, .84], [1.2, .84], [1.85, .79], [2.03, .75]],
    lowLine: [[-2.03, .60], [-1.75, .60], [-1.35, .62], [-.92, .50], [.8, .485], [1.23, .62], [1.65, .725], [2.03, .725]],
    bottom: [[-2.03, .46], [-1.92, .32], [-1.6, .25], [-1.0, .21], [.8, .21], [1.6, .23], [1.92, .28], [2.03, .38]],
    noseLen: .60, noseN: 3.0, tailLen: .32, tailN: 3.8,
    edgeZ: [[-2.03, .66], [-1.9, .75], [-1.50, .665], [-.2, .665], [.37, .655], [1.00, .75], [1.5, .75], [1.85, .72], [2.03, .6]],
    bow: [[-2.03, 0], [-1.9, -.03], [-1.6, -.04], [-1.0, 0], [.3, .045], [1.0, .10], [1.35, .05], [2.03, 0]],
    windows: [[-1.30, -.28], [-.20, .90]], windshield: [.37, 1.00], backlight: [-1.88, -1.66],
    keys: [-1.66, 1.84],
    crease: .007, wheel: { rim: 'rimAleacion', width: .19, depth: .026, spokes: 5 },
    mirror: { x: .82, y: 1.04 }, wiper: 2,
    gaps: { doors: [[-.24, .94], [-1.40, -.24]], hood: 1.82, hatch: [-1.96, -1.62], fuel: [-1.62, .94] },
    interior: { dash: .80, seat: .10, rear: -.80, floor: .38, belt: 1.01, hw: .78, height: .54 },
    driver: { x: .12, z: -.38, h: 1.44 },
    parts(k) {
      k.optic('hatchPopularHead'); k.optic('hatchPopularGrille');
      k.chrome('nose', [[0, .752], [.27, .752], [.36, .815]], .014, .008);
      k.optic('hatchPopularIntake'); k.optic('hatchPopularFog');
      k.plateFront(.525);
      k.nose({ a0: -.80, a1: .80, top: .355, bot: .295, off: .006, color: COLOR.plastic, rows: 1 });
      k.optic('hatchPopularTail');
      // Portón: su junta baja junto a los stops; placa en el hueco del portón y parachoques aparte.
      k.seam('tail', [[.545, 1.13], [.545, .625]]);
      k.platePocket('tail', .70, .17, .34); k.plateRear(.70);
      k.tail({ a0: -.84, a1: .84, top: .50, bot: .38, off: .007, color: COLOR.plastic, rows: 1 });
      k.reflex(.60, .76, .52, .55);
      k.handle(-.1, .90); k.handle(-1.08, .92);
      k.repeater(1.06, .85);
      k.skirt(-1.0, .86, .075);
      // Alerón sobre la luneta y limpiabrisas de atrás.
      k.spoiler(-1.56, -1.70, .54, 1.50, .03);
      k.rearWiper();
      k.exhaust(-1.96, .36, -.48); k.antenna(-1.2, 1.54, 0, .2);
    },
  }),

  // Sedán deportivo bajo y largo: techo como cupé, baúl corto, faros finos, parrilla de cinco lados y hombro marcado.
  sedanDeportivo: define({
    sillCut: 0.07400000000000001,
    noseRake: [.46, .40, 1.0], tailRake: [.14, .56, .7],
    noseSteps: [[.615, .01]], tailSteps: [[.60, .02]],
    id: 'sedanDeportivo', L: 4.46, W: 1.79, H: 1.44, wb: 2.70, r: .32, front: .90, flare: .011,
    top: [[-2.23, 1.03], [-2.16, 1.06], [-1.96, 1.085], [-1.62, 1.10], [-1.20, 1.28], [-.72, 1.40], [-.35, 1.435], [.05, 1.44], [.30, 1.42], [.46, 1.37], [1.26, .92], [1.36, .90], [1.7, .85], [2.0, .80], [2.14, .755], [2.23, .69]],
    edge: [[-2.23, 1.0], [-2.16, 1.03], [-2.05, 1.05], [-1.7, 1.06], [-1.57, 1.065], [-.72, 1.325], [-.35, 1.355], [.05, 1.36], [.41, 1.31], [1.14, .87], [1.36, .85], [1.7, .805], [2.0, .75], [2.14, .71], [2.23, .655]],
    belt: [[-2.23, .98], [-2.0, 1.02], [-1.4, 1.02], [-.6, .96], [.4, .90], [1.14, .865], [1.4, .84], [2.0, .735], [2.14, .70], [2.23, .645]],
    shoulder: [[-2.23, .88], [-1.8, .88], [-1.2, .85], [0, .77], [1.33, .74], [2.0, .66], [2.23, .58]],
    lowLine: [[-2.23, .60], [-1.85, .60], [-1.4, .62], [-.98, .455], [.9, .42], [1.33, .56], [1.75, .60], [2.23, .615]],
    lowDepth: .008,
    bottom: [[-2.23, .44], [-2.1, .30], [-1.7, .23], [-1.0, .185], [.9, .185], [1.8, .2], [2.12, .24], [2.23, .32]],
    noseLen: .72, noseN: 2.6, tailLen: .42, tailN: 3.2,
    edgeZ: [[-2.23, .6], [-1.9, .76], [-1.57, .77], [-.72, .66], [.41, .65], [1.14, .78], [1.6, .79], [2.0, .72], [2.23, .6]],
    bow: [[-2.23, 0], [-1.8, -.05], [-1.0, -.06], [-.3, 0], [.4, .05], [1.15, .12], [1.6, .06], [2.23, 0]],
    windows: [[-1.22, -1.0], [-.96, -.12], [-.06, 1.02]], windshield: [.41, 1.14], backlight: [-1.57, -.72],
    keys: [-1.96, 2.0], backlightFrit: .03, beltTrim: 'chrome',
    crease: .011, tuck: .96, wheel: { rim: 'rimRadios', width: .205, depth: .03, spokes: 7, rimRatio: .72 },
    mirror: { x: .92, y: .92 }, wiper: 2,
    gaps: { doors: [[-.09, 1.05], [-1.0, -.09]], hood: 2.02, trunk: -1.60, fuel: [-1.66, .94] },
    interior: { dash: .86, seat: .14, rear: -.72, floor: .32, belt: .93, hw: .80, height: .5 },
    driver: { x: .16, z: -.38, h: 1.32 },
    parts(k) {
      k.optic('sedanDeportivoHead'); k.optic('sedanDeportivoGrille');
      // Ala cromada fina bajo la parrilla, que sube hasta tocar el faro. Sin emblema.
      k.chrome('nose', [[0, .392], [.39, .428], [.52, .60], [.60, .635]], .011, .008);
      k.optic('sedanDeportivoIntake'); k.optic('sedanDeportivoFog');
      k.plateFront(.44, .15, .30);
      k.optic('sedanDeportivoTail');
      k.seam('tail', [[.455, 1.02], [.455, .62]]);
      k.platePocket('tail', .655, .17, .34); k.plateRear(.655);
      k.tail({ a0: -.86, a1: .86, top: .46, bot: .35, off: .006, color: COLOR.plastic, rows: 1 });
      k.reflex(.66, .84, .49, .515);
      k.spoiler(-2.08, -2.16, .54, 1.085, .016);
      k.exhaust(-2.15, .33, -.56); k.exhaust(-2.15, .33, .56);
      k.handle(-.03, .845); k.handle(-.90, .88);
      k.repeater(1.20, .78);
      k.skirt(-1.0, .96, .07);
      k.antenna(-.75, 1.39, 0, .14);
    },
  }),

  // Camioneta compacta: alta y cuadrada, parte baja y arcos de plástico negro, protectores plateados y barras de techo.
  suv: define({
    sillCut: 0.17,
    noseRake: [.2, .62, .6], tailRake: [.05, .66, .5],
    noseSteps: [[.835, .014]], tailSteps: [[.70, .022]],
    id: 'suv', L: 4.34, W: 1.82, H: 1.68, wb: 2.67, r: .34, front: .84, archGap: .075,
    top: [[-2.17, 1.18], [-2.13, 1.30], [-2.05, 1.47], [-1.92, 1.60], [-1.78, 1.645], [-1.6, 1.665], [-.8, 1.68], [.1, 1.68], [.4, 1.665], [.58, 1.62], [1.18, 1.17], [1.25, 1.155], [1.6, 1.12], [1.86, 1.09], [2.04, 1.055], [2.17, 1.0]],
    edge: [[-2.17, 1.15], [-2.11, 1.27], [-2.02, 1.43], [-1.86, 1.545], [-1.66, 1.58], [-1.0, 1.59], [.1, 1.59], [.53, 1.54], [1.08, 1.135], [1.25, 1.115], [1.6, 1.08], [1.86, 1.05], [2.04, 1.015], [2.17, .965]],
    belt: [[-2.17, 1.13], [-2.0, 1.17], [-1.6, 1.20], [-.5, 1.135], [.5, 1.115], [1.08, 1.12], [1.3, 1.09], [1.86, 1.03], [2.17, .955]],
    shoulder: [[-2.17, 1.0], [-1.6, 1.0], [0, .96], [1.3, .96], [1.86, .90], [2.17, .87]],
    lowLine: [[-2.17, .70], [-1.85, .70], [-1.4, .78], [-.93, .64], [.9, .62], [1.33, .78], [1.75, .835], [2.17, .835]],
    bottom: [[-2.17, .50], [-2.0, .45], [-1.6, .40], [-.9, .33], [.8, .33], [1.7, .40], [2.05, .42], [2.17, .45]],
    flare: .014, rocker: .12,
    noseLen: .54, noseN: 3.4, tailLen: .30, tailN: 4.2,
    edgeZ: [[-2.17, .72], [-2.0, .80], [-1.66, .73], [-.4, .715], [.53, .705], [1.08, .79], [1.6, .79], [1.9, .76], [2.17, .62]],
    bow: [[-2.17, 0], [-2.0, -.03], [-1.7, -.04], [-1.0, 0], [.4, .05], [1.05, .10], [1.5, .05], [2.17, 0]],
    windows: [[-1.60, -1.30], [-1.22, -.30], [-.22, .96]], windshield: [.53, 1.08], backlight: [-2.03, -1.84],
    keys: [-1.78],
    crease: .009, wheel: { rim: 'rimAleacion', width: .215, depth: .03, spokes: 5, rimRatio: .68 },
    mirror: { x: .88, y: 1.17 }, wiper: 2,
    gaps: { doors: [[-.26, 1.0], [-1.26, -.26]], hood: 1.84, hatch: [-2.1, -1.78], fuel: [-1.62, 1.08] },
    interior: { dash: .84, seat: .15, rear: -.78, floor: .48, belt: 1.14, hw: .82, height: .56 },
    driver: { x: .17, z: -.40, h: 1.58 },
    parts(k) {
      k.optic('suvHead'); k.optic('suvGrille');
      k.chrome('nose', [[0, .90], [.455, .90]], .022, .012);
      // Parte baja negra que sube a encontrarse con los arcos y protector plateado al centro.
      k.panel('nose', [[0, .46], [0, .625], [.72, .625], [1.0, .69], [1.09, .62], [1.04, .435], [.85, .425], [.6, .435]], { off: .007 });
      k.optic('suvIntake', { off: .011 }); k.optic('suvFog', { off: .011 });
      k.panel('nose', [[0, .46], [0, .54], [.46, .53], [.56, .49], [.46, .45]], { color: COLOR.silver, metal: .75, off: .014, rows: 1 });
      k.plateFront(.645, .155, .32);
      k.optic('suvTail');
      k.seam('tail', [[.525, 1.24], [.525, .725]]);
      k.platePocket('tail', .80, .17, .34); k.plateRear(.80);
      k.panel('tail', [[0, .51], [0, .665], [.72, .665], [1.0, .73], [1.12, .67], [1.08, .44], [.85, .46], [.6, .48]], { off: .008 });
      k.panel('tail', [[0, .51], [0, .59], [.5, .59], [.60, .55], [.5, .49]], { color: COLOR.silver, metal: .75, off: .014 });
      k.reflex(.66, .86, .59, .625);
      k.rearWiper(); k.spoiler(-1.80, -1.94, .6, 1.625, .03);
      k.archTrim(.085);
      k.skirt(-.98, .96, .15, COLOR.plastic, .012);
      k.handle(-.12, 1.04, 'trim'); k.handle(-1.1, 1.06, 'trim');
      k.repeater(1.14, .98);
      k.roofRails(-1.45, .28, .58);
      k.exhaust(-2.08, .42, -.52);
    },
  }),

  // Pick-up de doble cabina: alta sobre su chasis, platón hondo con compuerta, parrilla grande de barras y estribo.
  pickup: define({
    noseRake: [.12, .72, .5], tailRake: [.02, .7, .3],
    noseSteps: [[.84, .016]], tailSteps: [[.765, .024]],
    id: 'pickup', L: 5.30, W: 1.85, H: 1.80, wb: 3.08, r: .39, front: .92, archGap: .08,
    top: [[-2.65, 1.26], [-2.62, 1.285], [-2.55, 1.30], [-.82, 1.31], [-.78, 1.35], [-.72, 1.70], [-.62, 1.77], [-.2, 1.80], [.35, 1.80], [.62, 1.77], [.76, 1.72], [1.40, 1.31], [1.48, 1.295], [1.9, 1.275], [2.3, 1.25], [2.5, 1.22], [2.65, 1.17]],
    edge: [[-2.65, 1.235], [-2.6, 1.26], [-2.5, 1.27], [-.84, 1.285], [-.80, 1.31], [-.76, 1.60], [-.62, 1.695], [-.2, 1.71], [.35, 1.71], [.70, 1.65], [1.30, 1.27], [1.48, 1.25], [1.9, 1.23], [2.3, 1.205], [2.5, 1.175], [2.65, 1.145]],
    belt: [[-2.65, 1.22], [-2.5, 1.25], [-.9, 1.27], [-.7, 1.30], [.5, 1.275], [1.30, 1.265], [1.5, 1.23], [2.3, 1.185], [2.65, 1.13]],
    shoulder: [[-2.65, 1.09], [-2.3, 1.09], [0, 1.08], [1.6, 1.06], [2.3, 1.0], [2.65, .92]],
    lowLine: [[-2.65, .765], [-2.0, .765], [-1.35, .80], [-.86, .72], [1.2, .70], [1.73, .84], [2.2, .84], [2.65, .84]],
    bottom: [[-2.65, .60], [-2.5, .56], [-1.9, .50], [-.9, .46], [1.1, .46], [2.1, .46], [2.5, .50], [2.65, .58]],
    noseLen: .52, noseN: 3.6, tailLen: .12, tailN: 5, flare: .016, rocker: .09,
    edgeZ: [[-2.65, .84], [-2.5, .88], [-.84, .88], [-.76, .72], [.70, .72], [1.30, .83], [1.9, .84], [2.3, .80], [2.65, .66]],
    bow: [[-2.65, 0], [-.9, 0], [-.7, -.02], [.1, 0], [.7, .05], [1.3, .09], [1.8, .04], [2.65, 0]],
    windows: [[-.66, .12], [.20, 1.22]], windshield: [.70, 1.30], backlight: [-.76, -.635], bed: [-2.60, -.82], frameMargin: .02,
    keys: [-.84, -.72, 1.48, 2.3, -2.55], backlightFrit: .012, crown: 3,
    crease: .008, wheel: { rim: 'rimAleacion', width: .245, depth: .036, spokes: 6, rimRatio: .6 },
    mirror: { x: 1.08, y: 1.32 }, wiper: 2, taxiRoofX: 0,
    gaps: { doors: [[.16, 1.26], [-.70, .16]], hood: 2.32, fuel: [-1.15, 1.14] },
    interior: { dash: 1.05, seat: .42, rear: -.32, floor: .60, belt: 1.26, hw: .84, height: .58 },
    driver: { x: .44, z: -.40, h: 1.70 },
    // Junta entre cabina y platón: son dos piezas, no una sola lámina con el techo cortado.
    detail(ctx, { sx, sy, seam }) {
      ctx.beginPath(); ctx.moveTo(sx(-.80), sy(1.30)); ctx.lineTo(sx(-.80), sy(.50)); seam(); seam();
    },
    parts(k) {
      const { body, b } = k;
      k.optic('pickupHead'); k.optic('pickupGrille');
      // Barras gruesas de cromo y marco alto de la parrilla.
      for (const y of [1.018, .93]) k.chrome('nose', [[0, y], [.53, y - .004]], .036, .015);
      k.chrome('nose', [[0, 1.098], [.505, 1.094]], .018, .01);
      k.optic('pickupIntake'); k.optic('pickupFog');
      k.panel('nose', [[0, .47], [0, .50], [.70, .505], [.74, .475], [.70, .47]], { color: COLOR.gray, off: .01 });
      k.plateFront(.668, .155, .32);
      k.optic('pickupTail');
      // Compuerta: línea alta, junta a los lados, hueco de manija y bumper cromado de verdad, separado de ella.
      k.seam('tail', [[0, 1.215], [.69, 1.215]]);
      k.seam('tail', [[.692, 1.215], [.692, .79]]);
      k.seam('tail', [[0, .79], [.69, .79]]);
      k.tail({ a0: -.15, a1: .15, top: 1.135, bot: 1.075, off: .004, color: COLOR.pocket, rows: 1 });
      k.tail({ a0: -.115, a1: .115, top: 1.125, bot: 1.098, off: .012, color: COLOR.plastic, rows: 1 });
      k.chrome('tail', [[0, 1.03], [.58, 1.03]], .012, .006);
      k.tail({ a0: -.95, a1: .95, top: .765, bot: .63, off: .02, bulge: .012, color: COLOR.chrome, metal: 1, rows: 2 });
      k.plateRear(.815);
      k.handle(.08, 1.14, 'chrome'); k.handle(-.60, 1.14, 'chrome');
      k.repeater(1.45, 1.12);
      // Platón real: piso, paredes y frente con grosor, abiertos arriba y más hondos que antes.
      const x0 = -2.60, x1 = -.82, y = .92, floorZ = .78;
      const yTop = x => body.edge(x);
      addGrid(b.trim, 6, 1, (i, j) => { const x = x0 + (x1 - x0) * i / 6; return [x, y, j ? floorZ : -floorZ]; }, { color: COLOR.plastic, mirror: false, out: [0, 1, 0] });
      // Corrugado del piso.
      for (let i = 0; i < 5; i++) box(b.trim, [x1 - x0 - .1, .014, .05], [(x0 + x1) / 2, y + .01, -.56 + i * .28], { color: COLOR.rubber });
      addGrid(b.paint, 6, 1, (i, j) => { const x = x0 + (x1 - x0) * i / 6, zI = body.edgeZ(x) * .91; return j ? [x, y, floorZ] : [x, yTop(x) - .002, zI]; }, { color: [.82, .82, .82], out: [0, 0, -1], uv: () => [.0005, .0005] });
      for (const [x, s] of [[x0 + .001, 1], [x1 - .001, -1]]) {
        addGrid(b.paint, 2, 1, (i, j) => [x, j ? y : yTop(x) - .002, (i - 1) * (j ? floorZ : body.edgeZ(x) * .91)], { color: [.82, .82, .82], mirror: false, out: [s, 0, 0], uv: () => [.0005, .0005] });
      }
      // Chasis a la vista: largueros y eje de atrás. Sin ellos la carrocería alta parece flotar.
      for (const z of [-.42, .42]) box(b.trim, [4.0, .11, .08], [-.2, .43, z], { color: COLOR.dark });
      tube(b.trim, [-1.35, .39, -.68], [-1.35, .39, .68], .05, 6, { color: COLOR.dark });
      box(b.trim, [.3, .24, .3], [-1.35, .39, 0], { color: COLOR.dark });
      // Estribo tubular.
      const sy = .44, sz = body.hw(0) + .05;
      tube(b.trim, [-.84, sy, sz], [1.14, sy, sz], .03, 6, { color: COLOR.silver, metal: .8, mirror: true });
      bar(b.trim, [-.55, sy + .01, sz - .02], [-.55, sy + .05, sz - .13], .04, .03, { color: COLOR.plastic, mirror: true });
      bar(b.trim, [.85, sy + .01, sz - .02], [.85, sy + .05, sz - .13], .04, .03, { color: COLOR.plastic, mirror: true });
      k.archTrim(.05, COLOR.plastic, .008);
      k.exhaust(-1.6, .48, -.72); k.antenna(1.42, 1.29, -.72, .35);
    },
  }),

  // Caja de los años 70: parabrisas vertical, techo plano, pilares delgados, llantas angostas y cromo.
  cajaSetentera: define({
    noseRake: [.05, .55, .4], tailRake: [.03, .55, .4],
    id: 'cajaSetentera', L: 3.67, W: 1.51, H: 1.55, wb: 2.44, r: .29, front: .73, archGap: .05,
    top: [[-1.835, 1.0], [-1.81, 1.03], [-1.79, 1.06], [-1.63, 1.50], [-1.56, 1.53], [-1.2, 1.55], [.2, 1.55], [.34, 1.53], [.42, 1.49], [.88, 1.075], [.94, 1.06], [1.3, 1.015], [1.68, .985], [1.79, .965], [1.835, .94]],
    edge: [[-1.835, .98], [-1.8, 1.01], [-1.77, 1.05], [-1.61, 1.44], [-1.52, 1.475], [-1.2, 1.485], [.2, 1.485], [.36, 1.44], [.80, 1.045], [.94, 1.03], [1.3, .985], [1.68, .955], [1.80, .935], [1.835, .915]],
    belt: [[-1.835, .965], [-1.7, 1.0], [-1.2, .995], [.3, .99], [.80, .995], [1.2, .965], [1.68, .94], [1.835, .905]],
    shoulder: [[-1.835, .70], [-1.2, .74], [0, .73], [1.2, .72], [1.835, .68]],
    bottom: [[-1.835, .42], [-1.7, .30], [-1.3, .24], [-.6, .24], [.7, .24], [1.5, .25], [1.75, .30], [1.835, .42]],
    noseLen: .42, noseN: 4, tailLen: .26, tailN: 4, crown: 3.4,
    edgeZ: [[-1.835, .55], [-1.7, .66], [-1.52, .62], [.2, .625], [.8, .68], [1.3, .68], [1.7, .66], [1.835, .55]],
    bow: [[-1.835, 0], [-1.7, -.02], [-1.5, -.02], [-1, 0], [.2, .02], [.8, .05], [1.2, .03], [1.835, 0]],
    windows: [[-1.50, -1.08], [-1.02, -.14], [-.08, .73]], windshield: [.40, .83], backlight: [-1.77, -1.62],
    keys: [-1.56, 1.68], frame: 'paint', pillar: 'paint', beltTrim: 'chrome', frameMargin: .012, windshieldFrit: .012, backlightFrit: .012,
    crease: .005, shelf: .965, rocker: .07,
    wheel: { rim: 'rimAcero', width: .135, depth: .03, spokes: 0, rimRatio: .62 },
    mirror: { x: .70, y: 1.04 }, wiper: 2,
    gaps: { doors: [[-.11, .78], [-1.05, -.11]], hood: 1.62, hatch: [-1.80, -1.62], fuel: [-1.40, .86] },
    interior: { dash: .68, seat: .02, rear: -.86, floor: .38, belt: 1.0, hw: .68, height: .5 },
    driver: { x: .04, z: -.32, h: 1.45 },
    parts(k) {
      const { body, b } = k;
      // Faros redondos sueltos, con parrilla de lámina clara entre ellos.
      k.head({ a0: .36, a1: .62, rows: 3, rect: RECT.headRedondo, bulge: .012, top: .905, bot: .725, off: .006 });
      k.grille({ a0: -.35, a1: .35, top: .895, bot: .735, rect: RECT.grilleLamas });
      k.frontTurn({ a0: .40, a1: .58, top: .70, bot: .655 });
      // Parachoques cromados de tubo, con sus topes de caucho.
      k.nose({ a0: -.70, a1: .70, top: .56, bot: .49, off: .05, bulge: .015, color: COLOR.chrome, metal: 1, rows: 2 });
      k.nose({ a0: .70, a1: .88, top: .56, bot: .49, off: .022, bulge: .01, color: COLOR.chrome, metal: 1, rows: 1 });
      k.tail({ a0: -.68, a1: .68, top: .54, bot: .47, off: .05, bulge: .015, color: COLOR.chrome, metal: 1, rows: 2 });
      k.tail({ a0: .68, a1: .84, top: .54, bot: .47, off: .022, bulge: .01, color: COLOR.chrome, metal: 1, rows: 1 });
      for (const z of [-.48, .48]) {
        box(b.trim, [.05, .12, .05], [body.xNose + .02, .52, z], { color: COLOR.rubber });
        box(b.trim, [.05, .12, .05], [body.xTail - .02, .50, z], { color: COLOR.rubber });
      }
      k.plateFront(.575, .145, .30);
      k.plateRear(.59);
      // Luces traseras simples: rectángulo rojo con el ámbar arriba.
      k.stop({ a0: .50, a1: .68, rows: 1, rect: RECT.tailRojo, flipU: true, top: .88, bot: .75 });
      k.rearTurn({ a0: .50, a1: .68, top: .92, bot: .885 });
      k.handle(-.04, .885, 'chrome', .12); k.handle(-.98, .885, 'chrome', .12);
      k.exhaust(-1.76, .30, -.40); k.antenna(.90, 1.05, -.62, .55);
    },
  }),

  // Sedán cuadrado de los 90 que sigue rodando: aristas, faros rectangulares, parachoques de plástico gris.
  sedanNoventero: define({
    noseRake: [.1, .55, .7], tailRake: [.05, .55, .6],
    id: 'sedanNoventero', L: 4.20, W: 1.65, H: 1.40, wb: 2.47, r: .29, front: .80,
    top: [[-2.10, 1.0], [-2.07, 1.03], [-2.02, 1.045], [-1.80, 1.055], [-1.24, 1.07], [-.72, 1.36], [-.62, 1.385], [.15, 1.40], [.33, 1.385], [.42, 1.35], [1.02, .985], [1.10, .975], [1.7, .92], [1.98, .885], [2.06, .865], [2.10, .845]],
    edge: [[-2.10, .98], [-2.05, 1.015], [-1.5, 1.03], [-1.20, 1.045], [-.68, 1.305], [-.4, 1.325], [.15, 1.33], [.36, 1.29], [.94, .955], [1.10, .94], [1.7, .89], [1.98, .855], [2.08, .835], [2.10, .825]],
    belt: [[-2.10, .965], [-2.0, 1.0], [-1.2, 1.015], [-.3, .975], [.5, .945], [.94, .945], [1.3, .92], [2.0, .845], [2.10, .815]],
    shoulder: [[-2.10, .80], [-1.5, .84], [0, .79], [1.3, .77], [2.05, .72], [2.10, .70]],
    bottom: [[-2.10, .46], [-1.98, .29], [-1.6, .22], [-1.0, .19], [.9, .19], [1.7, .20], [2.0, .25], [2.10, .38]],
    noseLen: .34, noseN: 4.2, tailLen: .26, tailN: 4.4, crown: 3.2,
    edgeZ: [[-2.10, .60], [-1.9, .72], [-1.20, .71], [-.68, .62], [.36, .62], [.94, .715], [1.6, .715], [2.0, .69], [2.10, .58]],
    bow: [[-2.10, 0], [-1.3, -.04], [-.8, -.03], [-.3, 0], [.3, .03], [.95, .07], [1.4, .03], [2.10, 0]],
    windows: [[-1.02, -.84], [-.78, -.05], [.02, .83]], windshield: [.38, .95], backlight: [-1.20, -.68],
    keys: [-1.8, 1.98], crease: .012, tuck: .985, shelf: .95,
    wheel: { rim: 'rimTapa', width: .165, depth: .016, spokes: 0 },
    mirror: { x: .78, y: .985 }, wiper: 2,
    gaps: { doors: [[0, .87], [-.82, 0]], hood: 1.96, trunk: -1.24, fuel: [-1.5, .90] },
    interior: { dash: .76, seat: .10, rear: -.62, floor: .34, belt: .97, hw: .74, height: .47 },
    driver: { x: .12, z: -.35, h: 1.30 },
    parts(k) {
      k.head({ a0: .24, a1: .74, rows: 1, rect: RECT.headRect, top: .79, bot: .645, bulge: 0, off: .005 });
      // Direccional en la esquina, a continuación del faro: al doblar hacia el jugador también se ve por delante.
      k.frontTurn({ a0: .74, a1: .86, top: .79, bot: .645 });
      k.grille({ a0: -.24, a1: .24, top: .78, bot: .66, rect: RECT.grilleLamas });
      // Parachoques de plástico gris que envuelve las esquinas, con su caucho negro.
      k.nose({ a0: -.78, a1: .78, top: .615, bot: .42, off: .024, bulge: .004, color: COLOR.gray, rows: 2 });
      k.nose({ a0: .78, a1: 1.06, top: .615, bot: .46, off: .014, color: COLOR.gray, rows: 1 });
      k.nose({ a0: -.45, a1: .45, top: .40, bot: .30, off: .006, color: COLOR.plastic, rows: 1 });
      k.plateFront(.43, .155, .32, .03);
      k.stop({ a0: .30, a1: .66, rows: 1, rect: RECT.tailBarras, flipU: true, top: .95, bot: .80 });
      k.rearTurn({ a0: .66, a1: .82, top: .95, bot: .80 });
      k.reverse({ a0: .24, a1: .30, top: .95, bot: .80 });
      k.tail({ a0: -.78, a1: .78, top: .615, bot: .42, off: .024, bulge: .004, color: COLOR.gray, rows: 2 });
      k.tail({ a0: .78, a1: 1.0, top: .615, bot: .46, off: .014, color: COLOR.gray, rows: 1 });
      k.plateRear(.635, .155, .32);
      // Bocel negro lateral de los 90.
      patchSide(k.b.trim, k.body, { x0: k.spec.axleR + k.spec.archR + .02, x1: k.spec.axleF - k.spec.archR - .02, bot: .54, top: .585, off: .01, cols: 6, rows: 1, color: COLOR.plastic });
      k.handle(-.02, .85, 'trim'); k.handle(-.78, .87, 'trim');
      k.exhaust(-2.04, .28, -.46); k.antenna(.98, .96, -.72, .4);
    },
  }),

  // Furgoneta pequeña de carga: cara plana y corta, puerta corrediza, sin ventanas atrás.
  furgon: define({
    sillCut: 0.064,
    noseRake: [.26, .6, .6], tailRake: [.01, .7, .3],
    id: 'furgon', L: 4.05, W: 1.60, H: 1.90, wb: 2.70, r: .30, front: .63, archGap: .05,
    top: [[-2.025, 1.76], [-2.01, 1.82], [-1.99, 1.85], [-1.86, 1.885], [.6, 1.90], [1.0, 1.885], [1.12, 1.85], [1.72, 1.13], [1.78, 1.115], [1.92, 1.08], [2.0, 1.05], [2.025, 1.02]],
    edge: [[-2.025, 1.72], [-2.0, 1.79], [-1.97, 1.82], [-1.8, 1.845], [.6, 1.855], [1.04, 1.80], [1.62, 1.105], [1.78, 1.085], [1.92, 1.05], [2.0, 1.02], [2.025, 1.0]],
    belt: [[-2.025, 1.08], [-1.5, 1.10], [.5, 1.10], [1.62, 1.09], [1.78, 1.07], [1.92, 1.035], [2.025, .985]],
    shoulder: [[-2.025, .90], [0, .90], [1.6, .88], [2.025, .78]],
    bottom: [[-2.025, .42], [-1.9, .32], [-1.5, .27], [.8, .25], [1.7, .27], [1.95, .30], [2.025, .40]],
    noseLen: .34, noseN: 3.2, tailLen: .10, tailN: 5, crown: 3.6,
    edgeZ: [[-2.025, .68], [-1.97, .71], [.6, .715], [1.04, .70], [1.62, .74], [1.85, .72], [2.025, .6]],
    bow: [[-2.025, 0], [-1.5, 0], [0, 0], [1.04, .035], [1.62, .06], [1.85, .03], [2.025, 0]],
    windows: [[.42, 1.52]], windshield: [1.07, 1.66],
    keys: [-1.8, 1.85, -1.99, .32], frameMargin: .02, windshieldFrit: .025, tuck: .985, shelf: .985,
    noseSteps: [[.62, .014]], flare: .006,
    lowLine: [[-2.025, .545], [-1.7, .545], [-1.3, .66], [-.9, .56], [.95, .56], [1.4, .66], [1.75, .62], [2.025, .62]],
    crease: .003,
    wheel: { rim: 'rimAcero', width: .175, depth: .03, spokes: 0, rimRatio: .62 },
    mirror: { x: 1.55, y: 1.13 }, wiper: 2,
    gaps: { doors: [[.36, 1.58], [-.84, .36]], hood: 1.84, fuel: [-1.42, .92] },
    interior: { dash: 1.40, seat: .86, rear: null, floor: .56, belt: 1.10, hw: .70, height: .52, back: .34 },
    driver: { x: .88, z: -.36, h: 1.76 },
    parts(k) {
      const { body, b } = k;
      k.optic('furgonHead'); k.optic('furgonGrille');
      // Parte baja negra grande, con su toma de aire.
      k.panel('nose', [[0, .41], [0, .56], [.60, .56], [.78, .60], [.86, .55], [.84, .36], [.7, .365], [.4, .39]], { off: .007 });
      k.optic('furgonIntake', { off: .011 });
      k.plateFront(.60);
      // Stops verticales altos en las esquinas de las puertas traseras.
      k.optic('furgonTail');
      k.panel('tail', [[0, .43], [0, .50], [.78, .50], [.82, .36], [.7, .345], [.35, .40]], { off: .012 });
      k.reflex(.60, .76, .52, .55);
      k.platePocket('tail', .58, .17, .34); k.plateRear(.58);
      // Puertas traseras ciegas: la junta central y la manija.
      k.tail({ a0: -.006, a1: .006, top: 1.74, bot: .52, off: .004, color: COLOR.dark, rows: 1 });
      k.tail({ a0: .02, a1: .17, top: 1.09, bot: 1.04, off: .008, color: COLOR.plastic, rows: 1 });
      // Riel de la puerta corrediza.
      patchSide(b.trim, body, { x0: -1.30, x1: -.20, bot: 1.06, top: 1.085, off: .006, cols: 4, rows: 1, color: COLOR.plastic });
      k.handle(.28, 1.02, 'trim'); k.handle(1.46, 1.0, 'trim'); k.handle(-.72, 1.0, 'trim');
      k.skirt(-.95, 1.0, .06);
      k.bocel(-.95, 1.0, .62, .04);
      k.repeater(1.65, .95);
      k.exhaust(-1.9, .32, -.42); k.antenna(1.10, 1.87, 0, .16);
    },
  }),

  // Buseta de ruta: cara vertical con parabrisas enorme, ventanas seguidas, tablero de ruta y franjas.
  buseta: define({
    noseRake: [.02, 1.0, .1], tailRake: [.01, 1.0, .1],
    id: 'buseta', L: 7.6, W: 2.3, H: 3.0, wb: 4.0, r: .46, front: 1.25, archGap: .06,
    top: [[-3.8, 2.72], [-3.77, 2.88], [-3.6, 2.98], [3.2, 3.0], [3.5, 2.97], [3.62, 2.86], [3.74, 2.12], [3.78, 1.56], [3.795, 1.45], [3.8, 1.42]],
    edge: [[-3.8, 2.68], [-3.75, 2.84], [-3.5, 2.92], [3.2, 2.94], [3.5, 2.92], [3.62, 2.80], [3.74, 2.07], [3.78, 1.48], [3.8, 1.40]],
    belt: [[-3.8, 1.60], [-3.5, 1.62], [3.2, 1.62], [3.6, 1.6], [3.8, 1.38]],
    shoulder: [[-3.8, 1.30], [0, 1.32], [3.5, 1.30], [3.8, 1.1]],
    bottom: [[-3.8, .62], [-3.6, .50], [-2, .44], [2, .42], [3.5, .44], [3.8, .55]],
    noseLen: .30, noseN: 3.6, tailLen: .28, tailN: 3.6, crown: 4, shelf: .99, tuck: .99,
    edgeZ: [[-3.8, .9], [-3.6, 1.04], [3.2, 1.06], [3.62, 1.02], [3.78, .96], [3.8, .9]],
    bow: [[-3.8, 0], [3.3, 0], [3.62, .02], [3.78, .012], [3.8, 0]],
    windows: [[-3.42, -2.32], [-2.24, -1.14], [-1.06, .04], [.12, 1.22], [1.30, 2.40], [2.48, 3.30]],
    windshield: [3.62, 3.78], backlight: [-3.74, -3.6], crease: .003, frameMargin: .03,
    windshieldFrit: .01, backlightFrit: .008, keys: [-3.6, 3.5, 3.2], maxGap: 1.2,
    wheel: { rim: 'rimBuseta', width: .25, depth: .03, spokes: 0, rimRatio: .58 },
    mirror: { x: 3.42, y: 2.22, big: true }, wiper: 2.1, frame: 'trim', pillar: 'trim',
    gaps: { fuel: null },
    // Franjas de la empresa: dan la vuelta completa porque la cola y la cara usan la misma carta lateral.
    detail(ctx, { sy, W }) {
      const band = (y0, y1, color) => { ctx.fillStyle = color; ctx.fillRect(0, sy(y1), W, sy(y0) - sy(y1)); };
      band(1.02, 1.30, BUS_BLUE);
      band(.93, .985, '#c4202a');
      band(1.335, 1.385, '#c4202a');
      band(2.78, 2.9, BUS_BLUE);
    },
    interior: { dash: 3.34, seat: 2.72, rear: null, floor: .92, belt: 1.60, hw: 1.0, height: .65, wheelZ: .55, front: 3.58 },
    // Su única puerta va adelante, del lado de la acera (ver parts): por ahí se baja el conductor.
    driver: { x: 2.74, z: -.55, h: 2.15, door: { x: 3.34, side: 1 } },
    parts(k) {
      const { body, b } = k;
      // Tablero de ruta tras el parabrisas: lo primero que se busca de lejos en una buseta.
      const y0 = 2.40, y1 = 2.72, x = body.xNose - .10;
      addGrid(b.lamp, 2, 1, (i, j) => [x + .0, y0 + (y1 - y0) * j, (i - 1) * .78], { uv: (u, v) => rectUv(RECT.route0, 1 - u, 1 - v), mirror: false, lamp: LAMP.ROUTE, out: [1, 0, 0], color: [1, 1, 1] });
      // Los mismos cuadros bajos de todas las busetas: faros cuadrados y gran defensa.
      k.head({ a0: .62, a1: .95, rows: 1, rect: RECT.headCuadrado, top: 1.20, bot: .95, bulge: 0, off: .012 });
      k.head({ a0: .30, a1: .60, rows: 1, rect: RECT.headCuadrado, top: 1.20, bot: .95, bulge: 0, off: .012 });
      k.frontTurn({ a0: .95, a1: 1.08, top: 1.20, bot: .95, off: .012 });
      k.grille({ a0: -.29, a1: .29, top: 1.22, bot: .96, rect: RECT.grilleLamas });
      k.nose({ a0: -1.12, a1: 1.12, top: .80, bot: .50, off: .03, color: COLOR.plastic, rows: 1 });
      k.plateFront(.62);
      k.stop({ a0: .78, a1: 1.05, rows: 2, rect: RECT.tailRojo, flipU: true, top: 1.46, bot: 1.16 });
      k.rearTurn({ a0: .78, a1: 1.05, top: 1.15, bot: 1.04 });
      k.tail({ a0: -1.12, a1: 1.12, top: .84, bot: .58, off: .03, color: COLOR.plastic, rows: 1 });
      k.plateRear(.92);
      k.skirt(-2.8, 1.3, .08);
      k.exhaust(-3.7, .58, -.82);
      // Nombre de la empresa sobre la franja, a ambos lados.
      patchSide(b.lamp, body, { x0: -1.46, x1: -.31, bot: 1.035, top: 1.285, rect: RECT.busName, lamp: LAMP.OFF, off: .004, cols: 3, rows: 1, color: [1, 1, 1] });
      // Puerta de dos hojas adelante del eje, solo al lado de la acera (+Z): se sube junto al conductor.
      for (const [x0, x1] of [[3.09, 3.335], [3.345, 3.59]]) {
        patchSide(b.trim, body, { x0, x1, bot: .56, top: 2.60, cols: 1, rows: 1, off: .008, color: COLOR.dark, mirror: false });
        patchSide(b.trim, body, { x0: x0 + .035, x1: x1 - .035, bot: .98, top: 2.54, cols: 1, rows: 1, off: .012, color: [.05, .065, .075], metal: .35, mirror: false });
      }
      // Ventana de atrás, grande, con su marco de caucho.
      k.tail({ a0: -.93, a1: .93, top: 2.66, bot: 1.70, off: .006, color: COLOR.dark, rows: 1 });
      k.tail({ a0: -.88, a1: .88, top: 2.62, bot: 1.75, off: .01, color: [.045, .06, .07], metal: .4, rows: 1 });
      // Filas de asientos: se alcanzan a ver por las ventanas.
      for (let i = 0; i < 6; i++) {
        const x = -2.95 + i * .96;
        box(b.trim, [.09, .82, 1.9], [x, 1.46, 0], { color: [.1, .12, .17] });
      }
    },
  }),
  // Camioneta grande y negra de la limpieza social: no circula con la flota, solo llega por el jugador.
  camionetaNegra: define({
    sillCut: 0.124,
    noseRake: [.08, .8, .5], tailRake: [.03, .8, .4],
    id: 'camionetaNegra', L: 5.0, W: 2.02, H: 2.0, wb: 2.96, r: .42, front: .94, archGap: .075,
    top: [[-2.5, 1.42], [-2.45, 1.50], [-2.28, 1.88], [-2.2, 1.95], [-2.0, 1.985], [-1, 2.0], [.3, 2.0], [.62, 1.98], [.78, 1.93], [1.42, 1.42], [1.5, 1.40], [2.0, 1.37], [2.36, 1.34], [2.46, 1.31], [2.5, 1.27]],
    edge: [[-2.5, 1.39], [-2.42, 1.47], [-2.24, 1.78], [-2.1, 1.86], [-1, 1.88], [.3, 1.88], [.72, 1.82], [1.32, 1.385], [1.5, 1.36], [2.0, 1.33], [2.36, 1.30], [2.46, 1.275], [2.5, 1.24]],
    belt: [[-2.5, 1.37], [-2.3, 1.38], [-1.5, 1.38], [.5, 1.34], [1.32, 1.34], [1.6, 1.31], [2.36, 1.285], [2.5, 1.23]],
    shoulder: [[-2.5, 1.14], [-1.6, 1.12], [0, 1.1], [1.5, 1.1], [2.36, 1.04], [2.5, .98]],
    bottom: [[-2.5, .62], [-2.3, .5], [-1.8, .4], [-1, .38], [1.1, .38], [1.9, .42], [2.36, .5], [2.5, .62]],
    noseLen: .44, noseN: 4, tailLen: .3, tailN: 4, crown: 3.4, flare: .018, rocker: .13,
    edgeZ: [[-2.5, .8], [-2.3, .88], [-2.1, .82], [.72, .80], [1.32, .92], [2.0, .92], [2.36, .88], [2.5, .7]],
    bow: [[-2.5, 0], [-2.3, -.02], [-1.8, -.02], [-1, 0], [.5, .04], [1.3, .09], [1.8, .04], [2.5, 0]],
    windows: [[-1.92, -1.42], [-1.34, -.32], [-.24, 1.12]], windshield: [.72, 1.32], backlight: [-2.33, -2.2],
    keys: [-2.0, 2.0, 2.36], crease: .012,
    wheel: { rim: 'rimAleacion', width: .29, depth: .036, spokes: 6, rimRatio: .62 },
    mirror: { x: 1.0, y: 1.42 }, wiper: 2,
    gaps: { doors: [[-.28, 1.16], [-1.36, -.28]], hood: 2.34, hatch: [-2.44, -2.2], fuel: [-1.72, 1.2] },
    interior: { dash: 1.0, seat: .3, rear: -.8, floor: .62, belt: 1.34, hw: .92, height: .6 },
    driver: { x: .32, z: -.44, h: 1.84 },
    parts(k) {
      k.head({ a0: .46, a1: 1.06, rows: 2, rect: RECT.headFino, top: [[.46, 1.25], [1.06, 1.25]], bot: [[.46, 1.11], [1.06, 1.14]] });
      k.grille({ a0: -.46, a1: .46, top: 1.26, bot: .90, rect: RECT.grilleLamas });
      for (const y of [1.16, 1.06, .96]) k.nose({ a0: -.46, a1: .46, top: y + .03, bot: y, off: .014, color: COLOR.chrome, metal: 1, rows: 1 });
      k.nose({ a0: -.48, a1: .48, top: 1.28, bot: 1.25, off: .012, color: COLOR.chrome, metal: 1, rows: 1 });
      k.nose({ a0: -1, a1: 1, top: .78, bot: .50, off: .016, color: COLOR.plastic, rows: 2 });
      k.grille({ a0: -.55, a1: .55, top: .72, bot: .58, rect: RECT.grilleMalla, off: .02 });
      k.nose({ a0: -.5, a1: .5, top: .54, bot: .50, off: .024, color: COLOR.silver, metal: .75, rows: 1 });
      k.fog({ a0: .68, a1: .84, top: .72, bot: .60, off: .02 });
      k.plateFront(.79);
      k.stop({ a0: .72, a1: .96, rows: 3, rect: RECT.tailBarras, flipU: true, top: 1.44, bot: 1.05 });
      k.plateRear(1.02);
      k.tail({ a0: -1, a1: 1, top: .80, bot: .52, off: .016, color: COLOR.plastic, rows: 2 });
      k.tail({ a0: -.72, a1: .72, top: 1.0, bot: .985, off: .004, color: COLOR.chrome, metal: 1, rows: 1 });
      k.archTrim(.07);
      k.skirt(-1.36, 1.16, .12, COLOR.plastic, .012);
      const sz = k.body.hw(0) + .06;
      tube(k.b.trim, [-1.36, .44, sz], [1.16, .44, sz], .036, 6, { color: COLOR.chrome, metal: 1, mirror: true });
      bar(k.b.trim, [-1.0, .45, sz - .02], [-1.0, .5, sz - .16], .05, .03, { color: COLOR.plastic, mirror: true });
      bar(k.b.trim, [.8, .45, sz - .02], [.8, .5, sz - .16], .05, .03, { color: COLOR.plastic, mirror: true });
      k.handle(-.16, 1.2, 'chrome'); k.handle(-1.2, 1.22, 'chrome');
      k.roofRails(-1.9, .36, .68);
      k.exhaust(-2.4, .5, -.62); k.antenna(-1.4, 1.99, 0, .2);
    },
  }),
};

export const CAR_MODEL_IDS = Object.keys(CAR_MODELS).filter(id => id !== 'camionetaNegra');

// Mezcla de particulares que se ve en la calle: suma 100. La buseta circula por su cuenta y no entra aquí.
export const PRIVATE_MIX = [['citadino', 18], ['sedanPopular', 18], ['hatchPopular', 14], ['suv', 14], ['sedanDeportivo', 12], ['sedanNoventero', 8], ['pickup', 6], ['furgon', 5], ['cajaSetentera', 5]];

// Colores reales de calle: mucho blanco, plata, gris y negro; algo de rojo vino, azul oscuro y rojo.
// El blanco de un carro no es blanco puro: si lo fuera se quema al sol y se pierde la forma de la carrocería.
const STREET = ['#cdd0d0', '#cdd0d0', '#cdd0d0', '#b6bbc0', '#b6bbc0', '#b6bbc0', '#7e8388', '#7e8388', '#1b1d20', '#1b1d20', '#5e1218', '#16294d', '#a11915'];
export const MODEL_PAINTS = {
  citadino: [...STREET, '#a11915', '#2f6d9c'],
  sedanPopular: [...STREET, '#3b3a35'],
  hatchPopular: [...STREET, '#a35322', '#2d4f6b'],
  sedanDeportivo: ['#cdd0d0', '#b6bbc0', '#7e8388', '#1b1d20', '#1b1d20', '#8d1016', '#8d1016', '#16294d'],
  suv: [...STREET, '#39403a', '#8a8069'],
  pickup: ['#cdd0d0', '#cdd0d0', '#cdd0d0', '#b6bbc0', '#7e8388', '#1b1d20', '#5e1218', '#23344f'],
  cajaSetentera: ['#d5cdb3', '#507889', '#904b39', '#52644b', '#bd9a58', '#e0ddd0', '#c6702b', '#36507a'],
  sedanNoventero: ['#b6bbc0', '#7e8388', '#7e6a55', '#2e3a4f', '#5e1218', '#d2d2c8', '#2d4a3a', '#1b1d20'],
  furgon: ['#d0d3d3', '#d0d3d3', '#d0d3d3', '#d0d3d3', '#d0d3d3', '#b6bbc0'],
  buseta: ['#f4f2ea', '#efeee0', '#e6ebea'],
  camionetaNegra: ['#07080a'],
};
export const TAXI_COLOR = taxiYellow[0];
export const POLICE_COLOR = '#cfd2d2';
