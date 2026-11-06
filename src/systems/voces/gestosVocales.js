// src/systems/voces/gestosVocales.js
// Los sonidos sin palabras de la gente (¡ay!, ¡ey!, la risa, el murmullo, el ronquido), como datos: qué vocal, qué
// tono y qué tan fuerte en cada instante. No suena nada aquí; Vocalizador.js lo toca con Web Audio. Código propio,
// sin muestras grabadas: una fuente glotal pasa por tres formantes (las resonancias de la boca) y una envolvente corta.

/** Formantes F1, F2 y F3 (Hz) de una voz de hombre adulto; la de mujer los sube un 15 %. `m` es la boca cerrada. */
export const VOCALES = Object.freeze({
  a: [700, 1220, 2600], e: [480, 1800, 2550], i: [290, 2250, 2900], o: [500, 900, 2450], u: [320, 750, 2400],
  m: [260, 1100, 2300], r: [320, 640, 1050],
});

/**
 * Tono de cada voz del reparto (Hz), la mediana de la autocorrelación de sus grabaciones: quien tiene voz grabada
 * se queja en su mismo tono. Sin voz, el hombre va de 100 a 140 Hz y la mujer de 180 a 240.
 */
export const VOZ_TIMBRE = Object.freeze({
  nero_viejo: 126, reciclador: 126, conductor: 128, nero_pelado: 150, estudiante_h: 153, abuelo: 149, busetero: 145,
  vendedor: 150, nera: 207, senora: 235, vendedora: 235, estudiante: 238, conductora: 242,
});

/** Reactivos (responden a algo) y de ambiente (suenan solos, más bajo y de a uno). */
export const GESTOS_AMBIENTE = Object.freeze(new Set(['murmullo', 'ronquido']));

// Envolvente: entra en 25 ms y se apaga en 70; ningún gesto empieza ni termina de golpe.
const ATAQUE = .025, CAIDA = .07;

/** Azar repetible a partir de una semilla (mulberry32): el mismo perfil y el mismo gesto suenan igual. */
export function azarDe(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Número estable de un texto (FNV-1a). */
export function hashTexto(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Cómo suena esa persona: tono base, escala de formantes, temblor y aire. Sale de su voz del reparto (si tiene),
 * su sexo, su edad y una semilla suya, así que la misma persona suena siempre igual.
 */
export function perfilVocal({ seed = 1, voz = null, sexo = 'hombre', edad = 'adulto' } = {}) {
  const random = azarDe(seed);
  const mujer = sexo === 'mujer';
  const base = VOZ_TIMBRE[voz] ?? (mujer ? 180 + random() * 60 : 100 + random() * 40);
  const mayor = edad === 'mayor';
  const persona = 1 + (random() - .5) * .06; // ±3 % de una persona a otra
  return {
    f0: base * persona * (mayor ? .92 : 1),
    formantes: (mujer ? 1.15 : 1) * (1 + (random() - .5) * .06),
    temblor: mayor ? .022 : .008,
    aire: mayor ? .16 : .09 + random() * .04,
    seed: seed >>> 0,
  };
}

const vocal = (nombre, escala) => VOCALES[nombre].map(f => f * escala);

/**
 * Una toma: `dur` (s), y puntos [t, valor] de tono (`pitch`, Hz), formantes (`formantes`, [t, F1, F2, F3]),
 * voz (`amp`), aire filtrado por la boca (`aire`) y fricción sin boca (`friccion`). `pasaBajos` (Hz) apaga lo
 * agudo de lo nasal, el murmullo y el ronquido; `ganancia` es su nivel frente a una frase grabada.
 */
function nuevoPlan(gesto) {
  return { gesto, dur: 0, pitch: [], formantes: [], amp: [], aire: [], friccion: [], pasaBajos: 4500, ganancia: .5 };
}

/** Un tramo vocal de `dur` segundos desde `t`: el tono va de `f0a` a `f0b` (múltiplos del tono base). */
function tramo(plan, perfil, t, dur, nombre, f0a, f0b, { gain = 1, aire = perfil.aire, siguiente = null, random } = {}) {
  const f0 = perfil.f0;
  const temblor = () => 1 + (random() - .5) * 2 * perfil.temblor;
  plan.pitch.push([t, f0 * f0a * temblor()], [t + dur * .5, f0 * (f0a + f0b) * .5 * temblor()], [t + dur, f0 * f0b * temblor()]);
  const [f1, f2, f3] = vocal(nombre, perfil.formantes);
  plan.formantes.push([t, f1, f2, f3]);
  if (siguiente) {
    const [g1, g2, g3] = vocal(siguiente, perfil.formantes);
    plan.formantes.push([t + dur * .45, f1, f2, f3], [t + dur, g1, g2, g3]);
  } else plan.formantes.push([t + dur, f1, f2, f3]);
  plan.amp.push([t, gain]);
  plan.aire.push([t, gain * aire]);
}

/** Envolvente con ataque y caída cortos alrededor de los puntos de un canal. */
function envolver(puntos, desde, hasta) {
  if (!puntos.length) return puntos;
  const out = [[desde, 0]];
  for (const [t, v] of puntos) out.push([Math.max(desde + ATAQUE, Math.min(hasta - CAIDA, t)), v]);
  out.push([hasta - CAIDA, puntos.at(-1)[1] * .7], [hasta, 0]);
  return out;
}

/** El plan de un gesto para ese perfil. `random` solo mueve detalles (temblor, sílabas del murmullo). */
export function planVocalizacion(gesto, perfil, random = azarDe(perfil.seed ^ hashTexto(gesto))) {
  const plan = nuevoPlan(gesto);
  const o = { random };
  switch (gesto) {
    case 'ay':
      tramo(plan, perfil, 0, .12, 'a', 1.35, 1.2, { ...o, siguiente: 'i' });
      tramo(plan, perfil, .12, .18, 'i', 1.2, .85, o);
      plan.dur = .3; plan.ganancia = .5;
      break;
    case 'ay_fuerte':
      tramo(plan, perfil, 0, .25, 'a', 1.5, 1.3, { ...o, aire: perfil.aire + .18, siguiente: 'i' });
      tramo(plan, perfil, .25, .3, 'i', 1.3, .7, { ...o, aire: perfil.aire + .22, gain: .85 });
      plan.dur = .55; plan.ganancia = .6;
      break;
    case 'ey':
      tramo(plan, perfil, 0, .14, 'e', 1.25, 1.4, { ...o, siguiente: 'i' });
      tramo(plan, perfil, .14, .1, 'i', 1.4, 1.3, { ...o, gain: .8 });
      plan.dur = .24; plan.ganancia = .5;
      break;
    case 'uy':
      tramo(plan, perfil, 0, .1, 'u', 1.1, 1.5, { ...o, siguiente: 'i' });
      tramo(plan, perfil, .1, .15, 'i', 1.5, 1.2, { ...o, gain: .85 });
      plan.dur = .25; plan.ganancia = .45;
      break;
    case 'uf': {
      // Un golpe de aire con la boca en u y luego la f, sin voz: el esfuerzo de quien levanta la varilla.
      tramo(plan, perfil, 0, .08, 'u', .9, .85, { ...o, aire: perfil.aire + .3, gain: .7 });
      plan.amp.push([.1, 0]);
      plan.friccion.push([.06, 0], [.09, .55], [.22, .3], [.3, 0]);
      plan.dur = .3; plan.ganancia = .4;
      break;
    }
    case 'jaja': {
      // Tres a cinco «ja»: aire de la jota y una a, cada una un poco más grave.
      const n = 3 + Math.floor(random() * 3);
      let t = 0;
      for (let k = 0; k < n; k++) {
        const alto = 1.4 - k * .1;
        tramo(plan, perfil, t + .05, .08, 'a', alto, alto - .08, { ...o, aire: .2 });
        plan.aire.push([t, .6], [t + .045, .25], [t + .13, .05]);
        plan.amp.push([t + .04, 0], [t + .12, .9], [t + .135, 0]);
        t += .14 + random() * .02;
      }
      plan.dur = Math.min(1.2, t + .04); plan.ganancia = .4;
      break;
    }
    case 'mmm':
      tramo(plan, perfil, 0, .3, 'm', 1.0, 1.12, { ...o, aire: .03 });
      plan.pitch.splice(1, 1, [.18, perfil.f0 * 1.16]);
      plan.dur = .3; plan.pasaBajos = 900; plan.ganancia = .4;
      break;
    case 'mmm_no':
      // Dos zumbidos, el segundo más grave: «mm-mm», que no.
      tramo(plan, perfil, 0, .16, 'm', 1.15, 1.12, { ...o, aire: .03 });
      tramo(plan, perfil, .22, .18, 'm', .98, .9, { ...o, aire: .03 });
      plan.amp = [[0, 1], [.14, 1], [.17, 0], [.21, 0], [.23, 1]];
      plan.dur = .4; plan.pasaBajos = 900; plan.ganancia = .4;
      break;
    case 'murmullo': {
      // De seis a diez sílabas que no se entienden: la frase baja de tono al final, como cuando se conversa.
      const n = 6 + Math.floor(random() * 5);
      const nombres = ['a', 'e', 'o', 'i', 'u', 'a', 'e', 'o'];
      let t = 0;
      for (let k = 0; k < n; k++) {
        const d = .12 + random() * .08;
        const caida = 1.12 - .25 * (k / Math.max(1, n - 1)) + (random() - .5) * .08;
        const nombre = nombres[Math.floor(random() * nombres.length)];
        plan.amp.push([t, .15]);
        tramo(plan, perfil, t + .025, d - .025, nombre, caida, caida - .03, { ...o, gain: .7 + random() * .3, aire: .05 });
        t += d;
      }
      plan.dur = Math.min(3, t); plan.pasaBajos = 1200; plan.ganancia = .22;
      break;
    }
    case 'ronquido': {
      // Entra el aire roncando (una vibración lenta de la garganta) y sale soplando.
      plan.pitch.push([0, 26], [1, 31], [1.25, 31]);
      plan.formantes.push([0, ...vocal('r', 1)], [1.25, ...vocal('r', 1)]);
      plan.amp.push([0, .2], [.6, 1], [1.05, .6], [1.25, 0]);
      plan.aire.push([0, .1], [.7, .3], [1.25, .1], [1.5, .25], [2.3, .05]);
      plan.dur = 2.5; plan.pasaBajos = 400; plan.ganancia = .3;
      break;
    }
    default:
      return null;
  }
  const porTiempo = (a, b) => a[0] - b[0];
  for (const canal of [plan.pitch, plan.formantes, plan.amp, plan.aire, plan.friccion]) canal.sort(porTiempo);
  plan.amp = envolver(plan.amp, 0, plan.dur);
  plan.aire = envolver(plan.aire, 0, plan.dur);
  if (plan.friccion.length) plan.friccion = envolver(plan.friccion, 0, plan.dur);
  return plan;
}
