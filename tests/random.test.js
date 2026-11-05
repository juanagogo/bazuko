import assert from 'node:assert/strict';
import test from 'node:test';
import { mulberry32, pick, pickWithRandom, rand } from '../src/utils/random.js';

test('los generadores seeded son deterministas y conservan sus rangos', () => {
  const first = mulberry32(42), second = mulberry32(42);
  assert.deepEqual(Array.from({ length: 8 }, first), Array.from({ length: 8 }, second));
  assert.equal(rand(3, 7, () => 0.5), 5);
  assert.equal(pick(['a', 'b'], () => 0.75), 'b');
  assert.equal(pickWithRandom(() => 0, ['a', 'b']), 'a');
  assert.equal(pick([], () => 0), undefined);
});
