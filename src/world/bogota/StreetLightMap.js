import * as THREE from 'three';
import { STREET_LAMP } from './StreetLampModel.js';
import { STREET_SODIUM_PERCENT, STREET_LIGHT_CELL, STREET_LIGHT_TEXTURE_WIDTH } from './StreetLightShader.js';
import { LUCES, LUZ_LOCALES, puestosDelMercado } from './vitrinas.js';
import { MARKET } from './EastZones.js';
import { withVisualRandom } from './VisualRandom.js';

/** Posiciones de las lentes y de los vanos que efectivamente se construyeron. Toda potencia se expresa en candelas. */
export function streetLightSources(district) {
  const sources = [], color = new THREE.Color(), secondary = new THREE.Color();
  const add = (x, y, z, range, tint, power, shape = -1) => {
    color.set(tint);
    sources.push({ x, y, z, range, radiance: [color.r * power, color.g * power, color.b * power], shape });
  };
  for (const { instance } of district.props ?? []) {
    const base = instance.group;
    if (!base || !instance.light?.userData.streetFixture) continue;
    const { x, y, z } = base.position, yaw = base.rotation.y, lens = STREET_LAMP.lens;
    const seed = Math.round(x * 37 + z * 71);
    const led = THREE.MathUtils.euclideanModulo(seed, 100) > STREET_SODIUM_PERCENT;
    add(x + Math.cos(yaw) * lens.x, y + lens.y - .06, z - Math.sin(yaw) * lens.x, 15.5,
      led ? '#e6f0ff' : '#ffd2a1', led ? 125 : 103, 0);
  }
  for (const { x, y, z } of district.lanternSpots ?? []) add(x, y, z, 9, '#ffcc91', 28);
  for (const shop of district.vitrinas ?? []) {
    if (shop.estado === 'cerrada') continue;
    const { x, z, dx, dz, ancho, interior } = shop;
    const light = LUCES[interior] ?? LUCES.abarrotes;
    const halfOpen = shop.estado === 'media', side = dx > 0 ? 1 : dx < 0 ? 2 : dz > 0 ? 3 : 4;
    // Se toma el color del tubo o de la bombilla que se ve al mirar esa misma vitrina.
    color.set(light.tono[0]).lerp(secondary.set(light.tono[1]), .28);
    const floor = district.getGroundHeight?.(x + dx * .38, z + dz * .38) ?? 0;
    const power = 34 * light.fuerza * (light.haciaAnden ?? 1) * (halfOpen ? LUZ_LOCALES.mediaPersiana : 1);
    add(x + dx * .16, floor + (halfOpen ? 1.13 : 2.14), z + dz * .16, halfOpen ? 6.5 : 8.5,
      color, power, side + Math.min(ancho * .4, 1.5) / 4);
  }
  for (const { x, z, kind } of district.puestos ?? []) {
    add(x, (district.getGroundHeight?.(x, z) ?? 0) + 1.86, z, 5.5, '#ffd49d', kind === 'chaza' ? 11 : 8);
  }
  if (district.map?.[MARKET.z0]?.[MARKET.x0] === 'plaza') for (const stall of puestosDelMercado()) {
    add(stall.x + stall.lado * .7, 1.86 + (stall.lado > 0 ? .07 : 0), stall.z + stall.frente * .95, 5.5, '#ffd9a7', 12);
  }
  return sources;
}

/**
 * Un texel de cabecera por celda, seguido de dos texeles por luminaria que llega a ella.
 * Se guarda también el ancho del vano al asignar celdas: una persona que cruce su borde conserva las mismas fuentes.
 */
export function buildStreetLightMap(district) {
  const sources = streetLightSources(district);
  if (!sources.length) return null;
  const reach = light => light.range + (light.shape >= 1 ? (light.shape % 1) * 4 : 0);
  const cell = STREET_LIGHT_CELL, width = STREET_LIGHT_TEXTURE_WIDTH;
  const x0 = Math.floor(Math.min(...sources.map(light => light.x - reach(light))) / cell) * cell;
  const z0 = Math.floor(Math.min(...sources.map(light => light.z - reach(light))) / cell) * cell;
  const columns = Math.floor((Math.max(...sources.map(light => light.x + reach(light))) - x0) / cell) + 1;
  const rows = Math.floor((Math.max(...sources.map(light => light.z + reach(light))) - z0) / cell) + 1;
  const cells = Array.from({ length: rows * columns }, () => []);
  let records = 0;
  for (const light of sources) {
    const radius = reach(light), cx = light.x - x0, cz = light.z - z0;
    for (let z = Math.floor((cz - radius) / cell); z <= Math.floor((cz + radius) / cell); z++) {
      for (let x = Math.floor((cx - radius) / cell); x <= Math.floor((cx + radius) / cell); x++) {
        const dx = Math.max(0, x * cell - cx, cx - (x + 1) * cell);
        const dz = Math.max(0, z * cell - cz, cz - (z + 1) * cell);
        if (dx * dx + dz * dz > radius * radius) continue;
        cells[z * columns + x].push(light);
        records++;
      }
    }
  }
  const height = Math.ceil((cells.length + 2 * records) / width);
  const data = new Float32Array(width * height * 4);
  let cursor = cells.length;
  for (let i = 0; i < cells.length; i++) {
    data[i * 4] = cursor;
    for (const light of cells[i]) {
      data.set([light.x, light.y, light.z, light.range, ...light.radiance, light.shape], cursor * 4);
      cursor += 2;
    }
    data[i * 4 + 1] = cursor;
  }
  const texture = withVisualRandom(() => new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType));
  texture.name = 'Luminarias y vitrinas de Bogotá';
  texture.needsUpdate = true;
  return { texture, grid: new THREE.Vector4(x0, z0, columns, rows), sources };
}
