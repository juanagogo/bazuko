#pragma once

#include <string>
#include <utility>
#include <vector>

#include "game/data/GameData.h"

namespace bazuko {

struct ItemStack { std::string id; int qty; };

class InventorySystem {
public:
    InventorySystem(const GameData& data, double maxWeight) : maxWeight(maxWeight), data_(data) {}

    double maxWeight;

    const std::vector<ItemStack>& items() const { return items_; }
    double totalWeight() const;
    bool isFull() const { return totalWeight() >= maxWeight; }
    int itemCount() const;
    int count(const std::string& id) const;

    // Falla (sin cambios) si el ítem no existe o no cabe el peso total.
    bool add(const std::string& id, int qty = 1);
    bool canAdd(const std::string& id, int qty = 1) const;
    // Quita hasta `qty` unidades; borra la entrada si llega a 0. false si no hay ninguna.
    bool remove(const std::string& id, int qty = 1);

    // Reemplaza el contenido (carga de partida). Descarta ids que ya no existen y devuelve cuántos.
    int restore(const std::vector<std::pair<std::string, int>>& saved);

private:
    const GameData& data_;
    std::vector<ItemStack> items_;
};

}  // namespace bazuko
