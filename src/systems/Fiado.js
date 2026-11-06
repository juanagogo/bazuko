/**
 * Doña Rosa fía, pero solo a los conocidos. Con fama de «Ya me conocen» o mejor, en la Tienda La Esquinita se puede
 * llevar lo que no alcanza a pagar, hasta un cupo. Lo fiado se paga en la misma tienda; quien paga a tiempo gana
 * fama, y quien se demora más de `plazoDias` pierde fama cada día y se queda sin fiado hasta ponerse al día.
 */
export const FIADO = {
  cupoConocido: 5000,   // COP con fama de «Ya me conocen»
  cupoQuerido: 12000,   // COP con fama de «Me quieren»
  desdeFama: 20,
  queridoFama: 50,
  plazoDias: 3,
  famaPagar: 2,         // pagar todo a tiempo
  famaMoroso: -3,       // por cada día de mora
};

/** Cuánto le fía Doña Rosa con esa fama. */
export function cupoDeFiado(fama = 0) {
  if (fama >= FIADO.queridoFama) return FIADO.cupoQuerido;
  if (fama >= FIADO.desdeFama) return FIADO.cupoConocido;
  return 0;
}

export class Fiado {
  constructor({ reputation = null, target = globalThis.window } = {}) {
    this.reputation = reputation;
    this.target = target;
    this.deuda = 0;
    this.desde = null;      // día en que empezó la deuda
    this._cobrado = null;   // último día en que se cobró la mora
  }

  get cupo() { return cupoDeFiado(this.reputation?.valor ?? 0); }

  /** ¿Está atrasado con Doña Rosa ese día? */
  moroso(dia) { return this.deuda > 0 && this.desde !== null && dia - this.desde > FIADO.plazoDias; }

  /** Lo que todavía le fiaría hoy. */
  disponible(dia) { return this.moroso(dia) ? 0 : Math.max(0, this.cupo - this.deuda); }

  puedeFiar(precio, dia) { return precio > 0 && precio <= this.disponible(dia); }

  fiar(precio, dia) {
    if (!this.puedeFiar(precio, dia)) return false;
    if (!this.deuda) this.desde = dia;
    this.deuda += precio;
    this._emit('fiado', { deuda: this.deuda });
    return true;
  }

  /** Paga lo que pueda de la deuda con la plata que carga. Devuelve lo pagado. */
  pagar(stats, dia) {
    const n = Math.min(this.deuda, Math.max(0, Math.floor(stats?.dinero ?? 0)));
    if (!n) return 0;
    const aTiempo = !this.moroso(dia);
    stats.dinero -= n;
    this.deuda -= n;
    if (!this.deuda) {
      this.desde = null;
      this._cobrado = null;
      if (aTiempo) this.reputation?.sumar?.(FIADO.famaPagar);
    }
    this._emit('fiado', { deuda: this.deuda });
    return n;
  }

  /** Una vez por día de mora: baja la fama y Doña Rosa lo hace saber. */
  update(dia) {
    if (!this.moroso(dia) || this._cobrado === dia) return;
    this._cobrado = dia;
    this.reputation?.sumar?.(FIADO.famaMoroso);
    this._emit('toast', { text: 'Doña Rosa anda diciendo que le debo: tengo que pagarle lo fiado', type: 'warn' });
  }

  serialize() { return { deuda: this.deuda, desde: this.desde, cobrado: this._cobrado }; }

  deserialize(data) {
    const deuda = Number(data?.deuda);
    this.deuda = Number.isFinite(deuda) && deuda > 0 ? Math.floor(deuda) : 0;
    this.desde = this.deuda && Number.isFinite(data?.desde) ? data.desde : null;
    this._cobrado = Number.isFinite(data?.cobrado) ? data.cobrado : null;
  }

  _emit(type, detail) {
    if (typeof this.target?.dispatchEvent !== 'function') return;
    try { this.target.dispatchEvent(new CustomEvent(type, { detail })); } catch {}
  }
}
