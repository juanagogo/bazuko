// Economia en el anfitrion: el libro de cuentas acepta lo que las reglas del juego explican (compras, ventas, recetas, premios y botin dentro de un ritmo
// plausible) y rechaza lo demas (plata o objetos de la nada, ventas infladas, mejoras sin pagar), devolviendo su copia. Tambien prueba el espejo del
// invitado (cuando cuenta su estado y cuando adopta la correccion) y la lectura segura de los mensajes.
#include "game/GameData.hpp"
#include "net/EconomyLedger.hpp"

#include <cmath>
#include <cstdio>
#include <string>

using namespace Bazuko;
using namespace Bazuko::Net;

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

static uint16_t Index(const GameData& data, const std::string& id) {
    for (size_t i = 0; i < data.items.size(); ++i) if (data.items[i].id == id) return static_cast<uint16_t>(i);
    std::printf("objeto desconocido %s\n", id.c_str()); std::exit(2);
}
static int Qty(const EconomySnapshot& s, uint16_t index) { for (const auto& [i, q] : s.items) if (i == index) return q; return 0; }
static void Set(EconomySnapshot& s, uint16_t index, int quantity) {
    for (auto it = s.items.begin(); it != s.items.end(); ++it) if (it->first == index) { s.items.erase(it); break; }
    if (quantity > 0) s.items.push_back({index, static_cast<uint16_t>(quantity)});
}

int main() {
    std::string error;
    const auto loaded = GameData::LoadFromFile(BAZUKO_GAME_DATA_PATH, &error);
    if (!loaded) { std::printf("no se pudieron leer los datos: %s\n", error.c_str()); return 2; }
    const GameData& data = *loaded;
    const size_t count = data.items.size();
    const uint16_t pan = Index(data, "pan"), lata = Index(data, "lata"), chatarra = Index(data, "chatarra"), cable = Index(data, "cable"), pilas = Index(data, "pilas"), radio = Index(data, "radioTransistor");

    // A: arranque y compra
    {
        Ledger ledger(data);
        EconomySnapshot s; s.money = 20000.0f; Set(s, lata, 5);
        auto verdict = ledger.Submit(s, 0.0);
        CHECK(verdict.accepted && ledger.Started(), "A: el primer informe fija la copia");
        EconomySnapshot bought = s; bought.money -= 1500.0f; Set(bought, pan, 1);   // compra de un pan (1500)
        CHECK(ledger.Submit(bought, 1.0).accepted, "A: una compra al precio de la tienda se acepta");
        EconomySnapshot twice = bought; twice.money -= 3000.0f; Set(twice, pan, 3);
        CHECK(ledger.Submit(twice, 2.0).accepted, "A: dos panes mas por 3000 se aceptan");
        EconomySnapshot spendOnly = twice; spendOnly.money -= 500.0f;
        CHECK(ledger.Submit(spendOnly, 3.0).accepted, "A: gastar plata (multa, soborno) siempre se acepta");
        EconomySnapshot negative = spendOnly; negative.money = -5.0f;
        CHECK(!ledger.Submit(negative, 4.0).accepted, "A: plata negativa se rechaza");
        CHECK(std::abs(ledger.State().money - spendOnly.money) < 0.01f, "A: la copia no cambia tras un rechazo");
    }
    // B: ventas y premios
    {
        Ledger ledger(data);
        EconomySnapshot s; s.money = 1000.0f; Set(s, lata, 10); Set(s, chatarra, 4);
        ledger.Submit(s, 0.0);
        EconomySnapshot sold = s; Set(sold, lata, 0); sold.money += 10 * 250 * 1.2f;   // vende 10 latas con el 20 % del empujon
        CHECK(ledger.Submit(sold, 1.0).accepted, "B: vender lo que se tiene al precio (con margen) se acepta");
        EconomySnapshot inflated = sold; Set(inflated, chatarra, 3); inflated.money += 900 * 12.0f;   // una chatarra por 10 800: mucho mas que su valor
        auto verdict = ledger.Submit(inflated, 2.0);
        CHECK(!verdict.accepted, "B: una venta inflada se rechaza");
        CHECK(Qty(verdict.authoritative, chatarra) == 4 && std::abs(verdict.authoritative.money - sold.money) < 0.01f, "B: y se devuelve la copia del anfitrion");
        EconomySnapshot cheat = sold; cheat.money += 1.0e6f;
        CHECK(!ledger.Submit(cheat, 3.0).accepted, "B: un millon de la nada se rechaza");
        EconomySnapshot reward = sold; reward.money += 5000.0f;   // premio de mision
        CHECK(ledger.Submit(reward, 4.0).accepted, "B: un premio de 5000 se acepta");
        EconomySnapshot again = reward; again.money += 5000.0f;
        CHECK(!ledger.Submit(again, 4.5).accepted, "B: otro premio de 5000 medio segundo despues, no (tope de ritmo)");
        CHECK(ledger.Submit(again, 80.0).accepted, "B: pasado un buen rato el tope se rellena");
        EconomySnapshot ghost = again; Set(ghost, chatarra, 400);
        CHECK(!ledger.Submit(ghost, 81.0).accepted, "B: cuatrocientas chatarras de golpe se rechazan");
    }
    // C: botin y ritmo
    {
        Ledger ledger(data);
        EconomySnapshot s; s.money = 0.0f;
        ledger.Submit(s, 0.0);
        EconomySnapshot loot = s; Set(loot, lata, 12);
        CHECK(ledger.Submit(loot, 0.1).accepted, "C: una rafaga de 12 objetos del mundo se acepta");
        EconomySnapshot more = loot; Set(more, lata, 14);
        CHECK(!ledger.Submit(more, 0.2).accepted, "C: dos mas enseguida, no");
        CHECK(ledger.Submit(more, 3.0).accepted, "C: unos segundos despues, si");
        EconomySnapshot flood = more; Set(flood, lata, 200);
        CHECK(!ledger.Submit(flood, 30.0).accepted, "C: ciento ochenta y seis de golpe, no");
    }
    // D: recetas (no gastan el cupo de botin) y mejora del costal
    {
        Ledger ledger(data, LedgerLimits::Unlimited());
        EconomySnapshot s; s.money = 30000.0f; Set(s, chatarra, 40); Set(s, cable, 80); Set(s, pilas, 40);
        ledger.Submit(s, 0.0);
        EconomySnapshot cur = s; bool allAccepted = true;
        for (int i = 0; i < 30; ++i) {   // 30 radios seguidos en 3 segundos: ninguna de la nada
            Set(cur, chatarra, Qty(cur, chatarra) - 1); Set(cur, cable, Qty(cur, cable) - 2); Set(cur, pilas, Qty(cur, pilas) - 1); Set(cur, radio, Qty(cur, radio) + 1);
            allAccepted = allAccepted && ledger.Submit(cur, 0.1 * i).accepted;
        }
        CHECK(allAccepted && Qty(ledger.State(), radio) == 30, "D: fabricar con los ingredientes se acepta sin importar el ritmo");
        EconomySnapshot fake = cur; Set(fake, radio, Qty(fake, radio) + 13);   // trece radios sin ingredientes: ni la rafaga de botin los cubre
        CHECK(!ledger.Submit(fake, 4.0).accepted, "D: trece radios sin ingredientes se rechazan");
        EconomySnapshot sack = cur; sack.bigSack = true;
        CHECK(!ledger.Submit(sack, 5.0).accepted, "D: la mejora del costal sin pagar se rechaza");
        int upgradePrice = 0; for (const ShopEntry& e : data.shop) if (!e.upgrade.empty()) upgradePrice = e.price;
        sack.money -= static_cast<float>(upgradePrice);
        CHECK(ledger.Submit(sack, 6.0).accepted && ledger.State().bigSack, "D: la mejora pagada se acepta");
    }
    // D2: perfil nuevo limitado, perfil guardado manda, ida y vuelta con el guardado
    {
        Ledger fresh(data);
        EconomySnapshot rich; rich.money = 9.0e6f; Set(rich, lata, 500);
        auto verdict = fresh.Submit(rich, 0.0);
        CHECK(!verdict.accepted && verdict.authoritative.money == 50000.0f && Qty(verdict.authoritative, lata) == 60, "D2: un perfil nuevo arranca recortado a 50 000 y 60 objetos");
        CHECK(fresh.Started() && fresh.State().money == 50000.0f, "D2: y la copia queda con lo recortado");
        Ledger modest(data);
        EconomySnapshot ok; ok.money = 40000.0f; Set(ok, lata, 30);
        CHECK(modest.Submit(ok, 0.0).accepted, "D2: un perfil nuevo dentro del limite se acepta tal cual");
        Ledger saved(data);
        EconomySnapshot stored; stored.money = 777.0f; stored.bigSack = true; Set(stored, pan, 2);
        nlohmann::json save = nlohmann::json::object();
        ApplyEconomyToSave(save, stored);
        const EconomySnapshot back = EconomyFromSave(save, count);
        CHECK(back == Canonical(stored, count), "D2: el perfil guardado se lee igual que se escribio");
        saved.Adopt(back, 0.0);
        CHECK(saved.FromProfile() && saved.State() == back, "D2: adoptar un perfil fija la copia");
        nlohmann::json broken = {{"money", -5}, {"inventory", {{{"item", 9999}, {"quantity", 3}}, {{"item", 0}, {"quantity", -1}}, "basura"}}};
        const EconomySnapshot cleaned = EconomyFromSave(broken, count);
        CHECK(cleaned.money == 0.0f && cleaned.items.empty(), "D2: un guardado roto se lee como vacio");
    }
    // E: espejo del invitado
    {
        EconomyMirror mirror;
        EconomySnapshot s; s.money = 500.0f;
        auto first = mirror.Poll(s, 0.0);
        CHECK(first && first->seq == 1, "E: el primer estado se cuenta siempre");
        CHECK(!mirror.Poll(s, 1.0).has_value(), "E: sin cambios no se envia nada");
        EconomySnapshot changed = s; changed.money = 100.0f;
        auto second = mirror.Poll(changed, 1.2);
        CHECK(second && second->seq == 2, "E: un cambio se envia");
        EconomySync rejected{2, false, s, false};
        CHECK(mirror.OnSync(rejected, changed).has_value(), "E: correccion del anfitrion sin cambios nuevos: se adopta");
        EconomySnapshot movedOn = changed; movedOn.money = 50.0f;
        CHECK(!mirror.OnSync(rejected, movedOn).has_value(), "E: si el invitado ya cambio algo mas, no se pisa");
        EconomySync stale{1, false, s, false};
        CHECK(!mirror.OnSync(stale, changed).has_value(), "E: una correccion de un informe viejo no se adopta");
        EconomySync fine{2, true, changed, false};
        CHECK(!mirror.OnSync(fine, changed).has_value(), "E: lo aceptado no cambia nada");
    }
    // F: mensajes
    {
        EconomySnapshot s; s.money = 1234.5f; s.bigSack = true; Set(s, pan, 3); Set(s, lata, 7);
        s = Canonical(s, count);
        BitWriter w; Write(w, EconomyReport{9, s});
        BitReader r(w.Data());
        CHECK(ReadType(r) == MessageType::Economy, "F: tipo");
        const auto back = ReadEconomyReport(r);
        CHECK(back && back->seq == 9 && back->state == s, "F: informe ida y vuelta");
        BitWriter w2; Write(w2, EconomySync{9, false, s, true});
        BitReader r2(w2.Data()); ReadType(r2);
        const auto sync = ReadEconomySync(r2);
        CHECK(sync && !sync->accepted && sync->profile && sync->state == s, "F: correccion ida y vuelta");
        for (size_t cut = 1; cut + 1 < w.Data().size(); ++cut) {
            std::vector<uint8_t> part(w.Data().begin(), w.Data().begin() + static_cast<long>(cut));
            BitReader tr(part); ReadType(tr);
            CHECK(!ReadEconomyReport(tr).has_value(), "F: informe truncado se rechaza");
        }
        EconomySnapshot junk; junk.money = 5.0f; junk.items = {{60000, 5}, {pan, 0}, {pan, 2}, {pan, 3}};
        const auto canonical = Canonical(junk, count);
        CHECK(canonical.items.size() == 1 && canonical.items[0].second == 5, "F: lo canonico quita indices invalidos y ceros y suma repetidos");
    }
    if (failures == 0) std::printf("Libro de cuentas: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
