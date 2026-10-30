import { StorageInstancedBufferAttribute } from 'three/webgpu';

/** Slop New York 09361be, main.js: storage uploads only changed matrices.
 * Small uniform-backed instance banks otherwise upload again in each cascade.
 * Keep data and usage; the new attribute gets its own initial GPU upload.
 * Geometry, population and transforms are unchanged.
 */
export function useInstanceStorage(object) {
  const source = object.instanceMatrix;
  if (!object.isInstancedMesh || !source || source.isStorageInstancedBufferAttribute) return false;
  const storage = new StorageInstancedBufferAttribute(source.array, source.itemSize);
  storage.setUsage(source.usage);
  object.instanceMatrix = storage;
  return true;
}
