import {evaluateApartmentInterior} from './DonorSurfaces.js';
// Fachadas de casas de Bogotá dibujadas por un solo material procedural.
// Adaptado de la idea de Slop New York (tsl-materials.js, MIT): la fachada no es una textura por edificio
// sino un shader compartido cuyas variaciones (ancho, pisos, estilo, tono, semilla) viajan como datos de vértice.
import * as THREE from 'three/webgpu';
import {attribute,uv,vec2,float,vec3,vec4,floor,fract,max,min,mix,step,smoothstep,fwidth,round,length,sin,dot,color,mx_noise_float} from 'three/tsl';
import {cityUniforms} from './GraphicsState.js';
import {filteredPulse} from './FacadeNodes.js';

export const FACADE_STYLES = Object.freeze({ladrillo:0,pintada:1,ruina:2});
export const FACADE_ATTRIBUTES = Object.freeze(['facadeParams','facadeTone']);

const PAINTS = ['#c9a46a','#b8695a','#7f9aa8','#d8c9a3','#8fa37a','#c27f4a','#a7a29a','#b58fa8','#d2b48c','#6d8c9e'];
const RUINS = ['#8c8070','#7a6e62','#9a8a6a','#6f6a60'];
const BRICKS = ['#8a4b32','#7d4430','#94553a','#6e3b2a'];

/** Tono base de una fachada según su estilo; `random()` debe ser determinista. */
export function facadeTone(style, random) {
  const list = style === 'ladrillo' ? BRICKS : style === 'ruina' ? RUINS : PAINTS;
  return new THREE.Color(list[Math.floor(random() * list.length) % list.length]);
}

/** Escribe en la geometría de una pared los datos que lee el shader de fachada. */
export function applyFacadeAttributes(geometry, { width, floors, style, seed, tone }) {
  const count = geometry.attributes.position.count, params = new Float32Array(count * 4), tones = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    params.set([width, floors, FACADE_STYLES[style] ?? 1, seed], i * 4);
    tones.set([tone.r, tone.g, tone.b], i * 3);
  }
  geometry.setAttribute('facadeParams', new THREE.BufferAttribute(params, 4));
  geometry.setAttribute('facadeTone', new THREE.BufferAttribute(tones, 3));
}

const rnd = (key, k) => fract(sin(dot(key, vec3(12.9898, 78.233, 37.719)).add(k * 19.19)).mul(43758.5453));
const pulse = (v, a, b) => filteredPulse(v, a, b, fwidth(v));
const hex = value => color(value);

function buildGraph() {
  const params = attribute('facadeParams', 'vec4'), tone = attribute('facadeTone', 'vec3');
  // La semilla se redondea: interpolada entre vértices llega con error de 1e-5 y el seno de rnd lo amplifica en ruido por píxel.
  const widthM = params.x, floors = round(params.y), style = round(params.z), seed = round(params.w);
  const coord = uv();
  const alongM = coord.x.mul(widthM), heightM = coord.y.mul(floors.mul(3));
  const floorF = heightM.div(3);
  const floorId = min(floor(floorF), floors.sub(1)), upper = step(1, floorId);
  const cols = max(1, round(widthM.div(3.2))), cx = alongM.div(widthM.div(cols));
  const cellId = min(floor(cx), cols.sub(1)), cellM = widthM.div(cols);
  const key = vec3(cellId, floorId, seed);
  const ruin = step(1.5, style), brickStyle = float(1).sub(step(.5, style)), paint = step(.5, style).mul(float(1).sub(ruin));

  // Muro: ladrillo a la vista, pintura por pisos o pañete caído que deja ver el ladrillo.
  const brickY = heightM.div(.12), brickRow = floor(brickY), brickX = alongM.div(.36).add(brickRow.mod(2).mul(.5));
  const brickKey = vec3(floor(brickX), brickRow, seed);
  const brickTone = mix(tone, hex('#8a4b32'), ruin);
  const brickColor = mix(hex('#5a4436'), brickTone.mul(rnd(brickKey, 1).mul(.5).add(.75)), pulse(brickX, .03, .97).mul(pulse(brickY, .07, .93)));
  const floorPaint = rnd(vec3(floorId, seed, 3), 2), repainted = step(floorPaint, .45).mul(paint);
  const repaint = vec3(rnd(vec3(floorId, seed, 5), 4), rnd(vec3(floorId, seed, 6), 5), rnd(vec3(floorId, seed, 7), 6)).mul(.5).add(.35);
  const flat = mix(tone, mix(tone, repaint, .85), repainted);
  const rubble = step(.32, mx_noise_float(vec3(alongM.mul(.4), heightM.mul(.4), seed)).mul(.5).add(.5)).mul(ruin);
  const wallBase = mix(mix(flat, brickColor, brickStyle), brickColor, rubble);
  const grime = mx_noise_float(vec3(alongM.mul(7), heightM.mul(7), seed)).mul(.07).add(1);
  const floorBand = float(1).sub(pulse(floorF.add(.04), 0, .07).mul(.25));
  const wall = wallBase.mul(grime).mul(floorBand);

  // Ventanas de los pisos altos, con marco, reja, cortina y tablas en las ruinas.
  const lit = rnd(key, 7).mul(float(1).add(ruin.mul(3))), present = upper.mul(step(.12, rnd(key, 8)));
  const ww = rnd(key, 9).mul(.2).add(.42).div(1), wh = rnd(key, 10).mul(.12).add(.42);
  const widthCell = ww.mul(1), top = float(.78);
  const inU = pulse(cx, float(.5).sub(widthCell.mul(.5)), float(.5).add(widthCell.mul(.5)));
  const inV = pulse(floorF, top.sub(wh), top);
  const windowMask = inU.mul(inV).mul(present);
  const frameU = pulse(cx, float(.5).sub(widthCell.mul(.5)).sub(.03), float(.5).add(widthCell.mul(.5)).add(.03));
  const frameV = pulse(floorF, top.sub(wh).sub(.035), top.add(.035));
  const frameMask = frameU.mul(frameV).mul(present).sub(windowMask).max(0);
  const warm = step(lit, .22), cold = step(.22, lit).mul(step(lit, .30)), white = step(.30, lit).mul(step(lit, .36));
  const dark = hex('#0d1218');
  const glass = mix(mix(mix(dark, hex('#ffb766'), warm), hex('#a9c8ff'), cold), hex('#e9fbff'), white);
  const glow = mix(mix(hex('#ff9e45').mul(warm), hex('#6f9dff'), cold), hex('#c9ecff'), white).mul(max(max(warm, cold), white));
  const wu = cx.sub(cellId).sub(float(.5).sub(widthCell.mul(.5))).div(widthCell), wv = floorF.sub(floorId).sub(top.sub(wh)).div(wh);
  const bars = max(3, round(widthCell.mul(cellM).mul(3.1)));
  const barFade = float(1).sub(smoothstep(.12, .45, max(fwidth(wu.mul(bars)), fwidth(wv.mul(2)))));
  const barMask = max(pulse(wu.mul(bars), .9, 1), pulse(wv.mul(2), .9, 1)).mul(barFade).mul(windowMask).mul(float(1).sub(ruin.mul(step(rnd(key, 11), .55))));
  const curtained = step(rnd(key, 12), .6).mul(max(max(warm, cold), white));
  const curtainColor = mix(mix(hex('#7a2c2c'), hex('#2c4d7a'), step(.33, rnd(key, 13))), hex('#3b2a55'), step(.66, rnd(key, 13)));
  const curtain = pulse(cx, float(.5).sub(widthCell.mul(.5)), float(.5).sub(widthCell.mul(.5)).add(widthCell.mul(rnd(key, 14).mul(.3).add(.3)))).mul(curtained).mul(windowMask);
  const boarded = ruin.mul(step(rnd(key, 15), .55)).mul(windowMask);
  const plank = mix(mix(hex('#6b5a40'), hex('#5a4a33'), step(.33, rnd(vec3(floor(wv.mul(4)), cellId, seed), 16))), hex('#7a684a'), step(.66, rnd(vec3(floor(wv.mul(4)), cellId, seed), 16)));
  const frameColor = mix(hex('#2a2a2a'), hex('#e8e3d6'), brickStyle);
  const room=evaluateApartmentInterior(alongM,heightM,vec2(wu,wv),vec2(cellId,floorId),cellM,float(3),seed,float(.72),float(.36),vec2(fwidth(cx),fwidth(floorF)));
  const roomGlass=mix(room.rgb,glass,.14);
  const windowColor = mix(roomGlass, plank, boarded).mul(float(1).sub(barMask.mul(.8)));
  const windowGlow = room.rgb.mul(room.a).mul(windowMask).mul(float(1).sub(boarded));

  // Planta baja: persianas metálicas con grafiti.
  const doors = max(1, round(widthM.div(4.2))), dx = alongM.div(widthM.div(doors)), doorId = floor(dx);
  const shopKey = vec3(doorId, seed, 21);
  const shutter = pulse(dx, .08, .92).mul(pulse(floorF, 0, .82)).mul(float(1).sub(upper));
  const gray = mix(mix(mix(hex('#6d7276'), hex('#5a5f63'), step(.25, rnd(shopKey, 22))), hex('#7b6f5f'), step(.5, rnd(shopKey, 22))), hex('#4b5a52'), step(.75, rnd(shopKey, 22)));
  const slats = float(1).sub(pulse(heightM.div(.17), .9, 1).mul(.3));
  const tag = mix(mix(mix(hex('#ff3b6b'), hex('#2ee6a6'), step(.33, rnd(shopKey, 23))), hex('#ffe14d'), step(.5, rnd(shopKey, 23))), hex('#59b4ff'), step(.75, rnd(shopKey, 23)));
  const wobble = mx_noise_float(vec3(alongM.mul(5), heightM.mul(5), seed)).mul(.35);
  const blob = length(vec3(fract(dx).sub(.5).div(.2), floorF.sub(.4).div(.07), 0)).add(wobble);
  const graffiti = float(1).sub(smoothstep(.65, 1, blob)).mul(step(rnd(shopKey, 24), mix(float(.75), float(1), ruin))).mul(shutter);

  let surface = mix(wall, frameColor, frameMask);
  surface = mix(surface, windowColor, windowMask);
  surface = mix(surface, gray.mul(slats), shutter);
  surface = mix(surface, tag, graffiti.mul(.8));
  const emissive = windowGlow.mul(cityUniforms.lightsOn).mul(1.2);
  return {
    color: vec4(surface, 1), emissive,
    roughness: mix(mix(float(.88), float(.24), windowMask), float(.55), shutter),
    metalness: mix(float(0), float(.45), shutter)
  };
}

let shared = null;

/** Material único de todas las fachadas de casas; la copia por pared del corte isométrico comparte este grafo. */
export function createCityFacadeMaterial() {
  const graph = shared ??= buildGraph();
  const material = new THREE.MeshStandardNodeMaterial();
  material.colorNode = graph.color;
  material.emissiveNode = graph.emissive;
  material.roughnessNode = graph.roughness;
  material.metalnessNode = graph.metalness;
  material.name = 'fachada de casa · TSL Bogotá';
  material.userData.cityFacade = true;
  material.userData.vertexAttributes = [...FACADE_ATTRIBUTES];
  material.userData.shaderFamily = 'bogota-city-facade';
  return material;
}
