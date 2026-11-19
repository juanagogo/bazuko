let consulta;

export function prefiereMovimientoReducido() {
  consulta ??= globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
  return consulta?.matches ?? false;
}
