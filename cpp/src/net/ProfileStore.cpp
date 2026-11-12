#include "ProfileStore.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <random>

namespace Bazuko::Net {

namespace fs = std::filesystem;
using nlohmann::json;

std::string NewPlayerKey() {
    static const char digits[] = "0123456789abcdef";
    std::random_device device;
    std::string key;
    for (int i = 0; i < 32; ++i) key.push_back(digits[device() & 15u]);
    return key;
}

bool IsValidPlayerKey(const std::string& key) {
    if (key.size() != 32) return false;
    return std::all_of(key.begin(), key.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}

json WrapSave(const json& save, const std::string& key) {
    return json{{"formato", kProfileFormat}, {"jugador", key}, {"guardado", save}};
}

std::optional<json> UnwrapProfile(const json& profile, const std::string& key) {
    if (!profile.is_object() || profile.value("formato", 0) != kProfileFormat || profile.value("jugador", std::string{}) != key) return std::nullopt;
    const auto it = profile.find("guardado");
    if (it == profile.end() || !it->is_object()) return std::nullopt;
    return *it;
}

namespace {
constexpr float kMinX = 0.0f, kMaxX = 400.0f, kMinZ = -74.0f, kMaxZ = 322.0f;   // mismo recinto que el mapa jugable

bool FiniteNumber(const json& value) { return value.is_number() && std::isfinite(value.get<double>()); }

void ClampNumber(json& object, const char* name, double lowest, double highest, double fallback, std::vector<std::string>& fixes) {
    if (!object.contains(name)) return;
    const json& value = object[name];
    if (!FiniteNumber(value)) { object[name] = fallback; fixes.push_back(std::string(name) + " no era un numero valido"); return; }
    const double number = value.get<double>();
    const double clamped = std::clamp(number, lowest, highest);
    if (clamped != number) { object[name] = clamped; fixes.push_back(std::string(name) + " fuera de rango"); }
}
}

std::vector<std::string> Sanitize(json& save, const GameData& data) {
    std::vector<std::string> fixes;
    if (!save.is_object()) { save = json::object(); fixes.push_back("el guardado no era un objeto"); return fixes; }

    ClampNumber(save, "money", 0.0, 1.0e9, 0.0, fixes);
    ClampNumber(save, "playerX", kMinX, kMaxX, 112.98, fixes);
    ClampNumber(save, "playerZ", kMinZ, kMaxZ, 97.84, fixes);
    ClampNumber(save, "level", 1.0, 100.0, 1.0, fixes);
    ClampNumber(save, "xp", 0.0, 1.0e9, 0.0, fixes);
    ClampNumber(save, "talentPoints", 0.0, 1000.0, 0.0, fixes);
    ClampNumber(save, "dayProgress", 0.0, 1.0, 0.5, fixes);
    ClampNumber(save, "day", 1.0, 1.0e6, 1.0, fixes);

    if (save.contains("needs")) {   // necesidades entre 0 y 100
        if (!save["needs"].is_array()) { save.erase("needs"); fixes.push_back("needs no era una lista"); }
        else {
            for (auto& need : save["needs"]) {
                if (!FiniteNumber(need)) { need = 50.0; fixes.push_back("una necesidad no era numerica"); }
                else if (need.get<double>() < 0.0 || need.get<double>() > 100.0) { need = std::clamp(need.get<double>(), 0.0, 100.0); fixes.push_back("necesidad fuera de rango"); }
            }
        }
    }

    if (save.contains("inventory")) {   // solo objetos que existen, cantidades positivas y razonables
        json clean = json::array();
        if (!save["inventory"].is_array()) fixes.push_back("inventory no era una lista");
        else {
            for (const auto& entry : save["inventory"]) {
                const long long item = entry.is_object() && FiniteNumber(entry.value("item", json())) ? entry["item"].get<long long>() : -1;
                const long long quantity = entry.is_object() && FiniteNumber(entry.value("quantity", json())) ? entry["quantity"].get<long long>() : 0;
                if (item < 0 || static_cast<size_t>(item) >= data.items.size() || quantity <= 0) { fixes.push_back("pila de inventario invalida descartada"); continue; }
                clean.push_back({{"item", item}, {"quantity", std::min<long long>(quantity, 999)}});
            }
        }
        if (clean != save["inventory"]) save["inventory"] = clean;
    }

    if (save.contains("character") && save["character"].is_object()) {   // el nombre llega a los demas jugadores: sin control ni exceso
        std::string name = save["character"].value("nombre", std::string{});
        std::string cleaned;
        for (char c : name) if (static_cast<unsigned char>(c) >= 32 && c != 127 && cleaned.size() < 24) cleaned.push_back(c);
        if (cleaned != name) { save["character"]["nombre"] = cleaned; fixes.push_back("nombre con caracteres no permitidos o demasiado largo"); }
    }
    return fixes;
}

bool ProfileStore::Exists(const std::string& key) const {
    std::error_code ec;
    return IsValidPlayerKey(key) && fs::exists(PathFor(key), ec);
}

std::optional<json> ProfileStore::Load(const std::string& key) const {
    if (!IsValidPlayerKey(key)) return std::nullopt;
    std::ifstream file(PathFor(key), std::ios::binary);
    if (!file) return std::nullopt;
    json profile = json::parse(file, nullptr, /*allow_exceptions=*/false);
    if (profile.is_discarded()) return std::nullopt;
    return UnwrapProfile(profile, key);
}

bool ProfileStore::Save(const std::string& key, const json& save) const {
    if (!IsValidPlayerKey(key)) return false;
    std::error_code ec;
    fs::create_directories(m_Root, ec);
    const fs::path target = PathFor(key), temporary = m_Root / (key + ".json.tmp");
    {
        std::ofstream file(temporary, std::ios::binary | std::ios::trunc);
        if (!file) return false;
        file << WrapSave(save, key).dump(2);
        file.flush();
        if (!file) { fs::remove(temporary, ec); return false; }
    }
    fs::rename(temporary, target, ec);   // en Windows rename no sobrescribe si existe: se reintenta tras borrar
    if (ec) { fs::remove(target, ec); ec.clear(); fs::rename(temporary, target, ec); }
    if (ec) { fs::remove(temporary, ec); return false; }
    return true;
}

} // namespace Bazuko::Net
