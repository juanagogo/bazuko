// AudioContext mínimo para probar grafos de Web Audio en Node.
// Los parámetros toman el valor final de cada programación: las pruebas miran el destino, no la curva.

function param(value) {
  const schedule = (type) => function (v, time) { this.events.push({ type, value: v, time }); this.value = v; return this; };
  return {
    value,
    events: [],
    setValueAtTime: schedule('set'),
    linearRampToValueAtTime: schedule('ramp'),
    exponentialRampToValueAtTime: schedule('ramp'),
    setTargetAtTime: schedule('target')
  };
}

function node(kind, extra = {}) {
  return {
    kind,
    connections: [],
    connect(target) { this.connections.push(target); return target; },
    disconnect() { this.connections = []; },
    ...extra
  };
}

const source = (kind, extra) => node(kind, {
  started: false, stopAt: null,
  start() { this.started = true; },
  stop(t = 0) { this.stopAt = t; },
  ...extra
});

export function createFakeAudioContext() {
  const created = [];
  const track = (n) => (created.push(n), n);
  const destination = node('destination');
  const ctx = {
    state: 'running',
    currentTime: 0,
    sampleRate: 8000,
    destination,
    createGain: () => track(node('gain', { gain: param(1) })),
    createOscillator: () => track(source('oscillator', { type: 'sine', frequency: param(440), detune: param(0) })),
    createBiquadFilter: () => track(node('biquad', { type: 'lowpass', frequency: param(350), Q: param(1) })),
    createBufferSource: () => track(source('bufferSource', { buffer: null, loop: false })),
    createBuffer: (channels, length) => ({ getChannelData: () => new Float32Array(length) })
  };
  const master = node('master', { gain: param(1) });
  master.connect(destination);
  return { ctx, master, destination, created };
}
