// Lo unico que un jugador puede ver de otro (FR-010). Se arma campo por campo desde una lista blanca:
// nunca se devuelve el registro guardado, para que un campo nuevo en la tabla no se filtre sin querer.
export interface EstadisticasPublicas { partidas: number; dias: number; plata: number; peleas: number; tiempo: number }
export interface PerfilPublico {
  nombre: string;
  apariencia?: unknown;
  estadisticas?: EstadisticasPublicas;
  estado?: 'conectado' | 'jugando' | 'desconectado';
  sala?: string | null;
}

export interface Contexto {
  esAmigo: boolean;   // quien pregunta es amigo del perfil pedido
  esUnoMismo: boolean;
}

const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

export function perfilPublico(perfil: Record<string, any>, stats: Record<string, any> | undefined, presencia: Record<string, any> | undefined, ctx: Contexto): PerfilPublico {
  const salida: PerfilPublico = { nombre: String(perfil.nombre) };
  const visible = ctx.esUnoMismo || ctx.esAmigo || perfil.visibilidad !== 'amigos';
  if (!visible) return salida;   // con visibilidad "amigos", quien no es amigo ve solo el nombre
  if (perfil.apariencia && typeof perfil.apariencia === 'object') salida.apariencia = perfil.apariencia;
  salida.estadisticas = {
    partidas: numero(stats?.partidas), dias: numero(stats?.dias), plata: numero(stats?.plata), peleas: numero(stats?.peleas), tiempo: numero(stats?.tiempo),
  };
  const estado = presencia?.estado;
  salida.estado = estado === 'conectado' || estado === 'jugando' ? estado : 'desconectado';
  // la sala solo la ven los amigos, y solo mientras el otro juega
  salida.sala = ctx.esAmigo && salida.estado === 'jugando' && typeof presencia?.sala === 'string' ? presencia.sala : null;
  return salida;
}

export const CAMPOS_PUBLICOS = ['nombre', 'apariencia', 'estadisticas', 'estado', 'sala'] as const;
