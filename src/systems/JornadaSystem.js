/**
 * La jornada en la calle: la hora del reloj del juego cambia cómo responde la ciudad. De día la Policía ve lejos y la
 * gente da más limosna; de noche la patrulla ve menos y quien queda en la calle carga más plata, pero el que se deja
 * robar se defiende con más rabia. La madrugada es lo más solo y lo más duro. Cada franja trae los factores que
 * multiplican el robo (`StealSystem`), la vista de la patrulla (`TrafficSystem.sightRange`) y la limosna
 * (`InteractionSystem._beg`). No lleva reloj propio: lee `Clock.hour`, el mismo que mueve el sol y la luz.
 */
export const FRANJAS = {
  manana: {
    id: 'manana', label: 'La mañana', desde: 6,
    aviso: 'Amaneció: la Policía ve lejos y la gente suelta alguna moneda',
    policiaVista: 1.15, botin: 1, golpe: 1, limosna: 1.1,
  },
  tarde: {
    id: 'tarde', label: 'La tarde', desde: 12,
    aviso: 'Ya es de tarde: la calle está llena y la limosna rinde más',
    policiaVista: 1, botin: 1, golpe: 1, limosna: 1.2,
  },
  noche: {
    id: 'noche', label: 'La noche', desde: 20,
    aviso: 'Anocheció: la Policía ve menos, pero la calle se pone brava',
    policiaVista: .75, botin: 1.35, golpe: 1.3, limosna: .7,
  },
  madrugada: {
    id: 'madrugada', label: 'La madrugada', desde: 0,
    aviso: 'Es de madrugada: casi no hay nadie, y el que anda por ahí anda armado',
    policiaVista: .65, botin: 1.5, golpe: 1.5, limosna: .4,
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

  /** Avisa una vez al cambiar de franja, también al despertar o al bajarse del bus en otra: la calle ya es otra. */
  update() {
    const nueva = franjaDe(this.clock?.hour);
    if (nueva === this.franja) return;
    this.franja = nueva;
    this._emit('toast', { text: nueva.aviso, type: 'info' });
  }

  /** Sin avisar: al empezar o al cargar partida, la franja se toma tal cual. */
  sincronizar() { this.franja = franjaDe(this.clock?.hour); }

  _emit(type, detail) {
    if (typeof this.target?.dispatchEvent !== 'function') return;
    try { this.target.dispatchEvent(new CustomEvent(type, { detail })); } catch {}
  }
}
