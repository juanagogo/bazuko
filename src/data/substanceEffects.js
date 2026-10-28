// src/data/substanceEffects.js
// Recetas visuales de los efectos de consumo. `i` es la intensidad (0 a 1) y `t` los segundos del efecto.
// Ninguna oscilación de color o brillo supera ~0,5 Hz: nada de destellos.

export const EFFECT_FADE_IN = 3;   // s de subida de un efecto nuevo
export const EFFECT_FADE_OUT = 6;  // s de bajada al final de su duración
export const EFFECT_CUT_FADE = 1;  // s reales de desvanecido en cortes y reemplazos

export const SUBSTANCE_EFFECTS = Object.freeze({
  // Euforia de colores: el tono oscila despacio y la imagen «respira».
  pastilla: Object.freeze({
    seconds: 45,
    filter: (i, t) => ({ hueRotate: 160 * i * Math.sin(t * 0.35), saturate: 1 + 1.3 * i, contrast: 1 + 0.12 * i }),
    overlay: (i, t) => ({
      background: `conic-gradient(from ${(t * 25) % 360}deg, #ff3d7f, #ffd23d, #3dff8b, #3dc5ff, #b03dff, #ff3d7f)`,
      mixBlendMode: 'overlay', opacity: 0.32 * i
    }),
    trail: Object.freeze({ keep: 0.82, opacity: 0.5, sway: 0, breathe: 0.025 }),
    camera: Object.freeze({ fov: 4, roll: 0.02, hz: 0.25 })
  }),
  // Mareo: borroso, verdoso, bordes oscuros y visión doble que se balancea.
  pegante: Object.freeze({
    seconds: 35,
    filter: (i) => ({ blur: 1.6 * i, sepia: 0.35 * i, hueRotate: 55 * i, saturate: 1 - 0.25 * i, brightness: 1 - 0.08 * i }),
    overlay: (i) => ({
      background: 'radial-gradient(ellipse at center, transparent 35%, rgba(20,50,10,.85) 100%)',
      mixBlendMode: 'multiply', opacity: 0.7 * i
    }),
    trail: Object.freeze({ keep: 0.9, opacity: 0.6, sway: 14, breathe: 0.01 }),
    camera: Object.freeze({ fov: 6, roll: 0.07, hz: 0.32 })
  }),
  // Cálido y lento: tonos dorados, brillo suave al centro y movimiento perezoso.
  hierba: Object.freeze({
    seconds: 60,
    filter: (i) => ({ sepia: 0.4 * i, saturate: 1 + 0.35 * i, brightness: 1 + 0.06 * i, contrast: 1 - 0.06 * i }),
    overlay: (i) => ({
      background: 'radial-gradient(ellipse at center, rgba(255,200,90,.55) 0%, rgba(255,150,40,.15) 45%, rgba(40,20,0,.6) 100%)',
      mixBlendMode: 'soft-light', opacity: 0.8 * i
    }),
    trail: Object.freeze({ keep: 0.7, opacity: 0.3, sway: 0, breathe: 0.008 }),
    camera: Object.freeze({ fov: 3, roll: 0.008, hz: 0.12 })
  })
});
