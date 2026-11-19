import * as THREE from 'three';

// Radio lateral, trasero y delantero de la copa, con visera y borde de suspensión en la base.
const HELMET = [
  [.102, .109, .124, .121, 0, .05],
  [.095, .129, .146, .185, 1, .17],
  [.100, .132, .147, .190, 1, .30],
  [.108, .129, .146, .184, 1, .39],
  [.113, .120, .141, .139, 0, .49],
  [.126, .120, .139, .137, 0, .55],
  [.153, .116, .135, .127, 0, .65],
  [.183, .102, .118, .107, 0, .73],
  [.210, .081, .092, .080, 0, .82],
  [.228, .051, .060, .051, 0, .91],
  [.235, .024, .028, .027, 0, .96],
  [.238, 0, 0, 0, 0, 1]
];

/** Una copa moldeada, visera que prolonga el frente y ala corta que protege alrededor. */
export function workHelmetGeometry() {
  const sides = 32, stride = sides + 1;
  const position = [], uv = [], index = [];
  for (let row = 0; row < HELMET.length; row++) {
    const [y, width, rear, front, lip, v] = HELMET[row];
    for (let i = 0; i <= sides; i++) {
      const angle = i % sides / sides * Math.PI * 2;
      const side = Math.sin(angle), face = Math.cos(angle);
      const x = width * side;
      const nose = Math.max(0, face);
      // Refuerzo central que nace en el frente, se abre atrás y desaparece al llegar al ala.
      const raised = Math.max(0, 1 - Math.abs(x) / .025) * THREE.MathUtils.smoothstep(y, .127, .212) * .009;
      const brimSlope = lip * (nose ** 6 * .014 + side ** 2 * .006);
      position.push(x, y + raised - brimSlope, .018 + face * (face > 0 ? front : rear));
      uv.push(i / sides, v);
      if (i === sides || row === HELMET.length - 1) continue;
      const a = row * stride + i, b = a + stride;
      index.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  // Juntar las normales de la abertura de UV, que queda frente a la luz y no es una costura.
  const normal = geometry.attributes.normal, avg = new THREE.Vector3(), edge = new THREE.Vector3();
  for (let row = 0; row < HELMET.length; row++) {
    const a = row * stride, b = a + sides;
    avg.fromBufferAttribute(normal, a).add(edge.fromBufferAttribute(normal, b)).normalize();
    normal.setXYZ(a, avg.x, avg.y, avg.z);
    normal.setXYZ(b, avg.x, avg.y, avg.z);
  }
  return geometry;
}

let moldedShell;
export function workHelmetMap() {
  if (moldedShell) return moldedShell;
  const width = 64, height = 32, texels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / (height - 1), i = (y * width + x) * 4;
    const rim = THREE.MathUtils.smoothstep(v, .06, .40);
    const seam = Math.abs(v - .33) < .036 ? 22 : 0;
    const dust = 4.5 * Math.sin(u * Math.PI * 16 + v * 35) + 3.8 * Math.cos(u * Math.PI * 10 - v * 53);
    const value = Math.round(142 + 105 * rim - seam + dust);
    texels.set([value, value, Math.max(0, value - 3), 255], i);
  }
  moldedShell = new THREE.DataTexture(texels, width, height, THREE.RGBAFormat);
  moldedShell.colorSpace = THREE.SRGBColorSpace;
  moldedShell.wrapS = THREE.RepeatWrapping;
  moldedShell.generateMipmaps = true;
  moldedShell.minFilter = THREE.LinearMipmapLinearFilter;
  moldedShell.magFilter = THREE.LinearFilter;
  moldedShell.needsUpdate = true;
  return moldedShell;
}

/** Los colores del casco ya sorteado permiten dos colores de capa sobre las prendas de manga larga. */
export function workwearStyle(garment, helmet) {
  if (!helmet) return 0;
  if (garment === 'overol') return 1;
  if (garment === 'chaqueta' || garment === 'saco') return helmet.color === '#c8662a' ? 3 : 2;
  return 0;
}

export const WORKWEAR = /* glsl */ `
    if (uStreetWorkwear > .5) {
      // Cintas tomadas en coordenadas de la prenda en reposo: se doblan al andar, con la tela.
      float y = p.y;
      float px = max(max(fwidth(y), fwidth(p.x)) * .75, .0018);
      float tape = 0.;
      if (uStreetWorkwear < 1.5) {
        float shin = min(abs(y - .155), abs(y - .205));
        tape = (1. - smoothstep(.012, .012 + px, shin)) * step(.5, vStreetZone);
      } else {
        float torso = 1. - smoothstep(uStreetArm.x + .011, uStreetArm.x + .019 + px, abs(p.x));
        float shoulder = smoothstep(.790, .842, y);
        float front = smoothstep(.021, .045, p.z);
        float neck = 1. - smoothstep(.002, .009, abs(p.x) - shoulder * mix(.041, .060, front));
        float panel = torso * (1. - neck * shoulder) * (1. - step(.5, vStreetZone));
        panel *= smoothstep(.586, .594 + px, y) * (1. - smoothstep(.821, .841 + px, y));
        float zipper = front * (1. - smoothstep(.005, .008 + px, abs(p.x)));
        // Ámbar y naranja de obra. El ribete delimita el chaleco sobre la prenda.
        vec3 vest = uStreetWorkwear > 2.5 ? vec3(.66, .28, .045) : vec3(.54, .184, .046);
        float trim = max(smoothstep(uStreetArm.x + .002, uStreetArm.x + .013 + px, abs(p.x)),
          1. - smoothstep(.602, .61 + px, y));
        float baseShade = dot(diffuseColor.rgb, vec3(.2126, .7152, .0722));
        float folds = .78 + .55 * baseShade + surfaceNoise * .12;
        diffuseColor.rgb = mix(diffuseColor.rgb, vest * folds * (1. - trim * .49), panel * (1. - zipper * .82));
        float stripe = min(abs(y - .628), abs(y - .685));
        tape = (1. - smoothstep(.0125, .0125 + px, stripe)) * panel * (1. - max(zipper, trim));
      }
      // Plata mate que responde al sol y a las luces de la calle.
      vec3 silver = vec3(.61, .625, .61) * (.76 + surfaceNoise * .19);
      diffuseColor.rgb = mix(diffuseColor.rgb, silver, tape * .91);
      streetRoughness = mix(streetRoughness, .48, tape * .85);
    }
`;
