import * as THREE from 'three';
import { SignalMesher, roundedRect, createNoise, createRandom, mix, ramp } from './SignalModel.js';
import { chainSunField } from './SunFieldShader.js';

// Poste de alumbrado de Bogotá hecho por código: concreto centrifugado, brazo galvanizado
// y luminaria de cuerpo bajo. Origen en la base a nivel de andén; +X sale hacia la calzada.
export const STREET_LAMP = Object.freeze({
  top: 6.55, radiusBase: .112, radiusTop: .066,
  lens: Object.freeze({ x: 1.71, y: 6.22 })
});

/** Códigos del atributo por vértice: 1 es la lente; desde 9, juegos que varían por poste. */
export const LAMP_PART = Object.freeze({ NONE: 0, LENS: 1, SET: 9 });

// ---------- atlas ----------

const WIDTH = 128, HEIGHT = 256;
const cell = (x0, y0, x1, y1) => ({ u0: (x0 + .5) / WIDTH, v0: (y0 + .5) / HEIGHT, u1: (x1 - .5) / WIDTH, v1: (y1 - .5) / HEIGHT });
const CELLS = {
  pole: cell(0, 0, 96, 256),
  metal: cell(96, 0, 128, 64),
  poster: i => cell(96, 64 + 32 * i, 128, 96 + 32 * i),
  mark: cell(96, 224, 128, 248),
  white: { u0: 125.5 / WIDTH, v0: 253.5 / HEIGHT, u1: 125.5 / WIDTH, v1: 253.5 / HEIGHT }
};

/** Sin canvas: funciona igual en Node y deja el mismo resultado en cada partida. */
export function createStreetLampAtlas() {
  const data = new Uint8Array(WIDTH * HEIGHT * 4).fill(255);
  const noise = createNoise(0x2c71), random = createRandom(0x77a31);
  const put = (x, y, r, g, b) => {
    const i = (y * WIDTH + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  };

  // Concreto: claro arriba, chorreado por la lluvia, con la junta del molde y mugre de andén abajo.
  for (let y = 0; y < 256; y++) for (let x = 0; x < 96; x++) {
    const u = x / 96, h = y / 255;
    const blot = noise(u * 6, h * 16, 6), grain = noise(u * 32, h * 96, 32), streak = noise(u * 16 + 3, h * 3.4, 16);
    const seam = Math.min(Math.abs(u - .25), Math.abs(u - .75));
    let v = 146 + blot * 34 + grain * 22;
    v -= ramp(.48, .76, streak) * 36 * (.45 + h * .55);
    if (seam < .014) v *= .8;
    // Poros y descascarado: puntos oscuros sueltos.
    if (grain > .74) v *= .8;
    const dirt = 1 - ramp(0, .15, h + (blot - .5) * .05);
    v *= 1 - dirt * .52;
    let r = v * 1.0, g = v * .985, b = v * .94;
    // Goteo de óxido bajo la abrazadera del brazo.
    const rust = ramp(.74, .85, h) * (1 - ramp(.85, .875, h)) * ramp(.5, .74, noise(u * 20 + 11, h * 2.5, 20));
    r = mix(r, 92, rust * .7); g = mix(g, 64, rust * .7); b = mix(b, 46, rust * .7);
    // Salpicado de la calle.
    const splash = (1 - ramp(0, .06, h)) * .5;
    r = mix(r, 84, splash); g = mix(g, 78, splash); b = mix(b, 68, splash);
    put(x, y, r, g, b);
  }

  // Lámina y tubo galvanizado: moteado fino y claro.
  for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
    const v = 150 + noise(x / 4 + 3, y / 4 + 40, 8) * 62 + noise(x / 1.5, y / 1.5, 21) * 20;
    put(96 + x, y, v * .98, v, v * 1.01);
  }

  // Carteles pegados y arrancados, sin texto legible: bloques de tinta sobre papel entero.
  // Solo se rompe el borde: con esta resolución, los huecos sueltos se verían como ruido.
  const designs = [
    [[226, 214, 180], [52, 44, 42]],
    [[204, 84, 62], [238, 228, 206]],
    [[232, 194, 76], [44, 40, 36]],
    [[72, 118, 160], [232, 232, 226]],
    [[226, 226, 218], [176, 58, 52]]
  ];
  designs.forEach(([paper, ink], i) => {
    const y0 = 64 + 32 * i;
    for (let y = 0; y < 32; y++) {
      const band = y >> 2, stop = 12 + Math.floor(createRandom(i * 31 + band)() * 15);
      for (let x = 0; x < 32; x++) {
        const fade = .78 + noise(i * 7 + x / 12, y / 12, 32) * .3;
        const inked = y > 4 && y < 27 && band % 2 === 1 && x > 4 && x < stop;
        const edge = Math.max(Math.abs(x / 31 - .5), Math.abs(y / 31 - .5)) * 2;
        const torn = noise(i * 13 + x / 6, y / 6 + 7, 16) > 1.02 - edge * edge * .55;
        const [r, g, b] = torn ? [146, 142, 130] : inked ? ink : paper;
        put(96 + x, y0 + y, r * fade, g * fade, b * fade);
      }
    }
  });

  // Rótulo de inventario: rectángulo oscuro con renglones claros, ilegible a propósito.
  for (let y = 0; y < 24; y++) for (let x = 0; x < 32; x++) {
    const row = (y % 8 > 2 && y % 8 < 6) && x > 3 && x < 28 && random() > .22;
    const v = row ? 214 : 30 + random() * 10;
    put(96 + x, 224 + y, v, v * (row ? .86 : 1), v * (row ? .3 : 1));
  }
  for (let y = 250; y < 256; y++) for (let x = 122; x < 128; x++) put(x, y, 255, 255, 255);

  const texture = new THREE.DataTexture(data, WIDTH, HEIGHT, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 2;
  texture.needsUpdate = true;
  return texture;
}

// ---------- geometría ----------

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const rgb = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const paint = (hex, rough, metal, region = CELLS.white, part = LAMP_PART.NONE) => ({ rgb: rgb(hex), rough, metal, cell: region, lens: part });

const PAINT = {
  pole: paint('#ffffff', .94, 0, CELLS.pole),
  mortar: paint('#c9c5ba', .96, 0, CELLS.pole),
  galv: paint('#ffffff', .46, .55, CELLS.metal),
  galvDark: paint('#a9acad', .55, .45, CELLS.metal),
  body: paint('#b8bcbd', .5, .35, CELLS.metal),
  bodyRear: paint('#868a8c', .58, .3, CELLS.metal),
  frame: paint('#3d4042', .55, .2),
  lens: paint('#d6dcdd', .2, .1, CELLS.white, LAMP_PART.LENS),
  photocell: paint('#23252a', .4, .1),
  photocellCap: paint('#7d8387', .35, .1),
  conduit: paint('#8d9091', .55, .45, CELLS.metal),
  strap: paint('#6a6d6e', .5, .6),
  cable: paint('#121314', .75, 0),
  fiberBox: paint('#3c3f40', .7, .05)
};

const poleRadius = y => mix(STREET_LAMP.radiusBase, STREET_LAMP.radiusTop, y / STREET_LAMP.top);

/** Tramo de carrocería: anillos de esquinas redondas unidos en secuencia. */
function loft(m, stations, steps = 2) {
  const rings = stations.map(({ x, w, h, y = 0, nx = 0 }) => roundedRect(w, h, Math.min(w, h) * .46, steps)
    .map(p => m.vertex(x, y + p.y, p.z, nx, p.ny, p.nz, .5 + p.z, x)));
  for (let i = 0; i < rings.length - 1; i++) {
    const count = rings[i].length;
    for (let k = 0; k < count; k++) {
      const j = (k + 1) % count;
      m.quad(rings[i][k], rings[i + 1][k], rings[i + 1][j], rings[i][j]);
    }
  }
  return rings;
}

/** Luminaria de cuerpo bajo. Origen en el cuello; +X hacia la punta, lente por debajo. */
function luminaire(m) {
  m.paint = PAINT.bodyRear;
  loft(m, [
    { x: 0, w: .074, h: .074, nx: -.5 },
    { x: .07, w: .13, h: .1, nx: -.25 },
    { x: .17, w: .26, h: .13, y: .004 }
  ]);
  m.paint = PAINT.body;
  const rings = loft(m, [
    { x: .17, w: .262, h: .132, y: .004 },
    { x: .4, w: .29, h: .118, y: .008 },
    { x: .6, w: .25, h: .088, y: .006, nx: .15 },
    { x: .7, w: .15, h: .05, nx: .55 }
  ]);
  // Punta cerrada.
  const tip = rings[rings.length - 1];
  m.paint = PAINT.body;
  const center = m.vertex(.712, 0, 0, 1, 0, 0);
  for (let k = 0; k < tip.length; k++) m.tri(center, tip[k], tip[(k + 1) % tip.length]);
  // Nervio superior: rompe la cáscara lisa y hace de disipador.
  m.paint = PAINT.bodyRear;
  m.box(.36, .074, 0, .3, .012, .19, 'b');
  // Marco y lente plana que mira a la calle.
  const bottom = x => mix(-.056, -.042, (x - .2) / .4), cx = .4, hx = .2, hz = .105;
  const contour = roundedRect(hz * 2, hx * 2, .03, 1);
  m.paint = PAINT.frame;
  m.flat(roundedRect((hz + .016) * 2, (hx + .016) * 2, .036, 1).map(p => [cx + p.y, bottom(cx + p.y) - .002, p.z]), [0, -1, 0]);
  m.paint = PAINT.lens;
  m.flat(contour.map(p => [cx + p.y, bottom(cx + p.y) - .005, p.z, .5, .5, p.y / hx, p.z / hz]), [0, -1, 0]);
  // Fotocelda: cilindro corto con su tapa clara.
  m.paint = PAINT.photocell;
  m.sweep([V(.13, .05, 0), V(.13, .092, 0)], .03, 7);
  m.paint = PAINT.photocellCap;
  m.sweep([V(.13, .092, 0), V(.13, .106, 0), V(.13, .112, 0)], [.032, .03, .016], 7, { capEnd: true });
}

/** Papel o rótulo que abraza el fuste; cada poste muestra solo el juego que le toca. */
function wrapped(m, region, set, y, angle, width, height, tilt = 0) {
  const steps = 3, radius = poleRadius(y) + .0018, span = width / radius;
  m.paint = paint('#ffffff', .82, 0, region, set < 0 ? LAMP_PART.NONE : LAMP_PART.SET + set);
  const ids = [];
  for (let i = 0; i <= steps; i++) {
    const a = angle + (i / steps - .5) * span, cos = Math.cos(a), sin = Math.sin(a), lift = (i / steps - .5) * tilt;
    ids.push([
      m.vertex(cos * radius, y - height / 2 + lift, sin * radius, cos, 0, sin, i / steps, 0),
      m.vertex(cos * radius, y + height / 2 + lift, sin * radius, cos, 0, sin, i / steps, 1)
    ]);
  }
  for (let i = 0; i < steps; i++) m.quad(ids[i][0], ids[i + 1][0], ids[i + 1][1], ids[i][1]);
}

/** Caja de fibra con su cable subiendo por el poste: está en la mitad de los postes de la ciudad. */
function fiberBox(m, set, side, y) {
  const part = LAMP_PART.SET + set, { top } = STREET_LAMP;
  const within = base => ({ ...base, lens: part });
  m.paint = within(PAINT.cable);
  m.sweep([V(.012, y + .1, side * (poleRadius(y) + .012)), V(.012, 5.3, side * (poleRadius(5.3) + .012)), V(.012, top - .08, side * (poleRadius(top) + .012))], .008, 3);
  m.paint = within(PAINT.fiberBox);
  m.box(0, y, side * (poleRadius(y) + .036), .13, .2, .06);
  m.paint = within(PAINT.strap);
  m.sweep([V(0, y - .012, 0), V(0, y + .012, 0)], poleRadius(y) + .006, 10);
}

/** Geometría fusionada del poste: una sola para todas las instancias de la ciudad. */
export function createStreetLampGeometry() {
  const m = new SignalMesher(), { top } = STREET_LAMP;

  // Pie de mortero: es el parche que deja la obra al plantar el poste en el andén.
  m.paint = PAINT.mortar;
  m.sweep([V(0, 0, 0), V(0, .035, 0), V(0, .12, 0)], [.2, .172, poleRadius(.12) + .004], 10, { vStart: .3, vEnd: .36 });

  // Fuste de concreto, ahusado: la textura corre de abajo arriba sin repetirse.
  m.paint = PAINT.pole;
  m.sweep([.1, 1.6, 3.2, 4.8, top].map(y => V(0, y, 0)), [.1, 1.6, 3.2, 4.8, top].map(poleRadius), 10, { capEnd: true, vStart: .1 / top });

  // Abrazaderas y platina del brazo.
  const brace = 5.83;
  m.paint = PAINT.strap;
  for (const y of [brace - .19, brace + .19]) m.sweep([V(0, y - .02, 0), V(0, y + .02, 0)], poleRadius(y) + .007, 10);
  m.paint = PAINT.galvDark;
  m.box(poleRadius(brace) + .012, brace, 0, .022, .46, .1);

  // Brazo que sube suave sobre la calzada, con un riostra corta.
  const neck = V(1.34, 6.25, 0);
  m.paint = PAINT.galv;
  m.sweep([V(poleRadius(brace) + .018, 5.82, 0), V(.34, 5.93, 0), V(.74, 6.07, 0), V(1.1, 6.19, 0), neck], [.036, .034, .032, .03, .028], 7);
  m.paint = PAINT.galvDark;
  m.sweep([V(poleRadius(brace) + .018, brace - .2, 0), V(.56, 6.0, 0)], .013, 4);

  // Luminaria, un poco levantada hacia la calle como las reales.
  const frame = new THREE.Matrix4().makeRotationZ(.07).setPosition(neck.x - .03, neck.y, 0);
  m.within(frame, () => luminaire(m));

  // Bajante de la acometida por el lado del andén, con sus zunchos.
  m.paint = PAINT.conduit;
  m.sweep([V(-poleRadius(brace) - .014, brace - .2, 0), V(-poleRadius(4.4) - .014, 4.4, 0), V(-poleRadius(3) - .014, 3, 0)], .015, 4, { capEnd: true });
  m.paint = PAINT.strap;
  for (const y of [3.3, 4.6]) m.sweep([V(0, y - .012, 0), V(0, y + .012, 0)], poleRadius(y) + .007, 10);

  // Rótulo de inventario a ambos lados.
  wrapped(m, CELLS.mark, -1, 2.72, 0, .13, .09);
  wrapped(m, CELLS.mark, -1, 2.72, Math.PI, .13, .09);

  // Cuatro juegos de carteles y cableado: los postes vecinos no quedan iguales.
  wrapped(m, CELLS.poster(0), 0, 1.72, .6, .24, .32, .015);
  wrapped(m, CELLS.poster(3), 0, 1.2, 2.4, .2, .22);
  wrapped(m, CELLS.poster(1), 1, 1.86, 2.9, .22, .3, -.02);
  wrapped(m, CELLS.poster(2), 1, 1.34, -.5, .2, .2, .012);
  wrapped(m, CELLS.poster(4), 1, 2.1, 1.5, .16, .2);
  wrapped(m, CELLS.poster(2), 2, 1.56, 1.1, .24, .3, .01);
  wrapped(m, CELLS.poster(0), 3, 1.42, -2.2, .2, .26, -.015);
  wrapped(m, CELLS.poster(3), 3, 1.95, .2, .14, .18);
  fiberBox(m, 0, 1, 4.3);
  fiberBox(m, 2, -1, 3.85);

  return m.build();
}

/** Un cuadro para el resplandor y otro para el reflejo en el piso mojado. */
export function createLampHaloGeometry() {
  const { lens } = STREET_LAMP, position = [], corner = [], kind = [], index = [];
  [1, -1].forEach((quadKind, i) => {
    for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      position.push(lens.x, lens.y - .02, 0);
      corner.push(cx, cy);
      kind.push(quadKind);
    }
    const base = i * 4;
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('haloCorner', new THREE.Float32BufferAttribute(corner, 2));
  geometry.setAttribute('haloKind', new THREE.Float32BufferAttribute(kind, 1));
  geometry.setIndex(index);
  // Los cuadros se abren en el shader: los límites incluyen el resplandor y el reflejo.
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += 12;
  geometry.computeBoundingBox();
  geometry.boundingBox.expandByScalar(12);
  return geometry;
}

// ---------- materiales ----------

// Una de cada cuatro luminarias ya es LED, las demás siguen con sodio: lo que se ve de noche.
const LAMP_TONE = /* glsl */`
  vec3 lampTone(float seed, vec3 led, vec3 sodium) { return fract(seed) > .74 ? led : sodium; }
`;

export function createStreetLampMaterial(night, atlas) {
  const material = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: .8, metalness: 0 });
  material.name = 'Poste de alumbrado';
  material.customProgramCacheKey = () => 'street-lamp-v1';
  material.onBeforeCompile = shader => {
    shader.uniforms.lampNight = night;
    shader.vertexShader = /* glsl */`
      attribute float signalLens;
      attribute vec2 signalSurface;
      attribute vec2 signalLensUv;
      uniform float lampNight;
      varying vec2 vLampSurface;
      varying vec2 vLampUv;
      varying vec3 vLampGlow;
      varying float vLampIsLens;
      ${LAMP_TONE}
    ` + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      vLampSurface = signalSurface;
      vLampUv = signalLensUv;
      vLampGlow = vec3(0.);
      vLampIsLens = 0.;
      #ifdef USE_INSTANCING
        float lampSeed = instanceMatrix[3].x * .37 + instanceMatrix[3].z * .71;
      #else
        float lampSeed = 0.;
      #endif
      if (signalLens > 8.5) {
        // Cada poste muestra un solo juego de carteles y cableado.
        if (abs(signalLens - 9. - mod(floor(lampSeed), 4.)) > .5) transformed = vec3(0.);
      } else if (signalLens > .5) {
        vLampIsLens = 1.;
        vLampGlow = lampTone(lampSeed, vec3(1., .86, .68), vec3(1., .56, .16)) * lampNight;
      }
    `);
    shader.fragmentShader = /* glsl */`
      varying vec2 vLampSurface;
      varying vec2 vLampUv;
      varying vec3 vLampGlow;
      varying float vLampIsLens;
    ` + shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vLampSurface.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vLampSurface.y;')
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        if (vLampIsLens > .5) {
          // Matriz de diodos de cerca; a lo lejos se funde para no titilar.
          vec2 lampGrid = vLampUv * vec2(9., 4.5);
          float lampDot = 1. - smoothstep(.16, .46, length(fract(lampGrid) - .5));
          float lampFar = clamp(fwidth(lampGrid.y) * 1.4, 0., 1.);
          float lampCore = 1. - smoothstep(0., 1.25, length(vLampUv));
          diffuseColor.rgb *= mix(mix(.34, 1.3, lampDot), .75, lampFar);
          totalEmissiveRadiance += vLampGlow * mix(.9 + lampDot * 2.6, 2.2, lampFar) * (1. + lampCore);
        }
      `);
  };
  return chainSunField(material);
}

/**
 * Resplandor aditivo. No se marca transparente porque el mobiliario instanciado no acepta
 * transparencias: se dibuja al final de los opacos, sin escribir profundidad.
 */
export function createLampHaloMaterial(wet) {
  return new THREE.ShaderMaterial({
    name: 'Resplandor de farol',
    uniforms: { lampWet: wet },
    transparent: false, depthWrite: false, depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false, fog: false,
    vertexShader: /* glsl */`
      attribute vec2 haloCorner;
      attribute float haloKind;
      uniform float lampWet;
      varying vec2 vHaloCorner;
      varying vec3 vHaloTint;
      varying float vHaloStreak;
      ${LAMP_TONE}
      void main() {
        vHaloCorner = haloCorner;
        vHaloTint = vec3(0.);
        vHaloStreak = 0.;
        gl_Position = vec4(2., 2., 2., 1.);
        #ifdef USE_INSTANCING
          vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.);
          float lampSeed = instanceMatrix[3].x * .37 + instanceMatrix[3].z * .71;
        #else
          vec4 world = modelMatrix * vec4(position, 1.);
          float lampSeed = 0.;
        #endif
        vec3 toCamera = cameraPosition - world.xyz;
        float distanceToCamera = length(toCamera);
        vec3 tint = lampTone(lampSeed, vec3(1., .84, .62), vec3(1., .6, .24));
        if (haloKind < 0.) {
          // El reflejo cae sobre la línea que une la luminaria con quien mira. Sin agua no se dibuja.
          float strength = lampWet * .3;
          vec2 toEye = cameraPosition.xz - world.xz;
          float reach = length(toEye);
          if (strength < .01 || reach < 2.) return;
          vec2 along = toEye / reach, across = vec2(-along.y, along.x);
          float middle = min(reach * .3, 11.), halfLength = clamp(reach * .3, 2.5, 8.5);
          vec2 point = world.xz + along * (middle + haloCorner.y * halfLength) + across * haloCorner.x * (.8 + reach * .012);
          gl_Position = projectionMatrix * viewMatrix * vec4(point.x, .05, point.y, 1.);
          vHaloTint = tint * strength;
          vHaloStreak = 1.;
          return;
        }
        // La lente mira hacia abajo: desde arriba casi no se ve.
        float below = smoothstep(-.4, .1, -toCamera.y / max(distanceToCamera, .001));
        vec4 view = viewMatrix * world;
        view.xyz += normalize(-view.xyz) * min(.5, distanceToCamera * .5);
        // A lo lejos el destello casi no se encoge en pantalla, como en una foto.
        float radius = 1.05 * (1. + min(distanceToCamera, 90.) * .022);
        view.xy += haloCorner * radius;
        gl_Position = projectionMatrix * view;
        vHaloTint = tint * mix(.16, .72, below);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vHaloCorner;
      varying vec3 vHaloTint;
      varying float vHaloStreak;
      void main() {
        float r = length(vHaloCorner);
        float glow = pow(max(0., 1. - r), 2.8) + pow(max(0., 1. - r * 3.2), 2.) * .55;
        float streak = pow(max(0., 1. - vHaloCorner.y * vHaloCorner.y), 2.) * pow(max(0., 1. - abs(vHaloCorner.x)), 2.);
        gl_FragColor = vec4(vHaloTint * mix(glow, streak, vHaloStreak), 1.);
      }
    `
  });
}

// ---------- recursos compartidos ----------

let shared = null;
const night = { value: 0 }, wet = { value: 0 };

/** Todos los faroles comparten estos recursos; se liberan al soltar el último. */
export function acquireStreetLampAssets() {
  if (!shared) {
    const atlas = createStreetLampAtlas();
    shared = {
      users: 0, atlas,
      geometry: createStreetLampGeometry(),
      material: createStreetLampMaterial(night, atlas),
      haloGeometry: createLampHaloGeometry(),
      haloMaterial: createLampHaloMaterial(wet)
    };
    shared.haloMaterial.visible = night.value > .5;
  }
  shared.users++;
  return shared;
}

export function releaseStreetLampAssets() {
  if (!shared || --shared.users > 0) return;
  shared.geometry.dispose();
  shared.material.dispose();
  shared.haloGeometry.dispose();
  shared.haloMaterial.dispose();
  shared.atlas.dispose();
  shared = null;
}

/** Sin llamadas de dibujo de día: el resplandor ni siquiera entra en la lista. */
export function setStreetLampNight(isNight) {
  night.value = isNight ? 1 : 0;
  if (shared) shared.haloMaterial.visible = isNight;
}

export function setStreetLampWetness(amount = 0) { wet.value = amount; }
