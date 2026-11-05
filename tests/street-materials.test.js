import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { applyStreetMaterial, createStreetFrame, GARMENTS, markGarmentZones, normalizeTonos, SKIN_ALBEDO, streetFaceTint, streetMaterialSeed, streetSkinColor, streetWetness } from '../src/character/streetMaterials.js';
import { addHairTone } from '../src/character/weathering.js';

function characterFixture() {
  const root = new THREE.Group();
  root.position.set(9, 2, -4); root.rotation.y = .5; root.scale.setScalar(1.2);
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, .3), new THREE.MeshStandardMaterial());
  body.position.y = 1; root.add(body);
  const eyes = new THREE.Mesh(new THREE.BoxGeometry(.12, .04, .03), new THREE.MeshStandardMaterial());
  eyes.name = 'personaje.eyes'; eyes.position.set(0, 1.8, .13); root.add(eyes);
  const bones = new Map();
  for (const [name, x, y] of [['LeftHand', .5, 1.2], ['RightHand', -.5, 1.2], ['LeftLeg', .15, .5], ['RightLeg', -.15, .5]]) {
    const bone = new THREE.Bone(); bone.name = `mixamorig${name}`; bone.position.set(x, y, 0); root.add(bone); bones.set(bone.name, bone);
  }
  root.updateMatrixWorld(true);
  return { root, body, eyes, bones, frame: createStreetFrame(root, bones, body) };
}

function compile(material) {
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader, {});
  return shader;
}

test('la semilla mantiene una apariencia reproducible al cambiar el orden del look', () => {
  const first = { nombre: 'José', piel: 2, real: { ropa: 'chaqueta', barba: 'descuidada' } };
  const reordered = { real: { barba: 'descuidada', ropa: 'chaqueta' }, piel: 2, nombre: 'José' };
  assert.equal(streetMaterialSeed(first), streetMaterialSeed(reordered));
  assert.notEqual(streetMaterialSeed(first), streetMaterialSeed({ ...first, nombre: 'Ana' }));
});

test('el marco anatómico congela las marcas antes del skinning sin cambiar geometría ni UV', () => {
  const { root, body, bones, frame } = characterFixture();
  const positions = body.geometry.attributes.position.array.slice(), uv = body.geometry.attributes.uv.array.slice();
  applyStreetMaterial(body.material, body, { frame, kind: 'skin', wear: 2 });
  const shader = compile(body.material), matrix = shader.uniforms.uStreetRestMatrix.value;
  const top = new THREE.Vector3(0, 1, 0).applyMatrix4(matrix);
  assert.ok(Math.abs(top.y - 1) < 1e-6);
  const handBefore = frame.leftHand.toArray(), matrixBefore = matrix.toArray();
  bones.get('mixamorigLeftHand').rotation.z = .8;
  root.position.x += 3; root.updateMatrixWorld(true);
  assert.deepEqual(frame.leftHand.toArray(), handBefore);
  assert.deepEqual(matrix.toArray(), matrixBefore);
  assert.deepEqual(body.geometry.attributes.position.array, positions);
  assert.deepEqual(body.geometry.attributes.uv.array, uv);
  assert.ok(shader.vertexShader.indexOf('vStreetRest =') < shader.vertexShader.indexOf('#include <skinning_vertex>'));
});

test('los materiales conservan color elegido, transparencia y normales existentes por instancia', () => {
  const { body, frame } = characterFixture();
  const original = new THREE.MeshStandardMaterial({ color: '#41362a', map: new THREE.Texture(), normalMap: new THREE.Texture(), transparent: true, alphaTest: .08, depthWrite: false });
  const texture = new THREE.Texture();
  const own = original.clone();
  applyStreetMaterial(own, body, { frame, kind: 'skin', detailTexture: texture });
  assert.equal(own.map, original.map);
  assert.equal(own.normalMap, original.normalMap, 'normal preexistente preservada');
  assert.ok(own.color.equals(original.color));
  assert.equal(own.alphaTest, .08); assert.equal(own.transparent, true); assert.equal(own.depthWrite, false);
  assert.equal(original.roughness, 1, 'material fuente intacto');
  const skin = new THREE.MeshStandardMaterial();
  applyStreetMaterial(skin, body, { frame, kind: 'skin', detailTexture: texture });
  assert.equal(skin.normalMap, texture);
  assert.deepEqual(skin.normalScale.toArray(), [.5, .5]);
  const shoes = new THREE.MeshStandardMaterial();
  applyStreetMaterial(shoes, body, { frame, kind: 'shoes', detailTexture: texture });
  assert.equal(shoes.normalMap, null, 'microdetalle solo en piel');
});

test('el tono del cabello se evalúa antes del desgaste y los programas se comparten entre semillas', () => {
  const { body, frame } = characterFixture();
  const material = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), alphaTest: .08 });
  addHairTone(material);
  applyStreetMaterial(material, body, { frame, kind: 'hair', seed: 4 });
  const shader = compile(material);
  assert.ok(shader.fragmentShader.indexOf('diffuseColor.rgb = diffuse * mix') < shader.fragmentShader.indexOf('float streetRoughness'));
  assert.ok(shader.fragmentShader.includes('roughnessFactor *= streetRoughness'));
  const other = new THREE.MeshStandardMaterial({ map: material.map, alphaTest: .08 });
  addHairTone(other);
  applyStreetMaterial(other, body, { frame, kind: 'hair', seed: 99 });
  assert.equal(other.customProgramCacheKey(), material.customProgramCacheKey());
  assert.notEqual(compile(other).uniforms.uStreetSeed.value, shader.uniforms.uStreetSeed.value);
});

test('ojos y pestañas conservan su tratamiento independiente', () => {
  const { eyes, frame } = characterFixture();
  const lashes = new THREE.MeshStandardMaterial({ transparent: true, depthWrite: false, alphaTest: .02 });
  const lashesBefore = lashes.toJSON();
  applyStreetMaterial(eyes.material, eyes, { frame, kind: 'eyes' });
  assert.equal(eyes.material.roughness, .22);
  assert.equal(eyes.material.userData.streetSurface, 'eyes');
  assert.deepEqual(lashes.toJSON(), lashesBefore);
  assert.equal(eyes.material.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
});

const TONOS = { arriba: '#223344', abajo: '#556677', patron: 'franela', patronColor: '#8a2a20' };
const material = (kind, mesh, frame, options) => {
  const value = new THREE.MeshStandardMaterial();
  applyStreetMaterial(value, mesh, { frame, kind, ...options });
  return value;
};

test('sin tonos válidos la prenda conserva su textura, y un patrón roto queda liso', () => {
  assert.deepEqual(normalizeTonos(TONOS), TONOS);
  for (const raw of [undefined, null, 'rojo', {}, { arriba: '#223344' }, { arriba: 'rojo', abajo: '#556677' }, { arriba: '#234', abajo: '#556677' }]) {
    assert.equal(normalizeTonos(raw), null);
  }
  for (const patron of [undefined, 'cuadros', 'constructor']) {
    const { patron: resolved, patronColor } = normalizeTonos({ arriba: '#223344', abajo: '#556677', patron, patronColor: 'verde' });
    assert.equal(resolved, 'liso');
    assert.equal(patronColor, '#556677', 'sin color de patrón usa el de abajo');
  }
});

test('los tonos pintan por zona sin copiar texturas y sin ellos todo queda como venía', () => {
  const { body, frame } = characterFixture();
  const map = new THREE.Texture();
  const tinted = new THREE.MeshStandardMaterial({ map });
  applyStreetMaterial(tinted, body, { frame, kind: 'fabric', tonos: TONOS, garment: GARMENTS.camisa });
  const { uniforms } = compile(tinted);
  assert.equal(tinted.map, map);
  assert.equal(uniforms.uStreetTint.value, 1);
  assert.equal(uniforms.uStreetPattern.value, 2);
  assert.equal(uniforms.uStreetTop.value.getHexString(), '223344');
  assert.equal(uniforms.uStreetBottom.value.getHexString(), '556677');
  assert.equal(uniforms.uStreetPatternColor.value.getHexString(), '8a2a20');
  assert.deepEqual(uniforms.uStreetLight.value.toArray(), GARMENTS.camisa.luz);
  const plain = compile(material('fabric', body, frame, { garment: GARMENTS.camisa })).uniforms;
  assert.equal(plain.uStreetTint.value, 0, 'sin tonos');
  assert.equal(compile(material('fabric', body, frame, { tonos: TONOS })).uniforms.uStreetTint.value, 0, 'un sombrero no es una prenda');
});

test('las manchas grandes solo llegan con mucho desgaste', () => {
  const { body, frame } = characterFixture();
  const shader = wear => compile(material('fabric', body, frame, { wear }));
  assert.deepEqual([0, 1, 2, 5].map(wear => shader(wear).uniforms.uStreetWear.value), [0, .5, 1, 1]);
  const [, from] = /grime = smoothstep\(([\d.]+),/.exec(shader(2).fragmentShader);
  assert.ok(Number(from) >= .5, 'desgaste 1 queda sin manchas');
});

test('cada tipo de superficie comparte programa sea quien sea la persona', () => {
  const { body, frame } = characterFixture();
  const kinds = ['skin', 'fabric', 'shoes', 'hair', 'beard'];
  const key = (kind, options) => material(kind, body, frame, options).customProgramCacheKey();
  const other = { seed: 9, wear: 0, stubble: .5, faceTint: new THREE.Vector3(1.1, 1, .9), brows: new THREE.Vector4(.1, .1, .1, .8), tonos: TONOS, garment: GARMENTS.rayas };
  for (const kind of kinds) assert.equal(key(kind, other), key(kind), kind);
  assert.equal(new Set(kinds.map(kind => key(kind))).size, kinds.length);
});

test('la planta del calzado es oscura, sin textura nueva y sin tocar a los demás materiales', () => {
  const { body, frame } = characterFixture();
  for (const kind of ['skin', 'fabric', 'shoes', 'hair', 'beard']) {
    const shader = compile(material(kind, body, frame));
    assert.equal(/float underside\b/.test(shader.fragmentShader), kind === 'shoes', kind);
    if (kind !== 'shoes') continue;
    assert.match(shader.fragmentShader, /dFdx\(p\), dFdy\(p\)/, 'se reconoce por la cara, no por una textura');
    assert.ok(Object.keys(shader.uniforms).every(name => !/sole|underside/i.test(name)), 'ni un uniforme más');
  }
});

test('la lluvia es un solo valor para todos los materiales y lo actualiza el juego', () => {
  const { body, frame } = characterFixture();
  const shaders = ['skin', 'fabric', 'shoes', 'hair', 'beard'].map(kind => compile(material(kind, body, frame)));
  for (const shader of shaders) {
    assert.equal(shader.uniforms.uStreetWet, streetWetness, 'mismo objeto, no una copia');
    assert.match(shader.fragmentShader, /uStreetWet \* /);
  }
  const game = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  assert.equal(game.match(/streetWetness\.value = this\.weather\?\.wetness \?\? 0;/g).length, 2, 'en los dos caminos del clima');
});

test('las zonas salen de las islas: el dobladillo de la camisa no toma el color del pantalón', () => {
  // Camisa de .46 a .8, con el dobladillo por debajo de la pretina de un pantalón que llega a .52.
  const shirt = [[0, .46], [1, .46], [0, .8]], trousers = [[0, 0], [1, 0], [0, .52]];
  const islands = (...triangles) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triangles.flat().flatMap(([x, y]) => [x, y, 0])), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(triangles.flat().flatMap(([x, y]) => [x / 2, y / 2])), 2));
    geometry.setIndex(triangles.flatMap((_, i) => [i * 3, i * 3 + 1, i * 3 + 2]));
    return geometry;
  };
  const geometry = islands(shirt, trousers);
  markGarmentZones(geometry, new THREE.Matrix4(), GARMENTS.camisa);
  assert.deepEqual([...geometry.attributes.streetZone.array], [0, 0, 0, 255, 255, 255]);
  const before = geometry.attributes.streetZone;
  markGarmentZones(geometry, new THREE.Matrix4(), GARMENTS.short);
  assert.equal(geometry.attributes.streetZone, before, 'una vez por geometría compartida');
  // En el overol, arriba es solo la camiseta, que se reconoce por su sitio en la textura y no por su altura.
  const suit = islands([[.8, .2], [1, .2], [.8, .4]], [[0, .9], [.2, .9], [0, 1.1]]);
  markGarmentZones(suit, new THREE.Matrix4(), GARMENTS.overol);
  assert.deepEqual([...suit.attributes.streetZone.array], [0, 0, 0, 255, 255, 255]);
});

test('la piel cubre su rango sin gris y cada cuerpo llega al mismo tono', () => {
  const luminance = ([r, g, b]) => .2126 * r + .7152 * g + .0722 * b;
  SKIN_ALBEDO.forEach((albedo, tone) => {
    const [r, g, b] = albedo;
    assert.ok(r > g && g > b, 'rojiza: ni gris ni verdosa');
    assert.ok(r / g < 2.1, 'sin llegar a naranja');
    if (tone) assert.ok(luminance(albedo) < luminance(SKIN_ALBEDO[tone - 1]), 'de claro a oscuro');
  });
  const young = streetSkinColor(2, 'hombre-joven'), old = streetSkinColor(2, 'mujer-mayor');
  assert.notEqual(young.getHexString(), old.getHexString(), 'cada textura pide su corrección');
  assert.equal(streetSkinColor(99, 'hombre-adulto').getHexString(), streetSkinColor(2, 'hombre-adulto').getHexString());
  assert.ok(streetFaceTint('hombre-mayor').toArray().every(value => value >= 1), 'la cara oscura se acerca a los brazos');
});
