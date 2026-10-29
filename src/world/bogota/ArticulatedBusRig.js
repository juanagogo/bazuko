import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Bus articulado por piezas (carpeta public/models/bus-articulado): dos secciones, un fuelle con tres huesos y seis ruedas.
 * Cada seccion sigue el eje del carril por separado, asi que en las curvas y rampas del viaducto el bus se dobla en la articulacion;
 * el fuelle se deforma entre ambas y las ruedas ruedan (las del primer eje, ademas, viran). Las piezas usan el frente +Z del modelo;
 * el grupo del bus tiene su frente en -Z, de ahi el giro de 180 grados.
 */
const Y = new THREE.Vector3(0, 1, 0);
const MAX_STEER = 0.5;

const baseUrl = () => `${import.meta.env?.BASE_URL ?? '/'}models/bus-articulado/`;
let assets = null;

/** Descarga (una sola vez) la ficha y los GLB de las piezas. */
export function loadArticulatedBusAssets({ base = baseUrl(), fetchJson = url => fetch(url).then(r => r.json()), loadGlb = url => new GLTFLoader().loadAsync(url), loadTexture = url => new THREE.TextureLoader().loadAsync(url) } = {}) {
  assets ??= (async () => {
    const spec = await fetchJson(`${base}bus.json`);
    const glb = async file => (await loadGlb(`${base}${file}`)).scene;
    const sections = await Promise.all(spec.sections.map(s => glb(s.file)));
    const bellows = await Promise.all((spec.accordions ?? []).map(a => glb(a.file)));
    const wheels = await Promise.all(spec.wheels.map(w => glb(w.file)));
    const signTexture = spec.sign ? await loadTexture(`${base}${spec.sign.file}`) : null;
    return { spec, sections, bellows, wheels, signTexture };
  })();
  return assets;
}

/** Solo pruebas: sustituye las piezas descargadas por otras ya construidas. */
export function setArticulatedBusAssets(value) { assets = value ? Promise.resolve(value) : null; }

/** Crea una instancia con materiales propios (el bus se desvanece en los extremos del recorrido). */
export async function createArticulatedBus(options) {
  return new ArticulatedBusRig(await loadArticulatedBusAssets(options));
}

const placement = new THREE.Matrix4();
const inverse = new THREE.Matrix4();

export class ArticulatedBusRig {
  constructor({ spec, sections, bellows, wheels, signTexture }) {
    this.spec = spec;
    this.root = new THREE.Group();
    this.root.name = 'Bus articulado';
    this.owned = [];
    this.time = Math.random() * 100;
    const count = spec.sections.length;
    const ends = [Math.max(spec.sections[0].max[2], spec.sections[0].min[2]), ...spec.pivots.map(p => p[2]),
      Math.min(spec.sections[count - 1].min[2], spec.sections[count - 1].max[2])];
    this.reference = Array.from({ length: count }, (_, i) => (ends[i] + ends[i + 1]) / 2);
    this.pivotZ = spec.pivots.map(p => p[2]);
    this.centerZ = (ends[0] + ends[count]) / 2;
    this.halfLength = Array.from({ length: count }, (_, i) => Math.abs(ends[i] - ends[i + 1]) / 2);

    // Cada seccion: un nodo que se coloca sobre el eje del carril y, dentro, la pieza girada 180 grados y anclada en su punto de referencia.
    this.sectionRoots = [];
    this.flips = [];
    spec.sections.forEach((_, i) => {
      const section = new THREE.Object3D();
      const flip = new THREE.Object3D();
      flip.rotation.y = Math.PI;
      flip.position.z = this.reference[i];
      flip.add(this._own(sections[i]));
      section.add(flip);
      this.root.add(section);
      this.sectionRoots.push(section);
      this.flips.push(flip);
    });
    this.wheels = [];
    this.wheelSpecs = [];
    spec.wheels.forEach((wheel, index) => {
      const sectionIndex = wheel.section >= 0 ? wheel.section : (wheel.axle <= 1 ? 0 : 1);
      const pivot = new THREE.Object3D();
      pivot.rotation.order = 'YXZ';
      pivot.position.set(...wheel.center);
      const model = this._own(wheels[index]);
      model.position.set(-wheel.center[0], -wheel.center[1], -wheel.center[2]);
      pivot.add(model);
      this.flips[sectionIndex].add(pivot);
      this.wheels.push(pivot);
      this.wheelSpecs.push({ radius: wheel.radius, front: !!wheel.front });
    });
    this.sign = spec.sign && signTexture ? this._buildSign(spec.sign, signTexture) : null;

    // Fuelle: su armadura queda en el marco del bus; los huesos delantero, central y trasero se mueven con las secciones.
    this.bellowsRoot = new THREE.Group();
    this.bellowsRoot.rotation.y = Math.PI;
    this.bellowsRoot.position.z = this.centerZ;
    this.bellows = [];
    bellows.forEach(source => {
      const model = this._own(source);
      this.bellowsRoot.add(model);
      let skinned = null;
      model.traverse(o => { if (o.isSkinnedMesh) skinned = o; });
      if (skinned) { skinned.frustumCulled = false; this.bellows.push(skinned); }
    });
    this.root.add(this.bellowsRoot);
    this.root.updateMatrixWorld(true);
    this._bones = this.bellows.map(mesh => {
      const byName = Object.fromEntries(mesh.skeleton.bones.map(b => [b.name, b]));
      const rootInverse = new THREE.Matrix4().copy(this.bellowsRoot.matrixWorld).invert();
      const info = { mesh, bones: [byName.F, byName.M, byName.R].filter(Boolean) };
      info.rest = info.bones.map(b => new THREE.Matrix4().multiplyMatrices(rootInverse, b.matrixWorld));
      info.parent = info.bones.map(b => new THREE.Matrix4().multiplyMatrices(rootInverse, b.parent.matrixWorld));
      info.bones.forEach(b => { b.matrixAutoUpdate = false; });
      return info;
    }).filter(info => info.bones.length === 3);
  }

  /** Clona con materiales propios: el desvanecido no debe afectar a otro bus. */
  _own(source) {
    const model = cloneSkinned(source);
    const materials = new Map();
    const copy = material => {
      if (!materials.has(material)) {
        const own = material.clone();
        // la escena no tiene mapa de entorno: un metal pleno se ve negro; se limita al brillo que si se aprecia
        if (own.name?.startsWith('metal')) own.metalness = Math.min(own.metalness ?? 0, 0.3);
        materials.set(material, own);
        this.owned.push(own);
      }
      return materials.get(material);
    };
    model.traverse(object => {
      if (!object.isMesh) return;
      object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material);
      object.castShadow = true;
    });
    return model;
  }

  /** Letrero LED del frente: tira curva con la textura de puntos; el texto corre desplazando la textura. */
  _buildSign(sign, texture) {
    const points = sign.points;
    const positions = [], uvs = [], index = [];
    const visible = sign.window / sign.columns;
    points.forEach((p, i) => {
      positions.push(p[0], p[1], p[2], p[3], p[4], p[5]);
      const u = i / (points.length - 1);
      uvs.push(u, 0, u, 1);
      if (i > 0) { const a = (i - 1) * 2; index.push(a, a + 2, a + 3, a, a + 3, a + 1); }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(index);
    const map = texture.clone();
    map.wrapS = THREE.RepeatWrapping;
    map.repeat.set(visible, 1);
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
    const material = new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, toneMapped: false });
    this.owned.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    this.flips[0].add(mesh);
    this.signMap = map;
    this.signColumns = sign.columns;
    return mesh;
  }

  /**
   * Coloca las piezas sobre el eje del carril. `bus` aporta position, direction, laneX, pathX(z, laneX), groundHeight(x, z), height y group.
   * Debe llamarse tras fijar la posicion y el giro del grupo.
   */
  articulate(bus, dt = 0) {
    const group = bus.group;
    group.updateMatrix();
    inverse.copy(group.matrix).invert();
    const direction = bus.direction;
    const ground = (x, z) => bus.groundHeight?.(x, z) ?? bus.height ?? 0;
    const pathX = z => bus.pathX ? bus.pathX(z, bus.laneX) : bus.position.x;
    const poses = this.reference.map((reference, i) => {
      const z = bus.position.z + direction * (reference - this.centerZ);
      const x = pathX(z);
      const dx = bus.pathX ? bus.pathX(z + direction * .01, bus.laneX) - bus.pathX(z - direction * .01, bus.laneX) : 0;
      const scale = Math.hypot(dx, .02);
      const heading = { x: dx / scale, z: direction * .02 / scale };
      // como el bus entero: la inclinacion sale de la cuerda entre los extremos de la seccion y, para que ninguna parte corte el suelo en
      // el pie de la rampa o en la cresta, se apoya en cinco puntos y se sube lo necesario
      const half = this.halfLength[i], length = half * 2;
      const at = offset => ground(pathX(z + heading.z * offset), z + heading.z * offset);
      const pitch = Math.atan2(at(half) - at(-half), length);
      const slope = Math.tan(pitch);
      let y = ground(x, z);
      for (const fraction of [-.5, -.25, 0, .25, .5]) {
        const offset = fraction * length;
        y = Math.max(y, at(-offset) + offset * slope);
      }
      const yaw = Math.atan2(-heading.x, -heading.z);
      return { x, z, y, yaw, pitch };
    });
    this.sectionRoots.forEach((section, i) => {
      const pose = poses[i];
      placement.compose(new THREE.Vector3(pose.x, pose.y, pose.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(pose.pitch, pose.yaw, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
      placement.premultiply(inverse);
      placement.decompose(section.position, section.quaternion, section.scale);
      section.updateMatrix();
      if (i > 0) {
        // las secciones se unen por la articulacion: el extremo de esta coincide con el de la anterior (sin esto, en las rampas y curvas
        // los extremos se separan y el fuelle se desploma)
        const joint = new THREE.Vector3(0, 0, this.pivotZ[i - 1]);
        const previous = joint.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(this.sectionRoots[i - 1].matrix, this.flips[i - 1].matrix));
        const current = joint.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(section.matrix, this.flips[i].matrix));
        const gap = previous.sub(current);
        if (gap.y < 0) {
          // el extremo de esta seccion queda mas alto que el de la anterior: se sube la anterior en vez de hundir esta en el suelo
          for (let k = 0; k < i; k++) { this.sectionRoots[k].position.y -= gap.y; this.sectionRoots[k].updateMatrix(); }
          gap.y = 0;
        }
        section.position.add(gap);
        section.updateMatrix();
      }
    });
    // las ruedas del primer eje viran hacia donde va el eje del carril unos metros mas adelante
    const lookZ = bus.position.z + direction * (this.reference[0] - this.centerZ + 5);
    const dxLook = bus.pathX ? bus.pathX(lookZ + direction * .01, bus.laneX) - bus.pathX(lookZ - direction * .01, bus.laneX) : 0;
    const lookScale = Math.hypot(dxLook, .02);
    const yawLook = Math.atan2(-dxLook / lookScale, -direction * .02 / lookScale);
    let diff = yawLook - poses[0].yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    const steer = THREE.MathUtils.clamp(diff * 2, -MAX_STEER, MAX_STEER);
    this.wheels.forEach((wheel, i) => { wheel.rotation.y = this.wheelSpecs[i].front ? steer : 0; });
    this._deformBellows();
    if (this.signMap && dt > 0) {
      this.time += dt;
      this.signMap.offset.x = (this.time * 14 / this.signColumns) % 1;   // 14 columnas por segundo, como en el port
    }
  }

  _deformBellows() {
    const bind = new THREE.Matrix4().copy(this.bellowsRoot.matrix);
    const bindInverse = bind.clone().invert();
    const placementOf = i => new THREE.Matrix4().multiplyMatrices(this.sectionRoots[i].matrix, this.flips[i].matrix);
    const last = this.sectionRoots.length - 1;
    const delta = i => new THREE.Matrix4().multiplyMatrices(placementOf(i), bindInverse);
    const deltaFront = delta(0), deltaRear = delta(last);
    const qa = new THREE.Quaternion().setFromRotationMatrix(deltaFront);
    const qb = new THREE.Quaternion().setFromRotationMatrix(deltaRear);
    const pivotBind = new THREE.Vector3(0, 0, this.pivotZ[0]).applyMatrix4(bind);
    const pivotNow = pivotBind.clone().applyMatrix4(deltaFront);
    const middle = new THREE.Matrix4().makeTranslation(pivotNow.x, pivotNow.y, pivotNow.z)
      .multiply(new THREE.Matrix4().makeRotationFromQuaternion(qa.clone().slerp(qb, .5)))
      .multiply(new THREE.Matrix4().makeTranslation(-pivotBind.x, -pivotBind.y, -pivotBind.z));
    const toRoot = g => new THREE.Matrix4().multiplyMatrices(bindInverse, g).multiply(bind);   // grupo -> marco de la armadura
    const deltas = [toRoot(deltaFront), toRoot(middle), toRoot(deltaRear)];
    for (const info of this._bones) {
      info.bones.forEach((bone, k) => {
        const desired = new THREE.Matrix4().multiplyMatrices(deltas[k], info.rest[k]);
        bone.matrix.multiplyMatrices(new THREE.Matrix4().copy(info.parent[k]).invert(), desired);
        bone.matrixWorldNeedsUpdate = true;
      });
    }
  }

  /** Hace rodar las ruedas: `distance` en metros recorridos hacia el frente. */
  roll(distance) {
    this.wheels.forEach((wheel, i) => { wheel.rotation.x += distance / this.wheelSpecs[i].radius; });
  }

  dispose() {
    for (const material of this.owned) material.dispose();
    this.owned.length = 0;
    this.signMap?.dispose();
    this.root.removeFromParent();
  }
}
