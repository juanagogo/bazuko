// src/ui/fotoDeArresto.js
// La foto de la primera plana: el personaje de frente, tomado aparte de la calle para que se lea como persona. Dibuja
// dos veces una sola vez, con el juego ya detenido, y con una cámara propia: la del juego no se mueve ni un milímetro.
import * as THREE from 'three';

const DISTANCIA = 3.4;      // metros: se ve de cuerpo entero y con calle alrededor
const ALTURA = 1.45;        // la altura de un fotógrafo
const MIRA = 1.1;           // se apunta al pecho
const VUELTAS = [0, .6, -.6, 1.2, -1.2, 2, -2, Math.PI]; // de frente primero; si hay pared, se corre
const CLAVE = 0xff00ff;     // el color que no lleva nadie: lo que quede de ese color es lo que no es personaje
const TOLERANCIA = 60;

const _color = new THREE.Color();
const _sitio = new THREE.Vector3();

/** Dónde se para el fotógrafo: de frente al personaje, o lo más cerca de eso sin una pared en medio. */
export function sitioDeFoto(pos, yaw, collisions, salida = new THREE.Vector3()) {
  for (const giro of VUELTAS) {
    const a = yaw + giro;
    salida.set(pos.x + Math.sin(a) * DISTANCIA, pos.y + ALTURA, pos.z + Math.cos(a) * DISTANCIA);
    if (!(collisions?.mayOccludePlayer?.(salida, pos) ?? false)) return salida;
  }
  return null;
}

/** Lo que tiene el color clave se vuelve transparente. */
export function quitarClave(px, tolerancia = TOLERANCIA) {
  const [kr, kg, kb] = [px[0], px[1], px[2]]; // la esquina: nunca hay personaje ahí
  for (let i = 0; i < px.length; i += 4) {
    if (Math.abs(px[i] - kr) + Math.abs(px[i + 1] - kg) + Math.abs(px[i + 2] - kb) < tolerancia) px[i + 3] = 0;
  }
  return px;
}

function copiar(fuente, ancho, alto) {
  const c = document.createElement('canvas');
  c.width = ancho; c.height = alto;
  c.getContext('2d', { willReadFrequently: true }).drawImage(fuente, 0, 0, ancho, alto);
  return c;
}

/**
 * Dibuja en el lienzo del juego: quien la llame en pleno juego tiene que dibujar el cuadro del juego después, o lo que
 * se ve es la figura sobre fucsia. `conCalle: false` se salta la toma de la calle (el retrato no la usa).
 * @returns {{calle: HTMLCanvasElement|null, figura: HTMLCanvasElement, camara: THREE.Camera}|null} null si no hay sitio
 * para pararse: entonces la foto se queda con el último cuadro del juego.
 */
export function tomarFoto({ renderer, scene, jugador, collisions, maximo = 1280, conCalle = true }) {
  const gl = renderer?.instance, lienzo = gl?.domElement;
  if (!lienzo?.width || !jugador?.root?.visible) return null;
  const sitio = sitioDeFoto(jugador.position, jugador.root.rotation.y, collisions, _sitio);
  if (!sitio) return null;
  const k = Math.min(1, maximo / lienzo.width);
  const ancho = Math.round(lienzo.width * k), alto = Math.round(lienzo.height * k);
  const camara = new THREE.PerspectiveCamera(36, lienzo.width / lienzo.height, .25, 160);
  camara.position.copy(sitio);
  camara.lookAt(jugador.position.x, jugador.position.y + MIRA, jugador.position.z);
  camara.updateMatrixWorld(true);

  const sombras = gl.shadowMap.autoUpdate, hijos = scene.children, fondo = scene.background;
  const autoMundo = scene.matrixWorldAutoUpdate, claro = gl.getClearColor(_color).getHex(), alfa = gl.getClearAlpha();
  const autoLimpia = gl.autoClear;
  try {
    gl.shadowMap.autoUpdate = false;
    let calle = null;
    if (conCalle) {
      renderer.render(scene, camara, null, [], false);
      calle = copiar(lienzo, ancho, alto);
    }
    // Solo el personaje y sus luces, igual que la silueta: la ciudad no aporta ni un punto aquí.
    const luces = (renderer.overlayLights ?? hijos).filter((o) => o.isLight && o.visible);
    scene.children = [jugador.root, ...luces];
    scene.background = null;
    scene.matrixWorldAutoUpdate = false;
    // Los huesos con la pose de este cuadro: el retrato se toma antes del cuadro del juego, y en el primero de la
    // partida nadie los ha puesto aún en el mundo (saldría con los brazos abiertos, en la pose de fábrica).
    jugador.root.updateMatrixWorld(true);
    gl.setClearColor(CLAVE, 1);
    gl.autoClear = true;
    gl.render(scene, camara);
    const figura = copiar(lienzo, ancho, alto);
    const ctx = figura.getContext('2d');
    const img = ctx.getImageData(0, 0, ancho, alto);
    quitarClave(img.data);
    ctx.putImageData(img, 0, 0);
    return { calle, figura, camara };
  } finally {
    scene.children = hijos;
    scene.background = fondo;
    scene.matrixWorldAutoUpdate = autoMundo;
    gl.setClearColor(claro, alfa);
    gl.autoClear = autoLimpia;
    gl.shadowMap.autoUpdate = sombras;
  }
}

/** El borde mezclado con el color clave queda rosado: fuera. Sobre cartón se notaría como un contorno fucsia. */
export function quitarBorde(px) {
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] && px[i] - px[i + 1] > 45 && px[i + 2] - px[i + 1] > 45) px[i + 3] = 0;
  }
  return px;
}

/** Los límites de lo que no es transparente en unos píxeles RGBA, o null si no hay nada. */
export function limitesDeFigura(px, ancho, alto) {
  let x0 = ancho, y0 = alto, x1 = -1, y1 = -1;
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (px[(y * ancho + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, ancho: x1 - x0 + 1, alto: y1 - y0 + 1 };
}

/**
 * El retrato de la pestaña Estado: la misma toma de la plana, solo la figura, recortada a su tamaño con un margen.
 * Se toma antes de dibujar el cuadro del juego, que la tapa entera (`Game._renderFrame`). null si no hay sitio para la
 * foto o no quedó nadie.
 */
export function tomarRetrato({ renderer, scene, jugador, collisions }) {
  const foto = tomarFoto({ renderer, scene, jugador, collisions, maximo: 900, conCalle: false });
  const figura = foto?.figura;
  if (!figura) return null;
  const ctx = figura.getContext('2d');
  const img = ctx.getImageData(0, 0, figura.width, figura.height);
  quitarBorde(img.data);
  ctx.putImageData(img, 0, 0);
  const px = img.data;
  const caja = limitesDeFigura(px, figura.width, figura.height);
  if (!caja || caja.alto < 24) return null;
  const margen = Math.round(caja.alto * .06);
  const x = Math.max(0, caja.x - margen), y = Math.max(0, caja.y - margen);
  const ancho = Math.min(figura.width - x, caja.ancho + margen * 2), alto = Math.min(figura.height - y, caja.alto + margen * 2);
  const c = document.createElement('canvas');
  c.width = ancho; c.height = alto;
  c.getContext('2d').drawImage(figura, x, y, ancho, alto, 0, 0, ancho, alto);
  return c;
}
