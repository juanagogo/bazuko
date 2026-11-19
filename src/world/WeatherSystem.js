// src/world/WeatherSystem.js
import * as THREE from 'three';
import { WEATHER_TYPES, RAIN_THRESHOLD, seasonForDay, pickNextWeather, sunDirection } from './Climate.js';
import { setPuddles } from './bogota/StreetPuddles.js';
import { sinGastarAzar } from './bogota/concretoViaducto.js';
import { Goteo } from './goteo.js';
import { RAIN_COVER_GLSL } from './RainCover.js';

// Gotas visibles por perfil gráfico: el resto del búfer no se dibuja.
const RAIN_BUDGET = { baja: .4, media: .7, alta: 1 };
const RAIN_DROPS = 1400;
const RIPPLE_COUNT = 36;
const RAIN_COLOR_DAY = new THREE.Color(0xc0d2df);
const RAIN_COLOR_NIGHT = new THREE.Color(0x738ba6);
const RAIN_COLOR_FLASH = new THREE.Color(0xf0f4ff);

// Del anillo lejano al cercano: en baja solo se dibuja el primero.
const CURTAIN_RINGS = [{ radius: 24, columns: 400, alpha: .12 }, { radius: 13, columns: 260, alpha: .09 }, { radius: 7, columns: 180, alpha: .06 }];
const CURTAIN_SIDES = 20;
const SPLASH_SECTOR = 110 * Math.PI / 180;
// El aro de la salpicadura va de 8 a 16 cm antes de escalarlo; el sombreador ablanda sus dos bordes.
const SPLASH_INNER = .08, SPLASH_OUTER = .16;
// Vida y tamaño salen de los mismos sorteos de siempre: casi todas chicas y breves, unas pocas más abiertas.
const splashLife = u => .28 + u * .62;
const splashSize = u => .3 + u * u * .85;
// Se desvanecen con la distancia a la cámara: de cerca, de 4 a 12 m; con la cámara lejos, alrededor de ella.
const SPLASH_FADE_NEAR = [4, 12];
const SPLASH_UP = new THREE.Vector3(0, 1, 0);
const f = value => value.toFixed(4);
// Un sorteo propio por lugar, sin tocar el azar del juego: cada salpicadura gira distinto.
const splashTurn = (x, z) => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return (s - Math.floor(s)) * Math.PI * 2;
};
const LAMP_COUNT = 8;
const LAMP_REACH = 1.71, LAMP_HEIGHT = 6.22;

/**
 * Las gotas caen en el vertex shader: la CPU no reescribe el búfer cada cuadro.
 * Cada gota es un cuadro que mira a la cámara, estirado según su velocidad (caída + viento),
 * con un ancho mínimo en píxeles para que no se pierda en pantallas pequeñas. Su posición
 * horizontal se repite en una celda anclada al mundo, para que la lluvia no se desplace con el jugador.
 */
function createRainMaterial(area, coverUniforms) {
  return new THREE.ShaderMaterial({
    name: 'BogotaRainShader',
    uniforms: {
      ...coverUniforms,
      uTime: { value: 0 },
      uArea: { value: new THREE.Vector3(area.x, area.y, area.z) },
      uOrigin: { value: new THREE.Vector3() },
      uWind: { value: new THREE.Vector2() },
      uSpeed: { value: 22 },
      uLength: { value: .55 },
      uColor: { value: new THREE.Color(0xaec6dc) },
      uOpacity: { value: 0 },
      uViewHeight: { value: 800 },
      uLamps: { value: Array.from({ length: LAMP_COUNT }, () => new THREE.Vector3(0, -1e4, 0)) },
      uLampNight: { value: 0 },
      uLampTint: { value: new THREE.Color(0xffb877) }
    },
    vertexShader: `
      attribute vec4 aDrop;
      attribute vec2 aCorner;
      uniform float uTime;
      uniform vec3 uArea;
      uniform vec3 uOrigin;
      uniform vec2 uWind;
      uniform float uSpeed;
      uniform float uLength;
      uniform float uViewHeight;
      uniform vec3 uLamps[${LAMP_COUNT}];
      uniform float uLampNight;
      varying float vAlpha;
      varying float vSide;
      varying float vLamp;
      ${RAIN_COVER_GLSL}
      void main() {
        float fall = uSpeed * aDrop.w;
        float y = mod(aDrop.y - uTime * fall, uArea.y) - 2.0;
        vec2 xz = mod(aDrop.xz - uOrigin.xz + uWind * uTime, uArea.xz) - uArea.xz * 0.5;
        vec3 velocity = vec3(uWind.x, -fall, uWind.y);
        vec3 head = vec3(xz.x, y, xz.y);
        vec3 tail = head - velocity * (uLength / fall);
        // Acorta el trazo que toca la cubierta y conserva la parte que cae sobre ella.
        float roof = max(rainCoverAt(uOrigin.xz + head.xz), rainCoverAt(uOrigin.xz + tail.xz));
        float cut = clamp((roof - uOrigin.y - head.y) / uLength, 0.0, 1.0);
        if (cut >= 1.0) {
          vAlpha = vLamp = vSide = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        head = mix(head, tail, cut);
        vec4 headView = modelViewMatrix * vec4(head, 1.0);
        vec4 tailView = modelViewMatrix * vec4(tail, 1.0);
        vec4 viewPosition = mix(headView, tailView, aCorner.y);
        vec2 along = tailView.xy - headView.xy;
        float span = length(along);
        vec2 dir = span > 1e-5 ? along / span : vec2(0.0, 1.0);
        float depth = max(-viewPosition.z, 0.05);
        float pixel = (isOrthographic ? 2.0 : 2.0 * depth) / (projectionMatrix[1][1] * max(uViewHeight, 1.0));
        float width = max(0.018, 1.6 * pixel);
        viewPosition.xy += vec2(-dir.y, dir.x) * aCorner.x * width * 0.5;
        vec2 edge = abs(xz) / (uArea.xz * 0.5);
        float far = -headView.z;
        float distanceFade = smoothstep(0.8, 2.4, far) * (1.0 - smoothstep(18.0, 34.0, far));
        vAlpha = (1.0 - smoothstep(0.55, 1.0, max(edge.x, edge.y))) * mix(1.0, 0.15, mix(cut, 1.0, aCorner.y)) * distanceFade;
        vSide = aCorner.x;
        vec3 world = (modelMatrix * vec4(mix(head, tail, 0.5), 1.0)).xyz;
        float lit = 0.0;
        for (int i = 0; i < ${LAMP_COUNT}; i++) lit = max(lit, 1.0 - smoothstep(1.5, 5.0, length(world - uLamps[i])));
        vLamp = lit * uLampNight;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform vec3 uLampTint;
      uniform float uOpacity;
      varying float vAlpha;
      varying float vSide;
      varying float vLamp;
      void main() {
        float across = 1.0 - smoothstep(0.6, 1.0, abs(vSide));
        vec3 color = mix(uColor, uColor * uLampTint * 2.5, vLamp);
        gl_FragColor = vec4(color, min(1.0, uOpacity * vAlpha * across * (1.0 + vLamp * 0.6)));
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false
  });
}

/**
 * Cortinas de lluvia: tres cilindros abiertos alrededor de la cámara con rayas que bajan por columnas.
 * El lejano además cierra el aire con un velo del color de la niebla, y el del medio levanta la bruma
 * de las salpicaduras a ras del piso.
 */
function createCurtainGeometry() {
  const position = [], ring = [], index = [];
  CURTAIN_RINGS.forEach(({ radius, columns, alpha }, kind) => {
    const first = position.length / 3;
    for (let side = 0; side <= CURTAIN_SIDES; side++) {
      const around = side / CURTAIN_SIDES, angle = around * Math.PI * 2;
      for (const y of [-2, 16]) {
        position.push(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
        ring.push(around, columns, alpha, kind);
      }
    }
    for (let side = 0; side < CURTAIN_SIDES; side++) {
      const a = first + side * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('aRing', new THREE.Float32BufferAttribute(ring, 4));
  geometry.setIndex(index);
  return geometry;
}

function createCurtainMaterial(rain, fogColor, coverUniforms) {
  return new THREE.ShaderMaterial({
    name: 'BogotaRainCurtain',
    uniforms: {
      ...coverUniforms,
      uTime: rain.uTime,
      uSpeed: rain.uSpeed,
      uColor: rain.uColor,
      uFogColor: { value: fogColor },
      uRain: { value: 0 },
      uFeet: { value: 0 },
      uCenter: { value: new THREE.Vector2() }
    },
    vertexShader: `
      attribute vec4 aRing;
      uniform float uFeet;
      uniform vec2 uCenter;
      varying vec4 vRing;
      varying float vHeight;
      varying vec3 vRainWorld;
      void main() {
        vRing = aRing;
        vHeight = position.y;
        vRainWorld = vec3(position.x + uCenter.x, position.y + uFeet, position.z + uCenter.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(vRainWorld, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uSpeed;
      uniform float uRain;
      uniform vec3 uColor;
      uniform vec3 uFogColor;
      varying vec4 vRing;
      varying float vHeight;
      varying vec3 vRainWorld;
      ${RAIN_COVER_GLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float around = vRing.x * vRing.y;
        float column = floor(around);
        float seed = hash(vec2(column, vRing.w));
        float shift = hash(vec2(vRing.w + 7.0, column));
        float across = abs(fract(around) - 0.5 - (shift - 0.5) * 0.6);
        float pixel = fwidth(around);
        float line = 1.0 - smoothstep(pixel * 0.5, pixel * 1.5, across);
        float period = 2.2 + shift * 2.6;
        float fall = (vHeight + uTime * uSpeed * (0.85 + seed * 0.3)) / period + seed * 9.0;
        float dash = fract(fall);
        float span = 0.9 / period;
        float lit = step(0.4, hash(vec2(column + floor(fall) * 13.0, vRing.w + 3.0)));
        float streak = line * lit * step(dash, span) * (1.0 - dash / span) * vRing.z * uRain;
        streak *= 1.0 - smoothstep(9.0, 16.0, vHeight);
        float veil = vRing.w < 0.5 ? (0.10 + 0.18 * uRain) * smoothstep(-0.5, 2.0, vHeight) * (1.0 - smoothstep(8.0, 16.0, vHeight)) : 0.0;
        float mist = abs(vRing.w - 1.0) < 0.5 ? 0.06 * uRain * smoothstep(0.0, 0.12, vHeight) * (1.0 - smoothstep(0.15, 0.4, vHeight)) : 0.0;
        float glow = clamp(streak + mist, 0.0, 1.0);
        float alpha = glow + veil * (1.0 - glow);
        if (alpha < 0.002 || vRainWorld.y < rainCoverAt(vRainWorld.xz)) discard;
        vec3 color = (uColor * glow + uFogColor * veil * (1.0 - glow)) / alpha;
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false
  });
}

/**
 * Salpicadura de una gota: el aro plano de siempre, una corona de hojitas que se abren hacia arriba
 * y se aplana con la edad (escala vertical) y tres gotitas que saltan; todo con Y hacia arriba.
 * Nada de la corona se inclina hacia afuera: aplanada no deja huella sobre el aro.
 */
function createSplashGeometry() {
  const position = [], index = [];
  const quad = (a, b, c, d) => {
    const first = position.length / 3;
    position.push(...a, ...b, ...c, ...d);
    index.push(first, first + 1, first + 2, first, first + 2, first + 3);
  };
  for (let i = 0; i < 16; i++) {
    const a0 = i / 16 * Math.PI * 2, a1 = (i + 1) / 16 * Math.PI * 2;
    quad([Math.cos(a0) * SPLASH_INNER, 0, Math.sin(a0) * SPLASH_INNER], [Math.cos(a1) * SPLASH_INNER, 0, Math.sin(a1) * SPLASH_INNER],
      [Math.cos(a1) * SPLASH_OUTER, 0, Math.sin(a1) * SPLASH_OUTER], [Math.cos(a0) * SPLASH_OUTER, 0, Math.sin(a0) * SPLASH_OUTER]);
  }
  const tall = .04, half = .006, flare = half + Math.tan(25 * Math.PI / 180) * tall * .5;
  for (let i = 0; i < 8; i++) {
    const angle = (i + .5) / 8 * Math.PI * 2, r = .12;
    const cx = Math.cos(angle) * r, cz = Math.sin(angle) * r, tx = -Math.sin(angle), tz = Math.cos(angle);
    quad([cx - tx * half, 0, cz - tz * half], [cx + tx * half, 0, cz + tz * half],
      [cx + tx * flare, tall, cz + tz * flare], [cx - tx * flare, tall, cz - tz * flare]);
  }
  [[.3, .07, .05], [2.4, .09, .07], [4.4, .06, .09]].forEach(([angle, reach, height]) => {
    const x = Math.cos(angle) * reach, z = Math.sin(angle) * reach, h = .0075;
    quad([x - h, height - h, z], [x + h, height - h, z], [x + h, height + h, z], [x - h, height + h, z]);
    quad([x, height - h, z - h], [x, height - h, z + h], [x, height + h, z + h], [x, height + h, z - h]);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setIndex(index);
  // Cuánto de su vida lleva cada salpicadura (0 al nacer, 1 al apagarse).
  geometry.setAttribute('aAge', new THREE.InstancedBufferAttribute(new Float32Array(RIPPLE_COUNT), 1));
  return geometry;
}

/**
 * La salpicadura sin luz: gris según la luz de la lluvia y nunca blanca, de borde blando, que se apaga
 * mientras se abre y se pierde con la distancia. Cada una saca de su lugar un sorteo propio (sin azar
 * del juego) para su grosor, cuánto dura su brillo y si levanta corona.
 */
function createSplashMaterial(color) {
  const material = new THREE.ShaderMaterial({
    name: 'BogotaSalpicadura',
    uniforms: {
      uColor: { value: color },
      uOpacity: { value: 0 },
      uFade: { value: new THREE.Vector2(...SPLASH_FADE_NEAR) }
    },
    vertexShader: `
      attribute float aAge;
      varying float vAge;
      varying float vAcross;
      varying float vLifted;
      varying float vDepth;
      varying float vSeed;
      void main() {
        vec3 center = instanceMatrix[3].xyz;
        vSeed = fract(sin(dot(center.xz, vec2(12.9898, 78.233))) * 43758.5453);
        vAge = aAge;
        vLifted = step(1e-4, position.y);
        // -1 en el borde de adentro del aro, 1 en el de afuera; la corona y las gotitas no tienen borde.
        vAcross = (1.0 - vLifted) * (length(position.xz) - ${f((SPLASH_INNER + SPLASH_OUTER) / 2)}) / ${f((SPLASH_OUTER - SPLASH_INNER) / 2)};
        vDepth = -(modelViewMatrix * vec4(center, 1.0)).z;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform vec2 uFade;
      varying float vAge;
      varying float vAcross;
      varying float vLifted;
      varying float vDepth;
      varying float vSeed;
      void main() {
        float edge = pow(max(0.0, 1.0 - vAcross * vAcross), 1.0 + vSeed);
        float life = smoothstep(0.0, 0.05, vAge) * pow(max(0.0, 1.0 - vAge), 0.9 + 0.7 * vSeed);
        float crown = step(0.45, fract(vSeed * 7.31)) * 0.8;
        float far = 1.0 - smoothstep(uFade.x, uFade.y + 4.0 * vSeed, vDepth);
        float alpha = uOpacity * life * far * mix(edge, crown, vLifted);
        if (alpha < 0.002) discard;
        vec3 gray = vec3(dot(uColor, vec3(0.2126, 0.7152, 0.0722)));
        gl_FragColor = vec4(min(mix(uColor, gray, 0.5) * 0.7, vec3(0.62)), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false
  });
  // El clima copia aquí el color de la lluvia cada cuadro, como en cualquier material con color.
  material.color = color;
  return material;
}

export class WeatherSystem {
  constructor(scene) {
    this.scene = scene;
    this.weather = 'nublado';
    this.timer = 0;
    this.nextChange = 180 + Math.random() * 120; // 3 a 5 minutos
    this.isRaining = false;
    this.wetness = 0;
    this.season = seasonForDay(1);
    this.quality = 'alta';
    this.random = Math.random;

    // Valores mezclados que consumen el cielo, el audio y la interfaz.
    const start = WEATHER_TYPES.nublado;
    this.cloudCover = start.cloud;
    this.rainIntensity = 0;
    this.windStrength = start.wind;
    this.fogDensity = start.fog;
    this.lightningChance = 0;
    this.windDirection = new THREE.Vector2(.8, .6).normalize();
    this.wind = new THREE.Vector2();
    this.flash = 0;
    this._flashTime = -1;
    this._nextLightning = 6;
    this._windClock = 0;
    this._sunDirection = new THREE.Vector3();
    this._rainDaylight = 1;

    this.rainArea = { x: 30, y: 18, z: 30 };
    this.rainGeometry = null;
    this.rainParticles = null;
    this.rainCurtains = null;
    this.goteo = null;
    this.rippleMesh = null;
    this.rippleData = [];
    this._rainCover = null;
    this._coverUniforms = {
      uRainCoverMap: { value: null },
      uRainCoverRect: { value: new THREE.Vector4(0, 0, 0, 0) },
      uRainCoverHeight: { value: 0 }
    };

    if (this.scene) {
      this._initRain();
      this._initRipples();
      this._initCurtains();
      this.goteo = new Goteo(this.rainParticles.material.uniforms);
      if (this.goteo.mesh) this.rainParticles.add(this.goteo.mesh);
    }
  }

  get type() { return WEATHER_TYPES[this.weather] ?? WEATHER_TYPES.nublado; }

  _initRipples() {
    this.rippleCount = RIPPLE_COUNT;
    this.rippleData = [];
    this._dummyMatrix = new THREE.Matrix4();
    this._dummyPos = new THREE.Vector3();
    this._dummyScale = new THREE.Vector3();
    this._dummyQuat = new THREE.Quaternion();
    this._splashView = { seen: false, x: 0, z: 0, dirX: 0, dirZ: -1 };
    this._splashDir = new THREE.Vector3();

    this.rippleGeometry = createSplashGeometry();
    this.rippleMaterial = createSplashMaterial(new THREE.Color(0xbeddf5));
    this.rippleMaterial.opacity = 0.35;

    this.rippleMesh = new THREE.InstancedMesh(this.rippleGeometry, this.rippleMaterial, this.rippleCount);
    this.rippleMesh.frustumCulled = false;
    this.rippleMesh.visible = false;
    this.rippleMesh.onBeforeRender = (renderer, scene, camera) => {
      const view = this._splashView, dir = camera.getWorldDirection(this._splashDir);
      const flat = Math.hypot(dir.x, dir.z);
      view.seen = flat > .2;
      view.x = camera.matrixWorld.elements[12];
      view.z = camera.matrixWorld.elements[14];
      if (view.seen) { view.dirX = dir.x / flat; view.dirZ = dir.z / flat; }
    };
    this._dummyMatrix.makeTranslation(0, -100, 0);
    for (let i = 0; i < this.rippleCount; i++) {
      this.rippleData.push({ x: 0, y: -100, z: 0, age: Math.random() * 0.8, life: splashLife(Math.random()), maxScale: splashSize(Math.random()), turn: 0 });
      this.rippleMesh.setMatrixAt(i, this._dummyMatrix);
    }
    this.rippleMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.rippleMesh);
  }

  _initRain() {
    const drops = new Float32Array(RAIN_DROPS * 4 * 4);
    const corners = new Float32Array(RAIN_DROPS * 4 * 2);
    const index = new Uint16Array(RAIN_DROPS * 6);
    const positions = new Float32Array(RAIN_DROPS * 4 * 3); // la posición real sale del shader
    for (let i = 0; i < RAIN_DROPS; i++) {
      const x = Math.random() * this.rainArea.x, y = Math.random() * this.rainArea.y;
      const z = Math.random() * this.rainArea.z, speed = .85 + Math.random() * .3;
      for (let corner = 0; corner < 4; corner++) {
        drops.set([x, y, z, speed], (i * 4 + corner) * 4);
        corners.set([corner === 0 || corner === 3 ? -1 : 1, corner < 2 ? 0 : 1], (i * 4 + corner) * 2);
      }
      const base = i * 4;
      index.set([base, base + 2, base + 1, base, base + 3, base + 2], i * 6);
    }
    this.rainGeometry = new THREE.BufferGeometry();
    this.rainGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rainGeometry.setAttribute('aDrop', new THREE.BufferAttribute(drops, 4));
    this.rainGeometry.setAttribute('aCorner', new THREE.BufferAttribute(corners, 2));
    this.rainGeometry.setIndex(new THREE.BufferAttribute(index, 1));
    this.rainGeometry.setDrawRange(0, 0);

    this.rainParticles = new THREE.Mesh(this.rainGeometry, createRainMaterial(this.rainArea, this._coverUniforms));
    this.rainParticles.frustumCulled = false;
    this.rainParticles.visible = false;
    this.rainParticles.renderOrder = 5;
    this.rainParticles.raycast = () => {};
    const buffer = new THREE.Vector2();
    this.rainParticles.onBeforeRender = (renderer) => {
      this.rainParticles.material.uniforms.uViewHeight.value = renderer.getDrawingBufferSize(buffer).y;
    };
    this.scene.add(this.rainParticles);
  }

  /** Cuelgan de las gotas: se ven cuando ellas se ven y se preparan con ellas al cargar. */
  _initCurtains() {
    const curtains = sinGastarAzar(0x11a5c0a7, () => {
      const geometry = createCurtainGeometry();
      const fog = this.scene.fog?.color ?? new THREE.Color(0x8a96a0);
      return new THREE.Mesh(geometry, createCurtainMaterial(this.rainParticles.material.uniforms, fog, this._coverUniforms));
    });
    if (!curtains) return;
    curtains.frustumCulled = false;
    curtains.renderOrder = 4;
    curtains.raycast = () => {};
    const player = this._curtainPlayer = new THREE.Vector3();
    curtains.onBeforeRender = (renderer, scene, camera) => {
      const e = camera.matrixWorld.elements, near = Math.hypot(e[12] - player.x, e[14] - player.z) < 14;
      curtains.material.uniforms.uCenter.value.set(near ? e[12] : player.x, near ? e[14] : player.z);
    };
    this.rainCurtains = curtains;
    this.rainParticles.add(curtains);
  }

  /** Los faroles más cercanos aclaran las gotas que caen bajo su luz. */
  _gatherLamps(district, playerPosition) {
    const lamps = this.rainParticles.material.uniforms.uLamps.value;
    const near = this._lampNear ??= new Float64Array(LAMP_COUNT);
    near.fill(Infinity);
    for (const lamp of lamps) lamp.set(0, -1e4, 0);
    for (const prop of district?.props ?? []) {
      const group = prop.instance?.group;
      if (!group) continue;
      const angle = group.rotation.y;
      const x = group.position.x + Math.cos(angle) * LAMP_REACH, z = group.position.z - Math.sin(angle) * LAMP_REACH;
      const d = (x - playerPosition.x) ** 2 + (z - playerPosition.z) ** 2;
      if (d >= near[LAMP_COUNT - 1]) continue;
      let slot = LAMP_COUNT - 1;
      while (slot > 0 && near[slot - 1] > d) {
        near[slot] = near[slot - 1];
        lamps[slot].copy(lamps[slot - 1]);
        slot--;
      }
      near[slot] = d;
      lamps[slot].set(x, Math.max(group.position.y, 0) + LAMP_HEIGHT, z);
    }
  }

  _setRainCover(cover) {
    if (this._rainCover === cover) return;
    this._rainCover = cover;
    const { uRainCoverMap, uRainCoverRect, uRainCoverHeight } = this._coverUniforms;
    uRainCoverMap.value = cover?.texture ?? null;
    uRainCoverHeight.value = cover?.maxHeight ?? 0;
    if (cover) uRainCoverRect.value.copy(cover.rect);
  }

  setQuality(level = 'alta') {
    this.quality = RAIN_BUDGET[level] ? level : 'alta';
    this._applyRain();
  }

  /**
   * Cambia el estado del tiempo. Por defecto el cambio es inmediato (inicio de
   * partida, pruebas); `transition` mezcla nubes, lluvia y viento durante ~40 s.
   */
  setWeather(type, notify = true, { transition = false } = {}) {
    if (!WEATHER_TYPES[type] && import.meta.env?.DEV) console.warn(`[Clima] No existe el tiempo «${type}»: sigue el que había.`);
    if (!WEATHER_TYPES[type] || this.weather === type) return;
    this.weather = type;
    const target = WEATHER_TYPES[type];
    if (!transition) {
      this.cloudCover = target.cloud;
      this.rainIntensity = target.rain;
      this.windStrength = target.wind * this.season.windMul;
      this.fogDensity = target.fog;
      this.lightningChance = target.lightning;
      this.isRaining = this.rainIntensity >= RAIN_THRESHOLD;
      this._applyRain();
    }

    if (notify && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('toast', { detail: { text: target.toast, type: 'info' } }));
      window.dispatchEvent(new CustomEvent('weather-change', {
        detail: { weather: this.weather, isRaining: target.rain >= RAIN_THRESHOLD, season: this.season.id }
      }));
    }
  }

  _applyRain() {
    this._appliedRain = this.rainIntensity;
    if (!this.rainParticles) return;
    const amount = this.isRaining ? THREE.MathUtils.clamp(this.rainIntensity, .2, 1) : 0;
    const material = this.rainParticles.material;
    this.rainParticles.visible = amount > 0;
    material.opacity = amount > 0 ? .3 + amount * .3 : 0;
    material.uniforms.uOpacity.value = material.opacity;
    const drops = Math.round(RAIN_DROPS * amount * RAIN_BUDGET[this.quality]);
    this.rainGeometry.setDrawRange(0, drops * 6);
    if (this.rainCurtains) this.rainCurtains.geometry.setDrawRange(0, this.quality === 'baja' ? CURTAIN_SIDES * 6 : Infinity);
  }

  _blend(dt) {
    const target = this.type;
    const k = 1 - Math.exp(-dt / 14);
    this.cloudCover += (target.cloud - this.cloudCover) * k;
    // La lluvia arranca cuando las nubes ya cerraron el cielo; al escampar baja primero.
    const rainTarget = this.cloudCover >= target.cloud - .08 ? target.rain : Math.min(target.rain, this.rainIntensity);
    this.rainIntensity += (rainTarget - this.rainIntensity) * Math.min(1, k * 1.4);
    if (Math.abs(rainTarget - this.rainIntensity) < .002) this.rainIntensity = rainTarget;
    this.windStrength += (target.wind * this.season.windMul - this.windStrength) * k;
    this.fogDensity += (target.fog - this.fogDensity) * k;
    this.lightningChance += (target.lightning - this.lightningChance) * k;
  }

  _updateLightning(dt, playerPosition) {
    if (this._flashTime >= 0) {
      this._flashTime += dt;
      const t = this._flashTime;
      // Dos destellos seguidos, como un relámpago que parpadea.
      this.flash = Math.max(0, 1 - t / .12) + (t > .18 ? Math.max(0, .7 - (t - .18) / .25) : 0);
      if (t > .5) { this._flashTime = -1; this.flash = 0; }
    }
    if (this.lightningChance < .05) return;
    this._nextLightning -= dt * this.lightningChance;
    if (this._nextLightning > 0) return;
    this._nextLightning = 5 + this.random() * 11;
    this._flashTime = 0;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      // La distancia retrasa y apaga el trueno en el audio.
      window.dispatchEvent(new CustomEvent('weather-lightning', {
        detail: { distance: 300 + this.random() * 2200, x: playerPosition?.x ?? 0, z: playerPosition?.z ?? 0 }
      }));
    }
  }

  /** `clock` es opcional: aporta día y hora para la temporada y la neblina matinal. */
  update(dt, playerPosition, district = null, clock = null) {
    if (clock) this.season = seasonForDay(clock.day);
    this.timer += dt;
    if (this.timer >= this.nextChange) {
      this.timer = 0;
      this.nextChange = 180 + this.random() * 200;
      this.setWeather(pickNextWeather(this.weather, this.season, clock?.hour ?? 12, this.random), true, { transition: true });
    }
    this._blend(dt);
    const wasRaining = this.isRaining;
    this.isRaining = this.rainIntensity >= RAIN_THRESHOLD;
    // Ajustar el presupuesto de gotas solo cuando la intensidad cambia de forma visible.
    if (wasRaining !== this.isRaining || Math.abs(this.rainIntensity - this._appliedRain) > .02) this._applyRain();
    this._updateLightning(dt, playerPosition);

    // Viento: la dirección gira lentamente y hay ráfagas suaves.
    this._windClock += dt;
    const angle = Math.atan2(this.windDirection.y, this.windDirection.x) + Math.sin(this._windClock * .013) * dt * .02;
    this.windDirection.set(Math.cos(angle), Math.sin(angle));
    const gust = 1 + Math.sin(this._windClock * .7) * .15 + Math.sin(this._windClock * 1.9) * .08;
    this.wind.copy(this.windDirection).multiplyScalar(this.windStrength * 6 * gust);

    // Acumulación y secado gradual de charcos/humedad; el sol seca más rápido.
    if (this.isRaining) {
      this.wetness = Math.min(1.0, this.wetness + dt * 0.25 * Math.max(.4, this.rainIntensity));
    } else {
      // El piso tarda minutos en secar (casi tres nublado, minuto y medio con sol): el brillo sigue después de escampar.
      this.wetness = Math.max(0.0, this.wetness - dt * (this.weather === 'soleado' ? .012 : .006));
    }
    if (district?.setWetness && Math.abs(this.wetness - (this._sentWetness ?? -1)) > .004) {
      this._sentWetness = this.wetness;
      district.setWetness(this.wetness);
    }
    // La gente reacciona a lo que cae, no al piso mojado: con llovizna no se cubre como en un aguacero.
    const falling = this.isRaining ? this.rainIntensity : 0;
    if (district?.setRain && Math.abs(falling - (this._sentRain ?? -1)) > .01) {
      this._sentRain = falling;
      district.setRain(falling);
    }
    // Cada cuadro: una ciudad recién construida también debe enterarse de que el suelo sigue mojado.
    setPuddles(this.wetness, falling, dt);

    this._setRainCover(district?.rainCover ?? null);
    this._updateRipples(dt, playerPosition, district);

    if (!this.isRaining || !this.rainParticles || !playerPosition) return;
    this.rainParticles.position.copy(playerPosition);
    const uniforms = this.rainParticles.material.uniforms;
    if (clock) {
      sunDirection(clock.hour, clock.day, this._sunDirection);
      this._rainDaylight = THREE.MathUtils.smoothstep(this._sunDirection.y, -.08, .22);
    }
    uniforms.uColor.value.copy(RAIN_COLOR_NIGHT).lerp(RAIN_COLOR_DAY, this._rainDaylight)
      .lerp(RAIN_COLOR_FLASH, Math.min(1, this.flash));
    uniforms.uTime.value = (uniforms.uTime.value + dt) % 600;
    uniforms.uOrigin.value.copy(playerPosition);
    uniforms.uWind.value.copy(this.wind);
    uniforms.uLength.value = .45 + this.rainIntensity * .35;
    uniforms.uLampNight.value = 1 - this._rainDaylight;
    this.rippleMaterial?.color.copy(uniforms.uColor.value);
    if (this.rainCurtains) {
      const curtain = this.rainCurtains.material.uniforms;
      curtain.uRain.value = this.rainIntensity;
      curtain.uFeet.value = playerPosition.y;
      this._curtainPlayer.copy(playerPosition);
      if (this.scene.fog) curtain.uFogColor.value = this.scene.fog.color;
    }
    this.goteo?.update(dt, playerPosition, this.rainIntensity);
    this._lampClock = (this._lampClock ?? 0) - dt;
    if (this._lampClock <= 0) {
      this._lampClock = .5;
      this._gatherLamps(district, playerPosition);
    }
  }

  _updateRipples(dt, playerPosition, district) {
    if (!this.rippleMesh || !playerPosition) return;
    const count = this.isRaining ? Math.max(6, Math.round(this.rippleCount * this.rainIntensity)) : 0;
    this.rippleMesh.visible = count > 0;
    this.rippleMesh.count = count;
    if (!count) return;
    const heavy = THREE.MathUtils.smoothstep(this.rainIntensity, .3, .72);
    this.rippleMaterial.opacity = (0.2 + 0.1 * heavy) * Math.min(1.0, this.wetness * 1.5);
    const splash = this.rippleMaterial.uniforms;
    splash.uOpacity.value = this.rippleMaterial.opacity;
    const view = this._splashView;
    const away = Math.hypot(view.x - playerPosition.x, view.z - playerPosition.z);
    const ahead = view.seen && away < 14;
    if (ahead || !view.seen) splash.uFade.value.set(...SPLASH_FADE_NEAR);
    else splash.uFade.value.set(away - 4, away + 8);
    const ages = this.rippleGeometry.attributes.aAge;
    for (let i = 0; i < count; i++) {
      const r = this.rippleData[i];
      r.age += dt;
      const spawned = r.age >= r.life;
      if (spawned) {
        r.age = 0;
        r.life = splashLife(Math.random());
        const a = Math.random(), b = Math.random();
        if (ahead) {
          const turn = (a - 0.5) * SPLASH_SECTOR, reach = 2 + b * 10;
          const cos = Math.cos(turn), sin = Math.sin(turn);
          r.x = view.x + (view.dirX * cos - view.dirZ * sin) * reach;
          r.z = view.z + (view.dirX * sin + view.dirZ * cos) * reach;
        } else {
          r.x = playerPosition.x + (a - 0.5) * 26;
          r.z = playerPosition.z + (b - 0.5) * 26;
        }
        r.maxScale = splashSize(Math.random()); // gotas de lluvia, no anillos de un metro
        r.turn = splashTurn(r.x, r.z);
      }
      const roof = this._rainCover?.heightAt(r.x, r.z);
      if (spawned) {
        // En el viaducto toma el piso de la capa desde la que se está jugando.
        const layer = roof != null ? district?.getMovementGroundHeight?.(r.x, r.z, playerPosition.y) : undefined;
        r.y = (layer ?? district?.getGroundHeight?.(r.x, r.z) ?? playerPosition.y) + 0.025;
      }
      // Se abre rápido al caer la gota y cada vez más despacio.
      const t = Math.min(1.0, r.age / r.life);
      const currentScale = 0.15 + (1 - (1 - t) * (1 - t)) * r.maxScale;
      const crown = Math.max(0, 1 - r.age / (r.life * .25));
      // Una cubierta apaga solo el anillo de abajo, manteniendo vida, sorteos y anillos de la calle.
      ages.array[i] = roof != null && r.y + this._rainCover.metersPerByte * .5 < roof ? 1 : t;
      this._dummyPos.set(r.x, r.y, r.z);
      this._dummyScale.set(currentScale, crown, currentScale);
      this._dummyQuat.setFromAxisAngle(SPLASH_UP, r.turn ?? 0);
      this._dummyMatrix.compose(this._dummyPos, this._dummyQuat, this._dummyScale);
      this.rippleMesh.setMatrixAt(i, this._dummyMatrix);
    }
    ages.needsUpdate = true;
    this.rippleMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this._setRainCover(null);
    this.goteo?.dispose();
    if (this.rainCurtains) {
      this.rainCurtains.geometry.dispose();
      this.rainCurtains.material.dispose();
    }
    if (this.rainParticles && this.scene) {
      this.scene.remove(this.rainParticles);
      this.rainGeometry?.dispose();
      this.rainParticles.material?.dispose();
    }
    if (this.rippleMesh && this.scene) {
      this.scene.remove(this.rippleMesh);
      this.rippleGeometry?.dispose();
      this.rippleMaterial?.dispose();
    }
  }
}
