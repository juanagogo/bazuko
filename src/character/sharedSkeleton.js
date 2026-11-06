/**
 * Un solo esqueleto por personaje. Cada prenda, el pelo, las cejas y los ojos traen su propio
 * `THREE.Skeleton`, aunque usan los mismos huesos y casi siempre las mismas matrices inversas que
 * el cuerpo. Three calcula y sube a la GPU la textura de huesos una vez por esqueleto y por cuadro:
 * con 6 a 9 esqueletos por persona eran 6 a 9 subidas idénticas.
 *
 * Solo se comparte cuando el resultado es el mismo número a número: los mismos objetos Bone en el
 * mismo orden y las inversas iguales bit a bit. Lo que difiere aunque sea en 1e-6 se queda con su
 * esqueleto. El bindMatrix sigue siendo de cada malla.
 */

function sameSkeleton(a, b) {
  if (a === b) return true;
  const n = a.bones.length;
  if (b.bones.length !== n || a.boneInverses.length !== n || b.boneInverses.length !== n) return false;
  for (let i = 0; i < n; i++) {
    if (a.bones[i] !== b.bones[i]) return false;
    const x = a.boneInverses[i].elements, y = b.boneInverses[i].elements;
    if (x === y) continue;
    for (let k = 0; k < 16; k++) if (!Object.is(x[k], y[k])) return false;
  }
  return true;
}

/**
 * Ata al esqueleto del cuerpo (o al primero) cada malla con piel de `root` que coincide con él, y
 * libera los esqueletos que quedan sin uso. Devuelve cuántos esqueletos había y cuántos quedan.
 */
export function shareSkeletons(root) {
  const meshes = [];
  root.traverse(object => { if (object.isSkinnedMesh && object.skeleton) meshes.push(object); });
  const before = new Set(meshes.map(mesh => mesh.skeleton)).size;
  if (meshes.length < 2) return { before, after: before };
  const body = meshes.find(mesh => /body/i.test(mesh.name)) ?? meshes[0];
  const shared = body.skeleton;
  const replaced = new Set();
  for (const mesh of meshes) {
    const own = mesh.skeleton;
    if (own === shared || !sameSkeleton(own, shared)) continue;
    // Solo cambia el esqueleto: bindMatrix y su inversa siguen siendo los de la malla.
    mesh.skeleton = shared;
    replaced.add(own);
  }
  const used = new Set(meshes.map(mesh => mesh.skeleton));
  for (const skeleton of replaced) if (!used.has(skeleton)) skeleton.dispose();
  return { before, after: used.size };
}
