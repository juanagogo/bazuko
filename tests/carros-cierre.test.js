import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { makeVehicle } from '../src/world/bogota/vehicles.js';

const compilar = material => {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  material.onBeforeCompile(shader);
  return shader;
};

test('la buseta lleva vidrio claro para ver a los pasajeros; los particulares siguen con el ahumado', () => {
  const buseta = makeVehicle('buseta', 4, { beams: false }), otra = makeVehicle('buseta', 8, { beams: false });
  const particular = makeVehicle('carro', 7, { model: 'sedanPopular', beams: false }), taxi = makeVehicle('taxi', 3, { beams: false });
  const [, vidrio] = buseta.wetMaterials, [, ahumado] = particular.wetMaterials;
  assert.equal(buseta.model, 'buseta');
  assert.ok(vidrio.opacity >= .45 && vidrio.opacity <= .5, `opacidad ${vidrio.opacity}`);
  assert.equal(ahumado.opacity, .8);
  assert.equal(taxi.wetMaterials[1], ahumado, 'el taxi comparte el vidrio de los particulares');
  assert.equal(otra.wetMaterials[1], vidrio, 'todas las busetas comparten un solo vidrio');
  const luz = c => c.r * .3 + c.g * .59 + c.b * .11;
  assert.ok(luz(vidrio.color) > luz(ahumado.color), 'el vidrio de la buseta es algo más claro');
  // Mismo programa: el vidrio de la buseta no suma uno.
  assert.equal(vidrio.customProgramCacheKey(), ahumado.customProgramCacheKey());
  const a = compilar(vidrio), b = compilar(ahumado);
  assert.equal(a.fragmentShader, b.fragmentShader);
  assert.equal(a.vertexShader, b.vertexShader);
  // La sombra de contacto del vidrio sigue entera aunque el vidrio sea más claro.
  assert.equal(a.uniforms.uVidrioBase.value, vidrio.opacity);
  assert.equal(b.uniforms.uVidrioBase.value, ahumado.opacity);
});

test('todo teléfono pintado en taxis y busetas lleva el prefijo 555, que no existe', async () => {
  const { TAXI_EMPRESAS, drawTaxiCompany, drawBusLivery, drawBusConduzco } = await import('../src/world/bogota/carLibreas.js');
  const textos = [];
  const nada = () => {};
  const ctx = new Proxy({}, {
    get: (blanco, clave) => {
      if (clave === 'fillText' || clave === 'strokeText') return texto => textos.push(String(texto));
      if (clave === 'createLinearGradient' || clave === 'createRadialGradient') return () => ({ addColorStop: nada });
      if (clave === 'measureText') return texto => ({ width: String(texto).length * 10 });
      if (clave in blanco) return blanco[clave];
      return nada;
    },
    set: (blanco, clave, valor) => { blanco[clave] = valor; return true; },
  });
  const celda = [0, 0, 300, 70];
  TAXI_EMPRESAS.forEach((empresa, i) => drawTaxiCompany(ctx, celda, empresa, i));
  for (let i = 0; i < 4; i++) drawBusLivery(ctx, { librea: celda, frase: celda, cartones: [], numero: celda, cola: celda }, i);
  drawBusConduzco(ctx, celda);
  const telefonos = textos.filter(texto => /TEL/.test(texto));
  assert.ok(telefonos.length >= TAXI_EMPRESAS.length + 4 + 1, telefonos.join(' | '));
  for (const texto of telefonos) assert.match(texto, /TEL\. 555 0\d \d\d$/, texto);
});

test('el articulado deja la vitrina: su rojo va un 15 % más apagado', async () => {
  const { readFileSync } = await import('node:fs');
  const { busGeometry } = await import('../src/world/bogota/BusBody.js');
  const spec = JSON.parse(readFileSync(new URL('../public/models/bus-articulado/bus.json', import.meta.url), 'utf8'));
  const color = busGeometry(spec).sections[0].paint.attributes.color;
  // El rojo de la carrocería es el tono rojo que más vértices pinta.
  const cuenta = new Map(), c = new THREE.Color();
  for (let i = 0; i < color.count; i++) {
    c.setRGB(color.getX(i), color.getY(i), color.getZ(i), THREE.LinearSRGBColorSpace);
    const hex = c.getHexString(THREE.SRGBColorSpace), [r, g, b] = [0, 2, 4].map(k => parseInt(hex.slice(k, k + 2), 16));
    if (r > 120 && r > 2 * g && r > 2 * b) cuenta.set(hex, (cuenta.get(hex) ?? 0) + 1);
  }
  const [rojo] = [...cuenta.entries()].sort((a, b) => b[1] - a[1])[0];
  const [r, g, b] = [0, 2, 4].map(k => parseInt(rojo.slice(k, k + 2), 16));
  const viveza = (r - Math.min(g, b)) / r;
  assert.ok(viveza > .7 && viveza < .82, `rojo #${rojo}: viveza ${viveza.toFixed(3)} (de fábrica 0,91)`);
});
