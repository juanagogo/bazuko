// MT-09 de segunda generación, Ice Fluo 2019. Las piezas se construyen en metros y no necesitan texturas externas.
import * as THREE from 'three';
import { Batch } from './carParts.js';
import { ruedasMT09 } from './mt09Ruedas.js';
import { mecanicaMT09 } from './mt09Mecanica.js';
import { frenteMT09 } from './mt09Frente.js';
import { tanqueMT09 } from './mt09Tanque.js';
import { asientoYGuardabarrosMT09 } from './mt09Cola.js';
import { NOMBRE_MT09 } from './mt09Identidad.js';
import { crearMaterialesMT09, proyectarUV } from './mt09Acabados.js';

const piezas = [
  ['Ruedas y frenos', ruedasMT09],
  ['Motor CP3, bastidor y transmisión', mecanicaMT09],
  ['Dirección, instrumental y ópticas', frenteMT09],
  ['Depósito y tomas de aire', tanqueMT09],
  ['Asiento, colín y guardabarros', asientoYGuardabarrosMT09]
];
const acabados = [
  ['Plástico moldeado', { roughness: .56, metalness: .025 }, .24],
  ['Aleación de fundición', { roughness: .43, metalness: .65 }, .24],
  ['Caucho', { roughness: .78, metalness: 0 }, .28],
  ['Pintura satinada', { roughness: .34, metalness: .32, clearcoat: .58, clearcoatRoughness: .27 }, .045],
  ['Lentes y cristal', { roughness: .12, metalness: .22, clearcoat: .8, clearcoatRoughness: .08 }],
  ['LED delanteros', { roughness: .21, emissive: 0xc9def2, emissiveIntensity: .75 }],
  ['LED trasero', { roughness: .24, emissive: 0xae0809, emissiveIntensity: .55 }],
  ['Vinilo de asiento', { roughness: .76, metalness: 0, sheen: .07, sheenColor: 0x93969b, sheenRoughness: .82 }, .29, true],
  ['Policarbonato óptico', { transparent: true, opacity: .15, depthWrite: false, roughness: .09, metalness: .06,
    clearcoat: 1, clearcoatRoughness: .07 }],
  ['Metal pulido', { roughness: .20, metalness: .88 }],
  ['Acero del escape', { roughness: .33, metalness: .83 }, .09],
  ['Acero de fricción', { roughness: .28, metalness: .86 }, .08]
];
let materiales, geometriaCompleta, geometriasPorPieza;

function indiceAcabado(marca) {
  if (marca === .33) return 11;
  if (marca === .32) return 10;
  if (marca === .31) return 9;
  if (marca === .065) return 8;
  if (marca === .018) return 7;
  if (marca === .046) return 6;
  if (marca === .045) return 5;
  if (marca === .04) return 4;
  if (marca >= .5) return 3;
  if (marca >= .15) return 1;
  if (marca >= .075) return 2;
  return 0;
}

function geometria(nombre, componentes) {
  const b = new Batch({ uv: false });
  for (const [, dibujar] of componentes) dibujar(b);
  const uv = proyectarUV(b);
  // El alfa del taller indica el acabado. En el modelo final el color es RGB opaco y los materiales son PBR estándar.
  const indices = acabados.map(() => []);
  for (let i = 0; i < b.I.length; i += 3) {
    const v = b.I[i];
    indices[indiceAcabado(b.C[v * 4 + 3])].push(v, b.I[i + 1], b.I[i + 2]);
  }
  const g = new THREE.BufferGeometry(), colores = new Float32Array(b.count * 3);
  for (let i = 0; i < b.count; i++) {
    colores[3 * i] = b.C[4 * i];
    colores[3 * i + 1] = b.C[4 * i + 1];
    colores[3 * i + 2] = b.C[4 * i + 2];
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colores, 3));
  g.setAttribute('uv', uv);
  const orden = b.count > 65535 ? new Uint32Array(b.I.length) : new Uint16Array(b.I.length);
  let inicio = 0;
  indices.forEach((lista, i) => {
    if (!lista.length) return;
    orden.set(lista, inicio);
    g.addGroup(inicio, lista.length, i);
    inicio += lista.length;
  });
  g.setIndex(new THREE.BufferAttribute(orden, 1));
  g.name = nombre;
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function malla(g) {
  materiales ??= crearMaterialesMT09(acabados);
  const mesh = new THREE.Mesh(g, materiales);
  mesh.name = g.name;
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

/** Vista en sala y en el mapa. Cada montaje tiene su transformación y comparte los recursos de dibujo. */
export function crearMT09() {
  geometriaCompleta ??= geometria(NOMBRE_MT09, piezas);
  return malla(geometriaCompleta);
}

/** En un editor 3D se pueden seleccionar los cinco conjuntos por separado. */
export function crearMT09PorPiezas() {
  geometriasPorPieza ??= piezas.map(pieza => geometria(pieza[0], [pieza]));
  const grupo = new THREE.Group();
  grupo.name = NOMBRE_MT09;
  grupo.add(...geometriasPorPieza.map(malla));
  return grupo;
}
