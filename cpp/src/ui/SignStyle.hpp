#pragma once
// Estilo visual del juego original (web): menus como senal informativa azul con filete blanco,
// botones oscuros en monoespaciada y HUD plano. Todo se dibuja con ImGui, sin emojis ni imagenes.
#include <imgui.h>
#include <string>

namespace Bazuko::SignUI {

enum class Icon {
    None, Pause, Close, Sound, Mute, Bolt, Chart, Gear, Radio, Save, Compass, Person, Home, Star, Book, Bag, Paw,
    Check, Bread, Drop, Energy, Pill, Soap, Heart, Flame, Eye, Camera, Keyboard, Pin, Gauge, Walk, Plus, Minus, Target, Expand
};

struct Fonts {
    ImFont* body = nullptr;       // texto general: monoespaciada 13
    ImFont* mono12 = nullptr;
    ImFont* mono11 = nullptr;
    ImFont* mono14 = nullptr;
    ImFont* monoBold12 = nullptr;
    ImFont* monoBold13 = nullptr;
    ImFont* monoBold14 = nullptr;
    ImFont* sub = nullptr;        // Overpass 13 (subtitulos)
    ImFont* title = nullptr;      // Overpass Black 22
    ImFont* primary = nullptr;    // Overpass Black 16 (boton amarillo)
};

// Overpass en negrita (700) o negra (900) a `px` pixeles CSS (9..26), con la compensacion de alto de linea ya aplicada.
ImFont* Ov(bool black, int px);
// Cargar antes del primer fotograma. Usa Overpass (assets/fonts) y Consolas de Windows si existe.
void LoadFonts();
const Fonts& GetFonts();
// Colores base de ImGui (ventanas, botones, deslizadores) al estilo del juego web.
void ApplyTheme();

// Texto en mayusculas (ASCII y letras latinas acentuadas de UTF-8).
std::string Upper(const std::string& text);
float SpacedTextWidth(ImFont* font, float size, const char* text, float spacing);
void AddSpacedText(ImDrawList* draw, ImFont* font, float size, ImVec2 position, ImU32 color, const char* text, float spacing);
// Texto con sombra negra suave, como el text-shadow del HUD web.
void AddShadowText(ImDrawList* draw, ImFont* font, float size, ImVec2 position, ImU32 color, const char* text);
void DrawIcon(ImDrawList* draw, Icon icon, ImVec2 center, float size, float alpha = 1.0f);

// ---- Menus (senal azul) ----
// Dibuja la senal centrada con cabecera y abre el cuerpo desplazable. Siempre hay que llamar a EndMenu().
// `closeRequested` se pone en true al pulsar la X; si es nullptr no se dibuja la X.
bool BeginMenu(const char* id, const char* title, const char* subtitle, Icon icon, bool* closeRequested,
               float width = 560.0f, float height = 680.0f);
// Cierra el cuerpo y deja el cursor en el pie (boton principal).
void BeginFooter();
void EndMenu();
void DrawBackdrop(float alpha = 0.55f);

// Panel oscuro con titulo dorado (seccion del menu de pausa).
bool BeginSection(const char* title, Icon icon);
void EndSection();

// Fila de lista (zebra) con boton pequeno a la derecha, como .row del juego web.
bool BeginRow(const char* id, int index);
// Primera linea de una fila con boton de 30 px: devuelve la Y de la fila y baja el texto para centrarlo con el boton.
float RowBegin();
// Coloca el cursor en la misma fila, en la columna derecha (x) y a la altura del boton.
void RowCluster(float rowTop, float x);
// Coloca el cursor bajo la primera linea para las descripciones.
void RowBelow(float rowTop);
void EndRow();
bool RowButton(const char* label, bool enabled = true, bool primary = false);
float RowButtonWidth(const char* label);

// Botones. Se acomodan en filas (flex-wrap) tras llamar a FlexReset().
void FlexReset();
bool Button(const char* label, Icon icon = Icon::None, bool selected = false, bool danger = false);
// Boton amarillo de la senal; `fullWidth` lo estira.
bool PrimaryButton(const char* label, bool fullWidth = false, bool enabled = true, float height = 38.0f, float minWidth = 0.0f);
// Deslizador de volumen (verde). Devuelve true si cambia.
bool Slider(const char* id, float* value01, float width);
// Nota tenue que se ajusta al ancho (reemplaza a TextDisabled en los menus).
void NoteText(const char* text);
// Tecla resaltada ([kbd]) seguida de texto.
void KeyHint(const char* key, const char* description);
// Barra de estado del HUD (160x10, fondo oscuro y borde gris).
void StatBar(float fraction, ImU32 fill, float width = 160.0f, float height = 10.0f, bool critical = false);

// ---- Widgets del menu de pausa del juego web (Overpass, .btn, .pause-section...) ----
namespace Web {
constexpr ImU32 kBlue = IM_COL32(11, 79, 163, 255);
constexpr ImU32 kBlueText = IM_COL32(214, 228, 255, 255);
constexpr ImU32 kYellow = IM_COL32(246, 196, 0, 255);
constexpr ImU32 kInk = IM_COL32(14, 15, 18, 255);
constexpr ImU32 kCarcasa = IM_COL32(21, 23, 28, 255);
// Texto con tracking y fuente Overpass; devuelve el ancho dibujado.
float Text(ImDrawList* draw, ImFont* font, ImVec2 pos, ImU32 color, const char* text, float spacing = 0.0f);
float TextWidth(ImFont* font, const char* text, float spacing = 0.0f);
// .btn: oscuro con filete blanco (ghost) o amarillo (primary). Devuelve true al pulsar. `px` es el tamano de letra (14 = btn--small).
bool Button(const char* id, const char* label, Icon icon = Icon::None, bool primary = false, bool disabled = false, float height = 40.0f, int px = 14,
            float minWidth = 0.0f, float fixedWidth = 0.0f);
float ButtonWidth(const char* label, Icon icon, int px, float minWidth = 0.0f);
// Panel .pause-section: fondo oscuro translucido con filete; el contenido va con relleno 14 x 12. `height` 0 = se ajusta al contenido.
bool BeginPanel(const char* id, float width, float height = 0.0f, ImVec2 padding = ImVec2(14.0f, 12.0f), bool dashed = false);
void EndPanel();
// Titulo de seccion (amarillo, 13 px, mayusculas con tracking)
void SectionTitle(const char* title, Icon icon = Icon::None);
// Deslizador amarillo (.pause-slider). Devuelve true si cambia.
bool Slider(const char* id, float* value, float minValue, float maxValue, float step, float width);
// Medidor (.pause-meter)
void Meter(float fraction, ImU32 fill, float width, float height = 12.0f);
// <kbd> blanca de la lista de controles
float Kbd(const char* text, bool inline_ = true);
// Insignia de tecla de las pestanas (Q / E)
void TabKey(ImDrawList* draw, ImVec2 center, const char* text);
} // namespace Web

} // namespace Bazuko::SignUI
