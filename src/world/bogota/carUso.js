// src/world/bogota/carUso.js
// El uso que la calle le deja a cada carro: la edad de cada modelo, el polvo del tercio bajo, el barro de los arcos,
// los chorreones bajo las ventanas, el techo y el capó quemados por el sol y los rayones de los parachoques.
// Todo va en el mismo lienzo de detalle (carDetail.js), sin texturas ni materiales nuevos: el color oscurece el esmalte,
// como las juntas, y el alfa dice cuánto polvo hay encima. El esmalte lee ese alfa para irse hacia el color de la tierra,
// perder la laca y quedar mate: así el polvo aclara un carro negro y apaga uno blanco.

import { streetWetness } from '../../character/streetMaterials.js';
import { SIDE_V } from './carLoft.js';

/** Edad de cada modelo, de 0 (cuidado y recién lavado) a 1 (viejo y quemado por el sol). */
export const EDAD = {
  cajaSetentera: 1, sedanNoventero: .86, buseta: .72, pickup: .6, furgon: .55,
  hatchPopular: .42, citadino: .36, sedanPopular: .34, suv: .14, sedanDeportivo: .08, camionetaNegra: 0,
};
// El taxi trabaja todo el día y nunca está más nuevo que esto; la patrulla pasa por el lavadero cada semana.
const EDAD_TAXI = .62, EDAD_PATRULLA = .2;

export function edadDe(modelId, kind = 'carro') {
  const edad = EDAD[modelId] ?? .4;
  if (kind === 'taxi') return Math.max(edad, EDAD_TAXI);
  if (kind === 'police') return Math.min(edad, EDAD_PATRULLA);
  return edad;
}

// De dos carros del mismo modelo y color, uno salió ayer del lavadero y otro lleva un mes en la calle.
// Hasta el recién lavado lleva su película de polvo abajo: se distinguen por cuánto, no porque uno no tenga nada.
const MUGRES = [.9, 1.1, 1.25, 1.5];
/** Nivel de mugre de un carro, de los bits de su semilla revuelta que nadie más usa. */
export const mugreDe = h => MUGRES[(h >>> 23) % MUGRES.length];

/** La laca se apaga con los años: menos brillo, más rugosa y con menos reflejo del entorno. El tono no se toca. */
export function acabadoConEdad(base, edad = 0) {
  if (!(edad > 0)) return base;
  const hacia = (a, b) => a + (b - a) * edad;
  return {
    metalness: base.metalness * (1 - .45 * edad),
    roughness: hacia(base.roughness, .64),
    clearcoat: hacia(base.clearcoat, .16),
    clearcoatRoughness: hacia(base.clearcoatRoughness, .34),
    envMapIntensity: base.envMapIntensity * (1 - .3 * edad),
  };
}

/** Desde esta edad el carro lleva rin de acero pintado, gris y sin brillo, en vez de aleación plateada. */
export const EDAD_RIN_DE_ACERO = .5;

// Azar propio y sembrado con el nombre del modelo: no gasta ni un número del azar del juego.
const semillaDe = texto => { let h = 2166136261; for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619); return h >>> 0; };
const azarDe = semilla => () => {
  semilla = (semilla + 0x6d2b79f5) | 0;
  let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const azarDelUso = azarDe(semillaDe('uso de los carros'));
/** Three sortea un identificador por cada material o textura: lo que nace aquí dentro no gasta el azar del juego. */
export function sinGastarAzar(crear) {
  const delJuego = Math.random;
  Math.random = azarDelUso;
  try { return crear(); } finally { Math.random = delJuego; }
}

// Cuánto del polvo dibujado llega al alfa: nunca lo tapa todo, para que el color del carro siga mandando.
const TOPE_POLVO = .8;
const BARRO = '58,45,31', HOLLIN = '24,24,26';

let VELO = null;
/** Lienzo de trabajo del polvo, uno para todos los modelos: se dibuja en blanco sobre negro y se pasa al alfa. */
function lienzoDePolvo(W, H) {
  if (!VELO) {
    const lienzo = document.createElement('canvas');
    lienzo.width = W; lienzo.height = H;
    VELO = lienzo.getContext('2d', { willReadFrequently: true });
  }
  return VELO;
}

/**
 * Pinta el uso sobre el lienzo de detalle ya dibujado. `carta` trae las mismas medidas que usa carDetail.js:
 * sx y sy para la carta lateral (metros a píxeles), tx y ty para la superior.
 */
export function pintarUso(ctx, spec, body, { sx, sy, tx, ty, pxX, pxY, W, H }, edad = edadDe(spec.id)) {
  const velo = typeof document === 'undefined' ? null : lienzoDePolvo(W, H);
  if (!velo || !ctx.getImageData) return;
  const r = azarDe(semillaDe(`uso:${spec.id}`));
  const { L, axleF, axleR, archR, archY } = spec, xTail = body.xTail, xNose = xTail + L;
  const blanco = a => `rgba(255,255,255,${Math.max(0, Math.min(1, a)).toFixed(3)})`;
  const techoFin = ty(0);

  velo.globalCompositeOperation = 'source-over';
  velo.fillStyle = '#000'; velo.fillRect(0, 0, W, H);
  velo.globalCompositeOperation = 'lighter';

  // Película de polvo en todo el carro: es lo que apaga el color con los años.
  velo.fillStyle = blanco(.02 + .13 * edad); velo.fillRect(0, 0, W, H);
  // Arriba se asienta más: techo, capó y baúl.
  velo.fillStyle = blanco(.02 + .08 * edad); velo.fillRect(0, 0, W, techoFin);

  // Velo del tercio bajo: sube desde el estribo, más alto y más cargado cuanto más viejo el carro.
  const TIRAS = 128;
  for (let i = 0; i < TIRAS; i++) {
    const x = xTail + L * (i + .5) / TIRAS, b = body.bottom0(x);
    const alto = .4 + .22 * edad + .05 * Math.sin(x * 3.1 + edad * 9) + .03 * Math.sin(x * 11.3);
    const px0 = Math.round(W * i / TIRAS), px1 = Math.round(W * (i + 1) / TIRAS);
    const g = velo.createLinearGradient(0, sy(b + alto), 0, sy(b));
    g.addColorStop(0, blanco(0)); g.addColorStop(.55, blanco(.05 + .37 * edad)); g.addColorStop(1, blanco(.2 + .7 * edad));
    velo.fillStyle = g; velo.fillRect(px0, sy(b + alto), px1 - px0, sy(b - .02) - sy(b + alto));
    // Barro fresco del estribo: oscurece el color, no lo aclara.
    const m = ctx.createLinearGradient(0, sy(b + .13), 0, sy(b));
    m.addColorStop(0, `rgba(${BARRO},0)`); m.addColorStop(1, `rgba(${BARRO},${(.08 + .36 * edad).toFixed(3)})`);
    ctx.fillStyle = m; ctx.fillRect(px0, sy(b + .13), px1 - px0, sy(b - .02) - sy(b + .13));
  }

  // Abanico de barro detrás de cada arco (el frente es +X: la rueda lo lanza hacia la cola) y un poco por delante.
  for (const ax of [axleF, axleR]) {
    for (const [dx, radio, fuerza] of [[-archR * .95, archR + .46, .22 + .62 * edad], [archR * .85, archR + .2, .1 + .32 * edad]]) {
      velo.save(); velo.translate(sx(ax + dx), sy(archY + archR * .15)); velo.scale(pxX, pxY * .8);
      const g = velo.createRadialGradient(0, 0, archR * .3, 0, 0, radio);
      g.addColorStop(0, blanco(fuerza)); g.addColorStop(.5, blanco(fuerza * .5)); g.addColorStop(1, blanco(0));
      velo.fillStyle = g; velo.beginPath(); velo.arc(0, 0, radio, 0, Math.PI * 2); velo.fill(); velo.restore();
    }
    // Salpicaduras de barro seco, apretadas junto al arco y sueltas al alejarse. La rueda las lanza: cada una es
    // una raya corta que sale del arco, no un lunar.
    const gotas = Math.round(60 + 520 * edad);
    for (let i = 0; i < gotas; i++) {
      const atras = r() < .74, lejos = r() * r();
      const x = ax + (atras ? -1 : 1) * archR * (.75 + lejos * (atras ? 2.1 : 1.1));
      if (x < xTail + .03 || x > xNose - .03) { r(); r(); continue; }
      const y = body.bottom0(x) + .03 + r() * r() * (.5 - lejos * .25), radio = (.002 + r() * r() * .006) * pxX;
      const giro = Math.atan2((archY - y) * pxY, (x - ax) * pxX) + (r() - .5) * .5;
      ctx.fillStyle = `rgba(${BARRO},${(.06 + .2 * r()).toFixed(3)})`;
      ctx.beginPath(); ctx.ellipse(sx(x), sy(y), radio * (1.4 + r() * 2.6), radio * (.3 + r() * .4), giro, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Chorreones: el agua baja de la línea de ventanas y de los espejos y deja el polvo en hilos.
  const chorros = Math.round(12 + 34 * edad);
  for (let i = 0; i < chorros; i++) {
    const x = xTail + L * (.04 + .92 * r()), y0 = body.belt(x) - .012, largo = (.1 + .42 * r()) * (.55 + .6 * edad);
    const ancho = 1 + r() * 2.4, fuerza = (.1 + .3 * r()) * (.5 + .7 * edad);
    const g = velo.createLinearGradient(0, sy(y0), 0, sy(y0 - largo));
    g.addColorStop(0, blanco(fuerza)); g.addColorStop(.6, blanco(fuerza * .6)); g.addColorStop(1, blanco(0));
    velo.fillStyle = g; velo.fillRect(sx(x) - ancho / 2, sy(y0), ancho, sy(y0 - largo) - sy(y0));
  }

  // Grano: el polvo no es parejo. Motas en el costado bajo y manchas grandes arriba.
  const motas = Math.round(500 + 1500 * edad);
  for (let i = 0; i < motas; i++) {
    const x = xTail + L * r(), y = body.bottom0(x) + r() * r() * .75, lado = 1 + r() * 1.8;
    velo.fillStyle = blanco(.03 + .09 * r()); velo.fillRect(sx(x), sy(y), lado, lado);
  }
  // Techo y capó quemados por el sol: la laca se levanta en parches. Solo en carros con años.
  const parches = edad > .25 ? Math.round(52 * (edad - .2)) : 0;
  for (let i = 0; i < parches; i++) {
    const cx = W * r(), cy = techoFin * (.02 + .9 * r() * r()), radio = 9 + 46 * r() * (.5 + edad * .6), fuerza = (.07 + .26 * r()) * edad;
    velo.save(); velo.translate(cx, cy); velo.scale(1 + r() * 1.4, .55 + r() * .4);
    const g = velo.createRadialGradient(0, 0, radio * .15, 0, 0, radio);
    g.addColorStop(0, blanco(fuerza)); g.addColorStop(.7, blanco(fuerza * .55)); g.addColorStop(1, blanco(0));
    velo.fillStyle = g; velo.beginPath(); velo.arc(0, 0, radio, 0, Math.PI * 2); velo.fill(); velo.restore();
  }

  // Gotas secas en capó, techo y tapa: el aguacero se seca en manchas de polvo de 4 a 8 mm, juntas donde se empozó el agua,
  // y cada charco deja además su velo. Con su propio azar, para no mover nada de lo demás.
  const g = azarDe(semillaDe(`gotas:${spec.id}`)), pxZ = Math.abs(ty(0) - ty(1));
  const charcos = Math.round(30 + 30 * edad);
  for (let i = 0; i < charcos; i++) {
    const cx = W * g(), cy = techoFin * g(), ancho = (.03 + .09 * g()) * pxX, alto = ancho * pxZ / pxX * (.6 + .6 * g());
    velo.save(); velo.translate(cx, cy); velo.scale(1, alto / ancho);
    const halo = velo.createRadialGradient(0, 0, 0, 0, 0, ancho);
    halo.addColorStop(0, blanco(.07)); halo.addColorStop(1, blanco(0));
    velo.fillStyle = halo; velo.beginPath(); velo.arc(0, 0, ancho, 0, Math.PI * 2); velo.fill(); velo.restore();
    const cuantas = Math.round(50 + 150 * g());
    for (let k = 0; k < cuantas; k++) {
      const giro = g() * Math.PI * 2, lejos = Math.sqrt(g()), radio = .002 + .002 * g(), fuerza = .25 * (.55 + .45 * g());
      const x = cx + Math.cos(giro) * lejos * ancho, y = cy + Math.sin(giro) * lejos * alto;
      if (x < 0 || x > W || y < 0 || y > techoFin) continue;
      velo.fillStyle = blanco(fuerza);
      velo.beginPath(); velo.ellipse(x, y, radio * pxX, radio * pxZ, 0, 0, Math.PI * 2); velo.fill();
    }
  }

  // Rasguños de parqueo en las cuatro esquinas: haces cortos y curvos de dos o tres hilos, unos de caucho y hollín
  // y otros al fondo gris de la lámina. Largos, rectos y marcados parecían filetes pintados.
  const rayones = Math.round(3 + 8 * edad);
  for (const [extremo, dir, tramo] of [[xNose, -1, spec.noseLen ?? .4], [xTail, 1, spec.tailLen ?? .4]]) {
    for (let i = 0; i < rayones; i++) {
      const x0 = extremo + dir * (.02 + r() * tramo * 1.1), largo = .025 + r() * r() * .1;
      const y0 = body.bottom0(x0) + .16 + r() * .28, giro = (r() - .5) * .9, claro = r() < .4;
      const lienzo = claro ? velo : ctx, hilos = 1 + Math.floor(r() * 3);
      for (let k = 0; k < hilos; k++) {
        const y = y0 + (k - (hilos - 1) / 2) * (.006 + r() * .008), corto = largo * (.5 + r() * .5), comba = (r() - .5) * .03;
        const dx = Math.cos(giro) * corto * dir, dy = Math.sin(giro) * corto;
        lienzo.strokeStyle = claro ? blanco(.12 + .2 * r()) : `rgba(${HOLLIN},${(.08 + .16 * r()).toFixed(3)})`;
        lienzo.lineWidth = .5 + r() * .7; lienzo.lineCap = 'round';
        lienzo.beginPath(); lienzo.moveTo(sx(x0), sy(y));
        lienzo.quadraticCurveTo(sx(x0 + dx / 2), sy(y + dy / 2 + comba), sx(x0 + dx), sy(y + dy));
        lienzo.stroke();
      }
    }
  }

  // El polvo pasa al alfa del lienzo de detalle.
  const imagen = ctx.getImageData(0, 0, W, H), polvo = velo.getImageData(0, 0, W, H).data, datos = imagen.data;
  for (let i = 0; i < datos.length; i += 4) datos[i + 3] = 255 - Math.round(polvo[i] * TOPE_POLVO);
  ctx.putImageData(imagen, 0, 0);
}

// ----- Sombreado -----

// Los chorreones mojados nacen un poco arriba de la línea de ventanas, que en la carta lateral cae hacia el 70 % del alto.
const SIDE_V_CHORRO = (SIDE_V * .7).toFixed(3);

/** Un carro sin matiz propio: el tono, la viveza y la laca de su esmalte tal como salen del modelo. */
export const SIN_MATIZ = Object.freeze([1, 1, 1]);

/**
 * Cuánto se separa de noche un esmalte amarillo de su gris (0,35 es un 35 % más), y con eso cuánto vuelve hacia el
 * amarillo lo que el farol de sodio corre hacia el naranja. Es el número que hay que reajustar si cambia la curva de color nocturna.
 */
export const REFUERZO_AMARILLO_NOCHE = .15;

/**
 * El esmalte lee el polvo del alfa de su mapa de detalle: color hacia tierra, sin metal, sin laca y mate.
 * El alfa deja de ser transparencia: la chapa sigue opaca.
 */
export function leerPolvo(shader, mugre = 1, matiz = SIN_MATIZ) {
  shader.uniforms.uUsoMugre = { value: mugre };
  // Lo que distingue a este carro de otro del mismo tono: claridad, viveza y cuánta laca le queda.
  shader.uniforms.uUsoMatiz = { value: matiz };
  // Con el piso mojado la chapa también lo está: más oscura y más lisa.
  shader.uniforms.uMojado = streetWetness;
  shader.fragmentShader = `uniform float uUsoMugre;\nuniform vec3 uUsoMatiz;\nuniform float uMojado;\n${shader.fragmentShader}`
    .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
      float usoPolvo = 0.;
      #ifdef USE_MAP
        // Con aguacero el agua baja de las ventanas por costados y puertas y arrastra el polvo en hilos.
        float usoHilo = vMapUv.x * 90.;
        float usoCual = fract( sin( floor( usoHilo ) * 12.9898 ) * 43758.5453 );
        float usoAncho = .08 + .22 * fract( usoCual * 7.31 );
        float usoDesde = ${SIDE_V_CHORRO} - .08 * fract( usoCual * 3.17 ), usoHasta = usoDesde - .1 - .3 * fract( usoCual * 5.73 );
        float usoChorro = step( usoCual, .4 ) * ( 1. - smoothstep( usoAncho, usoAncho + .12, abs( fract( usoHilo ) - .5 ) ) );
        usoChorro *= smoothstep( usoHasta, mix( usoHasta, usoDesde, .4 ), vMapUv.y ) * step( vMapUv.y, usoDesde );
        usoChorro *= 1. - smoothstep( .3, .6, fwidth( usoHilo ) );
        usoPolvo = min( max( ( 1. - sampledDiffuseColor.a ) * uUsoMugre, .4 * uMojado * usoChorro ), .92 );
        diffuseColor.a = opacity;
      #endif`)
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      diffuseColor.rgb = mix( vec3( dot( diffuseColor.rgb, vec3( .3, .59, .11 ) ) ), diffuseColor.rgb, uUsoMatiz.y ) * uUsoMatiz.x;
      float usoLuz = dot( diffuseColor.rgb, vec3( .3, .59, .11 ) );
      float usoMayor = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
      float usoVivo = ( usoMayor - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) ) / max( usoMayor, .03 );
      float usoClaro = smoothstep( .02, .2, usoLuz );
      // Sobre un esmalte oscuro el polvo es una película gris y delgada: el negro sigue negro. Sobre un color vivo
      // es tierra de su mismo matiz: el amarillo del taxi se ensucia sin volverse caqui.
      usoPolvo *= mix( .5, 1., usoClaro );
      vec3 usoTierra = mix( vec3( .17, .165, .16 ), vec3( .26, .21, .15 ), usoClaro );
      usoTierra = mix( usoTierra, diffuseColor.rgb * ( .2 / max( usoLuz, .05 ) ), usoVivo * usoClaro * .6 );
      diffuseColor.rgb = mix( diffuseColor.rgb, usoTierra, usoPolvo );
      // Mojado, un esmalte de color pierde más luz que uno blanco o negro: el agua le quita el velo y lo deja más hondo.
      diffuseColor.rgb *= 1. - ( .3 + .15 * usoVivo ) * uMojado;
      // De noche, bajo los faroles, un esmalte vivo es lo que más se ve de la calle: aguanta un cuarto más de luz.
      diffuseColor.rgb *= 1. + .25 * usoVivo * usoClaro * saturate( ( uSunSkyFloor - .4 ) / .22 );
      // Bajo el sodio el amarillo se va a ocre: de noche los esmaltes amarillos, de 35° a 60°, se separan además de su gris.
      float usoSeparar = 0.;
      {
        vec3 usoS = sqrt( max( diffuseColor.rgb, 0. ) );
        float usoAlto = max( usoS.r, max( usoS.g, usoS.b ) ), usoRango = usoAlto - min( usoS.r, min( usoS.g, usoS.b ) );
        float usoGrados = 60. * ( usoS.r >= usoAlto ? ( usoS.g - usoS.b ) / max( usoRango, 1e-4 ) : 2. + ( usoS.b - usoS.r ) / max( usoRango, 1e-4 ) );
        float usoAmarillo = smoothstep( 32., 36., usoGrados ) * ( 1. - smoothstep( 60., 64., usoGrados ) ) * smoothstep( .08, .2, usoRango );
        usoSeparar = ${REFUERZO_AMARILLO_NOCHE} * usoAmarillo * saturate( ( uSunSkyFloor - .4 ) / .22 );
      }`)
    .replace('#include <opaque_fragment>', /* glsl */`{
        vec3 usoS = sqrt( max( outgoingLight, 0. ) );
        float usoGris = ( usoS.r + usoS.g + usoS.b ) / 3.;
        usoS = max( usoGris + ( usoS - usoGris ) * ( 1. + usoSeparar ), 0. );
        usoS.g += ( usoS.r - usoS.g ) * usoSeparar * .5;
        outgoingLight = usoS * usoS;
      }
      #include <opaque_fragment>`)
    .replace('#include <roughnessmap_fragment>', /* glsl */`#include <roughnessmap_fragment>
      roughnessFactor = mix( roughnessFactor, .95, min( usoPolvo * 1.3, 1. ) );
      roughnessFactor *= 1. - .6 * uMojado;`)
    .replace('#include <metalnessmap_fragment>', /* glsl */`#include <metalnessmap_fragment>
      metalnessFactor *= 1. - usoPolvo;`)
    .replace('#include <lights_physical_fragment>', /* glsl */`#include <lights_physical_fragment>
      #ifdef USE_CLEARCOAT
        float lacaEmpolvada = min( usoPolvo * 1.35, 1. );
        material.clearcoat = min( material.clearcoat * uUsoMatiz.z, 1. ) * ( 1. - lacaEmpolvada );
        material.clearcoatRoughness = mix( material.clearcoatRoughness, max( .56, material.clearcoatRoughness ), lacaEmpolvada * ( 1. - .65 * uMojado ) );
      #endif`);
}

/**
 * Molduras, llantas y rines comparten un solo material sin mapa de uso: el polvo de la calle les sube desde el piso.
 * Va por la altura sobre el pavimento (los carros andan a ras de calle): abajo, color de tierra, mate y sin brillo de metal.
 * Así un rin deja de ser un disco plateado de vitrina y la llanta no es un negro limpio.
 */
export function polvoDeCalle(shader, uso = 0) {
  // Un valor por material y un solo programa: 0 es el carro cuidado; 1, el que lleva años en la calle.
  shader.uniforms.uUsoRin = { value: uso };
  shader.vertexShader = `varying float vPerfilLlanta;\n${shader.vertexShader}`
    .replace('#include <color_vertex>', `#include <color_vertex>
      vPerfilLlanta = -vColor.a;
      vColor.a = max( 0., vColor.a );`);
  shader.fragmentShader = `uniform float uUsoRin;\nvarying float vPerfilLlanta;\n${shader.fragmentShader}`
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      float usoBajo = 1. - smoothstep( .04, .74, vSunFieldPos.y );
      usoBajo *= .35 + .65 * usoBajo;
      // Rin de acero y parachoques sin cromo en los carros con años: el metal bajo se vuelve gris y opaco.
      float usoAcero = uUsoRin * smoothstep( .3, .7, vColor.a ) * ( 1. - smoothstep( .72, .86, vSunFieldPos.y ) );
      diffuseColor.rgb *= 1. - .55 * usoAcero;
      float caucho = step( .5, vPerfilLlanta );
      vec3 polvo = mix( vec3( .2, .165, .125 ), vec3( .067, .059, .049 ), caucho );
      diffuseColor.rgb = mix( diffuseColor.rgb, polvo, usoBajo * ( .4 + .2 * uUsoRin ) * ( 1. - .35 * caucho ) );
      // Dos nervios moldeados en el flanco; el filtro los funde cuando ocupan menos de un píxel.
      float radioLlanta = vPerfilLlanta - 1., pixelLlanta = max( .002, fwidth( radioLlanta ) );
      float bordeLlanta = min( abs( radioLlanta - .22 ), abs( radioLlanta - .73 ) );
      float nervioLlanta = ( 1. - smoothstep( .012, .025 + pixelLlanta, bordeLlanta ) ) * min( 1., .045 / pixelLlanta );
      diffuseColor.rgb *= 1. + .45 * caucho * nervioLlanta;`)
    .replace('#include <normal_fragment_begin>', /* glsl */`roughnessFactor = mix( roughnessFactor, .92, usoBajo * .85 );
      metalnessFactor *= 1. - usoBajo * .8;
      roughnessFactor = mix( roughnessFactor, .66, usoAcero );
      metalnessFactor *= 1. - .6 * usoAcero;
      #include <normal_fragment_begin>`);
}

/**
 * Reflejo falso del cielo y de la calle, sin textura: según hacia dónde sale el rayo reflejado, la chapa y el vidrio
 * devuelven el cielo (el color de la niebla, que ya es el del horizonte, con nubes que pasan), las cuadras o el pavimento.
 * De noche el pavimento es el charco de luz de los faroles, por techo y capó pasan sus manchas cálidas y por el costado
 * corre la franja de las vitrinas. Se ve de frente y pesa más de canto, como todo reflejo; la laca apagada o con polvo
 * casi no lo muestra y la recién lavada lo sube. Va al final de <lights_fragment_end>.
 */
export const REFLEJO_CALLE = /* glsl */`
  {
    vec3 usoRayo = inverseTransformDirection( reflect( -geometryViewDir, geometryNormal ), viewMatrix );
    float usoCanto = pow( 1. - saturate( dot( geometryNormal, geometryViewDir ) ), 4. );
    #ifdef USE_FOG
      vec3 usoCielo = fogColor;
    #else
      vec3 usoCielo = vec3( .5, .62, .78 );
    #endif
    float usoNoche = saturate( ( uSunSkyFloor - .4 ) / .22 );
    vec3 usoSodio = vec3( 1., .56, .2 );
    vec3 usoCalle = mix( usoCielo * vec3( .2, .19, .18 ), usoSodio * .06, usoNoche );
    vec3 usoArriba = mix( usoCielo, usoCielo * vec3( .58, .72, .96 ), smoothstep( .15, .9, usoRayo.y ) );
    float usoNube = sin( usoRayo.x * 3.1 + vSunFieldPos.x * .23 ) * sin( usoRayo.z * 2.7 + vSunFieldPos.z * .19 );
    usoArriba += usoCielo * .2 * smoothstep( .2, .85, usoNube ) * smoothstep( .2, .6, usoRayo.y );
    // De noche arriba no hay cielo que devolver: queda un tercio y sin su azul.
    usoArriba = mix( usoArriba, vec3( dot( usoArriba, vec3( .3, .59, .11 ) ) * .35 ), usoNoche );
    // A ras del horizonte no hay cielo: hay cuadras. Esa franja más oscura es la que le da curva a un capó.
    usoArriba *= mix( .5, 1., smoothstep( .04, .3, usoRayo.y ) );
    vec3 usoEntorno = mix( usoCalle, usoArriba, smoothstep( -.1, .16, usoRayo.y ) );
    float usoFarol = .5 + .5 * sin( vSunFieldPos.x * .42 + usoRayo.x * 2.6 ) * sin( vSunFieldPos.z * .42 + usoRayo.z * 2.6 );
    usoEntorno += usoSodio * usoNoche * smoothstep( .1, .7, usoRayo.y ) * ( .08 + .5 * usoFarol * usoFarol * usoFarol );
    usoEntorno += usoSodio * usoNoche * .14 * ( 1. - smoothstep( .02, .3, abs( usoRayo.y - .06 ) ) ) * ( .35 + .65 * usoFarol );
    #ifdef USE_CLEARCOAT
      float usoLaca = material.clearcoat * ( 1. - material.clearcoatRoughness ) * mix( 1.35, .8, saturate( ( uUsoMugre - .5 ) / .85 ) );
      float usoFrente = .13;
      // La laca de un color vivo devuelve el reflejo con el matiz de su esmalte, y más de noche: lo gris y azul que le
      // caía encima al capó de un taxi lo dejaba caqui.
      float usoTope = max( diffuseColor.r, max( diffuseColor.g, diffuseColor.b ) );
      float usoPeso = dot( diffuseColor.rgb, vec3( .3, .59, .11 ) );
      float usoTinte = ( usoTope - min( diffuseColor.r, min( diffuseColor.g, diffuseColor.b ) ) ) / max( usoTope, .03 );
      usoTinte *= smoothstep( .01, .08, usoTope ) * mix( .35, .85, usoNoche );
      vec3 usoTono = min( diffuseColor.rgb / max( usoPeso, .03 ), vec3( 2. ) );
      usoEntorno = mix( usoEntorno, usoTono * dot( usoEntorno, vec3( .3, .59, .11 ) ), usoTinte );
      // El blanco al sol ya está arriba: el reflejo no lo quema.
      usoLaca *= 1. - .5 * smoothstep( .35, .8, usoPeso ) * ( 1. - usoNoche );
      // Mojada, la laca devuelve más cielo de canto, en la banda de capó y techo; de frente el agua no refleja más.
      usoCanto *= 1. + 1.2 * uMojado;
    #else
      // De noche el vidrio devuelve los faroles a media fuerza: entero, el panorámico parecía encendido por dentro.
      float usoLaca = mix( 1.15, .5, usoNoche ) * ( 1. + 1.2 * uMojado );
      float usoFrente = .17;
    #endif
    float usoFuerza = min( usoFrente + ( 1. - usoFrente ) * usoCanto, .75 ) * usoLaca;
    reflectedLight.indirectSpecular += usoEntorno * usoFuerza;
    #ifndef USE_CLEARCOAT
      // El vidrio de canto es espejo: ahí deja de transparentarse.
      diffuseColor.a = min( diffuseColor.a + usoFuerza * .5, 1. );
    #endif
  }`;
