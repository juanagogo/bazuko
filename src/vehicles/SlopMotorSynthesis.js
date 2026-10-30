// Slop New York 09d27e0 (MIT). Combustion voices; compatible with the existing master mixer.
// Shared procedural audio and continuously running, mono vehicle voices. Spatial placement and overall mixing
// belong to the caller; every source and processing node created by a voice is released by dispose().

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Movement and tone controls only need one value per audio block. Set every parameter on these nodes:
// even an unused a-rate parameter can make the browser recalculate spatial/filter math for every sample.
// Oscillator modulation and gain envelopes keep their default audio rate.
export function setControlRate(...parameters) {
  for (const parameter of parameters) {
    if (parameter?.automationRate !== undefined) parameter.automationRate = 'k-rate';
  }
}

function randomSequence(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalizeLoop(buffer, rms, ceiling = 0.9) {
  const data = buffer.getChannelData(0);
  let mean = 0;
  for (let i = 0; i < data.length; i++) mean += data[i];
  mean /= data.length;
  let energy = 0, peak = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] -= mean;
    energy += data[i] * data[i];
    peak = Math.max(peak, Math.abs(data[i]));
  }
  const scale = Math.min(ceiling / Math.max(peak, 0.0001), rms / Math.max(Math.sqrt(energy / data.length), 0.0001));
  for (let i = 0; i < data.length; i++) data[i] *= scale;
  return buffer;
}

function combustionBuffers(context, cylinders, diesel, seed) {
  const rate = context.sampleRate;
  const referenceRPM = 1200;
  const highReferenceRPM = diesel ? 2400 : 3600;
  const cycles = 20; // Twenty complete four-stroke cycles, not a single repeating waveform.
  const mechanical = context.createBuffer(1, Math.round(cycles * 120 / referenceRPM * rate), rate);
  const random = randomSequence(seed);
  const cylinderStrength = Array.from({ length: cylinders }, () => 0.83 + random() * 0.34);
  const cylinderDelay = Array.from({ length: cylinders }, () => (random() - 0.5) * 0.035);
  const resonance = (diesel ? 93 : cylinders === 6 ? 118 : 145) * (0.97 + random() * 0.06);
  const duration = Math.round(rate * (diesel ? 0.062 : 0.048));

  function exhaustBuffer(rpm, clatter) {
    const length = Math.round(cycles * 120 / rpm * rate);
    const buffer = context.createBuffer(1, length, rate);
    const pressure = buffer.getChannelData(0);
    const interval = length / (cycles * cylinders);
    // Separate timing from sample noise so both RPM banks share the same firing phases and cylinder balance.
    const timing = randomSequence(seed), noise = randomSequence(seed ^ 0x65786861);
    for (let firing = 0; firing < cycles * cylinders; firing++) {
      const cylinder = firing % cylinders;
      let index = Math.round((firing + cylinderDelay[cylinder] + (timing() - 0.5) * 0.012) * interval);
      index = (index + length) % length;
      const strength = cylinderStrength[cylinder] * (0.92 + timing() * 0.16);
      const decay = (diesel ? 0.019 : 0.012) * (0.95 + timing() * 0.1);
      let lowNoise = 0;
      for (let i = 0; i < duration; i++) {
        const t = i / rate;
        const white = noise() * 2 - 1;
        lowNoise += (white - lowNoise) * 0.16;
        const attack = 1 - Math.exp(-t / 0.00065);
        const tail = Math.exp(-t / decay);
        // Keep the exhaust's resonance and decay in seconds as firing frequency increases. Pitching one
        // idle loop through the entire rev range would shrink every pulse into a thin, high-pitched buzz.
        const release = Math.exp(-t / 0.0022) - 0.36 * Math.exp(-t / 0.009);
        const body = Math.sin(2 * Math.PI * resonance * t) * tail * 0.34;
        pressure[index] += strength * attack * (release + body + lowNoise * tail * (diesel ? 0.5 : 0.28));
        if (clatter) {
          // Injector/valve impacts contain much more noise than ringing, with a separate delayed tappet click.
          const valveTime = Math.max(0, t - 0.009);
          const valve = t > 0.009 ? Math.exp(-valveTime / 0.0016) * (white * 0.65 + Math.sin(valveTime * 14900) * 0.12) : 0;
          clatter[index] += strength * (white * attack * Math.exp(-t / (diesel ? 0.0036 : 0.0022)) + valve * 0.35);
        }
        if (++index === length) index = 0;
      }
    }
    return normalizeLoop(buffer, 0.30);
  }

  return {
    exhaust: exhaustBuffer(referenceRPM, mechanical.getChannelData(0)),
    highExhaust: exhaustBuffer(highReferenceRPM),
    mechanical: normalizeLoop(mechanical, diesel ? 0.22 : 0.18, 0.85),
    referenceRPM,
    highReferenceRPM
  };
}

export function createSynthResources(context) {
  const sampleRate = context.sampleRate;
  const noise = context.createBuffer(1, Math.round(sampleRate * 2), sampleRate);
  const samples = noise.getChannelData(0);
  const random = randomSequence(0x6e796361);
  for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;

  // Warm each filter with one complete cycle before writing. Its state then wraps with the buffer, so the loop
  // boundary is an ordinary noise sample transition rather than a restart of the filter or an amplitude fade.
  const coefficient = Math.exp(-2 * Math.PI * 7000 / sampleRate);
  for (let pass = 0; pass < 2; pass++) {
    let previous = 0;
    for (let i = 0; i < samples.length; i++) previous += (samples[i] - previous) * (1 - coefficient);
    for (let i = 0; i < samples.length; i++) {
      previous += (samples[i] - previous) * (1 - coefficient);
      samples[i] = previous;
    }
  }
  let mean = 0;
  for (let i = 0; i < samples.length; i++) mean += samples[i];
  mean /= samples.length;
  let peak = 0;
  let energy = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] -= mean;
    peak = Math.max(peak, Math.abs(samples[i]));
    energy += samples[i] * samples[i];
  }
  const scale = Math.min(0.95 / peak, 0.30 / Math.sqrt(energy / samples.length));
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;

  return {
    noise,
    combustion: {
      sedan: combustionBuffers(context, 4, false, 0x73656461),
      suv: combustionBuffers(context, 6, false, 0x73757631),
      bus: combustionBuffers(context, 6, true, 0x64696573)
    },
    voiceSerial: 0
  };
}

// Keep only meaningful target changes. Replacing future events bounds the scheduling horizon; setTargetAtTime
// starts from the value reached by the preceding ramp, including when an update interrupts that ramp.
// Bring a future target forward even if its value is unchanged (for example, when a shift is interrupted).
function smoothParameter(parameter, timeConstant = 0.07, epsilon = 0.0001, snapInitial = false) {
  let target = NaN, scheduledTime = -Infinity;
  return (value, now, smoothing = timeConstant) => {
    if (Math.abs(value - target) < epsilon && now >= scheduledTime) return;
    parameter.cancelScheduledValues(now);
    if (snapInitial && Number.isNaN(target)) parameter.setValueAtTime(value, now);
    else parameter.setTargetAtTime(value, now, smoothing);
    target = value;
    scheduledTime = now;
  };
}

export function createMotorVoice(context, resources, kind, output) {
  if (!['sedan', 'suv', 'bus'].includes(kind)) {
    throw new RangeError(`Unknown motor voice: ${kind}`);
  }
  const nodes = [];
  const sources = [];
  const serial = resources.voiceSerial = (resources.voiceSerial || 0) + 1;
  let disposed = false;
  let lastSeed = NaN;
  let variation = 0.5;
  const own = (node) => { nodes.push(node); return node; };
  const gain = (value = 0) => {
    const node = own(context.createGain());
    node.gain.value = value;
    return node;
  };
  const filter = (type, frequency, q = 0.7) => {
    const node = own(context.createBiquadFilter());
    setControlRate(node.frequency, node.detune, node.Q, node.gain);
    node.type = type;
    node.frequency.value = Math.min(frequency, context.sampleRate * 0.45);
    node.Q.value = q;
    return node;
  };
  const oscillator = (type, frequency) => {
    const node = own(context.createOscillator());
    if (typeof type === 'string') node.type = type;
    else node.setPeriodicWave(type);
    node.frequency.value = frequency;
    sources.push(node);
    return node;
  };
  const loop = (buffer = resources.noise) => {
    const node = own(context.createBufferSource());
    node.buffer = buffer;
    node.loop = true;
    sources.push(node);
    return node;
  };
  const mix = gain();
  mix.channelCount = 1;
  mix.channelCountMode = 'explicit';
  mix.connect(output);
  let render;

  if (kind === 'sedan' || kind === 'suv' || kind === 'bus') {
    const bus = kind === 'bus';
    const suv = kind === 'suv';
    const sound = resources.combustion[kind];
    const bankRatio = sound.highExhaust.duration / sound.exhaust.duration;
    const idle = bus ? 620 : suv ? 710 : 780;
    const ratios = bus ? [320, 205, 145, 108, 82] : [500, 325, 230, 170, 130];
    let gear = 0, rpm = idle, throttle = 0, previousTime = -1, gearLock = 0, shiftUntil = 0;
    const exhaust = loop(sound.exhaust);
    const highExhaust = loop(sound.highExhaust);
    highExhaust.playbackRate.value = bankRatio;
    const lowBankGain = gain(1), highBankGain = gain();
    const exhaustFilter = filter('lowpass', 500, 0.65);
    const exhaustGain = gain();
    exhaust.connect(lowBankGain).connect(exhaustFilter);
    highExhaust.connect(highBankGain).connect(exhaustFilter);
    exhaustFilter.connect(exhaustGain).connect(mix);
    const mechanism = loop(sound.mechanical);
    const mechanismFilter = filter('bandpass', bus ? 1400 : 1700, 0.45);
    const mechanismGain = gain();
    mechanism.connect(mechanismFilter).connect(mechanismGain).connect(mix);
    const road = loop();
    const roadHighpass = filter('highpass', 120, 0.5);
    const roadLowpass = filter('lowpass', 1400, 0.5);
    const roadGain = gain();
    road.connect(roadHighpass).connect(roadLowpass).connect(roadGain).connect(mix);
    const exhaustRate = smoothParameter(exhaust.playbackRate, 0.035, 0.0005, true);
    const highExhaustRate = smoothParameter(highExhaust.playbackRate, 0.035, 0.0005 * bankRatio, true);
    const lowBankLevel = smoothParameter(lowBankGain.gain, 0.07, 0.0001, true);
    const highBankLevel = smoothParameter(highBankGain.gain, 0.07, 0.0001, true);
    const mechanicalRate = smoothParameter(mechanism.playbackRate, 0.035, 0.0005, true);
    const exhaustCutoff = smoothParameter(exhaustFilter.frequency, 0.07, 1);
    const exhaustLevel = smoothParameter(exhaustGain.gain, 0.055);
    const mechanicalFrequency = smoothParameter(mechanismFilter.frequency, 0.12, 1);
    const mechanicalLevel = smoothParameter(mechanismGain.gain, 0.09);
    const roadLevel = smoothParameter(roadGain.gain, 0.18);
    const roadFrequency = smoothParameter(roadLowpass.frequency, 0.18, 1);
    const noiseRate = smoothParameter(road.playbackRate, 0.12, 0.001);
    render = (speed, load, doppler, now) => {
      const first = previousTime < 0;
      const dt = first ? 0.1 : clamp(now - previousTime, 0, 0.5);
      previousTime = now;
      throttle = first ? load : throttle + (load - throttle) * (1 - Math.exp(-dt / (load > throttle ? 0.14 : 0.32)));
      const shiftRPM = (bus ? 1700 : 2700) + throttle * (bus ? 950 : 2900);
      let upshift = false;
      if (speed < 0.6) {
        // A fresh launch starts in first immediately, even after a hard stop from top gear.
        gear = 0;
        gearLock = shiftUntil = 0;
      } else if (first) {
        while (gear < ratios.length - 1 && speed * ratios[gear] > shiftRPM) gear++;
      } else if (now >= gearLock) {
        const oldGear = gear;
        const wheelRPM = speed * ratios[gear];
        if (gear < ratios.length - 1 && wheelRPM > shiftRPM) gear++;
        else if (gear > 0 && speed * ratios[gear - 1] < shiftRPM * 0.82
          && (wheelRPM < (bus ? 1000 : 1600) || (throttle > 0.65 && wheelRPM < shiftRPM * 0.55))) gear--;
        if (gear !== oldGear) {
          gearLock = now + 0.65;
          upshift = gear > oldGear;
          if (upshift) shiftUntil = now + 0.16;
        }
      }
      // Wheel-coupled RPM, with torque-converter slip at low speed. Coasting retains engine braking rather than
      // dropping straight to idle; hysteresis and a minimum gear dwell prevent hunting around a shift boundary.
      const slip = throttle * (bus ? 600 : 1500) * Math.max(0.12, 1 - speed / 16);
      const targetRPM = clamp(Math.max(idle, speed * ratios[gear]) + slip, idle, bus ? 2900 : 6200);
      // The playback-rate ramps provide the short RPM fall on an upshift; do not soften it twice.
      rpm = first || upshift ? targetRPM : rpm + (targetRPM - rpm) * (1 - Math.exp(-dt / (targetRPM > rpm ? 0.12 : 0.075)));
      const pitch = (0.97 + variation * 0.06) * doppler;
      const effort = Math.min(1, throttle + speed * 0.005);
      const rolling = Math.min(1.35, speed / 28);
      exhaustRate(rpm / sound.referenceRPM * pitch, now);
      highExhaustRate(rpm / sound.referenceRPM * pitch * bankRatio, now);
      // Same cycle count, starting phase and proportional rates keep the firings in step. Equal-power
      // blending avoids a volume dip between the banks' different exhaust resonances.
      const bank = clamp((rpm - sound.referenceRPM) / (sound.highReferenceRPM - sound.referenceRPM), 0, 1);
      const blend = bank * bank * (3 - 2 * bank);
      lowBankLevel(Math.cos(blend * Math.PI / 2), now);
      highBankLevel(Math.sin(blend * Math.PI / 2), now);
      mechanicalRate(rpm / sound.referenceRPM * pitch, now);
      const cutoff = (bus ? 480 : 650) + rpm * 0.24;
      const exhaustIdle = bus ? 0.16 : suv ? 0.13 : 0.11;
      const mechanicalIdle = bus ? 0.10 : 0.03;
      if (upshift) {
        const unloaded = Math.min(effort, 0.06);
        exhaustCutoff(cutoff + unloaded * (bus ? 1400 : 1800), now, 0.012);
        exhaustLevel(exhaustIdle + unloaded * (bus ? 0.22 : 0.26), now, 0.012);
        mechanicalLevel(mechanicalIdle + unloaded * (bus ? 0.15 : 0.085), now, 0.012);
      }
      // Schedule unloading and recovery on the audio clock. Updates during the shift can revise
      // the recovery target without cancelling the cut, even though controls run at only 10 Hz.
      const loadTime = Math.max(now, shiftUntil);
      const recovery = now < shiftUntil ? 0.045 : undefined;
      exhaustCutoff(cutoff + effort * (bus ? 1400 : 1800), loadTime, recovery);
      exhaustLevel(exhaustIdle + effort * (bus ? 0.22 : 0.26), loadTime, recovery);
      mechanicalFrequency(((bus ? 1050 : 1250) + rpm * 0.12) * doppler, now);
      mechanicalLevel(mechanicalIdle + effort * (bus ? 0.15 : 0.085), loadTime, recovery);
      // Keep tire noise low and soft; its level follows road speed, not throttle release.
      roadLevel(Math.pow(rolling, 1.25) * (bus ? 0.16 : 0.10), now);
      roadFrequency((900 + Math.min(1, rolling) * 1000) * doppler, now);
      noiseRate(doppler * (0.96 + variation * 0.08), now);
    };
  }

  function update({ speed = 0, load = 0, doppler = 1, seed = 0, verticalSpeed = 0 } = {}, now = context.currentTime) {
    if (disposed) return;
    const safeSeed = Number.isFinite(seed) ? seed : 0;
    if (safeSeed !== lastSeed) {
      const hash = Math.sin((safeSeed % 1048576) * 12.9898 + 78.233) * 43758.5453;
      variation = hash - Math.floor(hash);
      lastSeed = safeSeed;
    }
    const time = Math.max(context.currentTime, Number.isFinite(now) ? now : context.currentTime);
    render(
      Number.isFinite(speed) ? Math.min(Math.abs(speed), 100) : 0,
      Number.isFinite(load) ? clamp(load, 0, 1) : 0,
      Number.isFinite(doppler) ? clamp(doppler, 0.5, 2) : 1,
      time,
      Number.isFinite(verticalSpeed) ? clamp(verticalSpeed, -30, 30) : 0
    );
  }

  const startTime = context.currentTime;
  mix.gain.setTargetAtTime(1, startTime, 0.04);
  for (const source of sources) {
    if (source.buffer) source.start(startTime, ((serial * 0.61803398875) % 1) * source.buffer.duration);
    else source.start(startTime);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const source of sources) source.stop();
    for (const node of nodes) node.disconnect();
  }

  return { update, dispose };
}
