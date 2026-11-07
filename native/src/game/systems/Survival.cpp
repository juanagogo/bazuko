#include "game/systems/Survival.h"

#include <algorithm>
#include <cmath>
#include <vector>

namespace bazuko {

SleepResult sleep(GameState& s, Rng& rng) {
    SleepResult r;
    if (!s.hasBuilt("base")) {
        r.failReason = "nobase";
        s.bus.emit(EvSleepFail{"nobase"});
        return r;
    }
    s.bus.emit(EvSleepStart{});

    const auto& sl = s.data.sleep;
    const bool night = s.clock.isNight();
    const double hour = s.clock.hour;
    r.hours = night ? (hour >= 6 ? 24 - hour + 6 : 6 - hour) : 3;
    const double factor = std::min(1.0, r.hours / 8.0);  // una siesta rinde menos
    s.clock.advance(r.hours);

    auto& st = s.stats;
    st.energia = std::min(100.0, st.energia + (sl.energia + (s.hasBuilt("cama") ? sl.energiaCama : 0)) * factor);
    st.salud = std::min(100.0, st.salud + (sl.salud + (s.hasBuilt("techo") ? sl.saludTecho : 0)) * factor);
    st.animo = std::min(100.0, st.animo + (s.data.c("MENTAL_RESTORE_SLEEP") + (s.hasBuilt("fogon") ? sl.animoFogon : 0)) * factor);
    st.vicio = s.hasBuilt("vela") ? std::min(100.0, st.vicio + sl.vicioVela)
                                  : std::max(0.0, st.vicio - s.data.withdrawal.at("vicioDormir") * factor);
    if (!s.hasBuilt("fogon")) st.hambre = std::max(0.0, st.hambre - sl.hambreFogon * factor);

    // Sin paredes te pueden robar si duermes de noche.
    if (night && !s.hasBuilt("paredes") && rng.next() < sl.roboProb) {
        r.moneyLost = static_cast<int>(std::floor(st.dinero * sl.roboDinero));
        st.dinero -= r.moneyLost;
        const auto snapshot = s.inventory.items();
        for (const auto& stack : snapshot) {
            if (s.data.item(stack.id)->recyclable())
                s.inventory.remove(stack.id, static_cast<int>(std::ceil(stack.qty * sl.roboMaterial)));
        }
        r.robbed = true;
        s.bus.emit(EvToast{"Te robaron mientras dormías. Unas paredes ayudarían.", "death"});
    }
    r.ok = true;
    return r;
}

bool isDead(const GameState& s) { return s.stats.salud <= 0; }

void respawn(GameState& s) {
    const auto snapshot = s.inventory.items();
    const std::size_t half = snapshot.size() / 2;
    for (std::size_t i = 0; i < half; ++i) s.inventory.remove(snapshot[i].id, snapshot[i].qty);

    for (const char* name : {"hambre", "sed", "energia", "salud", "higiene", "animo", "vicio"}) {
        double* v = s.stats.need(name);
        *v = std::max(60.0, *v);
    }
    s.diseases.cureAll();
}

bool useItem(GameState& s, const std::string& itemId) {
    if (s.inventory.count(itemId) == 0) return false;
    const ItemDef* item = s.data.item(itemId);
    if (!item) return false;

    if (item->consumable) {
        auto apply = [&](const char* need, double delta) {
            if (delta == 0) return;
            double* v = s.stats.need(need);
            *v = std::clamp(*v + delta, 0.0, 100.0);
        };
        // Efecto principal (consumable + amount) y extras por necesidad.
        apply(item->consumable->c_str(), item->amount);
        if (*item->consumable != "animo") apply("animo", item->animo);
        if (*item->consumable != "energia") apply("energia", item->energia);
        if (*item->consumable != "salud") apply("salud", item->salud);
    } else if (item->cure) {
        s.diseases.cure(*item->cure);
    } else {
        return false;
    }
    s.inventory.remove(itemId, 1);
    return true;
}

}  // namespace bazuko
