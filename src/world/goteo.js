import * as THREE from 'three';
import { sinGastarAzar } from './bogota/concretoViaducto.js';
import { viaductSurface, VIADUCT } from './bogota/ColpatriaViaduct.js';
import { bridgeCenter, bridgeNormal } from './bogota/Colpatria.js';

export const HILOS = 24;
const PASO = 1.5, ALCANCE = 18, CADA = .5;

const sorteo = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Dónde se acaba el tablero en la estación z, hacia un lado del eje: el filo de donde cuelga el agua. */
export function bordeDelTablero(z, lado) {
  const cx = bridgeCenter(z);
  if (viaductSurface(cx, z) === null) return null;
  const n = bridgeNormal(z);
  const punto = t => viaductSurface(cx + n.x * lado * t, z + n.z * lado * t);
  let dentro = 0, fuera = 10;
  if (punto(fuera) !== null) return null;
  for (let i = 0; i < 10; i++) {
    const t = (dentro + fuera) / 2;
    if (punto(t) !== null) dentro = t; else fuera = t;
  }
  const x = cx + n.x * lado * dentro, borde = z + n.z * lado * dentro;
  return { x, z: borde, y: viaductSurface(x, borde) ?? punto(dentro) };
}

function crearMaterial(lluvia) {
  return new THREE.ShaderMaterial({
    name: 'BogotaGoteo',
    uniforms: {
      uTime: lluvia.uTime,
      uColor: lluvia.uColor,
      uViewHeight: lluvia.uViewHeight,
      uAlpha: { value: 0 }
    },
    vertexShader: `
      uniform float uViewHeight;
      varying float vAlong;
      varying float vSide;
      varying float vSeed;
      void main() {
        vec4 top = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float len = length(instanceMatrix[1].xyz);
        vec4 topView = viewMatrix * top;
        vec4 bottomView = viewMatrix * vec4(top.xyz - vec3(0.0, len, 0.0), 1.0);
        vec4 viewPosition = mix(topView, bottomView, position.y);
        vec2 along = bottomView.xy - topView.xy;
        float span = length(along);
        vec2 dir = span > 1e-5 ? along / span : vec2(0.0, -1.0);
        float depth = max(-viewPosition.z, 0.05);
        float pixel = (isOrthographic ? 2.0 : 2.0 * depth) / (projectionMatrix[1][1] * max(uViewHeight, 1.0));
        viewPosition.xy += vec2(-dir.y, dir.x) * position.x * max(0.012, 1.2 * pixel) * 0.5;
        vAlong = position.y * len;
        vSide = position.x;
        vSeed = fract(sin(dot(top.xz, vec2(12.9898, 78.233))) * 43758.5453);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uAlpha;
      varying float vAlong;
      varying float vSide;
      varying float vSeed;
      void main() {
        float across = 1.0 - smoothstep(0.6, 1.0, abs(vSide));
        float fall = sqrt(2.0 * max(vAlong, 0.0) / 9.8);
        float every = 0.28 + vSeed * 0.3;
        float k = fract((fall - uTime) / every + vSeed * 5.0);
        float speed = max(1.2, 9.8 * fall);
        float bead = 1.0 - smoothstep(0.0, 0.09 / (speed * every), k);
        float film = 0.3 * (1.0 - smoothstep(0.0, 0.5, vAlong));
        float alpha = uAlpha * across * max(bead, film);
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(uColor * 1.15, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false
  });
}

/** Hilos de agua que cuelgan del filo del viaducto cuando llueve, cerca del jugador. */
export class Goteo {
  constructor(lluvia) {
    this.mesh = sinGastarAzar(0x90e7e0, () => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
      geometry.setIndex([0, 2, 1, 0, 3, 2]);
      return new THREE.InstancedMesh(geometry, crearMaterial(lluvia), HILOS);
    });
    this.puntos = [];
    this._reloj = 0;
    this._matriz = new THREE.Matrix4();
    if (!this.mesh) return;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.raycast = () => {};
  }

  _elegir(jugador) {
    const puntos = [];
    const primero = Math.ceil((jugador.z - ALCANCE) / PASO), ultimo = Math.floor((jugador.z + ALCANCE) / PASO);
    for (let k = primero; k <= ultimo; k++) {
      const z = k * PASO;
      if (z < VIADUCT.start || z > VIADUCT.end || Math.abs(bridgeCenter(z) - jugador.x) > ALCANCE + 9) continue;
      for (const lado of [-1, 1]) {
        if (sorteo(k, lado) < .45) continue;
        const borde = bordeDelTablero(z, lado);
        if (!borde) continue;
        const lejos = Math.hypot(borde.x - jugador.x, borde.z - jugador.z);
        if (lejos <= ALCANCE) puntos.push({ ...borde, lejos });
      }
    }
    puntos.sort((a, b) => a.lejos - b.lejos);
    this.puntos = puntos.slice(0, HILOS);
    this.puntos.forEach((p, i) => {
      const arriba = p.y - VIADUCT.thickness;
      this._matriz.makeScale(1, Math.max(.1, arriba), 1).setPosition(p.x, arriba, p.z);
      this.mesh.setMatrixAt(i, this._matriz);
    });
    this.mesh.count = this.puntos.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  update(dt, jugador, lluvia) {
    if (!this.mesh || !jugador) return;
    this._reloj -= dt;
    if (this._reloj <= 0) {
      this._reloj = CADA;
      this._elegir(jugador);
    }
    this.mesh.material.uniforms.uAlpha.value = .35 * lluvia;
    this.mesh.visible = lluvia > 0 && this.mesh.count > 0;
  }

  dispose() {
    this.mesh?.geometry.dispose();
    this.mesh?.material.dispose();
  }
}
