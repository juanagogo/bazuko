// src/world/bogota/CityBackdrop.js
// Lo que se ve más allá del perímetro: ciudad instanciada, cerros y barrio en la ladera. No tiene
// colisiones ni sombras y cuesta unas pocas llamadas de dibujo, se mire hacia donde se mire.
// Las texturas se resuelven en el sombreador: ventanas, pisos y luz de noche salen de la escala de
// cada bloque. La niebla propia deja una silueta en vez de borrar lo que está lejos.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sinGastarAzar } from './concretoViaducto.js';
import { patchBackdropMist } from './BackdropMist.js';
import { FIGURE_ANGLE, PEAK_ANGLE, buildBackdropTerrain } from './BackdropTerrain.js';
import { makeHillsideStreets, planHillsideSettlement } from './HillsideSettlement.js';
import { BACKDROP_FRONTAGE_GLSL, dressBackdropFrontages, frontageOf } from './BackdropFacades.js';
import { SUN_FIELD_SIDEWAYS, chainSunField, sunFieldUniforms } from './SunFieldShader.js';

const hash = (a, b, salt = 0) => {
  let h = Math.imul(Math.round(a) + 104729, 73856093) ^ Math.imul(Math.round(b) + 7919, 19349663) ^ Math.imul(salt + 1, 83492791);
  h = Math.imul(h ^ (h >>> 13), 2246822519);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// La cámara corta en 180-300 m. Se comprime lo que queda después de la niebla real, sin igualar
// las distancias: dos bloques lejanos se siguen tapando en el orden correcto. Lo que queda detrás
// de la cámara no se toca, para que el recorte del plano cercano siga cayendo donde debe.
const DEPTH_COMPRESS = /* glsl */`
  { float zn = gl_Position.z / gl_Position.w;
    float zc = zn > 0.9998 && gl_Position.w > 0. ? 0.9998 + (zn - 0.9998) * 0.14 : zn;
    gl_Position.z = zc * gl_Position.w; }
`;

// Del cielo sale cuánta luz hay: la misma niebla sigue la hora y el clima, sin código por cuadro.
const SKY_LIGHT = /* glsl */`
  float skyLum = dot(fogColor, vec3(.3, .6, .1));
  float light = clamp(skyLum * 1.42, .085, 1.);
  float night = smoothstep(.40, .15, skyLum);
  float hazeBoost = clamp(135. / fogFar, .8, 3.);
`;

function patchShared(shader) {
  patchBackdropMist(shader);
  shader.vertexShader = shader.vertexShader
    .replace('#include <project_vertex>', `#include <project_vertex>\n${DEPTH_COMPRESS}`);
}

/** @param {{ cx:number, cz:number, hx:number, hzNorth:number, hzSouth:number }} foot  Elipse del pie de los cerros. */
function createBlockMaterial(foot) {
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  material.name = 'Ciudad de fondo';
  const glsl = value => value.toFixed(2);
  material.onBeforeCompile = shader => {
    patchShared(shader);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 instanceSettlement;
        attribute vec4 instanceFrontage;
        varying vec2 vSettlement;
        varying vec4 vBlockFrontage;
        varying vec3 vBlockMeters; varying vec3 vBlockNormal; varying float vBlockSeed; varying float vBlockHeight; varying float vBlockHill;
        varying vec2 vBlockSize;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        { vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
          vBlockFrontage = instanceFrontage;
          if (instanceFrontage.x > 3.5 && abs(instanceFrontage.z) > .5) {
            transformed.y *= .09 + .91 * (.5 + sign(instanceFrontage.z) * position.z);
          }
          vBlockMeters = (position + vec3(.5, 0., .5)) * sc;
          vBlockSize = sc.xz;
          vSettlement = instanceSettlement;
          vBlockNormal = normal;
          vBlockHeight = sc.y;
          vBlockSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
          // Lo que está del pie de los cerros hacia afuera es ladera: casitas y santuarios.
          vec2 fromCenter = instanceMatrix[3].xz - vec2(${glsl(foot.cx)}, ${glsl(foot.cz)});
          vBlockHill = step(1., length(fromCenter / vec2(${glsl(foot.hx)}, fromCenter.y > 0. ? ${glsl(foot.hzSouth)} : ${glsl(foot.hzNorth)}))); }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vSettlement;
        varying vec4 vBlockFrontage;
        varying vec3 vBlockMeters; varying vec3 vBlockNormal; varying float vBlockSeed; varying float vBlockHeight; varying float vBlockHill;
        varying vec2 vBlockSize;
        float blockHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float blockNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(blockHash(i), blockHash(i + vec2(1., 0.)), f.x), mix(blockHash(i + vec2(0., 1.)), blockHash(i + vec2(1., 1.)), f.x), f.y);
        }
        ${BACKDROP_FRONTAGE_GLSL}`)
      .replace('#include <fog_fragment>', /* glsl */`
      #ifdef USE_FOG
        ${SKY_LIGHT}
        vec3 n = vBlockNormal;
        vec3 wall = vColor.rgb;
        vec3 col, glow = vec3(0.);
        // Colores casi blancos: iglesia del cerro, siempre iluminada de noche.
        float chapel = step(.92, min(wall.r, min(wall.g, wall.b)));
        // Más blanco todavía: la figura del segundo pico, que es de una pieza y no lleva ventanas.
        float figure = step(.945, min(wall.r, min(wall.g, wall.b)));
        float shed = step(1.5, vSettlement.y);
        float house = step(.5, vSettlement.y) * (1. - shed);
        if (vBlockFrontage.x > .5) {
          col = frontageColor(wall, n, night, glow);
        } else if (n.y > .5) {
          // Azotea: pretil con su sombra por dentro, losa manchada de agua y algún parche de manto oscuro.
          vec2 r = vBlockMeters.xz, rd = fwidth(r);
          float roofLod = clamp(max(rd.x, rd.y) * 1.2, 0., 1.);
          float edge = min(min(r.x, vBlockSize.x - r.x), min(r.y, vBlockSize.y - r.y));
          float parapet = 1. - smoothstep(.28, .28 + max(rd.x, rd.y), edge);
          float lee = smoothstep(.28, .4, edge) * (1. - smoothstep(.4, 1.3, edge));
          float damp = blockNoise(r / 4.3 + vBlockSeed * 37.) * .6 + blockNoise(r / 1.7 + vBlockSeed * 11.) * .4;
          float tar = smoothstep(.72, .8, blockNoise(r / 3.1 + vBlockSeed * 53.)) * step(6., vBlockHeight);
          vec3 slab = (wall * .62 + vec3(.03)) * (.88 + .2 * damp);
          slab = mix(slab, vec3(.15, .145, .14), tar * .6);
          slab *= 1. - .2 * lee;
          slab = mix(slab, wall * .72 + vec3(.04), parapet);
          col = mix(slab, wall * .62 + vec3(.03), max(roofLod, chapel));
          vec3 concrete = mix(vec3(.26, .25, .23), vec3(.43, .407, .365), vBlockSeed) * (.94 + .13 * mix(damp, .5, roofLod));
          col = mix(col, mix(concrete * (1. - .22 * lee), wall * .83, parapet), house);
          col = mix(col, wall * (.88 + .16 * mix(damp, .5, roofLod)), shed);
          glow = wall * chapel * .8 * night;
        } else {
          vec2 m = abs(n.x) > .5 ? vec2(vBlockMeters.z, vBlockMeters.y) : vec2(vBlockMeters.x, vBlockMeters.y);
          float grade = m.y - vSettlement.x;
          m.y = max(0., grade);
          float bayMeters = 2.3 + vBlockSeed * .9;
          float storey = mix(3.05, 2.72, house);
          vec2 cell = vec2(m.x / bayMeters, m.y / storey);
          vec2 id = floor(cell), f = fract(cell), dd = fwidth(cell);
          float lod = clamp(max(dd.x, dd.y) * 1.5, 0., 1.);
          float wx = smoothstep(.27 - dd.x, .27 + dd.x, f.x) * (1. - smoothstep(.73 - dd.x, .73 + dd.x, f.x));
          float wy = smoothstep(.32 - dd.y, .32 + dd.y, f.y) * (1. - smoothstep(.76 - dd.y, .76 + dd.y, f.y));
          float win = wx * wy;
          float bayTone = .9 + .16 * blockHash(vec2(id.x + vBlockSeed * 40., 3.));
          float floorTone = .9 + .14 * blockHash(vec2(id.y + vBlockSeed * 23., 7.));
          float streak = .94 + .1 * blockHash(vec2(floor(m.x * 1.7), floor(m.y / 7.) + vBlockSeed * 9.));
          float grime = mix(.8, 1., smoothstep(0., 2.4, vBlockHeight - m.y));
          vec3 walls = wall * bayTone * mix(1., floorTone, 1. - vBlockHill) * streak * grime;
          // Losa de cada piso, alféizar y sombra bajo el dintel: de cerca la ventana deja de ser un hueco plano.
          float slab = 1. - smoothstep(0., .05 + dd.y, f.y);
          float sill = smoothstep(.27 - dd.y, .27, f.y) * (1. - smoothstep(.31, .31 + dd.y, f.y)) * wx;
          float lintel = smoothstep(.76 - dd.y, .76, f.y) * (1. - smoothstep(.83, .83 + dd.y, f.y)) * wx;
          walls = mix(walls, wall * .72, slab * .75 * (1. - lod));
          walls = mix(walls, vec3(.74, .71, .65), sill * .8 * (1. - lod));
          walls = mix(walls, wall * .58, lintel * .7 * (1. - lod));
          float roll = blockHash(id + vBlockSeed * 91.7);
          // En la ladera hay más casas con la luz prendida que oficinas en el centro.
          float lit = step(mix(.82, .6, vBlockHill), roll);
          float warm = blockHash(id.yx + vBlockSeed * 13.);
          vec3 glass = mix(vec3(.13, .16, .19), vec3(.3, .37, .42), blockHash(id * 1.3 + vBlockSeed * 17.));
          // Marco y parteluz: el vidrio queda partido, como una ventana de verdad.
          float bar = 1. - smoothstep(.016, .024 + dd.x, abs(f.x - .5));
          glass = mix(glass, wall * .5 + vec3(.1), bar * (1. - lod));
          // Primer piso: vitrinas y cortinas metálicas, sin el mismo ritmo de los pisos altos.
          if (m.y < storey && house < .5) {
            win = wx * (1. - smoothstep(.86 - dd.y, .86 + dd.y, f.y)) * smoothstep(.06 - dd.y, .06 + dd.y, f.y);
            walls *= .72;
            glass = mix(glass, vec3(.34, .35, .33), step(.5, blockHash(id + 3.1)));
            lit = step(.6, blockHash(id + vBlockSeed * 5.));
          }
          if (house > .5) {
            // Las medianeras tienen menos huecos y la planta de la calle lleva un acceso angosto.
            float sideWall = abs(n.x) * step(.27, vBlockSeed);
            win *= 1. - .84 * sideWall;
            if (n.z > .5 && id.x == 0. && id.y == 0.) {
              float door = (1. - smoothstep(.16 - dd.x, .16 + dd.x, abs(f.x - .52)))
                * (1. - smoothstep(.73 - dd.y, .73 + dd.y, f.y));
              win = max(win, door);
              glass *= .75;
              lit = 0.;
            }
            vec2 brick = m / vec2(.48, .185);
            float brickFootprint = max(fwidth(brick.x), fwidth(brick.y));
            brick.x += .5 * mod(floor(brick.y), 2.);
            float grout = smoothstep(.02, .1 + brickFootprint * .24, min(fract(brick.x), fract(brick.y)));
            float fired = .86 + .22 * blockHash(floor(brick) + vBlockSeed * 14.);
            float face = mix(.87, fired, grout);
            walls *= mix(face, 1., smoothstep(.38, 1.05, brickFootprint));
          }
          float cover = mix(win, .2, lod);
          col = mix(walls, glass, cover);
          // Remate claro del pretil y, debajo, la cornisa con su sombra: el bloque deja de terminar en filo.
          float fromTop = vBlockHeight - m.y, ddy = fwidth(m.y);
          float coping = 1. - smoothstep(.32, .32 + ddy, fromTop);
          float cornice = smoothstep(.55 - ddy, .55, fromTop) * (1. - smoothstep(.9, .9 + ddy, fromTop));
          float drip = smoothstep(.9 - ddy, .9, fromTop) * (1. - smoothstep(1.25, 1.25 + ddy, fromTop));
          float trim = step(6., vBlockHeight) * (1. - figure) * (1. - chapel);
          col = mix(col, wall * 1.06 + vec3(.025), coping * trim);
          col = mix(col, wall * .82, cornice * trim);
          col = mix(col, col * .62, drip * trim);
          win *= 1. - (coping + cornice + drip) * trim;
          col = mix(col, wall * (.86 + .14 * smoothstep(0., 8., m.y)), figure);
          // Cada ventana enciende a su manera; lejos queda su promedio, sin centelleo.
          float level = .34 + .66 * fract(roll * 7.31);
          // De lejos, las casitas de la ladera son puntos: cerca de la mitad queda prendida entera.
          float farGlow = mix(.2 * .18, .2 * step(.46, vBlockSeed) * (.55 + .45 * fract(vBlockSeed * 13.7)), vBlockHill);
          float glowMask = mix(win * lit * level * (.72 + .28 * f.y), farGlow, lod);
          glow = mix(vec3(.96, .72, .45), vec3(.56, .68, .8), step(mix(.82, .93, vBlockHill), warm)) * glowMask * night * .72;
          // Bombillo amarillo de barrio, no luz de oficina.
          glow *= mix(vec3(1.), vec3(1.12, .84, .52), vBlockHill);
          glow = mix(glow, wall * .85, chapel * night);
          // Cada cara recibe una luz distinta aunque no existan luces en la escena.
          float side = n.z > .5 ? 1. : n.z < -.5 ? .74 : n.x < -.5 ? .9 : .66;
          col *= side;
          // Sombra de contacto en el suelo y hacia arriba un poco más de cielo.
          col *= mix(.72, 1., smoothstep(0., 7., m.y));
          col = mix(col, wall * .86, chapel * .38);
          float footing = house * (1. - smoothstep(-.08, .15, grade));
          col = mix(col, vec3(.25, .235, .207) * side * (.84 + .23 * blockNoise(m / 1.9)), footing);
          col = mix(col, wall * side * .85, shed);
          glow *= (1. - footing) * (1. - shed);
        }
        // Vista desde lo alto: las ventanas prendidas se acaban antes de la línea del horizonte.
        float highView = smoothstep(18., 45., cameraPosition.y);
        glow *= 1. - highView * smoothstep(-.05, -.015, normalize(vSkyFogRay).y) * (1. - chapel);
        vec3 lit3 = col * light + glow;
        // Perspectiva aérea propia: el fondo se aleja aunque esté a pocos metros de la ciudad real.
        // La ladera se tapa menos: el ladrillo y el blanco de los santuarios llegan hasta la calle.
        float cap = 1. - pow(1. - mix(mix(.52, .36, vBlockHill), mix(.88, .7, vBlockHill), smoothstep(60., 1000., vFogDepth)), hazeBoost);
        float aerial = .68 * (1. - exp(-vFogDepth / 150.));
        float haze = backdropMist(min(max(smoothstep(fogNear, fogFar, vFogDepth), aerial), cap));
        gl_FragColor.rgb = skyFogMix(lit3, haze) + glow * haze * .35;
      #endif
      `);
  };
  material.customProgramCacheKey = () => 'bogota-ciudad-fondo';
  return material;
}

function createTerrainMaterial(hills) {
  const material = new THREE.MeshBasicMaterial({ color: '#ffffff', vertexColors: true, depthWrite: hills });
  material.name = hills ? 'Cerros de fondo' : 'Suelo de fondo';
  material.customProgramCacheKey = () => hills ? 'bogota-cerros-fondo' : 'bogota-suelo-fondo';
  material.onBeforeCompile = shader => {
    patchShared(shader);
    if (!hills) {
      // Los triángulos grandes del suelo quedan detrás de todo, igual que el cielo.
      shader.vertexShader = shader.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\ngl_Position.z = gl_Position.w * .99999;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', /* glsl */`
        #ifdef USE_FOG
          ${SKY_LIGHT}
          float cap = 1. - pow(1. - mix(.26, .62, smoothstep(180., 1300., vFogDepth)), hazeBoost);
          float haze = backdropMist(min(smoothstep(fogNear, fogFar, vFogDepth), cap));
          gl_FragColor.rgb = skyFogMix(vColor.rgb * light, haze);
        #endif
      `);
      return;
    }
    shader.uniforms.uSunFieldSun = sunFieldUniforms.uSunFieldSun;
    shader.uniforms.uSunLitFloor = sunFieldUniforms.uSunLitFloor;
    const varyings = /* glsl */`
      varying vec3 vHillWorld;
      varying vec2 vHillCover;
      varying vec2 vHillLight;
    `;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        attribute vec2 terrainCover;
        uniform vec2 uSunFieldSun;
        ${varyings}`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vHillWorld = position;
        vHillCover = vec2(max(terrainCover.x, 0.), terrainCover.y);
        vec2 sun = uSunFieldSun / ${SUN_FIELD_SIDEWAYS.toFixed(2)};
        vec3 worldNormal = normalize(mat3(modelMatrix) * normal);
        vHillLight = vec2(worldNormal.y, dot(worldNormal, vec3(sun.x, sqrt(max(0., 1. - dot(sun, sun))), sun.y)));
      `)
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        // Las vías van en el mismo lote, con un sesgo de profundidad solo en sus caras.
        if (terrainCover.x < -.5 && gl_Position.w > 0.) gl_Position.z -= gl_Position.w * .00000024;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        ${varyings}
        uniform float uSunLitFloor;
        float terrainHash(vec2 p) {
          vec3 v = fract(p.xyx * .1031);
          v += dot(v, v.yzx + 33.33);
          return fract((v.x + v.y) * v.z);
        }
        float terrainNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
          return mix(mix(terrainHash(i), terrainHash(i + vec2(1., 0.)), f.x),
                     mix(terrainHash(i + vec2(0., 1.)), terrainHash(i + vec2(1., 1.)), f.x), f.y);
        }`)
      .replace('#include <fog_fragment>', /* glsl */`
      #ifdef USE_FOG
        ${SKY_LIGHT}
        float range = length(vSkyFogRay);
        float distanceFade = smoothstep(690., 1250., range);
        float detail = (1. - vHillCover.y) * (1. - distanceFade);
        vec2 q = vHillWorld.xz;
        float slope = max(vHillLight.x, 0.);
        // La luz es la de la ciudad. Con cielo cubierto o de noche domina el relleno.
        float direct = (1. - uSunLitFloor) * (1. - .77 * skyFogCloud.w);
        float diffuse = mix(.63 + .33 * slope, .64 + .74 * max(0., vHillLight.y), direct);
        vec3 c = vColor.rgb * mix(1., diffuse, 1. - .54 * vHillCover.y);

        // Bosque por grupos de copas. El grano pequeño desaparece antes de que la cámara lo
        // vea de canto y se convierta en rayas. Las pendientes muy abiertas revelan arenisca.
        vec2 crowns = (q + vHillWorld.y * vec2(.33, -.21)) / 6.4;
        float crownSize = length(fwidth(crowns));
        float broad = terrainNoise(q / 37. + 4.6);
        float fine = mix(terrainNoise(crowns), .5, smoothstep(.22, .92, crownSize));
        float forest = detail * vHillCover.x;
        c *= 1. + forest * ((broad - .5) * .38 + (fine - .5) * .32);
        float strata = terrainNoise(vec2((q.x + q.y * .42) / 36., vHillWorld.y / 11. + q.y / 79.));
        float rock = (1. - smoothstep(.47, .76, slope)) * smoothstep(.51, .82, strata)
          * smoothstep(28., 71., vHillWorld.y) * detail;
        c = mix(c, vec3(.37, .34, .28) * diffuse, rock * .72);

        float cap = 1. - pow(1. - mix(mix(.22, .52, distanceFade), .7, vHillCover.y), hazeBoost);
        float haze = backdropMist(min(smoothstep(fogNear, fogFar, vFogDepth), cap));
        // La bruma se recoge dentro de los pliegues. Conserva el color atmosférico incluso al llover.
        float bank = exp(-max(vHillWorld.y, 0.) * skyFogLayer.x * .32);
        haze += (1. - haze) * skyFogLayer.w * (.1 + bank * detail * (.16 + .24 * broad));
        gl_FragColor.rgb = skyFogMix(c * light, haze);
      #endif
      `);
  };
  return chainSunField(material);
}

const BACKDROP_SECTORS = 8, BACKDROP_VIEW_MARGIN = 60, ROOFTOP_RANGE = 220;

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

// Las piezas comparten los bloques instanciados del fondo. El eje de la cubierta y los brazos
// se inclinan en el espacio local del santuario.
function addSanctuary(entries, angle, x, y, z, parts) {
  const dx = Math.cos(angle), dz = Math.sin(angle), rotation = Math.PI / 2 - angle;
  for (const { across = 0, setback = 0, base, ...part } of parts) {
    entries.push({ ...part, rotation, x: x + dz * across + dx * setback, z: z - dx * across + dz * setback, y: y + base });
  }
}

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

  const { geometry: terrainGeometry, surface, heightAt, forEachFrontTriangle, cx, cz, foot } = buildBackdropTerrain({ width, height, corridors });
  const hillMaterial = createTerrainMaterial(true);
  // El suelo plano se pinta tras el cielo sin escribir profundidad; así nunca tapa una torre.
  const groundMaterial = sinGastarAzar(0x5e1f0d0, () => createTerrainMaterial(false));
  const terrain = new THREE.Mesh(terrainGeometry, [groundMaterial, hillMaterial]);
  terrain.name = 'Suelo y cerros';
  terrain.frustumCulled = false;
  terrain.renderOrder = -999;
  terrain.matrixAutoUpdate = false;
  group.add(terrain);
  // Todo el fondo va antes que la ciudad y al terminar se borra su profundidad: comprimido, quedaba delante
  // de las torres reales que ya están cerca del plano lejano y les tapaba una franja.
  const pending = Array.isArray(terrain.material) ? terrainGeometry.groups.length : 1, drawn = new Set();
  terrain.onAfterRender = (renderer, scene, camera, geometry, material, part) => {
    drawn.add(part);
    if (drawn.size < pending) return;
    drawn.clear();
    renderer.clearDepth();
  };

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
        if (!excluded.some(hits) && !hits({ x0: 0, x1: width, z0: 0, z1: height })) {
          const streetSide = c.alongX ? (side ? 0 : Math.PI) : (side ? Math.PI / 2 : -Math.PI / 2);
          entries.push({ x, z, w, d: dd, h, color, streetSide });
        }
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

  const { houses, roofs, routes } = planHillsideSettlement({ cx, cz, surface, heightAt, blocks: entries });
  entries.push(...houses, ...roofs);
  terrain.geometry = sinGastarAzar(0x153cfa, () => {
    const roads = makeHillsideStreets(routes, forEachFrontTriangle);
    const combined = mergeGeometries([terrainGeometry, roads]);
    const ground = terrainGeometry.groups[0].count;
    combined.addGroup(0, ground, 0);
    combined.addGroup(ground, combined.index.count - ground, 1);
    return combined;
  });

  // Iglesia blanca y teleférico en el cerro del oriente.
  const top = surface(PEAK_ANGLE, 1), toX = (angle, r) => cx + Math.cos(angle) * r, toZ = (angle, r) => cz + Math.sin(angle) * r;
  const px = toX(PEAK_ANGLE, top.radius), pz = toZ(PEAK_ANGLE, top.radius), py = top.y - 1;
  const WHITE = [.97, .96, .92], ROOF = [.49, .24, .16], STONE = [.63, .59, .52], STEEL = [.2, .2, .2];
  // Basílica de Monserrate: terraza, nave blanca con cubierta de teja y un campanario sobre la fachada.
  addSanctuary(entries, PEAK_ANGLE, px, py, pz, [
    { base: -7, w: 33, d: 16, h: 7, color: STONE },
    { base: -1, w: 25, d: 12, h: 9, color: WHITE },
    { base: 7.8, w: 24.9, d: 9.1, h: 1.2, color: WHITE },
    { base: 8.9, w: 24.8, d: 4.6, h: 1.2, color: WHITE },
    { setback: -3.2, base: 9.1, w: 26, d: 7.2, h: .7, pitch: -.38, color: ROOF },
    { setback: 3.2, base: 9.1, w: 26, d: 7.2, h: .7, pitch: .38, color: ROOF },
    { setback: -6.2, base: -1.4, w: 6.1, d: 5.6, h: 17.2, color: WHITE },
    { setback: -6.2, base: 15.5, w: 6.7, d: 6.2, h: .9, color: ROOF },
    { setback: -6.2, base: 16, w: 4.4, d: 4.4, h: 4.1, color: WHITE },
    { setback: -8.44, base: 16.5, w: 1.35, d: .17, h: 2.55, color: STEEL },
    { setback: -6.2, base: 20.1, w: 4.9, d: 4.9, h: 1.1, color: ROOF },
    { setback: -6.2, base: 20.8, w: 3.4, d: 3.4, h: 1.18, color: WHITE },
    { setback: -6.2, base: 21.8, w: 1.9, d: 1.9, h: 1.45, color: WHITE },
    { setback: -6.2, base: 23, w: .55, d: .55, h: 2.2, color: STEEL },
    { setback: -6.2, base: 24.2, w: 1.7, d: .48, h: .45, color: STEEL },
    { setback: -14, base: -8.5, w: 10.4, d: 8.5, h: 16.8, color: STONE },
    { setback: -14, base: 8.3, w: 10.9, d: 9, h: .8, color: ROOF }
  ]);
  // La capilla de Guadalupe hace de basamento de la estatua. El manto y los brazos caen hacia abajo.
  const crown = surface(FIGURE_ANGLE, 1), FIGURE = [.99, .98, .95];
  const fx = toX(FIGURE_ANGLE, crown.radius), fz = toZ(FIGURE_ANGLE, crown.radius), fy = crown.y - 1;
  addSanctuary(entries, FIGURE_ANGLE, fx, fy, fz, [
    { base: -5, w: 12, d: 10, h: 5, color: STONE },
    { base: -1, w: 10, d: 9, h: 11.7, color: WHITE },
    { setback: -4.5, base: 0, w: 2.8, d: .23, h: 5.6, color: STEEL },
    { base: 10, w: 11, d: 10, h: 1.45, color: WHITE },
    { base: 11.3, w: 6, d: 3.9, h: 5.1, color: FIGURE },
    { base: 16, w: 4.65, d: 3.55, h: 6.8, color: FIGURE },
    { base: 22.4, w: 3.5, d: 3.0, h: 3.8, color: FIGURE },
    { setback: -.45, base: 25.8, w: 2.7, d: 2.7, h: 3.1, color: FIGURE },
    { across: -4.25, base: 21.2, w: 6.2, d: 2.1, h: 2.35, roll: .37, color: FIGURE },
    { across: 4.25, base: 21.2, w: 6.2, d: 2.1, h: 2.35, roll: -.37, color: FIGURE },
    { across: -17, base: -4, w: 15, d: 9, h: 9.5, color: WHITE },
    { across: -17, base: 5.5, w: 13.6, d: 7.4, h: 1.5, color: ROOF },
    { across: -23, base: -4, w: 3.2, d: 3.2, h: 14, color: WHITE },
    { across: 13, base: -5, w: 9, d: 7, h: 7, color: STONE }
  ]);
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
    if (entry.rotation !== undefined || entry.y !== undefined || entry.h < 9 || frontageOf(entry, width, height) || hash(i, 3, 41) > .45) return;
    if (Math.max(-entry.x, entry.x - width, -entry.z, entry.z - height) > ROOFTOP_RANGE) return;
    const size = 2.2 + hash(i, 4, 41) * 2.4;
    rooftops.push({ x: entry.x + (hash(i, 5, 41) - .5) * Math.max(0, entry.w - size), z: entry.z + (hash(i, 6, 41) - .5) * Math.max(0, entry.d - size),
      y: entry.h - .1, w: size, d: size * (.7 + hash(i, 7, 41) * .5), h: 1.4 + hash(i, 8, 41) * 1.6, color: [.36, .35, .33] });
  });
  entries.push(...rooftops);
  const streetscape = dressBackdropFrontages(entries, width, height, hash);
  // Sin tapa inferior: nadie ve la base de estos bloques.
  const unit = new THREE.BoxGeometry(1, 1, 1);
  unit.translate(0, .5, 0);
  unit.setIndex([...unit.index.array].filter((_, i) => i < 18 || i >= 24));
  const angles = new THREE.Euler(0, 0, 0, 'YXZ'), quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(), place = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), tint = new THREE.Color();
  // Partida por costados: desde la calle nunca se ve toda la corona a la vez, y cada costado fuera
  // de cuadro ahorra sus triángulos a cambio de una llamada más por los que sí se ven.
  const sectors = Array.from({ length: BACKDROP_SECTORS }, () => ({ items: [], bounds: new THREE.Box3() }));
  const sectorAt = (x, z) => sectors[Math.floor((Math.atan2(z - cz, x - cx) + Math.PI) / (Math.PI * 2) * BACKDROP_SECTORS) % BACKDROP_SECTORS];
  // Las siluetas de edificios reales van aparte: la isométrica abre el edificio para ver al jugador
  // y una caja de fondo seguiría tapándolo.
  const closedOnly = { items: [], bounds: new THREE.Box3(), closedOnly: true };
  const corner = new THREE.Vector3();
  for (const entry of streetscape) {
    place.set(entry.x, entry.y ?? -.05, entry.z);
    const tilted = entry.pitch || entry.roll;
    if (tilted) quaternion.setFromEuler(angles.set(entry.pitch ?? 0, entry.rotation, entry.roll ?? 0));
    else quaternion.setFromAxisAngle(up, entry.rotation ?? 0);
    scale.set(entry.w, entry.h, entry.d);
    const sector = entry.closedOnly ? closedOnly : sectorAt(entry.x, entry.z);
    const reach = Math.hypot(entry.w, entry.d) / 2 + (tilted ? entry.h : 0), overhang = tilted ? reach : 0;
    sector.items.push({ matrix: new THREE.Matrix4().compose(place, quaternion, scale), color: entry.color,
      settlement: entry.settlement, frontage: entry.frontage });
    sector.bounds.expandByPoint(corner.set(entry.x - reach, place.y - overhang, entry.z - reach));
    sector.bounds.expandByPoint(corner.set(entry.x + reach, place.y + entry.h + overhang, entry.z + reach));
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
  const material = createBlockMaterial(foot);
  const parts = [];
  for (const [i, { items, bounds, closedOnly: onlyClosed = false }] of [...sectors, closedOnly].entries()) {
    if (!items.length) continue;
    const geometry = sinGastarAzar(0x41af0 + i, () => unit.clone());
    const settlement = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 2), 2);
    const frontage = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 4), 4);
    geometry.setAttribute('instanceSettlement', settlement);
    geometry.setAttribute('instanceFrontage', frontage);
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    mesh.name = 'Bloques de fondo';
    items.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, tint.setRGB(item.color[0], item.color[1], item.color[2], THREE.LinearSRGBColorSpace));
      if (item.settlement) settlement.setXY(i, ...item.settlement);
      if (item.frontage) frontage.setXYZW(i, ...item.frontage);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.renderOrder = -999.5;
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
  group.userData.blockCount = streetscape.length + cable.length;
  group.userData.peak = { x: px, z: pz, y: py };
  group.userData.figurePeak = { x: fx, z: fz, y: fy };
  group.userData.setNight = () => {}; // La luz sale del color del cielo.
  return group;
}
