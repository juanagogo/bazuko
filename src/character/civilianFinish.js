// Aspereza en seco, relieve del hilo y concentración del lavado en el frente de la pierna.
const ALGODON = [.91, .032, 0];
const LANA = [.98, .028, 0];
const PUNTO = [.96, .052, 0];
const LONA = [.91, .040, .35];
const JEAN = [.86, .052, 1];
const FORRO = [.75, .025, 0];

export const CIVIL_TEXTILES = {
  chaqueta: [FORRO, JEAN],
  rayas: [ALGODON, JEAN],
  camisa: [LONA, LONA],
  buzo: [PUNTO, JEAN],
  camiseta: [ALGODON, JEAN],
  overol: [ALGODON, LONA],
  blusa: [ALGODON, JEAN],
  short: [ALGODON, JEAN],
  sudadera: [PUNTO, PUNTO],
  rota: [ALGODON, LONA],
  saco: [LANA, LONA]
};

// Canto de la suela en fracción de la estatura, aspereza del empeine y color de goma.
// Los tenis nuevos llevan una goma más clara. En botas y zapatos pesa más el canto oscuro.
export const CIVIL_SHOE_PROFILES = {
  tenis: { height: .010, roughness: .87, rubber: '#9a9384' },
  'tenis-rotos': { height: .010, roughness: .88, rubber: '#645c50' },
  zapatos: { height: .013, roughness: .65, rubber: '#302a25' },
  botas: { height: .018, roughness: .78, rubber: '#383532' }
};

export const CIVIL_SKIN = /* glsl */ `
    if (uStreetCivil > .5) {
      // El rubor más difuso va en mejillas y orejas; nariz y frente reflejan más que las mejillas.
      float cheek = streetSpot(side, eye + vec3(.026, -.024, .004), vec3(.023, .019, .034));
      float warmth = max(cheek, max(ears * .62, nose * .28)) * (.8 - uStreetWear * .22);
      diffuseColor.rgb *= mix(vec3(1.), vec3(1.13, 1.025, .985), warmth);
      streetRoughness = clamp(streetRoughness + cheek * .045 - shine * .16, .49, .95);
    }
`;

export const CIVIL_FABRIC_SHADE = /* glsl */ `
      if (uStreetCivil > .5) {
        // Llega a las sombras de costuras, bolsillos y herrajes que recortaba el límite de luminancia.
        // Las luces de los pliegues se comprimen para que conserven color y no parezcan pintura blanca.
        float relief = shade - 1.;
        relief *= mix(1.08, .64, step(0., relief));
        fabricShade = clamp(1. + relief / (1. + abs(relief) * .38), .24, 1.48);
      }
`;

export const CIVIL_FABRIC = /* glsl */ `
    if (uStreetCivil > .5) {
      vec3 textile = mix(uStreetUpperCloth, uStreetLowerCloth, step(.5, vStreetZone));
      // Diagonal del hilo en reposo. Se apaga al quedar por debajo de unos píxeles por vuelta.
      float yarn = 0.;
      #ifndef USE_ROUGHNESSMAP
        float thread = (p.y * .86 + p.x * .54 + p.z * .31) / .004;
        yarn = sin(thread * 6.2831853) * (1. - smoothstep(.22, .5, fwidth(thread)));
        diffuseColor.rgb *= 1. + (yarn + (surfaceNoise - .5) * .9) * textile.y;
      #endif
      if (textile.z > 0.) {
        vec3 rise = vec3(0., .083, .018);
        vec3 leg = vec3(.052, .13, .063);
        float thigh = max(streetSpot(p, uStreetLeftKnee + rise, leg), streetSpot(p, uStreetRightKnee + rise, leg));
        float front = smoothstep(.01, .067, p.z);
        float washed = max(thigh, knees * .8) * front * textile.z * (.36 + .52 * uStreetWear) * (.57 + .58 * surfaceNoise);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.20 + vec3(.016, .018, .024), washed);
      }
      streetRoughness = clamp(textile.x + abrasion * .04 + dust * .07 + stains * .05 + yarn * .025, .68, .99);
    }
`;

export const CIVIL_SHOES = /* glsl */ `
    if (uStreetCivil > .5) {
      // El canto sigue la curva de la talonera y sube en la puntera. La planta sigue siendo caucho oscuro.
      float rubberEdge = uStreetShoeFinish.x + smoothstep(.071, .128, p.z) * .004;
      float aa = clamp(fwidth(p.y - rubberEdge) * .65, .0008, .006);
      float rubber = 1. - smoothstep(-aa, aa, p.y - rubberEdge);
      float tread = 1. - smoothstep(-aa, aa, p.y - rubberEdge + .006);
      float welt = (1. - smoothstep(.0008, aa + .001, abs(p.y - rubberEdge))) * (1. - underside);
      vec3 rubberColor = uStreetRubber * (.66 + surfaceNoise * .35) * (1. - uStreetWear * .38) * (1. - tread * .49);
      diffuseColor.rgb = mix(diffuseColor.rgb, rubberColor, rubber * (1. - underside) * .82);
      diffuseColor.rgb *= 1. - welt * .21;
      streetRoughness = mix(uStreetShoeFinish.y + use * .08, .91, rubber) + (surfaceNoise - .5) * .06;
    }
`;
