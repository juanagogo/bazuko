/**
 * La jornada en la calle: la hora cambia cómo responde la ciudad. De día hay más gente mirando y la Policía ve lejos;
 * de noche ve menos, quedan pocos testigos y los borrachos cargan plata, pero quien se deja robar se defiende con más
 * rabia. La madrugada es lo más solo y lo más duro. Cada franja trae factores que los demás sistemas multiplican.
 */
export const FRANJAS = {
  manana: {
    id: 'manana', label: 'La mañana', desde: 6,
    aviso: 'Amaneció: hay gente por todo lado y la Policía ve lejos',
    policiaVista: 1.15, policiaPierde: 1.15, testigosRadio: 1.1, llamar: 1.1,
    alerta: .05, botin: 1, golpe: 1, limosna: 1.1,
  },
  tarde: {
    id: 'tarde', label: 'La tarde', desde: 12,
    aviso: 'Ya es de tarde: la calle está llena',
    policiaVista: 1, policiaPierde: 1, testigosRadio: 1, llamar: 1,
    alerta: 0, botin: 1, golpe: 1, limosna: 1.2,
  },
  noche: {
    id: 'noche', label: 'La noche', desde: 20,
    aviso: 'Anocheció: la Policía ve menos, pero la calle se pone brava',
    policiaVista: .75, policiaPierde: .8, testigosRadio: .75, llamar: .8,
    alerta: -.1, botin: 1.35, golpe: 1.3, limosna: .7,
  },
  madrugada: {
    id: 'madrugada', label: 'La madrugada', desde: 0,
    aviso: 'Es de madrugada: casi no hay nadie, y el que anda por ahí anda armado',
    policiaVista: .65, policiaPierde: .7, testigosRadio: .6, llamar: .7,
    alerta: -.15, botin: 1.5, golpe: 1.5, limosna: .4,
  },
};

/** La franja de una hora (0 a 24, con decimales). */
export function franjaDe(hour) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24;
  if (h >= FRANJAS.noche.desde) return FRANJAS.noche;
  if (h >= FRANJAS.tarde.desde) return FRANJAS.tarde;
  if (h >= FRANJAS.manana.desde) return FRANJAS.manana;
  return FRANJAS.madrugada;
}

export class JornadaSystem {
  constructor(clock, { target = globalThis.window } = {}) {
    this.clock = clock;
    this.target = target;
    this.franja = franjaDe(clock?.hour);
  }

  /** Avisa una vez al cambiar de franja; al cargar o dormir también, porque la calle ya es otra. */
  update() {
    const nueva = franjaDe(this.clock?.hour);
    if (nueva === this.franja) return;
    this.franja = nueva;
    this._emit('toast', { text: nueva.aviso, type: 'info' });
    this._emit('franja', { id: nueva.id });
  }

  /** Sin avisar: al cargar partida o al empezar, la franja se toma tal cual. */
  sincronizar() { this.franja = franjaDe(this.clock?.hour); }

  _emit(type, detail) {
    if (typeof this.target?.dispatchEvent !== 'function') return;
    try { this.target.dispatchEvent(new CustomEvent(type, { detail })); } catch {}
  }
}
