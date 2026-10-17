// src/core/XRay.js
// Silueta "rayos X": muestra el contorno de un objeto SOLO donde queda tapado por otra geometría.
//
// Técnica (sin segunda pasada de escena ni override de materiales): cada Mesh registrado recibe dos
// "fantasmas" hijos que comparten su geometría (y el esqueleto si es SkinnedMesh):
//   1) pre-pase de stencil (colorWrite off): marca con stencil los píxeles donde el objeto SÍ se ve
//      (depth LessEqual con polygonOffset); así su propia pose no se duplica ni se ve a través de sí mismo.
//   2) silueta: ShaderMaterial con depthFunc GreaterDepth (solo donde hay algo más cerca) y stencil
//      NotEqual => relleno translúcido + borde fresnel, sin escribir depth. Sale ordenado el último
//      (transparent + renderOrder alto), después de todo el mundo opaco.
// Requiere WebGLRenderer({ stencil: true }). Costo: 2 draws por mesh activo; sin allocations por frame.
import * as THREE from 'three';
import {
  XRAY_ENABLED, XRAY_COLOR, XRAY_COLOR_INTERACT, XRAY_RANGE, XRAY_MAX_INTERACT
} from '../utils/constants.js';

const ORDER_PRE = 1000;
const ORDER_SIL = 1001;
const REBUILD_CHECK_FRAMES = 30; // revisa si el objeto cambió de meshes (GLB cargado después)

const VERT = /* glsl */`
  varying vec3 vN;
  varying vec3 vV;
  #include <common>
  #include <skinning_pars_vertex>
  void main() {
    #include <beginnormal_vertex>
    #include <skinbase_vertex>
    #include <skinnormal_vertex>
    #include <defaultnormal_vertex>
    #include <begin_vertex>
    #include <skinning_vertex>
    #include <project_vertex>
    vN = normalize(transformedNormal);
    vV = normalize(-mvPosition.xyz);
  }
`;

const FRAG = /* glsl */`
  uniform vec3 uColor;
  uniform float uFill;
  uniform float uEdge;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    f = f * f;
    gl_FragColor = vec4(uColor, mix(uFill, uEdge, f));
    #include <colorspace_fragment>
  }
`;

// Filtro por defecto: ignora anillos marcadores y cualquier cosa que ignore el depth (UI 3D)
function defaultFilter(m) {
  if (m.userData.noXRay) return false;
  if (m.geometry?.type === 'RingGeometry') return false;
  const mat = m.material;
  if (!mat || Array.isArray(mat)) return !!mat;
  return mat.depthTest !== false;
}

export class XRay {
  /**
   * @param {object} [opts]
   * @param {boolean} [opts.enabled]
   * @param {number} [opts.maxInteract] máximo de entradas no exentas activas a la vez
   */
  constructor(opts = {}) {
    this.enabled = opts.enabled ?? XRAY_ENABLED;
    this.maxInteract = opts.maxInteract ?? XRAY_MAX_INTERACT;
    this.entries = [];
    this._cand = [];
    this._groups = new Map(); // color -> { ref, pre, sil }
    this._frame = 0;
    this._cnt = 0;
    this._countFn = (o) => { if (o.isMesh) this._cnt++; };
  }

  // ---- materiales por color (compartidos por todos los fantasmas del color) ----
  _group(color) {
    let g = this._groups.get(color);
    if (g) return g;
    const ref = this._groups.size + 1; // referencia de stencil propia del color
    const pre = new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false, transparent: true,
      depthTest: true, depthFunc: THREE.LessEqualDepth,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
      stencilWrite: true, stencilRef: ref, stencilFunc: THREE.AlwaysStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.ReplaceStencilOp
    });
    const sil = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uFill: { value: 0.42 },
        uEdge: { value: 0.95 }
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true, depthWrite: false,
      depthTest: true, depthFunc: THREE.GreaterDepth,
      fog: false,
      stencilWrite: true, stencilRef: ref, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp
    });
    // Variante sin stencil (props estaticos): 1 solo draw por mesh; polygonOffset evita que se tape a si mismo
    const silNS = sil.clone();
    silNS.uniforms = { uColor: sil.uniforms.uColor, uFill: sil.uniforms.uFill, uEdge: sil.uniforms.uEdge };
    silNS.stencilWrite = false;
    silNS.polygonOffset = true; silNS.polygonOffsetFactor = -2; silNS.polygonOffsetUnits = -4;
    g = { ref, pre, sil, silNS };
    this._groups.set(color, g);
    return g;
  }

  /**
   * Registra un objeto para silueta.
   * @param {THREE.Object3D} object
   * @param {object} [o]
   * @param {number} [o.color] color de la silueta
   * @param {number} [o.maxDistance] alcance al jugador (Infinity = siempre)
   * @param {()=>boolean} [o.isActive] se consulta cada frame (p. ej. bolsa no vaciada)
   * @param {THREE.Vector3|{x:number,y:number,z:number}} [o.position] punto para medir distancia (por defecto el del objeto)
   * @param {(mesh:THREE.Mesh)=>boolean} [o.filter] qué meshes llevan silueta
   * @param {boolean} [o.exempt] no cuenta para el límite de interactuables (jugador)
   * @param {boolean} [o.stencil] usa pre-pase de stencil (más correcto con auto-oclusión, 2x draws); por defecto = exempt
   * @param {string} [o.tag] etiqueta para unregisterTag
   * @returns entry (pásalo a unregister)
   */
  register(object, o = {}) {
    const e = {
      obj: object,
      color: o.color ?? XRAY_COLOR_INTERACT,
      maxD2: (o.maxDistance ?? XRAY_RANGE) ** 2,
      isActive: o.isActive || null,
      pos: o.position || null,
      filter: o.filter || defaultFilter,
      exempt: !!o.exempt,
      stencil: o.stencil ?? !!o.exempt, // pre-pase de stencil (2 draws): solo para el jugador, que se auto-ocluye
      tag: o.tag || '',
      ghosts: [],
      on: false,
      want: false,
      d2: 0,
      sig: -1
    };
    this.entries.push(e);
    return e;
  }

  unregister(entry) {
    const i = this.entries.indexOf(entry);
    if (i < 0) return;
    this._clearGhosts(entry);
    this.entries.splice(i, 1);
  }

  unregisterTag(tag) {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].tag === tag) this.unregister(this.entries[i]);
    }
  }

  /** Fuerza reconstruir los fantasmas de una entrada (p. ej. tras cargar el modelo) */
  rebuild(entry) { entry.sig = -1; }

  _clearGhosts(e) {
    for (const gh of e.ghosts) gh.parent?.remove(gh); // geometría/materiales son compartidos: no se disponen
    e.ghosts.length = 0;
    e.on = false;
  }

  _build(e) {
    this._clearGhosts(e);
    const src = [];
    e.obj.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || m.userData.xrayGhost) return;
      if (e.filter(m)) src.push(m);
    });
    const g = this._group(e.color);
    for (const m of src) {
      for (let k = e.stencil ? 0 : 1; k < 2; k++) {
        const mat = !e.stencil ? g.silNS : (k === 0 ? g.pre : g.sil);
        let gh;
        if (m.isSkinnedMesh) {
          gh = new THREE.SkinnedMesh(m.geometry, mat);
          gh.bind(m.skeleton, m.bindMatrix);
          gh.bindMode = m.bindMode;
          gh.frustumCulled = false;
        } else {
          gh = new THREE.Mesh(m.geometry, mat);
          gh.frustumCulled = m.frustumCulled;
        }
        gh.userData.xrayGhost = true;
        gh.userData.sharedAsset = true; // los dispose() de las entidades no deben tocar el material compartido
        gh.castShadow = false;
        gh.receiveShadow = false;
        gh.matrixAutoUpdate = false;    // transform identidad respecto al mesh original
        gh.renderOrder = k === 0 ? ORDER_PRE : ORDER_SIL;
        gh.visible = e.on;
        m.add(gh);
        e.ghosts.push(gh);
      }
    }
    this._cnt = 0;
    e.obj.traverse(this._countFn);
    e.sig = this._cnt - e.ghosts.length; // meshes reales
  }

  _setOn(e, on) {
    if (e.on === on) return;
    e.on = on;
    for (let i = 0; i < e.ghosts.length; i++) e.ghosts[i].visible = on;
  }

  /** Llamar una vez por frame, antes de render. */
  update(camera, playerPos) {
    if (!this.enabled) {
      for (const e of this.entries) if (e.on) this._setOn(e, false);
      return;
    }
    this._frame++;
    const px = playerPos.x, py = playerPos.y, pz = playerPos.z;
    const cand = this._cand;
    let n = 0;
    const entries = this.entries;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      e.want = false;
      if (e.isActive && !e.isActive()) continue;
      let x, y, z;
      if (e.pos) { x = e.pos.x; y = e.pos.y; z = e.pos.z; }
      else { const el = e.obj.matrixWorld.elements; x = el[12]; y = el[13]; z = el[14]; }
      const dx = x - px, dy = y - py, dz = z - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > e.maxD2) continue;
      e.d2 = d2;
      e.want = true;
      if (!e.exempt) cand[n++] = e;
    }
    // Límite de interactuables simultáneos: los más cercanos (insertion sort, n pequeño)
    if (n > this.maxInteract) {
      for (let i = 1; i < n; i++) {
        const v = cand[i];
        let j = i - 1;
        while (j >= 0 && cand[j].d2 > v.d2) { cand[j + 1] = cand[j]; j--; }
        cand[j + 1] = v;
      }
      for (let i = this.maxInteract; i < n; i++) cand[i].want = false;
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.want) {
        // construye al primer uso y revisa de vez en cuando si cambió la cantidad de meshes
        if (e.sig < 0) this._build(e);
        else if ((this._frame + i) % REBUILD_CHECK_FRAMES === 0) {
          this._cnt = 0;
          e.obj.traverse(this._countFn);
          if (this._cnt - e.ghosts.length !== e.sig) this._build(e);
        }
      }
      this._setOn(e, e.want);
    }
  }

  dispose() {
    for (const e of this.entries) this._clearGhosts(e);
    this.entries.length = 0;
    for (const g of this._groups.values()) { g.pre.dispose(); g.sil.dispose(); g.silNS.dispose(); }
    this._groups.clear();
  }
}
