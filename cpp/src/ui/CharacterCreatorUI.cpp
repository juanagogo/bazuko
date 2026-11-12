#define IMGUI_DEFINE_MATH_OPERATORS
#include "CharacterCreatorUI.hpp"
#include "SignStyle.hpp"
#include <imgui.h>
#include <cstring>
#include <algorithm>

namespace Bazuko {

namespace {

using SignUI::Icon;
const ImVec4 kBlueText(0.84f, 0.89f, 1.0f, 1.0f);
const ImVec4 kPerkGreen(0.45f, 0.92f, 0.55f, 1.0f);

// Muestra de color al estilo de las senales: cuadro redondeado con filete blanco al elegirlo
bool Swatch(const char* id, const glm::vec4& color, bool selected, const char* tooltip) {
    ImGui::PushID(id);
    const ImVec2 size(36.0f, 30.0f);
    const bool pressed = ImGui::InvisibleButton("##muestra", size);
    const bool hovered = ImGui::IsItemHovered();
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    draw->AddRectFilled(min, max, ImGui::GetColorU32(ImVec4(color.r, color.g, color.b, 1.0f)), 5.0f);
    draw->AddRect(min, max, selected ? IM_COL32(255, 255, 255, 245) : (hovered ? IM_COL32(190, 210, 245, 230) : IM_COL32(90, 124, 176, 220)),
                  5.0f, 0, selected ? 2.5f : 1.5f);
    if (tooltip && hovered) ImGui::SetTooltip("%s", tooltip);
    ImGui::PopID();
    return pressed;
}

// Fila de muestras que se acomoda al ancho disponible
template <typename Palette, typename Names>
bool SwatchRow(const char* prefix, const Palette& palette, const Names& names, int& selectedIndex) {
    bool changed = false;
    const float right = ImGui::GetCursorScreenPos().x + ImGui::GetContentRegionAvail().x;
    for (size_t i = 0; i < palette.size(); ++i) {
        if (i > 0) {
            const float nextRight = ImGui::GetItemRectMax().x + 8.0f + 36.0f;
            if (nextRight <= right) ImGui::SameLine(0.0f, 8.0f);
        }
        const std::string id = std::string(prefix) + std::to_string(i);
        if (Swatch(id.c_str(), palette[i], selectedIndex == static_cast<int>(i), names[i].c_str())) {
            selectedIndex = static_cast<int>(i);
            changed = true;
        }
    }
    return changed;
}

// Ancho que ocupara un boton de SignUI con ese texto (14 px de margen a cada lado)
float ButtonWidth(const char* label) {
    return 28.0f + SignUI::SpacedTextWidth(SignUI::GetFonts().monoBold12, 12.0f, SignUI::Upper(label).c_str(), 1.0f);
}
constexpr float kDoneMinWidth = 220.0f;   // el boton Listo es mas grande que los demas, sin exagerar
constexpr float kDoneHeight = 46.0f;
float PrimaryWidth(const char* label) {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    return std::max(kDoneMinWidth, SignUI::SpacedTextWidth(fonts.primary, fonts.primary->FontSize, SignUI::Upper(label).c_str(), 1.3f) + 36.0f);
}

} // namespace

CharacterCreatorUI::CharacterCreatorUI()
    : m_Rng(std::random_device{}()) {
}

void CharacterCreatorUI::Open(const CharacterLook& currentLook, bool allowCancel, int initialTab) {
    m_TempLook = currentLook;
    NormalizeLook(m_TempLook);
    snprintf(m_NameBuffer, sizeof(m_NameBuffer), "%s", m_TempLook.nombre.c_str());
    m_AllowCancel = allowCancel;
    m_IsOpen = true;
    m_BringToFront = true;
    m_ActiveTab = std::clamp(initialTab, 0, 4);
}

void CharacterCreatorUI::Close() {
    m_IsOpen = false;
}

bool CharacterCreatorUI::Render(CharacterPreview& preview, CharacterLook& outLook, bool& outAppearanceChanged) {
    if (!m_IsOpen) return false;

    outAppearanceChanged = false;
    bool confirmed = false;
    bool closeRequested = false;

    // Fondo opaco de pantalla completa: es una ventana (no el dibujo de fondo) para quedar por encima del HUD
    {
        const ImGuiIO& io = ImGui::GetIO();
        ImGui::SetNextWindowPos(ImVec2(0, 0), ImGuiCond_Always);
        ImGui::SetNextWindowSize(io.DisplaySize, ImGuiCond_Always);
        if (m_BringToFront) ImGui::SetNextWindowFocus();
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.012f, 0.016f, 0.027f, 1.0f));
        ImGui::Begin("##CreadorFondo", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                                    ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoNav);
        ImGui::End();
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
        // Solo al abrir: cambiar el foco en cada fotograma cancelaria el clic en curso sobre un boton
        if (m_BringToFront) ImGui::SetNextWindowFocus();   // el menu (siguiente ventana) queda encima del fondo
        m_BringToFront = false;
    }
    if (SignUI::BeginMenu("##CreadorPersonaje", "Crea tu personaje", "Sobreviviente de Bogotá · define tu identidad, apariencia y origen",
                          Icon::Person, m_AllowCancel ? &closeRequested : nullptr, 10000.0f, 10000.0f)) {   // BeginMenu lo limita a la pantalla
        ImGui::PushStyleColor(ImGuiCol_Text, kBlueText);

        // --- Vista previa 3D ---
        // la vista previa ocupa todo el alto disponible (con la proporcion de siempre) para no desperdiciar la pantalla
        const float previewHeight = std::clamp(ImGui::GetContentRegionAvail().y - 100.0f, 300.0f, 760.0f);
        const ImVec2 previewSize(previewHeight * 0.775f, previewHeight);
        ImGui::BeginChild("##vista", ImVec2(previewSize.x + 24.0f, 0.0f), ImGuiChildFlags_None, ImGuiWindowFlags_NoScrollbar);
        ImGui::InvisibleButton("##CharacterPreview", previewSize);
        {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 min = ImGui::GetItemRectMin();
            const ImVec2 max = ImGui::GetItemRectMax();
            draw->AddRectFilled(min - ImVec2(2, 2), max + ImVec2(2, 2), IM_COL32(0, 0, 0, 90), 6.0f);
            draw->AddImage((ImTextureID)(intptr_t)preview.GetTextureID(), min, max, ImVec2(0, 1), ImVec2(1, 0));
            draw->AddRect(min - ImVec2(2, 2), max + ImVec2(2, 2), IM_COL32(90, 124, 176, 220), 6.0f, 0, 1.5f);
        }
        if (ImGui::IsItemHovered()) ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeEW);
        if (ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left)) {
            preview.StopRotation();
            preview.Rotate(ImGui::GetIO().MouseDelta.x * 0.015f);
        }
        SignUI::FlexReset();
        if (SignUI::Button("Izq.")) preview.SetYawVelocity(-4.5f);
        if (SignUI::Button("Detener")) preview.StopRotation();
        if (SignUI::Button("Der.")) preview.SetYawVelocity(4.5f);
        SignUI::NoteText("Arrastra el ratón sobre la imagen para rotar 360°.");
        ImGui::EndChild();

        ImGui::SameLine();

        // --- Opciones por pestañas ---
        ImGui::BeginChild("##opciones", ImVec2(0.0f, 0.0f), ImGuiChildFlags_None, ImGuiWindowFlags_None);
        {
            static const char* const tabNames[] = {"Identidad", "Cuerpo", "Pelo", "Barba", "Ropa y calzado"};
            SignUI::FlexReset();
            for (int tab = 0; tab < 5; ++tab)
                if (SignUI::Button(tabNames[tab], Icon::None, m_ActiveTab == tab)) m_ActiveTab = tab;
            ImGui::Spacing();
        }

        // Las secciones se desplazan en su propia caja, encima de la franja del boton Listo: el boton nunca tapa un texto
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0.0f, 0.0f, 0.0f, 0.0f));
        ImGui::BeginChild("##secciones", ImVec2(0.0f, -(kDoneHeight + 28.0f)), ImGuiChildFlags_None, ImGuiWindowFlags_None);
        if (m_ActiveTab == 0) {
            if (SignUI::BeginSection("Nombre del personaje", Icon::Person)) {
                ImGui::SetNextItemWidth(300.0f);
                if (ImGui::InputText("##NameInput", m_NameBuffer, sizeof(m_NameBuffer))) m_TempLook.nombre = CleanName(m_NameBuffer);
                ImGui::SameLine();
                SignUI::FlexReset();
                if (SignUI::Button("Sugerir nombre (azar)")) {
                    std::uniform_int_distribution<size_t> dist(0, NameIdeas.size() - 1);
                    m_TempLook.nombre = NameIdeas[dist(m_Rng)];
                    snprintf(m_NameBuffer, sizeof(m_NameBuffer), "%s", m_TempLook.nombre.c_str());
                }
                SignUI::NoteText("Así te llamarán en la cuadra. Máximo 16 letras.");
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("Estilos de calle", Icon::Person)) {   // character/presets.js del original: no cambian el nombre ni el origen
                const int current = MatchingStreetPreset(m_TempLook);
                for (size_t i = 0; i < StreetPresets.size(); ++i) {
                    const StreetPreset& preset = StreetPresets[i];
                    ImGui::PushID(preset.id);
                    SignUI::FlexReset();
                    if (SignUI::Button(preset.label, Icon::None, current == static_cast<int>(i))) {
                        ApplyStreetPreset(m_TempLook, preset);
                        outAppearanceChanged = true;
                    }
                    ImGui::PushTextWrapPos(0.0f);
                    ImGui::TextUnformatted(preset.desc);
                    ImGui::PopTextWrapPos();
                    ImGui::Spacing();
                    ImGui::PopID();
                }
                SignUI::NoteText("Cambian la apariencia; el nombre y el origen se quedan. Después puedes ajustar cada pieza.");
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("¿Cómo llegaste a la calle? (Origen)", Icon::Compass)) {
                for (const auto& origin : Origins) {
                    ImGui::PushID(origin.id.c_str());
                    SignUI::FlexReset();
                    if (SignUI::Button(origin.name.c_str(), Icon::None, m_TempLook.origen == origin.id)) m_TempLook.origen = origin.id;
                    ImGui::PushTextWrapPos(0.0f);
                    ImGui::TextUnformatted(origin.desc.c_str());
                    ImGui::PopTextWrapPos();
                    ImGui::TextColored(kPerkGreen, "%s", origin.perk.c_str());
                    ImGui::Spacing();
                    ImGui::PopID();
                }
            }
            SignUI::EndSection();
        } else if (m_ActiveTab == 1) {
            if (SignUI::BeginSection("Sexo", Icon::Person)) {
                SignUI::FlexReset();
                if (SignUI::Button("Hombre", Icon::None, m_TempLook.sexo == "hombre") && m_TempLook.sexo != "hombre") {
                    m_TempLook.sexo = "hombre";
                    NormalizeLook(m_TempLook);
                    outAppearanceChanged = true;
                }
                if (SignUI::Button("Mujer", Icon::None, m_TempLook.sexo == "mujer") && m_TempLook.sexo != "mujer") {
                    m_TempLook.sexo = "mujer";
                    NormalizeLook(m_TempLook);
                    outAppearanceChanged = true;
                }
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("Edad", Icon::Heart)) {
                const char* edades[] = {"joven", "adulto", "mayor"};
                const char* edadesLabels[] = {"Joven", "Adulto", "Mayor"};
                SignUI::FlexReset();
                for (int i = 0; i < 3; ++i) {
                    if (SignUI::Button(edadesLabels[i], Icon::None, m_TempLook.edad == edades[i]) && m_TempLook.edad != edades[i]) {
                        m_TempLook.edad = edades[i];
                        outAppearanceChanged = true;
                    }
                }
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("Tono de piel", Icon::Eye)) {
                if (SwatchRow("skin_", SkinPalettes, SkinColorNames, m_TempLook.pielIdx)) outAppearanceChanged = true;
                SignUI::NoteText(("Seleccionado: " + SkinColorNames[m_TempLook.pielIdx]).c_str());
            }
            SignUI::EndSection();
        } else if (m_ActiveTab == 2) {
            if (SignUI::BeginSection("Corte de pelo", Icon::Person)) {
                SignUI::FlexReset();
                for (const auto& hair : HairOptions) {
                    if (SignUI::Button(hair.label.c_str(), Icon::None, m_TempLook.pelo == hair.id)) {
                        m_TempLook.pelo = hair.id;
                        outAppearanceChanged = true;
                    }
                }
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("Color de pelo y vello facial", Icon::Eye)) {
                if (SwatchRow("hair_", HairPalettes, HairColorNames, m_TempLook.peloColorIdx)) outAppearanceChanged = true;
                SignUI::NoteText(("Seleccionado: " + HairColorNames[m_TempLook.peloColorIdx] + " (se aplica a cejas, pelo y barba)").c_str());
            }
            SignUI::EndSection();
        } else if (m_ActiveTab == 3) {
            if (SignUI::BeginSection("Estilo de barba", Icon::Person)) {
                if (m_TempLook.sexo == "hombre") {
                    SignUI::FlexReset();
                    for (const auto& beard : BeardOptions) {
                        if (SignUI::Button(beard.label.c_str(), Icon::None, m_TempLook.barba == beard.id)) {
                            m_TempLook.barba = beard.id;
                            outAppearanceChanged = true;
                        }
                    }
                } else {
                    SignUI::NoteText("La barba no aplica para personajes femeninos.");
                }
            }
            SignUI::EndSection();
        } else {
            if (SignUI::BeginSection("Prenda de vestir", Icon::Bag)) {
                SignUI::FlexReset();
                for (const auto& item : ClothesOptions) {
                    if (!item.sexo.empty() && item.sexo != m_TempLook.sexo) continue;
                    if (m_TempLook.edad == "joven" && GarmentUncovered(item.id)) continue;   // un cuerpo joven no lleva prendas que dejen al aire el torso o las piernas
                    if (SignUI::Button(item.label.c_str(), Icon::None, m_TempLook.ropa == item.id)) {
                        m_TempLook.ropa = item.id;
                        outAppearanceChanged = true;
                    }
                }
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("Color de ropa", Icon::Eye)) {
                if (SwatchRow("cloth_", ClothingPalettes, ClothingColorNames, m_TempLook.ropaColorIdx)) outAppearanceChanged = true;
                SignUI::NoteText(("Color seleccionado: " + ClothingColorNames[m_TempLook.ropaColorIdx]).c_str());
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("Calzado", Icon::Bag)) {
                SignUI::FlexReset();
                for (const auto& shoe : ShoeOptions) {
                    if (SignUI::Button(shoe.label.c_str(), Icon::None, m_TempLook.calzado == shoe.id)) {
                        m_TempLook.calzado = shoe.id;
                        outAppearanceChanged = true;
                    }
                }
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("Color de calzado", Icon::Eye)) {
                if (SwatchRow("shoe_", ShoePalettes, ShoeColorNames, m_TempLook.calzadoColorIdx)) outAppearanceChanged = true;
                SignUI::NoteText(("Calzado seleccionado: " + ShoeColorNames[m_TempLook.calzadoColorIdx]).c_str());
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("En la cabeza", Icon::Person)) {
                SignUI::FlexReset();
                for (const auto& head : HeadOptions) {
                    if (SignUI::Button(head.label.c_str(), Icon::None, m_TempLook.cabeza == head.id)) {
                        m_TempLook.cabeza = head.id;
                        outAppearanceChanged = true;
                    }
                }
                SignUI::NoteText("Toma el color de la ropa.");
            }
            SignUI::EndSection();

            if (SignUI::BeginSection("Lo que carga", Icon::Bag)) {   // accesorios del original (look.js): se pueden llevar los dos
                SignUI::FlexReset();
                if (SignUI::Button("Bastón", Icon::None, m_TempLook.baston)) { m_TempLook.baston = !m_TempLook.baston; outAppearanceChanged = true; }
                if (SignUI::Button("Mochila", Icon::None, m_TempLook.mochila)) { m_TempLook.mochila = !m_TempLook.mochila; outAppearanceChanged = true; }
                SignUI::NoteText("El bastón se guarda al pelear, fumar o empujar la carreta.");
            }
            SignUI::EndSection();
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();
        // Listo: centrado en la pantalla, en su franja al fondo del panel de opciones (un poco por encima del pie)
        {
            const float doneWidth = PrimaryWidth("Listo");
            const float bottom = ImGui::GetWindowPos().y + ImGui::GetWindowHeight();
            ImGui::SetCursorScreenPos(ImVec2(ImGui::GetIO().DisplaySize.x * 0.5f - doneWidth * 0.5f, bottom - kDoneHeight - 14.0f));
            if (SignUI::PrimaryButton("Listo", false, true, kDoneHeight, kDoneMinWidth)) {
                m_TempLook.nombre = CleanName(m_NameBuffer);
                if (m_TempLook.nombre.empty()) m_TempLook.nombre = "Parcero";
                NormalizeLook(m_TempLook);
                outLook = m_TempLook;
                confirmed = true;
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor();

        // --- Pie: acciones ---
        SignUI::BeginFooter();
        if (SignUI::Button("Todo al azar")) {
            m_TempLook = RandomLook(m_Rng);
            snprintf(m_NameBuffer, sizeof(m_NameBuffer), "%s", m_TempLook.nombre.c_str());
            outAppearanceChanged = true;
        }
        if (m_AllowCancel) {
            // Cancelar a la derecha del pie
            const float rightEdge = ImGui::GetCursorScreenPos().x + ImGui::GetContentRegionAvail().x - 22.0f;
            ImGui::SameLine();
            ImGui::SetCursorScreenPos(ImVec2(rightEdge - ButtonWidth("Cancelar"), ImGui::GetCursorScreenPos().y));
            SignUI::FlexReset();
            if (SignUI::Button("Cancelar")) closeRequested = true;
        }
    }
    SignUI::EndMenu();

    if (confirmed || closeRequested) Close();
    if (outAppearanceChanged) { NormalizeLook(m_TempLook); outLook = m_TempLook; }   // p. ej. al volverse joven cambia una prenda que deje el cuerpo al aire
    return confirmed;
}

} // namespace Bazuko
