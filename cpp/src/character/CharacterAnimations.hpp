#pragma once

#include <cstdlib>
#include <string>
#include <unordered_map>

namespace Bazuko {

// Correr: el trote de Quaternius (CC0) reorientado con tools/animaciones/reorientar_clip.py. Andar cansado: de andar-cansado.glb (Mixamo), reorientado con
// tools/agregar_correr_mixamo.py. Los de ActionForge siguen en el banco (BAZUKO_ANDAR_ANTERIOR=1 los vuelve a usar). El andar cansado (WalkTired) solo lo usan el jugador sin energia y 1 de cada 10 peatones..
inline const std::unordered_map<std::string, std::string>& CharacterAnimationAliases() {
    static const bool previous = std::getenv("BAZUKO_ANDAR_ANTERIOR") != nullptr;
    static const std::unordered_map<std::string, std::string> aliases{
        {"idle_loop_fit", "Idle"},
        {"walk_loop_fit", "Walk"},
        {"walk_mixamo", "WalkTired"},   // andar cansado: unos pocos peatones y el jugador sin energia
        {previous ? "sprint_loop_fit" : "Jog", "Run"},   // el trote de Quaternius (CC0), en lugar del de Mixamo
        {"run_mixamo", "RunPrevious"},   // el correr de Mixamo: respaldo si el banco no trae Jog (CharacterManager)
        {"fixing_kneeling_fit", "Search"},
        {"idle_talking_loop_fit", "Talk"},
        {"consume_fit", "Consume"},
        {"crouch_idle_loop_fit", "Crouch"},
        {"overhandthrow_fit", "Throw"}
    };
    return aliases;
}

} // namespace Bazuko
