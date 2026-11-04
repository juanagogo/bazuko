#define IMGUI_DEFINE_MATH_OPERATORS
#include "UIManager.hpp"
#include "Carton.hpp"
#include "SignStyle.hpp"
#include "../core/Input.hpp"
#include "../audio/AudioManager.hpp"
#include "../renderer/Camera.hpp"
#include "../world/Simulation.hpp"
#include <GLFW/glfw3.h>
#include <algorithm>
#include <array>
#include <cstdio>
#include <sstream>
#include <string>
#include <vector>

namespace Bazuko {

namespace {

constexpr ImGuiWindowFlags kHudFlags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                       ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse;

bool BeginHud(const char* name, ImVec2 pos, ImVec2 size, ImVec2 pivot = ImVec2(0, 0), bool inputs = true) {
    ImGui::SetNextWindowPos(pos, ImGuiCond_Always, pivot);
    ImGui::SetNextWindowSize(size, ImGuiCond_Always);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    const bool open = ImGui::Begin(name, nullptr, kHudFlags | (inputs ? 0 : ImGuiWindowFlags_NoInputs));
    ImGui::PopStyleVar(2);
    return open;
}

std::string Thousands(int value) {
    std::string digits = std::to_string(std::max(0, value)), out;
    for (size_t i = 0; i < digits.size(); ++i) {
        if (i > 0 && (digits.size() - i) % 3 == 0) out += '.';
        out += digits[i];
    }
    return out;
}

} // namespace

// HUD de carton y marcador (docs/identidad-visual.md del original): botones arriba a la izquierda, la mision como retazo arriba al centro, dinero y hora
// arriba a la derecha, las necesidades en masa rayada abajo a la izquierda con el radar, y Ayuda, Vista, Costal y Fabricar abajo a la derecha.
void UIManager::RenderHudCarton(const HudContext& c) {
    namespace C = Carton;
    const ImVec2 display = ImGui::GetIO().DisplaySize;
    const int totalMinutes = static_cast<int>(c.dayProgress * 1440.0f) % 1440;
    const std::array<float, 7>& needs = *c.needs;

    // ---- arriba a la izquierda: radio, pausa y sonido ----
    if (BeginHud("##cartonBotones", ImVec2(14.0f, 14.0f), ImVec2(200.0f, 56.0f))) {
        ImDrawList* draw = ImGui::GetWindowDrawList();
        const ImVec2 at = ImGui::GetWindowPos();
        C::Panel(draw, at, at + ImVec2(200.0f, 56.0f), 3u, 6.0f);
        const struct { const char* name; unsigned int glyph; } buttons[3] = {
            {"radio", C::Glyph("radio")}, {"pausa", C::Glyph("pausa")}, {"sonido", c.audio->IsMuted() ? C::Glyph("silencio") : C::Glyph("sonido")}};
        for (int i = 0; i < 3; ++i) {
            const ImVec2 min = at + ImVec2(8.0f + static_cast<float>(i) * 64.0f, 6.0f);
            ImGui::SetCursorScreenPos(min);
            ImGui::PushID(buttons[i].name);
            const bool pressed = ImGui::InvisibleButton("##b", ImVec2(58.0f, 44.0f));
            ImGui::PopID();
            const bool hovered = ImGui::IsItemHovered();
            if (hovered) draw->AddRectFilled(min, min + ImVec2(58.0f, 44.0f), IM_COL32(255, 245, 215, 70));
            C::DrawGlyph(draw, buttons[i].glyph, min + ImVec2(29.0f, 22.0f), 28.0f, C::kMarcador);
            if (i < 2) C::HandLine(draw, min + ImVec2(61.0f, 6.0f), min + ImVec2(61.0f, 38.0f), 500u + static_cast<unsigned int>(i), 2.0f);
            if (pressed) {
                if (i == 0) OpenRadioMenu(false);
                else if (i == 1) TogglePause();
                else c.audio->SetMuted(!c.audio->IsMuted());
            }
        }
    }
    ImGui::End();

    // ---- arriba al centro: lo que toca hacer ----
    if (!c.objective.empty()) {
        char progress[64] = {};
        if (c.simulation->IsMissionComplete()) std::snprintf(progress, sizeof(progress), "Misión completada");
        else if (c.simulation->IsMissionStarted()) std::snprintf(progress, sizeof(progress), "Reciclables: %llu de %llu", static_cast<unsigned long long>(c.missionProgress), static_cast<unsigned long long>(c.missionTarget));
        const float width = std::clamp(C::TextWidth(true, 24, c.objective.c_str()) + 52.0f, 280.0f, display.x * 0.42f);
        const float textHeight = C::TextHeight(true, 24, SignUI::Upper(c.objective).c_str(), width - 40.0f);
        const float height = textHeight + 26.0f + (progress[0] ? 26.0f : 0.0f);
        if (BeginHud("##cartonMision", ImVec2(display.x * 0.5f, 14.0f), ImVec2(width, height), ImVec2(0.5f, 0.0f), false)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            C::Panel(draw, at, at + ImVec2(width, height), 7u, 6.0f);
            const std::string upper = SignUI::Upper(c.objective);
            C::Text(draw, true, 24, at + ImVec2(20.0f, 10.0f), C::kMarcador, upper.c_str(), width - 40.0f);
            if (progress[0]) C::Text(draw, false, 16, at + ImVec2(20.0f, 14.0f + textHeight), C::kMarcador, progress);
        }
        ImGui::End();
    }

    // ---- arriba a la derecha: plata, hora y quien eres ----
    {
        char money[32], clock[48], who[96];
        std::snprintf(money, sizeof(money), "$ %s", Thousands(static_cast<int>(c.money)).c_str());
        std::snprintf(clock, sizeof(clock), "%02d:%02d  DÍA %d", totalMinutes / 60, totalMinutes % 60, m_Day);
        const std::string name = c.playerName.empty() ? "Parcero" : c.playerName;
        std::snprintf(who, sizeof(who), "%s, nivel %d", name.c_str(), c.level);
        const float width = std::max({C::TextWidth(true, 44, money) + 36.0f, C::TextWidth(true, 18, clock) + C::TextWidth(true, 18, m_WeatherLabel.c_str()) + 60.0f, 250.0f});
        if (BeginHud("##cartonPlata", ImVec2(display.x - 14.0f, 14.0f), ImVec2(width, 126.0f), ImVec2(1.0f, 0.0f), false)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            C::Panel(draw, at, at + ImVec2(width, 126.0f), 9u, 7.0f);
            C::Text(draw, true, 44, at + ImVec2(width - 18.0f - C::TextWidth(true, 44, money), 6.0f), C::kMarcador, money);
            C::Text(draw, true, 18, at + ImVec2(18.0f, 66.0f), C::kMarcador, clock);
            if (!m_WeatherLabel.empty()) {
                const std::string weather = SignUI::Upper(m_WeatherLabel);
                C::Text(draw, true, 18, at + ImVec2(width - 18.0f - C::TextWidth(true, 18, weather.c_str()), 66.0f), C::kMarcador, weather.c_str());
            }
            C::Text(draw, false, 16, at + ImVec2(18.0f, 92.0f), C::kMarcador, who);
            const float xp = std::clamp(static_cast<float>(c.xp) / static_cast<float>(std::max(1, c.level * 100)), 0.0f, 1.0f);
            C::Hatch(draw, at + ImVec2(width - 118.0f, 94.0f), at + ImVec2(width - 18.0f, 110.0f), xp);
        }
        ImGui::End();
    }

    // ---- abajo a la izquierda: avisos, necesidades y radar ----
    {
        float dockWidth;
        if (m_RadarSize == 0) dockWidth = 232.0f;
        else if (m_RadarSize == 2) dockWidth = std::clamp(display.x * 0.24f, 300.0f, 420.0f);
        else dockWidth = std::clamp(display.x * 0.18f, 260.0f, 330.0f);
        std::vector<std::pair<std::string, bool>> warnings;   // texto, peligro (rojo)
        if (needs[3] <= 10.0f) warnings.push_back({"Salud crítica: usa vendajes o evita los vehículos.", true});
        else if (needs[3] <= 25.0f) warnings.push_back({"Salud baja: usa vendajes y evita los vehículos.", false});
        if (c.boostActive) { char b[64]; std::snprintf(b, sizeof(b), "Adrenalina: %.1f s (+35 %% de velocidad)", std::max(0.0f, c.boostTimer)); warnings.push_back({b, false}); }
        const float withdrawal = needs[6] < 20.0f ? (20.0f - needs[6]) * 5.0f : 0.0f;
        if (withdrawal >= 80.0f) warnings.push_back({"¡Abstinencia crítica: psicosis!", true});
        else if (withdrawal >= 50.0f) warnings.push_back({"Abstinencia: paranoia", false});
        std::vector<std::string> diseases;
        if (c.diseaseSummary != "Sin enfermedades" && !c.diseaseSummary.empty()) {
            std::istringstream stream(c.diseaseSummary);
            std::string part;
            while (std::getline(stream, part, '|')) {
                const size_t first = part.find_first_not_of(" \t"), last = part.find_last_not_of(" \t");
                if (first != std::string::npos) diseases.push_back(part.substr(first, last - first + 1));
            }
        }
        static const std::array<const char*, 7> labels{{"HAMBRE", "SED", "ENERGÍA", "SALUD", "HIGIENE", "ÁNIMO", "VICIO"}};
        static const std::array<const char*, 7> glyphs{{"comida", "agua", "rayo", "corazon", "cara", "cara", "fogata"}};
        const int order[7] = {3, 0, 1, 2, 4, 5, 6};   // salud primero, como en el original
        const float rowHeight = 28.0f;
        const float warmthHeight = m_Warmth > 0.0f ? 24.0f : 0.0f;
        const float needsHeight = 12.0f + 7.0f * rowHeight + 6.0f + warmthHeight;
        const float radarHeight = m_RadarVisible ? std::round(dockWidth * 3.0f / 4.0f) : 0.0f;
        const float infoHeight = m_RadarVisible ? 46.0f : 0.0f;
        float stackHeight = needsHeight + 10.0f + static_cast<float>(warnings.size() + diseases.size()) * 42.0f;
        stackHeight += m_RadarVisible ? radarHeight + 6.0f + infoHeight : 0.0f;
        const ImVec2 dockPos(14.0f, display.y - 14.0f - stackHeight);
        if (BeginHud("##cartonDock", dockPos, ImVec2(dockWidth, stackHeight))) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            float y = dockPos.y;
            const auto placa = [&](const std::string& text, bool danger, unsigned int seed) {
                const ImVec2 min(dockPos.x, y), max(dockPos.x + dockWidth, y + 36.0f);
                C::Panel(draw, min, max, seed, 5.0f);
                if (danger) draw->AddRectFilled(min + ImVec2(4, 4), max - ImVec2(4, 4), C::kRojo);
                C::Text(draw, true, 15, min + ImVec2(12.0f, 8.0f), danger ? C::kCinta : C::kMarcador, text.c_str(), dockWidth - 24.0f);
                y += 42.0f;
            };
            for (const std::string& disease : diseases) placa(disease, true, 21u);
            for (const auto& [text, danger] : warnings) placa(text, danger, 31u);
            const ImVec2 needsMin(dockPos.x, y), needsMax(dockPos.x + dockWidth, y + needsHeight);
            C::Panel(draw, needsMin, needsMax, 13u, 7.0f);
            for (int row = 0; row < 7; ++row) {
                const size_t i = static_cast<size_t>(order[row]);
                const float value = std::clamp(needs[i], 0.0f, 100.0f);
                const bool critical = value < 15.0f;
                const float rowY = needsMin.y + 10.0f + static_cast<float>(row) * rowHeight;
                C::DrawGlyph(draw, C::Glyph(glyphs[i]), ImVec2(needsMin.x + 22.0f, rowY + 11.0f), 20.0f, critical ? C::kRojo : C::kMarcador);
                C::Text(draw, true, 15, ImVec2(needsMin.x + 40.0f, rowY + 1.0f), critical ? C::kRojo : C::kMarcador, labels[i]);
                const float barLeft = needsMin.x + 40.0f + (dockWidth > 280.0f ? 82.0f : 66.0f);
                C::Hatch(draw, ImVec2(barLeft, rowY + 3.0f), ImVec2(needsMax.x - 58.0f, rowY + 19.0f), value / 100.0f, critical ? C::kRojo : C::kMarcador);
                char number[8];
                std::snprintf(number, sizeof(number), "%d", static_cast<int>(value + 0.5f));
                C::Text(draw, true, 18, ImVec2(needsMax.x - 14.0f - C::TextWidth(true, 18, number), rowY), critical ? C::kRojo : C::kMarcador, number);
            }
            if (m_Warmth > 0.0f) {   // «Calientito 2:59»: cuanto dura el calor que ya tienes
                char warm[32];
                std::snprintf(warm, sizeof(warm), "Calientito %d:%02d", static_cast<int>(m_Warmth) / 60, static_cast<int>(m_Warmth) % 60);
                C::Text(draw, true, 16, ImVec2(needsMin.x + 14.0f, needsMax.y - 28.0f), C::kMarcador, warm);
            }
            y += needsHeight + 10.0f;
            if (m_RadarVisible) RenderMinimap(c, ImVec2(dockPos.x, y), ImVec2(dockWidth, radarHeight), infoHeight);
        }
        ImGui::End();
        if (!m_RadarVisible && BeginHud("##cartonRadarBoton", ImVec2(14.0f, dockPos.y - 44.0f), ImVec2(130.0f, 38.0f))) {
            ImGui::SetCursorScreenPos(ImGui::GetWindowPos());
            if (C::Tape("mostrarRadar", "Radar", ImVec2(130.0f, 38.0f), false, true, "N", 16)) m_RadarVisible = true;
        }
        if (!m_RadarVisible) ImGui::End();
    }

    // ---- abajo a la derecha: Ayuda, Vista, Costal y Fabricar ----
    {
        static bool helpOpen = false;
        const bool third = c.camera->GetMode() == CameraMode::ThirdPerson;
        if (BeginHud("##cartonAcciones", ImVec2(display.x - 14.0f, display.y - 14.0f), ImVec2(560.0f, 52.0f), ImVec2(1.0f, 1.0f))) {
            const ImVec2 at = ImGui::GetWindowPos();
            float x = at.x;
            const auto button = [&](const char* id, const char* label, const char* key, float w) {
                ImGui::SetCursorScreenPos(ImVec2(x, at.y + 4.0f));
                const bool pressed = C::Tape(id, label, ImVec2(w, 44.0f), false, true, key, 17);
                x += w + 10.0f;
                return pressed;
            };
            if (button("tAyuda", "Ayuda", nullptr, 100.0f)) helpOpen = !helpOpen;
            if (button("tVista", third ? "Vista" : "Tercera", "V", third ? 112.0f : 140.0f)) c.camera->ToggleMode();
            if (button("tCostal", "Costal", "I", 130.0f)) OpenPauseSection(1);
            if (button("tFabricar", "Fabricar", "C", 150.0f)) ToggleCraftMenu();
        }
        ImGui::End();
        if (helpOpen) {
            static const std::array<std::pair<const char*, const char*>, 20> items{{{"WASD", "Mover"}, {"Espacio", "Saltar"}, {"Clic o G", "Puñetazo"}, {"Shift", "Correr"}, {"E", "Interactuar"},
                {"I", "Costal"}, {"V", "Cámara"}, {"Q", "Seleccionar"}, {"B", "Limosna"}, {"F", "Boost"}, {"T", "Talentos"}, {"C", "Fabricar"},
                {"P", "Personaje"}, {"M", "Mapa y GPS"}, {"F3", "Rendimiento"}, {"N", "Radar"}, {"R", "Radio"}, {"X", "Lanzar popó"}, {"Z", "Defecar"}, {"Esc", "Pausa"}}};
            const float width = std::min(900.0f, display.x - 560.0f);
            if (BeginHud("##cartonAyuda", ImVec2(display.x * 0.5f, display.y - 82.0f), ImVec2(width, 120.0f), ImVec2(0.5f, 1.0f), false)) {
                ImDrawList* draw = ImGui::GetWindowDrawList();
                const ImVec2 at = ImGui::GetWindowPos();
                C::Panel(draw, at, at + ImVec2(width, 120.0f), 17u, 6.0f);
                float x = at.x + 16.0f, y = at.y + 12.0f;
                for (const auto& [key, text] : items) {
                    const float keyWidth = std::max(22.0f, C::TextWidth(true, 14, key) + 12.0f);
                    const float itemWidth = keyWidth + 8.0f + C::TextWidth(false, 15, text) + 18.0f;
                    if (x + itemWidth > at.x + width - 16.0f) { x = at.x + 16.0f; y += 28.0f; }
                    C::Key(draw, ImVec2(x, y), key, 14);
                    C::Text(draw, false, 15, ImVec2(x + keyWidth + 8.0f, y + 1.0f), C::kMarcador, text);
                    x += itemWidth;
                }
            }
            ImGui::End();
        }
    }

    // ---- popo ----
    {
        int poop = 0;
        for (const InventoryOption& item : *c.inventory) if (item.id == "popo") poop += item.quantity;
        char text[64];
        if (poop > 0) std::snprintf(text, sizeof(text), "X lanzar popó (%d), Z cagar", poop);
        else std::snprintf(text, sizeof(text), "X hacer popó");
        const float width = C::TextWidth(false, 16, text) + 28.0f;
        if (BeginHud("##cartonPopo", ImVec2(display.x - 14.0f, display.y - 76.0f), ImVec2(width, 34.0f), ImVec2(1.0f, 1.0f), false)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            C::Panel(draw, at, at + ImVec2(width, 34.0f), 19u, 4.0f);
            C::Text(draw, false, 16, at + ImVec2(14.0f, 6.0f), C::kMarcador, text);
        }
        ImGui::End();
    }
}

} // namespace Bazuko
