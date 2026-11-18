import * as THREE from 'three';
import { el } from './dom.js';

const pictures = new WeakMap();

const TODO = { base: true, techo: true, paredes: true, cama: true, fogon: true, vela: true };

/** Copia solo los nodos; geometrías, materiales y texturas siguen compartidos. */
export function cloneFinishedShelter(shelter) {
  const original = [], copied = [];
  shelter.group.traverse(node => original.push(node));
  const root = shelter.group.clone(true);
  root.traverse(node => copied.push(node));
  const nodes = new Map(original.map((node, i) => [node, copied[i]]));
  root.position.set(0, 0, 0);
  nodes.get(shelter.marker).visible = false;
  // Lo mismo que mostraría el cambuche con todo armado: piezas, patio y lo que va encima del modelo.
  for (const [node, visible] of shelter.visibles(TODO)) nodes.get(node).visible = visible;
  // La foto es de día: ni luces ni el resplandor de la noche.
  root.traverse(node => { if (node.isLight || node.userData.soloDeNoche) node.visible = false; });
  return root;
}

/** Las esquinas de la caja de cada malla que se ve (no cuentan el anillo ni las piezas que el modelo reemplaza). */
function visibleCorners(root) {
  const corners = [], box = new THREE.Box3();
  root.traverseVisible(node => {
    if (!node.isMesh) return;
    if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
    const { min, max } = box.copy(node.geometry.boundingBox);
    for (let i = 0; i < 8; i++) {
      corners.push(new THREE.Vector3(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z).applyMatrix4(node.matrixWorld));
    }
  });
  return corners;
}

async function takePicture(game) {
  await game.cambuche.preloadModel();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14110C');
  scene.environment = game.sceneMgr.scene.environment;
  scene.environmentIntensity = .7;
  const model = cloneFinishedShelter(game.cambuche);
  scene.add(model, new THREE.HemisphereLight(0xe3efff, 0x74624a, 2));
  const light = new THREE.DirectionalLight(0xffe6c4, 3);
  light.position.set(-3, 6, 5); scene.add(light);
  model.updateMatrixWorld(true);
  const corners = visibleCorners(model), bounds = new THREE.Box3().setFromPoints(corners);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
  const camera = new THREE.PerspectiveCamera(35, 16 / 9, .05, 100);
  // Desde arriba y de frente: el techo y el patio cuentan cómo va a quedar.
  const direction = new THREE.Vector3(3, 2.7, 5).normalize(), point = new THREE.Vector3();
  let distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  // Se acerca hasta que lo que se ve llene el cuadro, con un margen.
  for (let pass = 0; pass < 4; pass++) {
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    let reach = 0;
    for (const corner of corners) {
      point.copy(corner).project(camera);
      reach = Math.max(reach, Math.abs(point.x), Math.abs(point.y));
    }
    distance *= Math.max(.5, reach / .92);
  }
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);

  // Una sola foto con el renderer existente: sin otro contexto WebGL ni animación permanente.
  const renderer = game.renderer.instance;
  const target = new THREE.WebGLRenderTarget(768, 432, { depthBuffer: true });
  target.texture.colorSpace = THREE.SRGBColorSpace;
  const previous = renderer.getRenderTarget(), viewport = renderer.getViewport(new THREE.Vector4());
  const scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
  const autoClear = renderer.autoClear;
  const pixels = new Uint8Array(768 * 432 * 4);
  try {
    renderer.autoClear = true;
    renderer.setRenderTarget(target); renderer.setScissorTest(false);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, 768, 432, pixels);
  } finally {
    renderer.setRenderTarget(previous);
    renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
    renderer.autoClear = autoClear;
    target.dispose();
    // No liberar los recursos compartidos del modelo usado por la ciudad.
    scene.clear();
  }
  const canvas = document.createElement('canvas');
  canvas.width = 768; canvas.height = 432;
  const ctx = canvas.getContext('2d'), frame = ctx.createImageData(768, 432);
  for (let y = 0; y < 432; y++) frame.data.set(pixels.subarray((431 - y) * 768 * 4, (432 - y) * 768 * 4), y * 768 * 4);
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/png');
}

export function shelterPreview(game) {
  const image = el('img', { alt: 'Vista previa del cambuche terminado, con el techo en capas, el patio y todas las mejoras', width: 768, height: 432, hidden: true });
  const status = el('p', { class: 'shelter-preview__status', text: 'Preparando vista previa…', role: 'status' });
  const figure = el('figure', { class: 'shelter-preview' }, image, status,
    el('figcaption', { text: 'Así va a quedar mi cambuche' }));
  if (!pictures.has(game)) {
    pictures.set(game, takePicture(game).catch(error => { pictures.delete(game); throw error; }));
  }
  pictures.get(game).then(src => { image.src = src; image.hidden = false; status.remove(); })
    .catch(() => { status.textContent = 'No se pudo mostrar la vista previa. Se puede seguir armando.'; });
  return figure;
}
