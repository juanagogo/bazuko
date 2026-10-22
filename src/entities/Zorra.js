// src/entities/Zorra.js
// Zorra del jugador: modelo 3D y objetivo de interacción para volver a agarrarla.

import * as THREE from 'three';
import { zorra } from '../world/bogota/props.js';
import { ZORRA } from '../data/zorra.js';

export class Zorra {
  constructor(scene, {
    crearModelo = zorra,
    interactable = () => false,
    prompt = () => '',
    interactuar = () => {}
  } = {}) {
    this.kind = 'zorra';
    this.scene = scene;
    this.group = crearModelo();
    this.group.userData.noMerge = true;
    this.anchor = new THREE.Vector3();
    this._interactable = interactable;
    this._prompt = prompt;
    this._interactuar = interactuar;
    scene.add(this.group);
  }

  /** Punto de interacción: el ancla, no el centro del modelo (que puede quedar dentro de un muro). */
  get position() { return this.anchor; }
  get interactable() { return !!this._interactable(); }
  get prompt() { return this._prompt(); }
  interactuar() { this._interactuar(); }

  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }

  /** Ancla en `pos`; el modelo queda delante según `rotY`. */
  colocarDelante(pos, rotY) {
    this.anchor.copy(pos);
    this.group.position.set(
      pos.x + Math.sin(rotY) * ZORRA.distanciaDelante,
      pos.y,
      pos.z + Math.cos(rotY) * ZORRA.distanciaDelante
    );
    this.group.rotation.y = rotY;
  }

  /** Cuelga el modelo de `root` (el jugador) para que lo siga. */
  adjuntarA(root) {
    root.add(this.group);
    this.group.position.set(0, 0, ZORRA.distanciaDelante);
    this.group.rotation.set(0, 0, 0);
  }

  /** Vuelve a la escena conservando la pose mundial; el ancla queda donde estaba el padre. */
  dejarEnEscena() {
    const padre = this.group.parent;
    if (padre && padre !== this.scene) {
      padre.getWorldPosition(this.anchor);
      this.scene.attach(this.group);
    }
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose?.()); else m?.dispose?.();
    });
  }
}
