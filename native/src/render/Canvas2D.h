#pragma once

#include <memory>
#include <string>
#include <vector>

#include "render/Image.h"

namespace bazuko {

struct Color4 {
    float r = 0, g = 0, b = 0, a = 1;  // 0..1, sin premultiplicar
};
// '#rgb', '#rrggbb', 'rgb(r,g,b)', 'rgba(r,g,b,a)'. Lanza std::invalid_argument si no se entiende.
Color4 parseColor(const std::string& css);

// Degradado radial concéntrico o lineal, con paradas de color.
class Gradient {
public:
    static Gradient linear(double x0, double y0, double x1, double y1);
    static Gradient radial(double cx, double cy, double r0, double r1);
    Gradient& stop(double offset, const std::string& css);
    Color4 at(double x, double y) const;

private:
    bool radial_ = false;
    double x0_ = 0, y0_ = 0, x1_ = 0, y1_ = 0, r0_ = 0, r1_ = 1;
    std::vector<std::pair<double, Color4>> stops_;
};

enum class TextAlign { Left, Center, Right };
enum class TextBaseline { Alphabetic, Middle };

struct Font;  // fuente TrueType cargada
class FontLibrary {
public:
    // Carga los TTF de `directory` (Overpass-Black.ttf, Overpass-ExtraBold.ttf). Lanza si faltan.
    static const FontLibrary& instance();
    const Font& forWeight(int weight) const;  // 800 o 900
    ~FontLibrary();

private:
    FontLibrary();
    std::vector<std::unique_ptr<Font>> fonts_;
};

// Subconjunto de la API Canvas 2D implementado en CPU para generar texturas procedurales.
class Canvas2D {
public:
    Canvas2D(int width, int height);

    int width() const { return w_; }
    int height() const { return h_; }

    // --- estado ---
    void fillStyle(const std::string& css) { fillColor_ = parseColor(css); fillGradient_.reset(); }
    void fillStyle(const Gradient& g) { fillGradient_ = std::make_shared<Gradient>(g); }
    void strokeStyle(const std::string& css) { strokeColor_ = parseColor(css); }
    void lineWidth(double w) { lineWidth_ = w; }
    void globalAlpha(double a) { alpha_ = a; }
    void font(int weight, double px) { fontWeight_ = weight; fontPx_ = px; }
    void textAlign(TextAlign a) { align_ = a; }
    void textBaseline(TextBaseline b) { baseline_ = b; }
    void save();
    void restore();
    void translate(double x, double y);
    void rotate(double radians);
    void scale(double sx, double sy);

    // --- dibujo ---
    void fillRect(double x, double y, double w, double h);
    void strokeRect(double x, double y, double w, double h);
    void fillCircle(double cx, double cy, double r);  // equivale a arc(...) + fill()
    void line(double x0, double y0, double x1, double y1);  // trazo con lineWidth
    // Polilínea (curvas de Bézier ya aplanadas por el llamador).
    void polyline(const std::vector<std::pair<double, double>>& points);
    void bezier(double x0, double y0, double c1x, double c1y, double c2x, double c2y, double x1, double y1);
    void fillText(const std::string& utf8, double x, double y, double maxWidth = -1);
    void strokeText(const std::string& utf8, double x, double y, double maxWidth = -1);

    Image toImage(bool srgb = true) const;
    // Color premultiplicado en un píxel (para pruebas).
    Color4 pixel(int x, int y) const;

private:
    struct Affine {
        double a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;  // x' = a x + c y + e ; y' = b x + d y + f
    };
    struct State {
        Affine m;
        Color4 fill{0, 0, 0, 1}, stroke{0, 0, 0, 1};
        std::shared_ptr<Gradient> gradient;
        double lineWidth = 1, alpha = 1, fontPx = 10;
        int fontWeight = 900;
        TextAlign align = TextAlign::Left;
        TextBaseline baseline = TextBaseline::Alphabetic;
    };
    struct Mask {
        int w = 0, h = 0;
        std::vector<float> a;
    };

    // Recorre los píxeles del rectángulo (en píxeles del dispositivo) y mezcla el color con la cobertura
    // que devuelve `coverage(x, y, userUnitsPerPixel)` en coordenadas de usuario.
    template <class Coverage>
    void apply(double bx0, double by0, double bx1, double by1, bool stroke, Coverage coverage);
    void drawText(const std::string& utf8, double x, double y, double maxWidth, bool stroke);
    Mask textMask(const std::string& utf8, double& squeeze, double maxWidth, double& originX, double& originY, double x,
                  double y) const;
    void blend(int x, int y, const Color4& c, float coverage);
    Affine inverse(const Affine& m) const;

    int w_, h_;
    std::vector<float> px_;  // RGBA premultiplicado
    Color4 fillColor_{0, 0, 0, 1}, strokeColor_{0, 0, 0, 1};
    std::shared_ptr<Gradient> fillGradient_;
    double lineWidth_ = 1, alpha_ = 1, fontPx_ = 10;
    int fontWeight_ = 900;
    TextAlign align_ = TextAlign::Left;
    TextBaseline baseline_ = TextBaseline::Alphabetic;
    Affine m_;
    std::vector<State> stack_;
};

}  // namespace bazuko
