// Lo que una cuenta puede guardar en su perfil y lo que ve de si misma. Sin acceso a la red ni a tablas: se prueba solo.

export type Visibilidad = 'todos' | 'amigos';

export interface EstadisticasPropias { partidas: number; dias: number; plata: number; peleas: number; tiempo: number }

export interface PerfilPropio {
  nombre: string;
  apariencia: Record<string, string | number | boolean> | null;
  visibilidad: Visibilidad;
  creado: number;   // segundos desde 1970
  estadisticas: EstadisticasPropias;
}

// La apariencia son las opciones del creador de personaje: un objeto plano y chico. Nada anidado, nada largo.
export const APARIENCIA_MAX_CAMPOS = 60;
export const APARIENCIA_MAX_BYTES = 2048;

export function revisarApariencia(valor: unknown): Record<string, string | number | boolean> | null | 'invalida' {
  if (valor === null) return null;
  if (typeof valor !== 'object' || Array.isArray(valor)) return 'invalida';
  const entradas = Object.entries(valor as Record<string, unknown>);
  if (entradas.length > APARIENCIA_MAX_CAMPOS) return 'invalida';
  const limpia: Record<string, string | number | boolean> = {};
  for (const [clave, v] of entradas) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(clave)) return 'invalida';
    if (typeof v === 'string') { if (v.length > 80) return 'invalida'; limpia[clave] = v; }
    else if (typeof v === 'number') { if (!Number.isFinite(v)) return 'invalida'; limpia[clave] = v; }
    else if (typeof v === 'boolean') limpia[clave] = v;
    else return 'invalida';
  }
  if (Buffer.byteLength(JSON.stringify(limpia), 'utf8') > APARIENCIA_MAX_BYTES) return 'invalida';
  return limpia;
}

export interface Cambios { apariencia?: Record<string, string | number | boolean> | null; visibilidad?: Visibilidad }

// El cuerpo de PUT /yo: solo apariencia y visibilidad. Cualquier otro campo (nombre, cuenta, estadisticas) es un pedido invalido.
export function revisarCambios(cuerpo: unknown): Cambios | 'invalido' {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return 'invalido';
  const salida: Cambios = {};
  for (const [clave, valor] of Object.entries(cuerpo as Record<string, unknown>)) {
    if (clave === 'apariencia') {
      const apariencia = revisarApariencia(valor);
      if (apariencia === 'invalida') return 'invalido';
      salida.apariencia = apariencia;
    } else if (clave === 'visibilidad') {
      if (valor !== 'todos' && valor !== 'amigos') return 'invalido';
      salida.visibilidad = valor;
    } else return 'invalido';
  }
  return salida;
}

const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

// Lo que la cuenta ve de si misma: tambien campo por campo, para que nada interno de la tabla (cuenta, nombreMin) salga
export function perfilPropio(perfil: Record<string, any>, stats: Record<string, any> | undefined): PerfilPropio {
  const apariencia = perfil.apariencia && typeof perfil.apariencia === 'object' ? perfil.apariencia : null;
  return {
    nombre: String(perfil.nombre),
    apariencia,
    visibilidad: perfil.visibilidad === 'amigos' ? 'amigos' : 'todos',
    creado: numero(perfil.creado),
    estadisticas: {
      partidas: numero(stats?.partidas), dias: numero(stats?.dias), plata: numero(stats?.plata), peleas: numero(stats?.peleas), tiempo: numero(stats?.tiempo),
    },
  };
}
