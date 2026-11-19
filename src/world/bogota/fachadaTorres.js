import * as THREE from 'three';
import { azarPropio, sinGastarAzar, lienzo } from './concretoViaducto.js';

// Fachada de las torres de barrio. Una baldosa cubre 4 vanos de 3 m por 8 pisos de 3,2 m y se repite.
// Los cinco diseños comparten el reparto de cortinas y persianas, el brillo del vidrio y la luz de noche;
// la luz cubre 2 × 2 baldosas para que una torre alta no repita el mismo dibujo cada ocho pisos.

export const BALDOSA = Object.freeze({ vanos: 4, pisos: 8, vano: 3, piso: 3.2, ancho: 12, alto: 25.6 });
export const LUZ = Object.freeze({ vanos: 8, pisos: 16, encendidos: .26, sueltas: .04, brillo: 1.3 });
// La ventana dentro de su vano y de su piso (fracciones): coincide con los vanos de bulto de los primeros pisos.
const X0 = .235, AN = .53, Y0 = .29, AL = .5;
const COLOR = [320, 640], BRILLO = [128, 256], NOCHE = [256, 512];
const PAREDES = ['#975c40', '#b6b3a8', '#c3b8a5', '#857c70', '#687d81'];
const TELAS = ['#d2cdc2', '#a9b4c4'];
const CALIDA = [255, 180, 95], FRIA = [207, 232, 220], TELE = [124, 152, 204];

let reparto;
/** Qué hay detrás de cada vidrio y qué ventanas se prenden de noche. No usa lienzo ni gasta azar. */
export function repartoDeTorres() {
  if (reparto) return reparto;
  const rnd = azarPropio(0x70aa3e5), vestido = [], luces = [];
  for (let p = 0; p < BALDOSA.pisos; p++) for (let v = 0; v < BALDOSA.vanos; v++) {
    const que = rnd(), tela = TELAS[rnd() < .6 ? 0 : 1], ancho = .3 + rnd() * .4, lado = rnd() < .5 ? 0 : 1, caida = .3 + rnd() * .6;
    vestido.push({ p, v, tono: rnd(), reflejo: rnd() < .4 ? .1 + rnd() * .5 : -1,
      cortina: que < .22 ? { tela, ancho, lado } : null, persiana: que >= .22 && que < .34 ? caida : 0 });
  }
  // Se prende por apartamentos: dos vanos seguidos de un mismo piso.
  const apartamentos = [];
  for (let p = 0; p < LUZ.pisos; p++) for (let v = 0; v < LUZ.vanos; v += 2) apartamentos.push([p, v]);
  for (let i = apartamentos.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [apartamentos[i], apartamentos[j]] = [apartamentos[j], apartamentos[i]];
  }
  const prendidos = Math.round(apartamentos.length * LUZ.encendidos), ocupada = new Set();
  for (let i = 0; i < prendidos; i++) {
    const [p, v] = apartamentos[i], parte = i / prendidos;
    const color = parte < .55 ? CALIDA : parte < .8 ? FRIA : TELE;
    const fuerza = color === TELE ? .5 + rnd() * .15 : .55 + rnd() * .45, unaSola = rnd() < .25 ? Math.floor(rnd() * 2) : -1;
    for (let k = 0; k < 2; k++) {
      ocupada.add(p * LUZ.vanos + v + k);
      if (unaSola < 0 || unaSola === k) luces.push({ p, v: v + k, color, fuerza: fuerza * (.85 + rnd() * .15) });
    }
  }
  for (let quedan = Math.round(LUZ.vanos * LUZ.pisos * LUZ.sueltas), tope = 400; quedan > 0 && tope > 0; tope--) {
    const p = Math.floor(rnd() * LUZ.pisos), v = Math.floor(rnd() * LUZ.vanos);
    if (ocupada.has(p * LUZ.vanos + v)) continue;
    ocupada.add(p * LUZ.vanos + v);
    luces.push({ p, v, color: CALIDA, fuerza: .35 + rnd() * .25 });
    quedan--;
  }
  reparto = { vestido, luces };
  return reparto;
}

const hueco = (w, vano, piso, alto) => [(w.v + X0) * vano, alto - (w.p + Y0 + AL) * piso, AN * vano, AL * piso];

/** Vetas de lluvia y polvo: claras y oscuras, verticales, que no se cortan al repetir la baldosa. */
function vetas(ctx, rnd, ancho, alto, cuantas) {
  for (let i = 0; i < cuantas; i++) {
    ctx.fillStyle = rnd() < .45 ? `rgba(232,226,210,${.03 + rnd() * .06})` : `rgba(52,48,40,${.04 + rnd() * .08})`;
    const x = rnd() * ancho, y = rnd() * alto, w = 1 + rnd() * 3, h = 16 + rnd() * 110;
    ctx.fillRect(x, y, w, h); ctx.fillRect(x, y - alto, w, h);
  }
}

function pared(ctx, diseno, rnd, ancho, alto, vano, piso) {
  ctx.fillStyle = PAREDES[diseno]; ctx.fillRect(0, 0, ancho, alto);
  if (diseno === 0) {
    // Ladrillo a la vista: hiladas con tono propio y juntas tenues; el canto de cada placa asoma en concreto.
    const hilada = 4, tolete = 16;
    for (let y = 0, fila = 0; y < alto; y += hilada, fila++) {
      for (let x = fila % 2 ? -tolete / 2 : 0; x < ancho; x += tolete) {
        ctx.fillStyle = rnd() < .5 ? `rgba(196,128,92,${rnd() * .16})` : `rgba(58,30,20,${rnd() * .2})`;
        ctx.fillRect(x, y, tolete - 1, hilada - 1);
      }
      ctx.fillStyle = 'rgba(214,198,176,.2)'; ctx.fillRect(0, y + hilada - 1, ancho, 1);
    }
    for (let p = 0; p < BALDOSA.pisos; p++) { ctx.fillStyle = 'rgba(168,162,148,.85)'; ctx.fillRect(0, alto - p * piso - 5, ancho, 5); }
  } else {
    // Concreto o pañete en paños: una junta por piso y otra por medio vano.
    const juntas = diseno === 2 ? 1 : 2;
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = rnd() < .5 ? `rgba(240,236,222,${.02 + rnd() * .05})` : `rgba(40,38,32,${.02 + rnd() * .05})`;
      ctx.fillRect(Math.floor(rnd() * BALDOSA.vanos * juntas) * vano / juntas, Math.floor(rnd() * BALDOSA.pisos) * piso, vano / juntas, piso);
    }
    ctx.fillStyle = 'rgba(40,38,34,.16)';
    for (let x = 0; x < ancho; x += vano / juntas) ctx.fillRect(x, 0, 1, alto);
    if (diseno === 4) {
      // Antepecho de panel oscuro bajo cada ventana, como en las fachadas de vidrio y lámina.
      for (let p = 0; p < BALDOSA.pisos; p++) { ctx.fillStyle = 'rgba(34,48,54,.28)'; ctx.fillRect(0, alto - (p + Y0) * piso, ancho, Y0 * piso); }
    }
  }
  vetas(ctx, rnd, ancho, alto, 150);
  for (let p = 0; p < BALDOSA.pisos; p++) { ctx.fillStyle = 'rgba(50,48,42,.2)'; ctx.fillRect(0, alto - p * piso - 2, ancho, 2); }
}

function ventana(ctx, w, rnd, vano, piso, alto) {
  const [x, y, an, al] = hueco(w, vano, piso, alto);
  // Mugre que escurre bajo el alféizar.
  const mugre = ctx.createLinearGradient(0, y + al, 0, y + al + piso * .45);
  mugre.addColorStop(0, 'rgba(50,46,40,.2)'); mugre.addColorStop(1, 'rgba(50,46,40,0)');
  ctx.fillStyle = mugre; ctx.fillRect(x + 1, y + al + 2, an - 2, piso * .45);
  for (let i = 0; i < 2; i++) { ctx.fillStyle = `rgba(46,42,36,${.05 + rnd() * .09})`; ctx.fillRect(x + rnd() * an, y + al + 2, 1 + rnd() * 2, piso * (.12 + rnd() * .3)); }
  ctx.fillStyle = '#3a3b38'; ctx.fillRect(x - 2, y - 2, an + 4, al + 4);
  // El vidrio va pintado más azul de lo que se ve: el tono del barrio lo entibia después.
  const vidrio = ctx.createLinearGradient(0, y, 0, y + al);
  vidrio.addColorStop(0, '#c6e0fc'); vidrio.addColorStop(.55, '#8aa5c4'); vidrio.addColorStop(1, '#6a829f');
  ctx.fillStyle = vidrio; ctx.fillRect(x, y, an, al);
  ctx.fillStyle = `rgba(20,30,38,${w.tono * .14})`; ctx.fillRect(x, y, an, al);
  if (w.cortina) {
    const cw = an * w.cortina.ancho, cx = w.cortina.lado ? x + an - cw : x;
    ctx.fillStyle = w.cortina.tela; ctx.fillRect(cx, y, cw, al);
    for (let px = cx; px < cx + cw - 1; px += 4) {
      ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(px, y, 1.5, al);
      ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(px + 2, y, 1, al);
    }
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(cx, y, cw, 3);
  } else if (w.persiana) {
    const ph = al * w.persiana;
    ctx.fillStyle = '#c3c2bd'; ctx.fillRect(x, y, an, ph);
    for (let py = y; py < y + ph - 1; py += 3) { ctx.fillStyle = 'rgba(0,0,0,.24)'; ctx.fillRect(x, py + 2, an, 1); }
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x, y + ph - 1.5, an, 1.5);
  }
  if (w.reflejo >= 0) {
    // Brillo en diagonal del cielo nublado, por encima de la tela.
    const rx = x + an * w.reflejo;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, an, al); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,.07)';
    ctx.beginPath(); ctx.moveTo(rx, y); ctx.lineTo(rx + an * .3, y); ctx.lineTo(rx + an * .3 - al * .5, y + al); ctx.lineTo(rx - al * .5, y + al); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Parteluz y alféizar.
  ctx.fillStyle = '#3a3b38'; ctx.fillRect(x + an / 2 - 1, y, 2, al);
  ctx.fillStyle = 'rgba(206,200,186,.7)'; ctx.fillRect(x - 3, y + al + 2, an + 6, 2);
}

function pintar([ancho, alto], cada) {
  const hoja = lienzo(ancho, alto);
  if (!hoja) return null;
  cada(hoja.ctx, ancho, alto);
  return hoja.canvas;
}

function textura(canvas, srgb, nombre) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.name = nombre;
  return t;
}

let fachadas;
/** `{ color: [una por diseño], brillo, luz }`, pintadas una sola vez, o `null` si no hay lienzo (pruebas de node). */
export function fachadasDeTorres() {
  if (fachadas !== undefined) return fachadas;
  fachadas = sinGastarAzar(0x70aa3e6, () => {
    const { vestido, luces } = repartoDeTorres();
    const color = PAREDES.map((_, diseno) => pintar(COLOR, (ctx, ancho, alto) => {
      const rnd = azarPropio(0x70aa100 + diseno), vano = ancho / BALDOSA.vanos, piso = alto / BALDOSA.pisos;
      pared(ctx, diseno, rnd, ancho, alto, vano, piso);
      for (const w of vestido) ventana(ctx, w, rnd, vano, piso, alto);
    }));
    if (color.some(canvas => !canvas)) return null;
    // Verde: aspereza; azul: metal. El vidrio es liso y con poco metal: desde arriba un metal entero refleja
    // el piso y la ventana vuelve a quedar negra.
    const brillo = pintar(BRILLO, (ctx, ancho, alto) => {
      const vano = ancho / BALDOSA.vanos, piso = alto / BALDOSA.pisos;
      ctx.fillStyle = 'rgb(0,235,0)'; ctx.fillRect(0, 0, ancho, alto);
      for (const w of vestido) {
        const [x, y, an, al] = hueco(w, vano, piso, alto);
        ctx.fillStyle = 'rgb(0,40,64)'; ctx.fillRect(x, y, an, al);
        if (w.cortina) { ctx.fillStyle = 'rgb(0,200,20)'; ctx.fillRect(w.cortina.lado ? x + an * (1 - w.cortina.ancho) : x, y, an * w.cortina.ancho, al); }
        else if (w.persiana) { ctx.fillStyle = 'rgb(0,150,40)'; ctx.fillRect(x, y, an, al * w.persiana); }
      }
    });
    const luz = pintar(NOCHE, (ctx, ancho, alto) => {
      const vano = ancho / LUZ.vanos, piso = alto / LUZ.pisos;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, ancho, alto);
      for (const l of luces) {
        const [x, y, an, al] = hueco(l, vano, piso, alto), [r, g, b] = l.color, k = l.fuerza;
        const tinta = (m, n = m, o = m) => `rgb(${Math.round(r * k * m)},${Math.round(g * k * n)},${Math.round(b * k * o)})`;
        // Más fuerte arriba, donde cuelga el bombillo; el televisor alumbra desde abajo.
        const cae = ctx.createLinearGradient(0, y, 0, y + al);
        cae.addColorStop(l.color === TELE ? 1 : 0, tinta(1)); cae.addColorStop(l.color === TELE ? 0 : 1, tinta(.62));
        ctx.fillStyle = cae; ctx.fillRect(x, y, an, al);
        // Con cortina o persiana, la ventana se prende del color de la tela.
        const w = vestido[(l.p % BALDOSA.pisos) * BALDOSA.vanos + l.v % BALDOSA.vanos];
        if (w.cortina) {
          ctx.fillStyle = w.cortina.tela === TELAS[0] ? tinta(.8, .7, .52) : tinta(.5, .58, .7);
          ctx.fillRect(w.cortina.lado ? x + an * (1 - w.cortina.ancho) : x, y, an * w.cortina.ancho, al);
        } else if (w.persiana) { ctx.fillStyle = tinta(.42); ctx.fillRect(x, y, an, al * w.persiana); }
        ctx.fillStyle = '#000'; ctx.fillRect(x + an / 2 - .5, y, 1, al);
      }
    });
    const mapas = { color: color.map((canvas, i) => textura(canvas, true, `Fachada de torre ${i + 1}`)),
      brillo: textura(brillo, false, 'Brillo del vidrio de las torres'), luz: textura(luz, true, 'Ventanas encendidas de las torres') };
    mapas.luz.repeat.set(BALDOSA.vanos / LUZ.vanos, BALDOSA.pisos / LUZ.pisos);
    return mapas;
  });
  return fachadas;
}

/**
 * Viste los materiales de fachada de los cinco diseños (los comparten todas las torres y sus copias por barrio).
 * Sin lienzo no cambia nada. Devuelve si los vistió.
 */
export function vestirTorres(materiales) {
  const mapas = fachadasDeTorres();
  if (!mapas) return false;
  materiales.forEach((material, i) => {
    material.map = mapas.color[i % mapas.color.length]; material.color.set('#ffffff');
    material.roughnessMap = material.metalnessMap = mapas.brillo; material.roughness = material.metalness = 1;
    material.bumpMap = null;
    material.emissiveMap = mapas.luz; material.emissive.set('#ffffff'); material.emissiveIntensity = 0;
    material.userData.windowGlow = LUZ.brillo;
    material.needsUpdate = true;
  });
  return true;
}

/**
 * Acomoda las UV de las cuatro caras de una caja de fachada a la baldosa, corrida vanos y pisos enteros según
 * la semilla del edificio; el techo conserva su escala.
 */
export function uvDeTorre(geometry, ancho, altura, fondo, semilla = 0) {
  const uv = geometry.attributes.uv, s = semilla >>> 0;
  for (let i = 0; i < uv.count; i++) {
    const cara = Math.floor(i / 4);
    if (cara === 2 || cara === 3) continue;
    const du = ((s + cara * 3) % LUZ.vanos) / BALDOSA.vanos, dv = ((s >>> 3) % LUZ.pisos) / BALDOSA.pisos;
    uv.setXY(i, uv.getX(i) * (cara < 2 ? fondo : ancho) / BALDOSA.ancho + du, uv.getY(i) * altura / BALDOSA.alto + dv);
  }
  uv.needsUpdate = true;
  return geometry;
}
