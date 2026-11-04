// src/world/bogota/vehicles.js
// Fábrica de vehículos. Toda la geometría y las texturas son compartidas por modelo (ver VehicleBody.js);
// por carro solo existen los materiales que cambian de estado: esmalte, vidrio mojado y lámparas, y el haz de quien circula.
import * as THREE from 'three';
import { radialSprite } from './textures.js';
import { getCarBody, getCarGeometry, getParkedTrim, makeWipers, wheelSeats } from './VehicleBody.js';
import { CAR_MODELS, CAR_MODEL_IDS, PRIVATE_MIX, MODEL_PAINTS, TAXI_COLOR, POLICE_COLOR } from './carModels.js';
import { getCarAtlas, plateCell, ATLAS_SIZE, ATLAS_HEIGHT } from './carAtlas.js';
import { getDetailMap } from './carDetail.js';
import { chainSunField, fadeGlowInFog } from './SunFieldShader.js';

export { PUBLIC_PLATES, PRIVATE_PLATES } from './carAtlas.js';
export { CAR_MODEL_IDS };

/**
 * Una lámpara del carro. Conserva la interfaz que el resto del juego usa con un material (emissiveIntensity o
 * color), pero es solo un valor: todas las lámparas de un carro se dibujan juntas con un uniforme por canal.
 */
export class LampChannel {
  constructor(name, base, intensity, follower = null) {
    this.name = name; this.base = new THREE.Color(base); this.color = new THREE.Color();
    this.follower = follower;
    this.emissiveIntensity = intensity;
  }
  get emissiveIntensity() { return this._intensity; }
  set emissiveIntensity(value) {
    this._intensity = value;
    this.color.copy(this.base).multiplyScalar(value);
    if (this.follower) this.follower.emissiveIntensity = value;
  }
}

// Las piezas pegadas a la chapa (faros, parrillas, stops, franjas) quedan a milímetros de ella y las cuerdas de su
// malla la cortan en las esquinas. En vez de despegarlas, se acerca solo su profundidad unos centímetros a lo largo del
// rayo de vista: no cambia dónde se dibujan y la chapa ya no las atraviesa, ni parpadean de lejos.
const DEPTH_BIAS = `{
  float biasDist = length(mvPosition.xyz);
  vec4 biasClip = projectionMatrix * vec4(mvPosition.xyz * (1. - (.045 + biasDist * .0008) / max(biasDist, .2)), 1.);
  gl_Position.z = biasClip.z / biasClip.w * gl_Position.w;
}`;

// El entorno de la ciudad es de ladrillo: reflejado tal cual tiñe capós y vidrios de naranja. Se conserva su luz y solo parte de su color.
const NEUTRAL_REFLECTION = `#include <lights_fragment_end>
  reflectedLight.indirectSpecular = mix(vec3(dot(reflectedLight.indirectSpecular, vec3(.3, .59, .11))), reflectedLight.indirectSpecular, .35);
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect = mix(vec3(dot(clearcoatSpecularIndirect, vec3(.3, .59, .11))), clearcoatSpecularIndirect, .35);
  #endif`;
const neutralReflection = material => {
  material.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', NEUTRAL_REFLECTION); };
  material.customProgramCacheKey = () => 'reflejo-neutro';
  return chainSunField(material);
};
/** El vidrio lleva también la sombra de contacto: negra, con su opacidad en el vértice y atenta a la niebla. */
const glassWithShadow = material => {
  material.onBeforeCompile = shader => {
    shader.vertexShader = `attribute float lamp;\nvarying float vShade;\n${shader.vertexShader}`
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vShade = lamp;');
    shader.fragmentShader = `varying float vShade;\n${shader.fragmentShader}`
      .replace('#include <lights_fragment_end>', NEUTRAL_REFLECTION)
      .replace('#include <fog_fragment>', `if (vShade > .5) gl_FragColor = vec4(0., 0., 0., (vShade - 1.) * min(opacity / .66, 1.));
        #include <fog_fragment>`);
  };
  material.customProgramCacheKey = () => 'vidrio-con-sombra';
  return chainSunField(material);
};

const SHARED = {};
function shared() {
  if (SHARED.ready) return SHARED;
  const atlas = getCarAtlas();
  // Molduras, cauchos, ruedas e interior: un solo material; el canal alfa del color marca qué es metal.
  const trim = SHARED.trim = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: .62, metalness: 0 });
  trim.name = 'Molduras y ruedas';
  trim.onBeforeCompile = shader => {
    // Alfa 2 o más marca una pieza pegada a la chapa; el resto del valor sigue siendo la máscara de metal.
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      if (vColor.a > 1.5) { vColor.a -= 2.; ${DEPTH_BIAS} }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix(roughnessFactor, .24, vColor.a);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix(metalnessFactor, 1., vColor.a);');
  };
  trim.customProgramCacheKey = () => 'moldura-metal-sesgo';
  chainSunField(trim);
  SHARED.beamTex = radialSprite(128, 'rgba(255,240,215,0.9)', 'rgba(255,240,215,0)');
  SHARED.beamGeo = new THREE.PlaneGeometry(8, 3.6);
  // Resplandor: se orienta a la cámara en el sombreador y se apaga cuando la lámpara no la mira.
  SHARED.flare = new THREE.ShaderMaterial({
    uniforms: { uStrength: { value: .62 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute vec2 corner; attribute float facing;
      varying vec2 vCorner; varying vec3 vTint;
      uniform float uStrength;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.);
        vec3 axis = normalize((modelViewMatrix * vec4(facing, 0., 0., 0.)).xyz);
        float look = clamp(dot(axis, normalize(-view.xyz)), 0., 1.);
        vec3 tint = facing > 0. ? vec3(1., .92, .78) : vec3(.9, .08, .05);
        vTint = tint * look * look * uStrength * (facing > 0. ? 1. : .55);
        vCorner = corner / max(abs(corner), vec2(1e-3));
        view.xy += corner * (.6 + .4 * look);
        view.z += .25;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      varying vec2 vCorner; varying vec3 vTint;
      void main() {
        float d = max(1. - length(vCorner), 0.);
        gl_FragColor = vec4(vTint * d * d, 1.);
      }`,
  });
  SHARED.flare.name = 'Resplandor de lámparas';
  SHARED.ready = true;
  return SHARED;
}

function makeLampMaterial(channels, plateOffset, routeOffset) {
  const material = new THREE.MeshStandardMaterial({ map: getCarAtlas(), vertexColors: true, roughness: .28, metalness: .05 });
  material.name = 'Lámparas y placas';
  const glow = [new THREE.Color(0, 0, 0), ...channels.map(channel => channel.color)];
  material.onBeforeCompile = shader => {
    shader.uniforms.uLamps = { value: glow };
    shader.uniforms.uPlateOffset = { value: plateOffset };
    shader.uniforms.uRouteOffset = { value: routeOffset };
    // El alfa del color lleva, sobre el 2 de las piezas pegadas a la chapa, cuánto baja la V hasta el dibujo de día de un faro.
    // Apagado, el faro es vidrio sobre ese dibujo oscuro. Con los faros (uLamps[1]) o su propia luz encendidos vuelve al de
    // siempre: la noche y la lluvia no cambian y la emisión sigue saliendo del color difuso.
    shader.vertexShader = `attribute float lamp;\nuniform vec3 uLamps[8];\nuniform vec2 uPlateOffset;\nuniform float uRouteOffset;\nvarying vec3 vLampGlow;\nvarying vec2 vDayUv;\nvarying float vDayGlass;\n${shader.vertexShader}`
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        vMapUv += (step(9.5, lamp) - step(19.5, lamp)) * uPlateOffset + step(19.5, lamp) * vec2(0., uRouteOffset);
        vLampGlow = uLamps[int(mod(lamp, 10.) + .5)];
        float dayDrop = max(color.a - 2., 0.);
        vDayUv = vMapUv - vec2(0., dayDrop);
        vDayGlass = step(.001, dayDrop) * (1. - smoothstep(.15, .5, max(vLampGlow.r, uLamps[1].r)));`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${DEPTH_BIAS}`);
    shader.fragmentShader = `varying vec3 vLampGlow;\nvarying vec2 vDayUv;\nvarying float vDayGlass;\n${shader.fragmentShader}`
      .replace('#include <map_fragment>', 'diffuseColor *= mix(texture2D(map, vMapUv), texture2D(map, vDayUv), vDayGlass);')
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, .1, vDayGlass);`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vLampGlow * diffuseColor.rgb;');
  };
  material.customProgramCacheKey = () => 'lamparas-carro-sesgo-dia';
  return chainSunField(material);
}

/**
 * Acabado según el tono: lo que da volumen a un carro es el reflejo, y cada pintura refleja distinto. El blanco es
 * sólido y mate bajo la laca, la plata es metal de verdad y el negro casi solo muestra su reflejo. Mismo material, otros valores.
 * La laca no baja de cierta rugosidad: un espejo perfecto dibuja en franjas los edificios sobre una chapa de pocos polígonos.
 */
const FINISH = {
  negro: { metalness: 0, roughness: .34, clearcoat: 1, clearcoatRoughness: .17, envMapIntensity: 1.05 },
  blanco: { metalness: 0, roughness: .48, clearcoat: .85, clearcoatRoughness: .2, envMapIntensity: .9 },
  metal: { metalness: .7, roughness: .46, clearcoat: .7, clearcoatRoughness: .2, envMapIntensity: 1.05 },
  color: { metalness: .22, roughness: .4, clearcoat: 1, clearcoatRoughness: .18, envMapIntensity: 1 },
};
const hsl = {};
function finishOf(color) {
  color.getHSL(hsl, THREE.SRGBColorSpace);
  if (hsl.l < .16 && hsl.s < .3) return FINISH.negro;
  if (hsl.s > .16) return FINISH.color;
  return hsl.l > .78 ? FINISH.blanco : FINISH.metal;
}

/** Revuelve la semilla para que modelo, color y placa no queden atados entre sí. */
const mix = seed => { let h = Math.imul(seed + 0x9e37, 0x9e3779b1); h ^= h >>> 15; h = Math.imul(h, 0x85ebca77); h ^= h >>> 13; return h >>> 0; };

function pickModel(kind, seed, h) {
  if (kind === 'buseta') return 'buseta';
  if (kind === 'police') return seed % 2 ? 'suv' : 'sedanPopular';
  if (kind === 'taxi') return h % 4 === 3 ? 'sedanPopular' : 'citadino';
  let roll = h % 100;
  for (const [id, weight] of PRIVATE_MIX) { if (roll < weight) return id; roll -= weight; }
  return 'citadino';
}

/**
 * Frente +X. Cada modelo tiene su propia huella: tráfico y colisiones leen length y width.
 * Con `parked` el carro no animará nunca sus ruedas ni sus plumillas: van unidas a las molduras y no hay piezas que girar.
 */
export function makeVehicle(kind = 'carro', seedColor = 0, { beams = true, model = null, parked = false } = {}) {
  const seed = Number.isFinite(seedColor) ? Math.abs(Math.trunc(seedColor)) : 0, h = mix(seed), s = shared();
  const modelId = model && CAR_MODELS[model] ? model : pickModel(kind, seed, h);
  const geo = getCarGeometry(modelId, kind), spec = geo.spec, body = getCarBody(modelId);
  const { L, W } = spec, isPolice = kind === 'police', isTaxi = kind === 'taxi';
  const paints = MODEL_PAINTS[modelId], color = isTaxi ? TAXI_COLOR : isPolice ? POLICE_COLOR : paints[(h >>> 7) % paints.length];

  const paint = new THREE.MeshPhysicalMaterial({ color, map: getDetailMap(spec, body), vertexColors: true });
  Object.assign(paint, finishOf(paint.color));
  paint.name = 'Esmalte';
  neutralReflection(paint);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#1d282c', metalness: .05, roughness: .1, envMapIntensity: .75,
    transparent: true, opacity: .66, depthWrite: false });
  glass.name = 'Vidrio ahumado';
  glassWithShadow(glass);

  // Direccionales, stops y patrulla: valores de este carro; nunca se enciende el vecino.
  const signalMaterials = { left: new LampChannel('Direccional left', '#ff8a24', .12), right: new LampChannel('Direccional right', '#ff8a24', .12) };
  const tailMat = { color: new THREE.Color('#ff1a12').multiplyScalar(.14), name: 'Stops' };
  const sign = new LampChannel('Capacete', '#fff1a8', .02);
  const headlightMaterial = new LampChannel('Faros', '#fff1d3', .02, sign);
  const policeLights = isPolice ? { blue: { color: new THREE.Color('#1a6cff').multiplyScalar(1.8), name: 'Azul' }, red: { color: new THREE.Color('#ff1a2a').multiplyScalar(1.8), name: 'Rojo' } } : null;
  const off = { color: new THREE.Color(0, 0, 0) };
  const [px, py] = plateCell(kind === 'carro' ? 'carro' : 'publico', (h >>> 13) % 1000);
  const plateOffset = new THREE.Vector2(px / ATLAS_SIZE, -py / ATLAS_HEIGHT);
  // Con la semilla revuelta: la cruda de las busetas es múltiplo de cuatro y siempre daba la misma ruta.
  const routeIndex = (h >>> 3) % 4, routeOffset = -(routeIndex * 64) / ATLAS_HEIGHT;
  const lamp = makeLampMaterial([headlightMaterial, tailMat, signalMaterials.left, signalMaterials.right, policeLights?.blue ?? off, policeLights?.red ?? off, sign], plateOffset, routeOffset);

  const group = new THREE.Group();
  const bodyVisual = new THREE.Mesh(geo.paint, paint);
  bodyVisual.name = 'Carrocería suspendida'; bodyVisual.castShadow = bodyVisual.receiveShadow = true;
  group.add(bodyVisual);
  const trimMesh = new THREE.Mesh(parked ? getParkedTrim(geo) : geo.trim, s.trim); trimMesh.name = 'Molduras e interior'; trimMesh.castShadow = trimMesh.receiveShadow = true;
  const lampMesh = new THREE.Mesh(geo.lamp, lamp); lampMesh.name = 'Lámparas y placas'; lampMesh.castShadow = false;
  const glassMesh = new THREE.Mesh(geo.glass, glass); glassMesh.name = 'Vidrios'; glassMesh.castShadow = false;
  // El vidrio al final del grupo: se transparenta sobre interior y conductor.
  bodyVisual.add(trimMesh, lampMesh, glassMesh);

  const wipers = parked ? [] : makeWipers(spec, body, geo.wiper, s.trim);
  for (const wiper of wipers) bodyVisual.add(wiper.parent);

  const wheels = [], frontWheelPivots = [], r = spec.r;
  if (!parked) for (const [x, z, sideZ] of wheelSeats(spec, body)) {
    const pivot = new THREE.Group(); pivot.position.set(x, r, z); pivot.name = x > 0 && x === spec.axleF ? 'Eje delantero dirigible' : 'Eje trasero';
    const wheel = new THREE.Mesh(sideZ > 0 ? geo.wheelRight : geo.wheelLeft, s.trim); wheel.name = 'Rueda'; wheel.castShadow = wheel.receiveShadow = true;
    wheel.userData.radius = r; wheel.userData.front = x === spec.axleF;
    pivot.add(wheel); group.add(pivot); wheels.push(wheel);
    if (x === spec.axleF) frontWheelPivots.push(pivot);
  }

  const flareMesh = new THREE.Mesh(geo.flares, s.flare);
  flareMesh.name = 'Resplandor de faro'; flareMesh.userData.vehicleGlow = true; flareMesh.castShadow = false; flareMesh.renderOrder = 3;
  // De día no hay resplandor: se enciende con la noche, la lluvia o la neblina (Car.setNight).
  flareMesh.visible = false;
  bodyVisual.add(flareMesh);

  let beam = null;
  if (beams) {
    beam = new THREE.Mesh(s.beamGeo, new THREE.MeshBasicMaterial({ map: s.beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: .32, color: '#ffe8c8' }));
    fadeGlowInFog(beam.material);
    beam.name = 'Haz sobre el pavimento'; beam.userData.vehicleGlow = true; beam.rotation.x = -Math.PI / 2;
    beam.position.set(L / 2 + 4, .03, 0); beam.renderOrder = 2; beam.visible = false; group.add(beam);
  }

  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    paint.dispose(); glass.dispose(); lamp.dispose(); beam?.material.dispose();
  };

  return {
    group, length: L, width: W, model: modelId, wheels, tailMat, beam, flares: [flareMesh], policeLights, dispose,
    frontWheelPivots, bodyVisual, signalMaterials, wipers, visualManaged: true, wheelRadius: r, wheelbase: spec.wb,
    mirrorAnchors: geo.mirrorAnchors.map(anchor => anchor.clone()), mirrorGeometry: geo.mirror, trimMaterial: s.trim,
    driverAnchor: new THREE.Vector3(spec.driver.x, 0, spec.driver.z), driverHeight: spec.driver.h,
    driverDoor: spec.driver.door ?? { x: spec.driver.x, side: -1 }, routeIndex,
    wetMaterials: [paint, glass], headlightMaterial,
  };
}
