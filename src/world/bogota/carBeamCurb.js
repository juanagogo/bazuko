import { BufferAttribute, DynamicDrawUsage } from 'three';

const ESCALON = .055;

/** Reserva espacio para partir cada triángulo en tres si el haz cruza una discontinuidad del suelo. */
export function prepararCortes(geometria) {
  const base = geometria.attributes.position.count, triangulos = geometria.index.array;
  const capacidad = base + 4 * triangulos.length / 3;
  for (const atributo of Object.values(geometria.attributes)) {
    const array = new Float32Array(capacidad * atributo.itemSize);
    array.set(atributo.array);
    atributo.array = array;
    atributo.count = capacidad;
    atributo.setUsage(DynamicDrawUsage);
  }
  const indices = new Uint16Array(triangulos.length * 3);
  indices.set(triangulos);
  geometria.setIndex(new BufferAttribute(indices, 1).setUsage(DynamicDrawUsage));
  geometria.setDrawRange(0, triangulos.length);
  return { base, triangulos, activos: false };
}

function cortarArista({ position, uv, normal }, a, b, destino, suelo) {
  const ax = position.getX(a), ay = position.getY(a), za = position.getZ(a);
  const dx = position.getX(b) - ax, dy = position.getY(b) - ay, zb = position.getZ(b);
  const mitad = (za + zb) / 2;
  if (Math.abs(za - zb) < ESCALON || Math.abs(suelo(ax + dx / 2, ay + dy / 2, mitad) - mitad) < ESCALON / 2) return false;
  let desde = 0, hasta = 1, yA = za, yB = zb;
  for (let i = 0; i < 9; i++) {
    const t = (desde + hasta) / 2, altura = suelo(ax + t * dx, ay + t * dy, mitad);
    if ((altura < mitad) === (za < mitad)) { desde = t; yA = altura; }
    else { hasta = t; yB = altura; }
  }
  if (Math.abs(yA - yB) < ESCALON) return false;
  const t = (desde + hasta) / 2, x = ax + t * dx, y = ay + t * dy;
  const u = uv.getX(a) + (uv.getX(b) - uv.getX(a)) * t, v = uv.getY(a) + (uv.getY(b) - uv.getY(a)) * t;
  position.setXYZ(destino, x, y, yA); position.setXYZ(destino + 1, x, y, yB);
  uv.setXY(destino, u, v); uv.setXY(destino + 1, u, v);
  normal.setXYZ(destino, 0, 0, 1); normal.setXYZ(destino + 1, 0, 0, 1);
  return true;
}

/** La luz que cae a cada lado del sardinel termina en su propia altura; la UV es continua en la arista. */
export function cortarSardineles(geometria, suelo, desnivel) {
  const cortes = geometria.userData.cortes;
  if (!cortes.activos && desnivel < ESCALON) return;
  const { position, uv, normal } = geometria.attributes, dst = geometria.index.array, src = cortes.triangulos;
  let cantidad = 0, vertice = cortes.base;
  for (let i = 0; i < src.length; i += 3) {
    let a = src[i], b = src[i + 1], c = src[i + 2];
    const ab = Math.abs(position.getZ(a) - position.getZ(b)), bc = Math.abs(position.getZ(b) - position.getZ(c));
    const ca = Math.abs(position.getZ(c) - position.getZ(a));
    if (Math.max(ab, bc, ca) >= ESCALON) {
      // A queda en un nivel, B y C en el otro. Se conserva el orden de las caras.
      if (ab <= bc && ab <= ca) { a = src[i + 2]; b = src[i]; c = src[i + 1]; }
      else if (ca < bc) { a = src[i + 1]; b = src[i + 2]; c = src[i]; }
      if (cortarArista(geometria.attributes, a, b, vertice, suelo) &&
          cortarArista(geometria.attributes, a, c, vertice + 2, suelo)) {
        dst[cantidad++] = a; dst[cantidad++] = vertice; dst[cantidad++] = vertice + 2;
        dst[cantidad++] = vertice + 1; dst[cantidad++] = b; dst[cantidad++] = c;
        dst[cantidad++] = vertice + 1; dst[cantidad++] = c; dst[cantidad++] = vertice + 3;
        vertice += 4;
        continue;
      }
    }
    dst[cantidad++] = src[i]; dst[cantidad++] = src[i + 1]; dst[cantidad++] = src[i + 2];
  }
  const activos = vertice > cortes.base;
  if (activos || cortes.activos) {
    geometria.setDrawRange(0, cantidad);
    geometria.index.needsUpdate = true;
    if (activos) { position.needsUpdate = uv.needsUpdate = normal.needsUpdate = true; }
  }
  cortes.activos = activos;
}
