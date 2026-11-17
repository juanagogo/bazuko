import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countGlCalls, GL_CALLS } from '../tools/contar-llamadas-gl.mjs';

// Un contexto WebGL falso en globalThis, con requestAnimationFrame a 10 ms, para correr la función como en la página.
function withFakeContext(run) {
  class FakeGL {
    constructor() { this.received = []; }
    drawElements(mode, count, type, offset) { this.received.push([mode, count, type, offset]); return 'dibujo'; }
    texSubImage2D(...args) { this.received.push(args); }
    useProgram(program) { this.program = program; }
  }
  const originals = Object.fromEntries(['drawElements', 'texSubImage2D', 'useProgram'].map(name => [name, FakeGL.prototype[name]]));
  const saved = { gl2: globalThis.WebGL2RenderingContext, gl1: globalThis.WebGLRenderingContext, raf: globalThis.requestAnimationFrame };
  globalThis.WebGL2RenderingContext = FakeGL;
  delete globalThis.WebGLRenderingContext;
  globalThis.requestAnimationFrame = callback => setTimeout(callback, 10);
  return run(FakeGL, originals).finally(() => {
    if (saved.gl2) globalThis.WebGL2RenderingContext = saved.gl2; else delete globalThis.WebGL2RenderingContext;
    if (saved.gl1) globalThis.WebGLRenderingContext = saved.gl1;
    if (saved.raf) globalThis.requestAnimationFrame = saved.raf; else delete globalThis.requestAnimationFrame;
  });
}

test('countGlCalls cuenta por cuadro, pasa argumentos y resultado, y devuelve el prototipo como estaba', () => withFakeContext(async (FakeGL, originals) => {
  const gl = new FakeGL();
  // Un "cuadro" del juego cada 10 ms: dos dibujos, una subida y un cambio de programa.
  const loop = setInterval(() => {
    assert.equal(gl.drawElements(4, 36, 5123, 0), 'dibujo');
    gl.drawElements(4, 6, 5123, 72);
    gl.texSubImage2D(3553, 0, 0, 0, 4, 4, 6408, 5126, null, 0);
    gl.useProgram('programa');
  }, 10);
  let result;
  try { result = await countGlCalls(300); } finally { clearInterval(loop); }

  assert.ok(result.glFrames >= 3, `cuadros contados: ${result.glFrames}`);
  assert.deepEqual(Object.keys(result.glPerFrame), GL_CALLS);
  // Con temporizadores reales (y la máquina ocupada) el reparto entre cuadros varía: la proporción entre llamadas no.
  assert.ok(result.glPerFrame.drawElements > 0, JSON.stringify(result.glPerFrame));
  assert.ok(Math.abs(result.glPerFrame.drawElements - 2 * result.glPerFrame.useProgram) <= .2);
  assert.equal(result.glPerFrame.drawArrays, 0, 'un método que el contexto no tiene queda en cero y no se crea');
  // Los envoltorios llamaron al original con el mismo this y los mismos argumentos.
  assert.deepEqual(gl.received.find(args => args.length === 4 && args[3] === 72), [4, 6, 5123, 72]);
  assert.equal(gl.received.find(args => args.length === 10).length, 10);
  assert.equal(gl.program, 'programa');
  // Al terminar el prototipo vuelve a tener los métodos originales: nada queda envuelto fuera de la ventana.
  for (const [name, original] of Object.entries(originals)) assert.equal(FakeGL.prototype[name], original, name);
  assert.equal(Object.hasOwn(FakeGL.prototype, 'drawArrays'), false);
}));

test('countGlCalls corre sola en la página: su texto no usa nada del módulo', () => {
  const source = countGlCalls.toString();
  assert.ok(!source.includes('GL_CALLS'), 'page.evaluate manda solo el texto de la función');
  for (const name of GL_CALLS) assert.ok(source.includes(`'${name}'`), name);
});
