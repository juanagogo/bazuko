import * as THREE from 'three';

export const PEAK_ANGLE = -.205;
export const FIGURE_ANGLE = Math.PI / 30;

const TAU = Math.PI * 2;
const SEGMENTS = 240;
const RUN = 340;
const FRONT_ROWS = [0, .08, .17, .26, .36, .46, .57, .68, .8, .9, 1, 1.22, 1.48, 1.7];
const BACK_ROWS = [0, .45, .76, 1, 1.36];
const smooth = (start, end, x) => THREE.MathUtils.smoothstep(x, start, end);
const lerp = THREE.MathUtils.lerp;
const bell = (angle, center, width) => Math.exp(-(((angle - center) / width) ** 2));
const easternSlope = angle => smooth(.44, .87, Math.cos(angle));

function ridgeHeight(angle) {
  const east = Math.max(0, Math.cos(angle)), south = Math.max(0, Math.sin(angle)),
    west = Math.max(0, -Math.cos(angle)), north = Math.max(0, -Math.sin(angle));
  const base = 40 + 58 * east ** 1.2 + 72 * south ** 1.6 + 34 * west ** 2 + 6 * north;
  // El ruido de la cresta cierra suavemente al occidente, donde se unen los extremos del anillo.
  const seam = 1 - smooth(2.7, Math.PI, Math.abs(angle));
  const noise = seam * (Math.sin(angle * 7.3 + 1) * 8 + Math.sin(angle * 17.1 + 2.1) * 4.6
    + Math.sin(angle * 41.7) * 1.8 + Math.sin(angle * 3.1) * 7);
  const peaks = 62 * bell(angle, PEAK_ANGLE, .082) + 56 * bell(angle, FIGURE_ANGLE, .092);
  // Lomos desiguales hacia Chapinero y San Cristóbal, y el boquerón del Vicachá entre los santuarios.
  const shoulders = 24 * bell(angle, -.69, .18) + 23 * bell(angle, -.34, .095)
    + 24 * bell(angle, .25, .15) + 28 * bell(angle, .55, .17);
  const notch = 26 * bell(angle, -.058, .085);
  const anchors = 1 - Math.max(bell(angle, PEAK_ANGLE, .048), bell(angle, FIGURE_ANGLE, .044));
  return base + noise + peaks + (shoulders - notch) * anchors * easternSlope(angle);
}

function createSurface(ringAt) {
  return (angle, t) => {
    const radius = ringAt(angle) + t * RUN;
    const east = easternSlope(angle);
    const lift = t <= 1 ? t ** 1.45 : Math.max(.35, 1 - (t - 1) * .6);
    const wrinkles = Math.sin(angle * 61 + t * 9) * 3.2 + Math.sin(angle * 131 - t * 5) * 1.6;
    const folds = wrinkles * Math.min(1, t * 2.4) * (t <= 1 ? 1 : .4);
    const midSlope = smooth(.055, .39, t) * (1 - smooth(.71, 1, t)) * east;
    // Los cauces giran mientras bajan. Un ramal se junta con el Vicachá hacia el piedemonte.
    const main = -.06 + .054 * Math.sin((1 - t) * 2.8);
    const water = Math.min(1, bell(angle, main, .031 + .023 * (1 - t))
      + .72 * bell(angle, main - .15 * t, .036)
      + .8 * bell(angle, -.49 + .072 * Math.sin(t * 3.4), .048)
      + .83 * bell(angle, .38 - .105 * Math.sin(t * 2.7), .051));
    const spurs = 24 * bell(angle, -.34 + .12 * t, .125)
      + 18 * bell(angle, .18 + .13 * t, .16) + 16 * bell(angle, -.74 + .2 * t, .13);
    const erosion = midSlope * water;
    const slope = ridgeHeight(angle) * lift + folds - 2;
    const cut = erosion * Math.min(36, Math.max(0, slope) * .64);
    const y = slope + midSlope * spurs - cut;
    return { radius, y: Math.max(.5, y), erosion };
  };
}

function vegetation(angle, t, y, erosion) {
  const thicket = smooth(0, .39, t);
  const mosaic = .5 + .5 * Math.sin(angle * 26 + t * 15) * Math.sin(angle * 13 - t * 6);
  // Pajonal y matorral se abren en zonas de la cresta. En el sur las pendientes bajas tienen tierra
  // de los barrios; los cauces ganan vegetación oscura entre los lomos.
  const scrub = smooth(99 + mosaic * 16, 148 + mosaic * 16, y) * (.55 + .45 * mosaic);
  const settlement = bell(angle, Math.PI / 2, .56) * (1 - smooth(.46, .77, t));
  const wet = erosion * .44;
  const canopy = (1 - .74 * scrub) * (1 - .84 * settlement);
  const green = .206 + mosaic * .047;
  const r = lerp(lerp(lerp(.225, .15, thicket), .347, scrub), .39, settlement);
  const g = lerp(lerp(lerp(.269, green, thicket), .336, scrub), .294, settlement);
  const b = lerp(lerp(lerp(.194, .141, thicket), .221, scrub), .224, settlement);
  return [r * (1 - wet), g * (1 - wet * .65), b * (1 - wet * .35), canopy];
}

function frontAngles() {
  const angles = [];
  const step = TAU / SEGMENTS;
  for (let i = 0; i < SEGMENTS; i++) {
    const angle = -Math.PI + i * step;
    // Una fila pasa exactamente por cada santuario. El muestreo extra queda en las laderas orientales.
    if (Math.abs(angle - PEAK_ANGLE) < step / 2) angles.push(PEAK_ANGLE);
    else if (Math.abs(angle - FIGURE_ANGLE) < step / 2) angles.push(FIGURE_ANGLE);
    else angles.push(angle);
    if (angle > -1.08 && angle < 1.04) angles.push(angle + step / 2);
  }
  return angles;
}

/** Altura de la cara visible del cerro, interpolada en los mismos triángulos que dibuja el anillo. */
function frontSurface(position, start, angles, stride, cx, cz) {
  const triangle = (x, z, a, b, c) => {
    a *= 3; b *= 3; c *= 3;
    const ax = position[a], az = position[a + 2];
    const bx = position[b] - ax, bz = position[b + 2] - az;
    const cx0 = position[c] - ax, cz0 = position[c + 2] - az;
    const area = bx * cz0 - bz * cx0;
    const u = ((x - ax) * cz0 - (z - az) * cx0) / area;
    const v = (bx * (z - az) - bz * (x - ax)) / area;
    if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) return null;
    return position[a + 1] * (1 - u - v) + position[b + 1] * u + position[c + 1] * v;
  };
  const sectorAt = angle => {
    let low = 0, high = angles.length;
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (angles[middle] <= angle) low = middle;
      else high = middle;
    }
    return low;
  };
  const heightAt = (x, z) => {
    const sector = sectorAt(Math.atan2(z - cz, x - cx));
    const a = start + sector * stride, b = start + ((sector + 1) % angles.length) * stride;
    for (let row = 0; row < stride - 1; row++) {
      const left = a + row, right = b + row;
      const y = triangle(x, z, left, right, left + 1) ?? triangle(x, z, right, right + 1, left + 1);
      if (y !== null) return y;
    }
    return null;
  };
  // Las cintas se recortan por las fronteras de los triángulos, así sus paños siguen cada quiebre de la ladera.
  const forEachFrontTriangle = (x0, z0, x1, z1, visit) => {
    const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => Math.atan2(z - cz, x - cx));
    const low = Math.min(...corners), high = Math.max(...corners), crossesSeam = high - low > Math.PI;
    const first = crossesSeam ? 0 : sectorAt(low), last = crossesSeam ? angles.length - 1 : sectorAt(high);
    const add = (a, b, c) => {
      a *= 3; b *= 3; c *= 3;
      if (Math.max(position[a], position[b], position[c]) < x0 || Math.min(position[a], position[b], position[c]) > x1
        || Math.max(position[a + 2], position[b + 2], position[c + 2]) < z0
        || Math.min(position[a + 2], position[b + 2], position[c + 2]) > z1) return;
      visit([a, b, c].map(i => [position[i], position[i + 1], position[i + 2]]));
    };
    for (let sector = first; sector <= last; sector++) {
      const a = start + sector * stride, b = start + ((sector + 1) % angles.length) * stride;
      for (let row = 0; row < stride - 1; row++) {
        const left = a + row, right = b + row;
        add(left, right, left + 1);
        add(right, right + 1, left + 1);
      }
    }
  };
  return { heightAt, forEachFrontTriangle };
}

function distantSurface(angle, t, ringAt) {
  // Cordón detrás del boquerón, con falda, cumbre y contrapendiente. Cambia de profundidad
  // para que se abra entre los picos conforme la cámara se mueve por la ciudad.
  const setback = Math.cos(angle * 3 + .5) * 67 + Math.sin(angle * 7) * 29;
  const radius = ringAt(angle) + 1050 + setback + (t - 1) * 370;
  const east = Math.max(0, Math.cos(angle)), south = Math.max(0, Math.sin(angle));
  const ridge = 48 + 108 * east ** 1.3 + 115 * south ** 1.5
    + 36 * bell(angle, -.07, .21) + 31 * bell(angle, .56, .23)
    + 19 * bell(angle, -.137, .044) + 12 * bell(angle, .01, .047) - 9 * bell(angle, -.054, .03)
    + Math.sin(angle * 9 + 2) * 14 + Math.sin(angle * 31) * 6;
  const lift = t <= 1 ? t ** 1.31 : 1 - (t - 1) * 1.3;
  return { radius, y: 1 + ridge * lift };
}

export function buildBackdropTerrain({ width, height, corridors }) {
  const cx = width / 2, cz = height / 2;
  const hx = cx + RUN, hzNorth = cz + 300, hzSouth = cz + 190;
  // El sur queda más cerca para que la ladera con su barrio se vea encima de la ciudad baja.
  const ringAt = angle => 1 / Math.hypot(Math.cos(angle) / hx, Math.sin(angle) / (angle > 0 ? hzSouth : hzNorth));
  const surface = createSurface(ringAt);
  const position = [], color = [], terrainCover = [], index = [];
  const push = (x, y, z, r, g, b, canopy = 0, distant = 0) => {
    position.push(x, y, z);
    color.push(r, g, b);
    terrainCover.push(canopy, distant);
    return position.length / 3 - 1;
  };
  const rect = (x0, z0, x1, z1, [r, g, b], y = -.04) => {
    const a = push(x0, y, z0, r, g, b), b0 = push(x1, y, z0, r, g, b);
    const c = push(x1, y, z1, r, g, b), d = push(x0, y, z1, r, g, b);
    index.push(a, d, c, a, c, b0);
  };
  const FAR = 3200, GROUND = [.2, .205, .205];
  // La franja de muro no tiene suelo propio: el anillo la cubre hasta el primer tile interior.
  rect(-FAR, -FAR, width + FAR, 1, GROUND);
  rect(-FAR, height - 1, width + FAR, height + FAR, GROUND);
  rect(-FAR, 1, 1, height - 1, GROUND);
  rect(width - 1, 1, width + FAR, height - 1, GROUND);
  for (const c of corridors) {
    rect(c.x0, c.z0, c.x1, c.z1, [.17, .175, .18], -.03);
    const side = c.alongX ? 'z' : 'x';
    for (const edge of [0, 1]) {
      const a = side === 'z' ? (edge ? c.z1 : c.z0 - 3) : (edge ? c.x1 : c.x0 - 3);
      if (side === 'z') rect(c.x0, a, c.x1, a + 3, [.38, .37, .34], -.02);
      else rect(a, c.z0, a + 3, c.z1, [.38, .37, .34], -.02);
    }
  }

  const groundIndices = index.length;
  function ring(angles, rows, add) {
    const start = position.length / 3, stride = rows.length;
    for (const angle of angles) {
      const dx = Math.cos(angle), dz = Math.sin(angle);
      for (const t of rows) add(angle, t, dx, dz);
    }
    // Soldar la última fila con la primera mantiene continuas también sus normales.
    for (let s = 0; s < angles.length; s++) for (let j = 0; j < stride - 1; j++) {
      const a = start + s * stride + j, b = start + ((s + 1) % angles.length) * stride + j;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const angles = frontAngles(), frontStart = position.length / 3;
  ring(angles, FRONT_ROWS, (angle, t, dx, dz) => {
    const { radius, y, erosion } = surface(angle, t);
    const [r, g, b, canopy] = vegetation(angle, t, y, erosion);
    push(cx + dx * radius, y, cz + dz * radius, r, g, b, canopy);
  });
  const farAngles = Array.from({ length: SEGMENTS / 2 }, (_, i) => -Math.PI + i * TAU / (SEGMENTS / 2));
  ring(farAngles, BACK_ROWS, (angle, t, dx, dz) => {
    const { radius, y } = distantSurface(angle, t, ringAt);
    push(cx + dx * radius, y, cz + dz * radius, .27, .312, .318, 0, 1);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  geometry.setAttribute('terrainCover', new THREE.Float32BufferAttribute(terrainCover, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.addGroup(0, groundIndices, 0);
  geometry.addGroup(groundIndices, index.length - groundIndices, 1);
  const support = frontSurface(geometry.attributes.position.array, frontStart, angles, FRONT_ROWS.length, cx, cz);
  return { geometry, surface, ...support, cx, cz, foot: { cx, cz, hx, hzNorth, hzSouth } };
}
