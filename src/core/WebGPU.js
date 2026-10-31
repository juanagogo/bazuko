import { WebGPURenderer } from 'three/webgpu';

export const WEBGPU_QUALITY_KEY='bazuko.webgpu.graphics_quality';
export function createWebGPURenderer(options) {
  const renderer=new WebGPURenderer({...options,forceWebGL:false});
  // Three 0.186.1 instala un respaldo en su constructor. Esta rama es WebGPU exclusivamente.
  renderer._getFallback=null;
  return renderer;
}
export async function initializeWebGPU(renderer,gpu=globalThis.navigator?.gpu) {
  if(!gpu)throw new Error('WebGPU no está disponible. Usa un navegador y un equipo compatibles con WebGPU.');
  try {await renderer.init();}catch(cause){throw new Error('No se pudo iniciar WebGPU. Comprueba la aceleración gráfica y vuelve a intentarlo.',{cause});}
  if(!renderer.backend.isWebGPUBackend){renderer.dispose();throw new Error('Esta versión experimental requiere WebGPU.');}
  return renderer;
}
