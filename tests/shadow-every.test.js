// En calidad media la sombra del sol se pinta una imagen sí y otra no, y en todas si lo que se sigue va a más
// de 9 m/s o salta de lugar o de hora; en alta, en todas; baja no tiene.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import * as THREE from 'three';
import { Renderer } from '../src/core/Renderer.js';
import { AdaptiveResolution } from '../src/core/AdaptiveResolution.js';
import { FrustumCulling } from '../src/core/FrustumCulling.js';
import { AutoQuality, GRAPHICS_PROFILES } from '../src/core/GraphicsQuality.js';

// El reloj del dibujo es el de la prueba: cada imagen lo adelanta lo que dura.
let reloj = 0;

beforeEach(() => {
  globalThis.window = new EventTarget();
  window.devicePixelRatio = 1;
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  reloj = 0;
  mock.method(performance, 'now', () => reloj);
});

afterEach(() => mock.restoreAll());

const baked = () => {
  const texture = new THREE.Texture({ width: 384, height: 512 });
  texture.mapping = THREE.CubeUVReflectionMapping;
  return texture;
};

/**
 * El Renderer y el descarte de verdad, con un sol que sigue al jugador como en `SceneManager.followTarget`.
 * Del motor solo se imita lo que toca a la sombra: el mapa se pinta si `autoUpdate` o `needsUpdate`, con la
 * matriz del sol de ese momento; al pintarlo existe `shadow.map` y los dos `needsUpdate` vuelven a false, y la
 * escena lo lee con `sun.shadow.matrix`. Como en `WebGLRenderer.render`, se recorre lo que ve la cámara con el
 * número de imagen de `info`, se le suma uno y la pasada de sombra usa el nuevo; los huesos de quien da sombra
 * se ponen al día una sola vez por número, como en `WebGLObjects.update`.
 */
function partida({ saved = null } = {}) {
  if (saved) localStorage.setItem('bazuko.graphics_quality', saved);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1.6, .1, 300);
  const sun = new THREE.DirectionalLight();
  sun.castShadow = true;
  scene.add(sun, sun.target);
  const shadowMap = { enabled: true, autoUpdate: true, needsUpdate: false };
  const pintadoCon = new THREE.Matrix4(), imagenes = [], info = { render: { frame: 0 }, reset() {} };
  let juego = 0, huesosEn = -1, pose = -1;
  const huesos = () => { if (huesosEn !== info.render.frame) { huesosEn = info.render.frame; pose = juego; } };
  const instance = {
    shadowMap, domElement: new EventTarget(), info, setPixelRatio() {},
    compileAsync: () => Promise.resolve(), target: null,
    getRenderTarget() { return this.target; }, setRenderTarget(target) { this.target = target; },
    render(what) {
      if (what !== scene) return; // la mezcla de los mapas de entorno no tiene luces
      huesos();
      info.render.frame++;
      const pinta = shadowMap.enabled && sun.castShadow && (shadowMap.autoUpdate || shadowMap.needsUpdate);
      if (pinta) {
        huesos();
        sun.shadow.updateMatrices(sun);
        pintadoCon.copy(sun.shadow.matrix);
        sun.shadow.map ??= { texture: new THREE.Texture() };
        sun.shadow.needsUpdate = shadowMap.needsUpdate = false;
      }
      imagenes.push({ pinta, leeLoPintado: sun.shadow.matrix.equals(pintadoCon), matriz: sun.shadow.matrix.clone(), pose, juego });
    }
  };
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    resolution: new AdaptiveResolution(1), instance, autoQuality: new AutoQuality(saved === null),
    culling: new FrustumCulling(), silhouette: { render() {} }, _pixelRatio: 1,
    _bakeEnvironment: () => ({ day: baked(), night: baked() })
  });
  let x = 0;
  const haciaElSol = new THREE.Vector3(-30, 80, 40);
  // Sin más, el jugador corre a 6 m/s a 60 imágenes por segundo: el sol y su caja de sombra avanzan 10 cm por
  // imagen. `salto` lo lleva lejos de una imagen a otra, `sol` cambia la hora (hacia dónde queda el sol) y `giro`
  // da vuelta a la cámara a su alrededor. El dibujo no recibe al jugador: el sol sigue a lo que siga la cámara.
  const imagen = ({ velocidad = 6, espera = 1 / 60, salto = 0, sol = null, giro = 0 } = {}) => {
    juego++;
    reloj += espera * 1000;
    x += velocidad * espera + salto;
    if (sol) haciaElSol.set(...sol);
    sun.target.position.set(x, 0, 0);
    sun.position.copy(haciaElSol).add(sun.target.position);
    camera.position.set(x - 5 * Math.cos(giro), 2, 5 * Math.sin(giro));
    camera.lookAt(x, 1.5, 0);
    renderer.render(scene, camera, null, [sun]);
    return imagenes.at(-1);
  };
  const pintadas = n => { let total = 0; for (let i = 0; i < n; i++) if (imagen().pinta) total++; return total; };
  return { renderer, instance, shadowMap, sun, scene, camera, imagenes, imagen, pintadas };
}

test('en media la sombra se pinta en 5 de 10 imágenes, en alta en todas, y baja no tiene sombras', () => {
  const { renderer, shadowMap, imagenes, pintadas } = partida();
  renderer.setQuality('media');
  assert.equal(pintadas(10), 5);
  assert.deepEqual(imagenes.map(i => i.pinta), [true, false, true, false, true, false, true, false, true, false]);
  assert.equal(shadowMap.autoUpdate, true, 'fuera del dibujo el mapa sigue en automático');
  renderer.setQuality('alta');
  assert.equal(pintadas(10), 10);
  assert.equal(shadowMap.autoUpdate, true);
  renderer.setQuality('baja');
  assert.equal(shadowMap.enabled, false);
  assert.equal(pintadas(10), 0);
  assert.equal(GRAPHICS_PROFILES.baja.shadowSize, 0);
  assert.deepEqual([GRAPHICS_PROFILES.media.shadowEvery, GRAPHICS_PROFILES.alta.shadowEvery], [2, 1]);
});

test('al cambiar de calidad la imagen siguiente pinta la sombra, aunque le tocara saltársela', async () => {
  const { renderer, imagen, pintadas } = partida();
  renderer.setQuality('media');
  pintadas(3);
  renderer.setQuality('alta');
  assert.equal(imagen().pinta, true);
  renderer.setQuality('media');
  assert.deepEqual([imagen().pinta, imagen().pinta, imagen().pinta], [true, false, true]);

  // La subida automática de baja a media también la pide.
  const auto = partida();
  auto.renderer.setQuality('baja');
  assert.equal(auto.pintadas(3), 0);
  auto.renderer.autoQuality.preparing = true;
  assert.equal(await auto.renderer._raiseAutoQuality(), true);
  assert.equal(auto.renderer.effectiveQuality, 'media');
  assert.deepEqual([auto.imagen().pinta, auto.imagen().pinta, auto.imagen().pinta], [true, false, true]);
});

test('lo que pide pintarla la pinta en la imagen siguiente, aunque le tocara saltársela, y la cuenta sigue desde ahí', () => {
  const { renderer, instance, shadowMap, sun, imagenes, imagen } = partida();
  renderer.setQuality('media');
  renderer.createEnvironment();
  imagen();
  // Compilar o cambiar las sombras, como `adaptResolution` al apagarlas por presión.
  shadowMap.needsUpdate = true;
  imagen(); imagen(); imagen();
  // `SceneManager.setQuality` desecha el mapa cuando la presión le cambia el tamaño y pide repintarlo.
  sun.shadow.map = null;
  sun.shadow.needsUpdate = true;
  imagen(); imagen(); imagen();
  // Un contexto perdido y recuperado deja el mapa vacío.
  instance.domElement.dispatchEvent(new Event('webglcontextrestored'));
  imagen(); imagen(); imagen();
  assert.deepEqual(imagenes.map(i => i.pinta), [true, true, false, true, true, false, true, true, false, true]);
});

test('a más de 9 m/s, como en un carro, la sombra se pinta en todas las imágenes; corriendo o girando la cámara, una sí y otra no', () => {
  const { renderer, imagenes, imagen } = partida();
  renderer.setQuality('media');
  const pinta = (n, como) => Array.from({ length: n }, () => imagen(como).pinta);
  // Un carro a 90 km/h con la cámara detrás, uno a 10 m/s y uno a 12 m/s en un equipo a 30 imágenes por segundo.
  assert.deepEqual(pinta(6, { velocidad: 25 }), [true, true, true, true, true, true]);
  assert.deepEqual(pinta(4, { velocidad: 10 }), [true, true, true, true]);
  assert.deepEqual(pinta(4, { velocidad: 12, espera: 1 / 30 }), [true, true, true, true]);
  // Al frenar vuelve a una sí y otra no, también a 30 imágenes por segundo, y quieto con la cámara girando rápido.
  assert.deepEqual(pinta(4, { velocidad: 8 }), [false, true, false, true]);
  assert.deepEqual(pinta(4, { velocidad: 6, espera: 1 / 30 }), [false, true, false, true]);
  let giro = 0;
  assert.deepEqual(Array.from({ length: 4 }, () => imagen({ velocidad: 0, giro: giro += .4 }).pinta), [false, true, false, true]);
  assert.ok(imagenes.every(i => i.leeLoPintado && i.pose === i.juego));
});

test('un salto de lugar o de hora pinta la sombra en esa imagen aunque le tocara saltársela, también tras una pausa', () => {
  const { renderer, imagenes, imagen } = partida();
  renderer.setQuality('media');
  const quieto = { velocidad: 0 };
  imagen(quieto);
  // Recuperarse o salir del arresto deja al jugador a 80 m de un cuadro a otro, sin fundido.
  imagen({ ...quieto, salto: 80 });
  imagen(quieto); imagen(quieto);
  // Pasar el tiempo voltea el sol alrededor del jugador, que no se mueve.
  imagen({ ...quieto, sol: [40, 60, -50] });
  imagen(quieto); imagen(quieto);
  // Con el juego en pausa no se dibuja: un salto hecho en diez segundos de pausa no es ir despacio.
  imagen({ ...quieto, salto: 80, espera: 10 });
  assert.deepEqual(imagenes.map(i => i.pinta), [true, true, false, true, true, false, true, true]);
});

test('sin pasada de sombra el mapa se lee con la matriz con que se pintó, aunque el sol siga al jugador', () => {
  const { renderer, imagenes, pintadas } = partida();
  renderer.setQuality('media');
  pintadas(12);
  assert.ok(imagenes.every(i => i.leeLoPintado), 'una imagen leyó el mapa anterior con la matriz de otra posición del sol');
  const pintadasEn = imagenes.filter(i => i.pinta).map(i => i.matriz);
  assert.ok(pintadasEn.every((m, i) => i === 0 || !m.equals(pintadasEn[i - 1])), 'el sol se movió entre una pintada y la otra');
});

test('sin pasada de sombra el jugador y la gente se dibujan con la pose de esa imagen, no con la de la anterior', () => {
  const { renderer, imagenes, pintadas } = partida();
  renderer.setQuality('media');
  pintadas(12);
  assert.equal(imagenes.filter(i => !i.pinta).length, 6);
  assert.deepEqual(imagenes.filter(i => i.pose !== i.juego).map(i => i.juego), [], 'imágenes dibujadas con los huesos de la anterior');
});

test('quien congela la sombra para su propio dibujo, como la foto del arresto, no la pinta ni corre la cuenta', () => {
  const { renderer, shadowMap, scene, imagenes, imagen } = partida();
  renderer.setQuality('media');
  assert.equal(imagen().pinta, true);
  const foto = new THREE.PerspectiveCamera(36, 1.6, .25, 160);
  shadowMap.autoUpdate = false;
  renderer.render(scene, foto, null, [], false);
  assert.equal(imagenes.at(-1).pinta, false);
  assert.equal(shadowMap.autoUpdate, false, 'la foto lo devuelve ella misma');
  shadowMap.autoUpdate = true;
  assert.deepEqual([imagen().pinta, imagen().pinta], [false, true], 'la cuenta sigue donde iba');
});
