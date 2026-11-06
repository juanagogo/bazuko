// src/character/pantsDownLight.js
// Bajarse el pantalón en el personaje liviano. La piel de la cadera y de los muslos vive siempre dentro
// del pantalón (así su programa se compila en la carga); al bajar, la pretina y el pantalón del muslo se
// esconden, queda una manga que se recoge hacia la rodilla y un rollo de tela arrugada en su borde.
import * as THREE from 'three';
import { censorByLocalY, createCensorUniforms, setCensor } from './censor.js';

const THIGH = .24;          // de la cadera a la rodilla, en el espacio de la pierna
const SLEEVE = .26;         // alto del pantalón del muslo, desde la rodilla hasta la pretina
const THIGH_CENSOR = -.06;  // el tercio alto del muslo va censurado junto con la cadera
const SKIN = .97, SLEEVE_WIDTH = 1.08, RING_WIDTH = 1.1;

/** Cápsula del muslo con la misma forma que el pantalón de `character.js`, un poco más delgada. */
function thighGeometry(radius) {
  const geometry = new THREE.CapsuleGeometry(radius * SKIN, .1, 4, 12);
  geometry.translate(0, -.05 - radius * .6, 0);
  return geometry;
}

export function createLightPantsDown({ hips, legs, skinColor, bottomMaterial }) {
  const uniforms = createCensorUniforms(skinColor);
  const pelvisMaterial = new THREE.MeshLambertMaterial({ color: skinColor.clone() });
  const thighMaterial = new THREE.MeshLambertMaterial({ color: skinColor.clone() });
  censorByLocalY(pelvisMaterial, uniforms, -1e3);
  censorByLocalY(thighMaterial, uniforms, THIGH_CENSOR);

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), pelvisMaterial);
  hips.add(pelvis);
  const sleeveGeometry = new THREE.CylinderGeometry(1, 1, 1, 12);
  sleeveGeometry.translate(0, .5, 0);
  const ringGeometry = new THREE.TorusGeometry(1, .28, 6, 14);
  ringGeometry.rotateX(Math.PI / 2);
  const thighs = [], sleeves = [], rings = [], radii = [];
  for (const leg of legs) {
    const thigh = new THREE.Mesh(thighGeometry(.085), thighMaterial);
    const sleeve = new THREE.Mesh(sleeveGeometry, bottomMaterial);
    const ring = new THREE.Mesh(ringGeometry, bottomMaterial);
    sleeve.position.y = -THIGH;
    sleeve.castShadow = ring.castShadow = true;
    sleeve.visible = ring.visible = false;
    leg.hip.add(thigh, sleeve, ring);
    thighs.push(thigh); sleeves.push(sleeve); rings.push(ring); radii.push(.085);
  }

  let hipBand = null, legSlots = [], drop = 0;

  function apply() {
    const down = drop > 0;
    if (hipBand) hipBand.visible = !down;
    for (const slot of legSlots) for (const child of slot.upper.children) child.visible = !down;
    sleeves.forEach((sleeve, i) => {
      const r = radii[i];
      sleeve.visible = rings[i].visible = down;
      sleeve.scale.set(r * SLEEVE_WIDTH, Math.max(1e-3, (1 - drop) * SLEEVE), r * SLEEVE_WIDTH);
      const ring = r * RING_WIDTH * (.75 + .45 * drop);
      rings[i].scale.set(ring, ring, ring);
      rings[i].position.y = -THIGH + (1 - drop) * SLEEVE;
    });
  }

  return {
    /** Toma las piezas nuevas que dejó `build()` y vuelve a aplicar el estado actual. */
    rebuild({ hipBand: band, legSlots: slots }) {
      hipBand = band;
      legSlots = slots;
      pelvisMaterial.color.copy(skinColor);
      thighMaterial.color.copy(skinColor);
      uniforms.uCensorSkin.value.copy(skinColor);
      const params = band?.geometry?.parameters;
      if (params) {
        const r = Math.max(params.radiusTop, params.radiusBottom) * SKIN;
        pelvis.scale.set(r, params.height / 2, r * .85);
        pelvis.position.y = band.position.y;
      }
      slots.forEach((slot, i) => {
        const radius = slot.upper.children[0]?.geometry?.parameters?.radius ?? .085;
        if (radius !== radii[i]) {
          thighs[i].geometry.dispose();
          thighs[i].geometry = thighGeometry(radius);
          radii[i] = radius;
        }
      });
      apply();
    },
    setDrop(value) { drop = Math.max(0, Math.min(1, value || 0)); apply(); },
    setCensor(state) { setCensor(uniforms, state); },
    reset() { drop = 0; setCensor(uniforms, { on: false }); apply(); },
    get drop() { return drop; },
    get parts() { return { hipBand, legSlots, sleeves, rings, thighs, pelvis, uniforms }; }
  };
}
