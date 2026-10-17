// src/entities/Tienda.js
// Edificio-tienda: sustituye al antiguo SellPoint con el mismo contrato duck-typed
// (position, sell(inventory, mult), dispose). La interacción se mide desde la ENTRADA.
import * as THREE from 'three';
import { ProceduralTextures } from '../utils/textures.js';

// Volumen del edificio (como las casas del mapa: 8x4, alto 6)
const W = 8;
const D = 4;
const H = 6;
// Fachada: textura 1024x655 -> plano con la misma proporción, pegado al frente
const FACADE_W = W;
const FACADE_H = W * (655 / 1024);
// Distancia del frente del edificio al punto de interacción (centro de la entrada, sobre el andén)
const FRONT_GAP = 1.0;

export class Tienda {
  /** @param {THREE.Vector3} entrance punto de interacción frente a la entrada (suelo); el edificio queda detrás (-Z) */
  constructor(scene, entrance) {
    this.scene = scene;
    this.entrance = entrance.clone();

    // Centro del edificio: el frente (+Z) queda FRONT_GAP antes de la entrada
    this.center = new THREE.Vector3(entrance.x, 0, entrance.z - FRONT_GAP - D / 2);
    this.size = new THREE.Vector3(W, H, D);

    this.group = new THREE.Group();
    this.group.position.copy(this.center);
    scene.add(this.group);

    // ===== Materiales (propios de la instancia, compartidos entre sus meshes) =====
    this._wallMat = new THREE.MeshLambertMaterial({
      map: ProceduralTextures.concrete(),
      color: 0x5f6f62, // verde grisáceo, acorde a la pared lateral de la ilustración
      flatShading: true
    });
    this._facadeMat = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      emissive: 0xffffff // se escala con setNightLevel (cartel/vitrina "encendidos" de noche)
    });
    this._facadeMat.emissive.setScalar(0.1);

    // ===== Cuerpo + cornisa (2 meshes) =====
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), this._wallMat);
    body.position.y = H / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);

    const cornice = new THREE.Mesh(new THREE.BoxGeometry(W + 0.3, 0.3, D + 0.3), this._wallMat);
    cornice.position.y = H + 0.15;
    cornice.castShadow = true;
    cornice.receiveShadow = true;
    this.group.add(cornice);

    // ===== Fachada con la textura (plano frontal) =====
    const facade = new THREE.Mesh(new THREE.PlaneGeometry(FACADE_W, FACADE_H), this._facadeMat);
    facade.position.set(0, FACADE_H / 2 + 0.02, D / 2 + 0.02);
    facade.receiveShadow = true;
    this.group.add(facade);

    // ===== Umbral / felpudo marcando la entrada (sobre el andén) =====
    this._matMat = new THREE.MeshLambertMaterial({ color: 0x7a2a22, flatShading: true });
    const mat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 0.8), this._matMat);
    mat.position.set(0, 0.12, D / 2 + 0.4);
    mat.receiveShadow = true;
    this.group.add(mat);
    this.xrayParts = [facade, mat]; // lo que se resalta tras obstaculos (core/XRay.js)

    this._loadTexture();
  }

  _loadTexture() {
    const url = `${import.meta.env.BASE_URL}textures/tienda.jpg`;
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (this._disposed) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4; // se limita al máximo de la GPU
        this._tex = tex;
        this._facadeMat.map = tex;
        this._facadeMat.emissiveMap = tex; // el brillo nocturno conserva los colores de la imagen
        this._facadeMat.needsUpdate = true;
      },
      undefined,
      (err) => console.warn(`[Tienda] No se pudo cargar ${url}`, err)
    );
  }

  /** Punto de interacción (frente a la entrada): InteractionSystem mide la distancia a él */
  get position() { return this.entrance; }

  /** Registra el volumen del edificio como sólido (la zona frente a la entrada queda libre) */
  addCollision(collisions) {
    collisions.add({ position: this.center }, this.size);
  }

  /** Brillo gradual de noche (0..1) con un único material emisivo */
  setNightLevel(level) {
    this._facadeMat.emissive.setScalar(0.1 + 0.55 * level);
  }

  sell(inventory, mult = 1) {
    return inventory.sellAll(mult);
  }

  dispose() {
    this._disposed = true;
    this.scene.remove(this.group);
    this.group.traverse((o) => o.geometry?.dispose?.());
    this._wallMat.dispose();
    this._facadeMat.dispose();
    this._matMat.dispose();
    this._tex?.dispose();
  }
}
