#pragma once

#include <string>
#include <unordered_map>

namespace Bazuko {

inline const std::unordered_map<std::string, std::string>& CharacterAnimationAliases() {
    static const std::unordered_map<std::string, std::string> aliases{
        {"idle_loop_fit", "Idle"},
        {"walk_loop_fit", "Walk"},
        {"sprint_loop_fit", "Run"},
        {"fixing_kneeling_fit", "Search"},
        {"idle_talking_loop_fit", "Talk"},
        {"consume_fit", "Consume"},
        {"crouch_idle_loop_fit", "Crouch"},
        {"overhandthrow_fit", "Throw"}
    };
    return aliases;
}

} // namespace Bazuko
