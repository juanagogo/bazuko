#pragma once
// Misiones diarias (original: src/systems/DailyMissionSystem.js): tres tareas renovables cada dia de juego. Cada dia se eligen tres de las nueve
// plantillas de forma determinista (depende solo del numero de dia) y avanzan con lo que hace el jugador: reciclar, vender, comer en el comedor,
// atender a El Chato, cambiarse de ropa, calentarse en una fogata, pedir limosna, fabricar y pasar la noche. Sin dependencias de dibujo ni de la
// simulacion: main informa los avances con Report() y aplica la recompensa de lo que devuelve.
#include <algorithm>
#include <array>
#include <string>
#include <vector>
#include <nlohmann/json.hpp>

namespace Bazuko::Missions {

struct Reward { int money = 0, xp = 0, mood = 0; };

struct Template {
    const char* type;
    const char* title;
    const char* description;
    int target;
    Reward reward;
};

inline const std::array<Template, 9>& Templates() {
    static const std::array<Template, 9> templates{{
        {"reciclar", "Jornada de reciclaje", "Recoge 4 bolsas o canecas de basura por la ciudad.", 4, {3000, 30, 10}},
        {"vender", "El rebusque en El Progreso", "Vende material reciclable y gana al menos $2.000.", 2000, {2000, 25, 15}},
        {"comedor", "Almuerzo solidario", "Visita el Comedor Comunitario y recibe la ración diaria.", 1, {1500, 30, 20}},
        {"perro", "Compañero fiel", "Atiende a El Chato (dale comida o acarícialo).", 1, {1000, 25, 20}},
        {"ropa", "Cambio de pinta", "Cámbiate de ropa para protegerte del clima frío.", 1, {1500, 20, 15}},
        {"fogata", "Al calor de la candela", "Caliéntate las manos en una fogata de El Cartucho.", 1, {1200, 20, 15}},
        {"limosna", "La moneda de la suerte", "Pide limosna exitosamente 2 veces.", 2, {2000, 25, 15}},
        {"crafteo", "Artesano de la calle", "Fabrica un objeto útil en la mesa de trabajo.", 1, {2500, 35, 10}},
        {"noche", "Pasar la noche", "Sobrevive la noche o descansa en el cambuche.", 1, {2500, 30, 20}}}};
    return templates;
}

struct Mission {
    std::string id, type, title, description;
    int target = 1, progress = 0;
    bool completed = false;
    Reward reward;
};

class DailyMissions {
public:
    // Tres misiones del dia: misma eleccion que el original ((dia * 7 + 13) % 9, saltando de a tres sin repetir tipo)
    static std::vector<Mission> Generate(int day) {
        const auto& templates = Templates();
        const int total = static_cast<int>(templates.size());
        std::vector<Mission> selected;
        const int seed = ((day * 7 + 13) % total + total) % total;
        for (int step = 0; step < total * 2 && selected.size() < 3; ++step) {
            // los tres primeros saltos (seed, seed+3, seed+6) son los del original; si uno se descarta, se sigue con seed+1, seed+4...
            const Template& t = templates[static_cast<size_t>((seed + step * 3 + step / 3) % total)];
            if (std::any_of(selected.begin(), selected.end(), [&](const Mission& m) { return m.type == t.type; })) continue;
            Mission mission;
            mission.id = std::string(t.type) + "_d" + std::to_string(day);
            mission.type = t.type;
            mission.title = t.title;
            mission.description = t.description;
            mission.target = t.target;
            mission.reward = t.reward;
            selected.push_back(std::move(mission));
        }
        return selected;
    }

    void Init(int day) {
        m_Day = day;
        if (m_Missions.empty()) m_Missions = Generate(day);
    }

    // Un dia nuevo reemplaza las misiones; devuelve true cuando cambiaron (para avisar al jugador)
    bool Update(int day) {
        if (day == m_Day) return false;
        m_Day = day;
        m_Missions = Generate(day);
        return true;
    }

    // Suma `amount` a las misiones de ese tipo; devuelve las que se acaban de cumplir (la recompensa la entrega quien llama)
    std::vector<Mission> Report(const std::string& type, int amount = 1) {
        std::vector<Mission> completed;
        for (Mission& mission : m_Missions) {
            if (mission.type != type || mission.completed) continue;
            mission.progress = std::min(mission.target, mission.progress + amount);
            if (mission.progress >= mission.target) {
                mission.completed = true;
                completed.push_back(mission);
            }
        }
        return completed;
    }

    const std::vector<Mission>& Missions() const { return m_Missions; }
    int Day() const { return m_Day; }

    // Texto corto para la barra de mision del HUD: la primera pendiente, o que ya se cumplieron todas
    std::string ActiveText() const {
        if (m_Missions.empty()) return {};
        for (const Mission& mission : m_Missions) {
            if (mission.completed) continue;
            std::string progress = mission.target > 1 ? " (" + std::to_string(mission.progress) + "/" + std::to_string(mission.target) + ")" : "";
            return "MISIÓN: " + Upper(mission.title) + progress + " · $" + std::to_string(mission.reward.money);
        }
        return "MISIONES DEL DÍA COMPLETADAS";
    }

    nlohmann::json Serialize() const {
        nlohmann::json out;
        out["currentDay"] = m_Day;
        out["missions"] = nlohmann::json::array();
        for (const Mission& mission : m_Missions) {
            out["missions"].push_back({{"id", mission.id}, {"type", mission.type}, {"title", mission.title}, {"desc", mission.description},
                                       {"target", mission.target}, {"progress", mission.progress}, {"completed", mission.completed},
                                       {"reward", {{"dinero", mission.reward.money}, {"xp", mission.reward.xp}, {"animo", mission.reward.mood}}}});
        }
        return out;
    }

    void Deserialize(const nlohmann::json& data) {
        if (!data.is_object()) return;
        m_Day = data.value("currentDay", m_Day);
        m_Missions.clear();
        if (data.contains("missions") && data["missions"].is_array()) {
            for (const auto& entry : data["missions"]) {
                Mission mission;
                mission.id = entry.value("id", "");
                mission.type = entry.value("type", "");
                mission.title = entry.value("title", "");
                mission.description = entry.value("desc", "");
                mission.target = std::max(1, entry.value("target", 1));
                mission.progress = entry.value("progress", 0);
                mission.completed = entry.value("completed", false);
                if (entry.contains("reward")) {
                    mission.reward.money = entry["reward"].value("dinero", 0);
                    mission.reward.xp = entry["reward"].value("xp", 0);
                    mission.reward.mood = entry["reward"].value("animo", 0);
                }
                m_Missions.push_back(std::move(mission));
            }
        }
        if (m_Missions.empty()) m_Missions = Generate(m_Day);
    }

private:
    static std::string Upper(std::string text) {   // solo ASCII: las tildes y la ñ se dejan como estan (el cartón ya las trae)
        for (char& c : text) if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
        return text;
    }

    int m_Day = 1;
    std::vector<Mission> m_Missions;
};

} // namespace Bazuko::Missions
