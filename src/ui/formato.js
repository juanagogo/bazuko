// src/ui/formato.js
// Cómo se escriben la hora, la distancia y el porcentaje en toda la interfaz: una sola forma de cada uno.

/** 12:05, 06:00. La hora del juego va en horas con decimales. */
export function hora(h) {
  const minutos = Math.floor((((h % 24) + 24) % 24) * 60 + 1e-6);
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
}

/** 2:59. Segundos que faltan, sin bajar de cero. */
export function cuentaAtras(segundos) {
  const s = Math.max(0, Math.ceil(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 109 m, 1,2 km. */
export const metros = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(m)} m`);

/** 70 %, con su espacio. */
export const porcentaje = (n) => `${Math.round(n)} %`;
