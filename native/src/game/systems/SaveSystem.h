#pragma once

#include <array>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

#include "game/GameState.h"

namespace bazuko {

constexpr int kSaveVersion = 3;

// Foto serializable de la partida. Se puede leer de un guardado nativo (v3) o de uno del
// juego web (v1 sin versión, v2).
struct SaveData {
    struct Stats {
        double hambre = 100, sed = 100, energia = 100, salud = 100, higiene = 100, animo = 100, vicio = 80;
        double dinero = 0, xp = 0;
        int level = 1;
    } stats;
    int day = 1;
    double hour = 6;
    std::vector<std::pair<std::string, int>> inventory;
    int talentPoints = 0;
    std::set<std::string> talents;
    std::map<std::string, double> diseases;
    std::optional<std::array<double, 3>> playerPos;
    int worldLayoutVersion = 0;
    std::string lookJson;  // apariencia tal cual (JSON); vacío si aún no se creó el personaje
    std::map<std::string, bool> built;
    bool costal = false;
};

struct LoadResult {
    std::optional<SaveData> data;
    std::string error;       // vacío si no hay archivo o se leyó bien
    bool corrupt = false;    // el archivo existía pero era ilegible (se movió a *.corrupt)
};

SaveData capture(const GameState& s);
void apply(GameState& s, const SaveData& d);

std::string serialize(const SaveData& d);
// Lanza std::runtime_error si el texto no es un guardado válido.
SaveData parse(const std::string& text);

// $XDG_DATA_HOME/bazuko/save.json o ~/.local/share/bazuko/save.json
std::string defaultSavePath();

class SaveSystem {
public:
    explicit SaveSystem(std::string path = defaultSavePath()) : path_(std::move(path)) {}
    const std::string& path() const { return path_; }

    // Escritura atómica (archivo temporal + rename). false y `error` si falla.
    bool save(const SaveData& d, std::string* error = nullptr) const;
    LoadResult load() const;
    void clear() const;

private:
    std::string path_;
};

// Pide guardar cada `interval` segundos de juego (el juego web no tenía autoguardado).
class AutoSaver {
public:
    explicit AutoSaver(double interval = 60.0) : interval_(interval) {}
    // true cuando toca guardar.
    bool update(double dt) {
        acc_ += dt;
        if (acc_ < interval_) return false;
        acc_ = 0;
        return true;
    }
    void reset() { acc_ = 0; }

private:
    double interval_, acc_ = 0;
};

}  // namespace bazuko
