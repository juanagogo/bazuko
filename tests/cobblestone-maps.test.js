import test from 'node:test';
import assert from 'node:assert/strict';
import { paintCobblestoneMaps } from '../src/world/bogota/CobblestoneMaps.js';

test('el adoquín conserva juntas estrechas y cantos continuos al repetir el atlas', () => {
  const size = 512, pixels = size * size;
  const maps = Array.from({ length: 3 }, () => new Uint8ClampedArray(pixels * 4));
  paintCobblestoneMaps(size, ...maps);
  const [color, relief, roughness] = maps;
  let joints = 0, jointTone = 0, faces = 0, faceTone = 0;
  for (let i = 0; i < color.length; i += 4) {
    if (roughness[i] >= 244) { joints++; jointTone += color[i]; }
    if (relief[i] >= 152) { faces++; faceTone += color[i]; }
  }
  assert.ok(joints > pixels * .04 && joints < pixels * .15, 'las juntas ocupan solo una fracción de la calzada');
  assert.ok(faces > pixels * .4, 'las superficies de las piedras predominan sobre los cantos');
  assert.ok(jointTone / joints > faceTone / faces * .7, 'la tierra entre las piedras conserva un tono mineral');
  for (const data of [color, relief]) {
    let across = 0, down = 0;
    for (let i = 0; i < size; i++) {
      across += Math.abs(data[i * size * 4] - data[(i * size + size - 1) * 4]);
      down += Math.abs(data[i * 4] - data[((size - 1) * size + i) * 4]);
    }
    assert.ok(Math.max(across, down) / size < 12, 'la repetición no deja una discontinuidad de color o relieve');
  }
});
