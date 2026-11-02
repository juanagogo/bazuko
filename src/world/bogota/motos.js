// src/world/bogota/motos.js
// Motos parqueadas contra el andén: un lote instanciado por cada grupo de la acera, una llamada de dibujo por grupo a la vista.
// Sin marcas: moto urbana de 125 cc, la silueta que se repite en cualquier cuadra de Bogotá.
import * as THREE from 'three';
import { Batch, COLOR, addGeo, addGrid, bar, box, tube } from './carParts.js';
import { chainSunField } from './SunFieldShader.js';

export const MOTO_SIZE = Object.freeze({ length: 2, width: .72, height: 1.08 });
const MOTO_COLORS = ['#c21d1a', '#1a1c20', '#e6e6e4', '#1d3f7a', '#6d7377', '#b98a1b', '#20262c'];

// El alfa del lote dice qué es cada pieza: 1 toma el color de la moto, .3 es metal; el resto, plástico y caucho.
const PAINTED = 1, METAL = .3;
const WHITE = [1, 1, 1], SEAT = [.03, .03, .033], STEEL = [.62, .64, .66], ENGINE = [.028, .028, .03], ALU = [.14, .145, .15];

let material = null;
function motoMaterial() {
  if (material) return material;
  material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .46, metalness: .05 });
  material.name = 'Motos';
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', `vColor = color;
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb *= mix(vec3(1.), instanceColor.rgb, step(.5, color.a));
      #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        float motoMetal = step(.15, vColor.a) * (1. - step(.5, vColor.a));
        metalnessFactor = mix(metalnessFactor, .9, motoMetal);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .3, step(.15, vColor.a) * (1. - step(.5, vColor.a)));`);
  };
  material.customProgramCacheKey = () => 'motos-pintura';
  return chainSunField(material);
}

/**
 * Perfil lateral con volumen: el contorno al centro y encogido a cada lado, como un cuerpo inflado.
 * El contorno va en sentido antihorario visto desde +Z; así salen el tanque, el asiento y las tapas sin cajas.
 */
function pillow(points, halfWidth, shrink = .74) {
  const n = points.length;
  let cx = 0, cy = 0;
  for (const [x, y] of points) { cx += x; cy += y; }
  cx /= n; cy /= n;
  const position = [], index = [];
  for (const side of [1, -1]) for (const [x, y] of points) position.push(cx + (x - cx) * shrink, cy + (y - cy) * shrink, side * halfWidth);
  for (const [x, y] of points) position.push(x, y, 0);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, c = 2 * n;
    index.push(i, c + i, c + j, i, c + j, j, c + i, n + i, n + j, c + i, n + j, c + j);
  }
  for (let i = 1; i < n - 1; i++) index.push(0, i, i + 1, n, n + i + 1, n + i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

/** Guardabarros: lámina curva sobre la rueda, visible por encima y por debajo. */
function fender(b, cx, cy, radius, a0, a1, halfWidth, color, metal = 0) {
  const point = (i, j) => {
    const a = a0 + (a1 - a0) * i / 6, z = (j - 1) * halfWidth, r = radius - (j === 1 ? 0 : .018);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
  };
  addGrid(b, 6, 2, point, { color, metal, mirror: false, out: [0, 1, 0] });
  addGrid(b, 6, 2, point, { color: COLOR.dark, mirror: false, out: [0, -1, 0] });
}

function wheel(b, x, r) {
  const tire = new THREE.TorusGeometry(r - .042, .042, 4, 12);
  addGeo(b, tire, { position: [x, r, 0], color: COLOR.rubber });
  const rim = new THREE.TorusGeometry(r - .092, .012, 3, 12);
  addGeo(b, rim, { position: [x, r, 0], color: STEEL, metal: METAL });
  const hub = new THREE.CylinderGeometry(.05, .05, .1, 7);
  hub.rotateX(Math.PI / 2);
  addGeo(b, hub, { position: [x, r, 0], color: ALU, metal: METAL });
  // Tres radios cruzados: dan la rueda de alambre sin tapar lo que hay detrás.
  for (let k = 0; k < 3; k++) {
    const a = Math.PI * k / 3 + .3, s = r - .095;
    bar(b, [x - s * Math.cos(a), r - s * Math.sin(a), 0], [x + s * Math.cos(a), r + s * Math.sin(a), 0], .008, .008, { color: STEEL, metal: METAL });
  }
}

let geometry = null;
function motoGeometry() {
  if (geometry) return geometry;
  const b = new Batch(), r = .3, front = .66, rear = -.66;
  wheel(b, front, r); wheel(b, rear, r);
  fender(b, front, r, r + .035, .55, 2.5, .055, WHITE, PAINTED);
  fender(b, rear, r, r + .035, .55, 2.2, .06, COLOR.dark);

  // Tanque, asiento, colín y tapa lateral: el perfil que la hace reconocible.
  addGeo(b, pillow([[-.13, .84], [.10, .76], [.31, .75], [.37, .81], [.30, .91], [.12, .965], [-.07, .94]], .135), { color: WHITE, metal: PAINTED });
  addGeo(b, pillow([[-.72, .875], [-.62, .825], [-.10, .825], [-.05, .90], [-.07, .935], [-.35, .925], [-.62, .925]], .118, .8), { color: SEAT });
  addGeo(b, pillow([[-.87, .83], [-.72, .77], [-.44, .73], [-.44, .83], [-.74, .875]], .09), { color: WHITE, metal: PAINTED });
  addGeo(b, pillow([[-.40, .655], [-.20, .62], [-.07, .72], [-.12, .81], [-.40, .80]], .105), { color: WHITE, metal: PAINTED });
  box(b, [.05, .05, .13], [-.86, .825, 0], { color: [.6, .03, .03] });

  // Motor con cilindro inclinado y tapa de embrague; es lo que se ve bajo el tanque.
  addGeo(b, pillow([[-.18, .28], [.02, .22], [.22, .30], [.23, .49], [-.02, .54], [-.20, .46]], .125, .86), { color: ENGINE });
  addGeo(b, pillow([[.06, .50], [.20, .48], [.33, .62], [.24, .70], [.09, .63]], .075, .9), { color: ALU });
  const clutch = new THREE.CylinderGeometry(.095, .095, .03, 9);
  clutch.rotateX(Math.PI / 2);
  addGeo(b, clutch, { position: [.03, .37, -.135], color: ALU, metal: METAL });

  // Chasis: bajante, basculante, amortiguadores y cadena.
  bar(b, [.40, .86, 0], [.20, .50, 0], .05, .05, { color: COLOR.dark });
  bar(b, [-.10, .42, .08], [rear, r, .08], .03, .03, { color: COLOR.dark, mirror: true });
  bar(b, [-.52, .34, .095], [-.38, .72, .095], .026, .026, { color: STEEL, metal: METAL, mirror: true });
  bar(b, [-.06, .41, -.098], [-.60, .325, -.098], .07, .018, { color: COLOR.dark });

  // Escape: codo desde la culata y silenciador cromado hacia atrás, al lado derecho.
  tube(b, [.25, .46, .08], [.14, .25, .12], .022, 6, { color: COLOR.exhaust, metal: METAL });
  tube(b, [.14, .25, .12], [-.20, .27, .15], .022, 6, { color: COLOR.exhaust, metal: METAL });
  tube(b, [-.20, .27, .15], [-.70, .38, .15], .047, 7, { color: STEEL, metal: METAL });

  // Horquilla, faro, tablero y manubrio.
  bar(b, [front, r, .062], [.415, .93, .062], .032, .032, { color: STEEL, metal: METAL, mirror: true });
  box(b, [.09, .03, .17], [.42, .90, 0], { color: COLOR.dark });
  const head = new THREE.SphereGeometry(.085, 7, 5);
  head.scale(.85, 1, 1);
  addGeo(b, head, { position: [.51, .95, 0], color: [.82, .83, .8], metal: METAL });
  box(b, [.07, .05, .13], [.40, 1.01, 0], { color: COLOR.dark });
  bar(b, [.40, 1.02, 0], [.37, 1.06, .34], .02, .02, { color: COLOR.dark, mirror: true });
  bar(b, [.375, 1.055, .24], [.367, 1.062, .36], .033, .033, { color: COLOR.rubber, mirror: true });
  // Espejos con su vástago.
  bar(b, [.38, 1.05, .20], [.35, 1.20, .25], .009, .009, { color: COLOR.dark, mirror: true });
  const mirror = new THREE.CylinderGeometry(.052, .052, .012, 7);
  mirror.rotateZ(Math.PI / 2);
  addGeo(b, mirror, { position: [.35, 1.23, .255], color: COLOR.dark, mirror: true });

  // Gato lateral y estriberas.
  bar(b, [-.12, .28, -.11], [-.20, .01, -.21], .02, .02, { color: COLOR.dark });
  bar(b, [-.06, .28, .10], [-.06, .28, .20], .022, .022, { color: COLOR.rubber, mirror: true });

  geometry = b.toGeometry('Moto parqueada');
  return geometry;
}

/**
 * Motos parqueadas: cada posición es { x, z, rot, seed, group }; `rot` orienta el frente (+X local) como en los carros.
 * Quedan apoyadas en el gato, ladeadas a la izquierda. Devuelve un grupo con un lote instanciado por cada `group`:
 * geometría y material son los mismos, y como cada lote ocupa unos pocos metros, el que no se ve no se envía a la tarjeta.
 */
export function makeParkedMotos(placements) {
  const root = new THREE.Group(), byGroup = new Map();
  root.name = 'Motos parqueadas';
  for (const placement of placements) {
    const key = placement.group ?? 0;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(placement);
  }
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  for (const list of byGroup.values()) {
    const mesh = new THREE.InstancedMesh(motoGeometry(), motoMaterial(), list.length);
    mesh.name = 'Grupo de motos';
    mesh.castShadow = true; mesh.receiveShadow = true;
    list.forEach(({ x, z, rot, seed = 0 }, i) => {
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, rot, .0);
      dummy.rotateX(-.12);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, color.set(MOTO_COLORS[seed % MOTO_COLORS.length]));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    root.add(mesh);
  }
  // Solo es propio de cada lote lo instanciado; geometría y material siguen compartidos.
  root.dispose = () => { for (const mesh of root.children) mesh.dispose(); };
  return root;
}
