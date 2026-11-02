// src/world/bogota/ZoneGeometry.js
// Constructor de lotes para los barrios del oriente: acumula cajas y cuadriláteros por material y
// crea una sola malla por pared, sin un objeto Three por barrote, alero o baranda.
import * as THREE from 'three';
import { footHaze } from './CityBackdrop.js';
import { patchSunFieldShader } from './SunFieldShader.js';
import { colonialWallSheet, redBrick, clayTiles, detailSheet, muralSheet, towerFacade,
  detailRect, WALL_SHEET, RED_BRICK_METERS } from './ZoneTextures.js';

const FACE_BASIS = Object.freeze({ 0: [0, -1, 1, 0], 1: [0, 1, -1, 0], 4: [1, 0, 0, 1], 5: [-1, 0, 0, -1] });
const FULL_UV = Object.freeze([0, 0, 1, 1]);
export const FACES = Object.freeze({ front: 1, back: 2, left: 4, right: 8, top: 16, bottom: 32 });
export const ALL_FACES = 63;
export const NO_BACK = ALL_FACES & ~FACES.back;
export const SKIN = FACES.front | FACES.left | FACES.right; // Barrotes y postes vistos desde la calle.

const rectOf = rect => typeof rect === 'string' ? detailRect(rect) : rect ?? FULL_UV;

export class Batch {
  constructor() { this.groups = new Map(); }

  _bucket(material) {
    if (!this.groups.has(material)) this.groups.set(material, { position: [], normal: [], uv: [], index: [] });
    return this.groups.get(material);
  }

  /** Cuadrilátero con UV explícitos en el orden a, b, c, d; la normal sale del orden de los vértices. */
  quadUV(material, a, b, c, d, uvs) {
    const out = this._bucket(material), base = out.position.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    for (const p of [a, b, c, d]) {
      out.position.push(p[0], p[1], p[2]);
      out.normal.push(nx, ny, nz);
    }
    out.uv.push(...uvs);
    out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  quad(material, a, b, c, d, rect) {
    const [u0, v0, u1, v1] = rectOf(rect);
    this.quadUV(material, a, b, c, d, [u0, v0, u1, v0, u1, v1, u0, v1]);
  }

  tri(material, a, b, c, uvs) {
    const out = this._bucket(material), base = out.position.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    for (const p of [a, b, c]) {
      out.position.push(p[0], p[1], p[2]);
      out.normal.push(nx, ny, nz);
    }
    out.uv.push(...uvs);
    out.index.push(base, base + 1, base + 2);
  }

  /** Marco de una pared: u a lo largo de la fachada, y hacia arriba, n hacia la calle. */
  frame(face, plane = 0) {
    const [ux, uz, nx, nz] = FACE_BASIS[face];
    const P = (u, y, n) => [ux * u + nx * (n + plane), y, uz * u + nz * (n + plane)];
    const batch = this;
    return {
      P,
      box(material, u, y, n, w, h, d, rect, faces = ALL_FACES) {
        const l = u - w / 2, r = u + w / 2, t = y + h, b = y, f = n + d / 2, k = n - d / 2;
        if (faces & FACES.front) batch.quad(material, P(l, b, f), P(r, b, f), P(r, t, f), P(l, t, f), rect);
        if (faces & FACES.back) batch.quad(material, P(r, b, k), P(l, b, k), P(l, t, k), P(r, t, k), rect);
        if (faces & FACES.right) batch.quad(material, P(r, b, f), P(r, b, k), P(r, t, k), P(r, t, f), rect);
        if (faces & FACES.left) batch.quad(material, P(l, b, k), P(l, b, f), P(l, t, f), P(l, t, k), rect);
        if (faces & FACES.top) batch.quad(material, P(l, t, f), P(r, t, f), P(r, t, k), P(l, t, k), rect);
        if (faces & FACES.bottom) batch.quad(material, P(l, b, k), P(r, b, k), P(r, b, f), P(l, b, f), rect);
      },
      panel(material, u, y, n, w, h, rect) {
        const l = u - w / 2, r = u + w / 2;
        batch.quad(material, P(l, y, n), P(r, y, n), P(r, y + h, n), P(l, y + h, n), rect);
      },
      /** Cuadrilátero libre en coordenadas de la pared. */
      quad(material, a, b, c, d, rect) { batch.quad(material, P(...a), P(...b), P(...c), P(...d), rect); },
      quadUV(material, a, b, c, d, uvs) { batch.quadUV(material, P(...a), P(...b), P(...c), P(...d), uvs); },
      tri(material, a, b, c, uvs) { batch.tri(material, P(...a), P(...b), P(...c), uvs); }
    };
  }

  /** Crea una malla por material dentro de parent. */
  finish(parent, { castShadow = true, receiveShadow = true, name = 'Detalle de barrio' } = {}) {
    let triangles = 0;
    for (const [material, data] of this.groups) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
      geometry.setIndex(data.index);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      parent.add(mesh);
      triangles += data.index.length / 3;
    }
    this.groups.clear();
    return triangles;
  }
}

/** Caja con UV por cara para createBuildingShell: fija franja de muro o escala en metros. */
export function shellBox(width, height, depth, uvOf) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  const dims = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]];
  for (let face = 0; face < 6; face++) {
    const [u0, v0, u1, v1] = uvOf(face, dims[face][0], dims[face][1]);
    for (let i = face * 4; i < face * 4 + 4; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  }
  return geometry;
}

/** Rango UV de una franja del muro colonial: un muro de h metros, empezando en u. */
export function wallStripUV(strip, u, width, height, floor = 0) {
  const n = WALL_SHEET.strips, v0 = (strip + floor / WALL_SHEET.stripMeters) / n;
  return [u, v0, u + width / WALL_SHEET.uMeters, v0 + height / WALL_SHEET.stripMeters / n];
}
export const brickUV = (u, width, height) => [u, 0, u + width / RED_BRICK_METERS, height / RED_BRICK_METERS];

/** Materiales compartidos de los barrios del oriente: unos pocos por distrito, nunca uno por casa. */
/**
 * Las torres se ven desde todo el barrio. Con la niebla normal, lejos serían una silueta pálida
 * sobre el cielo oscuro; aquí la bruma tiene tope y la cámara no las recorta en su límite.
 * Es una clase porque la vista cerrada clona los materiales y un clon pierde los ganchos sueltos.
 */
class HazyTowerMaterial extends THREE.MeshStandardMaterial {
  constructor(parameters) {
    super(parameters);
    this.userData.pastFar = true;
  }

  onBeforeCompile(shader) {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      { float zn = gl_Position.z / gl_Position.w;
        float zc = zn > 0.9998 ? 0.9998 + (zn - 0.9998) * 0.14 : zn;
        gl_Position.z = zc * gl_Position.w; }`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
      #ifdef USE_FOG
        gl_FragColor.rgb = skyFogMix(gl_FragColor.rgb, ${footHaze('min(smoothstep(fogNear, fogFar, vFogDepth), .55)')});
      #endif`);
    // El gancho de la clase tapa el del prototipo: sin esto la torre no recibe sombra en calidad baja.
    patchSunFieldShader(shader);
  }
  customProgramCacheKey() { return 'torres-con-bruma'; }
}

export function createZoneMaterials() {
  const wallMaps = colonialWallSheet(), brickMaps = redBrick(), clayMaps = clayTiles(), detailMaps = detailSheet();
  const towerMaps = towerFacade(), mural = muralSheet();
  const material = parameters => new THREE.MeshStandardMaterial(parameters);
  const detail = material({ map: detailMaps.map, emissiveMap: detailMaps.emissiveMap, emissive: '#ffffff',
    emissiveIntensity: 0, roughness: .78 });
  detail.name = 'Detalles de barrio';
  const tower = new HazyTowerMaterial({ map: towerMaps.map, emissiveMap: towerMaps.emissiveMap, emissive: '#ffffff',
    emissiveIntensity: 0, roughness: .92 });
  return {
    wall: material({ map: wallMaps.map, bumpMap: wallMaps.bumpMap, bumpScale: .03, roughness: .96 }),
    brick: material({ map: brickMaps.map, bumpMap: brickMaps.bumpMap, bumpScale: .035, roughnessMap: brickMaps.roughnessMap, roughness: .96 }),
    clay: material({ map: clayMaps.map, bumpMap: clayMaps.bumpMap, bumpScale: .05, roughness: .9, color: '#f4e8dc' }),
    clayDark: material({ map: clayMaps.map, bumpMap: clayMaps.bumpMap, bumpScale: .05, roughness: .9, color: '#8d7a70' }),
    mural: material({ map: mural.map, alphaTest: .4, roughness: .95 }),
    detail, tower,
    interior: material({ color: '#675e50', roughness: 1 })
  };
}
