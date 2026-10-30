import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { geometryChunk, MaterialDeduper, VertexColorCarriers, bakeVertexColor } from './StaticGeometry.js';

const WALL_FACES = [0, 1, 4, 5];
const LOW_WALL_HEIGHT = 0.65;
const FADE_SECONDS = 0.22;
const RESTORE_DELAY = 0.18;
const SAMPLE_HEIGHTS = [0.45, 1.1, 1.85, 1.1, 1.1];

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
    this._closedMode = null;
    this._camera = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._hit = new THREE.Vector3();
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
            copy.userData.visibilityFade=true;
            if (material.userData.cityFacade) { copy.alphaHash = true; copy.transparent = false; copy.depthWrite = true; copy.userData.ditherFade = true; }
            copy.userData.staticBatchKey = key;
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
      const part = { object, roof, materials: [...clones.values()],
        bounds: new THREE.Box3().setFromObject(object).expandByScalar(0.08),
        opacity: 1, clearTime: RESTORE_DELAY };
      object.traverse(o => { o.matrixAutoUpdate = false; });
      return part;
    };
    const walls = [...shell.walls.values()].map(object => makePart(object, false));
    const roof = makePart(shell.roof, true);
    const building = { ...shell, baseBounds, bounds, parts: [...walls, roof], wallParts: walls, roofPart: roof };
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

  /** Versión agrupada de las partes altas para tercera persona; conserva el recorte isométrico. */
  buildClosedView() {
    const group = new THREE.Group(), buckets = new Map();
    // Cada edificio crea sus materiales: se unifican los idénticos y los lisos pasan a color por vértice.
    const deduper = new MaterialDeduper(), carriers = new VertexColorCarriers();
    this.closedCarriers = carriers;
    group.name = 'Edificios agrupados en tercera persona';
    group.userData.noMerge = true;
    group.visible = false;
    for (const building of this.buildings) for (const part of building.parts) {
      part.object.updateWorldMatrix(true, true);
      part.object.traverse(mesh => {
        if (!mesh.isMesh || Array.isArray(mesh.material)) return;
        const closed = this.closedMaterials.get(mesh.material.userData.staticBatchKey) ?? mesh.material;
        const resolved = deduper.resolve(closed), carried = carriers.resolve(resolved), material = carried?.material ?? resolved;
        const key = `${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${geometryChunk(mesh.geometry, mesh.matrixWorld)}`;
        if (!buckets.has(key)) buckets.set(key, { source: mesh, material, geometries: [] });
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
        // Las caras y los adornos comparten estos atributos; no se necesitan tangentes.
        const kept = ['position', 'normal', 'uv', ...(closed.userData.vertexAttributes ?? [])];
        for (const name of Object.keys(geometry.attributes)) if (!kept.includes(name)) geometry.deleteAttribute(name);
        if (!geometry.attributes.uv) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 2), 2));
        if (carried) bakeVertexColor(geometry, carried.color);
        buckets.get(key).geometries.push(geometry);
      });
    }
    for (const { source, material, geometries } of buckets.values()) {
      const geometry = mergeGeometries(geometries);
      for (const temporary of geometries) temporary.dispose();
      if (!geometry) throw new Error('Geometría incompatible en edificios agrupados');
      // Los lotes nunca comparten un material que pueda atenuarse en isométrica.
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = source.castShadow;
      mesh.receiveShadow = source.receiveShadow;
      geometry.computeBoundingSphere();
      group.add(mesh);
    }
    this.closedView = group;
    return group;
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
      if(material.userData.ditherFade){material.opacity=opacity;continue;}
      const transparent = opacity < 1;
      if (material.transparent !== transparent) { material.transparent = transparent; material.needsUpdate = true; }
      material.opacity = opacity;
      material.depthWrite = !transparent;
    }
  }

  update(dt, player, camera) {
    const wasEnabled = this.enabled;
    this.enabled = camera.userData.cameraMode === 'isometric';
    if (this.closedView && this._closedMode !== !this.enabled) {
      this._closedMode = !this.enabled;
      this.closedView.visible = this._closedMode;
      // Restaurar antes de ocultar las piezas también restaura los materiales usados por lotes.
      for (const building of this.buildings) for (const part of building.parts) {
        this._fade(part, false, dt, true);
        part.object.visible = this.enabled;
      }
    }
    if (!this.enabled) {
      if (wasEnabled && !this.closedView) for (const building of this.buildings) for (const part of building.parts) this._fade(part, false, dt, true);
      return;
    }
    this._camera.setFromMatrixPosition(camera.matrixWorld);
    this._right.setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize();
    for (let i = 0; i < this._rays.length; i++) {
      this._target.copy(player);
      this._target.y += SAMPLE_HEIGHTS[i];
      if (i >= 3) this._target.addScaledVector(this._right, i === 3 ? -0.45 : 0.45);
      const sample = this._rays[i];
      sample.distance = this._camera.distanceTo(this._target);
      sample.ray.set(this._camera, this._target.sub(this._camera).normalize());
    }
    for (const building of this.buildings) {
      const candidate = this._intersects(building.bounds);
      let blocked = candidate && this._intersects(building.roofPart.bounds);
      for (const wall of building.wallParts) {
        const hidden = candidate && this._intersects(wall.bounds);
        blocked ||= hidden;
        this._fade(wall, hidden, dt);
      }
      this._fade(building.roofPart, blocked, dt);
    }
  }

  dispose() {
    for (const material of this.closedMaterials.values()) material.dispose();
    for (const material of this.closedCarriers?.carriers.values() ?? []) material.dispose();
    this.closedCarriers = null;
    this.closedMaterials.clear();
    this.closedView = null;
    this._closedMode = null;
    this.buildings.length = 0;
  }
}
