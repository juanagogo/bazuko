import * as THREE from 'three';
import { busGeometry, busTextures, busWipers, WINDSHIELD_GLSL } from './BusBody.js';
import { chainSunField } from './SunFieldShader.js';

/**
 * Bus articulado: dos secciones, un fuelle con tres huesos y seis ruedas, armados por código sobre las medidas de
 * public/models/bus-articulado/bus.json (pivotes, ruedas y fuelle). Cada seccion sigue el eje del carril por separado, asi
 * que en las curvas y rampas del viaducto el bus se dobla en la articulacion; el fuelle se deforma entre ambas y las ruedas
 * ruedan (las del primer eje, ademas, viran). Las piezas usan el frente +Z del modelo; el grupo del bus tiene su frente
 * en -Z, de ahi el giro de 180 grados.
 */
const MAX_STEER = 0.5;
const SIGN_PAGE_SECONDS = 5;

const baseUrl = () => `${import.meta.env?.BASE_URL ?? '/'}models/bus-articulado/`;
let assets = null;

/** Descarga (una sola vez) la ficha con las medidas; la carrocería se arma al crear cada bus. */
export function loadArticulatedBusAssets({ base = baseUrl(), fetchJson = url => fetch(url).then(r => r.json()) } = {}) {
  assets ??= (async () => ({ spec: await fetchJson(`${base}bus.json`) }))();
  return assets;
}

/** Solo pruebas: sustituye la ficha descargada por otra ya construida. */
export function setArticulatedBusAssets(value) { assets = value ? Promise.resolve(value) : null; }

/** Crea una instancia con materiales propios (el bus se desvanece en los extremos del recorrido). */
export async function createArticulatedBus(options) {
  return new ArticulatedBusRig(await loadArticulatedBusAssets(options));
}

const placement = new THREE.Matrix4();
const inverse = new THREE.Matrix4();
const WIPER_CYCLES_PER_SECOND = .7, WIPER_SWEEP = 1.2;

/** Inyecta en el material el corrimiento de las hojas de puerta y, en el vidrio, un reflejo más fuerte que el de un dieléctrico. */
function patchMaterial(material, { door = null, reflectance = null, alpha = null, lampNight = null, coat = 0, wiper = null }) {
  material.onBeforeCompile = shader => {
    if (wiper) {
      // Solo las piezas del limpiabrisas tienen UV: giran sobre su pivote y se pegan a la curva del vidrio.
      shader.uniforms.busWiper = wiper;
      shader.vertexShader = `uniform float busWiper;\n${WINDSHIELD_GLSL}\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', `#include <begin_vertex>
  if (uv.y > .5 && busWiper > 0.) {
    float wipe = uv.x > 0. ? -busWiper : busWiper;
    vec2 arm = transformed.xy - uv;
    vec2 swept = uv + vec2(arm.x * cos(wipe) - arm.y * sin(wipe), arm.x * sin(wipe) + arm.y * cos(wipe));
    transformed.z += windshieldZ(swept) - windshieldZ(transformed.xy);
    transformed.xy = swept;
  }`);
    }
    if (coat) {
      // Laca de bus: refleja el doble que una pintura común, y sin aclarar el rojo con un material metálico.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n  material.specularColorBlended = vec3(${coat.toFixed(3)});`);
    }
    if (lampNight) {
      // Cada lámpara guarda en la UV su brillo de día y de noche: faros, cornisas y stops comparten malla y material.
      shader.uniforms.lampNight = lampNight;
      shader.vertexShader = `uniform float lampNight;\nvarying float vLampGlow;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vLampGlow = mix(uv.x, uv.y, lampNight);');
      shader.fragmentShader = `varying float vLampGlow;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= vLampGlow;');
    }
    if (door) {
      shader.uniforms.busDoor = door;
      shader.vertexShader = `attribute float aSlide;\nuniform float busDoor;\n${shader.vertexShader}`
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.z += aSlide * busDoor;');
    }
    if (reflectance) {
      // El vidrio entintado refleja como una película: sin esto el 4 % de un vidrio común no se nota de día.
      shader.uniforms.glassReflectance = reflectance;
      shader.uniforms.glassAlpha = alpha;
      shader.fragmentShader = `uniform float glassReflectance;\nuniform float glassAlpha;\n${shader.fragmentShader}`
        .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= glassAlpha;')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n  material.specularColorBlended = vec3(glassReflectance);');
    }
  };
  material.customProgramCacheKey = () => `bus:${door ? 'puerta' : ''}:${reflectance ? 'vidrio' : ''}:${lampNight ? 'lampara' : ''}:${coat}:${wiper ? 'plumilla' : ''}`;
  return chainSunField(material);
}

export class ArticulatedBusRig {
  constructor({ spec }) {
    this.spec = spec;
    this.root = new THREE.Group();
    this.root.name = 'Bus articulado';
    this.owned = [];
    this.time = Math.random() * 100;
    this.doorUniform = { value: 0 };
    this.reflectanceUniform = { value: .2 };
    this.glassAlphaUniform = { value: 1 };
    this.lampNightUniform = { value: 0 };
    this.wiperUniform = { value: 0 };
    this.wiperPhase = 0;
    this.night = false;
    const count = spec.sections.length;
    const ends = [Math.max(spec.sections[0].max[2], spec.sections[0].min[2]), ...spec.pivots.map(p => p[2]),
      Math.min(spec.sections[count - 1].min[2], spec.sections[count - 1].max[2])];
    this.reference = Array.from({ length: count }, (_, i) => (ends[i] + ends[i + 1]) / 2);
    this.pivotZ = spec.pivots.map(p => p[2]);
    this.centerZ = (ends[0] + ends[count]) / 2;
    this.halfLength = Array.from({ length: count }, (_, i) => Math.abs(ends[i] - ends[i + 1]) / 2);

    const geometry = busGeometry(spec);
    const materials = this._createMaterials();

    // Cada seccion: un nodo que se coloca sobre el eje del carril y, dentro, la pieza girada 180 grados y anclada en su punto de referencia.
    this.sectionRoots = [];
    this.flips = [];
    this.stopMeshes = [];
    this.flareMeshes = [];
    spec.sections.forEach((_, i) => {
      const section = new THREE.Object3D();
      const flip = new THREE.Object3D();
      flip.rotation.y = Math.PI;
      flip.position.z = this.reference[i];
      // El vidrio va de último: transparente, se dibuja encima de todo lo que deja ver.
      for (const name of ['paint', 'matte', 'interior', 'lamps', 'decals', 'sign', 'stops', 'flares', 'glass']) {
        const part = geometry.sections[i][name];
        if (!part) continue;
        const mesh = new THREE.Mesh(part, materials[name]);
        mesh.name = `${name} ${i}`;
        mesh.castShadow = name === 'paint' || name === 'matte';
        mesh.receiveShadow = name === 'paint';
        flip.add(mesh);
        if (name === 'stops') { mesh.visible = false; this.stopMeshes.push(mesh); }
        if (name === 'flares') { mesh.visible = false; mesh.renderOrder = 2; this.flareMeshes.push(mesh); }
      }
      section.add(flip);
      this.root.add(section);
      this.sectionRoots.push(section);
      this.flips.push(flip);
    });
    this.wheels = [];
    this.wheelSpecs = [];
    spec.wheels.forEach(wheel => {
      const sectionIndex = wheel.section >= 0 ? wheel.section : (wheel.axle <= 1 ? 0 : 1);
      const pivot = new THREE.Object3D();
      pivot.rotation.order = 'YXZ';
      pivot.position.set(...wheel.center);
      const model = new THREE.Mesh(geometry.wheel, materials.wheel);
      model.castShadow = true;
      // La rueda se modela con la tapa hacia +X; las del otro costado se giran, no se reflejan.
      if (wheel.center[0] < 0) model.rotation.y = Math.PI;
      pivot.add(model);
      this.flips[sectionIndex].add(pivot);
      this.wheels.push(pivot);
      this.wheelSpecs.push({ radius: wheel.radius, front: !!wheel.front });
    });

    // Fuelle: su armadura queda en el marco del bus; los huesos delantero, central y trasero se mueven con las secciones.
    this.bellowsRoot = new THREE.Group();
    this.bellowsRoot.rotation.y = Math.PI;
    this.bellowsRoot.position.z = this.centerZ;
    this.bellows = [];
    const arm = this._buildBellows(geometry.bellows, materials.bellows);
    this.bellowsRoot.add(arm);
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
    this.setDestination(-1);
    this.setNight(false);
  }

  /** Materiales propios de este bus: el desvanecido de uno no debe afectar al otro. La geometría y las texturas sí se comparten. */
  _createMaterials() {
    const shared = busTextures();
    const own = material => { this.owned.push(material); return material; };
    const door = this.doorUniform;
    this.interiorMaterial = own(new THREE.MeshBasicMaterial({ name: 'interior', vertexColors: true }));
    this.lampMaterial = own(patchMaterial(new THREE.MeshBasicMaterial({ name: 'lamparas', vertexColors: true, toneMapped: false }), { lampNight: this.lampNightUniform }));
    this.glassMaterial = own(patchMaterial(new THREE.MeshStandardMaterial({
      name: 'vidrio', vertexColors: true, transparent: true, depthWrite: false, roughness: .06, metalness: 0,
      side: THREE.DoubleSide, forceSinglePass: true
    }), { door, reflectance: this.reflectanceUniform, alpha: this.glassAlphaUniform }));
    this.signMaterial = own(new THREE.MeshBasicMaterial({ name: 'letrero', toneMapped: false }));
    return {
      paint: own(patchMaterial(new THREE.MeshStandardMaterial({ name: 'pintura', vertexColors: true, map: shared.grime, roughness: .24, metalness: .04 }), { coat: .09 })),
      matte: own(patchMaterial(new THREE.MeshStandardMaterial({ name: 'caucho', vertexColors: true, roughness: .62, metalness: 0 }), { door, wiper: this.wiperUniform })),
      interior: this.interiorMaterial,
      lamps: this.lampMaterial,
      decals: own(new THREE.MeshStandardMaterial({ name: 'calcomanias', map: shared.decals, alphaTest: .5, roughness: .42, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })),
      sign: this.signMaterial,
      stops: own(new THREE.MeshBasicMaterial({ name: 'stop', vertexColors: true, toneMapped: false })),
      flares: own(new THREE.MeshBasicMaterial({ name: 'destello', map: shared.flare, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })),
      glass: this.glassMaterial,
      wheel: own(new THREE.MeshStandardMaterial({ name: 'rueda', vertexColors: true, roughness: .62, metalness: .12 })),
      bellows: own(new THREE.MeshStandardMaterial({ name: 'fuelle', vertexColors: true, roughness: .78, metalness: 0 }))
    };
  }

  _buildBellows(data, material) {
    const arm = new THREE.Group();
    const bones = [['F', data.zFront], ['M', data.midZ], ['R', data.zRear]].map(([name, z]) => {
      const bone = new THREE.Bone();
      bone.name = name;
      bone.position.set(0, 1.92, z);
      arm.add(bone);
      return bone;
    });
    const mesh = new THREE.SkinnedMesh(data.geometry, material);
    mesh.name = 'Fuelle';
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    arm.add(mesh);
    arm.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones), mesh.matrixWorld);
    this.bellows.push(mesh);
    return arm;
  }

  /** El letrero depende del sentido: hacia el norte el Portal, hacia el sur el Parque del Lago. */
  setDestination(direction) {
    const shared = busTextures();
    this.signMap?.dispose();
    const map = (direction < 0 ? shared.ledNorth : shared.ledSouth).clone();
    map.colorSpace = THREE.SRGBColorSpace;
    map.needsUpdate = true;
    this.signMap = map;
    this.signMaterial.map = map;
    this.signMaterial.needsUpdate = true;
  }

  /** Las luces interiores y de posición son emisivas: nada de luces reales por bus. */
  setNight(isNight) {
    this.night = isNight;
    // De día el interior se ve apagado detrás del tinte; de noche manda la luz de adentro y el vidrio casi no refleja.
    this.interiorMaterial.color.setRGB(...(isNight ? [1.45, 1.28, 1.02] : [.72, .72, .72]));
    this.lampNightUniform.value = isNight ? 1 : 0;
    this.reflectanceUniform.value = isNight ? .05 : .2;
    this.glassAlphaUniform.value = isNight ? .62 : 1;
    for (const mesh of this.flareMeshes) mesh.visible = isNight;
  }

  /** `amount` de 0 a 1: las hojas de vidrio corren dentro de la carrocería. */
  setDoors(amount) { this.doorUniform.value = amount; }

  setBraking(braking) {
    for (const mesh of this.stopMeshes) mesh.visible = braking;
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
    if (dt > 0) {
      this.time += dt;
      // Alterna entre dos páginas despacio y de un golpe: sin parpadeo ni brillo que oscile.
      this.signMap.offset.y = Math.floor(this.time / SIGN_PAGE_SECONDS) % 2 ? -.5 : 0;
      this._wipe(dt);
    }
  }

  /** Va y vuelve mientras llueve; si escampa a mitad de barrido termina el viaje y queda parqueado. */
  _wipe(dt) {
    if (!busWipers.running && this.wiperPhase === 0) return;
    this.wiperPhase += dt * WIPER_CYCLES_PER_SECOND;
    if (this.wiperPhase >= 1) this.wiperPhase = busWipers.running ? this.wiperPhase % 1 : 0;
    this.wiperUniform.value = WIPER_SWEEP * (.5 - .5 * Math.cos(this.wiperPhase * Math.PI * 2));
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
    for (const mesh of this.bellows) mesh.skeleton.dispose();
    this.root.removeFromParent();
  }
}
