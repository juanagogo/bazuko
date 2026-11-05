import { AnimationMixer, LoopOnce, Matrix4, Vector3, VectorKeyframeTrack } from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';

/**
 * Soporte de los vértices visibles con skin, incluidas suelas y ropa. Con `bones` solo mira los
 * vértices que dependen de esos huesos: de pie o andando, lo más bajo siempre es un pie.
 */
export function createSkinSupport(root, { bones = null } = {}) {
  const meshes = [];
  const point = new Vector3(), matrix = new Matrix4(), inverseRoot = new Matrix4();
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh || !mesh.visible) return;
    const geometry = mesh.geometry;
    const position = geometry.attributes.position, indices = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
    if (!position || !indices || !weights) return;
    let visible = geometry.index ? [...new Set(geometry.index.array)] : Array.from({ length: position.count }, (_, i) => i);
    if (bones) {
      const wanted = mesh.skeleton.bones.map(bone => bones.test(bone.name));
      visible = visible.filter(index => {
        for (let j = 0; j < 4; j++) if (weights.getComponent(index, j) > 0 && wanted[indices.getComponent(index, j)]) return true;
        return false;
      });
      if (!visible.length) return;
    }
    const vertices = new Float64Array(visible.length * 3), joints = new Uint16Array(visible.length * 4), influence = new Float64Array(visible.length * 4);
    visible.forEach((index, i) => {
      point.fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix).toArray(vertices, i * 3);
      for (let j = 0; j < 4; j++) {
        joints[i * 4 + j] = indices.getComponent(index, j);
        influence[i * 4 + j] = weights.getComponent(index, j);
      }
    });
    meshes.push({ mesh, vertices, joints, influence, rows: new Float64Array(mesh.skeleton.bones.length * 4) });
  });
  return {
    vertexCount: meshes.reduce((n, item) => n + item.vertices.length / 3, 0),
    minimumY() {
      root.updateMatrixWorld(true);
      inverseRoot.copy(root.matrixWorld).invert();
      let min = Infinity;
      for (const { mesh, vertices, joints, influence, rows } of meshes) {
        // mesh.matrixWorld * bindMatrixInverse convierte la suma de skin al mundo.
        // Precalcular solo la fila vertical evita crear vectores por vértice/frame.
        const frame = inverseRoot.clone().multiply(mesh.matrixWorld).multiply(mesh.bindMatrixInverse);
        const skeleton = mesh.skeleton;
        skeleton.bones.forEach((bone, index) => {
          matrix.copy(frame).multiply(bone.matrixWorld).multiply(skeleton.boneInverses[index]);
          const e = matrix.elements, offset = index * 4;
          rows[offset] = e[1]; rows[offset + 1] = e[5]; rows[offset + 2] = e[9]; rows[offset + 3] = e[13];
        });
        for (let i = 0, v = 0; v < vertices.length; i += 4, v += 3) {
          const x = vertices[v], y = vertices[v + 1], z = vertices[v + 2];
          let height = 0;
          for (let j = 0; j < 4; j++) {
            const weight = influence[i + j];
            if (!weight) continue;
            const bone = joints[i + j] * 4;
            height += weight * (rows[bone] * x + rows[bone + 1] * y + rows[bone + 2] * z + rows[bone + 3]);
          }
          if (height < min) min = height;
        }
      }
      return min;
    }
  };
}

/** La mezcla de dos apoyos válidos puede hundir un pie: resolver tras componer. */
export class MixamoGroundContact {
  constructor(root, { clearance = .004 } = {}) {
    this.root = root;
    this.support = createSkinSupport(root);
    root.traverse(node => { if (node.isBone && /(?:mixamorig|:)Hips$|^Hips$/.test(node.name)) this.hips = node; });
    this.clearance = clearance;
    this.saved = new Vector3(); this.point = new Vector3();
    this.active = false;
  }

  restore() {
    if (this.active) this.hips.position.copy(this.saved);
    this.active = false;
  }

  apply(enabled = true) {
    this.restore();
    if (!enabled || !this.hips || !this.support.vertexCount) return;
    const lift = Math.max(0, this.clearance - this.support.minimumY());
    if (lift < 1e-7) return;
    this.saved.copy(this.hips.position);
    this.hips.getWorldPosition(this.point);
    this.root.worldToLocal(this.point); this.point.y += lift; this.root.localToWorld(this.point);
    this.hips.parent.worldToLocal(this.point);
    this.hips.position.copy(this.point);
    this.active = true;
    this.root.updateMatrixWorld(true);
  }
}

/**
 * Con la cadera animada, la pisada de correr clava el pie en el suelo. Caminar y correr
 * no bajan de donde apoya el cuerpo de pie, medido con el mismo cuerpo que los usa.
 */
export function groundLocomotion(visibleRoot, clips) {
  const root = clone(visibleRoot), support = createSkinSupport(root);
  if (!clips.idle || !clips.walk || !support.vertexCount) return clips;
  const mixer = new AnimationMixer(root);
  mixer.clipAction(clips.idle).play();
  mixer.setTime(0);
  // Aquí no hay zapatos, que se ponen por instancia: al rodar el pie, la suela baja unos 2 cm más que la piel.
  const clearance = support.minimumY() + .02;
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  const { walk, run } = clips;
  // El banco salta hasta 50° por cuadro: sin suavizar, la cadera temblaría al compensar cada pisada.
  return { ...clips, ...groundMixamoClips(visibleRoot, run ? { walk, run } : { walk }, { clearance, smooth: .05 }) };
}

/** Cubre cada subida con un máximo y la redondea con una media, en ciclo: nunca queda por debajo del original. */
function smoothLifts(lifts, radius) {
  const count = lifts.length - 1;
  const around = (source, i, read) => {
    for (let d = -radius; d <= radius; d++) read(source[(i + d + count) % count]);
  };
  const covered = lifts.map((_, i) => {
    let top = 0;
    around(lifts, i, sample => { top = Math.max(top, sample); });
    return top;
  });
  return covered.map((_, i) => {
    let sum = 0;
    around(covered, i, sample => { sum += sample; });
    return sum / (radius * 2 + 1);
  });
}

/** Hornea solo altura de pelvis; conserva duración, rotaciones y fases de vuelo. */
export function groundMixamoClips(visibleRoot, clips, { fps = 60, clearance = .004, smooth = 0 } = {}) {
  const root = clone(visibleRoot);
  let hips;
  root.traverse(node => { if (node.isBone && /(?:mixamorig|:)Hips$|^Hips$/.test(node.name)) hips = node; });
  const support = createSkinSupport(root);
  if (!hips || !support.vertexCount) throw new Error('Mixamo preview: no se pudo medir el apoyo del personaje vestido.');
  const mixer = new AnimationMixer(root), point = new Vector3(), result = {};
  const inverseParent = new Matrix4();
  for (const [name, source] of Object.entries(clips)) {
    const action = mixer.clipAction(source).setLoop(LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();
    const frames = Math.max(2, Math.ceil(source.duration * fps) + 1);
    const times = new Float32Array(frames), positions = new Float32Array(frames * 3);
    let lifts = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      const time = Math.min(source.duration, i / fps);
      times[i] = time;
      mixer.setTime(time);
      lifts[i] = Math.max(0, clearance - support.minimumY());
    }
    const maxLift = lifts.reduce((a, b) => Math.max(a, b), 0);
    if (smooth) lifts = smoothLifts(lifts, Math.round(smooth * fps));
    action.reset().play(); // al llegar al final quedó en pausa
    for (let i = 0; i < frames; i++) {
      mixer.setTime(times[i]);
      root.updateMatrixWorld(true);
      const lift = lifts[i];
      hips.getWorldPosition(point);
      // La instancia aún no está unida al mundo. Resolver el desplazamiento en
      // espacio de raíz también mantiene correcto cualquier padre del esqueleto.
      root.worldToLocal(point); point.y += lift; root.localToWorld(point);
      inverseParent.copy(hips.parent.matrixWorld).invert();
      point.applyMatrix4(inverseParent).toArray(positions, i * 3);
    }
    action.stop();
    const clip = source.clone();
    clip.tracks = clip.tracks.filter(track => track.name !== `${hips.name}.position`);
    clip.tracks.push(new VectorKeyframeTrack(`${hips.name}.position`, times, positions));
    clip.userData.grounding = { fps, clearance, maxLift, vertices: support.vertexCount };
    result[name] = clip;
  }
  mixer.stopAllAction(); mixer.uncacheRoot(root);
  return result;
}
