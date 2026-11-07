#pragma once

#include <string>

#include "game/GameState.h"

namespace bazuko {

// Recicladora El Progreso: paga al peso lo que no se come, no cura, no es sustancia ni sirve para construir.
// mult = (boost ? 1,2 : 1) · efecto `sellMult` del origen.
int recyclerTotal(const GameState& s, double mult);
// Vende todo lo reciclable. Devuelve lo ganado (0 si no había nada).
int sellToRecycler(GameState& s, double mult);

enum class ShopStatus { Ok, NotEnoughMoney, AlreadyOwned, TooHeavy, NotSold };
// Comprar una entrada de la tienda (`vendorItems` filtra lo que vende un vendedor ambulante; vacío = toda la tienda).
ShopStatus canBuy(const GameState& s, const ShopEntry& entry);
ShopStatus buy(GameState& s, const ShopEntry& entry);
// Texto corto con los efectos de un objeto consumible ("+25 hambre · +5 ánimo", "Cura: gripe.").
std::string describeItem(const ItemDef& item);

// Cambuche: se arma por piezas y la base va primero.
enum class BuildStatus { Ok, AlreadyBuilt, NeedsBase, MissingMaterials };
BuildStatus canBuild(const GameState& s, const CambuchePiece& piece);
BuildStatus build(GameState& s, const CambuchePiece& piece);

// Mesa de crafteo (tecla C): fabrica la receta y da XP.
bool craftRecipe(GameState& s, const Recipe& recipe);

}  // namespace bazuko
