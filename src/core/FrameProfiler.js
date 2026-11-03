import { percentile } from '../utils/percentile.js';

/** Tiempos de CPU optativos y acotados; renderer.render no mide la GPU. */
export class FrameProfiler {
  constructor(capacity = 1800) {
    this.capacity = capacity;
    this.enabled = false;
    this.samples = new Map();
    this.reset();
  }

  reset() {
    this.frames = 0; this.index = 0; this.active = false;
    for (const values of this.samples.values()) values.fill(0);
  }

  beginFrame(now = performance.now()) {
    this.active = this.enabled;
    if (!this.active) return;
    this.previous = this.started = now;
    for (const values of this.samples.values()) values[this.index] = 0;
  }

  mark(name, now = performance.now()) {
    if (!this.active) return;
    let values = this.samples.get(name);
    if (!values) this.samples.set(name, values = new Float32Array(this.capacity));
    values[this.index] += now - this.previous;
    this.previous = now;
  }

  endFrame(now = performance.now()) {
    if (!this.active) return;
    let total = this.samples.get('totalCPU');
    if (!total) this.samples.set('totalCPU', total = new Float32Array(this.capacity));
    total[this.index] = now - this.started;
    this.frames = Math.min(this.capacity, this.frames + 1);
    this.index = (this.index + 1) % this.capacity;
    this.active = false;
  }

  report() {
    const phases = {};
    for (const [name, values] of this.samples) {
      const sorted = Array.from(values.subarray(0, this.frames)).sort((a, b) => a - b);
      phases[name] = { p50: percentile(sorted, .5), p95: percentile(sorted, .95), p99: percentile(sorted, .99) };
    }
    return { frames: this.frames, capacity: this.capacity, unit: 'ms de CPU; no incluye tiempo GPU', phases };
  }
}
