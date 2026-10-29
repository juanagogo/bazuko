#define IMGUI_DEFINE_MATH_OPERATORS
#include "SignStyle.hpp"
#include <imgui_internal.h>
#include "../core/Log.hpp"
#include "../core/Paths.hpp"
#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstring>
#include <filesystem>

namespace Bazuko::SignUI {

namespace {

Fonts g_fonts;

constexpr ImU32 kBlue = IM_COL32(11, 79, 163, 255);
constexpr ImU32 kBlueText = IM_COL32(214, 228, 255, 255);
constexpr ImU32 kYellow = IM_COL32(246, 196, 0, 255);
constexpr ImU32 kInk = IM_COL32(14, 15, 18, 255);

bool g_menuVisible = false;
bool g_bodyOpen = false;
float g_menuWidth = 0.0f;
float g_menuHeight = 0.0f;

bool g_flexFirst = true;
float g_flexRight = 1.0e9f;

ImU32 White(float alpha) { return IM_COL32(255, 255, 255, static_cast<int>(std::clamp(alpha, 0.0f, 1.0f) * 255.0f)); }

std::string ExistingPath(const std::string& relative) {
    const std::string found = Paths::Find(relative);
    return std::filesystem::exists(found) ? found : std::string{};
}

ImFont* AddFont(const std::string& path, float size, const ImWchar* ranges) {
    if (path.empty()) return nullptr;
    return ImGui::GetIO().Fonts->AddFontFromFileTTF(path.c_str(), size, nullptr, ranges);
}

} // namespace

void LoadFonts() {
    ImGuiIO& io = ImGui::GetIO();
    // Latin basico y suplemento + puntuacion general (raya, puntos suspensivos, comillas) + flechas
    static const ImWchar kRanges[] = {0x0020, 0x00FF, 0x2010, 0x203A, 0x2190, 0x2193, 0};

    const std::string regular = ExistingPath("assets/fonts/Overpass-Regular.ttf");
    const std::string bold = ExistingPath("assets/fonts/Overpass-Bold.ttf");
    const std::string black = ExistingPath("assets/fonts/Overpass-Black.ttf");

    // La monoespaciada del navegador en Windows es Consolas; si no esta se usa Overpass.
    std::string monoPath, monoBoldPath;
    for (const char* candidate : {"C:/Windows/Fonts/consola.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"})
        if (monoPath.empty() && std::filesystem::exists(candidate)) monoPath = candidate;
    for (const char* candidate : {"C:/Windows/Fonts/consolab.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"})
        if (monoBoldPath.empty() && std::filesystem::exists(candidate)) monoBoldPath = candidate;
    if (monoPath.empty()) monoPath = regular;
    if (monoBoldPath.empty()) monoBoldPath = bold;

    g_fonts.body = AddFont(monoPath, 13.0f, kRanges);
    g_fonts.mono12 = AddFont(monoPath, 12.0f, kRanges);
    g_fonts.mono11 = AddFont(monoPath, 11.0f, kRanges);
    g_fonts.mono14 = AddFont(monoPath, 14.0f, kRanges);
    g_fonts.monoBold12 = AddFont(monoBoldPath, 12.0f, kRanges);
    g_fonts.monoBold13 = AddFont(monoBoldPath, 13.0f, kRanges);
    g_fonts.monoBold14 = AddFont(monoBoldPath, 14.0f, kRanges);
    // Overpass mide 1.266 em de ascenso+descenso y ImGui interpreta el tamano como alto de linea: se compensa
    constexpr float kOverpassLine = 1.266f;
    g_fonts.sub = AddFont(regular, 13.0f * kOverpassLine, kRanges);
    g_fonts.title = AddFont(black, 22.0f * kOverpassLine, kRanges);
    g_fonts.primary = AddFont(black, 16.0f * kOverpassLine, kRanges);

    if (!g_fonts.body) {
        LogWarn("No se pudieron cargar las fuentes del juego (assets/fonts); se usa la fuente por defecto de ImGui.");
        ImFont* fallback = io.Fonts->AddFontDefault();
        g_fonts = Fonts{fallback, fallback, fallback, fallback, fallback, fallback, fallback, fallback, fallback, fallback};
    }
    for (ImFont** font : {&g_fonts.mono12, &g_fonts.mono11, &g_fonts.mono14, &g_fonts.monoBold12, &g_fonts.monoBold13,
                          &g_fonts.monoBold14, &g_fonts.sub, &g_fonts.title, &g_fonts.primary})
        if (!*font) *font = g_fonts.body;
    io.FontDefault = g_fonts.body;
}

const Fonts& GetFonts() { return g_fonts; }

void ApplyTheme() {
    ImGuiStyle& style = ImGui::GetStyle();
    ImVec4* colors = style.Colors;
    style.WindowRounding = 6.0f;
    style.ChildRounding = 5.0f;
    style.FrameRounding = 4.0f;
    style.GrabRounding = 6.0f;
    style.PopupRounding = 4.0f;
    style.ScrollbarRounding = 4.0f;
    style.WindowBorderSize = 1.0f;
    style.FrameBorderSize = 1.0f;
    style.ItemSpacing = ImVec2(8.0f, 8.0f);
    style.WindowPadding = ImVec2(10.0f, 8.0f);
    style.FramePadding = ImVec2(10.0f, 6.0f);
    style.ScrollbarSize = 8.0f;

    const auto rgb = [](int r, int g, int b, float a = 1.0f) { return ImVec4(r / 255.0f, g / 255.0f, b / 255.0f, a); };
    colors[ImGuiCol_Text] = rgb(221, 221, 221);
    colors[ImGuiCol_TextDisabled] = rgb(136, 144, 158);
    // Ventanas genericas: panel de rendimiento del juego web
    colors[ImGuiCol_WindowBg] = rgb(9, 17, 21, 0.88f);
    colors[ImGuiCol_ChildBg] = rgb(0, 0, 0, 0.30f);
    colors[ImGuiCol_PopupBg] = rgb(11, 24, 40, 0.97f);
    colors[ImGuiCol_Border] = rgb(84, 119, 106, 0.9f);
    colors[ImGuiCol_FrameBg] = rgb(14, 24, 40, 0.9f);
    colors[ImGuiCol_FrameBgHovered] = rgb(24, 40, 66, 0.95f);
    colors[ImGuiCol_FrameBgActive] = rgb(34, 56, 90, 1.0f);
    colors[ImGuiCol_TitleBg] = rgb(8, 60, 125);
    colors[ImGuiCol_TitleBgActive] = rgb(11, 79, 163);
    colors[ImGuiCol_TitleBgCollapsed] = rgb(8, 60, 125, 0.8f);
    colors[ImGuiCol_ScrollbarBg] = ImVec4(0, 0, 0, 0);
    colors[ImGuiCol_ScrollbarGrab] = ImVec4(1, 1, 1, 0.40f);
    colors[ImGuiCol_ScrollbarGrabHovered] = ImVec4(1, 1, 1, 0.60f);
    colors[ImGuiCol_ScrollbarGrabActive] = ImVec4(1, 1, 1, 0.80f);
    colors[ImGuiCol_CheckMark] = rgb(246, 196, 0);
    colors[ImGuiCol_SliderGrab] = rgb(39, 174, 96);
    colors[ImGuiCol_SliderGrabActive] = rgb(60, 205, 120);
    colors[ImGuiCol_Button] = rgb(14, 24, 40, 0.95f);
    colors[ImGuiCol_ButtonHovered] = rgb(24, 40, 66, 1.0f);
    colors[ImGuiCol_ButtonActive] = rgb(34, 56, 90, 1.0f);
    colors[ImGuiCol_Header] = rgb(14, 24, 40, 0.9f);
    colors[ImGuiCol_HeaderHovered] = rgb(24, 40, 66, 1.0f);
    colors[ImGuiCol_HeaderActive] = rgb(34, 56, 90, 1.0f);
    colors[ImGuiCol_Separator] = ImVec4(1, 1, 1, 0.18f);
    colors[ImGuiCol_PlotHistogram] = rgb(39, 174, 96);
}

std::string Upper(const std::string& text) {
    std::string out = text;
    for (size_t i = 0; i < out.size(); ++i) {
        const unsigned char c = static_cast<unsigned char>(out[i]);
        if (c >= 'a' && c <= 'z') {
            out[i] = static_cast<char>(c - 32);
        } else if (c == 0xC3 && i + 1 < out.size()) {
            const unsigned char next = static_cast<unsigned char>(out[i + 1]);
            if (next >= 0xA0 && next <= 0xBE && next != 0xB7) out[i + 1] = static_cast<char>(next - 0x20);
            ++i;
        }
    }
    return out;
}

float SpacedTextWidth(ImFont* font, float size, const char* text, float spacing) {
    const char* end = text + std::strlen(text);
    float width = 0.0f;
    int glyphs = 0;
    for (const char* p = text; p < end;) {
        unsigned int c = 0;
        const int bytes = ImTextCharFromUtf8(&c, p, end);
        width += font->CalcTextSizeA(size, FLT_MAX, 0.0f, p, p + bytes).x;
        p += std::max(bytes, 1);
        ++glyphs;
    }
    return width + spacing * static_cast<float>(std::max(0, glyphs - 1));
}

void AddSpacedText(ImDrawList* draw, ImFont* font, float size, ImVec2 position, ImU32 color, const char* text, float spacing) {
    const char* end = text + std::strlen(text);
    for (const char* p = text; p < end;) {
        unsigned int c = 0;
        const int bytes = std::max(ImTextCharFromUtf8(&c, p, end), 1);
        draw->AddText(font, size, position, color, p, p + bytes);
        position.x += font->CalcTextSizeA(size, FLT_MAX, 0.0f, p, p + bytes).x + spacing;
        p += bytes;
    }
}

void AddShadowText(ImDrawList* draw, ImFont* font, float size, ImVec2 position, ImU32 color, const char* text) {
    const ImU32 shadow = IM_COL32(0, 0, 0, 170);
    draw->AddText(font, size, position + ImVec2(1.0f, 1.0f), shadow, text);
    draw->AddText(font, size, position + ImVec2(-1.0f, 1.0f), IM_COL32(0, 0, 0, 90), text);
    draw->AddText(font, size, position, color, text);
}

void DrawIcon(ImDrawList* draw, Icon icon, ImVec2 c, float s, float alpha) {
    const auto P = [&](float x, float y) { return ImVec2(c.x + x * s, c.y + y * s); };
    const auto col = [&](int r, int g, int b) { return IM_COL32(r, g, b, static_cast<int>(255.0f * alpha)); };
    const float t = std::max(1.0f, s * 0.09f);
    switch (icon) {
    case Icon::None: break;
    case Icon::Pause:
        draw->AddRect(P(-0.40f, -0.46f), P(-0.08f, 0.46f), col(255, 255, 255), s * 0.08f, 0, std::max(2.0f, s * 0.085f));
        draw->AddRect(P(0.08f, -0.46f), P(0.40f, 0.46f), col(255, 255, 255), s * 0.08f, 0, std::max(2.0f, s * 0.085f));
        break;
    case Icon::Close:
        draw->AddLine(P(-0.3f, -0.3f), P(0.3f, 0.3f), col(255, 255, 255), std::max(2.0f, s * 0.11f));
        draw->AddLine(P(0.3f, -0.3f), P(-0.3f, 0.3f), col(255, 255, 255), std::max(2.0f, s * 0.11f));
        break;
    case Icon::Sound:
    case Icon::Mute: {
        const ImVec2 poly[] = {P(-0.40f, -0.14f), P(-0.20f, -0.14f), P(0.02f, -0.34f), P(0.02f, 0.34f), P(-0.20f, 0.14f), P(-0.40f, 0.14f)};
        draw->AddConvexPolyFilled(poly, 6, col(215, 224, 238));
        if (icon == Icon::Sound) {
            draw->PathArcTo(P(0.02f, 0.0f), s * 0.24f, -0.9f, 0.9f, 8);
            draw->PathStroke(col(215, 224, 238), 0, t);
            draw->PathArcTo(P(0.02f, 0.0f), s * 0.40f, -0.9f, 0.9f, 10);
            draw->PathStroke(col(215, 224, 238), 0, t);
        } else {
            draw->AddLine(P(0.16f, -0.16f), P(0.42f, 0.16f), col(255, 90, 80), t * 1.2f);
            draw->AddLine(P(0.42f, -0.16f), P(0.16f, 0.16f), col(255, 90, 80), t * 1.2f);
        }
        break;
    }
    case Icon::Bolt: {
        const ImVec2 poly[] = {P(0.08f, -0.5f), P(-0.30f, 0.06f), P(-0.03f, 0.06f), P(-0.10f, 0.5f), P(0.30f, -0.10f), P(0.03f, -0.10f)};
        draw->AddConvexPolyFilled(poly, 6, col(255, 150, 30));
        break;
    }
    case Icon::Chart:
        draw->AddRectFilled(P(-0.40f, -0.05f), P(-0.16f, 0.40f), col(66, 133, 244), 1.5f);
        draw->AddRectFilled(P(-0.10f, -0.40f), P(0.14f, 0.40f), col(180, 90, 220), 1.5f);
        draw->AddRectFilled(P(0.20f, 0.10f), P(0.44f, 0.40f), col(80, 200, 120), 1.5f);
        break;
    case Icon::Gear:
        for (int tooth = 0; tooth < 8; ++tooth) {
            const float a = tooth * 0.7853982f;
            draw->AddLine(P(std::cos(a) * 0.26f, std::sin(a) * 0.26f), P(std::cos(a) * 0.46f, std::sin(a) * 0.46f), col(205, 212, 224), s * 0.17f);
        }
        draw->AddCircleFilled(c, s * 0.32f, col(205, 212, 224), 16);
        draw->AddCircleFilled(c, s * 0.12f, col(28, 40, 62), 12);
        break;
    case Icon::Radio:
        draw->AddRectFilled(P(-0.46f, -0.22f), P(0.46f, 0.38f), col(170, 182, 198), s * 0.08f);
        draw->AddLine(P(0.18f, -0.22f), P(0.38f, -0.48f), col(200, 205, 215), t);
        draw->AddCircleFilled(P(-0.18f, 0.08f), s * 0.15f, col(52, 62, 80), 12);
        draw->AddRectFilled(P(0.08f, -0.06f), P(0.38f, 0.0f), col(52, 62, 80));
        draw->AddRectFilled(P(0.08f, 0.10f), P(0.38f, 0.16f), col(52, 62, 80));
        break;
    case Icon::Save:
        draw->AddRectFilled(P(-0.40f, -0.40f), P(0.40f, 0.40f), col(150, 90, 205), s * 0.07f);
        draw->AddRectFilled(P(-0.24f, -0.40f), P(0.20f, -0.08f), col(245, 245, 250));
        draw->AddRectFilled(P(-0.24f, 0.10f), P(0.24f, 0.40f), col(222, 218, 235));
        break;
    case Icon::Compass:
        draw->AddCircleFilled(c, s * 0.42f, col(232, 192, 122), 20);
        draw->AddCircle(c, s * 0.42f, col(150, 100, 50), 20, t);
        {
            const ImVec2 north[] = {P(0.0f, -0.30f), P(0.11f, 0.0f), P(-0.11f, 0.0f)};
            const ImVec2 south[] = {P(0.0f, 0.30f), P(0.11f, 0.0f), P(-0.11f, 0.0f)};
            draw->AddConvexPolyFilled(north, 3, col(210, 55, 45));
            draw->AddConvexPolyFilled(south, 3, col(250, 250, 250));
        }
        break;
    case Icon::Person:
        draw->AddCircleFilled(P(0.0f, -0.24f), s * 0.17f, col(244, 172, 84), 14);
        draw->AddRectFilled(P(-0.24f, -0.03f), P(0.24f, 0.46f), col(232, 128, 52), s * 0.12f);
        break;
    case Icon::Home: {
        const ImVec2 roof[] = {P(0.0f, -0.42f), P(0.46f, 0.08f), P(-0.46f, 0.08f)};
        draw->AddConvexPolyFilled(roof, 3, col(64, 176, 96));
        draw->AddRectFilled(P(-0.30f, 0.08f), P(0.30f, 0.42f), col(38, 120, 66));
        draw->AddRectFilled(P(-0.07f, 0.18f), P(0.07f, 0.42f), col(18, 60, 34));
        break;
    }
    case Icon::Star: {
        ImVec2 poly[10];
        for (int i = 0; i < 10; ++i) {
            const float radius = (i % 2 == 0) ? 0.48f : 0.20f;
            const float angle = -1.5707963f + static_cast<float>(i) * 0.6283185f;
            poly[i] = P(std::cos(angle) * radius, std::sin(angle) * radius);
        }
        draw->AddConvexPolyFilled(poly, 10, col(252, 202, 44));
        break;
    }
    case Icon::Book:
        draw->AddRectFilled(P(-0.36f, -0.42f), P(0.36f, 0.42f), col(66, 118, 214), s * 0.05f);
        draw->AddRectFilled(P(-0.22f, -0.28f), P(0.28f, 0.34f), col(238, 242, 250));
        draw->AddLine(P(-0.12f, -0.12f), P(0.18f, -0.12f), col(66, 118, 214), 1.0f);
        draw->AddLine(P(-0.12f, 0.04f), P(0.18f, 0.04f), col(66, 118, 214), 1.0f);
        break;
    case Icon::Bag:
        draw->PathArcTo(P(0.0f, -0.08f), s * 0.2f, 3.14159f, 6.28318f, 10);
        draw->PathStroke(col(120, 76, 40), 0, t);
        draw->AddRectFilled(P(-0.38f, -0.08f), P(0.38f, 0.44f), col(184, 120, 64), s * 0.09f);
        break;
    case Icon::Paw:
        draw->AddCircleFilled(P(0.0f, 0.16f), s * 0.22f, col(196, 126, 64), 14);
        draw->AddCircleFilled(P(-0.28f, -0.10f), s * 0.11f, col(196, 126, 64), 10);
        draw->AddCircleFilled(P(-0.10f, -0.30f), s * 0.11f, col(196, 126, 64), 10);
        draw->AddCircleFilled(P(0.10f, -0.30f), s * 0.11f, col(196, 126, 64), 10);
        draw->AddCircleFilled(P(0.28f, -0.10f), s * 0.11f, col(196, 126, 64), 10);
        break;
    case Icon::Check:
        draw->AddLine(P(-0.36f, 0.04f), P(-0.10f, 0.30f), col(255, 255, 255), std::max(2.0f, s * 0.14f));
        draw->AddLine(P(-0.10f, 0.30f), P(0.38f, -0.30f), col(255, 255, 255), std::max(2.0f, s * 0.14f));
        break;
    case Icon::Bread:
        draw->AddRectFilled(P(-0.42f, -0.22f), P(0.42f, 0.34f), col(176, 122, 52), s * 0.2f);
        draw->AddRectFilled(P(-0.32f, -0.12f), P(0.32f, 0.24f), col(208, 154, 74), s * 0.14f);
        break;
    case Icon::Drop: {
        const ImVec2 top[] = {P(0.0f, -0.46f), P(0.28f, 0.12f), P(-0.28f, 0.12f)};
        draw->AddConvexPolyFilled(top, 3, col(60, 140, 232));
        draw->AddCircleFilled(P(0.0f, 0.14f), s * 0.28f, col(60, 140, 232), 16);
        break;
    }
    case Icon::Energy: {
        draw->AddCircleFilled(c, s * 0.44f, col(176, 106, 214), 18);
        const ImVec2 poly[] = {P(0.06f, -0.30f), P(-0.16f, 0.04f), P(-0.01f, 0.04f), P(-0.06f, 0.30f), P(0.16f, -0.06f), P(0.01f, -0.06f)};
        draw->AddConvexPolyFilled(poly, 6, col(255, 232, 130));
        break;
    }
    case Icon::Pill:
        draw->AddLine(P(-0.26f, 0.26f), P(0.0f, 0.0f), col(220, 66, 56), s * 0.34f);
        draw->AddLine(P(0.0f, 0.0f), P(0.26f, -0.26f), col(58, 130, 220), s * 0.34f);
        draw->AddCircleFilled(P(-0.26f, 0.26f), s * 0.17f, col(220, 66, 56), 10);
        draw->AddCircleFilled(P(0.26f, -0.26f), s * 0.17f, col(58, 130, 220), 10);
        break;
    case Icon::Soap:
        draw->AddRectFilled(P(-0.42f, -0.18f), P(0.42f, 0.30f), col(222, 118, 192), s * 0.16f);
        draw->AddCircleFilled(P(-0.04f, -0.34f), s * 0.09f, col(190, 224, 250), 8);
        draw->AddCircleFilled(P(0.16f, -0.42f), s * 0.06f, col(190, 224, 250), 8);
        break;
    case Icon::Heart: {
        draw->AddCircleFilled(P(-0.16f, -0.12f), s * 0.2f, col(226, 90, 150), 14);
        draw->AddCircleFilled(P(0.16f, -0.12f), s * 0.2f, col(226, 90, 150), 14);
        const ImVec2 tip[] = {P(-0.34f, -0.02f), P(0.34f, -0.02f), P(0.0f, 0.42f)};
        draw->AddConvexPolyFilled(tip, 3, col(226, 90, 150));
        break;
    }
    case Icon::Flame: {
        const ImVec2 top[] = {P(0.02f, -0.48f), P(0.30f, 0.14f), P(-0.30f, 0.14f)};
        draw->AddConvexPolyFilled(top, 3, col(240, 140, 40));
        draw->AddCircleFilled(P(0.0f, 0.14f), s * 0.30f, col(240, 140, 40), 16);
        draw->AddCircleFilled(P(0.0f, 0.22f), s * 0.14f, col(255, 214, 90), 10);
        break;
    }
    case Icon::Eye:
        draw->AddEllipse(c, ImVec2(s * 0.44f, s * 0.26f), col(255, 90, 80), 0.0f, 20, t);
        draw->AddCircleFilled(c, s * 0.14f, col(255, 90, 80), 10);
        break;
    case Icon::Camera:
        draw->AddRectFilled(P(-0.44f, -0.22f), P(0.44f, 0.34f), col(190, 198, 212), s * 0.08f);
        draw->AddRectFilled(P(-0.18f, -0.36f), P(0.12f, -0.22f), col(190, 198, 212));
        draw->AddCircleFilled(P(0.0f, 0.06f), s * 0.17f, col(40, 52, 74), 12);
        break;
    }
}

void DrawBackdrop(float alpha) {
    ImGui::GetBackgroundDrawList()->AddRectFilled(ImVec2(0, 0), ImGui::GetIO().DisplaySize,
        IM_COL32(3, 4, 7, static_cast<int>(alpha * 255.0f)));
}

bool BeginMenu(const char* id, const char* title, const char* subtitle, Icon icon, bool* closeRequested,
               float width, float height) {
    const ImGuiIO& io = ImGui::GetIO();
    g_menuWidth = std::min(width, io.DisplaySize.x - 32.0f);
    g_menuHeight = std::min(height, io.DisplaySize.y - 32.0f);
    ImGui::SetNextWindowSize(ImVec2(g_menuWidth, g_menuHeight), ImGuiCond_Always);
    ImGui::SetNextWindowPos(ImVec2(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));
    const ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                   ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoCollapse;
    g_menuVisible = ImGui::Begin(id, nullptr, flags);
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    g_bodyOpen = false;
    if (!g_menuVisible) return false;

    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 p0 = ImGui::GetWindowPos();
    const ImVec2 p1 = p0 + ImVec2(g_menuWidth, g_menuHeight);

    // sombra (0 6px 18px) en la capa de fondo, para que no la recorte la ventana
    ImDrawList* back = ImGui::GetBackgroundDrawList();
    for (int layer = 1; layer <= 9; ++layer) {
        const float grow = static_cast<float>(layer) * 2.0f;
        back->AddRectFilled(p0 + ImVec2(-grow, 6.0f - grow), p1 + ImVec2(grow, 6.0f + grow), IM_COL32(0, 0, 0, 14), 10.0f + grow);
    }
    draw->AddRectFilled(p0, p1, kBlue, 10.0f);
    draw->AddRect(p0 + ImVec2(5, 5), p1 - ImVec2(5, 5), White(0.95f), 6.0f, 0, 2.0f);

    // cabecera: icono, titulo, subtitulo y boton de cerrar
    const Fonts& fonts = g_fonts;
    DrawIcon(draw, icon, p0 + ImVec2(22.0f + 17.0f, 22.0f + 22.0f), 34.0f);
    const float textX = p0.x + 22.0f + 34.0f + 14.0f;
    const std::string upperTitle = Upper(title);
    AddSpacedText(draw, fonts.title, fonts.title->FontSize, ImVec2(textX, p0.y + 15.5f), White(1.0f), upperTitle.c_str(), 0.9f);
    draw->AddText(fonts.sub, fonts.sub->FontSize, ImVec2(textX, p0.y + 46.0f), kBlueText, subtitle);

    if (closeRequested) {
        const ImVec2 closeMin = p0 + ImVec2(g_menuWidth - 22.0f - 44.0f, 22.0f);
        ImGui::SetCursorScreenPos(closeMin);
        const bool pressed = ImGui::InvisibleButton("##cerrar", ImVec2(44.0f, 44.0f));
        const bool hovered = ImGui::IsItemHovered();
        draw->AddRect(closeMin, closeMin + ImVec2(44, 44), White(hovered ? 1.0f : 0.8f), 8.0f, 0, 2.0f);
        if (hovered) draw->AddRectFilled(closeMin + ImVec2(2, 2), closeMin + ImVec2(42, 42), White(0.10f), 7.0f);
        DrawIcon(draw, Icon::Close, closeMin + ImVec2(22, 22), 22.0f);
        if (pressed) *closeRequested = true;
    }

    const float lineY = p0.y + 22.0f + 44.0f + 14.0f;
    draw->AddLine(ImVec2(p0.x + 22.0f, lineY), ImVec2(p1.x - 22.0f, lineY), White(0.25f), 2.0f);

    // cuerpo desplazable
    ImGui::SetCursorScreenPos(ImVec2(p0.x + 22.0f, lineY + 2.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(2.0f, 10.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 8.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    const float bodyHeight = (p1.y - 72.0f) - (lineY + 2.0f);
    ImGui::BeginChild("##cuerpo", ImVec2(g_menuWidth - 44.0f, bodyHeight), ImGuiChildFlags_None, ImGuiWindowFlags_None);
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(2);
    g_bodyOpen = true;
    FlexReset();
    return true;
}

void BeginFooter() {
    if (!g_menuVisible) return;
    if (g_bodyOpen) {
        ImGui::EndChild();
        g_bodyOpen = false;
    }
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 p0 = ImGui::GetWindowPos();
    const float lineY = p0.y + g_menuHeight - 72.0f;
    draw->AddLine(ImVec2(p0.x + 22.0f, lineY), ImVec2(p0.x + g_menuWidth - 22.0f, lineY), White(0.25f), 2.0f);
    ImGui::SetCursorScreenPos(ImVec2(p0.x + 22.0f, lineY + 12.0f));
    FlexReset();
}

void EndMenu() {
    if (g_menuVisible && g_bodyOpen) {
        ImGui::EndChild();
        g_bodyOpen = false;
    }
    ImGui::End();
    g_menuVisible = false;
}

bool BeginSection(const char* title, Icon icon) {
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 5.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ChildBorderSize, 1.0f);
    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0.30f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.45f, 0.65f, 0.95f, 0.35f));
    const bool open = ImGui::BeginChild(title, ImVec2(0, 0), ImGuiChildFlags_Borders | ImGuiChildFlags_AutoResizeY,
                                        ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(3);
    if (open) {
        ImDrawList* draw = ImGui::GetWindowDrawList();
        const ImVec2 at = ImGui::GetCursorScreenPos();
        const float width = ImGui::GetContentRegionAvail().x;
        DrawIcon(draw, icon, at + ImVec2(7.0f, 9.0f), 14.0f);
        draw->AddText(g_fonts.monoBold13, 13.0f, at + ImVec2(22.0f, 2.0f), IM_COL32(238, 214, 136, 255), title);
        draw->AddLine(at + ImVec2(0.0f, 22.0f), at + ImVec2(width, 22.0f), White(0.14f), 1.0f);
        ImGui::Dummy(ImVec2(width, 28.0f));
        FlexReset();
    }
    return open;
}

void EndSection() {
    ImGui::EndChild();
    ImGui::Dummy(ImVec2(0.0f, 2.0f));
}

void FlexReset() {
    g_flexFirst = true;
    g_flexRight = ImGui::GetCursorScreenPos().x + ImGui::GetContentRegionAvail().x;
}

bool Button(const char* label, Icon icon, bool selected, bool danger) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const std::string upper = Upper(label);
    const float spacing = 1.0f;
    const float textWidth = SpacedTextWidth(g_fonts.monoBold12, 12.0f, upper.c_str(), spacing);
    const float iconWidth = icon != Icon::None ? 22.0f : 0.0f;
    const ImVec2 size(14.0f + iconWidth + textWidth + 14.0f, 38.0f);
    if (!g_flexFirst) {
        const float previousRight = ImGui::GetItemRectMax().x;
        if (previousRight + 8.0f + size.x <= g_flexRight) ImGui::SameLine(0.0f, 8.0f);
    }
    g_flexFirst = false;
    ImGui::PushID(label);
    const bool pressed = ImGui::InvisibleButton("##boton", size);
    ImGui::PopID();
    const bool hovered = ImGui::IsItemHovered();
    const bool active = ImGui::IsItemActive();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    ImU32 background = IM_COL32(14, 24, 40, 245);
    if (danger) background = IM_COL32(96, 38, 34, 245);
    if (hovered) background = danger ? IM_COL32(140, 52, 46, 250) : IM_COL32(26, 44, 72, 250);
    if (active) background = danger ? IM_COL32(170, 60, 52, 255) : IM_COL32(36, 60, 98, 255);
    const ImU32 border = selected ? White(0.95f) : (danger ? IM_COL32(220, 110, 100, 210) : IM_COL32(90, 124, 176, 220));
    draw->AddRectFilled(min, max, background, 5.0f);
    draw->AddRect(min, max, border, 5.0f, 0, selected ? 2.0f : 1.5f);
    float x = min.x + 14.0f;
    if (icon != Icon::None) {
        DrawIcon(draw, icon, ImVec2(x + 7.0f, (min.y + max.y) * 0.5f), 14.0f);
        x += iconWidth;
    }
    AddSpacedText(draw, g_fonts.monoBold12, 12.0f, ImVec2(x, (min.y + max.y) * 0.5f - 6.5f), IM_COL32(244, 248, 255, 255),
                  upper.c_str(), spacing);
    return pressed;
}

bool BeginRow(const char* id, int index) {
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(10.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, 6.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 4.0f));
    ImGui::PushStyleColor(ImGuiCol_ChildBg, index % 2 == 0 ? ImVec4(1, 1, 1, 0.05f) : ImVec4(0, 0, 0, 0));
    const bool open = ImGui::BeginChild(id, ImVec2(0, 0), ImGuiChildFlags_AutoResizeY,
                                        ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    ImGui::PopStyleColor();
    ImGui::PopStyleVar(3);
    return open;
}

float RowBegin() {
    const float top = ImGui::GetCursorPosY();
    ImGui::SetCursorPosY(top + 7.0f);
    return top;
}

void RowCluster(float rowTop, float x) {
    ImGui::SameLine(x);
    ImGui::SetCursorPosY(rowTop);
}

void RowBelow(float rowTop) {
    ImGui::SetCursorPos(ImVec2(10.0f, rowTop + 30.0f));
}

void EndRow() {
    ImGui::EndChild();
    ImGui::Dummy(ImVec2(0.0f, 0.0f));
}

float RowButtonWidth(const char* label) {
    return SpacedTextWidth(g_fonts.monoBold12, 12.0f, Upper(label).c_str(), 0.8f) + 24.0f;
}

bool RowButton(const char* label, bool enabled, bool primary) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const std::string upper = Upper(label);
    const float spacing = 0.8f;
    ImFont* font = g_fonts.monoBold12;
    const float textWidth = SpacedTextWidth(font, 12.0f, upper.c_str(), spacing);
    const ImVec2 size(textWidth + 24.0f, 30.0f);
    ImGui::PushID(label);
    const bool pressed = ImGui::InvisibleButton("##fila", size) && enabled;
    ImGui::PopID();
    const bool hovered = enabled && ImGui::IsItemHovered();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    const int fade = enabled ? 255 : 110;
    if (primary) {
        draw->AddRectFilled(min, max, hovered ? IM_COL32(255, 210, 26, fade) : IM_COL32(246, 196, 0, fade), 6.0f);
        draw->AddRect(min, max, IM_COL32(14, 15, 18, fade), 6.0f, 0, 2.0f);
    } else {
        draw->AddRectFilled(min, max, hovered ? IM_COL32(26, 44, 72, 250) : IM_COL32(14, 24, 40, 245), 6.0f);
        draw->AddRect(min, max, IM_COL32(255, 255, 255, enabled ? 120 : 50), 6.0f, 0, 1.5f);
    }
    AddSpacedText(draw, font, 12.0f, ImVec2(min.x + 12.0f, (min.y + max.y) * 0.5f - 6.5f),
                  primary ? IM_COL32(14, 15, 18, fade) : IM_COL32(244, 248, 255, fade), upper.c_str(), spacing);
    return pressed;
}

bool PrimaryButton(const char* label, bool fullWidth, bool enabled, float height, float minWidth) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const std::string upper = Upper(label);
    const float spacing = 1.3f;
    const float primarySize = g_fonts.primary->FontSize;
    const float textWidth = SpacedTextWidth(g_fonts.primary, primarySize, upper.c_str(), spacing);
    const float width = fullWidth ? ImGui::GetContentRegionAvail().x : std::max(textWidth + 36.0f, minWidth);
    ImGui::PushID(label);
    const bool pressed = ImGui::InvisibleButton("##principal", ImVec2(width, height)) && enabled;
    ImGui::PopID();
    const bool hovered = enabled && ImGui::IsItemHovered();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    draw->AddRectFilled(min + ImVec2(0, 3), max + ImVec2(0, 3), IM_COL32(0, 0, 0, 90), 8.0f);
    draw->AddRectFilled(min, max, !enabled ? IM_COL32(120, 112, 70, 255) : hovered ? IM_COL32(255, 210, 26, 255) : kYellow, 8.0f);
    // rayas diagonales sutiles (repeating-linear-gradient de 60 grados)
    draw->PushClipRect(min + ImVec2(2, 2), max - ImVec2(2, 2), true);
    for (float x = min.x - 40.0f; x < max.x + 40.0f; x += 8.0f)
        draw->AddLine(ImVec2(x, max.y), ImVec2(x + 22.0f, min.y), White(0.08f), 2.0f);
    draw->PopClipRect();
    draw->AddRect(min, max, kInk, 8.0f, 0, 3.0f);
    AddSpacedText(draw, g_fonts.primary, primarySize, ImVec2(min.x + (width - textWidth) * 0.5f, (min.y + max.y) * 0.5f - primarySize * 0.42f), kInk,
                  upper.c_str(), spacing);
    return pressed;
}

bool Slider(const char* id, float* value01, float width) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    ImGui::PushID(id);
    ImGui::InvisibleButton("##deslizador", ImVec2(width, 20.0f));
    ImGui::PopID();
    const ImVec2 min = ImGui::GetItemRectMin();
    const ImVec2 max = ImGui::GetItemRectMax();
    const float left = min.x + 7.0f;
    const float right = max.x - 7.0f;
    bool changed = false;
    if (ImGui::IsItemActive()) {
        const float next = std::clamp((ImGui::GetIO().MousePos.x - left) / std::max(1.0f, right - left), 0.0f, 1.0f);
        if (next != *value01) {
            *value01 = next;
            changed = true;
        }
    }
    const float centerY = (min.y + max.y) * 0.5f;
    const float knobX = left + (right - left) * std::clamp(*value01, 0.0f, 1.0f);
    draw->AddRectFilled(ImVec2(left, centerY - 2.0f), ImVec2(right, centerY + 2.0f), IM_COL32(190, 196, 206, 255), 2.0f);
    draw->AddRectFilled(ImVec2(left, centerY - 2.0f), ImVec2(knobX, centerY + 2.0f), IM_COL32(39, 174, 96, 255), 2.0f);
    draw->AddCircleFilled(ImVec2(knobX, centerY), 7.0f, IM_COL32(39, 174, 96, 255), 16);
    draw->AddCircle(ImVec2(knobX, centerY), 7.0f, IM_COL32(20, 90, 50, 255), 16, 1.5f);
    return changed;
}

void NoteText(const char* text) {
    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.78f, 0.84f, 0.95f, 0.65f));
    ImGui::TextWrapped("%s", text);
    ImGui::PopStyleColor();
}

void KeyHint(const char* key, const char* description) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    ImFont* font = g_fonts.mono12;
    const ImVec2 keySize = font->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, key);
    const ImVec2 at = ImGui::GetCursorScreenPos();
    const ImVec2 chipMin = at + ImVec2(0.0f, 1.0f);
    const ImVec2 chipMax = chipMin + ImVec2(keySize.x + 10.0f, 19.0f);
    draw->AddRectFilled(chipMin, chipMax, IM_COL32(51, 51, 51, 255), 3.0f);
    draw->AddRect(chipMin, chipMax, IM_COL32(85, 85, 85, 255), 3.0f);
    draw->AddText(font, 12.0f, chipMin + ImVec2(5.0f, 2.5f), IM_COL32(255, 209, 102, 255), key);
    draw->AddText(font, 12.0f, ImVec2(chipMax.x + 6.0f, chipMin.y + 2.5f), IM_COL32(200, 206, 216, 255), description);
    ImGui::Dummy(ImVec2(1.0f, 23.0f));
}

void StatBar(float fraction, ImU32 fill, float width, float height, bool critical) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 min = ImGui::GetCursorScreenPos();
    const ImVec2 max = min + ImVec2(width, height);
    draw->AddRectFilled(min, max, IM_COL32(34, 34, 34, 255));
    const float inner = std::clamp(fraction, 0.0f, 1.0f) * (width - 2.0f);
    draw->AddRectFilled(min + ImVec2(1, 1), min + ImVec2(1.0f + inner, height - 1.0f), fill);
    draw->AddRect(min, max, critical ? IM_COL32(192, 57, 43, 255) : IM_COL32(68, 68, 68, 255));
    ImGui::Dummy(ImVec2(width, height));
}

} // namespace Bazuko::SignUI
