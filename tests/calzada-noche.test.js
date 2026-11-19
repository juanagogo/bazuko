import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { NIGHT_ROAD, dressAsphalt, followAsphaltNight, lightOnAsphalt, setAsphaltWetness } from '../src/world/bogota/AsphaltDressing.js';
import { fadeGlowInFog } from '../src/world/bogota/SunField.js';
import { wetFloorEnvironment } from '../src/world/bogota/StreetPuddles.js';
import { Bogota } from '../src/world/districts/Bogota.js';

/** Una calle de cuatro tiles que corre en z, entre dos andenes, cruzada a media altura por otra igual. */
function streets(size = 40) {
  return Array.from({ length: size }, (_, z) => Array.from({ length: size }, (_, x) =>
    (x >= 18 && x <= 21) || (z >= 18 && z <= 21) ? 'road' : 'sidewalk'));
}

const compile = material => {
  const base = THREE.ShaderLib[material.isMeshBasicMaterial ? 'basic' : 'standard'];
  const shader = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader };
  material.onBeforeCompile(shader, null);
  return shader;
};

const sorteos = run => {
  const original = Math.random;
  let pedidos = 0;
  Math.random = () => { pedidos++; return original(); };
  try { run(); } finally { Math.random = original; }
  return pedidos;
};

const luzDeFarol = (map, road) => lightOnAsphalt(fadeGlowInFog(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true,
  depthWrite: false, blending: THREE.AdditiveBlending, forceSinglePass: true })), map, road);

test('la luz pintada de los faroles toma el grano, la huella y el aceite de la calzada sin dejar de ser aditiva', () => {
  const map = streets(), road = dressAsphalt(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), map);
  road.map.userData = { scale: 14 };
  const glow = luzDeFarol(map, road), shader = compile(glow);
  assert.equal(glow.blending, THREE.AdditiveBlending);
  assert.equal(glow.forceSinglePass, true, 'en una pasada');
  assert.ok(glow.fog, 'con niebla');
  assert.ok(!shader.fragmentShader.includes('#include <fog_fragment>'));
  assert.ok(shader.fragmentShader.includes('gl_FragColor.rgb *= 1. - smoothstep( fogNear, fogFar, vFogDepth )'), 'que la apaga hacia negro');
  assert.equal(shader.uniforms.uLampGrain.value, road.map, 'el grano es el mapa de color del asfalto: ninguna textura nueva');
  assert.equal(shader.uniforms.uLampGrainScale.value, 1 / 14, 'con su mismo repetido');
  const roadShader = compile(road);
  assert.equal(shader.uniforms.uAsphaltMask.value, roadShader.uniforms.uAsphaltMask.value, 'y las huellas, las de la máscara de la calzada');
  assert.match(shader.vertexShader, /vLampAt = \( modelMatrix \* vec4\( transformed, 1\.0 \) \)\.xyz;/);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb \*= mix\( 1\., lampGrain \* \( 1\. - [0-9.]+ \* min\( lampTrack, 1\. \) \) \* \( 1\. - [0-9.]+ \* lampOil \), lampRoad \);/);
  assert.ok(shader.fragmentShader.indexOf('lampGrain *') > shader.fragmentShader.indexOf('vColor'), 'después del tinte de cada charco');
  const calzada = shader.fragmentShader.match(/float lampRoad = 1\. - smoothstep\( ([0-9.]+), ([0-9.]+), vLampAt\.y \) \+ smoothstep\( ([0-9.]+), ([0-9.]+), vLampAt\.y \);/);
  assert.ok(calzada, 'solo donde cae en la calzada');
  const [desde, hasta, sube, arriba] = calzada.slice(1).map(Number), alto = y => y + .03;
  assert.ok(alto(.02) < desde && alto(.04) > hasta, 'la calzada y la troncal sí; la tierra, el pasto y el andén quedan como estaban');
  assert.ok(alto(.12) < sube && arriba < 7, 'y el tablero del viaducto también es asfalto');
  assert.ok(!/lampFine/.test(shader.fragmentShader), 'sin manchas de ruido sobre el charco: solo lo que el asfalto ya tiene');
  assert.notEqual(glow.customProgramCacheKey(), fadeGlowInFog(new THREE.MeshBasicMaterial()).customProgramCacheKey());
});

test('el grano ni apaga del todo el charco de luz ni lo deja más fuerte que antes', () => {
  const [low, high] = NIGHT_ROAD.poolGrain;
  assert.ok(low >= .4 && low < 1 && high > 1 && high <= 1.4, `${low} a ${high}`);
  assert.ok(NIGHT_ROAD.poolTint > .15 && NIGHT_ROAD.poolTint <= .3, `tinte ${NIGHT_ROAD.poolTint}`);
  assert.ok(NIGHT_ROAD.poolStain > 0 && NIGHT_ROAD.poolStain <= 1 && NIGHT_ROAD.poolPatch <= .2, 'las manchas, apenas: sin parches de camuflaje');
  assert.ok(NIGHT_ROAD.poolTrack > 0 && NIGHT_ROAD.poolTrack <= .3 && NIGHT_ROAD.poolOil > 0 && NIGHT_ROAD.poolOil <= .3);
  const details = readFileSync(new URL('../src/world/bogota/StreetDetails.js', import.meta.url), 'utf8');
  assert.match(details, /const pool = tint\('#ffb06a', NIGHT_ROAD\.poolTint\);/, 'el charco del farol usa ese tinte');
});

test('sin mapa de asfalto la luz se compila igual y vestirla no gasta el azar del juego', () => {
  const map = streets(), glow = fadeGlowInFog(new THREE.MeshBasicMaterial());
  assert.equal(sorteos(() => { lightOnAsphalt(glow, map, null); glow.onBeforeCompile({ uniforms: {}, vertexShader: '', fragmentShader: '' }, null); }), 0);
  assert.ok(compile(glow).uniforms.uLampGrain.value, 'toma el ruido que la cúpula ya tiene en memoria');
});

const calzadas = () => {
  const map = streets();
  const road = dressAsphalt(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), map);
  const busway = dressAsphalt(new THREE.MeshStandardMaterial({ map: new THREE.Texture() }), map, { slabs: true });
  return { road, busway };
};
const numero = '([0-9.]+)';

test('calzada y troncal siguen en un programa y comparten lo mojado y la noche', () => {
  const { road, busway } = calzadas(), a = compile(road), b = compile(busway);
  assert.equal(road.customProgramCacheKey(), busway.customProgramCacheKey());
  assert.equal(a.fragmentShader, b.fragmentShader, 'el mismo texto: lo que cambia va en uniformes');
  assert.ok(!/#define [A-Z_]*ASPHALT/.test(a.fragmentShader));
  for (const name of ['uAsphaltWet', 'uAsphaltNight']) assert.equal(a.uniforms[name], b.uniforms[name], name);
  assert.match(a.fragmentShader, /sunFieldLit/, 'el campo de sol sigue encadenado');
  assert.ok(a.fragmentShader.includes('#include <aomap_fragment>'), 'lo que se encadena después sigue encontrando su sitio');
});

test('de noche y en seco la calzada queda mate y casi no devuelve el entorno; de día no cambia', () => {
  const { fragmentShader } = compile(calzadas().road);
  const piso = fragmentShader.match(new RegExp(`roughnessFactor = mix\\( roughnessFactor, max\\( roughnessFactor, ${numero} - ${numero} \\* min\\( asphaltPolish, 1\\. \\) \\), uAsphaltNight \\* \\( 1\\. - uAsphaltWet \\) \\);`));
  assert.ok(piso, 'piso de rugosidad en seco, solo de noche');
  assert.ok(Number(piso[1]) >= .9 && Number(piso[2]) <= .05, `${piso[1]} menos ${piso[2]} en la huella`);
  assert.ok(fragmentShader.indexOf(piso[0]) > fragmentShader.indexOf('roughnessFactor *= 1. - .22 * min( asphaltPolish, 1. );'), 'después del pulido de la huella');
  const entorno = fragmentShader.match(new RegExp(`reflectedLight\\.indirectSpecular \\*= mix\\( 1\\., ${numero}, uAsphaltNight \\* \\( 1\\. - uAsphaltWet \\) \\);`));
  assert.ok(entorno, 'el entorno baja de noche y en seco');
  assert.ok(Number(entorno[1]) > 0 && Number(entorno[1]) * .72 <= .11, `con la escena en .72 queda en ${Number(entorno[1]) * .72}`);
  assert.deepEqual([Number(piso[1]), Number(piso[2]), Number(entorno[1])], [NIGHT_ROAD.dryRoughness, NIGHT_ROAD.dryPolish, NIGHT_ROAD.dryEnvironment]);
});

test('la lluvia llega a la calzada con lo mojado del piso: entera en media, a .65 en baja', () => {
  const city = new Bogota();
  city.groundMaterials = calzadas();
  const { uAsphaltWet } = compile(city.groundMaterials.road).uniforms;
  city.setWetness(1);
  assert.equal(uAsphaltWet.value, 1);
  assert.ok(city.groundMaterials.road.roughness < .5, 'la rugosidad del material sigue bajando como antes');
  city.setWetness(0);
  assert.equal(uAsphaltWet.value, 0);
  assert.equal(city.groundMaterials.road.roughness, .82);
  city.graphicsQuality = 'baja';
  city.setWetness(1);
  assert.ok(Math.abs(uAsphaltWet.value - .65) < 1e-9, `${uAsphaltWet.value}`);
  city.setWetness(0);
  setAsphaltWetness(7);
  assert.equal(uAsphaltWet.value, 1);
  setAsphaltWetness(undefined);
  assert.equal(uAsphaltWet.value, 0);
});

test('la calzada sigue la noche de la escena en cada cuadro sin soltar el piso mojado', () => {
  const { road, busway } = calzadas();
  wetFloorEnvironment(road);
  let antes = 0;
  const deAntes = road.onBeforeRender;
  road.onBeforeRender = function (...args) { antes++; return deAntes.apply(this, args); };
  assert.equal(sorteos(() => { followAsphaltNight(road, busway, undefined); followAsphaltNight(road); }), 0);
  const { uAsphaltNight } = compile(road).uniforms;
  assert.ok(compile(road).fragmentShader.includes('reflectedLight.indirectSpecular *= uWetFloorEnv'), 'el piso mojado sigue encadenado');
  road.onBeforeRender(null, { userData: { environmentDay: 0 } });
  assert.equal(uAsphaltNight.value, 1);
  assert.equal(antes, 1, 'lo que el material ya hacía antes de dibujarse se sigue haciendo, una sola vez');
  busway.onBeforeRender(null, { userData: { environmentDay: .75 } });
  assert.equal(uAsphaltNight.value, .25);
  road.onBeforeRender(null, { userData: {} });
  assert.equal(uAsphaltNight.value, 0, 'sin dato es de día');
});

test('de noche y mojada, la calzada brilla más en el surco de la huella que en el agregado, píxel a píxel; de día no cambia', () => {
  const { road, busway } = calzadas(), { fragmentShader } = compile(road);
  const mojado = fragmentShader.match(new RegExp(`roughnessFactor = mix\\( roughnessFactor, mix\\( ${numero}, ${numero}, min\\( asphaltPolish, 1\\. \\) \\) \\* \\( ${numero} \\+ ${numero} \\* asphaltGrain \\), uAsphaltWet \\* uAsphaltNight \\);`));
  assert.ok(mojado, 'mezcla mojada por píxel');
  const [agregado, surco, base, grano] = mojado.slice(1).map(Number);
  assert.deepEqual([agregado, surco, grano], [NIGHT_ROAD.wetRoughness, NIGHT_ROAD.wetTrackRoughness, NIGHT_ROAD.wetGrain]);
  assert.ok(surco <= .3 && agregado >= .4 && agregado - surco >= .15, `surco ${surco}, agregado ${agregado}`);
  assert.ok(Math.abs(base + grano / 2 - 1) < 1e-9, 'el grano no cambia la media');
  assert.ok(agregado * (base + grano) < .85, 'ni lo más áspero del piso mojado llega a verse seco');
  assert.ok(fragmentShader.indexOf(mojado[0]) > fragmentShader.indexOf('uAsphaltNight * ( 1. - uAsphaltWet ) );'), 'después del piso seco');
  assert.match(fragmentShader, /float asphaltGrain = \.5;/);
  assert.match(fragmentShader, /asphaltGrain \+= \( dot\( sampledDiffuseColor\.rgb, vec3\( \.3, \.59, \.11 \) \) \/ max\( dot\( texture2D\( map, vMapUv, 5\. \)\.rgb/, 'el grano sale del mapa de color, sin textura nueva');
  assert.ok(fragmentShader.indexOf('asphaltGrain += ') > fragmentShader.indexOf('#include <map_fragment>'), 'después de leer el mapa');
  assert.equal(compile(busway).fragmentShader, fragmentShader, 'la troncal, con el mismo programa');
  assert.equal(road.roughness, 1, 'la rugosidad del material no se toca');
});

test('de noche la calzada lee el entorno borroso, sin volúmenes, y con una sola consulta', () => {
  const { road } = calzadas(), { fragmentShader } = compile(road);
  assert.ok(!fragmentShader.includes('#include <lights_fragment_maps>'));
  const consulta = fragmentShader.match(new RegExp(`vec3 iblRadiance = getIBLRadiance\\( geometryViewDir, geometryNormal, mix\\( material\\.roughness, max\\( material\\.roughness, ${numero} \\), uAsphaltNight \\) \\);`));
  assert.ok(consulta, 'la consulta de entorno usa de noche una rugosidad mínima');
  assert.equal(Number(consulta[1]), NIGHT_ROAD.environmentRoughness);
  assert.ok(NIGHT_ROAD.environmentRoughness >= .6 && NIGHT_ROAD.environmentRoughness < NIGHT_ROAD.dryRoughness, 'borroso, pero no más que la calzada seca');
  assert.ok(!fragmentShader.includes('getIBLRadiance( geometryViewDir, geometryNormal, material.roughness )'), 'no queda otra consulta nítida');
  assert.equal(fragmentShader.split('vec3 iblRadiance = ').length, 3, 'las mismas dos ramas del sombreador, ninguna consulta de más');
  assert.ok(fragmentShader.includes('iblIrradiance += getIBLIrradiance( geometryNormal );'), 'la luz difusa del entorno no cambia');
  const plain = new THREE.MeshStandardMaterial();
  assert.ok(compile(plain).fragmentShader.includes('#include <lights_fragment_maps>'), 'lo demás (carros, vidrios, andenes) sigue con su entorno');
});
