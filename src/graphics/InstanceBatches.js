import * as THREE from 'three';
import {useInstanceStorage} from './InstanceStorage.js';

/**
 * Lotes instanciados de objetos sueltos que aparecen y desaparecen (bolsas, contenedores, aros).
 *
 * Cada objeto registrado deja de verse en las cámaras (capa vacía) pero conserva su `visible`, su
 * posición y su lógica: el juego sigue ocultándolo al recogerlo y mostrándolo al reaparecer. Cada
 * cuadro, después del descarte por frustum, el lote copia las matrices de los que están a la vista
 * o proyectan sombra: un dibujo por tipo en lugar de uno por objeto.
 */
const registries = new WeakMap();
const MIN_CAPACITY = 64;
// Más allá de esta distancia a la cámara un objeto suelto sigue dibujándose pero ya no proyecta sombra del sol:
// sus modelos tienen miles de triángulos y la cascada lejana los repetía todos (415 mil triángulos por pasada).
export const SHADOW_RANGE = 48;

export class InstanceBatches {
  constructor(scene) {
    this.scene = scene;
    this.groups = new Map();
    this._at = new THREE.Vector3();
    this.root = new THREE.Group();
    this.root.name = 'Objetos sueltos agrupados';
    this.root.userData.noMerge = true;
    scene.add(this.root);
  }

  /**
   * Por omisión agrupa objetos que comparten geometría y material. Con `key` agrupa objetos con
   * recursos propios pero equivalentes: el lote usa copias, porque cada dueño libera los suyos.
   */
  add(object, key = null) {
    const id = key ?? `${object.geometry.uuid}|${object.material.uuid}`;
    let group = this.groups.get(id);
    if (!group) this.groups.set(id, group = { source: object, owned: key !== null, members: new Set(), mesh: null });
    group.members.add(object);
    object.layers.disableAll();
    return () => {
      group.members.delete(object);
      object.layers.enable(0);
    };
  }

  _mesh(group, far = false) {
    const key = far ? 'far' : 'mesh';
    const needed = Math.max(MIN_CAPACITY, THREE.MathUtils.ceilPowerOfTwo(group.members.size));
    if (group[key] && group[key].instanceMatrix.count >= group.members.size) return group[key];
    if (group[key]) { this.root.remove(group[key]); group[key].dispose(); }
    const { source } = group;
    group.geometry ??= group.owned ? source.geometry.clone() : source.geometry;
    group.material ??= group.owned ? source.material.clone() : source.material;
    const mesh = new THREE.InstancedMesh(group.geometry, group.material, needed);
    useInstanceStorage(mesh);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.name = `${source.name || source.geometry.type} · lote${far ? ' lejano' : ''}`;
    mesh.castShadow = source.castShadow && !far;
    mesh.receiveShadow = source.receiveShadow;
    mesh.renderOrder = source.renderOrder;
    mesh.frustumCulled = false; // los miembros ya pasaron el descarte del cuadro
    mesh.count = 0;
    this.root.add(mesh);
    return group[key] = mesh;
  }

  sync(camera = null) {
    // Tras el calentamiento los lotes vacíos no se dibujan; durante él sí, para que sus pipelines queden preparados.
    const skip = this.scene.userData.skipEmptyBatches === true;
    if (camera) camera.getWorldPosition(this._eye ??= new THREE.Vector3());
    for (const group of this.groups.values()) {
      const near = this._mesh(group), far = camera && group.source.castShadow ? this._mesh(group, true) : group.far;
      near.count = 0;
      if (far) far.count = 0;
      for (const object of group.members) {
        let visible = !!object.parent;
        for (let node = object; node && visible; node = node.parent) visible = node.visible;
        if (!visible) continue;
        object.updateWorldMatrix(true, false);
        const mesh = camera && far && this._eye.distanceToSquared(this._at.setFromMatrixPosition(object.matrixWorld)) > SHADOW_RANGE * SHADOW_RANGE ? far : near;
        mesh.setMatrixAt(mesh.count++, object.matrixWorld);
      }
      near.visible = !skip || near.count > 0;
      near.instanceMatrix.needsUpdate = true;
      if (far) { far.visible = !skip || far.count > 0; far.instanceMatrix.needsUpdate = true; }
    }
  }

  dispose() {
    for (const group of this.groups.values()) {
      for (const object of group.members) object.layers.enable(0);
      group.mesh?.dispose();
      group.far?.dispose();
      if (group.owned) { group.geometry?.dispose(); group.material?.dispose(); }
    }
    this.groups.clear();
    this.root.removeFromParent();
    registries.delete(this.scene);
  }
}

export function instanceBatches(scene) {
  let batches = registries.get(scene);
  if (!batches) registries.set(scene, batches = new InstanceBatches(scene));
  return batches;
}
export function syncInstanceBatches(scene, camera = null) { registries.get(scene)?.sync(camera); }
export function disposeInstanceBatches(scene) { registries.get(scene)?.dispose(); }
