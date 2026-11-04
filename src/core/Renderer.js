import * as THREE from 'three';
import { PlayerSilhouette } from './PlayerSilhouette.js';
import { AdaptiveResolution } from './AdaptiveResolution.js';
import { FrustumCulling } from './FrustumCulling.js';
import { paintLoadingFrame } from '../ui/LoadingScreen.js';
import { AutoQuality, GRAPHICS_PROFILES, effectiveQuality } from './GraphicsQuality.js';
import { sunFieldUniforms } from '../world/bogota/SunField.js';

// Bandas verticales del cielo que se refleja: el esmalte necesita un horizonte claro entre un cenit
// más oscuro y una calle negra; un cielo uniforme lo hace ver como plástico mate.
const REFLECTION_SKIES = {
  dia: { zenith: 0x9db3cc, mid: 0xc8d3de, horizon: 0xf6f5f0, street: 0x24272b, ground: 0x34363a, building: 0x2f363f, glow: 0xdfe8ef, glowScale: 1.2 },
  noche: { zenith: 0x05080f, mid: 0x0d1420, horizon: 0x33291f, street: 0x0c0d10, ground: 0x0d0e11, building: 0x090c12, glow: 0xffb873, glowScale: 3.6 }
};

function gradientSky(palette) {
  const geometry = new THREE.SphereGeometry(30, 32, 24);
  const position = geometry.attributes.position, colors = new Float32Array(position.count * 3);
  const zenith = new THREE.Color(palette.zenith), mid = new THREE.Color(palette.mid);
  const horizon = new THREE.Color(palette.horizon), street = new THREE.Color(palette.street);
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) / 30;
    if (y < 0) color.copy(street);
    else if (y < .14) color.copy(horizon).lerp(mid, y / .14);
    else color.copy(mid).lerp(zenith, Math.pow((y - .14) / .86, .7));
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
}

/** Entorno exterior urbano de Bogotá para reflejos PBR en carros, asfalto, vidrios y charcos */
export class OutdoorUrbanEnvironment extends THREE.Scene {
  constructor(mode = 'dia') {
    super();
    this.name = 'OutdoorUrbanEnvironment';
    const palette = REFLECTION_SKIES[mode] ?? REFLECTION_SKIES.dia;

    // Cielo con horizonte: la franja clara es la que dibuja la línea de luz en la carrocería.
    this.add(gradientSky(palette));

    // Disco del sol o del resplandor urbano: el brillo puntual que le da forma al esmalte.
    const glare = new THREE.Mesh(new THREE.SphereGeometry(mode === 'noche' ? 2.2 : 3.6, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(mode === 'noche' ? 0xffcfa0 : 0xfff6e8).multiplyScalar(mode === 'noche' ? 1.6 : 9) }));
    glare.position.set(-11, 25, 10);
    this.add(glare);

    // Calle oscura: el mundo del juego siempre tiene asfalto debajo del reflejo.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshBasicMaterial({ color: palette.ground }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    this.add(ground);

    // El sol también alumbra las manzanas del reflejo: el lado que le da la cara no queda plano.
    const light = new THREE.PointLight(mode === 'noche' ? 0xffcfa0 : 0xfff2df, mode === 'noche' ? 60 : 900);
    light.position.copy(glare.position);
    this.add(light);

    // Manzanas alrededor, más bajas que el horizonte claro: cortan el cielo como en una calle real.
    const buildingMat = new THREE.MeshLambertMaterial({ color: palette.building, emissive: palette.building, emissiveIntensity: .75 });
    const shopGeo = new THREE.PlaneGeometry(3.2, 2.4);
    const windowGeo = new THREE.PlaneGeometry(2.4, 1.1);
    const glowMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(palette.glow).multiplyScalar(palette.glowScale), side: THREE.DoubleSide
    });
    const blocks = 12;
    for (let i = 0; i < blocks; i++) {
      const angle = i / blocks * Math.PI * 2 + .13, radius = 15 + (i * 7 % 5);
      const height = 6 + (i * 5 % 7);
      const box = new THREE.BoxGeometry(5.5, height, 5.5);
      const b = new THREE.Mesh(box, buildingMat);
      const x = Math.sin(angle) * radius, z = Math.cos(angle) * radius;
      b.position.set(x, height / 2 - .5, z);
      b.rotation.y = angle;
      this.add(b);
      // Comercios y ventanas: de noche son los reflejos cálidos sobre los charcos.
      const inner = radius - 2.9;
      const shop = new THREE.Mesh(shopGeo, glowMat);
      shop.position.set(Math.sin(angle) * inner, 1.2, Math.cos(angle) * inner);
      shop.rotation.y = angle;
      this.add(shop);
      if (i % 2 === 0) {
        const lit = new THREE.Mesh(windowGeo, glowMat);
        lit.position.set(Math.sin(angle + .05) * inner, Math.min(height - 1.5, 4.5), Math.cos(angle + .05) * inner);
        lit.rotation.y = angle;
        this.add(lit);
      }
    }
  }

  dispose() {
    const geometries = new Set(), materials = new Set();
    this.traverse(o => {
      if (o.geometry) geometries.add(o.geometry);
      for (const material of [o.material].flat()) if (material) materials.add(material);
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  }
}

// Si los programas no terminan de compilar en este tiempo (contexto perdido, por ejemplo) el cambio de
// calidad se aplica igual: lo peor que pasa es lo de antes, que el primer cuadro espere a la GPU.
const VARIANT_WAIT_MS = 15000;
// Los primeros cuadros tras cambiar las sombras pagan el cambio, con varios tirones la primera vez:
// no dicen nada del equipo y no cuentan para la resolución ni para la calidad automática.
const SETTLE_FRAMES = 20;

// Cada cambio de la mezcla es una pasada de pantalla completa sobre el mapa. Este paso no se ve en el
// piso y deja unas pocas por segundo, solo durante el minuto que dura el amanecer o el atardecer.
const ENVIRONMENT_STEP = 1 / 128;

/**
 * Un solo mapa de entorno que se funde entre el de día y el de noche. Three alumbra con él todo material
 * PBR, no solo sus reflejos: cambiarlo de golpe hacía saltar el brillo del piso de un cuadro a otro.
 * La textura es siempre la misma y del mismo tamaño, así que ningún material vuelve a buscar su programa.
 */
export class EnvironmentMix {
  constructor(renderer, day, night) {
    this.renderer = renderer;
    this.target = new THREE.WebGLRenderTarget(day.image.width, day.image.height, {
      magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, generateMipmaps: false,
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false
    });
    this.target.texture.mapping = THREE.CubeUVReflectionMapping;
    this.target.texture.name = 'PMREM.cubeUv';
    this.material = new THREE.ShaderMaterial({
      name: 'Mezcla de mapas de entorno',
      uniforms: { dayMap: { value: day }, nightMap: { value: night }, dayAmount: { value: 1 } },
      depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false, fog: false,
      vertexShader: 'varying vec2 vMapUv; void main() { vMapUv = uv; gl_Position = vec4( position.xy, 0., 1. ); }',
      // Los dos mapas tienen la misma disposición: mezclar texel a texel mezcla también cada nivel de rugosidad.
      fragmentShader: `uniform sampler2D dayMap; uniform sampler2D nightMap; uniform float dayAmount; varying vec2 vMapUv;
        void main() { gl_FragColor = mix( texture2D( nightMap, vMapUv ), texture2D( dayMap, vMapUv ), dayAmount ); }`
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
    this.amount = null;
  }

  get texture() { return this.target.texture; }

  /** Mapas nuevos tras recuperar un contexto perdido: la próxima mezcla se dibuja aunque la hora no cambie. */
  setMaps(day, night) {
    this.material.uniforms.dayMap.value = day;
    this.material.uniforms.nightMap.value = night;
    this.amount = null;
  }

  /** `amount` es 1 de día y 0 de noche; solo dibuja si el cambio ya se notaría o si llega a un extremo. */
  update(amount) {
    if (amount === this.amount) return false;
    const atEnd = amount === 0 || amount === 1;
    if (this.amount !== null && !atEnd && Math.abs(amount - this.amount) < ENVIRONMENT_STEP) return false;
    this.amount = amount;
    this.material.uniforms.dayAmount.value = amount;
    const gl = this.renderer, previous = gl.getRenderTarget();
    gl.setRenderTarget(this.target);
    gl.render(this.scene, this.camera);
    gl.setRenderTarget(previous);
    return true;
  }
}

export class Renderer {
  constructor(canvas) {
    this.instance = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.resolution = new AdaptiveResolution(window.devicePixelRatio);
    let saved = null;
    try { saved = localStorage.getItem('bazuko.graphics_quality'); } catch { saved = 'sin almacenamiento'; }
    this.autoQuality = new AutoQuality(saved === null);
    this.instance.setPixelRatio(this.resolution.ratio);
    this._pixelRatio = this.resolution.ratio;
    this.instance.setSize(window.innerWidth, window.innerHeight);
    this.instance.shadowMap.enabled = true;
    this.instance.shadowMap.type = THREE.PCFShadowMap;

    // Look realista: tone mapping fílmico
    this.instance.toneMapping = THREE.ACESFilmicToneMapping;
    this.instance.toneMappingExposure = 1.05;
    this.instance.outputColorSpace = THREE.SRGBColorSpace;
    this.silhouette = new PlayerSilhouette();
    this.culling = new FrustumCulling();
    this.composer = null;
    this.bloomPass = null;
    // El contador incluye las tres pasadas, no solo la última del personaje.
    this.instance.info.autoReset = false;

    window.addEventListener('resize', () => this._onResize());
    document.addEventListener('visibilitychange', () => this.resolution.resetWindow());
  }

  setQuality(level = 'alta') {
    this.quality = ['baja', 'media', 'alta'].includes(level) ? level : 'alta';
    const limit = GRAPHICS_PROFILES[this.quality].pixelRatio;
    this.resolution.setLimit(Math.min(globalThis.window?.devicePixelRatio || 1, limit));
    this.instance.shadowMap.enabled = this.effectiveQuality !== 'baja';
    this.instance.shadowMap.type = THREE.PCFShadowMap;
    this.instance.shadowMap.needsUpdate = true;
    this._settleFrames = SETTLE_FRAMES;
    // El primer llamado es el arranque con la calidad por defecto: no es una elección y no se guarda.
    const auto = this.autoQuality;
    if (auto?.eligible && !auto.started) { auto.started = true; return; }
    this.rememberQuality(this.quality);
    this.instance.shadowMap.enabled = this.effectiveQuality !== 'baja';
  }

  /** El jugador eligió: la calidad ya no cambia sola y su elección queda guardada, aunque aún no se aplique. */
  rememberQuality(quality) {
    this.autoQuality?.cancel();
    try { localStorage.setItem('bazuko.graphics_quality', quality); } catch { /* sin almacenamiento */ }
  }

  get effectiveQuality() { return effectiveQuality(this.quality ?? 'alta', this.resolution?.pressure ?? 0, this.autoQuality?.tier ?? 0); }

  /**
   * Compila de antemano las variantes con sombra, sin bloquear: el juego no se congela esperándolas,
   * aunque su primer dibujo siga dando un tirón. Si algo falla, se queda en baja por el resto de la sesión.
   */
  async _raiseAutoQuality() {
    const auto = this.autoQuality, frame = this._lastFrame, sun = frame?.shadowLights?.[0], gl = this.instance;
    if (!auto || !frame || !sun || !gl.compileAsync) { auto?.cancel(); return false; }
    const enabled = gl.shadowMap.enabled, cast = sun.castShadow;
    let ready;
    try {
      gl.shadowMap.enabled = true; sun.castShadow = true;
      ready = gl.compileAsync(frame.scene, frame.camera);
    } catch { auto.cancel(); return false; } finally {
      gl.shadowMap.enabled = enabled; sun.castShadow = cast;
    }
    try { await ready; } catch { auto.cancel(); return false; }
    // Mientras compilaba el jugador pudo elegir calidad: su decisión manda.
    if (!auto.eligible || auto.blocked) return false;
    auto.preparing = false;
    auto.tier = 1;
    auto.reset();
    gl.shadowMap.enabled = true;
    gl.shadowMap.needsUpdate = true;
    this._settleFrames = SETTLE_FRAMES;
    return true;
  }

  /**
   * Compila sin bloquear la variante con o sin sombras: cambiarla después no congela el juego.
   * Su promesa nunca falla ni se queda sin terminar, para que un error no deje atascada la calidad.
   */
  prepareVariant(shadows) {
    const frame = this._lastFrame, sun = frame?.shadowLights?.[0], gl = this.instance;
    if (!sun || !gl.compileAsync || gl.shadowMap.enabled === shadows) return Promise.resolve();
    const enabled = gl.shadowMap.enabled, cast = sun.castShadow;
    let ready;
    try {
      gl.shadowMap.enabled = shadows; sun.castShadow = shadows;
      ready = gl.compileAsync(frame.scene, frame.camera);
    } catch { return Promise.resolve(); } finally {
      gl.shadowMap.enabled = enabled; sun.castShadow = cast;
    }
    return new Promise(resolve => {
      const limit = setTimeout(resolve, VARIANT_WAIT_MS);
      const done = () => { clearTimeout(limit); resolve(); };
      ready.then(done, done);
    });
  }

  _dropAutoQuality() {
    // Vuelve exactamente a como estaba baja: sin presión acumulada ni resolución recortada.
    this.resolution.setLimit(this.resolution.max);
    this.instance.shadowMap.enabled = this.effectiveQuality !== 'baja';
    this.instance.shadowMap.needsUpdate = true;
  }

  setupPostprocessing(scene, camera) {
    // Postprocesado seguro sin romper buffer de profundidad de siluetas
  }

  /**
   * Mapas de entorno de día y de noche, y la textura que los mezcla, que es la que usa la escena.
   * SceneManager pide la mezcla según la hora en `scene.userData.environmentDay`.
   */
  createEnvironment() {
    const { day, night } = this._bakeEnvironment();
    this.environmentMix = new EnvironmentMix(this.instance, day, night);
    // Lista desde ya: compila aquí y no en el primer atardecer.
    this.environmentMix.update(1);
    // Three vuelve a subir lo que tiene en memoria, pero estos mapas son dibujos: un contexto perdido los vacía.
    this.instance.domElement.addEventListener('webglcontextrestored', () => { this._environmentLost = true; this._settleFrames = SETTLE_FRAMES; });
    return this.environmentMix.texture;
  }

  _bakeEnvironment() {
    const pmrem = new THREE.PMREMGenerator(this.instance);
    const bake = mode => {
      const environment = new OutdoorUrbanEnvironment(mode);
      try { return pmrem.fromScene(environment, 0.03, .1, 100, { size: 128 }).texture; }
      finally { environment.dispose(); }
    };
    try { return { day: bake('dia'), night: bake('noche') }; }
    finally { pmrem.dispose(); }
  }

  _onResize() {
    this.instance.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  async prepare(scene, camera, extraModels = []) {
    const textures = new Set();
    for (const root of [scene, ...extraModels]) root.traverse(object => {
      for (const material of [object.material].flat().filter(Boolean)) {
        for (const value of Object.values(material)) {
          if (value?.isTexture && !value.isRenderTargetTexture) textures.add(value);
        }
      }
    });
    let uploadStart = performance.now();
    for (const texture of textures) {
      this.instance.initTexture(texture);
      if (performance.now() - uploadStart >= 8) {
        await paintLoadingFrame();
        uploadStart = performance.now();
      }
    }
    await this.instance.compileAsync(scene, camera);
    // Referencias temporales: no cambia los padres ni el LOD visible de cada NPC.
    const models = new THREE.Group();
    models.children = extraModels;
    try { await this.instance.compileAsync(models, camera, scene); }
    finally { models.children = []; }
  }

  async waitForGPU() {
    const gl = this.instance.getContext();
    if (gl.isContextLost()) throw new Error('Se perdió el contexto gráfico.');
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) throw new Error('No se pudo comprobar la preparación gráfica.');
    gl.flush();
    const deadline = performance.now() + 30000;
    try {
      while (true) {
        const result = gl.clientWaitSync(fence, 0, 0);
        if (result === gl.ALREADY_SIGNALED || result === gl.CONDITION_SATISFIED) return;
        if (result === gl.WAIT_FAILED || gl.isContextLost() || performance.now() > deadline) {
          throw new Error('No se pudo completar la preparación gráfica.');
        }
        await paintLoadingFrame();
      }
    } finally { gl.deleteSync(fence); }
  }

  render(scene, camera, playerRoot = null, shadowLights = [], showSilhouette = true) {
    this.instance.info.reset();
    // Cambiar la resolución borra el lienzo: se hace justo antes de dibujar, o se ve un cuadro negro.
    const ratio = this.resolution?.ratio;
    if (ratio !== undefined && ratio !== this._pixelRatio) {
      this._pixelRatio = ratio;
      this.instance.setPixelRatio(ratio);
    }
    const exposure = scene.userData?.toneMappingExposure;
    this.instance.toneMappingExposure = Number.isFinite(exposure) ? THREE.MathUtils.clamp(exposure, .8, 1.3) : 1.05;
    if (this._environmentLost) {
      this._environmentLost = false;
      const { day, night } = this._bakeEnvironment();
      this.environmentMix.setMaps(day, night);
    }
    const environmentDay = scene.userData?.environmentDay;
    if (this.environmentMix && Number.isFinite(environmentDay)) this.environmentMix.update(environmentDay);
    const autoUpdate = scene.matrixWorldAutoUpdate;
    try {
      // Los inmuebles ya tienen matrices mundiales fijas. El recorrido automático
      // de Scene aún visitaba sus miles de nodos, incluso con matrices congeladas.
      if (autoUpdate && this.dynamicWorldRoots && !scene.parent) {
        if (scene.matrixAutoUpdate) scene.updateMatrix();
        scene.matrixWorld.copy(scene.matrix);
        scene.matrixWorldNeedsUpdate = false;
        for (const root of scene.children) if (root.matrixWorldAutoUpdate !== false) root.updateMatrixWorld();
        for (const root of this.dynamicWorldRoots) root.updateMatrixWorld();
        scene.matrixWorldAutoUpdate = false;
      }
      this.culling.apply(camera, this.instance.shadowMap.enabled ? shadowLights : []);
      // Lo que hay que compilar si cambian las sombras. El objeto se reutiliza: se escribe en cada cuadro.
      const frame = this._lastFrame ??= {};
      frame.scene = scene; frame.camera = camera; frame.shadowLights = shadowLights;
      sunFieldUniforms.uSunFieldOn.value = 1;
      this.instance.render(scene, camera);
      if (playerRoot && showSilhouette && GRAPHICS_PROFILES[this.effectiveQuality].silhouette) {
        this.silhouette.render(this.instance, scene, camera, playerRoot, this.overlayLights);
      }
    } finally {
      sunFieldUniforms.uSunFieldOn.value = 0;
      scene.matrixWorldAutoUpdate = autoUpdate;
      this.culling.restore();
    }
  }

  adaptResolution(frameMs, workMs = 0) {
    // Los tirones de compilar la subida tampoco dicen nada del equipo: no pueden bajar la resolución.
    if (this._settleFrames > 0 || this.autoQuality?.preparing) {
      if (this._settleFrames > 0) this._settleFrames--;
      this.resolution.resetWindow();
      return;
    }
    const action = this.autoQuality?.sample(frameMs, workMs, {
      pressure: this.resolution.pressure, atMaxRatio: this.resolution.ratio >= this.resolution.max
    });
    if (action === 'subir') this._raiseAutoQuality();
    else if (action === 'bajar') { this._dropAutoQuality(); return; }
    if (this.resolution.sample(frameMs, workMs)) {
      // Ya no queda resolución que bajar: lo siguiente es apagar las sombras, y se deja compilado desde ya.
      // Quien partió de baja ya compiló esa variante al cargar.
      if (this.resolution.ratio <= this.resolution.min && this.quality !== 'baja' && !this._shadowlessReady) {
        this._shadowlessReady = true;
        this.prepareVariant(false);
      }
      const shadows = this.effectiveQuality !== 'baja';
      if (this.instance.shadowMap.enabled !== shadows) {
        this.instance.shadowMap.enabled = shadows;
        this.instance.shadowMap.needsUpdate = true;
        this._settleFrames = SETTLE_FRAMES;
      }
    }
  }
}
