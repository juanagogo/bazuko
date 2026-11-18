// src/world/bogota/realRiders.js
// Quien va en una moto a pocos metros de la cámara es una persona completa de la calle (la misma de los peatones, con
// cara y ropa), no la malla horneada: un grupo fijo se precarga con la ciudad, cada una ya sentada en la pose de su puesto,
// y se presta a las motos más cercanas. Al alejarse vuelve al grupo y la moto pasa a llevar la versión horneada.
import * as THREE from 'three';
import { loadCatalog } from '../../character/RealisticCharacter.js';
import { RIDER_LOOKS, helmetParts, riderLook, seatedFigure } from './motoRiders.js';

export const REAL_NEAR = 18;
// Cada persona real son varias mallas con esqueleto: pasados estos, quien sigue va horneado aunque esté cerca.
export const REAL_MAX = 12;
// Cuántas personas reales hay por apariencia y puesto: conductores de sobra, un acompañante y los niños de a uno.
export const REAL_COPIES = { driver: 2, pillion: 1, tank: 1 };

const key = (kind, look, role) => `${kind}:${look}:${role}`;

async function seatedRider(kind, look, role, catalog) {
  const kid = kind === 'kid';
  const figure = await seatedFigure(riderLook(look, kid, catalog), kid, role);
  const holder = new THREE.Group();
  holder.name = 'Persona en moto';
  holder.matrixAutoUpdate = false;
  holder.add(figure.group);
  const [shell, visor] = helmetParts(figure.head, figure.size).map(([geometry, , rgb]) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: new THREE.Color(...rgb), roughness: .4 }));
    holder.add(mesh);
    return mesh;
  });
  holder.traverse(object => { if (object.isMesh) object.castShadow = false; });
  return { ...figure, holder, shell, visor };
}

export class RealRiders {
  /** `factory(kind, look, role)` entrega `{ holder, shell, visor }`; las pruebas pasan una de mentira. */
  constructor(root, { factory = null, copies = REAL_COPIES, looks = RIDER_LOOKS, near = REAL_NEAR, max = REAL_MAX } = {}) {
    this.root = root;
    this.near = near;
    this.max = max;
    this.copies = copies;
    this.looks = looks;
    this.factory = factory;
    this.free = new Map();
    this.all = [];
    this.taken = [];
  }

  /** Una tarea de precarga por persona, para la pantalla de carga. */
  tasks() {
    const jobs = [];
    for (const [kind, roles] of [['adult', ['driver', 'pillion']], ['kid', ['tank', 'pillion']]]) {
      for (let look = 0; look < this.looks[kind]; look++) {
        for (const role of roles) {
          for (let copy = 0; copy < this.copies[role]; copy++) jobs.push(() => this._make(kind, look, role));
        }
      }
    }
    return jobs;
  }

  async _make(kind, look, role) {
    const factory = this.factory ?? (async (...args) => seatedRider(...args, await loadCatalog()));
    const figure = await factory(kind, look, role);
    figure.holder.visible = false;
    figure.key = key(kind, look, role);
    this.all.push(figure);
    this.free.get(figure.key)?.push(figure) ?? this.free.set(figure.key, [figure]);
  }

  get size() { return this.all.length; }
  get used() { return this.taken.length; }

  begin() {
    for (const figure of this.taken) this.free.get(figure.key).push(figure);
    this._last = this.taken;
    this.taken = [];
  }

  take(at) { return this.taken.length >= this.max ? null : this.free.get(at)?.pop() ?? null; }

  put(figure, matrix, helmet) {
    this.taken.push(figure);
    figure.holder.matrix.copy(matrix);
    figure.holder.matrixWorldNeedsUpdate = true;
    figure.shell.visible = figure.visor.visible = !!helmet;
    if (helmet) figure.shell.material.color.copy(helmet);
    if (!figure.holder.parent) { this.root.add(figure.holder); figure.holder.visible = true; }
  }

  end() {
    for (const figure of this._last ?? []) if (!this.taken.includes(figure)) {
      figure.holder.visible = false;
      figure.holder.removeFromParent();
    }
    this._last = null;
  }

  dispose() {
    for (const { holder, character } of this.all) { holder.removeFromParent(); character?.dispose?.(); }
    this.all.length = this.taken.length = 0;
    this.free.clear();
  }
}
