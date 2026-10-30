// Slop New York 09d27e0, Copyright Mr.doob, MIT; see THIRD_PARTY_NOTICES.md.
// Room mapping and pavement in world metres. NYC coordinates and neon decals omitted.
import * as THREE from 'three/webgpu';
import {
  Fn,
  float,
  vec2,
  vec3,
  vec4,
  color,
  uniform,
  attribute,
  varying,
  positionGeometry,
  positionLocal,
  positionWorld,
  positionView,
  positionViewDirection,
  normalLocal,
  normalWorld,
  normalWorldGeometry,
  normalGeometry,
  normalView,
  normalViewGeometry,
  modelNormalMatrix,
  frontFacing,
  cameraPosition,
  cameraProjectionMatrix,
  cameraViewMatrix,
  screenSize,
  uv,
  time,
  sin,
  cos,
  abs,
  floor,
  fract,
  mod,
  min,
  max,
  clamp,
  mix,
  step,
  smoothstep,
  dot,
  length,
  normalize,
  reflect,
  pow,
  log2,
  exp2,
  sign,
  fwidth,
  texture,
  rotateUV,
  mrt,
  If,
  sqrt,
  specularColor,
  specularColorBlended,
  specularF90
} from 'three/tsl';
import {cityUniforms} from './GraphicsState.js';
const hash2D = Fn(([p]) => {
  return fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453));
});

// Smooth 2D value noise in TSL
const noise2D = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const i = floor(pv).toVar();
  const f = fract(pv).toVar();
  const u = f.mul(f).mul(float(3.0).sub(f.mul(2.0))).toVar();
  const a = hash2D(i);
  const b = hash2D(i.add(vec2(1.0, 0.0)));
  const c = hash2D(i.add(vec2(0.0, 1.0)));
  const d = hash2D(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});

/**
 * Mikkelsen's Surface-Gradient Hardware Derivative Bump Mapping (ported from CityGeneratorUtils.js)
 * Wrapped in Fn() so `height` is evaluated once into a scalar parameter before dFdx/dFdy!
 */
const bumpNormal = Fn(([height]) => {
  const h = float(height).toVar();
  const dpdx = positionView.dFdx();
  const dpdy = positionView.dFdy();
  const r1 = dpdy.cross(normalView);
  const r2 = normalView.cross(dpdx);
  const det = dpdx.dot(r1);
  const grad = det.sign().mul(h.dFdx().mul(r1).add(h.dFdy().mul(r2)));
  return det.abs().mul(normalView).sub(grad).normalize();
});

/**
 * Filter-Width Anti-Aliased Filled Band (ported from CityGenerator.js)
 * Wrapped in Fn() so NodeBuilder emits a single WGSL function instead of inlining fwidth trees.
 */
const lineAA = Fn(([coord, halfWidth]) => {
  const c = float(coord).toVar();
  const hw = float(halfWidth).toVar();
  const aa = fwidth(c).max(0.0001).toVar();
  const effHw = max(hw, aa.mul(0.5)).toVar();
  const cov = smoothstep(effHw.add(aa), effHw.sub(aa), abs(c));
  return cov.mul(min(float(1.0), hw.div(effHw)));
});

/**
 * Filter-Width Anti-Aliased Repeating Grid Line (ported from CityGenerator.js & SidewalkGenerator.js)
 */
const gridLine = Fn(([coord, period, halfWidth]) => {
  const p = float(period).toVar();
  const g = float(coord).div(p).toVar();
  const d = float(0.5).sub(abs(fract(g).sub(0.5))).toVar();
  const aa = fwidth(g).max(0.0001).toVar();
  const hw = float(halfWidth).div(p).toVar();
  const effHw = max(hw, aa.mul(0.5)).toVar();
  const cov = smoothstep(effHw.add(aa), effHw.sub(aa), d);
  return cov.mul(min(float(1.0), hw.div(effHw)));
});

/**
 * Box-Filtered Periodic Pulse: fraction of a footprint `w` wide around `x` where fract() lies in [a, b].
 * Exact anti-aliasing that settles to the mean coverage (b - a) once a period shrinks below a pixel, so facade grids
 * don't shimmer or moiré at distance & grazing angles. Pass the in-cell coordinate (fract) for precision.
 */
const filteredPulse = Fn(([x, a, b, w]) => {
  const p = float(x).toVar();
  const lo = float(a).toVar();
  const hi = float(b).toVar();
  const hw = max(float(w), 0.0001).mul(0.5).toVar();
  const integral = (t) => floor(t).mul(hi.sub(lo)).add(clamp(fract(t), lo, hi).sub(lo));
  return integral(p.add(hw)).sub(integral(p.sub(hw))).div(hw.mul(2.0));
});

// Share of [x - s, x + s] covered by the non-repeating interval [a, b].
const boxCoverage = Fn(([x, a, b, s]) => {
  const xv = float(x).toVar();
  const sv = max(float(s), 0.001).toVar();
  return clamp(min(xv.add(sv), b).sub(max(xv.sub(sv), a)).div(sv.mul(2.0)), 0.0, 1.0);
});

// Keep distant lit windows in 1–2 pixel clusters. Adjacent world-anchored scales cross-fade, and
// the half-width inset leaves room for filtering at cell edges while preserving mean brightness.
const distantWindowLight = Fn(([grid, fw, probability, seed, lod]) => {
  const light = float(probability).toVar();
  If(cityUniforms.uInteriorGlow.greaterThan(0.5).and(lod.greaterThan(0.0)), () => {
    const level = log2(max(max(fw.x, fw.y).mul(4.0), 2.0)).toVar();
    const scale = exp2(floor(level)).toVar();
    const cluster = (size) => {
      const p = grid.div(size).toVar();
      const width = fw.div(size).toVar();
      const lit = step(float(1.0).sub(probability), hash2D(floor(p).add(vec2(seed, 73.1))));
      const coverage = filteredPulse(fract(p.x), 0.25, 0.75, width.x)
        .mul(filteredPulse(fract(p.y), 0.25, 0.75, width.y));
      return lit.mul(coverage).mul(4.0);
    };
    const clustered = mix(cluster(scale), cluster(scale.mul(2.0)), smoothstep(0.0, 1.0, fract(level)));
    light.assign(mix(probability, clustered, smoothstep(0.5, 1.2, cityUniforms.uInteriorGlow)));
  });
  return light;
});

const facadeNormalVertex = normalize(modelNormalMatrix.mul(normalLocal));
const facadeWorldNormal = varying(facadeNormalVertex, 'vFacadeWorldNormal').normalize();
const facadeAlongZ = varying(
  step(abs(facadeNormalVertex.z).sub(0.0001), abs(facadeNormalVertex.x)),
  'vFacadeAlongZ'
).setInterpolation(THREE.InterpolationSamplingType.FLAT, THREE.InterpolationSamplingMode.EITHER);

/**
 * Lightweight, Fast-Compiling 3D Parallax Apartment Interior Mapping (Upper Floors Only)
 * Modelled directly after `interior()` in `three/addons/generators/city/SkyscraperGenerator.js`:
 * - Evaluates `origin`, `dir`, `boxMin`, and `boxMax` in true world meters (isotropic 1:1:1 scale)
 *   so 3D room perspective is accurate from all viewing angles.
 * - Each apartment room spans 2.5 window bays wide (~6.8m) × 1 story tall (~3.5m) × ~5.2m deep,
 *   set back behind the facade so neighbouring windows look into the same full-sized room.
 * - Includes left & right fabric drapes hung just inside the window frame (`winUV`) from a 6-swatch
 *   domestic palette that block interior glow (`emit = 0.20`) so drapes silhouette against lit rooms.
 * - Once windows shrink to a pixel or two (`fwNode`: pixel footprint in cells), lit rooms merge into filtered
 *   clusters, drapes settle to their mean coverage & lamps fade out, so distant towers don't twinkle in motion.
 * - Returns `vec4(roomColor, litEmit)`.
 */
const evaluateApartmentInterior = Fn(([uCoord, vCoord, winUV, cellId, winWNode, floorHNode, seedNode, warmthNode, litProbNode, fwNode]) => {
  const u = float(uCoord).toVar();
  const v = float(vCoord).toVar();
  const wUV = vec2(winUV).toVar();
  const cid = vec2(cellId).toVar();
  const wW = float(winWNode).toVar();
  const fH = float(floorHNode).toVar();

  // Room module (SkyscraperGenerator.js lines 959-975):
  // Each room spans an INTEGER 2 or 3 window bays wide (~5.4m - 8.1m) and an INTEGER bay phase
  // offset per floor so partition walls ALWAYS land behind masonry piers/mullions, never mid-window!
  const floorIdx = floor(v.div(fH)).toVar();
  const fHash1 = fract(sin(floorIdx.mul(41.3).add(seedNode)).mul(43758.5453));
  const fHash2 = fract(sin(floorIdx.mul(73.7).add(seedNode.mul(1.7))).mul(43758.5453));
  const roomBays = mix(float(2.0), float(3.0), step(0.5, fHash1)).toVar();
  const roomPhase = floor(fHash2.mul(roomBays)).toVar();

  const gridU = u.div(wW);
  const roomU = gridU.add(roomPhase).div(roomBays).toVar();
  const roomIdx = floor(roomU).toVar();
  const roomId = vec2(roomIdx, floorIdx).toVar();

  const roomW = wW.mul(roomBays).toVar();
  const roomH = fH.mul(0.92).toVar();
  const setback = float(0.12);
  const depth = roomH.mul(1.55).toVar();

  // Pixel entry position `origin` in world meters relative to the multi-bay room center:
  // Window sill (wUV.y=0) sits ~0.75m above the room floor; window lintel (wUV.y=1) sits ~0.58m below the ceiling
  const originX = fract(roomU).sub(0.5).mul(roomW).toVar();
  const originY = wUV.y.sub(0.46).mul(roomH.mul(0.62)).toVar();

  // View ray `dir` in world meters in the room's (across, up, depth) frame. `across` runs along the wall's tangent
  // (+x on walls facing ±z, +z on walls facing ±x, turning with walls that follow a non-grid street)
  const rayWorld = normalize(positionWorld.sub(cameraPosition)).toVar();
  const tSign = mix(sign(facadeWorldNormal.z).negate(), sign(facadeWorldNormal.x), facadeAlongZ);
  const dirX = dot(rayWorld, vec3(facadeWorldNormal.z.negate(), 0.0, facadeWorldNormal.x).mul(tSign)).toVar();
  const dirY = rayWorld.y.toVar();
  const dirZ = max(abs(dot(rayWorld, facadeWorldNormal)), 0.05).toVar();

  // Slab intersection with the far planes of the room box:
  // [-halfW .. +halfW] x [-halfH .. +halfH] x [setback .. setback + depth]
  const halfW = roomW.mul(0.5).toVar();
  const halfH = roomH.mul(0.5).toVar();
  const tFarX = halfW.sub(originX.mul(sign(dirX))).div(max(abs(dirX), 0.0001)).toVar();
  const tFarY = halfH.sub(originY.mul(sign(dirY))).div(max(abs(dirY), 0.0001)).toVar();
  const tFarZ = setback.add(depth).div(dirZ).toVar();
  const t = min(min(tFarX, tFarY), tFarZ).toVar();
  const hit = vec3(originX.add(dirX.mul(t)), originY.add(dirY.mul(t)), dirZ.mul(t)).toVar();

  // Normalized 0..1 coordinates inside the room box (SkyscraperGenerator.js line 1150)
  const q = clamp(
    vec3(
      hit.x.div(roomW).add(0.5),
      hit.y.div(roomH).add(0.5),
      hit.z.sub(setback).div(depth)
    ),
    vec3(0.0),
    vec3(1.0)
  ).toVar();

  const onBack = step(tFarZ, tFarX).mul(step(tFarZ, tFarY)).toVar();
  const isYPlane = step(tFarY, tFarX).mul(step(tFarY, tFarZ)).toVar();
  const onCeil = isYPlane.mul(step(0.0, dirY)).toVar();
  const onFloor = isYPlane.mul(float(1.0).sub(step(0.0, dirY))).toVar();

  // Per-room hashes & bulb temperature (SkyscraperGenerator.js lines 1162-1171)
  const seed1 = hash2D(roomId.add(vec2(seedNode, 19.4))).toVar();
  const seed2 = hash2D(roomId.add(vec2(seedNode.mul(1.9), 83.1))).toVar();
  const seed3 = hash2D(roomId.add(vec2(63.2, seedNode.mul(0.7)))).toVar();
  const lod = smoothstep(0.3, 0.8, max(fwNode.x, fwNode.y)).toVar();
  const litRoom = step(float(1.0).sub(litProbNode), seed3).toVar();
  const lit = mix(litRoom, 1.0, lod).toVar();

  const warmLight = mix(color(0xffb845), color(0xffe49c), seed1);
  const coolLight = mix(color(0xdfe8ff), color(0x9fb6ff), seed2);
  const lightCol = mix(coolLight, warmLight, step(float(1.0).sub(warmthNode), seed2)).toVar();

  // Room shell: muted plaster walls with skirting board, wood floorboards + rug, ceiling lamp, back-wall door & art
  const wallBase = mix(mix(color(0x9a8b73), color(0x6f7a82), seed1), color(0xb9ad97), seed2.mul(0.6)).toVar();
  const wallCol = mix(wallBase, wallBase.mul(0.5), smoothstep(0.06, 0.04, q.y)).toVar();

  const seam = step(0.92, fract(q.x.mul(7.0)));
  const boards = mix(color(0x4a3320), color(0x6a4c30), seed1).mul(float(1.0).sub(seam.mul(0.3)));
  const rug = mix(color(0x7a3b32), color(0x3a5760), seed2);
  const inRug = step(abs(q.x.sub(0.5)), 0.28).mul(step(abs(q.z.sub(0.58)), 0.25));
  const floorCol = mix(boards, rug, inRug.mul(0.88)).toVar();

  const lamp = smoothstep(0.18, 0.11, length(vec2(q.x.sub(0.5), q.z.sub(0.5)))).mul(float(1.0).sub(lod));
  const ceilBase = mix(wallBase, color(0xe8e2d5), 0.28);
  const ceilCol = mix(ceilBase, lightCol.mul(mix(float(0.85), float(3.8), lit)), lamp).toVar();

  const doorX = mix(float(0.24), float(0.76), seed1);
  const doorCol = mix(color(0x5a4631), color(0x39383c), step(0.5, seed2));
  const inDoor = step(abs(q.x.sub(doorX)), 0.09).mul(step(abs(q.y.sub(0.34)), 0.34));
  const picX = mix(float(0.72), float(0.28), step(0.5, seed1));
  const inPicFrame = step(abs(q.x.sub(picX)), 0.085).mul(step(abs(q.y.sub(0.56)), 0.095));
  const inPicCanvas = step(abs(q.x.sub(picX)), 0.065).mul(step(abs(q.y.sub(0.56)), 0.075));
  const picCol = mix(color(0x2c3a4a), color(0x7a5a3a), fract(seed1.add(seed2)));
  const backWithDoor = mix(wallCol, doorCol, inDoor);
  const backWithFrame = mix(backWithDoor, color(0x141210), inPicFrame);
  const backCol = mix(backWithFrame, picCol, inPicCanvas).toVar();

  const shellCol = mix(mix(mix(wallCol, floorCol, onFloor), ceilCol, onCeil), backCol, onBack).toVar();

  // Soft 3D corner ambient occlusion & depth falloff (SkyscraperGenerator.js lines 1176 & 1213-1216)
  const aoX = smoothstep(0.0, 0.16, q.x).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.x))).toVar();
  const aoY = smoothstep(0.0, 0.16, q.y).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.y))).toVar();
  const aoZ = smoothstep(0.0, 0.16, q.z).mul(smoothstep(0.0, 0.16, float(1.0).sub(q.z))).toVar();
  const edgeAO = mix(mix(aoY.mul(aoZ), aoX.mul(aoZ), isYPlane), aoX.mul(aoY), onBack);
  const shellAO = mix(float(0.66), float(1.0), edgeAO);
  const falloff = mix(float(1.0), float(0.42), q.z);
  const shadedRoom = shellCol.mul(shellAO).mul(falloff).toVar();

  // Curtains hung just inside the glass of each window opening (SkyscraperGenerator.js lines 1274-1302)
  // Parallax shift onto the curtain plane behind the glass
  const cUVx = clamp(wUV.x.add(dirX.div(dirZ).mul(0.06)), 0.0, 1.0).toVar();
  const wSeed1 = hash2D(cid.add(vec2(seedNode.mul(0.8), 41.2))).toVar();
  const wSeed2 = hash2D(cid.add(vec2(17.9, seedNode.mul(1.3)))).toVar();

  const sL = smoothstep(0.18, 1.0, wSeed1);
  const sR = smoothstep(0.18, 1.0, wSeed2);
  const lw = sL.mul(sL).mul(0.48); // Left drape width (0..48% of window width)
  const rw = sR.mul(sR).mul(0.48); // Right drape width (0..48% of window width)
  // Drape edges widen to the pixel footprint & pleats fade to their mean shade once they'd shrink below a few pixels
  const cFw = fwidth(cUVx).toVar();
  const drapeAA = cFw.add(0.015).toVar();
  const inLeftDrape = smoothstep(lw.add(drapeAA), lw.sub(drapeAA), cUVx).mul(step(0.03, lw));
  const inRightDrape = smoothstep(float(1.0).sub(rw).sub(drapeAA), float(1.0).sub(rw).add(drapeAA), cUVx).mul(step(0.03, rw));
  const inDrape = mix(clamp(max(inLeftDrape, inRightDrape), 0.0, 1.0), 0.29, lod).toVar(); // 0.29: mean drape coverage

  // Domestic curtain fabric palette (cream, taupe, warm grey, dusty blue, sage green, faded terracotta)
  const pick = fract(seed1.mul(5.7)).mul(5.0);
  const sw0 = mix(color(0xcabfa6), color(0xd8cdb8), seed2);
  const sw1 = mix(color(0x8a7a64), color(0x9b8c72), seed2);
  const sw2 = mix(color(0x5f7079), color(0x6f818b), seed2);
  const sw3 = mix(color(0x6c7558), color(0x79835f), seed2);
  const sw4 = mix(color(0x8c5a44), color(0x9a6a52), seed2);
  const fabric = mix(
    mix(mix(mix(sw0, sw1, step(1.0, pick)), sw2, step(2.0, pick)), sw3, step(3.0, pick)),
    sw4,
    step(4.0, pick)
  );
  const pleatWave = sin(cUVx.mul(48.0).add(wSeed1.mul(6.28))).mul(float(1.0).sub(smoothstep(0.6, 1.6, cFw.mul(48.0))));
  const pleat = pleatWave.mul(0.205).add(0.945);
  const drapeCol = fabric.mul(pleat).mul(0.92).toVar();

  // A drape only transmits a little of the room's glow (0.20), never out-glowing the interior!
  const bestCol = mix(shadedRoom, drapeCol, inDrape);
  const bestEmit = mix(float(1.0), float(0.20), inDrape);
  const roomWarmth = mix(vec3(1.0), lightCol, lit.mul(0.85));
  const finalRoomCol = bestCol.mul(roomWarmth).mul(mix(float(0.85), float(1.35), lit));

  const distantLit = distantWindowLight(vec2(gridU, v.div(fH)), fwNode, litProbNode, seedNode, lod);
  return vec4(finalRoomCol, mix(litRoom, distantLit, lod).mul(bestEmit));
});

// Post-rain puddle field (organic standing rainwater pools) shared by every road surface channel
function roadPuddleField(wx, wz) {
  const nMacro = noise2D(vec2(wx.mul(0.095), wz.mul(0.075)));
  const nMid = noise2D(vec2(wx.mul(0.25).add(19.4), wz.mul(0.22).add(11.8)));
  const nDetail = noise2D(vec2(wx.mul(0.68).sub(7.3), wz.mul(0.68).add(29.1)));
  return nMacro.mul(0.52).add(nMid.mul(0.34)).add(nDetail.mul(0.14));
}

/**
 * Wetness masks over a puddle field, driven by cityUniforms.uRoadWetness (0 = bone dry … 1 = right after a downpour):
 * x = damp stains (darker, satin), y = standing water (mirror-smooth; none on a dry day), z = wet film over everything.
 * Water collects in the field's highest (lowest-lying) spots first, so pools appear, grow & merge as wetness rises;
 * `drainage` raises the water line for better-drained surfaces such as the crowned sidewalk flags.
 */
function roadWetMasks(field, drainage = 0.0) {
  const w = cityUniforms.uRoadWetness;
  const level = mix(float(0.86), float(0.56), clamp(w.sub(0.1).div(0.55), 0.0, 1.0)).add(drainage);
  const damp = smoothstep(level.sub(0.09), level.sub(0.015), field);
  const puddle = smoothstep(level, level.add(0.022), field).mul(smoothstep(0.1, 0.22, w));
  const film = smoothstep(0.2, 0.8, w);
  return vec3(damp, puddle, film);
}

// Distance from p to the nearest border of its jittered 3x3 Voronoi cell (in cell units, ~(F2 - F1) / 2)
const voronoiBorder = Fn(([p]) => {
  const pv = vec2(p).toVar();
  const ip = floor(pv).toVar();
  const fp = fract(pv).toVar();
  const f1 = float(8.0).toVar();
  const f2 = float(8.0).toVar();
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const id = ip.add(vec2(i, j));
      const site = vec2(i, j).add(vec2(hash2D(id), hash2D(id.add(vec2(37.1, 11.7)))).mul(0.8).add(0.1));
      const d = length(fp.sub(site)).toVar();
      f2.assign(min(f2, max(f1, d)));
      f1.assign(min(f1, d));
    }
  }
  return f2.sub(f1).mul(0.5);
});

/**
 * Wear & repairs of the asphalt at world xz, `px` metres a pixel: x = hairline crack coverage (block & alligator
 * cracking in worn stretches), y = signed distance to the edge of a rectangular utility-cut patch (m, < 0 inside),
 * z = pothole depth (0 .. 1 at the bottom of the bowl), w = 1 where the 11 m cell has a patch.
 * Cracks are only traced near the camera and in the worn stretches, where they can show.
 */
const roadWear = Fn(([wxz, px]) => {
  // Worn stretches: about a quarter of the roadway, in patches a block or so across
  const worn = smoothstep(0.5, 0.78, noise2D(wxz.mul(0.045).add(71.0))).toVar();

  const crack = float(0.0).toVar();
  If(worn.greaterThan(0.001).and(px.lessThan(0.04)), () => {
    const warp = vec2(noise2D(wxz.mul(2.7)), noise2D(wxz.mul(2.7).add(13.0))).sub(0.5).mul(0.35);
    const cell = 0.55;
    const border = voronoiBorder(wxz.div(cell).add(warp)).mul(cell);
    const width = worn.mul(0.0016).add(0.0012);
    const effWidth = max(width, px.mul(0.6));
    crack.assign(float(1.0).sub(smoothstep(effWidth, effWidth.add(px), border)).mul(width.div(effWidth)).mul(worn)
      .mul(smoothstep(0.04, 0.015, px)));
  });

  // Rectangular utility-cut patches (ConEd, water & sewer trenches): one 11 m cell in two, kept inside its cell. Some
  // are squarish cuts, others long narrow trenches running along the avenue or across it
  const pCell = floor(wxz.div(11.0));
  const hasPatch = step(0.5, hash2D(pCell.add(vec2(3.7, 8.1))));
  const trench = step(0.6, hash2D(pCell.add(vec2(2.9, 6.3))));
  const alongX = step(0.5, hash2D(pCell.add(vec2(5.5, 9.9))));
  const pCentre = pCell.add(0.5).add(vec2(hash2D(pCell.add(vec2(1.3, 5.9))), hash2D(pCell.add(vec2(9.2, 2.4)))).sub(0.5)
    .mul(mix(float(0.4), float(0.08), trench))).mul(11.0);
  const cutHalf = vec2(hash2D(pCell.add(vec2(4.4, 0.6))).mul(1.8).add(0.6), hash2D(pCell.add(vec2(7.8, 3.1))).mul(1.4).add(0.5));
  const trenchLong = hash2D(pCell.add(vec2(0.7, 4.8))).mul(2.0).add(2.4);
  const trenchNarrow = hash2D(pCell.add(vec2(6.6, 7.2))).mul(0.25).add(0.3);
  const trenchHalf = mix(vec2(trenchNarrow, trenchLong), vec2(trenchLong, trenchNarrow), alongX);
  const pHalf = mix(cutHalf, trenchHalf, trench);
  const pq = abs(wxz.sub(pCentre)).sub(pHalf);
  const patchDist = max(pq.x, pq.y);

  // Potholes, mostly in the worn stretches: a ragged bowl a hand or two across
  const hCell = floor(wxz.div(7.0));
  const hCentre = hCell.add(vec2(hash2D(hCell.add(vec2(2.2, 7.7))), hash2D(hCell.add(vec2(6.1, 1.9)))).mul(0.6).add(0.2)).mul(7.0);
  const hRadius = hash2D(hCell.add(vec2(5.3, 4.2))).mul(0.24).add(0.12);
  const hDist = length(wxz.sub(hCentre)).mul(noise2D(wxz.mul(6.0)).sub(0.5).mul(0.5).add(1.0));
  const hasHole = step(float(0.975).sub(worn.mul(0.12)), hash2D(hCell.add(vec2(8.8, 0.3))));
  const pothole = smoothstep(hRadius.add(px), hRadius.mul(0.35), hDist).mul(hasHole);

  return vec4(crack.mul(float(1.0).sub(step(patchDist, 0.0).mul(hasPatch))), patchDist, pothole, hasPatch);
});

/**
 * "Tar snakes" at world xz, `px` metres a pixel: the meandering 3-5 cm bands of black crack sealant the city pours over
 * the wider cracks, in a broken network of ~2.4 m cells across sealed stretches of the roadway. Wide enough to read
 * from the car, so they are traced further than the hairline cracks, thinning out before they shrink below a pixel.
 */
const roadTarSnakes = Fn(([wxz, px]) => {
  const zone = smoothstep(0.3, 0.48, noise2D(wxz.mul(0.03).add(17.0))).toVar();
  const snake = float(0.0).toVar();
  If(zone.greaterThan(0.001).and(px.lessThan(0.12)), () => {
    const warp = vec2(noise2D(wxz.mul(0.9)), noise2D(wxz.mul(0.9).add(31.0))).sub(0.5).mul(0.6);
    const cell = 2.4;
    const border = voronoiBorder(wxz.div(cell).add(warp)).mul(cell);
    // Only some cracks were sealed: the network breaks up into runs a few metres long
    const keep = smoothstep(0.38, 0.5, noise2D(wxz.mul(0.6).add(5.0)));
    const width = noise2D(wxz.mul(1.7).add(9.0)).mul(0.012).add(0.014);
    const effWidth = max(width, px.mul(0.6));
    snake.assign(float(1.0).sub(smoothstep(effWidth, effWidth.add(px), border)).mul(width.div(effWidth)).mul(zone).mul(keep)
      .mul(smoothstep(0.12, 0.06, px)));
  });
  return snake;
});

/**
 * Unified Manhattan Roadway Asphalt, Footprint-Filtered Aggregate `bumpNormal`, Scattered Manholes, Wear & Repairs
 * (block cracking, tar-sealed utility-cut patches & trenches, potholes, tar snakes, oil drips, exposed stone chips, a
 * gentle swell of the paving; see roadWear & roadTarSnakes) & Post-Rain Wetness (upgraded with techniques from
 * CityGenerator.js `createRoadMaterial`).
 * cityUniforms.uRoadWetness drives damp stains, a faint wet sheen & standing puddles (roadWetMasks): bone dry at
 * midday, a few small pools at golden hour, glossy stains & pools mirroring the lights at night. Water's Fresnel rides
 * on metalness (as for the rivers), so puddles reflect the street through SSR at grazing angles yet only darken seen
 * from above.
 * Lane markings are separate geometry built from the road network (js/road-paint.js).
 */
function createRoadSurfaceMaterial() {
  const mat = new THREE.MeshStandardNodeMaterial({
    metalness: 0.24,
    roughness: 0.48
  });

  // Weathered, oxidised asphalt (fresh blacktop only in the newer patches)
  const cAsphaltDark = color(0x3d3f43);
  const cAsphaltLight = color(0x686a6e);
  const cManhole = color(0x4a433c);
  const cOldPatch = color(0x77787a);

  // World size of a pixel: fine texture settles to its mean before it can alias at grazing angles or from the air
  const pixelSize = length(fwidth(positionWorld.xz));
  // Cracks, utility-cut patches & potholes, shared by every channel below (see roadWear)
  const wear = roadWear(positionWorld.xz, pixelSize);
  const crack = wear.x;
  const patchDist = wear.y;
  const pothole = wear.z;
  const patchCover = smoothstep(pixelSize, pixelSize.negate(), patchDist).mul(wear.w);
  // The tar sealing the saw-cut edge of each patch, a few centimetres wide
  const sealWidth = max(float(0.022), pixelSize.mul(0.75));
  const patchSeal = float(1.0).sub(smoothstep(sealWidth, sealWidth.add(pixelSize), abs(patchDist))).mul(float(0.022).div(sealWidth)).mul(wear.w);
  // Fresh patches are darker & tighter than the roadway, old ones paler & greyer
  const patchFresh = step(0.55, hash2D(floor(positionWorld.xz.div(11.0)).add(vec2(12.9, 6.6))));
  // Exposed light stone chips in the worn surface, settling to their average where they shrink below a pixel
  const chips = mix(float(0.035), smoothstep(0.72, 0.8, noise2D(positionWorld.xz.mul(30.0))), smoothstep(0.03, 0.012, pixelSize));
  // Tar-snake crack sealant (none over the newer patches)
  const tarSnake = roadTarSnakes(positionWorld.xz, pixelSize).mul(float(1.0).sub(patchCover));
  // Oil & coolant drips from parked & idling cars: ragged dark blots a hand or two across, one 2.5 m cell in three
  const oilCell = floor(positionWorld.xz.div(2.5));
  const oilCentre = oilCell.add(vec2(hash2D(oilCell.add(vec2(4.1, 2.2))), hash2D(oilCell.add(vec2(8.3, 6.7)))).mul(0.6).add(0.2)).mul(2.5);
  const oilDist = length(positionWorld.xz.sub(oilCentre)).mul(noise2D(positionWorld.xz.mul(5.0)).sub(0.5).mul(0.8).add(1.0));
  const oilRadius = hash2D(oilCell.add(vec2(1.9, 9.4))).mul(0.25).add(0.1);
  const oilDrip = smoothstep(oilRadius.add(pixelSize), oilRadius.mul(0.3), oilDist).mul(step(0.66, hash2D(oilCell.add(vec2(7.7, 3.3)))))
    .mul(hash2D(oilCell.add(vec2(2.6, 5.1))).mul(0.6).add(0.4));

  // Circular cast-iron ConEd / NYC Sewer manhole covers scattered over the roadway (one 14 m cell in three)
  const mhCell = floor(positionWorld.xz.div(14.0));
  const mhCentre = mhCell.add(vec2(hash2D(mhCell.add(13.7)), hash2D(mhCell.add(29.1))).mul(0.6).add(0.2)).mul(14.0);
  const mhDist = length(positionWorld.xz.sub(mhCentre));
  const hasManhole = step(0.66, hash2D(mhCell));

  // Puddle field & wetness masks shared by every channel below (each node is generated once per fragment); potholes
  // hold water first
  const puddleField = roadPuddleField(positionWorld.x, positionWorld.z).add(pothole.mul(0.45));
  const wet = roadWetMasks(puddleField);
  const damp = wet.x;
  const puddle = wet.y;
  const film = wet.z;
  const viewDir = normalize(cameraPosition.sub(positionWorld));
  const waterFresnel = pow(float(1.0).sub(clamp(viewDir.y, 0.0, 1.0)), 5.0).mul(0.98).add(0.02);

  mat.aoNode = float(1);

  mat.colorNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const camDist = length(positionWorld.sub(cameraPosition));
    const detail = smoothstep(240.0, 22.0, camDist);

    // Two-scale aggregate grit, patchwork pours, oily wear stains & tar crack seams
    const microAggregate = mix(float(0.5), noise2D(vec2(wx.mul(16.0), wz.mul(16.0))), smoothstep(0.06, 0.02, pixelSize));
    const fineGrain = mix(float(0.5), noise2D(vec2(wx.mul(3.2), wz.mul(3.2))), smoothstep(0.4, 0.12, pixelSize));
    const patchNoise = noise2D(vec2(wx.mul(0.18), wz.mul(0.18)));
    const oilyStain = smoothstep(0.52, 0.84, noise2D(vec2(wx.mul(0.42), wz.mul(0.42)))).mul(detail);
    const tarSeam = float(1.0).sub(smoothstep(0.0, 0.04, abs(patchNoise.sub(0.52)))).mul(0.42).mul(detail);
    // Binder-rich (dark) & ravelled, aggregate-exposed (pale) mottling a stride or so across
    const mottle = noise2D(vec2(wx.mul(0.9), wz.mul(0.9)).add(41.0)).mul(0.65).add(noise2D(vec2(wx.mul(2.3), wz.mul(2.3)).add(7.0)).mul(0.35));

    const baseAsphalt = mix(
      cAsphaltDark,
      cAsphaltLight,
      fineGrain.mul(0.3).add(microAggregate.mul(0.22)).add(patchNoise.mul(0.22)).add(smoothstep(0.3, 0.7, mottle).mul(0.26)).sub(0.04)
    )
      .mul(float(1.0).sub(oilyStain.mul(0.32)))
      .mul(float(1.0).sub(tarSeam));

    // Utility-cut patches with their tar-sealed edges, stone chips, tar snakes, oil drips, cracks & potholes
    const patchCol = mix(mix(baseAsphalt, cOldPatch, 0.45).mul(1.08), color(0x2b2e33).mul(0.85), patchFresh);
    const repaired = mix(baseAsphalt, patchCol, patchCover)
      .mul(float(1.0).sub(patchSeal.mul(0.5)))
      .add(chips.mul(0.08).mul(float(1.0).sub(patchCover.mul(patchFresh))))
      .mul(float(1.0).sub(tarSnake.mul(0.62)))
      .mul(float(1.0).sub(oilDrip.mul(0.45)))
      .mul(float(1.0).sub(crack.mul(0.65)))
      .mul(float(1.0).sub(pothole.mul(0.4)));

    const isManhole = float(1.0).sub(smoothstep(0.52, 0.60, mhDist)).mul(hasManhole).mul(detail);
    const mhRings = sin(mhDist.mul(36.0)).mul(0.15).add(0.85);

    // Water filling the pores darkens the surface: damp stains & pools most, the overall wet film a little
    const wetDarkening = mix(mix(float(1.0), float(0.72), damp), float(0.6), puddle).mul(mix(float(1.0), float(0.8), film));
    return mix(repaired, cManhole.mul(mhRings), isManhole).mul(wetDarkening);
  })();

  mat.roughnessNode = Fn(() => {
    const microRough = mix(float(0.04), noise2D(positionWorld.xz.mul(12.0)).mul(0.08), smoothstep(0.08, 0.03, pixelSize));
    // Tar sealant is glossier, oil satin, fresh patches a little tighter, potholes & cracks rougher
    const dry = float(0.90).add(microRough)
      .sub(patchSeal.mul(0.3))
      .sub(tarSnake.mul(0.38))
      .sub(oilDrip.mul(0.18))
      .sub(patchCover.mul(patchFresh).mul(0.06))
      .add(pothole.mul(0.06));
    // The wet film only takes the edge off the asphalt's mattness (a soft sheen, too rough for SSR); real gloss is kept
    // for the damp stains and the standing water
    const filmed = mix(dry, float(0.68), film.mul(0.7));
    const wetRough = mix(filmed, float(0.4), damp.mul(0.85));
    return mix(wetRough, float(0.1), puddle);
  })();

  // Water's Fresnel (F0 = 0.02): weights SSR & trades diffuse for reflection in pools (fully), damp stains (partly) and
  // the wet film (barely)
  mat.metalnessNode = clamp(waterFresnel.mul(1.6), 0.0, 0.85).mul(max(puddle, max(damp.mul(0.35), film.mul(0.15))));

  // Footprint-gated asphalt relief via bumpNormal (from CityGenerator.js): a gentle swell & sag of the paving, shallow
  // ruts & ripples, 6 mm ravelled coarse texture + 2.2 mm & 1.6 mm aggregate grit, stone chips, hairline cracks, raised
  // patches with their tar seals, tar-snake beads, pothole bowls and the manhole covers' rims & rings. Steps ramp over
  // >= 2 px so no edge sparkles; the finest relief fades before it shrinks to a pixel. Flattens to mirror-smooth 0.0
  // inside standing rainwater puddles so SSR reflections stay crisp!
  mat.normalNode = Fn(() => {
    const wx = positionWorld.x;
    const wz = positionWorld.z;
    const coarseFade = smoothstep(0.12, 0.035, pixelSize);
    const midFade = smoothstep(0.035, 0.012, pixelSize);
    const fineFade = smoothstep(0.02, 0.006, pixelSize).mul(float(1.0).sub(film.mul(0.6)));
    const ramp = max(float(0.012), pixelSize.mul(2.0));

    const swell = noise2D(vec2(wx.mul(0.55), wz.mul(0.55)).add(23.0)).sub(0.5).mul(0.02)
      .add(noise2D(vec2(wx.mul(1.9), wz.mul(1.9))).sub(0.5).mul(0.005));
    const ripples = noise2D(vec2(wx.mul(3.6), wz.mul(3.6)).add(61.0)).sub(0.5).mul(0.004).mul(smoothstep(0.3, 0.1, pixelSize));
    const coarseGrit = noise2D(vec2(wx.mul(8.5), wz.mul(8.5))).sub(0.5).mul(0.006).mul(coarseFade);
    const midGrit = noise2D(vec2(wx.mul(19.0), wz.mul(19.0)).add(3.0)).sub(0.5).mul(0.0022).mul(midFade);
    const fineGrit = noise2D(vec2(wx.mul(36.0), wz.mul(36.0))).sub(0.5).mul(0.0016).mul(fineFade);
    const chipRelief = chips.mul(0.0015).mul(midFade);
    const snakeBead = tarSnake.mul(0.0018);
    const crackGroove = crack.mul(0.003).mul(smoothstep(0.012, 0.004, pixelSize));
    const patchStep = smoothstep(ramp, ramp.negate(), patchDist).mul(wear.w).mul(0.004);
    const sealBead = float(1.0).sub(smoothstep(0.0, max(float(0.03), ramp), abs(patchDist))).mul(wear.w).mul(0.0015);
    const bowl = pothole.mul(0.03);
    const mhRim = float(1.0).sub(smoothstep(0.0, max(float(0.02), ramp), abs(mhDist.sub(0.58)))).mul(0.004);
    const mhPattern = sin(mhDist.mul(36.0)).mul(0.0008).mul(step(mhDist, 0.54)).mul(smoothstep(0.01, 0.004, pixelSize));
    const manhole = mhPattern.sub(mhRim).mul(hasManhole).mul(coarseFade);

    const height = swell.add(ripples).add(coarseGrit).add(midGrit).add(fineGrit).add(chipRelief).add(snakeBead).sub(crackGroove)
      .add(patchStep).add(sealBead).sub(bowl).add(manhole);
    return bumpNormal(height.mul(float(1.0).sub(puddle)));
  })();

  mat.emissiveNode = vec3(0);

  return mat;
}


export {evaluateApartmentInterior,createRoadSurfaceMaterial,roadPuddleField,roadWetMasks};
