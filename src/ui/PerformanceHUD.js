import { FrameMetrics } from '../core/FrameMetrics.js';

export class PerformanceHUD {
  constructor() {
    this.metrics = new FrameMetrics();
    this.nextPaint = 0;
    this.element = document.createElement('aside');
    this.element.id = 'performance-panel';
    this.element.setAttribute('aria-label', 'Rendimiento y coordenadas del jugador');
    this.element.innerHTML = '<pre></pre><button type="button" title="Reiniciar mínimos, máximos y promedio">Reiniciar medición</button>';
    this.text = this.element.querySelector('pre');
    this.element.querySelector('button').addEventListener('click', () => this.metrics.reset());
    document.body.appendChild(this.element);
    // Lectura mínima siempre visible en el borde superior derecho.
    this.readout = document.createElement('div');
    this.readout.id = 'top-readout';
    this.readout.setAttribute('aria-label', 'FPS y coordenadas');
    document.body.appendChild(this.readout);
    this.nextReadout = 0;
    // Oculto por defecto: F3 o Ajustes lo muestran. Las métricas se toman igual.
    let saved = null;
    try { saved = localStorage.getItem('bazuko.perf_visible'); } catch { /* sin almacenamiento */ }
    this.setVisible(saved === 'true', false);
    this.onVisibility = () => { this.metrics.previous = null; };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  setVisible(visible, save = true) {
    this.visible = !!visible;
    this.element.hidden = !this.visible;
    this.nextPaint = 0;
    if (save) try { localStorage.setItem('bazuko.perf_visible', String(this.visible)); } catch { /* sin almacenamiento */ }
    return this.visible;
  }

  toggle() { return this.setVisible(!this.visible); }

  update(now, position, renderer, active, lighting = null) {
    const sampled = this.metrics.sample(now, active && !document.hidden);
    if (this.readout && now >= this.nextReadout) {
      this.nextReadout = now + 250;
      this.readout.textContent = `${this.metrics.frames ? Math.round(this.metrics.current) : '—'} FPS · X ${position.x.toFixed(1)} · Z ${position.z.toFixed(1)}`;
    }
    if (now < this.nextPaint || this.visible === false) return sampled;
    this.nextPaint = now + 250; // 4 escrituras/s; las muestras sí se toman cada cuadro.
    const m = this.metrics;
    const fps = value => m.frames ? value.toFixed(1) : '—';
    const info = renderer.instance.info.render;
    const recent = m.recentStats();
    this.text.textContent = [
      `FPS actual ${fps(m.current)}${active ? '' : ' · pausa'}`,
      `Mín ${fps(m.min)} · Máx ${fps(m.max)}`,
      `Promedio ${fps(m.average)} · ${m.frameMs.toFixed(1)} ms`,
      `Últimos ${recent.frames} cuadros · p95 ${recent.p95.toFixed(1)} ms · p99 ${recent.p99.toFixed(1)} ms`,
      `1% bajos ${recent.low1Percent.toFixed(1)} FPS · Tirones >100 ms ${recent.over100ms} · Max ${m.maxFrameMs.toFixed(1)} ms`,
      `X ${position.x.toFixed(2)}  Y ${position.y.toFixed(2)}  Z ${position.z.toFixed(2)}`,
      `Dibujo ${info.drawCalls??info.calls} · Triángulos ${info.triangles.toLocaleString('es')}`,
      ...(renderer.diagnostics?[`Programas ${renderer.diagnostics.programs} · Pipelines ${renderer.diagnostics.pipelines} · CPU render max ${renderer.diagnostics.maxRenderMs.toFixed(1)} ms`]:[]),
      `Resolución ${renderer.instance.getPixelRatio().toFixed(2)}× · WebGPU`,
      ...(renderer.startupStats?.totalMs!==undefined?[`Carga ${(renderer.startupStats.totalMs/1000).toFixed(2)} s · ${renderer.startupStats.shaderFamilies??0} familias TSL`]:[]),
      ...(renderer.instance.info.memory?.total?[`Memoria GPU registrada ${(renderer.instance.info.memory.total/1048576).toFixed(1)} MiB · texturas ${((renderer.instance.info.memory.texturesSize??0)/1048576).toFixed(1)} MiB`]:[]),
      ...(renderer.effectiveQuality ? [`Calidad efectiva ${renderer.effectiveQuality}`] : []),
      ...(renderer.culling ? [`Grupos en cámara ${renderer.culling.stats.visible}/${renderer.culling.stats.total} · Descartados ${renderer.culling.stats.culled}`] : []),
      ...(lighting ? [`Luces dinámicas ${lighting.pool.length} · Halos ${lighting.halos.mesh.count}`] : [])
    ].join('\n');
    return sampled;
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.element.remove();
    this.readout?.remove();
  }
}
