// Pruebas de los datos compartidos con el juego web (logica pura: sin ventana ni GPU).
// Devuelve 0 si todo pasa.
#include "game/GameData.hpp"

#include <cmath>
#include <cstdio>
#include <set>

using namespace Bazuko;

static int g_failures = 0;
#define CHECK(cond, ...)                                                        \
    do {                                                                        \
        if (!(cond)) {                                                          \
            ++g_failures;                                                       \
            std::printf("FALLO (%s:%d): %s -> ", __FILE__, __LINE__, #cond);    \
            std::printf(__VA_ARGS__);                                           \
            std::printf("\n");                                                  \
        }                                                                       \
    } while (0)

int main() {
    std::setvbuf(stdout, nullptr, _IONBF, 0);
    std::string error;
    const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
    CHECK(loaded.has_value(), "no cargo: %s", error.c_str());
    if (!loaded) return 1;
    const GameData& data = *loaded;

    // Las partidas guardadas referencian el indice del objeto: el orden no puede cambiar.
    CHECK(data.items.size() == 43, "se esperaban 43 objetos, hay %zu", data.items.size());
    CHECK(data.ItemIndex("hierba") == 42, "hierba va al final (indice 42): %d", data.ItemIndex("hierba"));
    const char* expectedOrder[] = {"lata", "botella", "carton", "chatarra", "cable", "pan", "agua", "reloj", "vendaje", "antibiotico"};
    for (size_t index = 0; index < 10; ++index)
        CHECK(data.items[index].id == expectedOrder[index], "indice %zu: %s", index, data.items[index].id.c_str());
    CHECK(data.ItemIndex("retrovisor") == 13 && data.ItemIndex("cafe") == 27 && data.ItemIndex("anillo") == 41,
          "indices de retrovisor/cafe/anillo: %d %d %d", data.ItemIndex("retrovisor"), data.ItemIndex("cafe"), data.ItemIndex("anillo"));

    std::set<std::string> ids;
    for (const ItemDef& item : data.items) CHECK(ids.insert(item.id).second, "id repetido: %s", item.id.c_str());

    // Recicladora: solo lo que no se come, no cura, no es sustancia ni material de construccion
    const std::set<std::string> recyclable{"lata", "botella", "carton", "chatarra", "cable", "reloj", "retrovisor", "radio",
                                           "curita", "rifa", "moneda", "anillo"};
    for (const ItemDef& item : data.items)
        CHECK(item.recyclable == recyclable.contains(item.id), "reciclable de %s: %d", item.id.c_str(), item.recyclable);

    const ItemDef* coffee = data.FindItem("cafe");
    CHECK(coffee && coffee->name == "Café caliente" && coffee->consumableNeed == 2 && coffee->amount == 40.0f && coffee->deltas[5] == 15.0f,
          "cafe mal cargado");
    const ItemDef* soda = data.FindItem("refresco");
    CHECK(soda && DescribeItemEffects(*soda) == "+50 sed · +10 energía · +10 ánimo", "descripcion del refresco: %s",
          soda ? DescribeItemEffects(*soda).c_str() : "(falta)");
    const ItemDef* syrup = data.FindItem("jarabe");
    CHECK(syrup && DescribeItemEffects(*syrup) == "Cura: gripe." && syrup->cure == "gripe", "jarabe mal cargado");
    CHECK(data.FindItem("pegante") && data.FindItem("pegante")->substance, "pegante deberia ser sustancia");

    // Tienda
    CHECK(data.shop.size() == 21, "se esperaban 21 productos, hay %zu", data.shop.size());
    bool hasCostal = false;
    for (const ShopEntry& entry : data.shop) {
        if (entry.upgrade == "costal") {
            hasCostal = true;
            CHECK(entry.price == 12000, "costal grande: %d", entry.price);
        } else {
            CHECK(data.FindItem(entry.item) != nullptr, "producto desconocido: %s", entry.item.c_str());
            CHECK(entry.price > 0 && entry.qty >= 1, "producto %s con precio/cantidad invalidos", entry.item.c_str());
        }
    }
    CHECK(hasCostal && data.costalBonus == 20.0f, "falta el costal grande o su bono");

    // Botin
    for (const auto* table : {&data.lootCommon, &data.lootRare, &data.lootSubstance}) {
        CHECK(!table->empty(), "tabla de botin vacia");
        for (const LootEntry& entry : *table) CHECK(data.FindItem(entry.item) != nullptr, "botin desconocido: %s", entry.item.c_str());
    }

    // Talentos: mismas reglas que TalentSystem.getEffect del original
    CHECK(data.talents.size() == 9, "se esperaban 9 talentos, hay %zu", data.talents.size());
    for (const TalentDef& talent : data.talents)
        for (const std::string& required : talent.prerequisites) CHECK(data.FindTalent(required) != nullptr, "%s requiere %s", talent.id.c_str(), required.c_str());
    const auto near = [](float a, float b) { return std::fabs(a - b) < 1e-5f; };
    CHECK(near(data.TalentEffect({}, "decayMult"), 1.0f), "sin talentos el multiplicador debe ser 1");
    CHECK(near(data.TalentEffect({"surv1"}, "decayMult"), 0.7f), "decayMult con surv1");
    CHECK(near(data.TalentEffect({"surv2"}, "diseaseResist"), 0.6f), "diseaseResist con surv2");
    CHECK(near(data.TalentEffect({"collector2"}, "maxWeightBonus", 0.0f), 10.0f), "maxWeightBonus suma");
    CHECK(near(data.TalentEffect({"collector3"}, "sortValueMult"), 1.5f) && near(data.TalentEffect({"collector3"}, "sortDiseaseMult"), 0.8f), "efectos de collector3");
    CHECK(near(data.TalentEffect({"crime2"}, "substancePriceMult"), 1.3f), "substancePriceMult con crime2");
    CHECK(near(data.TalentEffect({"crime3"}, "xpMult"), 1.5f), "xpMult con crime3");
    CHECK(near(data.TalentEffect({"crime1"}, "stealCaughtMult"), 0.8f), "stealCaughtMult con crime1");
    CHECK(near(data.TalentEffect({"collector1"}, "rareChanceMult"), 1.25f), "rareChanceMult con collector1");

    // Cambuche y sueño (src/data/cambuche.js)
    CHECK(data.cambuche.size() == 6 && data.cambuche[0].id == "base" && data.cambuche[0].needs.empty(), "piezas del cambuche");
    const CambuchePieceDef* stove = data.FindCambuchePiece("fogon");
    CHECK(stove && stove->needs == "base" && stove->req.size() == 2, "el fogon necesita la base, latas y madera");
    CHECK(data.sleep.energia == 45.0f && data.sleep.roboProb == 0.25f && data.sleep.vicioVela == 15.0f, "constantes de dormir");

    if (g_failures == 0) std::printf("GameData: todo OK (%zu objetos, %zu productos, %zu talentos)\n", data.items.size(), data.shop.size(), data.talents.size());
    else std::printf("GameData: %d fallos\n", g_failures);
    return g_failures == 0 ? 0 : 1;
}
