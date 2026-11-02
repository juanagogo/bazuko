import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import * as THREE from 'three';
import { PhotoMode } from '../src/ui/PhotoMode.js';
import { CameraRig } from '../src/core/Camera.js';
import { Input } from '../src/core/Input.js';
import { Game } from '../src/core/game.js';
import { BuildingVisibility, createBuildingShell } from '../src/world/bogota/BuildingVisibility.js';

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attributes = {}; this.isConnected = true;
    this.hidden = false; this.disabled = false; this.listeners = {};
    const classes = new Set();
    this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) };
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
    if (name === 'hidden') this.hidden = true;
    if (name === 'id') document.elements.set(value, this);
  }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  append(...children) { this.children.push(...children); }
  focus() { document.activeElement = this; }
  click() { this.clicked = true; this.listeners.click?.(); }
  remove() { this.isConnected = false; }
  querySelectorAll() {
    return this.children.flatMap(child => typeof child === 'string' ? [] :
      [...(child.tag === 'button' && !child.disabled ? [child] : []), ...child.querySelectorAll()]);
  }
}

beforeEach(() => {
  globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {} };
  globalThis.document = {
    elements: new Map(), hidden: false, pointerLockElement: null,
    createElement: tag => new Element(tag), getElementById(id) { return this.elements.get(id); },
    addEventListener() {}, exitPointerLock() { this.pointerLockElement = null; }
  };
  document.body = new Element('body'); document.activeElement = document.body;
  document.elements.set('game-settings', new Element('div'));
  globalThis.localStorage = { getItem() { return null; }, setItem() {} };
});

function fixture() {
  const canvas = new Element('canvas');
  const game = Object.assign(Object.create(Game.prototype), {
    _running: true, _loading: false, _deathPending: false, isSleeping: false, canvas,
    menu: { isOpen: false }, creator: { isOpen: false }, inventoryUI: { isOpen: false },
    stats: { salud: 100, hambre: 64, sed: 75 }, player: { position: new THREE.Vector3(40, 0, 26), isRagdollActive: false },
    collisions: { colliders: [] }, input: new Input(), cameraRig: new CameraRig(new THREE.Scene(), canvas),
    audio: { setPaused(value) { this.paused = value; } }, radio: { setPaused(value) { this.paused = value; } }
  });
  game.cameraRig.canControl = () => game.photoMode?.active || !game.paused;
  game.photoMode = new PhotoMode(game);
  return { game, photo: game.photoMode };
}

function key(code, extra = {}) {
  return { code, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra };
}

test('modo foto pausa la partida, encuadra sin mover al jugador y restaura cámara, controles y audio', () => {
  const { game, photo } = fixture();
  const camera = game.cameraRig;
  camera.mode = 'isometric'; camera.yaw = 1.2; camera.pitch = .4; camera.distance = 7;
  const before = { position: game.player.position.toArray(), stats: { ...game.stats } };
  photo.launch.focus();
  game.input.keys.KeyW = true; game.input.pressedThisFrame.add('Mouse0');
  document.pointerLockElement = game.canvas;
  assert.equal(photo.enter(), true);
  assert.equal(game.paused, true);
  assert.equal(photo.root.hidden, false);
  assert.equal(document.body.classList.contains('is-photo-mode'), true);
  assert.equal(document.pointerLockElement, null);
  assert.equal(document.activeElement, photo.captureButton);
  assert.deepEqual(game.input.keys, {});
  assert.equal(game.input.pressedThisFrame.size, 0);
  assert.equal(game.audio.paused, true); assert.equal(game.radio.paused, true);
  assert.equal(camera.mode, 'third-person');
  game.input.keys.ArrowRight = true;
  photo.update(.1);
  assert.notEqual(camera.yaw, 1.2);
  assert.deepEqual(game.player.position.toArray(), before.position);
  assert.deepEqual(game.stats, before.stats);
  camera.zoom(200);
  photo.exit();
  assert.equal(game.paused, false);
  assert.equal(photo.root.hidden, true);
  assert.equal(document.body.classList.contains('is-photo-mode'), false);
  assert.equal(camera.mode, 'isometric'); assert.equal(camera.yaw, 1.2);
  assert.equal(camera.pitch, .4); assert.equal(camera.distance, 7);
  assert.equal(camera.camera.userData.cameraMode, 'isometric');
  assert.deepEqual(game.input.keys, {});
  assert.equal(game.audio.paused, false); assert.equal(game.radio.paused, false);
  assert.equal(document.activeElement, photo.launch);
});

test('lo que orienta dentro del mundo no sale en la foto y vuelve como estaba', () => {
  const { game, photo } = fixture();
  const beacon = { visible: true }, dealer = { visible: true }, mesa = { visible: false }, bolsa = { visible: true }, carro = { visible: false };
  Object.assign(game, { gpsBeacon: { group: beacon }, dealer: { marker: dealer }, craftingStation: { marker: mesa },
    pickups: [{ marker: bolsa }], cars: [{ marker: carro }] });
  assert.equal(photo.enter(), true);
  for (const marca of [beacon, dealer, mesa, bolsa, carro]) assert.equal(marca.visible, false);
  photo.exit();
  assert.deepEqual([beacon, dealer, mesa, bolsa, carro].map(m => m.visible), [true, true, false, true, false]);
});

test('H esconde los controles para mirar el encuadre, y el foco no se pierde', () => {
  const { photo } = fixture();
  photo.handleKey(key('KeyH'));
  assert.equal(photo.clean, undefined, 'fuera del modo foto, H no es de esta pantalla');
  photo.enter();
  photo.handleKey(key('KeyH'));
  assert.equal(photo.panel.hidden, true);
  assert.equal(photo.showButton.hidden, false);
  assert.equal(document.activeElement, photo.showButton);
  photo.handleKey(key('Tab'));
  assert.equal(document.activeElement, photo.showButton, 'con todo escondido solo queda el botón de volver a mostrar');
  photo.handleKey(key('KeyH'));
  assert.equal(photo.panel.hidden, false);
  assert.equal(photo.showButton.hidden, true);
  assert.equal(document.activeElement, photo.hideButton);
  photo.setClean(true);
  photo.exit();
  photo.enter();
  assert.equal(photo.panel.hidden, false, 'la siguiente foto empieza con los controles a la vista');
  assert.equal(document.activeElement, photo.captureButton);
});

test('foto respeta carga, menús, sueño, caída y recuperación fatal', () => {
  const changes = [game => { game._loading = true; }, game => { game.menu.isOpen = true; },
    game => { game.creator.isOpen = true; }, game => { game.inventoryUI.isOpen = true; },
    game => { game.isSleeping = true; }, game => { game._running = false; },
    game => { game.player.isRagdollActive = true; }, game => { game.stats.salud = 0; },
    game => { game._deathPending = true; }, game => { game._arrestPending = true; }];
  for (const change of changes) {
    const { game, photo } = fixture(); change(game);
    assert.equal(photo.enter(), false);
    assert.equal(photo.active, false);
  }
});

test('girar en foto revela NPC recién encuadrados sin avanzar su ruta, pose ni temporizadores', () => {
  const { game, photo } = fixture();
  const npc = { position: new THREE.Vector3(0, 0, 10), root: new THREE.Group(),
    animAcc: .14, wait: 3, routeIndex: 2, splatTimer: 5,
    update() { assert.fail('la simulación NPC debe seguir congelada'); } };
  npc.root.position.copy(npc.position);
  game.player.position.set(0, 0, 0); game.cameraRig.yaw = 0;
  game.world = { active: { npcs: [npc], update() { assert.fail('el distrito debe seguir congelado'); } } };
  photo.enter();
  assert.equal(npc.root.visible, false);
  const position = npc.position.clone(), rotation = npc.root.rotation.clone();
  game.cameraRig.yaw = Math.PI; photo.update(1 / 60);
  assert.equal(npc.root.visible, true, 'la visibilidad sigue a la nueva cámara');
  assert.deepEqual(npc.position, position); assert.ok(npc.root.rotation.equals(rotation));
  assert.equal(npc.animAcc, .14); assert.equal(npc.wait, 3);
  assert.equal(npc.routeIndex, 2); assert.equal(npc.splatTimer, 5);
  photo.exit();
  assert.equal(npc.root.visible, false, 'la cámara restaurada recalcula el descarte antes de renderizar');
});

test('foto reencuadra agresores activos sin mostrar los que siguen dentro del vehículo', () => {
  const { game, photo } = fixture();
  const actor = active => ({ active, position: new THREE.Vector3(0, 0, 10), root: new THREE.Group(),
    update() { assert.fail('foto no avanza los actores'); } });
  const driver = actor(true), thug = actor(true), hidden = actor(false);
  hidden.root.visible = false;
  game.roadRage = { preloadables: [driver] };
  game.limpieza = { preloadables: [thug, hidden] };
  game.world = { active: { npcs: [] } };
  game.player.position.set(0, 0, 0); game.cameraRig.yaw = 0;
  photo.enter();
  assert.equal(driver.root.visible, false); assert.equal(thug.root.visible, false);
  game.cameraRig.yaw = Math.PI; photo.update(1 / 60);
  assert.equal(driver.root.visible, true); assert.equal(thug.root.visible, true);
  assert.equal(hidden.root.visible, false);
  photo.exit();
});

test('entrar desde isométrica restaura edificios completos y salir recupera su representación', () => {
  const { game, photo } = fixture();
  const visibility = new BuildingVisibility(), material = new THREE.MeshStandardMaterial();
  const shell = createBuildingShell(new THREE.BoxGeometry(4, 8, 4), Array(6).fill(material), {
    x: 0, z: 0, height: 8, interiorMaterial: material
  });
  const building = visibility.register(shell), closed = visibility.buildClosedView();
  const camera = game.cameraRig.camera;
  game.player.position.set(0, 0, -5); game.cameraRig.mode = 'isometric';
  camera.userData.cameraMode = 'isometric';
  camera.position.set(0, 6, 9); camera.lookAt(new THREE.Vector3(0, 1.1, -5)); camera.updateMatrixWorld();
  for (let i = 0; i < 60; i++) visibility.update(1 / 60, game.player.position, camera);
  assert.equal(building.roofPart.opacity, 0); assert.equal(closed.visible, false);
  game.world = { active: { buildingVisibility: visibility, npcs: [] } };
  photo.enter();
  assert.equal(closed.visible, true);
  assert.equal(visibility.enabled, false);
  assert.ok(building.parts.every(part => part.opacity === 1 && !part.object.visible));
  photo.exit();
  assert.equal(visibility.enabled, true);
  assert.equal(closed.visible, false, 'ningún lote cerrado tapa la vista isométrica restaurada');
  visibility.dispose();
});

test('salir no reanuda audio si otra pausa o la pestaña oculta sigue activa', () => {
  for (const otherPause of [game => { game.menu.isOpen = true; }, () => { document.hidden = true; }]) {
    document.hidden = false;
    const { game, photo } = fixture(); photo.enter(); otherPause(game); photo.exit();
    assert.equal(game.audio.paused, true); assert.equal(game.radio.paused, true);
  }
});

test('F2 y Escape se consumen una vez; los atajos no atraviesan el modo foto', () => {
  const { photo } = fixture();
  const open = key('F2'); photo.handleKey(open);
  assert.ok(open.prevented && open.stopped && photo.active);
  photo.handleKey(key('F2', { repeat: true })); assert.equal(photo.active, true);
  for (const code of ['KeyP', 'KeyV', 'KeyR', 'KeyE', 'KeyB', 'Space', 'Enter']) {
    const event = key(code); photo.handleKey(event);
    assert.equal(event.stopped, true);
    assert.equal(event.prevented, false, 'los botones conservan su activación nativa');
  }
  const arrow = key('ArrowRight'); photo.handleKey(arrow); assert.equal(arrow.stopped, false);
  const close = key('Escape'); photo.handleKey(close);
  assert.ok(close.prevented && close.stopped && close._panelHandled);
  assert.equal(photo.active, false);
  photo.handleKey(key('F2', { target: { closest: () => true } }));
  assert.equal(photo.active, false, 'escribir en otros paneles no abre foto');
});

test('el foco recorre únicamente los controles de foto y omite el guardado ocupado', () => {
  const { photo } = fixture(); photo.enter();
  photo.closeButton.focus();
  const first = photo.root.querySelectorAll()[0];
  photo.handleKey(key('Tab')); assert.equal(document.activeElement, first);
  photo.handleKey(key('Tab', { shiftKey: true })); assert.equal(document.activeElement, photo.closeButton);
  photo.captureButton.disabled = true;
  photo.handleKey(key('Tab', { shiftKey: true }));
  assert.notEqual(document.activeElement, photo.captureButton);
});

test('guardar renderiza antes de leer PNG y crea una descarga local sin duplicarla', async t => {
  const { game, photo } = fixture(); photo.enter();
  const steps = []; let finish;
  game._renderFrame = (now, active) => { assert.equal(active, false); steps.push('render'); };
  game.canvas.toBlob = (callback, mime) => { assert.equal(mime, 'image/png'); steps.push('blob'); finish = callback; };
  t.mock.method(URL, 'createObjectURL', blob => { assert.equal(blob.type, 'image/png'); steps.push('url'); return 'blob:local-photo'; });
  t.mock.method(URL, 'revokeObjectURL', url => { assert.equal(url, 'blob:local-photo'); steps.push('revoke'); });
  t.mock.method(globalThis, 'setTimeout', callback => { callback(); });
  const result = photo.capture();
  assert.deepEqual(steps, ['render', 'blob']);
  assert.equal(photo.captureButton.disabled, true);
  assert.equal(await photo.capture(), false);
  finish(new Blob(['png'], { type: 'image/png' }));
  assert.equal(await result, true);
  const link = document.body.children.find(element => element.tag === 'a');
  assert.equal(link.clicked, true); assert.equal(link.isConnected, false);
  assert.equal(link.attributes.href, 'blob:local-photo');
  assert.match(link.attributes.download, /^Bazuko-Bogota-.+\.png$/);
  assert.deepEqual(steps, ['render', 'blob', 'url', 'revoke']);
  assert.equal(photo.busy, false); assert.equal(photo.captureButton.disabled, false);
});

test('una captura fallida permite reintentar y no crea enlaces vacíos', async () => {
  const { game, photo } = fixture();
  assert.equal(await photo.capture(), false);
  photo.enter(); game._renderFrame = () => {};
  game.canvas.toBlob = callback => callback(null);
  assert.equal(await photo.capture(), false);
  assert.equal(photo.busy, false); assert.equal(photo.captureButton.disabled, false);
  assert.match(photo.status.textContent, /Vuelva a intentarlo/);
  assert.equal(document.body.children.some(element => element.tag === 'a'), false);
});
