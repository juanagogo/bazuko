// Regla de nombres de usuario: la misma que aplica el juego antes de enviar (cpp/src/online/NameRules.hpp).
// Solo letras a-z y numeros, de 3 a 16; la unicidad sin distinguir mayusculas la da Cognito.
import lista from '../../datos/nombres-prohibidos.json';

export const NOMBRE_MIN = 3;
export const NOMBRE_MAX = 16;
const PATRON = /^[A-Za-z0-9]+$/;

export type FallaNombre = 'corto' | 'largo' | 'caracteres' | 'prohibido';

export function revisarNombre(nombre: unknown): FallaNombre | null {
  if (typeof nombre !== 'string') return 'caracteres';
  if (nombre.length < NOMBRE_MIN) return 'corto';
  if (nombre.length > NOMBRE_MAX) return 'largo';
  if (!PATRON.test(nombre)) return 'caracteres';
  const min = nombre.toLowerCase();
  if (lista.partes.some((parte) => min.includes(parte))) return 'prohibido';
  const sinNumeros = min.replace(/[0-9]+$/, '');
  if (lista.exactos.includes(sinNumeros)) return 'prohibido';
  return null;
}

export function revisarContrasena(contrasena: unknown, nombre: string): 'corta' | 'igual_al_nombre' | null {
  if (typeof contrasena !== 'string' || contrasena.length < 8) return 'corta';
  if (contrasena.toLowerCase() === nombre.toLowerCase()) return 'igual_al_nombre';
  return null;
}
