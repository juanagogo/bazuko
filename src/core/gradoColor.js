import * as THREE from 'three';

// Grado de color del juego: la curva que convierte la luz de la escena en el color de la pantalla.
// Parte de la curva fílmica de siempre, para que la exposición y las luces sigan calibradas, y encima
// revela la imagen: pie más hondo, sombra fría y alta cálida, y el color fuerte del rebusque con cuerpo.
// De noche lo que no está bajo un farol pierde naranja y vira al azul: sodio contra penumbra.
// Todo sale de la exposición que ya publica la escena; no hay uniformes, pasadas ni texturas nuevas.
export const GRADO = Object.freeze({
  // El pie baja hasta este tanto lo más oscuro y se desvanece al llegar a `pieHasta` (luminancia lineal).
  pieHondura: .34,
  // De noche casi todo es sombra: el pie no baja, y lo más oscuro (hasta `subidaNocheHasta`) sube este tanto
  // para que la calzada, el prado y la gente se lean lejos de los faroles.
  pieHonduraNoche: 0,
  pieHasta: .32,
  subidaNoche: .4,
  subidaNocheHasta: .12,
  // Tinte por luminancia: multiplica las sombras y las altas. El de día casi no se nota.
  sombraHasta: .4,
  // De noche el tinte frío llega solo hasta aquí: el piso que ya recibe algo de farol conserva su sodio.
  sombraHastaNoche: .26,
  altaDesde: .45,
  sombraDia: [.97, .99, 1.03],
  sombraNoche: [.76, 1.02, 1.4],
  alta: [1, .99, .95],
  // De noche la penumbra pierde este tanto de color antes de enfriarse.
  apagadoNoche: .22,
  // Saturación que se suma en los tonos medios; lo casi negro y lo casi quemado no se tocan.
  saturacionDia: .2,
  saturacionNoche: .1,
  // Exposición entre la que el pie pasa del de día al de noche (día despejado 0,8; nublado 1,05; noche 1,22).
  // Empieza justo en el nublado para que al caer la tarde la sombra no quede más honda que de noche.
  nocheDesde: 1.05,
  nocheHasta: 1.18,
  // El color de la noche (penumbra apagada y azul) entra más tarde: una tarde nublada o con lluvia sube
  // la exposición sin ser de noche (hasta 1,11 con el sol ya bajo), y tiene que quedar gris, no azul.
  // Antes de salir el sol y recién puesto (1,14 a 1,15 despejado) ya va por la mitad.
  colorNocheDesde: 1.105,
  colorNocheHasta: 1.185
});

const LINEA_DE_FABRICA = 'vec3 CustomToneMapping( vec3 color ) { return color; }';
const LUMA = [.2126, .7152, .0722];

const f = value => {
  const text = String(value);
  return /[.e]/.test(text) ? text : `${text}.`;
};
const vec3 = values => `vec3( ${values.map(f).join(', ')} )`;

export function codigoDelGrado(grado = GRADO) {
  return /* glsl */`
vec3 CustomToneMapping( vec3 color ) {

	vec3 grado = ACESFilmicToneMapping( color );
	const vec3 gradoLuma = ${vec3(LUMA)};
	float gradoNoche = smoothstep( ${f(grado.nocheDesde)}, ${f(grado.nocheHasta)}, toneMappingExposure );
	float gradoColorNoche = smoothstep( ${f(grado.colorNocheDesde)}, ${f(grado.colorNocheHasta)}, toneMappingExposure );

	// Pie: lo oscuro baja (de noche sube un poco) y lo que pasa de los medios queda igual. Es creciente: nada se empasta.
	float gradoLuz = dot( grado, gradoLuma );
	float gradoPie = 1. - mix( ${f(grado.pieHondura)}, ${f(grado.pieHonduraNoche)}, gradoNoche ) * ( 1. - smoothstep( 0., ${f(grado.pieHasta)}, gradoLuz ) );
	gradoPie += ${f(grado.subidaNoche)} * gradoNoche * ( 1. - smoothstep( 0., ${f(grado.subidaNocheHasta)}, gradoLuz ) );
	grado *= gradoPie;
	gradoLuz *= gradoPie;

	// Sombras frías, altas cálidas. De noche la penumbra además se apaga: el naranja queda bajo el farol.
	float gradoSombra = 1. - smoothstep( 0., mix( ${f(grado.sombraHasta)}, ${f(grado.sombraHastaNoche)}, gradoColorNoche ), gradoLuz );
	float gradoAlta = smoothstep( ${f(grado.altaDesde)}, 1., gradoLuz );
	grado = mix( grado, vec3( gradoLuz ), ${f(grado.apagadoNoche)} * gradoColorNoche * gradoSombra );
	grado *= mix( vec3( 1. ), mix( ${vec3(grado.sombraDia)}, ${vec3(grado.sombraNoche)}, gradoColorNoche ), gradoSombra );
	grado *= mix( vec3( 1. ), ${vec3(grado.alta)}, gradoAlta );

	// Color con cuerpo en los medios, sin tocar el matiz ni empujar lo que ya está cerca de quemarse.
	gradoLuz = dot( grado, gradoLuma );
	float gradoPico = max( grado.r, max( grado.g, grado.b ) );
	float gradoMedios = smoothstep( 0., .12, gradoLuz ) * ( 1. - smoothstep( .7, 1., gradoPico ) );
	grado = gradoLuz + ( grado - gradoLuz ) * ( 1. + mix( ${f(grado.saturacionDia)}, ${f(grado.saturacionNoche)}, gradoColorNoche ) * gradoMedios );

	// La saturación solo quita de los canales débiles, como la densidad de una película: ninguno gana brillo.
	return clamp( grado, 0., gradoPico );

}`;
}

const saturate = value => Math.min(1, Math.max(0, value));
const smoothstep = (a, b, value) => {
  const t = saturate((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const luma = color => color[0] * LUMA[0] + color[1] * LUMA[1] + color[2] * LUMA[2];

// Cuánto del color de la noche lleva una exposición: 0 de día, también nublado o con lluvia, y 1 de noche.
export function colorDeNoche(exposicion, grado = GRADO) {
  return smoothstep(grado.colorNocheDesde, grado.colorNocheHasta, exposicion);
}

// La misma cuenta del sombreador, sobre un color que ya pasó por la curva fílmica (lineal, 0 a 1).
// Sirve para medir el grado sin navegador.
export function gradoDeColor(color, exposicion = 1.05, grado = GRADO) {
  const noche = smoothstep(grado.nocheDesde, grado.nocheHasta, exposicion);
  const colorNoche = colorDeNoche(exposicion, grado);
  let luz = luma(color);
  const pie = 1 - mix(grado.pieHondura, grado.pieHonduraNoche, noche) * (1 - smoothstep(0, grado.pieHasta, luz))
    + grado.subidaNoche * noche * (1 - smoothstep(0, grado.subidaNocheHasta, luz));
  let out = color.map(channel => channel * pie);
  luz *= pie;
  const sombra = 1 - smoothstep(0, mix(grado.sombraHasta, grado.sombraHastaNoche, colorNoche), luz);
  const alta = smoothstep(grado.altaDesde, 1, luz);
  const apagado = grado.apagadoNoche * colorNoche * sombra;
  out = out.map((channel, i) => mix(channel, luz, apagado)
    * mix(1, mix(grado.sombraDia[i], grado.sombraNoche[i], colorNoche), sombra)
    * mix(1, grado.alta[i], alta));
  luz = luma(out);
  const pico = Math.max(...out);
  const medios = smoothstep(0, .12, luz) * (1 - smoothstep(.7, 1, pico));
  const saturacion = 1 + mix(grado.saturacionDia, grado.saturacionNoche, colorNoche) * medios;
  return out.map(channel => Math.min(pico, Math.max(0, luz + (channel - luz) * saturacion)));
}

// Deja la curva propia en el trozo de three y dice qué mapeo usar. Si una versión nueva de three
// cambia la línea de fábrica, el juego sigue con la curva fílmica de antes en vez de quedar sin curva.
export function mapeoDeGrado(chunks = THREE.ShaderChunk) {
  const pars = chunks?.tonemapping_pars_fragment;
  if (typeof pars !== 'string') return THREE.ACESFilmicToneMapping;
  const propio = codigoDelGrado();
  if (pars.includes(propio)) return THREE.CustomToneMapping;
  if (!pars.includes(LINEA_DE_FABRICA) || !pars.includes('vec3 ACESFilmicToneMapping(')) return THREE.ACESFilmicToneMapping;
  chunks.tonemapping_pars_fragment = pars.replace(LINEA_DE_FABRICA, propio);
  return THREE.CustomToneMapping;
}
