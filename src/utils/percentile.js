export function percentile(sorted, p) {
  return sorted.length ? sorted[Math.ceil(sorted.length * p) - 1] : 0;
}
