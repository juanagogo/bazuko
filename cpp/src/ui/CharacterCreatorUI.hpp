#pragma once
#include "../character/CharacterTypes.hpp"
#include "../character/CharacterPreview.hpp"
#include <random>

namespace Bazuko {

class CharacterCreatorUI {
public:
    CharacterCreatorUI();
    ~CharacterCreatorUI() = default;

    void Open(const CharacterLook& currentLook, bool allowCancel = true);
    void Close();
    bool IsOpen() const { return m_IsOpen; }
    bool IsFocusingFace() const { return m_ActiveTab == 2 || m_ActiveTab == 3; }

    // Dibuja la ventana del creador en ImGui con la vista previa 3D en vivo integrada
    // Devuelve true si la apariencia fue confirmada/guardada.
    bool Render(CharacterPreview& preview, CharacterLook& outLook, bool& outAppearanceChanged);

private:
    bool m_IsOpen = false;
    bool m_AllowCancel = true;
    CharacterLook m_TempLook;
    char m_NameBuffer[32] = {0};
    int m_ActiveTab = 0; // 0: Identidad, 1: Cuerpo, 2: Pelo, 3: Barba, 4: Ropa
    std::mt19937 m_Rng;
};

} // namespace Bazuko
