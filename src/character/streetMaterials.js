// src/character/streetMaterials.js
// Materiales de calle de todos los personajes realistas, jugador y peatones, modelo completo y liviano:
// piel curtida, mugre, ropa recoloreada por persona y lluvia. Las marcas se calculan en coordenadas de
// reposo, así que siguen a la superficie al animar, y los programas se comparten entre personas.
import * as THREE from 'three';
import { SKIN_ALBEDO } from './look.js';

export { SKIN_ALBEDO };

const KINDS = new Set(['skin', 'fabric', 'shoes', 'hair', 'beard', 'eyes']);

/**
 * Humedad de la calle, de 0 a 1: un solo objeto compartido por todos los materiales, que Game actualiza
 * con la del clima. Es una aproximación global: quien está bajo techo también se ve mojado.
 */
export const streetWetness = { value: 0 };

// Color lineal medio de la textura de piel de cada cuerpo (medido sobre sus triángulos): en toda la
// piel y solo en la cara, que en estas texturas es más oscura y rojiza que los brazos.
const SKIN_TEXTURES = {
  'hombre-joven': { todo: [.702, .369, .234], cara: [.697, .304, .185] },
  'hombre-adulto': { todo: [.599, .349, .231], cara: [.543, .243, .15] },
  'hombre-mayor': { todo: [.78, .463, .288], cara: [.61, .261, .152] },
  'mujer-joven': { todo: [.638, .37, .251], cara: [.611, .287, .188] },
  'mujer-adulta': { todo: [.64, .383, .259], cara: [.541, .249, .163] },
  'mujer-mayor': { todo: [.685, .445, .329], cara: [.523, .259, .185] }
};
const FACE_MATCH = .5; // cuánto se acerca la cara al color de los brazos

/** Color del material de piel para que la textura de ese cuerpo dé en promedio el tono de la paleta. */
export function streetSkinColor(tone, bodyId, target = new THREE.Color()) {
  const albedo = SKIN_ALBEDO[tone] ?? SKIN_ALBEDO[2];
  const { todo } = SKIN_TEXTURES[bodyId] ?? SKIN_TEXTURES['hombre-adulto'];
  return target.setRGB(albedo[0] / todo[0], albedo[1] / todo[1], albedo[2] / todo[2]);
}

/** Corrección de la cara de ese cuerpo, que se funde con el cuello en el shader. */
export function streetFaceTint(bodyId) {
  const { todo, cara } = SKIN_TEXTURES[bodyId] ?? SKIN_TEXTURES['hombre-adulto'];
  return new THREE.Vector3(...todo.map((value, i) => (value / cara[i]) ** FACE_MATCH));
}

// Una prenda trae camisa y pantalón en el mismo archivo. Se separan por islas de la malla, no con un
// plano: el dobladillo de una camisa queda por debajo de la pretina del pantalón que tapa, y un corte
// recto pintaría una franja de una prenda con el color de la otra.
// `cintura`: una isla con la altura media por debajo de esto, en fracción de la estatura, es de abajo.
// `arribaUV`: en el overol, lo de arriba es la camiseta (la isla cuyo centro de UV cae aquí) y todo lo
// demás es el overol, que entonces toma el color de abajo.
// `luz`: luminancia lineal media de la textura en cada zona [arriba, abajo], medida sobre los triángulos.
// `metePretina`: el saco cae más justo que el resto y el pantalón ancho se le sale por la cadera.
export const GARMENTS = {
  chaqueta: { cintura: .45, luz: [.051, .125] },
  rayas: { cintura: .45, luz: [.045, .125] },
  camisa: { cintura: .45, luz: [.065, .073] },
  buzo: { cintura: .45, luz: [.095, .125] },
  camiseta: { cintura: .45, luz: [.622, .125] },
  overol: { arribaUV: [.3, .03, .7, .35], luz: [1, .28] },
  blusa: { cintura: .45, luz: [.093, .131] },
  short: { cintura: .6, luz: [.093, .184], piernasAlAire: true },
  sudadera: { cintura: .45, luz: [.097, .057] },
  rota: { cintura: .45, luz: [.93, .014] },
  saco: { cintura: .45, luz: [.083, .014], metePretina: true }
};

// Margen de la tela sobre el cuerpo, en fracción de la estatura: tapa la piel que se asoma por lo justo.
// El pantalón suelto queda debajo de la camisa que le cae encima: su pretina se baja lo que la camisa
// tapa y, con `metePretina`, se mete hacia adentro en el último tramo para no atravesarla en la cadera.
const CLOTH_MARGIN = .0028, UNDER_MARGIN = .001, UNDER_LAYER = /pants/i, UNDER_TRIM = .023, UNDER_TUCK = [.05, .006];

const PATTERNS = { liso: 0, rayas: 1, franela: 2 };
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** `look.real.tonos` válido o null: sin él, o con un color roto, la prenda conserva su textura. */
export function normalizeTonos(raw) {
  if (!raw || !HEX_COLOR.test(raw.arriba) || !HEX_COLOR.test(raw.abajo)) return null;
  const patron = Object.hasOwn(PATTERNS, raw.patron ?? '') ? raw.patron : 'liso';
  const tonos = { arriba: raw.arriba, abajo: raw.abajo, patron, patronColor: HEX_COLOR.test(raw.patronColor) ? raw.patronColor : raw.abajo };
  if (HEX_COLOR.test(raw.calzado)) tonos.calzado = raw.calzado;
  return tonos;
}

/** La misma apariencia conserva sus zonas de desgaste al vestirse o volver a cargar. */
export function streetMaterialSeed(look = {}) {
  const identity = [look.nombre ?? '', look.piel ?? 2, look.peloColor ?? 0,
    ...Object.entries(look.real ?? {}).sort(([a], [b]) => a.localeCompare(b)).flat()].join('|');
  let hash = 2166136261;
  for (const char of identity) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 10000 / 137;
}

/** Marco común congelado ANTES de animar. Las marcas se deforman con la superficie. */
export function createStreetFrame(root, bones, bodyMesh) {
  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  if (bodyMesh?.geometry?.attributes.position) {
    const localBounds = new THREE.Box3().setFromBufferAttribute(bodyMesh.geometry.attributes.position);
    bounds.copy(localBounds).applyMatrix4(rootInverse.clone().multiply(bodyMesh.matrixWorld));
  } else bounds.set(new THREE.Vector3(-.5, 0, -.1), new THREE.Vector3(.5, 1.7, .3));
  const height = Math.max(.5, bounds.max.y - bounds.min.y);
  const centerX = (bounds.max.x + bounds.min.x) * .5;
  const worldToNormalized = new THREE.Matrix4().makeScale(1 / height, 1 / height, 1 / height)
    .multiply(new THREE.Matrix4().makeTranslation(-centerX, -bounds.min.y, 0)).multiply(rootInverse);
  const landmark = (suffix, fallback) => {
    const bone = [...bones.values()].find(item => item.name.endsWith(suffix));
    return bone ? bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(worldToNormalized) : new THREE.Vector3(...fallback);
  };
  const eyes = new THREE.Box3();
  root.traverse(mesh => {
    if (!mesh.isMesh || !/(?:low-poly|eyes?)(?:_|\.|$)/i.test(mesh.name) || /eyebrow|eyelash/i.test(mesh.name)) return;
    if (!mesh.geometry?.attributes.position) return;
    const localBounds = new THREE.Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
    eyes.union(localBounds.applyMatrix4(worldToNormalized.clone().multiply(mesh.matrixWorld)));
  });
  const eyeCenter = eyes.isEmpty() ? new THREE.Vector3(0, .933, .075) : eyes.getCenter(new THREE.Vector3());
  const eyeWidth = eyes.isEmpty() ? .052 : eyes.max.x - eyes.min.x;
  // Hombro y dirección del brazo: las rayas de una manga le dan la vuelta al brazo, no van a lo largo.
  const shoulder = landmark('LeftArm', [.105, .8, .007]);
  const elbow = landmark('LeftForeArm', [.2, .69, .01]);
  const armDir = new THREE.Vector2(elbow.x - shoulder.x, elbow.y - shoulder.y).normalize();
  return {
    worldToNormalized, height,
    eyes: new THREE.Vector4(eyeCenter.x, eyeCenter.y, eyeCenter.z, eyeWidth * .26),
    arm: new THREE.Vector4(shoulder.x, shoulder.y, armDir.x, armDir.y),
    leftHand: landmark('LeftHand', [.28, .6, .02]), rightHand: landmark('RightHand', [-.28, .6, .02]),
    leftElbow: landmark('LeftForeArm', [.22, .73, 0]), rightElbow: landmark('RightForeArm', [-.22, .73, 0]),
    leftKnee: landmark('LeftLeg', [.06, .27, .015]), rightKnee: landmark('RightLeg', [-.06, .27, .015])
  };
}

/**
 * Las islas de UV son los componentes conexos de la malla: sus vértices están partidos en las costuras.
 * Devuelve la isla de cada vértice y sus medidas en coordenadas de reposo.
 */
function meshIslands(geometry, restMatrix) {
  const { index, attributes: { position, uv } } = geometry;
  const parent = Int32Array.from({ length: position.count }, (_, i) => i);
  const find = i => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < index.count; i += 3) {
    const a = find(index.getX(i));
    parent[find(index.getX(i + 1))] = a;
    parent[find(index.getX(i + 2))] = a;
  }
  const islands = new Map(), m = restMatrix.elements, vertex = new Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const root = find(i);
    let island = islands.get(root);
    if (!island) islands.set(root, island = { count: 0, y: 0, minY: Infinity, maxY: -Infinity, u: 0, v: 0 });
    const y = m[1] * position.getX(i) + m[5] * position.getY(i) + m[9] * position.getZ(i) + m[13];
    island.count++;
    island.y += y;
    island.minY = Math.min(island.minY, y);
    island.maxY = Math.max(island.maxY, y);
    if (uv) { island.u += uv.getX(i); island.v += uv.getY(i); }
    vertex[i] = island;
  }
  return vertex;
}

/** Marca una vez, en la geometría compartida de la prenda, cuáles islas van con el color de abajo. */
export function markGarmentZones(geometry, restMatrix, garment) {
  if (geometry.attributes.streetZone || !geometry.index) return;
  const { arribaUV: top, cintura = 0 } = garment;
  const below = island => {
    const u = island.u / island.count, v = island.v / island.count;
    return top ? !(u >= top[0] && v >= top[1] && u <= top[2] && v <= top[3]) : island.y / island.count < cintura;
  };
  const zone = Uint8Array.from(meshIslands(geometry, restMatrix), island => below(island) ? 255 : 0);
  geometry.setAttribute('streetZone', new THREE.BufferAttribute(zone, 1, true));
}

const trimmed = new WeakMap();
/** Versión de una geometría compartida sin ciertas islas; sigue siendo una sola por pieza. */
function withoutIslands(geometry, restMatrix, isDropped) {
  if (trimmed.has(geometry)) return trimmed.get(geometry);
  let result = geometry;
  if (geometry.index) {
    const islands = meshIslands(geometry, restMatrix), { index } = geometry, kept = [];
    for (let i = 0; i < index.count; i += 3) {
      if (!isDropped(islands[index.getX(i)])) kept.push(index.getX(i), index.getX(i + 1), index.getX(i + 2));
    }
    if (kept.length < index.count) {
      result = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(geometry.attributes)) result.setAttribute(name, attribute);
      result.setIndex(kept);
    }
  }
  trimmed.set(geometry, result);
  return result;
}

/**
 * Tenis y zapatos traen medias hasta media canilla, que atraviesan cualquier pantalón al que no le
 * caben. Debajo de un pantalón largo no se ven: la media empieza por encima de la suela y sube mucho
 * más que la boca del zapato.
 */
export const shoesWithoutSocks = (geometry, restMatrix) =>
  withoutIslands(geometry, restMatrix, island => island.minY > .012 && island.maxY > .09);

/** El pelo crespo trae, sobre sus dos capas, cuadritos sueltos que de cerca forman una malla: se quitan. */
export const curlsWithoutCards = (geometry, restMatrix) =>
  withoutIslands(geometry, restMatrix, island => island.count < 16);

const COMMON = /* glsl */ `
uniform float uStreetWear;
uniform float uStreetSeed;
uniform float uStreetWet;
uniform float uStreetStubble;
uniform float uStreetCurl;
uniform vec3 uStreetFaceTint;
uniform vec4 uStreetBrows;
uniform vec4 uStreetEyes;
uniform vec4 uStreetArm;
uniform vec3 uStreetLeftHand;
uniform vec3 uStreetRightHand;
uniform vec3 uStreetLeftElbow;
uniform vec3 uStreetRightElbow;
uniform vec3 uStreetLeftKnee;
uniform vec3 uStreetRightKnee;
uniform float uStreetTint;
uniform float uStreetPattern;
uniform vec3 uStreetTop;
uniform vec3 uStreetBottom;
uniform vec3 uStreetPatternColor;
uniform vec2 uStreetLight;
varying vec3 vStreetRest;
float streetHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float streetNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(streetHash(i), streetHash(i + vec2(1.0, 0.0)), f.x),
    mix(streetHash(i + vec2(0.0, 1.0)), streetHash(i + vec2(1.0)), f.x), f.y);
}
float streetPatch(vec3 p) {
  vec2 q = vec2(p.x * 31.0 + p.z * 17.0, p.y * 37.0) + uStreetSeed;
  return (streetNoise(q) * 2.0 + streetNoise(q * 2.03 + 7.0)) / 3.0;
}
float streetSpot(vec3 p, vec3 center, vec3 radius) {
  vec3 d = (p - center) / radius;
  return 1.0 - smoothstep(0.25, 1.0, dot(d, d));
}
float streetPair(vec3 p, vec3 a, vec3 b, float radius) {
  return max(streetSpot(p, a, vec3(radius)), streetSpot(p, b, vec3(radius)));
}
// Onda cuadrada con el borde suavizado: s en periodos, w el ancho de un píxel en periodos. De lejos
// se funde con su promedio en vez de vibrar.
float streetStripe(float s, float duty, float w) {
  float wave = abs(fract(s) - .5) * 2.;
  return mix(smoothstep(duty - w * 2., duty + w * 2., wave), 1. - duty, smoothstep(.22, .6, w));
}
`;

const SURFACES = {
  skin: /* glsl */ `
    vec3 eye = uStreetEyes.xyz;
    vec3 side = vec3(abs(p.x), p.yz); // la cara es simétrica: basta mirar un lado
    float pixel = max(length(dFdx(p)), length(dFdy(p)));
    float faceFront = smoothstep(eye.z - .018, eye.z + .004, p.z);
    float face = smoothstep(eye.y - .088, eye.y - .066, p.y);
    diffuseColor.rgb *= mix(vec3(1.), uStreetFaceTint, face);
    // Sol de altura: nariz, pómulos y frente, y más en quien vive en la calle. Cuanto más oscura la piel, menos
    // se le nota, y la cara no pierde su forma a la sombra.
    float skinLum = dot(diffuse, vec3(.2126, .7152, .0722));
    float weathered = uStreetWear * mix(.35, 1., smoothstep(.15, .5, skinLum));
    float nose = streetSpot(p, eye + vec3(0., -.016, .016), vec3(.013, .022, .03));
    float cheekbone = streetSpot(side, eye + vec3(.029, -.016, -.006), vec3(.024, .017, .05));
    float forehead = streetSpot(p, eye + vec3(0., .032, -.006), vec3(.05, .032, .06));
    float sun = max(nose, max(cheekbone, forehead * .8));
    diffuseColor.rgb *= mix(vec3(1.), vec3(.86, .68, .56), sun * (.22 + .4 * weathered) * (.72 + surfaceNoise * .56));
    diffuseColor.rgb *= mix(vec3(1.), vec3(.92, .84, .77), face * weathered * .7);
    // Labios y orejas algo más rojos.
    float lips = streetSpot(p, eye + vec3(0., -.038, .006), vec3(.016, .0078, .035));
    float ears = streetSpot(side, vec3(.05, eye.y - .011, eye.z - .053), vec3(.013, .021, .019));
    // La textura ya da los labios rojos: un poco menos, y más en piel clara, y se quedan en su color en vez de salmón.
    float paleSkin = smoothstep(.34, .72, skinLum);
    diffuseColor.rgb *= mix(vec3(1.), vec3(1.03, .84, .82), lips * mix(.32, .08, paleSkin));
    float lipLum = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
    diffuseColor.rgb = mix(diffuseColor.rgb, lipLum * vec3(1.32, .92, .8), lips * mix(.26, .42, paleSkin));
    diffuseColor.rgb *= mix(vec3(1.), vec3(1.04, .84, .8), ears * .6);
    // Sombra de barba: de lejos es un tono, y solo de muy cerca se ve el grano.
    float jaw = streetSpot(p, eye + vec3(0., -.058, -.012), vec3(.047, .03, .08));
    float upperLip = streetSpot(p, eye + vec3(0., -.0305, .012), vec3(.019, .0062, .03));
    float stubble = clamp(max(jaw, upperLip) - lips * 1.4, 0., 1.) * uStreetStubble * faceFront;
    float grain = mix(streetNoise(p.xy * 950. + uStreetSeed), .5, clamp(pixel * 950. - .25, 0., 1.));
    diffuseColor.rgb *= mix(vec3(1.), vec3(.5, .49, .5), stubble * (.42 + grain * .62));
    // Ojeras; el albedo conserva su detalle.
    vec3 eyeOffset = vec3(uStreetEyes.w, -.012, .012);
    float underEyes = max(streetSpot(p, eye + eyeOffset, vec3(.014, .007, .05)),
      streetSpot(p, eye + vec3(-eyeOffset.x, eyeOffset.yz), vec3(.014, .007, .05))) * faceFront;
    diffuseColor.rgb *= mix(vec3(1.), vec3(.62, .68, .76), underEyes * (.14 + .10 * uStreetWear));
    // El modelo liviano no trae cejas: se pintan para que no salten al cambiar de modelo.
    float brow = streetSpot(side, eye + vec3(.021, .0065, .006), vec3(.0175, .0042, .03)) * uStreetBrows.a;
    diffuseColor.rgb = mix(diffuseColor.rgb, uStreetBrows.rgb, brow);
    // Mugre: manos, cuello y, si va descalzo, los pies, que sin zapatos no se salvan de ensuciarse.
    float hands = streetPair(p, uStreetLeftHand, uStreetRightHand, .085);
    float neck = (1. - smoothstep(eye.y - .07, eye.y - .05, p.y)) * smoothstep(eye.y - .155, eye.y - .1, p.y) * (1. - smoothstep(.065, .09, abs(p.x)));
    float dirt = max(hands, neck * .85) * uStreetWear * (.3 + .7 * surfaceNoise);
    diffuseColor.rgb *= mix(vec3(1.), vec3(.56, .5, .43), dirt);
    float feet = 1. - smoothstep(.018, .085, p.y);
    diffuseColor.rgb *= mix(vec3(1.), vec3(.42, .37, .31), feet * (.55 + .4 * uStreetWear) * (.55 + .6 * surfaceNoise));
    // Lo que quita la cera: moteado fino de color y poros de aspereza desigual, que de lejos se funden en su promedio.
    float mottleFade = clamp(pixel * 240. - .3, 0., 1.);
    float mottle = mix(streetNoise(p.xy * 240. + uStreetSeed) * .55 + streetNoise(p.zy * 560. + uStreetSeed) * .45, .5, mottleFade);
    float blotch = streetNoise(vec2(p.x * 95. + p.z * 60., p.y * 95.) + uStreetSeed);
    diffuseColor.rgb *= mix(vec3(.9, .875, .87), vec3(1.07, 1.085, 1.09), mottle);
    diffuseColor.rgb *= mix(vec3(1.03, .965, .95), vec3(.985, 1.015, 1.02), blotch);
    float shine = max(nose, forehead * .5) * (1. - uStreetWear * .35);
    streetRoughness = clamp(.8 + (surfaceNoise - .5) * .07 + (mottle - .5) * .22 + hands * .05 - shine * .09 + dirt * .08, .62, .94);
    diffuseColor.rgb *= 1. - uStreetWet * .06;
    streetRoughness = mix(streetRoughness, streetRoughness * .66, uStreetWet);
  `,
  fabric: /* glsl */ `
    if (uStreetTint > .5) {
      // Recoloreado por luminancia: la textura aporta pliegues, costuras y grano; el color es de la persona.
      float below = step(.5, vStreetZone);
      float shade = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)) / mix(uStreetLight.x, uStreetLight.y, below);
      // La textura del pantalón trae el asiento oscurecido: solo el desgaste lo justifica.
      float seat = streetSpot(p, vec3(0., .5, -.07), vec3(.2, .11, .1)) * below * (1. - uStreetWear);
      shade = mix(shade, max(shade, .95), seat * .85);
      vec3 tone = mix(uStreetTop, uStreetBottom, below);
      if (uStreetPattern > .5 && below < .5) {
        vec2 fromShoulder = vec2(abs(p.x) - uStreetArm.x, p.y - uStreetArm.y);
        float along = dot(fromShoulder, uStreetArm.zw);
        float across = fromShoulder.x * uStreetArm.w - fromShoulder.y * uStreetArm.z;
        float sleeve = step(0., along) * step(abs(across), .045);
        float height = mix(p.y, -along, sleeve);
        float pixel = max(length(dFdx(p)), length(dFdy(p)));
        if (uStreetPattern < 1.5) {
          tone = mix(tone, uStreetPatternColor, streetStripe(height / .03, .52, pixel / .03));
        } else {
          // Franela: bandas anchas que se cruzan y una línea fina clara, por las vueltas de cuerpo y manga.
          float around = sleeve > .5 ? atan(across, p.z - .01) * .032
            : p.x + sign(p.x) * smoothstep(0., .05, abs(p.x)) * max(0., .055 - abs(p.z - .005));
          float size = .062, w = pixel / size;
          float bands = streetStripe(height / size, .5, w) + streetStripe(around / size, .5, w);
          tone = mix(tone, uStreetPatternColor, bands * .44);
          float thin = max(streetStripe(height / size + .25, .9, w), streetStripe(around / size + .25, .9, w));
          tone = mix(tone, tone * .55 + .3, thin * .4);
        }
      }
      diffuseColor.rgb = tone * mix(1., clamp(shade, .42, 1.55), .82);
    }
    float cuffs = streetPair(p, uStreetLeftHand, uStreetRightHand, .075);
    float elbows = streetPair(p, uStreetLeftElbow, uStreetRightElbow, .08);
    float knees = streetPair(p, uStreetLeftKnee, uStreetRightKnee, .085);
    float hem = (1.0 - smoothstep(.065, .16, p.y));
    float abrasion = clamp(knees * .8 + elbows * .6 + cuffs * .55, 0.0, 1.0);
    float faded = abrasion * uStreetWear * (.45 + surfaceNoise * .35);
    float lum = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum), .14 * uStreetWear);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * 1.1 + .01, faded * .42);
    float dust = (hem * .7 + cuffs * .22) * uStreetWear * smoothstep(.3, .78, surfaceNoise);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.16, .135, .105), dust * .40);
    // Manchas grandes de mugre: solo quien lleva mucho tiempo en la calle.
    float grime = smoothstep(.62, 1., uStreetWear);
    float stains = 0.;
    if (grime > 0.) {
      // Girado y torcido para que la cuadrícula del ruido no dibuje manchas rectangulares.
      vec2 big = vec2(p.x * 7.4 + p.y * 5.2 + p.z * 5., p.y * 9.1 - p.x * 6.) + uStreetSeed * 1.7;
      big += (streetNoise(big * 2.3) - .5) * .9;
      stains = smoothstep(.56, .76, streetNoise(big) * .72 + streetNoise(big * 2.7 + 3.) * .28) * grime;
      vec3 dirty = mix(diffuseColor.rgb, vec3(lum), .55) * vec3(.6, .54, .44) * (.7 + surfaceNoise * .5);
      diffuseColor.rgb = mix(diffuseColor.rgb, dirty, stains * .72);
    }
    streetRoughness = clamp(.88 + abrasion * .07 + dust * .06 + stains * .05 + (surfaceNoise - .5) * .035, .84, .99);
    diffuseColor.rgb *= 1. - uStreetWet * .4;
    streetRoughness = mix(streetRoughness, streetRoughness * .84, uStreetWet);
  `,
  shoes: /* glsl */ `
    float sole = 1.0 - smoothstep(.025, .065, p.y);
    float toe = smoothstep(.055, .115, p.z);
    float use = clamp(sole * .8 + toe * .55, 0.0, 1.0) * uStreetWear;
    float lum = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
    // El cuero se recolorea por luminancia con el tono de la persona: la textura solo aporta pliegues y costuras.
    if (uStreetTint > .5) {
      diffuseColor.rgb = uStreetTop * clamp(lum / uStreetLight.x, .5, 1.7);
      lum = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
    }
    // El polvo de la calle les quita el color aunque no estén rotos.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum) * vec3(1.04, .98, .9), .32 + .38 * uStreetWear) * (.92 - .26 * uStreetWear);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.19, .16, .12), use * (.19 + surfaceNoise * .14));
    diffuseColor.rgb *= 1.0 + toe * .05;
    // La planta es caucho oscuro: con el pie en el aire, clara parece la planta de un pie descalzo.
    // La cara, medida en el cuerpo de pie, apunta hacia quien la ve: oscurece solo lo que se ve desde abajo, nunca el empeine.
    float underside = smoothstep(.7, .9, -normalize(cross(dFdx(p), dFdy(p))).y);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(.2126, .7152, .0722))) * vec3(.34, .32, .3), underside);
    streetRoughness = clamp(.82 + use * .12 + surfaceNoise * .035, .80, .98);
    diffuseColor.rgb *= 1. - uStreetWet * .3;
    streetRoughness = mix(streetRoughness, streetRoughness * .72, uStreetWet);
  `,
  hair: /* glsl */ `
    // La textura original aporta el detalle de mechones; el moteado solo varía su tono.
    diffuseColor.rgb *= .88 + surfaceNoise * .14;
    float silver = smoothstep(.65, .86, surfaceNoise) * (.02 + uStreetWear * .035);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.38, .40, .41), silver);
    streetRoughness = .74 + surfaceNoise * .10;
    if (uStreetCurl > .5) {
      // El crespo es una mata lisa: un grano fino y mate la hace leer como rizos apretados, y de lejos se funde.
      float pixel = max(length(dFdx(p)), length(dFdy(p)));
      vec3 q = p * 340. + uStreetSeed;
      float curls = streetNoise(q.xy + q.z * .7) * .6 + streetNoise(q.yz * 2.1 + 9.) * .4;
      diffuseColor.rgb *= .5 + mix(curls, .5, clamp(pixel * 340. - .4, 0., 1.));
      streetRoughness = .92;
    }
    diffuseColor.rgb *= 1. - uStreetWet * .28;
    streetRoughness = mix(streetRoughness, streetRoughness * .8, uStreetWet);
  `,
  beard: /* glsl */ `
    float roots = smoothstep(uStreetEyes.y - .09, uStreetEyes.y - .035, p.y);
    diffuseColor.rgb *= (.74 + surfaceNoise * .3) * mix(1.0, .86, roots);
    float silver = smoothstep(.61, .85, surfaceNoise) * (.02 + uStreetWear * .025);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.35, .37, .38), silver);
    // Grano de pelo: la barba corta es una lámina lisa y sin esto se lee como pintura negra; de lejos se funde.
    float pixel = max(length(dFdx(p)), length(dFdy(p)));
    vec3 q = p * 520. + uStreetSeed;
    float bristle = streetNoise(q.xy + q.z * .7) * .6 + streetNoise(q.yz * 2.3 + 5.) * .4;
    bristle = mix(bristle, .5, clamp(pixel * 520. - .4, 0., 1.));
    diffuseColor.rgb = diffuseColor.rgb * (.45 + bristle * 1.1) + (bristle - .5) * .018;
    streetRoughness = .78 + surfaceNoise * .12;
    diffuseColor.rgb *= 1. - uStreetWet * .28;
    streetRoughness = mix(streetRoughness, streetRoughness * .8, uStreetWet);
  `
};

// Tono del zapato de cuero cuando la persona no trae el suyo, y luminancia media de su textura sobre el cuero.
const PLAIN_SHOE = '#33261d', SHOE_LIGHT = .11;
const BLACK = new THREE.Color(0);
const NO_BROWS = new THREE.Vector4(0, 0, 0, 0);
const toneColor = hex => hex ? new THREE.Color(hex) : BLACK;

/**
 * Aplica sobre un material de instancia. Mapas/UV/alpha/geometría permanecen compartidos.
 * `stubble`, `faceTint` y `brows` son de la piel; `curl`, del pelo; `tonos` y `garment`, de la ropa que los recibe;
 * `leather` y `shoeTone`, del zapato de cuero, que nadie lleva del naranja de su textura.
 */
export function applyStreetMaterial(material, mesh, { kind, frame, wear = 2, seed = 0, detailTexture = null, stubble = 0, faceTint = null, brows = null, curl = 0, tonos = null, garment = null, leather = false, shoeTone = null } = {}) {
  if (!KINDS.has(kind)) throw new Error(`Superficie de personaje desconocida: ${kind}`);
  material.metalness = 0;
  material.userData.streetSurface = kind;
  if (kind === 'eyes') {
    material.roughness = .22;
    return;
  }
  if (!frame?.worldToNormalized) throw new Error('El material necesita el marco de reposo del personaje.');
  material.roughness = kind === 'skin' ? .8 : kind === 'hair' ? .74 : kind === 'beard' ? .80 : .9;
  if (kind === 'skin' && detailTexture && !material.normalMap) {
    material.normalMap = detailTexture;
    material.normalScale.set(.5, .5);
  }
  mesh.updateWorldMatrix(true, false);
  const restMatrix = frame.worldToNormalized.clone().multiply(mesh.matrixWorld);
  const tinted = kind === 'fabric' && !!tonos && !!garment;
  const shoeColor = kind === 'shoes' && leather ? shoeTone ?? PLAIN_SHOE : null;
  if (garment) markGarmentZones(mesh.geometry, restMatrix, garment);
  const scale = restMatrix.getMaxScaleOnAxis();
  const underLayer = garment && UNDER_LAYER.test(mesh.name);
  const margin = garment ? (underLayer ? UNDER_MARGIN : CLOTH_MARGIN) / scale : 0;
  if (underLayer && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const waist = underLayer
    ? new THREE.Vector3(mesh.geometry.boundingBox.max.y - UNDER_TRIM / scale, UNDER_TUCK[0] / scale, garment.metePretina ? UNDER_TUCK[1] / scale : 0)
    : new THREE.Vector3(1e6, 1, 0);
  const previous = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey?.() ?? '';
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, {
      uStreetRestMatrix: { value: restMatrix },
      uStreetWear: { value: THREE.MathUtils.clamp(wear / 2, 0, 1) },
      uStreetSeed: { value: seed },
      uStreetWet: streetWetness,
      uStreetStubble: { value: stubble },
      uStreetCurl: { value: curl },
      uStreetFaceTint: { value: faceTint ?? new THREE.Vector3(1, 1, 1) },
      uStreetBrows: { value: brows ?? NO_BROWS },
      uStreetEyes: { value: frame.eyes },
      uStreetArm: { value: frame.arm },
      uStreetTint: { value: tinted || shoeColor ? 1 : 0 },
      uStreetPattern: { value: tinted ? PATTERNS[tonos.patron] : 0 },
      uStreetTop: { value: toneColor(shoeColor ?? (tinted && tonos.arriba)) },
      uStreetBottom: { value: toneColor(tinted && tonos.abajo) },
      uStreetPatternColor: { value: toneColor(tinted && tonos.patronColor) },
      uStreetLight: { value: new THREE.Vector2(...(garment?.luz ?? [shoeColor ? SHOE_LIGHT : 1, 1])) },
      uStreetMargin: { value: margin },
      uStreetWaist: { value: waist },
      ...Object.fromEntries(['leftHand', 'rightHand', 'leftElbow', 'rightElbow', 'leftKnee', 'rightKnee']
        .map(name => [`uStreet${name[0].toUpperCase()}${name.slice(1)}`, { value: frame[name] }]))
    });
    const cloth = kind === 'fabric';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nuniform mat4 uStreetRestMatrix;\nvarying vec3 vStreetRest;\n${cloth ? 'attribute float streetZone;\nvarying float vStreetZone;\nuniform float uStreetMargin;\nuniform vec3 uStreetWaist;\n' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvStreetRest = (uStreetRestMatrix * vec4(position, 1.0)).xyz;\n${cloth ? 'vStreetZone = streetZone;\ntransformed += normal * (uStreetMargin - uStreetWaist.z * smoothstep(uStreetWaist.x - uStreetWaist.y, uStreetWaist.x, position.y));\ntransformed.y = min(transformed.y, uStreetWaist.x);' : ''}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}${cloth ? 'varying float vStreetZone;\n' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nfloat streetRoughness = roughness;\n{
        vec3 p = vStreetRest; float surfaceNoise = streetPatch(p);\n${SURFACES[kind]}\n}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= streetRoughness / max(roughness, .001);');
    // Pelo y barba son láminas sueltas con la normal de la cabeza: las que quedan al revés no deben
    // apagarse como si les diera la espalda a la luz, o la coronilla se llena de parches negros.
    if (kind === 'hair' || kind === 'beard') shader.fragmentShader = shader.fragmentShader
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);');
  };
  material.customProgramCacheKey = () => `${previousKey}|street:v2:${kind}`;
  material.needsUpdate = true;
}
