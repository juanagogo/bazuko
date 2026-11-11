#pragma once
// Economia del jugador: inventario, botin, venta, compra, fabricacion, uso de objetos, experiencia e infeccion al rebuscar. Antes eran
// lambdas de main() mezcladas con el audio y la interfaz; aqui son funciones sobre `PlayerSession` que devuelven QUE paso (un resultado), y
// main() decide que sonido y que aviso mostrar. Lo ejecuta tambien un servidor. tests/EconomyTest.cpp las compara con las lambdas originales.
#include "GameData.hpp"
#include "PlayerSession.hpp"

#include <random>
#include <string>
#include <utility>
#include <vector>

namespace Bazuko::Economy {

// Receta de la mesa de crafteo (src/data/recipes.js del original)
struct RecipeDef { std::string id; int quantity; std::vector<std::pair<std::string, int>> ingredients; };

// Recetas de la mesa de crafteo: las de src/data/recipes.js del original (todos los materiales salen de la basura, la tienda o el dealer)
const std::vector<RecipeDef>& Recipes();

float Capacity(const PlayerSession& session, const GameData& data);        // kg que cabe en el costal
int CountItem(const PlayerSession& session, const GameData& data, const std::string& id);
int AvailableCount(const PlayerSession& session, const GameData& data, const std::string& id);   // cuantas unidades mas caben
bool AddItem(PlayerSession& session, const GameData& data, const std::string& id);               // false si no existe o no cabe

struct SellResult { int soldCount = 0; float earned = 0.0f; };
// Vende todo lo reciclable (precio x `multiplier`); si vende algo suma plata, contador y +2 de animo. La experiencia la otorga quien llama.
SellResult SellRecyclables(PlayerSession& session, const GameData& data, float multiplier);

enum class CraftOutcome { Unknown, MissingMaterials, NoRoom, Crafted };
struct CraftResult { CraftOutcome outcome = CraftOutcome::Unknown; std::string resultName; int quantity = 0; };
CraftResult Craft(PlayerSession& session, const GameData& data, const std::vector<RecipeDef>& recipes, const std::string& recipeId);

enum class PurchaseOutcome { UnknownProduct, NotEnoughMoney, UpgradeAlreadyOwned, ProductMissing, NoRoom, BoughtUpgrade, Bought };
struct PurchaseResult { PurchaseOutcome outcome = PurchaseOutcome::UnknownProduct; std::string label; };
PurchaseResult Purchase(PlayerSession& session, const GameData& data, const std::string& request);

enum class EffectOutcome { NotApplicable, Applied, CuredDisease, NoSuchDisease };
// Efecto de consumir un objeto (necesidades, calor, vendaje o curacion). No lo quita del inventario.
EffectOutcome ApplyItemEffect(PlayerSession& session, const ItemDef& item);

// Tira `amount` de experiencia; devuelve cuantos niveles subio (cada uno da un punto de talento)
int AwardXp(PlayerSession& session, int amount, float activityMultiplier, float talentMultiplier);

// Suelta unidades de un objeto del inventario: devuelve cuantas se soltaron (0 si no lo tiene)
int DropItem(PlayerSession& session, const GameData& data, size_t itemIndex, bool all);

// Posible enfermedad al rebuscar en la basura; devuelve su id o vacio. `resistance` ya multiplica talento, personaje y clasificado.
std::string TryInfectFromPickup(PlayerSession& session, std::mt19937& random, bool sortedBag, float resistance);

} // namespace Bazuko::Economy
