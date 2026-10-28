// Propagación de un claxon por la ciudad, calculada con volumen y filtros: sin panners
// ni posición del oyente, de modo que girar la cámara no cambia la mezcla.
export const HORN_RANGE = 170;
const REFERENCE = 6;
const ROLLOFF = .6;
const SPEED_OF_SOUND = 343;
const NEAR_CUTOFF = 16000;
const FAR_CUTOFF = 1800;

const clamp01 = value => Math.min(1, Math.max(0, value));

/**
 * Cerca domina el sonido directo y brillante; lejos, el directo cae más rápido que la
 * reverberación de las fachadas y pierde agudos. Fuera del mismo corredor de calle el
 * sonido llega rodeando manzanas: más apagado y más difuso.
 */
export function hornAcoustics(dx, dy, dz) {
  const distance = Math.hypot(dx, dy, dz);
  const along = Math.max(0, distance - REFERENCE) / REFERENCE;
  const lateral = Math.min(Math.abs(dx), Math.abs(dz));
  const occlusion = clamp01((lateral - 6) / 16) * clamp01((distance - 12) / 20);
  const direct = (1 - .5 * occlusion) / (1 + ROLLOFF * along);
  const reverb = .16 / (1 + .08 * along);
  const edge = clamp01((HORN_RANGE - distance) / 35);
  const cutoff = NEAR_CUTOFF * (FAR_CUTOFF / NEAR_CUTOFF) ** clamp01((distance - 8) / 150) * (1 - .55 * occlusion);
  return { distance, level: (direct + reverb) * edge, wet: reverb / (direct + reverb), cutoff, delay: distance / SPEED_OF_SOUND };
}

/** Respuesta corta de calle: reflejos tempranos de fachadas y una cola de unos 1,5 s. */
function streetImpulse(ctx) {
  const rate = ctx.sampleRate, length = Math.floor(rate * 1.6);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = Math.floor(rate * .02); i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / rate / .24) * .5;
    for (let k = 0; k < 6; k++) {
      const index = Math.floor((.018 + k * .013 + Math.random() * .01) * rate);
      data[index] += (Math.random() < .5 ? -1 : 1) * (.5 - k * .06);
    }
  }
  return impulse;
}

function setParam(param, value, ctx) {
  if (param.setTargetAtTime) param.setTargetAtTime(value, ctx.currentTime, .03);
  else param.value = value;
}

/**
 * Inserta en cada voz de Howler un filtro de absorción y un envío a una reverberación
 * compartida. Si el contexto no ofrece esos nodos, el claxon conserva la salida directa
 * y la distancia se expresa solo con el volumen.
 */
export class HornMixer {
  constructor(howler) {
    this.howler = howler;
    this.routes = new WeakMap();
  }

  _reverb(ctx) {
    if (this._reverbBus?.ctx === ctx) return this._reverbBus;
    this._reverbBus = null;
    if (!ctx.createConvolver || !ctx.createBuffer) return null;
    try {
      const input = ctx.createConvolver(), tone = ctx.createBiquadFilter(), output = ctx.createGain();
      input.buffer = streetImpulse(ctx);
      tone.type = 'lowpass'; tone.frequency.value = 3200;
      output.gain.value = .9;
      input.connect(tone); tone.connect(output); output.connect(this.howler.masterGain);
      this._reverbBus = { ctx, input };
    } catch { /* sin reverberación */ }
    return this._reverbBus;
  }

  route(sound, id) {
    const ctx = this.howler?.ctx, master = this.howler?.masterGain;
    const node = sound._soundById?.(id)?._node;
    if (!ctx?.createBiquadFilter || !master || !node?.connect || !node.gain) return null;
    let route = this.routes.get(node);
    if (route?.ctx === ctx) return route;
    try {
      const filter = ctx.createBiquadFilter(), dry = ctx.createGain();
      filter.type = 'lowpass'; filter.Q.value = .6;
      node.disconnect();
      node.connect(filter); filter.connect(dry); dry.connect(master);
      const reverb = this._reverb(ctx);
      let send = null;
      if (reverb) { send = ctx.createGain(); filter.connect(send); send.connect(reverb.input); }
      route = { ctx, filter, dry, send };
      this.routes.set(node, route);
      return route;
    } catch { return null; }
  }

  apply(route, acoustics) {
    if (!route) return;
    setParam(route.filter.frequency, acoustics.cutoff, route.ctx);
    setParam(route.dry.gain, route.send ? 1 - acoustics.wet : 1, route.ctx);
    if (route.send) setParam(route.send.gain, acoustics.wet, route.ctx);
  }
}
