import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { vestirCaja, vestirBloque } from './concretoViaducto.js';
import { MeshKit, rgb } from './MeshKit.js';
import { withVisualRandom } from './VisualRandom.js';
import { bridgeCenter } from './Colpatria.js';
import { viaductHeight } from './ColpatriaViaduct.js';

/** Una malla por material, incluso cuando la obra deja un vano entre dos tramos. */
export function metroBoxes(boxes, { concrete = false, slab = false } = {}) {
  const parts = boxes.map(([w, h, d, x, y, z], index) => {
    const create = () => new THREE.BoxGeometry(w, h, d);
    const geometry = index ? withVisualRandom(create) : create();
    if (concrete) vestirCaja(geometry, w, d, { losa: slab });
    return geometry.translate(x, y, z);
  });
  if (parts.length === 1) return parts[0];
  const joined = withVisualRandom(() => mergeGeometries(parts));
  for (const part of parts) part.dispose();
  return joined;
}

function metroDetail(group, geometry, material, name, castShadow = false) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.userData.visualOnly = true;
  group.add(mesh);
  return mesh;
}

const colors = {
  steel: rgb('#536466'), flange: rgb('#778581'), joint: rgb('#3f4c4b'),
  curb: rgb('#a9aaa0'), pad: rgb('#8b8b82'), black: rgb('#242a28'), warning: rgb('#dda831')
};

export function metroCivilMaterials() {
  return withVisualRandom(() => new THREE.MeshStandardMaterial({
    name: 'Acero pintado del Metro', vertexColors: true, roughness: .79, metalness: .16
  }));
}

export function metroPortalSpan(group, metro, endZ, concrete, steel) {
  withVisualRandom(() => {
    const { x, zStart, trackHeight, deckWidth } = metro;
    const supportZ = zStart + .15, bottom = trackHeight - .97;
    // La cercha pasa sobre la cubierta del Portal y la pasarela. Los apoyos caen en la barrera existente y la primera pila.
    const pier = new THREE.BoxGeometry(2.5, bottom, .88);
    vestirBloque(pier);
    metroDetail(group, pier.translate(x, bottom / 2, supportZ), concrete, 'Estribo sobre la barrera del Portal', true);
    const parts = new MeshKit();
    const top = trackHeight + 5.2;
    const edge = deckWidth / 2 + .10, span = endZ - supportZ;
    const panels = 12, step = span / panels;
    const chord = (x0, y, z, w, h, d) => parts.box(x0, y, z, w, h, d, colors.steel, { bottom: .74 });
    const brace = (a, b, width) => parts.tube([a, b], width, 4, colors.joint, { flat: true });
    for (const side of [-1, 1]) {
      const ix = x + side * edge;
      chord(ix, bottom, supportZ + span / 2, .46, .68, span);
      chord(ix, top, supportZ + span / 2, .39, .43, span);
      // Zócalo bajo y tubos separados para ver la carrocería al otro lado de la cercha.
      const railX = x + side * (edge - .34);
      for (const height of [.70, 1.21]) chord(railX, trackHeight + height, supportZ + span / 2, .067, .064, span);
      for (let z = supportZ + 1.8; z < endZ; z += 2.55) {
        chord(railX, trackHeight + .76, z, .066, .94, .072);
      }
      for (let i = 0; i <= panels; i++) {
        const z = supportZ + step * i;
        chord(ix, (bottom + top) / 2, z, i === 0 || i === panels ? .5 : .30, top - bottom, .35);
        parts.box(ix + side * .245, bottom + .31, z, .06, .75, .78, colors.flange);
        if (i < panels) {
          const up = i < panels / 2;
          brace([ix, up ? top : bottom, z], [ix, up ? bottom : top, z + step], .17);
        }
      }
    }
    for (let i = 0; i <= panels; i++) {
      const z = supportZ + step * i;
      chord(x, bottom, z, deckWidth + .44, .84, .36);
      chord(x, top, z, deckWidth + .33, .22, .22);
      if (i < panels) brace([x - edge, top, z], [x + edge, top, z + step], .077);
    }
    metroDetail(group, parts.geometry(), steel, 'Cercha de acero del Portal', true);
  });
}

export function metroPierBearings(group, x, piers, steel) {
  withVisualRandom(() => {
    const parts = new MeshKit();
    for (const z of piers) {
      const h = viaductHeight(z);
      if (h < 4 || Math.abs(bridgeCenter(z) - x) > .85 || Math.abs(viaductHeight(z + 1) - viaductHeight(z - 1)) > .055) continue;
      // Junta y collar de protección donde la pila independiente cruza por la mediana del tablero del bus.
      parts.tube([[x, h - .025, z], [x, h + .12, z]], 1.29, 20, colors.curb, { flat: true, twist: 0 });
      parts.tube([[x, h + .055, z], [x, h + .105, z]], 1.294, 20, colors.warning, { flat: true, twist: 0, caps: false });
    }
    metroDetail(group, parts.geometry(), steel, 'Juntas de las pilas en la mediana del bus');
  });
}

export function metroTrackFurniture(group, metro, spans, steel) {
  withVisualRandom(() => {
    const parts = new MeshKit(), { x, trackHeight: y } = metro;
    for (const [from, to] of spans) {
      // En placa elevada, apoyos bajos entre los rieles de cada vía.
      for (let z = from + .6; z < to - .45; z += 1.58) for (const side of [-1, 1]) {
        parts.box(x + side * 1.9, y + .155, z, 1.80, .054, .188, colors.pad, { bottom: .62 });
      }
      for (const sign of [-1, 1]) {
        const z = sign < 0 ? from + .8 : to - .8;
        for (const side of [-1, 1]) {
          const axis = x + side * 1.9;
          for (const dx of [-.65, .65]) {
            parts.box(axis + dx, y + .28, z, .30, .22, 1.3, colors.joint);
            parts.tube([[axis + dx, y + .30, z + sign * .48], [axis + dx, y + .98, z - sign * .12]],
              .104, 4, colors.flange, { flat: true });
          }
          parts.box(axis, y + .95, z - sign * .10, 1.85, .22, .23, colors.warning, { bottom: .7 });
          for (const dx of [-.62, 0, .62]) parts.box(axis + dx, y + .95, z - sign * .222, .21, .211, .01, colors.black);
        }
      }
    }
    metroDetail(group, parts.geometry(), steel, 'Fijaciones y topes de las vías');
  });
}

export function metroStationEdges(group, { platform, canopy, z, eastAccess }, inner, outer, baseY, spring, steel) {
  withVisualRandom(() => {
    const parts = new MeshKit();
    const [a, b] = platform.map(value => value - z), [c, d] = canopy.map(value => value - z);
    const center = (a + b) / 2, length = b - a;
    for (const side of [-1, 1]) {
      // Cantos de hormigón, banda de seguridad y baranda exterior dejan libres las dos vías.
      parts.box(side * (inner + .18), baseY + .008, center, .29, .045, length, colors.curb);
      parts.box(side * (inner + .52), baseY + .035, center, .14, .012, length, colors.warning);
      const shift = side > 0 ? THREE.MathUtils.clamp(eastAccess?.shift ?? 0, a + .76, b - .76) : 0;
      const edgeX = side * (outer - .12);
      // El pasamanos se interrumpe donde llega la torre de acceso.
      for (const [from, to] of [[a, shift - .76], [shift + .76, b]]) {
        if (to - from <= 0) continue;
        const middle = (from + to) / 2;
        const segments = Math.ceil((to - from) / 2.4);
        for (let i = 0; i <= segments; i++) {
          const at = THREE.MathUtils.lerp(from, to, i / segments);
          parts.box(edgeX, baseY + .57, at, .064, 1.05, .064, colors.steel);
        }
        for (const height of [.4, 1.08]) parts.box(edgeX, baseY + height, middle, .072, .053, to - from, colors.flange);
      }
      for (let support = c + .24; support < d; support += (d - c - .48) / 7) {
        const x = side * (outer - .31);
        parts.box(x, (spring + baseY) / 2, support, .18, spring - baseY, .23, colors.steel, { bottom: .72 });
        parts.box(side * 7.72, spring, support, 1.64, .16, .21, colors.steel);
      }
      parts.box(side * 8.37, spring - .02, (c + d) / 2, .17, .19, d - c, colors.flange);
    }
    metroDetail(group, parts.geometry(), steel, 'Bordes, barandas y soportes de andén');
  });
}
