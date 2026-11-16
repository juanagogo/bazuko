// src/entities/Cambuche.js
// Refugio que se arma por piezas (base, techo, paredes, colchón, fogón, vela).
// Cada pieza es una maqueta de caras planas unida en una sola malla (`cambuche/piezas.js`); alrededor crece el
// patio y, con la estructura completa, el modelo importado recibe encima las capas del techo (`cambuche/patio.js`).
import * as THREE from 'three';
import { CHARACTER_SCALE } from '../utils/constants.js';
import { createImportedModel, disposeImportedInstance } from '../utils/ImportedModels.js';
import { createFlame, fireGlow, stepFlames } from '../world/bogota/flame.js';
import { Maqueta, PALETA, materialDeMaqueta } from './cambuche/maqueta.js';
import * as piezas from './cambuche/piezas.js';
import { PATIO, TABLA, alturasDelModelo, cubierta, reciclaje, rendijas, resplandor, rincon, tendedero } from './cambuche/patio.js';
import { crearTinta, rotulos } from './cambuche/letreros.js';

/** Las piezas que trae el modelo completo: con las cuatro armadas, el modelo las reemplaza. */
export const STRUCTURE = ['base', 'techo', 'paredes', 'cama'];
const PIEZAS = [...STRUCTURE, 'fogon', 'vela'];
const LLAMA = .44;

export class Cambuche {
  constructor(scene, position) {
    this.scene = scene;
    this.kind = 'cambuche';
    this.t = 0;

    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.rotation.y = Math.PI * 0.08;
    scene.add(this.group);

    const root = new THREE.Group();
    root.scale.setScalar(CHARACTER_SCALE);
    this.group.add(root);

    // Los materiales de todo lo armado a mano: el de las maquetas (de dos caras y liso donde hay tela, plástico o
    // lata), el de las brasas y el de la luz de noche.
    this._material = materialDeMaqueta();
    this._tela = materialDeMaqueta(THREE.DoubleSide, true);
    this._brasas = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this._luz = new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, toneMapped: false, fog: false, side: THREE.DoubleSide });
    this._luz.color.setScalar(0);
    this._tinta = crearTinta();
    const malla = (maqueta, sombra = true, tela = false) => {
      const mesh = new THREE.Mesh(maqueta.geometria(), tela ? this._tela : this._material);
      mesh.castShadow = sombra;
      mesh.receiveShadow = true;
      return mesh;
    };
    const deNoche = maqueta => {
      const mesh = new THREE.Mesh(maqueta.geometria(), this._luz);
      mesh.visible = false;
      mesh.renderOrder = 3;
      mesh.userData.soloDeNoche = true;
      return mesh;
    };
    const pintado = lista => {
      const mesh = new THREE.Mesh(rotulos(lista), this._tinta.material);
      mesh.receiveShadow = true;
      return mesh;
    };
    this._malla = malla; this._pintado = pintado;
    const pieces = {};

    // Cartones sueltos que marcan el sitio antes de armar
    const sueltos = new Maqueta(7);
    for (let i = 0; i < 4; i++) {
      sueltos.caja(0.6 + sueltos.r() * 0.4, 0.03, 0.5, i % 2 ? PALETA.cartonViejo : PALETA.carton,
        { en: [(sueltos.r() - 0.5) * 1.4, 0.02 + i * 0.012, (sueltos.r() - 0.5) * 1], giro: [0, sueltos.r() * 3, 0] });
    }
    const marker = malla(sueltos, false);
    root.add(marker);

    // Base de cartón aplanado
    pieces.base = malla(piezas.base(), false);

    // Techo en capas, alto atrás y bajo adelante: plástico negro, lona azul remendada, piedras, una llanta y cuerdas
    pieces.techo = malla(piezas.techo(), true, true);

    // Paredes de tablas y cartón, con la cobija de cortina; de noche la luz se cuela por las rendijas
    const paredes = new THREE.Group();
    this.rendijas = deNoche(rendijas());
    paredes.add(malla(piezas.paredes(), true, true), pintado([
      { tinta: 'panela', ancho: .56, alto: .56, en: [-1.18, .58, .806] },
      { tinta: 'galletas', ancho: .38, alto: .38, en: [-1.626, .5, -.2], giro: [0, -Math.PI / 2, 0] },
      { tinta: 'galletas', ancho: .6, alto: .6, en: [-.66, .58, -1.176] },
      { tinta: 'panela', ancho: .56, alto: .56, en: [.65, .6, -1.206], giro: [0, Math.PI, 0] },
    ]), this.rendijas);
    pieces.paredes = paredes;

    // Colchón sobre una estiba, con almohada y cobija
    pieces.cama = malla(piezas.cama());

    // Fogón de tres piedras con la olla tiznada, las latas y el fuego
    const fogon = new THREE.Group();
    fogon.add(malla(piezas.fogon(), false), new THREE.Mesh(piezas.brasas().geometria(), this._brasas));
    this.fire = createFlame(0.34, LLAMA);
    this.fire.position.y = 0.03;
    fogon.add(this.fire);
    this.fireLight = new THREE.PointLight(0xff8a2a, 2.5, 5);
    this.fireLight.position.y = 0.4;
    this.fireGlow = fireGlow();
    fogon.add(this.fireLight);
    fogon.position.set(1.0, 0, 1.3);
    pieces.fogon = fogon;

    // Vela y estampa en su cajón, con una matica al lado: adentro, a la vista desde la entrada
    const vela = new THREE.Group();
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc46b').multiplyScalar(5) }));
    this.flame.position.set(...piezas.LLAMA_VELA);
    vela.add(malla(piezas.vela(), false), this.flame);
    vela.position.set(0.6, 0, 0.3);
    vela.rotation.y = -0.12;
    pieces.vela = vela;

    Object.values(pieces).forEach((p) => {
      p.visible = false;
      root.add(p);
    });

    // Anillo que marca el sitio
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(1.9, 2.1, 32),
      new THREE.MeshBasicMaterial({ color: 0xf6c400, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.03;
    this.group.add(this.marker);

    // El patio se va poblando a medida que se arma; lo de encima del modelo llega con él.
    this.patio = { rincon: malla(rincon()), tendedero: malla(tendedero(), true, true), reciclaje: malla(reciclaje()) };
    this.resplandor = deNoche(resplandor());
    this.encima = new THREE.Group();
    this.encima.visible = false;
    for (const part of Object.values(this.patio)) part.visible = false;
    this.group.add(...Object.values(this.patio), this.resplandor, this.encima);

    this.pieces = pieces;
    this.markerPile = marker;
    this.built = {};
    this._noche = null;
    this._esNoche = false;
    this._conLuz = false;
  }

  get position() { return this.group.position; }

  preloadModel() {
    return this._modelPromise ??= createImportedModel('cambuche').then(model => {
      if (this._disposed) { disposeImportedInstance(model); return; }
      this.model = model;
      // Ligera separación del suelo para evitar planos superpuestos.
      model.position.y = 0.025;
      this.group.add(model);
      // Las capas del techo se apoyan en las alturas del propio modelo.
      this.encima.add(this._malla(cubierta(alturasDelModelo(model, this.group)), true, true), this._pintado([
        { tinta: 'nombre', ancho: TABLA.ancho * .92, alto: TABLA.alto * .9, en: [TABLA.en[0], TABLA.en[1], TABLA.en[2] + .014], giro: [0, 0, TABLA.caida] },
      ]));
      this.setBuilt(this.built);
    });
  }

  /**
   * Qué se ve con esas piezas armadas, como pares [objeto, visible]. Lo usan el cambuche y su vista previa,
   * así las dos muestran lo mismo.
   */
  visibles(built, withModel = !!this.model) {
    // El modelo completo trae techo, paredes y colchón: sale solo cuando las cuatro piezas de la estructura están
    // armadas. Antes se ve cada pieza por separado, así que cada una que se arma cambia lo que se ve.
    const assembled = withModel && STRUCTURE.every((id) => built[id]);
    const count = PIEZAS.filter((id) => built[id]).length;
    const list = Object.entries(this.pieces).map(([id, obj]) => [obj, !!built[id] && !(assembled && STRUCTURE.includes(id))]);
    list.push([this.markerPile, !built.base], [this.encima, assembled]);
    for (const [id, obj] of Object.entries(this.patio)) list.push([obj, count >= PATIO[id]]);
    if (this.model) list.push([this.model, assembled]);
    return list;
  }

  /** Muestra las piezas construidas: { base: true, techo: true, ... } */
  setBuilt(built) {
    this.built = { ...built };
    for (const [obj, visible] of this.visibles(this.built)) obj.visible = visible;
    // La luz de adentro es la de la vela, y solo se nota si hay paredes que la encierren.
    const assembled = !!this.model && STRUCTURE.every((id) => built[id]);
    this._conLuz = !!built.vela && (assembled || !!built.paredes);
  }

  update(dt) {
    this.t += dt;
    const t = this.t;
    stepFlames(t);
    this.fire.scale.y = LLAMA * (1 + Math.sin(t * 1.9) * 0.05);
    this.fireLight.intensity = (2.85 + Math.sin(t * 2.4) * 0.2) * this.fireGlow.step(dt);
    this.flame.scale.setScalar(0.9 + Math.sin(t * 2.7) * 0.1);
    this.marker.material.opacity = 0.35 + Math.sin(t * 2) * 0.15;
    this._brasas.color.setScalar(1.7 + Math.sin(t * 1.3) * 0.4);
    // De noche sale luz cálida por la entrada y las rendijas; sube y baja de a poco, como el fuego.
    this._noche ??= this._esNoche ? 1 : 0;
    this._noche += ((this._esNoche ? 1 : 0) - this._noche) * Math.min(1, dt * 0.8);
    const luz = this._conLuz ? this._noche * (1 + Math.sin(t * 1.1) * 0.06) : 0;
    this._luz.color.setScalar(luz);
    this.resplandor.visible = this.rendijas.visible = luz > 0.02;
  }

  setNight(isNight) {
    this.fireGlow.setNight(isNight);
    this._esNoche = !!isNight;
  }

  dispose() {
    this._disposed = true;
    if (this.model) disposeImportedInstance(this.model);
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this._tinta.texture.dispose();
  }
}
