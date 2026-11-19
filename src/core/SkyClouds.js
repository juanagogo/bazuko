// Solo la cúpula lee estos estratos. El campo de sombras sigue usando su proyección de nube original.
export const daylightCloudShader = /* glsl */ `
  const float cloudHorizon = 0.065;
  const float cloudBaseHeight = 550.0;
  const float cloudMidHeight = 668.0;
  const float cloudTopHeight = 818.0;
  const float highCloudHeight = 1610.0;
  const float lowCloudScale = 1.0 / 3450.0;

  float cloudBody(vec2 uv) {
    vec2 field = texture2D(cloudNoise, uv).rg;
    return mix(field.r, field.g, 0.28);
  }

  vec3 daylightClouds(vec3 sky, vec3 ray, float sunDot) {
    if (ray.y <= cloudHorizon) return sky;

    // Metros sobre la sabana. Intersectar el rayo desde la cámara da paralaje incluso al subir al viaducto.
    vec2 slope = ray.xz / ray.y;
    vec2 ground = cameraPosition.xz - cameraPosition.y * slope;
    float closed = smoothstep(0.68, 0.98, cloudCover);
    float lowVisibility = smoothstep(0.08, 0.27, ray.y);
    float highVisibility = smoothstep(0.12, 0.36, ray.y);

    // El velo alto es más delgado, tiene otra orientación y deriva a un ritmo propio.
    // Estos factores son múltiplos de 1/64 para repetir sin salto cuando cloudOffset vuelve a cero.
    vec2 highPoint = ground + highCloudHeight * slope;
    vec2 highUV = mat2(0.86, 0.50, -0.50, 0.86) * highPoint * vec2(1.0 / 5260.0, 1.0 / 3750.0)
      + vec2(0.68, 0.14) + cloudOffset.yx * vec2(0.046875, -0.03125);
    vec2 highField = texture2D(cloudNoise, highUV).rg;
    float veil = smoothstep(mix(0.63, 0.28, cloudCover), mix(0.88, 0.63, cloudCover),
      mix(highField.r, highField.g, 0.21));
    vec3 highColor = mix(cloudShadow, cloudLight, mix(0.64, 0.12, closed) + 0.1 * highField.r);

    // Con aguacero se cierra el azul entre estratos. Se conserva la difusión que ya tiene el horizonte.
    vec3 overcast = mix(bottomColor, mix(cloudShadow, topColor, 0.28), smoothstep(0.03, 0.43, ray.y));
    sky = mix(sky, overcast, closed * 0.89 * smoothstep(cloudHorizon, 0.17, ray.y));
    sky = mix(sky, highColor, veil * highVisibility * mix(0.25, 0.60, cloudCover));

    // Tres cortes siguen el rayo dentro del banco bajo. El perfil se afina hacia la cima.
    vec2 drift = vec2(0.32, 0.69) + cloudOffset * 0.0625;
    vec2 startUV = ground * lowCloudScale + drift;
    vec2 slopeUV = slope * lowCloudScale;
    vec2 baseUV = startUV + cloudBaseHeight * slopeUV;
    float base = cloudBody(baseUV);
    float middle = cloudBody(startUV + cloudMidHeight * slopeUV);
    float crown = cloudBody(startUV + cloudTopHeight * slopeUV);
    float threshold = mix(0.796, 0.35, cloudCover);
    float baseDensity = 0.88 * smoothstep(threshold - 0.023, threshold + 0.072, base);
    float middleDensity = 0.88 * smoothstep(threshold - 0.018, threshold + 0.073, middle);
    float topDensity = 0.75 * smoothstep(threshold + 0.022, threshold + 0.113, crown);
    vec3 layers = vec3(baseDensity, (1.0 - baseDensity) * middleDensity,
      (1.0 - baseDensity) * (1.0 - middleDensity) * topDensity);
    float density = layers.x + layers.y + layers.z;

    // La base en sombra se dibuja delante del lomo. La muestra solar estima dónde la luz se dispersa de lado.
    float edgeLight = clamp((middle - base) * 1.9, -0.18, 0.20);
    if (octaves > 2.5) {
      vec2 lightStep = sunDirection.xz * mix(0.041, 0.022, max(sunDirection.y, 0.0));
      edgeLight += clamp((base - cloudBody(baseUV + lightStep)) * 2.2, -0.27, 0.27);
    }
    vec3 scattering = vec3(0.70 - baseDensity * 0.43 + edgeLight,
      0.84 - middleDensity * 0.30 + (crown - middle) * 0.58, 0.97 - topDensity * 0.15);
    float openLight = dot(layers, scattering) / max(density, 0.001);
    float transmission = mix(openLight, 0.08 + (1.0 - base) * 0.15 + edgeLight * 0.23, closed);
    vec3 lowerColor = mix(cloudShadow, cloudLight, clamp(transmission, 0.03, 0.95));
    lowerColor += sunGlowColor * pow(sunDot, 9.0) * sunGlowIntensity
      * (0.51 - baseDensity * 0.27) * (1.0 - closed * 0.82);
    lowerColor += vec3(0.75, 0.80, 0.95) * flash * (0.32 + baseDensity * 0.7);

    // Los cuerpos lejanos pierden contraste antes de llegar al perfil de los cerros.
    lowerColor = mix(bottomColor, lowerColor, lowVisibility);
    return mix(sky, lowerColor, density * lowVisibility);
  }
`;
