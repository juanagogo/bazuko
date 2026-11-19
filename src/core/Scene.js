import * as THREE from 'three';
import { daylightCloudShader } from './SkyClouds.js';
import { sunDirection, moonDirection, moonPhase, moonIllumination } from '../world/Climate.js';
import { setNightGlow, setSunFieldLight, sunFieldUniforms } from '../world/bogota/SunField.js';
import { setStreetLightLevel } from '../world/bogota/StreetLightShader.js';
import { setStreetLampTwilight } from '../world/bogota/StreetLampModel.js';

const smooth = THREE.MathUtils.smoothstep;
const clamp01 = value => THREE.MathUtils.clamp(value, 0, 1);
const C = hex => new THREE.Color(hex);

// Paleta del cielo bogotano: despejado de altura, cubierto y crepuscular. El amanecer es pálido y frío;
// el arrebol es de la tarde.
const SKY = {
  nightTop: C(0x101b2a), nightTopOvercast: C(0x263344),
  nightHorizon: C(0x26394a), nightHorizonOvercast: C(0x394454),
  dayTop: C(0x1a58ad), dayTopOvercast: C(0x8b9298),
  dayHorizon: C(0xa9cae8), dayHorizonOvercast: C(0xbfc1bd),
  twilightTop: C(0x3a5c9a), twilightHorizon: C(0xf4ae8a), dawnTop: C(0x5d7398), dawnHorizon: C(0xe8c9b4),
  rain: C(0x3c4651), mistDay: C(0xa9aeb2), mistNight: C(0x384854), flash: C(0x8e98b0)
};
const CLOUD = {
  dayLight: C(0xffffff), dayShadow: C(0x8b9aab), overcastShadow: C(0x6f7276),
  twilightLight: C(0xffc39a), twilightShadow: C(0x5f5068), dawnLight: C(0xf0d8cc), dawnShadow: C(0x667089),
  nightLight: C(0x455160), nightShadow: C(0x222e3e), rainShadow: C(0x3c434b)
};
const MOON_GRAZE_LIMIT = .25;
const SUN = { day: C(0xfff0dc), low: C(0xff7c55), dawn: C(0xffbe96), overcast: C(0xdde4ec), night: C(0xa5b9d2), moon: C(0xbecde0) };
const HEMI = { day: C(0xbcc3ca), dayOvercast: C(0xb4bcc6), twilight: C(0xc9b2c0), dawn: C(0xa7adc6), night: C(0x9aaac0), groundDay: C(0x8f806c), groundNight: C(0x8a7a66) };
const OCTAVES = { baja: 2, media: 3, alta: 4 };
// Los colores del sol bajo según sea de mañana o de tarde; se reescriben en cada llamada.
const LOW = { sun: C(0), fill: C(0), top: C(0), horizon: C(0), cloudLight: C(0), cloudShadow: C(0) };

// La curva del degradado del cielo: la misma para la cúpula y para la niebla, o no empalman.
const SKY_RAMP = 'pow( max( y + .04, 0. ), .78 )';

/**
 * Color de la niebla en la dirección de cada fragmento: lo lejano se funde con el cielo que tiene
 * detrás, no con el horizonte. Con un solo color, una torre en bruma quedaba más clara que el cielo
 * oscuro de arriba y se veía como una caja translúcida.
 * Son objetos planos a propósito: `UniformsUtils.clone` copia los Color y los Vector, pero un objeto
 * sin marcas lo pasa por referencia. Así toda la ciudad comparte estos valores sin recorrer materiales.
 */
export const skyFogUniforms = {
  skyFogLow: { value: { r: 0, g: 0, b: 0 } },
  skyFogHigh: { value: { r: 0, g: 0, b: 0 } },
  // Cielo cerrado: xyz es el color de la capa de nubes y w cuánto la tapa.
  skyFogCloud: { value: { x: 0, y: 0, z: 0, w: 0 } },
  skyFogGlow: { value: { r: 0, g: 0, b: 0 } },
  // Bruma acostada: x = 1 / alto de la capa, y = cuánto se abre arriba, z = cierre antes del plano lejano, w = neblina baja.
  skyFogLayer: { value: { x: 0, y: 0, z: 0, w: 0 } },
  // Segundo tono: cuánto rojo, verde y azul pierde la bruma de medio camino frente al horizonte.
  skyFogCool: { value: { r: 0, g: 0, b: 0 } },
  // Velo de sodio de la noche, solo en la capa baja.
  skyFogVeil: { value: { r: 0, g: 0, b: 0 } },
};
// El plano lejano de cada calidad (`GraphicsQuality.js`): ahí la bruma tiene que haber cerrado del todo.
const FOG_CUT = { baja: 180, media: 220, alta: 300 };

// `fogColor` sigue siendo el horizonte porque la ciudad de fondo lee de él cuánta luz hay.
THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vSkyFogRay;
#endif
`;
THREE.ShaderChunk.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // Solo gira, sin trasladar: rayo de la cámara al vértice en ejes del mundo, también con instancias.
  vSkyFogRay = transpose( mat3( viewMatrix ) ) * mvPosition.xyz;
#endif
`;
THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vSkyFogRay;
  uniform vec3 skyFogLow;
  uniform vec3 skyFogHigh;
  uniform vec4 skyFogCloud;
  uniform vec3 skyFogGlow;
  uniform vec4 skyFogLayer;
  uniform vec3 skyFogCool;
  uniform vec3 skyFogVeil;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  // El cielo sin sol ni nubes sueltas, ya en color de pantalla. Lo que el sol y las nubes le suman
  // a la cúpula solo la aclara: lo lejano queda fundido o apenas más oscuro, nunca más claro.
  vec3 skyFogColor() {
    float y = normalize( vSkyFogRay ).y;
    vec3 sky = mix( skyFogLow, skyFogHigh, ${SKY_RAMP} );
    sky += skyFogGlow * exp( - max( y, 0. ) * 8. );
    sky = mix( sky, mix( skyFogLow * 1.08, skyFogCloud.xyz, smoothstep( .02, .32, y ) ), skyFogCloud.w * smoothstep( 0., .1, y ) );
    #ifdef TONE_MAPPING
      sky = toneMapping( sky );
    #endif
    return linearToOutputTexel( vec4( sky, 1. ) ).rgb;
  }
  // Desde lo alto la bruma se mira de canto y no a lo largo: de noche (x) y con la neblina de la mañana (y)
  // pesa menos y su velo queda más hondo que el cielo. A pie de calle (cámara bajo 14 m) vale cero.
  vec2 skyFogAloft() {
    float aloft = smoothstep( 14., 50., cameraPosition.y );
    float night = 1. - smoothstep( .07, .2, dot( skyFogLow, vec3( .2126, .7152, .0722 ) ) );
    return aloft * vec2( night, ( 1. - night ) * smoothstep( 0., .3, skyFogLayer.w ) );
  }
  // Lo claro se apaga antes que lo oscuro: una fachada al sol con bruma encima no queda más clara que
  // el cielo. Y lo que se alza sobre el horizonte queda como silueta un poco más oscura, porque igual al
  // cielo se vería translúcido; al llegar al plano lejano se funde del todo y no se nota el corte.
  // De noche no aplica: las ventanas encendidas sí deben atravesar la bruma.
  vec3 skyFogMix( vec3 color, float amount ) {
    vec3 sky = skyFogColor();
    // Dos tonos: a medio camino la bruma es más fría y más honda que el horizonte y solo al fondo llega
    // a su color, así la distancia se lee por planos y no como una pared clara. De noche se le suma el
    // velo de sodio, a ras de la ciudad.
    float rest = 1. - amount;
    vec2 aloft = skyFogAloft();
    vec3 veil = sky * ( 1. - ( skyFogCool + .45 * aloft.x + .15 * aloft.y ) * rest );
    // De noche, mirada desde lo alto, la ciudad bajo la bruma queda más oscura que el cielo; en el horizonte empalma.
    veil *= 1. - .3 * aloft.x * smoothstep( 0., .25, - normalize( vSkyFogRay ).y );
    veil += skyFogVeil * ( 4. * amount * rest * exp( - max( cameraPosition.y + vSkyFogRay.y, 0. ) * .06 ) );
    vec3 mixed = mix( color, veil, amount );
    float day = smoothstep( .14, .32, dot( sky, vec3( .3, .6, .1 ) ) );
    mixed -= max( mixed - sky, 0. ) * smoothstep( 0., .55, amount ) * day;
    return mixed * ( 1. - .8 * amount * ( 1. - amount ) * day * smoothstep( -.01, .03, normalize( vSkyFogRay ).y ) );
  }
  // Bruma acostada: espesa a ras de piso y abierta arriba, para que las torres asomen sobre ella en vez
  // de disolverse enteras. A ras de piso queda igual; el cierre llega a 1 justo antes del plano lejano
  // y tapa su corte. La neblina baja de la madrugada se suma solo en los primeros metros.
  float skyFogBank( float amount ) {
    float height = max( cameraPosition.y + vSkyFogRay.y, 0. );
    float banked = amount * ( 1. - skyFogLayer.y * ( 1. - exp( - height * skyFogLayer.x ) ) );
    banked += ( 1. - banked ) * skyFogLayer.w * ( 1. - .5 * skyFogAloft().y ) * exp( - height * .12 ) * smoothstep( 0., .3, amount );
    float closing = clamp( vFogDepth * skyFogLayer.z - 4.3, 0., 1. );
    return max( banked, closing * closing * ( 3. - 2. * closing ) );
  }
#endif
`;
THREE.ShaderChunk.fog_fragment = /* glsl */`
#ifdef USE_FOG
  // Desde lo alto la distancia que cuenta se acorta; a pie de calle queda la de siempre.
  float fogDepth = vFogDepth;
  if ( cameraPosition.y > 14. ) {
    vec2 fogAloft = skyFogAloft();
    fogDepth *= 1. - .3 * fogAloft.x - .3 * fogAloft.y;
  }
  #ifdef FOG_EXP2
    float fogFactor = 1. - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, fogDepth );
  #endif
  // Lo cercano no paga el cálculo: es la mayoría de los píxeles de una calle. El cierre del plano lejano siempre entra.
  if ( fogFactor > .004 || vFogDepth * skyFogLayer.z > 4.3 ) gl_FragColor.rgb = skyFogMix( gl_FragColor.rgb, skyFogBank( fogFactor ) );
#endif
`;
for (const shader of Object.values(THREE.ShaderLib)) {
  if (shader.uniforms?.fogColor) Object.assign(shader.uniforms, skyFogUniforms);
}
const setRgb = (target, color) => { target.r = color.r; target.g = color.g; target.b = color.b; };

/**
 * Ruido periódico de dos canales para las nubes: R grande y redondeado, G fino y deshilachado.
 * Se calcula una vez, sin canvas, y se repite sin costuras gracias a la rejilla periódica.
 */
function createCloudNoise(size = 256) {
  const layer = (seed, cells, octaves) => {
    const out = new Float32Array(size * size);
    let amplitude = 1, total = 0;
    for (let octave = 0; octave < octaves; octave++, cells *= 2, amplitude *= .52) {
      const lattice = new Float32Array(cells * cells);
      let state = (seed + octave * 977) >>> 0;
      for (let i = 0; i < lattice.length; i++) {
        state = Math.imul(state ^ (state >>> 15), 2246822519) + 3266489917 >>> 0;
        lattice[i] = state / 4294967296;
      }
      for (let y = 0; y < size; y++) {
        const fy = y / size * cells, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
        const row0 = iy % cells * cells, row1 = (iy + 1) % cells * cells;
        for (let x = 0; x < size; x++) {
          const fx = x / size * cells, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
          const a = ix % cells, b = (ix + 1) % cells;
          const top = lattice[row0 + a] + (lattice[row0 + b] - lattice[row0 + a]) * sx;
          const bottom = lattice[row1 + a] + (lattice[row1 + b] - lattice[row1 + a]) * sx;
          out[y * size + x] += (top + (bottom - top) * sy) * amplitude;
        }
      }
      total += amplitude;
    }
    for (let i = 0; i < out.length; i++) out[i] /= total;
    return out;
  };
  const shape = layer(9127, 4, 4), detail = layer(5021, 16, 3);
  const data = new Uint8Array(size * size * 2);
  for (let i = 0; i < shape.length; i++) {
    // El fbm se agolpa cerca del gris medio: estirarlo deja cielo abierto y nubes con cuerpo.
    const stretch = v => THREE.MathUtils.clamp((v - .5) * 1.9 + .5, 0, 1) * 255;
    data[i * 2] = stretch(shape[i]);
    data[i * 2 + 1] = stretch(detail[i]);
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createSkyDome() {
  const geo = new THREE.SphereGeometry(360, 32, 16);
  const mat = new THREE.ShaderMaterial({
    name: 'BogotaSkyShader',
    uniforms: {
      topColor: { value: new THREE.Color(0x060c15) },
      bottomColor: { value: new THREE.Color(0x121a24) },
      sunDirection: { value: new THREE.Vector3(1, 0.5, 0.5).normalize() },
      sunGlowColor: { value: new THREE.Color(0xffaa55) },
      sunGlowIntensity: { value: 0.0 },
      sunDisc: { value: 0.0 },
      moonDirection: { value: new THREE.Vector3(0, 1, 0) },
      moonPhase: { value: 0.5 },
      moonVisibility: { value: 0.0 },
      nightFactor: { value: 1.0 },
      cityGlow: { value: 0.0 },
      cityGlowColor: { value: C(0xb98251) },
      cloudCover: { value: 0.5 },
      cloudOffset: { value: new THREE.Vector2() },
      cloudLight: { value: new THREE.Color(0xf3f5f7) },
      cloudShadow: { value: new THREE.Color(0x9aa6b1) },
      octaves: { value: 4 },
      cloudNoise: { value: createCloudNoise() },
      flash: { value: 0.0 },
      time: { value: 0.0 }
    },
    vertexShader: `
      varying vec3 vDirection;
      varying vec3 vRay;
      void main() {
        // La cúpula no rota ni escala: la posición local ya es la dirección de vista.
        vDirection = position;
        vRay = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // Siempre en el plano lejano: la cámara de cualquier calidad la dibuja completa.
        gl_Position = clip.xyww;
        gl_Position.z = clip.w * 0.99999;
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 sunDirection;
      uniform vec3 sunGlowColor;
      uniform float sunGlowIntensity;
      uniform float sunDisc;
      uniform vec3 moonDirection;
      uniform float moonPhase;
      uniform float moonVisibility;
      uniform float nightFactor;
      uniform float cityGlow;
      uniform vec3 cityGlowColor;
      uniform float cloudCover;
      uniform vec2 cloudOffset;
      uniform vec3 cloudLight;
      uniform vec3 cloudShadow;
      uniform float octaves;
      uniform sampler2D cloudNoise;
      uniform float flash;
      uniform float time;
      varying vec3 vDirection;
      varying vec3 vRay;

      float hash21(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }

      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
                   mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
      }

      ${daylightCloudShader}

      // Se conserva la proyección y la luz de las nubes de noche.
      float cloudDensity(vec2 uv, float threshold) {
        vec2 base = texture2D(cloudNoise, uv * 0.085).rg;
        float shape = base.r * 0.78 + base.g * 0.22;
        if (octaves > 2.5) shape += (texture2D(cloudNoise, uv * 0.37 + base * 0.08).g - 0.5) * 0.14;
        return smoothstep(threshold, threshold + 0.2, shape);
      }

      vec3 nightClouds(vec3 sky, vec3 dir, float sunDot, float urbanHaze) {
        if (dir.y > 0.0) {
          vec2 uv = dir.xz / (dir.y + 0.14) * 1.7 + cloudOffset;
          float threshold = mix(0.68, 0.3, cloudCover);
          float density = cloudDensity(uv, threshold);
          density = max(density, smoothstep(0.86, 1.0, cloudCover) * 0.92);
          density *= smoothstep(0.0, 0.1, dir.y);
          float towardSun = density;
          if (octaves > 2.5) towardSun = cloudDensity(uv + sunDirection.xz * 0.55, threshold);
          float thickness = clamp(towardSun * 0.75 + cloudCover * 0.32, 0.0, 1.0);
          vec3 cloud = mix(cloudLight, cloudShadow, thickness);
          // La nube se funde con la bruma lejos, no recorta el horizonte.
          cloud = mix(bottomColor * 1.08, cloud, smoothstep(0.02, 0.32, dir.y));
          cloud += cityGlowColor * cityGlow * (0.18 + urbanHaze * 0.6) * (1.0 - thickness * 0.4);
          cloud += sunGlowColor * pow(sunDot, 10.0) * (1.0 - thickness) * sunGlowIntensity * 0.8;
          cloud += vec3(0.75, 0.8, 0.95) * flash * (0.4 + thickness);
          sky = mix(sky, cloud, density);
          sky += sunGlowColor * pow(sunDot, 24.0) * density * (1.0 - thickness) * sunDisc * 0.5;
        }
        return sky;
      }

      void main() {
        vec3 dir = normalize(vDirection);
        float y = dir.y;
        vec3 sky = mix(bottomColor, topColor, ${SKY_RAMP});
        // Luz de sodio dispersada por la humedad: una franja suave sobre la ciudad.
        float urbanHaze = exp(-max(dir.y, 0.0) * 8.0);
        sky += cityGlowColor * cityGlow * urbanHaze;
        float sunDot = max(dot(dir, sunDirection), 0.0);
        sky += sunGlowColor * (pow(sunDot, 5.0) * 0.6 + pow(sunDot, 48.0) * 0.5) * sunGlowIntensity;

        if (nightFactor > 0.05 && dir.y > 0.12) {
          vec2 starCoord = floor(dir.xz / (dir.y + 0.45) * 320.0);
          float star = hash21(starCoord);
          if (star > 0.9972) {
            float twinkle = 0.6 + 0.4 * sin(time * 3.5 + star * 45.0);
            // Las nubes tapan las estrellas: con lluvia no se ve ninguna.
            sky += vec3(0.95, 0.98, 1.0) * twinkle * (star - 0.9972) * 170.0 * nightFactor * (1.0 - smoothstep(0.5, 0.9, cloudCover));
          }
        }

        // Luna con fase: esfera iluminada desde el lado del sol.
        float moonDot = dot(dir, moonDirection);
        if (moonVisibility > 0.01 && moonDot > 0.97) {
          vec3 right = normalize(cross(moonDirection, vec3(0.0, 1.0, 0.0)) + vec3(0.0001, 0.0, 0.0));
          vec3 up = cross(right, moonDirection);
          vec3 rel = dir - moonDirection * moonDot;
          vec2 q = vec2(dot(rel, right), dot(rel, up)) / 0.03;
          float r2 = dot(q, q);
          float angle = moonPhase * 6.2831853;
          if (r2 < 1.0) {
            vec3 normal = vec3(q, sqrt(1.0 - r2));
            float lit = smoothstep(-0.04, 0.1, dot(normal, vec3(sin(angle), 0.0, -cos(angle))));
            float maria = 0.8 + 0.2 * noise(q * 2.6 + 4.0);
            vec3 moon = vec3(0.93, 0.93, 0.88) * maria * (0.05 + lit * 1.15);
            sky = mix(sky, moon, smoothstep(1.0, 0.85, r2) * moonVisibility);
          }
          float brightness = (1.0 - cos(angle)) * 0.5;
          sky += vec3(0.55, 0.65, 0.85) * pow(max(moonDot, 0.0), 900.0) * 0.35 * brightness * moonVisibility;
        }

        // Disco solar nítido; las nubes lo tapan más abajo.
        sky += sunGlowColor * smoothstep(0.99955, 0.9998, sunDot) * sunDisc * 6.0;

        // El relieve diurno se funde con la capa nocturna cuando empieza a verse el cielo estrellado.
        if (cloudCover > 0.01) {
          vec3 ray = normalize(vRay);
          float daylight = 1.0 - smoothstep(0.12, 0.88, nightFactor);
          vec3 cloudsByDay = sky;
          if (daylight > 0.0) cloudsByDay = daylightClouds(sky, ray, sunDot);
          if (daylight < 1.0) sky = nightClouds(sky, dir, sunDot, urbanHaze);
          sky = mix(sky, cloudsByDay, daylight);
        }
        sky += vec3(0.5, 0.55, 0.7) * flash * 0.25;

        gl_FragColor = vec4(sky, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // Desde lo alto, de noche, lo que queda bajo el horizonte se oscurece igual que la bruma sobre la
        // ciudad (skyFogMix): donde no hay ciudad que tapar, la cúpula empalma con ella.
        float aloftNight = smoothstep(14.0, 50.0, cameraPosition.y) * (1.0 - smoothstep(0.07, 0.2, dot(bottomColor, vec3(0.2126, 0.7152, 0.0722))));
        gl_FragColor.rgb *= 1.0 - 0.3 * aloftNight * smoothstep(0.0, 0.25, -normalize(vRay).y);
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  mesh.userData.isSkyDome = true;
  return mesh;
}

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a222d);

    // Bóveda celeste procedural andina: sol, luna con fases, estrellas y nubes
    this.skyDome = createSkyDome();
    this.scene.add(this.skyDome);
    // La sombra de las nubes en el suelo usa el mismo ruido del cielo: no hay una textura más.
    sunFieldUniforms.uSunCloud.value = this.skyDome.material.uniforms.cloudNoise.value;

    // Niebla atmosférica con mayor alcance para dar profundidad urbana
    this.scene.fog = new THREE.Fog(0x1a222d, 50, 180);

    // Luz ambiental: cielo azul-gris suave + rebote cálido del suelo/asfalto
    this.ambient = new THREE.HemisphereLight(0x9fb5cc, 0x4a4640, 0.85);
    this.scene.add(this.ambient);

    // Sol de día y luna de noche: una sola luz direccional con sombra
    this.sun = new THREE.DirectionalLight(0xffedd8, 1.2);
    this.sun.position.set(50, 80, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 200;
    this.sun.shadow.camera.left = -45;
    this.sun.shadow.camera.right = 45;
    this.sun.shadow.camera.top = 45;
    this.sun.shadow.camera.bottom = -45;
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);

    this.sun.target.position.set(0, 0, 0);
    this.scene.add(this.sun.target);
    this.quality = 'alta';
    this.day = 1;
    this._sky = new THREE.Color();
    this._top = new THREE.Color();
    this._tmp = new THREE.Color();
    this._sunDir = new THREE.Vector3(0, 1, 0);
    this._moonDir = new THREE.Vector3(0, 1, 0);
    this._lightDir = new THREE.Vector3(0, 1, 0);
    this._celestialKey = '';
    this._wind = new THREE.Vector2();
    this._legacyWeather = { cloudCover: .85, rainIntensity: 0, fogDensity: 1, flash: 0, wind: null };
  }

  /** Sol y luna para la hora y el día; se recalculan solo si cambian. */
  _celestial(hour, day = this.day) {
    const key = `${hour}|${day}`;
    if (key === this._celestialKey) return;
    this._celestialKey = key;
    sunDirection(hour, day, this._sunDir);
    moonDirection(hour, day, this._moonDir);
    this._phase = moonPhase(day, hour);
    this._illumination = moonIllumination(this._phase);
    // Luz direccional: el sol mientras está arriba; de noche la luna, que se mezcla con
    // el resplandor del cielo al salir para que la sombra no salte.
    if (this._sunDir.y > -0.03) this._lightDir.copy(this._sunDir);
    else {
      const moon = smooth(this._moonDir.y, 0.05, 0.25);
      this._lightDir.set(-0.35, 1, 0.25).lerp(this._moonDir, moon);
    }
    // Evita sombras infinitas con el astro sobre el horizonte.
    if (this._lightDir.y < 0.28) this._lightDir.y = 0.28;
    this._lightDir.normalize();
    setSunFieldLight(this._lightDir);
    // A ras del piso, la luz de la luna rebota en la calzada como una franja blanca de borde duro.
    // El sol no entra: su hora dorada es rasante a propósito. Al cambiar de astro esta luz está apagada.
    this._moonGraze = this._sunDir.y > -0.03 ? 1 : THREE.MathUtils.lerp(MOON_GRAZE_LIMIT, 1, smooth(this._lightDir.y, 0.28, 0.7));
  }

  /**
   * Cielo e iluminación según hora, día y clima.
   * `weather` es el WeatherSystem (cloudCover, rainIntensity, fogDensity, flash, wind).
   * Por compatibilidad acepta también `(hour, isRaining, wetness)`.
   */
  setTimeOfDay(hour, weather = null, dayOrWetness = undefined) {
    if (weather == null) weather = this._lastWeather ?? this._legacyWeather;
    else if (typeof weather === 'boolean') {
      weather = Object.assign(this._legacyWeather, {
        cloudCover: weather ? .92 : .85, rainIntensity: weather ? .65 : 0, fogDensity: 1 + (dayOrWetness ?? 0) * .25
      });
    } else {
      this._lastWeather = weather;
      if (Number.isFinite(dayOrWetness)) this.day = dayOrWetness;
    }
    this._hour = hour;
    this._celestial(hour);

    const cloud = clamp01(weather.cloudCover ?? .85);
    const rain = clamp01(weather.rainIntensity ?? 0);
    const flash = weather.flash ?? 0;
    const mist = clamp01(((weather.fogDensity ?? 1) - 1) / 1.4);
    if (weather.wind) this._wind.copy(weather.wind);

    const sunAlt = this._sunDir.y, moonAlt = this._moonDir.y;
    const day = smooth(sunAlt, -0.08, 0.22);
    const night = 1 - smooth(sunAlt, -0.18, 0.02);
    // Empieza con el sol todavía arriba: la hora dorada es lo mejor del día despejado en la sabana.
    const twilight = clamp01(1 - Math.abs(sunAlt - 0.03) / (sunAlt > 0.03 ? 0.26 : 0.17)) * (1 - cloud * .55);
    const lowSun = 1 - smooth(sunAlt, 0.05, 0.4);
    // De mañana el sol bajo es pálido y de tarde rosado. A medianoche vuelve a cero sin salto: no hay sol que teñir.
    const afternoon = smooth(hour, 11, 13) - smooth(hour, 23, 24);
    LOW.sun.copy(SUN.dawn).lerp(SUN.low, afternoon);
    LOW.fill.copy(HEMI.dawn).lerp(HEMI.twilight, afternoon);
    LOW.top.copy(SKY.dawnTop).lerp(SKY.twilightTop, afternoon);
    LOW.horizon.copy(SKY.dawnHorizon).lerp(SKY.twilightHorizon, afternoon);
    LOW.cloudLight.copy(CLOUD.dawnLight).lerp(CLOUD.twilightLight, afternoon);
    LOW.cloudShadow.copy(CLOUD.dawnShadow).lerp(CLOUD.twilightShadow, afternoon);
    const sunLit = smooth(sunAlt, -0.03, 0.12);
    const moonLit = smooth(moonAlt, -0.03, 0.1) * (1 - sunLit);
    const moonLight = moonLit * (0.1 + 0.3 * this._illumination) * (1 - 0.75 * cloud);
    // Despejado de verdad: a 2.600 m el sol pega duro y la sombra queda azul y honda.
    const clear = 1 - smooth(cloud, 0.12, 0.85);
    // El cambio de astro ocurre con esta luz apagada: su sombra no salta a la vista.
    const swap = smooth(Math.abs(sunAlt + 0.03), 0, 0.06);

    // Luz directa: el sol pierde fuerza con las nubes; de noche queda la luna y el brillo urbano.
    const sunPeak = THREE.MathUtils.lerp(4.4, 0.62, Math.pow(cloud, 1.15));
    // Rasante todavía alumbra: la tarde bogotana tiñe las fachadas, no solo el cielo.
    const lowFade = THREE.MathUtils.lerp(0.72, 1, smooth(sunAlt, 0.02, 0.4));
    this.sun.intensity = sunLit * sunPeak * lowFade * (1 - 0.3 * rain)
      + (1 - sunLit) * (0.4 + moonLight * .8) * swap * this._moonGraze;
    // Nubes sueltas: su sombra cruza la ciudad despacio. Ni el cielo limpio ni el cerrado la tienen.
    sunFieldUniforms.uSunCloudShade.value = sunLit * smooth(cloud, 0.12, 0.3) * (1 - smooth(cloud, 0.6, 0.82)) * .85;
    // Los faroles prenden al caer el sol, sin saltos.
    const lampLevel = 1 - smooth(sunAlt, -.05, .07);
    const mappedLamps = setStreetLightLevel(this.scene, this.quality === 'alta', lampLevel);
    setStreetLampTwilight(mappedLamps ? lampLevel : null);
    // En alta la luz física ya cae en los materiales. Solo queda un toque del rebote pintado.
    setNightGlow(lampLevel * (mappedLamps ? .14 : 1));
    if (sunLit > 0.02) {
      this.sun.color.copy(SUN.day).lerp(LOW.sun, lowSun * (1 - cloud * .6)).lerp(SUN.overcast, cloud * .5);
      this.sun.color.lerp(SUN.night, 1 - sunLit);
    } else {
      this.sun.color.copy(SUN.night).lerp(SUN.moon, clamp01(moonLight * 2.5));
    }

    // Relleno difuso en espacio lineal: conserva detalle en ropa y andenes durante la noche.
    // De día despejado baja mucho: si no, las sombras no se ven y todo queda plano.
    const dayFill = THREE.MathUtils.lerp(1.35 + .25 * cloud, 1.26, clear);
    sunFieldUniforms.uSunLitFloor.value = (1 - sunLit) * .6;
    sunFieldUniforms.uSunSkyFloor.value = THREE.MathUtils.lerp(.62, .4, day);
    // Con el sol bajo todavía arriba el cielo es lo que más alumbra la calle; al ponerse, el relleno vuelve a lo de antes.
    const lowFill = THREE.MathUtils.lerp(.34, .75, smooth(sunAlt, -0.1, 0.1));
    this.ambient.intensity = (THREE.MathUtils.lerp(1.3, dayFill, day) + twilight * lowFill)
      * (1 - .06 * rain) + flash * 2.2;
    this.ambient.color.copy(HEMI.night).lerp(this._tmp.copy(HEMI.dayOvercast).lerp(HEMI.day, clear), day)
      .lerp(LOW.fill, twilight * (1 - cloud));
    this.ambient.groundColor.copy(HEMI.groundNight).lerp(HEMI.groundDay, day);
    this.scene.environmentIntensity = (THREE.MathUtils.lerp(.72, THREE.MathUtils.lerp(.92, .74, clear), day) + twilight * .08 + flash * .5);
    this._updateEnvironment(day);
    // Adaptación fotográfica lenta ligada al ciclo solar, sin medir píxeles ni añadir pasadas.
    this.scene.userData.toneMappingExposure = 1.22 - day * (.17 + .3 * clear) - twilight * .06;

    // Colores del cielo: cenit (top) y horizonte (sky = fondo y niebla).
    const top = this._top.copy(SKY.nightTop).lerp(SKY.nightTopOvercast, cloud)
      .lerp(this._tmp.copy(SKY.dayTop).lerp(SKY.dayTopOvercast, cloud), day)
      .lerp(LOW.top, twilight * 0.55);
    const sky = this._sky.copy(SKY.nightHorizon).lerp(SKY.nightHorizonOvercast, cloud)
      .lerp(this._tmp.copy(SKY.dayHorizon).lerp(SKY.dayHorizonOvercast, cloud), day)
      .lerp(LOW.horizon, twilight * 0.6);
    if (rain > 0.01) {
      top.lerp(SKY.rain, rain * 0.45);
      sky.lerp(SKY.rain, rain * 0.4);
    }
    if (mist > 0.01) sky.lerp(this._tmp.copy(SKY.mistNight).lerp(SKY.mistDay, day), mist * 0.75);
    if (flash > 0.01) sky.lerp(SKY.flash, Math.min(1, flash) * 0.5);

    this.scene.background.copy(sky);
    if (this.scene.fog) {
      this.scene.fog.color.copy(sky);
      // El día claro deja ver lejos, con bruma azul en el fondo; la lluvia y la noche la acercan.
      const density = Math.max(1, weather.fogDensity ?? 1);
      if (this.quality !== 'baja') {
        this.scene.fog.near = Math.max(12, (45 + day * 30 + day * clear * 35) * (1 - rain * 0.38) / density);
        this.scene.fog.far = Math.max(60, (150 + day * 80) * (1 - rain * 0.35) / Math.sqrt(density));
      } else {
        this.scene.fog.near = (40 + day * clear * 42) / density;
        this.scene.fog.far = 130 + day * clear * 42;
      }
      this._limitFog(day * clear);
    }
    this._layFog(day, clear, mist, rain);

    setRgb(skyFogUniforms.skyFogLow.value, sky);
    setRgb(skyFogUniforms.skyFogHigh.value, top);
    const u = this.skyDome?.material?.uniforms;
    if (!u) return;
    u.topColor.value.copy(top);
    u.bottomColor.value.copy(sky);
    u.sunDirection.value.copy(this._sunDir);
    u.moonDirection.value.copy(this._moonDir);
    u.moonPhase.value = this._phase;
    u.moonVisibility.value = smooth(moonAlt, -0.02, 0.06) * (0.25 + 0.75 * night);
    u.sunGlowColor.value.copy(SUN.day).lerp(LOW.sun, lowSun);
    u.sunGlowIntensity.value = (twilight * 1.0 + day * 0.35 * (1 - cloud)) * (1 - rain * 0.85);
    u.sunDisc.value = smooth(sunAlt, -0.02, 0.03) * (1 - rain);
    u.nightFactor.value = night; // las nubes tapan las estrellas en el shader
    u.cityGlow.value = night * (.035 + cloud * .055 + rain * .025);
    u.cloudCover.value = cloud;
    u.flash.value = flash;
    u.cloudLight.value.copy(CLOUD.nightLight).lerp(CLOUD.dayLight, day).lerp(LOW.cloudLight, twilight * 0.45);
    u.cloudShadow.value.copy(CLOUD.nightShadow)
      .lerp(this._tmp.copy(CLOUD.dayShadow).lerp(CLOUD.overcastShadow, cloud), day)
      .lerp(LOW.cloudShadow, twilight * 0.5)
      .lerp(CLOUD.rainShadow, rain * 0.6 * day);
    // Lo mismo que la cúpula, sin sus manchas: la niebla no consulta el ruido de las nubes.
    const glow = u.cityGlowColor.value, glowLevel = u.cityGlow.value;
    const fogGlow = skyFogUniforms.skyFogGlow.value;
    fogGlow.r = glow.r * glowLevel; fogGlow.g = glow.g * glowLevel; fogGlow.b = glow.b * glowLevel;
    // Solo el cielo casi cerrado cuenta: con nubes sueltas se ve azul entre ellas y lo lejano no las imita.
    const fogCloud = skyFogUniforms.skyFogCloud.value, shadow = u.cloudShadow.value;
    fogCloud.x = shadow.r + fogGlow.r * .11; fogCloud.y = shadow.g + fogGlow.g * .11; fogCloud.z = shadow.b + fogGlow.b * .11;
    fogCloud.w = smooth(cloud, .6, .9);
  }

  setQuality(level = 'alta') {
    this.quality = ['baja', 'media', 'alta'].includes(level) ? level : 'alta';
    level = this.quality;
    const size = level === 'media' ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.map?.dispose();
      this.sun.shadow.mapPass?.dispose();
      this.sun.shadow.map = this.sun.shadow.mapPass = null;
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.needsUpdate = true;
    }
    if (level === 'baja') {
      this.sun.castShadow = false;
      if (this.scene.fog) {
        this.scene.fog.near = 40;
        this.scene.fog.far = 130;
      }
    } else if (level === 'media') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      if (this.scene.fog) {
        this.scene.fog.near = 45;
        this.scene.fog.far = 160;
      }
    } else {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
    }
    // La cúpula se dibuja en el plano lejano en todas las calidades; baja usa menos octavas de nubes.
    if (this.skyDome) {
      this.skyDome.visible = true;
      this.skyDome.material.uniforms.octaves.value = OCTAVES[level];
    }
    this.setTimeOfDay(this._hour ?? 6);
  }

  _limitFog(clearDay = 0) {
    if (!this.scene.fog) return;
    // Solo el día despejado abre la vista; en baja nunca pasa de su plano lejano de 180 m.
    const cap = this.quality === 'baja' ? 130 + clearDay * 42 : this.quality === 'media' ? 160 + clearDay * 50 : 230;
    this.scene.fog.far = Math.min(this.scene.fog.far, cap);
    this.scene.fog.near = Math.min(this.scene.fog.near, this.scene.fog.far * .5, this.quality === 'baja' ? 40 + clearDay * 42 : Infinity);
  }

  /** Bruma acostada, sus dos tonos y la neblina baja de la madrugada: los números de los trozos de niebla. */
  _layFog(day, clear, mist, rain) {
    const hour = this._hour ?? 12, lerp = THREE.MathUtils.lerp;
    // Neblina de sabana: sube antes de amanecer y se levanta a media mañana; el aguacero la barre.
    const dawn = smooth(hour, 4.2, 5.4) * (1 - smooth(hour, 7.4, 9.2)) * (1 - rain * .7);
    const layer = skyFogUniforms.skyFogLayer.value;
    layer.x = 1 / lerp(34, 14, Math.max(dawn, mist));
    layer.y = .78 * (1 - .45 * rain);
    // Empieza al 80 % del plano lejano y llega a 1 al 98,5 %: lo alto nunca se corta a la vista.
    layer.z = 5.3 / (.985 * (FOG_CUT[this.quality] ?? FOG_CUT.alta));
    layer.w = Math.min(.8, dawn * .62 + mist * .5);
    // En baja la bruma cercana queda donde está: de ella depende hasta dónde se dibujan peatones y bolsas.
    if (this.scene.fog && this.quality !== 'baja') this.scene.fog.near *= 1 - .4 * layer.w;
    const cool = skyFogUniforms.skyFogCool.value, veil = skyFogUniforms.skyFogVeil.value;
    cool.r = lerp(.1, lerp(.34, .46, clear), day);
    cool.g = lerp(.05, lerp(.21, .26, clear), day);
    cool.b = lerp(0, lerp(.07, .03, clear), day);
    const sodium = (1 - day) * (1 - .4 * rain);
    veil.r = .13 * sodium; veil.g = .058 * sodium; veil.b = 0;
  }

  /**
   * Cuánto del mapa de entorno de día se usa; el Renderer hace la mezcla antes de dibujar.
   * El mapa alumbra todo el piso: el fundido dura un minuto de juego real y el brillo baja sin saltos.
   */
  _updateEnvironment(day) {
    this.scene.userData.environmentDay = smooth(day, .1, .55);
  }

  /** La luz direccional (y su caja de sombras) sigue al jugador para sombras nítidas en un mapa grande */
  followTarget(pos, hour = this._hour ?? 12) {
    this._celestial(hour);
    this.sun.target.position.copy(pos);
    this.sun.position.copy(this._lightDir).multiplyScalar(90).add(pos);

    if (this.skyDome) this.skyDome.position.set(pos.x, 0, pos.z);
  }

  update(dt = 0) {
    const u = this.skyDome?.material?.uniforms;
    if (!u) return;
    u.time.value += dt;
    // Unos 3,5 m/s de viento alto: una nube tarda medio minuto en cruzar la cuadra.
    const drift = sunFieldUniforms.uSunCloudDrift.value;
    drift.set((drift.x + dt * .0065) % 1, (drift.y + dt * .0028) % 1);
    // Las nubes derivan con el viento del clima y una corriente lenta de fondo.
    u.cloudOffset.value.x = (u.cloudOffset.value.x + (this._wind.x * 0.004 + 0.002) * dt) % 512;
    u.cloudOffset.value.y = (u.cloudOffset.value.y + (this._wind.y * 0.004 + 0.001) * dt) % 512;
  }

  /** Ajusta el color de fondo/fog según ánimo */
  applyMentalState(desaturation) {
    if (desaturation <= 0) return;
    const bg = this.scene.background;
    const fog = this.scene.fog?.color;
    if (!bg) return;

    const r = bg.r, g = bg.g, b = bg.b;
    const gray = (r + g + b) / 3;

    bg.setRGB(
      r * (1 - desaturation) + gray * desaturation,
      g * (1 - desaturation) + gray * desaturation,
      b * (1 - desaturation) + gray * desaturation
    );

    if (fog) fog.copy(bg);

    if (this.skyDome?.material?.uniforms) {
      const tc = this.skyDome.material.uniforms.topColor.value;
      const tGray = (tc.r + tc.g + tc.b) / 3;
      tc.setRGB(
        tc.r * (1 - desaturation) + tGray * desaturation,
        tc.g * (1 - desaturation) + tGray * desaturation,
        tc.b * (1 - desaturation) + tGray * desaturation
      );
      const bc = this.skyDome.material.uniforms.bottomColor.value;
      const bGray = (bc.r + bc.g + bc.b) / 3;
      bc.setRGB(
        bc.r * (1 - desaturation) + bGray * desaturation,
        bc.g * (1 - desaturation) + bGray * desaturation,
        bc.b * (1 - desaturation) + bGray * desaturation
      );
    }
  }
}
