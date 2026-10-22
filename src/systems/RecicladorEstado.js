// src/systems/RecicladorEstado.js
// Máquina de estados pura de un reciclador con zorra: sin DOM ni three.js.

import { RECICLADORES, FORCEJEO } from '../data/zorra.js';

export class RecicladorEstado {
  constructor(random = Math.random) {
    this.random = random;
    this.fase = 'paseando'; // paseando | parada | descuidando | regresando | forcejeando
    this.tieneZorra = true;
    this.zorraDescuidada = false;
    this.espera = 0;     // s sin aceptar otro forcejeo
    this.sinZorra = 0;   // s acumulados sin zorra
    this.faseRestante = 0;
  }

  get puedeForcejear() {
    return this.tieneZorra && !this.zorraDescuidada && this.fase !== 'forcejeando' && this.espera <= 0;
  }

  get enojado() { return this.espera > 0; }

  llegarACaneca() {
    // Sin zorra no hay nada que descuidar: siempre es una parada normal
    if (this.tieneZorra && this.random() < RECICLADORES.probDescuido) {
      this.fase = 'descuidando';
      this.zorraDescuidada = true;
      this.faseRestante = RECICLADORES.duracionDescuido;
      return 'descuidar';
    }
    this.fase = 'parada';
    this.faseRestante = RECICLADORES.duracionParada;
    return 'rebuscar';
  }

  avanzar(dt) {
    this.espera = Math.max(0, this.espera - dt);
    let evento = null;
    if (this.fase === 'parada' || this.fase === 'descuidando') {
      this.faseRestante -= dt;
      if (this.faseRestante <= 0) {
        if (this.fase === 'parada') {
          this.fase = 'paseando';
          evento = 'fin-parada';
        } else {
          this.fase = 'regresando';
          evento = 'regresar';
        }
      }
    }
    if (!this.tieneZorra) {
      this.sinZorra += dt;
      if (this.sinZorra >= RECICLADORES.tiempoRecuperar) {
        this.tieneZorra = true;
        this.sinZorra = 0;
        evento ??= 'recupera';
      }
    }
    return evento;
  }

  robarZorra() {
    if (!this.zorraDescuidada) return false;
    this.tieneZorra = false;
    this.zorraDescuidada = false;
    this.sinZorra = 0;
    return true;
  }

  /** `false` significa que se la robaron mientras no miraba */
  recogerZorra() {
    if (this.fase !== 'regresando') return false;
    this.zorraDescuidada = false;
    this.fase = 'paseando';
    return this.tieneZorra;
  }

  iniciarForcejeo() { this.fase = 'forcejeando'; }

  jugadorGana() {
    this.tieneZorra = false;
    this.fase = 'paseando';
    this.sinZorra = 0;
  }

  jugadorPierde() {
    this.fase = 'paseando';
    this.espera = FORCEJEO.espera;
  }

  cancelarForcejeo() { this.fase = 'paseando'; }
}
