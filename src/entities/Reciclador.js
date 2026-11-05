// src/entities/Reciclador.js
// Reciclador con zorra: recorre los andenes, se detiene en las bolsas de basura (sin vaciarlas)
// y a veces deja la zorra sola un rato. La zorra cuelga del `root` del NPC, así que hereda
// el LOD y el descarte de `Npc.update`.

import * as THREE from 'three';
import { Npc } from './Npc.js';
import { Zorra } from './Zorra.js';
import { RecicladorEstado } from '../systems/RecicladorEstado.js';
import { RECICLADORES, TEXTOS_ZORRA, INSULTOS_RECICLADOR } from '../data/zorra.js';

const toast = (text, type = 'info') =>
  window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));

export class Reciclador extends Npc {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3} position
   * @param {{ navigation: object, groundHeight?: Function, isWalkable?: Function,
   *   canecas?: () => object[], jugadorTieneZorra?: () => boolean,
   *   alRobar?: (r: Reciclador) => void, alForcejear?: (r: Reciclador) => void,
   *   alCambiarZorra?: (vieja: Zorra|null, nueva: Zorra|null) => void,
   *   crearModelo?: () => THREE.Object3D, random?: () => number }} opts
   */
  constructor(scene, position, {
    navigation, groundHeight, isWalkable,
    canecas = () => [],
    jugadorTieneZorra = () => false,
    alRobar = () => {},
    alForcejear = () => {},
    alCambiarZorra = () => {},
    crearModelo,
    random = Math.random
  } = {}) {
    super(scene, position, { navigation, groundHeight, isWalkable, gastada: true });
    this.kind = 'reciclador';
    this.random = random;
    this.estado = new RecicladorEstado(random);
    this.canecas = canecas;
    this.jugadorTieneZorra = jugadorTieneZorra;
    this.alRobar = alRobar;
    this.alForcejear = alForcejear;
    this.alCambiarZorra = alCambiarZorra;
    this.crearModelo = crearModelo;
    this.zorra = null;
    this.caneca = null;
    this.objetivoCaneca = null;
    this._anclaZorra = new THREE.Vector3();
    this._buscarEn = this._intervaloCaneca();
    this._crearZorra();
  }

  // ---------- objetivo de interacción (forcejeo) ----------

  get interactable() { return this.estado.tieneZorra && !this.estado.zorraDescuidada; }

  get prompt() {
    if (this.jugadorTieneZorra()) return TEXTOS_ZORRA.yaTienes;
    return this.estado.enojado ? TEXTOS_ZORRA.enojado : TEXTOS_ZORRA.forcejear;
  }

  interactuar() {
    if (!this.jugadorTieneZorra() && this.estado.puedeForcejear) this.alForcejear(this);
  }

  /** Objetivos para registrar en `InteractionSystem`. */
  objetivos() { return [this, this.zorra].filter(Boolean); }

  // ---------- zorra propia ----------

  _crearZorra() {
    const z = new Zorra(this.scene, {
      ...(this.crearModelo ? { crearModelo: this.crearModelo } : {}),
      // Una zorra ya desechada puede seguir en la lista de objetivos: solo cuenta la actual.
      interactable: () => this.zorra === z && this.estado.zorraDescuidada,
      prompt: () => this.jugadorTieneZorra() ? TEXTOS_ZORRA.yaTienes : TEXTOS_ZORRA.robar,
      interactuar: () => this._robar(z)
    });
    z.adjuntarA(this.root);
    this.zorra = z;
    return z;
  }

  _robar(z) {
    if (this.zorra !== z || this.jugadorTieneZorra()) return;
    if (!this.estado.robarZorra()) return;
    z.visible = false;
    z.dispose();
    this.zorra = null;
    this.alCambiarZorra(z, null);
    this.alRobar(this);
  }

  // ---------- movimiento ----------

  _intervaloCaneca() {
    const [min, max] = RECICLADORES.intervaloCaneca;
    return min + this.random() * (max - min);
  }

  _seguir(ruta) {
    this.route = ruta;
    this.routeIndex = 0;
    this.target = ruta[0] ?? null;
    return !!this.target;
  }

  _limpiarRuta() {
    this.route = [];
    this.routeIndex = 0;
    this.target = null;
  }

  /** Avanza por la ruta actual; `'llego'`, `'bloqueado'` o `null` si sigue en camino. */
  _avanzarRuta(dt) {
    if (!this.target) return this.route.length ? 'llego' : 'bloqueado';
    super._walk(dt);
    if (this.target) return null;
    // `Npc._walk` vacía la ruta solo cuando el siguiente paso no es caminable
    return this.route.length ? 'llego' : 'bloqueado';
  }

  _walk(dt) {
    const evento = this.estado.avanzar(dt);
    // 'recupera' puede quedar oculto tras otro evento del mismo cuadro: se mira el estado
    if (this.estado.tieneZorra && !this.zorra) this.alCambiarZorra(null, this._crearZorra());
    if (evento === 'regresar') this._regresar();

    switch (this.estado.fase) {
      case 'parada':
      case 'forcejeando':
        this.moving = false;
        return;
      case 'descuidando':
        if (this._avanzarRuta(dt) !== null) { this.moving = false; this._limpiarRuta(); }
        return;
      case 'regresando':
        if (this._avanzarRuta(dt) !== null) this._volverAZorra();
        return;
      default:
        this._pasear(dt);
    }
  }

  _pasear(dt) {
    if (this.caneca && !this._canecaVigente()) this._soltarCaneca();
    if (this.caneca) {
      const r = this._avanzarRuta(dt);
      if (r === 'llego') this._llegarACaneca();
      else if (r === 'bloqueado') this._soltarCaneca();
      return;
    }
    if (this._buscarEn <= 0 || (this._buscarEn -= dt) <= 0) {
      this._buscarEn = this._intervaloCaneca();
      if (this._elegirCaneca()) {
        if (this._avanzarRuta(dt) === 'llego') this._llegarACaneca();
        return;
      }
    }
    super._walk(dt);
  }

  _canecaVigente() {
    return !this.caneca.used &&
      this.caneca.position.distanceTo(this.objetivoCaneca) <= RECICLADORES.movidaMax;
  }

  /** Abandona la meta y vuelve a elegir de inmediato. */
  _soltarCaneca() {
    this.caneca = null;
    this.objetivoCaneca = null;
    this._limpiarRuta();
    this._buscarEn = 0;
  }

  _elegirCaneca() {
    let mejor = null, dist = RECICLADORES.radioCaneca;
    for (const p of this.canecas()) {
      if (p.used) continue;
      const d = Math.hypot(p.position.x - this.position.x, p.position.z - this.position.z);
      if (d <= dist) { dist = d; mejor = p; }
    }
    if (!mejor) return false;
    const meta = this.navigation?.nearestPoint(mejor.position.x, mejor.position.z);
    const ruta = meta ? this.navigation.createRouteTo(this.position, meta) : [];
    if (!ruta.length) return false;
    this.caneca = mejor;
    this.objetivoCaneca = mejor.position.clone();
    this._seguir(ruta);
    return true;
  }

  /** Llegó a la bolsa: rebusca o, a veces, deja la zorra sola y se aleja. Nunca vacía la bolsa. */
  _llegarACaneca() {
    this.caneca = null;
    this.objetivoCaneca = null;
    this._limpiarRuta();
    this.moving = false;
    // `llegarACaneca` solo descuida si tiene zorra, y `_walk` la recrea en cuanto la recupera
    if (this.estado.llegarACaneca() !== 'descuidar' || !this.zorra) return;
    this.zorra.dejarEnEscena();
    this._anclaZorra.copy(this.zorra.anchor);
    const a = this.random() * Math.PI * 2;
    const d = RECICLADORES.distanciaDescuido;
    const meta = this.navigation?.nearestPoint(this.position.x + Math.cos(a) * d, this.position.z + Math.sin(a) * d);
    if (meta) this._seguir(this.navigation.createRouteTo(this.position, meta));
  }

  _regresar() {
    const meta = this.navigation?.nearestPoint(this._anclaZorra.x, this._anclaZorra.z);
    if (!meta || !this._seguir(this.navigation.createRouteTo(this.position, meta))) this._limpiarRuta();
  }

  /** Llegó al ancla: recoge la zorra o, si se la robaron, insulta. */
  _volverAZorra() {
    this._limpiarRuta();
    this.moving = false;
    if (this.estado.recogerZorra()) {
      this.zorra?.adjuntarA(this.root);
    } else {
      const i = Math.floor(this.random() * INSULTOS_RECICLADOR.length);
      toast(INSULTOS_RECICLADOR[Math.min(i, INSULTOS_RECICLADOR.length - 1)], 'warn');
    }
  }

  dispose() {
    this.zorra?.dispose();
    this.zorra = null;
    super.dispose();
  }
}
