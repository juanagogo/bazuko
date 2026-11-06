// src/systems/rebusque/RebusqueVisual.js
// Lo que se ve del rebusque: las pelotas en cascada entre las manos, el rodillo y la espuma sobre el parabrisas de
// verdad, la chaza y el dulce, y la mano del conductor que sale por la ventana con la moneda.
//
// Es un dibujante tonto: solo lee `game.rebusque.escena` (un objeto plano que llena RebusqueSystem) y la pose del
// cuerpo. Sin escena no existe ninguna malla. Todo es propio: nunca toca los materiales del carro ni su grupo
// (el vidrio y el esmalte son compartidos por toda la flota); la espuma copia la matriz de la carrocería. Lo único
// que le pide al carro es bajar la ventana del conductor antes de sacar la mano (`Car.setDriverWindow`) y subirla
// después; solo se ocupa de los carros que tienen la ventana abajo, y sin ellos no hace nada por cuadro.
// Pocas mallas, sin sombras, geometrías y materiales creados una vez y liberados en dispose().
import * as THREE from 'three';
import { getCarBody } from '../../world/bogota/VehicleBody.js';
import { BEAT, VUELO, ALTURA, ALTURA_ALTA, esAlta, manoDe } from './ritmo.js';
import { rumbo, puertaDe } from './semaforo.js';
import { barrido } from '../../character/rebusquePose.js';

const GRAVEDAD = 9.8;
const BOLA_R = .035;
const COLORES_BOLA = ['#d8322b', '#f2c230', '#2f9e4f'];
const ESPUMA_U = 11, ESPUMA_V = 7;
const ESPUMA_ALFA = .62;
const SOAP_S = .6;              // primero se enjabona; después pasa el rodillo
const MANO_SALE_S = .3, MANO_QUEDA_S = 1.5, MANO_ENTRA_S = .3;
// Primero baja el vidrio y después sale la mano; al entrar la mano, el vidrio sube. El primero que reacciona espera a
// que baje; el segundo se corre la mitad, para no sacar la mano a la vez que el primero sin pasarse del cobro, y del
// tercero en adelante el turno de .35 s ya alcanza para bajarlo.
const VENTANA_BAJA_S = .35, VENTANA_SUBE_S = .6;
const saleLaMano = t0 => Math.max(t0, VENTANA_BAJA_S + t0 / 2);
const VUELO_MONEDA_S = .35;
const GUARDAR_S = VUELO + .25; // al cobrar, las pelotas que iban en el aire caen en las manos y luego se guardan
const MAX_MANOS = 3;
const VISIBLES = new Set(['paga', 'propina', 'comida', 'compra', 'excusa', 'insulto', 'bravo', 'furia']);
const norm = name => String(name ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const suave = t => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };

export class RebusqueVisual {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.group = null;      // se crea con la primera escena
    this._char = null;      // personaje cuyas manos están en caché
    this._manos = [null, null];
    this._dedos = [null, null];
    this._palma = [new THREE.Vector3(), new THREE.Vector3()];
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3(); this._u = new THREE.Vector3();
    this._m = new THREE.Matrix4(); this._p2 = new THREE.Vector3(); this._n = new THREE.Vector3(); this._l = new THREE.Vector3();
    this._visibles = [];
    this._arriba = new THREE.Vector3(0, 1, 0);
    this._bolas = [];       // { mesh, k, desde: Vector3, caida }
    this._espuma = null;    // { mesh, modelo, limpio: Float32Array }
    this._manosConductor = [];
    this._ventanas = new Map(); // carro → { abierta (0 a 1), cuadro en que el cobro la puso }
    this._cuadro = 0;
    this._escenaPrevia = null;
    this._finT = null;      // tiempo del show de malabares cuando empezó el cobro: las pelotas terminan su vuelo
    this._finRitmo = null;
    this.mallas = 0;        // para las pruebas: cuántas mallas propias existen
  }

  // ---------- creación perezosa ----------

  _armar() {
    if (this.group) return;
    this.group = new THREE.Group();
    this.group.name = 'Rebusque: props';
    this.scene?.add(this.group);
    this._recursos();
  }

  /** Geometrías y materiales, una sola vez: los usan la escena y la precarga de shaders. */
  _recursos() {
    if (this._mat) return;
    const mat = (color, roughness = .7, metalness = 0) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
      m.name = 'rebusque-prop';
      return m;
    };
    this._geo = {
      bola: new THREE.SphereGeometry(BOLA_R, 12, 8),
      hoja: new THREE.BoxGeometry(.04, .03, .34),
      palo: new THREE.CylinderGeometry(.011, .011, 1, 6),
      chaza: new THREE.BoxGeometry(.17, .06, .11),
      dulce: new THREE.BoxGeometry(.05, .024, .024),
      mano: new THREE.CapsuleGeometry(.034, .11, 3, 8),
      brazo: new THREE.CylinderGeometry(.03, .026, 1, 8),
      manga: new THREE.CylinderGeometry(.046, .042, 1, 8),
      moneda: new THREE.CylinderGeometry(.024, .024, .005, 14),
      billete: new THREE.BoxGeometry(.15, .003, .07)
    };
    this._geo.palo.translate(0, .5, 0); // nace en la mano y crece hacia el rodillo
    this._geo.brazo.translate(0, .5, 0); // del codo (adentro de la cabina) a la muñeca
    this._geo.manga.translate(0, .5, 0);
    this._mat = {
      bolas: COLORES_BOLA.map(c => mat(c, .55)),
      hoja: mat('#2b2b2b', .6), palo: mat('#8a8f96', .4, .6),
      chaza: mat('#b58a52', .9), dulce: mat('#e2477d', .5),
      piel: mat('#b98563', .75), manga: mat('#3d4a5c', .85), billete: mat('#6fae6f', .8),
      // Poco metal: sin mapa de entorno, una moneda muy metálica se ve negra. Un brillo propio para que se lea de noche.
      moneda: new THREE.MeshStandardMaterial({ color: '#e8c35a', roughness: .35, metalness: .25, emissive: '#4a3608' }),
      espuma: new THREE.MeshStandardMaterial({ color: '#f2f6f8', roughness: .55, transparent: true, depthWrite: false,
        vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
    };
    this._mat.espuma.name = 'rebusque-espuma';
    this._mat.moneda.name = 'rebusque-prop';
  }

  /**
   * Para Renderer.prepare: una malla por material, para que los shaders se compilen en la carga y no en el primer show.
   * La espuma lleva color RGBA por vértice como la de verdad (otro programa). El grupo cuelga de la escena, apagado:
   * no se dibuja ni se recorre en cada cuadro, pero lo alcanzan las compilaciones de la escena cuando cambian las sombras
   * (la subida automática de calidad, el bajón de resolución o Ajustes), que si no lo dejarían para el primer show.
   */
  get preloadables() {
    if (!this._precarga) {
      this._recursos();
      const grupo = new THREE.Group();
      grupo.name = 'Rebusque: precarga';
      grupo.visible = false;
      grupo.matrixAutoUpdate = false; grupo.matrixWorldAutoUpdate = false;
      const espuma = new THREE.BufferGeometry();
      espuma.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3));
      espuma.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * 4), 4));
      espuma.computeVertexNormals();
      this._geoPrecarga = espuma;
      for (const m of Object.values(this._mat).flat()) {
        const mesh = new THREE.Mesh(m === this._mat.espuma ? espuma : this._geo.bola, m);
        mesh.name = `Precarga: ${m.name}`;
        mesh.castShadow = false; mesh.receiveShadow = false;
        mesh.visible = false;
        grupo.add(mesh);
      }
      this._precarga = grupo;
      this.scene?.add(grupo);
    }
    return [this._precarga];
  }

  _malla(geo, mat, name) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.visible = false;
    this.group.add(mesh);
    this.mallas++;
    return mesh;
  }

  // ---------- manos del jugador ----------

  /** Busca las manos una vez por personaje (cambia con el modelo o al reconstruirlo). */
  _buscarManos() {
    const ch = this.game.player?.character;
    if (ch === this._char && this._colgada(this._manos[0], ch)) return;
    this._char = ch; this._grupo = ch?.group; this._hijos = ch?.group?.children?.length ?? 0;
    this._manos = [null, null]; this._dedos = [null, null];
    ch?.group?.traverse?.(o => {
      const n = norm(o.name);
      const i = n.endsWith('righthand') ? 0 : n.endsWith('lefthand') ? 1 : -1;
      if (i < 0 || this._manos[i]) return;
      this._manos[i] = o;
      // El dedo medio da hacia dónde queda la palma; si no hay, el primer hueso hijo.
      let dedo = null;
      o.traverse(c => { if (!dedo && c !== o && /middle1$/.test(norm(c.name))) dedo = c; });
      this._dedos[i] = dedo ?? o.children.find(c => c.isBone) ?? null;
    });
  }

  /** ¿La mano en caché sigue colgada del grupo del personaje? Si el modelo se reconstruyó, hay que buscarla otra vez. */
  _colgada(mano, ch) {
    // Ya se buscó en este mismo grupo y no tenía huesos: se vuelve a buscar solo si le llega otro modelo.
    if (!mano) return ch?.group === this._grupo && (ch?.group?.children?.length ?? 0) === this._hijos;
    for (let o = mano; o; o = o.parent) if (o === ch?.group) return true;
    return false;
  }

  /** Palma de la mano (0 derecha, 1 izquierda) en el mundo. Sin huesos, un punto delante del pecho. */
  _palmaDe(i, out = this._palma[i]) {
    const mano = this._manos[i];
    if (mano) {
      mano.getWorldPosition(out);
      const dedo = this._dedos[i];
      if (dedo) out.lerp(dedo.getWorldPosition(this._u), .55);
      return out;
    }
    const player = this.game.player, s = player?.modelScale ?? 1;
    out.set(i === 0 ? -.2 : .2, 1.02, .32).multiplyScalar(s);
    return player?.root ? player.root.localToWorld(out) : out.add(player?.position ?? this._u.set(0, 0, 0));
  }

  // ---------- ciclo ----------

  update(dt) {
    this._cuadro++;
    const escena = this.game.rebusque?.escena ?? null;
    if (!escena) { if (this.group) this._ocultarTodo(); this._escenaPrevia = null; this._subirVentanas(dt); return; }
    this._armar();
    this._buscarManos();
    this._palmaDe(0); this._palmaDe(1);
    const previa = this._escenaPrevia, nueva = escena !== previa;
    this._escenaPrevia = escena;
    if (nueva) {
      this._ocultarTodo();
      const cierre = escena.tipo === 'cobro' && previa?.tipo === 'malabares';
      this._finT = cierre ? previa.tiempo : null;
      this._finRitmo = cierre ? previa.ritmo ?? null : null;
    }
    const vivo = !escena.vehicle || (this.game.traffic?.vehicles ?? []).includes(escena.vehicle);
    if (escena.tipo === 'malabares') this._malabares(escena, nueva);
    else if (escena.tipo === 'vidrios' && vivo) this._vidrios(escena, nueva);
    else if (escena.tipo === 'dulces' || escena.tipo === 'bus') this._dulces(escena);
    else if (escena.tipo === 'cobro') this._cobro(escena, dt);
    this._subirVentanas(dt);
  }

  /** Pone la ventana del conductor de `car` (0 cerrada, 1 abajo) y la anota para subirla si el cobro la suelta. */
  _ventanaA(car, abierta) {
    const estado = this._ventanas.get(car);
    if (!(abierta > 0)) { if (estado) { car.setDriverWindow?.(0); this._ventanas.delete(car); } return; }
    if (!car.setDriverWindow?.(abierta)) { this._ventanas.delete(car); return; }
    if (estado) { estado.abierta = abierta; estado.cuadro = this._cuadro; }
    else this._ventanas.set(car, { abierta, cuadro: this._cuadro });
  }

  /** Las ventanas que el cobro ya no lleva (terminó, cambió de escena o el carro salió) suben solas hasta cerrar. */
  _subirVentanas(dt) {
    if (!this._ventanas.size) return;
    for (const [car, estado] of this._ventanas) {
      if (estado.cuadro === this._cuadro) continue;
      estado.abierta = Math.max(0, estado.abierta - Math.max(0, dt) / VENTANA_SUBE_S);
      if (!car.setDriverWindow?.(estado.abierta) || estado.abierta <= 0) this._ventanas.delete(car);
    }
  }

  _ocultarTodo() {
    for (const o of this.group?.children ?? []) o.visible = false;
  }

  // ---------- malabares ----------

  /**
   * `t` y `ritmo` son los del show; `kMax` es el último lanzamiento que sale (al cobrar ya no se lanza más: las que van
   * en el aire terminan su vuelo y se quedan en la mano que las recibe).
   */
  _malabares(escena, nueva, t = escena.tiempo, ritmo = escena.ritmo, kMax = Infinity) {
    if (this._bolas.length < 3) for (let b = this._bolas.length; b < 3; b++) {
      this._bolas.push({ mesh: this._malla(this._geo.bola, this._mat.bolas[b], `Pelota de malabares ${b + 1}`), k: -1, desde: new THREE.Vector3(), caida: null });
    }
    const piso = (this.game.player?.position?.y ?? 0) + BOLA_R;
    const kAhora = Math.min(kMax, Math.floor(t / BEAT + 1e-9));
    for (let b = 0; b < 3; b++) {
      const bola = this._bolas[b];
      if (nueva) { bola.k = -1; bola.caida = null; }
      // El lanzamiento más reciente de esta pelota que sí salió.
      let k = kAhora - (((kAhora - b) % 3) + 3) % 3;
      while (k >= 0 && ritmo && !ritmo.enJuego(k)) k -= 3;
      const mesh = bola.mesh;
      mesh.visible = true;
      if (k < 0) { // todavía en la mano que la va a lanzar; la tercera espera montada sobre la primera
        mesh.position.copy(this._palma[manoDe(b)]);
        if (b === 2) mesh.position.y += 2 * BOLA_R;
        continue;
      }
      if (k !== bola.k) {
        // Acaba de salir: el punto de partida es la mano que lanza, un poco hacia adentro.
        bola.k = k; bola.caida = null;
        const origen = this._palma[manoDe(k)], otra = this._palma[1 - manoDe(k)];
        bola.desde.copy(origen).lerp(otra, .08);
      }
      const destino = this._palma[1 - manoDe(k)];
      const tau = (t - k * BEAT) / VUELO;
      const alto = ALTURA * (esAlta(k) ? ALTURA_ALTA : 1);
      if (tau < 1) {
        mesh.position.copy(bola.desde).lerp(destino, tau);
        mesh.position.y += 4 * alto * tau * (1 - tau);
        continue;
      }
      if (ritmo?.seCae(k)) { this._cayendo(bola, destino, alto, t - (k * BEAT + VUELO), piso); continue; }
      // En la mano: la lleva hacia adentro y abajo antes de lanzarla otra vez.
      const enMano = Math.min(1, (t - k * BEAT - VUELO) / (3 * BEAT - VUELO));
      mesh.position.copy(destino).lerp(this._palma[manoDe(k)], .06 * Math.sin(Math.PI * enMano));
    }
  }

  /** La pelota que no se agarra sigue cayendo, rebota una vez y rueda un poco. */
  _cayendo(bola, destino, alto, s, piso) {
    if (!bola.caida) {
      const p = destino.clone();
      const h = rumbo({ group: { rotation: { y: (this.game.player?.root?.rotation?.y ?? 0) - Math.PI / 2 } } });
      bola.caida = { p, vy: -4 * alto / VUELO, dir: new THREE.Vector3(h.x, 0, h.z) };
    }
    const c = bola.caida, mesh = bola.mesh;
    const caer = h => { const a = GRAVEDAD / 2, b = -c.vy, cc = -(h); return (-b + Math.sqrt(Math.max(0, b * b - 4 * a * cc))) / (2 * a); };
    const t1 = caer(c.p.y - piso), v1 = Math.abs(c.vy - GRAVEDAD * t1) * .35, t2 = 2 * v1 / GRAVEDAD;
    mesh.position.copy(c.p);
    if (s < t1) { mesh.position.y = c.p.y + c.vy * s - GRAVEDAD / 2 * s * s; return; }
    const r = Math.min(.5, s - t1 - t2);
    mesh.position.y = s < t1 + t2 ? piso + v1 * (s - t1) - GRAVEDAD / 2 * (s - t1) ** 2 : piso;
    mesh.position.addScaledVector(c.dir, .12 * Math.min(1, (s - t1) / Math.max(t2, .01)) + (r > 0 ? .5 * r * (1 - r) : 0));
  }

  // ---------- parabrisas ----------

  /** El parabrisas del modelo: punto (u de −1 a 1 a lo ancho, v de 0 abajo a 1 arriba) en coordenadas de la carrocería. */
  _puntoVidrio(body, u, v, out) {
    const [arriba, abajo] = body.spec.windshield;
    const x = abajo + (arriba - abajo) * v;
    const z = u * body.edgeZ(x) * (.86 - .14 * v);
    return out.set(x, body.topY(x, z) + .012, z);
  }

  _armarEspuma(modelo, body) {
    if (this._espuma?.modelo === modelo) return this._espuma;
    if (this._espuma) { this._espuma.mesh.geometry.dispose(); this.group.remove(this._espuma.mesh); this.mallas--; }
    const geo = new THREE.BufferGeometry(), n = ESPUMA_U * ESPUMA_V;
    const pos = new Float32Array(n * 3), color = new Float32Array(n * 4), idx = [];
    const p = new THREE.Vector3();
    for (let j = 0; j < ESPUMA_V; j++) for (let i = 0; i < ESPUMA_U; i++) {
      const u = -1 + 2 * i / (ESPUMA_U - 1), v = j / (ESPUMA_V - 1), a = j * ESPUMA_U + i;
      this._puntoVidrio(body, u, v, p).toArray(pos, a * 3);
      color.set([1, 1, 1, 0], a * 4);
      if (i < ESPUMA_U - 1 && j < ESPUMA_V - 1) idx.push(a, a + ESPUMA_U, a + 1, a + 1, a + ESPUMA_U, a + ESPUMA_U + 1);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(color, 4));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // Que mire hacia afuera del vidrio: si quedó al revés, se voltea el orden de los triángulos.
    const normal = new THREE.Vector3().fromBufferAttribute(geo.attributes.normal, Math.floor(n / 2));
    if (normal.y < 0) { const ix = geo.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } geo.computeVertexNormals(); }
    const mesh = this._malla(geo, this._mat.espuma, 'Espuma sobre el parabrisas');
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 2;
    this._espuma = { mesh, modelo, limpio: new Float32Array(n), uv: Array.from({ length: n }, (_, a) => [-1 + 2 * (a % ESPUMA_U) / (ESPUMA_U - 1), Math.floor(a / ESPUMA_U) / (ESPUMA_V - 1)]) };
    return this._espuma;
  }

  _vidrios(escena, nueva) {
    const car = escena.car, carroceria = car?.vehicle?.bodyVisual, modelo = car?.vehicle?.model;
    let body = null;
    try { body = modelo ? getCarBody(modelo) : null; } catch { body = null; }
    this._hoja ??= this._malla(this._geo.hoja, this._mat.hoja, 'Rodillo');
    this._palo ??= this._malla(this._geo.palo, this._mat.palo, 'Palo del rodillo');
    const t = escena.tiempo, dur = Math.max(1, escena.dur);
    const cabeza = this._w;
    if (body?.spec?.windshield && carroceria) {
      carroceria.updateWorldMatrix(true, false);
      const espuma = this._armarEspuma(modelo, body);
      if (nueva) espuma.limpio.fill(0);
      // La cabeza baja de arriba a abajo mientras va de lado a lado con el mismo barrido del brazo
      // (character/rebusquePose.js): la derecha del jugador, que mira al carro, es la −Z de la carrocería.
      const v = .92 - .84 * suave((t - SOAP_S) / (dur - SOAP_S));
      const u = t < SOAP_S ? Math.sin(t * 14) * .6 : -.95 * barrido(t);
      this._puntoVidrio(body, u, v, cabeza);
      // Ejes sobre el vidrio, en la carrocería: T sube por el vidrio, L lo cruza y N sale de él.
      const T = this._puntoVidrio(body, u, Math.min(1, v + .05), this._p2).sub(cabeza).normalize();
      const L = this._l.set(0, 0, 1), N = this._n.crossVectors(T, L).normalize();
      this._limpiar(espuma, u, v, t);
      espuma.mesh.matrix.copy(carroceria.matrixWorld);
      espuma.mesh.matrixWorldNeedsUpdate = true;
      espuma.mesh.visible = true;
      cabeza.applyMatrix4(carroceria.matrixWorld);
      T.transformDirection(carroceria.matrixWorld); L.transformDirection(carroceria.matrixWorld); N.transformDirection(carroceria.matrixWorld);
      // La hoja a lo largo del vidrio y de canto contra él: base (N, −L, T), derecha.
      this._m.makeBasis(N, L.negate(), T);
      this._hoja.quaternion.setFromRotationMatrix(this._m);
      this._hoja.position.copy(cabeza).addScaledVector(N, .02);
    } else {
      // Sin modelo conocido: frente al capó, a la altura del pecho.
      const h = rumbo(car ?? {});
      cabeza.set(car?.position?.x ?? 0, (car?.position?.y ?? 0) + 1.05, car?.position?.z ?? 0).addScaledVector(this._v.set(h.x, 0, h.z), (car?.length ?? 4) / 2 - .6);
      this._hoja.position.copy(cabeza);
    }
    this._hoja.visible = true;
    // El palo va de la mano a la hoja: tapa cualquier diferencia de alcance del brazo.
    const mano = this._palma[0];
    const dir = this._v.copy(this._hoja.position).sub(mano);
    const largo = dir.length();
    this._palo.position.copy(mano);
    this._palo.quaternion.setFromUnitVectors(this._arriba, dir.normalize());
    this._palo.scale.set(1, Math.max(.05, largo), 1);
    this._palo.visible = true;
  }

  _limpiar(espuma, u, v, t) {
    const color = espuma.mesh.geometry.attributes.color, entrada = Math.min(1, t / SOAP_S);
    for (let a = 0; a < espuma.limpio.length; a++) {
      const [ua, va] = espuma.uv[a];
      // Lo que la hoja ya tocó queda limpio, con un hilito de espuma que escurre.
      if (t > SOAP_S && Math.abs(ua - u) < .28 && va > v - .12) espuma.limpio[a] = 1;
      color.array[a * 4 + 3] = ESPUMA_ALFA * entrada * (1 - .9 * espuma.limpio[a]);
    }
    color.needsUpdate = true;
  }

  // ---------- dulces ----------

  _dulces(escena) {
    this._chaza ??= this._malla(this._geo.chaza, this._mat.chaza, 'Chaza de dulces');
    this._dulce ??= this._malla(this._geo.dulce, this._mat.dulce, 'Dulce');
    const yaw = this.game.player?.root?.rotation?.y ?? 0;
    this._chaza.position.copy(this._palma[1]); this._chaza.position.y += .02; this._chaza.rotation.set(0, yaw, 0); this._chaza.visible = true;
    this._dulce.position.copy(this._palma[0]); this._dulce.rotation.set(0, yaw + .6, 0); this._dulce.visible = true;
    if (escena.tiempo !== undefined) this._dulce.position.y += .01 * Math.sin(escena.tiempo * 10);
  }

  // ---------- la mano del conductor ----------

  /** Ventana del conductor de un carro, en el mundo, y hacia dónde sale la mano. */
  _ventana(car, out, haciaFuera) {
    const v = car.vehicle, carroceria = v?.bodyVisual;
    let body = null;
    try { body = v?.model ? getCarBody(v.model) : null; } catch { body = null; }
    const lado = puertaDe(car).lado; // el lado del puesto, no el de la puerta por la que se aborda
    if (body && carroceria) {
      const x = v.driverAnchor?.x ?? 0;
      const y = body.belt(x) + .17; // a media ventana, no sobre la puerta
      out.set(x + .2, y, lado * (body.sideZ(x, y) + .03));
      carroceria.updateWorldMatrix(true, false);
      out.applyMatrix4(carroceria.matrixWorld);
    } else if (car.position) {
      const h = rumbo(car), w = (car.width ?? 1.8) / 2;
      out.set(car.position.x - h.z * lado * w, (car.position.y ?? 0) + 1.0, car.position.z + h.x * lado * w);
    }
    const h = rumbo(car);
    haciaFuera.set(-h.z * lado, 0, h.x * lado);
    return out;
  }

  _cobro(escena) {
    const player = this.game.player;
    if (escena.trabajo === 'dulces') this._dulces(escena);
    if (escena.trabajo === 'malabares' && this._finT !== null && this._bolas.length) {
      if (escena.tiempo < GUARDAR_S) this._malabares(escena, false, this._finT + escena.tiempo, this._finRitmo, Math.floor(this._finT / BEAT + 1e-9));
      else for (const bola of this._bolas) bola.mesh.visible = false;
    }
    // Las reacciones que se ven se escogen una vez por cobro: nada de listas nuevas por cuadro.
    if (this._visiblesDe !== escena) {
      this._visiblesDe = escena;
      this._visibles.length = 0;
      for (const r of escena.reacciones) if (VISIBLES.has(r.tipo) && r.car?.position && this._visibles.length < MAX_MANOS) this._visibles.push(r);
    }
    const visibles = this._visibles;
    while (this._manosConductor.length < visibles.length) {
      const i = this._manosConductor.length;
      this._manosConductor.push({
        mano: this._malla(this._geo.mano, this._mat.piel, `Mano del conductor ${i + 1}`),
        brazo: this._malla(this._geo.brazo, this._mat.piel, `Antebrazo del conductor ${i + 1}`),
        manga: this._malla(this._geo.manga, this._mat.manga, `Manga del conductor ${i + 1}`),
        codo: new THREE.Vector3(),
        moneda: this._malla(this._geo.moneda, this._mat.moneda, `Moneda ${i + 1}`),
        billete: this._malla(this._geo.billete, this._mat.billete, `Billete ${i + 1}`),
        ventana: new THREE.Vector3(), fuera: new THREE.Vector3()
      });
    }
    const quieto = this.game.traffic?.vehicles ?? [];
    for (let i = 0; i < visibles.length; i++) {
      const r = visibles[i], slot = this._manosConductor[i];
      const s = escena.tiempo - saleLaMano(r.t0), total = MANO_SALE_S + MANO_QUEDA_S + MANO_ENTRA_S;
      slot.mano.visible = slot.moneda.visible = slot.billete.visible = slot.brazo.visible = slot.manga.visible = false;
      const enCirculacion = !r.vehicle || quieto.includes(r.vehicle);
      if (!enCirculacion) continue;
      // El vidrio baja antes de que salga la mano y sube cuando ya entró.
      if (s > -VENTANA_BAJA_S) this._ventanaA(r.car, s < 0 ? suave(1 + s / VENTANA_BAJA_S) : s <= total ? 1 : 1 - suave((s - total) / VENTANA_SUBE_S));
      if (s < 0 || s > total) continue;
      const ventana = this._ventana(r.car, slot.ventana, slot.fuera);
      const sale = s < MANO_SALE_S ? suave(s / MANO_SALE_S) : s > MANO_SALE_S + MANO_QUEDA_S ? 1 - suave((s - MANO_SALE_S - MANO_QUEDA_S) / MANO_ENTRA_S) : 1;
      const mano = slot.mano;
      mano.position.copy(ventana).addScaledVector(slot.fuera, .05 + .25 * sale);
      mano.position.y += .03 * sale;
      // La excusa se mueve de lado a lado, el insulto sacude el puño.
      const h = rumbo(r.car);
      if (r.tipo === 'excusa') mano.position.addScaledVector(this._v.set(h.x, 0, h.z), .06 * Math.sin(s * Math.PI * 6) * sale);
      if (r.tipo === 'insulto' || r.tipo === 'bravo' || r.tipo === 'furia') mano.position.y += .07 * Math.abs(Math.sin(s * Math.PI * 5)) * sale;
      // El antebrazo sale de la cabina: el codo queda adentro, apoyado en la puerta, y la mano sigue su línea.
      const codo = slot.codo.copy(ventana).addScaledVector(slot.fuera, -.3);
      codo.y -= .07;
      const dir = this._v.copy(mano.position).sub(codo), largo = dir.length();
      dir.multiplyScalar(1 / Math.max(largo, 1e-6));
      mano.quaternion.setFromUnitVectors(this._arriba, dir);
      mano.position.addScaledVector(dir, .05);
      this._tramo(slot.brazo, codo, mano.quaternion, largo);
      this._tramo(slot.manga, codo, mano.quaternion, largo * .45);
      mano.visible = true;
      if (r.tipo !== 'paga' && r.tipo !== 'propina' && r.tipo !== 'comida' && r.tipo !== 'compra') continue;
      // La plata (o el pan) pasa de la mano del conductor a la del jugador.
      const ficha = r.tipo === 'propina' && r.pesos >= 5000 ? slot.billete : slot.moneda;
      const entrega = MANO_SALE_S + .45;
      if (s > entrega + VUELO_MONEDA_S) continue;
      const k = s < entrega ? 0 : suave((s - entrega) / VUELO_MONEDA_S);
      ficha.position.copy(mano.position).addScaledVector(slot.fuera, .1).lerp(this._palma[0], k);
      ficha.position.y += Math.sin(Math.PI * k) * .35;
      ficha.rotation.set(0, (player?.root?.rotation?.y ?? 0) + s * 4, 0);
      ficha.visible = true;
    }
    for (let i = visibles.length; i < this._manosConductor.length; i++) {
      const slot = this._manosConductor[i];
      slot.mano.visible = slot.moneda.visible = slot.billete.visible = slot.brazo.visible = slot.manga.visible = false;
    }
  }

  /** Un cilindro que nace en `desde` y crece `largo` en la dirección de `giro`. */
  _tramo(malla, desde, giro, largo) {
    malla.position.copy(desde);
    malla.quaternion.copy(giro);
    malla.scale.set(1, Math.max(.02, largo), 1);
    malla.visible = true;
  }

  dispose() {
    for (const car of this._ventanas.keys()) car.setDriverWindow?.(0);
    this._ventanas.clear();
    if (!this._mat) return;
    this.group?.removeFromParent();
    this._precarga?.removeFromParent();
    for (const geo of Object.values(this._geo)) geo.dispose();
    this._espuma?.mesh.geometry.dispose();
    this._geoPrecarga?.dispose();
    for (const m of Object.values(this._mat)) (Array.isArray(m) ? m : [m]).forEach(x => x.dispose());
    this.group = null; this._mat = this._geo = this._precarga = this._geoPrecarga = null;
    this._bolas = []; this._manosConductor = []; this._espuma = null; this._hoja = this._palo = this._chaza = this._dulce = null;
    this.mallas = 0;
  }
}
