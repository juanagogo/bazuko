import * as THREE from 'three';
import { NEIGHBORHOODS } from './NeighborhoodIdentity.js';
import { rng } from './textures.js';
import { detailAtlas } from './textures-calle.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT = Object.fromEntries(['position', 'normal', 'uv'].map(key => [key, Array.from(BOX.attributes[key].array)]));
const INDICES = Array.from(BOX.index.array);
BOX.dispose();
const materialPools = new Map();
const FACE_BASIS = { 0: [0, -1, 1, 0], 1: [0, 1, -1, 0], 4: [1, 0, 0, 1], 5: [-1, 0, 0, -1] };
const hash = value => (Math.imul(value ^ (value >>> 16), 2246822519) >>> 0);

function sharedMaterials(neighborhood) {
  const profile = typeof neighborhood === 'string' ? NEIGHBORHOODS[neighborhood] ?? NEIGHBORHOODS.centro : neighborhood;
  if (!materialPools.has(profile.id)) {
    const p = profile.palette;
    const warmWindow = new THREE.MeshStandardMaterial({ color: '#b8a88d', roughness: .78,
      emissive: '#f4c99b', emissiveIntensity: 0 });
    // BuildingVisibility conserva userData al clonar. El distrito activa este
    // valor únicamente de noche tanto en paredes como en los lotes cerrados.
    warmWindow.userData.windowGlow = .42;
    materialPools.set(profile.id, {
      trim: new THREE.MeshStandardMaterial({ color: p.trim, roughness: .86 }),
      metal: new THREE.MeshStandardMaterial({ color: p.metal, metalness: .25, roughness: .64 }),
      glass: new THREE.MeshStandardMaterial({ color: '#33494b', metalness: .18, roughness: .3 }),
      curtain: new THREE.MeshStandardMaterial({ color: '#a8a59a', roughness: .94 }),
      warmWindow,
      concrete: new THREE.MeshStandardMaterial({ color: p.plinth, roughness: .94 })
    });
  }
  return materialPools.get(profile.id);
}

// Acumula vértices directamente: cientos de piezas producen un mesh por
// material y pared, sin crear objetos Three por ventana, barrote o alféizar.
function batches(parent, face, plane) {
  const [ux, uz, nx, nz] = FACE_BASIS[face], groups = new Map();
  const bucket = material => {
    if (!groups.has(material)) groups.set(material, { position: [], normal: [], uv: [], index: [] });
    return groups.get(material);
  };
  const append = (material, positions, normals, uvs, indices, u, y, v, w = 1, h = 1, d = 1) => {
    const out = bucket(material), offset = out.position.length / 3;
    for (let i = 0; i < positions.length; i += 3) {
      const a = positions[i] * w + u, b = positions[i + 1] * h + y, c = positions[i + 2] * d + v + plane;
      out.position.push(ux * a + nx * c, b, uz * a + nz * c);
      out.normal.push(ux * normals[i] + nx * normals[i + 2], normals[i + 1], uz * normals[i] + nz * normals[i + 2]);
    }
    out.uv.push(...uvs);
    for (const index of indices) out.index.push(offset + index);
  };
  return {
    box: (material, u, y, v, w, h, d) => append(material, UNIT.position, UNIT.normal, UNIT.uv, INDICES, u, y, v, w, h, d),
    panel: (material, u, y, v, w, h) => append(material,
      [-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0], [0,0,1,0,0,1,0,0,1,0,0,1],
      [0,0,1,0,1,1,0,1], [0,1,2,0,2,3], u,y,v,w,h,1),
    cylinder(material, u, y, v, radius, height) {
      const geometry = new THREE.CylinderGeometry(radius, radius, height, 10);
      append(material, geometry.attributes.position.array, geometry.attributes.normal.array, geometry.attributes.uv.array, geometry.index.array, u, y, v);
      geometry.dispose();
    },
    finish(label) {
      let triangles = 0;
      for (const [material, data] of groups) {
        const geometry = new THREE.BufferGeometry();
        for (const key of ['position', 'normal', 'uv']) geometry.setAttribute(key, new THREE.Float32BufferAttribute(data[key], key === 'uv' ? 2 : 3));
        geometry.setIndex(data.index);
        geometry.computeBoundingBox(); geometry.computeBoundingSphere();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = label;
        mesh.castShadow = mesh.receiveShadow = true;
        mesh.userData.buildingDetails = true;
        parent.add(mesh);
        triangles += data.index.length / 3;
      }
      return { meshes: groups.size, triangles };
    }
  };
}

// Vida de la casa: tanques, varillas, ropa, avisos. Va en un material de atlas compartido por toda
// la ciudad; como pertenece a la pared o al techo, la vista isométrica la corta junto con ellos.
let lifeMaterial = null, stainMaterial = null;
function sharedLifeMaterial() {
  const map = detailAtlas().texture;
  // Al cerrar la ciudad se libera el atlas; la siguiente recibe uno nuevo.
  if (lifeMaterial?.map !== map) {
    lifeMaterial = new THREE.MeshStandardMaterial({ map, roughness: .9, metalness: 0, envMapIntensity: .5 });
    lifeMaterial.name = 'Vida de fachadas y azoteas';
  }
  return lifeMaterial;
}
/** La humedad necesita alfa suave; un material aparte evita volver translúcida toda la vida de la casa. */
function sharedStainMaterial() {
  const map = detailAtlas().texture;
  if (stainMaterial?.map !== map) {
    // Una sola pasada: BuildingVisibility la vuelve de dos caras y Three pediría programa en cada dibujo.
    stainMaterial = new THREE.MeshStandardMaterial({ map, roughness: .95, metalness: 0, envMapIntensity: .3,
      transparent: true, depthWrite: false, forceSinglePass: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    stainMaterial.name = 'Humedad de fachadas';
  }
  return stainMaterial;
}

/** Lote con UV de atlas: el color de cada pieza sale de su celda, porque la vista agrupada no guarda colores por vértice. */
function lifeBatch(parent, face, plane, material = sharedLifeMaterial) {
  const [ux, uz, nx, nz] = FACE_BASIS[face];
  const out = { position: [], normal: [], uv: [], index: [] };
  const quad = (points, normal, rect) => {
    const base = out.position.length / 3;
    for (const [a, y, c] of points) {
      out.position.push(ux * a + nx * (c + plane), y, uz * a + nz * (c + plane));
      out.normal.push(ux * normal[0] + nx * normal[2], normal[1], uz * normal[0] + nz * normal[2]);
    }
    out.uv.push(rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]);
    out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  return {
    panel(rect, u, y, v, w, h) {
      quad([[u - w / 2, y - h / 2, v], [u + w / 2, y - h / 2, v], [u + w / 2, y + h / 2, v], [u - w / 2, y + h / 2, v]], [0, 0, 1], rect);
    },
    /** Tela inclinada que sale de la pared, de (v0, y0) a (v1, y1). */
    slope(rect, u, y0, v0, y1, v1, w) {
      const nv = y0 - y1, ny = v1 - v0, length = Math.hypot(nv, ny);
      quad([[u - w / 2, y1, v1], [u + w / 2, y1, v1], [u + w / 2, y0, v0], [u - w / 2, y0, v0]], [0, ny / length, nv / length], rect);
    },
    /** Caja con la base en `y` y sin tapa inferior. */
    box(rect, u, y, v, w, h, d) {
      const a0 = u - w / 2, a1 = u + w / 2, c0 = v - d / 2, c1 = v + d / 2, y1 = y + h;
      quad([[a0, y, c1], [a1, y, c1], [a1, y1, c1], [a0, y1, c1]], [0, 0, 1], rect);
      quad([[a1, y, c0], [a0, y, c0], [a0, y1, c0], [a1, y1, c0]], [0, 0, -1], rect);
      quad([[a1, y, c1], [a1, y, c0], [a1, y1, c0], [a1, y1, c1]], [1, 0, 0], rect);
      quad([[a0, y, c0], [a0, y, c1], [a0, y1, c1], [a0, y1, c0]], [-1, 0, 0], rect);
      quad([[a0, y1, c1], [a1, y1, c1], [a1, y1, c0], [a0, y1, c0]], [0, 1, 0], rect);
    },
    cylinder(rect, u, y, v, r0, r1, h, sides = 8) {
      const slope = (r0 - r1) / Math.max(h, 1e-3), length = Math.hypot(1, slope);
      for (let i = 0; i < sides; i++) {
        const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cm = Math.cos((a + b) / 2), sm = Math.sin((a + b) / 2);
        quad([[u + sa * r0, y, v + ca * r0], [u + sb * r0, y, v + cb * r0], [u + sb * r1, y + h, v + cb * r1], [u + sa * r1, y + h, v + ca * r1]],
          [sm / length, slope / length, cm / length], rect);
      }
    },
    finish(label) {
      if (!out.index.length) return 0;
      const geometry = new THREE.BufferGeometry();
      for (const key of ['position', 'normal', 'uv']) geometry.setAttribute(key, new THREE.Float32BufferAttribute(out[key], key === 'uv' ? 2 : 3));
      geometry.setIndex(out.index);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material());
      mesh.name = label;
      mesh.castShadow = material === sharedLifeMaterial;
      mesh.receiveShadow = true;
      mesh.userData.streetLife = true;
      parent.add(mesh);
      return 1;
    }
  };
}

/** Azotea bogotana: tanque negro, columnas sin terminar con varillas, antena, cuarto de escalera y ropa tendida. */
function addRooftopLife(shell, { baseY, width, depth, height, seed, ruin, tankSide }) {
  const UV = detailAtlas().uv, life = lifeBatch(shell.roof, 4, 0), r = rng((seed ^ 0x51ed27) >>> 0);
  const hw = width / 2 - .32, hd = depth / 2 - .32;
  if (hw < 1 || hd < 1) return 0;
  // Cuadrantes libres: el tanque viejo ya ocupa uno.
  const slots = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([a, b]) => a !== tankSide[0] || b !== tankSide[1]);
  for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
  const next = () => slots.pop();
  const at = ([a, b], k = .55) => [a * hw * k, b * hd * k];
  if (!ruin && r() < .78 && slots.length) {
    const [u, v] = at(next(), .6);
    life.box(UV.concrete, u, baseY, v, 1.15, .22, 1.15);
    life.cylinder(UV.tank, u, baseY + .22, v, .5, .55, 1.02, 8);
    life.cylinder(UV.tank, u, baseY + 1.24, v, .56, .12, .15, 8);
    if (r() < .35) {
      life.box(UV.rust, u + .62, baseY + .2, v, .05, .9, .05);
      life.box(UV.rust, u + .36, baseY + 1.08, v, .55, .05, .05);
    }
  }
  if (!ruin && r() < .34 && height > 6 && width > 5 && depth > 5 && slots.length) {
    const [u, v] = at(next(), .6);
    life.box(UV.concrete, u, baseY, v, 1.9, 2.25, 1.9);
    life.panel(UV.wood, u, baseY + 1, v + .955, .8, 1.9);
    life.box(UV.concrete, u, baseY + 2.25, v, 2.1, .1, 2.1);
  }
  // Varillas de la plancha que nunca se hizo: la señal de una casa que sigue creciendo.
  if ((ruin || r() < .52)) {
    const corners = ruin ? 4 : 2 + Math.floor(r() * 3);
    const spots = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]];
    for (let i = 0; i < corners; i++) {
      const [u, v] = spots[i], stub = .35 + r() * .55;
      life.box(UV.concrete, u, baseY, v, .3, stub, .3);
      for (const [ku, kv] of [[-.09, -.09], [.09, -.09], [-.09, .09], [.09, .09]]) {
        life.box(UV.rebar, u + ku, baseY + stub, v + kv, .022, .75 + r() * .85, .022);
      }
    }
  }
  if (!ruin && r() < .52 && slots.length) {
    const [u, v] = at(next(), .7), mast = 2.5 + r() * 1.2;
    life.box(UV.rust, u, baseY, v, .035, mast, .035);
    for (let i = 0; i < 3; i++) life.box(UV.rust, u, baseY + mast - .1 - i * .32, v, 1.1 - i * .22, .02, .02);
    if (r() < .5) life.box(UV.rust, u, baseY + mast - .45, v, .02, .02, .7);
  }
  if (!ruin && r() < .46 && width > 4.5 && slots.length) {
    // Dos parales, dos cuerdas y lo que se esté secando.
    const v = at(next(), .5)[1], span = Math.min(hw * 1.5, 5.2), y = baseY + 1.72;
    for (const u of [-span / 2, span / 2]) life.box(UV.wood, u, baseY, v, .06, 1.8, .06);
    for (const k of [-.14, .14]) life.box(UV.rust, 0, y, v + k, span, .012, .012);
    const count = 3 + Math.floor(r() * 4), cells = [UV.cloth, UV.cloth2, UV.cloth3];
    for (let i = 0; i < count; i++) {
      const u = -span / 2 + span * (i + .5) / count + (r() - .5) * .15, w = .36 + r() * .3, h = .5 + r() * .45;
      life.panel(cells[Math.floor(r() * cells.length)], u, y - h / 2, v + (i % 2 ? .14 : -.14), w, h);
    }
  }
  return life.finish('Azotea con vida');
}

/** Primer piso: toldos, contadores, letreros a mano y humedad bajo los alféizares. */
function addFacadeLife(wall, face, plane, { length, facadeHeight, floorHeight, centers, windowWidth, windowHeight, rows, seed, ruin, shopfront, tower }) {
  const UV = detailAtlas().uv, life = lifeBatch(wall, face, plane), damp = lifeBatch(wall, face, plane, sharedStainMaterial);
  const r = rng((seed ^ Math.imul(face + 3, 0x2f6e2b)) >>> 0);
  // La lluvia baja de cada alféizar: lo que más delata una pared recién pintada es no tener esto.
  const stains = [UV.damp, UV.damp2];
  for (let floor = 1; floor <= rows; floor++) for (const u of centers) {
    if (r() > (ruin ? .7 : .38)) continue;
    const top = (floor + .54) * floorHeight - windowHeight / 2 - .1, h = .6 + r() * .65;
    damp.panel(stains[Math.floor(r() * 2)], u + (r() - .5) * .2, top - h / 2, -.07, windowWidth * (.8 + r() * .5), h);
  }
  if (r() < .6) {
    const w = length * (.3 + r() * .5), h = 1 + r() * 1.2;
    damp.panel(stains[Math.floor(r() * 2)], (r() - .5) * (length - w), facadeHeight - .24 - h / 2, -.07, w, h);
  }
  const stainMeshes = damp.finish('Humedad de la fachada');
  if (tower) {
    // El portal del edificio, sobre el hueco de la entrada: liso era lo más falso de cada cuadra.
    const w = Math.min(2.6, length * .32), cells = [UV.door, UV.door2, UV.door3, UV.door4];
    life.panel(cells[Math.floor(r() * 4)], 0, 1.4, .06, w, 2.4);
  }
  if (!shopfront || ruin) return stainMeshes + life.finish('Fachada con vida');
  if (length >= 5 && r() < .46) {
    // Toldo de lona de la tienda: arriba de 2,1 m, nadie se lo lleva por delante.
    const w = Math.min(length - 1.4, 3.2 + r() * 1.6), u = (r() - .5) * (length - w - .8), out = .85 + r() * .25;
    const cell = r() < .5 ? UV.awning : UV.awning2;
    life.slope(cell, u, 2.72, -.05, 2.3, out, w);
    life.panel(cell, u, 2.18, out, w, .24);
    for (const side of [-1, 1]) life.box(UV.rust, u + side * w / 2, 2.3, out / 2, .02, .02, out);
  }
  if (r() < .68) {
    // Contadores de luz junto a la entrada, con su tubo subiendo hasta la acometida.
    const side = r() < .5 ? -1 : 1, count = 1 + Math.floor(r() * 3), u0 = side * (length / 2 - .62);
    for (let i = 0; i < count; i++) life.box(UV.meter, u0 - side * i * .42, 1.35, -.03, .34, .46, .1);
    life.box(UV.rust, u0, 1.8, -.04, .04, Math.min(2.2, facadeHeight - 2), .04);
  }
  if (centers.length >= 2 && rows >= 1 && r() < .24) {
    // Letrero pintado a mano en el muro, entre dos ventanas.
    const cells = [UV.paintA, UV.paintB, UV.paintC, UV.paintD];
    const u = (centers[0] + centers[1]) / 2, gap = Math.abs(centers[1] - centers[0]) - windowWidth - .3;
    if (gap > .55) life.panel(cells[Math.floor(r() * 4)], u, floorHeight * 1.5, -.07, Math.min(gap, 1.3), Math.min(gap, 1.3) * .62);
  }
  return stainMeshes + life.finish('Fachada con vida');
}

function insetRoofCap(shell, height, inset) {
  let chosen = null, area = 0;
  shell.roof.traverse(mesh => {
    if (!mesh.isMesh || mesh.userData.buildingDetails || /cornisa|remate/i.test(mesh.name)) return;
    const p = mesh.geometry.attributes.position, n = mesh.geometry.attributes.normal;
    if (!p || !n) return;
    const indices = [];
    for (let i = 0; i < p.count; i++) if (n.getY(i) > .9 && Math.abs(p.getY(i) * mesh.scale.y + mesh.position.y - height) < .02) indices.push(i);
    if (indices.length < 3) return;
    const xs = indices.map(i => p.getX(i)), zs = indices.map(i => p.getZ(i));
    const candidateArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    if (candidateArea > area) { chosen = { mesh, indices }; area = candidateArea; }
  });
  if (!chosen) return false;
  const { mesh, indices } = chosen, positions = mesh.geometry.attributes.position;
  for (const i of indices) positions.setY(i, positions.getY(i) - inset / mesh.scale.y);
  positions.needsUpdate = true;
  mesh.geometry.computeBoundingBox(); mesh.geometry.computeBoundingSphere();
  return true;
}

/**
 * Detalla una sola fachada y su azotea antes de BuildingVisibility.register.
 * Todas las medidas son locales al shell. `height` siempre es la cota máxima;
 * facadeHeight/roofWidth/roofDepth sirven para torres con coronación retranqueada.
 * Los materiales suministrados se reutilizan; el respaldo comparte seis por barrio.
 */
export function addBuildingDetails({ shell, width, depth, height, floors, face = 4, seed = 0,
  neighborhood = 'centro', ruin = false, materials = {}, balconies = false, roof = true,
  facadeHeight = height, roofWidth = width, roofDepth = depth, windowBayWidth = null }) {
  const wall = shell.walls.get(face);
  if (!wall || !FACE_BASIS[face] || width <= 0 || depth <= 0 || height <= 0 || floors < 1) return { meshes: 0, triangles: 0, windows: 0, balconies: 0 };
  shell.root.userData.detailedFaces ??= [];
  if (shell.root.userData.detailedFaces.includes(face)) return { meshes: 0, triangles: 0, windows: 0, balconies: 0 };
  shell.root.userData.detailedFaces.push(face);
  const m = { ...sharedMaterials(neighborhood), ...materials };
  const length = face < 2 ? depth : width, plane = (face < 2 ? width : depth) / 2;
  const [,, nx, nz] = FACE_BASIS[face];
  // Un ligero entrante deja un zócalo real y espacio para marcos. El volumen
  // exterior, la tapa y las colisiones conservan exactamente la misma planta.
  for (const child of wall.children) if (child.isMesh && child.geometry.attributes.position.count === 4) {
    child.geometry.translate(-nx * .08, 0, -nz * .08);
  }
  const front = batches(wall, face, plane);
  const floorHeight = height / floors;
  const bay = windowBayWidth ?? length / Math.max(1, Math.round(length / 3.2));
  const rows = Math.max(0, Math.min(5, Math.floor(facadeHeight / floorHeight) - 1));
  const windowWidth = Math.min(1.8, bay * .51), windowHeight = Math.min(1.55, floorHeight * .48);
  const centers = [];
  for (let column = 0; column < Math.ceil(length / bay) && centers.length < 4; column++) {
    const center = -length / 2 + bay * (column + .5);
    if (Math.abs(center) + windowWidth / 2 + .11 <= length / 2) centers.push(center);
  }
  let windowCount = 0, balconyCount = 0;
  for (let floor = 1; floor <= rows; floor++) for (let column = 0; column < centers.length; column++) {
    const u = centers[column], y = (floor + .54) * floorHeight;
    const bottom = y - windowHeight / 2, top = y + windowHeight / 2;
    const boarded = ruin && hash(seed + floor * 37 + column * 13) % 5 === 0;
    const paneSeed = hash((seed >>> 0) ^ Math.imul(floor + 1, 73856093)
      ^ Math.imul(column + 1, 19349663) ^ Math.imul(face + 1, 83492791));
    const choice = paneSeed % 100;
    const panelMaterial = boarded ? m.concrete : !ruin && choice < 28 ? m.warmWindow
      : choice < 48 ? m.curtain : m.glass;
    front.panel(panelMaterial, u, y, -.06, windowWidth, windowHeight);
    if (!boarded && panelMaterial !== m.curtain && (paneSeed >>> 8) % 3 !== 0) {
      const coverage = .26 + ((paneSeed >>> 12) % 4) * .07;
      const curtainWidth = windowWidth * coverage;
      const side = paneSeed & 1 ? -1 : 1;
      front.panel(m.curtain, u + side * (windowWidth - curtainWidth) / 2, y, -.055, curtainWidth, windowHeight);
    }
    for (const side of [-1, 1]) front.box(m.trim, u + side * (windowWidth / 2 + .035), y, -.045, .07, windowHeight + .14, .09);
    for (const edge of [bottom - .035, top + .035]) front.box(m.trim, u, edge, -.045, windowWidth, .07, .09);
    front.box(m.metal, u, y, -.035, .035, windowHeight, .04);
    front.box(m.concrete, u, bottom - .08, -.06, windowWidth + .22, .09, .12);
    if (balconies && !boarded && floor <= 3 && (column + floor + seed) % 2 === 0) {
      // Balcón francés: baranda abierta con barrotes, dentro de la planta.
      const railY = bottom + .82, railWidth = windowWidth + .14;
      front.box(m.metal, u, railY, -.016, railWidth, .045, .03);
      for (let bar = 0; bar <= 3; bar++) front.box(m.metal, u - railWidth / 2 + bar * railWidth / 3, bottom + .45, -.016, .025, .74, .03);
      balconyCount++;
    }
    windowCount++;
  }
  // Rejas bajas laterales: el centro del local y su rótulo siguen despejados.
  if (length >= 4.5) for (const side of [-1, 1]) {
    const u = side * length * .34, w = Math.min(.85, length * .15);
    for (const y of [1.05, 2.05]) front.box(m.metal, u, y, -.02, w, .035, .035);
    for (let i = 0; i < 4; i++) front.box(m.metal, u - w / 2 + i * w / 3, 1.55, -.02, .025, 1, .035);
  }
  const pipeU = (seed & 1 ? -1 : 1) * (length / 2 - .16);
  front.box(m.metal, pipeU, facadeHeight / 2, -.025, .045, facadeHeight - .2, .045);
  front.box(m.trim, 0, facadeHeight - .13, -.055, Math.max(.2, length - .1), .16, .11);
  const result = { ...front.finish('Detalles de fachada agrupados'), windows: windowCount, balconies: balconyCount };
  result.lifeMeshes = addFacadeLife(wall, face, plane, { length, facadeHeight, floorHeight, centers, windowWidth, windowHeight,
    rows, seed, ruin, shopfront: windowBayWidth === null, tower: windowBayWidth !== null });

  if (roof && !shell.root.userData.detailedRoof && height >= 4 && roofWidth >= 2 && roofDepth >= 2) {
    const inset = .8;
    if (insetRoofCap(shell, height, inset)) {
      shell.root.userData.detailedRoof = true;
      const top = batches(shell.roof, 4, 0), baseY = height - inset;
      for (const side of [-1, 1]) {
        top.box(m.concrete, side * (roofWidth / 2 - .07), height - inset / 2, 0, .14, inset, roofDepth);
        top.box(m.concrete, 0, height - inset / 2, side * (roofDepth / 2 - .07), roofWidth - .28, inset, .14);
      }
      const tankX = (seed & 1 ? -1 : 1) * Math.min(roofWidth * .2, 1.4);
      const tankZ = ((seed >>> 1) & 1 ? -1 : 1) * Math.min(roofDepth * .2, 1.4);
      if (!ruin) {
        top.cylinder(m.metal, tankX, baseY + .36, tankZ, .34, .64);
        top.cylinder(m.metal, tankX, baseY + .7, tankZ, .36, .04);
      }
      top.box(m.metal, tankX + .42, baseY + .25, tankZ, .06, .5, .06);
      top.box(m.metal, tankX + .22, baseY + .49, tankZ, .46, .06, .06);
      const roofStats = top.finish('Azotea agrupada');
      result.meshes += roofStats.meshes; result.triangles += roofStats.triangles;
      // Solo en las casas de la cuadra: las torres no dejan ver su azotea desde la calle.
      if (windowBayWidth === null) result.lifeMeshes += addRooftopLife(shell, { baseY, width: roofWidth, depth: roofDepth, height, seed, ruin,
        tankSide: [Math.sign(tankX), Math.sign(tankZ)] });
    }
  }
  return result;
}
