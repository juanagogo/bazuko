import { Vector3 } from 'three';
import { kitDistante, motoDistante } from './motoDistante.js';

// A 55° de campo vertical: salir a 30 m y volver a 24 m. Con teleobjetivo se conserva el detalle más lejos.
const SALIR = 30, ENTRAR = 24;
const FOCAL_BASE = 1 / Math.tan(55 * Math.PI / 360);

function nivelesDeMalla(malla, lejos) {
  const cerca = malla.geometry;
  const cajaCerca = malla.boundingBox.clone(), esferaCerca = malla.boundingSphere.clone();
  malla.geometry = lejos;
  malla.computeBoundingBox();
  malla.computeBoundingSphere();
  malla.boundingBox.union(cajaCerca);
  malla.boundingSphere.union(esferaCerca);
  malla.geometry = cerca;
  return { malla, cerca, lejos };
}

/** Se prepara antes de registrar el descarte: cámara, sombras y diagnóstico usan los límites de ambos modelos. */
export function prepararDetalleMotos(raiz) {
  const lotes = raiz.children.map(malla => {
    const niveles = [nivelesDeMalla(malla, motoDistante())];
    for (const kit of malla.children) niveles.push(nivelesDeMalla(kit, kitDistante()));
    return { malla, niveles, cerca: true };
  });
  const ojo = new Vector3(), centro = new Vector3();
  return camara => {
    const escala = FOCAL_BASE / camara.projectionMatrix.elements[5];
    ojo.setFromMatrixPosition(camara.matrixWorld);
    for (const lote of lotes) {
      const limite = lote.cerca ? SALIR : ENTRAR;
      let cerca;
      if (camara.isOrthographicCamera) {
        // En una proyección paralela el tamaño visible depende del zoom, a cualquier distancia.
        cerca = escala < limite;
      } else {
        const esfera = lote.malla.boundingSphere, mundo = lote.malla.matrixWorld;
        centro.copy(esfera.center).applyMatrix4(mundo);
        const radio = esfera.radius * mundo.getMaxScaleOnAxis();
        cerca = centro.distanceToSquared(ojo) < (limite / escala + radio) ** 2;
      }
      if (cerca === lote.cerca) continue;
      for (const nivel of lote.niveles) nivel.malla.geometry = cerca ? nivel.cerca : nivel.lejos;
      lote.cerca = cerca;
    }
  };
}
