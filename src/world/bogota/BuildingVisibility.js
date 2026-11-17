import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { STATIC_CHUNK_SIZE, geometryChunk } from './StaticGeometry.js';

const WALL_FACES = [0, 1, 4, 5];
const LOW_WALL_HEIGHT = 0.65;
const FADE_SECONDS = 0.22;
const RESTORE_DELAY = 0.18;
const SAMPLE_HEIGHTS = [0.45, 1.1, 1.85, 1.1, 1.1];
const AXES = ['x', 'y', 'z'];
// Los lotes cerrados son cajas con pocos triángulos y muchos materiales: lo que pesa son las llamadas.
export const CLOSED_CHUNK_SIZE = STATIC_CHUNK_SIZE * 2;
// En isométrica solo va con paredes sueltas el edificio cerca de la línea cámara-jugador. Entra a menos de
// LOOSE_MARGIN_IN metros de esa línea y vuelve al lote a más de LOOSE_MARGIN_OUT y con todo opaco: así no
// alterna en el borde ni corta un fundido.
export const LOOSE_MARGIN_IN = 1.5;
export const LOOSE_MARGIN_OUT = 3;

// Extrae una cara de la caja conservando la escala de sus texturas al separar los pisos.
function faceGeometry(source, face, height, bottom, top) {
  const geometry = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = source.getAttribute(name);
    const values = attribute.array.slice(face * 4 * attribute.itemSize, (face + 1) * 4 * attribute.itemSize);
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  geometry.setIndex(Array.from(source.index.array.slice(face * 6, face * 6 + 6), i => i - face * 4));
  const p = geometry.attributes.position, uv = geometry.attributes.uv;
  if (WALL_FACES.includes(face)) {
    let vMin = Infinity, vMax = -Infinity;
    for (let i = 0; i < 4; i++) { vMin = Math.min(vMin, uv.getY(i)); vMax = Math.max(vMax, uv.getY(i)); }
    for (let i = 0; i < 4; i++) {
      const y = p.getY(i) > 0 ? top : bottom;
      p.setY(i, y);
      uv.setY(i, vMin + (vMax - vMin) * y / height);
    }
  } else {
    for (let i = 0; i < 4; i++) p.setY(i, top);
  }
  return geometry;
}

/** Caja arquitectónica separada en zócalo cerrado, cuatro paredes altas y techo. */
export function createBuildingShell(source, materials, {
  x, z, height, interiorMaterial, facadeFace, wallInteriorMaterial, wallInteriorUV
}) {
  const root = new THREE.Group();
  root.position.set(x, 0, z);
  const base = new THREE.Group();
  root.add(base);
  const walls = new Map();
  for (const face of WALL_FACES) {
    const low = new THREE.Mesh(faceGeometry(source, face, height, 0, LOW_WALL_HEIGHT), materials[face]);
    low.castShadow = low.receiveShadow = true;
    base.add(low);
    const wall = new THREE.Group();
    wall.userData.noMerge = true;
    const mesh = new THREE.Mesh(faceGeometry(source, face, height, LOW_WALL_HEIGHT, height), materials[face]);
    // Las caras interiores son visibles: separar tabiques vecinos evita superficies coplanares.
    const normal = mesh.geometry.attributes.normal;
    mesh.geometry.translate(-normal.getX(0) * 0.015, 0, -normal.getZ(0) * 0.015);
    mesh.castShadow = mesh.receiveShadow = true;
    wall.add(mesh);
    if (face === facadeFace && wallInteriorMaterial) {
      // Desde dentro se ve ladrillo, no el aviso de la tienda escrito al revés.
      mesh.userData.visibilitySide = THREE.FrontSide;
      const geometry = mesh.geometry.clone();
      const uv = geometry.attributes.uv;
      const width = face < 2 ? source.parameters.depth : source.parameters.width;
      for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * width / wallInteriorUV[0], uv.getY(i) * height / wallInteriorUV[1]);
      }
      const inside = new THREE.Mesh(geometry, wallInteriorMaterial);
      inside.userData.visibilitySide = THREE.BackSide;
      inside.castShadow = inside.receiveShadow = true;
      wall.add(inside);
    }
    walls.set(face, wall);
    root.add(wall);
  }
  // La superficie interior termina la sección: no queda un hueco sin geometría al ocultar el techo.
  const floor = new THREE.Mesh(faceGeometry(source, 2, height, 0, LOW_WALL_HEIGHT), interiorMaterial);
  floor.receiveShadow = true;
  base.add(floor);
  const roof = new THREE.Group();
  roof.userData.noMerge = true;
  const roofMesh = new THREE.Mesh(faceGeometry(source, 2, height, 0, height), materials[2]);
  roofMesh.castShadow = roofMesh.receiveShadow = true;
  roof.add(roofMesh);
  root.add(roof);
  source.dispose();
  return { root, base, walls, roof, height };
}

export class BuildingVisibility {
  constructor() {
    this.buildings = [];
    this.enabled = false;
    this.closedView = null;
    this.closedMaterials = new Map();
    // false: la isométrica de antes, todas las paredes sueltas y sin lotes (comparación y descarte de fallas).
    this.isoBatches = true;
    this.isoStats = { sueltos: 0, lotesPartidos: 0, lotesOcultos: 0 };
    this._batches = [];
    this._dirty = new Set();
    this._mode = null;
    this._camera = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._hit = new THREE.Vector3();
    this._box = new THREE.Box3();
    // Caja de las cinco líneas cámara-jugador con el margen de salida: descarta de un golpe lo que no está cerca.
    this._sight = new THREE.Box3();
    this._rays = Array.from({ length: 5 }, () => ({ ray: new THREE.Ray(), distance: 0 }));
  }

  register(shell) {
    shell.root.updateWorldMatrix(true, true);
    const baseBounds = new THREE.Box3().setFromObject(shell.base);
    const bounds = baseBounds.clone();
    bounds.max.y = shell.root.position.y + shell.height;
    bounds.expandByScalar(0.6);
    const makePart = (object, roof) => {
      // Cada pieza tiene materiales propios: atenuar una pared no cambia las demás casas.
      const clones = new Map();
      object.traverse(mesh => {
        if (!mesh.isMesh) return;
        const clone = material => {
          const side = mesh.userData.visibilitySide ?? THREE.DoubleSide;
          const key = `${material.uuid}:${side}`;
          if (!clones.has(key)) {
            const copy = material.clone();
            copy.side = side;
            copy.userData.staticBatchKey = key;
            // Lo de fábrica: una mancha de humedad ya es transparente y debe volver a serlo tras atenuarse.
            copy.userData.fadeBase = { transparent: material.transparent, depthWrite: material.depthWrite, opacity: material.opacity };
            if (!this.closedMaterials.has(key)) {
              const closed = material.clone();
              closed.side = side;
              this.closedMaterials.set(key, closed);
            }
            clones.set(key, copy);
          }
          return clones.get(key);
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material);
      });
      const meshes = [];
      object.traverse(mesh => { if (mesh.isMesh) meshes.push(mesh); });
      // `kept`: las mallas transparentes o con varios materiales, que en isométrica siguen sueltas aunque el
      // edificio vaya en lotes.
      const part = { object, roof, materials: [...clones.values()], meshes, kept: [],
        bounds: new THREE.Box3().setFromObject(object).expandByScalar(0.08),
        opacity: 1, clearTime: RESTORE_DELAY };
      object.traverse(o => { o.matrixAutoUpdate = false; });
      return part;
    };
    const walls = [...shell.walls.values()].map(object => makePart(object, false));
    const roof = makePart(shell.roof, true);
    // Sin lotes cerrados todo se ve suelto; buildClosedView los pasa a sus lotes.
    const building = { ...shell, baseBounds, bounds, parts: [...walls, roof], wallParts: walls, roofPart: roof, loose: true, batches: [] };
    this.buildings.push(building);
    return building;
  }

  _intersects(bounds) {
    for (const { ray, distance } of this._rays) {
      if (ray.intersectBox(bounds, this._hit) &&
          this._camera.distanceToSquared(this._hit) < (distance - 0.08) ** 2) return true;
    }
    return false;
  }

  /**
   * Versión agrupada de las partes altas. Tercera persona la usa entera; la isométrica también, salvo los
   * tramos de los edificios cercanos a la línea de vista, que se dibujan con sus paredes sueltas.
   */
  buildClosedView() {
    const group = new THREE.Group(), buckets = new Map();
    group.name = 'Edificios agrupados';
    group.userData.noMerge = true;
    for (const building of this.buildings) for (const part of building.parts) {
      part.object.updateWorldMatrix(true, true);
      part.object.traverse(mesh => {
        if (!mesh.isMesh) return;
        // Varios materiales no entran en un lote: en isométrica sigue suelta, como antes, para no desaparecer.
        if (Array.isArray(mesh.material)) { part.kept.push(mesh); return; }
        const key = `${mesh.material.userData.staticBatchKey ?? mesh.material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${geometryChunk(mesh.geometry, mesh.matrixWorld, CLOSED_CHUNK_SIZE)}`;
        if (!buckets.has(key)) buckets.set(key, { source: mesh, geometries: [], owners: [] });
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        // Las caras y los adornos comparten estos atributos; no se necesitan tangentes.
        for (const name of Object.keys(geometry.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geometry.deleteAttribute(name);
        buckets.get(key).geometries.push(geometry);
        buckets.get(key).owners.push(building);
        // Lo transparente se ordena por objeto: fundido en un lote se pintaría delante de una pared atenuada.
        if (mesh.material.transparent) part.kept.push(mesh);
      });
    }
    for (const { source, geometries, owners } of buckets.values()) {
      // Se recorren edificio por edificio: lo de cada uno queda en un tramo seguido del índice.
      const ranges = [];
      let start = 0;
      geometries.forEach((geometry, i) => {
        const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
        const last = ranges.at(-1);
        if (last?.building === owners[i]) last.count += count;
        else ranges.push({ building: owners[i], start, count });
        start += count;
      });
      const geometry = mergeGeometries(geometries);
      for (const temporary of geometries) temporary.dispose();
      if (!geometry) throw new Error('Geometría incompatible en edificios agrupados');
      // Los lotes nunca comparten un material que pueda atenuarse en isométrica.
      const material = this.closedMaterials.get(source.material.userData.staticBatchKey) ?? source.material;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = source.castShadow;
      mesh.receiveShadow = source.receiveShadow;
      geometry.computeBoundingSphere();
      group.add(mesh);
      const batch = { mesh, material, split: [material], ranges, total: start, transparent: material.transparent };
      this._batches.push(batch);
      for (const range of ranges) if (!range.building.batches.includes(batch)) range.building.batches.push(batch);
    }
    this.closedView = group;
    this._mode = null;
    // Hasta el primer update, como en tercera persona: todo en sus lotes.
    for (const building of this.buildings) this._setLoose(building, false);
    this._refreshBatches();
    return group;
  }

  /**
   * Edificio suelto (paredes propias, que se pueden atenuar) o dentro de sus lotes. En isométrica, sus
   * mallas transparentes o con varios materiales quedan sueltas igual, como se dibujaban antes.
   */
  _setLoose(building, loose) {
    if (building.loose === loose) return;
    building.loose = loose;
    const kept = this._mode === 'mixto';
    for (const part of building.parts) {
      if (part.kept.length) for (const mesh of part.meshes) mesh.visible = loose || (kept && part.kept.includes(mesh));
      part.object.visible = (loose || (kept && part.kept.length > 0)) && part.opacity > 0;
    }
    for (const batch of building.batches) this._dirty.add(batch);
  }

  /**
   * Cada lote dibuja los tramos de sus edificios que no están sueltos: entero con su material, o por grupos
   * del mismo índice. La geometría no se toca, así que lo que queda en el lote se ve igual que antes.
   */
  _refreshBatches() {
    const kept = this._mode === 'mixto';
    for (const batch of this._dirty) {
      const { mesh, ranges } = batch, geometry = mesh.geometry;
      geometry.clearGroups();
      let shown = 0;
      for (const { building, start, count } of ranges) {
        if (building.loose || (kept && batch.transparent)) continue;
        const last = geometry.groups.at(-1);
        if (last && last.start + last.count === start) last.count += count;
        else geometry.addGroup(start, count, 0);
        shown += count;
      }
      mesh.visible = shown > 0;
      if (shown === batch.total) geometry.clearGroups();
      mesh.material = geometry.groups.length ? batch.split : batch.material;
    }
    this._dirty.clear();
    const stats = this.isoStats;
    stats.sueltos = 0; stats.lotesPartidos = 0; stats.lotesOcultos = 0;
    for (const building of this.buildings) if (building.loose) stats.sueltos++;
    for (const { mesh } of this._batches) {
      if (!mesh.visible) stats.lotesOcultos++;
      else if (mesh.geometry.groups.length) stats.lotesPartidos++;
    }
  }

  /** ¿Pasa alguna de las líneas cámara-jugador a menos de `margin` metros de la caja? */
  _nearSight(bounds, margin) {
    const box = this._box.copy(bounds).expandByScalar(margin);
    for (const { ray, distance } of this._rays) {
      let near = 0, far = distance;
      for (const axis of AXES) {
        const origin = ray.origin[axis], direction = ray.direction[axis];
        if (Math.abs(direction) < 1e-9) {
          if (origin < box.min[axis] || origin > box.max[axis]) { far = -1; break; }
          continue;
        }
        let t0 = (box.min[axis] - origin) / direction, t1 = (box.max[axis] - origin) / direction;
        if (t0 > t1) [t0, t1] = [t1, t0];
        if (t0 > near) near = t0;
        if (t1 < far) far = t1;
        if (near > far) break;
      }
      if (near <= far) return true;
    }
    return false;
  }

  _fade(part, hidden, dt, reset = false) {
    part.clearTime = hidden ? 0 : part.clearTime + dt;
    const target = hidden || part.clearTime < RESTORE_DELAY ? 0 : 1;
    const opacity = reset ? 1 : THREE.MathUtils.clamp(part.opacity + (target ? 1 : -1) * dt / FADE_SECONDS, 0, 1);
    if (reset) part.clearTime = RESTORE_DELAY;
    if (opacity === part.opacity) return;
    part.opacity = opacity;
    part.object.visible = opacity > 0;
    for (const material of part.materials) {
      const base = material.userData.fadeBase, transparent = opacity < 1 || base.transparent;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = base.opacity * opacity;
      material.depthWrite = opacity < 1 ? false : base.depthWrite;
    }
  }

  update(dt, player, camera) {
    const wasEnabled = this.enabled;
    this.enabled = camera.userData.cameraMode === 'isometric';
    const batched = !!this.closedView && this.isoBatches;
    // Tercera persona: todo en lotes. Isométrica sin lotes: todo suelto. Isométrica con lotes: lo cercano.
    const mode = !this.enabled ? 'cerrado' : batched ? 'mixto' : 'suelto';
    if (this.closedView && this._mode !== mode) {
      this._mode = mode;
      this.closedView.visible = mode !== 'suelto';
      // Restaurar antes de ocultar las piezas también restaura los materiales usados por lotes.
      // En mixto todo empieza en sus lotes y este mismo cuadro suelta lo cercano, antes de atenuar nada.
      for (const building of this.buildings) {
        for (const part of building.parts) this._fade(part, false, dt, true);
        building.loose = null;
        this._setLoose(building, mode === 'suelto');
      }
      this._refreshBatches();
    }
    if (!this.enabled) {
      if (wasEnabled && !this.closedView) for (const building of this.buildings) for (const part of building.parts) this._fade(part, false, dt, true);
      return;
    }
    this._camera.setFromMatrixPosition(camera.matrixWorld);
    this._right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    this._sight.makeEmpty().expandByPoint(this._camera);
    for (let i = 0; i < this._rays.length; i++) {
      this._target.copy(player);
      this._target.y += SAMPLE_HEIGHTS[i];
      if (i >= 3) this._target.addScaledVector(this._right, i === 3 ? -0.45 : 0.45);
      this._sight.expandByPoint(this._target);
      const sample = this._rays[i];
      sample.distance = this._camera.distanceTo(this._target);
      sample.ray.set(this._camera, this._target.sub(this._camera).normalize());
    }
    this._sight.expandByScalar(LOOSE_MARGIN_OUT);
    for (const building of this.buildings) {
      if (mode === 'mixto') {
        // Suelto a tiempo: una pared solo se atenúa si alguna línea toca la caja, y esa ya está a menos del margen.
        // Lo que no toca la caja de las líneas queda a más de LOOSE_MARGIN_OUT de todas: no hace falta medirlo.
        const near = this._sight.intersectsBox(building.bounds) &&
          this._nearSight(building.bounds, building.loose ? LOOSE_MARGIN_OUT : LOOSE_MARGIN_IN);
        this._setLoose(building, near || (building.loose && building.parts.some(part => part.opacity < 1)));
        if (!building.loose) continue;
      }
      const candidate = this._intersects(building.bounds);
      let blocked = candidate && this._intersects(building.roofPart.bounds);
      for (const wall of building.wallParts) {
        const hidden = candidate && this._intersects(wall.bounds);
        blocked ||= hidden;
        this._fade(wall, hidden, dt);
      }
      this._fade(building.roofPart, blocked, dt);
    }
    if (this._dirty.size) this._refreshBatches();
  }

  dispose() {
    for (const material of this.closedMaterials.values()) material.dispose();
    this.closedMaterials.clear();
    this.closedView = null;
    this._mode = null;
    this._batches.length = 0;
    this._dirty.clear();
    this.buildings.length = 0;
  }
}
