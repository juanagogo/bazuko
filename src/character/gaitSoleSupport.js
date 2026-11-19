import { Matrix4, Vector3 } from 'three';

// Al rodar el zapato cambia el apoyo entre talón, planta, bordes y puntera.
// Los extremos se eligen una vez en la malla vestida; conservan sus pesos de skin.
const directions = [];
for (const x of [-.55, 0, .55]) {
  for (const z of [-2, -.7, -.25, 0, .25, .7, 2]) directions.push([x, z]);
}

function soleVertices(mesh) {
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const sides = mesh.skeleton.bones.map(bone => /Left(?:Foot|ToeBase)$/.test(bone.name) ? 0
    : /Right(?:Foot|ToeBase)$/.test(bone.name) ? 1 : -1);
  const ends = [0, 1].map(() => directions.map(() => ({ min: Infinity, index: -1 })));
  const point = new Vector3();
  const { index: indices } = mesh.geometry;
  const visible = indices ? new Set(indices.array) : Array.from({ length: position.count }, (_, i) => i);
  for (const index of visible) {
    let side = -1;
    for (let j = 0; j < 4 && side < 0; j++) {
      if (skinWeight.getComponent(index, j) > 0) side = sides[skinIndex.getComponent(index, j)];
    }
    if (side < 0) continue;
    point.fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix);
    for (let k = 0; k < directions.length; k++) {
      const [dx, dz] = directions[k];
      const height = dx * point.x + point.y + dz * point.z;
      const end = ends[side][k];
      if (height < end.min) { end.min = height; end.index = index; }
    }
  }
  return new Set(ends.flat().map(end => end.index).filter(index => index >= 0));
}

/** Apoyo de ambos pies en el espacio del personaje, tras mezclar el paso y su estilo. */
export function createGaitGroundContact(root, hips, meshes) {
  const transforms = new Map([[root, new Matrix4()]]);
  const chain = [], vertices = [];
  const local = new Matrix4();
  function transform(bone) {
    if (transforms.has(bone)) return transforms.get(bone);
    const parent = transform(bone.parent);
    const matrix = new Matrix4();
    chain.push({ bone, parent, matrix });
    transforms.set(bone, matrix);
    return matrix;
  }
  for (const mesh of meshes) {
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    for (const index of soleVertices(mesh)) {
      const vertex = [];
      const bind = new Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.bindMatrix);
      for (let j = 0; j < 4; j++) {
        const weight = skinWeight.getComponent(index, j);
        if (weight <= 0) continue;
        const joint = skinIndex.getComponent(index, j);
        const point = bind.clone().applyMatrix4(mesh.skeleton.boneInverses[joint]).multiplyScalar(weight);
        vertex.push({ point, weight, matrix: transform(mesh.skeleton.bones[joint]) });
      }
      vertices.push(vertex);
    }
  }
  let savedY = null;
  return {
    restore() {
      if (savedY !== null) hips.position.y = savedY;
      savedY = null;
    },
    apply(enabled) {
      this.restore();
      if (!enabled) return;
      // El paso solo necesita la cadena cadera–pie; no actualiza matrices del mundo ni las prendas.
      for (const { bone, parent, matrix } of chain) {
        matrix.multiplyMatrices(parent, local.compose(bone.position, bone.quaternion, bone.scale));
      }
      let min = Infinity;
      for (const vertex of vertices) {
        let y = 0;
        for (const { point, weight, matrix } of vertex) {
          const e = matrix.elements;
          y += e[1] * point.x + e[5] * point.y + e[9] * point.z + e[13] * weight;
        }
        min = Math.min(y, min);
      }
      // Un margen de 4 mm cubre la piel entre los puntos muestreados. Las fases de vuelo quedan libres.
      if (min < .004) {
        savedY = hips.position.y;
        hips.position.y += .004 - min;
      }
    }
  };
}
