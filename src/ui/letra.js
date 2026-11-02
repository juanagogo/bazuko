// La letra es parte de lo que se carga: nada que dependa de ella se pinta antes de tenerla.
const FAMILIA = '"Dios Le Pague"';
/** Para ctx.font en los lienzos de la interfaz. */
export const LETRA = `${FAMILIA}, sans-serif`;
const MUESTRA = 'a'; // una letra y un dibujo
const TOPE_MS = 5000;

let lista = null;

/** Espera los dos cortes. Si tardan o fallan, sigue: el juego no se queda en la pantalla de carga por la letra. */
export function letraLista() {
  if (lista) return lista;
  const fuentes = globalThis.document?.fonts;
  if (!fuentes?.load) return (lista = Promise.resolve(false));
  const cargar = Promise.all([
    fuentes.load(`400 16px ${FAMILIA}`, MUESTRA),
    fuentes.load(`800 16px ${FAMILIA}`, MUESTRA),
  ]).then(() => true, () => false);
  let reloj;
  const tope = new Promise((listo) => { reloj = setTimeout(() => listo(false), TOPE_MS); });
  return (lista = Promise.race([cargar, tope]).finally(() => clearTimeout(reloj)));
}

/** Solo para pruebas. */
export const olvidarLetra = () => { lista = null; };
