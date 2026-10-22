// src/systems/ZorraController.js
// Conecta la zorra del jugador con el juego (soltar/agarrar, sobrepeso y muerte)
// y crea los recicladores con zorra que recorren los andenes.

import * as THREE from 'three';
import { Zorra } from '../entities/Zorra.js';
import { Reciclador } from '../entities/Reciclador.js';
import { ZORRA, RECICLADORES, FORCEJEO, TEXTOS_ZORRA, INSULTOS_RECICLADOR } from '../data/zorra.js';
import { ITEMS } from '../data/items.js';
import { originEffect } from '../data/origins.js';
import { movimientoJugador, haySobrepeso, objetosADescartar } from './ZorraSystem.js';
import {
  fuerzaJugador, crearForcejeo, pulsarForcejeo, avanzarForcejeo, cancelarForcejeo, botinForcejeo
} from './Forcejeo.js';
import { INTERACT_RANGE } from '../utils/constants.js';
import { ForcejeoBar } from '../ui/ForcejeoBar.js';

const toast = (text, type = 'info') =>
  window.dispatchEvent(new CustomEvent('toast', { detail: { text, type } }));

export class ZorraController {
  constructor(game) {
    this.game = game;
    this.zorraJugador = null;
    this.recicladores = [];
    this._avisoSobrepeso = 0; // s restantes para el próximo aviso
    this.forcejeo = null;     // estado del forcejeo en curso (ver Forcejeo.js)
    this.rival = null;        // Reciclador contra el que se forcejea
    this.barra = null;        // ForcejeoBar, creada en el primer forcejeo
    this._posSuelo = new THREE.Vector3(); // reutilizado cada frame para la zorra soltada
  }

  spawn(district) {
    const game = this.game;
    if (!this.zorraJugador) {
      this.zorraJugador = new Zorra(game.sceneMgr.scene, {
        interactable: () => game.zorra.estado === 'dropped',
        prompt: () => TEXTOS_ZORRA.agarrar,
        interactuar: () => {
          if (game.zorra.agarrar()) toast(TEXTOS_ZORRA.agarrada);
        }
      });
      this.zorraJugador.visible = false;
    }
    game.interaction.register(this.zorraJugador);
    this._spawnRecicladores(district);
  }

  /** Recicladores junto a bolsas repartidas por el mapa; no se guardan con la partida. */
  _spawnRecicladores(district) {
    const navigation = district?.pedestrianNavigation;
    if (!navigation) return;
    const game = this.game;
    this._quitarRecicladores(district);
    const bolsas = game.pickups ?? [];
    const n = bolsas.length;
    if (!n) return;
    const isWalkable = (x, z) => navigation.isWalkableAt(x, z);
    for (let i = 0; i < RECICLADORES.cantidad; i++) {
      const bolsa = bolsas[Math.floor((i + 0.5) * n / RECICLADORES.cantidad)];
      const pos = navigation.nearestPoint(bolsa.position.x, bolsa.position.z);
      if (!pos) continue;
      const r = new Reciclador(game.sceneMgr.scene, pos, {
        navigation, groundHeight: navigation.groundHeight, isWalkable,
        canecas: () => game.pickups,
        jugadorTieneZorra: () => game.zorra.tieneZorra(),
        alRobar: () => {
          if (!game.zorra.obtener()) return;
          game._actualizarCapacidad();
          toast(TEXTOS_ZORRA.robada);
        },
        alForcejear: (rec) => this.alForcejear(rec),
        alCambiarZorra: (vieja, nueva) => {
          if (vieja) game.interaction.unregister(vieja);
          if (nueva) game.interaction.register(nueva);
        }
      });
      this.recicladores.push(r);
      district.npcs.push(r);
      for (const objetivo of r.objetivos()) game.interaction.register(objetivo);
    }
  }

  /** Quita de `district.npcs` (en el sitio: otros sistemas guardan la referencia) y desecha. */
  _quitarRecicladores(district) {
    const anteriores = new Set(this.recicladores);
    const npcs = district?.npcs ?? [];
    for (let i = npcs.length - 1; i >= 0; i--) {
      if (npcs[i] instanceof Reciclador) anteriores.add(...npcs.splice(i, 1));
    }
    for (const r of anteriores) r.dispose();
    this.recicladores = [];
  }

  /** El jugador quiere forcejear con `reciclador`; ya se comprobó `estado.puedeForcejear`. */
  alForcejear(reciclador) { this.iniciarForcejeo(reciclador); }

  iniciarForcejeo(reciclador) {
    if (this.forcejeo) return;
    const { game } = this;
    const fuerza = fuerzaJugador({
      energia: game.stats.energia,
      enAbstinencia: game.stats.inWithdrawal,
      origenMult: originEffect(game.look?.origen, 'forcejeoBonus', 1)
    });
    this.forcejeo = crearForcejeo(fuerza);
    this.rival = reciclador;
    reciclador.estado.iniciarForcejeo();
    this.barra ??= new ForcejeoBar();
    this.barra.mostrar(this.forcejeo.barra);
  }

  _actualizarForcejeo(dt, input, pulsoG) {
    const f = this.forcejeo;
    // Se consumen todas las E para que InteractionSystem no las vea mientras dura
    if (input.consumePress(ZORRA.teclas.forcejear)) pulsarForcejeo(f);
    if (pulsoG) cancelarForcejeo(f);
    avanzarForcejeo(f, dt);
    if (f.resultado === 'victoria') this._ganarForcejeo();
    else if (f.resultado === 'derrota') this._perderForcejeo();
    else this.barra.mostrar(f.barra);
  }

  /** Zorra interactuable más cercana (propia soltada o descuidada de un reciclador) dentro del alcance. */
  _zorraAlcanzable() {
    const pos = this.game.player.position;
    let mejor = null;
    let mejorDist = INTERACT_RANGE;
    const candidatas = [this.zorraJugador, ...this.recicladores.map((r) => r.zorra)];
    for (const z of candidatas) {
      if (!z || z.interactable === false) continue;
      const d = z.position.distanceTo(pos);
      if (d < mejorDist) { mejorDist = d; mejor = z; }
    }
    return mejor;
  }

  _cerrarForcejeo() {
    this.forcejeo = null;
    this.rival = null;
    this.barra?.ocultar();
  }

  _ganarForcejeo() {
    const { game, rival } = this;
    game.zorra.obtener();
    rival.estado.jugadorGana();
    const z = rival.zorra;
    if (z) {
      z.dispose();
      rival.zorra = null;
      rival.alCambiarZorra?.(z, null);
    }
    game._actualizarCapacidad(); // antes de repartir: la capacidad ya incluye la zorra
    const nombres = [];
    for (const id of botinForcejeo()) {
      const item = ITEMS[id];
      if (item && game.inventory.add(item)) nombres.push(item.name);
    }
    toast(nombres.length ? `${TEXTOS_ZORRA.ganaste}: ${nombres.join(', ')}` : TEXTOS_ZORRA.ganaste, 'info');
    this._cerrarForcejeo();
  }

  _perderForcejeo() {
    const { game, rival } = this;
    game.stats.salud = Math.max(0, game.stats.salud - FORCEJEO.castigoSalud);
    game.stats.animo = Math.max(0, game.stats.animo - FORCEJEO.castigoAnimo);
    rival.estado.jugadorPierde();
    const i = Math.floor(Math.random() * INSULTOS_RECICLADOR.length);
    toast(INSULTOS_RECICLADOR[Math.min(i, INSULTOS_RECICLADOR.length - 1)], 'warn');
    this._cerrarForcejeo();
  }

  update(dt, input) {
    const { game } = this;
    const zorra = game.zorra;
    const vista = this.zorraJugador;

    game._actualizarCapacidad(); // el paso 4b del juego corre después: evita un frame con capacidad vieja

    // Una sola lectura de G por frame: una pulsación hace exactamente una cosa
    const pulsoG = input.consumePress(ZORRA.teclas.soltar);
    if (this.forcejeo) {
      this._actualizarForcejeo(dt, input, pulsoG);
    } else if (pulsoG) {
      if (zorra.empujando) {
        if (zorra.soltar(game.player.position.toArray(), game.player.root.rotation.y)) toast(TEXTOS_ZORRA.soltada);
      } else {
        this._zorraAlcanzable()?.interactuar();
      }
    }

    if (vista) {
      if (zorra.empujando) {
        vista.colocarDelante(game.player.position, game.player.root.rotation.y);
        vista.visible = true;
      } else if (zorra.estado === 'dropped') {
        vista.colocarDelante(this._posSuelo.set(...zorra.pos), zorra.rot);
        vista.visible = true;
      } else {
        vista.visible = false;
      }
    }

    const sobrepeso = haySobrepeso(game.inventory.totalWeight, game.inventory.maxWeight);
    const { mult, puedeCorrer } = movimientoJugador({ empujando: zorra.empujando, sobrepeso, forcejeando: !!this.forcejeo });
    game.player.zorraMult = mult;
    game.player.canRun = puedeCorrer;

    this._avisoSobrepeso = Math.max(0, this._avisoSobrepeso - dt);
    const eje = input.axis;
    if (sobrepeso && (eje.x !== 0 || eje.z !== 0) && this._avisoSobrepeso <= 0) {
      toast(TEXTOS_ZORRA.sobrepeso, 'warn');
      this._avisoSobrepeso = ZORRA.avisoSobrepesoCada;
    }
  }

  /**
   * Al desmayarse se pierde lo que no cabe sin la zorra. Con la zorra en el suelo
   * (o sin ella) el recorte es silencioso, para no dejar al jugador inmovilizado.
   */
  alMorir() {
    const { game } = this;
    if (this.forcejeo) {
      this.rival?.estado.cancelarForcejeo();
      this._cerrarForcejeo();
    }
    const quitar = objetosADescartar(game.inventory.items, game._capacidadSinZorra());
    for (const [id, qty] of quitar) game.inventory.remove(id, qty);
    if (game.zorra.empujando) toast(TEXTOS_ZORRA.muerte);
  }

  /** Punto del radar para la zorra propia: solo cuando está en el suelo. */
  poi() {
    const { zorra } = this.game;
    if (zorra?.estado !== 'dropped' || !zorra.pos) return null;
    const { nombre, icono, color } = ZORRA.mapa;
    return { name: nombre, icon: icono, x: zorra.pos[0], z: zorra.pos[2], color };
  }

  dispose() {
    this._quitarRecicladores(this.game.world?.active);
    this.zorraJugador?.dispose();
    this.zorraJugador = null;
  }
}
