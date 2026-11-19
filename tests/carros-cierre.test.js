import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle } from '../src/world/bogota/vehicles.js';

const compilar = material => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
};


test('de noche el amarillo del taxi se separa de su gris; los rojos y naranjas de los particulares no', async () => {
  const { REFUERZO_AMARILLO_NOCHE } = await import('../src/world/bogota/carUso.js');
  const { AMARILLOS_TAXI } = await import('../src/world/bogota/carVariantes.js');
  assert.ok(REFUERZO_AMARILLO_NOCHE >= .1 && REFUERZO_AMARILLO_NOCHE <= .2);
  const taxi = makeVehicle('taxi', 3, { beams: false }), chapa = compilar(taxi.wetMaterials[0]).fragmentShader;
  assert.ok(chapa.includes(`usoSeparar = ${REFUERZO_AMARILLO_NOCHE} * usoAmarillo * saturate( ( uSunSkyFloor - .4 ) / .22 )`), 'solo de noche y con una sola constante');
  assert.ok(chapa.includes('( 1. + usoSeparar )') && chapa.includes('outgoingLight = usoS * usoS;\n      }\n      #include <opaque_fragment>'), 'se separa la luz que sale del esmalte');
  // El mismo cálculo del sombreador, en sRGB aproximado: qué tonos toca y cuánto.
  const grados = hex => {
    const c = new THREE.Color(hex), s = [c.r, c.g, c.b].map(Math.sqrt), alto = Math.max(...s), rango = alto - Math.min(...s);
    return 60 * (s[0] >= alto ? (s[1] - s[2]) / rango : 2 + (s[2] - s[0]) / rango);
  };
  for (const hex of AMARILLOS_TAXI) assert.ok(grados(hex) > 37 && grados(hex) < 58, `${hex} queda dentro: ${grados(hex)}`);
  for (const hex of ['#b0261c', '#c4561c', '#8a3a22', '#d06a2a']) assert.ok(grados(hex) < 32, `${hex} queda fuera: ${grados(hex)}`);
});

test('la luz de los faroles en el piso se adelanta un trecho fijo y no por pendiente: no tapa la parte baja de las ruedas', async () => {
  const { Bogota } = await import('../src/world/districts/Bogota.js');
  const { addStreetDetails } = await import('../src/world/bogota/StreetDetails.js');
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  Object.assign(city, { props: [], treePlan: [], vegetationPlan: { clusters: [] }, vendors: [], fireBarrels: [],
    signals: { poles: [] }, renderSectors: [], isNearReserved: () => false, buildingVisibility: { buildings: [] } });
  const { map } = city;
  for (let z = 2; z < map.length - 2 && !city.lanternSpots; z++) for (let x = 2; x < map[0].length - 2; x++) {
    if (map[z][x] === 'sidewalk' && map[z][x + 1] === 'road') { city.lanternSpots = [new THREE.Vector3(x * 2, 3.5, z * 2)]; break; }
  }
  addStreetDetails(city);
  let luz = null;
  city.group.traverse(mesh => { if (mesh.material?.name === 'Calle: luz de faroles') luz = mesh.material; });
  assert.ok(luz, 'no hay luz de faroles');
  // Con pendiente, a ras de piso el plano se adelantaba palmos y pintaba encima de llantas y postes.
  assert.equal(luz.polygonOffsetFactor, 0);
  assert.ok(luz.polygonOffset && luz.polygonOffsetUnits < 0);
});

test('una sola lista de amarillos de taxi, y el mapa del taxi con la edad del modelo no se pinta porque nadie lo usa', async () => {
  const { AMARILLOS_TAXI } = await import('../src/world/bogota/carVariantes.js');
  const { TAXI_YELLOWS } = await import('../src/world/bogota/carLibreas.js');
  const { getDetailMap } = await import('../src/world/bogota/carDetail.js');
  const { CAR_MODELS } = await import('../src/world/bogota/carModels.js');
  const { getCarBody } = await import('../src/world/bogota/VehicleBody.js');
  assert.equal(AMARILLOS_TAXI, TAXI_YELLOWS);
  for (const model of ['citadino', 'sedanPopular']) {
    const taxi = makeVehicle('taxi', 5, { model, beams: false });
    assert.equal(taxi.wetMaterials[0].map.name, `Detalle ${model}:taxi@0.62`);
    const sobra = getDetailMap(CAR_MODELS[model], getCarBody(model), 'taxi', undefined, { sinPintar: true });
    assert.equal(sobra.name, `Detalle ${model}:taxi`);
    assert.ok(sobra.userData.sinPintar, `${model}: el mapa que nadie muestra no se pinta`);
  }
});

test('el charco del farol de poste baja del andén a la calzada: no flota sobre el asfalto', async () => {
  const { Bogota } = await import('../src/world/districts/Bogota.js');
  const { addStreetDetails } = await import('../src/world/bogota/StreetDetails.js');
  const city = new Bogota();
  city.map = city._layout();
  city.groundMaterials = {};
  Object.assign(city, { treePlan: [], vegetationPlan: { clusters: [] }, vendors: [], fireBarrels: [],
    signals: { poles: [] }, renderSectors: [], isNearReserved: () => false, buildingVisibility: { buildings: [] } });
  const { map } = city;
  let spot = null;
  for (let z = 4; z < map.length - 4 && !spot; z++) for (let x = 4; x < map[0].length - 4; x++) {
    if (map[z][x] === 'sidewalk' && map[z][x + 1] === 'road' && map[z][x + 2] === 'road') { spot = { x: x * 2, z: z * 2 }; break; }
  }
  const group = new THREE.Group();
  group.position.set(spot.x, city.getGroundHeight(spot.x, spot.z), spot.z);
  city.props = [{ instance: { group } }];
  addStreetDetails(city);
  const cuadros = [];
  city.group.traverse(mesh => {
    if (mesh.material?.name !== 'Calle: luz de faroles') return;
    const p = mesh.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 4) {
      const xs = [0, 1, 2, 3].map(k => p.getX(i + k)), zs = [0, 1, 2, 3].map(k => p.getZ(i + k));
      // En el mismo lote van las manchas de los puestos del mercado, lejos de aquí: solo cuentan las de este poste.
      if (Math.hypot((Math.min(...xs) + Math.max(...xs)) / 2 - spot.x, (Math.min(...zs) + Math.max(...zs)) / 2 - spot.z) > 16) continue;
      cuadros.push({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y: p.getY(i) });
    }
  });
  const alturas = [];
  for (const c of cuadros) for (let x = Math.ceil(c.x0 / 2) * 2; x < c.x1; x += 2) for (let z = Math.ceil(c.z0 / 2) * 2; z < c.z1; z += 2) {
    if (map[z / 2]?.[x / 2] === 'road') alturas.push(c.y - city.getGroundHeight(x, z));
  }
  assert.ok(alturas.length > 4, 'el charco cae también en la calzada');
  for (const alto of alturas) assert.ok(Math.abs(alto - .03) < .01, `sobre la calzada a ${alto.toFixed(3)} m`);
  assert.ok(group.position.y > .1, 'el poste está en un andén más alto que la calzada');
  const area = cuadros.reduce((suma, c) => suma + (c.x1 - c.x0) * (c.z1 - c.z0), 0);
  assert.ok(Math.abs(area - 15.6 ** 2) < .01, `el charco cubre ${area.toFixed(2)} m² y no el cuadro entero`);
  assert.ok(cuadros.length <= 12, `${cuadros.length} cuadros: los tiles vecinos a la misma altura no se juntan`);
});


test('el rojo de los stops en el piso va a la mitad con el piso seco, y el lavado conserva polvo abajo', async () => {
  const { layCarLight } = await import('../src/world/bogota/carBeam.js');
  const { streetWetness } = await import('../src/character/streetMaterials.js');
  const { mugreDe } = await import('../src/world/bogota/carUso.js');
  const carro = makeVehicle('carro', 11, { model: 'sedanPopular' });
  layCarLight(carro.beam, carro.length);
  layCarLight(carro.beam, carro.length);
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.basic.vertexShader, fragmentShader: THREE.ShaderLib.basic.fragmentShader };
  carro.beam.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uPisoMojado, streetWetness);
  assert.equal(shader.fragmentShader.split('uPisoMojado').length - 1, 2, 'el gancho se pone una sola vez');
  assert.ok(shader.fragmentShader.includes('mix( .5, 1., uPisoMojado )'));
  assert.ok(shader.fragmentShader.includes('vFogDepth'), 'sigue apagándose en la niebla');
  assert.notEqual(carro.beam.material.customProgramCacheKey(), 'luz-aditiva-niebla', 'no comparte programa con la luz de los faroles');
  const niveles = new Set(Array.from({ length: 64 }, (_, i) => mugreDe(i << 23)));
  assert.ok(Math.min(...niveles) >= .65, 'hasta el recién lavado lleva su película de polvo');
});

test('con el piso mojado la chapa sale más oscura y lisa y el vidrio refleja más', async () => {
  const { streetWetness } = await import('../src/character/streetMaterials.js');
  const carro = makeVehicle('carro', 7, { model: 'sedanPopular', beams: false }), [esmalte, vidrio] = carro.wetMaterials;
  const chapa = compilar(esmalte), luna = compilar(vidrio);
  assert.equal(chapa.uniforms.uMojado, streetWetness);
  assert.equal(luna.uniforms.uMojado, streetWetness);
  assert.ok(chapa.fragmentShader.includes('diffuseColor.rgb *= 1. - ( .3 + .15 * usoVivo ) * uMojado'), 'esmalte de un 30 a un 45 % más oscuro');
  assert.ok(chapa.fragmentShader.includes('roughnessFactor *= 1. - .6 * uMojado'));
  assert.ok(luna.fragmentShader.includes('( 1. + 1.2 * uMojado )'), 'el vidrio mojado refleja más');
});

