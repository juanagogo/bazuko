// El teclado: una tecla oprimida cuenta una sola vez, aunque se sostenga y el sistema la repita.
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { Input } from '../src/core/Input.js';

beforeEach(() => { globalThis.window = new EventTarget(); });

/** Un evento como el del navegador; `repeat` es la repetición automática de una tecla sostenida. */
const tecla = (type, code, { repeat = false } = {}) => {
  const event = new Event(type);
  Object.assign(event, { code, repeat, preventDefault() {} });
  window.dispatchEvent(event);
};
// Lo que pregunta Player para saltar.
const quiereSaltar = (input) => input.consumePress('Space') || input.consumePress('KeySpace');

test('con Espacio sostenido se salta una vez: la repetición del teclado no es otra pulsación', () => {
  const input = new Input();
  tecla('keydown', 'Space');
  assert.equal(quiereSaltar(input), true);
  input.endFrame();
  // El sistema repite la tecla cada 33 ms mientras siga oprimida: el personaje aterriza y no vuelve a saltar.
  for (let cuadro = 0; cuadro < 60; cuadro++) {
    tecla('keydown', 'Space', { repeat: true });
    assert.equal(quiereSaltar(input), false, `repetición ${cuadro}`);
    assert.equal(input.isDown('Space'), true, 'sostenida sigue oprimida: el salto largo la lee así');
    input.endFrame();
  }
  tecla('keyup', 'Space');
  assert.equal(input.isDown('Space'), false);
  tecla('keydown', 'Space');
  assert.equal(quiereSaltar(input), true, 'soltarla y volver a oprimirla sí es otro salto');
});

test('la misma regla para las demás teclas: sostener E no vuelve a interactuar, ni después de volver a la ventana', () => {
  const input = new Input();
  tecla('keydown', 'KeyE');
  assert.equal(input.consumePress('KeyE'), true);
  input.endFrame();
  tecla('keydown', 'KeyE', { repeat: true });
  assert.equal(input.consumePress('KeyE'), false);
  // Al perder la ventana se sueltan las teclas; si al volver la E sigue oprimida, su repetición no es una pulsación.
  window.dispatchEvent(new Event('blur'));
  tecla('keydown', 'KeyE', { repeat: true });
  assert.equal(input.consumePress('KeyE'), false);
  assert.equal(input.isDown('KeyE'), true);
});

test('Espacio activa un botón enfocado sin enviar un salto al jugador', () => {
  const input = new Input();
  const evento = new Event('keydown', { cancelable: true });
  Object.assign(evento, { code: 'Space' });
  const boton = { closest: selector => selector.split(',').some(s => s.trim() === 'button') ? boton : null };
  Object.defineProperty(evento, 'target', { value: boton });
  window.dispatchEvent(evento);
  assert.equal(evento.defaultPrevented, false);
  assert.equal(input.isDown('Space'), false);
  assert.equal(quiereSaltar(input), false);
});

test('ocultar la pestaña suelta el acelerador y descarta las pulsaciones pendientes aunque no llegue blur', t => {
  const doc = new EventTarget();
  globalThis.document = doc;
  t.after(() => { delete globalThis.document; });
  const input = new Input();
  tecla('keydown', 'KeyW');
  tecla('keydown', 'Space');
  doc.hidden = true;
  doc.dispatchEvent(new Event('visibilitychange'));
  doc.hidden = false;
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(input.isDown('KeyW'), false);
  assert.equal(quiereSaltar(input), false);
  tecla('keydown', 'KeyW');
  assert.equal(input.consumePress('KeyW'), true);
});
