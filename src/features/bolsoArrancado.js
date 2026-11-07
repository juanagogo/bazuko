// src/features/bolsoArrancado.js
// Lo que se lleva el raponazo: al contacto, el bolso, la bolsa o el maletín deja de verse en la víctima
// (Npc.quitarCarga) y aparece en la mano del tirón, la que fue a buscarlo. Mientras el jugador arranca a
// correr cuelga del puño, atravesado contra el pecho; al terminar el gesto se guarda y no queda nada en
// ninguna parte. Funciona con los dos cuerpos del jugador: los dos tienen `hold(objeto, postura)`.
import { Quaternion, Vector3 } from 'three';
import { streetPropInHand } from '../character/props.js';

/** Lo que tarda en voltearse de como lo cargaba la víctima a como lo aprieta el jugador. */
const VUELTA = .3;
/** Contra el pecho va atravesado: el lado largo de lado a lado, no hacia el frente. */
const ATRAVESADO = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);

const _padre = new Quaternion(), _meta = new Quaternion(), _giro = new Quaternion();
const _escalaPadre = new Vector3(), _sitio = new Vector3();
const smooth = v => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t); };

export class BolsoArrancado {
  constructor() {
    this.malla = null;
    this.id = null;
    this._t = 0;
    this._desde = new Quaternion();
    this._escala = new Vector3(1, 1, 1);
  }

  get enLaMano() { return !!this.malla; }

  /**
   * `prop` es la malla que se veía en la víctima (`prop-bolso`…), `cuerpo` el modelo que se ve del jugador y
   * `lado` la mano del tirón (1 derecha, -1 izquierda). Sin postura de mano en ese cuerpo no se ve nada, y
   * devuelve false; lo robado igual se lo lleva.
   */
  agarrar(prop, cuerpo, lado) {
    this.guardar();
    const id = prop?.name?.startsWith('prop-') ? prop.name.slice(5) : null;
    const malla = id && typeof cuerpo?.hold === 'function' ? streetPropInHand(id, prop.material) : null;
    if (!malla) return false;
    // Del tamaño que tenía en ella y, al primer cuadro, con el giro que tenía en ella.
    prop.updateWorldMatrix?.(true, false);
    prop.matrixWorld.decompose(_sitio, this._desde, this._escala);
    if (!cuerpo.hold(malla, lado < 0 ? 'cargar-izquierda' : 'cargar-derecha')) return false;
    this.malla = malla;
    this.id = id;
    this._t = 0;
    return true;
  }

  /**
   * Cuelga del puño con el rumbo del jugador (`raiz`), sin seguir los giros de la muñeca: el brazo sube al
   * pecho y lo arrancado sigue colgando derecho. Usa la matriz del puño de este cuadro.
   */
  update(dt, raiz) {
    const malla = this.malla, padre = malla?.parent;
    if (!padre) return;
    this._t += Math.max(0, dt);
    padre.updateWorldMatrix(true, false);
    padre.matrixWorld.decompose(_sitio, _padre, _escalaPadre);
    if (raiz?.getWorldQuaternion) raiz.getWorldQuaternion(_giro).multiply(ATRAVESADO);
    else _giro.copy(ATRAVESADO);
    _meta.slerpQuaternions(this._desde, _giro, smooth(this._t / VUELTA));
    malla.quaternion.copy(_padre.invert()).multiply(_meta);
    malla.scale.set(this._escala.x / (_escalaPadre.x || 1), this._escala.y / (_escalaPadre.y || 1), this._escala.z / (_escalaPadre.z || 1));
  }

  /** Al costal: deja de verse. La geometría y el material son compartidos; no se libera nada. */
  guardar() {
    this.malla?.removeFromParent();
    this.malla = null;
    this.id = null;
  }
}
