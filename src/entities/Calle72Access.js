import * as THREE from 'three';
import { canvasTexture, MeshKit, rgb } from '../world/bogota/MeshKit.js';
import { signTexture } from '../utils/signs.js';

const FRONT = new THREE.Matrix4().makeRotationY(Math.PI / 2).setPosition(-.94, 0, .38);
const SIGN_Y = 2.25;
const READER = { x: -.47, y: 1.16, z: -.065, tilt: -.19, depth: .104 };

function readerTexture(ctx, w, h) {
  ctx.fillStyle = '#222c2c';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#eee9d6';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = '800 40px system-ui, sans-serif';
  ctx.fillText('PASAJES', 25, 35);

  ctx.fillStyle = '#526c63';
  ctx.fillRect(146, 68, 82, 39);
  ctx.fillStyle = '#bddfc4';
  ctx.fillRect(161, 86, 52, 5);
  ctx.strokeStyle = '#bddfc4';
  ctx.lineWidth = 4;
  ctx.strokeRect(28, 73, 44, 31);
  for (const radius of [10, 18]) {
    ctx.beginPath();
    ctx.arc(83, 89, radius, -.8, .8);
    ctx.stroke();
  }
}

/** La placa mira a la acera oriental. El lector se recoge contra la pila y deja libre el acceso de E. */
export function addCalle72Access(group, galvanized) {
  const steel = rgb('#394c49'), trim = rgb('#222d2d'), concrete = rgb('#898783');
  const painted = rgb('#285e46'), zinc = rgb('#a1a6a3');
  const body = new MeshKit(), fixings = new MeshKit();

  body.frustum(READER.x, -.15, 0, .085, .48, .19, .44, .15, concrete, { bottom: .62 });
  body.frustum(READER.x, -.15, .085, 1.06, .25, .14, .23, .13, steel, { bottom: .62 });
  body.box(READER.x, 1.54, -.163, .09, 1.1, .085, trim, { bottom: .75 });
  body.box(READER.x, READER.y, READER.z, .46, .27, READER.depth, painted,
    { rotation: [READER.tilt, 0, 0], bottom: .70, top: 1.12 });

  // Dos ménsulas atornilladas llevan la placa elevada hasta el concreto de la pila.
  for (const x of [-.47, .44]) {
    fixings.box(x, SIGN_Y, -.09, .10, .20, .40, zinc);
    fixings.box(x, SIGN_Y - .14, -.18, .14, .14, .18, zinc);
  }
  body.box(0, SIGN_Y, .137, 1.52, .70, .10, trim, { bottom: .75, top: 1.2 });
  body.box(0, SIGN_Y, .188, 1.46, .64, .012, painted, { bottom: .85 });
  for (const x of [-.73, .73]) for (const y of [SIGN_Y - .29, SIGN_Y + .29]) {
    fixings.tube([[x, y, .188], [x, y, .205]], .022, 6, zinc);
  }

  const frame = new THREE.Mesh(body.geometry().applyMatrix4(FRONT), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .62, metalness: .12,
  }));
  frame.name = 'Bastidor del acceso al Metro en Calle 72';
  frame.castShadow = frame.receiveShadow = true;
  const anchors = new THREE.Mesh(fixings.geometry().applyMatrix4(FRONT), galvanized);
  anchors.name = 'Anclajes del acceso en la pila de Calle 72';
  anchors.castShadow = anchors.receiveShadow = true;

  const signMap = signTexture({ title: 'CALLE 72', sub: 'METRO DE BOGOTÁ - LÍNEA 1',
    bg: '#286747', fg: '#fff8df', accent: '#ffe4a0', w: 896, h: 384 });
  const signGeometry = new THREE.PlaneGeometry(1.39, .60).translate(0, SIGN_Y, .196).applyMatrix4(FRONT);
  const sign = new THREE.Mesh(signGeometry, new THREE.MeshBasicMaterial({ map: signMap }));
  sign.name = 'Rótulo del Metro en Calle 72';

  const face = READER.depth / 2 + .002;
  const screenGeometry = new THREE.PlaneGeometry(.419, .211).rotateX(READER.tilt)
    .translate(READER.x, READER.y - Math.sin(READER.tilt) * face, READER.z + Math.cos(READER.tilt) * face)
    .applyMatrix4(FRONT);
  const screen = new THREE.Mesh(screenGeometry, new THREE.MeshBasicMaterial({ map: canvasTexture(256, 128, readerTexture) }));
  screen.name = 'Lector de pasajes de Calle 72';
  group.add(frame, anchors, sign, screen);
}
