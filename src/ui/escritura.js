/** Cuánto de cada trazo va escrito, en orden y según su largo. El trazo en curso es uno solo. */
export function escritura(avance, largos) {
  const total = largos.reduce((s, l) => s + l, 0);
  let falta = Math.min(1, Math.max(0, avance)) * total;
  return largos.map(l => {
    const t = Math.min(1, falta / l);
    falta = Math.max(0, falta - l);
    return t;
  });
}
