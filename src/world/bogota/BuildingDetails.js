import * as THREE from 'three';
import { NEIGHBORHOODS } from './NeighborhoodIdentity.js';
import { rng } from './textures.js';
import { detailAtlas } from './textures-calle.js';
import { MUROS } from './textures-locales.js';
import { atlasDeVentanas, celdaDelVano, celdaVentana, columnaSinReja, FILA, LUZ_LISA } from './WindowAtlas.js';
import { addBakeryDisplay, bakeryOpening, panelsAround } from './Panaderia.js';
import { ANTEPECHO_BOTELLERO, ponerBotellero } from './Botellero.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const UNIT = Object.fromEntries(['position', 'normal', 'uv'].map(key => [key, Array.from(BOX.attributes[key].array)]));
const INDICES = Array.from(BOX.index.array);
BOX.dispose();
const materialPools = new Map();
const FACE_BASIS = { 0: [0, -1, 1, 0], 1: [0, 1, -1, 0], 4: [1, 0, 0, 1], 5: [-1, 0, 0, -1] };
const hash = value => (Math.imul(value ^ (value >>> 16), 2246822519) >>> 0);
/** Viste un material de vano con el atlas: el color y la luz de cada ventana salen de su celda. */
function conAtlas(material, brillo) {
  const atlas = atlasDeVentanas();
  if (!atlas) return material;
  material.map = atlas.color; material.emissiveMap = atlas.luz;
  material.color.set('#ffffff'); material.emissive.setScalar(brillo); material.emissiveIntensity = 0;
  return material;
}

function sharedMaterials(neighborhood) {
  const profile = typeof neighborhood === 'string' ? NEIGHBORHOODS[neighborhood] ?? NEIGHBORHOODS.centro : neighborhood;
  if (!materialPools.has(profile.id)) {
    const p = profile.palette;
    const warmWindow = new THREE.MeshStandardMaterial({ color: '#b8a88d', roughness: .78,
      emissive: '#f4c99b', emissiveIntensity: 0 });
    // BuildingVisibility conserva userData al clonar. El distrito activa este
    // valor únicamente de noche tanto en paredes como en los lotes cerrados.
    warmWindow.userData.windowGlow = .42;
    // De noche la ciudad prende con 1,2 lo que lleva mapa de luz y con `windowGlow` las cálidas: el brillo las empareja.
    conAtlas(warmWindow, 1.45 / .42);
    materialPools.set(profile.id, {
      trim: new THREE.MeshStandardMaterial({ color: p.trim, roughness: .86 }),
      metal: new THREE.MeshStandardMaterial({ color: p.metal, metalness: .25, roughness: .64 }),
      glass: conAtlas(new THREE.MeshStandardMaterial({ color: '#33494b', metalness: .18, roughness: .3 }), .9),
      curtain: conAtlas(new THREE.MeshStandardMaterial({ color: '#a8a59a', roughness: .94 }), .9),
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
  const append = (material, positions, normals, uvs, indices, u, y, v, w = 1, h = 1, d = 1, rect = null) => {
    const out = bucket(material), offset = out.position.length / 3;
    for (let i = 0; i < positions.length; i += 3) {
      const a = positions[i] * w + u, b = positions[i + 1] * h + y, c = positions[i + 2] * d + v + plane;
      out.position.push(ux * a + nx * c, b, uz * a + nz * c);
      out.normal.push(ux * normals[i] + nx * normals[i + 2], normals[i + 1], uz * normals[i] + nz * normals[i + 2]);
    }
    // `rect` lleva las UV a una celda del atlas de ventanas.
    if (rect) for (let i = 0; i < uvs.length; i += 2) out.uv.push(rect[0] + uvs[i] * (rect[2] - rect[0]), rect[1] + uvs[i + 1] * (rect[3] - rect[1]));
    else out.uv.push(...uvs);
    for (const index of indices) out.index.push(offset + index);
  };
  return {
    box: (material, u, y, v, w, h, d, rect) => append(material, UNIT.position, UNIT.normal, UNIT.uv, INDICES, u, y, v, w, h, d, rect),
    panel: (material, u, y, v, w, h, rect) => append(material,
      [-.5,-.5,0,.5,-.5,0,.5,.5,0,-.5,.5,0], [0,0,1,0,0,1,0,0,1,0,0,1],
      [0,0,1,0,1,1,0,1], [0,1,2,0,2,3], u,y,v,w,h,1, rect),
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
    points.forEach(([a, y, c], i) => {
      // Una normal para la cara, o una por esquina en lo que es redondo.
      const n = Array.isArray(normal[0]) ? normal[i] : normal;
      out.position.push(ux * a + nx * (c + plane), y, uz * a + nz * (c + plane));
      out.normal.push(ux * n[0] + nx * n[2], n[1], uz * n[0] + nz * n[2]);
    });
    out.uv.push(rect[0], rect[1], rect[2], rect[1], rect[2], rect[3], rect[0], rect[3]);
    out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  return {
    estampa(modelo, rect, u, y, v, escala) {
      const desde = out.position.length / 3, { position, normal, uv, index } = modelo;
      for (let i = 0; i < position.length; i += 3) {
        const a = u + escala * position[i], c = plane + v + escala * position[i + 2];
        out.position.push(ux * a + nx * c, y + escala * position[i + 1], uz * a + nz * c);
        out.normal.push(ux * normal[i] + nx * normal[i + 2], normal[i + 1], uz * normal[i] + nz * normal[i + 2]);
      }
      for (let i = 0; i < uv.length; i += 2) {
        out.uv.push(rect[0] + (rect[2] - rect[0]) * uv[i], rect[1] + (rect[3] - rect[1]) * uv[i + 1]);
      }
      for (const i of index) out.index.push(desde + i);
    },
    panel(rect, u, y, v, w, h) {
      quad([[u - w / 2, y - h / 2, v], [u + w / 2, y - h / 2, v], [u + w / 2, y + h / 2, v], [u - w / 2, y + h / 2, v]], [0, 0, 1], rect);
    },
    /** Cara vertical de (a0, c0) a (a1, c1): mira hacia la derecha de quien la recorre. */
    side(rect, a0, c0, a1, c1, y0, y1) {
      const length = Math.hypot(a1 - a0, c1 - c0);
      quad([[a0, y0, c0], [a1, y0, c1], [a1, y1, c1], [a0, y1, c0]], [(c0 - c1) / length, 0, (a1 - a0) / length], rect);
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
    /** `round`: la celda da una sola vuelta y la luz no marca las caras. */
    cylinder(rect, u, y, v, r0, r1, h, sides = 8, round = false) {
      const slope = (r0 - r1) / Math.max(h, 1e-3), length = Math.hypot(1, slope), ny = slope / length, du = (rect[2] - rect[0]) / sides;
      for (let i = 0; i < sides; i++) {
        const a = i / sides * Math.PI * 2, b = (i + 1) / sides * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cm = Math.cos((a + b) / 2), sm = Math.sin((a + b) / 2);
        const points = [[u + sa * r0, y, v + ca * r0], [u + sb * r0, y, v + cb * r0], [u + sb * r1, y + h, v + cb * r1], [u + sa * r1, y + h, v + ca * r1]];
        if (!round) { quad(points, [sm / length, ny, cm / length], rect); continue; }
        const na = [sa / length, ny, ca / length], nb = [sb / length, ny, cb / length];
        quad(points, [na, nb, nb, na], [rect[0] + du * i, rect[1], rect[0] + du * (i + 1), rect[3]]);
      }
    },
    get empty() { return !out.index.length; },
    get vertices() { return out.position.length / 3; },
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
      if (this.bandera) mesh.userData.bandera = this.bandera;
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
    life.box(UV.canvas, u, baseY, v, 1.15, .22, 1.15);
    // La tapa toma la franja de arriba de la celda, la del polvo que aclara el sol.
    const t = UV.tank, lid = [t[0], t[3] - (t[3] - t[1]) * .16, t[2], t[3]];
    life.cylinder(t, u, baseY + .22, v, .5, .55, 1.02, 16, true);
    life.cylinder(lid, u, baseY + 1.24, v, .56, .12, .15, 16, true);
    if (r() < .35) {
      life.box(UV.rust, u + .62, baseY + .2, v, .05, .9, .05);
      life.box(UV.rust, u + .36, baseY + 1.08, v, .55, .05, .05);
    }
  }
  if (!ruin && r() < .34 && height > 6 && width > 5 && depth > 5 && slots.length) {
    const [u, v] = at(next(), .6);
    life.box(UV.canvas, u, baseY, v, 1.9, 2.25, 1.9);
    life.panel(UV.wood, u, baseY + 1, v + .955, .8, 1.9);
    life.box(UV.canvas, u, baseY + 2.25, v, 2.1, .1, 2.1);
  }
  // Varillas de la plancha que nunca se hizo: la señal de una casa que sigue creciendo.
  if ((ruin || r() < .52)) {
    const corners = ruin ? 4 : 2 + Math.floor(r() * 3);
    const spots = [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd]];
    for (let i = 0; i < corners; i++) {
      const [u, v] = spots[i], stub = .35 + r() * .55;
      life.box(UV.canvas, u, baseY, v, .3, stub, .3);
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
  if (!life.empty) {
    // Pañete sucio por dentro del pretil, a ras de su cara interior; por paños, para que las manchas no se estiren.
    const a = width / 2 - .155, c = depth / 2 - .155, c0 = UV.canvas, c1 = [c0[2], c0[1], c0[0], c0[3]];
    const wall = (ax, cx, bx, dx) => {
      const n = Math.max(1, Math.round(Math.hypot(bx - ax, dx - cx) / 2.6));
      for (let i = 0; i < n; i++) {
        life.side(i % 2 ? c1 : c0, ax + (bx - ax) * i / n, cx + (dx - cx) * i / n, ax + (bx - ax) * (i + 1) / n, cx + (dx - cx) * (i + 1) / n, baseY, height - .01);
      }
    };
    wall(a, -c, a, c); wall(-a, c, -a, -c); wall(a, c, -a, c); wall(-a, -c, a, -c);
  }
  return life.finish('Azotea con vida');
}

/** Lo que el local saca al andén. Todo queda a menos de 40 cm del muro: nadie lo atraviesa a la vista. */
const ANDEN = {
  canastas(life, UV, q, u, s) {
    const cells = [UV.canastaRoja, UV.canastaAmarilla, UV.canastaAzul];
    for (const [du, count] of [[0, 3 + Math.floor(q() * 2)], [s * .47, 2 + Math.floor(q() * 2)]]) {
      for (let i = 0; i < count; i++) life.box(cells[Math.floor(q() * 3)], u + du + (q() - .5) * .04, i * .27, .2, .42, .27, .32);
    }
  },
  nevera(life, UV, q, u) { life.box(UV.nevera, u, 0, .2, .78, .86, .38); },
  tijera(life, UV, q, u) { life.slope(UV.tijera, u, .86, .16, 0, .38, .56); life.panel(UV.wood, u, .43, .14, .56, .86); },
  almuerzo(life, UV, q, u) { life.slope(UV.almuerzo, u, .92, .16, 0, .38, .6); life.panel(UV.wood, u, .46, .14, .6, .92); },
  sillas(life, UV, q, u, s) {
    const cell = q() < .5 ? UV.sillaRoja : UV.chair;
    for (const du of q() < .6 ? [0, s * .52] : [0]) {
      life.box(cell, u + du, .4, .21, .4, .04, .36);
      life.box(cell, u + du, .44, .05, .4, .4, .03);
      for (const [a, c] of [[-.17, .06], [.17, .06], [-.17, .36], [.17, .36]]) life.box(cell, u + du + a, 0, c, .03, .4, .03);
    }
  },
  llantas(life, UV, q, u) {
    const count = 4 + Math.floor(q() * 3);
    for (let i = 0; i < count; i++) life.cylinder(UV.tire, u + (q() - .5) * .03, i * .17, .2, .19, .19, .17, 8);
    life.cylinder(UV.tire, u, count * .17, .2, .19, .08, .01, 8);
  },
  costales(life, UV, q, u) {
    const count = 3 + Math.floor(q() * 2);
    for (let i = 0; i < count; i++) life.box(UV.sack, u + (i % 2 ? .05 : -.03), i * .21, .2, .6 - i * .04, .21, .38 - i * .02);
  },
  cajas(life, UV, q, u, s) {
    life.box(UV.box, u, 0, .2, .48, .38, .38);
    life.box(UV.cardboard, u + .03, .38, .2, .42, .32, .36);
    if (q() < .6) life.box(UV.box, u - .02, .7, .19, .34, .26, .32);
    life.box(UV.box, u + s * .47, 0, .19, .38, .32, .36);
  },
  guacales(life, UV, q, u, s) {
    for (const du of [0, s * .58]) {
      // El primero va montado sobre un guacal vacío: la fruta queda a la altura de la mano.
      const base = du ? 0 : .3;
      if (base) life.box(UV.guacal, u, 0, .2, .54, base, .38);
      life.box(UV.guacal, u + du, base, .2, .54, .3, .36);
      life.box(UV.guacal, u + du, base + .3, .18, .54, .08, .32);
      life.slope(UV.frutas, u + du, base + .56, .03, base + .38, .39, .54);
    }
  },
  // Matera de barro con lengua de suegra: cuatro hojas en punta, de alto distinto. La mitad está vacía, con la tierra seca.
  matera(life, UV, q, u) {
    const suerte = q(), alto = .22 + suerte * .16, resto = n => suerte * n % 1;
    life.cylinder(UV.matera, u, 0, .2, .13, .17, .32, 6);
    life.cylinder(UV.wood, u, .29, .2, .135, 0, .025, 4);
    if (resto(7) < .5) return;
    for (let i = 0; i < 4; i++) {
      const giro = resto(13) * 6.283 + i * 1.571, fuera = .035 + resto(31 + i * 7) * .045;
      life.cylinder(UV.planta, u + Math.cos(giro) * fuera, .3, .2 + Math.sin(giro) * fuera, .028 + resto(17 + i * 5) * .014, 0, alto + .12 + resto(23 + i * 11) * .2, 3);
    }
  },
  caneca(life, UV, q, u) { life.cylinder(UV.bin, u, 0, .2, .17, .19, .62, 8); life.cylinder(UV.bin, u, .62, .2, .19, .05, .02, 8); },
  chatarra(life, UV, q, u) {
    const alto = .5 + q() * .25;
    life.box(UV.pila, u, 0, .2, .86, alto, .38);
    life.box(UV.pila, u + .12, alto, .18, .46, .26, .3);
    life.box(UV.rust, u - .3, 0, .33, .05, alto + .5, .05);
  },
  afiches(life, UV, q, u, s) { life.panel(UV.afiches, u - s * .2, 1.5 + q() * .25, .03, .52, .64); }
};

/** Tejadillo o lona corta de un local: alto en la pared, lo que cae hasta el borde de afuera y lo que vuela, en metros. */
const TEJADILLO = { arranque: 2.8, caida: .06, vuelo: .42 };
/** Aviso de bandera: distancia a la medianera y holgura hasta el borde del rótulo pintado, en metros. */
const BANDERA = { medianera: .9, holgura: .15 };

/** El local del primer piso: muro, persiana, lo que se ve adentro, rótulo y lo que sale al andén. */
function addLocal(life, front, m, UV, { length, facadeHeight, floorHeight, seed, local, toldo, contadores, warm, avisoBajo, balcon, flat = false }) {
  const q = rng((seed ^ 0x6c0ca15) >>> 0), half = length / 2, bajo = facadeHeight < 3.7, alto = bajo ? 2 : 2.3;
  const panos = Math.ceil(length / 2.3), ancho = length / panos, muro = UV[MUROS[Math.floor(q() * MUROS.length)]];
  // La pintura llega hasta arriba del rótulo, cerca de la placa del segundo piso, o solo al dintel. El aviso grande
  // retrocede con la fachada y queda por detrás de este muro: donde lo hay, la pintura termina 6 cm por debajo de él.
  const anchoRotulo = Math.min(length - .5, bajo ? 2 : 2.6), yRotulo = bajo ? Math.min(2.5, facadeHeight - anchoRotulo / 8 - .1) : 3.05;
  const placa = yRotulo + anchoRotulo / 8 + .1, cabe = placa <= Math.min(floorHeight * 1.2, facadeHeight - .2);
  const tope = local.conAviso ? avisoBajo - .06 : q() < .5 && cabe ? placa : alto + .19;
  const altoMuro = Math.min(tope, facadeHeight - .2);
  // El vano deja libres los contadores y las esquinas. El zócalo del cascarón conserva su planta.
  let a = -half + .3, b = half - .3;
  const borde = contadores ? half - .62 - (contadores.count - 1) * .42 - .32 : 0;
  if (contadores) {
    if (contadores.side < 0) a = -borde; else b = borde;
  }
  const libre = b - a, vanos = libre >= 5.2 ? 2 : 1, vano = Math.min(3.1, libre / vanos - .25);
  const display = flat ? null : bakeryOpening(local, seed, a + libre * .5 / vanos, vano, .07 + alto - .26);
  const botellas = local.interior === 'botellas', huecos = display ? [display] : [];
  if (botellas && !flat && vano >= .85) for (let i = 0; i < vanos; i++) {
    const u = a + libre * (i + .5) / vanos;
    huecos.push({ left: u - vano / 2, right: u + vano / 2, bottom: ANTEPECHO_BOTELLERO, top: .07 + alto });
  }
  for (let i = 0; i < panos; i++) {
    if (!huecos.length) life.panel(muro, -half + ancho * (i + .5), altoMuro / 2, .01, ancho, altoMuro);
    else {
      const bounds = [-half + ancho * i, 0, -half + ancho * (i + 1), altoMuro];
      let piezas = [[...bounds, muro]];
      for (const hueco of huecos) piezas = piezas.flatMap(([l, b, r, t, uv]) => panelsAround([l, b, r, t], hueco, uv));
      for (const [left, bottom, right, top, uv] of piezas) {
        life.panel(uv, (left + right) / 2, (bottom + top) / 2, .01, right - left, top - bottom);
      }
    }
  }
  if (!flat) life.box(UV.concrete, 0, altoMuro - .03, .035, length, .06, .05);
  const centros = [];
  if (vano >= .85) for (let i = 0; i < vanos; i++) {
    const u = a + libre * (i + .5) / vanos, estado = i && q() < .5 ? 'cerrada' : local.estado;
    centros.push(u);
    if (!flat) life.box(UV.canvas, u, 0, .09, vano + .2, .07, .28);
    if (estado === 'cerrada') {
      life.panel(UV[local.persiana], u, .07 + alto / 2, .03, vano, alto);
      if (q() < .3) life.panel(q() < .6 ? UV.arrienda : UV.vende, u + (q() - .5) * vano * .4, 1.5, .04, .62, .46);
      continue;
    }
    const interior = local.reja && q() < .55 ? UV.reja : UV[local.interior];
    const caida = estado === 'media' ? .9 + q() * .4 : .26;
    if (botellas) ponerBotellero(life, UV, u, vano, .07 + alto - caida, seed ^ Math.imul(i + 1, 0x371e8da7), interior === UV.reja, flat);
    else if (!display || i !== 0) life.panel(interior, u, .07 + alto / 2, .022, vano, alto);
    if (flat) life.panel(UV[local.persiana], u, .07 + alto - caida / 2, .034, vano, caida);
    else life.box(UV[local.persiana], u, .07 + alto - caida, .065, vano, caida, .07);
    if (local.luz && warm) front.box(m.warmWindow, u, alto + .2, .05, Math.min(1.5, vano * .7), .09, .07, LUZ_LISA);
  }
  const centro = centros.length ? (centros[0] + centros[centros.length - 1]) / 2 : (a + b) / 2;
  const uRotulo = Math.max(-half + anchoRotulo / 2 + .1, Math.min(half - anchoRotulo / 2 - .1, centro));
  if (!local.conAviso) life.panel(UV[`rot_${local.id}`], uRotulo, yRotulo, .03, anchoRotulo, anchoRotulo / 4);
  if (!centros.length || flat) return { sale: false, display };
  const izquierda = centros[0] - vano / 2, derecha = centros[centros.length - 1] + vano / 2;
  let sale = !!toldo;
  if (local.bandera === 'cruz') {
    life.box(UV.cruz, Math.min(half - .12, derecha + .12), 2.5, .31, .05, .5, .5);
    sale = true;
  }
  if (local.bandera === 'barbero') {
    const u = Math.max(-half + .12, izquierda - .14);
    life.cylinder(UV.barbero, u, 1.25, .1, .06, .06, .6, 6);
    for (const y of [1.19, 1.85]) life.box(UV.canvas, u, y, .1, .15, .06, .15);
  }
  // El andén: a cada lado del vano, sin tapar la entrada ni el toldo de nadie.
  const sitios = [Math.max(-half + .45, izquierda - .2), Math.min(half - .45, derecha + .2)];
  if (sitios[1] - sitios[0] < 1.6) sitios.length = 1;
  const quieto = local.estado === 'cerrada' ? .45 : 1;
  const sobreContador = u => contadores && (contadores.side < 0 ? u < -borde + .4 : u > borde - .4);
  sitios.forEach((u, i) => {
    const pieza = local.anden[i], s = i ? -1 : 1;
    if (pieza === 'afiches' && sobreContador(u - s * .2)) return;
    if (q() < (pieza === 'afiches' || pieza === 'matera' ? .7 : quieto)) ANDEN[pieza](life, UV, q, u, s);
  });
  // Sin toldo de antes, muchos tienen tejadillo de lata o una lona corta sobre la entrada. Va alto y vuela poco, para
  // no tapar a quien camina pegado a la pared, y ocupa casi todo el frente, para verse desde arriba. Donde el aviso
  // grande baja de ahí no hay tejadillo: lo taparía.
  const lata = local.toldos.includes('zinc'), { arranque, caida, vuelo } = TEJADILLO;
  const cabeTejadillo = arranque <= facadeHeight - .3 && (!local.conAviso || avisoBajo >= arranque - .04);
  if (!toldo && cabeTejadillo && q() < (lata ? .96 : .92)) {
    const w = Math.min(length - .3, Math.max(vano + .9, length * .82)), u = Math.max(-half + w / 2 + .15, Math.min(half - w / 2 - .15, centros[0]));
    const cell = lata ? UV.zinc : UV[local.toldos[0]], borde = arranque - caida;
    if (lata) {
      life.slope(cell, u, arranque, -.05, borde, vuelo, w);
      for (const side of [-1, 1]) life.box(UV.rust, u + side * (w / 2 - .06), borde - .02, vuelo / 2, .02, .02, vuelo);
    } else {
      // La lona hace comba entre la pared y el tubo de afuera, y le cuelga un faldón corto y raído: la franja de abajo
      // de la celda, la del dobladillo.
      life.slope(cell, u, arranque, -.05, borde - .015, vuelo * .55, w);
      life.slope(cell, u, borde - .015, vuelo * .55, borde, vuelo, w);
      life.slope([cell[0], cell[1], cell[2], cell[1] + (cell[3] - cell[1]) * .3], u, borde, vuelo, borde - .12, vuelo + .015, w);
    }
    sale = true;
  }
  // Aviso de bandera: un cajón de lata colgado de un ángulo, perpendicular a la fachada; se lee al derecho viniendo
  // de cualquier lado y su tapa se ve desde arriba. Solo donde no hay aviso grande, que diría lo mismo; a un lado del
  // rótulo pintado, sin cruzarlo, y lejos de la medianera, para no quedar delante del aviso del vecino. Como el rótulo
  // ya dice el nombre, la bandera lleva solo el título del oficio: la franja de arriba de la misma celda. Tampoco
  // cuelga donde el balcón de madera llega hasta ella.
  const bajoBalcon = balcon && half - BANDERA.medianera - .07 < Math.min(length * .7, 3.5) / 2 + .05;
  const lados = local.conAviso || bajoBalcon || facadeHeight <= 3.6 ? [] : [-1, 1].filter(lado =>
    half - BANDERA.medianera - (lado * uRotulo + anchoRotulo / 2) >= BANDERA.holgura && !(lado > 0 && local.bandera === 'cruz'));
  if (lados.length && q() < .9) {
    const u = lados[Math.floor(q() * lados.length)] * (half - BANDERA.medianera);
    const celda = UV[`rot_${local.id}`], titulo = [celda[0], celda[3] + (celda[1] - celda[3]) * .64, celda[2], celda[3]], desde = life.vertices;
    life.box(titulo, u, 3.01, .76, .14, .26, 1.36);
    life.box(UV.rust, u, 3.27, .74, .17, .02, 1.48);
    // Si después resulta que toca un sólido de la ciudad, `Bogota` la recoge: estos son sus vértices.
    life.bandera = { desde, hasta: life.vertices };
    sale = true;
  }
  return { sale, display };
}

/**
 * Primer piso: toldos, contadores, letreros a mano, humedad bajo los alféizares y, donde ya había vida, el local.
 * Solo arma piezas; las mallas nacen en `finish`, en el orden de siempre.
 */
function addFacadeLife(wall, face, plane, front, m, { length, facadeHeight, floorHeight, centers, windowWidth, windowHeight, rows, seed, ruin, shopfront, tower, local, warm, avisoBajo, balcon, residential, paintedSign }) {
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
  const finish = () => damp.finish('Humedad de la fachada') + life.finish('Fachada con vida');
  if (tower || residential) {
    const w = residential ? Math.min(1.38, length * .68) : Math.min(2.6, length * .32);
    const cells = [UV.door, UV.door2, UV.door3, UV.door4];
    life.panel(cells[Math.floor(r() * 4)], 0, residential ? 1.32 : 1.4, .06, w, 2.4);
  }
  if (!shopfront || ruin) return { local: false, finish };
  let toldo = false, contadores = null;
  if (length >= 5 && r() < .46) {
    // Toldo de lona de la tienda: arriba de 2,1 m, nadie se lo lleva por delante.
    const w = Math.min(length - 1.4, 3.2 + r() * 1.6), u = (r() - .5) * (length - w - .8), out = .85 + r() * .25;
    const first = r() < .5, cell = local ? UV[local.toldos[first ? 0 : 1]] : first ? UV.awning : UV.awning2;
    life.slope(cell, u, 2.72, -.05, 2.3, out, w);
    life.panel(cell, u, 2.18, out, w, .24);
    for (const side of [-1, 1]) life.box(UV.rust, u + side * w / 2, 2.3, out / 2, .02, .02, out);
    toldo = true;
  }
  if (r() < .68) {
    // Contadores de luz junto a la entrada, con su tubo subiendo hasta la acometida.
    const side = r() < .5 ? -1 : 1, count = 1 + Math.floor(r() * 3), u0 = side * (length / 2 - .62);
    for (let i = 0; i < count; i++) life.box(UV.meter, u0 - side * i * .42, 1.35, -.03, .34, .46, .1);
    life.box(UV.rust, u0, 1.8, -.04, .04, Math.min(2.2, facadeHeight - 2), .04);
    contadores = { side, count };
  }
  if (centers.length >= 2 && rows >= 1 && r() < .24) {
    const u = (centers[0] + centers[1]) / 2, gap = Math.abs(centers[1] - centers[0]) - windowWidth - .3;
    if (gap > .55) {
      // Donde el local ya anuncia su oficio, aquí se ve el revoque que cubrió la publicidad antigua.
      const cell = [UV.paintA, UV.paintB, UV.paintC, UV.paintD][Math.floor(r() * 4)];
      life.panel(local || !paintedSign ? UV.concrete : cell, u, floorHeight * 1.5, -.07,
        Math.min(gap, 1.3), Math.min(gap, 1.3) * .62);
    }
  }
  // El local va en una malla que esta pared ya tenía: la ciudad no gana mallas ni materiales. Sin toldo ni
  // contadores queda la de la humedad, que se pinta en orden y sin fondo: ahí el local va plano, sin andén.
  const flat = life.empty;
  if (!local || (flat && damp.empty)) return { local: false, finish };
  const { sale, display } = addLocal(flat ? damp : life, front, m, UV, { length, facadeHeight, floorHeight, seed, local, toldo, contadores, warm, avisoBajo, balcon, flat });
  return { local: flat ? 'plano' : 'completo', sale, finish, display };
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
  facadeHeight = height, roofWidth = width, roofDepth = depth, windowBayWidth = null, local = null,
  residential = false, paintedSign = true }) {
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
  // El aviso grande del local cuelga de esta pared: la pintura del primer piso tiene que terminar antes de él.
  // Es el único plano que la casa cuelga a media altura, lleve textura propia o una celda de un atlas.
  const aviso = wall.children.find(child => child.isMesh && child.position.y > 1 && child.geometry.attributes.position.count === 4);
  aviso?.geometry.computeBoundingBox();
  const avisoBajo = aviso ? aviso.position.y + aviso.geometry.boundingBox.min.y : 3.05 - Math.min(length * .85, 3.6) / 8;
  const balcon = wall.children.some(child => child.isGroup && Math.abs(child.position.y - 3.1) < 1e-6);
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
  let windowCount = 0, balconyCount = 0, warm = false;
  for (let floor = 1; floor <= rows; floor++) for (let column = 0; column < centers.length; column++) {
    const u = centers[column], y = (floor + .54) * floorHeight;
    const bottom = y - windowHeight / 2, top = y + windowHeight / 2;
    const boarded = ruin && hash(seed + floor * 37 + column * 13) % 5 === 0;
    const paneSeed = hash((seed >>> 0) ^ Math.imul(floor + 1, 73856093)
      ^ Math.imul(column + 1, 19349663) ^ Math.imul(face + 1, 83492791));
    const choice = paneSeed % 100;
    const panelMaterial = boarded ? m.concrete : !ruin && choice < 28 ? m.warmWindow
      : choice < 48 ? m.curtain : m.glass;
    // La celda del atlas sale de las semillas, sin gastar azar: la reja es una por casa; cortina y luz, de cada vano.
    const [columna, fila] = celdaDelVano(panelMaterial === m.warmWindow ? 'luz' : panelMaterial === m.curtain ? 'cortina' : 'vidrio', paneSeed, seed);
    front.panel(panelMaterial, u, y, -.06, windowWidth, windowHeight, celdaVentana(columna, fila));
    warm ||= panelMaterial === m.warmWindow;
    if (!boarded && panelMaterial !== m.curtain && (paneSeed >>> 8) % 3 !== 0) {
      const coverage = .26 + ((paneSeed >>> 12) % 4) * .07;
      const curtainWidth = windowWidth * coverage;
      const side = paneSeed & 1 ? -1 : 1;
      // La cortina corrida toma el mismo trozo de su celda, con la misma reja del vano que tapa; sobre un vidrio liso va sin reja.
      const conReja = panelMaterial.map ? columna : columnaSinReja(columna);
      front.panel(m.curtain, u + side * (windowWidth - curtainWidth) / 2, y, -.055, curtainWidth, windowHeight,
        side < 0 ? celdaVentana(conReja, FILA.cortina, 0, coverage) : celdaVentana(conReja, FILA.cortina, 1 - coverage, 1));
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
  const life = addFacadeLife(wall, face, plane, front, m, { length, facadeHeight, floorHeight, centers, windowWidth, windowHeight,
    rows, seed, ruin, shopfront: windowBayWidth === null && !residential, tower: windowBayWidth !== null,
    local, warm, avisoBajo, balcon, residential, paintedSign });
  if (local) shell.root.userData.local = { id: local.id, nombre: local.conAviso ? local.nombre : local.rotulo ?? local.nombre,
    armado: life.local, aviso: !!local.conAviso, sale: !!life.sale };
  // Rejas bajas laterales: el centro del local y su rótulo siguen despejados. Donde hay local, la reja es suya.
  if (length >= 4.5 && !life.local) for (const side of [-1, 1]) {
    const u = side * length * .34, w = residential ? Math.min(1.55, length * .23) : Math.min(.85, length * .15);
    for (const y of [1.05, 2.05]) front.box(m.metal, u, y, -.02, w, .035, .035);
    for (let i = 0; i < 4; i++) front.box(m.metal, u - w / 2 + i * w / 3, 1.55, -.02, .025, 1, .035);
  }
  const pipeU = (seed & 1 ? -1 : 1) * (length / 2 - .16);
  front.box(m.metal, pipeU, facadeHeight / 2, -.025, .045, facadeHeight - .2, .045);
  front.box(m.trim, 0, facadeHeight - .13, -.055, Math.max(.2, length - .1), .16, .11);
  const result = { ...front.finish('Detalles de fachada agrupados'), windows: windowCount, balconies: balconyCount };
  result.lifeMeshes = life.finish();
  if (life.display) addBakeryDisplay(wall, face, length, plane, life.display, seed);
  result.local = life.local;

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
