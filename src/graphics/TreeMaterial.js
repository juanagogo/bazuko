// Tree material adapted from createTreeMaterial / FoliageLightingModel in js/tsl-materials.js of
// Slop New York 1b54e165 (MIT). Adjusted to BAZUKO: Bogotá species barks, no Manhattan canyon sky AO,
// wind from the east-southeast (the prevailing direction over the Sabana).
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, color, attribute, positionLocal, positionGeometry, normalLocal, normalView,
  normalViewGeometry, positionViewDirection, frontFacing, uv, time, sin, abs, floor, fract, mix, step, smoothstep,
  dot, normalize, pow, clamp, texture
} from 'three/tsl';

const hash2D = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
const noise2D = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash2D(i), b = hash2D(i.add(vec2(1, 0))), c = hash2D(i.add(vec2(0, 1))), d = hash2D(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

// Luz del sol a través de las hojas (aproximación de Barré-Brisebois y Bouchard): a contraluz la hoja brilla
// con la luz que deja pasar; toma el color de la luz directa, así que las sombras también la apagan.
class FoliageLightingModel extends THREE.PhysicalLightingModel {
  direct(lightData, builder) {
    const { lightDirection, lightColor, reflectedLight } = lightData;
    const translucency = builder.material.translucencyNode;
    if (translucency) {
      const scatter = normalize(lightDirection.add(normalView.mul(0.3)));
      const through = pow(clamp(dot(positionViewDirection, scatter.negate()), 0.0, 1.0), 3.0);
      reflectedLight.directDiffuse.addAssign(lightColor.mul(translucency).mul(through));
    }
    super.direct(lightData, builder);
  }
}

class TreeNodeMaterial extends THREE.MeshStandardNodeMaterial {
  static get type() { return 'TreeNodeMaterial'; }
  constructor(parameters) {
    super(parameters);
    this.translucencyNode = null;
  }
  setupLightingModel() { return new FoliageLightingModel(); }
}

// Viento dominante sobre la Sabana: del este-sureste (xz normalizado).
const TREE_WIND = vec2(-0.92, 0.39);

/**
 * Corteza y hojas recortadas en un solo dibujo por malla instanciada (TreeField.js).
 * - aTree (vec4): x = 1 en tarjetas de hojas / 0 en corteza, y = oclusión de copa, z = peso de vaivén, w = azar por tarjeta.
 * - aTreeData (instanciado vec4): rgb = tinte lineal del follaje del árbol, w = especie + fracción aleatoria.
 *   Especies: 0 urapán y 2 caucho sabanero (corteza agrietada gris-parda), 1 eucalipto (corteza que se
 *   descascara en parches crema, gris y canela).
 * - Atlas: r = brillo de la hoja, g = variación de tono, b = ramita/peciolo, a = cobertura (mips que la conservan).
 * La prueba alfa va como nodos (alphaTestNode / maskShadowNode) y no como `alphaTest`, para no alternar la
 * versión del material de sombras compartido en cada pasada (ver el comentario del donante).
 */
export function createTreeMaterial(leafAtlas) {
  const mat = new TreeNodeMaterial({ side: THREE.DoubleSide, alphaToCoverage: true, metalness: 0.0, roughness: 0.8 });
  mat.name = 'Árboles de Bogotá · TSL';
  const aTree = attribute('aTree', 'vec4');
  const aData = attribute('aTreeData', 'vec4');
  const isLeaf = aTree.x;
  const crownAO = aTree.y;
  const rnd = fract(aData.w);
  const species = floor(aData.w);
  const leaf = texture(leafAtlas, uv());

  // Viento: positionLocal ya está instanciado (mundo); positionGeometry es el marco del árbol en metros.
  mat.positionNode = Fn(() => {
    const p = positionLocal;
    const g = positionGeometry;
    const phase = rnd.mul(6.2832);
    const gust = sin(time.mul(0.5).sub(dot(p.xz, TREE_WIND).mul(0.045))).mul(0.5).add(0.5);
    const strength = gust.mul(gust).mul(0.7).add(0.3);
    const h = g.y.div(11.0);
    const bend = h.mul(h);
    const lean = sin(time.mul(0.85).add(phase)).mul(0.45).add(0.55).mul(strength).mul(0.2);
    const rock = sin(time.mul(0.67).add(phase.mul(1.7))).mul(0.06).mul(strength);
    const sway = vec3(TREE_WIND.x.mul(lean).sub(TREE_WIND.y.mul(rock)), 0.0, TREE_WIND.y.mul(lean).add(TREE_WIND.x.mul(rock))).mul(bend);
    const bob = sin(time.mul(2.1).add(g.x.mul(0.9)).add(g.z.mul(0.7)).add(phase)).mul(0.05).mul(aTree.z).mul(strength);
    const flutter = sin(time.mul(8.0).add(aTree.w.mul(37.0)).add(g.y.mul(2.0))).mul(0.03).mul(isLeaf).mul(aTree.z).mul(strength.add(0.25));
    return p.add(sway).add(vec3(0.0, bob, 0.0)).add(normalLocal.mul(flutter));
  })();

  const alpha = mix(float(frontFacing), leaf.a, isLeaf);
  mat.alphaTestNode = float(0.5);
  mat.maskShadowNode = alpha.greaterThan(0.5);

  mat.colorNode = Fn(() => {
    const tint = aData.xyz;
    const base = tint.mul(leaf.r.mul(1.4));
    const warm = smoothstep(0.62, 1.0, leaf.g).mul(0.45);
    const cool = smoothstep(0.38, 0.0, leaf.g).mul(0.45);
    const leafCol = mix(mix(base, base.mul(vec3(1.2, 1.08, 0.55)), warm), base.mul(vec3(0.8, 0.92, 1.05)), cool);
    const foliage = mix(leafCol, color(0x4a3b2c), leaf.b).mul(crownAO.mul(0.45).add(0.55));

    const bu = uv();
    const n1 = noise2D(vec2(bu.x.mul(5.0), bu.y.mul(1.1)).add(rnd.mul(17.0)));
    const n2 = noise2D(bu.mul(vec2(2.4, 0.9)).add(rnd.mul(31.0)));
    const ridge = float(1.0).sub(abs(n1.sub(0.5).mul(2.0)));
    const furrowed = mix(color(0x2f2821), color(0x5e5447), smoothstep(0.35, 0.9, ridge));
    // Eucalipto: tiras largas que se desprenden, crema y gris sobre canela
    const peeling = mix(mix(color(0x8a7f6c), color(0xc9c0a6), smoothstep(0.55, 0.68, n2)), color(0x6e5440), smoothstep(0.3, 0.2, n2));
    const isEucalyptus = step(0.5, species).mul(float(1.0).sub(step(1.5, species)));
    const bark = mix(furrowed, peeling, isEucalyptus).mul(crownAO.mul(0.4).add(0.6));
    return vec4(mix(bark, foliage, isLeaf), alpha);
  })();

  mat.roughnessNode = mix(float(0.93), float(0.72).sub(leaf.r.mul(0.1)), isLeaf);
  mat.normalNode = normalViewGeometry;
  mat.aoNode = crownAO.mul(0.75).add(0.25);
  mat.translucencyNode = aData.xyz.mul(vec3(1.0, 1.2, 0.45)).mul(leaf.r.mul(1.5)).mul(crownAO.mul(0.8).add(0.2)).mul(isLeaf);
  return mat;
}
