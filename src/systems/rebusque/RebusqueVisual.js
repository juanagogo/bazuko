// src/systems/rebusque/RebusqueVisual.js
// Las pelotas de los malabares: tres, en cascada entre las manos del jugador, con el reloj del show
// (systems/rebusque/ritmo.js), el mismo que mueve los brazos (character/rebusquePose.js).
//
// Solo lee `game.rebusque.trabajo` y las manos del personaje. Sin show no existe ninguna malla; al terminar se ocultan.
// Tres mallas propias, sin sombras; geometría y materiales creados una vez y liberados en dispose().
import * as THREE from 'three';
import { BEAT, VUELO, ALTURA, manoDe } from './ritmo.js';

const BOLA_R = .035;
const COLORES_BOLA = ['#d8322b', '#f2c230', '#2f9e4f'];
const norm = name => String(name ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();

export class RebusqueVisual {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.group = null;      // se crea con el primer show
    this._char = null;      // personaje cuyas manos están en caché
    this._manos = [null, null];
    this._dedos = [null, null];
    this._palma = [new THREE.Vector3(), new THREE.Vector3()];
    this._u = new THREE.Vector3();
    this._bolas = [];       // { mesh, k, desde: Vector3 }
  }

  _armar() {
    if (this.group) return;
    this.group = new THREE.Group();
    this.group.name = 'Rebusque: pelotas';
    this.scene?.add(this.group);
    this._geo = new THREE.SphereGeometry(BOLA_R, 12, 8);
    this._mat = COLORES_BOLA.map(color => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: .55 });
      m.name = 'rebusque-pelota';
      return m;
    });
    for (let b = 0; b < 3; b++) {
      const mesh = new THREE.Mesh(this._geo, this._mat[b]);
      mesh.name = `Pelota de malabares ${b + 1}`;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.visible = false;
      this.group.add(mesh);
      this._bolas.push({ mesh, k: -1, desde: new THREE.Vector3() });
    }
  }

  // ---------- manos del jugador ----------

  /** Busca las manos una vez por personaje (cambia con el modelo o al reconstruirlo). */
  _buscarManos() {
    const ch = this.game.player?.character;
    if (ch === this._char && this._colgada(this._manos[0], ch)) return;
    this._char = ch; this._grupo = ch?.group; this._hijos = ch?.group?.children?.length ?? 0;
    this._manos = [null, null]; this._dedos = [null, null];
    ch?.group?.traverse?.(o => {
      const n = norm(o.name);
      const i = n.endsWith('righthand') ? 0 : n.endsWith('lefthand') ? 1 : -1;
      if (i < 0 || this._manos[i]) return;
      this._manos[i] = o;
      // El dedo medio da hacia dónde queda la palma; si no hay, el primer hueso hijo.
      let dedo = null;
      o.traverse(c => { if (!dedo && c !== o && /middle1$/.test(norm(c.name))) dedo = c; });
      this._dedos[i] = dedo ?? o.children.find(c => c.isBone) ?? null;
    });
  }

  /** ¿La mano en caché sigue colgada del grupo del personaje? Si el modelo se reconstruyó, hay que buscarla otra vez. */
  _colgada(mano, ch) {
    // Ya se buscó en este mismo grupo y no tenía huesos: se vuelve a buscar solo si le llega otro modelo.
    if (!mano) return ch?.group === this._grupo && (ch?.group?.children?.length ?? 0) === this._hijos;
    for (let o = mano; o; o = o.parent) if (o === ch?.group) return true;
    return false;
  }

  /** Palma de la mano (0 derecha, 1 izquierda) en el mundo. Sin huesos (el muñeco procedural), un punto delante del pecho. */
  _palmaDe(i, out = this._palma[i]) {
    const mano = this._manos[i];
    if (mano) {
      mano.getWorldPosition(out);
      const dedo = this._dedos[i];
      if (dedo) out.lerp(dedo.getWorldPosition(this._u), .55);
      return out;
    }
    const player = this.game.player, s = player?.modelScale ?? 1;
    out.set(i === 0 ? -.2 : .2, 1.02, .32).multiplyScalar(s);
    return player?.root ? player.root.localToWorld(out) : out.add(player?.position ?? this._u.set(0, 0, 0));
  }

  // ---------- ciclo ----------

  update() {
    const t = this.game.rebusque?.trabajo?.tiempo;
    if (t === undefined) {
      if (this.group?.visible) { this.group.visible = false; for (const b of this._bolas) b.k = -1; }
      return;
    }
    this._armar();
    this.group.visible = true;
    this._buscarManos();
    this._palmaDe(0); this._palmaDe(1);
    const kAhora = Math.floor(t / BEAT + 1e-9);
    for (let b = 0; b < 3; b++) {
      const bola = this._bolas[b], mesh = bola.mesh;
      // El lanzamiento más reciente de esta pelota.
      const k = kAhora - (((kAhora - b) % 3) + 3) % 3;
      mesh.visible = true;
      if (k < 0) { // todavía en la mano que la va a lanzar; la tercera espera montada sobre la primera
        mesh.position.copy(this._palma[manoDe(b)]);
        if (b === 2) mesh.position.y += 2 * BOLA_R;
        continue;
      }
      if (k !== bola.k) {
        // Acaba de salir: el punto de partida es la mano que lanza, un poco hacia adentro.
        bola.k = k;
        bola.desde.copy(this._palma[manoDe(k)]).lerp(this._palma[1 - manoDe(k)], .08);
      }
      const destino = this._palma[1 - manoDe(k)];
      const tau = (t - k * BEAT) / VUELO;
      if (tau < 1) {
        mesh.position.copy(bola.desde).lerp(destino, tau);
        mesh.position.y += 4 * ALTURA * tau * (1 - tau);
        continue;
      }
      // En la mano: la lleva hacia adentro y abajo antes de lanzarla otra vez.
      const enMano = Math.min(1, (t - k * BEAT - VUELO) / (3 * BEAT - VUELO));
      mesh.position.copy(destino).lerp(this._palma[manoDe(k)], .06 * Math.sin(Math.PI * enMano));
    }
  }

  dispose() {
    if (!this.group) return;
    this.group.removeFromParent();
    this._geo.dispose();
    for (const m of this._mat) m.dispose();
    this.group = this._geo = this._mat = null;
    this._bolas = [];
  }
}
