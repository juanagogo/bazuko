// Oleaje entre los rizos de centímetros y la malla de un metro. El lecho y el
// espejo consultan las mismas crestas para desviar la vista y la luz del sol.
export const LAKE_WAVE_FIELD = /* glsl */ `
const vec2 lakeWind = vec2(0.81915, 0.57358);
const vec2 lakeCrosswind = vec2(-0.57358, 0.81915);

// xy = pendiente en ejes del mundo, z = curvatura aproximada en las crestas (1/m).
vec3 lakeWindWaves(vec2 point, float time, float shoreMeters, float pixelMeters, float rain) {
  vec2 p = vec2(dot(point, lakeWind), dot(point, lakeCrosswind));
  const vec3 kx = vec3(4.21, 7.05, 10.97);
  const vec3 kz = vec3(1.48, -4.83, 7.67);
  vec3 envelope = sin(p.x * vec3(0.29, -0.22, 0.43) + p.y * vec3(0.39, 0.47, -0.31)
    - time * vec3(0.32, 0.53, 0.41));
  // Crestas cortas: dos trenes con distinta apertura y un frente que gira dentro
  // de cada ráfaga rompen la hilera de reflejos a ras del agua.
  vec3 bends = sin(p.x * vec3(0.38, -0.49, 0.64) + p.y * vec3(1.12, 1.86, 2.40)
    - time * vec3(0.58, -0.76, 0.67));
  vec3 phase = p.x * kx + p.y * kz - time * vec3(6.62, 9.14, 11.46) + envelope + 0.87 * bends;
  vec3 resolved = 1.0 - smoothstep(vec3(0.12, 0.075, 0.045), vec3(0.42, 0.24, 0.15), vec3(pixelMeters));
  vec3 height = vec3(0.014, 0.008, 0.0042) * (0.57 + 0.41 * envelope) * resolved;
  height *= mix(0.16, 1.0, smoothstep(0.08, 3.2, shoreMeters)) * (1.0 + 0.25 * rain);
  vec3 gradient = cos(phase) * height;
  vec2 slope = lakeWind * dot(gradient, kx) + lakeCrosswind * dot(gradient, kz);
  return vec3(slope, -dot(height * sin(phase), kx * kx + kz * kz));
}
`;
