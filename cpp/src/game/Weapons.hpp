#pragma once
// Armas cuerpo a cuerpo del original (src/data/weapons.js): dano por golpe, alcance en metros y empuje.
// El port conserva sus propias animaciones y tiempos de combate; de la tabla toma el dano, el alcance y el empuje.
#include <string>

namespace Bazuko {

struct WeaponStats {
    const char* id;
    const char* name;
    float damage;      // vida que quita un golpe normal (el ultimo del combo pega 1,5 veces mas)
    float range;       // alcance en metros
    float knockback;   // empuje (1 = el de un puno)
    bool hitAll;
};

inline const WeaponStats* FindWeapon(const std::string& id) {
    static const WeaponStats table[] = {
        {"punos", "Puños", 12.0f, 1.3f, 0.9f, false},
        {"cuchillo", "Cuchillo", 28.0f, 1.45f, 0.7f, true},
        {"botella_picada", "Botella picada", 20.0f, 1.6f, 1.2f, true},
        {"arma", "Arma casera", 34.0f, 1.8f, 1.6f, true},
    };
    for (const WeaponStats& weapon : table) if (id == weapon.id) return &weapon;
    return nullptr;
}

} // namespace Bazuko
