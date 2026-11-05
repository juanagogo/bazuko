#pragma once

#include <optional>
#include <string>
#include <vector>

#include "core/Input.h"
#include "core/Rng.h"
#include "game/Entities.h"
#include "game/GameState.h"
#include "world/Bogota.h"

namespace bazuko {

enum class TargetType { None, Pickup, Car, Recycler, Shop, Vendor, Cambuche, Dealer, Craft };

struct Target {
    TargetType type = TargetType::None;
    int index = -1;  // en Entities::pickups / cars, o en Bogota::vendors()
};

// Todo lo que el jugador hace al acercarse a algo (InteractionSystem.js): recoger o seleccionar basura (E / Q),
// robar retrovisores, abrir tiendas, vender sustancias de noche, pedir limosna (B / L) y el boost (F).
class Interaction {
public:
    Interaction(GameState& state, Entities& entities, const Bogota& city, Rng& rng)
        : s_(state), e_(entities), city_(city), rng_(rng) {}

    std::string originId;  // origen del personaje (data/origins)

    // Avanza el boost y la selección y atiende las teclas. `playerPos` en el plano XZ.
    void update(double dt, Input& input, const Vec3& playerPos);

    const Target& current() const { return current_; }
    bool boostActive() const { return boostActive_; }
    double boostTimeLeft() const { return boostTimer_; }
    bool sorting() const { return sortingPickup_ >= 0; }  // el jugador mantiene Q sobre una bolsa
    int sortingPickup() const { return sortingPickup_; }

    // Acciones (las usa update; también la interfaz de usuario).
    bool toggleBoost();
    void harvestTrash(int pickup, bool sorted);
    void stealCar(int car);
    void sellSubstances();
    struct BuyResult {
        bool ok = false;
        std::string reason, name;
        int cost = 0;
    };
    BuyResult buySubstance(const std::string& itemId = {});
    void beg();

    // Efecto del origen elegido (1 si no aplica). Las claves con "Mult" se multiplican.
    double originEffect(const std::string& key, double base = 1.0) const;

private:
    void endBoost() { boostActive_ = false; boostTimer_ = 0; }
    std::string weightedPick(const std::vector<LootEntry>& table);
    void sound(const char* name) { s_.bus.emit(EvSound{name}); }
    // Añade los ítems que caben y devuelve sus nombres; avisa de los que se pierden por la mochila llena.
    std::vector<std::string> collect(const std::vector<std::string>& ids);

    GameState& s_;
    Entities& e_;
    const Bogota& city_;
    Rng& rng_;
    Target current_;
    bool boostActive_ = false;
    double boostTimer_ = 0;
    bool holdingQ_ = false;
    int sortingPickup_ = -1;
    double sinceBeg_ = 1e9;
    static constexpr double kBegCooldown = 4;
};

}  // namespace bazuko
