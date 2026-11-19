import * as THREE from 'three';

// Las superficies se generan una vez. Los modelos comparten los mapas incluso al cambiar de mano.
const smooth = THREE.MathUtils.smoothstep;

function hash(x, y) {
  const h = Math.imul(x, 0x1f123bb5) ^ Math.imul(y + 61, 0x5f356495);
  return ((Math.imul(h ^ h >>> 15, 0x2c1b3c6d) >>> 0) / 0xffffffff);
}

function noise(x, y) {
  const i = Math.floor(x), j = Math.floor(y);
  const fx = smooth(x - i, 0, 1), fy = smooth(y - j, 0, 1);
  const low = THREE.MathUtils.lerp(hash(i, j), hash(i + 1, j), fx);
  const high = THREE.MathUtils.lerp(hash(i, j + 1), hash(i + 1, j + 1), fx);
  return THREE.MathUtils.lerp(low, high, fy);
}

function paintedTexture(name, width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    paint(data, i, (x + .5) / width, (y + .5) / height, x, y);
    data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(new Uint8Array(data.buffer), width, height, THREE.RGBAFormat);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

let timber;
/** La cara pintada ocupa tres cuartos del atlas. El canto y el mango toman madera descubierta. */
export function timberMap() {
  return timber ??= paintedTexture('tabla-pintura-y-veta', 192, 256, (data, i, s, v, x, y) => {
    const painted = s < .75;
    const u = painted ? s / .75 : (s - .75) * 4;
    const bent = u + .028 * Math.sin(v * 10 + u * 4) + .019 * noise(u * 7, v * 5);
    const fibre = noise(bent * 81, v * 8), broad = noise(bent * 12, v * 4);
    const dust = hash(x, y) - .5;
    const pores = 1 - smooth(fibre, .08, .29);
    const grain = 36 * (broad - .5) + 24 * (fibre - .5) - 25 * pores + 13 * dust;
    const scar = .56 * noise(bent * 6 + 7, v * 4)
      + .27 * noise(bent * 22, v * 11) + .17 * fibre;
    const edge = Math.min(u, 1 - u, v * 3, (1 - v) * 3);
    const flake = smooth(fibre, .62, .88) * smooth(noise(bent * 23 + 1, v * 32), .50, .80);
    const pigment = painted ? smooth(scar + .27 * smooth(edge, 0, .12) - .08 * pores, .61, .65)
      * (1 - smooth(flake, .24, .69)) : 0;
    const patina = noise(bent * 3, v * 6) - .5;
    const green = 18 * patina + .49 * grain;
    const stain = painted ? Math.max(0, 1 - Math.hypot((u - .70) * 5, (v - .79) * 7) + .67 * (scar - .53)) : 0;
    data[i] = THREE.MathUtils.lerp(128 + grain, 60 + green, pigment) + 22 * stain;
    data[i + 1] = THREE.MathUtils.lerp(111 + grain, 130 + green, pigment) - 35 * stain;
    data[i + 2] = THREE.MathUtils.lerp(95 + grain, 119 + green, pigment) - 38 * stain;
  });
}

let satin;
export function satinMap() {
  return satin ??= paintedTexture('acero-satinado', 64, 128, (data, i, u, v, x, y) => {
    const brushed = noise(u * 45 + v * 14, v * 11);
    const grain = 6 * brushed + 5 * hash(x, y);
    const patina = 1 - smooth(noise(u * 9, v * 14), .15, .31);
    data[i] = 244 + grain - 15 * patina;
    data[i + 1] = 245 + grain - 26 * patina;
    data[i + 2] = 242 + grain - 36 * patina;
  });
}

let label;

/** El resto de papel conserva una sola franja ocre, gastada en los pliegues. */
export function returnLabelMap() {
  return label ??= paintedTexture('etiqueta-retornable', 128, 48, (data, i, u, v, x, y) => {
    const patina = (noise(u * 17, v * 6) - .5) * 22 + (hash(x, y) - .5) * 15;
    const edge = Math.min(v, 1 - v);
    const fold = (1 - smooth(edge, 0, .12)) * 15 + 19 * (1 - smooth(noise(u * 77 + v * 3, v * 4), .10, .18));
    const band = v > .09 && v < .37 && noise(u * 97, v * 14) > .09;
    const rgb = band ? [192, 147, 66] : [222, 204, 165];
    for (let c = 0; c < 3; c++) data[i + c] = rgb[c] + patina - fold;
  });
}
