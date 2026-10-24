#include "CharacterCreatorUI.hpp"
#include <imgui.h>
#include <cstring>
#include <algorithm>

namespace Bazuko {

static bool ChipButton(const char* label, bool selected, const ImVec2& size = ImVec2(0, 0)) {
    if (selected) {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.88f, 0.58f, 0.15f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.95f, 0.65f, 0.22f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.98f, 0.72f, 0.28f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.08f, 0.08f, 0.08f, 1.0f));
    } else {
        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.18f, 0.20f, 0.23f, 0.85f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.28f, 0.32f, 0.38f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.85f, 0.55f, 0.15f, 0.8f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.90f, 0.90f, 0.90f, 1.0f));
    }

    bool clicked = ImGui::Button(label, size);
    ImGui::PopStyleColor(4);
    return clicked;
}

static bool SwatchButton(const char* id, const glm::vec4& color, bool selected, const char* tooltip) {
    ImVec4 col(color.r, color.g, color.b, color.a);
    ImGui::PushID(id);

    if (selected) {
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.98f, 0.75f, 0.20f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 2.5f);
    } else {
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.25f, 0.25f, 0.25f, 0.8f));
        ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 1.0f);
    }

    bool clicked = ImGui::ColorButton("##swatch", col, ImGuiColorEditFlags_NoAlpha | ImGuiColorEditFlags_NoPicker, ImVec2(32, 28));

    if (tooltip && ImGui::IsItemHovered()) {
        ImGui::SetTooltip("%s", tooltip);
    }

    ImGui::PopStyleVar();
    ImGui::PopStyleColor();
    ImGui::PopID();
    return clicked;
}

CharacterCreatorUI::CharacterCreatorUI()
    : m_Rng(std::random_device{}()) {
}

void CharacterCreatorUI::Open(const CharacterLook& currentLook, bool allowCancel) {
    m_TempLook = currentLook;
    NormalizeLook(m_TempLook);
    snprintf(m_NameBuffer, sizeof(m_NameBuffer), "%s", m_TempLook.nombre.c_str());
    m_AllowCancel = allowCancel;
    m_IsOpen = true;
    m_ActiveTab = 0;
}

void CharacterCreatorUI::Close() {
    m_IsOpen = false;
}

bool CharacterCreatorUI::Render(CharacterPreview& preview, CharacterLook& outLook, bool& outAppearanceChanged) {
    if (!m_IsOpen) return false;

    outAppearanceChanged = false;
    bool confirmed = false;

    ImGuiIO& io = ImGui::GetIO();
    ImVec2 center(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f);
    ImGui::SetNextWindowPos(center, ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(1040, 630), ImGuiCond_Appearing);

    ImGuiWindowFlags windowFlags = ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove;

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16, 16));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(10, 10));

    if (ImGui::Begin("CREA TU PERSONAJE - BAZUKO", m_AllowCancel ? &m_IsOpen : nullptr, windowFlags)) {
        ImGui::TextColored(ImVec4(0.95f, 0.65f, 0.20f, 1.0f), "SOBREVIVIENTE DE BOGOTA");
        ImGui::TextDisabled("Define la identidad, apariencia y origen de tu personaje en la calle.");
        ImGui::Separator();

        ImGui::Columns(2, "CreatorColumns", false);
        ImGui::SetColumnWidth(0, 360.0f);

        // --- COLUMNA IZQUIERDA: VISTA PREVIA 3D ---
        ImVec2 previewSize(340.0f, 440.0f);
        ImTextureID texId = (ImTextureID)(intptr_t)preview.GetTextureID();
        ImGui::InvisibleButton("##CharacterPreview", previewSize);
        ImGui::GetWindowDrawList()->AddImage(
            texId,
            ImGui::GetItemRectMin(),
            ImGui::GetItemRectMax(),
            ImVec2(0, 1),
            ImVec2(1, 0));

        if (ImGui::IsItemHovered()) {
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
        }
        if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)) {
            preview.StopRotation();
            preview.Rotate(ImGui::GetIO().MouseDelta.x * 0.015f);
        }

        ImGui::Spacing();
        if (ImGui::Button("Girar izq.", ImVec2(105, 30))) { preview.SetYawVelocity(-4.5f); }
        ImGui::SameLine();
        if (ImGui::Button("Detener", ImVec2(90, 30))) { preview.StopRotation(); }
        ImGui::SameLine();
        if (ImGui::Button("Girar der.", ImVec2(105, 30))) { preview.SetYawVelocity(4.5f); }

        ImGui::TextDisabled("Arrastra el raton sobre la imagen para rotar 360°.");

        ImGui::NextColumn();

        // --- COLUMNA DERECHA: OPCIONES Y PESTAÑAS ---
        if (ImGui::BeginTabBar("CreatorTabs", ImGuiTabBarFlags_None)) {
            // TAB 1: IDENTIDAD
            if (ImGui::BeginTabItem("Identidad")) {
                m_ActiveTab = 0;
                ImGui::Spacing();

                ImGui::Text("Nombre del Personaje:");
                ImGui::SetNextItemWidth(300.0f);
                if (ImGui::InputText("##NameInput", m_NameBuffer, sizeof(m_NameBuffer))) {
                    m_TempLook.nombre = CleanName(m_NameBuffer);
                }

                ImGui::SameLine();
                if (ImGui::Button("Sugerir Nombre (Azar)")) {
                    std::uniform_int_distribution<size_t> dist(0, NameIdeas.size() - 1);
                    m_TempLook.nombre = NameIdeas[dist(m_Rng)];
                    snprintf(m_NameBuffer, sizeof(m_NameBuffer), "%s", m_TempLook.nombre.c_str());
                }

                ImGui::TextDisabled("Asi te llamaran en la cuadra. Maximo 16 letras.");
                ImGui::Spacing();
                ImGui::Separator();
                ImGui::Spacing();

                ImGui::TextColored(ImVec4(0.95f, 0.75f, 0.20f, 1.0f), "¿Como llegaste a la calle? (Origen):");
                ImGui::Spacing();

                for (const auto& origin : Origins) {
                    bool selected = (m_TempLook.origen == origin.id);
                    ImGui::PushID(origin.id.c_str());

                    if (ChipButton(origin.name.c_str(), selected, ImVec2(130, 32))) {
                        m_TempLook.origen = origin.id;
                    }

                    ImGui::SameLine();
                    ImGui::BeginGroup();
                    ImGui::Text("%s", origin.desc.c_str());
                    ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.45f, 1.0f), "%s", origin.perk.c_str());
                    ImGui::EndGroup();

                    ImGui::Spacing();
                    ImGui::PopID();
                }

                ImGui::EndTabItem();
            }

            // TAB 2: CUERPO
            if (ImGui::BeginTabItem("Cuerpo")) {
                m_ActiveTab = 1;
                ImGui::Spacing();

                // Sexo
                ImGui::Text("Sexo:");
                if (ChipButton("Hombre", m_TempLook.sexo == "hombre", ImVec2(100, 30))) {
                    if (m_TempLook.sexo != "hombre") {
                        m_TempLook.sexo = "hombre";
                        NormalizeLook(m_TempLook);
                        outAppearanceChanged = true;
                    }
                }
                ImGui::SameLine();
                if (ChipButton("Mujer", m_TempLook.sexo == "mujer", ImVec2(100, 30))) {
                    if (m_TempLook.sexo != "mujer") {
                        m_TempLook.sexo = "mujer";
                        NormalizeLook(m_TempLook);
                        outAppearanceChanged = true;
                    }
                }

                ImGui::Spacing();
                ImGui::Separator();
                ImGui::Spacing();

                // Edad
                ImGui::Text("Edad:");
                const char* edades[] = {"joven", "adulto", "mayor"};
                const char* edadesLabels[] = {"Joven", "Adulto", "Mayor"};
                for (int i = 0; i < 3; ++i) {
                    if (i > 0) ImGui::SameLine();
                    if (ChipButton(edadesLabels[i], m_TempLook.edad == edades[i], ImVec2(90, 30))) {
                        if (m_TempLook.edad != edades[i]) {
                            m_TempLook.edad = edades[i];
                            outAppearanceChanged = true;
                        }
                    }
                }

                ImGui::Spacing();
                ImGui::Separator();
                ImGui::Spacing();

                // Tono de piel
                ImGui::Text("Tono de piel:");
                for (size_t i = 0; i < SkinPalettes.size(); ++i) {
                    if (i > 0) ImGui::SameLine();
                    std::string id = "skin_" + std::to_string(i);
                    if (SwatchButton(id.c_str(), SkinPalettes[i], m_TempLook.pielIdx == static_cast<int>(i), SkinColorNames[i].c_str())) {
                        m_TempLook.pielIdx = static_cast<int>(i);
                        outAppearanceChanged = true;
                    }
                }
                ImGui::TextDisabled("Seleccionado: %s", SkinColorNames[m_TempLook.pielIdx].c_str());

                ImGui::EndTabItem();
            }

            // TAB 3: PELO
            if (ImGui::BeginTabItem("Pelo")) {
                m_ActiveTab = 2;
                ImGui::Spacing();

                ImGui::Text("Corte de pelo:");
                int colCount = 0;
                for (const auto& hair : HairOptions) {
                    if (colCount > 0 && colCount % 4 != 0) ImGui::SameLine();
                    bool selected = (m_TempLook.pelo == hair.id);
                    if (ChipButton(hair.label.c_str(), selected, ImVec2(120, 30))) {
                        m_TempLook.pelo = hair.id;
                        outAppearanceChanged = true;
                    }
                    colCount++;
                }

                ImGui::Spacing();
                ImGui::Separator();
                ImGui::Spacing();

                ImGui::Text("Color de pelo y vello facial:");
                for (size_t i = 0; i < HairPalettes.size(); ++i) {
                    if (i > 0) ImGui::SameLine();
                    std::string id = "hair_" + std::to_string(i);
                    if (SwatchButton(id.c_str(), HairPalettes[i], m_TempLook.peloColorIdx == static_cast<int>(i), HairColorNames[i].c_str())) {
                        m_TempLook.peloColorIdx = static_cast<int>(i);
                        outAppearanceChanged = true;
                    }
                }
                ImGui::TextDisabled("Seleccionado: %s (se aplica a cejas, pelo y barba)", HairColorNames[m_TempLook.peloColorIdx].c_str());

                ImGui::EndTabItem();
            }

            // TAB 4: BARBA
            if (ImGui::BeginTabItem("Barba")) {
                m_ActiveTab = 3;
                ImGui::Spacing();

                if (m_TempLook.sexo == "hombre") {
                    ImGui::Text("Estilo de barba:");
                    for (size_t i = 0; i < BeardOptions.size(); ++i) {
                        if (i > 0) ImGui::SameLine();
                        const auto& beard = BeardOptions[i];
                        bool selected = (m_TempLook.barba == beard.id);
                        if (ChipButton(beard.label.c_str(), selected, ImVec2(110, 30))) {
                            m_TempLook.barba = beard.id;
                            outAppearanceChanged = true;
                        }
                    }
                } else {
                    ImGui::TextDisabled("La barba no aplica para personajes femeninos.");
                }

                ImGui::EndTabItem();
            }

            // TAB 5: ROPA Y CALZADO
            if (ImGui::BeginTabItem("Ropa y Calzado")) {
                m_ActiveTab = 4;
                ImGui::Spacing();

                ImGui::Text("Prenda de vestir:");
                int colCount = 0;
                for (const auto& item : ClothesOptions) {
                    if (!item.sexo.empty() && item.sexo != m_TempLook.sexo) continue;

                    if (colCount > 0 && colCount % 3 != 0) ImGui::SameLine();
                    bool selected = (m_TempLook.ropa == item.id);
                    if (ChipButton(item.label.c_str(), selected, ImVec2(160, 30))) {
                        m_TempLook.ropa = item.id;
                        outAppearanceChanged = true;
                    }
                    colCount++;
                }

                ImGui::Spacing();
                ImGui::Text("Color de ropa:");
                for (size_t i = 0; i < ClothingPalettes.size(); ++i) {
                    if (i > 0 && i % 7 != 0) ImGui::SameLine();
                    std::string id = "cloth_" + std::to_string(i);
                    if (SwatchButton(id.c_str(), ClothingPalettes[i], m_TempLook.ropaColorIdx == static_cast<int>(i), ClothingColorNames[i].c_str())) {
                        m_TempLook.ropaColorIdx = static_cast<int>(i);
                        outAppearanceChanged = true;
                    }
                }
                ImGui::TextDisabled("Color seleccionado: %s", ClothingColorNames[m_TempLook.ropaColorIdx].c_str());

                ImGui::Spacing();
                ImGui::Separator();
                ImGui::Spacing();

                ImGui::Text("Calzado:");
                for (size_t i = 0; i < ShoeOptions.size(); ++i) {
                    if (i > 0) ImGui::SameLine();
                    const auto& shoe = ShoeOptions[i];
                    bool selected = (m_TempLook.calzado == shoe.id);
                    if (ChipButton(shoe.label.c_str(), selected, ImVec2(110, 30))) {
                        m_TempLook.calzado = shoe.id;
                        outAppearanceChanged = true;
                    }
                }

                ImGui::Spacing();
                ImGui::Text("Color de calzado:");
                for (size_t i = 0; i < ShoePalettes.size(); ++i) {
                    if (i > 0) ImGui::SameLine();
                    std::string id = "shoe_" + std::to_string(i);
                    if (SwatchButton(id.c_str(), ShoePalettes[i], m_TempLook.calzadoColorIdx == static_cast<int>(i), ShoeColorNames[i].c_str())) {
                        m_TempLook.calzadoColorIdx = static_cast<int>(i);
                        outAppearanceChanged = true;
                    }
                }
                ImGui::TextDisabled("Calzado seleccionado: %s", ShoeColorNames[m_TempLook.calzadoColorIdx].c_str());

                ImGui::EndTabItem();
            }

            ImGui::EndTabBar();
        }

        ImGui::Columns(1);

        // BARRA INFERIOR DE ACCIONES
        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        if (ImGui::Button("Todo al azar", ImVec2(140, 34))) {
            m_TempLook = RandomLook(m_Rng);
            snprintf(m_NameBuffer, sizeof(m_NameBuffer), "%s", m_TempLook.nombre.c_str());
            outAppearanceChanged = true;
        }

        ImGui::SameLine();
        ImGui::SetCursorPosX(ImGui::GetWindowWidth() - (m_AllowCancel ? 270.0f : 150.0f));

        if (m_AllowCancel) {
            if (ImGui::Button("Cancelar", ImVec2(110, 34))) {
                Close();
            }
            ImGui::SameLine();
        }

        ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.85f, 0.55f, 0.15f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.95f, 0.65f, 0.20f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(1.0f, 0.75f, 0.30f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.08f, 0.08f, 0.08f, 1.0f));

        if (ImGui::Button("Listo", ImVec2(130, 34))) {
            m_TempLook.nombre = CleanName(m_NameBuffer);
            if (m_TempLook.nombre.empty()) {
                m_TempLook.nombre = "Parcero";
            }
            NormalizeLook(m_TempLook);
            outLook = m_TempLook;
            confirmed = true;
            Close();
        }
        ImGui::PopStyleColor(4);
    }
    ImGui::End();

    ImGui::PopStyleVar(2);

    if (outAppearanceChanged) {
        outLook = m_TempLook;
    }

    return confirmed;
}

} // namespace Bazuko
