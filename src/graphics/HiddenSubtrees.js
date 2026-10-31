import { Object3D } from 'three';

const baseUpdateMatrixWorld = Object3D.prototype.updateMatrixWorld;

/**
 * Three recorre los descendientes de un objeto oculto en cada fotograma: un peatón fuera de cámara
 * arrastraba unos 60 huesos que nadie dibuja ni anima. Mientras `visible` sea falso solo se actualiza
 * la matriz propia; al volver a mostrarse se fuerza una actualización completa. No usar en objetos
 * cuyos hijos se consultan estando ocultos (los grupos del descarte por frustum calculan límites con ellos).
 */
export function skipWhenHidden(root) {
  let stale = false;
  root.updateMatrixWorld = function (force) {
    if (!this.visible) {
      if (this.matrixAutoUpdate) this.updateMatrix();
      if ((this.matrixWorldNeedsUpdate || force) && this.matrixWorldAutoUpdate === true) {
        if (this.parent === null) this.matrixWorld.copy(this.matrix);
        else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      stale = true;
      return;
    }
    baseUpdateMatrixWorld.call(this, force || stale);
    stale = false;
  };
  return () => { delete root.updateMatrixWorld; };
}
