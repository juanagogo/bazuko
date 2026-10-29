import * as THREE from 'three';
import { NEIGHBORHOODS } from './NeighborhoodIdentity.js';

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
    }
  }
  return result;
}
