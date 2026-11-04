#pragma once

#include <cstdlib>
#include <string>
#include <unordered_map>

namespace Bazuko {

// Andar y correr del juego original (andar-cansado.glb, de Mixamo: Sad Walk y Running), reorientados a este esqueleto con
// tools/agregar_correr_mixamo.py. Los de ActionForge siguen en el banco (BAZUKO_ANDAR_ANTERIOR=1 los vuelve a usar).
inline const std::unordered_map<std::string, std::string>& CharacterAnimationAliases() {
    static const bool previous = std::getenv("BAZUKO_ANDAR_ANTERIOR") != nullptr;
    static const std::unordered_map<std::string, std::string> aliases{
        {"idle_loop_fit", "Idle"},
        {std::getenv("BAZUKO_ANDAR_CANSADO") ? "walk_mixamo" : "walk_loop_fit", "Walk"},
        {previous ? "sprint_loop_fit" : "run_mixamo", "Run"},
        {"fixing_kneeling_fit", "Search"},
        {"idle_talking_loop_fit", "Talk"},
        {"consume_fit", "Consume"},
        {"crouch_idle_loop_fit", "Crouch"},
        {"overhandthrow_fit", "Throw"}
    };
    return aliases;
}

} // namespace Bazuko
