export const GRAPHICS_PROFILES = Object.freeze({
  baja: { pixelRatio: 1, shadowSize: 0, localLights:16,ssr:false,bloom:true,bloomResolution:.25, silhouette: false, animationBudget: 3, far: 180 },
  media: { pixelRatio: 1, shadowSize: 1024,localLights:48,ssr:false,bloom:true,bloomResolution:.5, silhouette: true, animationBudget: 2, far: 220 },
  alta: { pixelRatio: 1, shadowSize: 2048,localLights:96,ssr:true,bloom:true,bloomResolution:.5, silhouette: true, animationBudget: 1, far: 300 }
});

export function effectiveQuality(selected = 'alta', pressure = 0) {
  const levels = ['baja', 'media', 'alta'];
  return levels[Math.max(0, Math.max(0, levels.indexOf(selected)) - pressure)];
}
