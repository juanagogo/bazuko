// Reglas de los resultados de partida: que cuenta y que es imposible (FR-017, FR-018).
// El anfitrion manda lo que vio de cada jugador desde su ultimo informe; el servidor solo acredita lo que cabe en el tiempo real que esa cuenta lleva en la sala.

export const TABLAS_CLASIFICACION = ['dias', 'plata', 'peleas', 'partidas', 'tiempo'] as const;
export type TablaClasificacion = (typeof TABLAS_CLASIFICACION)[number];

export interface Resultado { nombre: string; dias: number; plata: number; peleas: number; muertes: number; tiempo: number }

export const MARGEN_SEG = 10;             // demora entre el informe y su llegada
export const MIN_PARA_CONTAR_SEG = 60;    // una partida cuenta en "partidas" despues de un minuto dentro
export const REINICIO_SEG = 30 * 60;      // volver a la misma sala tras media hora es otra partida
export const MAX_JUGADORES = 16;

// Topes por segundo real dentro de la sala: un dia de juego dura una hora real, pero dormir lo adelanta (como mucho uno cada 10 minutos)
export function topes(segundos: number) {
  const s = Math.max(0, segundos);
  return {
    tiempo: s + MARGEN_SEG,
    dias: Math.floor(s / 600) + 1,
    plata: 50000 + s * 2000,
    peleas: Math.floor(s / 5) + 1,
    muertes: Math.floor(s / 5) + 1,
  };
}

const entero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

// El cuerpo de POST /partidas/{codigo}/resultado: una lista de jugadores sin repetidos, con numeros enteros no negativos
export function revisarResultados(cuerpo: unknown): Resultado[] | null {
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return null;
  const lista = (cuerpo as Record<string, unknown>).jugadores;
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > MAX_JUGADORES) return null;
  const vistos = new Set<string>();
  const salida: Resultado[] = [];
  for (const j of lista) {
    if (!j || typeof j !== 'object') return null;
    const f = j as Record<string, unknown>;
    if (typeof f.nombre !== 'string' || !/^[A-Za-z0-9]{3,16}$/.test(f.nombre)) return null;
    const clave = f.nombre.toLowerCase();
    if (vistos.has(clave)) return null;
    vistos.add(clave);
    const r = { nombre: f.nombre, dias: entero(f.dias ?? 0), plata: entero(f.plata ?? 0), peleas: entero(f.peleas ?? 0), muertes: entero(f.muertes ?? 0), tiempo: entero(f.tiempo ?? 0) };
    if (r.dias === null || r.plata === null || r.peleas === null || r.muertes === null || r.tiempo === null) return null;
    salida.push(r as Resultado);
  }
  return salida;
}

// Lo que se acredita a una cuenta que lleva `segundos` reales en la sala desde su ultima marca. null: imposible, no se acredita nada de ese jugador
export function acreditable(r: Resultado, segundos: number): Omit<Resultado, 'nombre'> | null {
  const t = topes(segundos);
  if (r.dias > t.dias || r.plata > t.plata || r.peleas > t.peleas || r.muertes > t.muertes) return null;
  if (r.tiempo > t.tiempo + 60) return null;   // mas de un minuto de mas no es demora: es inventado
  return { dias: r.dias, plata: r.plata, peleas: r.peleas, muertes: r.muertes, tiempo: Math.min(r.tiempo, Math.max(0, Math.floor(segundos))) };
}

// Codigo de sala del relevo: letras y numeros, sin minusculas
export const codigoValido = (c: unknown): c is string => typeof c === 'string' && /^[A-Z0-9]{4,10}$/.test(c);
