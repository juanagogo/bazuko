import { percentile } from '../utils/percentile.js';

/** Mide intervalos reales de RAF, nunca el dt limitado de la simulación. */
export class FrameMetrics {
  constructor() { this.reset(); }

  reset() {
    this.recent = new Float32Array(600);
    this.recentIndex = this.recentCount = 0;
    this.previous = null;
    this.frames = 0;
    this.elapsed = 0;
    this.current = this.min = this.max = this.average = 0;
    this.frameMs = 0;
  }

  sample(now, active = true) {
    if (!active) { this.previous = null; return false; }
    const previous = this.previous;
    this.previous = now;
    if (previous === null || now <= previous) return false;
    this.frameMs = now - previous;
    this.current = 1000 / this.frameMs;
    this.frames++;
    this.elapsed += this.frameMs;
    this.min = this.frames === 1 ? this.current : Math.min(this.min, this.current);
    this.max = Math.max(this.max, this.current);
    this.average = this.frames * 1000 / this.elapsed;
    this.recent[this.recentIndex] = this.frameMs;
    this.recentIndex = (this.recentIndex + 1) % this.recent.length;
    this.recentCount = Math.min(this.recent.length, this.recentCount + 1);
    return true;
  }

  recentStats() {
    const values = Array.from(this.recent.subarray(0, this.recentCount)).sort((a, b) => a - b);
    const slowest = values.slice(-Math.max(1, Math.ceil(values.length * .01)));
    const lowMean = slowest.reduce((sum, value) => sum + value, 0) / slowest.length;
    return { frames: values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99),
      low1Percent: lowMean > 0 ? 1000 / lowMean : 0, over100ms: values.filter(value => value > 100).length };
  }
}
