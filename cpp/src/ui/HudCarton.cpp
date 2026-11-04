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
        const bool compact = display.x < 900.0f || display.y < 520.0f || std::getenv("BAZUKO_HUD_COMPACTO") != nullptr;   // celular acostado (844) o mas chico: filas mas bajas y lo que sube se vuelve ficha
        if (compact) dockWidth = std::min(dockWidth, display.x < 480.0f ? 168.0f : 206.0f);
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
        static const std::array<const char*, 8> labels{{"HAMBRE", "SED", "ENERGÍA", "SALUD", "HIGIENE", "ÁNIMO", "VICIO", "CALOR"}};
        static const std::array<const char*, 8> glyphs{{"comida", "agua", "rayo", "corazon", "cara", "cara", "fogata", "termometro"}};
        static const std::array<const char*, 8> orders{{"a comer", "a beber", "a dormir", "a curarme", "a lavarme", "a calmarme", "me pide", "a la candela"}};
        const auto valueOf = [&](int need) { return need == 7 ? std::clamp(m_Warmth / 1.8f, 0.0f, 100.0f) : std::clamp(needs[static_cast<size_t>(need)], 0.0f, 100.0f); };
        // Siempre a la vista: salud (un poco mas alta), hambre, sed y energia. Higiene, animo y vicio van recogidos en un boton y suben a la columna
        // cuando bajan de 30 (como en el original: docs/identidad-visual.md, «El HUD»).
        std::vector<int> rows{3, 0, 1, 2};
        const bool extrasLow = needs[4] < 30.0f || needs[5] < 30.0f || needs[6] < 30.0f;
        std::vector<int> chips;   // en pantallas chicas las recogidas que suben van como ficha: dibujo y cifra
        for (int extra : {4, 5, 6})
            if (m_NeedsExpanded || needs[static_cast<size_t>(extra)] < 30.0f) (compact ? chips : rows).push_back(extra);
        // calor: sube cuando se esta acabando el que ya tienes (o no hay y hace frio); mientras no, solo la linea «Calientito»
        if (m_Freezing || (m_Warmth > 0.0f && m_Warmth < 20.0f)) rows.push_back(7);
        const auto heightOf = [&](int need) { return compact ? (need == 3 ? 30.0f : 25.0f) : (need == 3 ? 36.0f : 29.0f); };
        float rowsHeight = 0.0f;
        for (int need : rows) rowsHeight += heightOf(need);
        const float warmthHeight = m_Warmth > 0.0f ? 24.0f : 0.0f;
        const float needsHeight = 12.0f + rowsHeight + 36.0f + (m_Warmth >= 20.0f ? warmthHeight : 0.0f);   // 36: pie con el boton de las recogidas
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
            float rowY = needsMin.y + 10.0f;
            for (int need : rows) {
                const size_t i = static_cast<size_t>(need);
                const float value = valueOf(need);
                const bool critical = need == 7 ? (m_Warmth <= 0.0f) : value < 15.0f, low = need == 7 ? m_Warmth < 20.0f : value < 30.0f;
                const float height = heightOf(need);
                const ImVec2 rowMin(needsMin.x + 6.0f, rowY - 2.0f), rowMax(needsMax.x - 8.0f, rowY + height - 3.0f);
                if (critical) draw->AddRectFilled(rowMin, rowMax, C::kRojo);   // bajo 15 la fila entera pasa a rojo con letra de cinta
                const ImU32 ink = critical ? C::kCinta : C::kMarcador;
                const float mid = rowY + height * 0.5f - 1.0f;
                C::DrawGlyph(draw, C::Glyph(glyphs[i]), ImVec2(needsMin.x + 22.0f, mid), need == 3 ? 24.0f : 20.0f, ink);
                C::Text(draw, true, need == 3 ? 17 : 15, ImVec2(needsMin.x + 40.0f, mid - (need == 3 ? 10.0f : 9.0f)), ink, labels[i]);
                const float barLeft = needsMin.x + 40.0f + (compact ? 54.0f : dockWidth > 280.0f ? 82.0f : 66.0f);
                const float barRight = needsMax.x - 62.0f;
                if (critical) {   // la masa se vuelve una raya y aparece que hacer
                    C::HandLine(draw, ImVec2(barLeft, mid + 7.0f), ImVec2(barRight, mid + 7.0f), 800u + static_cast<unsigned int>(i), 2.5f, C::kCinta);
                    C::Text(draw, false, 15, ImVec2(barLeft, mid - 10.0f), C::kCinta, orders[i]);
                } else {
                    C::Hatch(draw, ImVec2(barLeft, mid - 8.0f), ImVec2(barRight, mid + 8.0f), value / 100.0f, ink);
                }
                // cifra en columna fija; bajo 30 se invierte: cinta sobre marcador
                char number[8];
                std::snprintf(number, sizeof(number), "%d", static_cast<int>(value + 0.5f));
                const float numberWidth = C::TextWidth(true, 18, number);
                const float numberX = needsMax.x - 18.0f - 34.0f;
                if (low && !critical) {
                    draw->AddRectFilled(ImVec2(numberX, mid - 12.0f), ImVec2(numberX + 36.0f, mid + 12.0f), C::kMarcador);
                    C::Text(draw, true, 18, ImVec2(numberX + 36.0f - 5.0f - numberWidth, mid - 11.0f), C::kCinta, number);
                } else {
                    C::Text(draw, true, 18, ImVec2(numberX + 36.0f - 5.0f - numberWidth, mid - 11.0f), ink, number);
                }
                rowY += height;
            }
            {   // pie: el boton de las recogidas (su dibujo baja de nivel con la peor) y, a su lado, lo que dura el calor
                const float worstExtra = std::min({needs[4], needs[5], needs[6]});
                const char* face = worstExtra < 15.0f ? "peligro" : worstExtra < 30.0f ? "enfermo" : worstExtra < 60.0f ? "nauseas" : "cara";
                const ImVec2 buttonMin(needsMax.x - 14.0f - 54.0f, needsMax.y - 8.0f - 28.0f - warmthHeight * 0.0f), buttonMax(buttonMin.x + 54.0f, buttonMin.y + 28.0f);
                float chipX = needsMin.x + 10.0f;
                for (int need : chips) {   // ficha: dibujo y cifra
                    const float value = valueOf(need);
                    const bool critical = value < 15.0f;
                    const ImVec2 chipMin(chipX, buttonMin.y), chipMax(chipX + 48.0f, buttonMin.y + 28.0f);
                    draw->AddRectFilled(chipMin, chipMax, critical ? C::kRojo : C::kMarcador);
                    C::DrawGlyph(draw, C::Glyph(glyphs[static_cast<size_t>(need)]), ImVec2(chipMin.x + 13.0f, chipMin.y + 14.0f), 17.0f, C::kCinta);
                    char number[8];
                    std::snprintf(number, sizeof(number), "%d", static_cast<int>(value + 0.5f));
                    C::Text(draw, true, 15, ImVec2(chipMin.x + 25.0f, chipMin.y + 5.0f), C::kCinta, number);
                    chipX += 52.0f;
                }
                ImGui::SetCursorScreenPos(buttonMin);
                ImGui::PushID("extrasNecesidades");
                const bool pressed = ImGui::InvisibleButton("##extras", ImVec2(54.0f, 28.0f));
                ImGui::PopID();
                if (pressed) m_NeedsExpanded = !m_NeedsExpanded;
                draw->AddRectFilled(buttonMin + ImVec2(2, 3), buttonMax + ImVec2(2, 3), IM_COL32(20, 14, 6, 150));
                draw->AddRectFilled(buttonMin, buttonMax, extrasLow ? C::kMarcador : C::kCinta);
                C::DrawGlyph(draw, C::Glyph(face), ImVec2(buttonMin.x + 18.0f, buttonMin.y + 14.0f), 20.0f, extrasLow ? C::kCinta : C::kMarcador);
                C::Text(draw, true, 13, ImVec2(buttonMin.x + 34.0f, buttonMin.y + 5.0f), extrasLow ? C::kCinta : C::kMarcador, m_NeedsExpanded ? "−" : "+");
            }
            if (m_Warmth > 0.0f) {   // «Calientito 2:59»: cuanto dura el calor que ya tienes
                char warm[32];
                std::snprintf(warm, sizeof(warm), "Calientito %d:%02d", static_cast<int>(m_Warmth) / 60, static_cast<int>(m_Warmth) % 60);
                C::Text(draw, true, 16, ImVec2(needsMin.x + 14.0f, needsMax.y - 36.0f - 22.0f), C::kMarcador, warm);
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

    // ---- lo mas urgente: un retazo con la frase en primera persona y lo que se va a hacer (solo uno; otro tiene que ganarle por 8 puntos) ----
    {
        struct Urgent { int id; float weight; const char* phrase; const char* action; };
        const Urgent candidates[] = {
            {0, needs[3] <= 30.0f ? 100.0f - needs[3] * 2.0f : 0.0f, "ESTOY MUY MAL", "Busco dónde curarme"},
            {1, needs[1] <= 20.0f ? 95.0f - needs[1] * 2.5f : 0.0f, "TENGO SED", "Busco agua"},
            {2, needs[0] <= 20.0f ? 90.0f - needs[0] * 2.5f : 0.0f, "TENGO HAMBRE", "Busco comida"},
            {3, needs[2] <= 20.0f ? 80.0f - needs[2] * 2.5f : 0.0f, "NO DOY MÁS", "Busco dónde dormir"},
            {4, m_Freezing && m_Warmth <= 0.0f ? 70.0f : 0.0f, "TENGO FRÍO", "Busco candela o techo"},
            {5, m_InWithdrawal ? 55.0f : 0.0f, "TENGO MALILLA", "Caminar me cuesta"},
        };
        static int shownId = -1;
        static float shownWeight = 0.0f;
        const Urgent* best = nullptr;
        for (const Urgent& candidate : candidates) if (candidate.weight > 0.0f && (!best || candidate.weight > best->weight)) best = &candidate;
        const Urgent* current = nullptr;
        for (const Urgent& candidate : candidates) if (candidate.id == shownId && candidate.weight > 0.0f) current = &candidate;
        if (!current || (best && best->id != shownId && best->weight > current->weight + 8.0f)) current = best;   // histeresis: dos parecidos no se turnan
        shownId = current ? current->id : -1;
        shownWeight = current ? current->weight : 0.0f;
        (void)shownWeight;
        if (current && current->weight > 0.0f) {
            const float missionBottom = c.objective.empty() ? 14.0f : 14.0f + 80.0f;
            const float width = std::max(C::TextWidth(true, 30, current->phrase), C::TextWidth(false, 18, current->action)) + 44.0f;
            if (BeginHud("##cartonUrgente", ImVec2(display.x * 0.5f, missionBottom + 70.0f), ImVec2(width, 76.0f), ImVec2(0.5f, 0.0f), false)) {
                ImDrawList* draw = ImGui::GetWindowDrawList();
                const ImVec2 at = ImGui::GetWindowPos();
                C::Panel(draw, at, at + ImVec2(width, 76.0f), 55u, 5.0f);
                const bool grave = current->weight >= 70.0f;
                if (grave) draw->AddRectFilled(at + ImVec2(4, 4), at + ImVec2(width - 4, 72), C::kRojo);
                C::Text(draw, true, 30, at + ImVec2(22.0f, 5.0f), grave ? C::kCinta : C::kMarcador, current->phrase);
                C::Text(draw, false, 18, at + ImVec2(22.0f, 43.0f), grave ? C::kCinta : C::kMarcador, current->action);
            }
            ImGui::End();
        }
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
