const BRICK = [[.57, .29, .185], [.66, .38, .23], [.46, .23, .16], [.59, .32, .225], [.53, .26, .185]];
const PLASTER = [[.72, .635, .48], [.59, .64, .53], [.52, .58, .59], [.65, .46, .36], [.73, .71, .64]];
const COLONIAL = [[.71, .57, .39], [.63, .64, .51], [.7, .65, .54], [.57, .45, .37], [.52, .595, .64]];
const CLAY = [[.46, .205, .112], [.54, .254, .147], [.54, .278, .191]];
const METAL = [[.305, .305, .286], [.39, .372, .334], [.29, .32, .315]];

export function frontageOf(entry, width, height) {
  if (entry.y !== undefined || entry.closedOnly) return 0;
  if (entry.z > height - 4 && entry.z < height + 116 && entry.x > -48 && entry.x < 281) return 1;
  if (entry.x > width - 4 && entry.x < width + 112 && entry.z > 22 && entry.z < 143) return 2;
  return 0;
}

function roof(parts, body, tx, tz, rise, color, clay) {
  for (const side of [-1, 1]) {
    const offset = side * body.d / 4;
    parts.push({ x: body.x - tz * offset, z: body.z + tx * offset, y: body.h - .11, w: body.w, d: body.d / 2,
      h: rise, color, rotation: body.rotation, frontage: [4, 0, -side, Number(clay)] });
  }
}

// El borde se conserva primero, después la prolongación de calles y al final la retícula. Al coincidir
// dos orígenes, se aprovecha la parte sobrante para que no se dibujen dos fachadas en el mismo plano.
function reserveLot(block, occupied) {
  let rect = { x0: block.x - block.w / 2, x1: block.x + block.w / 2, z0: block.z - block.d / 2, z1: block.z + block.d / 2 };
  for (const prior of occupied) {
    if (rect.x1 <= prior.x0 || rect.x0 >= prior.x1 || rect.z1 <= prior.z0 || rect.z0 >= prior.z1) continue;
    const remainders = [
      { ...rect, x1: prior.x0 - .09 }, { ...rect, x0: prior.x1 + .09 },
      { ...rect, z1: prior.z0 - .09 }, { ...rect, z0: prior.z1 + .09 }
    ];
    let largest = 0, best = null;
    for (const remainder of remainders) {
      const w = remainder.x1 - remainder.x0, d = remainder.z1 - remainder.z0;
      if (w < 3.65 || d < 3.65 || w * d <= largest) continue;
      best = remainder;
      largest = w * d;
    }
    if (!best) return null;
    rect = best;
  }
  occupied.push(rect);
  return { x: (rect.x0 + rect.x1) / 2, z: (rect.z0 + rect.z1) / 2, w: rect.x1 - rect.x0, d: rect.z1 - rect.z0 };
}

/** Predios de las dos transiciones cercanas. Todas las divisiones caben en la huella y altura de la manzana. */
export function dressBackdropFrontages(entries, width, height, hash) {
  const occupied = [];
  return entries.flatMap(entry => {
    const region = frontageOf(entry, width, height);
    if (!region) return entry;
    const lot = reserveLot(entry, occupied);
    if (!lot) return [];
    const east = region === 2, rotation = entry.streetSide ?? (east ? Math.PI / 2 : 0);
    const tx = Math.cos(rotation), tz = -Math.sin(rotation), acrossX = Math.abs(tx) > .5;
    const span = acrossX ? lot.w : lot.d, deep = acrossX ? lot.d : lot.w;
    const count = Math.min(4, Math.max(1, Math.ceil(span / (east ? 8.5 : 10.3))));
    const district = hash(Math.floor(entry.x / 34), Math.floor(entry.z / 31), 70);
    const x = Math.round(entry.x * 10), z = Math.round(entry.z * 10);
    const parts = [], pitch = span / count;
    let previous = -span / 2;
    for (let i = 0; i < count; i++) {
      const seed = (salt) => hash(x + i * 17, z + i * 9, 71 + salt);
      const next = i + 1 === count ? span / 2 : -span / 2 + pitch * (i + 1 + (seed(1) - .5) * .34);
      const center = (previous + next) / 2, w = next - previous - .12;
      previous = next;
      const kind = east && seed(2) < .76 ? 3 : (!east && seed(3) < .28 ? 2 : 1);
      const clay = kind === 3, pitched = clay || seed(4) < .19;
      const rise = pitched ? Math.min((clay ? .95 : .5) + seed(5) * .64, entry.h * .18) : 0;
      const d = deep * (.84 + seed(6) * .155), setback = (deep - d) / 2;
      const floor = (clay ? 2.86 : 2.66) + seed(7) * .32;
      const fits = Math.max(1, Math.floor((entry.h - rise - .16) / floor + .1));
      const floors = Math.max(1, Math.min(fits - Number(fits > 2 && seed(8) < .48), clay ? 3 : 4));
      const h = Math.min(entry.h - rise, floor * floors + .18 + seed(9) * .35);
      const plastered = clay || seed(10) < .19 + .35 * district;
      const palette = clay ? COLONIAL : plastered ? PLASTER : BRICK;
      const color = palette[Math.floor(seed(11) * palette.length)];
      const endToPark = !east && !acrossX && (tz < 0 ? i === count - 1 : i === 0)
        && lot.z - lot.d / 2 < height + 25 && entry.streetSide !== undefined;
      const flank = endToPark ? -Math.sign(tz) : 0;
      // Tipo, altura de piso, cara expuesta y acabado. El acabado guarda el pañete en la parte entera y el tono en la fracción.
      // En cubiertas los últimos dos canales dan la pendiente y la teja.
      const body = { x: lot.x + tx * center + tz * setback, z: lot.z + tz * center - tx * setback, w, d, h, color, rotation,
        frontage: [kind, floor, flank, Number(plastered) + seed(12)] };
      if (endToPark && d > 13 && h > 4.2) {
        // La cabecera larga da al parque. Un cuerpo bajo de servicios rompe el costado y deja ver el cambio de azotea.
        const mainDepth = d * (.53 + seed(17) * .11), behind = (mainDepth + .18) / 2;
        const annexColor = color.map((channel, c) => channel * .71 + [.142, .13, .113][c]);
        parts.push({ ...body, x: body.x - tz * behind, z: body.z + tx * behind, w: w * .96, d: d - mainDepth - .18,
          h: h - .81 - seed(18) * .94, color: annexColor, frontage: [1, floor, flank, Number(plastered) + seed(19)] });
        body.x += tz * (d - mainDepth) / 2;
        body.z -= tx * (d - mainDepth) / 2;
        body.d = mainDepth;
      }
      parts.push(body);
      if (pitched) {
        const finishes = clay ? CLAY : METAL;
        roof(parts, body, tx, tz, rise, finishes[Math.floor(seed(13) * finishes.length)], clay);
      } else if (h > 6 && entry.h - h > .65 && seed(13) < .37) {
        const offset = (seed(14) - .5) * body.d * .39;
        parts.push({ x: body.x - tz * offset, z: body.z + tx * offset, y: h - .1, w: w * (.38 + seed(15) * .22),
          d: body.d * .29, h: Math.min(entry.h - h, .68 + seed(16) * .86), color: METAL[1], rotation, frontage: [4, 0, 0, 0] });
      }
    }
    return parts;
  });
}

// Detalle métrico común a las fachadas cercanas. La anchura de la huella borra juntas finas y marcos a distancia.
export const BACKDROP_FRONTAGE_GLSL = /* glsl */`
  float facadeBand(float x, float lo, float hi, float fringe) {
    return smoothstep(lo - fringe, lo + fringe, x) * (1. - smoothstep(hi - fringe, hi + fringe, x));
  }

  vec3 frontageColor(vec3 wall, vec3 n, float night, out vec3 glow) {
    float kind = vBlockFrontage.x;
    float colonial = step(2.5, kind) * (1. - step(3.5, kind));
    float shop = step(1.5, kind) * (1. - step(2.5, kind));
    float finish = vBlockFrontage.w;
    glow = vec3(0.);
    if (kind > 3.5) {
      // Las tejas y la lámina conservan su dirección en las dos aguas.
      vec2 r = vBlockMeters.xz;
      vec2 grooves = r / vec2(mix(.25, .39, finish), .32);
      grooves.x += floor(grooves.y) * .48 * finish;
      float clarity = 1. - smoothstep(.24, .92, max(fwidth(grooves.x), fwidth(grooves.y)));
      float ribs = .83 + .15 * smoothstep(.1, .65, fract(grooves.x)) - .08 * finish * step(.88, fract(grooves.y));
      float stains = .9 + .18 * blockNoise(r / 2.1 + vBlockSeed * 51.);
      return wall * stains * (n.y > .5 ? mix(1., ribs, clarity) : .63);
    }
    if (n.y > .5) {
      vec2 r = vBlockMeters.xz;
      float edge = min(min(r.x, vBlockSize.x - r.x), min(r.y, vBlockSize.y - r.y));
      float fade = clamp(max(fwidth(r.x), fwidth(r.y)), 0., 1.);
      float brim = 1. - smoothstep(.16, .27 + fade, edge);
      float lee = facadeBand(edge, .23, .65, fade);
      vec3 slab = mix(vec3(.29, .275, .243), vec3(.45, .428, .38), vBlockSeed);
      slab *= (.84 + .29 * blockNoise(r / 2.8 + vBlockSeed * 67.)) * (1. - .24 * lee);
      return mix(slab, wall * .9, brim * (1. - fade));
    }
    bool side = abs(n.x) > .5;
    vec2 m = side ? vBlockMeters.zy : vBlockMeters.xy;
    float tendency = fract(finish), plaster = step(1., finish);
    float openFlank = step(.5, n.x * vBlockFrontage.z);
    float facade = n.z < -.5 ? 1. : n.z > .5 ? .62 : max(.92 * openFlank, step(.79, tendency) * .7);
    vec2 scale = vec2(mix(2.36, 2.7, colonial) + vBlockSeed * .31, vBlockFrontage.y);
    vec2 cell = m / scale;
    vec2 id = floor(cell), f = fract(cell), d = max(fwidth(cell) * .62, vec2(.005));
    float lod = smoothstep(.14, .73, max(d.x, d.y));
    float rhythm = blockHash(vec2(id.x + 3., 11. + vBlockSeed * 28.));
    float narrow = mix(.18, .28, rhythm) * (1. - colonial * .27);
    float h0 = mix(.31, .25, colonial), h1 = mix(.74, .82, colonial);
    float mid = .5 + (rhythm - .5) * .12;
    float foot = 1. - step(.5, id.y), first = 1. - step(.5, id.x);
    float openings = facade * mix(1., step(.25 + .21 * foot, rhythm), openFlank);
    // En la planta baja se distinguen los accesos de vivienda y los vanos más amplios del local de esquina.
    mid = mix(mid, .45, foot * first * (1. - shop));
    narrow = mix(narrow, .38, foot * shop);
    h0 = mix(h0, .065, foot * max(first, shop));
    h1 = mix(h1, .78, foot);
    float opening = facadeBand(f.x, mid - narrow, mid + narrow, d.x) * facadeBand(f.y, h0, h1, d.y);
    float frame = facadeBand(f.x, mid - narrow - .035, mid + narrow + .035, d.x)
      * facadeBand(f.y, h0 - .039, h1 + .036, d.y);
    float lintel = facadeBand(f.y, h1, h1 + .051, d.y) * facadeBand(f.x, mid - narrow - .04, mid + narrow + .04, d.x);
    float sill = facadeBand(f.y, h0 - .046, h0 - .003, d.y) * frame;
    float stand = mix(.93, .99, rhythm), limestone = .88 + .17 * blockNoise(m / vec2(1.1, .78) + vBlockSeed * 27.);
    vec2 brick = m / vec2(.305, .115);
    float joints = 1. - smoothstep(.32, 1.01, max(fwidth(brick.x), fwidth(brick.y)));
    brick.x += floor(brick.y) * .5;
    float units = .88 + .17 * blockHash(floor(brick) + vBlockSeed * 45.);
    float mortar = 1. - smoothstep(.035, .11, min(fract(brick.x), fract(brick.y)));
    vec3 medianera = mix(wall, vec3(.49, .32, .245), .64) * (.87 + .15 * blockNoise(m / 2.2 + 3.));
    vec3 material = mix(medianera, wall * limestone * stand, facade);
    material *= 1. - (.12 + .03 * colonial) * (1. - smoothstep(.22, .98, m.y));
    float brickFinish = 1. - plaster * smoothstep(.42, .69, facade);
    material *= mix(1., mix(units, .74, mortar), joints * brickFinish);
    float belt = facadeBand(f.y, .02, .056, d.y) * facade * (1. - lod);
    material *= 1. - belt * (.19 - colonial * .11);
    vec3 trim = mix(wall * .63, vec3(.69, .63, .52), .48 + colonial * .35);
    material = mix(material, trim, frame * openings * (1. - lod) * .86);
    material = mix(material, trim * 1.06, sill * openings * (1. - lod));
    material = mix(material, material * .67, lintel * openings * (1. - lod));
    float mullion = 1. - smoothstep(.012, .02 + d.x, abs(f.x - mid));
    float crossbar = 1. - smoothstep(.007, .012 + d.y, abs(f.y - mix(.55, .62, colonial)));
    vec3 glass = mix(vec3(.083, .113, .128), vec3(.19, .233, .236), blockHash(id + vBlockSeed * 19.));
    glass = mix(glass, mix(vec3(.29, .24, .186), vec3(.2, .245, .228), tendency), max(mullion, crossbar) * (1. - lod));
    glass = mix(glass, vec3(.198, .164, .126), foot * first * (1. - shop) * .73);
    float cover = mix(opening, .16 + .09 * shop, lod) * openings;
    float lightMask = step(.59 + .1 * shop, blockHash(id + vBlockSeed * 31.));
    glow = vec3(.8, .55, .29) * cover * lightMask * night * .57;
    float sideLight = mix(n.z < -.5 ? .86 : n.z > .5 ? .98 : n.x < -.5 ? .83 : .7, .9, openFlank);
    return mix(material, glass, cover) * sideLight;
  }
`;
