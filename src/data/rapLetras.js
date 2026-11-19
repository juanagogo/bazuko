// src/data/rapLetras.js
// Lo que se dice en el rap del vagón: el saludo, las estrofas, lo que sale cuando el personaje se traba, el cierre y
// la gente que va en el vagón. Solo datos, sin DOM ni audio: las pruebas de voz y de letra leen todo esto.
//
// Las estrofas son del personaje y van en primera persona; a la gente le habla de usted («señores pasajeros»), como
// cualquiera que se sube a vender. Cada línea va en dos pedazos: cada pedazo se dice en un golpe de la caja.

/** El saludo cambia con la hora del juego. */
export const SALUDOS = {
  dias: 'Buenos días, señores pasajeros,',
  tardes: 'Buenas tardes, señores pasajeros,',
  noches: 'Buenas noches, señores pasajeros,',
};

export const PRESENTACION = 'disculpen la molestia: no vengo a robarles, vengo a rimarles.';

/** El último compás: dos golpes, como cualquier línea. */
export const CIERRE = ['Gracias, señores pasajeros,', '¡que Dios les pague!'];

/** Siete estrofas de cuatro líneas; cada rap usa dos, distintas. */
export const ESTROFAS = [
  {
    id: 'cambuche',
    lineas: [
      ['Vivo en un cambuche', 'de cartón y de plástico,'],
      ['no tiene ni baño,', 'pero el barrio es fantástico.'],
      ['Mi colchón lo encontré', 'botado en la Jiménez,'],
      ['duermo como un rey', 'aunque me piquen los ciempiés.'],
    ],
  },
  {
    id: 'bus-lleno',
    lineas: [
      ['Este bus va más lleno', 'que olla de tamal,'],
      ['la señora del fondo', 'ya me pisó el costal.'],
      ['El de la corbata', 'va hablando por celular:'],
      ['«Ya voy llegando»,', 'y ni ha salido del portal.'],
    ],
  },
  {
    id: 'carreta',
    lineas: [
      ['No vendo chicles', 'ni vendo galletas,'],
      ['vendo pura carreta,', 'pero rimada y completa.'],
      ['El que colabora', 'con lo que le sobre,'],
      ['se lo devuelve el cielo', 'y nunca queda pobre.'],
    ],
  },
  {
    id: 'chato',
    lineas: [
      ['Tengo un perro flaco', 'que se llama El Chato,'],
      ['me cuida el cambuche', 'y se come mi plato.'],
      ['Es el único fan', 'que tengo en la ciudad:'],
      ['me aplaude con la cola', 'cuando rimo de verdad.'],
    ],
  },
  {
    id: 'clima',
    lineas: [
      ['En Bogotá no hay clima,', 'hay cuatro estaciones,'],
      ['y pasan en un día', 'sin pedir permiso, señores.'],
      ['Salí con sol a las ocho,', 'a las nueve, aguacero,'],
      ['y aquí estoy rimando', 'mojado hasta el sombrero.'],
    ],
  },
  {
    id: 'trancon',
    lineas: [
      ['Trancón en la Caracas,', 'trancón en la Décima,'],
      ['el bus va tan despacio', 'que me creció la barba encima.'],
      ['La señora de al lado', 'ya tejió una ruana,'],
      ['y el que iba de pie', 'se acomodó hasta mañana.'],
    ],
  },
  {
    id: 'fama',
    lineas: [
      ['Yo no soy famoso', 'ni salgo en la radio,'],
      ['pero en este vagón', 'tengo lleno el estadio.'],
      ['Si me dan una moneda,', 'les dedico el coro,'],
      ['y si me dan un billete,', 'me bajo y no les lloro.'],
    ],
  },
];

/** Lo que sale en lugar del pedazo que no pegó con la caja. */
export const TRABADAS = [
  'eh… eh… ¿cómo era?',
  'se me olvidó la letra',
  '…y la rima se me fue',
  'parce, espere, espere',
  'esto rimaba con algo',
  'la la la, ajá',
  'me trabé, me trabé',
  '¿en qué iba?',
];

/**
 * Cómo me fue, de lo mejor a lo peor. `grito` va grande; `linea` lo cuenta el cartón.
 * `cancelado` es cuando me callo a mitad del rap.
 */
export const VEREDICTOS = {
  durisimo: { grito: '¡ME LUCÍ!', linea: 'El vagón entero me aplaudió.' },
  bien: { grito: 'ME FUE BIEN', linea: 'Unos cuantos me siguieron el ritmo.' },
  regular: { grito: 'MÁS O MENOS', linea: 'Me trabé más de lo que me gustaría.' },
  mal: { grito: 'QUÉ OSO', linea: 'Más trabado que el trancón de la Caracas.' },
  bajado: { grito: 'ME BAJARON', linea: 'En la siguiente estación me pidieron que me bajara. Me tocó seguir a pie.' },
  cancelado: { grito: 'ME QUEDÉ CALLADO', linea: 'Me dio pena y no dije nada.' },
};

export const CON_MAL_OLOR = 'Con este olor, más de uno abrió la ventana.';

/**
 * La gente del vagón. `gusto` multiplica las ganas de dar; `billete`, que a veces da uno de $ 5.000 si me luzco.
 * `durante` es lo que hace mientras rimo (bueno o malo, según cómo voy). `dichos`, lo que dice o hace al final,
 * por nivel y según si me dio algo (`da`) o no (`nada`), para que lo que dice cuadre con la plata.
 * `dice` va entre comillas y en usted; `hace` lo cuenta el cartón.
 */
export const PASAJEROS = [
  {
    id: 'senora', nombre: 'La señora del mercado', dibujo: 'comida', gusto: 1.1,
    durante: { bueno: 'Lleva el ritmo con la bolsa.', malo: 'Se cambió de puesto.' },
    dichos: {
      durisimo: {
        da: [{ dice: '¡Ay, qué belleza! Tome, mijo, para el almuerzo.' }, { dice: 'Eso sí es talento, no como mi yerno. Tome.' }],
        nada: [{ dice: '¡Qué belleza, mijo! Lástima que me gasté todo en la plaza.' }],
      },
      bien: { da: [{ dice: 'Muy bonito, mijo. Tome una monedita.' }], nada: [{ dice: 'Así se rebusca uno, con gracia. Que le vaya bien.' }] },
      regular: { da: [{ dice: 'Tome, para la aguapanela.' }], nada: [{ dice: 'Ánimo, mijo, que la práctica hace al maestro.' }] },
      mal: { da: [{ dice: 'Tome, pero mejor venda dulces.' }], nada: [{ dice: 'Mijo, mejor venda dulces.' }, { dice: 'Ay, no, qué pena ajena.' }] },
    },
  },
  {
    id: 'estudiante', nombre: 'El estudiante', dibujo: 'foto', gusto: 1,
    durante: { bueno: 'Ya está grabando.', malo: 'Está grabando para los memes.' },
    dichos: {
      durisimo: { da: [{ dice: '¡Lo grabé todo! Tome, esto se vuelve viral.' }], nada: [{ dice: 'Le hice un video, ¿cómo lo etiqueto?' }] },
      bien: { da: [{ dice: 'Uy, buena esa. Ahí le va lo del pasaje.' }], nada: [{ dice: 'Buena esa. No tengo ni para el mío, pero lo sigo.' }] },
      regular: { da: [{ dice: 'Tome, para que ensaye.' }], nada: [{ dice: 'Lo grabé, pero para los memes.' }] },
      mal: { da: [{ dice: 'Tome por el esfuerzo. Igual lo subo a los memes.' }], nada: [{ dice: 'Ya lo subí a mis historias. Perdón.' }] },
    },
  },
  {
    id: 'celador', nombre: 'El celador que sale de turno', dibujo: 'sueno', gusto: 0.7,
    durante: { bueno: 'Abrió un ojo.', malo: 'Ronca más duro.' },
    dichos: {
      durisimo: { da: [{ dice: '¿Ya llegamos? Tome, por despertarme bonito.' }], nada: [{ hace: 'Se despertó, aplaudió y se volvió a dormir.' }] },
      bien: { da: [{ hace: 'Abrió un ojo, me pasó una moneda y siguió durmiendo.' }], nada: [{ hace: 'Abrió un ojo y siguió durmiendo.' }] },
      regular: { da: [{ hace: 'Entre dormido me pasó una moneda.' }], nada: [{ hace: 'Siguió durmiendo.' }] },
      mal: { da: [{ hace: 'Me pasó una moneda para que me callara.' }], nada: [{ hace: 'Se despertó solo para pedirme silencio.' }] },
    },
  },
  {
    id: 'corbata', nombre: 'El de corbata', dibujo: 'reloj', gusto: 0.8, billete: true,
    durante: { bueno: 'Se quitó un audífono.', malo: 'Subió el volumen.' },
    dichos: {
      durisimo: { da: [{ dice: '¿Eso era en vivo? Tome, crack.' }], nada: [{ dice: '¿Eso era en vivo? Muy bueno, pero solo cargo tarjeta.' }] },
      bien: { da: [{ hace: 'Me hizo así con la cabeza y me dio algo.' }], nada: [{ hace: 'Me hizo así con la cabeza.' }] },
      regular: { da: [{ hace: 'Sin quitarse los audífonos, me pasó una moneda.' }], nada: [{ hace: 'Ni se quitó los audífonos.' }] },
      mal: { da: [{ hace: 'Me dio una moneda para que lo dejara oír su música.' }], nada: [{ hace: 'Subió el volumen de los audífonos.' }] },
    },
  },
  {
    id: 'abuela', nombre: 'La abuela de la camándula', dibujo: 'corazon', gusto: 1.2,
    durante: { bueno: 'Lleva el compás con la camándula.', malo: 'Se persigna.' },
    dichos: {
      durisimo: { da: [{ dice: '¡Dios me lo bendiga, mijo, y me lo multiplique!' }], nada: [{ dice: '¡Dios me lo bendiga! Le voy a prender una vela.' }] },
      bien: { da: [{ dice: 'Dios le pague, mijito.' }], nada: [{ dice: 'Qué muchacho tan juicioso. Rezo por usted.' }] },
      regular: { da: [{ dice: 'Tome, mijito, y siga ensayando.' }], nada: [{ hace: 'Rezó por mí. No sé si por la rima.' }] },
      mal: { da: [{ dice: 'Ave María purísima. Tome, para que estudie.' }], nada: [{ dice: 'Ave María purísima.' }] },
    },
  },
  {
    id: 'parcero', nombre: 'El parcero de gorra', dibujo: 'radio', gusto: 1.3,
    durante: { bueno: 'Mueve la cabeza al ritmo.', malo: 'Niega con la cabeza.' },
    dichos: {
      durisimo: { da: [{ dice: 'Respeto, parcero. Eso tuvo flow.' }], nada: [{ dice: 'Respeto, parcero. Le debo la moneda, en serio.' }] },
      bien: { da: [{ dice: 'Nada mal. Le falta calle, pero va.' }], nada: [{ dice: 'Le falta calle, pero va.' }] },
      regular: { da: [{ dice: 'Tome, para que se compre un ritmo.' }], nada: [{ dice: 'Eso no rimó, parce.' }] },
      mal: { da: [{ dice: 'Tome, pero no vuelva a rimar.' }], nada: [{ dice: 'Me dieron ganas de bajarme a mí.' }] },
    },
  },
  {
    id: 'dulces', nombre: 'El de los dulces', dibujo: 'chaza', gusto: 0.4,
    durante: { bueno: 'Está tomando nota.', malo: 'Ya alista su turno.' },
    dichos: {
      durisimo: { da: [{ dice: 'Me quitó el turno, pero tome: hagamos sociedad.' }], nada: [{ dice: 'Me quitó el turno, pero hagamos sociedad.' }] },
      bien: { da: [{ dice: 'Bueno, tome, pero después me deja vender a mí.' }], nada: [{ dice: 'Bueno, bueno, después me deja vender a mí.' }] },
      regular: { da: [{ dice: 'Tome, por lo menos ya calentó al público.' }], nada: [{ dice: 'Ya, ya, hágale, que me toca a mí.' }] },
      mal: { da: [{ dice: 'Tome, pero bájese, que me espanta los clientes.' }], nada: [{ dice: 'Ni con dulces se compone eso.' }] },
    },
  },
  {
    id: 'turista', nombre: 'La turista', dibujo: 'mapa', gusto: 1.2, billete: true,
    durante: { bueno: 'Aplaude con ganas.', malo: 'Se puso a buscar en el traductor.' },
    dichos: {
      durisimo: { da: [{ dice: '¡Qué bacano! Tome. ¿Tiene redes? Lo quiero seguir.' }], nada: [{ dice: '¡Qué bacano! ¿Tiene redes? Lo quiero seguir.' }] },
      bien: { da: [{ dice: '¡Muy bueno! No entendí, pero tome.' }], nada: [{ dice: '¡Muy bueno! No entendí nada.' }] },
      regular: { da: [{ hace: 'Aplaudió por cortesía y me dio una moneda.' }], nada: [{ hace: 'Aplaudió por cortesía.' }] },
      mal: { da: [{ hace: 'Me dio una moneda sin saber muy bien por qué.' }], nada: [{ hace: 'Sacó el mapa para ver dónde bajarse.' }] },
    },
  },
  {
    id: 'maestro', nombre: 'El maestro de obra', dibujo: 'martillo', gusto: 1,
    durante: { bueno: 'Golpea el tubo al ritmo.', malo: 'Ya miró el reloj dos veces.' },
    dichos: {
      durisimo: { da: [{ dice: '¡Eso, mijo! Así se pega un ladrillo.' }], nada: [{ dice: '¡Eso, mijo! Si fuera viernes, le daba.' }] },
      bien: { da: [{ dice: 'Bien rimado. Tome para la gaseosa.' }], nada: [{ dice: 'Bien rimado. El viernes le colaboro.' }] },
      regular: { da: [{ dice: 'Le falta mezcla a eso, pero tome.' }], nada: [{ dice: 'Le falta mezcla a eso, pero bueno.' }] },
      mal: { da: [{ dice: 'Tome, y busque otro oficio.' }], nada: [{ dice: 'Eso se cayó como pared sin varilla.' }] },
    },
  },
  {
    id: 'enfermera', nombre: 'La enfermera del turno de noche', dibujo: 'vendaje', gusto: 1,
    durante: { bueno: 'Sonríe.', malo: 'Bosteza.' },
    dichos: {
      durisimo: { da: [{ dice: 'Usted me alegró la noche. Tome.' }], nada: [{ dice: 'Usted me alegró la noche. Ojalá tuviera sencillo.' }] },
      bien: { da: [{ dice: 'Qué bonito. Le voy a dar algo.' }], nada: [{ dice: 'Qué bonito. Me lo voy a acordar en el turno.' }] },
      regular: { da: [{ hace: 'Sonrió y me dio una moneda.' }], nada: [{ hace: 'Sonrió, pero no tenía sencillo.' }] },
      mal: { da: [{ hace: 'Me dio una moneda y me recomendó tomar agua.' }], nada: [{ hace: 'Me miró como a un paciente difícil.' }] },
    },
  },
];
