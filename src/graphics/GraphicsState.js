import {uniform} from 'three/tsl';
export const cityUniforms={uInteriorGlow:uniform(.95),wetness:uniform(.6),night:uniform(1),lightsOn:uniform(1),clouds:uniform(.7)};

// Both adapters read the same weather-controlled value, never independent clocks.
cityUniforms.uRoadWetness=cityUniforms.wetness;
