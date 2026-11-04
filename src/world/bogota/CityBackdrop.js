// src/world/bogota/CityBackdrop.js
// Lo que se ve más allá del perímetro: ciudad instanciada, cerros y barrio en la ladera. No tiene
// colisiones ni sombras y cuesta unas pocas llamadas de dibujo, se mire hacia donde se mire.
// Las texturas se resuelven en el sombreador: ventanas, pisos y luz de noche salen de la escala de
// cada bloque. La niebla propia deja una silueta en vez de borrar lo que está lejos.
import * as THREE from 'three';

const hash = (a, b, salt = 0) => {
  let h = Math.imul(Math.round(a) + 104729, 73856093) ^ Math.imul(Math.round(b) + 7919, 19349663) ^ Math.imul(salt + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// La cámara corta en 180-300 m. Se comprime lo que queda después de la niebla real, sin igualar
// las distancias: dos bloques lejanos se siguen tapando en el orden correcto.
const DEPTH_COMPRESS = /* glsl */`
  { float zn = gl_Position.z / gl_Position.w;
    float zc = zn > 0.9998 ? 0.9998 + (zn - 0.9998) * 0.14 : zn;
    gl_Position.z = zc * gl_Position.w; }
`;

// Del cielo sale cuánta luz hay: la misma niebla sigue la hora y el clima, sin código por cuadro.
const SKY_LIGHT = /* glsl */`
  float skyLum = dot(fogColor, vec3(.3, .6, .1));
  float light = clamp(skyLum * 1.42, .085, 1.);
  float night = smoothstep(.40, .15, skyLum);
  float hazeBoost = clamp(135. / fogFar, .8, 3.);
`;

const HAZE_REACH = '(1. - .65 * smoothstep(135., 170., fogFar))';
/**
 * Cerca del horizonte, lo lejano queda tan cubierto como la ciudad real que tiene delante, que a esa distancia ya es solo
 * niebla. Con el tope de niebla solo, esa ciudad se recortaría como un cartón pálido contra cerros y torres. La bruma se
 * mide por el ángulo de la mirada: es lo que tapa esa ciudad desde donde esté la cámara. Con el día despejado queda baja.
 */
export const footHaze = haze =>
  `max(${haze}, smoothstep(fogNear, fogFar, vFogDepth) * (1. - smoothstep(.06 * ${HAZE_REACH}, .3 * ${HAZE_REACH}, normalize(vSkyFogRay).y)))`;

function patchShared(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <project_vertex>', `#include <project_vertex>\n${DEPTH_COMPRESS}`);
}

function createBlockMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  material.name = 'Ciudad de fondo';
  material.onBeforeCompile = shader => {
    patchShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBlockMeters; varying vec3 vBlockNormal; varying float vBlockSeed; varying float vBlockHeight;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vBlockMeters = (position + vec3(.5, 0., .5)) * sc;
          vBlockNormal = normal;
          vBlockHeight = sc.y;
          vBlockSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453); }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vBlockMeters; varying vec3 vBlockNormal; varying float vBlockSeed; varying float vBlockHeight;
        float blockHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`)
      .replace('#include <fog_fragment>', /* glsl */`
      #ifdef USE_FOG
        ${SKY_LIGHT}
        vec3 n = vBlockNormal;
        vec3 wall = vColor.rgb;
        vec3 col, glow = vec3(0.);
        // Colores casi blancos: iglesia del cerro, siempre iluminada de noche.
        float chapel = step(.92, min(wall.r, min(wall.g, wall.b)));
        if (n.y > .5) {
          col = wall * .62 + vec3(.03);
          glow = wall * chapel * .8 * night;
        } else {
          vec2 m = abs(n.x) > .5 ? vec2(vBlockMeters.z, vBlockMeters.y) : vec2(vBlockMeters.x, vBlockMeters.y);
          float bayMeters = 2.3 + vBlockSeed * .9;
          vec2 cell = vec2(m.x / bayMeters, m.y / 3.05);
          vec2 id = floor(cell), f = fract(cell), dd = fwidth(cell);
          float lod = clamp(max(dd.x, dd.y) * 1.5, 0., 1.);
          float wx = smoothstep(.27 - dd.x, .27 + dd.x, f.x) * (1. - smoothstep(.73 - dd.x, .73 + dd.x, f.x));
          float wy = smoothstep(.32 - dd.y, .32 + dd.y, f.y) * (1. - smoothstep(.76 - dd.y, .76 + dd.y, f.y));
          float win = wx * wy;
          float bayTone = .9 + .16 * blockHash(vec2(id.x + vBlockSeed * 40., 3.));
          float streak = .94 + .1 * blockHash(vec2(floor(m.x * 1.7), floor(m.y / 7.) + vBlockSeed * 9.));
          float grime = mix(.8, 1., smoothstep(0., 2.4, vBlockHeight - m.y));
          vec3 walls = wall * bayTone * streak * grime;
          // Losa de cada piso, alféizar y sombra bajo el dintel: de cerca la ventana deja de ser un hueco plano.
          float slab = 1. - smoothstep(0., .05 + dd.y, f.y);
          float sill = smoothstep(.27 - dd.y, .27, f.y) * (1. - smoothstep(.31, .31 + dd.y, f.y)) * wx;
          float lintel = smoothstep(.76 - dd.y, .76, f.y) * (1. - smoothstep(.83, .83 + dd.y, f.y)) * wx;
          walls = mix(walls, wall * .72, slab * .75 * (1. - lod));
          walls = mix(walls, vec3(.74, .71, .65), sill * .8 * (1. - lod));
          walls = mix(walls, wall * .58, lintel * .7 * (1. - lod));
          float roll = blockHash(id + vBlockSeed * 91.7);
          float lit = step(.82, roll);
          float warm = blockHash(id.yx + vBlockSeed * 13.);
          vec3 glass = mix(vec3(.13, .16, .19), vec3(.3, .37, .42), blockHash(id * 1.3 + vBlockSeed * 17.));
          // Marco y parteluz: el vidrio queda partido, como una ventana de verdad.
          float bar = 1. - smoothstep(.016, .024 + dd.x, abs(f.x - .5));
          glass = mix(glass, wall * .5 + vec3(.1), bar * (1. - lod));
          // Primer piso: vitrinas y cortinas metálicas, sin el mismo ritmo de los pisos altos.
          if (m.y < 3.05) {
            win = wx * (1. - smoothstep(.86 - dd.y, .86 + dd.y, f.y)) * smoothstep(.06 - dd.y, .06 + dd.y, f.y);
            walls *= .72;
            glass = mix(glass, vec3(.34, .35, .33), step(.5, blockHash(id + 3.1)));
            lit = step(.6, blockHash(id + vBlockSeed * 5.));
          }
          float cover = mix(win, .2, lod);
          col = mix(walls, glass, cover);
          // Cada ventana enciende a su manera; lejos queda su promedio, sin centelleo.
          float level = .34 + .66 * fract(roll * 7.31);
          float glowMask = mix(win * lit * level * (.72 + .28 * f.y), .2 * .18, lod);
          glow = mix(vec3(.96, .72, .45), vec3(.56, .68, .8), step(.82, warm)) * glowMask * night * .72;
          glow = mix(glow, wall * .85, chapel * night);
          // Cada cara recibe una luz distinta aunque no existan luces en la escena.
          float side = n.z > .5 ? 1. : n.z < -.5 ? .74 : n.x < -.5 ? .9 : .66;
          col *= side;
          // Sombra de contacto en el suelo y hacia arriba un poco más de cielo.
          col *= mix(.72, 1., smoothstep(0., 7., m.y));
        }
        vec3 lit3 = col * light + glow;
        // Perspectiva aérea propia: el fondo se aleja aunque esté a pocos metros de la ciudad real.
        float cap = 1. - pow(1. - mix(.52, .88, smoothstep(60., 1000., vFogDepth)), hazeBoost);
        float aerial = .68 * (1. - exp(-vFogDepth / 150.));
        float haze = ${footHaze('min(max(smoothstep(fogNear, fogFar, vFogDepth), aerial), cap)')};
        gl_FragColor.rgb = skyFogMix(lit3, haze) + glow * haze * .35;
      #endif
      `);
  };
  material.customProgramCacheKey = () => 'bogota-ciudad-fondo';
  return material;
}

function createTerrainMaterial() {
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true });
  material.name = 'Cerros de fondo';
  material.onBeforeCompile = shader => {
    patchShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTerrainWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\nvTerrainWorld = position;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTerrainWorld;
        float terrainHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 19873.17); }
        float terrainNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(terrainHash(i), terrainHash(i + vec2(1., 0.)), f.x),
                     mix(terrainHash(i + vec2(0., 1.)), terrainHash(i + vec2(1., 1.)), f.x), f.y);
        }`)
      .replace('#include <fog_fragment>', /* glsl */`
      #ifdef USE_FOG
        ${SKY_LIGHT}
        // Mancha de bosque: el cerro no es de un solo verde aunque casi no tenga vértices.
        vec2 q = vTerrainWorld.xz;
        float canopy = terrainNoise(q / 17.) * .55 + terrainNoise(q / 6.1) * .3 + terrainNoise(q / 61.) * .45;
        float isTerrain = step(1., vTerrainWorld.y);
        // Tan lejos no se distingue el bosque, y el segundo cordón es casi una pared: la mancha lo dejaría a rayas.
        float forest = isTerrain * (1. - smoothstep(650., 1000., vFogDepth));
        vec3 c = vColor.rgb * mix(1., .62 + canopy * .62, forest) * light;
        float cap = 1. - pow(1. - mix(.34, .74, smoothstep(180., 1300., vFogDepth)), hazeBoost);
        float haze = ${footHaze('min(smoothstep(fogNear, fogFar, vFogDepth), cap)')};
        gl_FragColor.rgb = skyFogMix(c, haze);
      #endif
      `);
  };
  material.customProgramCacheKey = () => 'bogota-cerros-fondo';
  return material;
}

const PEAK_ANGLE = -.205;
const BACKDROP_SECTORS = 8, BACKDROP_VIEW_MARGIN = 60, ROOFTOP_RANGE = 220;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Altura de la cresta según la dirección: cerros altos al oriente y al sur, más bajos al norte. */
function ridgeHeight(angle) {
  const east = Math.max(0, Math.cos(angle)), south = Math.max(0, Math.sin(angle)),
    west = Math.max(0, -Math.cos(angle)), north = Math.max(0, -Math.sin(angle));
  const base = 40 + 58 * east ** 1.2 + 72 * south ** 1.6 + 34 * west ** 2 + 6 * north;
  const noise = Math.sin(angle * 7.3 + 1) * 8 + Math.sin(angle * 17.1 + 2.1) * 4.6 + Math.sin(angle * 41.7) * 1.8 + Math.sin(angle * 3.1) * 7;
  const delta = Math.atan2(Math.sin(angle - PEAK_ANGLE), Math.cos(angle - PEAK_ANGLE));
  return base + noise + 62 * Math.exp(-((delta / .082) ** 2));
}

function buildTerrain({ width, height, corridors }) {
  const cx = width / 2, cz = height / 2;
  const position = [], color = [], index = [];
  const push = (x, y, z, r, g, b) => { position.push(x, y, z); color.push(r, g, b); return position.length / 3 - 1; };
  const hx = cx + 340;
  // El sur queda más cerca: la ladera con su barrio se alcanza a ver por encima de la ciudad baja.
  const ringAt = angle => 1 / Math.hypot(Math.cos(angle) / hx, Math.sin(angle) / (cz + (Math.sin(angle) > 0 ? 190 : 300)));

  // Suelo plano desde el borde del mapa hasta más allá de los cerros.
  const rect = (x0, z0, x1, z1, [r, g, b], y = -.04) => {
    const a = push(x0, y, z0, r, g, b), c = push(x1, y, z0, r, g, b), d = push(x1, y, z1, r, g, b), e = push(x0, y, z1, r, g, b);
    index.push(a, e, d, a, d, c);
  };
  const FAR = 3200, GROUND = [.2, .205, .205];
  // La franja de muro no tiene suelo propio: el anillo la cubre hasta el primer tile interior.
  rect(-FAR, -FAR, width + FAR, 1, GROUND);
  rect(-FAR, height - 1, width + FAR, height + FAR, GROUND);
  rect(-FAR, 1, 1, height - 1, GROUND);
  rect(width - 1, 1, width + FAR, height - 1, GROUND);
  // Las calles siguen detrás de los cierres aunque no se pueda llegar a ellas.
  for (const c of corridors) {
    rect(c.x0, c.z0, c.x1, c.z1, [.17, .175, .18], -.03);
    const side = c.alongX ? 'z' : 'x';
    for (const edge of [0, 1]) {
      const a = side === 'z' ? (edge ? c.z1 : c.z0 - 3) : (edge ? c.x1 : c.x0 - 3);
      if (side === 'z') rect(c.x0, a, c.x1, a + 3, [.38, .37, .34], -.02);
      else rect(a, c.z0, a + 3, c.z1, [.38, .37, .34], -.02);
    }
  }

  // Anillo de montaña: pocas filas radiales; la textura de bosque está en el sombreador.
  const SEGMENTS = 240, rows = [0, .1, .22, .36, .52, .7, .86, 1, 1.28, 1.7];
  const surface = (angle, t) => {
    const radius = ringAt(angle) + t * 340;
    const ridge = ridgeHeight(angle);
    const lift = t <= 1 ? t ** 1.45 : Math.max(.35, 1 - (t - 1) * .6);
    const wrinkle = (Math.sin(angle * 61 + t * 9) * 3.2 + Math.sin(angle * 131 - t * 5) * 1.6) * Math.min(1, t * 2.4) * (t <= 1 ? 1 : .4);
    return { radius, y: Math.max(.5, ridge * lift + wrinkle - 2), ridge };
  };
  const hillColor = (angle, t, y) => {
    const south = Math.exp(-(((angle - Math.PI / 2) / .62) ** 2));
    const shade = .92 + hash(angle * 30, t * 11, 3) * .2;
    const low = [.285, .30, .225], mid = [.205, .285, .205], high = [.27, .325, .255];
    const k = smooth(0, .4, t), m = smooth(.72, 1, t);
    let r = low[0] + (mid[0] - low[0]) * k, g = low[1] + (mid[1] - low[1]) * k, b = low[2] + (mid[2] - low[2]) * k;
    r += (high[0] - r) * m; g += (high[1] - g) * m; b += (high[2] - b) * m;
    // Ladera del sur: tierra y ladrillo donde el barrio ya quitó el bosque.
    const bare = south * (1 - smooth(.5, .82, t));
    r += (.46 - r) * bare; g += (.33 - g) * bare; b += (.25 - b) * bare;
    const face = .84 + .22 * Math.max(0, Math.cos(angle + .9));
    return [r * shade * face, g * shade * face, b * shade * face, y];
  };
  const ringBase = position.length / 3;
  for (let s = 0; s <= SEGMENTS; s++) {
    const angle = -Math.PI + s / SEGMENTS * Math.PI * 2;
    for (const t of rows) {
      const { radius, y } = surface(angle, t);
      const [r, g, b] = hillColor(angle, t, y);
      push(cx + Math.cos(angle) * radius, y, cz + Math.sin(angle) * radius, r, g, b);
    }
  }
  const perRow = rows.length;
  for (let s = 0; s < SEGMENTS; s++) for (let t = 0; t < perRow - 1; t++) {
    const a = ringBase + s * perRow + t, b = a + perRow, c = a + 1, d = b + 1;
    index.push(a, b, c, b, d, c);
  }
  // Segundo cordón, más pálido: da profundidad detrás del primero.
  const farBase = position.length / 3;
  for (let s = 0; s <= SEGMENTS; s += 2) {
    const angle = -Math.PI + s / SEGMENTS * Math.PI * 2;
    const radius = ringAt(angle) + 1050;
    const ridge = ridgeHeight(angle + .35) * 1.55 + 16 + Math.sin(angle * 23) * 7;
    push(cx + Math.cos(angle) * radius, 2, cz + Math.sin(angle) * radius, .32, .4, .4);
    push(cx + Math.cos(angle) * radius, ridge, cz + Math.sin(angle) * radius, .36, .44, .43);
  }
  for (let s = 0; s < SEGMENTS / 2; s++) {
    const a = farBase + s * 2, b = a + 2, c = a + 1, d = b + 1;
    index.push(a, b, c, b, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setIndex(index);
  return { geometry, surface, cx, cz };
}

// Lejos sube la ciudad; cerca del borde queda baja para que los cerros se vean por encima.
function skylineCeiling(distance, direction) {
  const near = distance < 90 ? 11 : distance < 200 ? 16 : distance < 340 ? 24 : 34;
  return near * direction;
}
/** Oriente bajo y colonial hacia el cerro; el norte y el occidente, más edificios de centro. */
function directionalScale(x, z, width, height) {
  if (x > width) return .72;
  if (z < 0) return 1.5;
  if (x < 0) return 1.3;
  if (z > height) return .85;
  return 1;
}
const EAST_COLORS = [[.82, .78, .68], [.76, .62, .42], [.62, .36, .28], [.74, .71, .64], [.58, .46, .36], [.8, .74, .6]];
const BLOCK_COLORS = [
  [.54, .34, .26], [.60, .39, .30], [.47, .29, .22], [.62, .60, .55], [.70, .67, .60],
  [.52, .54, .54], [.74, .69, .58], [.43, .41, .38], [.57, .47, .38], [.64, .54, .45]
];
const CASITA_COLORS = [
  [.55, .32, .23], [.60, .36, .26], [.50, .29, .21], [.66, .42, .30], [.46, .43, .40],
  [.70, .66, .58], [.56, .33, .26], [.42, .50, .55], [.70, .55, .35], [.62, .36, .30]
];

/**
 * Ciudad y cerros de fondo.
 * @param {{ width:number, height:number, corridors:Array, blocks:Array, excluded:Array }} options
 *   width y height en metros; corridors son calles que siguen tras un cierre; blocks, fachadas
 *   del perímetro que comparten material; excluded, rectángulos donde no se levanta nada.
 */
export function buildCityBackdrop({ width, height, corridors = [], blocks: edgeBlocks = [], excluded = [] }) {
  const group = new THREE.Group();
  group.name = 'Ciudad de fondo y cerros';
  group.userData.noMerge = true;
  group.userData.backdrop = true;

  const { geometry: terrainGeometry, surface, cx, cz } = buildTerrain({ width, height, corridors });
  const terrain = new THREE.Mesh(terrainGeometry, createTerrainMaterial());
  terrain.name = 'Suelo y cerros';
  terrain.frustumCulled = false;
  terrain.renderOrder = 11;
  terrain.matrixAutoUpdate = false;
  group.add(terrain);

  const entries = [...edgeBlocks];
  const margin = 2;
  const blocked = (x0, z0, x1, z1) =>
    (x1 > -margin && x0 < width + margin && z1 > -margin && z0 < height + margin) ||
    excluded.some(r => x1 > r.x0 && x0 < r.x1 && z1 > r.z0 && z0 < r.z1) ||
    corridors.some(c => x1 > c.x0 - 4 && x0 < c.x1 + 4 && z1 > c.z0 - 4 && z0 < c.z1 + 4);
  // Las calles que siguen tras un cierre llevan edificios a ambos lados: no son un vacío.
  for (const c of corridors) {
    const length = c.alongX ? c.x1 - c.x0 : c.z1 - c.z0;
    for (let d = 4, i = 0; d < length - 18; i++) {
      const front = 19 + hash(i, c.x0 + c.z0, 7) * 14, deep = 16 + hash(i, c.x0, 8) * 12;
      const scaleHere = directionalScale(c.x0, c.z0 < 0 ? -1 : c.z1, width, height);
      const palette = c.x0 >= width - 4 ? EAST_COLORS : BLOCK_COLORS;
      for (const side of [0, 1]) {
        const h = skylineCeiling(d, scaleHere) * (.62 + hash(i, side + c.z0, 9) * .5);
        const color = palette[Math.floor(hash(i * 3, side + c.x0, 10) * palette.length)];
        const along = c.outward > 0 ? (c.alongX ? c.x0 : c.z0) + d + front / 2 : (c.alongX ? c.x1 : c.z1) - d - front / 2;
        const x = c.alongX ? along : side ? c.x1 + 3 + deep / 2 : c.x0 - 3 - deep / 2;
        const z = c.alongX ? (side ? c.z1 + 3 + deep / 2 : c.z0 - 3 - deep / 2) : along;
        const w = c.alongX ? front : deep, dd = c.alongX ? deep : front;
        const hits = r => x + w / 2 > r.x0 && x - w / 2 < r.x1 && z + dd / 2 > r.z0 && z - dd / 2 < r.z1;
        if (!excluded.some(hits) && !hits({ x0: 0, x1: width, z0: 0, z1: height })) entries.push({ x, z, w, d: dd, h, color });
      }
      d += front + 1;
    }
  }
  const SPAN = 640;
  for (let gz = -SPAN; gz < height + SPAN;) {
    const distanceZ = gz < 0 ? -gz : gz > height ? gz - height : 0;
    const stepZ = 30 + Math.min(1, distanceZ / 400) * 14;
    for (let gx = -SPAN; gx < width + SPAN;) {
      const distanceX = gx < 0 ? -gx : gx > width ? gx - width : 0;
      const distance = Math.max(distanceX, distanceZ);
      const stepX = 32 + Math.min(1, distance / 400) * 14;
      const gap = 9 + hash(gx, gz, 1) * 3;
      const x0 = gx + gap / 2, z0 = gz + gap / 2, w = stepX - gap, d = stepZ - gap;
      if (!blocked(x0, z0, x0 + w, z0 + d)) {
        // La ciudad se queda bajo el pie de los cerros.
        const angle = Math.atan2(z0 + d / 2 - cz, x0 + w / 2 - cx);
        const radius = Math.hypot(x0 + w / 2 - cx, z0 + d / 2 - cz);
        if (radius < surface(angle, .03).radius) {
          const tall = hash(gx, gz, 2);
          const direction = directionalScale(x0, z0, width, height);
          const towerZone = Math.exp(-(((x0 + 300) / 260) ** 2) - (((z0 - height / 2) / 300) ** 2)) * .28;
          const ceiling = skylineCeiling(distance, direction);
          // Torres sueltas solo lejos del borde, donde la bruma ya las aleja de la calle real.
          const isTower = distance > 170 && x0 < width && tall > .955 - towerZone;
          const h = ceiling * (.5 + hash(gx, gz, 3) ** 1.4 * .62) + (isTower ? 22 + hash(gx, gz, 4) * 40 : 0);
          const palette = x0 > width ? EAST_COLORS : BLOCK_COLORS;
          const color = palette[Math.floor(hash(gx, gz, 5) * palette.length)];
          const split = hash(gx, gz, 6);
          if (distance < 320) {
            // Cerca se reparte en varios predios: una manzana entera de una sola altura delata el truco.
            const cols = split < .4 ? 2 : split < .75 ? 3 : 2, rows = split < .4 ? 2 : split < .75 ? 1 : 2;
            for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
              const pw = w / cols, pd = d / rows, part = hash(c * 7 + gx, r * 5 + gz, 14);
              const partColor = palette[Math.floor(hash(c + gx, r + gz, 15) * palette.length)];
              entries.push({ x: x0 + pw * (c + .5), z: z0 + pd * (r + .5), w: pw - .35, d: pd - .35,
                h: Math.max(5.5, h * (.5 + part * .75)), color: partColor });
            }
            if (isTower) entries.push({ x: x0 + w / 2, z: z0 + d / 2, w: w * .55, d: d * .55, h, color });
          } else {
            entries.push({ x: x0 + w / 2, z: z0 + d / 2, w, d, h, color });
            if (isTower) entries.push({ x: x0 + w / 2, z: z0 + d / 2, w: w * .62, d: d * .62, h: h + 6 + hash(gx, gz, 13) * 9, color });
          }
        }
      }
      gx += stepX;
    }
    gz += stepZ;
  }

  // Barrio de ladrillo que trepa la ladera del sur, con caminos y casas sueltas arriba.
  const casitas = [];
  for (let i = 0; i < 1900; i++) {
    const u = hash(i, 1, 21), v = hash(i, 2, 22);
    const angle = Math.PI / 2 - .62 + u * 1.08 + Math.sin(v * 9) * .015;
    const t = .03 + v ** 1.35 * .64;
    // Pierde densidad hacia los bordes y hacia arriba, como un barrio que sigue creciendo.
    const density = Math.exp(-(((u - .5) / .42) ** 2)) * (1 - t * .55);
    if (hash(i, 3, 23) > density) continue;
    const { radius, y } = surface(angle, t);
    const size = 5 + hash(i, 4, 24) * 4.5;
    casitas.push({
      x: cx + Math.cos(angle) * radius, z: cz + Math.sin(angle) * radius, w: size, d: size * (.8 + hash(i, 5, 25) * .5),
      h: 3.2 + hash(i, 6, 26) ** 2 * 6.5, color: CASITA_COLORS[Math.floor(hash(i, 7, 27) * CASITA_COLORS.length)], y: y - 1.2,
      rotation: angle + (hash(i, 8, 28) - .5) * .4
    });
  }
  entries.push(...casitas);

  // Iglesia blanca y teleférico en el cerro del oriente.
  const top = surface(PEAK_ANGLE, 1), toX = (angle, r) => cx + Math.cos(angle) * r, toZ = (angle, r) => cz + Math.sin(angle) * r;
  const px = toX(PEAK_ANGLE, top.radius), pz = toZ(PEAK_ANGLE, top.radius), py = top.y - 1;
  const WHITE = [.97, .96, .92], ROOF = [.42, .24, .18], STEEL = [.2, .2, .2];
  const faceAngle = PEAK_ANGLE + Math.PI;
  entries.push(
    { x: px, z: pz, y: py, w: 22, d: 11, h: 9, color: WHITE, rotation: Math.PI / 2 - PEAK_ANGLE },
    { x: px + 9 * Math.cos(faceAngle) + 6 * Math.sin(faceAngle), z: pz + 9 * Math.sin(faceAngle) - 6 * Math.cos(faceAngle), y: py, w: 4, d: 4, h: 18, color: WHITE, rotation: -PEAK_ANGLE },
    { x: px + 9 * Math.cos(faceAngle) - 6 * Math.sin(faceAngle), z: pz + 9 * Math.sin(faceAngle) + 6 * Math.cos(faceAngle), y: py, w: 4, d: 4, h: 18, color: WHITE, rotation: -PEAK_ANGLE },
    { x: px, z: pz, y: py + 9, w: 20, d: 8.4, h: 1.6, color: ROOF, rotation: Math.PI / 2 - PEAK_ANGLE }
  );
  // Las pilonas y la línea siguen la ladera; las cabinas son lo único que se alcanza a leer.
  const cable = [];
  const stationT = .34, cableAngle = PEAK_ANGLE - .012;
  const lower = surface(cableAngle, stationT);
  const a = new THREE.Vector3(toX(cableAngle, lower.radius), lower.y + 9, toZ(cableAngle, lower.radius));
  const b = new THREE.Vector3(px - 14 * Math.cos(PEAK_ANGLE), py + 9, pz - 14 * Math.sin(PEAK_ANGLE));
  const direction = b.clone().sub(a), length = direction.length();
  direction.normalize();
  const mid = a.clone().addScaledVector(direction, length / 2);
  cable.push({ position: mid, direction, length, thick: .7 });
  entries.push({ x: a.x, z: a.z, y: a.y - 9, w: 12, d: 9, h: 9, color: WHITE });
  for (let i = 1; i < 5; i++) {
    const k = i / 5, tk = stationT + (1 - stationT) * k, s = surface(cableAngle, tk);
    const pylon = a.clone().addScaledVector(direction, length * k);
    entries.push({ x: pylon.x, z: pylon.z, y: Math.min(pylon.y - 14, s.y - 1), w: 1.4, d: 1.4, h: pylon.y - Math.min(pylon.y - 14, s.y - 1), color: STEEL });
  }
  for (const k of [.27, .71]) {
    const cabin = a.clone().addScaledVector(direction, length * k);
    entries.push({ x: cabin.x, z: cabin.z, y: cabin.y - 4.6, w: 4.2, d: 2.6, h: 3.4, color: [.68, .16, .14], rotation: -PEAK_ANGLE });
  }

  // Cuartos de máquinas y tanques en las azoteas: rompen la línea recta del horizonte. Más lejos
  // ya no se leen como volumen y solo gastarían triángulos.
  const rooftops = [];
  entries.forEach((entry, i) => {
    if (entry.rotation !== undefined || entry.y !== undefined || entry.h < 9 || hash(i, 3, 41) > .45) return;
    if (Math.max(-entry.x, entry.x - width, -entry.z, entry.z - height) > ROOFTOP_RANGE) return;
    const size = 2.2 + hash(i, 4, 41) * 2.4;
    rooftops.push({ x: entry.x + (hash(i, 5, 41) - .5) * Math.max(0, entry.w - size), z: entry.z + (hash(i, 6, 41) - .5) * Math.max(0, entry.d - size),
      y: entry.h - .1, w: size, d: size * (.7 + hash(i, 7, 41) * .5), h: 1.4 + hash(i, 8, 41) * 1.6, color: [.36, .35, .33] });
  });
  entries.push(...rooftops);
  // Sin tapa inferior: nadie ve la base de estos bloques.
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, .5, 0);
  unit.setIndex([...unit.index.array].filter((_, i) => i < 18 || i >= 24));
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3(), place = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  // Partida por costados: desde la calle nunca se ve toda la corona a la vez, y cada costado fuera
  // de cuadro ahorra sus triángulos a cambio de una llamada más por los que sí se ven.
  const sectors = Array.from({ length: BACKDROP_SECTORS }, () => ({ items: [], bounds: new THREE.Box3() }));
  const sectorAt = (x, z) => sectors[Math.floor((Math.atan2(z - cz, x - cx) + Math.PI) / (Math.PI * 2) * BACKDROP_SECTORS) % BACKDROP_SECTORS];
  // Las siluetas de edificios reales van aparte: la isométrica abre el edificio para ver al jugador
  // y una caja de fondo seguiría tapándolo.
  const closedOnly = { items: [], bounds: new THREE.Box3(), closedOnly: true };
  const corner = new THREE.Vector3();
  for (const entry of entries) {
    place.set(entry.x, entry.y ?? -.05, entry.z);
    quaternion.setFromAxisAngle(up, entry.rotation ?? 0);
    scale.set(entry.w, entry.h, entry.d);
    const sector = entry.closedOnly ? closedOnly : sectorAt(entry.x, entry.z), reach = Math.hypot(entry.w, entry.d) / 2;
    sector.items.push({ matrix: new THREE.Matrix4().compose(place, quaternion, scale), color: entry.color });
    sector.bounds.expandByPoint(corner.set(entry.x - reach, place.y, entry.z - reach));
    sector.bounds.expandByPoint(corner.set(entry.x + reach, place.y + entry.h, entry.z + reach));
  }
  for (const line of cable) {
    quaternion.setFromUnitVectors(up, line.direction);
    scale.set(line.thick, line.length, line.thick);
    place.copy(line.position).addScaledVector(line.direction, -line.length / 2);
    const sector = sectorAt(line.position.x, line.position.z);
    sector.items.push({ matrix: new THREE.Matrix4().compose(place, quaternion, scale), color: [.1, .1, .1] });
    sector.bounds.expandByPoint(corner.copy(place));
    sector.bounds.expandByPoint(corner.copy(place).addScaledVector(line.direction, line.length));
  }
  const material = createBlockMaterial();
  const parts = [];
  for (const { items, bounds, closedOnly: onlyClosed = false } of [...sectors, closedOnly]) {
    if (!items.length) continue;
    const mesh = new THREE.InstancedMesh(unit, material, items.length);
    mesh.name = 'Bloques de fondo';
    items.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, tint.setRGB(item.color[0], item.color[1], item.color[2], THREE.LinearSRGBColorSpace));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    group.add(mesh);
    parts.push({ mesh, bounds, onlyClosed });
  }
  // El descarte normal no sirve: estos bloques están más allá del plano lejano y aun así se ven.
  // Solo cuentan los planos de los lados y el de la cámara. El cerro se dibuja siempre y avisa
  // antes de cada cuadro; el margen cubre el cuadro de retraso cuando la cámara gira rápido.
  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
  const outside = (bounds, plane) => plane.distanceToPoint(corner.set(
    plane.normal.x > 0 ? bounds.max.x : bounds.min.x,
    plane.normal.y > 0 ? bounds.max.y : bounds.min.y,
    plane.normal.z > 0 ? bounds.max.z : bounds.min.z)) < -BACKDROP_VIEW_MARGIN;
  terrain.onBeforeRender = (renderer, scene, camera) => {
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const [right, left, , , , near] = frustum.planes;
    const isometric = camera.userData.cameraMode === 'isometric';
    for (const { mesh, bounds, onlyClosed } of parts) {
      mesh.visible = !(onlyClosed && isometric) && !outside(bounds, right) && !outside(bounds, left) && !outside(bounds, near);
    }
  };
  group.userData.blockCount = entries.length + cable.length;
  group.userData.peak = { x: px, z: pz, y: py };
  group.userData.setNight = () => {}; // La luz sale del color del cielo.
  return group;
}
