#define IMGUI_DEFINE_MATH_OPERATORS
#include "UIManager.hpp"
#include "Carton.hpp"
#include "SignStyle.hpp"
#include "../core/Input.hpp"
#include <algorithm>
#include <cstdio>
#include <string>

namespace Bazuko {

namespace {

std::string Thousands(int value) {   // punto de miles: 15.000
    std::string digits = std::to_string(value), out;
    for (size_t i = 0; i < digits.size(); ++i) {
        if (i > 0 && (digits.size() - i) % 3 == 0) out += '.';
        out += digits[i];
    }
    return out;
}

std::string Number(float value) {
    char text[32];
    std::snprintf(text, sizeof(text), "%.1f", value);
    for (char* c = text; *c; ++c)
        if (*c == '.') *c = ',';
    return text;
}

} // namespace

// Costal de carton y marcador (docs/identidad-visual.md del original): cuadricula de 5 x 4 trazada a mano, ficha del objeto con cintas y acceso rapido 1 a 5.
void UIManager::RenderCostal(const std::vector<InventoryOption>& items, float weight, float capacity) {
    namespace C = Carton;
    SignUI::DrawBackdrop(0.45f);
    const ImVec2 display = ImGui::GetIO().DisplaySize;
    const float width = std::min(display.x - 24.0f, 1040.0f), height = std::min(display.y - 24.0f, 660.0f);
    ImGui::SetNextWindowSize(ImVec2(width, height), ImGuiCond_Always);
    ImGui::SetNextWindowPos(ImVec2(display.x * 0.5f, display.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));
    const bool open = ImGui::Begin("##costalCarton", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                                                  ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar);
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    if (!open) { ImGui::End(); return; }
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 winMin = ImGui::GetWindowPos(), winMax = winMin + ImVec2(width, height);
    C::Panel(draw, winMin, winMax, 11u, 9.0f);
    const float pad = 26.0f;
    const size_t count = items.size();

    // cabecera: titulo, peso y masa rayada
    C::Text(draw, true, 40, winMin + ImVec2(pad, 14.0f), C::kMarcador, "EL COSTAL");
    char weightText[64];
    std::snprintf(weightText, sizeof(weightText), "%s DE %.0f KG", Number(weight).c_str(), capacity);
    const float titleWidth = C::TextWidth(true, 40, "EL COSTAL");
    const float weightWidth = C::TextWidth(true, 18, weightText);
    C::Text(draw, true, 18, winMin + ImVec2(pad + titleWidth + 18.0f, 34.0f), C::kMarcador, weightText);
    C::Hatch(draw, winMin + ImVec2(pad + titleWidth + 30.0f + weightWidth, 36.0f), winMin + ImVec2(pad + titleWidth + 150.0f + weightWidth, 56.0f), weight / std::max(1.0f, capacity));
    bool close = false;
    ImGui::SetCursorScreenPos(ImVec2(winMax.x - pad - 100.0f, winMin.y + 16.0f));
    if (C::Tape("cerrarCostal", "Cerrar", ImVec2(100.0f, 40.0f), false, true, "I", 16)) close = true;
    C::HandLine(draw, winMin + ImVec2(pad, 70.0f), ImVec2(winMax.x - pad, winMin.y + 70.0f), 5u, 2.5f);

    constexpr int columns = 5;
    const float detailWidth = 300.0f;
    const float gridLeft = winMin.x + pad, gridTop = winMin.y + 84.0f;
    const float gridWidth = width - pad * 2.0f - detailWidth - 24.0f;
    const float cellW = gridWidth / columns;
    const float footerHeight = 76.0f;
    const float cellH = std::min(cellW * 0.82f, (winMax.y - gridTop - footerHeight - 8.0f) / 4.0f);

    // teclado: flechas o WASD mueven, Enter usa, X tira (Mayus: todo), R ordena, 1-5 asignan el acceso rapido, Tab o I cierran
    if (count > 0) {
        m_InventorySelected = std::min(m_InventorySelected, count - 1);
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

    // rejilla trazada con marcador: lineas un poco torcidas, nunca iguales
    for (int line = 1; line < columns; ++line)
        C::HandLine(draw, ImVec2(gridLeft + cellW * static_cast<float>(line), gridTop), ImVec2(gridLeft + cellW * static_cast<float>(line), gridTop + cellH * 4.0f), 30u + static_cast<unsigned int>(line), 2.2f);
    for (int line = 1; line < 4; ++line)
        C::HandLine(draw, ImVec2(gridLeft, gridTop + cellH * static_cast<float>(line)), ImVec2(gridLeft + gridWidth, gridTop + cellH * static_cast<float>(line)), 50u + static_cast<unsigned int>(line), 2.2f);
    C::HandRect(draw, ImVec2(gridLeft, gridTop), ImVec2(gridLeft + gridWidth, gridTop + cellH * 4.0f), 70u, C::kMarcador, 2.4f);
    for (size_t index = 0; index < std::min<size_t>(count, 20); ++index) {
        const ImVec2 min(gridLeft + static_cast<float>(index % columns) * cellW, gridTop + static_cast<float>(index / columns) * cellH);
        const ImVec2 max(min.x + cellW, min.y + cellH);
        ImGui::SetCursorScreenPos(min);
        ImGui::PushID(static_cast<int>(index));
        const bool clicked = ImGui::InvisibleButton("##casillaCarton", ImVec2(cellW, cellH));
        const bool hovered = ImGui::IsItemHovered();
        ImGui::PopID();
        if (clicked) m_InventorySelected = index;
        const InventoryOption& entry = items[index];
        if (hovered && ImGui::IsMouseDoubleClicked(0) && entry.usable) m_InventoryUseRequest = entry.itemIndex;
        const ImVec2 center((min.x + max.x) * 0.5f, min.y + cellH * 0.42f);
        if (!C::DrawGlyph(draw, C::ItemGlyph(entry.id), center, std::min(cellH * 0.46f, 52.0f), C::kMarcador))
            DrawItemIcon(draw, center, cellH * 0.22f, entry.id, entry.name, C::kMarcador);
        C::TextCentered(draw, false, 16, ImVec2(center.x, min.y + cellH * 0.8f), C::kMarcador, entry.name.c_str());
        if (entry.quantity > 1) {
            char amount[16];
            std::snprintf(amount, sizeof(amount), "×%d", entry.quantity);
            C::Text(draw, true, 18, ImVec2(max.x - C::TextWidth(true, 18, amount) - 8.0f, min.y + 4.0f), C::kMarcador, amount);
        }
        if (entry.hotbarSlot >= 0) {
            char key[4];
            std::snprintf(key, sizeof(key), "%d", entry.hotbarSlot + 1);
            C::Key(draw, min + ImVec2(7.0f, 6.0f), key, 13);
        }
        if (index == m_InventorySelected) C::HandCircle(draw, ImVec2(center.x, min.y + cellH * 0.5f), cellW * 0.44f, cellH * 0.45f, 90u + static_cast<unsigned int>(index), C::kRojo, 3.2f);
        else if (hovered) C::HandCircle(draw, ImVec2(center.x, min.y + cellH * 0.5f), cellW * 0.42f, cellH * 0.43f, 90u + static_cast<unsigned int>(index), IM_COL32(20, 17, 12, 90), 2.0f);
    }
    if (count == 0) C::TextCentered(draw, false, 20, ImVec2(gridLeft + gridWidth * 0.5f, gridTop + cellH * 1.5f), C::kMarcador, "El costal está vacío. Rebusca en las bolsas.");

    // pie de la rejilla: casillas, Ordenar y ayuda
    const float footerTop = gridTop + cellH * 4.0f + 14.0f;
    char slotsText[48];
    std::snprintf(slotsText, sizeof(slotsText), "%zu de 20 casillas", count);
    C::Text(draw, false, 16, ImVec2(gridLeft, footerTop + 8.0f), C::kMarcador, slotsText);
    ImGui::SetCursorScreenPos(ImVec2(gridLeft + gridWidth - 150.0f, footerTop));
    if (C::Tape("ordenarCostal", "Ordenar", ImVec2(150.0f, 40.0f), false, true, "R", 17)) m_InventorySortRequest = true;
    C::Text(draw, false, 14, ImVec2(gridLeft, footerTop + 46.0f), C::kMarcador, "I, Tab o Esc cierran. Flechas o WASD mueven. Mayús + X tira todo. 1 a 5: acceso rápido.", gridWidth);

    // ficha del objeto elegido
    const ImVec2 detailMin(winMax.x - pad - detailWidth, gridTop), detailMax(winMax.x - pad, winMax.y - pad);
    C::HandLine(draw, ImVec2(detailMin.x - 12.0f, gridTop), ImVec2(detailMin.x - 12.0f, detailMax.y), 120u, 2.4f);
    if (count > 0) {
        const InventoryOption& chosen = items[m_InventorySelected];
        if (!C::DrawGlyph(draw, C::ItemGlyph(chosen.id), detailMin + ImVec2(40.0f, 42.0f), 64.0f, C::kMarcador))
            DrawItemIcon(draw, detailMin + ImVec2(40.0f, 42.0f), 30.0f, chosen.id, chosen.name, C::kMarcador);
        char amount[16];
        std::snprintf(amount, sizeof(amount), "×%d", chosen.quantity);
        C::Text(draw, true, 22, detailMin + ImVec2(86.0f, 58.0f), C::kMarcador, amount);
        float y = detailMin.y + 92.0f;
        const std::string title = SignUI::Upper(chosen.name);
        C::Text(draw, true, 32, ImVec2(detailMin.x, y), C::kMarcador, title.c_str(), detailWidth);
        y += C::TextHeight(true, 32, title.c_str(), detailWidth) + 4.0f;
        const auto paragraph = [&](bool bold, int px, const std::string& text) {
            if (text.empty()) return;
            C::Text(draw, bold, px, ImVec2(detailMin.x, y), C::kMarcador, text.c_str(), detailWidth);
            y += C::TextHeight(bold, px, text.c_str(), detailWidth) + 6.0f;
        };
        paragraph(true, 17, chosen.effects);
        paragraph(false, 15, chosen.description);
        char meta[96];
        if (chosen.value > 0) std::snprintf(meta, sizeof(meta), "%s kg, $ %s, en total $ %s", Number(chosen.weight).c_str(), Thousands(chosen.value).c_str(), Thousands(chosen.value * chosen.quantity).c_str());
        else std::snprintf(meta, sizeof(meta), "%s kg, en total %s kg", Number(chosen.weight).c_str(), Number(chosen.weight * static_cast<float>(chosen.quantity)).c_str());
        paragraph(false, 15, meta);
        y += 4.0f;
        ImGui::SetCursorScreenPos(ImVec2(detailMin.x, y));
        const bool weapon = chosen.description.find("sacar o guardar") != std::string::npos;
        if (C::Tape("usarCostal", weapon ? "Sacar" : "Usar", ImVec2(170.0f, 44.0f), true, chosen.usable, chosen.usable ? "Enter" : nullptr, 19)) m_InventoryUseRequest = chosen.itemIndex;
        ImGui::SetCursorScreenPos(ImVec2(detailMin.x, y + 54.0f));
        if (C::Tape("tirar1Costal", "Tirar 1", ImVec2(116.0f, 38.0f), false, true, "X", 16)) { m_InventoryDropRequest = chosen.itemIndex; m_InventoryDropAll = false; }
        ImGui::SetCursorScreenPos(ImVec2(detailMin.x + 126.0f, y + 54.0f));
        if (C::Tape("tirarTodoCostal", "Tirar todo", ImVec2(150.0f, 38.0f), false, true, nullptr, 16)) { m_InventoryDropRequest = chosen.itemIndex; m_InventoryDropAll = true; }
    }
    // acceso rapido: cinco numeros, el del objeto elegido va encerrado
    const float quickTop = detailMax.y - 56.0f;
    C::Text(draw, true, 16, ImVec2(detailMin.x, quickTop - 26.0f), C::kMarcador, "ACCESO RÁPIDO");
    for (int slot = 0; slot < 5; ++slot) {
        const ImVec2 center(detailMin.x + 24.0f + static_cast<float>(slot) * 56.0f, quickTop + 14.0f);
        ImGui::SetCursorScreenPos(center - ImVec2(22.0f, 22.0f));
        ImGui::PushID(200 + slot);
        const bool clicked = ImGui::InvisibleButton("##accesoRapido", ImVec2(44.0f, 44.0f));
        ImGui::PopID();
        if (clicked && count > 0 && items[m_InventorySelected].usable) { m_HotbarAssignSlot = slot; m_HotbarAssignItem = items[m_InventorySelected].itemIndex; }
        char label[4];
        std::snprintf(label, sizeof(label), "%d", slot + 1);
        C::TextCentered(draw, true, 24, center, C::kMarcador, label);
        if (count > 0 && items[m_InventorySelected].hotbarSlot == slot) C::HandCircle(draw, center, 22.0f, 22.0f, 300u + static_cast<unsigned int>(slot), C::kRojo, 3.0f);
        if (slot < 4) C::HandLine(draw, center + ImVec2(28.0f, -16.0f), center + ImVec2(28.0f, 16.0f), 330u + static_cast<unsigned int>(slot), 2.0f);
    }
    if (close) TogglePause();
    ImGui::End();
}

// Mesa de crafteo de carton y marcador: recetas en rejilla de 3 columnas y el banco con los materiales de la elegida.
void UIManager::RenderMesaCarton(const std::vector<CraftingOption>& craftingOptions, float weight, float capacity) {
    namespace C = Carton;
    SignUI::DrawBackdrop(0.45f);
    const ImVec2 display = ImGui::GetIO().DisplaySize;
    const float width = std::min(display.x - 24.0f, 960.0f), height = std::min(display.y - 24.0f, 620.0f);
    ImGui::SetNextWindowSize(ImVec2(width, height), ImGuiCond_Always);
    ImGui::SetNextWindowPos(ImVec2(display.x * 0.5f, display.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));
    const bool open = ImGui::Begin("##mesaCarton", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                                               ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar);
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    if (!open) { ImGui::End(); return; }
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 winMin = ImGui::GetWindowPos(), winMax = winMin + ImVec2(width, height);
    C::Panel(draw, winMin, winMax, 23u, 9.0f);
    const float pad = 26.0f;
    C::DrawGlyph(draw, C::Glyph("mesa"), winMin + ImVec2(pad + 22.0f, 40.0f), 44.0f, C::kMarcador);
    C::Text(draw, true, 40, winMin + ImVec2(pad + 54.0f, 14.0f), C::kMarcador, "MESA DE CRAFTEO");
    char load[48];
    std::snprintf(load, sizeof(load), "%s DE %.0f KG", Number(weight).c_str(), capacity);
    C::Text(draw, true, 18, winMin + ImVec2(pad + 54.0f + C::TextWidth(true, 40, "MESA DE CRAFTEO") + 18.0f, 34.0f), C::kMarcador, load);
    bool close = false;
    ImGui::SetCursorScreenPos(ImVec2(winMax.x - pad - 100.0f, winMin.y + 16.0f));
    if (C::Tape("cerrarMesa", "Cerrar", ImVec2(100.0f, 40.0f), false, true, "C", 16)) close = true;
    C::HandLine(draw, winMin + ImVec2(pad, 70.0f), ImVec2(winMax.x - pad, winMin.y + 70.0f), 7u, 2.5f);

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
    const float benchWidth = 330.0f;
    const float gridLeft = winMin.x + pad, gridTop = winMin.y + 84.0f;
    const float gridWidth = width - pad * 2.0f - benchWidth - 26.0f;
    constexpr int columns = 3;
    const float cellW = gridWidth / columns;
    const int rowCount = static_cast<int>((craftingOptions.size() + columns - 1) / columns);
    const float cellH = std::min(150.0f, (winMax.y - gridTop - 70.0f) / static_cast<float>(std::max(rowCount, 1)));
    for (int line = 1; line < columns; ++line)
        C::HandLine(draw, ImVec2(gridLeft + cellW * static_cast<float>(line), gridTop), ImVec2(gridLeft + cellW * static_cast<float>(line), gridTop + cellH * static_cast<float>(rowCount)), 40u + static_cast<unsigned int>(line), 2.2f);
    for (int line = 1; line < rowCount; ++line)
        C::HandLine(draw, ImVec2(gridLeft, gridTop + cellH * static_cast<float>(line)), ImVec2(gridLeft + gridWidth, gridTop + cellH * static_cast<float>(line)), 60u + static_cast<unsigned int>(line), 2.2f);
    C::HandRect(draw, ImVec2(gridLeft, gridTop), ImVec2(gridLeft + gridWidth, gridTop + cellH * static_cast<float>(rowCount)), 80u, C::kMarcador, 2.4f);
    int cell = 0;
    for (const auto& option : craftingOptions) {
        const ImVec2 min(gridLeft + static_cast<float>(cell % columns) * cellW, gridTop + static_cast<float>(cell / columns) * cellH);
        const ImVec2 max(min.x + cellW, min.y + cellH);
        ImGui::SetCursorScreenPos(min);
        ImGui::PushID(option.id.c_str());
        const bool clicked = ImGui::InvisibleButton("##recetaCarton", ImVec2(cellW, cellH));
        const bool hovered = ImGui::IsItemHovered();
        ImGui::PopID();
        if (clicked) m_CraftSelected = option.id;
        const bool ready = option.craftable && option.fits;
        const ImU32 ink = option.craftable ? C::kMarcador : IM_COL32(0x14, 0x11, 0x0C, 130);
        const ImVec2 center((min.x + max.x) * 0.5f, min.y + cellH * 0.40f);
        if (!C::DrawGlyph(draw, C::ItemGlyph(option.id), center, std::min(cellH * 0.42f, 50.0f), ink)) DrawItemIcon(draw, center, cellH * 0.2f, option.id, option.name, ink);
        C::TextCentered(draw, false, 16, ImVec2(center.x, min.y + cellH * 0.80f), ink, option.name.c_str());
        char quantity[16];
        std::snprintf(quantity, sizeof(quantity), "×%d", option.quantity);
        C::Text(draw, true, 17, ImVec2(max.x - C::TextWidth(true, 17, quantity) - 8.0f, min.y + 4.0f), ink, quantity);
        if (ready) C::DrawGlyph(draw, C::Glyph("chulo"), min + ImVec2(20.0f, 20.0f), 22.0f, C::kMarcador);
        if (option.id == m_CraftSelected) C::HandCircle(draw, ImVec2(center.x, min.y + cellH * 0.5f), cellW * 0.44f, cellH * 0.45f, 400u + static_cast<unsigned int>(cell), C::kRojo, 3.2f);
        else if (hovered) C::HandCircle(draw, ImVec2(center.x, min.y + cellH * 0.5f), cellW * 0.42f, cellH * 0.43f, 400u + static_cast<unsigned int>(cell), IM_COL32(20, 17, 12, 90), 2.0f);
        ++cell;
    }

    // banco de trabajo: la receta elegida y sus materiales
    const ImVec2 benchMin(winMax.x - pad - benchWidth, gridTop), benchMax(winMax.x - pad, winMax.y - pad);
    C::HandLine(draw, ImVec2(benchMin.x - 13.0f, gridTop), ImVec2(benchMin.x - 13.0f, benchMax.y), 130u, 2.4f);
    if (const CraftingOption* option = optionById(m_CraftSelected)) {
        const bool ready = option->craftable && option->fits;
        if (!C::DrawGlyph(draw, C::ItemGlyph(option->id), benchMin + ImVec2(36.0f, 38.0f), 56.0f, C::kMarcador)) DrawItemIcon(draw, benchMin + ImVec2(36.0f, 38.0f), 26.0f, option->id, option->name, C::kMarcador);
        char yield[16];
        std::snprintf(yield, sizeof(yield), "×%d", option->quantity);
        C::Text(draw, true, 22, benchMin + ImVec2(76.0f, 48.0f), C::kMarcador, yield);
        float y = benchMin.y + 80.0f;
        const std::string title = SignUI::Upper(option->name);
        C::Text(draw, true, 30, ImVec2(benchMin.x, y), C::kMarcador, title.c_str(), benchWidth);
        y += C::TextHeight(true, 30, title.c_str(), benchWidth) + 4.0f;
        C::Text(draw, false, 15, ImVec2(benchMin.x, y), C::kMarcador, option->effect.c_str(), benchWidth);
        y += C::TextHeight(false, 15, option->effect.c_str(), benchWidth) + 10.0f;
        C::Text(draw, true, 16, ImVec2(benchMin.x, y), C::kMarcador, "MATERIALES");
        C::HandLine(draw, ImVec2(benchMin.x, y + 24.0f), ImVec2(benchMax.x, y + 24.0f), 140u, 1.8f);
        y += 32.0f;
        int missing = 0;
        for (const auto& material : option->materials) {
            const bool enough = material.have >= material.need;
            missing += std::max(0, material.need - material.have);
            if (!C::DrawGlyph(draw, C::ItemGlyph(material.id), ImVec2(benchMin.x + 16.0f, y + 15.0f), 26.0f, C::kMarcador)) DrawItemIcon(draw, ImVec2(benchMin.x + 16.0f, y + 15.0f), 12.0f, material.id, material.name, C::kMarcador);
            C::Text(draw, false, 16, ImVec2(benchMin.x + 40.0f, y + 4.0f), C::kMarcador, material.name.c_str(), benchWidth - 130.0f);
            char count[24];
            std::snprintf(count, sizeof(count), "%d/%d", std::min(material.have, material.need), material.need);
            C::Text(draw, true, 18, ImVec2(benchMax.x - 76.0f, y + 3.0f), C::kMarcador, count);
            if (enough) {
                C::DrawGlyph(draw, C::Glyph("chulo"), ImVec2(benchMax.x - 10.0f, y + 15.0f), 22.0f, C::kMarcador);
            } else {
                C::HandLine(draw, ImVec2(benchMax.x - 18.0f, y + 6.0f), ImVec2(benchMax.x - 2.0f, y + 24.0f), 150u + static_cast<unsigned int>(y), 2.6f, C::kRojo);
                C::HandLine(draw, ImVec2(benchMax.x - 2.0f, y + 6.0f), ImVec2(benchMax.x - 18.0f, y + 24.0f), 160u + static_cast<unsigned int>(y), 2.6f, C::kRojo);
            }
            y += 34.0f;
        }
        const std::string many = "Te faltan " + std::to_string(missing) + " materiales";
        const char* reason = ready ? "Listo para fabricar" : option->craftable ? "No te cabe en el costal" : missing == 1 ? "Te falta 1 material" : many.c_str();
        C::Text(draw, true, 17, ImVec2(benchMin.x, benchMax.y - 96.0f), ready ? C::kMarcador : C::kRojo, reason);
        ImGui::SetCursorScreenPos(ImVec2(benchMin.x, benchMax.y - 56.0f));
        if (C::Tape("fabricarMesa", "Fabricar", ImVec2(benchWidth - 6.0f, 50.0f), true, ready, ready ? "Enter" : nullptr, 22)) { m_CraftRequest = option->id; m_CraftFlash = 0.6f; }
        if (ready && ImGui::IsKeyPressed(ImGuiKey_Enter, false)) { m_CraftRequest = option->id; m_CraftFlash = 0.6f; }
    }
    if (close) m_CraftMenuOpen = false;
    ImGui::End();
}

} // namespace Bazuko

namespace Bazuko {

// El jibaro (docs/identidad-visual.md del original): comprar tinto, pegante, pastilla y basuco; vender de noche lo que lleves.
void UIManager::RenderJibaro(const std::vector<DealerOption>& options, float money) {
    namespace C = Carton;
    SignUI::DrawBackdrop(0.5f);
    const ImVec2 display = ImGui::GetIO().DisplaySize;
    const float width = std::min(display.x - 24.0f, 700.0f);
    const float rowHeight = 76.0f;
    const float sellRows = m_DealerSales.empty() ? 1.0f : static_cast<float>(m_DealerSales.size());
    const float height = std::min(display.y - 24.0f, 88.0f + 40.0f + static_cast<float>(options.size()) * rowHeight + 46.0f + (m_DealerSales.empty() ? 34.0f : sellRows * 56.0f) + 70.0f);
    ImGui::SetNextWindowSize(ImVec2(width, height), ImGuiCond_Always);
    ImGui::SetNextWindowPos(ImVec2(display.x * 0.5f, display.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));
    const bool open = ImGui::Begin("##jibaroCarton", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                                                  ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar);
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    if (!open) { ImGui::End(); return; }
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 min = ImGui::GetWindowPos(), max = min + ImVec2(width, height);
    C::Panel(draw, min, max, 21u, 8.0f);
    const float pad = 24.0f;
    C::Text(draw, true, 38, min + ImVec2(pad, 12.0f), C::kMarcador, "El jíbaro");
    char cash[48];
    std::snprintf(cash, sizeof(cash), "Plata: $ %s", Thousands(static_cast<int>(money)).c_str());
    C::Text(draw, true, 18, min + ImVec2(pad + C::TextWidth(true, 38, "El jíbaro") + 16.0f, 30.0f), C::kMarcador, cash);
    // cerrar: caja con la equis y la tecla
    const ImVec2 closeMin(max.x - 96.0f, min.y + 14.0f), closeSize(78.0f, 40.0f);
    ImGui::SetCursorScreenPos(closeMin);
    if (ImGui::InvisibleButton("##cerrarJibaro", closeSize)) TogglePause();
    draw->AddRectFilled(closeMin, closeMin + closeSize, ImGui::IsItemHovered() ? IM_COL32(0xF2, 0xE6, 0xC4, 255) : C::kCinta);
    draw->AddRect(closeMin, closeMin + closeSize, C::kMarcador, 0.0f, 0, 2.0f);
    C::Text(draw, true, 30, closeMin + ImVec2(8.0f, 1.0f), C::kMarcador, "×");
    draw->AddRectFilled(closeMin + ImVec2(34.0f, 9.0f), closeMin + ImVec2(70.0f, 31.0f), C::kMarcador);
    C::Text(draw, true, 15, closeMin + ImVec2(40.0f, 11.0f), C::kCinta, "Esc");
    C::HandLine(draw, ImVec2(min.x + pad, min.y + 66.0f), ImVec2(max.x - pad, min.y + 66.0f), 2101u, 2.5f);

    const auto tapeButton = [&](const char* id, const char* label, ImVec2 at, ImVec2 size, bool enabled) {
        ImGui::SetCursorScreenPos(at);
        const bool pressed = ImGui::InvisibleButton(id, size) && enabled;
        draw->AddRect(at, at + size, C::kMarcador, 0.0f, 0, 2.0f);
        if (enabled && ImGui::IsItemHovered()) draw->AddRectFilled(at, at + size, IM_COL32(0xF2, 0xE6, 0xC4, 255));
        const float textWidth = C::TextWidth(true, 17, label);
        C::Text(draw, true, 17, at + ImVec2((size.x - textWidth) * 0.5f, 10.0f), C::kMarcador, label);
        if (!enabled) draw->AddLine(at + ImVec2(8.0f, size.y * 0.5f + 1.0f), at + ImVec2(size.x - 8.0f, size.y * 0.5f - 3.0f), C::kMarcador, 2.0f);   // tachado: no se puede
        return pressed;
    };

    float y = min.y + 78.0f;
    C::Text(draw, true, 26, ImVec2(min.x + pad, y), C::kMarcador, "Comprar");
    y += 38.0f;
    int row = 0;
    for (const DealerOption& option : options) {
        const bool enabled = option.affordable && option.canCarry;
        C::Text(draw, true, 20, ImVec2(min.x + pad, y), C::kMarcador, option.name.c_str());
        std::string detail = option.detail;
        if (!option.affordable) detail += ". No me alcanza";
        else if (!option.canCarry) detail += ". No cabe en el costal";
        C::Text(draw, false, 15, ImVec2(min.x + pad, y + 25.0f), C::kMarcador, detail.c_str(), width - 280.0f);
        char price[32];
        std::snprintf(price, sizeof(price), "$ %s", Thousands(option.price).c_str());
        C::Text(draw, true, 21, ImVec2(max.x - pad - 118.0f - 12.0f - C::TextWidth(true, 21, price), y + 8.0f), C::kMarcador, price);
        ImGui::PushID(row++);
        if (tapeButton("##comprar", "Comprar", ImVec2(max.x - pad - 118.0f, y + 4.0f), ImVec2(118.0f, 42.0f), enabled)) m_DealerPurchaseRequest = option.id;
        ImGui::PopID();
        y += rowHeight - 6.0f;
        C::HandLine(draw, ImVec2(min.x + pad, y), ImVec2(max.x - pad, y), 2110u + static_cast<unsigned int>(row), 1.8f);
        y += 6.0f;
    }

    y += 8.0f;
    C::Text(draw, true, 26, ImVec2(min.x + pad, y), C::kMarcador, "Vender");
    y += 38.0f;
    if (m_DealerSales.empty()) {
        C::Text(draw, false, 17, ImVec2(min.x + pad, y), C::kMarcador, m_DealerNight ? "No llevo nada que venderle." : "Solo compra de noche.");
        y += 34.0f;
    } else {
        int sellRow = 0;
        for (const DealerSale& sale : m_DealerSales) {
            char line[96];
            std::snprintf(line, sizeof(line), "%s ×%d", sale.name.c_str(), sale.quantity);
            C::Text(draw, true, 19, ImVec2(min.x + pad, y + 8.0f), C::kMarcador, line);
            char price[48];
            std::snprintf(price, sizeof(price), "$ %s c/u", Thousands(sale.unitPrice).c_str());
            C::Text(draw, true, 18, ImVec2(max.x - pad - 118.0f - 12.0f - C::TextWidth(true, 18, price), y + 9.0f), C::kMarcador, price);
            ImGui::PushID(1000 + sellRow++);
            if (tapeButton("##vender", "Vender", ImVec2(max.x - pad - 118.0f, y + 2.0f), ImVec2(118.0f, 40.0f), m_DealerNight)) m_DealerSellRequest = sale.id;
            ImGui::PopID();
            y += 56.0f;
        }
    }
    C::HandLine(draw, ImVec2(min.x + pad, y), ImVec2(max.x - pad, y), 2190u, 1.8f);
    C::Text(draw, false, 14, ImVec2(min.x + pad, y + 8.0f), C::kMarcador,
            "De noche paga 1,8× el valor de lo que se le traiga, pero en cada venta hay un 15 % de que caiga la policía y se lleve la mercancía.", width - pad * 2.0f);
    ImGui::End();
}

} // namespace Bazuko

namespace Bazuko {

// Mi cambuche (docs/identidad-visual.md del original): vista previa del refugio terminado, las seis piezas con lo que piden y dormir hasta las 06:00.
// El recuadro negro de la vista previa se deja vacio: main.cpp dibuja ahi el modelo (segundo renderizador) despues de pintar la interfaz.
void UIManager::RenderCambucheCarton(const std::vector<CambuchePieceOption>& pieces, bool hasBase, bool isNight) {
    namespace C = Carton;
    SignUI::DrawBackdrop(0.5f);
    const ImVec2 display = ImGui::GetIO().DisplaySize;
    const float width = std::min(display.x - 24.0f, 700.0f);
    const float previewHeight = std::clamp(display.y * 0.24f, 120.0f, 215.0f);
    const float rowHeight = 62.0f;
    const float height = std::min(display.y - 20.0f, 128.0f + previewHeight + 30.0f + static_cast<float>(pieces.size()) * rowHeight + 86.0f);
    ImGui::SetNextWindowSize(ImVec2(width, height), ImGuiCond_Always);
    ImGui::SetNextWindowPos(ImVec2(display.x * 0.5f, display.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));
    const bool open = ImGui::Begin("##cambucheCarton", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                                                    ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoScrollbar);
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    if (!open) { ImGui::End(); m_CambuchePreviewRect = glm::vec4(0.0f); return; }
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 min = ImGui::GetWindowPos(), max = min + ImVec2(width, height);
    C::Panel(draw, min, max, 31u, 8.0f);
    const float pad = 22.0f;
    C::Text(draw, true, 34, min + ImVec2(pad, 8.0f), C::kMarcador, "Mi cambuche");
    C::Text(draw, false, 16, min + ImVec2(pad, 52.0f), C::kMarcador, "Los materiales salen de la basura de toda la ciudad: hay para todas las mejoras.", width - 150.0f);
    // cerrar
    const ImVec2 closeMin(max.x - 96.0f, min.y + 12.0f), closeSize(78.0f, 40.0f);
    ImGui::SetCursorScreenPos(closeMin);
    bool closeRequested = ImGui::InvisibleButton("##cerrarCambuche", closeSize);
    draw->AddRectFilled(closeMin, closeMin + closeSize, ImGui::IsItemHovered() ? IM_COL32(0xF2, 0xE6, 0xC4, 255) : C::kCinta);
    draw->AddRect(closeMin, closeMin + closeSize, C::kMarcador, 0.0f, 0, 2.0f);
    C::Text(draw, true, 30, closeMin + ImVec2(8.0f, 1.0f), C::kMarcador, "×");
    draw->AddRectFilled(closeMin + ImVec2(34.0f, 9.0f), closeMin + ImVec2(70.0f, 31.0f), C::kMarcador);
    C::Text(draw, true, 15, closeMin + ImVec2(40.0f, 11.0f), C::kCinta, "Esc");
    C::HandLine(draw, ImVec2(min.x + pad, min.y + 96.0f), ImVec2(max.x - pad, min.y + 96.0f), 3101u, 2.5f);

    // vista previa: recuadro negro; el modelo se dibuja encima despues
    const ImVec2 previewMin(min.x + pad, min.y + 106.0f), previewMax(max.x - pad, min.y + 106.0f + previewHeight);
    draw->AddRectFilled(previewMin, previewMax, IM_COL32(0x12, 0x10, 0x0C, 255));
    m_CambuchePreviewRect = glm::vec4(previewMin.x, previewMin.y, previewMax.x - previewMin.x, previewMax.y - previewMin.y);
    C::Text(draw, true, 16, ImVec2(previewMin.x, previewMax.y + 4.0f), C::kMarcador, "Así va a quedar mi cambuche");   // debajo: el modelo se dibuja encima del recuadro

    const auto tapeButton = [&](const char* id, const char* label, ImVec2 at, ImVec2 size, bool enabled) {
        ImGui::SetCursorScreenPos(at);
        const bool pressed = ImGui::InvisibleButton(id, size) && enabled;
        draw->AddRect(at, at + size, C::kMarcador, 0.0f, 0, 2.0f);
        if (enabled && ImGui::IsItemHovered()) draw->AddRectFilled(at, at + size, IM_COL32(0xF2, 0xE6, 0xC4, 255));
        const float textWidth = C::TextWidth(true, 17, label);
        C::Text(draw, true, 17, at + ImVec2((size.x - textWidth) * 0.5f, (size.y - 20.0f) * 0.5f), C::kMarcador, label);
        if (!enabled) draw->AddLine(at + ImVec2(8.0f, size.y * 0.5f + 1.0f), at + ImVec2(size.x - 8.0f, size.y * 0.5f - 3.0f), C::kMarcador, 2.0f);
        return pressed;
    };

    float y = previewMax.y + 30.0f;
    int row = 0;
    for (const CambuchePieceOption& piece : pieces) {
        // dibujo: el cambuche en la pieza armada con su marca; un candado si falta la base
        const ImVec2 iconCenter(min.x + pad + 14.0f, y + 22.0f);
        C::DrawGlyph(draw, C::Glyph(piece.isBuilt ? "chulo" : piece.isLocked ? "candado" : "cambuche"), iconCenter, 22.0f, C::kMarcador);
        C::Text(draw, true, 19, ImVec2(min.x + pad + 40.0f, y), C::kMarcador, piece.name.c_str());
        C::Text(draw, false, 14, ImVec2(min.x + pad + 40.0f, y + 22.0f), C::kMarcador, piece.isBuilt ? "Armado." : piece.desc.c_str(), width - 260.0f);
        if (!piece.isBuilt && !piece.reqText.empty()) {
            const float reqY = y + 38.0f;
            C::Text(draw, false, 13, ImVec2(min.x + pad + 40.0f, reqY), C::kMarcador, piece.reqText.c_str());
            if (!piece.canBuild) draw->AddLine(ImVec2(min.x + pad + 40.0f, reqY + 8.0f), ImVec2(min.x + pad + 40.0f + C::TextWidth(false, 13, piece.reqText.c_str()), reqY + 8.0f), C::kMarcador, 1.6f);   // tachado: todavia no lo tengo
        }
        ImGui::PushID(row);
        if (!piece.isBuilt && tapeButton("##armar", "Armar", ImVec2(max.x - pad - 112.0f, y + 2.0f), ImVec2(112.0f, 40.0f), piece.canBuild && !piece.isLocked)) m_CambucheBuildRequest = piece.id;
        ImGui::PopID();
        y += rowHeight;
        C::HandLine(draw, ImVec2(min.x + pad, y - 6.0f), ImVec2(max.x - pad, y - 6.0f), 3110u + static_cast<unsigned int>(row++), 1.8f);
    }

    // pie: dormir
    const char* sleepNote = !hasBase ? "Sin base no se puede dormir." : !isNight ? "Dormir solo de noche." : "Dormir recupera energía y salud.";
    C::Text(draw, false, 15, ImVec2(min.x + pad, max.y - 52.0f), C::kMarcador, sleepNote);
    const ImVec2 wardrobeSize(176.0f, 44.0f);   // cambiarse de ropa (original: boton "Cambiar ropa" del menu del cambuche)
    if (tapeButton("##ropa", "Cambiar ropa", ImVec2(min.x + pad, max.y - wardrobeSize.y - 14.0f - 30.0f), wardrobeSize, true)) {
        m_WardrobeRequest = true;
        m_CambucheMenuOpen = false;
        Input::SetCursorLocked(true);
    }
    const ImVec2 sleepSize(250.0f, 44.0f);
    if (tapeButton("##dormir", "Dormir hasta las 06:00", ImVec2(max.x - pad - sleepSize.x, max.y - sleepSize.y - 14.0f), sleepSize, hasBase && isNight)) {
        m_SleepRequest = true;
        m_CambucheMenuOpen = false;
        Input::SetCursorLocked(true);
    }
    ImGui::End();
    if (closeRequested) {
        m_CambucheMenuOpen = false;
        m_CambuchePreviewRect = glm::vec4(0.0f);
        Input::SetCursorLocked(true);
    }
}

} // namespace Bazuko
