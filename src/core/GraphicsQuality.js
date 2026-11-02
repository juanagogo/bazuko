export const GRAPHICS_PROFILES = Object.freeze({
  // farDetailFog: en qué punto de la niebla (0 empieza, 1 tapa todo) dejan de dibujarse peatones y bolsas lejanos.
  baja: { pixelRatio: 1, shadowSize: 0, silhouette: false, animationBudget: 3, far: 180, farDetailFog: .7 },
  media: { pixelRatio: 1.25, shadowSize: 1024, silhouette: true, animationBudget: 2, far: 220 },
  alta: { pixelRatio: 1.5, shadowSize: 2048, silhouette: true, animationBudget: 1, far: 300 }
});

export function effectiveQuality(selected = 'alta', pressure = 0, autoTier = 0) {
  const levels = ['baja', 'media', 'alta'];
  const base = Math.min(levels.length - 1, Math.max(0, levels.indexOf(selected)) + autoTier);
  return levels[Math.max(0, base - pressure)];
}

// El trabajo de un cuadro crece 1,4 veces al prender las sombras: desde CALM_WORK_MS en baja ya no cabe en 60 FPS.
const CALM_FRAME_MS = 18, CALM_WORK_MS = 12, CALM_NEEDED_MS = 20000, MAX_SLOW_SHARE = .02, DROP_WINDOW_MS = 3000, DROP_SLOW_SHARE = .2;
// Un intervalo así no es el ritmo del equipo: la pestaña estuvo oculta o hubo un tirón aislado.
const GAP_FRAME_MS = 250, GAPS_TO_DROP = 3;

/**
 * Sube de baja a media a quien nunca eligió calidad, si su equipo lleva unos veinte segundos
 * holgado. No guarda nada: la preferencia sigue siendo del jugador. Un solo intento por sesión.
 */
export class AutoQuality {
  constructor(eligible = false) {
    this.eligible = eligible;
    this.tier = 0;
    this.blocked = false;
    this.preparing = false;
    this.started = false; // el primer setQuality es el del arranque, no una elección del jugador
    this.reset();
  }

  reset() { this.elapsed = 0; this.frames = 0; this.slow = 0; this.gaps = 0; }

  /** El jugador eligió, o algo falló: la calidad ya no cambia sola. */
  cancel() {
    const raised = this.tier > 0;
    this.eligible = false; this.tier = 0; this.blocked = true; this.preparing = false;
    return raised;
  }

  /** Devuelve 'subir', 'bajar' o null; no toca nada del motor gráfico. */
  sample(frameMs, workMs, { pressure = 0, atMaxRatio = true } = {}) {
    if (!this.eligible || this.blocked || this.preparing || !Number.isFinite(frameMs) || frameMs <= 0) return null;
    if (frameMs > GAP_FRAME_MS) {
      if (this.tier === 0) { this.reset(); return null; }
      // Con sombras no reinician la ventana: si lo hicieran, intervalos que rozan este valor nunca
      // bajarían. Varios en una ventana dicen que el equipo no aguanta; cerrarla los olvida.
      if (++this.gaps < GAPS_TO_DROP) return null;
      this.reset();
      this.tier = 0;
      this.blocked = true;
      return 'bajar';
    }
    this.elapsed += frameMs;
    this.frames++;
    if (this.tier === 0) {
      // Un cuadro lento, la presión del sistema adaptativo o un trabajo alto vuelven a empezar la cuenta.
      if (frameMs > CALM_FRAME_MS || workMs > CALM_WORK_MS) this.slow++;
      if (pressure > 0 || !atMaxRatio || this.slow > Math.max(4, this.frames * MAX_SLOW_SHARE)) { this.reset(); return null; }
      if (this.elapsed < CALM_NEEDED_MS) return null;
      this.reset();
      this.preparing = true;
      return 'subir';
    }
    if (frameMs > 1000 / 58) this.slow++;
    if (this.elapsed < DROP_WINDOW_MS) return null;
    const share = this.slow / this.frames, fps = this.frames * 1000 / this.elapsed;
    this.reset();
    // Igual que la resolución: a 60 FPS reales el intervalo medido oscila alrededor del límite y no es lentitud.
    if ((share < DROP_SLOW_SHARE || fps >= 58) && pressure === 0) return null;
    this.tier = 0;
    this.blocked = true;
    return 'bajar';
  }
}
