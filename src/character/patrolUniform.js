import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Batch, addGeo, addGrid, tube } from '../world/bogota/carParts.js';
import { chainSunField } from '../world/bogota/SunFieldShader.js';

export const PATROL_COLORS = {
  uniforme: '#46533d',
  pantalon: '#394735',
  gorra: '#303b30',
  chaleco: '#b7c849',
  chalecoConductor: '#a7b94c',
  cinta: '#c2cbbd'
};

export const patrolSkinIndex = (index) => 1 + (index * 3 + 1) % 4;

// Corte en los ejes de la camisa en reposo. Así los paneles y pespuntes se doblan con
// el torso completo y con su malla simplificada, incluso al salir del vehículo.
const VEST_CUT = /* glsl */ `
float patrolVestEdge(vec3 p) {
  float side = abs(p.x);
  float armhole = mix(.185, .137, smoothstep(1.17, 1.38, p.y));
  float front = smoothstep(-.015, .044, p.z);
  float neckFront = 1.309 + .218 * pow(clamp(side / .137, 0., 1.), 1.65);
  float neckBack = 1.405 + .114 * smoothstep(.042, .125, side);
  float neck = mix(neckBack, neckFront, front);
  vec2 hem = vec2(side - armhole + .018, 1.057 - p.y + .018);
  return max(length(max(hem, 0.)) + min(max(hem.x, hem.y), 0.) - .018, p.y - neck);
}
`;

const VEST_CLOTH = /* glsl */ `
uniform vec3 uPatrolVest;
uniform vec3 uPatrolTape;
uniform sampler2D uPatrolLettering;

float patrolFill(float distanceToEdge, float antialias) {
  return 1. - smoothstep(-antialias, antialias, distanceToEdge);
}

float patrolHem(vec2 p, vec2 size, float radius) {
  vec2 q = abs(p) - size + radius;
  return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - radius;
}
`;

const VEST_SURFACE = /* glsl */ `
// Las medidas de la prenda corresponden al cuerpo adulto de la patrulla, en metros.
vec3 patrolPos = vStreetRest * 1.686;
float patrolPixel = max(length(dFdx(patrolPos)), length(dFdy(patrolPos)));
float patrolAA = clamp(patrolPixel * .65, .00065, .013);
float patrolX = abs(patrolPos.x);
float patrolY = patrolPos.y;
float patrolFront = smoothstep(.035, .074, patrolPos.z);
float patrolBack = 1. - smoothstep(-.082, -.036, patrolPos.z);
float patrolEdge = patrolVestEdge(patrolPos);
float patrolVest = patrolFill(patrolEdge, patrolAA);
float patrolTrim = patrolFill(patrolEdge + .010, patrolAA);

// Cinta textil gris cosida al paño. Los laterales de la prenda son de malla oscura.
vec3 patrolBinding = vec3(.027, .038, .025);
vec3 patrolAirMesh = vec3(.092, .115, .035);
float patrolVent = smoothstep(.134, .162, patrolX) * (1. - max(patrolFront, patrolBack));
vec3 patrolCloth = mix(uPatrolVest, patrolAirMesh, patrolVent * .82);
float patrolHorizontal = patrolFill(abs(patrolY - 1.117) - .017, patrolAA);
float patrolShoulderOrigin = mix(.094, .104, smoothstep(1.21, 1.41, patrolY));
float patrolShoulder = patrolFill(abs(patrolX - patrolShoulderOrigin) - .013, patrolAA)
  * smoothstep(1.25, 1.28, patrolY) * (1. - patrolVent);
float patrolTape = max(patrolHorizontal, patrolShoulder);
patrolCloth = mix(patrolCloth, uPatrolTape, patrolTape);
float patrolTapeHem = patrolFill(abs(abs(patrolY - 1.117) - .0175) - .0013, patrolAA);
patrolCloth *= 1. - patrolTapeHem * .17;

// Cierre y bolsillo de pecho derecho; la solapa queda por encima de la cinta.
float patrolZip = patrolFill(patrolX - .009, patrolAA) * patrolFront;
float patrolZipTooth = patrolFill(patrolX - .0018, patrolAA) * patrolFront;
float patrolPocket = patrolHem(vec2(patrolPos.x + .087, patrolY - 1.204), vec2(.048, .045), .010);
float patrolPocketFlap = patrolFill(abs(patrolY - 1.235) - .009, patrolAA);
float patrolPocketArea = patrolFill(patrolPocket, patrolAA) * patrolFront;
float patrolPocketSeam = patrolFill(abs(patrolPocket + .001) - .0015, patrolAA) * patrolFront;
patrolCloth = mix(patrolCloth, uPatrolVest * .82, patrolPocketArea * (.55 + patrolPocketFlap * .45));
patrolCloth = mix(patrolCloth, patrolBinding, max(patrolPocketSeam * .35, patrolZip));
patrolCloth = mix(patrolCloth, uPatrolTape * .51, patrolZipTooth);

// La misma palabra de la carrocería, sobre dos rótulos de tela.
vec2 patrolRearPanel = vec2(-patrolPos.x, patrolY - 1.246);
vec2 patrolChestPanel = vec2(patrolPos.x + .079, patrolY - 1.261);
float patrolRearPatch = patrolFill(patrolHem(patrolRearPanel, vec2(.121, .030), .004), patrolAA) * patrolBack;
float patrolChestPatch = patrolFill(patrolHem(patrolChestPanel, vec2(.045, .013), .003), patrolAA) * patrolFront;
float patrolPatch = max(patrolRearPatch, patrolChestPatch);
vec2 patrolPanel = mix(patrolRearPanel / vec2(.240, .059), patrolChestPanel / vec2(.090, .026), patrolFront) + .5;
patrolCloth = mix(patrolCloth, patrolBinding, patrolPatch);
patrolCloth = mix(patrolCloth, vec3(.76, .81, .54), texture2D(uPatrolLettering, clamp(patrolPanel, .002, .998)).r * patrolPatch);

float patrolTopstitch = patrolFill(abs(patrolEdge + .013) - .0012, patrolAA);
patrolCloth = mix(patrolBinding, patrolCloth, patrolTrim) * (1. - .17 * patrolTopstitch);
// Solo parte del sombreado de la camisa pasa al chaleco, que es de una tela más firme.
float patrolFolds = clamp(dot(diffuseColor.rgb, vec3(.2126, .7152, .0722)) / .081, .64, 1.34);
float patrolGrain = streetNoise(vec2(patrolPos.x + .61 * patrolPos.z, patrolY) * 385.);
patrolGrain = mix(patrolGrain, .5, smoothstep(.0015, .005, patrolPixel));
diffuseColor.rgb = mix(diffuseColor.rgb, patrolCloth * mix(.93, 1.07, patrolGrain)
  * mix(1., patrolFolds, .31) * (1. - uStreetWet * .29), patrolVest);
streetRoughness = mix(streetRoughness, mix(.88, .58, patrolTape) * (1. - uStreetWet * .17), patrolVest);

// Cinturón de lona sobre la pretina existente y bolsillos de fuelle al costado.
float patrolBelt = patrolFill(abs(patrolY - .968 + patrolPos.z * .03) - .026, patrolAA)
  * patrolFill(patrolX - .192, patrolAA);
float patrolBuckle = patrolFill(patrolHem(vec2(patrolPos.x, patrolY - .964), vec2(.024, .016), .004), patrolAA) * patrolFront;
diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(.021, .025, .022), vec3(.074, .086, .077), patrolBuckle), patrolBelt);
float patrolThigh = smoothstep(.152, .180, patrolX);
float patrolCargo = patrolHem(vec2(patrolPos.z - .048, patrolY - .744), vec2(.054, .081), .012);
float patrolCargoEdge = patrolFill(abs(patrolCargo) - .0018, patrolAA);
float patrolCargoFlap = patrolFill(abs(patrolY - .804) - .013, patrolAA);
diffuseColor.rgb *= 1. - patrolThigh * (.22 * patrolCargoEdge + .23 * patrolFill(patrolCargo, patrolAA) * patrolCargoFlap);
`;

let lettering;
function patrolLettering() {
  if (lettering) return lettering;
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 96;
  const ink = canvas.getContext('2d');
  ink.fillStyle = '#000';
  ink.fillRect(0, 0, canvas.width, canvas.height);
  ink.fillStyle = '#fff';
  ink.textAlign = 'center';
  ink.textBaseline = 'alphabetic';
  ink.font = 'bold 72px sans-serif';
  ink.fillText('POLICÍA', canvas.width / 2, 77, 342);
  lettering = new THREE.CanvasTexture(canvas);
  lettering.name = 'Letras del chaleco de patrulla';
  return lettering;
}

function coatVest(material, role) {
  const vest = new THREE.Color(role === 'conductor' ? PATROL_COLORS.chalecoConductor : PATROL_COLORS.chaleco);
  const tape = new THREE.Color(PATROL_COLORS.cinta);
  const previous = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uPatrolVest = { value: vest };
    shader.uniforms.uPatrolTape = { value: tape };
    shader.uniforms.uPatrolLettering = { value: patrolLettering() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VEST_CUT}`)
      .replace('#include <morphtarget_vertex>', `
        #include <morphtarget_vertex>
        transformed += normal * (.008 * (1. - smoothstep(-.023, 0., patrolVestEdge(vStreetRest * 1.686))));
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${VEST_CUT}\n${VEST_CLOTH}`)
      .replace('#include <roughnessmap_fragment>', `${VEST_SURFACE}\n#include <roughnessmap_fragment>`)
      .replace('#include <normal_fragment_maps>', `
        vec3 patrolSmoothNormal = normal;
        #include <normal_fragment_maps>
        normal = normalize(mix(normal, patrolSmoothNormal, .67 * patrolVest));
      `);
  };
  material.customProgramCacheKey = () => `${key}|chaleco-patrulla`;
  chainSunField(material);
  material.needsUpdate = true;
}

let kitMaterial, capShape;
const equipment = new Map();
const rgb = color => new THREE.Color(color).toArray();

function capGeometry() {
  const cap = new Batch({ uv: false, colorSize: 3 });
  const fabric = new THREE.Color(PATROL_COLORS.gorra), seam = new THREE.Color('#435041');
  // Copa de seis paneles. El borde baja por detrás y la visera curva continúa por delante.
  // [altura, medio ancho, punta delantera, borde trasero], con respecto al hueso de cabeza.
  const rows = [
    [.100, .084, .144, -.082], [.106, .089, .147, -.090], [.116, .088, .147, -.091],
    [.132, .089, .146, -.090], [.154, .087, .144, -.088], [.175, .083, .140, -.085],
    [.193, .076, .130, -.075], [.209, .066, .110, -.063], [.220, .049, .084, -.047],
    [.228, .026, .064, -.027], [.232, .0001, .0221, .0219]
  ];
  const around = 36;
  addGrid(cap, around, rows.length - 1, (i, j) => {
    const angle = i / around * Math.PI * 2, front = Math.cos(angle);
    const [y, halfWidth, tip, back] = rows[j], bend = (1 - j / (rows.length - 1)) ** 2;
    return [Math.sin(angle) * halfWidth, y + .009 * front * bend, .022 + front * (front > 0 ? tip - .022 : .022 - back)];
  }, { mirror: false, out: [0, 0, -1], color: (u, v) => {
    const edge = Math.round(v * (rows.length - 1));
    const topstitch = Math.abs(u * 6 - Math.round(u * 6)) < .004;
    return fabric.clone().lerp(seam, edge === 1 ? .58 : topstitch && edge >= 3 ? .3 : .04).toArray();
  } });
  const visorPoint = (i, j, face) => {
    const theta = (i / 20 - .5) * 2.25, outer = j / 4;
    const x = Math.sin(theta) * (.081 + .015 * outer);
    const z = .023 + Math.cos(theta) * (.111 + .068 * outer);
    const y = .116 - .012 * outer - .019 * (x / .096) ** 2;
    return [x, y + face * .0022, z];
  };
  for (const face of [1, -1]) addGrid(cap, 20, 4, (i, j) => visorPoint(i, j, face), {
    mirror: false, out: [0, face, 0], color: (u, v) => v > .88 ? rgb('#374639') : fabric.toArray()
  });
  addGrid(cap, 20, 1, (i, j) => visorPoint(i, 4, j === 0 ? -1 : 1), {
    mirror: false, out: [0, 0, 1], color: rgb('#222d26')
  });
  addGeo(cap, new THREE.SphereGeometry(.004, 8, 4), { position: [0, .231, .022], color: rgb(PATROL_COLORS.gorra) });
  return cap.toGeometry('Gorra de patrulla');
}

function fieldEquipment(kind) {
  if (equipment.has(kind)) return equipment.get(kind);
  const detail = new Batch({ uv: false, colorSize: 3 });
  const box = (size, center, round, color) => addGeo(detail, round ? new RoundedBoxGeometry(...size, 1, round) : new THREE.BoxGeometry(...size), {
    position: center, color: rgb(color)
  });
  let name;
  if (kind === 'radio') {
    name = 'Radio al pecho';
    box([.052, .091, .036], [.101, 1.270, .140], .006, '#282c28');
    box([.034, .018, .004], [.101, 1.289, .159], 0, '#626c60');
    for (const y of [1.272, 1.266, 1.260]) box([.034, .0027, .002], [.101, y, .159], 0, '#101510');
    tube(detail, [.119, 1.310, .135], [.132, 1.389, .084], .0039, 7, { color: rgb('#222720') });
    tube(detail, [.088, 1.310, .136], [.088, 1.323, .135], .006, 9, { color: rgb('#343a34') });
  } else if (kind === 'microfono') {
    name = 'Micrófono de solapa';
    box([.043, .061, .024], [.104, 1.299, .124], .006, '#282f2a');
    for (const y of [1.307, 1.301, 1.295]) box([.025, .0028, .002], [.104, y, .137], 0, '#111611');
    box([.011, .009, .004], [.104, 1.286, .137], .001, '#455348');
  } else {
    name = 'Funda en el cinturón';
    box([.071, .096, .037], [-.140, .949, .111], .009, '#282f2a');
    box([.068, .042, .008], [-.140, .973, .135], .004, '#39413b');
    box([.016, .035, .007], [-.140, .945, .136], 0, '#222822');
  }
  const geometry = detail.toGeometry(name);
  equipment.set(kind, geometry);
  return geometry;
}

/** Accesorios en metros de la camisa en reposo, ajustados a su hueso por la inversa de la pose de enlace. */
function putOnBone(clothing, joint, geometry) {
  const { skeleton, bindMatrix, castShadow } = clothing;
  const index = skeleton.bones.findIndex(bone => bone.name.endsWith(joint));
  if (index < 0) return;
  const part = new THREE.Mesh(geometry, kitMaterial);
  part.name = geometry.name;
  part.castShadow = castShadow;
  part.receiveShadow = true;
  part.applyMatrix4(new THREE.Matrix4().multiplyMatrices(skeleton.boneInverses[index], bindMatrix));
  skeleton.bones[index].add(part);
}

export function dressPatrolOfficer(character, role) {
  const group = character?.group;
  const cap = group?.getObjectByName('prop-gorra');
  if (!cap || cap.userData.patrulla) return;
  const clothing = group.getObjectByName('personajemale_casualsuit01');
  if (!clothing?.isSkinnedMesh) return;
  coatVest(clothing.material, role);
  const boots = group.getObjectByName('personajetoigo_ankle_boots_male');
  boots?.material.color.set('#adbfc9');

  kitMaterial ??= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .89 });
  kitMaterial.userData.shared = true;
  capShape ??= capGeometry();
  const mesh = new THREE.Mesh(capShape, kitMaterial);
  mesh.name = capShape.name;
  mesh.castShadow = clothing.castShadow;
  mesh.receiveShadow = true;
  const oldMaterials = new Set(cap.children.map(child => child.material));
  for (const material of oldMaterials) material.dispose();
  cap.clear();
  cap.add(mesh);
  cap.userData.patrulla = true;
  // El gesto de radio lleva la mano a la solapa izquierda.
  const driver = role === 'conductor';
  putOnBone(clothing, 'Spine2', fieldEquipment(driver ? 'microfono' : 'radio'));
  if (driver) putOnBone(clothing, 'Hips', fieldEquipment('pouch'));
}
