// src/systems/Reputation.js
// La fama en la calle: lo que piensan de mí los parceros (habitantes de calle) y los de las chazas
// (vendedores ambulantes). Empieza en 50 y se mueve por lo que hago cerca de ellos.
//
// Parceros:  compartir comida en la fogata sube; robarle o pegarle a un habitante de calle baja.
//            Con buena fama avisan cuando viene la camioneta y a veces regalan algo en la candela;
//            con mala no me dejan arrimar a la fogata.
// Chazas:    comprarles y cuidar carros sube; robar o pelear cerca de un puesto baja.
//            Con buena fama fían y rebajan; con mala cobran más.

export const FAMA_GRUPOS = {
  calle: { nombre: 'Los parceros', quien: 'habitantes de calle' },
  chazas: { nombre: 'Los de las chazas', quien: 'vendedores ambulantes' },
};

export const FAMA = {
  inicio: 50,
  buena: 60,      // desde aquí avisan de la camioneta y fían
  muyBuena: 80,   // desde aquí rebajan y regalan
  mala: 25,       // por debajo cobran más y no dejan arrimar
  fiadoMax: 6000, // lo que fían como mucho
  fiadoHoras: 48, // horas de juego para pagar antes de quedar mal: dos días
  cercaPuesto: 20 // metros: lo que pasa a esta distancia de una chaza lo ven
};

/** Cuánto mueve cada cosa. */
export const FAMA_ACCION = {
  compartir: { calle: +6 },
  robarHabitante: { calle: -12 },
  pegarHabitante: { calle: -8 },
  comprarChaza: { chazas: +2 },
  cuidarCarro: { chazas: +3 },
  robarCercaChaza: { chazas: -6 },
  pegarCercaChaza: { chazas: -4 },
  pegarVendedor: { chazas: -15 },
  espejoCercaChaza: { chazas: -3 },
  pagarFiado: { chazas: +4 },
  quedarMal: { chazas: -15 },
};

const clamp = (v) => Math.max(0, Math.min(100, v));

/** El nivel de un valor: 'mala', 'normal', 'buena' o 'muyBuena'. */
export function famaNivel(valor) {
  if (valor < FAMA.mala) return 'mala';
  if (valor >= FAMA.muyBuena) return 'muyBuena';
  if (valor >= FAMA.buena) return 'buena';
  return 'normal';
}

/** Lo que significa cada nivel, dicho para la pestaña Estado. */
export function famaEfecto(grupo, valor) {
  const nivel = famaNivel(valor);
  if (grupo === 'calle') return {
    mala: 'No me dejan arrimar a la fogata.',
    normal: 'Me dejan estar. Si comparto comida en la fogata, me cogen confianza.',
    buena: 'Me avisan cuando viene la camioneta.',
    muyBuena: 'Me avisan de la camioneta y a veces me regalan algo en la candela.',
  }[nivel];
  return {
    mala: 'Me cobran más caro.',
    normal: 'Precio normal. Si les compro seguido, me fían.',
    buena: 'Me fían hasta $ 6.000.',
    muyBuena: 'Me fían y me rebajan.',
  }[nivel];
}

export class Reputation {
  constructor() {
    this.calle = FAMA.inicio;
    this.chazas = FAMA.inicio;
    this.deuda = 0;          // lo que debo en las chazas
    this.deudaDesde = null;  // hora de juego en que fiaron por primera vez
  }

  /** Aplica una acción de FAMA_ACCION. Devuelve los cambios de nivel para avisarlos. */
  apply(accion) {
    const cambios = [];
    for (const [grupo, delta] of Object.entries(FAMA_ACCION[accion] ?? {})) {
      const antes = famaNivel(this[grupo]);
      this[grupo] = clamp(this[grupo] + delta);
      const despues = famaNivel(this[grupo]);
      if (antes !== despues) cambios.push({ grupo, antes, despues, sube: delta > 0 });
    }
    return cambios;
  }

  /** Multiplicador de precio en las chazas. */
  priceMult() {
    const nivel = famaNivel(this.chazas);
    return nivel === 'mala' ? 1.2 : nivel === 'muyBuena' ? 0.9 : 1;
  }

  /** ¿Me fían este precio? */
  canCredit(price) {
    return this.chazas >= FAMA.buena && this.deuda + price <= FAMA.fiadoMax;
  }

  credit(price, now) {
    this.deuda += price;
    this.deudaDesde ??= now;
  }

  /** Paga lo que alcance de la deuda. Devuelve lo pagado. */
  payDebt(stats) {
    if (this.deuda <= 0) return 0;
    const pago = Math.min(this.deuda, Math.max(0, stats.dinero));
    if (pago <= 0) return 0;
    stats.dinero -= pago;
    this.deuda -= pago;
    if (this.deuda <= 0) { this.deuda = 0; this.deudaDesde = null; this.apply('pagarFiado'); }
    return pago;
  }

  /** Pasadas las horas del fiado sin pagar, quedo mal: la deuda se olvida y la fama cae. */
  checkDebt(now) {
    if (this.deuda <= 0 || this.deudaDesde === null || typeof now !== 'number') return null;
    if (now - this.deudaDesde < FAMA.fiadoHoras) return null;
    const perdida = this.deuda;
    this.deuda = 0;
    this.deudaDesde = null;
    return { perdida, cambios: this.apply('quedarMal') };
  }

  /** Horas que quedan para pagar el fiado, o null. */
  debtHoursLeft(now) {
    if (this.deuda <= 0 || this.deudaDesde === null) return null;
    return Math.max(0, FAMA.fiadoHoras - (now - this.deudaDesde));
  }

  serialize() {
    return { calle: this.calle, chazas: this.chazas, deuda: this.deuda, deudaDesde: this.deudaDesde };
  }

  deserialize(d) {
    if (!d) return;
    if (Number.isFinite(d.calle)) this.calle = clamp(d.calle);
    if (Number.isFinite(d.chazas)) this.chazas = clamp(d.chazas);
    this.deuda = Number.isFinite(d.deuda) ? Math.max(0, d.deuda) : 0;
    this.deudaDesde = Number.isFinite(d.deudaDesde) ? d.deudaDesde : null;
  }
}

/** Texto del aviso cuando cambia un nivel. */
export function avisoDeFama({ grupo, despues, sube }) {
  const quien = grupo === 'calle' ? 'Los parceros' : 'Los de las chazas';
  if (sube) {
    if (despues === 'buena') return grupo === 'calle'
      ? `${quien} ya me tienen confianza: me avisarán si viene la camioneta.`
      : `${quien} ya me conocen: ahora me fían.`;
    if (despues === 'muyBuena') return grupo === 'calle'
      ? `${quien} me quieren: a veces me regalan algo en la candela.`
      : `${quien} me tienen aprecio: me rebajan.`;
    return `${quien} me miran mejor.`;
  }
  if (despues === 'mala') return grupo === 'calle'
    ? `${quien} me cogieron rabia: no me dejan arrimar a la fogata.`
    : `${quien} me cogieron rabia: me cobran más.`;
  return `${quien} ya no me tienen la misma confianza.`;
}
