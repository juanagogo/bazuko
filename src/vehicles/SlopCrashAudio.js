// Crash synthesis adapted from Slop New York 1b54e165/audio-events.js (MIT).
const TAU = Math.PI * 2;
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, finite(value)));
const smoothstep = (value) => { const x = clamp(value); return x * x * (3 - 2 * x); };

function randomSource(seed) {
  let state = (finite(seed, 1) * 2654435761) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x7feb352d);
  state = Math.imul(state ^ (state >>> 15), 0x846ca68b);
  state ^= state >>> 16;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function makeBuffer(ctx, duration, synthesize, peak = 0.6) {
  const buffer = ctx.createBuffer(1, Math.ceil(duration * ctx.sampleRate), ctx.sampleRate);
  const samples = buffer.getChannelData(0);
  let maximum = 0, mean = 0;
  for (let i = 0; i < samples.length; i++) {
    samples[i] = synthesize(i / ctx.sampleRate, i);
    mean += samples[i];
  }
  mean /= samples.length;
  for (let i = 0; i < samples.length; i++) {
    // A short endpoint fade removes clicks even when a pitched component ends between zero crossings.
    const fade = Math.min(1, i / (ctx.sampleRate * 0.002), (samples.length - 1 - i) / (ctx.sampleRate * 0.012));
    samples[i] = (samples[i] - mean) * fade;
    maximum = Math.max(maximum, Math.abs(samples[i]));
  }
  const scale = maximum > 0 ? peak / maximum : 0;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
  return buffer;
}

function crashBody(ctx, seed) {
  const random = randomSource(seed);
  const coefficients = [45, 240 + random() * 70, 950].map((frequency) => 1 - Math.exp(-TAU * frequency / ctx.sampleRate));
  const bands = [0, 0, 0];
  const rebound = 0.018 + random() * 0.018;
  const decay = 0.026 + random() * 0.012;
  return makeBuffer(ctx, 0.28, (t) => {
    const noise = random() * 2 - 1;
    for (let i = 0; i < bands.length; i++) bands[i] += (noise - bands[i]) * coefficients[i];
    const contact = (1 - Math.exp(-t * 1600)) * Math.exp(-t / decay);
    const second = Math.max(0, t - rebound);
    const compression = (1 - Math.exp(-second * 700)) * Math.exp(-second / 0.034);
    // Broad, damped bumper/body pressure with a second contact; there is no pitched kick or falling oscillator.
    return (bands[1] - bands[0]) * (contact * 1.8 + compression * 0.65)
      + (bands[2] - bands[1]) * (contact * 0.6 + compression * 0.18);
  }, 0.7);
}

function crashMetal(ctx, seed) {
  const random = randomSource(seed);
  const creases = Array.from({ length: 7 }, () => ({
    time: 0.008 + random() ** 2 * 0.19,
    decay: 0.009 + random() * 0.020,
    level: 0.25 + random() * 0.65
  }));
  const modes = [430, 790, 1370, 2380].map((frequency, i) => {
    const radius = Math.exp(-1 / (ctx.sampleRate * (0.012 + random() * 0.016)));
    return { a: 2 * radius * Math.cos(TAU * frequency * (0.88 + random() * 0.24) / ctx.sampleRate),
      b: radius * radius, gain: (1 - radius) * [1, 0.85, 0.6, 0.3][i], y1: 0, y2: 0 };
  });
  const lowCoefficient = 1 - Math.exp(-TAU * 550 / ctx.sampleRate);
  const highCoefficient = 1 - Math.exp(-TAU * 4800 / ctx.sampleRate);
  let low = 0, high = 0;
  return makeBuffer(ctx, 0.43, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * lowCoefficient;
    high += (noise - high) * highCoefficient;
    let pressure = (1 - Math.exp(-t * 1800)) * Math.exp(-t / 0.018);
    for (const crease of creases) {
      const local = t - crease.time;
      if (local > 0) pressure += (1 - Math.exp(-local * 2200)) * Math.exp(-local / crease.decay) * crease.level;
    }
    const excitation = noise * pressure;
    let panel = 0;
    for (const mode of modes) {
      const y = excitation + mode.a * mode.y1 - mode.b * mode.y2;
      mode.y2 = mode.y1;
      mode.y1 = y;
      panel += y * mode.gain;
    }
    // Inharmonic sheet-metal resonances are driven by uneven buckles, underneath a short crushed/scraped texture.
    return panel * 1.7 + (high - low) * pressure * 0.22;
  }, 0.65);
}

function crashDebris(ctx, seed) {
  const random = randomSource(seed);
  const grains = Array.from({ length: 14 }, () => {
    const time = 0.015 + random() ** 1.7 * 0.51;
    return { time, frequency: 1400 + random() * 4300, decay: 0.003 + random() * 0.010,
      level: (0.25 + random() * 0.75) * (1 - time * 0.9) };
  });
  const coefficient = 1 - Math.exp(-TAU * 1100 / ctx.sampleRate);
  let low = 0;
  return makeBuffer(ctx, 0.67, (t) => {
    const noise = random() * 2 - 1;
    low += (noise - low) * coefficient;
    let fragments = 0;
    for (const grain of grains) {
      const local = t - grain.time;
      if (local <= 0 || local > grain.decay * 7) continue;
      const envelope = (1 - Math.exp(-local * 3500)) * Math.exp(-local / grain.decay) * grain.level;
      const ring = Math.sin(TAU * grain.frequency * local) + Math.sin(TAU * grain.frequency * 1.71 * local) * 0.3;
      fragments += ((noise - low) * 0.7 + ring * 0.16) * envelope;
    }
    return fragments;
  }, 0.55);
}


export class SlopCrashAudio {
 constructor(howler,listener,muted=()=>false){this.howler=howler;this.listener=listener;this.muted=muted;this.pairs=new WeakMap();this.voices=new Set();}
 prepare(){
  const ctx=this.howler.ctx;if(!ctx?.createBuffer)return false;if(this.ctx===ctx)return true;this.stop();this.ctx=ctx;
  this.buffers={body:[],metal:[],debris:[]};for(let i=0;i<3;i++){this.buffers.body.push(crashBody(ctx,i+301));this.buffers.metal.push(crashMetal(ctx,i+401));this.buffers.debris.push(crashDebris(ctx,i+501));}return true;
 }
 play(impact){
  const ctx=this.howler.ctx,p=this.listener();if(this.muted()||!p||ctx?.state!=='running'||!this.howler.masterGain||!impact.a||!impact.b||impact.a===impact.b||impact.speed<.8)return false;
  const d=Math.hypot(impact.x-p.x,impact.y-p.y,impact.z-p.z);if(d>160)return false;
  if(!this.prepare())return false;
  const now=ctx.currentTime;let pairs=this.pairs.get(impact.a);if(!pairs)this.pairs.set(impact.a,pairs=new WeakMap());let contact=pairs.get(impact.b);
  if(!contact){contact={last:-Infinity,played:-Infinity,speed:0};pairs.set(impact.b,contact);let reverse=this.pairs.get(impact.b);if(!reverse)this.pairs.set(impact.b,reverse=new WeakMap());reverse.set(impact.a,contact);}
  const separated=now-contact.last>.3;contact.last=now;
  if(now-contact.played<.18||(!separated&&impact.speed<=Math.max(4,contact.speed*1.8)))return false;
  if(this.voices.size>=8)return false;
  const severity=clamp((impact.speed-.8)/22),intensity=.12+.88*Math.sqrt(severity),range=50+severity*110;
  const gain=ctx.createGain();gain.gain.value=.35*intensity*Math.max(0,1-d/range)**2;gain.connect(this.howler.masterGain);
  const voice={sources:new Set(),gain};this.voices.add(voice);const variant=Math.floor(Math.random()*3),rate=(1.16-severity*.24)*(.96+Math.random()*.08);
  const play=(buffer,delay,volume)=>{const s=ctx.createBufferSource(),envelope=ctx.createGain();s.buffer=buffer;s.playbackRate.value=rate;envelope.gain.value=volume;s.connect(envelope);envelope.connect(gain);voice.sources.add(s);s.onended=()=>{s.disconnect();envelope.disconnect();voice.sources.delete(s);if(!voice.sources.size){gain.disconnect();this.voices.delete(voice);}};s.start(now+delay);s.stop(now+delay+buffer.duration/rate);};
  play(this.buffers.body[variant],0,.7+severity*.3);play(this.buffers.metal[variant],.003,.08+severity*.72);if(severity>.45)play(this.buffers.debris[variant],.012,(severity-.45)/.55*.55);
  contact.played=now;contact.speed=impact.speed;return true;
 }
 stop(){for(const v of this.voices){for(const s of v.sources){try{s.stop();}catch{ /* ended */ }}v.gain.disconnect();}this.voices.clear();this.pairs=new WeakMap();}
}

export function synthHorn(ctx, duration, seed) {
  const random = randomSource(seed);
  const frequencies = [365 + random() * 45, 465 + random() * 55];
  const phases = [random(), random()];
  const delay = 0.006 + random() * 0.009;
  const harmonics = [0.52, 1, 0.65, 0.37, 0.24, 0.14, 0.085];
  let flutter = 0, air = 0;
  return makeBuffer(ctx, duration, (t) => {
    const noise = random() * 2 - 1;
    flutter += (noise - flutter) * 0.008;
    air += (noise - air) * 0.24;
    let tone = 0;
    for (let reed = 0; reed < 2; reed++) {
      const local = Math.max(0, t - reed * delay);
      const attack = 1 - Math.exp(-local * (reed ? 160 : 230));
      const settling = 1 - 0.065 * Math.exp(-local * 65);
      phases[reed] += frequencies[reed] * (settling + flutter * 0.045 + Math.sin(local * 71 + reed) * 0.0025) / ctx.sampleRate;
      let buzz = 0;
      for (let i = 0; i < harmonics.length; i++) buzz += Math.sin(TAU * phases[reed] * (i + 1)) * harmonics[i];
      tone += buzz * attack * (reed ? 0.83 : 1);
    }
    const release = smoothstep((duration - t) / 0.045);
    const chatter = (noise - air) * Math.exp(-t * 55) * 0.6;
    return (tone * (0.95 + flutter * 0.6) + air * 0.17 + chatter) * release;
  }, 0.7);
}


/**
 * Arranque al subir al carro: el motor de arranque gira el cigüeñal (pulsos de compresión sobre un zumbido
 * eléctrico) y el motor prende con un golpe grave. Después sigue la voz de motor del donante en ralentí.
 */
export function synthStarter(ctx, seed = 3) {
  const random = randomSource(seed);
  const duration = 1.15, catchAt = 0.72 + random() * 0.12;
  let whine = 0, rumble = 0, air = 0;
  return makeBuffer(ctx, duration, (t) => {
    const noise = random() * 2 - 1;
    air += (noise - air) * 0.18;
    rumble += (noise - rumble) * 0.02;
    const cranking = t < catchAt ? 1 : Math.exp(-(t - catchAt) * 18);
    // Unas 8 compresiones por segundo que aceleran un poco antes de prender.
    const strokes = 7.2 + t * 3.5;
    const compression = 0.55 + 0.45 * Math.max(0, Math.sin(TAU * strokes * t));
    whine += (230 + 40 * compression) / ctx.sampleRate;
    const motor = (Math.sin(TAU * whine) * 0.5 + Math.sin(TAU * whine * 2) * 0.22) * compression * cranking;
    const fired = t < catchAt ? 0 : Math.exp(-(t - catchAt) * 5.5);
    const ignition = (Math.sin(TAU * 48 * t) * 0.8 + rumble * 2.2) * fired * smoothstep((t - catchAt) / 0.02);
    const attack = smoothstep(t / 0.03);
    return (motor * 0.55 + air * 0.08 * cranking + ignition) * attack;
  }, 0.55);
}
