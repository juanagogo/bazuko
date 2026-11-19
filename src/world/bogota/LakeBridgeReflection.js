import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { withLakeRandom } from './LakeWaterMaterial.js';

const BUS_BRIDGE_PARTS = new Set(['Tablero de concreto', 'Pilar', 'Barrera lateral', 'Baranda amarilla']);
const METRO_CONCRETE = new Set(['ConcretoMetro', 'ConcretoDovelas']);
const BANK_MARGIN = 26;
const MAX_BANK_TREES = 16;

/** Una sola cámara bajo el agua conserva la perspectiva de la orilla y del horizonte. */
export function attachLakeBridgeReflection(water, lake, viaduct, metro, { backdrop, buildings, tower, getQuality } = {}) {
  const reflection = withLakeRandom(() => new LakeBridgeReflection(lake, viaduct, metro, water, backdrop, buildings, tower));
  const syncWater = water.onBeforeRender;
  water.onBeforeRender = (renderer, scene, camera) => {
    syncWater.call(water, renderer, scene, camera);
    const visible = reflection.render(renderer, scene, camera, getQuality?.());
    water.material.userData.setBridgeReflection(visible ? reflection : null);
  };
  water.material.addEventListener('dispose', () => reflection.dispose());
  return reflection;
}

class LakeBridgeReflection {
  constructor(lake, viaduct, metro, water, backdrop, buildings, tower) {
    this.surface = lake.surfaceY;
    this.scene = new THREE.Scene();
    this.sun = new THREE.DirectionalLight();
    this.ambient = new THREE.HemisphereLight();
    this.scene.add(this.sun, this.sun.target, this.ambient);
    this.camera = new THREE.PerspectiveCamera();
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      generateMipmaps: false, depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType)
    });
    this.target.texture.name = 'Reflejo del Parque del Lago';
    this.projection = new THREE.Matrix4();
    this.viewProjection = new THREE.Matrix4();
    this.inverseViewProjection = new THREE.Matrix4();
    this.frustum = new THREE.Frustum();
    this.bounds = new THREE.Box3();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.surface);
    this.clip = new THREE.Plane();
    this.clipVector = new THREE.Vector4();
    this.corner = new THREE.Vector4();
    this.direction = new THREE.Vector3();
    this.rotation = new THREE.Matrix4();
    this.clearColor = new THREE.Color();
    this.meshes = [];
    this.landscape = new THREE.Group();
    this.scene.add(this.landscape);
    this.ownedSkylineGeometry = [];
    this.disposed = false;
    this._captureGeometry(lake, viaduct, metro, water);
    this._captureLandscape(lake, backdrop, buildings, tower);
  }

  _captureLandscape(lake, backdrop, buildings, tower) {
    // El fondo es inmutable. Se reutilizan la geometría y los datos de instancias,
    // con atributos propios para poder soltar su VAO sin invalidar el de la ciudad.
    for (const source of backdrop?.children ?? []) {
      if (!source.isMesh) continue;
      let copy;
      if (source.isInstancedMesh) {
        copy = new THREE.InstancedMesh(source.geometry, source.material, 0);
        copy.instanceMatrix = new THREE.InstancedBufferAttribute(source.instanceMatrix.array, 16);
        if (source.instanceColor) copy.instanceColor = new THREE.InstancedBufferAttribute(source.instanceColor.array, 3);
        copy.count = source.count;
        copy.computeBoundingSphere();
      } else {
        copy = new THREE.Mesh(source.geometry, source.material);
        copy.frustumCulled = false;
      }
      source.updateWorldMatrix(true, false);
      copy.matrix.copy(source.matrixWorld);
      copy.matrixAutoUpdate = false;
      copy.renderOrder = source.renderOrder;
      this.landscape.add(copy);
    }

    // Fachadas de verdad frente al parque. Las primeras casas por dirección
    // dejan paso también a los pisos que asoman detrás y a la torre Colpatria.
    const rows = Array.from({ length: 16 }, () => []);
    for (const building of buildings?.buildings ?? []) {
      const dx = building.root.position.x - lake.lakeX, dz = building.root.position.z - lake.lakeZ;
      const distance = Math.hypot(dx, dz);
      if (distance > 152 || distance < 1) continue;
      const sector = Math.floor((Math.atan2(dz, dx) + Math.PI) * rows.length / (2 * Math.PI)) % rows.length;
      rows[sector].push({ building, distance });
    }
    const batches = new Map();
    const add = (source, material = source?.material) => {
      if (!source?.isMesh || !material?.isMaterial) return;
      source.updateWorldMatrix(true, false);
      if (!batches.has(material)) batches.set(material, []);
      batches.get(material).push(source.geometry.clone().applyMatrix4(source.matrixWorld));
    };
    for (const row of rows) {
      row.sort((a, b) => a.distance - b.distance);
      const selected = new Set(row.slice(0, 2));
      if (row.length) selected.add(row.reduce((a, b) => a.building.height / a.distance >= b.building.height / b.distance ? a : b));
      for (const { building } of selected) {
        for (const part of [building.base, ...building.walls.values(), building.roof]) {
          for (const mesh of part.children) {
            if (!mesh.isMesh || mesh.userData.visibilitySide === THREE.BackSide) continue;
            if (part !== building.base && mesh !== part.children[0]) continue;
            add(mesh, buildings.closedMaterials.get(mesh.material.userData.staticBatchKey) ?? mesh.material);
          }
        }
      }
    }
    for (const mesh of tower?.children ?? []) {
      if (['Cuerpo de la torre', 'Coronación', 'Costilla vertical'].includes(mesh.name)) add(mesh);
    }
    for (const [material, parts] of batches) {
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      this.ownedSkylineGeometry.push(geometry);
      this.landscape.add(new THREE.Mesh(geometry, material));
    }
  }

  _captureGeometry(lake, viaduct, metro, water) {
    const sources = [
      ...viaduct.children.filter(mesh => BUS_BRIDGE_PARTS.has(mesh.name)),
      ...metro.children.filter(mesh => mesh.isMesh && METRO_CONCRETE.has(mesh.material.name))
    ];
    if (water.userData.reeds) sources.push(water.userData.reeds);
    const point = new THREE.Vector3(), trees = [];
    for (const root of water.parent?.children ?? []) {
      if (!root.userData.tree) continue;
      root.getWorldPosition(point);
      const radius = Math.hypot((point.x - lake.lakeX) / lake.radiusX, (point.z - lake.lakeZ) / lake.radiusZ);
      if (radius < 1.5) trees.push({ root, radius });
    }
    trees.sort((a, b) => a.radius - b.radius);
    for (const { root } of trees.slice(0, MAX_BANK_TREES)) {
      root.traverse(mesh => { if (mesh.isMesh) sources.push(mesh); });
    }
    const batches = new Map(), bounds = new THREE.Box3();
    const minZ = lake.lakeZ - lake.radiusZ - BANK_MARGIN, maxZ = lake.lakeZ + lake.radiusZ + BANK_MARGIN;
    for (const source of sources) {
      source.updateWorldMatrix(true, false);
      bounds.setFromObject(source);
      if (bounds.max.z < minZ || bounds.min.z > maxZ || bounds.max.y < this.surface) continue;
      if (!batches.has(source.material)) batches.set(source.material, []);
      batches.get(source.material).push(source.geometry.clone().applyMatrix4(source.matrixWorld));
      this.bounds.union(bounds);
    }
    for (const [material, parts] of batches) {
      const geometry = mergeGeometries(parts);
      for (const part of parts) part.dispose();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = 'Entorno reflejado del lago';
      this.meshes.push(mesh);
      this.scene.add(mesh);
    }
  }

  _project(camera) {
    if (!camera.isPerspectiveCamera || !this.meshes.length && !this.landscape.children.length) return false;
    const reflected = this.camera;
    reflected.position.setFromMatrixPosition(camera.matrixWorld);
    if (reflected.position.y <= this.surface + .015) return false;
    reflected.position.y = 2 * this.surface - reflected.position.y;
    camera.getWorldDirection(this.direction);
    this.direction.y *= -1;
    reflected.up.set(0, 1, 0).applyMatrix4(this.rotation.extractRotation(camera.matrixWorld));
    reflected.up.y *= -1;
    reflected.lookAt(this.direction.add(reflected.position));
    reflected.updateMatrixWorld();
    reflected.near = camera.near;
    reflected.far = camera.far;
    reflected.projectionMatrix.copy(camera.projectionMatrix);
    // Un rizo que mira más allá del borde de la ventana todavía debe encontrar
    // la fachada, en vez de cortar su reflejo con una franja vertical de cielo.
    const p = reflected.projectionMatrix.elements;
    if (this.landscape.visible) { p[0] *= 0.76; p[5] *= 0.76; }
    this.projection.multiplyMatrices(reflected.projectionMatrix, reflected.matrixWorldInverse);

    // Plano cercano oblicuo. Recorta la parte enterrada de las pilas en su línea de agua real.
    const clip = this.clip.copy(this.plane).applyMatrix4(reflected.matrixWorldInverse);
    const v = this.clipVector.set(clip.normal.x, clip.normal.y, clip.normal.z, clip.constant);
    const q = this.corner.set((Math.sign(v.x) + p[8]) / p[0], (Math.sign(v.y) + p[9]) / p[5], -1, (1 + p[10]) / p[14]);
    const offset = v.dot(q);
    if (Math.abs(offset) < 1e-6) return false;
    v.multiplyScalar(2 / offset);
    p[2] = v.x; p[6] = v.y; p[10] = v.z + 1; p[14] = v.w;
    reflected.projectionMatrixInverse.copy(reflected.projectionMatrix).invert();
    this.viewProjection.multiplyMatrices(reflected.projectionMatrix, reflected.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProjection);
    this.inverseViewProjection.copy(this.viewProjection).invert();
    return this.landscape.visible && this.landscape.children.length > 0 || this.frustum.intersectsBox(this.bounds);
  }

  _light(scene) {
    const sky = scene.children.find(object => object.isHemisphereLight && object.visible);
    if (sky) {
      this.ambient.color.copy(sky.color);
      this.ambient.groundColor.copy(sky.groundColor);
      sky.getWorldPosition(this.ambient.position);
    }
    this.ambient.intensity = sky?.intensity ?? 0;
    const sun = scene.children.find(object => object.isDirectionalLight && object.visible);
    if (sun) {
      this.sun.color.copy(sun.color);
      sun.getWorldPosition(this.sun.position);
      sun.target.getWorldPosition(this.sun.target.position);
    }
    this.sun.intensity = sun?.intensity ?? 0;
  }

  render(renderer, scene, camera, quality = renderer.shadowMap?.enabled ? 'alta' : 'baja') {
    this.landscape.visible = quality === 'alta';
    if (!renderer.isWebGLRenderer || !this._project(camera)) return false;
    const side = quality === 'alta' ? Math.min(1152, Math.max(640, renderer.domElement.width)) : quality === 'media' ? 512 : 288;
    this.target.setSize(Math.max(1, Math.round(side * Math.min(1, camera.aspect))),
      Math.max(1, Math.round(side * Math.min(1, 1 / camera.aspect))));
    this._light(scene);
    this.scene.fog = scene.fog;

    const previous = renderer.getRenderTarget();
    const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
    const xr = renderer.xr.enabled;
    const shadow = renderer.shadowMap, autoShadow = shadow.autoUpdate, freshShadow = shadow.needsUpdate;
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    try {
      renderer.xr.enabled = false;
      shadow.autoUpdate = false;
      shadow.needsUpdate = false;
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0, 0);
      renderer.state.buffers.depth.setMask(true);
      if (!renderer.autoClear) renderer.clear();
      withLakeRandom(() => renderer.render(this.scene, this.camera));
    } finally {
      renderer.xr.enabled = xr;
      shadow.autoUpdate = autoShadow;
      shadow.needsUpdate = freshShadow;
      renderer.setRenderTarget(previous, face, mip);
      renderer.setClearColor(this.clearColor, alpha);
      if (camera.viewport) renderer.state.viewport(camera.viewport);
    }
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) mesh.geometry.dispose();
    for (const geometry of this.ownedSkylineGeometry) geometry.dispose();
    for (const mesh of this.landscape.children) if (mesh.isInstancedMesh) mesh.dispose();
    this.meshes.length = 0;
    this.ownedSkylineGeometry.length = 0;
    this.landscape.clear();
    this.scene.clear();
    this.target.dispose();
  }
}
