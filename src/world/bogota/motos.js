// src/world/bogota/motos.js
// Motos parqueadas contra el andén: un lote instanciado por cada grupo de la acera, una llamada de dibujo por grupo a la vista.
// Moto urbana de 250 cc sin marca, con piezas compartidas entre todos los colores. Donde se juntan varias hay
// domiciliarios: cajón térmico sin letrero sobre la parrilla y el casco colgado del manubrio.
import * as THREE from 'three';
import { Batch, COLOR, bar, box } from './carParts.js';
import { chainSunField } from './SunFieldShader.js';
import { ruedasMoto } from './motoRuedas.js';
import { mecanicaMoto } from './motoMecanica.js';
import { direccionMoto } from './motoDireccion.js';
import { carroceriaMoto } from './motoCarroceria.js';
import { llenarKitReparto } from './motoReparto.js';
import { dibujarPlacaMoto, MASCARAS, PLACAS_MOTO } from './motoPlaca.js';

export { PLACAS_MOTO };
export const MOTO_SIZE = Object.freeze({ length: 2, width: .72, height: 1.08 });
const MOTO_COLORS = ['#92222b', '#104a49', '#d1c9ac', '#214f70', '#475d41', '#aa732e', '#35333d'];
const CAJON_COLORS = ['#963f30', '#af612d', '#456849'];
const DESTENIDO = new THREE.Color('#77746c');
const PLATE = new THREE.Color('#d6b02a').toArray();

/** Azar propio (mulberry32): lo que arman las motos no gasta el del juego. */
function conAzarPropio(semilla, crear) {
  const delJuego = Math.random;
  let s = semilla >>> 0;
  Math.random = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return crear(); } finally { Math.random = delJuego; }
}

let material = null;
function motoMaterial() {
  if (material) return material;
  material = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: .46, metalness: .05, clearcoat: 1, clearcoatRoughness: .18
  });
  material.name = 'Motos';
  material.onBeforeCompile = shader => {
    // Cada moto corre sus manchas con el sitio donde queda parqueada: no hay dos iguales en la fila.
    // Los trazos que no son de la placa de la moto quedan dentro de la placa, donde no se ven.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
      varying vec3 vMotoLocal;
      varying vec3 vPiezaMoto;
      const int MOTO_PLACAS[${MASCARAS.length}] = int[](${MASCARAS.join(', ')});`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING_COLOR
        if (uv.x > 1.5) {
          int placa = int(fract(instanceColor.r * 4096.) * ${PLACAS_MOTO.length}.);
          if (((MOTO_PLACAS[placa * 6 + int(uv.y + .5)] >> int(uv.x - 1.5)) & 1) == 0) transformed.x += .01;
        }
      #endif`)
      .replace('#include <color_vertex>', `vColor = color;
      vMotoLocal = position;
      vPiezaMoto = position;
      #ifdef USE_INSTANCING
        vMotoLocal.xz += instanceMatrix[3].xz * 1.37;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor.rgb *= mix(vec3(1.), instanceColor.rgb, step(.5, color.a));
      #endif`);
    // Usada y sucia: el polvo de la calle sube desde el piso hasta medio motor y deja manchas en todo lo demás.
    // Donde hay polvo no hay brillo; caucho, sillín y plástico son mates, y solo la pintura y el metal reflejan.
    // La mancha fina se apaga cuando la moto queda lejos y ya no cabe en los píxeles: así no titila al caminar.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
      varying vec3 vMotoLocal;
      varying vec3 vPiezaMoto;
      float motoMugre = 0.;
      float motoAzar(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      float motoRuido(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3. - 2. * f);
        return mix(mix(mix(motoAzar(i), motoAzar(i + vec3(1., 0., 0.)), f.x), mix(motoAzar(i + vec3(0., 1., 0.)), motoAzar(i + vec3(1., 1., 0.)), f.x), f.y),
          mix(mix(motoAzar(i + vec3(0., 0., 1.)), motoAzar(i + vec3(1., 0., 1.)), f.x), mix(motoAzar(i + vec3(0., 1., 1.)), motoAzar(i + vec3(1., 1., 1.)), f.x), f.y), f.z);
      }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        // Filete crema y cobre que sigue el hombro del tanque y se cierra en la punta.
        if (abs(vColor.a - .9) < .005) {
          float x = vPiezaMoto.x;
          float h = vPiezaMoto.y - (.826 + .095 * x + .19 * x * x);
          float aa = max(fwidth(h), .0008);
          float costado = smoothstep(.052, .105, abs(vPiezaMoto.z));
          float orla = 1. - smoothstep(.018 - aa, .018 + aa, abs(h));
          float cobre = 1. - smoothstep(.003 - aa, .003 + aa, abs(h + .028));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.84,.73,.52), orla * costado);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.46,.24,.095), cobre * costado);
          vec2 rodilla = (vPiezaMoto.xy - vec2(-.038,.825)) / vec2(.117,.048);
          float borde = length(vec2(rodilla.x, rodilla.y + .28 * rodilla.x));
          float goma = (1. - smoothstep(.92,1.,borde)) * costado;
          float nervadura = .5 + .5 * cos(rodilla.y * 13.);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.026,.024,.021) + .015 * nervadura, goma);
        } else if (abs(vColor.a - .77) < .005) {
          vec2 tapa = vPiezaMoto.xy - vec2(-.28,.758);
          float h = tapa.y - .11 * tapa.x;
          float borde = abs(fract(h/.022 + .5) - .5) * .022;
          float aa = max(.001,fwidth(h));
          float ranuras = (1. - smoothstep(.002,.002 + aa,borde)) * (1. - smoothstep(.024,.027,abs(h)))
            * (1. - smoothstep(.081,.092,abs(tapa.x - 1.1 * h))) * smoothstep(.07,.12,abs(vPiezaMoto.z));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.021,.020,.019), ranuras);
        } else if (abs(vColor.a - .025) < .005) {
          // Pliegues transversales del vinilo, limitados al cojín y suavizados a distancia.
          float vuelta = (vPiezaMoto.x + .72) / .063;
          float paso = max(fwidth(vuelta), .012);
          float surco = (1. - smoothstep(.018, .08 + paso, abs(fract(vuelta + .5) - .5)))
            * (1. - smoothstep(.14, .55, paso)) * smoothstep(.82, .88, vPiezaMoto.y);
          diffuseColor.rgb *= 1. - .55 * surco;
        } else if (abs(vColor.a - .42) < .005) {
          vec2 lente = vec2(vPiezaMoto.z, vPiezaMoto.y - .957) / .094;
          float radio = length(lente), tallado = lente.x * 4.5;
          float ranura = cos(tallado * 6.28318) * (1. - smoothstep(.09,.5,fwidth(tallado)));
          float labio = smoothstep(.75,.98,radio), casquillo = 1. - smoothstep(.22,.28,radio);
          float bombillo = 1. - smoothstep(.12,.17,radio);
          diffuseColor.rgb *= .77 + .12 * ranura + .17 * lente.y - .40 * labio - .48 * casquillo + .96 * bombillo;
        } else if (abs(vColor.a - .34) < .005) {
          // Botella de fundición, guardapolvo y barra pulida de la horquilla telescópica.
          diffuseColor.rgb *= mix(.33, 1., step(.62,vPiezaMoto.y));
          diffuseColor.rgb *= 1. - .87 * (step(.605,vPiezaMoto.y) - step(.625,vPiezaMoto.y));
        }
        // La trama de la lona desaparece cuando el hilo ocupa menos de un píxel.
        if (abs(vColor.a - .62) < .005) {
          vec2 hebra = vec2(vPiezaMoto.x + vPiezaMoto.z, vPiezaMoto.y + .14 * vPiezaMoto.z) * 365.;
          vec2 nitidez = 1. - smoothstep(vec2(.15), vec2(.55), fwidth(hebra));
          diffuseColor.rgb *= 1. + .05 * dot(cos(hebra * 6.28318), nitidez);
        }
        float fino = mix(motoRuido(vMotoLocal * 27.), .5, smoothstep(.35, .8, length(fwidth(vMotoLocal)) * 27.));
        float mancha = motoRuido(vMotoLocal * 9.) * .65 + fino * .35;
        float polvo = 1. - smoothstep(.06, .78, vMotoLocal.y);
        float motoCaucho = step(.05, vColor.a) * (1. - step(.15, vColor.a));
        motoMugre = clamp(polvo * (.10 + .32 * mancha) + .075 * smoothstep(.5, .9, mancha), 0., .44);
        // La llanta se empolva gris y poco: bajo el farol no puede quedar del color del asfalto alumbrado.
        motoMugre *= 1. - .7 * motoCaucho;
        diffuseColor.rgb = mix(diffuseColor.rgb * (.84 + .16 * mancha), mix(vec3(.13, .11, .085), vec3(.035, .033, .03), motoCaucho), motoMugre);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        float motoMetal = step(.15, vColor.a) * (1. - step(.5, vColor.a));
        roughnessFactor = mix(mix(.79, .34, step(.5, vColor.a)), .32, motoMetal);
        if (abs(vColor.a - .04) < .004) roughnessFactor = .16;
        if (abs(vColor.a - .62) < .005) roughnessFactor = .87;
        if (abs(vColor.a - .018) < .003) roughnessFactor = .68;
        roughnessFactor = mix(roughnessFactor, .95, motoMugre * 1.5);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = mix(metalnessFactor, .65, motoMetal * (1. - motoMugre));
        if (abs(vColor.a - .42) < .005) metalnessFactor = .14;`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          float laca = step(.75, vColor.a);
          float cristal = 1. - smoothstep(.002, .005, abs(vColor.a - .04));
          material.clearcoat *= max(laca, cristal * .85) * (1. - motoMugre);
          material.clearcoatRoughness = max(material.clearcoatRoughness, .14 + .36 * motoMugre);
        #endif`);
  };
  material.customProgramCacheKey = () => 'motos-laca-cuero-lona';
  return chainSunField(material);
}

let geometry = null;
function motoGeometry() {
  if (geometry) return geometry;
  geometry = conAzarPropio(0x125CC, armarMoto);
  // El modelo anterior gastaba 38 identificadores del azar del juego la primera vez que se armaba. Este se arma con azar
  // propio y gasta esos mismos 38, para que lo que venga detrás (el tráfico) reciba las mismas tiradas que antes.
  for (let i = 0; i < 38; i++) THREE.MathUtils.generateUUID();
  return geometry;
}

function armarMoto() {
  const b = new Batch();
  ruedasMoto(b);
  mecanicaMoto(b);
  direccionMoto(b);
  carroceriaMoto(b);
  bar(b, [-.80, .80, 0], [-.925, .70, 0], .016, .11, { color: COLOR.dark });
  box(b, [.012, .125, .215], [-.93, .655, 0], { color: COLOR.dark });
  box(b, [.012, .105, .195], [-.936, .655, 0], { color: PLATE });
  dibujarPlacaMoto(b);
  return b.toGeometry('Moto parqueada');
}

let cajon = null;
function cajonGeometry() {
  if (!cajon) {
    const b = new Batch();
    llenarKitReparto(b);
    cajon = b.toGeometry('Cajón de domicilio');
  }
  return cajon;
}

/** Semilla de la moto llevada a 0..1, sin tocar el azar del juego. */
const fraccion = seed => (Math.imul((seed | 0) + 1, 0x9E3779B1) >>> 0) / 4294967296;
/** La placa de cada moto va en los bits más bajos del rojo de su color, que no se notan: el lote no lleva otro dato por moto. */
const conPlaca = (color, placa) => { color.r = (Math.floor(color.r * 4096) + (placa + .5) / PLACAS_MOTO.length) / 4096; return color; };

/**
 * Motos parqueadas: cada posición es { x, z, rot, seed, group }; `rot` orienta el frente (+X local) como en los carros.
 * Quedan apoyadas en el gato, ladeadas a la izquierda. Devuelve un grupo con un lote instanciado por cada `group`:
 * geometría y material son los mismos, y como cada lote ocupa unos pocos metros, el que no se ve no se envía a la tarjeta.
 * Las filas de tres o más, y algún par suelto, son de domiciliarios: llevan colgado un segundo lote con los cajones y los
 * cascos, que se dibuja y se descarta con el del grupo. En el juego, con sus diez grupos, eso es la mitad.
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
  // Placas por turno: en una fila no se repiten y en la ciudad dan la vuelta.
  let turno = 0;
  for (const [key, list] of byGroup) {
    const mesh = new THREE.InstancedMesh(motoGeometry(), motoMaterial(), list.length);
    mesh.name = 'Grupo de motos';
    mesh.castShadow = true; mesh.receiveShadow = true;
    list.forEach(({ x, z, rot, seed = 0 }, i) => {
      dummy.position.set(x, 0, z);
      dummy.rotation.set(0, rot, .0);
      dummy.rotateX(-.12);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      // Cada moto destiñe un poco distinto: ninguna sale de vitrina.
      mesh.setColorAt(i, conPlaca(color.set(MOTO_COLORS[seed % MOTO_COLORS.length]).lerp(DESTENIDO, .018 + .08 * fraccion(seed)), turno++ % PLACAS_MOTO.length));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    root.add(mesh);
    // En una fila de reparto una de cada tres queda sin cajón: es la del que entró a recoger o la de un vecino.
    const reparto = list.length >= 3 || key % 6 === 4;
    const cargadas = reparto ? list.map((_, i) => i).filter(i => i % 3 !== 1) : [];
    if (cargadas.length) mesh.add(conAzarPropio(0xD0A1C1 + cargadas.length, () => {
      const kit = new THREE.InstancedMesh(cajonGeometry(), motoMaterial(), cargadas.length), matrix = new THREE.Matrix4();
      kit.name = 'Cajones de domicilio';
      kit.castShadow = true; kit.receiveShadow = true;
      cargadas.forEach((i, k) => {
        const seed = list[i].seed ?? 0;
        mesh.getMatrixAt(i, matrix);
        kit.setMatrixAt(k, matrix);
        kit.setColorAt(k, color.set(CAJON_COLORS[(seed + i) % CAJON_COLORS.length]).lerp(DESTENIDO, .1 + .25 * fraccion(seed + 7)));
      });
      kit.instanceMatrix.needsUpdate = true;
      kit.instanceColor.needsUpdate = true;
      kit.computeBoundingBox(); kit.computeBoundingSphere();
      return kit;
    }));
  }
  // Solo es propio de cada lote lo instanciado; geometría y material siguen compartidos.
  root.dispose = () => { for (const mesh of root.children) { for (const kit of mesh.children) kit.dispose(); mesh.dispose(); } };
  return root;
}
