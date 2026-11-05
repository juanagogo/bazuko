#include "game/Interaction.h"

#include <algorithm>
#include <cmath>

#include "game/Money.h"

namespace bazuko {

double Interaction::originEffect(const std::string& key, double base) const {
    const Origin* o = s_.data.origin(originId);
    if (!o) return base;
    auto it = o->effects.find(key);
    return it == o->effects.end() ? base : it->second;
}

std::string Interaction::weightedPick(const std::vector<LootEntry>& table) {
    double total = 0;
    for (const auto& e : table) total += e.weight;
    double r = rng_.next() * total;
    for (const auto& e : table) {
        r -= e.weight;
        if (r <= 0) return e.item;
    }
    return table.front().item;
}

bool Interaction::toggleBoost() {
    if (boostActive_) {
        endBoost();
        return true;
    }
    if (s_.stats.energia < 15) return false;
    if (s_.stats.salud <= s_.data.c("BOOST_MIN_HEALTH")) return false;
    boostActive_ = true;
    boostTimer_ = s_.data.c("BOOST_DURATION");
    s_.stats.energia -= s_.data.c("BOOST_ENERGY_COST");
    return true;
}

void Interaction::update(double dt, Input& input, const Vec3& pos) {
    sinceBeg_ += dt;

    // ===== el objetivo más cercano dentro del alcance =====
    const double range = s_.data.c("INTERACT_RANGE");
    Target best;
    double bestDist = range;
    auto consider = [&](TargetType type, int index, const Vec3& p) {
        const double d = std::hypot(p.x - pos.x, p.z - pos.z);
        if (d < bestDist) { bestDist = d; best = {type, index}; }
    };
    for (size_t i = 0; i < e_.pickups.size(); ++i) consider(TargetType::Pickup, static_cast<int>(i), e_.pickups[i].position);
    for (size_t i = 0; i < e_.cars.size(); ++i) consider(TargetType::Car, static_cast<int>(i), e_.cars[i].position);
    consider(TargetType::Recycler, 0, e_.recycler.position);
    consider(TargetType::Dealer, 0, e_.dealer.position);
    consider(TargetType::Craft, 0, e_.craft.position);
    consider(TargetType::Cambuche, 0, e_.cambuche.position);
    consider(TargetType::Shop, 0, e_.shop.position);
    for (size_t i = 0; i < city_.vendors().size(); ++i) consider(TargetType::Vendor, static_cast<int>(i), {city_.vendors()[i].x, 0, city_.vendors()[i].z});
    current_ = best;

    // ===== boost =====
    if (boostActive_) {
        boostTimer_ -= dt;
        s_.stats.salud = std::max(0.0, s_.stats.salud - s_.data.c("BOOST_HEALTH_DRAIN") * dt);
        if (boostTimer_ <= 0 || s_.stats.salud <= s_.data.c("BOOST_MIN_HEALTH")) endBoost();
    }

    // ===== selección de basura (mantener Q) =====
    const double sortTime = s_.data.c("SORT_BASE_TIME");
    if (best.type == TargetType::Pickup && input.isDown(Key::Q)) {
        if (!holdingQ_) {
            holdingQ_ = true;
            Pickup& p = e_.pickups[best.index];
            if (!p.used && p.cooldown <= 0) {
                p.sorting = true;
                p.sortProgress = 0;
                sortingPickup_ = best.index;
            }
        }
    } else if (holdingQ_) {
        holdingQ_ = false;
        if (sortingPickup_ >= 0) {
            Pickup& p = e_.pickups[sortingPickup_];
            const bool sorted = p.sortComplete(sortTime);
            const int index = sortingPickup_;
            harvestTrash(index, sorted);
            p.sorting = false;
            p.sortProgress = 0;
            sortingPickup_ = -1;
        }
    }

    // ===== interacción principal (E) =====
    if (input.consumePress(Key::E) && best.type != TargetType::None) {
        switch (best.type) {
            case TargetType::Pickup: harvestTrash(best.index, false); break;
            case TargetType::Recycler: s_.bus.emit(EvOpenRecycler{}); break;
            case TargetType::Shop: s_.bus.emit(EvOpenShop{-1}); break;
            case TargetType::Vendor: s_.bus.emit(EvOpenShop{best.index}); break;
            case TargetType::Cambuche: s_.bus.emit(EvOpenCambuche{}); break;
            case TargetType::Craft: s_.bus.emit(EvOpenCrafting{}); break;
            case TargetType::Car: stealCar(best.index); break;
            case TargetType::Dealer: {
                bool hasSubstances = false;
                for (const ItemStack& st : s_.inventory.items()) hasSubstances |= s_.data.item(st.id)->substance;
                if (hasSubstances && s_.clock.isNight()) sellSubstances();
                else s_.bus.emit(EvDealerToggle{});  // abre la tienda del dealer para comprar
                break;
            }
            default: break;
        }
    }

    // ===== comprar / abrir la tienda del dealer (Q) =====
    if (best.type == TargetType::Dealer && input.consumePress(Key::Q)) s_.bus.emit(EvDealerToggle{});

    // ===== pedir limosna (B o L) =====
    const bool b = input.consumePress(Key::B), l = input.consumePress(Key::L);
    if (b || l) beg();

    // ===== boost (F) =====
    if (input.consumePress(Key::F) && !toggleBoost()) sound("empty");
}

std::vector<std::string> Interaction::collect(const std::vector<std::string>& ids) {
    std::vector<std::string> added, lost;
    for (const std::string& id : ids) {
        const ItemDef* item = s_.data.item(id);
        if (!item) continue;
        if (s_.inventory.add(id)) added.push_back(item->name);
        else lost.push_back(item->name);
    }
    if (!lost.empty()) {  // la versión web perdía estos objetos sin avisar
        std::string text = "🎒 Mochila llena: dejaste ";
        for (size_t i = 0; i < lost.size(); ++i) text += (i ? ", " : "") + lost[i];
        s_.bus.emit(EvToast{text, "warn"});
    }
    return added;
}

void Interaction::harvestTrash(int index, bool sorted) {
    Pickup& p = e_.pickups[index];
    if (p.used || p.cooldown > 0) return;

    const double rareMult = s_.talents.getEffect("rareChanceMult", 1);
    const double sortValueMult = s_.talents.getEffect("sortValueMult", 1);
    const int extraRolls = static_cast<int>(originEffect("extraLoot", 0));
    const bool boost = boostActive_;

    int rolls;
    double rareChance;
    if (sorted) {
        rolls = boost ? 6 : 4;
        rareChance = (boost ? 0.25 : 0.12) * rareMult;
        // FIX: "Selección Experta" decía +50 % de valor pero no hacía nada: rinde más objetos al seleccionar.
        rolls = static_cast<int>(std::lround(rolls * sortValueMult));
    } else {
        rolls = boost ? 4 : 2;
        rareChance = (boost ? 0.15 : 0.05) * rareMult;
    }
    rolls += extraRolls;

    std::vector<std::string> ids;
    for (int i = 0; i < rolls; ++i) ids.push_back(weightedPick(s_.data.lootCommon));
    std::string rare;
    if (rng_.next() < rareChance) {
        rare = weightedPick(s_.data.lootRare);
        ids.push_back(rare);
    }
    p.used = true;
    p.cooldown = s_.data.c("PICKUP_COOLDOWN");
    p.sorting = false;
    p.sortProgress = 0;

    s_.bus.emit(EvPlayerAction{"buscar", 0.8});
    const auto added = collect(ids);
    sound("pickup");
    if (!rare.empty()) {
        sound("treasure");
        s_.stats.animo = std::min(100.0, s_.stats.animo + s_.data.c("MENTAL_RESTORE_RARE"));
    }
    if (added.empty()) sound("full");

    // Riesgo de enfermedad: más al seleccionar (más contacto) y con poca higiene (FIX: nunca se aplicaba).
    double resist = s_.talents.getEffect("diseaseResistMult", 1) * originEffect("diseaseResistMult", 1) * s_.stats.getDiseaseChanceMultiplier();
    if (sorted) resist *= s_.talents.getEffect("sortDiseaseMult", 1);
    s_.diseases.tryInfect(sorted, resist, rng_);

    s_.stats.addXP(s_.data.c("XP_PICKUP"));
    s_.bus.emit(EvPickup{added, !rare.empty(), sorted});
}

void Interaction::stealCar(int index) {
    ParkedCar& c = e_.cars[index];
    if (c.used || c.cooldown > 0) return;

    std::vector<std::string> ids;
    const int mirrors = rng_.next() < 0.5 ? 2 : 1;
    for (int i = 0; i < mirrors; ++i) ids.push_back("retrovisor");
    if (rng_.next() < 0.2) ids.push_back("radio");
    const bool caught = rng_.next() < s_.data.c("STEAL_CAUGHT_CHANCE") * s_.talents.getEffect("stealCaughtMult", 1);
    c.used = true;
    c.cooldown = s_.data.c("CAR_COOLDOWN");

    const auto added = collect(ids);  // los objetos robados se conservan aunque te atrapen
    if (caught) {
        s_.stats.salud = std::max(0.0, s_.stats.salud - s_.data.c("STEAL_CAUGHT_PENALTY"));
        s_.stats.dinero = std::max(0.0, s_.stats.dinero - s_.data.c("STEAL_CAUGHT_MONEY"));
        s_.bus.emit(EvStealCaught{});
    } else {
        sound("pickup");
        s_.stats.addXP(s_.data.c("XP_STEAL"));
    }
    s_.bus.emit(EvSteal{added, caught});
}

void Interaction::sellSubstances() {
    if (!s_.clock.isNight()) {
        s_.bus.emit(EvSubstanceFail{"day"});
        sound("empty");
        return;
    }
    const double priceMult = s_.talents.getEffect("substancePriceMult", 1);
    double total = 0;
    const auto snapshot = s_.inventory.items();
    for (const ItemStack& st : snapshot) {
        const ItemDef* item = s_.data.item(st.id);
        if (!item || !item->substance || st.qty <= 0) continue;
        total += item->value * st.qty * 1.8 * 1.3 * priceMult;  // reventa x1,8 y bonificación nocturna x1,3
        s_.inventory.remove(st.id, st.qty);
    }
    const int earned = static_cast<int>(std::lround(total));
    if (earned > 0) {
        s_.stats.dinero += earned;
        s_.stats.addXP(s_.data.c("XP_SELL") * 2);
        s_.bus.emit(EvSubstanceSell{earned});
        sound("sell");
    } else {
        sound("empty");
    }
}

Interaction::BuyResult Interaction::buySubstance(const std::string& requested) {
    BuyResult r;
    std::string id = requested;
    if (id.empty()) id = weightedPick(s_.data.lootSubstance);
    const ItemDef* item = s_.data.item(id);
    if (!item) {
        r.reason = "invalid_item";
    } else if (s_.stats.dinero < item->value) {
        r.reason = "insufficient_money";
        r.cost = static_cast<int>(item->value);
    } else if (!s_.inventory.canAdd(id)) {
        r.reason = "inventory_full";
        r.cost = static_cast<int>(item->value);
    } else {
        s_.stats.dinero -= item->value;
        s_.inventory.add(id);
        r.ok = true;
        r.name = item->name;
        r.cost = static_cast<int>(item->value);
    }
    if (r.ok) {
        sound("pickup");
        s_.bus.emit(EvSubstanceBuy{r.name, r.cost});
    } else {
        sound("empty");
        s_.bus.emit(EvSubstanceBuyFail{r.reason, r.cost});
    }
    return r;
}

void Interaction::beg() {
    if (sinceBeg_ < kBegCooldown) {
        s_.bus.emit(EvBegCooldown{static_cast<int>(std::ceil(kBegCooldown - sinceBeg_))});
        return;
    }
    auto& st = s_.stats;
    if (st.energia < 3) {
        sound("empty");
        s_.bus.emit(EvBegFail{"energy"});
        return;
    }
    sinceBeg_ = 0;
    st.energia = std::max(0.0, st.energia - 3);
    s_.bus.emit(EvPlayerAction{"pedir", 1.2});

    if (st.isRejectedByNPCs() && rng_.next() < 0.70) {
        st.animo = std::max(0.0, st.animo - 2);
        sound("empty");
        s_.bus.emit(EvBegResult{false, "higiene", "", "🚫 La gente se aleja con disgusto por tu olor (Higiene muy baja)", 0, false});
        return;
    }
    if (rng_.next() < 0.20) {  // 20 % de ser ignorado
        st.animo = std::max(0.0, st.animo - 1);
        sound("empty");
        s_.bus.emit(EvBegResult{false, "ignored", "", "🚶 Los transeúntes te ignoran y siguen de largo...", 0, false});
        return;
    }
    if (rng_.next() < 0.18) {  // 18 %: comida o agua
        const char* id = rng_.next() < 0.5 ? "pan" : "agua";
        const ItemDef* food = s_.data.item(id);
        const bool added = s_.inventory.add(id);
        st.animo = std::min(100.0, st.animo + 4);
        st.addXP(s_.data.c("XP_BEG"));
        sound("pickup");
        s_.bus.emit(EvBegResult{true, "", food->name,
                                added ? "🍞 ¡Un alma caritativa te regaló " + food->name + "!"
                                      : "🍞 Te ofrecieron " + food->name + ", pero tu inventario está lleno",
                                0, false});
        return;
    }
    // Dinero: monedas ($200 a $1.500) o billete raro ($5.000 a $10.000)
    const bool rare = rng_.next() < 0.08;
    int amount;
    if (rare) amount = rng_.next() < 0.5 ? 5000 : 10000;
    else amount = static_cast<int>(std::lround((2 + rng_.next() * 13) * originEffect("begMult"))) * 100;
    st.dinero += amount;
    st.animo = std::min(100.0, st.animo + (rare ? 6 : 2));
    st.addXP(s_.data.c("XP_BEG") * (rare ? 2 : 1));
    sound(rare ? "treasure" : "sell");
    s_.bus.emit(EvBegResult{true, "", "", rare ? "💎 ¡Un transeúnte generoso te dio un billete de " + cop(amount) + "!"
                                              : "🪙 Recibiste " + cop(amount) + " de limosna",
                            amount, rare});
}

}  // namespace bazuko
