import * as THREE from 'three';
import { MeshKit, rgb, shade } from './MeshKit.js';
import { withVisualRandom } from './VisualRandom.js';

const IVORY = rgb('#d4c4a4'), PLASTER = rgb('#998773'), SHADOW = rgb('#6b6152');
const TILE = rgb('#b9aa8d'), STEEL = rgb('#777963'), EDGE = rgb('#b4b49c');
const GREEN = rgb('#547064'), WOOD = rgb('#856348'), AMBER = rgb('#cb812b'), OIL_SHOULDER = rgb('#e3ae4d');
const LAMP = rgb('#fff0d0'), PAPER = rgb('#ddd4bc'), TIN = rgb('#a9a296');
const OIL_LABELS = ['#486045', '#264e67'].map(color => rgb(color));
const CAN_LABELS = ['#a75037', '#687849'].map(color => rgb(color));
const COFFEE = [['#613935', '#c98552', '#703629'], ['#48455b', '#b77261', '#612f3c']].map(colors => colors.map(color => rgb(color)));
const GRAIN = [['#bb9a5c', '#793e30', '#dfb076'], ['#9c9764', '#616146', '#d7bf83']].map(colors => colors.map(color => rgb(color)));
const MILK = [['#c2d3cf', '#38628a', '#75a3ab'], ['#d9d3ae', '#3e775f', '#82a690']].map(colors => colors.map(color => rgb(color)));
const STOCK = [
  ['grano', 'grano', 'lata', 'lata', 'cafe', 'cafe', 'leche', 'leche', 'grano', 'grano'],
  ['lata', 'lata', 'grano', 'grano', 'leche', 'leche', 'cafe', 'cafe'],
  ['aceite', 'aceite', 'cafe', 'cafe', 'leche', 'leche', 'grano', 'grano']
];
const NO_BASE = 'ny';

const face = (kit, x, y, z, w, h, color) => kit.quad(
  [x, y, z + w / 2], [x, y, z - w / 2], [x, y + h, z - w / 2], [x, y + h, z + w / 2],
  color, { normal: [1, 0, 0] }
);

function room(kit, { back, glass, bottom, top, z, width, lining }) {
  const depth = glass - back;
  const reveal = lining - back;
  // La pared de fondo sigue en sombra y el techo recibe algo de luz del tubo.
  kit.alphaValue = .19;
  face(kit, back, bottom, z, width, top - bottom, [SHADOW, SHADOW, PLASTER, PLASTER]);
  // Las caras interiores terminan en el canto posterior del marco, sin quedar una encima de otra.
  kit.alphaValue = .24;
  kit.box(back + reveal / 2, bottom - .025, z, reveal, .05, width, TILE, { skip: 'ny nz pz nx px' });
  kit.box(back + reveal / 2, top + .02, z, reveal, .04, width, shade(IVORY, .72), { skip: 'py nz pz nx px' });
  for (const side of [-1, 1]) {
    kit.box(back + reveal / 2, (top + bottom) / 2, z + side * (width / 2 + .005), reveal, top - bottom, .01,
      shade(PLASTER, side < 0 ? .73 : .93), { bottom: .66, skip: side < 0 ? 'nx px py ny nz' : 'nx px py ny pz' });
  }
  kit.alphaValue = .43;
  for (const side of [-1, 1]) {
    kit.box(back + depth * .56, top - .139, z + side * width * .31, .024, .278, .038, shade(STEEL, .77), { skip: 'py ny' });
  }
  kit.box(back + depth * .56, top - .285, z, .115, .046, width * .77, STEEL, { skip: 'ny' });
  kit.alphaValue = 2.2;
  kit.box(back + depth * .56, top - .309, z, .061, .017, width * .72, LAMP, { skip: 'py' });
}

function oil(kit, x, y, z, w, h, variant) {
  const d = .096, onFront = x + d / 2 + .001;
  kit.box(x, y + h * .365, z, d, h * .73, w * .8, AMBER, { bottom: .57, top: 1.17, skip: 'py ny' });
  kit.frustum(x, z, y + h * .73, y + h * .89, d, w * .8, .043, w * .36, OIL_SHOULDER);
  kit.box(x, y + h * .945, z, .047, h * .11, w * .44, OIL_LABELS[variant], { skip: NO_BASE });
  face(kit, onFront, y + h * .17, z, w * .77, h * .3, OIL_LABELS[variant]);
  face(kit, onFront + .001, y + h * .33, z + w * .053, w * .47, h * .072, PAPER);
  face(kit, onFront, y + h * .515, z + w * .31, w * .069, h * .195, shade(OIL_SHOULDER, 1.14));
}

function can(kit, x, y, z, w, h, variant) {
  const r = w * .445, front = x + r * Math.sqrt(3) / 2 + .001;
  kit.tube([[x, y, z], [x, y + h, z]], r, 6, CAN_LABELS[variant], { caps: false, twist: 0 });
  kit.disc([x, y + h, z], [0, 1, 0], r, 6, shade(TIN, .71), { edge: TIN });
  face(kit, front, y + h * .25, z, w * .40, h * .105, PAPER);
  face(kit, front, y + h * .77, z, w * .43, h * .175, TIN);
}

function bag(kit, x, y, z, w, h, colors, coffee) {
  const [base, label, emblem] = colors;
  const neck = coffee ? .78 : .67;
  const d0 = coffee ? .069 : .122, d1 = coffee ? .136 : .172;
  kit.frustum(x, z, y, y + h * neck, d0, w * .88, d1, w, base, { bottom: .7, skipTop: true });
  kit.frustum(x, z, y + h * neck, y + h, d1, w, coffee ? .032 : .059, w * .85, shade(base, 1.12));
  const front = (u, t, clearance = .0015) => [x + (d0 + (d1 - d0) * t / neck) / 2 + clearance, y + h * t, z + u * w];
  const stripe = (bottom, top, width, color) => kit.quad(front(width, bottom), front(-width, bottom),
    front(-width, top), front(width, top), color, { facing: [1, 0, 0] });
  if (coffee) {
    stripe(.22, .61, .38, label);
    stripe(.09, .15, .42, label);
    kit.quad(front(.22, .432, .003), front(.025, .31, .003), front(-.22, .434, .003), front(-.025, .548, .003),
      emblem, { facing: [1, 0, 0] });
  } else {
    stripe(.25, .52, .43, label);
    for (const [u, t] of [[-.245, .38], [.0, .417], [.245, .359]]) {
      kit.quad(front(u + .059, t, .003), front(u + .005, t - .044, .003), front(u - .062, t, .003), front(u - .007, t + .047, .003),
        emblem, { facing: [1, 0, 0] });
    }
  }
}

function carton(kit, x, y, z, w, h, variant) {
  const [paper, label, accent] = MILK[variant];
  const front = x + .067, rear = x - .067, shoulder = y + h * .8, crest = y + h;
  kit.box(x, (y + shoulder) / 2, z, front - rear, shoulder - y, w, paper, { bottom: .72, skip: 'py ny' });
  for (const side of [-1, 1]) {
    const edge = z + side * w / 2;
    kit.quad([rear, shoulder, edge], [front, shoulder, edge], [front, crest, z], [rear, crest, z],
      shade(paper, side > 0 ? .91 : 1.08), { facing: [0, 1, side] });
  }
  kit.quad([front, shoulder, z + w / 2], [front, shoulder, z - w / 2], [front, crest, z], [front, crest, z],
    shade(paper, .93), { facing: [1, 0, 0] });
  face(kit, front + .001, y + h * .19, z, w * .94, h * .345, label);
  kit.quad([front + .002, y + h * .17, z + w * .47], [front + .002, y + h * .28, z - w * .47],
    [front + .002, y + h * .35, z - w * .47], [front + .002, y + h * .26, z + w * .47], accent, { facing: [1, 0, 0] });
}

export function addD69Display(kit, opening, originalRows) {
  const { back, glass, bottom, z, width } = opening;
  const previousLight = kit.alphaValue;
  room(kit, opening);
  const depth = glass - back;
  const lip = glass - .118;
  const levels = [bottom + .12, bottom + .51, bottom + 1.76];
  // La última hilera queda por encima de las ofertas; las otras se alcanzan a ver por debajo.
  for (const u of [-1.32, -.08, 1.32]) {
    kit.alphaValue = .44;
    kit.box(back + .082, (bottom + levels[2]) / 2, z + u, .06, levels[2] - bottom + .17, .038, STEEL, { skip: NO_BASE });
  }
  for (let row = 0; row < levels.length; row++) {
    const surface = levels[row];
    kit.alphaValue = .62 + row * .12;
    kit.box((back + lip) / 2, surface - .021, z, lip - back - .012, .04, width - .22, STEEL, { bottom: .64, skip: 'nx' });
    face(kit, lip - .005, surface - .034, z, width - .27, .018, EDGE);
    const stock = originalRows[row];
    for (let i = 0; i < stock.length; i++) {
      const { u, w, h, kind } = stock[i];
      const style = STOCK[row][i], variant = (kind + i) % 2;
      const front = back + depth * (.48 + (i % 3) * .055);
      const center = z + width / 2 - u - w / 2;
      kit.alphaValue = [.66, .79, .99][row] - (i % 3) * .055;
      if (style === 'aceite') {
        oil(kit, front, surface, center - w * .218, w * .365, .198 + h * .29, variant);
        oil(kit, front - .072, surface, center + w * .208, w * .4, .174 + h * .29, variant);
      } else if (style === 'lata') {
        const height = .063 + h * .17;
        can(kit, front, surface, center, w * .76, height, variant);
        if (i % 2 === 0) can(kit, front, surface + height, center, w * .76, height, variant);
      } else if (style === 'leche') {
        carton(kit, front, surface, center, w * .73, .143 + h * .49, variant);
      } else if (style === 'cafe') {
        bag(kit, front, surface, center, w * .73, .131 + h * .48, COFFEE[variant], true);
      } else {
        bag(kit, front, surface, center, w * .93, .104 + h * .48, GRAIN[variant], false);
      }
    }
  }
  kit.alphaValue = previousLight;
}

export function addD69Vestibule(kit, opening, floor) {
  const { back, z } = opening;
  const previousLight = kit.alphaValue;
  room(kit, { ...opening, bottom: floor });
  kit.alphaValue = .39;
  face(kit, back + .002, floor + 1.36, z, opening.width, .085, GREEN);
  // Una caja al costado deja ver el piso y la pared a través de las dos hojas de la puerta.
  const registerZ = z - .80, counter = floor + .85;
  kit.box(back + .224, floor + .41, registerZ, .345, .82, .96, WOOD, { bottom: .63, skip: 'nx ny' });
  kit.alphaValue = .60;
  kit.box(back + .224, counter, registerZ, .405, .047, 1.02, shade(IVORY, .83), { skip: NO_BASE });
  kit.box(back + .25, counter + .057, registerZ - .2, .242, .076, .255, STEEL, { skip: NO_BASE });
  kit.box(back + .204, counter + .148, registerZ - .2, .095, .117, .233, SHADOW, { skip: NO_BASE });
  kit.alphaValue = previousLight;
}

export function createD69Glass(openings) {
  return withVisualRandom(() => {
    const kit = new MeshKit({ alpha: true });
    const tint = (color, alpha) => [...rgb(color), alpha];
    const shadeBelow = tint('#605142', .13), shadeAbove = tint('#a4b9bb', .19);
    const reflection = [tint('#b4c3bd', .07), tint('#c7d2ca', .12)];
    for (const { glass, bottom, top, z, width } of openings) {
      face(kit, glass, bottom, z, width, top - bottom, [shadeBelow, shadeBelow, shadeAbove, shadeAbove]);
      const left = z + width / 2;
      kit.quad([glass + .003, bottom, left - .53], [glass + .003, bottom, left - .98],
        [glass + .003, top, left - 1.925], [glass + .003, top, left - 1.475],
        [reflection[0], reflection[0], reflection[1], reflection[1]], { normal: [1, 0, 0] });
    }
    const pane = new THREE.Mesh(kit.geometry(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    pane.name = 'Vidrio oriental de Doña Inés';
    pane.userData.noMerge = true;
    pane.userData.visualOnly = true;
    return pane;
  });
}
