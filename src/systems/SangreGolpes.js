import * as THREE from 'three';
import { prefiereMovimientoReducido } from '../utils/movimientoReducido.js';
import { prepararContacto, soltarAncla } from './PolvoGolpes.js';

export const NIVELES_SANGRE = [
  { id: 'desactivada', label: 'Desactivada' }, { id: 'discreta', label: 'Discreta' }, { id: 'visible', label: 'Visible' }
];
export const SANGRE_INICIAL = 'discreta';
const CLAVE = 'bazuko.sangre';
const CONTACTOS = 8, MARCAS = 6;
const DURACION_CONTACTO = .24, DURACION_MARCA = 24, DESVANECER = 5;
const ARRIBA = new THREE.Vector3(0, 1, 0);
const posicionValida = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

function nivelGuardado() {
  try {
    const id = globalThis.localStorage?.getItem(CLAVE);
    return NIVELES_SANGRE.some(nivel => nivel.id === id) ? id : SANGRE_INICIAL;
  } catch { return SANGRE_INICIAL; }
}

// Un mismo trazo irregular y mate sirve en la ropa y en el suelo. El borde se filtra también a distancia.
function tinta() {
  const lado = 32, datos = new Uint8Array(lado * lado * 4).fill(255);
  const trazos = [[-.13, .02, .68, .59], [.37, -.18, .37, .35], [.57, .40, .15, .14]];
  for (let fila = 0; fila < lado; fila++) {
    const z = 2 * (fila + .5) / lado - 1;
    for (let col = 0; col < lado; col++) {
      const x = 2 * (col + .5) / lado - 1;
      const borde = .075 * Math.sin(11 * x + 5 * z) * Math.cos(9 * z - 3 * x);
      let alfa = 0;
      for (const [cx, cz, rx, rz] of trazos) {
        const radio = Math.hypot((x - cx) / rx, (z - cz) / rz);
        alfa = Math.max(alfa, 1 - THREE.MathUtils.smoothstep(radio + borde, .66, 1));
      }
      datos[(fila * lado + col) * 4 + 3] = Math.round(alfa * 255);
    }
  }
  const mapa = new THREE.DataTexture(datos, lado, lado);
  mapa.magFilter = THREE.LinearFilter;
  mapa.minFilter = THREE.LinearMipmapLinearFilter;
  mapa.generateMipmaps = true;
  mapa.needsUpdate = true;
  return mapa;
}

function reserva(nombre, cantidad, crear) {
  const grupo = new THREE.Group();
  grupo.name = nombre;
  for (let i = 0; i < cantidad; i++) {
    const marca = crear();
    marca.visible = false;
    grupo.add(marca);
  }
  return grupo;
}

// La cota de referencia conserva la calle o el tablero que sostenía a esta víctima.
function alturaSeca(distrito, victima, x, z, y) {
  const altura = distrito?.getMovementGroundHeight?.(x, z, y)
    ?? victima.groundHeight?.(x, z) ?? distrito?.getGroundHeight?.(x, z);
  if (!Number.isFinite(altura)) return NaN;
  const agua = distrito?.getWaterInfo ? distrito.getWaterInfo(x, z) : victima.getWaterInfo?.(x, z);
  if (agua && (Number.isFinite(agua.surfaceY) ? agua.surfaceY > altura + .002 : agua.depth > 0)) return NaN;
  return altura;
}

/** Efectos de la pelea en espacio de mundo. Las prendas de los personajes conservan su material compartido. */
export class SangreGolpes {
  constructor(escena, mundo, jugador, eventos = globalThis.window) {
    this.escena = escena;
    this.mundo = mundo;
    this._distrito = mundo?.active;
    this.jugador = jugador;
    this.nivel = nivelGuardado();
    // Three usa Math.random para los UUID. Reservar al cargar evita que el ajuste cambie el azar de una pelea.
    this._tinta = tinta();
    this._plano = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.contactos = reserva('sangre-contacto', CONTACTOS, () => {
      const marca = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._tinta, color: '#96423a', transparent: true, depthWrite: false
      }));
      marca.renderOrder = 1;
      return marca;
    });
    this.marcas = reserva('sangre-suelo', MARCAS, () => {
      const marca = new THREE.Mesh(this._plano, new THREE.MeshStandardMaterial({
        map: this._tinta, color: '#74362e', roughness: .94, transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -3
      }));
      marca.receiveShadow = true;
      marca.renderOrder = -1.5; // sobre la pintura y los charcos, bajo el reflejo del farol y la sombra del cuerpo
      return marca;
    });
    this._punto = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._contactoSiguiente = this._marcaSiguiente = 0;
    this._vistas = new WeakSet();
    this._eventos = eventos;
    this._pelea = ({ detail }) => {
      if (detail?.attacker !== this.jugador || !detail?.results) return;
      for (const golpe of detail.results) this.contacto(detail.attacker, golpe.target, golpe.weapon, golpe.damage, golpe.attackId);
    };
    this._recibido = ({ detail }) => {
      if (detail?.victim && detail.victim === this.jugador) this.contacto(detail.attacker, detail.victim, detail.weapon, detail.damage);
    };
    this._muerte = ({ detail }) => this.muere(detail?.victim);
    eventos?.addEventListener?.('street-fight', this._pelea);
    eventos?.addEventListener?.('npc-player-hit', this._recibido);
    eventos?.addEventListener?.('npc-death', this._muerte);
  }

  setNivel(id, guardar = true) {
    if (!NIVELES_SANGRE.some(nivel => nivel.id === id)) return this.nivel;
    if (this.nivel !== id) this.limpiar();
    this.nivel = id;
    if (guardar) {
      try { globalThis.localStorage?.setItem(CLAVE, id); } catch { /* sigue vigente durante la partida */ }
    }
    return id;
  }

  _actualizarDistrito() {
    if (this.mundo?.active === this._distrito) return;
    this.limpiar();
    this._distrito = this.mundo?.active;
  }

  contacto(atacante, victima, arma, dano, attackId) {
    if (!this.escena || this.nivel === 'desactivada' || !Number.isFinite(dano) || dano <= 0 ||
      !posicionValida(atacante?.position) || !posicionValida(victima?.position) || prefiereMovimientoReducido()) return;
    this._actualizarDistrito();
    if (!this.contactos.parent) this.escena.add(this.contactos);
    const marca = this.contactos.children[this._contactoSiguiente];
    this._contactoSiguiente = (this._contactoSiguiente + 1) % CONTACTOS;
    prepararContacto(marca, atacante, victima, arma, attackId);
    const punos = !arma || arma === 'punos';
    const intensidad = THREE.MathUtils.clamp(dano / 32, .2, 1);
    const ancho = (punos ? .21 : .29) + .13 * intensidad;
    const escala = this.nivel === 'discreta' ? .75 : 1;
    marca.scale.set(ancho * escala, ancho * escala * .74, 1);
    marca.material.rotation = (this._contactoSiguiente % 5 - 2) * .28;
    marca.material.opacity = marca.userData.alfa = (.58 + .24 * intensidad) * escala;
    marca.userData.edad = 0;
    marca.visible = true;
  }

  muere(victima) {
    if (!this.escena || this.nivel !== 'visible' || !posicionValida(victima?.position) || victima._disposed ||
      typeof victima.deathSettled !== 'boolean' || this._vistas.has(victima) ||
      (victima.scene?.isScene && victima.scene !== this.escena)) return;
    this._actualizarDistrito();
    this._vistas.add(victima);
    if (!this.marcas.parent) this.escena.add(this.marcas);
    const marca = this.marcas.children[this._marcaSiguiente];
    this._marcaSiguiente = (this._marcaSiguiente + 1) % MARCAS;
    marca.visible = false;
    marca.userData.caida = victima;
  }

  _apoyar(marca, victima) {
    if (victima.isSwimming || victima._koPlan === 'banca') return false;
    const distrito = this.mundo?.active, pies = victima.position;
    const punto = this._punto.copy(pies);
    // Cerca se ve el torso de la pose tendida. Con huesos suspendidos se conserva la posición física final.
    if (victima.root?.matrixWorldAutoUpdate !== false && victima.character?.pecho?.(punto) &&
      (!posicionValida(punto) || Math.hypot(punto.x - pies.x, punto.z - pies.z) > 1.8)) punto.copy(pies);
    const giro = victima.root?.rotation?.y ?? 0;
    const apoyo = alturaSeca(distrito, victima, punto.x, punto.z, pies.y);
    if (!Number.isFinite(apoyo) || Math.abs(apoyo - pies.y) > .30) return false;
    const dx = .12 * Math.cos(giro), dz = -.12 * Math.sin(giro);
    let x = punto.x + dx, z = punto.z + dz;
    let piso = alturaSeca(distrito, victima, x, z, apoyo);
    if (!Number.isFinite(piso) || Math.abs(piso - apoyo) > .065) {
      // Si al costado se acaba la grada o empieza el agua, el lado opuesto conserva el apoyo del torso.
      x = punto.x - dx; z = punto.z - dz;
      piso = alturaSeca(distrito, victima, x, z, apoyo);
      if (!Number.isFinite(piso) || Math.abs(piso - apoyo) > .065) return false;
    }

    // En una rampa las diagonales comparten plano. En un escalón encogemos la huella hasta que quepa en la misma cara.
    for (let rx = .31; rx >= .065; rx *= .55) {
      const rz = rx * .72;
      const a = alturaSeca(distrito, victima, x - rx, z - rz, piso), b = alturaSeca(distrito, victima, x + rx, z - rz, piso);
      const c = alturaSeca(distrito, victima, x - rx, z + rz, piso), d = alturaSeca(distrito, victima, x + rx, z + rz, piso);
      const desnivelX = (b + d - a - c) / (4 * rx), desnivelZ = (c + d - a - b) / (4 * rz);
      if (!Number.isFinite(desnivelX + desnivelZ) || Math.hypot(desnivelX, desnivelZ) > .65 ||
        Math.abs((a + b + c + d) / 4 - piso) > .009 || Math.abs(a + d - b - c) > .03) continue;
      marca.position.set(x, piso + .009, z);
      marca.scale.set(2 * rx, 1, 2 * rz);
      marca.quaternion.setFromUnitVectors(ARRIBA, this._normal.set(-desnivelX, 1, -desnivelZ).normalize());
      if (Math.cos(giro) < 0) marca.rotateY(Math.PI);
      marca.material.opacity = .76;
      marca.userData.edad = 0;
      return true;
    }
    return false;
  }

  update(dt) {
    this._actualizarDistrito();
    if (!(dt > 0) || !Number.isFinite(dt)) dt = 0;
    if (this.contactos?.parent) {
      const reducida = prefiereMovimientoReducido();
      let quedan = false;
      for (const marca of this.contactos.children) {
        if (!marca.visible) continue;
        const edad = marca.userData.edad += dt;
        if (reducida || edad >= DURACION_CONTACTO) { marca.visible = false; soltarAncla(marca); continue; }
        marca.material.opacity = marca.userData.alfa * (1 - THREE.MathUtils.smoothstep(edad / DURACION_CONTACTO, .18, 1));
        quedan = true;
      }
      if (!quedan) this.contactos.removeFromParent();
    }
    if (dt > 0 && this.marcas?.parent) {
      let quedan = false;
      for (const marca of this.marcas.children) {
        const victima = marca.userData.caida;
        if (victima) {
          if (!victima._disposed && !victima.deathSettled) { quedan = true; continue; }
          marca.userData.caida = null;
          marca.visible = !victima._disposed && this._apoyar(marca, victima);
        } else if (marca.visible) {
          const edad = marca.userData.edad += dt;
          marca.visible = edad < DURACION_MARCA;
          marca.material.opacity = .76 * (1 - THREE.MathUtils.smoothstep(edad, DURACION_MARCA - DESVANECER, DURACION_MARCA));
        }
        quedan ||= marca.visible;
      }
      if (!quedan) this.marcas.removeFromParent();
    }
  }

  limpiar() {
    for (const grupo of [this.contactos, this.marcas]) {
      if (!grupo) continue;
      for (const marca of grupo.children) {
        if (grupo === this.contactos) soltarAncla(marca);
        marca.userData.caida = null;
        marca.visible = false;
      }
      grupo.removeFromParent();
    }
    this._contactoSiguiente = this._marcaSiguiente = 0;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._eventos?.removeEventListener?.('street-fight', this._pelea);
    this._eventos?.removeEventListener?.('npc-player-hit', this._recibido);
    this._eventos?.removeEventListener?.('npc-death', this._muerte);
    this.limpiar();
    for (const grupo of [this.contactos, this.marcas]) {
      if (!grupo) continue;
      for (const marca of grupo.children) marca.material.dispose();
      grupo.clear();
    }
    this._plano?.dispose();
    this._tinta?.dispose();
    this.contactos = this.marcas = this._plano = this._tinta = null;
    this.escena = this.mundo = this._distrito = this.jugador = this._eventos = null;
  }
}
