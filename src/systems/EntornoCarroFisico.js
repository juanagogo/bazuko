import { Quaternion, Vector3 } from 'three';
import { alturaBanda } from './apoyoCarro.js';

const CELDA = .5;
const MITAD = 16;
const LADO = MITAD * 2 + 1;
const ANCHO = (LADO - 1) * CELDA;
const ALCANCE = 24;

const GRUPO_SUELO = 0x0001ffff;
export const GRUPO_SOLIDO = 0x0002ffff;
export const GRUPO_CHASIS = 0x00040003;
const GRUPO_PISTA = 0x00080010;
export const RAYO_RUEDA = 0x00100008;
const ARRIBA = new Vector3(0, 1, 0);
const SEMIGROSOR = .04;

export class EntornoCarroFisico {
  constructor(rapier, mundo, sistema) {
    this.rapier = rapier;
    this.mundo = mundo;
    this.sistema = sistema;
    this.centroX = Infinity;
    this.centroZ = Infinity;
    this.alturas = new Float32Array(LADO * LADO);
    this.candidatas = [];
    this.obstaculos = new Map();
    this.revision = 0;
    this.pistas = [];
    this.anclaje = new Vector3();
    this.bajada = new Vector3();
    this.normal = new Vector3();
    this.inclinacion = new Quaternion();
    this.ejeRueda = new Vector3();
    this.sueloRueda = this.altura.bind(this);
  }

  altura(x, z, y) {
    const altura = this.sistema._ground(x, z, y);
    return Number.isFinite(altura) ? altura : y;
  }

  _pendiente(x, z, y, dx, dz) {
    const delante = this.altura(x + dx, z + dz, y) - y;
    if (Math.abs(delante) < .035) return delante / .04;
    const detras = y - this.altura(x - dx, z - dz, y);
    return Math.abs(detras) < .035 ? detras / .04 : 0;
  }

  actualizarRuedas(ruedas, centro, rotacion, giro = 0) {
    const bajada = this.bajada.set(0, -1, 0).applyQuaternion(rotacion);
    if (bajada.y > -.4) return;
    for (let i = 0; i < ruedas.length; i++) {
      const rueda = ruedas[i], p = this.anclaje.copy(rueda.anclaje).applyQuaternion(rotacion).add(centro);
      const distancia = Math.max(0, Math.min(.9, (rueda.cota - p.y) / bajada.y));
      const x = p.x + distancia * bajada.x, z = p.z + distancia * bajada.z;
      const piso = this.altura(x, z, rueda.cota);
      const direccion = i < 2 ? giro : 0;
      const eje = this.ejeRueda.set(Math.sin(direccion), 0, Math.cos(direccion)).applyQuaternion(rotacion);
      const y = rueda.cota = alturaBanda(this.sueloRueda, rueda, x, z, piso, eje);
      // El campo de alturas redondea el borde del andén. Cada rayo encuentra la tangente
      // a la calle exacta bajo esa rueda y la carrocería choca con el terreno completo.
      const normal = this.normal.set(-this._pendiente(x, z, piso, .04, 0), 1, -this._pendiente(x, z, piso, 0, .04)).normalize();
      const q = this.inclinacion.setFromUnitVectors(ARRIBA, normal);
      const pista = this.pistas[i];
      if (!pista) {
        const forma = this.rapier.ColliderDesc.cylinder(SEMIGROSOR, .48).setCollisionGroups(GRUPO_PISTA)
          .setTranslation(x - normal.x * SEMIGROSOR, y - normal.y * SEMIGROSOR, z - normal.z * SEMIGROSOR).setRotation(q);
        this.pistas[i] = { caja: this.mundo.createCollider(forma), x, y, z, nx: normal.x, nz: normal.z };
      } else if (Math.abs(x - pista.x) > .12 || Math.abs(z - pista.z) > .12 ||
          Math.abs(y - pista.y) > .0005 || Math.abs(normal.x - pista.nx) + Math.abs(normal.z - pista.nz) > .002) {
        pista.caja.setTranslation(this.anclaje.set(x, y, z).addScaledVector(normal, -SEMIGROSOR));
        pista.caja.setRotation(q);
        pista.x = x; pista.y = y; pista.z = z; pista.nx = normal.x; pista.nz = normal.z;
      }
    }
  }

  _muestrearSuelo(x, z, y) {
    const cx = this.centroX = Math.round(x / CELDA) * CELDA;
    const cz = this.centroZ = Math.round(z / CELDA) * CELDA;
    this.cota = y;
    const alturas = this.alturas;
    alturas[MITAD * LADO + MITAD] = this.altura(cx, cz, y);
    // El viaducto solo devuelve su tablero cerca de la cota de llegada. Cada muestra
    // continúa desde su vecina para seguir la misma calle a lo largo de una rampa.
    for (const signo of [-1, 1]) {
      for (let dx = signo; Math.abs(dx) <= MITAD; dx += signo) {
        const i = (MITAD + dx) * LADO + MITAD;
        alturas[i] = this.altura(cx + dx * CELDA, cz, alturas[i - signo * LADO]);
      }
    }
    for (let ix = 0; ix < LADO; ix++) {
      const sx = cx + (ix - MITAD) * CELDA;
      for (const signo of [-1, 1]) {
        for (let dz = signo; Math.abs(dz) <= MITAD; dz += signo) {
          const i = ix * LADO + MITAD + dz;
          alturas[i] = this.altura(sx, cz + dz * CELDA, alturas[i - signo]);
        }
      }
    }
    const forma = new this.rapier.Heightfield(LADO - 1, LADO - 1, alturas, { x: ANCHO, y: 1, z: ANCHO });
    if (this.suelo) {
      this.suelo.setShape(forma);
      this.suelo.setTranslation({ x: cx, y: 0, z: cz });
    } else {
      const descriptor = new this.rapier.ColliderDesc(forma);
      this.suelo = this.mundo.createCollider(descriptor.setTranslation(cx, 0, cz).setCollisionGroups(GRUPO_SUELO));
    }
  }

  _registrar(entrada, movil, x, z, y) {
    const caja = entrada.box;
    if (!caja || entrada.vehicle === this.sistema.car) return;
    const { min, max } = caja;
    if (min.x > x + ALCANCE || max.x < x - ALCANCE || min.z > z + ALCANCE || max.z < z - ALCANCE ||
        min.y > y + 4 || max.y < y - 3) return;
    const obb = entrada.obb;
    const hx = obb?.halfSize.x ?? (max.x - min.x) * .5;
    const hy = obb?.halfSize.y ?? (max.y - min.y) * .5;
    const hz = obb?.halfSize.z ?? (max.z - min.z) * .5;
    if (!(hx > 0 && hy > 0 && hz > 0 && Number.isFinite(hx + hy + hz))) return;
    const cx = obb?.center.x ?? min.x + hx, cy = obb?.center.y ?? min.y + hy, cz = obb?.center.z ?? min.z + hz;
    const q = obb?.quaternion;
    let dato = this.obstaculos.get(entrada);
    if (!dato) {
      const forma = this.rapier.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz)
        .setCollisionGroups(GRUPO_SOLIDO).setFriction(.26).setRestitution(.16);
      if (q) forma.setRotation(q);
      dato = { colisionador: this.mundo.createCollider(forma), movil, hx, hy, hz, cx, cy, cz, rotacion: q?.clone() };
      this.obstaculos.set(entrada, dato);
    } else {
      if (hx !== dato.hx || hy !== dato.hy || hz !== dato.hz) {
        dato.colisionador.setHalfExtents({ x: hx, y: hy, z: hz });
        dato.hx = hx; dato.hy = hy; dato.hz = hz;
      }
      if (cx !== dato.cx || cy !== dato.cy || cz !== dato.cz) {
        dato.colisionador.setTranslation({ x: cx, y: cy, z: cz });
        dato.cx = cx; dato.cy = cy; dato.cz = cz;
      }
      if (q && !dato.rotacion?.equals(q)) {
        dato.colisionador.setRotation(q);
        (dato.rotacion ??= new Quaternion()).copy(q);
      } else if (!q && dato.rotacion) {
        dato.colisionador.setRotation(dato.rotacion.identity());
        dato.rotacion = null;
      }
    }
    dato.revision = this.revision;
  }

  actualizar(x, z, y) {
    const nuevaZona = Math.abs(x - this.centroX) >= 3 || Math.abs(z - this.centroZ) >= 3 || Math.abs(y - this.cota) >= 1;
    if (nuevaZona) this._muestrearSuelo(x, z, y);
    const colisiones = this.sistema.game.collisions;
    const cantidad = colisiones?.colliders?.length;
    const buscar = nuevaZona || cantidad !== this.cantidadEstatica;
    this.revision++;
    if (buscar) {
      this.cantidadEstatica = cantidad;
      this.candidatas.length = 0;
      const cajas = colisiones?.queryStatic?.(x - ALCANCE, z - ALCANCE, x + ALCANCE, z + ALCANCE, this.candidatas);
      for (const entrada of cajas ?? []) this._registrar(entrada, false, x, z, y);
    }
    for (const entrada of colisiones?.dynamicColliders ?? []) this._registrar(entrada, true, x, z, y);
    for (const [entrada, dato] of this.obstaculos) {
      if ((dato.movil || buscar) && dato.revision !== this.revision) {
        this.mundo.removeCollider(dato.colisionador, false);
        this.obstaculos.delete(entrada);
      }
    }
  }
}
