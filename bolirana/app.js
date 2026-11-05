import * as T from 'three';
import { embedded, hostReady, hostRequest, leaveHost } from './bridge.mjs';
const host = await hostReady;
let playerName = host?.playerName || 'Tu personaje';
let scoreSync = Promise.resolve();
import { stepBall, BALL_RADIUS } from './physics.mjs';
import {
  GRAVITY,
  BALLS,
  MAX_SECONDS,
  boardY,
  boardValues,
  launchVelocity,
  validStake,
  Match
} from '../src/features/bolirana/rules.mjs';
const $ = (id) => document.getElementById(id),
  canvas = $('game'),
  arena = canvas.parentElement;
const money = (n) => '$ ' + Math.floor(n).toLocaleString('es-CO');
let wallet = host.balance,
  level = host.level;
let mode = 'entrance',
  match = null,
  shots = 0,
  practiceScore = 0,
  activeBall = null,
  npcDue = 0,
  nextReady = 0;
let charging = false,
  power = 0,
  chargeStart = 0,
  muted = !!host?.muted,
  soundCtx,
  deadline = 0,
  ending = false;
let aim = new T.Vector3(0, boardY(-1), -1),
  pointer = new T.Vector2(0, 0.05),
  celebrationUntil = 0;
const scene = new T.Scene();
scene.background = new T.Color('#110f20');
scene.fog = new T.Fog('#161127', 19, 42);
const camera = new T.PerspectiveCamera(43, 1, 0.1, 70);
camera.position.set(0, 5.7, 10.7);
camera.lookAt(0, 2.1, -1.8);
let renderer;
try {
  renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance'
  });
} catch {
  $('toast').textContent =
    'Este navegador no pudo iniciar WebGL. Prueba con Firefox o Safari actualizado.';
  throw Error('WebGL unavailable');
}
renderer.setPixelRatio(
  Math.min(
    devicePixelRatio,
    host?.quality === 'baja' ? 1 : host?.quality === 'media' ? 1.4 : 1.7
  )
);
renderer.shadowMap.enabled = host?.quality !== 'baja';
renderer.shadowMap.type = T.PCFShadowMap;
renderer.outputColorSpace = T.SRGBColorSpace;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
scene.add(new T.HemisphereLight('#c5b8ff', '#251731', 1.3));
const sun = new T.DirectionalLight('#ffe4ae', 2.6);
sun.position.set(-4, 10, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, {
  left: -9,
  right: 9,
  top: 10,
  bottom: -10,
  far: 35
});
sun.shadow.bias = -0.0003;
scene.add(sun);
const warm = new T.PointLight('#ffb86d', 18, 18, 2);
warm.position.set(0, 7, -4);
scene.add(warm);
const mat = (color, extra = {}) =>
  new T.MeshStandardMaterial({ color, roughness: 0.72, ...extra });
const teal = mat('#e83483', { metalness: 0.35, roughness: 0.3 }),
  darkTeal = mat('#26224b', { roughness: 0.4 }),
  wood = mat('#b88c50'),
  darkWood = mat('#432b32'),
  brass = mat('#d5b060', { metalness: 0.65, roughness: 0.35 }),
  frogGreen = mat('#719b50', { metalness: 0.12, roughness: 0.35 }),
  black = mat('#111e18');
function mesh(geometry, material, x, y, z) {
  const m = new T.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  return m;
}
const box = (x, y, z, w, h, d, m) =>
  mesh(new T.BoxGeometry(w, h, d), m, x, y, z);
function sphere(x, y, z, r, m, sx = 1, sy = 1, sz = 1) {
  const v = mesh(new T.SphereGeometry(r, 24, 16), m, x, y, z);
  v.scale.set(sx, sy, sz);
  return v;
}
function label(text, color = '#f5e3b5', size = 1, background = null) {
  const c = document.createElement('canvas');
  const numeric = /^\d+$/.test(text);
  c.width = numeric ? 128 : 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, c.width, 128);
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let font = numeric ? 90 : 63;
  ctx.font = `bold ${font}px Georgia`;
  while (ctx.measureText(text).width > c.width - 24 && font > 14) {
    font--;
    ctx.font = `bold ${font}px Georgia`;
  }
  ctx.fillText(text, c.width / 2, 67);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const s = new T.Sprite(
    new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  s.scale.set(size, numeric ? size : size / 4, 1);
  scene.add(s);
  return s;
}
// Interior original: piso ajedrezado, madera, ladrillo pintado y mobiliario.
box(0, -0.12, -3, 28, 0.2, 35, mat('#343044'));
for (let x = -12; x <= 12; x += 2)
  for (let z = -17; z <= 10; z += 2)
    box(
      x,
      -0.005,
      z,
      1.98,
      0.012,
      1.98,
      mat((x + z) % 4 === 0 ? '#605465' : '#302c3d')
    );
box(0, 4, -10, 28, 8, 0.3, mat('#3b2744'));
box(0, 1.25, -9.8, 28, 2.5, 0.3, darkTeal);
for (let row = 0; row < 8; row++)
  for (let col = 0; col < 20; col++)
    box(
      -13 + col * 1.4 + (row % 2) * 0.7,
      2.7 + row * 0.55,
      -9.79,
      1.34,
      0.5,
      0.12,
      mat(row % 2 ? '#68454e' : '#4d3548')
    );
box(-9, 2, -3, 0.3, 4, 18, darkTeal);
box(9, 2, -3, 0.3, 4, 18, darkTeal);
const sign = label('EL RUMBIADERO', '#ffd78b', 8.5, '#25152f');
sign.position.set(0, 6.35, -9.5);
const sub = label('BOLIRANA  ·  MÚSICA  ·  PARCHE', '#73f5cc', 6);
sub.position.set(0, 5.55, -9.4);
for (const x of [-6.3, 6.3]) {
  box(x, 1.6, -6, 2.5, 3.2, 0.9, darkWood);
  box(x, 3.25, -6, 2.9, 0.16, 1.25, wood);
  for (let i = 0; i < 5; i++) {
    mesh(
      new T.CylinderGeometry(0.1, 0.14, 0.55, 12),
      mat(['#476b40', '#ad7740', '#a9a269'][i % 3]),
      x - 0.8 + i * 0.4,
      3.6,
      -6
    );
  }
  for (const z of [-3.5, -0.7]) {
    const seat = mesh(
      new T.CylinderGeometry(0.5, 0.5, 0.17, 24),
      wood,
      x,
      1.4,
      z
    );
    for (const dx of [-0.27, 0.27])
      for (const dz of [-0.27, 0.27])
        box(x + dx, 0.65, z + dz, 0.09, 1.3, 0.09, darkWood);
  }
  const light = mesh(
    new T.ConeGeometry(0.65, 0.45, 24, 1, true),
    darkTeal,
    x,
    6,
    -5
  );
  const bulb = sphere(
    x,
    5.83,
    -5,
    0.15,
    mat('#ffe8af', { emissive: '#ffd48b', emissiveIntensity: 2 })
  );
}
// Ambientación original inspirada en los salones de bolirana de Bogotá.
const neonPink = mat('#ff55b8', {
  emissive: '#e82a94',
  emissiveIntensity: 2.5,
  roughness: 0.3
});
const neonBlue = mat('#6868ff', {
  emissive: '#463bff',
  emissiveIntensity: 3,
  roughness: 0.3
});
const neonLime = mat('#b9f573', {
  emissive: '#72d94d',
  emissiveIntensity: 1.5
});
for (const x of [-8.7, 8.7]) {
  box(x, 6.9, -2, 0.09, 0.09, 17, neonBlue);
  box(x, 4.5, -8, 0.07, 4, 0.07, neonPink);
  const glow = new T.PointLight(x < 0 ? '#ff329d' : '#524bff', 32, 18, 2);
  glow.position.set(x * 0.7, 5, -4);
  scene.add(glow);
}
// Marquesina de bombillas cálidas sobre el muro de ladrillo.
for (let i = 0; i < 21; i++)
  for (const y of [5.9, 6.84])
    sphere(
      -4.1 + i * 0.41,
      y,
      -9.25,
      0.055,
      mat('#ffe4a0', { emissive: '#ffb52e', emissiveIntensity: 3 }),
      1,
      1,
      1
    );
for (const x of [-4.3, 4.3])
  for (let i = 0; i < 3; i++)
    sphere(
      x,
      6.15 + i * 0.24,
      -9.25,
      0.055,
      mat('#ffe4a0', { emissive: '#ffb52e', emissiveIntensity: 3 })
    );
// Mural original de rana y formas tropicales.
const muralCanvas = document.createElement('canvas');
muralCanvas.width = 512;
muralCanvas.height = 512;
const mc = muralCanvas.getContext('2d');
mc.fillStyle = '#241b38';
mc.fillRect(0, 0, 512, 512);
for (let i = 0; i < 18; i++) {
  mc.fillStyle = ['#df448d', '#4abda0', '#7565cd', '#e5b147'][i % 4];
  mc.beginPath();
  mc.ellipse(
    (i * 137) % 512,
    (i * 83) % 512,
    18 + (i % 4) * 12,
    150,
    i * 0.7,
    0,
    Math.PI * 2
  );
  mc.fill();
}
mc.fillStyle = '#122e32';
mc.beginPath();
mc.ellipse(256, 290, 138, 117, 0, 0, Math.PI * 2);
mc.fill();
for (const x of [176, 336]) {
  mc.fillStyle = '#8cd764';
  mc.beginPath();
  mc.arc(x, 190, 48, 0, Math.PI * 2);
  mc.fill();
  mc.fillStyle = '#ffe8a2';
  mc.beginPath();
  mc.arc(x, 190, 26, 0, Math.PI * 2);
  mc.fill();
  mc.fillStyle = '#202139';
  mc.beginPath();
  mc.arc(x, 190, 12, 0, Math.PI * 2);
  mc.fill();
}
mc.strokeStyle = '#e8bd6a';
mc.lineWidth = 12;
mc.beginPath();
mc.ellipse(256, 300, 74, 42, 0, 0, Math.PI);
mc.stroke();
const muralTex = new T.CanvasTexture(muralCanvas);
muralTex.colorSpace = T.SRGBColorSpace;
for (const x of [-6.6, 6.6])
  mesh(
    new T.PlaneGeometry(3.8, 3.8),
    new T.MeshStandardMaterial({ map: muralTex, roughness: 0.95 }),
    x,
    5,
    -9.58
  );
// Plantas colgantes y banderines de colores.
const leafMat = mat('#387b54');
for (let i = 0; i < 70; i++) {
  const x = -8 + (i % 14) * 1.2,
    z = -8 + Math.floor(i / 14) * 1.3;
  const leaf = mesh(
    new T.SphereGeometry(0.19, 6, 4),
    leafMat,
    x + Math.sin(i * 4) * 0.25,
    7.25 - Math.sin(i * 2) ** 2 * 0.6,
    z
  );
  leaf.scale.set(0.6, 1.8, 0.45);
  leaf.rotation.z = Math.sin(i) * 0.8;
}
for (let i = 0; i < 13; i++) {
  const flag = mesh(
    new T.ConeGeometry(0.22, 0.55, 3),
    [neonPink, neonBlue, neonLime][i % 3],
    -7 + i * 1.15,
    6.8 - Math.sin((i / 12) * Math.PI) * 0.5,
    -5.5
  );
  flag.rotation.z = Math.PI;
}

// Mueble, tablero inclinado y cajón frontal de retorno de bolas.
box(0, 0.85, -1, 3.95, 1.7, 5.65, darkTeal);
box(0, 0.45, 1.88, 3.65, 0.65, 0.15, wood);
box(0, 0.7, 1.99, 2.2, 0.5, 0.12, black);
box(0, 0.45, 2.18, 2.35, 0.1, 0.45, brass);
const brand = label('RUMBIADERO', '#efd699', 2.4);
brand.position.set(0, 1.3, 1.9);
const normal = new T.Vector3(0, 1, 0.28).normalize(),
  boardPlane = new T.Plane(normal, -2.05 / Math.sqrt(1 + 0.28 * 0.28));
const board = mesh(
  new T.BoxGeometry(3.55, 0.14, 5.5),
  wood,
  0,
  boardY(-1.25) - 0.08,
  -1.25
);
board.rotation.x = Math.atan(0.28);
for (const x of [-1.9, 1.9]) {
  const rail = box(x, boardY(-1.25) + 0.15, -1.25, 0.2, 0.42, 5.9, teal);
  rail.rotation.x = Math.atan(0.28);
}
box(0, boardY(-4.1) + 0.35, -4.16, 4, 0.8, 0.2, teal);
// Tiras de luz delimitan el mueble sin modificar su superficie de colisión.
for (const x of [-1.92, 1.92]) {
  const strip = box(
    x,
    boardY(-1.25) + 0.38,
    -1.25,
    0.045,
    0.045,
    5.8,
    neonLime
  );
  strip.rotation.x = Math.atan(0.28);
}
box(0, 0.19, 1.99, 3.6, 0.045, 0.05, neonPink);
const crest = label('LA BOCA MANDA · 20', '#e6cb84', 2.8);
crest.position.set(0, 4.1, -4.12);
const positions = [
  [-1.08, -3.6],
  [1.08, -3.6],
  [-1.08, -2.35],
  [1.08, -2.35],
  [-1.08, -1.1],
  [0, -1.1],
  [1.08, -1.1],
  [-1.08, 0.25],
  [0, 0.25],
  [1.08, 0.25]
];
const holes = [],
  numberLabels = [];
for (const [x, z] of positions) {
  const center = new T.Vector3(x, boardY(z) + 0.015, z),
    hole = mesh(new T.CircleGeometry(0.23, 40), black, x, center.y, z);
  hole.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), normal);
  const rim = mesh(
    new T.TorusGeometry(0.24, 0.025, 8, 40),
    brass,
    x,
    center.y + 0.015,
    z
  );
  rim.quaternion.copy(hole.quaternion);
  const n = label('0', '#fff0c9', 0.48);
  n.position.set(x, boardY(z - 0.37) + 0.1, z - 0.37);
  numberLabels.push(n);
  holes.push({ center, radius: 0.23, value: 0 });
}
const frogCenter = new T.Vector3(0, boardY(-2.55) + 0.64, -2.09);
sphere(0, frogCenter.y - 0.13, -2.7, 0.5, frogGreen, 1, 1, 1.05);
for (const x of [-0.4, 0.4]) {
  sphere(x, frogCenter.y - 0.37, -2.5, 0.25, frogGreen, 1.5, 0.65, 1.4);
  sphere(x * 0.65, frogCenter.y + 0.3, -2.55, 0.17, frogGreen);
  sphere(x * 0.65, frogCenter.y + 0.32, -2.4, 0.095, mat('#ecd89b'));
  sphere(x * 0.65, frogCenter.y + 0.32, -2.32, 0.045, black);
}
const mouth = mesh(
  new T.CircleGeometry(0.19, 40),
  black,
  0,
  frogCenter.y,
  frogCenter.z + 0.02
);
const lips = mesh(
  new T.TorusGeometry(0.205, 0.055, 12, 40),
  brass,
  0,
  frogCenter.y,
  frogCenter.z + 0.04
);
lips.scale.y = 0.85;
const frogPoints = label('20', '#f5d16f', 0.62);
frogPoints.position.set(0, frogCenter.y + 0.65, -2.5);
const reticle = mesh(
  new T.RingGeometry(0.095, 0.12, 32),
  new T.MeshBasicMaterial({
    color: '#e7e7b5',
    transparent: true,
    opacity: 0.8,
    depthTest: false
  }),
  0,
  0,
  0
);
reticle.renderOrder = 10;
const ballMat = mat('#8ce7bc', { metalness: 0.25, roughness: 0.23 }),
  redMat = mat('#dd7b5a', { metalness: 0.22, roughness: 0.27 });
const held = sphere(0.9, 1.85, 5.3, 0.24, ballMat);
const rack = [];
for (let i = 0; i < 3; i++)
  rack.push(sphere(1.65, 0.6 + i * 0.23, 3.3, 0.115, ballMat));
const ballMesh = sphere(0, -10, 0, 0.105, ballMat);
ballMesh.visible = false;
const trailGeo = new T.BufferGeometry().setFromPoints([
  new T.Vector3(),
  new T.Vector3()
]);
const trail = new T.Line(
  trailGeo,
  new T.LineDashedMaterial({
    color: '#d4d6a2',
    dashSize: 0.07,
    gapSize: 0.1,
    transparent: true,
    opacity: 0.35
  })
);
scene.add(trail);
const ray = new T.Raycaster(),
  startPos = new T.Vector3(0, 2, 5.8);
function setBoard() {
  const values = boardValues();
  holes.forEach((h, i) => {
    h.value = values[i];
    const old = numberLabels[i];
    old.material.map.dispose();
    old.material.dispose();
    scene.remove(old);
    const n = label(String(h.value), '#284836', 0.48);
    n.position.copy(old.position);
    numberLabels[i] = n;
  });
}
setBoard();

function tell(text) {
  $('toast').textContent = text;
}
function sound(kind) {
  if (muted || (embedded && host.volume <= 0)) return;
  try {
    soundCtx ??= new AudioContext();
    soundCtx.resume();
    const ctx = soundCtx,
      output = ctx.createGain();
    output.gain.value = embedded ? host.volume : 1;
    output.connect(ctx.destination);
    const t = ctx.currentTime;
    const notes =
      kind === 'rana'
        ? [523, 659, 784, 1047]
        : kind === 'score'
          ? [440, 660]
          : [180];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(),
        g = ctx.createGain();
      o.type = kind === 'miss' ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(f, t + i * 0.09);
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.09 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.4);
      o.connect(g);
      g.connect(output);
      o.start(t + i * 0.09);
      o.stop(t + i * 0.09 + 0.45);
    });
    if (kind === 'rana') {
      const n = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate),
        a = n.getChannelData(0);
      for (let i = 0; i < a.length; i++)
        a[i] =
          (Math.random() * 2 - 1) * Math.sin((i / ctx.sampleRate) * Math.PI);
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        g = ctx.createGain();
      source.buffer = n;
      filter.type = 'bandpass';
      filter.frequency.value = 1100;
      filter.Q.value = 0.8;
      g.gain.value = 0.16;
      source.connect(filter);
      filter.connect(g);
      g.connect(output);
      source.start();
    }
  } catch {}
}
$('entry-bet').append($('bet-panel'));
function enterPractice() {
  if (match?.active || activeBall) return;
  mode = 'practice';
  match = null;
  ending = false;
  practiceScore = 0;
  shots = 0;
  hud();
  tell(
    'Práctica gratis: juega sin límite y vuelve a la entrada cuando quieras.'
  );
}
function enterBetting() {
  if (match?.active || activeBall) return;
  mode = 'match';
  match = null;
  ending = false;
  hud();
  updatePayout();
}
function entrance() {
  if (match?.active) {
    tell('Abandona la partida para salir: perderás la apuesta.');
    return;
  }
  activeBall = null;
  ballMesh.visible = false;
  charging = false;
  mode = 'entrance';
  match = null;
  ending = false;
  hud();
}
function hud() {
  const choosing = mode === 'entrance' || (mode === 'match' && !match?.active);
  $('entrance').hidden = !choosing;
  document.querySelector('main').inert = choosing;
  $('entry-choices').hidden = mode !== 'entrance';
  $('entry-back').hidden = mode !== 'match';
  $('practice').hidden = true;
  $('match-tab').hidden = true;
  $('exit-venue').hidden = choosing;
  $('street-exit').hidden = choosing;
  $('toggle-instructions').hidden = choosing;

  $('player-score').textContent = String(
    match ? match.player : practiceScore
  ).padStart(2, '0');
  $('npc-score').textContent = match
    ? String(match.npc).padStart(2, '0')
    : '20';
  $('player-balls').textContent = match
    ? `${Math.max(0, 3 - match.playerBalls)} BOLAS`
    : '∞ BOLAS';
  $('npc-name').firstChild.textContent = match ? 'DON LEO ' : 'LA MESA ';
  $('level-label').textContent = match ? `NIVEL ${match.level}` : '20 MÁX.';
  $('balance').textContent = money(wallet);
  $('mode-label').textContent = match?.active
    ? `APUESTA ${money(match.stake)}`
    : mode === 'practice'
      ? 'SIN APUESTA · PRÁCTICA'
      : `RIVAL NIVEL ${level}`;
  $('turn-label').textContent = match?.active
    ? match.playerBalls < 3
      ? 'Tu turno. Hazlo contar.'
      : 'Don Leo está lanzando…'
    : 'La próxima puede ser rana.';
  $('bet-panel').hidden = mode !== 'match' || !!match?.active;
  $('practice-panel').hidden = mode !== 'practice';
  $('match-panel').hidden = !match?.active;
  $('practice').classList.toggle('selected', mode === 'practice');
  $('match-tab').classList.toggle('selected', mode === 'match');
  $('match-detail').textContent = match?.active
    ? `Apuesta comprometida: ${money(match.stake)}. ${match.playerBalls < 3 ? 'Tienes tres intentos para sumar.' : 'Observa los tres tiros del rival.'}`
    : '';
  rack.forEach(
    (b, i) =>
      (b.visible =
        !match ||
        i < 3 - (match.playerBalls < 3 ? match.playerBalls : match.npcBalls))
  );
}
function updatePayout() {
  const n = Number($('stake').value);
  $('payout').textContent = validStake(wallet, n)
    ? `Si ganas, recibes ${money(n * 2)} en total (ganancia: ${money(n)}).`
    : 'Elige un importe entero entre $1 y tu saldo.';
  $('start').disabled = !validStake(wallet, n) || !!match?.active;
}
async function end(forfeit = false) {
  if (!match?.active || ending) return;
  const result = match.finish(forfeit);
  if (!result) return;
  ending = true;
  wallet = result.balance;
  level = result.level;
  if (embedded) {
    try {
      await scoreSync;
      const state = await hostRequest('finish', { forfeit });
      wallet = state.balance;
      level = state.level;
      if (state.result) {
        result.outcome = state.result.outcome;
        match.player = state.result.player;
        match.npc = state.result.npc;
      }
    } catch (e) {
      tell(e.message);
      leaveHost();
      return;
    }
  }
  activeBall = null;
  ballMesh.visible = false;
  charging = false;
  npcDue = 0;
  const lossTaunts = [
    '¡Qué puntería tan de mierda, parce!',
    '¡Mucho güevón! La rana está allá, no en el piso.',
    '¡Lo dejaron viendo un chispero, papá!',
    '¡No joda, parce! Hasta de espaldas le ganan.',
    '¡Se lo mecatiaron, papá! Vaya practique.',
    '¡Qué visaje, parce! No le pega ni al tablero.',
    '¡Lo volvieron una nada, güevón!',
    '¡Paila, papá! Mucha bulla y nada de puntería.'
  ];
  const titles = {
    win: '¡Ganó sumercé!',
    loss: lossTaunts[Math.floor(Math.random() * lossTaunts.length)],
    tie: 'Quedaron tablas.',
    forfeit: 'Partida abandonada.'
  };
  $('result-title').textContent = titles[result.outcome];
  const net =
    result.outcome === 'win'
      ? match.stake
      : result.outcome === 'tie'
        ? 0
        : -match.stake;
  $('result-money').dataset.outcome =
    net > 0 ? 'win' : net < 0 ? 'loss' : 'tie';
  $('result-money-label').textContent =
    net > 0 ? 'GANASTE' : net < 0 ? 'PERDISTE' : 'EMPATE';
  $('result-money-amount').textContent =
    (net > 0 ? '+' : net < 0 ? '−' : '') + money(Math.abs(net));

  $('result-score').textContent =
    `${playerName} ${match.player} — Don Leo ${match.npc}`;
  $('result').showModal();
  hud();
  updatePayout();
}
function launch(point, p, who = 'player') {
  if (activeBall) return;
  const velocity = launchVelocity(startPos, point, p);
  activeBall = {
    p: startPos.clone(),
    v: new T.Vector3(velocity.x, velocity.y, velocity.z),
    age: 0,
    who,
    bounced: false
  };
  ballMesh.material = who === 'npc' ? redMat : ballMat;
  ballMesh.visible = true;
  held.visible = false;
  charging = false;
  shots++;
}
function resolve(points, rana = false) {
  if (!activeBall) return;
  const who = activeBall.who;
  activeBall = null;
  ballMesh.visible = false;
  nextReady = performance.now() + 550;
  if (match?.active) {
    match.score(who, points);
    wallet = match.balance;
    if (embedded) {
      scoreSync = scoreSync.then(() => hostRequest('score', { who, points }));
      scoreSync.catch((e) => tell(e.message));
    }
  } else practiceScore += points;
  tell(
    points
      ? `${who === 'npc' ? 'Don Leo' : '¡Bien!'} +${points} puntos${rana ? ' · ¡RANA!' : ''}`
      : 'No entró. Ajusta la puntería o la fuerza.'
  );
  sound(rana ? 'rana' : points ? 'score' : 'miss');
  if (rana) {
    $('rana').hidden = false;
    celebrationUntil = performance.now() + 1800;
  }
  hud();
  if (match?.active) {
    if (match.npcBalls === 3) end();
    else if (match.playerBalls === 3) npcDue = performance.now() + 1500;
  }
}
function physics(dt) {
  if (!activeBall) return;
  const b = activeBall,
    old = b.p.clone(),
    result = stepBall(b, dt, holes, frogCenter);
  ballMesh.position.copy(b.p);
  const travel = b.p.clone().sub(old),
    axis = new T.Vector3().crossVectors(normal, travel);
  if (axis.lengthSq() > 1e-10)
    ballMesh.rotateOnWorldAxis(axis.normalize(), travel.length() / BALL_RADIUS);
  if (result) resolve(result.points, result.rana);
}

function npcThrow() {
  if (
    !match?.active ||
    activeBall ||
    match.playerBalls < 3 ||
    match.npcBalls >= 3
  )
    return;
  const accuracy = Math.min(0.92, 0.35 + (match.level - 1) * 0.09),
    frogTry = Math.random() < Math.min(0.45, 0.08 + match.level * 0.04);
  const target = frogTry
    ? frogCenter
    : holes[Math.floor(Math.random() * holes.length)].center;
  const point = target.clone(),
    error = (1 - accuracy) * 0.9;
  point.x += (Math.random() - 0.5) * error;
  point.z += (Math.random() - 0.5) * error;
  launch(point, 0.62 + (Math.random() - 0.5) * (1 - accuracy) * 0.18, 'npc');
  npcDue = 0;
}
function canThrow() {
  return (
    (mode === 'practice' || !!match?.active) &&
    !activeBall &&
    !ending &&
    performance.now() > nextReady &&
    (!match || !match.active || match.playerBalls < 3) &&
    !$('result').open
  );
}
function pointerAim(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.set(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    (-(e.clientY - rect.top) / rect.height) * 2 + 1
  );
  ray.setFromCamera(pointer, camera);
  const frogHit = ray.intersectObject(mouth);
  if (frogHit.length) aim.copy(frogHit[0].point);
  else {
    const point = new T.Vector3();
    if (ray.ray.intersectPlane(boardPlane, point)) {
      point.x = T.MathUtils.clamp(point.x, -1.7, 1.7);
      point.z = T.MathUtils.clamp(point.z, -4.05, 1.3);
      point.y = boardY(point.z) + 0.05;
      aim.copy(point);
    }
  }
}
canvas.addEventListener('pointermove', pointerAim);
canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !canThrow()) return;
  canvas.focus({ preventScroll: true });
  pointerAim(e);
  charging = true;
  chargeStart = performance.now();
  power = 0.08;
  canvas.setPointerCapture(e.pointerId);
  soundCtx ??= new AudioContext();
  soundCtx.resume();
});
canvas.addEventListener('pointerup', (e) => {
  if (!charging) return;
  charging = false;
  if (canThrow()) launch(aim, power);
  if (canvas.hasPointerCapture(e.pointerId))
    canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointercancel', () => (charging = false));
window.addEventListener('blur', () => (charging = false));
canvas.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (!e.repeat && canThrow()) {
      charging = true;
      chargeStart = performance.now();
      power = 0.08;
    }
  }
  if (e.code.startsWith('Arrow')) {
    e.preventDefault();
    aim.x = T.MathUtils.clamp(
      aim.x +
        (e.code === 'ArrowRight' ? 0.1 : e.code === 'ArrowLeft' ? -0.1 : 0),
      -1.7,
      1.7
    );
    aim.z = T.MathUtils.clamp(
      aim.z +
        (e.code === 'ArrowDown' ? 0.12 : e.code === 'ArrowUp' ? -0.12 : 0),
      -4.05,
      1.3
    );
    aim.y = boardY(aim.z) + 0.05;
  }
});
canvas.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && charging) {
    e.preventDefault();
    charging = false;
    if (canThrow()) launch(aim, power);
  }
});
$('practice').onclick = enterPractice;
$('match-tab').onclick = enterBetting;
$('enter-practice').onclick = enterPractice;
$('enter-betting').onclick = enterBetting;
$('entry-back').onclick = entrance;
$('exit-venue').onclick = entrance;
let leaving = false;
async function leaveToStreet() {
  if (leaving) return;
  leaving = true;
  charging = false;
  await leaveHost();
}

for (const id of ['street-exit', 'entry-street', 'result-street'])
  $(id).onclick = leaveToStreet;

$('reset-practice').onclick = () => {
  if (activeBall) return;
  practiceScore = 0;
  shots = 0;
  setBoard();
  hud();
  tell('Marcador limpio. La rana sigue esperando.');
};
document.querySelectorAll('[data-percent]').forEach(
  (b) =>
    (b.onclick = () => {
      $('stake').value = Math.floor((wallet * Number(b.dataset.percent)) / 100);
      updatePayout();
    })
);
$('stake').oninput = updatePayout;
$('start').onclick = async () => {
  try {
    if (mode !== 'match' || activeBall || match?.active || $('start').disabled)
      return;
    const stake = Number($('stake').value);
    $('start').disabled = true;
    let before = wallet;
    if (embedded) {
      const state = await hostRequest('begin', { stake });
      before = state.balance + stake;
      level = state.level;
    }
    scoreSync = Promise.resolve();
    match = new Match(before, stake, level);
    wallet = match.balance;
    deadline = performance.now() + MAX_SECONDS * 1000;
    ending = false;
    hud();
    tell('Tu turno: tres bolas.');
  } catch (e) {
    tell(e.message);
    updatePayout();
  }
};

$('abandon').onclick = () => {
  if (match?.active) end(true);
};
$('result-close').onclick = () => {
  $('result').close();
  match = null;
  ending = false;
  setBoard();
  entrance();
  updatePayout();
};
$('result').addEventListener('cancel', (e) => {
  e.preventDefault();
  $('result-close').click();
});
let helpHidden = false;
try {
  helpHidden = localStorage.getItem('bazuko.bolirana.hideHelp') === 'true';
} catch {}
function updateHelp() {
  document.body.classList.toggle('instructions-hidden', helpHidden);
  $('toggle-instructions').textContent = helpHidden
    ? 'Mostrar ayuda'
    : 'Ocultar ayuda';
  $('toggle-instructions').setAttribute('aria-expanded', String(!helpHidden));
}
$('toggle-instructions').onclick = () => {
  helpHidden = !helpHidden;
  updateHelp();
  try {
    localStorage.setItem('bazuko.bolirana.hideHelp', String(helpHidden));
  } catch {}
};
updateHelp();
$('sound').onclick = () => {
  muted = !muted;
  $('sound').textContent = 'SONIDO: ' + (muted ? 'NO' : 'SÍ');
};
function resize() {
  const r = arena.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / r.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(arena);
resize();
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.06);
  last = now;
  if (charging) {
    const elapsed = (now - chargeStart) / 1100;
    power = 0.08 + 0.92 * (1 - Math.abs((elapsed % 2) - 1));
  }
  $('power-fill').style.width = (charging ? power * 100 : 0) + '%';
  $('power-text').textContent = charging
    ? Math.round(power * 100) + '% · SUELTA PARA LANZAR'
    : activeBall
      ? 'BOLA EN JUEGO'
      : 'MANTÉN PULSADO';
  const steps = Math.max(1, Math.ceil(dt / 0.008));
  for (let i = 0; i < steps; i++) physics(dt / steps);
  if (npcDue && now >= npcDue && !activeBall) npcThrow();
  if (match?.active) {
    const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
    $('timer').textContent =
      `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} PARA TERMINAR`;
    if (seconds === 0) end(true);
  } else
    $('timer').textContent =
      mode === 'practice'
        ? 'Tómate tu tiempo'
        : '3 bolas cada uno · máximo 2 minutos';
  if (celebrationUntil && now > celebrationUntil) {
    $('rana').hidden = true;
    celebrationUntil = 0;
  }
  reticle.position.copy(aim);
  reticle.position.y += 0.03;
  reticle.quaternion.copy(
    aim.z === frogCenter.z
      ? mouth.quaternion
      : new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 0, 1), normal)
  );
  const ready = canThrow();
  held.visible = ready;
  held.position.y = 1.85 + Math.sin(now * 0.002) * 0.025;
  const points = [];
  const v = launchVelocity(startPos, aim, charging ? power : 0.62);
  for (let i = 0; i < 25; i++) {
    const t = i * 0.045;
    points.push(
      new T.Vector3(
        startPos.x + v.x * t,
        startPos.y + v.y * t - 0.5 * GRAVITY * t * t,
        startPos.z + v.z * t
      )
    );
  }
  trail.geometry.dispose();
  trail.geometry = new T.BufferGeometry().setFromPoints(points);
  trail.computeLineDistances();
  trail.visible = charging && ready;
  renderer.render(scene, camera);
}
if (embedded) {
  $('sound').hidden = true;
  document.querySelector('.local-label').textContent = 'EL RUMBIADERO';
}
hud();
updatePayout();
if (embedded)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && !$('result').open) {
      e.preventDefault();
      leaveHost();
    }
  });
requestAnimationFrame(frame);
// Estado de solo lectura para comprobar la escena y los tiros.
window.bolirana = Object.freeze({
  snapshot: () => ({
    mode,
    balance: wallet,
    level,
    practiceScore,
    shots,
    inFlight: !!activeBall,
    charging,
    power,
    aim: { x: aim.x, y: aim.y, z: aim.z },
    holes: holes.map((h) => ({
      x: h.center.x,
      y: h.center.y,
      z: h.center.z,
      value: h.value
    })),
    frog: { x: frogCenter.x, y: frogCenter.y, z: frogCenter.z },
    match: match
      ? {
          player: match.player,
          npc: match.npc,
          playerBalls: match.playerBalls,
          npcBalls: match.npcBalls,
          active: match.active,
          stake: match.stake
        }
      : null
  }),
  project: (x, y, z) => {
    const p = new T.Vector3(x, y, z).project(camera),
      r = canvas.getBoundingClientRect();
    return {
      x: r.left + ((p.x + 1) / 2) * r.width,
      y: r.top + ((1 - p.y) / 2) * r.height
    };
  }
});
