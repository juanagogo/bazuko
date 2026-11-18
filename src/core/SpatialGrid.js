// Llave numérica de cada celda: exacta de -16384 a 16383 celdas por eje (±262 km con celdas de 16 m; la ciudad mide
// 400 × 322 m) y siempre un entero de 31 bits, que V8 guarda sin crear objetos. Un texto o un número mayor dejan basura.
// Coordenadas no finitas, como siempre: con NaN los bucles no dan vuelta (nada entra ni sale) y con ±Infinity no terminan.
const CELL_RANGE = 16384;
const cellKey = (x, z) => (x + CELL_RANGE) * (2 * CELL_RANGE) + (z + CELL_RANGE);

/** Índice conservador X/Z: guarda volúmenes completos, incluidos los que cruzan celdas. */
export class SpatialGrid {
  constructor(cellSize = 16) {
    this.cellSize = cellSize;
    this.cells = new Map();
    this.seen = new Set();
  }

  clear() {
    // Reutilizar los buckets evita recrearlos en cada subpaso del tráfico.
    for (const bucket of this.cells.values()) bucket.length = 0;
  }

  insert(item, minX, minZ, maxX = minX, maxZ = minZ) {
    const size = this.cellSize;
    for (let z = Math.floor(minZ / size); z <= Math.floor(maxZ / size); z++) {
      for (let x = Math.floor(minX / size); x <= Math.floor(maxX / size); x++) {
        const key = cellKey(x, z);
        let bucket = this.cells.get(key);
        if (!bucket) this.cells.set(key, bucket = []);
        bucket.push(item);
      }
    }
  }

  query(minX, minZ, maxX, maxZ, result = []) {
    result.length = 0;
    this.seen.clear();
    const size = this.cellSize;
    for (let z = Math.floor(minZ / size); z <= Math.floor(maxZ / size); z++) {
      for (let x = Math.floor(minX / size); x <= Math.floor(maxX / size); x++) {
        const bucket = this.cells.get(cellKey(x, z));
        if (!bucket) continue;
        for (const item of bucket) {
          if (this.seen.has(item)) continue;
          this.seen.add(item);
          result.push(item);
        }
      }
    }
    return result;
  }
}
