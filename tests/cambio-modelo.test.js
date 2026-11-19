import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as THREE from 'three';
import { Game } from '../src/core/game.js';
import { Player } from '../src/entities/Player.js';

function partida(t) {
  const player = new Player(new THREE.Scene(), {});
  const game = Object.assign(Object.create(Game.prototype), { player });
  const avisos = [], guardados = [];
  const valores = new Map([['bazuko.modelo', 'procedural']]);
  globalThis.localStorage = {
    getItem: key => valores.get(key),
    setItem(key, value) { valores.set(key, value); guardados.push(value); }
  };
  globalThis.window = new EventTarget();
  window.addEventListener('toast', e => avisos.push(e.detail));
  t.after(() => player.dispose());
  return { player, game, avisos, guardados };
}

test('K conserva el cuerpo y la preferencia si falla una descarga y reintenta el recurso al volver la conexión', async t => {
  const { player, game, avisos, guardados } = partida(t);
  const origen = new URL('https://juego.test/');
  const archivos = new URL('../public/', import.meta.url);
  const catalogo = '/models/personaje/catalogo.json', cuerpo = '/models/personaje/hombre-adulto/cuerpo.gltf';
  const cuerpoNuevo = '/models/personaje/mujer-joven/cuerpo.gltf';
  const intentos = new Map(), primeraRespuesta = Promise.withResolvers();
  THREE.DefaultLoadingManager.setURLModifier(url => new URL(url, origen).href);
  t.after(() => THREE.DefaultLoadingManager.setURLModifier(undefined));
  globalThis.self ??= globalThis;
  globalThis.ProgressEvent ??= class { constructor(type, init) { Object.assign(this, { type }, init); } };
  globalThis.createImageBitmap = async () => ({ width: 4, height: 4 });
  t.mock.method(THREE.TextureLoader.prototype, 'loadAsync', async () => new THREE.Texture());
  const fetchOriginal = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url, origen);
    if (url.origin !== origen.origin) return fetchOriginal(input, options);
    const recurso = url.pathname;
    const intento = (intentos.get(recurso) ?? 0) + 1;
    intentos.set(recurso, intento);
    if (recurso === catalogo && intento === 1) return primeraRespuesta.promise;
    if (recurso === cuerpo && intento === 1) return new Response(null, { status: 503 });
    if (recurso === cuerpoNuevo && intento <= 2) return new Response(null, { status: 503 });
    return new Response(await readFile(new URL('.' + recurso, archivos)));
  });

  const cambio = game._toggleModel();
  assert.equal(localStorage.getItem('bazuko.modelo'), 'procedural');
  assert.equal(player.modelKind, 'procedural');
  assert.deepEqual(avisos, []);
  primeraRespuesta.resolve(new Response('{}', { status: 503 }));
  await cambio;
  assert.equal(avisos.at(-1).type, 'warn');
  assert.equal(intentos.get(cuerpo), undefined);
  await game._toggleModel();
  assert.equal(intentos.get(cuerpo), 1);
  assert.equal(player.character, player.procedural);
  assert.equal(localStorage.getItem('bazuko.modelo'), 'procedural');
  assert.deepEqual(guardados, []);

  await game._toggleModel();
  assert.equal(intentos.get(catalogo), 2);
  assert.equal(intentos.get(cuerpo), 2);
  assert.equal(player.modelKind, 'realista');
  assert.notEqual(player.character, player.procedural);
  assert.equal(player.character.group.parent, player.root);
  assert.deepEqual(avisos.map(a => a.type), ['warn', 'warn', 'info']);
  assert.deepEqual(guardados, ['realista']);

  // Si cambia la apariencia, incluso un realista que ya se descargó puede necesitar otra pieza.
  await game._toggleModel();
  const apariencia = { real: { sexo: 'mujer', edad: 'joven' } };
  await assert.rejects(player.setLook(apariencia));
  await game._toggleModel();
  assert.equal(avisos.at(-1).type, 'warn');
  assert.equal(player.modelKind, 'procedural');
  assert.equal(localStorage.getItem('bazuko.modelo'), 'procedural');
  await game._toggleModel();
  assert.equal(intentos.get(cuerpoNuevo), 3);
  assert.equal(player.character.look, apariencia);
  assert.equal(localStorage.getItem('bazuko.modelo'), 'realista');
});

test('varias pulsaciones de K comparten la descarga y sólo anuncian y visten la última elección', async t => {
  const { game, player, avisos, guardados } = partida(t);
  const fallida = Promise.withResolvers();
  player._realisticPromise = fallida.promise;
  const primera = game._toggleModel();
  await game._toggleModel();
  fallida.reject(new Error('Se cortó la descarga cancelada'));
  await primera;
  assert.equal(player.character, player.procedural);
  assert.deepEqual(avisos.map(a => a.type), ['info']);
  assert.deepEqual(guardados, ['procedural']);

  const carga = Promise.withResolvers();
  player._realisticPromise = carga.promise;
  const modelo = { group: new THREE.Group(), clearSleepPose: t.mock.fn() };
  const cambios = [game._toggleModel(), game._toggleModel(), game._toggleModel()];
  assert.equal(player.modelKind, 'procedural');
  carga.resolve(modelo);
  await Promise.all(cambios);
  assert.equal(player.character, modelo);
  assert.equal(modelo.clearSleepPose.mock.callCount(), 1);
  assert.deepEqual(guardados, ['procedural', 'realista']);
  assert.equal(avisos.length, 2);
});
