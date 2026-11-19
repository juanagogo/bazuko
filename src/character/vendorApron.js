import * as THREE from 'three';
import { chainSunField } from '../world/bogota/SunFieldShader.js';

const APRONS = {
  tinto: { canvas: '#c5ab82', strap: '#967453', pocket: '#b19269', towel: 0 },
  fritanga: { canvas: '#b97b57', strap: '#e2c09b', pocket: '#a06448', towel: 1 }
};

// El ancho sigue a los hombros del cuerpo base. Las alturas se miden desde la
// unión del brazo, de modo que el mismo corte sienta bien sobre camisa, saco o chaqueta.
const CUT = /* glsl */ `
uniform vec2 uApronShoulder;
vec3 apronFit(vec3 point) {
  return vec3(point.x * .105 / max(.066, uApronShoulder.x), point.y - uApronShoulder.y, point.z);
}
float apronBox(vec2 point, vec2 halfSize, float radius) {
  vec2 edge = abs(point) - halfSize + radius;
  return length(max(edge, 0.)) + min(max(edge.x, edge.y), 0.) - radius;
}
float apronCut(vec3 p) {
  float width = mix(.105, .064, smoothstep(-.233, -.065, p.y));
  return apronBox(p.xy - vec2(0., -.221), vec2(width, .166), .008);
}
`;

const SURFACE = /* glsl */ `
vec3 apronPoint = apronFit(vStreetRest);
float apronX = abs(apronPoint.x), apronY = apronPoint.y;
float apronPixel = max(length(dFdx(apronPoint)), length(dFdy(apronPoint)));
float apronAA = clamp(apronPixel * .65, .0006, .014);
float apronFront = smoothstep(.012, .048, apronPoint.z);
float apronBack = 1. - smoothstep(-.042, .008, apronPoint.z);
float apronTop = smoothstep(-.036, -.002, apronY);
float apronEdge = apronCut(apronPoint);
float apronBody = apronFill(apronEdge, apronAA) * apronFront;

// Los tirantes salen del peto y continúan por encima del hombro. La cinta de cintura
// les da la vuelta a la camisa y termina en un cruce a la espalda.
float apronStrapX = mix(.049, .067, apronBack) + apronY * mix(-.28, -.13, apronBack);
float apronStrapLimit = mix(-.073, -.224, apronBack);
float apronStrapEdge = max(abs(apronX - apronStrapX) - .009, max(apronStrapLimit - apronY, apronY - .073));
float apronStrap = apronFill(apronStrapEdge, apronAA);
apronStrap *= max(max(apronFront, apronBack), apronTop);
float apronWaist = apronFill(max(apronX - .110, abs(apronY + .224) - .006), apronAA);
float apronKnot = apronFill(apronBox(vec2(apronX, apronY + .227), vec2(.011, .009), .003), apronAA) * apronBack;

// Bolsillo de pecho con remate horizontal. Siempre queda por encima de la mayor parte del mostrador.
float apronPocketX = mix(.019, -.014, uApronTowel);
float apronPocketEdge = apronBox(vec2(apronPoint.x - apronPocketX, apronY + .111), vec2(.030, .023), .003);
float apronPocket = apronFill(apronPocketEdge, apronAA);
float apronPocketHem = apronFill(abs(apronPocketEdge) - .0012, apronAA);
float apronPocketTop = apronFill(abs(apronY + .091) - .0035, apronAA) * apronPocket;
vec3 apronFabric = mix(uApronCanvas, uApronPocket, apronPocket);
apronFabric *= 1. - apronPocketHem * .24 - apronPocketTop * .09;

// Un paño crudo doblado sobre la cintura del puesto de cocina, bajo el bolsillo.
vec2 apronTowelPoint = vec2(apronPoint.x - .058 + .14 * (apronY + .243), apronY + .246);
float apronTowel = uApronTowel * apronFill(apronBox(apronTowelPoint, vec2(.027, .052), .004), apronAA);
float apronFold = .91 + .09 * smoothstep(-.013, -.002, apronTowelPoint.x) - .08 * smoothstep(.006, .019, apronTowelPoint.x);
float apronTowelHem = apronFill(abs(apronTowelPoint.y + .044) - .0035, apronAA);
apronFabric = mix(apronFabric, vec3(.62, .53, .40) * apronFold * (1. - apronTowelHem * .16), apronTowel);

float apronBorder = apronFill(abs(apronEdge + .0043) - .0011, apronAA);
apronFabric *= 1. - .19 * apronBorder;
float apronTie = max(apronStrap, max(apronWaist * (1. - apronFront * .88), apronKnot));
float apronCloth = max(apronBody, apronTie);
vec3 apronColor = mix(apronFabric, uApronStrap, apronTie / max(apronCloth, .001));
float apronGrain = streetNoise(vec2(apronPoint.x + apronPoint.z * .3, apronY) * 350.);
apronGrain = mix(apronGrain, .5, smoothstep(.0015, .006, apronPixel));
diffuseColor.rgb = mix(diffuseColor.rgb, apronColor * mix(.87, 1.1, apronGrain) * (1. - uStreetWet * .27), apronCloth);
streetRoughness = mix(streetRoughness, .91 - uStreetWet * .16, apronCloth);
`;

const DECLARATIONS = /* glsl */ `
uniform vec3 uApronCanvas;
uniform vec3 uApronStrap;
uniform vec3 uApronPocket;
uniform float uApronTowel;
float apronFill(float edge, float aa) { return 1. - smoothstep(-aa, aa, edge); }
`;

/** El delantal sigue los mismos pesos de piel que la ropa, incluso en el modelo lejano. */
export function dressVendorApron(material, style, shoulder) {
  if (!Object.hasOwn(APRONS, style)) return;
  const profile = APRONS[style];
  const previous = material.onBeforeCompile, key = material.customProgramCacheKey();
  const uniforms = {
    uApronShoulder: { value: new THREE.Vector2(shoulder.x, shoulder.y) },
    uApronCanvas: { value: new THREE.Color(profile.canvas) },
    uApronStrap: { value: new THREE.Color(profile.strap) },
    uApronPocket: { value: new THREE.Color(profile.pocket) },
    uApronTowel: { value: profile.towel }
  };
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CUT}`)
      .replace('#include <morphtarget_vertex>', `
        #include <morphtarget_vertex>
        vec3 apronRest = apronFit(vStreetRest);
        float apronLift = (1. - smoothstep(-.024, 0., apronCut(apronRest))) * smoothstep(.012, .046, apronRest.z);
        transformed += normal * .005 * apronLift;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${CUT}\n${DECLARATIONS}`)
      .replace('#include <roughnessmap_fragment>', `${SURFACE}\n#include <roughnessmap_fragment>`)
      .replace('#include <normal_fragment_maps>', `
        vec3 apronBaseNormal = normal;
        #include <normal_fragment_maps>
        normal = normalize(mix(normal, apronBaseNormal, apronCloth * .61));
      `);
  };
  material.customProgramCacheKey = () => `${key}|delantal-de-puesto`;
  material.userData.delantal = style;
  chainSunField(material);
  material.needsUpdate = true;
}
