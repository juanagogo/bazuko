// Los dos cortes parten del chaleco de lona con canesú y del acolchado de uso cotidiano.
// Se dibujan en las coordenadas de reposo de la prenda, al mismo compás que la tela.
export const RECYCLER_VEST_PROFILE = Object.freeze({ lona: 1, acolchado: 2 });

export const RECYCLER_VEST_FIT = /* glsl */ `
float recyclerVestEdge(vec3 p, vec2 shoulder) {
  float y = p.y - shoulder.y;
  float x = abs(p.x);
  float front = smoothstep(.004, .065, p.z);
  float width = shoulder.x * mix(1.07, .88, smoothstep(-.115, .038, y));
  float top = .047 - .017 * smoothstep(shoulder.x * .47, shoulder.x, x);
  float edge = max(x - width, max(-.215 - y, y - top));
  // El escote baja por delante. Atrás el cuello sube hasta el comienzo de la nuca.
  float collar = mix(.039, .047 + .32 * y, front);
  float opening = max(x - collar, mix(.002, -.071, front) - y);
  return max(edge, -opening);
}
`;

export const RECYCLER_VEST_CLOTH = /* glsl */ `
    if (uStreetRecyclerVest > .5) {
      float y = p.y - uStreetArm.y;
      float x = abs(p.x);
      float front = smoothstep(.014, .06, p.z);
      float edge = recyclerVestEdge(p, uStreetArm.xy);
      float pixel = max(length(dFdx(p)), length(dFdy(p)));
      float aa = clamp(pixel * .68, .0012, .012);
      float vest = 1. - smoothstep(-aa, aa, edge);
      if (vest > 0.) {
        bool canvas = uStreetRecyclerVest < 1.5;
        vec3 ink = vec3(.035, .071, .112);
        vec3 red = vec3(.405, .059, .057);
        vec3 blue = vec3(.057, .146, .199);
        float yoke = smoothstep(-.122, -.119 + aa, y);
        vec3 dye = canvas ? mix(ink, red, yoke) : blue;

        // Una sola banda en el canesú de lona. El azul se reconoce por los paños y las costuras.
        float band = (1. - smoothstep(.010, .010 + aa, abs(y + .10))) * (canvas ? 1. : 0.);
        dye = mix(dye, vec3(.41, .46, .47), band);
        float quilt = min(abs(y + .062), min(abs(y + .112), abs(y + .171)));
        float seam = 1. - smoothstep(.0023, .0038 + aa * .35, quilt);
        if (!canvas) dye *= (.91 + .16 * smoothstep(.002, .019, quilt)) * (1. - seam * .18);

        // Dos bolsillos de entrada oblicua y un cierre continuo. La tela de las mangas queda a la vista.
        float pocketY = y + .162 + .2 * (x - uStreetArm.x * .51);
        float pocket = (1. - smoothstep(.032, .032 + aa, abs(x - uStreetArm.x * .51))) * front;
        float flap = pocket * (1. - smoothstep(.0038, .005 + aa, abs(pocketY)));
        float pocketBody = pocket * smoothstep(-.045, -.025 + aa, pocketY) * (1. - smoothstep(-.005, .001 + aa, pocketY));
        dye = mix(dye, dye * .74 + vec3(.012, .016, .018), pocketBody * .63);
        float zipper = front * (1. - smoothstep(.004, .0055 + aa, x));
        float binding = smoothstep(-.009 - aa, -.004 + aa, edge);
        dye = mix(dye, dye * .43 + ink * .34, max(binding, flap * .81));
        dye = mix(dye, vec3(.021, .026, .032), zipper * .84);

        float weave = streetNoise(vec2(p.x + p.z * .3, y) * 230.);
        weave = mix(weave, .5, smoothstep(.002, .007, pixel));
        dye *= (.83 + .32 * surfaceNoise) * (.94 + .12 * weave);
        diffuseColor.rgb = mix(diffuseColor.rgb, dye, vest);
        float faceRoughness = (canvas ? .91 : .76) - uStreetWet * (canvas ? .05 : .16);
        streetRoughness = mix(streetRoughness, mix(faceRoughness, .58, band), vest);
      }
    }
`;
