// El pavimento del parque cruza dos mallas. Las manchas se muestrean en metros en ambas.
export const PAVING_STAIN_GLSL = /* glsl */`
vec2 pavingStains(vec2 at) {
  return vec2(texture2D(uSunCloud, at * .017 + .2).r, texture2D(uSunCloud, at.yx * .05 + .6).g);
}
float pavingTone(vec2 stains) {
  return 1.07 - .2 * smoothstep(.3, .78, stains.x) - .11 * smoothstep(.42, .82, stains.y);
}
`;
