#pragma once
// Interfaz de carton y marcador del juego original (docs/identidad-visual.md): toda pieza de informacion es carton con canto y filo oscuro,
// lo que se oprime es cinta, lo elegido va encerrado en un circulo rojo hecho a mano y las letras salen de la tipografia propia «Dios Le Pague»
// (Grueso y Fino), que tambien trae los dibujos de objetos y menus en la zona privada de Unicode.
#include <imgui.h>
#include <string>

namespace Bazuko::Carton {

constexpr ImU32 kCarton = IM_COL32(0xCB, 0xA2, 0x6C, 255);       // cara de toda pieza de informacion
constexpr ImU32 kCartonMojado = IM_COL32(0xBA, 0x8D, 0x56, 255);  // la misma pieza bajo la lluvia
constexpr ImU32 kCanto = IM_COL32(0x3B, 0x29, 0x13, 255);         // el grueso del carton
constexpr ImU32 kMarcador = IM_COL32(0x14, 0x11, 0x0C, 255);      // toda letra y trazo sobre carton
constexpr ImU32 kCinta = IM_COL32(0xE9, 0xDB, 0xB4, 255);         // lo que se oprime
constexpr ImU32 kRojo = IM_COL32(0xAB, 0x1D, 0x17, 255);          // elegido, destino, peligro

// Carga Dios Le Pague (despues de SignUI::LoadFonts, antes del primer fotograma).
void LoadFonts();
bool FontsReady();
// Letra de carton: `bold` = Grueso, si no Fino; `px` es el tamano CSS (se aproxima al mas cercano cargado).
ImFont* Font(bool bold, int px);
// Humedad de la calle 0..1: con 0,4 o mas la cara pasa a carton mojado (hasta que baja de 0,25).
void SetWetness(float wetness);
ImU32 Face();

// Codigo del dibujo de un objeto (id del juego) o de un menu en la tipografia; 0 si no hay.
unsigned int ItemGlyph(const std::string& id);
unsigned int Glyph(const char* name);
// Dibuja un dibujo de la tipografia centrado en `center` con `size` px de alto; false si no hay dibujo.
bool DrawGlyph(ImDrawList* draw, unsigned int glyph, ImVec2 center, float size, ImU32 color);

// Texto (UTF-8) con la letra del carton; devuelve el ancho.
float TextWidth(bool bold, int px, const char* text);
void Text(ImDrawList* draw, bool bold, int px, ImVec2 pos, ImU32 color, const char* text, float wrapWidth = 0.0f);
void TextCentered(ImDrawList* draw, bool bold, int px, ImVec2 center, ImU32 color, const char* text);
float TextHeight(bool bold, int px, const char* text, float wrapWidth);

// Pieza de carton con corte irregular en las esquinas, canto abajo y a la derecha y filo oscuro alrededor.
void Panel(ImDrawList* draw, ImVec2 min, ImVec2 max, unsigned int seed = 1, float cut = 7.0f);
// Linea y circulo a mano (trazo del marcador con leve temblor, fijo por `seed`).
void HandLine(ImDrawList* draw, ImVec2 a, ImVec2 b, unsigned int seed, float thickness = 2.0f, ImU32 color = kMarcador);
void HandCircle(ImDrawList* draw, ImVec2 center, float radiusX, float radiusY, unsigned int seed, ImU32 color = kMarcador, float thickness = 3.0f);
void HandRect(ImDrawList* draw, ImVec2 min, ImVec2 max, unsigned int seed, ImU32 color = kMarcador, float thickness = 2.5f);
// Masa rayada: la cantidad se lee por lo lleno, nunca por un numero.
void Hatch(ImDrawList* draw, ImVec2 min, ImVec2 max, float fraction, ImU32 color = kMarcador);
// Tecla: celda de marcador con letra de cinta.
float Key(ImDrawList* draw, ImVec2 pos, const char* label, int px = 16);
// Ventanas del estilo anterior (senal azul) que se pintan con la paleta de carton: se registran por nombre y, antes de dibujar, sus colores
// se invierten por luminosidad (lo claro pasa a marcador, lo oscuro a carton). Las texturas (mapa, imagenes) no se tocan.
void RegisterWindow(const char* name);
bool IsRegistered(const char* ownerName);
void RemapDrawData(ImDrawData* data);
// Cinta: lo que se oprime. `verb` = extremos en zigzag (el verbo principal); `key` es la tecla opcional. Devuelve true al pulsar.
bool Tape(const char* id, const char* label, ImVec2 size, bool verb = false, bool enabled = true, const char* key = nullptr, int px = 18);

} // namespace Bazuko::Carton
