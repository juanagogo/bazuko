#pragma once
// Lo que el filtro de una sustancia le hace a la imagen en un cuadro (port de lo que SubstanceEffects.js escribe en el lienzo y sus capas): el filtro de color
// (en el orden de CSS: desenfoque, sepia, rotacion de tono, saturacion, brillo y contraste), la capa de color encima (con su modo de mezcla) y la estela
// (el promedio de los ultimos cuadros, dibujado debajo con algo de opacidad, un vaiven y una respiracion). Solo datos: lo aplica present.frag.
namespace Bazuko {

struct SubstanceLook {
    bool active = false;
    // filtro (los valores por omision no cambian nada)
    float blurPx = 0.0f, sepia = 0.0f, hueDegrees = 0.0f, saturate = 1.0f, brightness = 1.0f, contrast = 1.0f;
    // capa de color: 0 ninguna, 1 conica de colores (overlay), 2 viñeta verde (multiply), 3 resplandor calido (soft-light), 4 tunel rojizo que pulsa (multiply)
    int overlay = 0;
    float overlayOpacity = 0.0f;
    float overlayAngleDegrees = 0.0f;   // pastilla: desde donde parte el degradado conico
    float overlayStop = 30.0f;          // basuco: % donde empieza el borde oscuro (oscila)
    // estela
    bool trail = false;
    float trailKeep = 0.8f;             // cuanto del cuadro anterior se conserva
    float trailOpacity = 0.0f;
    float trailShiftPx = 0.0f;
    float trailScale = 1.0f;
};

} // namespace Bazuko
