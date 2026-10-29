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
      `1% bajos ${recent.low1Percent.toFixed(1)} FPS · Tirones >100 ms ${recent.over100ms}`,
      `X ${position.x.toFixed(2)}  Y ${position.y.toFixed(2)}  Z ${position.z.toFixed(2)}`,
      `Dibujo ${info.calls} · Triángulos ${info.triangles.toLocaleString('es')}`,
      `Resolución ${renderer.instance.getPixelRatio().toFixed(2)}×`,
      ...(renderer.effectiveQuality ? [`Calidad efectiva ${renderer.effectiveQuality}`] : []),
      ...(renderer.culling ? [`Grupos en cámara ${renderer.culling.stats.visible}/${renderer.culling.stats.total} · Descartados ${renderer.culling.stats.culled}`] : []),
      ...(lighting ? [`Luces dinámicas ${lighting.pool.length} · Halos ${lighting.halos.mesh.count}`] : [])
    ].join('\n');
    return sampled;
  }

  dispose() {
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.element.remove();
  }
}
