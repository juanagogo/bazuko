// El gesto se comparte entre el cuerpo realista, el liviano y el periódico.
import * as THREE from 'three';

export const BENCH_SLEEP_DURATION = 3.9;
export const BENCH_SLEEP_SAMPLES = 20;
const { clamp, lerp, smoothstep } = THREE.MathUtils;

export function benchSleepProgress(elapsed) {
  return clamp(Math.min(elapsed / 1.7, (BENCH_SLEEP_DURATION - elapsed) / 1.15), 0, 1);
}

export function benchSleepFrame(progress) {
  const lie = smoothstep(progress, .14, .78);
  const legs = smoothstep(progress, .20, .76);
  const reach = smoothstep(progress, .06, .29);
  const spread = smoothstep(progress, .51, .97);
  const lift = Math.sin(spread * Math.PI);
  const paperX = lerp(.015, .12, lie);
  const paperY = lerp(.65, .805, lie) + lift * .075;
  const paperZ = lerp(.30, .03, lie);
  const depth = lerp(.16, .57, spread);
  return { lie, legs, reach, spread, roll: lie * 1.62,
    hipX: .18 * lie, hipY: lerp(.55, .625, lie), hipZ: lerp(-.05, -.075, lie),
    paperX, paperY, paperZ, depth,
    gripX: paperX - lie * .25, gripY: paperY + .016, gripZ: paperZ + depth * .46 };
}

let newsprint;
function paperTexture() {
  if (newsprint || typeof document === 'undefined') return newsprint;
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 512;
  const ink = canvas.getContext('2d');
  if (!ink) return null;
  ink.fillStyle = '#d5c8ad';
  ink.fillRect(0, 0, 1024, 512);
  ink.fillStyle = '#35302a';
  ink.textAlign = 'center';
  ink.font = 'bold 78px Georgia, serif';
  ink.fillText('LA CALLE', 512, 83);
  ink.font = 'bold 29px Georgia, serif';
  ink.fillText('CRÓNICAS DEL CENTRO', 512, 132);
  ink.fillRect(28, 94, 968, 3);
  ink.fillRect(28, 145, 968, 2);
  let seed = 23;
  const next = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let column = 0; column < 7; column++) {
    const x = 31 + column * 139;
    for (let line = 0; line < 27; line++) {
      const y = 165 + line * 12;
      for (let start = 0; start < 118;) {
        const width = 4 + next() * 23;
        ink.globalAlpha = .38 + next() * .5;
        ink.fillRect(x + start, y, Math.min(width, 122 - start), 3);
        start += width + 3 + next() * 5;
      }
    }
  }
  ink.globalAlpha = 1;
  newsprint = new THREE.CanvasTexture(canvas);
  newsprint.colorSpace = THREE.SRGBColorSpace;
  return newsprint;
}

/** Dos pliegues cruzados y una curva transversal sobre el cuerpo. */
export class BenchNewspaper extends THREE.Mesh {
  constructor() {
    const geometry = new THREE.PlaneGeometry(1, 1, 12, 6).rotateX(-Math.PI / 2);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      const ridge = .102 + .022 * smoothstep(x, -.22, .36);
      const overKnees = .105 * (1 - smoothstep(Math.abs(x - .24), .07, .26)) * (1 - smoothstep(Math.abs(z), .38, .56));
      const raised = overKnees + ridge * (1 - 4 * z * z) + .014 * Math.cos(x * Math.PI * 6) * (1 - Math.abs(z));
      position.setY(i, raised);
    }
    geometry.computeVertexNormals();
    super(geometry, new THREE.MeshStandardMaterial({ color: 0xebe0c7, map: paperTexture() ?? null,
      roughness: 1, side: THREE.DoubleSide }));
    this.name = 'periodico-banca';
    this.castShadow = this.receiveShadow = true;
    this.visible = false;
  }

  show(progress, offsetX) {
    this.visible = progress > .13;
    if (!this.visible) return;
    const frame = benchSleepFrame(progress);
    this.position.set(frame.paperX + offsetX, frame.paperY, frame.paperZ);
    this.scale.set(lerp(.38, 1.05, frame.spread), lerp(.22, 1, frame.spread), frame.depth);
  }

  dispose() {
    this.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
