import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Siluetas inspiradas en el parque automotor local; dimensiones físicas comunes al tráfico.
export const CAR_PROFILES = Object.freeze({
  zapatico: { roofRear: -1.22, roofFront: .28, roofY: 1.64, rearBase: -1.83, frontBase: 1.02, beltY: .98, roofWidth: .65,
    top: [[-2.08,.85],[-1.77,1.00],[.94,.98],[1.52,.86],[2.08,.76]], round: false },
  huevito: { roofRear: -.93, roofFront: .17, roofY: 1.58, rearBase: -1.73, frontBase: 1.03, beltY: .95, roofWidth: .64,
    top: [[-2.08,.73],[-1.82,.91],[-1.1,1.01],[.95,.95],[1.65,.83],[2.08,.68]], round: true },
  amigofiel: { roofRear: -1.39, roofFront: .34, roofY: 1.69, rearBase: -1.87, frontBase: .87, beltY: 1.00, roofWidth: .69,
    top: [[-2.08,.94],[-1.7,1.00],[.87,1.00],[1.82,.93],[2.08,.90]], round: false },
  sedan: { roofRear: -.88, roofFront: .27, roofY: 1.49, rearBase: -1.43, frontBase: 1.05, beltY: .99, roofWidth: .66,
    top: [[-2.08,.82],[-1.75,.95],[-1.4,.99],[1.03,.99],[1.83,.90],[2.08,.80]], round: false }
});

/** Reúne piezas inmóviles por material; todos los buffers intermedios son exclusivos. */
export class VehicleBodyBuilder {
  constructor() { this.parts = new Map(); }
  add(geometry, material, position = null, rotation = null) {
    if (rotation) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rotation)));
    if (position) geometry.translate(...position);
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(part);
  }
  box(size, position, material, rotation = null) { this.add(new THREE.BoxGeometry(...size), material, position, rotation); }
  quad(points, material, flip = false) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,1], 2));
    geometry.setIndex(flip ? [0,2,1,0,3,2] : [0,1,2,0,2,3]);
    geometry.computeVertexNormals(); this.add(geometry, material);
  }
  bar(a, b, width, material, depth = width) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const geometry = new THREE.BoxGeometry(width, direction.length(), depth);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0), direction.normalize()));
    geometry.translate(...start.add(end).multiplyScalar(.5).toArray()); this.add(geometry, material);
  }
  build(primaryMaterial) {
    const make = material => {
      const pieces = this.parts.get(material), combined = mergeGeometries(pieces, false);
      for (const piece of pieces) piece.dispose();
      if (material.userData.roadDust) {
        const positions = combined.attributes.position, colors = new Float32Array(positions.count * 3);
        for (let i = 0; i < positions.count; i++) {
          const dust = Math.max(0, Math.min(1, (.65 - positions.getY(i)) / .35));
          colors.set([1 - dust * .13, 1 - dust * .13, 1 - dust * .16], i * 3);
        }
        combined.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      combined.computeBoundingBox(); combined.computeBoundingSphere();
      const mesh = new THREE.Mesh(combined, material);
      mesh.castShadow = mesh.receiveShadow = true;
      return mesh;
    };
    const root = make(primaryMaterial); root.name = 'Carrocería suspendida';
    for (const material of this.parts.keys()) if (material !== primaryMaterial) {
      const part = make(material); part.name = `Detalle · ${material.name || material.type}`; root.add(part);
    }
    this.parts.clear();
    return root;
  }
}

/** Volumen con pasos de rueda abiertos a través de ambos costados; no hay bloque tras las llantas. */
function lowerShell(profile) {
  const shape = new THREE.Shape();
  shape.moveTo(-2.08, .28);
  for (const axle of [-1.33, 1.33]) {
    shape.lineTo(axle - .405, .28);
    for (let step = 0; step <= 12; step++) {
      const angle = Math.PI * (1 - step / 12);
      shape.lineTo(axle + Math.cos(angle) * .405, .33 + Math.sin(angle) * .405);
    }
    shape.lineTo(axle + .405, .28);
  }
  shape.lineTo(2.08, .28);
  for (const [x,y] of [...profile.top].reverse()) shape.lineTo(x,y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 1.67, bevelEnabled: true,
    bevelThickness: .035, bevelSize: .035, bevelSegments: 2, steps: 1, curveSegments: 6 });
  geometry.translate(0, 0, -.835);
  return geometry;
}

export function addCarBody(batch, model, { paint, glass, dark, chrome }) {
  const p = CAR_PROFILES[model];
  batch.add(lowerShell(p), paint);
  // Bastidor estrecho: queda por dentro de los pasos de rueda y deja los neumáticos visibles.
  batch.box([3.3,.12,.94], [0,.30,0], dark);
  const roofY = p.roofY, roofZ = p.roofWidth, baseZ = .806, b = -.30;
  const rear = p.roofRear, front = p.roofFront, base = p.beltY;
  // Techo de tres paños, con corona y bordes biselados, sigue la forma de cada cabina.
  batch.quad([[rear,roofY-.045,-roofZ],[front,roofY-.045,-roofZ],[front,roofY+.015,0],[rear,roofY+.015,0]], paint, true);
  batch.quad([[rear,roofY+.015,0],[front,roofY+.015,0],[front,roofY-.045,roofZ],[rear,roofY-.045,roofZ]], paint, true);
  for (const side of [-1,1]) {
    const rb = [p.rearBase,base,side*baseZ], fb = [p.frontBase,base,side*baseZ];
    const rt = [rear,roofY-.045,side*roofZ], ft = [front,roofY-.045,side*roofZ];
    batch.quad([rb,fb,ft,rt], glass, side < 0);
    // Pilares y junquillos reales, no una cabina de vidrio maciza.
    batch.bar(rb,rt,.075,paint,.08); batch.bar(fb,ft,.078,paint,.08);
    batch.bar(rt,ft,.055,paint,.065); batch.bar(rb,fb,.038,dark,.045);
    batch.bar([b,base,side*baseZ],[b,roofY-.04,side*roofZ],.065,model==='amigofiel'?paint:dark,.065);
    // La junta de puerta y la moldura no atraviesan los huecos de las ruedas.
    for (const x of [b,p.frontBase-.10]) batch.bar([x,.39,side*.873],[x,base-.025,side*.873],.011,dark,.008);
    batch.box([1.72,.035,.018],[-.05,.57,side*.872],dark);
    batch.box([1.80,.055,.04],[-.03,.315,side*.849],model==='amigofiel'?chrome:paint);
    for (const x of [b+.18,b-.58]) batch.box([.17,.035,.025],[x,base-.13,side*.88],model==='amigofiel'?chrome:dark);
    // Ribete bajo la luna y pequeñas líneas térmicas: brillo discreto, sin emitir luz.
    if (model==='amigofiel') batch.bar(rb,fb,.014,chrome,.018);
  }
  const frontBottom = [p.frontBase,base,0], frontTop = [front,roofY-.045,0];
  batch.quad([[p.frontBase,base,-baseZ],[p.frontBase,base,baseZ],[front,roofY-.045,roofZ],[front,roofY-.045,-roofZ]],glass,true);
  batch.quad([[p.rearBase,base,baseZ],[p.rearBase,base,-baseZ],[rear,roofY-.045,-roofZ],[rear,roofY-.045,roofZ]],glass,true);
  // Tablero y asientos visibles tras el acristalamiento; comparten el lote oscuro de molduras.
  batch.box([.34,.16,1.38],[p.frontBase-.17,base-.06,0],dark);
  for (const z of [-.37,.37]) {
    batch.box([.14,.37,.44],[-.19,base+.07,z],dark,[0,0,-.12]);
    batch.box([.14,.13,.26],[-.20,base+.32,z],dark);
  }
  batch.box([.18,.32,1.25],[p.rearBase+.24,base+.04,0],dark);
  const steering = new THREE.TorusGeometry(.13,.016,5,14);
  batch.add(steering, dark, [p.frontBase-.30,base+.12,-.38], [0,Math.PI/2-.3,0]);
  // Parachoques retranqueados: ni placa ni detalles ensanchan la huella física de 4,3×1,76.
  for (const sign of [-1,1]) {
    batch.box([.105,.14,1.65],[sign*2.09,.40,0],model==='amigofiel'?chrome:dark);
    if (model==='amigofiel') for (const z of [-.52,.52]) batch.box([.12,.20,.08],[sign*2.08,.42,z],dark);
  }
  // Juntas de capó y baúl siguen sus superficies, sin relieves exagerados.
  for (const z of [-.63,.63]) batch.bar([p.frontBase+.08,base-.015,z],[1.91,p.top.at(-1)[1]+.025,z],.008,dark);
  if (model==='sedan') batch.bar([-1.82,.952,-.66],[-1.82,.952,.66],.009,dark);
  const exhaust = new THREE.CylinderGeometry(.033,.033,.17,8);
  batch.add(exhaust,dark,[-2.04,.25,-.48],[0,0,Math.PI/2]);
  return { profile:p, windshield:{ bottom:frontBottom,top:frontTop },
    mirrorAnchors:[-1,1].map(side=>new THREE.Vector3(p.frontBase-.14,base+.07,side*.98)) };
}

/** El marco fijo alinea Z con la normal del vidrio; el hijo gira en Z sobre ese plano. */
export function makeWipers(windshield, material) {
  const bottom = new THREE.Vector3(...windshield.bottom), top = new THREE.Vector3(...windshield.top);
  const up = top.sub(bottom).normalize(), right = new THREE.Vector3(0,0,-1);
  const normal = new THREE.Vector3().crossVectors(right,up).normalize();
  const rotation = new THREE.Matrix4().makeBasis(right,up,normal);
  return [-.43,.22].map(z => {
    const frame = new THREE.Group(); frame.name = 'Soporte de limpiaparabrisas';
    frame.position.copy(bottom).addScaledVector(up,.035).addScaledVector(normal,.012); frame.position.z=z;
    frame.setRotationFromMatrix(rotation);
    const pivot = new THREE.Group(); pivot.name = 'Limpiaparabrisas';
    pivot.userData.restAngle=-.85; pivot.userData.sweepAngle=1.55; pivot.rotation.z=pivot.userData.restAngle;
    const arm=new THREE.Mesh(new THREE.BoxGeometry(.018,.39,.014),material); arm.position.y=.19;
    arm.castShadow=false; pivot.add(arm); frame.add(pivot);
    return pivot;
  });
}
