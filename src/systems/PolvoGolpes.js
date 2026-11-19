import * as THREE from 'three';
import { texturaHumo } from '../character/smoking.js';
import { attackSide } from '../character/melee.js';
import { prefiereMovimientoReducido } from '../utils/movimientoReducido.js';

const DURACION = .15;
// Cabe incluso un golpe que alcance a toda la población del distrito a la vez.
const CAPACIDAD = 96;
const TAMANO = .22, EXPANSION = .30, OPACIDAD = .80;

function crearReserva() {
  const grupo = new THREE.Group();
  grupo.name = 'polvo-golpes';
  const map = texturaHumo();
  for (let i = 0; i < CAPACIDAD; i++) {
    const nube = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: '#d9c5a5', transparent: true, depthWrite: false }));
    nube.visible = false;
    grupo.add(nube);
  }
  return grupo;
}

/** Del centro del pecho hacia quien pegó, hasta la superficie de la ropa. */
export function puntoDeContacto(punto, atacante, objetivo) {
  if (objetivo.root?.matrixWorldAutoUpdate === false || !objetivo.character?.pecho?.(punto)) {
    punto.copy(objetivo.position);
    punto.y += 1.05 * (objetivo.look?.real?.talla?.alto ?? 1);
  }
  const dx = atacante.position.x - punto.x, dz = atacante.position.z - punto.z;
  const fraccion = Math.min(.5, .22 / Math.max(.001, Math.hypot(dx, dz)));
  punto.x += dx * fraccion;
  punto.z += dz * fraccion;
  return punto;
}

const extremos = new WeakMap();
const pendientes = new WeakMap();
const mano = new THREE.Vector3(), otra = new THREE.Vector3(), borde = new THREE.Vector3();

// Los objetos empuñados tienen el agarre en el origen y el extremo sobre su eje Y.
// El vértice se busca solo al primer golpe y se comparte entre los portadores de esa geometría.
function punta(malla) {
  const geometria = malla.geometry;
  let punto = extremos.get(geometria);
  if (!punto) {
    const vertices = geometria.attributes.position;
    let mayor = 0;
    for (let i = 1; i < vertices.count; i++) if (Math.abs(vertices.getY(i)) > Math.abs(vertices.getY(mayor))) mayor = i;
    punto = new THREE.Vector3().fromBufferAttribute(vertices, mayor);
    extremos.set(geometria, punto);
  }
  return punto;
}

function puntoDelAncla(destino, ancla, objetivo, empunada) {
  if (!empunada) return ancla.getWorldPosition(destino);
  ancla.getWorldPosition(destino);
  // Las piezas están modeladas en ejes del agarre. Una tabla larga puede contactar antes de su punta.
  let pieza = null;
  for (const hija of ancla.children) {
    if (hija.geometry?.attributes.position && (!pieza || Math.abs(punta(hija).y) > Math.abs(punta(pieza).y))) pieza = hija;
  }
  if (!pieza) return destino;
  pieza.localToWorld(borde.copy(punta(pieza))).sub(destino);
  const horizontal = borde.x ** 2 + borde.z ** 2;
  const avance = horizontal < .0001 ? 1
    : THREE.MathUtils.clamp(((objetivo.x - destino.x) * borde.x + (objetivo.z - destino.z) * borde.z) / horizontal, .45, 1);
  return destino.addScaledVector(borde, avance);
}

export function soltarAncla(marca) {
  const contacto = pendientes.get(marca);
  if (contacto) contacto.atacante = contacto.victima = null;
  marca.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
  marca.frustumCulled = true;
}

function fijarContactoVisible(_renderer, _escena, camara) {
  const { atacante, victima, arma, lado } = pendientes.get(this);
  soltarAncla(this);
  if (!atacante || !victima || atacante._disposed || victima._disposed || atacante.root?.matrixWorldAutoUpdate === false) return;
  const personaje = atacante.character;
  const varilla = arma === 'varilla' && atacante.bar?.pivot;
  const ancla = varilla || personaje?.anclaGolpe?.(lado ?? 'R', arma);
  if (!ancla) return;
  const empunada = !!varilla || ancla.name.startsWith('weapon-');
  const punto = puntoDeContacto(this.position, atacante, victima);
  puntoDelAncla(mano, ancla, punto, empunada);
  if (!lado) {
    // Un cuadro largo puede consumir la fase lógica. La mano adelantada identifica la pose que sí se dibuja.
    const izquierda = personaje.anclaGolpe('L', arma);
    if (izquierda && izquierda !== ancla && izquierda.getWorldPosition(otra).distanceToSquared(punto) < mano.distanceToSquared(punto)) mano.copy(otra);
  }
  // Cerca manda el punto dibujado. En los extremos de un barrido cada víctima conserva su propia señal.
  const dx = mano.x - punto.x, dz = mano.z - punto.z;
  const distancia = Math.hypot(dx, dz);
  const lejos = THREE.MathUtils.smoothstep(distancia, .35, .65);
  const k = THREE.MathUtils.lerp(1, Math.min(1, .19 / Math.max(.001, distancia)), lejos);
  punto.x += dx * k;
  punto.z += dz * k;
  punto.y = mano.y;
  if (camara) {
    // El hueso está dentro de la mano. El trazo nace en la cara exterior del contacto, con profundidad normal.
    const radio = empunada ? .018 : ancla.isBone ? .046 : .07;
    if (!empunada && distancia > .001) {
      // Cuando la mano entra en la ropa, el encuentro visible queda un poco antes del nudillo.
      borde.subVectors(victima.position, atacante.position).setY(0).normalize();
      const avance = THREE.MathUtils.clamp(-dx * borde.x - dz * borde.z, -.075, .035);
      punto.addScaledVector(borde, avance * (1 - lejos));
    }
    camara.getWorldPosition(borde).sub(punto).normalize();
    punto.addScaledVector(borde, radio);
  }
  this.updateWorldMatrix(true, false);
}

export function prepararContacto(marca, atacante, victima, arma, attackId) {
  puntoDeContacto(marca.position, atacante, victima);
  if (!atacante.character?.anclaGolpe && !(arma === 'varilla' && atacante.bar?.pivot)) { soltarAncla(marca); return; }
  const ataque = atacante.attack ?? atacante._counterPose ?? atacante.poseParams?.attack;
  let lado = null;
  if (arma && arma !== 'punos') lado = 'R';
  else if (ataque && (attackId == null || ataque.id === attackId)) lado = attackSide(ataque);
  let contacto = pendientes.get(marca);
  if (!contacto) { contacto = {}; pendientes.set(marca, contacto); }
  contacto.atacante = atacante;
  contacto.victima = victima;
  contacto.arma = arma;
  contacto.lado = lado;
  // El daño se decide antes de componer el brazo. Fijar una sola vez cuando ya se ve la pose de contacto.
  marca.onBeforeRender = fijarContactoVisible;
  marca.frustumCulled = false;
}

export class PolvoGolpes {
  constructor(escena) {
    this.escena = escena;
    this.grupo = null;
    this.siguiente = 0;
  }

  emitir(atacante, objetivo, golpe) {
    if (!this.escena || prefiereMovimientoReducido()) return;
    this.grupo ??= crearReserva();
    if (!this.grupo.parent) this.escena.add(this.grupo);
    const nube = this.grupo.children[this.siguiente];
    this.siguiente = (this.siguiente + 1) % CAPACIDAD;
    prepararContacto(nube, atacante, objetivo, golpe?.weapon ?? atacante.attack?.weapon, golpe?.attackId);
    nube.userData.edad = 0;
    nube.scale.setScalar(TAMANO);
    nube.material.opacity = OPACIDAD;
    nube.visible = true;
  }

  update(dt) {
    if (!this.grupo?.parent) return;
    if (prefiereMovimientoReducido()) { this.limpiar(); return; }
    if (!(dt > 0)) return;
    let quedan = false;
    for (const nube of this.grupo.children) {
      if (!nube.visible) continue;
      nube.userData.edad += dt;
      if (nube.userData.edad >= DURACION) { nube.visible = false; soltarAncla(nube); continue; }
      const fase = nube.userData.edad / DURACION;
      nube.scale.setScalar(TAMANO + EXPANSION * fase);
      nube.position.y += .4 * dt;
      nube.material.opacity = OPACIDAD * (1 - fase);
      quedan = true;
    }
    if (!quedan) this.grupo.removeFromParent();
  }

  limpiar() {
    if (!this.grupo) return;
    for (const nube of this.grupo.children) { nube.visible = false; soltarAncla(nube); }
    this.grupo.removeFromParent();
    this.siguiente = 0;
  }

  dispose() {
    this.limpiar();
    if (this.grupo) {
      for (const nube of this.grupo.children) nube.material.dispose();
      this.grupo.clear();
      this.grupo = null;
    }
    this.escena = null;
  }
}
