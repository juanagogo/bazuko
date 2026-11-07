// Cuenta llamadas WebGL por cuadro en una ventana corta. Lo usa tools/benchmark-performance.mjs con
// page.evaluate(countGlCalls, ms): Playwright manda el texto de la función a la página, así que no puede
// usar nada de fuera de ella. Se exporta aparte para probarla en Node (tests/contar-llamadas-gl.test.js).
export const GL_CALLS = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'texImage2D', 'texSubImage2D', 'useProgram'];

// Corre dentro de la página. Envuelve los métodos del prototipo durante `ms` milisegundos, cuenta cuadros con
// requestAnimationFrame y devuelve los originales al terminar. `apply(this, arguments)` no crea arreglos.
export async function countGlCalls(ms) {
  // La lista se repite a propósito: la función corre en la página, sin los imports del módulo.
  const names = ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'texImage2D', 'texSubImage2D', 'useProgram'];
  const counts = Object.fromEntries(names.map(name => [name, 0]));
  const restore = [];
  for (const Context of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext].filter(Boolean)) {
    for (const name of names) {
      const original = Context.prototype[name];
      if (typeof original !== 'function') continue;
      Context.prototype[name] = function () { counts[name]++; return original.apply(this, arguments); };
      restore.push(() => { Context.prototype[name] = original; });
    }
  }
  let frames = 0, counting = true;
  const tick = () => { if (!counting) return; frames++; requestAnimationFrame(tick); };
  try {
    await new Promise(resolve => requestAnimationFrame(() => { for (const name of names) counts[name] = 0; requestAnimationFrame(tick); resolve(); }));
    await new Promise(resolve => setTimeout(resolve, ms));
  } finally {
    counting = false;
    for (const undo of restore) undo();
  }
  const glPerFrame = {};
  for (const name of names) glPerFrame[name] = frames ? +(counts[name] / frames).toFixed(1) : null;
  return { glPerFrame, glFrames: frames };
}
