#define IMGUI_DEFINE_MATH_OPERATORS
#include "Carton.hpp"
#include <imgui_internal.h>
#include "../core/Paths.hpp"
#include "../core/Log.hpp"
#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstring>
#include <string>
#include <filesystem>
#include <unordered_map>
#include <vector>

namespace Bazuko::Carton {

namespace {

ImFont* g_fonts[2][64] = {};
bool g_ready = false;
bool g_wet = false;

// numero pseudoaleatorio estable en [-1, 1] para un trazo (semilla + indice)
float Jitter(unsigned int seed, unsigned int index) {
    unsigned int h = seed * 747796405u + index * 2891336453u + 12345u;
    h = ((h >> ((h >> 28u) + 4u)) ^ h) * 277803737u;
    h = (h >> 22u) ^ h;
    return static_cast<float>(h & 0xFFFFu) / 32767.5f - 1.0f;
}

const std::unordered_map<std::string, unsigned int>& Glyphs() {
    static const std::unordered_map<std::string, unsigned int> table = {
        {"pausa", 0xE100}, {"radio", 0xE101}, {"sonido", 0xE102}, {"silencio", 0xE103}, {"foto", 0xE104}, {"vista", 0xE105}, {"costal", 0xE106},
        {"martillo", 0xE107}, {"mas", 0xE108}, {"menos", 0xE109}, {"cerrar", 0xE10A}, {"centrar", 0xE10B}, {"ciudad", 0xE10C}, {"ayuda", 0xE10F},
        {"fogata", 0xE110}, {"comida", 0xE111}, {"chaza", 0xE112}, {"agua", 0xE113}, {"cambuche", 0xE114}, {"reciclar", 0xE115}, {"tienda", 0xE116},
        {"mesa", 0xE117}, {"luna", 0xE118}, {"carreta", 0xE119}, {"perro", 0xE11A}, {"edificio", 0xE11B}, {"parque", 0xE11C}, {"bus", 0xE11D},
        {"bandera", 0xE11E}, {"lago", 0xE11F}, {"gasolina", 0xE120}, {"flecha", 0xE121}, {"sol", 0xE14C}, {"nube", 0xE14D}, {"medioNublado", 0xE14E},
        {"neblina", 0xE14F}, {"llovizna", 0xE150}, {"aguacero", 0xE151}, {"tormenta", 0xE152}, {"viento", 0xE153}, {"rayo", 0xE154}, {"peligro", 0xE156},
        {"chulo", 0xE157}, {"candado", 0xE158}, {"corazon", 0xE159}, {"golpe", 0xE15A}, {"sueno", 0xE15B}, {"persona", 0xE15C}, {"cara", 0xE15D},
        {"enfermo", 0xE15E}, {"correr", 0xE15F}, {"mano", 0xE160}, {"patrulla", 0xE162}, {"sirena", 0xE163}, {"termometro", 0xE165}, {"lupa", 0xE166},
        {"mapa", 0xE167}, {"ajustes", 0xE16C}, {"teclado", 0xE16D}, {"barras", 0xE16E}, {"mando", 0xE16F}, {"nauseas", 0xE170},
    };
    return table;
}

} // namespace

void LoadFonts() {
    // Latin, puntuacion general, flechas, signo menos, vineta, estrella, chulo y la zona privada de dibujos
    static const ImWchar kRanges[] = {0x0020, 0x00FF, 0x2010, 0x203A, 0x2190, 0x21FF, 0x2212, 0x2212, 0x2219, 0x2219, 0x2605, 0x2605, 0x2713, 0x2717, 0xE100, 0xE170, 0};
    const std::string bold = Paths::Find("assets/fonts/DiosLePague-Grueso.ttf");
    const std::string fine = Paths::Find("assets/fonts/DiosLePague-Fino.ttf");
    if (!std::filesystem::exists(bold) || !std::filesystem::exists(fine)) {
        LogWarn("No se encontro la tipografia Dios Le Pague (assets/fonts): se usa la interfaz anterior.");
        return;
    }
    // la fuente mide 1,2 em de ascenso y descenso: ImGui toma el tamano como alto de linea, asi que se compensa
    constexpr float kLine = 1.2f;
    ImGuiIO& io = ImGui::GetIO();
    for (int px : {12, 13, 14, 15, 16, 17, 18, 20, 22, 24, 26, 28, 32, 36, 40, 44, 46, 52}) {
        g_fonts[1][px] = io.Fonts->AddFontFromFileTTF(bold.c_str(), static_cast<float>(px) * kLine, nullptr, kRanges);
        g_fonts[0][px] = io.Fonts->AddFontFromFileTTF(fine.c_str(), static_cast<float>(px) * kLine, nullptr, kRanges);
    }
    g_ready = g_fonts[1][16] && g_fonts[0][16];
}

bool FontsReady() { return g_ready; }

ImFont* Font(bool bold, int px) {
    px = std::clamp(px, 12, 52);
    for (int delta = 0; delta < 52; ++delta) {
        for (int candidate : {px - delta, px + delta}) {
            if (candidate >= 12 && candidate <= 52 && g_fonts[bold ? 1 : 0][candidate]) return g_fonts[bold ? 1 : 0][candidate];
        }
    }
    return ImGui::GetFont();
}

namespace {
std::vector<std::string> g_registered;

ImU32 Invert(ImU32 color) {
    const float r = static_cast<float>((color >> IM_COL32_R_SHIFT) & 0xFF), g = static_cast<float>((color >> IM_COL32_G_SHIFT) & 0xFF), b = static_cast<float>((color >> IM_COL32_B_SHIFT) & 0xFF);
    const float l = std::clamp((0.299f * r + 0.587f * g + 0.114f * b) / 255.0f, 0.0f, 1.0f);
    // amarillo y colores vivos (lo elegido, lo principal) pasan a marcador, y su letra oscura a carton; el resto mezcla marcador y carton
    const float hi = std::max({r, g, b}), lo = std::min({r, g, b});
    const bool vivid = hi - lo > 90.0f && l > 0.35f;
    const float t = vivid ? 1.0f : l;   // 0 = carton claro, 1 = marcador
    const float a = static_cast<float>((color >> IM_COL32_A_SHIFT) & 0xFF);
    const float base[3] = {static_cast<float>((kCarton >> IM_COL32_R_SHIFT) & 0xFF), static_cast<float>((kCarton >> IM_COL32_G_SHIFT) & 0xFF), static_cast<float>((kCarton >> IM_COL32_B_SHIFT) & 0xFF)};
    const float ink[3] = {20.0f, 17.0f, 12.0f};
    const float tape[3] = {233.0f, 219.0f, 180.0f};
    float out[3];
    (void)tape;
    for (int i = 0; i < 3; ++i) out[i] = base[i] * (1.0f - t) + ink[i] * t;
    return IM_COL32(static_cast<int>(out[0]), static_cast<int>(out[1]), static_cast<int>(out[2]), static_cast<int>(a));
}
} // namespace

void RegisterWindow(const char* name) {
    if (std::find(g_registered.begin(), g_registered.end(), name) == g_registered.end()) g_registered.push_back(name);
}

bool IsRegistered(const char* owner) {
    if (!owner) return false;
    for (const std::string& name : g_registered)
        if (std::strncmp(owner, name.c_str(), name.size()) == 0) return true;
    return false;
}

void RemapDrawData(ImDrawData* data) {
    if (!g_ready || !data) return;
    const ImTextureID atlas = ImGui::GetIO().Fonts->TexID;
    for (int n = 0; n < data->CmdListsCount; ++n) {
        ImDrawList* list = data->CmdLists[n];
        if (!IsRegistered(list->_OwnerName)) continue;
        std::vector<uint8_t> done(static_cast<size_t>(list->VtxBuffer.Size), 0);
        for (const ImDrawCmd& cmd : list->CmdBuffer) {
            if (cmd.TextureId != atlas) continue;   // imagenes y mapas conservan sus colores
            for (unsigned int i = 0; i < cmd.ElemCount; ++i) {
                const unsigned int vertex = static_cast<unsigned int>(list->IdxBuffer[static_cast<int>(cmd.IdxOffset + i)]) + cmd.VtxOffset;
                if (vertex >= done.size() || done[vertex]) continue;
                done[vertex] = 1;
                list->VtxBuffer[static_cast<int>(vertex)].col = Invert(list->VtxBuffer[static_cast<int>(vertex)].col);
            }
        }
    }
}

void SetWetness(float wetness) {
    if (!g_wet && wetness >= 0.4f) g_wet = true;   // histeresis del original: moja con 0,4 y seca por debajo de 0,25
    else if (g_wet && wetness < 0.25f) g_wet = false;
}

ImU32 Face() { return g_wet ? kCartonMojado : kCarton; }

unsigned int Glyph(const char* name) {
    const auto it = Glyphs().find(name);
    return it == Glyphs().end() ? 0u : it->second;
}

unsigned int ItemGlyph(const std::string& id) {
    static const std::unordered_map<std::string, unsigned int> items = {
        {"pan", 0xE122}, {"empanada", 0xE111}, {"morcilla", 0xE123}, {"papaCriolla", 0xE124}, {"lataComida", 0xE125}, {"agua", 0xE126},
        {"aguapanela", 0xE127}, {"cafe", 0xE127}, {"tintico", 0xE127}, {"refresco", 0xE128}, {"vendaje", 0xE129}, {"curita", 0xE12A},
        {"jabon", 0xE12B}, {"cepillo", 0xE12C}, {"vacuna", 0xE12D}, {"carbon", 0xE12E}, {"jarabe", 0xE12F}, {"pomada", 0xE130},
        {"antibiotico", 0xE132}, {"antiparasitario", 0xE132}, {"pastilla", 0xE132}, {"pegante", 0xE133}, {"basuco", 0xE134}, {"cigarrillo", 0xE135},
        {"hierba", 0xE136}, {"rifa", 0xE137}, {"arma", 0xE138}, {"cuchillo", 0xE139}, {"botella_picada", 0xE13A}, {"lona", 0xE13B}, {"madera", 0xE13C},
        {"colchon", 0xE13D}, {"vela", 0xE13E}, {"popo", 0xE13F}, {"lata", 0xE140}, {"botella", 0xE141}, {"carton", 0xE142}, {"chatarra", 0xE143},
        {"cable", 0xE144}, {"reloj", 0xE145}, {"moneda", 0xE146}, {"anillo", 0xE147}, {"pilas", 0xE148}, {"retrovisor", 0xE149}, {"radio", 0xE14A},
        {"radioTransistor", 0xE101},
    };
    const auto it = items.find(id);
    return it == items.end() ? 0u : it->second;
}

bool DrawGlyph(ImDrawList* draw, unsigned int glyph, ImVec2 center, float size, ImU32 color) {
    if (!g_ready || glyph == 0) return false;
    // el dibujo ocupa casi el em completo; la fuente mide 1,2 em de alto de linea
    ImFont* font = Font(true, std::clamp(static_cast<int>(size + 0.5f), 12, 52));
    char text[8] = {};
    ImTextCharToUtf8(text, glyph);
    const ImVec2 box = font->CalcTextSizeA(font->FontSize, FLT_MAX, 0.0f, text);
    draw->AddText(font, font->FontSize, ImVec2(center.x - box.x * 0.5f, center.y - box.y * 0.5f), color, text);
    return true;
}

float TextWidth(bool bold, int px, const char* text) {
    ImFont* font = Font(bold, px);
    return font->CalcTextSizeA(font->FontSize, FLT_MAX, 0.0f, text).x;
}

float TextHeight(bool bold, int px, const char* text, float wrapWidth) {
    ImFont* font = Font(bold, px);
    return font->CalcTextSizeA(font->FontSize, FLT_MAX, wrapWidth, text).y;
}

void Text(ImDrawList* draw, bool bold, int px, ImVec2 pos, ImU32 color, const char* text, float wrapWidth) {
    ImFont* font = Font(bold, px);
    draw->AddText(font, font->FontSize, pos, color, text, nullptr, wrapWidth);
}

void TextCentered(ImDrawList* draw, bool bold, int px, ImVec2 center, ImU32 color, const char* text) {
    ImFont* font = Font(bold, px);
    const ImVec2 extent = font->CalcTextSizeA(font->FontSize, FLT_MAX, 0.0f, text);
    draw->AddText(font, font->FontSize, ImVec2(center.x - extent.x * 0.5f, center.y - extent.y * 0.5f), color, text);
}

void Panel(ImDrawList* draw, ImVec2 min, ImVec2 max, unsigned int seed, float cut) {
    // contorno con las cuatro esquinas cortadas a mano (cada una distinta) y los lados apenas torcidos
    const auto outline = [&](ImVec2 offset, ImVec2 grow, std::vector<ImVec2>& points) {
        points.clear();
        const ImVec2 a = min + offset, b = max + offset + grow;
        const float c0 = cut * (0.7f + 0.5f * (Jitter(seed, 0) * 0.5f + 0.5f)), c1 = cut * (0.7f + 0.5f * (Jitter(seed, 1) * 0.5f + 0.5f));
        const float c2 = cut * (0.7f + 0.5f * (Jitter(seed, 2) * 0.5f + 0.5f)), c3 = cut * (0.7f + 0.5f * (Jitter(seed, 3) * 0.5f + 0.5f));
        points.push_back({a.x + c0, a.y});
        points.push_back({(a.x + b.x) * 0.5f, a.y + Jitter(seed, 4) * 1.2f});
        points.push_back({b.x - c1, a.y});
        points.push_back({b.x, a.y + c1});
        points.push_back({b.x + Jitter(seed, 5) * 1.2f, (a.y + b.y) * 0.5f});
        points.push_back({b.x, b.y - c2});
        points.push_back({b.x - c2, b.y});
        points.push_back({(a.x + b.x) * 0.5f, b.y + Jitter(seed, 6) * 1.2f});
        points.push_back({a.x + c3, b.y});
        points.push_back({a.x, b.y - c3});
        points.push_back({a.x + Jitter(seed, 7) * 1.2f, (a.y + b.y) * 0.5f});
        points.push_back({a.x, a.y + c0});
    };
    std::vector<ImVec2> points;
    outline({-2.5f, -2.5f}, {5.0f, 5.0f}, points);   // filo oscuro alrededor: separa el carton de una calle clara u oscura
    draw->AddConvexPolyFilled(points.data(), static_cast<int>(points.size()), IM_COL32(12, 9, 5, 215));
    outline({0.0f, 0.0f}, {0.0f, 0.0f}, points);     // canto: el grueso del carton, abajo y a la derecha
    for (ImVec2& point : points) { point.x += 3.0f; point.y += 4.0f; }
    draw->AddConvexPolyFilled(points.data(), static_cast<int>(points.size()), kCanto);
    outline({0.0f, 0.0f}, {0.0f, 0.0f}, points);
    draw->AddConvexPolyFilled(points.data(), static_cast<int>(points.size()), Face());
    // corrugado: rayas muy suaves, sin imagenes de textura
    const ImU32 groove = IM_COL32(60, 40, 15, 22);
    for (float y = min.y + 9.0f; y < max.y - 5.0f; y += 11.0f)
        draw->AddLine(ImVec2(min.x + 6.0f, y + Jitter(seed, static_cast<unsigned int>(y)) * 0.6f), ImVec2(max.x - 6.0f, y), groove, 1.0f);
}

void HandLine(ImDrawList* draw, ImVec2 a, ImVec2 b, unsigned int seed, float thickness, ImU32 color) {
    const ImVec2 mid((a.x + b.x) * 0.5f + Jitter(seed, 1) * 1.6f, (a.y + b.y) * 0.5f + Jitter(seed, 2) * 1.6f);
    const ImVec2 points[3] = {a + ImVec2(Jitter(seed, 3) * 0.8f, Jitter(seed, 4) * 0.8f), mid, b + ImVec2(Jitter(seed, 5) * 0.8f, Jitter(seed, 6) * 0.8f)};
    draw->AddPolyline(points, 3, color, 0, thickness);
}

void HandCircle(ImDrawList* draw, ImVec2 center, float radiusX, float radiusY, unsigned int seed, ImU32 color, float thickness) {
    constexpr int kSteps = 28;
    ImVec2 points[kSteps + 3];
    const float start = (Jitter(seed, 90) * 0.5f + 0.5f) * 6.2831853f;
    for (int i = 0; i <= kSteps + 2; ++i) {   // la vuelta pasa un poco de largo y no cierra: asi dibuja la mano
        const float t = start + 6.2831853f * static_cast<float>(i) / static_cast<float>(kSteps) * 1.04f;
        const float wobble = 1.0f + 0.045f * Jitter(seed, static_cast<unsigned int>(i % 9)) + 0.03f * static_cast<float>(i) / kSteps;
        points[i] = ImVec2(center.x + std::cos(t) * radiusX * wobble, center.y + std::sin(t) * radiusY * wobble);
    }
    draw->AddPolyline(points, kSteps + 3, color, 0, thickness);
}

void HandRect(ImDrawList* draw, ImVec2 min, ImVec2 max, unsigned int seed, ImU32 color, float thickness) {
    HandLine(draw, min, ImVec2(max.x, min.y), seed + 1, thickness, color);
    HandLine(draw, ImVec2(max.x, min.y), max, seed + 2, thickness, color);
    HandLine(draw, max, ImVec2(min.x, max.y), seed + 3, thickness, color);
    HandLine(draw, ImVec2(min.x, max.y), min, seed + 4, thickness, color);
}

void Hatch(ImDrawList* draw, ImVec2 min, ImVec2 max, float fraction, ImU32 color) {
    fraction = std::clamp(fraction, 0.0f, 1.0f);
    draw->AddRect(min, max, color, 0.0f, 0, 1.5f);
    const float width = (max.x - min.x - 4.0f) * fraction;
    if (width <= 0.0f) return;
    draw->PushClipRect(ImVec2(min.x + 2.0f, min.y + 2.0f), ImVec2(min.x + 2.0f + width, max.y - 2.0f), true);
    for (float x = min.x - (max.y - min.y); x < min.x + width + 4.0f; x += 6.0f)
        draw->AddLine(ImVec2(x, max.y - 2.0f), ImVec2(x + (max.y - min.y), min.y + 2.0f), color, 3.0f);
    draw->PopClipRect();
}

float Key(ImDrawList* draw, ImVec2 pos, const char* label, int px) {
    const float width = std::max(static_cast<float>(px) * 1.25f, TextWidth(true, px, label) + 12.0f);
    const float height = static_cast<float>(px) * 1.35f;
    draw->AddRectFilled(pos, pos + ImVec2(width, height), kMarcador, 2.0f);
    TextCentered(draw, true, px, pos + ImVec2(width * 0.5f, height * 0.5f), kCinta, label);
    return width;
}

bool Tape(const char* id, const char* label, ImVec2 size, bool verb, bool enabled, const char* key, int px) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 min = ImGui::GetCursorScreenPos();
    ImGui::PushID(id);
    const bool pressed = ImGui::InvisibleButton("##cinta", size) && enabled;
    const unsigned int seed = static_cast<unsigned int>(ImGui::GetID("##cinta"));
    ImGui::PopID();
    const bool hovered = enabled && ImGui::IsItemHovered();
    const ImVec2 max = min + size;
    const ImU32 fill = enabled ? (hovered ? IM_COL32(0xF2, 0xE6, 0xC4, 255) : kCinta) : IM_COL32(0xD8, 0xC9, 0xA0, 255);
    draw->AddRectFilled(min + ImVec2(2, 3), max + ImVec2(2, 3), IM_COL32(20, 14, 6, 150));   // canto de la cinta
    if (verb) {   // verbo principal: extremos en zigzag
        std::vector<ImVec2> points;
        const float tooth = std::min(7.0f, size.y * 0.25f);
        int row = 0;
        for (float y = min.y; y <= max.y; y += tooth, ++row) points.push_back({min.x + ((row & 1) ? tooth * 0.7f : 0.0f), y});
        row = static_cast<int>((max.y - min.y) / tooth);
        for (float y = min.y + static_cast<float>(row) * tooth; y >= min.y; y -= tooth, --row) points.push_back({max.x - ((row & 1) ? tooth * 0.7f : 0.0f), y});
        draw->AddConvexPolyFilled(points.data(), static_cast<int>(points.size()), fill);
    } else {
        draw->AddRectFilled(min, max, fill);
        draw->AddRect(min, max, IM_COL32(60, 45, 20, 120), 0.0f, 0, 1.0f);
    }
    const ImU32 ink = enabled ? kMarcador : IM_COL32(0x14, 0x11, 0x0C, 120);
    const float labelWidth = TextWidth(true, px, label);
    const float keyWidth = key ? std::max(static_cast<float>(px - 3) * 1.25f, TextWidth(true, px - 3, key) + 12.0f) + 8.0f : 0.0f;
    const float x = (min.x + max.x - labelWidth - keyWidth) * 0.5f;
    Text(draw, true, px, ImVec2(x, (min.y + max.y) * 0.5f - TextHeight(true, px, label, 0.0f) * 0.5f), ink, label);
    if (key) Key(draw, ImVec2(x + labelWidth + 8.0f, (min.y + max.y) * 0.5f - static_cast<float>(px - 3) * 0.675f), key, px - 3);
    if (!enabled) HandLine(draw, ImVec2(min.x + 6.0f, (min.y + max.y) * 0.5f + 1.0f), ImVec2(max.x - 6.0f, (min.y + max.y) * 0.5f - 1.0f), seed, 2.0f);   // tachado: no disponible
    return pressed;
}

} // namespace Bazuko::Carton
