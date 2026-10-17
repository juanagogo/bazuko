// src/world/tiles/TileFactory.js
import * as THREE from 'three';
import { TILE_SIZE } from '../../utils/constants.js';
import { ProceduralTextures } from '../../utils/textures.js';
import { getWorldTexture } from '../../utils/TextureCache.js';

const _geoCache = {};
const _matCache = {};

function geo(key, factory) {
  if (!_geoCache[key]) _geoCache[key] = factory();
  return _geoCache[key];
}

function mat(key, factory) {
  if (!_matCache[key]) _matCache[key] = factory();
  return _matCache[key];
}

function texFor(name) {
  switch (name) {
    case 'asphalt':   return ProceduralTextures.asphalt();
    case 'concrete':  return ProceduralTextures.concrete();
    case 'brick':     return ProceduralTextures.brick();
    case 'road':      return ProceduralTextures.road();
    case 'roadV':     return ProceduralTextures.roadV();
    case 'sidewalk':  return ProceduralTextures.sidewalk();
    case 'windowLit': return ProceduralTextures.windowLit();
    case 'dirt':      return ProceduralTextures.dirt();
    default:          return ProceduralTextures.white();
  }
}

/**
 * Textura de suelo cargada (pasto/calle/anden) con su repeat por baldosa (TILE_SIZE = 2 u), o null si
 * no cargó (se usa la procedural). Los tiles son InstancedMesh: el repeat va en la textura compartida
 * y debe ser entero para que las baldosas vecinas empalmen (las texturas son tileables).
 */
function groundTex(name, repeat, variant) {
  const base = getWorldTexture(name);
  if (!base) return null;
  if (!variant) { base.repeat.set(repeat, repeat); return base; }
  return variant(base);
}

/** Hay textura de calle: ZonaCero orienta cada tile de calle (media calzada con raya en un borde). */
export function hasRoadTexture() {
  return !!getWorldTexture('calle');
}

const _winLit = new THREE.Color(0x2a2a20);

export const TileFactory = {
  /** Ventanas de edificios encendidas gradualmente (level 0..1) */
  setNightLevel(level) {
    const m = _matCache['buildingLit'];
    if (m) m.emissive.setRGB(0, 0, 0).lerp(_winLit, level);
  },

  create(type) {
    switch (type) {
      case 'floor':
      case 'sidewalk':  return this._sidewalk();
      case 'roadX':     return this._road('roadX'); // intersección sin raya (solo con textura de calle)
      case 'tm':        return this._road('tm');    // carril exclusivo TransMilenio (asfalto rojizo con raya)
      case 'tmX':       return this._road('tmX');   // ídem sin raya (cruces de calle)
      case 'grass':     return this._grass();       // parche de pasto de la zona verde central
      case 'road':      return this._road('road');
      case 'roadV':     return this._road('roadV');
      case 'dirt':      return this._dirt();
      case 'building':  return this._building();
      case 'buildingBrick': return this._buildingBrick();
      case 'buildingLit':   return this._buildingLit();
      case 'barrel':    return this._barrel();
      case 'trash':     return this._trash();
      default:          return this._sidewalk();
    }
  },

  _sidewalk() {
    const g = geo('sidewalk', () => new THREE.BoxGeometry(TILE_SIZE, 0.2, TILE_SIZE));
    const m = mat('sidewalk', () => new THREE.MeshLambertMaterial({
      map: groundTex('anden', 2) || texFor('sidewalk'), // 2x2 baldosas de 1 u por tile
      color: getWorldTexture('anden') ? 0xdddddd : 0x9a9a9a,
      flatShading: true
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    return mesh;
  },

  _road(textureName) {
    const key = `road-${textureName}`;
    const g = geo(key, () => new THREE.BoxGeometry(TILE_SIZE, 0.1, TILE_SIZE));
    const isTM = textureName === 'tm' || textureName === 'tmX';
    const flat = textureName === 'roadX' || textureName === 'tmX';
    const m = mat(key, () => {
      const roadTex = flat
        ? groundTex('calle', 0.8, (b) => { // asfalto liso: solo u 0.1..0.9, sin la media raya del borde
            const t = b.clone(); t.needsUpdate = true; t.repeat.set(0.8, 1); t.offset.set(0.1, 0); return t;
          })
        : groundTex('calle', 1);
      const mm = new THREE.MeshLambertMaterial({
        map: roadTex || texFor(isTM || textureName === 'roadX' ? 'road' : textureName),
        color: roadTex ? 0xdddddd : 0x9a9a9a,
        flatShading: true
      });
      // Carril exclusivo TM: mismo asfalto con tinte rojizo (multiplica el gris de la textura)
      if (isTM) mm.color.setRGB(2.1, 0.85, 0.75, THREE.LinearSRGBColorSpace);
      return mm;
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    return mesh;
  },

  // Pasto de la zona verde central: parche fino sobre un tile de andén (el borde de andén queda como bordillo).
  // La geometría ya trae su altura (los InstancedMesh de ZonaCero no usan mesh.position).
  _grass() {
    const g = geo('grass', () => {
      const b = new THREE.BoxGeometry(TILE_SIZE, 0.06, TILE_SIZE * 0.78);
      b.translate(0, 0.1, 0); // apoyado sobre el andén (cara superior en y = 0.1)
      return b;
    });
    const m = mat('grass', () => new THREE.MeshLambertMaterial({
      map: groundTex('pasto', 1) || texFor('dirt'),
      color: getWorldTexture('pasto') ? 0xdddddd : 0x9a9a9a,
      flatShading: true
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    return mesh;
  },

  _dirt() {
    const g = geo('dirt', () => new THREE.BoxGeometry(TILE_SIZE, 0.15, TILE_SIZE));
    const m = mat('dirt', () => new THREE.MeshLambertMaterial({
      map: groundTex('pasto', 1) || texFor('dirt'), // un pasto por tile
      color: getWorldTexture('pasto') ? 0xdddddd : 0x9a9a9a,
      flatShading: true
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.receiveShadow = true;
    return mesh;
  },

  _building() {
    const g = geo('building', () => new THREE.BoxGeometry(TILE_SIZE, 8, TILE_SIZE));
    const m = mat('building', () => new THREE.MeshLambertMaterial({
      map: texFor('concrete'),
      color: 0x9a9a9a,
      flatShading: true
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 4;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },

  _buildingBrick() {
    const g = geo('buildingBrick', () => new THREE.BoxGeometry(TILE_SIZE, 6, TILE_SIZE));
    const m = mat('buildingBrick', () => new THREE.MeshLambertMaterial({
      map: texFor('brick'),
      color: 0xaaaaaa,
      flatShading: true
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 3;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },

  _buildingLit() {
    const g = geo('buildingLit', () => new THREE.BoxGeometry(TILE_SIZE, 10, TILE_SIZE));
    const m = mat('buildingLit', () => new THREE.MeshLambertMaterial({
      map: texFor('windowLit'),
      color: 0xaaaaaa,
      emissive: 0x000000, // apagado de día; TileFactory.setNightLevel lo enciende
      flatShading: true
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 5;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },

  _barrel() {
    const g = geo('barrel', () => new THREE.CylinderGeometry(0.5, 0.5, 1.2, 8));
    const m = mat('barrel', () => new THREE.MeshLambertMaterial({
      color: 0x5a3a1a,
      flatShading: true
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 0.6;
    mesh.castShadow = true;
    return mesh;
  },

  _trash() {
    const g = geo('trash', () => new THREE.BoxGeometry(1.2, 0.6, 1.2));
    const m = mat('trash', () => new THREE.MeshLambertMaterial({
      color: 0x4a4a2a,
      flatShading: true
    }));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = 0.4;
    mesh.castShadow = true;
    return mesh;
  },

  dispose() {
    for (const g of Object.values(_geoCache)) g.dispose?.();
    for (const m of Object.values(_matCache)) m.dispose?.();
  }
};