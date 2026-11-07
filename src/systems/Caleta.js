/**
 * La caleta: un tarro enterrado bajo la base del cambuche donde guardar la plata. Lo que está ahí no se lo lleva la
 * Policía al arrestarlo ni se pierde por la calle. El único que da con ella es el ladrón de la noche, si el cambuche
 * no tiene paredes y nadie lo cuida: se lleva una parte.
 */
export const CALETA = {
  roboNocturno: .3,   // fracción de la caleta que se lleva el ladrón cuando entra
};

export class Caleta {
  constructor({ target = globalThis.window } = {}) {
    this.plata = 0;
    this.target = target;
  }

  /** Mete en la caleta `monto` (por defecto, todo lo que carga). Devuelve lo que guardó. */
  guardar(stats, monto = stats?.dinero ?? 0) {
    const n = Math.max(0, Math.min(Math.floor(monto), Math.floor(stats?.dinero ?? 0)));
    if (!n) return 0;
    stats.dinero -= n;
    this.plata += n;
    this._emit();
    return n;
  }

  /** Saca de la caleta `monto` (por defecto, todo). Devuelve lo que sacó. */
  sacar(stats, monto = this.plata) {
    const n = Math.max(0, Math.min(Math.floor(monto), this.plata));
    if (!n || !stats) return 0;
    this.plata -= n;
    stats.dinero = (stats.dinero ?? 0) + n;
    this._emit();
    return n;
  }

  /** El ladrón de la noche dio con ella: devuelve cuánto se llevó. */
  robar(fraccion = CALETA.roboNocturno) {
    const n = Math.floor(this.plata * fraccion / 100) * 100;
    if (!n) return 0;
    this.plata -= n;
    this._emit();
    return n;
  }

  serialize() { return { plata: this.plata }; }

  deserialize(data) {
    const plata = Number(data?.plata);
    this.plata = Number.isFinite(plata) && plata > 0 ? Math.floor(plata) : 0;
  }

  _emit() {
    if (typeof this.target?.dispatchEvent !== 'function') return;
    try { this.target.dispatchEvent(new CustomEvent('caleta', { detail: { plata: this.plata } })); } catch {}
  }
}
