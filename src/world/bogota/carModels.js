// src/world/bogota/carModels.js
// La flota: cada modelo es un juego de curvas y piezas. Los identificadores describen el tipo de carro;
// ningún nombre, logo ni emblema de marca: lo que se reconoce es la silueta y las proporciones.
// Coordenadas en metros desde el centro de la huella: X hacia el frente, Y arriba.
import * as THREE from 'three';
import { lerp } from './carLoft.js';
import { RECT, rectUv, dayDrop, dayHeadRect } from './carAtlas.js';
import { BUS_ESCAPE, BUS_NUMERO, BUS_PAINTS, DAMERO_ALTO, TAXI_YELLOWS, conAzarPropio, esTaxi, pintarDamero, pintarLibreaBuseta, pintarMugreBuseta, pintarPanelesBuseta, rutaDe } from './carLibreas.js';
import { COLOR, PATCH_FLAG, patchAround, patchOutline, patchSide, patchTop, seamLine, box, bar, tube, addGrid, addGeo } from './carParts.js';
import { OPTICS } from './carLamps.js';
import { TECHO, TUBOS, TUBO_LARGO } from './pasajerosBuseta.js';
import { addBusetaInterior } from './BusetaInterior.js';

// Canales de lámpara del material de luces.
// PLATE (10) desplaza la UV a la celda de placa del carro; ROUTE (27) al tablero de su ruta y se enciende como SIGN.
// LIVERY (20) baja a la fila de la ruta como ROUTE, pero no enciende: es pintura, no un letrero.
export const LAMP = Object.freeze({ OFF: 0, HEAD: 1, TAIL: 2, LEFT: 3, RIGHT: 4, BLUE: 5, RED: 6, SIGN: 7, PLATE: 10, LIVERY: 20, ROUTE: 27 });
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
    optic(name, { rows = 2, off = null, bezel = 0 } = {}) {
      const o = OPTICS[name];
      if (bezel > 0) {
        seamLine(b.trim, body, o.end, [...o.outline, o.outline[0]], {
          width: bezel * 2, off: .009, color: COLOR.rubber, maxStep: .09,
        });
      }
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
    interior({ dash, seat, rear = null, floor = .42, belt, hw, height = .5, wheelZ = .37, tapiceria = null }) {
      const dark = COLOR.dash;
      const cloth = tapiceria ? { color: [1, 1, 1], uv: (u, v) => rectUv(tapiceria, u, 1 - v) } : { color: COLOR.seat };
      box(b.trim, [.34, .14, hw * 1.86], [dash, belt - .06, 0], { color: dark });
      box(b.trim, [.20, .24, hw * 1.7], [dash + .08, belt - .22, 0], { color: dark });
      for (const z of [-wheelZ, wheelZ]) {
        box(b.trim, [.46, .12, .46], [seat - .02, floor + .10, z], cloth);
        bar(b.trim, [seat - .22, floor + .12, z], [seat - .31, floor + height + .10, z], .10, .44, cloth);
        box(b.trim, [.09, .16, .24], [seat - .33, floor + height + .23, z], cloth);
      }
      if (rear !== null) {
        box(b.trim, [.46, .12, hw * 1.6], [rear, floor + .08, 0], cloth);
        bar(b.trim, [rear - .22, floor + .10, 0], [rear - .28, floor + height + .02, 0], .10, hw * 1.6, cloth);
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

/** Franja ajedrezada del taxi: 10 cm bajo las ventanas, de arco a arco; crece hacia abajo para no subirse a las manijas. */
export function dameroDe(spec, body) {
  const stripeY = spec.stripeY ?? (x => body.shoulder(x) - DAMERO_ALTO);
  return { stripeY, x0: spec.axleR + spec.archR + .02, x1: spec.axleF - spec.archR - .02 };
}

/** Distintivos que dependen del tipo: capacete y calcomanías de taxi, franja y luces de patrulla. */
export function addKindParts(k, kind) {
  const { body, b, spec } = k;
  if (kind === 'taxi') {
    const rx = spec.taxiRoofX ?? (spec.windshield[0] - .45);
    // El acrílico del capacete se recoge hacia el techo y curva sus hombros. Las cinco caras comparten el canal del aviso.
    const y = body.topY(rx, 0), signW = .63, zSteps = [-1, -.81, 0, .81, 1];
    box(b.trim, [.27, .048, signW + .06], [rx, y + .016, 0], { color: COLOR.trim });
    const signPoint = (sx, i, j) => {
      const z = zSteps[i], h = .178 - .044 * Math.abs(z) ** 4;
      return [rx + sx * lerp(.118, .076, j), y + .04 + h * j, z * signW / 2 * lerp(1, .93, j)];
    };
    for (const sx of [1, -1]) {
      addGrid(b.lamp, 4, 1, (i, j) => signPoint(sx, i, j), {
        uv: (u, v) => rectUv(RECT.sign, (1 - sx * zSteps[Math.round(u * 4)]) / 2, 1 - v),
        color: [1, 1, 1], lamp: LAMP.SIGN, mirror: false, out: [sx, 0, 0],
      });
    }
    addGrid(b.lamp, 4, 1, (i, j) => signPoint(j ? 1 : -1, i, 1), { color: [.5, .4, .09], lamp: LAMP.SIGN, mirror: false, out: [0, 1, 0] });
    addGrid(b.lamp, 2, 1, (i, j) => signPoint(i - 1, 4, j), {
      uv: (u, v) => rectUv(RECT.sign, .085 * (1 - Math.abs(2 * u - 1)), 1 - v), color: [.8, .8, .8], lamp: LAMP.SIGN, out: [0, 0, 1] });
    // El damero va pintado en el mapa de detalle (ver dameroDe). Las letras de las puertas, siempre bajo él para que no las tape.
    const { stripeY } = dameroDe(spec, body);
    const [frontDoor, rearDoor] = spec.gaps?.doors ?? [[.1, .9], [-.8, .1]];
    const under = (x0, x1) => Math.min(stripeY(x0), stripeY(x1)) - .012;
    // Puerta trasera: número interno grande y placa, una celda por placa.
    // Con bocel a media puerta (taxiDoorTop), los rótulos van debajo de él: encima no caben y el bocel les taparía un renglón.
    const dx = spec.decalX ?? ((rearDoor[0] + rearDoor[1]) / 2 + .04), dw = .25, dTop = spec.taxiDoorTop ?? under(dx - dw, dx + dw);
    patchSide(b.lamp, body, { x0: dx - dw, x1: dx + dw, bot: dTop - .25, top: dTop, rect: RECT.door, lamp: LAMP.PLATE, off: .004, cols: 3, rows: 3, color: [1, 1, 1], flipU: false });
    // Puerta delantera: empresa y teléfono inventados; cada modelo de taxi es de una afiliadora distinta.
    const ex = (frontDoor[0] + frontDoor[1]) / 2, ew = .32, eTop = spec.taxiDoorTop ?? under(ex - ew, ex + ew);
    patchSide(b.lamp, body, { x0: ex - ew, x1: ex + ew, bot: eTop - .16, top: eTop, rect: spec.id === 'citadino' ? RECT.taxiEmpresa0 : RECT.taxiEmpresa1, lamp: LAMP.OFF, off: .004, cols: 4, rows: 2, color: [1, 1, 1], flipU: false });
    // Placa pintada en el techo para que se lea desde arriba.
    patchTop(b.lamp, body, { x0: rx - .66, x1: rx - .26, z0: .40, z1: -.40, cols: 2, rows: 4, off: .005, color: [1, 1, 1], lamp: LAMP.PLATE,
      uvFn: (u, v) => rectUv(RECT.roof, v, u) });
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

/** Defensa envolvente con cantos que se recogen en la chapa y una cara abombada que recoge la luz. */
function bumper(k, end, { span, bot, top, depth, color = COLOR.plastic, metal = 0, taper = .045 }) {
  const corner = a => (a / span) ** 4 * taper;
  patchAround(k.b.trim, k.body, end, {
    a0: -span, a1: span, bot: a => bot + corner(a), top: a => top - corner(a) * .45,
    off: .004, bulge: depth, rows: 4, maxStep: .14, metal,
    color: (u, v) => color.map(c => c * lerp(.58, 1.12, v)),
  });
}

/** El bisel metálico y el vidrio quedan a distintas profundidades en el faro antiguo. */
function roundHead(k, a, y, r) {
  const circle = size => Array.from({ length: 16 }, (_, i) => {
    const t = Math.PI * 2 * i / 16;
    return [a + size * Math.cos(t), y + size * Math.sin(t)];
  });
  k.panel('nose', circle(r + .026), { color: COLOR.rubber, off: .009, bulge: .012, rows: 3 });
  k.panel('nose', circle(r + .014), { color: COLOR.chrome, metal: .84, off: .023, bulge: .009, rows: 3 });
  const rect = RECT.headRedondo;
  patchOutline(k.b.lamp, k.body, 'nose', {
    outline: circle(r), rect, rows: 4, off: .035, bulge: .014,
    color: [1, 1, 1], lamp: LAMP.HEAD, metal: dayDrop(rect, dayHeadRect(rect)),
  });
  k.spec.headFlare = k.body.around('nose', a, y, .055);
}

function roofGutter(k, x0, x1) {
  // Vierteaguas plegado a lo largo del techo. En las puntas vuelve a meterse en la carrocería.
  addGrid(k.b.trim, 12, 2, (i, j) => {
    const x = lerp(x0, x1, i / 12), z = k.body.edgeZ(x);
    const width = i === 0 || i === 12 ? .004 : .024;
    return [x, k.body.edge(x) + [.006, .011, -.014][j], z + [-.010, width, width][j]];
  }, { color: COLOR.silver, metal: .68, out: [0, 1, .5] });
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

// El primero es el esmalte de hoy; los otros dos esperan a que la fábrica elija amarillo por carro (ver carLibreas.js).
const taxiYellow = TAXI_YELLOWS;

export const CAR_MODELS = {
  // Citadino alto y corto, con guardabarros abultados, capó bajo y faros que ascienden hacia los pilares.
  citadino: define({
    sillCut: .092,
    hoodPress: { root: .75, tip: .52, depth: .025 },
    noseRake: [.29, .54, 1.15], tailRake: [.10, .56, .85],
    noseSteps: [[.548, .024]], tailSteps: [[.58, .038]],
    id: 'citadino', L: 3.64, W: 1.60, H: 1.52, wb: 2.38, r: .29, front: .66, flare: .017,
    top: [[-1.82, 1.075], [-1.79, 1.175], [-1.68, 1.38], [-1.55, 1.475], [-1.41, 1.505], [-1.14, 1.52], [-.45, 1.52], [-.04, 1.50], [.15, 1.46], [.32, 1.37], [.85, 1.01], [.96, .975], [1.28, .917], [1.55, .864], [1.71, .824], [1.82, .777]],
    edge: [[-1.82, 1.02], [-1.76, 1.145], [-1.64, 1.345], [-1.50, 1.41], [-1.15, 1.433], [-.42, 1.44], [-.04, 1.416], [.13, 1.382], [.77, .981], [.96, .944], [1.28, .880], [1.55, .823], [1.72, .791], [1.82, .752]],
    belt: [[-1.82, .98], [-1.62, 1.065], [-1.31, 1.07], [-.90, 1.025], [-.30, .971], [.34, .935], [.77, .951], [1.24, .866], [1.55, .808], [1.82, .745]],
    shoulder: [[-1.82, .80], [-1.43, .92], [-1.0, .895], [-.25, .817], [.76, .767], [1.15, .748], [1.52, .701], [1.82, .663]],
    lowLine: [[-1.82, .578], [-1.5, .59], [-1.17, .606], [-.81, .541], [.65, .475], [1.16, .576], [1.52, .543], [1.82, .543]],
    lowDepth: .014, rocker: .10,
    bottom: [[-1.82, .353], [-1.69, .301], [-1.45, .231], [-.95, .211], [.74, .211], [1.42, .242], [1.68, .263], [1.82, .303]],
    plan: [[-1.82, .94], [-1.29, 1], [-.78, .985], [.32, .972], [1.16, 1], [1.55, .988], [1.82, .938]],
    noseLen: .64, noseN: 2.65, tailLen: .33, tailN: 3.55,
    edgeZ: [[-1.82, .58], [-1.65, .69], [-1.49, .624], [-.66, .616], [.13, .598], [.77, .696], [1.19, .735], [1.55, .689], [1.82, .57]],
    bow: [[-1.82, 0], [-1.67, -.03], [-1.32, -.045], [-.65, 0], [.13, .050], [.77, .112], [1.04, .070], [1.48, .026], [1.82, 0]],
    windows: [[-1.39, -1.13], [-1.065, -.27], [-.193, .685]], windshield: [.13, .77], backlight: [-1.758, -1.51],
    keys: [-1.69, -1.47, -.65, .99, 1.55], frameMargin: .025, pillarTop: 'black',
    crease: .016, wheel: { rim: 'rimTapa', width: .165, depth: .023, spokes: 0 },
    mirror: { x: .63, y: 1.000 }, wiper: 2,
    gaps: { doors: [[-.23, .735], [-1.10, -.23]], hood: 1.61, hatch: [-1.78, -1.45], fuel: [-1.38, .92] },
    interior: { dash: .55, seat: .02, rear: -.78, floor: .36, belt: .96, hw: .70, height: .55, tapiceria: RECT.seatVinilo },
    driver: { x: .03, z: -.34, h: 1.42 },
    parts(k) {
      k.optic('citadinoHead', { rows: 3, off: .014, bezel: .012 });
      k.optic('citadinoGrille', { off: .012 });
      k.chrome('nose', [[0, .731], [.20, .728], [.254, .709]], .012, .014);
      k.optic('citadinoIntake', { off: .013 });
      k.optic('citadinoFog', { off: .014 });
      k.plateFront(.473, .155, .34, .024);
      bumper(k, 'nose', { span: .77, bot: .309, top: .353, depth: .037, taper: .018 });
      k.panel('tail', OPTICS.citadinoTail.outline, { off: .012, rows: 2, color: COLOR.rubber });
      k.optic('citadinoTail', { rows: 3, off: .020 });
      // El portón recoge la placa en la chapa y termina por encima de la defensa negra.
      k.seam('tail', [[.39, 1.091], [.401, .76], [.372, .615], [0, .607]], .008);
      k.platePocket('tail', .714, .17, .34); k.plateRear(.714, .17, .34, .018);
      k.tail({ a0: -.21, a1: .21, top: .935, bot: .903, off: .011, bulge: .012, color: COLOR.dark, rows: 2 });
      bumper(k, 'tail', { span: .84, bot: .359, top: .51, depth: .035 });
      k.reflex(.55, .72, .516, .554);
      k.rearWiper(); k.spoiler(-1.49, -1.59, .52, 1.50, .030);
      k.handle(-.02, .887); k.handle(-.91, .959, 'paint', .125);
      k.repeater(.86, .827);
      k.skirt(-.88, .82, .084);
      k.exhaust(-1.74, .307, -.43); k.antenna(-1.15, 1.507, 0, .195);
    },
  }),

  // Sedán popular: cabina vertical, capó alto y plano, baúl largo y cuadrado, barra cromada en la parrilla.
  sedanPopular: define({
    sillCut: 0.079,
    hoodPress: { root: .77, tip: .58, depth: .023 },
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
    mirror: { x: .94, y: 1.03 }, wiper: 2, taxiDoorTop: .575,
    gaps: { doors: [[.02, 1.05], [-.86, .02]], hood: 1.96, trunk: -1.40, fuel: [-1.62, .96] },
    interior: { dash: .92, seat: .25, rear: -.62, floor: .36, belt: 1.0, hw: .78, height: .52, tapiceria: RECT.seat },
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

  // Compacto de cinco puertas de finales de los ochenta, con poca altura, cintura recta y un portón inclinado.
  hatchPopular: define({
    sillCut: .058,
    noseRake: [.19, .53, 1.04], tailRake: [.12, .54, .82],
    noseSteps: [[.575, .037]], tailSteps: [[.578, .042]],
    id: 'hatchPopular', L: 4.06, W: 1.73, H: 1.55, wb: 2.59, r: .31, front: .80, flare: .008,
    top: [[-2.03, .858], [-1.985, .925], [-1.84, 1.08], [-1.60, 1.322], [-1.46, 1.414], [-1.32, 1.452], [-.91, 1.462], [.07, 1.456], [.30, 1.438], [.43, 1.405], [1.045, .946], [1.16, .916], [1.48, .881], [1.82, .833], [1.97, .811], [2.03, .793]],
    edge: [[-2.03, .835], [-1.98, .895], [-1.81, 1.064], [-1.57, 1.302], [-1.42, 1.387], [-1.25, 1.408], [-.85, 1.418], [.06, 1.41], [.39, 1.368], [.99, .919], [1.16, .896], [1.48, .857], [1.82, .807], [1.98, .781], [2.03, .767]],
    belt: [[-2.03, .817], [-1.83, .902], [-1.52, .926], [-.5, .920], [.42, .902], [.99, .901], [1.48, .845], [1.82, .806], [2.03, .757]],
    shoulder: [[-2.03, .74], [-1.73, .815], [-1.28, .803], [.75, .772], [1.55, .725], [2.03, .637]],
    lowLine: [[-2.03, .567], [-1.73, .577], [-1.35, .565], [-.87, .477], [.72, .459], [1.19, .550], [1.65, .562], [2.03, .560]],
    lowDepth: .009,
    bottom: [[-2.03, .355], [-1.90, .29], [-1.65, .232], [-1.21, .204], [.85, .204], [1.67, .234], [1.94, .277], [2.03, .334]],
    plan: [[-2.03, .96], [-1.72, .975], [-1.28, .984], [.9, .984], [1.24, .995], [1.70, .97], [2.03, .94]],
    noseLen: .38, noseN: 4.2, tailLen: .30, tailN: 4.25, crown: 3.4, tuck: .978,
    edgeZ: [[-2.03, .65], [-1.80, .73], [-1.56, .685], [-1.27, .618], [.39, .623], [.99, .732], [1.54, .755], [1.83, .730], [2.03, .61]],
    bow: [[-2.03, 0], [-1.78, -.041], [-1.45, -.026], [-.95, 0], [.39, .039], [.99, .045], [1.51, .014], [2.03, 0]],
    windows: [[-1.57, -.30], [-.218, .872]], windshield: [.39, .99], backlight: [-1.89, -1.48],
    keys: [-1.72, -1.32, .10, 1.15, 1.82], frameMargin: .024, backlightFrit: .02, pillar: 'trim',
    crease: .012, wheel: { rim: 'rimAcero', width: .156, depth: .025, spokes: 0, rimRatio: .593 },
    mirror: { x: .775, y: .945 }, wiper: 2,
    gaps: { doors: [[-.263, .913], [-1.49, -.263]], hood: 1.85, hatch: [-1.99, -1.46], fuel: [-1.67, .832] },
    interior: { dash: .75, seat: .10, rear: -.76, floor: .36, belt: .917, hw: .74, height: .49, tapiceria: RECT.seatPopular },
    driver: { x: .12, z: -.38, h: 1.35 },
    parts(k) {
      k.optic('hatchPopularHead', { off: .016, bezel: .011 });
      k.optic('hatchPopularGrille', { off: .012 });
      // Traviesa del color de la chapa y defensa de plástico que gira hasta los guardabarros.
      patchAround(k.b.paint, k.body, 'nose', { a0: -.238, a1: .238, bot: .691, top: .719, rows: 2, off: .018, bulge: .005, color: [1, 1, 1], uv: () => [.0005, .0005] });
      bumper(k, 'nose', { span: .95, bot: .339, top: .595, depth: .042, taper: .053, color: COLOR.plasticLight });
      k.optic('hatchPopularIntake', { off: .053 });
      k.plateFront(.502, .14, .34, .048);
      k.optic('hatchPopularTail', { off: .014, bezel: .010 });
      k.seam('tail', [[.393, 1.02], [.343, .871], [.339, .610], [0, .600]], .008);
      k.platePocket('tail', .643, .164, .34); k.plateRear(.643, .164, .34, .020);
      k.tail({ a0: -.22, a1: .22, top: .848, bot: .817, off: .017, color: COLOR.dark, rows: 1 });
      bumper(k, 'tail', { span: .94, bot: .362, top: .588, depth: .040, taper: .058, color: COLOR.plasticLight });
      k.reflex(.56, .725, .595, .620);
      k.handle(-.10, .850, 'trim', .141); k.handle(-1.16, .864, 'trim', .135);
      k.bocel(-.962, .849, .548, .045);
      k.repeater(1.01, .791);
      k.skirt(-.96, .86, .062);
      k.rearWiper();
      k.exhaust(-1.94, .303, -.48); k.antenna(.377, 1.417, -.46, .19);
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

  // Caja de los setenta, con guardabarros altos, tres vidrios por costado, techo de canaleta y portón casi vertical.
  cajaSetentera: define({
    noseRake: [.035, .52, .52], tailRake: [.037, .54, .51],
    noseSteps: [[.585, .018]], tailSteps: [[.55, .014]],
    id: 'cajaSetentera', L: 3.67, W: 1.51, H: 1.55, wb: 2.44, r: .29, front: .73, archGap: .05,
    top: [[-1.835, 1.139], [-1.806, 1.24], [-1.747, 1.415], [-1.682, 1.525], [-1.585, 1.543], [-1.31, 1.55], [.18, 1.55], [.368, 1.541], [.435, 1.504], [.832, 1.055], [.95, 1.037], [1.25, 1.02], [1.63, .986], [1.772, .967], [1.835, .951]],
    edge: [[-1.835, 1.08], [-1.802, 1.201], [-1.742, 1.395], [-1.675, 1.467], [-1.52, 1.483], [.19, 1.485], [.393, 1.447], [.776, 1.025], [.95, 1.009], [1.29, .988], [1.65, .955], [1.78, .932], [1.835, .925]],
    belt: [[-1.835, .925], [-1.72, .96], [-1.19, .958], [.38, .960], [.78, .993], [1.23, .963], [1.63, .927], [1.835, .902]],
    shoulder: [[-1.835, .659], [-1.41, .732], [-1.04, .724], [.62, .705], [1.095, .777], [1.46, .756], [1.835, .687]],
    bottom: [[-1.835, .414], [-1.70, .306], [-1.34, .249], [-.62, .237], [.69, .237], [1.54, .264], [1.75, .316], [1.835, .395]],
    plan: [[-1.835, .955], [-1.48, .973], [-1.30, .969], [.40, .936], [1.105, .977], [1.53, .979], [1.835, .933]],
    noseLen: .352, noseN: 5, tailLen: .26, tailN: 4.4, crown: 4.3,
    edgeZ: [[-1.835, .575], [-1.70, .654], [-1.55, .60], [.34, .597], [.79, .664], [1.24, .69], [1.66, .656], [1.835, .55]],
    bow: [[-1.835, 0], [-1.70, -.018], [-1.52, -.020], [-1.29, 0], [.35, .025], [.795, .052], [1.09, .016], [1.835, 0]],
    windows: [[-1.599, -1.165], [-1.068, -.233], [-.156, .697]], windshield: [.392, .793], backlight: [-1.821, -1.687],
    keys: [-1.665, -.4, .30, .995, 1.64], frame: 'paint', pillar: 'paint', beltTrim: 'chrome', frameMargin: .020, windshieldFrit: .014, backlightFrit: .009,
    crease: .008, shelf: .941, rocker: .063, tuck: .982, flare: .062, rearFlare: .024, flareShoulder: .78,
    wheel: { rim: 'rimAcero', width: .135, depth: .03, spokes: 0, rimRatio: .608 },
    mirror: { x: .661, y: 1.035 }, wiper: 2,
    gaps: { doors: [[-.198, .745], [-1.115, -.198]], hood: 1.64, hatch: [-1.823, -1.680], fuel: [-1.43, .858] },
    interior: { dash: .673, seat: .02, rear: -.86, floor: .38, belt: .961, hw: .656, height: .5, tapiceria: RECT.seatClasico },
    driver: { x: .04, z: -.32, h: 1.45 },
    parts(k) {
      const { body, b } = k;
      // Parrilla de aluminio con los dos faros encastrados y una pareja de direccionales de vidrio ámbar debajo.
      k.panel('nose', [[0, .700], [0, .944], [.467, .944], [.565, .922], [.615, .895], [.654, .849], [.657, .767], [.624, .716], [.567, .700]], { color: COLOR.gray, metal: .53, off: .009, rows: 2 });
      k.grille({ a0: -.357, a1: .357, top: .920, bot: .725, rect: RECT.grilleClasica, metal: .48, off: .014 });
      k.chrome('nose', [[0, .930], [.397, .930], [.474, .917]], .015, .019);
      k.chrome('nose', [[0, .717], [.42, .719], [.581, .719]], .016, .018);
      roundHead(k, .491, .797, .115);
      k.frontTurn({ a0: .477, a1: .639, top: .651, bot: .594, off: .011 });
      patchTop(b.trim, body, { x0: .828, x1: .908, z0: -.370, z1: .370, cols: 1, rows: 5, off: .015, rect: RECT.grilleLamas, color: [1, 1, 1] });
      bumper(k, 'nose', { span: .869, bot: .448, top: .552, depth: .054, taper: .019, color: COLOR.chrome, metal: .84 });
      bumper(k, 'tail', { span: .853, bot: .423, top: .53, depth: .053, taper: .019, color: COLOR.chrome, metal: .84 });
      for (const [end, y] of [['nose', .501], ['tail', .478]]) {
        const pad = body.around(end, .42, y, .046);
        box(b.trim, [.053, .139, .067], pad, { color: COLOR.rubber, mirror: true });
      }
      k.plateFront(.554, .135, .30, .022);
      k.plateRear(.619, .149, .32, .018);
      k.seam('tail', [[.48, 1.159], [.542, 1.052], [.542, .749], [.51, .558], [0, .561]], .008);
      k.tail({ a0: .554, a1: .684, top: .954, bot: .696, off: .010, rows: 2, color: COLOR.rubber });
      k.stop({ a0: .568, a1: .668, rows: 2, rect: RECT.tailRojo, flipU: true, top: .883, bot: .713, off: .015 });
      k.rearTurn({ a0: .568, a1: .668, top: .937, bot: .886, off: .016 });
      k.spec.tailFlare = body.around('tail', .618, .798, .03);
      k.chrome('tail', [[0, .831], [.108, .831]], .026, .022);
      roofGutter(k, -1.638, .421);
      k.bocel(-.983, .735, .639, .035, COLOR.plasticLight);
      k.rearWiper();
      k.handle(-.05, .887, 'chrome', .131); k.handle(-.985, .899, 'chrome', .131);
      k.exhaust(-1.76, .30, -.40); k.antenna(.898, 1.036, -.579, .43);
    },
  }),

  // Sedán cuadrado de los 90 que sigue rodando: aristas, faros rectangulares, parachoques de plástico gris.
  sedanNoventero: define({
    hoodPress: { root: .73, tip: .65, depth: .019 },
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
    wheel: { rim: 'rimAcero', stamped: true, width: .165, depth: .034, spokes: 0 },
    mirror: { x: .78, y: .985 }, wiper: 2,
    gaps: { doors: [[0, .87], [-.82, 0]], hood: 1.96, trunk: -1.24, fuel: [-1.5, .90] },
    interior: { dash: .76, seat: .10, rear: -.62, floor: .34, belt: .97, hw: .74, height: .47 },
    driver: { x: .12, z: -.35, h: 1.30 },
    parts(k) {
      k.head({ a0: .24, a1: .74, rows: 1, rect: RECT.headRect, top: .79, bot: .645, bulge: 0, off: .005 });
      // Direccional en la esquina, a continuación del faro: al doblar hacia el jugador también se ve por delante.
      k.frontTurn({ a0: .74, a1: .86, top: .79, bot: .645 });
      k.grille({ a0: -.24, a1: .24, top: .78, bot: .66, rect: RECT.grilleLamas });
      bumper(k, 'nose', { span: 1.06, bot: .41, top: .621, depth: .045, color: COLOR.gray });
      k.nose({ a0: -.45, a1: .45, top: .40, bot: .30, off: .006, color: COLOR.plastic, rows: 1 });
      k.plateFront(.43, .155, .32, .053);
      k.stop({ a0: .30, a1: .66, rows: 1, rect: RECT.tailBarras, flipU: true, top: .95, bot: .80 });
      k.rearTurn({ a0: .66, a1: .82, top: .95, bot: .80 });
      k.reverse({ a0: .24, a1: .30, top: .95, bot: .80 });
      bumper(k, 'tail', { span: 1.02, bot: .415, top: .621, depth: .047, color: COLOR.gray });
      k.platePocket('tail', .635, .155, .32);
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
    // El zócalo, más oscuro y sucio que el resto del esmalte, con su filete, y encima las franjas de la empresa, que
    // cambian con la ruta (la variante del mapa: «ruta0» a «ruta3»).
    detail(ctx, carta) {
      const { sy, W, variante = '' } = carta;
      const band = (y0, y1, color) => { ctx.fillStyle = color; ctx.fillRect(0, sy(y1), W, sy(y0) - sy(y1)); };
      band(.40, .9, 'rgba(88,78,64,.19)');
      band(.888, .91, 'rgba(50,44,36,.25)');
      pintarLibreaBuseta(ctx, carta, rutaDe(variante));
      pintarPanelesBuseta(ctx, carta);
      pintarMugreBuseta(ctx, carta, this.windows.map(([x0]) => x0 - .03), -this.L / 2, 2.95, BUS_ESCAPE);
    },
    interior: { dash: 3.34, seat: 2.72, rear: null, floor: .92, belt: 1.60, hw: 1.0, height: .65, wheelZ: .55, front: 3.58 },
    // Su única puerta va adelante, del lado de la acera (ver parts): por ahí se baja el conductor.
    driver: { x: 2.74, z: -.55, h: 2.15, door: { x: 3.34, side: 1 } },
    parts(k) {
      const { body, b } = k;
      // El tablero alto se inclina con el panorámico y deja libres el marco y la vista del conductor.
      addGrid(b.lamp, 2, 1, (i, j) => {
        const y = lerp(2.30, 2.75, j);
        return [body.around('nose', .89, y, -.009)[0], y, (i - 1) * .835];
      }, { uv: (u, v) => rectUv(RECT.route0, 1 - u, 1 - v), mirror: false, lamp: LAMP.ROUTE, out: [1, 0, 0], color: [1, 1, 1] });
      // Los mismos cuadros bajos de todas las busetas: faros cuadrados y gran defensa.
      k.head({ a0: .62, a1: .95, rows: 1, rect: RECT.headCuadrado, top: 1.20, bot: .95, bulge: 0, off: .012 });
      k.head({ a0: .30, a1: .60, rows: 1, rect: RECT.headCuadrado, top: 1.20, bot: .95, bulge: 0, off: .012 });
      k.frontTurn({ a0: .95, a1: 1.08, top: 1.20, bot: .95, off: .012 });
      k.grille({ a0: -.29, a1: .29, top: 1.22, bot: .96, rect: RECT.grilleLamas });
      // Defensas de plástico negro con uso: barro seco que sube desde abajo y raspones grises en las esquinas.
      const usada = semilla => (u, v) => {
        const ruido = n => { const t = Math.sin(u * 127.1 + v * 311.7 + (semilla + n) * 74.7) * 43758.5453; return t - Math.floor(t); };
        const barro = Math.pow(1 - v, 1.4) * (.25 + .6 * ruido(1)), raspon = v > .4 && Math.abs(u - .5) > .3 && ruido(2) > .55 ? .5 : ruido(3) * .12;
        return COLOR.plastic.map((c, i) => c + ([.15, .105, .062][i] - c) * barro + ([.1, .1, .095][i] - c) * raspon * (1 - barro));
      };
      k.nose({ a0: -1.12, a1: 1.12, top: .80, bot: .50, off: .03, color: usada(1), rows: 2, maxStep: .17 });
      k.plateFront(.816, .138, .34);
      k.stop({ a0: .78, a1: 1.05, rows: 2, rect: RECT.tailRojo, flipU: true, top: 1.46, bot: 1.16 });
      k.rearTurn({ a0: .78, a1: 1.05, top: 1.15, bot: 1.04 });
      k.tail({ a0: -1.12, a1: 1.12, top: .84, bot: .58, off: .03, color: usada(2), rows: 2, maxStep: .17 });
      k.plateRear(.92);
      k.skirt(-2.8, 1.3, .08);
      // Tubo de escape: asoma bajo la defensa, a la izquierda de la cola, con la boca negra.
      tube(b.trim, [-3.56, BUS_ESCAPE.y, -BUS_ESCAPE.z], [-3.81, BUS_ESCAPE.y, -BUS_ESCAPE.z], .045, 8, { color: [.045, .04, .036], metal: .35 });
      conAzarPropio(0xB05E7E, () => tube(b.trim, [-3.8, BUS_ESCAPE.y, -BUS_ESCAPE.z], [-3.814, BUS_ESCAPE.y, -BUS_ESCAPE.z], .034, 8, { color: COLOR.liner }));
      // Nombre de la empresa de la ruta, entre los ejes: solo las letras, recortadas sobre la franja pintada en la chapa.
      patchSide(b.lamp, body, { x0: -1.9, x1: 1.3, bot: 1.0, top: 1.40, rect: RECT.busLibrea, lamp: LAMP.LIVERY, off: .004, cols: 5, rows: 1, color: [1, 1, 1], flipU: false });
      // Los cartones quedan dentro del campo de vidrio, del lado de la acera.
      patchAround(b.lamp, body, 'nose', { a0: .015, a1: .437, top: 2.20, bot: 1.91, rows: 1, off: .009, rect: RECT.busCarton0, lamp: LAMP.LIVERY, color: [1, 1, 1], flipU: true, mirror: false });
      patchAround(b.lamp, body, 'nose', { a0: .458, a1: .797, top: 2.135, bot: 1.91, rows: 1, off: .009, rect: RECT.busCarton1, lamp: LAMP.LIVERY, color: [1, 1, 1], flipU: true, mirror: false });
      // Las dos hojas, sus bisagras y el peldaño usan una sola superficie del lado de la acera (+Z).
      patchSide(b.trim, body, { x0: 3.08, x1: 3.60, bot: .56, top: 2.67, cols: 2, rows: 2, off: .011,
        color: [1, 1, 1], uv: (u, v) => rectUv(RECT.busDoor, v, u), mirror: false });
      conAzarPropio(0xB05E7A, () => {
        // Techo, que es lo que más se ve desde arriba: dos claraboyas grises con su marco y las cornetas del pito adelante.
        for (const x of [1.25, -1.7]) {
          const y = body.topY(x, 0);
          box(b.trim, [.74, .02, .74], [x, y + .008, 0], { color: COLOR.rubber });
          box(b.trim, [.6, .05, .6], [x, y + .035, 0], { color: (_, yp) => yp > y + .036 ? [.45, .48, .45] : [.23, .25, .23], metal: .14 });
        }
        const hornY = body.topY(2.9, .26) + .05;
        tube(b.trim, [2.62, hornY, .26], [3.02, hornY, .26], .032, 6, { color: COLOR.chrome, metal: 1, mirror: true });
        tube(b.trim, [3.02, hornY, .26], [3.12, hornY, .26], .06, 6, { color: COLOR.chrome, metal: 1, mirror: true });
      });
      // Ventanas corredizas: el travesaño de aluminio que parte cada vidrio y la hoja de arriba, que es la que se abre.
      const aluminio = (_, v) => v ? [.39, .42, .42] : [.16, .18, .18];
      for (const [x0, x1] of k.spec.windows.slice(0, 5)) {
        patchSide(b.trim, body, { x0: x0 + .03, x1: x1 - .03, bot: 2.275, top: 2.315, cols: 1, rows: 1, off: .009, color: aluminio, metal: .34 });
        patchSide(b.trim, body, { x0: (x0 + x1) / 2 - .018, x1: (x0 + x1) / 2 + .018, bot: 2.315, top: 2.80, cols: 1, rows: 1, off: .009, color: aluminio, metal: .34 });
      }
      // Calcomanía de «¿Cómo conduzco?» entre la franja y la ventana de atrás, corrida a un lado.
      patchAround(b.lamp, body, 'tail', { a0: -.82, a1: -.22, top: 1.66, bot: 1.46, rows: 1, off: .006, rect: RECT.busConduzco, lamp: LAMP.OFF, color: [1, 1, 1], mirror: false });
      // Número interno y placa, a brocha: en el recuadro que la franja deja libre en el voladizo trasero y en la cola,
      // al otro lado de la calcomanía. Cada buseta lleva el de su placa.
      patchSide(b.lamp, body, { x0: BUS_NUMERO.x0 + .02, x1: BUS_NUMERO.x1 - .02, bot: BUS_NUMERO.y0 + .01, top: BUS_NUMERO.y1 - .01, rect: RECT.door, lamp: LAMP.PLATE, off: .004, cols: 2, rows: 1, color: [1, 1, 1], flipU: false });
      patchAround(b.lamp, body, 'tail', { a0: .2, a1: .7, top: 1.69, bot: 1.44, rows: 1, off: .006, rect: RECT.door, lamp: LAMP.PLATE, color: [1, 1, 1], mirror: false });
      // Ventana de atrás, grande, con su marco de caucho.
      k.tail({ a0: -.93, a1: .93, top: 2.66, bot: 1.70, off: .006, color: COLOR.dark, rows: 1 });
      k.tail({ a0: -.88, a1: .88, top: 2.62, bot: 1.75, off: .01, color: [.045, .06, .07], metal: .4, rows: 1 });
      // Rutero de atrás, pegado por dentro al vidrio: el mismo tablero de la ruta, que de noche se enciende con el de adelante.
      patchAround(b.lamp, body, 'tail', { a0: -.46, a1: .46, top: 2.60, bot: 2.31, rows: 1, off: .014, rect: RECT.route0, lamp: LAMP.ROUTE, color: [1, 1, 1] });
      // Y abajo, la frase que el dueño mandó pintar: solo las letras, sobre el vidrio oscuro.
      patchAround(b.lamp, body, 'tail', { a0: -.4, a1: .4, top: 2.16, bot: 1.84, rows: 1, off: .014, rect: RECT.busFrase, lamp: LAMP.LIVERY, color: [1, 1, 1] });
      addBusetaInterior(b, k.spec.interior.floor, LAMP.SIGN);
      // Y el cielo raso, que es lo que se ve encendido desde la calle, a la altura de un peatón. De cerca lo tapa el
      // pintado, con su mugre (pasajerosBuseta.js); los cuatro tubos cuelgan debajo y son lo más claro de la buseta.
      addGrid(b.lamp, 4, 1, (i, j) => [lerp(-3.52, 3.3, i / 4), 2.86, j ? -.9 : .9], { color: [.3, .37, .52], lamp: LAMP.SIGN, mirror: false, out: [0, -1, 0] });
      conAzarPropio(0xB05E7B, () => {
        for (const x of TUBOS) box(b.lamp, [TUBO_LARGO, .04, .07], [x, TECHO.y - .026, 0], { color: [1.5, 1.72, 3.9], lamp: LAMP.SIGN });
      });
    },
  }),
  // Camioneta grande y negra de la limpieza social: no circula con la flota, solo llega por el jugador.
  camionetaNegra: define({
    sillCut: 0.124,
    hoodPress: { root: .72, tip: .61, depth: .029 },
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

// Cualquier modelo puede salir de taxi: con esa librea, su mapa de detalle suma el damero a lo que el modelo ya pinta.
for (const spec of Object.values(CAR_MODELS)) {
  const propio = spec.detail;
  spec.detail = (ctx, carta) => {
    propio?.call(spec, ctx, carta);
    if (!esTaxi(carta.variante ?? '')) return;
    const { stripeY, x0, x1 } = dameroDe(spec, carta.body);
    pintarDamero(ctx, carta, x0, x1, stripeY);
  };
}

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
  buseta: BUS_PAINTS,
  camionetaNegra: ['#07080a'],
};
export const TAXI_COLOR = taxiYellow[0];
export const POLICE_COLOR = '#cfd2d2';
