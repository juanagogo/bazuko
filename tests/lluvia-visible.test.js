import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { WeatherSystem } from '../src/world/WeatherSystem.js';
import { azarPropio } from '../src/world/bogota/concretoViaducto.js';
import { bordeDelTablero } from '../src/world/goteo.js';
import { viaductSurface } from '../src/world/bogota/ColpatriaViaduct.js';

beforeEach(() => {
  globalThis.window = new EventTarget();
});

const JUGADOR = new THREE.Vector3(112.98, 0, 97.84);

function contando(crear) {
  const delJuego = Math.random, azar = azarPropio(1234);
  let sorteos = 0;
  Math.random = () => { sorteos++; return azar(); };
  try { return { valor: crear(), sorteos: () => sorteos }; } finally { Math.random = delJuego; }
}

const farol = (x, z, giro = 0) => ({ instance: { group: { position: new THREE.Vector3(x, 0, z), rotation: { y: giro } } } });
const barrio = (props = []) => ({ props, getGroundHeight: () => 0 });

test('el clima gasta los mismos sorteos que antes al armarse, con escena y sin ella', () => {
  const escena = new THREE.Scene();
  const conEscena = contando(() => new WeatherSystem(escena));
  assert.equal(conEscena.sorteos(), 5733);
  const sinEscena = contando(() => new WeatherSystem(null));
  assert.equal(sinEscena.sorteos(), 1);
  conEscena.valor.dispose();
});

test('cada gota guarda sus cuatro sorteos de siempre en las cuatro esquinas de su cuadro', () => {
  const escena = new THREE.Scene();
  const { valor: weather } = contando(() => new WeatherSystem(escena));
  const drop = weather.rainGeometry.attributes.aDrop;
  assert.equal(drop.count, 1400 * 4);
  assert.equal(weather.rainGeometry.index.count, 1400 * 6);
  let suma = 0;
  for (let i = 0; i < drop.count; i += 4) {
    for (let k = 0; k < 4; k++) {
      suma += drop.array[i * 4 + k];
      for (let esquina = 1; esquina < 4; esquina++) assert.equal(drop.array[(i + esquina) * 4 + k], drop.array[i * 4 + k]);
    }
  }
  assert.ok(Math.abs(suma - 55998.345744) < 1e-3, `suma ${suma}`);
  assert.ok(weather.rainParticles.isMesh);
  assert.equal(weather.rainParticles.material.side, THREE.DoubleSide, 'el cuadro se ve venga de donde venga la cámara');
  weather.dispose();
});

test('las gotas que se dibujan son seis índices por gota y crecen con la calidad', () => {
  const weather = new WeatherSystem(new THREE.Scene());
  weather.setWeather('aguacero', false);
  const cuenta = {};
  for (const calidad of ['baja', 'media', 'alta']) {
    weather.setQuality(calidad);
    cuenta[calidad] = weather.rainGeometry.drawRange.count;
    assert.equal(cuenta[calidad] % 6, 0);
  }
  assert.ok(cuenta.baja < cuenta.media && cuenta.media < cuenta.alta, JSON.stringify(cuenta));
  assert.equal(cuenta.alta, Math.round(1400 * .72) * 6);
  weather.dispose();
});

test('de noche las gotas bajo los faroles más cercanos se aclaran; de día no', () => {
  const weather = new WeatherSystem(new THREE.Scene());
  weather.setWeather('aguacero', false);
  const lejos = Array.from({ length: 12 }, (_, i) => farol(200 + i * 10, 300));
  const district = barrio([...lejos, farol(115, 98)]);
  weather.update(.016, JUGADOR, district, { hour: 22, day: 1 });
  const uniforms = weather.rainParticles.material.uniforms;
  assert.ok(uniforms.uLampNight.value > .9);
  const [primero] = uniforms.uLamps.value;
  assert.ok(Math.abs(primero.x - 116.71) < 1e-6 && Math.abs(primero.y - 6.22) < 1e-6 && primero.z === 98);
  assert.equal(uniforms.uLamps.value.length, 8);
  const deNoche = weather.rippleMaterial.color.getHex();
  assert.equal(deNoche, uniforms.uColor.value.getHex(), 'el aro de noche toma el color de la lluvia, no queda blanco');
  weather.update(.016, JUGADOR, district, { hour: 12, day: 1 });
  assert.ok(uniforms.uLampNight.value < .05);
  assert.ok(weather.rippleMaterial.color.getHex() !== deNoche);
  weather.dispose();
});

test('con lluvia, update solo gasta azar cuando renace un anillo', () => {
  const weather = new WeatherSystem(new THREE.Scene());
  weather.setWeather('aguacero', false);
  const district = barrio([farol(115, 98), farol(100, 90)]);
  const delJuego = Math.random;
  let sorteos = 0, renacidos = 0;
  Math.random = () => { sorteos++; return delJuego(); };
  try {
    for (let i = 0; i < 60; i++) {
      weather.update(.05, JUGADOR, district, { hour: 22, day: 1 });
      renacidos += weather.rippleData.slice(0, weather.rippleMesh.count).filter(r => r.age === 0).length;
    }
  } finally { Math.random = delJuego; }
  assert.ok(renacidos > 0);
  assert.equal(sorteos, renacidos * 4);
  weather.dispose();
});

const seVe = (objeto) => {
  for (let o = objeto; o; o = o.parent) if (!o.visible) return false;
  return true;
};

test('las cortinas solo se ven con lluvia y en baja queda solo el anillo lejano', () => {
  const escena = new THREE.Scene();
  escena.fog = new THREE.Fog(0x8899aa, 50, 180);
  const weather = new WeatherSystem(escena);
  const cortinas = weather.rainCurtains;
  assert.ok(cortinas, 'hay cortinas');
  assert.equal(cortinas.parent, weather.rainParticles);
  assert.equal(seVe(cortinas), false);
  weather.setWeather('llovizna', false);
  assert.equal(seVe(cortinas), true);
  const uniforms = cortinas.material.uniforms;
  assert.equal(uniforms.uColor, weather.rainParticles.material.uniforms.uColor, 'comparten el color de las gotas');
  weather.update(.016, JUGADOR, barrio(), { hour: 15, day: 1 });
  assert.equal(uniforms.uFogColor.value, escena.fog.color, 'el velo lee el color de la niebla');
  assert.ok(uniforms.uRain.value > .2);

  const anillo = cortinas.geometry.attributes.aRing, indice = cortinas.geometry.index;
  weather.setQuality('baja');
  const enBaja = cortinas.geometry.drawRange.count;
  assert.equal(enBaja, 20 * 6);
  for (let i = 0; i < enBaja; i++) assert.equal(anillo.getW(indice.getX(i)), 0, 'en baja solo el anillo lejano');
  assert.equal(Math.max(...Array.from({ length: anillo.count }, (_, i) => Math.hypot(cortinas.geometry.attributes.position.getX(i), cortinas.geometry.attributes.position.getZ(i))).filter((_, i) => anillo.getW(i) === 0)).toFixed(3), '24.000');
  weather.setQuality('media');
  assert.ok(cortinas.geometry.drawRange.count >= indice.count);

  const camara = new THREE.PerspectiveCamera();
  camara.position.set(JUGADOR.x + 3, 4, JUGADOR.z + 8);
  camara.updateMatrixWorld(true);
  cortinas.onBeforeRender(null, null, camara);
  assert.deepEqual(uniforms.uCenter.value.toArray(), [camara.position.x, camara.position.z], 'cerca, rodean a la cámara');
  camara.position.set(JUGADOR.x + 12, 16, JUGADOR.z + 12);
  camara.updateMatrixWorld(true);
  cortinas.onBeforeRender(null, null, camara);
  assert.deepEqual(uniforms.uCenter.value.toArray(), [JUGADOR.x, JUGADOR.z], 'con la cámara lejos, rodean al jugador');

  weather.setWeather('nublado', false);
  assert.equal(seVe(cortinas), false);
  weather.dispose();
});

test('la corona de la salpicadura sale al nacer y se aplana a un cuarto de su vida', () => {
  const weather = new WeatherSystem(new THREE.Scene());
  weather.setWeather('aguacero', false);
  const matriz = new THREE.Matrix4(), escala = new THREE.Vector3(), lugar = new THREE.Vector3(), giro = new THREE.Quaternion();
  const anillo = weather.rippleData[0];
  anillo.age = anillo.life;
  weather.update(0, JUGADOR, barrio(), { hour: 15, day: 1 });
  assert.equal(anillo.age, 0);
  weather.rippleMesh.getMatrixAt(0, matriz);
  matriz.decompose(lugar, giro, escala);
  assert.ok(Math.abs(escala.y - 1) < 1e-6, `al nacer ${escala.y}`);
  assert.ok(escala.x < .25, 'el aro arranca pequeño');
  weather.update(anillo.life * .25, JUGADOR, barrio(), { hour: 15, day: 1 });
  weather.rippleMesh.getMatrixAt(0, matriz);
  assert.ok(Math.abs(matriz.elements[5]) < 1e-6, 'a un cuarto de su vida la corona ya está plana');
  assert.ok(Math.abs(weather.rippleMaterial.opacity - .3 * Math.min(1, weather.wetness * 1.5)) < 1e-6, 'con aguacero el aro pesa .3');
  const pos = weather.rippleGeometry.attributes.position, indice = weather.rippleGeometry.index;
  let huella = 0;
  for (let i = 0; i < indice.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => indice.getX(i + k));
    const alto = Math.max(pos.getY(a), pos.getY(b), pos.getY(c));
    if (alto === 0) continue;
    const ab = [pos.getX(b) - pos.getX(a), pos.getZ(b) - pos.getZ(a)], ac = [pos.getX(c) - pos.getX(a), pos.getZ(c) - pos.getZ(a)];
    huella += Math.abs(ab[0] * ac[1] - ab[1] * ac[0]) / 2;
  }
  assert.ok(huella < 1e-9, `lo que se levanta no deja huella al aplanarse (${huella} m²)`);
  weather.dispose();
});

test('con la cámara vista, las salpicaduras nacen delante de ella entre 2 y 12 m', () => {
  const weather = new WeatherSystem(new THREE.Scene());
  weather.setWeather('aguacero', false);
  const camara = new THREE.PerspectiveCamera();
  camara.position.set(JUGADOR.x, 4, JUGADOR.z + 9);
  camara.lookAt(JUGADOR);
  camara.updateMatrixWorld(true);
  weather.rippleMesh.onBeforeRender(null, null, camara);
  for (const anillo of weather.rippleData) anillo.age = anillo.life;
  weather.update(0, JUGADOR, barrio(), { hour: 15, day: 1 });
  for (const anillo of weather.rippleData.slice(0, weather.rippleMesh.count)) {
    const dx = anillo.x - camara.position.x, dz = anillo.z - camara.position.z;
    const lejos = Math.hypot(dx, dz);
    assert.ok(lejos >= 2 - 1e-9 && lejos <= 12 + 1e-9, `a ${lejos} m`);
    assert.ok(Math.abs(Math.atan2(dx, -dz)) <= 55 * Math.PI / 180 + 1e-9, 'dentro del sector');
  }
  weather.dispose();
});

test('el filo del viaducto gotea cerca del jugador con lluvia, sin gastar azar, y en seco no', () => {
  const borde = bordeDelTablero(60, -1);
  assert.ok(borde && viaductSurface(borde.x, borde.z) !== null, 'el punto queda sobre el tablero');
  assert.ok(viaductSurface(borde.x - .2, borde.z) === null, 'y justo afuera ya no hay tablero');
  const weather = new WeatherSystem(new THREE.Scene());
  const goteo = weather.goteo;
  assert.equal(goteo.mesh.parent, weather.rainParticles);
  const bajoElPuente = new THREE.Vector3(64, 0, 60);
  weather.update(.016, bajoElPuente, barrio(), { hour: 15, day: 1 });
  assert.equal(seVe(goteo.mesh), false);
  weather.setWeather('aguacero', false);
  const delJuego = Math.random;
  let sorteos = 0;
  Math.random = () => { sorteos++; return delJuego(); };
  try {
    goteo._reloj = 0;
    for (const anillo of weather.rippleData) anillo.age = 0;
    weather.update(.016, bajoElPuente, barrio(), { hour: 15, day: 1 });
  } finally { Math.random = delJuego; }
  assert.equal(sorteos, 0);
  assert.equal(seVe(goteo.mesh), true);
  assert.ok(goteo.mesh.count > 0 && goteo.mesh.count <= 24, `hilos: ${goteo.mesh.count}`);
  for (const punto of goteo.puntos) assert.ok(Math.hypot(punto.x - 64, punto.z - 60) <= 18);
  assert.ok(Math.abs(goteo.mesh.material.uniforms.uAlpha.value - .35 * weather.rainIntensity) < 1e-9);
  goteo._reloj = 0;
  weather.update(.016, new THREE.Vector3(200, 0, 150), barrio(), { hour: 15, day: 1 });
  assert.equal(goteo.mesh.count, 0, 'lejos del viaducto no gotea nada');
  assert.equal(goteo.mesh.visible, false);
  weather.dispose();
});
