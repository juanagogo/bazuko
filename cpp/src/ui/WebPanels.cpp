// Paneles del juego web (menu de pausa por pestanas, radio, inventario, crafteo...) dibujados con ImGui.
// Las medidas salen de src/ui/menus.css, styles.css, inventory.css y crafting.css del juego original.
#define IMGUI_DEFINE_MATH_OPERATORS
#include "UIManager.hpp"
#include <imgui.h>
#include <imgui_internal.h>
#include <GLFW/glfw3.h>
#include "../core/Input.hpp"
#include "SignStyle.hpp"
#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstdio>
#include <sstream>
#include <glm/gtc/constants.hpp>

namespace Bazuko {

namespace {

using SignUI::Icon;
using SignUI::Ov;
namespace W = SignUI::Web;

constexpr ImU32 kAzulTexto = IM_COL32(214, 228, 255, 255);
constexpr ImU32 kAmarillo = IM_COL32(246, 196, 0, 255);

struct NeedStyle { const char* label; Icon icon; ImU32 color; };
const std::array<NeedStyle, 7> kNeeds{{
    {"Hambre", Icon::Bread, IM_COL32(233, 168, 59, 255)}, {"Sed", Icon::Drop, IM_COL32(61, 142, 240, 255)},
    {"Energía", Icon::Energy, IM_COL32(166, 120, 255, 255)}, {"Salud", Icon::Heart, IM_COL32(236, 75, 79, 255)},
    {"Higiene", Icon::Soap, IM_COL32(47, 195, 173, 255)}, {"Ánimo", Icon::Heart, IM_COL32(239, 119, 182, 255)},
    {"Vicio", Icon::Flame, IM_COL32(184, 151, 122, 255)}}};

// Texto con la fuente Overpass en el cursor actual (una linea)
void Label(bool black, int px, ImU32 color, const char* text) {
    ImFont* font = Ov(black, px);
    ImGui::PushFont(font);
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(color));
    ImGui::TextUnformatted(text);
    ImGui::PopStyleColor();
    ImGui::PopFont();
}

} // namespace

void UIManager::RenderPauseTabs(const PauseContext& c) {
    struct Tab { int section; const char* label; Icon icon; };
    static const std::array<Tab, 4> tabs{{{8, "Mapa", Icon::Compass}, {0, "Estado", Icon::Chart}, {9, "Ajustes", Icon::Gear}, {10, "Controles", Icon::Keyboard}}};
    const int current = m_PauseSection == 3 ? 0 : m_PauseSection;
    size_t active = 1;
    for (size_t i = 0; i < tabs.size(); ++i) if (tabs[i].section == current) active = i;
    if (Input::IsKeyPressed(GLFW_KEY_E)) { active = (active + 1) % tabs.size(); SelectPauseTab(tabs[active].section); }
    else if (Input::IsKeyPressed(GLFW_KEY_Q)) { active = (active + tabs.size() - 1) % tabs.size(); SelectPauseTab(tabs[active].section); }
    const int section = tabs[active].section;

    SignUI::DrawBackdrop(0.55f);
    bool closeRequested = false;
    if (SignUI::BeginMenu("##pausa", "Partida en pausa", "Vagabundo / Habitante de Calle · Bogotá", Icon::Pause, &closeRequested, 1100.0f, 780.0f)) {
        ImDrawList* draw = ImGui::GetWindowDrawList();
        const ImVec2 origin = ImGui::GetCursorScreenPos();
        const float width = ImGui::GetContentRegionAvail().x;
        // --- barra de pestanas (.pause-tabs) ---
        const float barHeight = 58.0f;
        draw->AddRectFilled(origin, origin + ImVec2(width, barHeight), W::kCarcasa, 8.0f);
        draw->AddRect(origin, origin + ImVec2(width, barHeight), W::kInk, 8.0f, 0, 2.0f);
        const float innerLeft = origin.x + 8.0f, innerRight = origin.x + width - 8.0f;
        W::TabKey(draw, ImVec2(innerLeft + 13.0f, origin.y + barHeight * 0.5f), "Q");
        W::TabKey(draw, ImVec2(innerRight - 13.0f, origin.y + barHeight * 0.5f), "E");
        const float tabsLeft = innerLeft + 26.0f + 6.0f, tabsRight = innerRight - 26.0f - 6.0f;
        const float tabWidth = (tabsRight - tabsLeft - 6.0f * 3.0f) / 4.0f;
        ImFont* tabFont = Ov(true, 15);
        for (size_t i = 0; i < tabs.size(); ++i) {
            const ImVec2 min(tabsLeft + static_cast<float>(i) * (tabWidth + 6.0f), origin.y + 8.0f);
            const ImVec2 max(min.x + tabWidth, min.y + 42.0f);
            ImGui::SetCursorScreenPos(min);
            ImGui::PushID(static_cast<int>(i));
            const bool pressed = ImGui::InvisibleButton("##pestana", ImVec2(tabWidth, 42.0f));
            ImGui::PopID();
            const bool hovered = ImGui::IsItemHovered();
            const bool selected = i == active;
            if (selected) {
                draw->AddRectFilled(min + ImVec2(0, 2), max + ImVec2(0, 2), IM_COL32(217, 169, 0, 255), 6.0f);
                draw->AddRectFilled(min, max, kAmarillo, 6.0f);
                draw->AddRect(min, max, W::kInk, 6.0f, 0, 2.0f);
            } else if (hovered) {
                draw->AddRectFilled(min, max, IM_COL32(255, 255, 255, 20), 6.0f);
            }
            const std::string upper = SignUI::Upper(tabs[i].label);
            const float textWidth = SignUI::SpacedTextWidth(tabFont, tabFont->FontSize, upper.c_str(), 1.2f);
            float x = (min.x + max.x) * 0.5f - (textWidth + 25.0f) * 0.5f;
            SignUI::DrawIcon(draw, tabs[i].icon, ImVec2(x + 8.5f, (min.y + max.y) * 0.5f), 17.0f);
            x += 25.0f;
            const ImU32 color = selected ? W::kInk : (hovered ? IM_COL32(255, 255, 255, 255) : kAzulTexto);
            SignUI::AddSpacedText(draw, tabFont, tabFont->FontSize, ImVec2(x, (min.y + max.y) * 0.5f - 7.5f), color, upper.c_str(), 1.2f);
            if (pressed && !selected) SelectPauseTab(tabs[i].section);
        }

        // --- cuerpo de la pestana ---
        ImGui::SetCursorScreenPos(origin + ImVec2(0.0f, barHeight + 14.0f));
        const float panelHeight = ImGui::GetContentRegionAvail().y;
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 12.0f));
        ImGui::BeginChild("##panelPausa", ImVec2(width, panelHeight), ImGuiChildFlags_None, section == 8 ? ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse : ImGuiWindowFlags_None);
        ImGui::PopStyleVar(2);
        const float panelWidth = ImGui::GetContentRegionAvail().x - (section == 8 ? 0.0f : 0.0f);
        if (section == 8) {
            m_CameraPosition = c.camera->GetPosition();
            RenderMapView(c.playerPos, *c.city, *c.simulation, ImGui::GetCursorScreenPos(), ImVec2(panelWidth, panelHeight));
        } else if (section == 0) {
            RenderStateTab(c, panelWidth);
        } else if (section == 9) {
            RenderSettingsTab(c, panelWidth);
        } else {
            RenderControlsTab(panelWidth);
        }
        ImGui::EndChild();

        SignUI::BeginFooter();
        if (W::Button("continuar", "Continuar jugando", Icon::None, true, false, 40.0f, 14, 0.0f)) TogglePause();
        ImGui::SameLine(0.0f, 12.0f);
        if (W::Button("salir", "Guardar y salir del juego", Icon::None, false, false, 40.0f, 14)) m_QuitRequest = true;
    }
    SignUI::EndMenu();
    if (closeRequested) TogglePause();
}

void UIManager::RenderStateTab(const PauseContext& c, float width) {
    const auto text = [](bool black, int px, ImU32 color, const std::string& value) { Label(black, px, color, value.c_str()); };
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const int totalMinutes = static_cast<int>(c.dayProgress * 1440.0f) % 1440;
    char time[48];
    std::snprintf(time, sizeof(time), "Día %d · %02d:%02d", m_Day, totalMinutes / 60, totalMinutes % 60);
    struct Card { const char* label; std::string value; };
    std::vector<Card> cards{{"Personaje", c.playerName.empty() ? "Parcero" : c.playerName}, {"Dinero", "$ " + std::to_string(static_cast<int>(c.money))},
                            {"Tiempo", time}};
    if (!m_WeatherLabel.empty()) { cards.push_back({"Clima", m_WeatherLabel}); cards.push_back({"Temporada", m_SeasonLabel}); }
    cards.push_back({"El Chato", c.companionIsFriend ? "Te acompaña" : "Sin adoptar"});

    // tarjetas: rejilla auto-fit de columnas de al menos 170 px y 10 px de separacion
    const int columns = std::max(1, static_cast<int>((width + 10.0f) / 180.0f));
    const float cardWidth = (width - 10.0f * static_cast<float>(columns - 1)) / static_cast<float>(columns);
    for (size_t i = 0; i < cards.size(); i += static_cast<size_t>(columns)) {
        float rowHeight = 62.0f;
        for (size_t k = 0; k < static_cast<size_t>(columns) && i + k < cards.size(); ++k) {
            if (k > 0) ImGui::SameLine(0.0f, 10.0f);
            const Card& card = cards[i + k];
            const bool tall = W::TextWidth(Ov(true, 18), card.value.c_str()) > cardWidth - 28.0f;
            const float height = tall ? 84.0f : 62.0f;
            rowHeight = std::max(rowHeight, height);
            ImGui::PushID(static_cast<int>(i + k));
            if (W::BeginPanel("##tarjeta", cardWidth, 62.0f + (tall ? 22.0f : 0.0f), ImVec2(14.0f, 10.0f))) {
                const std::string upper = SignUI::Upper(card.label);
                W::Text(ImGui::GetWindowDrawList(), Ov(true, 11), ImGui::GetCursorScreenPos(), kAzulTexto, upper.c_str(), 1.1f);
                ImGui::Dummy(ImVec2(1.0f, 15.0f));
                ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + cardWidth - 28.0f);
                ImGui::PushFont(Ov(true, 18));
                ImGui::TextWrapped("%s", card.value.c_str());
                ImGui::PopFont();
                ImGui::PopTextWrapPos();
            }
            W::EndPanel();
            ImGui::PopID();
        }
    }

    // apariencia de El Chato (solo si ya es companero)
    if (c.companionIsFriend) {
        if (W::BeginPanel("##chato", width, 0.0f)) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 8.0f));
            W::SectionTitle("El Chato", Icon::Paw);
            const float labelWidth = 124.0f;
            const auto rowLabel = [&](const char* label) {
                const ImVec2 at = ImGui::GetCursorScreenPos();
                W::Text(ImGui::GetWindowDrawList(), Ov(false, 14), at + ImVec2(0.0f, 10.0f), kAzulTexto, label);
                ImGui::SetCursorScreenPos(at + ImVec2(labelWidth, 0.0f));
            };
            struct Coat { const char* label; int id; ImU32 color; };
            static const std::array<Coat, 5> coats{{{"Canela", 0, IM_COL32(168, 101, 46, 255)}, {"Chocolate", 1, IM_COL32(92, 58, 34, 255)}, {"Negro", 3, IM_COL32(46, 41, 37, 255)},
                                                   {"Crema", 4, IM_COL32(237, 214, 158, 255)}, {"Gris", 2, IM_COL32(125, 120, 114, 255)}}};
            const float controlsWidth = width - 28.0f - labelWidth;
            {   // pelaje
                const ImVec2 rowTop = ImGui::GetCursorScreenPos();
                rowLabel("Pelaje");
                const float each = (controlsWidth - 6.0f * 4.0f) / 5.0f;
                for (size_t i = 0; i < coats.size(); ++i) {
                    if (i > 0) ImGui::SameLine(0.0f, 6.0f);
                    const ImVec2 at = ImGui::GetCursorScreenPos();
                    if (W::Button(coats[i].label, coats[i].label, Icon::None, m_CompanionCoat == coats[i].id, false, 38.0f, 13, 0.0f, each)) m_CompanionCoat = coats[i].id;
                    ImDrawList* d = ImGui::GetWindowDrawList();
                    const float textWidth = W::TextWidth(Ov(true, 13), SignUI::Upper(coats[i].label).c_str(), 1.04f);
                    const ImVec2 dot(at.x + each * 0.5f - textWidth * 0.5f - 12.0f, at.y + 19.0f);
                    d->AddCircleFilled(dot, 6.0f, coats[i].color, 14);
                    d->AddCircle(dot, 6.0f, IM_COL32(255, 255, 255, 150), 14, 1.0f);
                }
                ImGui::SetCursorScreenPos(ImVec2(rowTop.x, rowTop.y + 38.0f));
                ImGui::Dummy(ImVec2(1.0f, 8.0f));
            }
            {   // accesorio
                const ImVec2 rowTop = ImGui::GetCursorScreenPos();
                rowLabel("Accesorio");
                struct Accessory { const char* label; int id; };
                static const std::array<Accessory, 4> items{{{"Pañuelo rojo", 1}, {"Collar azul", 3}, {"Gorra", 2}, {"Ninguno", 0}}};
                const float each = (controlsWidth - 6.0f * 3.0f) / 4.0f;
                for (size_t i = 0; i < items.size(); ++i) {
                    if (i > 0) ImGui::SameLine(0.0f, 6.0f);
                    if (W::Button(items[i].label, items[i].label, Icon::None, m_CompanionAccessory == items[i].id, false, 38.0f, 13, 0.0f, each)) m_CompanionAccessory = items[i].id;
                }
                ImGui::SetCursorScreenPos(ImVec2(rowTop.x, rowTop.y + 38.0f));
                ImGui::Dummy(ImVec2(1.0f, 8.0f));
            }
            {   // tamano
                const ImVec2 rowTop = ImGui::GetCursorScreenPos();
                rowLabel("Tamaño");
                float percent = m_CompanionSize * 100.0f;
                if (W::Slider("tamanoChato", &percent, 80.0f, 125.0f, 5.0f, controlsWidth - 64.0f)) m_CompanionSize = percent / 100.0f;
                char value[16];
                std::snprintf(value, sizeof(value), "%d%%", static_cast<int>(percent + 0.5f));
                const float valueWidth = W::TextWidth(Ov(true, 14), value);
                W::Text(ImGui::GetWindowDrawList(), Ov(true, 14), ImVec2(rowTop.x + width - 28.0f - valueWidth, rowTop.y + 2.0f), kAmarillo, value);
                ImGui::SetCursorScreenPos(ImVec2(rowTop.x, rowTop.y + 24.0f));
                ImGui::Dummy(ImVec2(1.0f, 2.0f));
            }
            ImGui::PopStyleVar();
        }
        W::EndPanel();
    }

    // nivel y experiencia
    {
        const int xpNeeded = std::max(1, c.level * 100);
        if (W::BeginPanel("##nivel", width, 46.0f, ImVec2(14.0f, 10.0f))) {
            ImDrawList* d = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetCursorScreenPos();
            char badge[16];
            std::snprintf(badge, sizeof(badge), "Nv %d", c.level);
            const float badgeWidth = W::TextWidth(Ov(true, 14), badge) + 20.0f;
            d->AddRectFilled(at + ImVec2(0, 3), at + ImVec2(badgeWidth, 26), kAmarillo, 5.0f);
            W::Text(d, Ov(true, 14), at + ImVec2(10.0f, 5.5f), W::kInk, badge);
            char xp[32];
            std::snprintf(xp, sizeof(xp), "%d / %d XP", c.xp, xpNeeded);
            const float xpWidth = W::TextWidth(Ov(true, 13), xp);
            W::Text(d, Ov(true, 13), ImVec2(at.x + width - 28.0f - xpWidth, at.y + 6.0f), kAzulTexto, xp);
            ImGui::SetCursorScreenPos(at + ImVec2(badgeWidth + 12.0f, 7.0f));
            W::Meter(static_cast<float>(c.xp) / static_cast<float>(xpNeeded), IM_COL32(25, 196, 99, 255), width - 28.0f - badgeWidth - xpWidth - 24.0f);
        }
        W::EndPanel();
    }

    // necesidades
    {
        const ImVec2 titleAt = ImGui::GetCursorScreenPos();
        W::Text(draw, Ov(true, 13), titleAt, kAmarillo, "NECESIDADES", 1.3f);
        ImGui::Dummy(ImVec2(1.0f, 14.0f));
        const int needColumns = std::max(1, static_cast<int>((width - 28.0f + 24.0f) / 324.0f));
        const int rows = (static_cast<int>(kNeeds.size()) + needColumns - 1) / needColumns;
        if (W::BeginPanel("##necesidades", width, 20.0f + static_cast<float>(rows) * 30.0f + static_cast<float>(rows - 1) * 10.0f + 4.0f, ImVec2(14.0f, 10.0f))) {
            ImDrawList* d = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetCursorScreenPos();
            const float columnWidth = (width - 28.0f - 24.0f * static_cast<float>(needColumns - 1)) / static_cast<float>(needColumns);
            for (size_t i = 0; i < kNeeds.size(); ++i) {
                const int col = static_cast<int>(i) % needColumns, row = static_cast<int>(i) / needColumns;
                const ImVec2 cell(at.x + static_cast<float>(col) * (columnWidth + 24.0f), at.y + static_cast<float>(row) * 40.0f);
                const int value = static_cast<int>(std::clamp((*c.needs)[i], 0.0f, 100.0f) + 0.5f);
                SignUI::DrawIcon(d, kNeeds[i].icon, cell + ImVec2(8.0f, 14.0f), 15.0f);
                W::Text(d, Ov(true, 14), cell + ImVec2(22.0f, 5.0f), IM_COL32(255, 255, 255, 255), kNeeds[i].label);
                ImGui::SetCursorScreenPos(cell + ImVec2(110.0f + 10.0f, 8.0f));
                W::Meter(static_cast<float>(value) / 100.0f, kNeeds[i].color, columnWidth - 110.0f - 10.0f - 46.0f - 10.0f);
                char number[8];
                std::snprintf(number, sizeof(number), "%d%%", value);
                const float numberWidth = W::TextWidth(Ov(true, 14), number);
                const ImU32 numberColor = value < 15 ? IM_COL32(255, 68, 51, 255) : value < 30 ? IM_COL32(255, 176, 0, 255) : IM_COL32(255, 255, 255, 255);
                W::Text(d, Ov(true, 14), ImVec2(cell.x + columnWidth - numberWidth, cell.y + 5.0f), numberColor, number);
            }
        }
        W::EndPanel();
    }

    // destino del GPS y guardar
    {
        if (W::BeginPanel("##gpsResumen", width, 56.0f, ImVec2(14.0f, 7.0f))) {
            ImDrawList* d = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetCursorScreenPos();
            std::string summary;
            if (m_GpsView.active) {
                char distance[48];
                if (m_GpsView.distance >= 1000.0f) std::snprintf(distance, sizeof(distance), "%.1f km", m_GpsView.distance / 1000.0f);
                else std::snprintf(distance, sizeof(distance), "%.0f m", m_GpsView.distance);
                summary = "Destino: " + m_GpsView.name + " · " + distance;
            } else {
                summary = "Sin destino marcado · abre el mapa con M";
            }
            SignUI::DrawIcon(d, Icon::Pin, at + ImVec2(8.0f, 20.0f), 16.0f);
            W::Text(d, Ov(true, 14), at + ImVec2(24.0f, 11.0f), IM_COL32(255, 255, 255, 255), summary.c_str());
            const float buttonWidth = W::ButtonWidth("Guardar partida", Icon::Save, 14);
            ImGui::SetCursorScreenPos(ImVec2(at.x + width - 28.0f - buttonWidth, at.y + 1.0f));
            if (W::Button("guardar", "Guardar partida", Icon::Save, false, false, 38.0f, 14)) {
                m_SaveRequest = true;
                Notify("¡Partida guardada con éxito!", ToastType::Info);
            }
        }
        W::EndPanel();
    }
    (void)text;
}

void UIManager::RenderSettingsTab(const PauseContext& c, float width) {
    const float columnWidth = (width - 12.0f) * 0.5f;
    const float labelWidth = 124.0f;   // 112 px de etiqueta + 12 de separacion
    const auto rowLabel = [&](const char* label) {
        const ImVec2 at = ImGui::GetCursorScreenPos();
        W::Text(ImGui::GetWindowDrawList(), Ov(false, 14), at + ImVec2(0.0f, 4.0f), kAzulTexto, label);
        ImGui::SetCursorScreenPos(at + ImVec2(labelWidth, 0.0f));
    };
    const auto rowEnd = [&](const ImVec2& top, float height) {
        ImGui::SetCursorScreenPos(ImVec2(top.x, top.y + height));
        ImGui::Dummy(ImVec2(1.0f, 0.0f));
    };
    const auto percentLabel = [&](const ImVec2& top, float rightEdge, const std::string& value) {
        const float w = W::TextWidth(Ov(true, 14), value.c_str());
        W::Text(ImGui::GetWindowDrawList(), Ov(true, 14), ImVec2(rightEdge - w, top.y + 3.0f), kAmarillo, value.c_str());
    };
    const float inner = columnWidth - 28.0f;
    const float sliderWidth = inner - labelWidth - 56.0f;

    // fila 1: sonido y calidad grafica
    const float topHeight = 262.0f;
    if (W::BeginPanel("##sonido", columnWidth, topHeight)) {
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 4.0f));
        W::SectionTitle("Sonido", Icon::Sound);
        ImGui::Dummy(ImVec2(1.0f, 2.0f));
        {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            rowLabel("Volumen");
            float volume = c.audio->GetVolume() * 100.0f;
            if (W::Slider("volumenMaestro", &volume, 0.0f, 100.0f, 1.0f, sliderWidth)) c.audio->SetVolume(volume / 100.0f);
            char value[16];
            std::snprintf(value, sizeof(value), "%d%%", static_cast<int>(volume + 0.5f));
            percentLabel(top, top.x + inner, value);
            rowEnd(top, 30.0f);
        }
        static const std::array<std::pair<MixCategory, const char*>, 4> mixes{{{MixCategory::Ambient, "Ambiente"}, {MixCategory::Traffic, "Tráfico"},
                                                                               {MixCategory::Voices, "Voces"}, {MixCategory::Effects, "Efectos"}}};
        for (const auto& [category, label] : mixes) {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            rowLabel(label);
            float level = c.audio->GetMix(category) * 100.0f;
            ImGui::PushID(label);
            if (W::Slider("mezcla", &level, 0.0f, 100.0f, 1.0f, sliderWidth)) c.audio->SetMix(category, level / 100.0f);
            ImGui::PopID();
            char value[16];
            std::snprintf(value, sizeof(value), "%d%%", static_cast<int>(level + 0.5f));
            percentLabel(top, top.x + inner, value);
            rowEnd(top, 30.0f);
        }
        {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            rowLabel("Silencio");
            if (W::Button("silencio", c.audio->IsMuted() ? "Activar sonido" : "Silenciar", c.audio->IsMuted() ? Icon::Mute : Icon::Sound, false, false, 38.0f, 14))
                c.audio->SetMuted(!c.audio->IsMuted());
            rowEnd(top, 40.0f);
        }
        ImGui::PopStyleVar();
    }
    W::EndPanel();
    ImGui::SameLine(0.0f, 12.0f);
    if (W::BeginPanel("##calidad", columnWidth, topHeight)) {
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
        W::SectionTitle("Calidad gráfica", Icon::Bolt);
        const float each = (inner - 12.0f) / 3.0f;
        const char* names[3] = {"Baja", "Media", "Alta"};
        const Icon icons[3] = {Icon::Bolt, Icon::Gauge, Icon::Star};
        for (int q = 0; q < 3; ++q) {
            if (q > 0) ImGui::SameLine(0.0f, 6.0f);
            if (W::Button(names[q], names[q], icons[q], m_GraphicsQuality == q, false, 38.0f, 13, 0.0f, each)) m_GraphicsQualityRequest = q;
        }
        ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + inner);
        ImGui::PushFont(Ov(true, 12));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.84f, 0.89f, 1.0f, 0.85f));
        ImGui::TextWrapped("Baja da más FPS. Bajo carga la calidad puede bajar sola sin cambiar tu elección.");
        ImGui::PopStyleColor();
        ImGui::PopFont();
        ImGui::PopTextWrapPos();
        {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            rowLabel("Rendimiento");
            if (W::Button("rendimiento", m_PerfVisible ? "Visible (F3)" : "Oculto (F3)", Icon::None, m_PerfVisible, false, 38.0f, 13)) m_PerfVisible = !m_PerfVisible;
            rowEnd(top, 40.0f);
        }
        ImGui::PopStyleVar();
    }
    W::EndPanel();

    // fila 2: radar y GPS, personaje y radio
    const float bottomHeight = 244.0f;
    if (W::BeginPanel("##radar", columnWidth, bottomHeight)) {
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
        W::SectionTitle("Radar y GPS", Icon::Compass);
        {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            rowLabel("Radar");
            if (W::Button("radar", m_RadarVisible ? "Visible (N)" : "Oculto (N)", Icon::None, m_RadarVisible, false, 38.0f, 13)) m_RadarVisible = !m_RadarVisible;
            rowEnd(top, 38.0f);
        }
        {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            rowLabel("Tamaño");
            const float each = (inner - labelWidth - 12.0f) / 3.0f;
            const char* sizes[3] = {"Pequeño", "Mediano", "Grande"};
            for (int s = 0; s < 3; ++s) {
                if (s > 0) ImGui::SameLine(0.0f, 6.0f);
                if (W::Button(sizes[s], sizes[s], Icon::None, m_RadarSize == s, false, 38.0f, 13, 0.0f, each)) m_RadarSize = s;
            }
            rowEnd(top, 38.0f);
        }
        {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            rowLabel("Alcance base");
            float range = m_RadarRange;
            if (W::Slider("alcanceRadar", &range, 30.0f, 150.0f, 5.0f, sliderWidth)) m_RadarRange = range;
            char value[16];
            std::snprintf(value, sizeof(value), "%d m", static_cast<int>(range + 0.5f));
            percentLabel(top, top.x + inner, value);
            rowEnd(top, 30.0f);
        }
        {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            rowLabel("Haz del destino");
            if (W::Button("haz", m_GpsBeaconVisible ? "Visible" : "Oculto", Icon::None, m_GpsBeaconVisible, false, 38.0f, 13)) m_GpsBeaconVisible = !m_GpsBeaconVisible;
            rowEnd(top, 38.0f);
        }
        ImGui::PopStyleVar();
    }
    W::EndPanel();
    ImGui::SameLine(0.0f, 12.0f);
    if (W::BeginPanel("##personaje", columnWidth, bottomHeight)) {
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
        W::SectionTitle("Personaje y radio", Icon::Person);
        if (W::Button("personaje", "Editar personaje (P)", Icon::Person, false, false, 38.0f, 13)) m_CharacterCreatorRequest = true;
        ImGui::SameLine(0.0f, 8.0f);
        if (W::Button("radioAjustes", m_RadioView.on ? "Sintonizar radio (R)" : "Radio transistor (R)", Icon::Radio, false, false, 38.0f, 13)) OpenRadioMenu(true);
        ImGui::PopStyleVar();
    }
    W::EndPanel();
}

void UIManager::RenderControlsTab(float width) {
    struct Group { const char* title; std::vector<std::pair<const char*, const char*>> items; };
    static const std::array<Group, 4> groups{{
        {"Movimiento", {{"WASD", "Caminar"}, {"Shift", "Correr"}, {"Espacio", "Saltar"}, {"Ratón", "Clic fija la cámara · rueda acerca"}, {"V", "Vista tercera persona / isométrica"}}},
        {"Acciones", {{"E", "Interactuar: basura, tiendas, cambuche, carros"}, {"Q", "Mantener para clasificar basura · dealer"}, {"B / L", "Pedir limosna"},
                      {"F", "Boost de adrenalina"}, {"G / Clic", "Golpear"}, {"X", "Lanzar / recoger"}, {"Z", "Defecar"}}},
        {"Paneles", {{"I / Tab", "Inventario · 1-5 acceso rápido"}, {"T", "Talentos"}, {"C", "Fabricar"}, {"P", "Editar personaje"}, {"R", "Radio transistor"},
                     {"F3", "Panel de rendimiento"}, {"Esc", "Pausa · cerrar panel"}}},
        {"Mapa y GPS", {{"M", "Abrir / cerrar el mapa"}, {"N", "Mostrar / ocultar radar"}, {"+ / −", "Zoom del radar"}, {"Clic", "Marcar destino en el mapa"},
                        {"Clic der. / Supr", "Quitar destino"}, {"Q / E", "Cambiar de pestaña en la pausa"}}},
    }};
    const float columnWidth = (width - 24.0f) / 3.0f;
    const std::array<std::vector<size_t>, 3> layout{{{0, 1}, {2}, {3}}};
    const ImVec2 start = ImGui::GetCursorScreenPos();
    ImDrawList* draw = ImGui::GetWindowDrawList();
    for (size_t column = 0; column < 3; ++column) {
        float y = start.y;
        for (size_t index : layout[column]) {
            const Group& group = groups[index];
            const float x = start.x + static_cast<float>(column) * (columnWidth + 12.0f);
            // alto: titulo + filas (la descripcion larga ocupa dos lineas)
            float height = 24.0f + 22.0f;
            std::vector<int> lines;
            for (const auto& [key, text] : group.items) {
                const float keyWidth = W::TextWidth(Ov(true, 12), key) + 16.0f;
                const ImVec2 size = Ov(true, 14)->CalcTextSizeA(Ov(true, 14)->FontSize, columnWidth - 28.0f - keyWidth - 12.0f, columnWidth - 28.0f - keyWidth - 12.0f, text);
                const int count = size.y > 24.0f ? 2 : 1;
                lines.push_back(count);
                height += (count == 2 ? 36.0f : 22.0f) + 7.0f;
            }
            height -= 7.0f - 6.0f;
            draw->AddRectFilled(ImVec2(x, y), ImVec2(x + columnWidth, y + height), IM_COL32(6, 8, 13, 115), 8.0f);
            draw->AddRect(ImVec2(x, y), ImVec2(x + columnWidth, y + height), IM_COL32(255, 255, 255, 46), 8.0f, 0, 2.0f);
            W::Text(draw, Ov(true, 13), ImVec2(x + 14.0f, y + 13.0f), kAmarillo, SignUI::Upper(group.title).c_str(), 1.3f);
            float rowY = y + 42.0f;
            // la tecla mas ancha define la primera columna de la rejilla
            float keyColumn = 0.0f;
            for (const auto& item : group.items) keyColumn = std::max(keyColumn, W::TextWidth(Ov(true, 12), item.first) + 16.0f);
            size_t i = 0;
            for (const auto& [key, text] : group.items) {
                const float keyWidth = W::TextWidth(Ov(true, 12), key) + 16.0f;
                draw->AddRectFilled(ImVec2(x + 14.0f, rowY + 1.0f), ImVec2(x + 14.0f + keyWidth, rowY + 23.0f), IM_COL32(154, 163, 181, 255), 5.0f);
                draw->AddRectFilled(ImVec2(x + 14.0f, rowY + 1.0f), ImVec2(x + 14.0f + keyWidth, rowY + 20.0f), IM_COL32(255, 255, 255, 255), 5.0f);
                W::Text(draw, Ov(true, 12), ImVec2(x + 22.0f, rowY + 4.5f), W::kInk, key);
                const float textX = x + 14.0f + keyColumn + 12.0f;
                ImFont* font = Ov(false, 14);
                draw->AddText(font, font->FontSize, ImVec2(textX, rowY + 2.0f), IM_COL32(255, 255, 255, 255), text, nullptr, x + columnWidth - 14.0f - textX);
                rowY += (lines[i] == 2 ? 36.0f : 22.0f) + 7.0f;
                ++i;
            }
            y += height + 12.0f;
        }
    }
    ImGui::Dummy(ImVec2(width, 520.0f));
}

void UIManager::RenderRadioMenu() {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    const RadioView& radio = m_RadioView;
    const auto frequencyOf = [](const RadioStation& station) { return static_cast<float>(std::atof(station.frequency.c_str())); };
    // la aguja y el ajuste manual siguen a la emisora elegida cuando se cambia desde otro sitio (preajuste, partida guardada)
    if (!m_RadioStations.empty()) {
        const float stationFrequency = frequencyOf(m_RadioStations[m_SelectedRadioStation]);
        if (stationFrequency != m_RadioDialStation) { m_RadioDialStation = stationFrequency; m_RadioFrequency = stationFrequency; }
    }
    const float frequency = m_RadioFrequency;
    SignUI::DrawBackdrop(0.55f);
    bool closeRequested = false;
    if (SignUI::BeginMenu("##radio", "Radio Transistor a Pilas", "Sintonizador AM / FM Lo-Fi Bogotano", Icon::Radio, &closeRequested, 560.0f, 680.0f)) {
        const float width = ImGui::GetContentRegionAvail().x - 8.0f;   // deja sitio a la barra de desplazamiento
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 14.0f));
        ImDrawList* draw = ImGui::GetWindowDrawList();

        // 1. encendido y bateria
        const int battery = static_cast<int>(radio.battery + 0.5f);
        if (W::BeginPanel("##estadoRadio", width, 96.0f, ImVec2(14.0f, 12.0f))) {
            const ImVec2 top = ImGui::GetCursorScreenPos();
            const char* powerLabel = radio.on ? "Apagar radio" : "Encender radio";
            if (W::Button("encender", powerLabel, Icon::None, false, false, 40.0f, 14)) m_RadioPowerRequest = true;
            const ImVec2 dot = top + ImVec2(W::ButtonWidth(powerLabel, Icon::None, 14) + 16.0f, 0.0f);
            const ImU32 ledColor = radio.on ? IM_COL32(46, 204, 113, 255) : IM_COL32(136, 136, 136, 255);
            W::Text(draw, Ov(true, 11), dot + ImVec2(0.0f, 13.0f), ledColor, radio.on ? "• TRANSMISIÓN ACTIVA" : "• APAGADA");
            ImGui::SetCursorScreenPos(top + ImVec2(0.0f, 52.0f));
            const ImVec2 row = ImGui::GetCursorScreenPos();
            char label[32];
            std::snprintf(label, sizeof(label), "Batería: %d%%", battery);
            W::Text(draw, Ov(true, 11), row + ImVec2(0.0f, 10.0f), IM_COL32(238, 214, 136, 255), label);
            const float labelWidth = W::TextWidth(Ov(true, 11), label);
            const ImVec2 barMin = row + ImVec2(labelWidth + 10.0f, 10.0f);
            draw->AddRectFilled(barMin, barMin + ImVec2(90.0f, 12.0f), IM_COL32(17, 17, 17, 255), 3.0f);
            draw->AddRectFilled(barMin, barMin + ImVec2(90.0f * radio.battery / 100.0f, 12.0f),
                                battery > 30 ? IM_COL32(39, 174, 96, 255) : battery > 10 ? IM_COL32(243, 156, 18, 255) : IM_COL32(231, 76, 60, 255), 3.0f);
            draw->AddRect(barMin, barMin + ImVec2(90.0f, 12.0f), IM_COL32(85, 85, 85, 255), 3.0f);
            ImGui::SetCursorScreenPos(row + ImVec2(labelWidth + 112.0f, 0.0f));
            if (W::Button("pilas", "Poner pilas AA (+50%)", Icon::Bolt, false, !radio.hasBatteries || radio.battery >= 100.0f, 34.0f, 12)) m_RadioBatteryRequest = true;
        }
        W::EndPanel();

        // 2. dial analogico retro con aguja roja
        if (W::BeginPanel("##dial", width, 0.0f, ImVec2(14.0f, 12.0f))) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
            W::SectionTitle("Dial de sintonía analógico", Icon::Radio);
            const float inner = width - 28.0f;
            const ImVec2 at = ImGui::GetCursorScreenPos();
            const ImVec2 dialMax = at + ImVec2(inner, 56.0f);
            draw->AddRectFilled(at, dialMax, IM_COL32(18, 16, 14, 255), 6.0f);
            draw->AddRect(at, dialMax, IM_COL32(90, 69, 46, 255), 6.0f, 0, 2.0f);
            const char* ticks[5] = {"540 AM", "700", "890 AM", "1040 AM", "98.5 FM"};
            float totalTicks = 0.0f;
            for (const char* tick : ticks) totalTicks += fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, tick).x;
            const float gap = (inner - 24.0f - totalTicks) / 4.0f;
            float tx = at.x + 12.0f;
            for (const char* tick : ticks) {
                draw->AddText(fonts.mono11, 11.0f, ImVec2(tx, at.y + 9.0f), IM_COL32(229, 185, 124, 255), tick);
                tx += fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, tick).x + gap;
            }
            draw->AddLine(ImVec2(at.x + 12.0f, at.y + 28.0f), ImVec2(dialMax.x - 12.0f, at.y + 28.0f), IM_COL32(115, 89, 57, 255), 1.0f);
            float needle = 50.0f;
            if (frequency >= 500.0f && frequency <= 1100.0f) needle = (frequency - 500.0f) / 600.0f * 100.0f;
            else if (frequency < 108.0f) needle = (frequency - 88.0f) / 20.0f * 100.0f;
            needle = std::clamp(needle, 2.0f, 98.0f);
            const float needleX = at.x + inner * needle / 100.0f;
            draw->AddRectFilled(ImVec2(needleX - 5.0f, at.y + 2.0f), ImVec2(needleX + 5.0f, dialMax.y - 2.0f), IM_COL32(255, 56, 56, 40), 3.0f);
            draw->AddRectFilled(ImVec2(needleX - 1.5f, at.y + 4.0f), ImVec2(needleX + 1.5f, dialMax.y - 4.0f), IM_COL32(255, 56, 56, 255), 1.0f);
            ImGui::Dummy(ImVec2(inner, 56.0f));
            // ajuste manual
            const ImVec2 row = ImGui::GetCursorScreenPos();
            W::Text(draw, Ov(true, 14), row + ImVec2(0.0f, 5.0f), IM_COL32(255, 255, 255, 255), "Ajuste manual:");
            char shown[48];
            const bool fm = frequency < 110.0f;
            if (fm) std::snprintf(shown, sizeof(shown), "%.1f MHz (FM)", frequency);
            else std::snprintf(shown, sizeof(shown), "%d kHz (AM)", static_cast<int>(frequency + 0.5f));
            const float shownWidth = fonts.monoBold13->CalcTextSizeA(13.0f, FLT_MAX, 0.0f, shown).x + 16.0f;
            const float sliderStart = W::TextWidth(Ov(true, 14), "Ajuste manual:") + 14.0f;
            ImGui::SetCursorScreenPos(row + ImVec2(sliderStart, 2.0f));
            float tuned = std::clamp(frequency, 520.0f, 1060.0f);
            if (W::Slider("sintonia", &tuned, 520.0f, 1060.0f, 5.0f, inner - sliderStart - shownWidth - 14.0f)) {
                m_RadioFrequency = tuned;
                // la emisora AM mas cercana queda sintonizada (la FM se elige con su preajuste)
                size_t best = m_SelectedRadioStation;
                float bestDistance = 1.0e9f;
                for (size_t index = 0; index < m_RadioStations.size(); ++index) {
                    const float f = frequencyOf(m_RadioStations[index]);
                    if (f < 110.0f) continue;
                    if (std::abs(f - tuned) < bestDistance) { bestDistance = std::abs(f - tuned); best = index; }
                }
                if (best != m_SelectedRadioStation) { m_SelectedRadioStation = best; m_RadioTuned = true; m_RadioDialStation = frequencyOf(m_RadioStations[best]); }
            }
            const ImVec2 boxMin(row.x + inner - shownWidth, row.y);
            draw->AddRectFilled(boxMin, boxMin + ImVec2(shownWidth, 28.0f), IM_COL32(17, 17, 17, 255), 4.0f);
            draw->AddRect(boxMin, boxMin + ImVec2(shownWidth, 28.0f), IM_COL32(51, 51, 51, 255), 4.0f);
            draw->AddText(fonts.monoBold13, 13.0f, boxMin + ImVec2(8.0f, 6.0f), IM_COL32(241, 196, 15, 255), shown);
            ImGui::SetCursorScreenPos(row + ImVec2(0.0f, 30.0f));
            ImGui::Dummy(ImVec2(1.0f, 0.0f));
            ImGui::PopStyleVar();
        }
        W::EndPanel();

        // 3. emisoras populares
        if (W::BeginPanel("##emisoras", width, 0.0f, ImVec2(14.0f, 12.0f))) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 8.0f));
            W::SectionTitle("Emisoras populares de Bogotá", Icon::Camera);
            const float inner = width - 28.0f;
            const float each = (inner - 8.0f) * 0.5f;
            for (size_t index = 0; index < m_RadioStations.size(); ++index) {
                const RadioStation& station = m_RadioStations[index];
                if (index % 2 == 1) ImGui::SameLine(0.0f, 8.0f);
                const bool current = m_SelectedRadioStation == index;
                if (W::Button(station.id.c_str(), station.name.c_str(), frequencyOf(station) < 110.0f ? Icon::Star : Icon::Radio, current, false, 48.0f, 13, 0.0f, each)) {
                    m_SelectedRadioStation = index;
                    m_RadioTuned = true;
                    m_RadioFrequency = frequencyOf(station);
                    m_RadioDialStation = m_RadioFrequency;
                }
            }
            ImGui::PopStyleVar();
        }
        W::EndPanel();

        // 4. emisora actual y senal
        if (!m_RadioStations.empty()) {
            const RadioStation& station = m_RadioStations[m_SelectedRadioStation];
            const float stationFrequency = frequencyOf(station);
            const float signalValue = radio.on ? std::clamp(1.0f - std::abs(stationFrequency - frequency) / 40.0f, 0.0f, 1.0f) : 0.0f;
            const int signal = static_cast<int>(signalValue * 100.0f + 0.5f);
            const char* rating = signal > 80 ? "Excelente (Sintonía fina)" : signal > 45 ? "Buena (Fondo con estática)" : signal > 15 ? "Débil (Mucho ruido)" : "Sin señal (solo estática)";
            const ImU32 badge = signal > 80 ? IM_COL32(39, 174, 96, 255) : signal > 45 ? IM_COL32(243, 156, 18, 255) : signal > 15 ? IM_COL32(211, 84, 0, 255) : IM_COL32(127, 140, 141, 255);
            const ImVec2 at = ImGui::GetCursorScreenPos();
            const ImVec2 max = at + ImVec2(width, 76.0f);
            draw->AddRectFilled(at, max, IM_COL32(20, 15, 10, 153), 6.0f);
            draw->AddRect(at, max, IM_COL32(115, 89, 57, 255), 6.0f);
            W::Text(draw, Ov(true, 16), at + ImVec2(12.0f, 7.0f), IM_COL32(255, 255, 255, 255), station.name.c_str());
            const float badgeWidth = W::TextWidth(Ov(true, 11), rating) + 26.0f;
            const ImVec2 badgeMin(max.x - 12.0f - badgeWidth, at.y + 8.0f);
            draw->AddRectFilled(badgeMin, badgeMin + ImVec2(badgeWidth, 20.0f), badge, 3.0f);
            SignUI::DrawIcon(draw, Icon::Gauge, badgeMin + ImVec2(11.0f, 10.0f), 11.0f);
            W::Text(draw, Ov(true, 11), badgeMin + ImVec2(20.0f, 3.5f), IM_COL32(255, 255, 255, 255), rating);
            draw->AddText(fonts.mono12, 12.0f, at + ImVec2(12.0f, 33.0f), IM_COL32(241, 196, 15, 255), ("Programa: " + station.program).c_str());
            draw->AddText(fonts.mono11, 11.0f, at + ImVec2(12.0f, 53.0f), IM_COL32(187, 187, 187, 255), ("Género: " + station.genre).c_str());
            ImGui::Dummy(ImVec2(width, 76.0f));
        }

        // 5. volumen del transistor
        if (W::BeginPanel("##volumenRadio", width, 0.0f, ImVec2(14.0f, 12.0f))) {
            ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
            W::SectionTitle("Volumen del transistor", Icon::Sound);
            const ImVec2 row = ImGui::GetCursorScreenPos();
            const float inner = width - 28.0f;
            W::Text(draw, Ov(true, 14), row + ImVec2(0.0f, 3.0f), kAzulTexto, "Volumen:");
            float volume = radio.volume * 100.0f;
            ImGui::SetCursorScreenPos(row + ImVec2(124.0f, 0.0f));
            if (W::Slider("volumenTransistor", &volume, 0.0f, 100.0f, 1.0f, inner - 124.0f - 56.0f)) m_RadioVolumeRequest = volume / 100.0f;
            char value[16];
            std::snprintf(value, sizeof(value), "%d%%", static_cast<int>(volume + 0.5f));
            const float valueWidth = W::TextWidth(Ov(true, 14), value);
            W::Text(draw, Ov(true, 14), ImVec2(row.x + inner - valueWidth, row.y + 3.0f), kAmarillo, value);
            ImGui::SetCursorScreenPos(row + ImVec2(0.0f, 22.0f));
            ImGui::Dummy(ImVec2(1.0f, 0.0f));
            ImGui::PopStyleVar();
        }
        W::EndPanel();
        ImGui::PopStyleVar();

        SignUI::BeginFooter();
        if (W::Button("cerrarRadio", radio.on ? "Escuchar de fondo y cerrar (R)" : "Cerrar ventana (R)", Icon::None, true, false, 40.0f, 14)) closeRequested = true;
    }
    SignUI::EndMenu();
    if (closeRequested) CloseRadioMenu();
}

namespace {

// Ventana oscura con filete de color (.inv-window, #craft-panel): fondo casi negro, borde de 2 px y un halo suave.
struct DarkWindow {
    ImVec2 min, max;
    bool open = false;
};

DarkWindow BeginDarkWindow(const char* id, float width, float height, ImU32 border, ImU32 glow) {
    const ImVec2 display = ImGui::GetIO().DisplaySize;
    DarkWindow window;
    width = std::min(width, display.x - 16.0f);
    height = std::min(height, display.y - 16.0f);
    ImGui::SetNextWindowSize(ImVec2(width, height), ImGuiCond_Always);
    ImGui::SetNextWindowPos(ImVec2(display.x * 0.5f, display.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));
    window.open = ImGui::Begin(id, nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                            ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar);
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    if (!window.open) return window;
    window.min = ImGui::GetWindowPos();
    window.max = window.min + ImVec2(width, height);
    ImDrawList* back = ImGui::GetBackgroundDrawList();
    for (int layer = 1; layer <= 8; ++layer) {
        const float grow = static_cast<float>(layer) * 3.0f;
        back->AddRectFilled(window.min - ImVec2(grow, grow), window.max + ImVec2(grow, grow), (glow & 0x00FFFFFF) | (4u << 24), grow);
    }
    ImDrawList* draw = ImGui::GetWindowDrawList();
    draw->AddRectFilled(window.min, window.max, IM_COL32(15, 15, 20, 247));
    draw->AddRect(window.min, window.max, border, 0.0f, 0, 2.0f);
    return window;
}

// Cabecera: icono, titulo en el color del panel, texto gris a la derecha y boton de cerrar de 26 px. Devuelve true si se pulsa cerrar.
bool DarkHeader(const DarkWindow& window, Icon icon, const char* title, ImU32 titleColor, const char* rightText, ImU32 rightColor = IM_COL32(136, 136, 136, 255)) {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 at = window.min + ImVec2(16.0f, 16.0f);
    const float width = window.max.x - window.min.x - 32.0f;
    SignUI::DrawIcon(draw, icon, at + ImVec2(12.0f, 13.0f), 22.0f);
    draw->AddText(fonts.monoBold14, 18.0f, at + ImVec2(34.0f, 3.0f), titleColor, title);
    const ImVec2 closeMin = at + ImVec2(width - 26.0f, 0.0f);
    ImGui::SetCursorScreenPos(closeMin);
    const bool pressed = ImGui::InvisibleButton("##cerrarOscuro", ImVec2(26.0f, 26.0f));
    const bool hovered = ImGui::IsItemHovered();
    draw->AddRect(closeMin, closeMin + ImVec2(26.0f, 26.0f), hovered ? titleColor : IM_COL32(68, 68, 68, 255));
    const ImU32 cross = hovered ? IM_COL32(255, 255, 255, 255) : IM_COL32(170, 170, 170, 255);
    draw->AddLine(closeMin + ImVec2(8.0f, 8.0f), closeMin + ImVec2(18.0f, 18.0f), cross, 1.6f);
    draw->AddLine(closeMin + ImVec2(18.0f, 8.0f), closeMin + ImVec2(8.0f, 18.0f), cross, 1.6f);
    const float rightWidth = fonts.mono12->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, rightText).x;
    draw->AddText(fonts.mono12, 12.0f, ImVec2(closeMin.x - 12.0f - rightWidth, at.y + 6.0f), rightColor, rightText);
    draw->AddLine(at + ImVec2(0.0f, 36.0f), at + ImVec2(width, 36.0f), IM_COL32(68, 68, 68, 255), 1.0f);
    return pressed;
}

// Boton plano de las ventanas oscuras (.inv-d-btns button, .craft-go)
bool DarkButton(const char* id, const char* label, ImVec2 size, ImU32 background, bool enabled, bool bold = false) {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    ImDrawList* draw = ImGui::GetWindowDrawList();
    ImGui::PushID(id);
    const bool pressed = ImGui::InvisibleButton("##botonOscuro", size) && enabled;
    ImGui::PopID();
    const bool hovered = enabled && ImGui::IsItemHovered();
    const ImVec2 min = ImGui::GetItemRectMin(), max = ImGui::GetItemRectMax();
    ImU32 fill = enabled ? background : IM_COL32(68, 68, 68, 255);
    if (hovered) fill = IM_COL32(std::min(255, static_cast<int>((fill >> IM_COL32_R_SHIFT & 0xFF) * 1.15f + 8)), std::min(255, static_cast<int>((fill >> IM_COL32_G_SHIFT & 0xFF) * 1.15f + 8)),
                                 std::min(255, static_cast<int>((fill >> IM_COL32_B_SHIFT & 0xFF) * 1.15f + 8)), 255);
    draw->AddRectFilled(min, max, fill);
    ImFont* font = bold ? fonts.monoBold14 : fonts.mono12;
    const float size_ = bold ? 14.0f : 12.0f;
    const ImVec2 extent = font->CalcTextSizeA(size_, FLT_MAX, 0.0f, label);
    draw->AddText(font, size_, ImVec2((min.x + max.x - extent.x) * 0.5f, (min.y + max.y - extent.y) * 0.5f), enabled ? IM_COL32(255, 255, 255, 255) : IM_COL32(136, 136, 136, 255), label);
    return pressed;
}

} // namespace

void UIManager::RenderInventoryWindow(const std::vector<InventoryOption>& items, float weight, float capacity) {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    SignUI::DrawBackdrop(0.55f);
    const ImU32 gold = IM_COL32(201, 162, 39, 255);
    const DarkWindow window = BeginDarkWindow("##inventarioOscuro", 640.0f, 456.0f, gold, IM_COL32(201, 162, 39, 255));
    if (window.open) {
        ImDrawList* draw = ImGui::GetWindowDrawList();
        const size_t count = items.size();
        char capacityText[64];
        std::snprintf(capacityText, sizeof(capacityText), "%zu/20 casillas · %.1f/%.0f kg", count, weight, capacity);
        bool close = DarkHeader(window, Icon::Bag, "Inventario", gold, capacityText);

        constexpr int columns = 5;
        constexpr float gap = 6.0f;
        constexpr float detailWidth = 190.0f;
        const float innerLeft = window.min.x + 16.0f;
        const float innerWidth = window.max.x - window.min.x - 32.0f;
        const float gridWidth = innerWidth - 14.0f - detailWidth;
        const float slot = (gridWidth - gap * (columns - 1)) / static_cast<float>(columns);
        const float top = window.min.y + 16.0f + 36.0f + 13.0f;
        const size_t slotCount = std::max<size_t>(20, ((count + columns - 1) / columns) * columns);
        const float gridHeight = static_cast<float>(slotCount / columns) * (slot + gap) - gap;
        if (count > 0) {
            m_InventorySelected = std::min(m_InventorySelected, count - 1);
            // teclado: flechas o WASD mueven, Enter usa, X tira (Mayus: todo), R ordena y 1-5 asignan la barra rapida
            const auto pressed = [](ImGuiKey a, ImGuiKey b) { return ImGui::IsKeyPressed(a, false) || ImGui::IsKeyPressed(b, false); };
            if (pressed(ImGuiKey_RightArrow, ImGuiKey_D)) m_InventorySelected = std::min(count - 1, m_InventorySelected + 1);
            if (pressed(ImGuiKey_LeftArrow, ImGuiKey_A) && m_InventorySelected > 0) --m_InventorySelected;
            if (pressed(ImGuiKey_DownArrow, ImGuiKey_S) && m_InventorySelected + columns < count) m_InventorySelected += columns;
            if (pressed(ImGuiKey_UpArrow, ImGuiKey_W) && m_InventorySelected >= static_cast<size_t>(columns)) m_InventorySelected -= columns;
            const InventoryOption& chosen = items[m_InventorySelected];
            if (pressed(ImGuiKey_Enter, ImGuiKey_KeypadEnter) && chosen.usable) m_InventoryUseRequest = chosen.itemIndex;
            if (pressed(ImGuiKey_X, ImGuiKey_Delete)) { m_InventoryDropRequest = chosen.itemIndex; m_InventoryDropAll = ImGui::GetIO().KeyShift; }
            for (int hot = 0; hot < 5; ++hot)
                if (ImGui::IsKeyPressed(static_cast<ImGuiKey>(ImGuiKey_1 + hot), false) && chosen.usable) { m_HotbarAssignSlot = hot; m_HotbarAssignItem = chosen.itemIndex; }
        }
        if (ImGui::IsKeyPressed(ImGuiKey_R, false)) m_InventorySortRequest = true;
        if (ImGui::IsKeyPressed(ImGuiKey_Tab, false)) close = true;

        // casillas
        for (size_t index = 0; index < slotCount; ++index) {
            const ImVec2 min(innerLeft + static_cast<float>(index % columns) * (slot + gap), top + static_cast<float>(index / columns) * (slot + gap));
            const ImVec2 max(min.x + slot, min.y + slot);
            const bool filled = index < count;
            ImGui::SetCursorScreenPos(min);
            ImGui::PushID(static_cast<int>(index));
            const bool clicked = ImGui::InvisibleButton("##casillaOscura", ImVec2(slot, slot));
            const bool hovered = ImGui::IsItemHovered();
            if (filled && clicked) m_InventorySelected = index;
            if (filled && hovered && ImGui::IsMouseDoubleClicked(0) && items[index].usable) m_InventoryUseRequest = items[index].itemIndex;
            ImGui::PopID();
            const bool selected = filled && index == m_InventorySelected;
            const bool rare = filled && !items[index].rarityLabel.empty() && items[index].rarityLabel != "Común" && items[index].rarityLabel != "Comun";
            draw->AddRectFilled(min, max, filled ? IM_COL32(40, 40, 50, 179) : IM_COL32(0, 0, 0, 115));
            if (selected) draw->AddRect(min - ImVec2(3, 3), max + ImVec2(3, 3), IM_COL32(255, 209, 102, 60), 0.0f, 0, 3.0f);
            draw->AddRect(min, max, selected ? IM_COL32(255, 209, 102, 255) : hovered ? IM_COL32(119, 119, 119, 255) : rare ? IM_COL32(138, 114, 32, 255) : IM_COL32(51, 51, 51, 255));
            if (!filled) continue;
            const InventoryOption& entry = items[index];
            DrawItemIcon(draw, ImVec2((min.x + max.x) * 0.5f, (min.y + max.y) * 0.5f), slot * 0.5f, entry.id, entry.name, IM_COL32(236, 240, 248, 255));
            char amount[16];
            std::snprintf(amount, sizeof(amount), "%d", entry.quantity);
            const float amountWidth = fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, amount).x;
            if (entry.quantity > 1) draw->AddText(fonts.mono11, 11.0f, ImVec2(max.x - amountWidth - 3.0f, max.y - 14.0f), gold, amount);
            if (entry.hotbarSlot >= 0) {
                char key[4];
                std::snprintf(key, sizeof(key), "%d", entry.hotbarSlot + 1);
                draw->AddText(fonts.mono11, 10.0f, ImVec2(min.x + 3.0f, min.y + 1.0f), IM_COL32(74, 181, 232, 255), key);
            }
        }

        // detalle del objeto elegido
        const ImVec2 detailMin(innerLeft + gridWidth + 14.0f, top);
        const ImVec2 detailMax(detailMin.x + detailWidth, top + gridHeight);
        draw->AddRectFilled(detailMin, detailMax, IM_COL32(0, 0, 0, 102));
        draw->AddRect(detailMin, detailMax, IM_COL32(51, 51, 51, 255));
        if (count > 0) {
            const InventoryOption& chosen = items[m_InventorySelected];
            DrawItemIcon(draw, detailMin + ImVec2(28.0f, 30.0f), 38.0f, chosen.id, chosen.name, IM_COL32(246, 220, 120, 255));
            float y = detailMin.y + 58.0f;
            char title[96];
            std::snprintf(title, sizeof(title), "%s ×%d", chosen.name.c_str(), chosen.quantity);
            draw->AddText(fonts.monoBold14, 14.0f, ImVec2(detailMin.x + 10.0f, y), IM_COL32(238, 238, 238, 255), title, nullptr, detailWidth - 20.0f);
            y += fonts.monoBold14->CalcTextSizeA(14.0f, detailWidth - 20.0f, detailWidth - 20.0f, title).y + 6.0f;
            const auto paragraph = [&](ImFont* font, float size, ImU32 color, const std::string& text) {
                if (text.empty()) return;
                draw->AddText(font, size, ImVec2(detailMin.x + 10.0f, y), color, text.c_str(), nullptr, detailWidth - 20.0f);
                y += font->CalcTextSizeA(size, detailWidth - 20.0f, detailWidth - 20.0f, text.c_str()).y + 6.0f;
            };
            paragraph(fonts.mono12, 12.0f, IM_COL32(170, 170, 170, 255), chosen.description);
            paragraph(fonts.mono12, 12.0f, IM_COL32(39, 174, 96, 255), chosen.effects);
            char meta[96];
            if (chosen.value > 0) std::snprintf(meta, sizeof(meta), "Peso %.1f kg · Valor $%d · Total $%d", chosen.weight, chosen.value, chosen.value * chosen.quantity);
            else std::snprintf(meta, sizeof(meta), "Peso %.1f kg · Total %.1f kg", chosen.weight, chosen.weight * static_cast<float>(chosen.quantity));
            paragraph(fonts.mono11, 11.0f, IM_COL32(136, 136, 136, 255), meta);
            // botones abajo: Usar | Tirar 1 / Tirar todo / Ordenar
            const float buttonWidth = (detailWidth - 20.0f - 6.0f) * 0.5f;
            const float buttonsTop = detailMax.y - 10.0f - 3.0f * 26.0f - 2.0f * 6.0f - 28.0f;
            ImGui::SetCursorScreenPos(ImVec2(detailMin.x + 10.0f, buttonsTop));
            if (DarkButton("usar", "Usar", ImVec2(buttonWidth, 26.0f), IM_COL32(39, 174, 96, 255), chosen.usable)) m_InventoryUseRequest = chosen.itemIndex;
            ImGui::SetCursorScreenPos(ImVec2(detailMin.x + 16.0f + buttonWidth, buttonsTop));
            if (DarkButton("tirar1", "Tirar 1", ImVec2(buttonWidth, 26.0f), IM_COL32(138, 58, 46, 255), true)) { m_InventoryDropRequest = chosen.itemIndex; m_InventoryDropAll = false; }
            ImGui::SetCursorScreenPos(ImVec2(detailMin.x + 10.0f, buttonsTop + 32.0f));
            if (DarkButton("tirarTodo", "Tirar todo", ImVec2(buttonWidth, 26.0f), IM_COL32(138, 58, 46, 255), true)) { m_InventoryDropRequest = chosen.itemIndex; m_InventoryDropAll = true; }
            ImGui::SetCursorScreenPos(ImVec2(detailMin.x + 10.0f, buttonsTop + 64.0f));
            if (DarkButton("ordenar", "Ordenar", ImVec2(detailWidth - 20.0f, 26.0f), IM_COL32(58, 90, 122, 255), true)) m_InventorySortRequest = true;
            draw->AddText(fonts.mono11, 10.0f, ImVec2(detailMin.x + 10.0f, detailMax.y - 22.0f), IM_COL32(102, 102, 102, 255),
                          chosen.usable ? "Acceso rápido: pulsa 1-5 para asignar" : "No se puede usar", nullptr, detailWidth - 20.0f);
        } else {
            draw->AddText(fonts.mono12, 12.0f, detailMin + ImVec2(10.0f, 12.0f), IM_COL32(136, 136, 136, 255), "El costal está vacío.\nRebusca en las bolsas para encontrar objetos.", nullptr, detailWidth - 20.0f);
        }

        const char* hint = "I / Tab / Esc cerrar · Flechas o WASD mover · Enter usar · X tirar (Mayús: todo) · R ordenar";
        const float hintWidth = fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, hint).x;
        draw->AddText(fonts.mono11, 11.0f, ImVec2((window.min.x + window.max.x - hintWidth) * 0.5f, top + gridHeight + 14.0f), IM_COL32(102, 102, 102, 255), hint);
        if (close) TogglePause();
    }
    ImGui::End();
}

void UIManager::RenderCraftWindow(const std::vector<CraftingOption>& craftingOptions, float weight, float capacity) {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    SignUI::DrawBackdrop(0.55f);
    const ImU32 green = IM_COL32(39, 174, 96, 255);
    const ImU32 wood = IM_COL32(90, 58, 26, 255);
    const ImU32 ink = IM_COL32(232, 226, 208, 255);
    const DarkWindow window = BeginDarkWindow("##crafteoOscuro", 720.0f, 520.0f, green, IM_COL32(39, 174, 96, 255));
    if (window.open) {
        ImDrawList* draw = ImGui::GetWindowDrawList();
        char load[48];
        std::snprintf(load, sizeof(load), "%.1f/%.0f kg", weight, capacity);
        const bool close = DarkHeader(window, Icon::Gear, "Mesa de Crafteo", green, load);

        const auto optionById = [&](const std::string& id) -> const CraftingOption* {
            for (const auto& option : craftingOptions) if (option.id == id) return &option;
            return nullptr;
        };
        if (!optionById(m_CraftSelected)) {
            const CraftingOption* first = nullptr;
            for (const auto& option : craftingOptions) if (option.craftable && option.fits) { first = &option; break; }
            if (!first && !craftingOptions.empty()) first = &craftingOptions.front();
            m_CraftSelected = first ? first->id : std::string();
        }
        const auto categoryColor = [](const std::string& id) -> ImU32 {
            if (id == "radioTransistor" || id == "arma") return IM_COL32(42, 183, 202, 255);   // equipo
            if (id == "curita" || id == "antibiotico") return IM_COL32(39, 174, 96, 255);       // medico
            if (id == "rifa") return IM_COL32(201, 162, 39, 255);                                // valor
            return IM_COL32(163, 91, 196, 255);                                                  // sustancia
        };
        const auto mix = [](ImU32 a, ImU32 b, float t) {
            const auto channel = [&](int shift) { return static_cast<int>(((a >> shift) & 0xFF) * (1.0f - t) + ((b >> shift) & 0xFF) * t); };
            return IM_COL32(channel(IM_COL32_R_SHIFT), channel(IM_COL32_G_SHIFT), channel(IM_COL32_B_SHIFT), 255);
        };

        const float innerLeft = window.min.x + 16.0f;
        const float innerWidth = window.max.x - window.min.x - 32.0f;
        const float benchWidth = 280.0f;
        const float gridWidth = innerWidth - 14.0f - benchWidth;
        constexpr float gap = 6.0f;
        const float tile = (gridWidth - gap * 2.0f) / 3.0f;
        const float top = window.min.y + 16.0f + 36.0f + 13.0f;

        // recetas: casillas como las del inventario
        int cell = 0;
        for (const auto& option : craftingOptions) {
            const ImVec2 min(innerLeft + static_cast<float>(cell % 3) * (tile + gap), top + static_cast<float>(cell / 3) * (tile + gap));
            const ImVec2 max(min.x + tile, min.y + tile);
            ImGui::SetCursorScreenPos(min);
            ImGui::PushID(option.id.c_str());
            const bool clicked = ImGui::InvisibleButton("##receta", ImVec2(tile, tile));
            const bool hovered = ImGui::IsItemHovered();
            ImGui::PopID();
            if (clicked) m_CraftSelected = option.id;
            const bool ready = option.craftable && option.fits;
            const bool selected = option.id == m_CraftSelected;
            const ImU32 tone = categoryColor(option.id);
            draw->AddRectFilled(min, max, IM_COL32(0, 0, 0, 115));
            draw->AddCircleFilled(ImVec2((min.x + max.x) * 0.5f, min.y + tile * 0.4f), tile * 0.42f, (mix(IM_COL32(0, 0, 0, 255), tone, 0.20f) & 0x00FFFFFF) | (150u << 24), 36);
            if (selected) draw->AddRect(min - ImVec2(3, 3), max + ImVec2(3, 3), IM_COL32(255, 209, 102, 60), 0.0f, 0, 3.0f);
            draw->AddRect(min, max, selected ? IM_COL32(255, 209, 102, 255) : hovered ? IM_COL32(119, 119, 119, 255) : option.craftable ? mix(IM_COL32(51, 51, 51, 255), green, 0.55f) : IM_COL32(51, 51, 51, 255));
            const ImU32 iconColor = option.craftable ? mix(ink, tone, 0.35f) : (IM_COL32(95, 95, 105, 255) & 0x00FFFFFF) | (140u << 24);
            DrawItemIcon(draw, ImVec2((min.x + max.x) * 0.5f, min.y + tile * 0.40f), tile * 0.36f, option.id, option.name, iconColor);
            char quantity[16];
            std::snprintf(quantity, sizeof(quantity), "×%d", option.quantity);
            const float quantityWidth = fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, quantity).x;
            draw->AddText(fonts.mono11, 11.0f, ImVec2(max.x - quantityWidth - 4.0f, min.y + 3.0f), IM_COL32(201, 162, 39, 255), quantity);
            if (ready) { const ImVec2 c(min.x + 11.0f, min.y + 11.0f); const ImVec2 pts[3] = {ImVec2(c.x - 4.0f, c.y), ImVec2(c.x - 1.0f, c.y + 3.5f), ImVec2(c.x + 5.0f, c.y - 4.5f)}; draw->AddPolyline(pts, 3, green, 0, 2.0f); }
            else if (option.craftable) draw->AddText(fonts.mono11, 10.0f, ImVec2(min.x + 5.0f, min.y + 3.0f), IM_COL32(208, 160, 32, 255), "kg");
            const ImVec2 nameSize = fonts.mono11->CalcTextSizeA(11.0f, tile - 10.0f, tile - 10.0f, option.name.c_str());
            draw->AddText(fonts.mono11, 11.0f, ImVec2((min.x + max.x - nameSize.x) * 0.5f, max.y - nameSize.y - 7.0f), option.craftable ? ink : IM_COL32(95, 95, 105, 255),
                          option.name.c_str(), nullptr, tile - 10.0f);
            ++cell;
        }

        // banco de trabajo
        const ImVec2 benchMin(innerLeft + gridWidth + 14.0f, top);
        const float benchHeight = window.max.y - 16.0f - 30.0f - top;
        const ImVec2 benchMax(benchMin.x + benchWidth, top + benchHeight);
        draw->AddRectFilled(benchMin, benchMax, IM_COL32(0, 0, 0, 90));
        draw->AddRectFilledMultiColor(benchMin, benchMax, IM_COL32(90, 58, 26, 70), IM_COL32(90, 58, 26, 70), IM_COL32(0, 0, 0, 130), IM_COL32(0, 0, 0, 130));
        draw->AddRect(benchMin, benchMax, wood);
        if (const CraftingOption* option = optionById(m_CraftSelected)) {
            const bool ready = option->craftable && option->fits;
            const ImU32 tone = categoryColor(option->id);
            const ImVec2 pedestal(benchMin.x + benchWidth * 0.5f, benchMin.y + 14.0f + 56.0f);
            if (ready) draw->AddCircleFilled(pedestal, 62.0f, (tone & 0x00FFFFFF) | (36u << 24), 40);
            draw->AddCircleFilled(pedestal, 56.0f, (mix(IM_COL32(0, 0, 0, 255), tone, 0.16f) & 0x00FFFFFF) | (170u << 24), 40);
            draw->AddCircle(pedestal, 56.0f, ready ? mix(IM_COL32(0, 0, 0, 255), tone, 0.7f) : IM_COL32(51, 51, 51, 255), 40, 1.5f);
            DrawItemIcon(draw, pedestal, 66.0f, option->id, option->name, ready ? ink : IM_COL32(150, 150, 160, 255));
            char yield[16];
            std::snprintf(yield, sizeof(yield), "×%d", option->quantity);
            const float yieldWidth = fonts.mono12->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, yield).x;
            const ImVec2 yieldMin(pedestal.x + 56.0f - yieldWidth - 12.0f, pedestal.y + 34.0f);
            draw->AddRectFilled(yieldMin, yieldMin + ImVec2(yieldWidth + 10.0f, 20.0f), IM_COL32(0, 0, 0, 190));
            draw->AddRect(yieldMin, yieldMin + ImVec2(yieldWidth + 10.0f, 20.0f), IM_COL32(68, 68, 68, 255));
            draw->AddText(fonts.mono12, 12.0f, yieldMin + ImVec2(5.0f, 3.0f), IM_COL32(201, 162, 39, 255), yield);
            float y = pedestal.y + 66.0f;
            const float nameWidth = fonts.mono14->CalcTextSizeA(15.0f, FLT_MAX, 0.0f, option->name.c_str()).x;
            draw->AddText(fonts.mono14, 15.0f, ImVec2(benchMin.x + (benchWidth - nameWidth) * 0.5f, y), IM_COL32(238, 238, 238, 255), option->name.c_str());
            y += 22.0f;
            const ImVec2 effectSize = fonts.mono11->CalcTextSizeA(11.0f, benchWidth - 24.0f, benchWidth - 24.0f, option->effect.c_str());
            draw->AddText(fonts.mono11, 11.0f, ImVec2(benchMin.x + (benchWidth - std::min(effectSize.x, benchWidth - 24.0f)) * 0.5f, y), IM_COL32(170, 170, 170, 255), option->effect.c_str(), nullptr, benchWidth - 24.0f);
            y += effectSize.y + 8.0f;
            draw->AddLine(ImVec2(benchMin.x + 12.0f, y), ImVec2(benchMax.x - 12.0f, y), IM_COL32(255, 255, 255, 20));
            draw->AddText(fonts.mono11, 10.0f, ImVec2(benchMin.x + 12.0f, y + 6.0f), IM_COL32(136, 136, 136, 255), "M A T E R I A L E S");
            y += 22.0f;
            int missing = 0;
            for (const auto& material : option->materials) {
                const bool enough = material.have >= material.need;
                missing += std::max(0, material.need - material.have);
                const ImVec2 rowMin(benchMin.x + 12.0f, y), rowMax(benchMax.x - 12.0f, y + 32.0f);
                draw->AddRectFilled(rowMin, rowMax, IM_COL32(0, 0, 0, 102));
                draw->AddRect(rowMin, rowMax, enough ? mix(IM_COL32(51, 51, 51, 255), green, 0.4f) : IM_COL32(51, 51, 51, 255));
                DrawItemIcon(draw, ImVec2(rowMin.x + 17.0f, (rowMin.y + rowMax.y) * 0.5f), 24.0f, material.id, material.name,
                             enough ? mix(ink, tone, 0.4f) : (mix(ink, tone, 0.4f) & 0x00FFFFFF) | (110u << 24));
                draw->AddText(fonts.mono12, 12.0f, ImVec2(rowMin.x + 36.0f, rowMin.y + 9.0f), IM_COL32(204, 204, 204, 255), material.name.c_str(), nullptr, rowMax.x - rowMin.x - 36.0f - 64.0f);
                char count[24];
                std::snprintf(count, sizeof(count), "%d/%d", std::min(material.have, material.need), material.need);
                const float countWidth = fonts.mono12->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, count).x;
                draw->AddText(fonts.mono12, 12.0f, ImVec2(rowMax.x - 24.0f - countWidth, rowMin.y + 9.0f), enough ? IM_COL32(201, 162, 39, 255) : IM_COL32(224, 87, 74, 255), count);
                { const ImVec2 c(rowMax.x - 11.0f, (rowMin.y + rowMax.y) * 0.5f); const ImU32 flag = enough ? green : IM_COL32(224, 87, 74, 255);
                  if (enough) { const ImVec2 pts[3] = {ImVec2(c.x - 4.0f, c.y), ImVec2(c.x - 1.0f, c.y + 3.5f), ImVec2(c.x + 5.0f, c.y - 4.5f)}; draw->AddPolyline(pts, 3, flag, 0, 2.0f); }
                  else { draw->AddLine(c + ImVec2(-4, -4), c + ImVec2(4, 4), flag, 2.0f); draw->AddLine(c + ImVec2(4, -4), c + ImVec2(-4, 4), flag, 2.0f); } }
                y += 36.0f;
            }
            const std::string many = "Te faltan " + std::to_string(missing) + " materiales";
            const char* reason = ready ? "Listo para fabricar" : option->craftable ? "No te cabe en el costal" : missing == 1 ? "Te falta 1 material" : many.c_str();
            const float reasonWidth = fonts.mono12->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, reason).x;
            const ImU32 reasonColor = ready ? green : option->craftable ? IM_COL32(208, 160, 32, 255) : IM_COL32(224, 87, 74, 255);
            draw->AddText(fonts.mono12, 12.0f, ImVec2(benchMin.x + (benchWidth - reasonWidth) * 0.5f, benchMax.y - 40.0f - 26.0f), reasonColor, reason);
            ImGui::SetCursorScreenPos(ImVec2(benchMin.x + 12.0f, benchMax.y - 12.0f - 40.0f));
            draw->AddRectFilled(ImVec2(benchMin.x + 12.0f, benchMax.y - 12.0f - 37.0f), ImVec2(benchMax.x - 12.0f, benchMax.y - 12.0f + 3.0f), ready ? IM_COL32(27, 122, 67, 255) : IM_COL32(0, 0, 0, 0));
            if (DarkButton("fabricar", "FABRICAR", ImVec2(benchWidth - 24.0f, 40.0f), green, ready, true)) { m_CraftRequest = option->id; m_CraftFlash = 0.6f; }
        }
        const char* hint = "Clic: elegir receta · C / Esc: cerrar";
        const float hintWidth = fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, hint).x;
        draw->AddText(fonts.mono11, 11.0f, ImVec2((window.min.x + window.max.x - hintWidth) * 0.5f, window.max.y - 28.0f), IM_COL32(102, 102, 102, 255), hint);
        if (close) m_CraftMenuOpen = false;
    }
    ImGui::End();
}

namespace {

// Tarjeta del HUD (.hud-card): fondo oscuro translucido con filete claro y sombra suave
void HudCard(ImDrawList* draw, ImVec2 min, ImVec2 max, float rounding = 12.0f, ImU32 fill = IM_COL32(12, 15, 20, 189)) {
    for (int layer = 3; layer >= 1; --layer)
        draw->AddRectFilled(min + ImVec2(-static_cast<float>(layer), 6.0f - static_cast<float>(layer)), max + ImVec2(static_cast<float>(layer), 6.0f + static_cast<float>(layer)), IM_COL32(0, 0, 0, 12), rounding + static_cast<float>(layer));
    draw->AddRectFilled(min, max, fill, rounding);
    draw->AddRect(min, max, IM_COL32(255, 255, 255, 26), rounding, 0, 1.0f);
}

constexpr ImGuiWindowFlags kHudWindow = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                        ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_NoNav | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse;

bool BeginHudWindow(const char* name, ImVec2 pos, ImVec2 size, ImVec2 pivot = ImVec2(0, 0), bool inputs = true) {
    ImGui::SetNextWindowPos(pos, ImGuiCond_Always, pivot);
    ImGui::SetNextWindowSize(size, ImGuiCond_Always);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    const bool open = ImGui::Begin(name, nullptr, kHudWindow | (inputs ? 0 : ImGuiWindowFlags_NoInputs));
    ImGui::PopStyleVar(2);
    return open;
}

void DrawArrow(ImDrawList* draw, ImVec2 center, float angle, float size, ImU32 color) {
    const float s = std::sin(angle), c = std::cos(angle);
    const auto rotate = [&](float x, float y) { return ImVec2(center.x + (x * c - y * s) * size, center.y + (x * s + y * c) * size); };
    const ImVec2 head[3] = {rotate(0.0f, -0.5f), rotate(0.38f, 0.0f), rotate(-0.38f, 0.0f)};
    draw->AddConvexPolyFilled(head, 3, color);
    draw->AddLine(rotate(0.0f, 0.0f), rotate(0.0f, 0.5f), color, std::max(1.5f, size * 0.16f));
}

} // namespace

void UIManager::RenderWebHud(const HudContext& c) {
    using namespace SignUI;
    const ImVec2 display = ImGui::GetIO().DisplaySize;
    const float time = static_cast<float>(ImGui::GetTime());
    const int totalMinutes = static_cast<int>(c.dayProgress * 1440.0f) % 1440;
    const std::array<float, 7>& needs = *c.needs;

    if (!m_Paused && Input::IsKeyPressed(GLFW_KEY_N)) m_RadarVisible = !m_RadarVisible;
    if (!m_Paused && (Input::IsKeyPressed(GLFW_KEY_EQUAL) || Input::IsKeyPressed(GLFW_KEY_KP_ADD))) m_RadarRange = std::max(40.0f, std::round(m_RadarRange / 1.2f));
    if (!m_Paused && (Input::IsKeyPressed(GLFW_KEY_MINUS) || Input::IsKeyPressed(GLFW_KEY_KP_SUBTRACT))) m_RadarRange = std::min(140.0f, std::round(m_RadarRange * 1.2f));
    m_RadarRange = std::clamp(m_RadarRange, 40.0f, 140.0f);
    if (Input::IsKeyPressed(GLFW_KEY_F3)) m_PerfVisible = !m_PerfVisible;

    // ---- barra superior: nombre, dia y hora, dinero, nivel y puntos de talento ----
    {
        ImFont* font = Ov(true, 13);
        char clock[48];
        std::snprintf(clock, sizeof(clock), "Día %d – %02d:%02d", m_Day, totalMinutes / 60, totalMinutes % 60);
        char money[32], level[16], points[16];
        std::snprintf(money, sizeof(money), "$ %.0f", c.money);
        std::snprintf(level, sizeof(level), "Nv %d", c.level);
        std::snprintf(points, sizeof(points), "%d", c.talentPoints);
        const std::string name = c.playerName.empty() ? "Parcero" : c.playerName;
        const float nameWidth = W::TextWidth(font, name.c_str()), clockWidth = W::TextWidth(font, clock), moneyWidth = W::TextWidth(font, money);
        const float levelWidth = std::max(W::TextWidth(font, level), 64.0f), pointsWidth = W::TextWidth(font, points) + 20.0f;
        const float total = 4.0f + (nameWidth + 18.0f) + (clockWidth + 18.0f) + (moneyWidth + 18.0f) + (levelWidth + 18.0f) + (pointsWidth + 18.0f) + 4.0f;
        if (BeginHudWindow("##topbar", ImVec2(12, 12), ImVec2(total, 34.0f), ImVec2(0, 0), false)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            HudCard(draw, at, at + ImVec2(total, 34.0f), 10.0f, IM_COL32(12, 15, 20, 189));
            float x = at.x + 4.0f;
            const float y = at.y + 11.0f;
            const auto separator = [&]() { draw->AddLine(ImVec2(x, at.y + 8.0f), ImVec2(x, at.y + 26.0f), IM_COL32(255, 255, 255, 20), 1.0f); };
            W::Text(draw, font, ImVec2(x + 9.0f, y), W::kYellow, name.c_str()); x += nameWidth + 18.0f; separator();
            W::Text(draw, font, ImVec2(x + 9.0f, y), IM_COL32(238, 242, 248, 255), clock); x += clockWidth + 18.0f; separator();
            W::Text(draw, font, ImVec2(x + 9.0f, y), IM_COL32(127, 224, 160, 255), money); x += moneyWidth + 18.0f; separator();
            W::Text(draw, font, ImVec2(x + 9.0f, at.y + 7.0f), IM_COL32(238, 242, 248, 255), level);
            const float xpFraction = std::clamp(static_cast<float>(c.xp) / static_cast<float>(std::max(1, c.level * 100)), 0.0f, 1.0f);
            draw->AddRectFilled(ImVec2(x + 9.0f, at.y + 25.0f), ImVec2(x + 9.0f + 64.0f, at.y + 29.0f), IM_COL32(255, 255, 255, 31), 2.0f);
            draw->AddRectFilled(ImVec2(x + 9.0f, at.y + 25.0f), ImVec2(x + 9.0f + 64.0f * xpFraction, at.y + 29.0f), IM_COL32(25, 196, 99, 255), 2.0f);
            x += levelWidth + 18.0f; separator();
            DrawIcon(draw, Icon::Star, ImVec2(x + 15.0f, at.y + 17.0f), 14.0f);
            W::Text(draw, font, ImVec2(x + 25.0f, y), IM_COL32(255, 209, 102, 255), points);
        }
        ImGui::End();
    }

    // ---- boton de camara, ayuda de la vista y objetivo ----
    {
        const bool third = c.camera->GetMode() == CameraMode::ThirdPerson;
        const char* label = third ? "⇄ Cambiar a vista isométrica · V" : "⇄ Cambiar a tercera persona · V";
        ImFont* font = Ov(true, 12);
        const std::string text = third ? "Cambiar a vista isométrica · V" : "Cambiar a tercera persona · V";
        const float buttonWidth = W::TextWidth(font, text.c_str()) + 28.0f + 20.0f;
        const char* hint = third ? "Clic: fijar ratón · Arrastrar o flechas: girar · Rueda: distancia · Esc: liberar" : "V: cambiar a tercera persona";
        const float hintWidth = W::TextWidth(font, hint) + 16.0f;
        std::vector<std::string> objectiveLines;
        const bool showObjective = !c.objective.empty();
        float panelHeight = 36.0f + 6.0f + 24.0f;
        if (showObjective) panelHeight += 6.0f + 46.0f;
        if (BeginHudWindow("##camara", ImVec2(12, 55), ImVec2(std::max(buttonWidth, hintWidth) + 4.0f, panelHeight + 8.0f), ImVec2(0, 0), true)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            ImGui::SetCursorScreenPos(at);
            ImGui::PushID("camaraBoton");
            const bool pressed = ImGui::InvisibleButton("##v", ImVec2(buttonWidth, 36.0f));
            ImGui::PopID();
            const bool hovered = ImGui::IsItemHovered();
            const ImU32 fill = third ? (hovered ? IM_COL32(28, 108, 170, 255) : IM_COL32(20, 83, 136, 255)) : (hovered ? IM_COL32(104, 65, 172, 255) : IM_COL32(81, 49, 140, 255));
            const ImU32 border = third ? IM_COL32(130, 206, 255, 255) : IM_COL32(194, 164, 255, 255);
            draw->AddRectFilled(at + ImVec2(0, 3), at + ImVec2(buttonWidth, 39), IM_COL32(0, 0, 0, 50), 7.0f);
            draw->AddRectFilled(at, at + ImVec2(buttonWidth, 36.0f), fill, 7.0f);
            draw->AddRect(at, at + ImVec2(buttonWidth, 36.0f), border, 7.0f, 0, 1.0f);
            const std::string full = std::string("Cambiar ") + (third ? "a vista isométrica" : "a tercera persona") + " · V";
            DrawIcon(draw, Icon::Camera, at + ImVec2(21.0f, 18.0f), 14.0f);
            W::Text(draw, font, at + ImVec2(34.0f, 11.0f), IM_COL32(255, 255, 255, 255), full.c_str());
            (void)label;
            if (pressed) c.camera->ToggleMode();
            const ImVec2 hintMin = at + ImVec2(0, 42.0f);
            draw->AddRectFilled(hintMin, hintMin + ImVec2(hintWidth, 24.0f), IM_COL32(12, 15, 20, 189), 7.0f);
            W::Text(draw, font, hintMin + ImVec2(8.0f, 5.0f), IM_COL32(201, 211, 227, 255), hint);
            if (showObjective) {
                const ImVec2 objectiveMin = at + ImVec2(0, 72.0f);
                const float objectiveWidth = 330.0f;
                draw->AddRectFilled(objectiveMin, objectiveMin + ImVec2(objectiveWidth, 46.0f), IM_COL32(40, 18, 8, 235), 10.0f);
                draw->AddRect(objectiveMin, objectiveMin + ImVec2(objectiveWidth, 46.0f), IM_COL32(230, 162, 60, 255), 10.0f);
                draw->AddText(Ov(true, 12), Ov(true, 12)->FontSize, objectiveMin + ImVec2(10.0f, 7.0f), IM_COL32(255, 225, 173, 255), c.objective.c_str(), nullptr, objectiveWidth - 20.0f);
                char progress[64] = {};
                if (c.simulation->IsMissionComplete()) std::snprintf(progress, sizeof(progress), "Misión completada");
                else if (c.simulation->IsMissionStarted()) std::snprintf(progress, sizeof(progress), "Reciclables: %llu / %llu", static_cast<unsigned long long>(c.missionProgress), static_cast<unsigned long long>(c.missionTarget));
                else std::snprintf(progress, sizeof(progress), "Acércate al marcador para iniciar la misión");
                W::Text(draw, Ov(true, 11), objectiveMin + ImVec2(10.0f, 27.0f), IM_COL32(246, 196, 0, 255), progress);
            }
        }
        ImGui::End();
    }

    // ---- botones de arriba a la derecha: radio, pausa y sonido; inventario debajo ----
    {
        ImFont* font = Ov(true, 13);
        const float height = 34.0f;
        const float radioWidth = 38.0f, soundWidth = 38.0f;
        const float pauseWidth = W::TextWidth(font, "Pausa") + 22.0f + 22.0f;
        const float total = radioWidth + pauseWidth + soundWidth + 12.0f;
        if (BeginHudWindow("##ajustesJuego", ImVec2(display.x - 12.0f, 14.0f), ImVec2(total, height), ImVec2(1.0f, 0.0f), true)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            const auto button = [&](const char* id, float x, float w, Icon icon, const char* label) {
                ImGui::SetCursorScreenPos(at + ImVec2(x, 0.0f));
                ImGui::PushID(id);
                const bool pressed = ImGui::InvisibleButton("##b", ImVec2(w, height));
                ImGui::PopID();
                const bool hovered = ImGui::IsItemHovered();
                const ImVec2 min = at + ImVec2(x, 0.0f), max = min + ImVec2(w, height);
                draw->AddRectFilled(min, max, hovered ? W::kYellow : IM_COL32(12, 15, 20, 189), 9.0f);
                draw->AddRect(min, max, IM_COL32(255, 255, 255, 36), 9.0f);
                const float labelWidth = label ? W::TextWidth(font, label) : 0.0f;
                float ix = min.x + (w - (labelWidth + (label ? 22.0f : 0.0f) + (label ? 0.0f : 16.0f))) * 0.5f;
                DrawIcon(draw, icon, ImVec2(ix + 8.0f, min.y + height * 0.5f), 16.0f);
                if (label) W::Text(draw, font, ImVec2(ix + 22.0f, min.y + 11.0f), hovered ? W::kInk : IM_COL32(238, 242, 248, 255), label);
                return pressed;
            };
            if (button("radio", 0.0f, radioWidth, Icon::Radio, nullptr)) OpenRadioMenu(false);
            if (button("pausa", radioWidth + 6.0f, pauseWidth, Icon::Pause, "Pausa")) TogglePause();
            if (button("sonido", radioWidth + pauseWidth + 12.0f, soundWidth, c.audio->IsMuted() ? Icon::Mute : Icon::Sound, nullptr)) c.audio->SetMuted(!c.audio->IsMuted());
        }
        ImGui::End();
        const float inventoryWidth = 8.0f + 22.0f + SignUI::GetFonts().monoBold13->CalcTextSizeA(13.0f, FLT_MAX, 0.0f, "Inventario · I").x + 12.0f;
        if (BeginHudWindow("##botonInventario", ImVec2(display.x - 12.0f, 72.0f), ImVec2(inventoryWidth, 34.0f), ImVec2(1.0f, 0.0f), true)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            ImGui::SetCursorScreenPos(at);
            const bool pressed = ImGui::InvisibleButton("##inv", ImVec2(inventoryWidth, 34.0f));
            const bool hovered = ImGui::IsItemHovered();
            draw->AddRectFilled(at, at + ImVec2(inventoryWidth, 34.0f), hovered ? IM_COL32(28, 28, 38, 255) : IM_COL32(18, 18, 24, 255));
            draw->AddRect(at, at + ImVec2(inventoryWidth, 34.0f), IM_COL32(201, 162, 39, 255));
            DrawIcon(draw, Icon::Bag, at + ImVec2(20.0f, 17.0f), 16.0f);
            draw->AddText(GetFonts().monoBold13, 13.0f, at + ImVec2(34.0f, 9.0f), IM_COL32(237, 197, 94, 255), "Inventario · I");
            if (pressed) OpenPauseSection(1);
        }
        ImGui::End();
    }

    // ---- columna izquierda: avisos, necesidades y radar ----
    {
        float dockWidth;
        if (m_RadarSize == 0) dockWidth = 216.0f;
        else if (m_RadarSize == 2) dockWidth = std::clamp(display.x * 0.24f, 280.0f, 400.0f);
        else dockWidth = std::clamp(display.x * 0.17f, 236.0f, 300.0f);
        const float cardPadX = 10.0f;
        const float rowHeight = 14.0f, rowGap = 4.0f;
        const float needsHeight = 8.0f + 7.0f * rowHeight + 6.0f * rowGap + 6.0f;
        // avisos de salud, adrenalina y abstinencia (#status)
        std::vector<std::pair<std::string, ImU32>> warnings;
        if (needs[3] <= 10.0f) warnings.push_back({"Salud crítica: usa vendajes o evita los vehículos.", IM_COL32(255, 107, 94, 255)});
        else if (needs[3] <= 25.0f) warnings.push_back({"Salud baja: usa vendajes y evita los vehículos.", IM_COL32(255, 194, 74, 255)});
        if (c.boostActive) { char b[64]; std::snprintf(b, sizeof(b), "ADRENALINA: %.1fs (+35%% vel, +botín)", std::max(0.0f, c.boostTimer)); warnings.push_back({b, IM_COL32(64, 242, 255, 255)}); }
        const float withdrawal = needs[6] < 20.0f ? (20.0f - needs[6]) * 5.0f : 0.0f;
        if (withdrawal >= 80.0f) warnings.push_back({"¡ABSTINENCIA CRÍTICA: PSICOSIS!", IM_COL32(255, 60, 60, 255)});
        else if (withdrawal >= 50.0f) warnings.push_back({"Síndrome de abstinencia: paranoia", IM_COL32(255, 153, 51, 255)});
        std::vector<std::pair<std::string, std::string>> diseases;
        if (c.diseaseSummary != "Sin enfermedades" && !c.diseaseSummary.empty()) {
            std::istringstream stream(c.diseaseSummary);
            std::string part;
            while (std::getline(stream, part, '|')) {
                const size_t first = part.find_first_not_of(" \t"), last = part.find_last_not_of(" \t");
                if (first == std::string::npos) continue;
                part = part.substr(first, last - first + 1);
                std::string name = part, remaining;
                const size_t paren = part.find(" (");
                if (paren != std::string::npos) { name = part.substr(0, paren); remaining = part.substr(paren + 2, part.size() - paren - 3); }
                diseases.push_back({name, remaining});
            }
        }
        const float radarWidth = dockWidth;
        const float radarHeight = m_RadarVisible ? std::round(radarWidth * 3.0f / 4.0f) : 0.0f;
        const float infoHeight = m_RadarVisible ? 46.0f : 0.0f;
        const float showButtonHeight = m_RadarVisible ? 0.0f : 28.0f;
        float stackHeight = needsHeight + 8.0f;
        stackHeight += static_cast<float>(warnings.size()) * (30.0f + 8.0f) + static_cast<float>(diseases.size()) * (26.0f + 4.0f);
        if (m_RadarVisible) stackHeight += radarHeight + 6.0f + infoHeight; else stackHeight += showButtonHeight;
        const ImVec2 dockPos(16.0f, display.y - 16.0f - stackHeight);
        if (BeginHudWindow("##dock", dockPos, ImVec2(dockWidth, stackHeight), ImVec2(0, 0), true)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            float y = dockPos.y;
            // enfermedades
            for (const auto& [name, remaining] : diseases) {
                draw->AddRectFilled(ImVec2(dockPos.x, y), ImVec2(dockPos.x + dockWidth, y + 26.0f), IM_COL32(60, 14, 10, 217), 8.0f);
                draw->AddRect(ImVec2(dockPos.x, y), ImVec2(dockPos.x + dockWidth, y + 26.0f), IM_COL32(192, 57, 43, 255), 8.0f);
                W::Text(draw, Ov(true, 12), ImVec2(dockPos.x + 9.0f, y + 6.0f), IM_COL32(255, 122, 107, 255), name.c_str());
                const float rw = W::TextWidth(Ov(true, 12), remaining.c_str());
                W::Text(draw, Ov(true, 12), ImVec2(dockPos.x + dockWidth - 9.0f - rw, y + 6.0f), IM_COL32(136, 136, 136, 255), remaining.c_str());
                y += 30.0f;
            }
            for (const auto& [text, color] : warnings) {
                draw->AddRectFilled(ImVec2(dockPos.x, y), ImVec2(dockPos.x + dockWidth, y + 30.0f), IM_COL32(40, 18, 8, 235), 10.0f);
                draw->AddRect(ImVec2(dockPos.x, y), ImVec2(dockPos.x + dockWidth, y + 30.0f), IM_COL32(230, 162, 60, 255), 10.0f);
                draw->AddText(Ov(true, 12), Ov(true, 12)->FontSize, ImVec2(dockPos.x + 10.0f, y + 7.0f), color, text.c_str(), nullptr, dockWidth - 20.0f);
                y += 38.0f;
            }
            // necesidades
            const ImVec2 needsMin(dockPos.x, y), needsMax(dockPos.x + dockWidth, y + needsHeight);
            HudCard(draw, needsMin, needsMax, 12.0f);
            static const std::array<const char*, 7> labels{{"Hambre", "Sed", "Energía", "Salud", "Higiene", "Ánimo", "Vicio"}};
            static const std::array<Icon, 7> icons{{Icon::Bread, Icon::Drop, Icon::Energy, Icon::Heart, Icon::Soap, Icon::Heart, Icon::Flame}};
            static const std::array<ImU32, 7> fills{{IM_COL32(233, 168, 59, 255), IM_COL32(61, 142, 240, 255), IM_COL32(166, 120, 255, 255), IM_COL32(236, 75, 79, 255),
                                                       IM_COL32(47, 195, 173, 255), IM_COL32(239, 119, 182, 255), IM_COL32(184, 151, 122, 255)}};
            const bool compact = m_RadarSize == 0;
            for (size_t i = 0; i < 7; ++i) {
                const float value = std::clamp(needs[i], 0.0f, 100.0f);
                const bool critical = value < 15.0f, low = value < 30.0f;
                const float rowY = needsMin.y + 8.0f + static_cast<float>(i) * (rowHeight + rowGap);
                const ImU32 nameColor = critical ? IM_COL32(255, 107, 94, 255) : IM_COL32(201, 211, 227, 255);
                const ImU32 valueColor = critical ? IM_COL32(255, 107, 94, 255) : low ? IM_COL32(255, 194, 74, 255) : IM_COL32(255, 255, 255, 255);
                DrawIcon(draw, icons[i], ImVec2(needsMin.x + cardPadX + 9.0f, rowY + 7.0f), 13.0f);
                float barX = needsMin.x + cardPadX + 18.0f + 7.0f;
                if (!compact) { W::Text(draw, Ov(true, 12), ImVec2(barX, rowY + 0.5f), nameColor, labels[i]); barX += 62.0f + 7.0f; }
                const float barRight = needsMax.x - cardPadX - 26.0f - 7.0f;
                const ImVec2 barMin(barX, rowY + 3.0f), barMax(barRight, rowY + 11.0f);
                draw->AddRectFilled(barMin, barMax, IM_COL32(255, 255, 255, 23), 4.0f);
                const float fillWidth = (barMax.x - barMin.x) * value / 100.0f;
                if (fillWidth > 1.0f) {
                    const ImU32 base = fills[i];
                    const ImU32 dark = IM_COL32(static_cast<int>(((base >> IM_COL32_R_SHIFT) & 0xFF) * 0.65f), static_cast<int>(((base >> IM_COL32_G_SHIFT) & 0xFF) * 0.65f), static_cast<int>(((base >> IM_COL32_B_SHIFT) & 0xFF) * 0.65f), 255);
                    draw->AddRectFilledMultiColor(barMin, ImVec2(barMin.x + fillWidth, barMax.y), dark, base, base, dark);
                }
                if (critical) draw->AddRect(barMin, barMax, IM_COL32(255, 90, 74, static_cast<int>(120 + 120 * (0.5f + 0.5f * std::sin(time * 7.0f)))), 4.0f, 0, 1.5f);
                char number[8];
                std::snprintf(number, sizeof(number), "%d", static_cast<int>(value + 0.5f));
                const float nw = W::TextWidth(Ov(true, 12), number);
                W::Text(draw, Ov(true, 12), ImVec2(needsMax.x - cardPadX - nw, rowY + 0.5f), valueColor, number);
            }
            y += needsHeight + 8.0f;

            if (m_RadarVisible) RenderMinimap(c, ImVec2(dockPos.x, y), ImVec2(radarWidth, radarHeight), infoHeight);
            else {
                ImGui::SetCursorScreenPos(ImVec2(dockPos.x, y));
                if (W::Button("mostrarRadar", "Radar · N", Icon::Compass, false, false, 28.0f, 12)) m_RadarVisible = true;
            }
        }
        ImGui::End();
    }

    // ---- ayuda de controles: boton "!" plegado; al pulsarlo se abre la guia ----
    {
        static bool helpOpen = false;
        if (BeginHudWindow("##ayudaControles", ImVec2(display.x * 0.5f, display.y - 12.0f), ImVec2(helpOpen ? std::min(900.0f, display.x - 540.0f) : 44.0f, helpOpen ? 108.0f : 44.0f), ImVec2(0.5f, 1.0f), true)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            const ImVec2 size = ImGui::GetWindowSize();
            draw->AddRectFilled(at, at + size, IM_COL32(12, 19, 22, 245), helpOpen ? 10.0f : 22.0f);
            draw->AddRect(at, at + size, IM_COL32(100, 114, 102, 255), helpOpen ? 10.0f : 22.0f);
            ImGui::SetCursorScreenPos(at);
            ImGui::PushID("ayuda");
            const bool pressed = ImGui::InvisibleButton("##alternar", ImVec2(size.x, 44.0f));
            ImGui::PopID();
            ImFont* toggleFont = Ov(true, helpOpen ? 13 : 24);
            const char* toggleText = helpOpen ? "Ocultar controles" : "!";
            const float toggleWidth = W::TextWidth(toggleFont, toggleText);
            W::Text(draw, toggleFont, ImVec2(at.x + (size.x - toggleWidth) * 0.5f, at.y + (helpOpen ? 14.0f : 8.0f)), IM_COL32(255, 225, 153, 255), toggleText);
            if (pressed) helpOpen = !helpOpen;
            if (helpOpen) {
                static const std::array<std::pair<const char*, const char*>, 20> items{{{"WASD", "Mover"}, {"Espacio", "Saltar"}, {"Click / G", "Puñetazo"}, {"Shift", "Correr"}, {"E", "Interactuar"},
                    {"I / Tab", "Inventario"}, {"V", "Cámara"}, {"Q", "Seleccionar / dealer"}, {"B", "Limosna"}, {"F", "Boost"}, {"T", "Talentos"}, {"C", "Fabricar"},
                    {"P", "Personaje"}, {"M", "Mapa y GPS"}, {"F3", "Rendimiento"}, {"N", "Radar"}, {"R", "Radio"}, {"X", "Lanzar / recoger"}, {"Z", "Defecar"}, {"Esc", "Pausa y ayuda"}}};
                float x = at.x + 16.0f, y = at.y + 46.0f;
                ImFont* keyFont = SignUI::GetFonts().mono12;
                for (const auto& [key, text] : items) {
                    const float keyWidth = keyFont->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, key).x + 12.0f;
                    const float textWidth = W::TextWidth(Ov(false, 13), text);
                    const float itemWidth = keyWidth + 6.0f + textWidth + 16.0f;
                    if (x + itemWidth > at.x + size.x - 16.0f) { x = at.x + 16.0f; y += 22.0f; }
                    draw->AddRectFilled(ImVec2(x, y), ImVec2(x + keyWidth, y + 19.0f), IM_COL32(48, 60, 62, 255), 4.0f);
                    draw->AddRect(ImVec2(x, y), ImVec2(x + keyWidth, y + 19.0f), IM_COL32(129, 145, 140, 255), 4.0f);
                    draw->AddText(keyFont, 12.0f, ImVec2(x + 6.0f, y + 2.0f), IM_COL32(255, 225, 153, 255), key);
                    W::Text(draw, Ov(false, 13), ImVec2(x + keyWidth + 6.0f, y + 1.5f), IM_COL32(243, 240, 231, 255), text);
                    x += itemWidth;
                }
            }
        }
        ImGui::End();
    }

    // ---- municion de popo ----
    {
        int poop = 0;
        for (const InventoryOption& item : *c.inventory) if (item.id == "popo") poop += item.quantity;
        char text[64];
        if (poop > 0) std::snprintf(text, sizeof(text), "[X] Lanzar popó (%d) · [Z] Cagar", poop);
        else std::snprintf(text, sizeof(text), "[X] Hacer popó");
        const float width = W::TextWidth(Ov(true, 13), text) + 28.0f + 24.0f;
        if (BeginHudWindow("##popo", ImVec2(display.x - 16.0f, display.y - 80.0f), ImVec2(width, 32.0f), ImVec2(1.0f, 1.0f), false)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            const float alpha = poop > 0 ? 1.0f : 0.7f;
            draw->AddRectFilled(at, at + ImVec2(width, 32.0f), IM_COL32(36, 20, 10, static_cast<int>(224 * alpha)), 9.0f);
            draw->AddRect(at, at + ImVec2(width, 32.0f), poop > 0 ? IM_COL32(255, 209, 102, 255) : IM_COL32(121, 85, 72, static_cast<int>(255 * alpha)), 9.0f);
            draw->AddCircleFilled(at + ImVec2(20.0f, 16.0f), 7.0f, IM_COL32(120, 78, 42, 255), 16);
            draw->AddCircleFilled(at + ImVec2(20.0f, 11.5f), 4.5f, IM_COL32(120, 78, 42, 255), 14);
            W::Text(draw, Ov(true, 13), at + ImVec2(36.0f, 8.0f), poop > 0 ? IM_COL32(255, 255, 255, 255) : IM_COL32(215, 204, 200, static_cast<int>(255 * alpha)), text);
        }
        ImGui::End();
    }
}

// Radar de la columna izquierda (Minimap.js): plano girado con la camara (arriba = frente de la vista), jugador algo abajo, ruta del GPS,
// norte en el borde, puntos de interes y destino. Debajo, la tarjeta con el punto mas cercano o el destino.
void UIManager::RenderMinimap(const HudContext& c, ImVec2 origin, ImVec2 size, float infoHeight) {
    using namespace SignUI;
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const glm::vec3 cameraPosition = c.camera->GetPosition();
    glm::vec2 forward(c.playerPos.x - cameraPosition.x, c.playerPos.z - cameraPosition.z);
    forward = glm::length(forward) > 0.01f ? glm::normalize(forward) : glm::vec2(0.0f, -1.0f);
    const float theta = -glm::half_pi<float>() - std::atan2(forward.y, forward.x);   // gira el mundo para que el frente quede arriba
    const float sinT = std::sin(theta), cosT = std::cos(theta);
    const float u = size.x / 220.0f;
    const ImVec2 max = origin + size;
    const float cx = origin.x + size.x * 0.5f, cy = origin.y + size.y * 0.6f;
    static float range = 70.0f;
    range += (m_RadarRange - range) * std::min(1.0f, ImGui::GetIO().DeltaTime * 2.5f);
    const float scale = (size.y * 0.5f) / range;   // pixeles por metro
    const auto project = [&](float x, float z) {
        const float dx = x - c.playerPos.x, dz = z - c.playerPos.z;
        return ImVec2(cx + (dx * cosT - dz * sinT) * scale, cy + (dx * sinT + dz * cosT) * scale);
    };
    const float pad = 9.0f * u;
    // lleva un punto al borde del rectangulo siguiendo el rayo desde el jugador
    const auto clampToEdge = [&](ImVec2 p, bool& clamped) {
        const float vx = p.x - cx, vy = p.y - cy;
        float t = 1.0f;
        if (vx > 0) t = std::min(t, (max.x - pad - cx) / vx); else if (vx < 0) t = std::min(t, (origin.x + pad - cx) / vx);
        if (vy > 0) t = std::min(t, (max.y - pad - cy) / vy); else if (vy < 0) t = std::min(t, (origin.y + pad - cy) / vy);
        clamped = t < 1.0f;
        return ImVec2(cx + vx * t, cy + vy * t);
    };

    // sombra y fondo
    for (int layer = 3; layer >= 1; --layer)
        draw->AddRectFilled(origin + ImVec2(-static_cast<float>(layer), 6.0f - static_cast<float>(layer)), max + ImVec2(static_cast<float>(layer), 6.0f + static_cast<float>(layer)), IM_COL32(0, 0, 0, 14), 12.0f + static_cast<float>(layer));
    draw->AddRectFilled(origin, max, IM_COL32(16, 19, 24, 255), 12.0f);
    draw->PushClipRect(origin, max, true);
    // plano: se muestrea el mapa por celdas de 4 px
    const float cell = 3.0f;
    const int columns = static_cast<int>(std::ceil(size.x / cell)), rows = static_cast<int>(std::ceil(size.y / cell));
    for (int row = 0; row < rows; ++row) {
        for (int column = 0; column < columns; ++column) {
            const float px = origin.x + (static_cast<float>(column) + 0.5f) * cell, py = origin.y + (static_cast<float>(row) + 0.5f) * cell;
            const float screenX = (px - cx) / scale, screenZ = (py - cy) / scale;
            const float worldX = c.playerPos.x + screenX * cosT + screenZ * sinT;
            const float worldZ = c.playerPos.z - screenX * sinT + screenZ * cosT;
            const int tileX = static_cast<int>(std::floor((worldX + CityLayout::ORIGIN_X) / CityLayout::TILE_SIZE));
            const int tileZ = static_cast<int>(std::floor((worldZ + CityLayout::ORIGIN_Z) / CityLayout::TILE_SIZE));
            ImU32 color;
            switch (c.city->GetMapCode(tileX, tileZ)) {
                case 'r': color = IM_COL32(0x24, 0x27, 0x2d, 255); break;
                case 'B': color = IM_COL32(0x5b, 0x2c, 0x31, 255); break;
                case 's': color = IM_COL32(0x6b, 0x6e, 0x72, 255); break;
                case 'f': color = IM_COL32(0x58, 0x5c, 0x61, 255); break;
                case 'p': color = IM_COL32(0x77, 0x73, 0x6a, 255); break;
                case 'd': color = IM_COL32(0x5d, 0x4b, 0x37, 255); break;
                case 'g': color = IM_COL32(0x2f, 0x5b, 0x35, 255); break;
                case 'W': color = IM_COL32(0x1e, 0x5a, 0x86, 255); break;
                case 'R': color = IM_COL32(0x4a, 0x40, 0x38, 255); break;
                case 'w': color = IM_COL32(0x15, 0x17, 0x1b, 255); break;
                case 'S': color = IM_COL32(0x2c, 0x6b, 0x4b, 255); break;
                case 'C': color = IM_COL32(0x8a, 0x6d, 0x22, 255); break;
                case 'A': color = IM_COL32(0x6f, 0x6a, 0x5e, 255); break;
                case 'M': color = IM_COL32(0x45, 0x4b, 0x56, 255); break;
                default: color = IM_COL32(0x3b, 0x41, 0x4c, 255); break;
            }
            const ImVec2 a(origin.x + static_cast<float>(column) * cell, origin.y + static_cast<float>(row) * cell);
            draw->AddRectFilled(a, ImVec2(a.x + cell + 0.5f, a.y + cell + 0.5f), color);
        }
    }
    // ruta del GPS
    if (m_GpsView.active && m_GpsView.route.size() > 1) {
        std::vector<ImVec2> line;
        for (const glm::vec2& point : m_GpsView.route) line.push_back(project(point.x, point.y));
        draw->AddPolyline(line.data(), static_cast<int>(line.size()), IM_COL32(0, 0, 0, 166), ImDrawFlags_RoundCornersAll, 7.0f * u);
        draw->AddPolyline(line.data(), static_cast<int>(line.size()), IM_COL32(246, 196, 0, 255), ImDrawFlags_RoundCornersAll, 4.0f * u);
    }
    // vineta del borde
    draw->AddRect(origin + ImVec2(u, u), max - ImVec2(u, u), IM_COL32(0, 0, 0, 140), 10.0f, 0, 2.0f * u);

    // norte en el borde
    {
        bool clamped = false;
        const ImVec2 north = clampToEdge(ImVec2(cx + sinT * size.x * 4.0f, cy - cosT * size.x * 4.0f), clamped);
        draw->AddCircleFilled(north, 7.0f * u, IM_COL32(14, 15, 18, 230), 18);
        W::Text(draw, Ov(true, 10), north - ImVec2(3.5f, 5.5f), W::kYellow, "N");
    }

    // puntos de interes
    struct Poi { std::string name; glm::vec3 position; ImU32 color; };
    std::vector<Poi> pois;
    pois.push_back({"El Chato", c.simulation->GetDogPosition(), IM_COL32(117, 184, 255, 255)});
    pois.push_back({"Cambuche", c.simulation->GetCambuchePosition(), IM_COL32(255, 209, 102, 255)});
    pois.push_back({"Recicladora", c.simulation->GetRecyclerPosition(), IM_COL32(42, 183, 202, 255)});
    pois.push_back({"Dealer", c.simulation->GetDealerPosition(), IM_COL32(155, 89, 182, 255)});
    for (const auto& landmark : c.city->GetLandmarks()) {
        if (landmark.name == "Pasarela") continue;
        pois.push_back({landmark.name, landmark.position, landmark.name == "Gasolinera" ? IM_COL32(222, 62, 62, 255) : landmark.name == "Tienda D69" ? IM_COL32(236, 76, 118, 255) : landmark.name == "Torre Colpatria" ? IM_COL32(255, 203, 69, 255) : IM_COL32(92, 168, 226, 255)});
    }
    const Poi* nearest = nullptr;
    float nearestDistance = 1.0e9f;
    for (const Poi& poi : pois) {
        const float distance = std::hypot(poi.position.x - c.playerPos.x, poi.position.z - c.playerPos.z);
        if (distance < nearestDistance) { nearestDistance = distance; nearest = &poi; }
        bool clamped = false;
        const ImVec2 at = clampToEdge(project(poi.position.x, poi.position.z), clamped);
        draw->AddCircleFilled(at, (clamped ? 3.5f : 5.0f) * u, poi.color, 16);
        draw->AddCircle(at, (clamped ? 3.5f : 5.0f) * u, IM_COL32(0, 0, 0, 255), 16, 1.2f * u);
    }
    // destino del GPS: chincheta amarilla
    if (m_GpsView.active) {
        bool clamped = false;
        const ImVec2 tip = clampToEdge(project(m_GpsView.waypoint.x, m_GpsView.waypoint.y), clamped);
        const ImVec2 head(tip.x, tip.y - 9.0f * u);
        draw->AddTriangleFilled(tip, ImVec2(head.x - 5.0f * u, head.y + 3.0f * u), ImVec2(head.x + 5.0f * u, head.y + 3.0f * u), W::kYellow);
        draw->AddCircleFilled(head, 6.0f * u, W::kYellow, 18);
        draw->AddCircle(head, 6.0f * u, W::kInk, 18, 1.5f * u);
        draw->AddCircleFilled(head, 2.2f * u, W::kInk, 10);
    }
    // jugador: flecha fija hacia arriba
    {
        const ImVec2 arrow[4] = {ImVec2(cx, cy - 8.0f * u), ImVec2(cx + 5.5f * u, cy + 6.0f * u), ImVec2(cx, cy + 3.0f * u), ImVec2(cx - 5.5f * u, cy + 6.0f * u)};
        draw->AddConvexPolyFilled(arrow, 4, IM_COL32(255, 255, 255, 255));
        draw->AddPolyline(arrow, 4, IM_COL32(11, 79, 163, 255), ImDrawFlags_Closed, 1.6f * u);
    }
    // escala
    {
        char scaleText[16];
        std::snprintf(scaleText, sizeof(scaleText), "%d m", static_cast<int>(range + 0.5f));
        W::Text(draw, Ov(true, 10), ImVec2(origin.x + 8.0f * u, max.y - 7.0f * u - 11.0f), IM_COL32(214, 228, 255, 179), scaleText);
    }
    draw->PopClipRect();
    draw->AddRect(origin, max, IM_COL32(255, 255, 255, 36), 12.0f, 0, 1.0f);

    // herramientas: acercar, alejar y ocultar
    {
        struct Tool { const char* id; const char* glyph; };
        static const std::array<Tool, 3> tools{{{"acercar", "+"}, {"alejar", "−"}, {"ocultar", "✕"}}};
        const float alpha = ImGui::IsMouseHoveringRect(origin, max) ? 1.0f : 0.55f;
        for (size_t i = 0; i < tools.size(); ++i) {
            const ImVec2 min(max.x - 6.0f - 24.0f, origin.y + 6.0f + static_cast<float>(i) * 28.0f);
            ImGui::SetCursorScreenPos(min);
            ImGui::PushID(tools[i].id);
            const bool pressed = ImGui::InvisibleButton("##herramientaRadar", ImVec2(24.0f, 24.0f));
            ImGui::PopID();
            const bool hovered = ImGui::IsItemHovered();
            draw->AddRectFilled(min, min + ImVec2(24, 24), hovered ? W::kYellow : IM_COL32(12, 15, 20, static_cast<int>(217 * alpha)), 7.0f);
            draw->AddRect(min, min + ImVec2(24, 24), IM_COL32(255, 255, 255, static_cast<int>(56 * alpha)), 7.0f);
            const ImVec2 mid = min + ImVec2(12, 12);
            const ImU32 ink = hovered ? W::kInk : IM_COL32(238, 242, 248, static_cast<int>(255 * alpha));
            if (i == 0) { draw->AddLine(mid + ImVec2(-5, 0), mid + ImVec2(5, 0), ink, 2.0f); draw->AddLine(mid + ImVec2(0, -5), mid + ImVec2(0, 5), ink, 2.0f); }
            else if (i == 1) draw->AddLine(mid + ImVec2(-5, 0), mid + ImVec2(5, 0), ink, 2.0f);
            else { draw->AddLine(mid + ImVec2(-4, -4), mid + ImVec2(4, 4), ink, 2.0f); draw->AddLine(mid + ImVec2(4, -4), mid + ImVec2(-4, 4), ink, 2.0f); }
            if (pressed) {
                if (i == 0) m_RadarRange = std::max(40.0f, std::round(m_RadarRange / 1.2f));
                else if (i == 1) m_RadarRange = std::min(140.0f, std::round(m_RadarRange * 1.2f));
                else m_RadarVisible = false;
            }
        }
    }

    // tarjeta de informacion: destino del GPS o punto mas cercano
    {
        static const std::array<const char*, 8> directions{{"Al frente", "Diagonal der.", "Derecha", "Atrás der.", "Atrás", "Atrás izq.", "Izquierda", "Diagonal izq."}};
        const auto sector = [&](float x, float z) {
            const float dx = x - c.playerPos.x, dz = z - c.playerPos.z;
            const float right = dx * cosT - dz * sinT, ahead = -(dx * sinT + dz * cosT);
            const int index = (static_cast<int>(std::lround(std::atan2(right, ahead) / (glm::pi<float>() / 4.0f))) + 8) % 8;
            return std::pair<int, const char*>{index, directions[static_cast<size_t>(index)]};
        };
        std::string title, detail;
        int arrow = -1;
        if (m_GpsView.active) {
            title = m_GpsView.name;
            if (m_GpsView.route.empty()) detail = "Sin ruta a pie";
            else {
                // el punto de la ruta unos 12 m por delante marca la direccion
                glm::vec2 aim = m_GpsView.route.back();
                float walked = 0.0f;
                for (size_t i = 1; i < m_GpsView.route.size(); ++i) {
                    walked += glm::distance(m_GpsView.route[i - 1], m_GpsView.route[i]);
                    if (walked >= 12.0f) { aim = m_GpsView.route[i]; break; }
                }
                const auto [index, name] = sector(aim.x, aim.y);
                char distance[48];
                if (m_GpsView.distance >= 1000.0f) std::snprintf(distance, sizeof(distance), "%.1fkm", m_GpsView.distance / 1000.0f);
                else std::snprintf(distance, sizeof(distance), "%.0fm", m_GpsView.distance);
                detail = std::string(distance) + " · " + name;
                arrow = index;
            }
        } else if (nearest) {
            title = nearest->name;
            char distance[48];
            std::snprintf(distance, sizeof(distance), "%.0fm", nearestDistance);
            if (nearestDistance < 2.0f) { detail = std::string(distance) + " · Aquí"; }
            else { const auto [index, name] = sector(nearest->position.x, nearest->position.z); detail = std::string(distance) + " · " + name; arrow = index; }
        } else {
            title = "Sin puntos cercanos";
        }
        const ImVec2 infoMin(origin.x, max.y + 6.0f), infoMax(max.x, max.y + 6.0f + infoHeight - 6.0f + 6.0f);
        draw->AddRectFilled(infoMin, ImVec2(infoMax.x, infoMin.y + 40.0f), IM_COL32(12, 15, 20, 209), 10.0f);
        draw->AddRect(infoMin, ImVec2(infoMax.x, infoMin.y + 40.0f), IM_COL32(255, 255, 255, 26), 10.0f);
        draw->PushClipRect(infoMin, ImVec2(infoMax.x, infoMin.y + 40.0f), true);
        draw->AddRectFilled(infoMin, ImVec2(infoMin.x + 4.0f, infoMin.y + 40.0f), m_GpsView.active ? W::kYellow : IM_COL32(108, 122, 144, 255));
        draw->PopClipRect();
        W::Text(draw, Ov(true, 13), infoMin + ImVec2(14.0f, 5.0f), IM_COL32(255, 255, 255, 255), title.c_str());
        // "<distancia> · <flecha> <direccion>"
        float detailX = infoMin.x + 14.0f;
        const size_t dot = detail.find(" · ");
        const std::string distanceText = dot == std::string::npos ? detail : detail.substr(0, dot + 3);
        const std::string directionText = dot == std::string::npos ? std::string() : detail.substr(dot + 4);
        detailX += W::Text(draw, Ov(true, 12), ImVec2(detailX, infoMin.y + 21.0f), IM_COL32(201, 211, 227, 255), (distanceText + " ").c_str());
        if (arrow >= 0) { DrawArrow(draw, ImVec2(detailX + 6.0f, infoMin.y + 29.0f), static_cast<float>(arrow) * glm::pi<float>() / 4.0f, 11.0f, IM_COL32(201, 211, 227, 255)); detailX += 15.0f; }
        else if (nearest && nearestDistance < 2.0f && dot != std::string::npos) { DrawIcon(draw, Icon::Pin, ImVec2(detailX + 6.0f, infoMin.y + 29.0f), 12.0f); detailX += 15.0f; }
        W::Text(draw, Ov(true, 12), ImVec2(detailX, infoMin.y + 21.0f), IM_COL32(201, 211, 227, 255), directionText.c_str());
    }
}

void UIManager::RenderTalentWindow(const std::vector<TalentOption>& talents, int points) {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    SignUI::DrawBackdrop(0.55f);
    const ImU32 gold = IM_COL32(201, 162, 39, 255);
    const DarkWindow window = BeginDarkWindow("##talentosOscuro", 700.0f, 470.0f, gold, IM_COL32(201, 162, 39, 255));
    if (window.open) {
        ImDrawList* draw = ImGui::GetWindowDrawList();
        char pointsText[32];
        std::snprintf(pointsText, sizeof(pointsText), "Puntos: %d", points);
        const bool close = DarkHeader(window, Icon::Star, "Árbol de Talentos", IM_COL32(255, 209, 102, 255), pointsText, IM_COL32(255, 209, 102, 255));
        struct Branch { const char* name; const char* prefix; };
        static const std::array<Branch, 3> branches{{{"Recolección", "collector"}, {"Supervivencia", "surv"}, {"Crimen", "crime"}}};
        const float left = window.min.x + 16.0f;
        const float width = window.max.x - window.min.x - 32.0f;
        const float columnWidth = (width - 24.0f) / 3.0f;
        const float top = window.min.y + 16.0f + 36.0f + 16.0f;
        const auto nameOf = [&](const std::string& id) {
            for (const TalentOption& talent : talents) if (talent.id == id) return talent.name;
            return id;
        };
        for (size_t b = 0; b < branches.size(); ++b) {
            const float x = left + static_cast<float>(b) * (columnWidth + 12.0f);
            draw->AddText(fonts.monoBold14, 14.0f, ImVec2(x, top), IM_COL32(42, 183, 202, 255), branches[b].name);
            float y = top + 26.0f;
            for (const TalentOption& talent : talents) {
                if (talent.id.rfind(branches[b].prefix, 0) != 0) continue;
                const float textWidth = columnWidth - 16.0f;
                const ImVec2 descSize = fonts.mono11->CalcTextSizeA(11.0f, textWidth, textWidth, talent.description.c_str());
                const bool hasRequirement = !talent.requirement.empty();
                const float height = 8.0f + 18.0f + descSize.y + 6.0f + (hasRequirement ? 14.0f : 0.0f) + 16.0f + 8.0f;
                const ImVec2 min(x, y), max(x + columnWidth, y + height);
                ImGui::SetCursorScreenPos(min);
                ImGui::PushID(talent.id.c_str());
                const bool clicked = ImGui::InvisibleButton("##talento", ImVec2(columnWidth, height)) && talent.available;
                const bool hovered = ImGui::IsItemHovered() && talent.available;
                ImGui::PopID();
                ImU32 fill = IM_COL32(0, 0, 0, 102), border = IM_COL32(51, 51, 51, 255);
                if (talent.unlocked) { fill = IM_COL32(201, 162, 39, 38); border = gold; }
                else if (talent.available) { fill = hovered ? IM_COL32(39, 174, 96, 64) : IM_COL32(39, 174, 96, 26); border = IM_COL32(39, 174, 96, 255); }
                draw->AddRectFilled(min, max, fill);
                draw->AddRect(min, max, border);
                draw->AddText(fonts.monoBold12, 13.0f, min + ImVec2(8.0f, 8.0f), IM_COL32(238, 238, 238, 255), talent.name.c_str(), nullptr, textWidth);
                draw->AddText(fonts.mono11, 11.0f, min + ImVec2(8.0f, 26.0f), IM_COL32(170, 170, 170, 255), talent.description.c_str(), nullptr, textWidth);
                float line = 26.0f + descSize.y + 6.0f;
                if (hasRequirement) {
                    draw->AddText(fonts.mono11, 10.0f, min + ImVec2(8.0f, line), IM_COL32(136, 136, 136, 255), ("Requiere: " + nameOf(talent.requirement)).c_str(), nullptr, textWidth);
                    line += 14.0f;
                }
                char cost[32];
                std::snprintf(cost, sizeof(cost), "Costo: %d", talent.cost);
                draw->AddText(fonts.mono11, 11.0f, min + ImVec2(8.0f, line), IM_COL32(255, 209, 102, 255), cost);
                SignUI::DrawIcon(draw, Icon::Star, min + ImVec2(8.0f + fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, cost).x + 10.0f, line + 6.0f), 11.0f);
                if (talent.unlocked) draw->AddText(fonts.monoBold12, 11.0f, ImVec2(max.x - 76.0f, min.y + 9.0f), gold, "APRENDIDO");
                if (clicked) m_TalentUnlockRequest = talent.id;
                y += height + 8.0f;
            }
        }
        const char* hint = "Haz clic en un talento disponible para desbloquearlo. Pulsa T o ESC para cerrar.";
        const float hintWidth = fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, hint).x;
        draw->AddText(fonts.mono11, 11.0f, ImVec2((window.min.x + window.max.x - hintWidth) * 0.5f, window.max.y - 26.0f), IM_COL32(102, 102, 102, 255), hint);
        if (close) TogglePause();
    }
    ImGui::End();
}

void UIManager::RenderDealerWindow(const std::vector<DealerOption>& options, float money) {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    SignUI::DrawBackdrop(0.55f);
    const ImU32 purple = IM_COL32(155, 89, 182, 255);
    const DarkWindow window = BeginDarkWindow("##dealerOscuro", 520.0f, 150.0f + static_cast<float>(options.size()) * 74.0f, purple, IM_COL32(155, 89, 182, 255));
    if (window.open) {
        ImDrawList* draw = ImGui::GetWindowDrawList();
        char moneyText[48];
        std::snprintf(moneyText, sizeof(moneyText), "Tu dinero: $ %.0f", money);
        const bool close = DarkHeader(window, Icon::Pill, "Rincón del Dealer", IM_COL32(215, 131, 255, 255), moneyText, IM_COL32(46, 204, 113, 255));
        const float left = window.min.x + 16.0f;
        const float width = window.max.x - window.min.x - 32.0f;
        float y = window.min.y + 16.0f + 36.0f + 14.0f;
        for (const DealerOption& option : options) {
            const ImVec2 min(left, y), max(left + width, y + 64.0f);
            draw->AddRectFilled(min, max, IM_COL32(40, 20, 50, 102));
            draw->AddRect(min, max, IM_COL32(74, 40, 88, 255));
            draw->AddText(fonts.monoBold14, 14.0f, min + ImVec2(10.0f, 10.0f), IM_COL32(245, 230, 255, 255), option.name.c_str());
            const char* note = !option.affordable ? "No tienes dinero suficiente." : !option.canCarry ? "No cabe en el costal." : "Efectos sobre vicio y ánimo.";
            draw->AddText(fonts.mono11, 11.0f, min + ImVec2(10.0f, 33.0f), IM_COL32(188, 160, 203, 255), note);
            char price[32];
            std::snprintf(price, sizeof(price), "$ %d", option.price);
            const float priceWidth = fonts.monoBold12->CalcTextSizeA(13.0f, FLT_MAX, 0.0f, price).x;
            const bool enabled = option.affordable && option.canCarry;
            ImGui::SetCursorScreenPos(ImVec2(max.x - 10.0f - 96.0f, min.y + 19.0f));
            if (DarkButton(option.id.c_str(), enabled ? "Comprar" : (option.affordable ? "Lleno" : "Sin Dinero"), ImVec2(96.0f, 26.0f), IM_COL32(142, 68, 173, 255), enabled)) m_DealerPurchaseRequest = option.id;
            draw->AddText(fonts.monoBold12, 13.0f, ImVec2(max.x - 10.0f - 96.0f - 12.0f - priceWidth, min.y + 25.0f), IM_COL32(255, 209, 102, 255), price);
            y += 74.0f;
        }
        const char* hints[2] = {"De noche puedes vender sustancias aquí (1.8x precio base).", "Pulsa Q o ESC para cerrar."};
        for (int line = 0; line < 2; ++line) {
            const float hintWidth = fonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, hints[line]).x;
            draw->AddText(fonts.mono11, 11.0f, ImVec2((window.min.x + window.max.x - hintWidth) * 0.5f, window.max.y - 44.0f + static_cast<float>(line) * 15.0f), IM_COL32(136, 136, 119, 255), hints[line]);
        }
        if (close) TogglePause();
    }
    ImGui::End();
}

} // namespace Bazuko
