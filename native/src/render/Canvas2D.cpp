#include "render/Canvas2D.h"

#define STB_TRUETYPE_IMPLEMENTATION
#include <stb_truetype.h>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>
#include <stdexcept>

namespace bazuko {

// ---------------------------------------------------------------------------------- colores

namespace {

float clamp01f(double v) { return static_cast<float>(v < 0 ? 0 : v > 1 ? 1 : v); }

int hexDigit(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    throw std::invalid_argument("color inválido");
}

}  // namespace

Color4 parseColor(const std::string& css) {
    Color4 c;
    if (!css.empty() && css[0] == '#') {
        if (css.size() == 7) {
            c.r = (hexDigit(css[1]) * 16 + hexDigit(css[2])) / 255.0f;
            c.g = (hexDigit(css[3]) * 16 + hexDigit(css[4])) / 255.0f;
            c.b = (hexDigit(css[5]) * 16 + hexDigit(css[6])) / 255.0f;
            return c;
        }
        if (css.size() == 4) {
            c.r = hexDigit(css[1]) * 17 / 255.0f;
            c.g = hexDigit(css[2]) * 17 / 255.0f;
            c.b = hexDigit(css[3]) * 17 / 255.0f;
            return c;
        }
    } else if (css.rfind("rgb", 0) == 0) {
        const auto open = css.find('('), close = css.find(')');
        if (open != std::string::npos && close != std::string::npos) {
            std::string inner = css.substr(open + 1, close - open - 1);
            for (char& ch : inner) if (ch == ',') ch = ' ';
            std::istringstream in(inner);
            double r, g, b, a = 1;
            if (in >> r >> g >> b) {
                in >> a;
                return {static_cast<float>(r / 255), static_cast<float>(g / 255), static_cast<float>(b / 255), static_cast<float>(a)};
            }
        }
    }
    throw std::invalid_argument("color CSS no soportado: " + css);
}

// ------------------------------------------------------------------------------ degradados

Gradient Gradient::linear(double x0, double y0, double x1, double y1) {
    Gradient g;
    g.x0_ = x0; g.y0_ = y0; g.x1_ = x1; g.y1_ = y1;
    return g;
}

Gradient Gradient::radial(double cx, double cy, double r0, double r1) {
    Gradient g;
    g.radial_ = true;
    g.x0_ = cx; g.y0_ = cy; g.r0_ = r0; g.r1_ = r1;
    return g;
}

Gradient& Gradient::stop(double offset, const std::string& css) {
    stops_.emplace_back(offset, parseColor(css));
    return *this;
}

Color4 Gradient::at(double x, double y) const {
    double t;
    if (radial_) {
        const double d = std::hypot(x - x0_, y - y0_);
        t = (d - r0_) / std::max(1e-9, r1_ - r0_);
    } else {
        const double dx = x1_ - x0_, dy = y1_ - y0_;
        t = ((x - x0_) * dx + (y - y0_) * dy) / std::max(1e-9, dx * dx + dy * dy);
    }
    t = std::clamp(t, 0.0, 1.0);
    if (stops_.empty()) return {0, 0, 0, 0};
    if (t <= stops_.front().first) return stops_.front().second;
    for (size_t i = 1; i < stops_.size(); ++i) {
        if (t <= stops_[i].first) {
            const auto& [o0, c0] = stops_[i - 1];
            const auto& [o1, c1] = stops_[i];
            const float k = static_cast<float>((t - o0) / std::max(1e-9, o1 - o0));
            // Interpolación en espacio premultiplicado, como los degradados del navegador.
            const float a = c0.a + (c1.a - c0.a) * k;
            const float pr = c0.r * c0.a + (c1.r * c1.a - c0.r * c0.a) * k;
            const float pg = c0.g * c0.a + (c1.g * c1.a - c0.g * c0.a) * k;
            const float pb = c0.b * c0.a + (c1.b * c1.a - c0.b * c0.a) * k;
            return a > 1e-6f ? Color4{pr / a, pg / a, pb / a, a} : Color4{0, 0, 0, 0};
        }
    }
    return stops_.back().second;
}

// ---------------------------------------------------------------------------------- fuentes

struct Font {
    std::vector<unsigned char> data;
    stbtt_fontinfo info;
};

FontLibrary::FontLibrary() {
    for (const char* name : {"Overpass-ExtraBold.ttf", "Overpass-Black.ttf"}) {
        const std::string path = std::string(BAZUKO_ASSETS_DIR) + "/fonts/" + name;
        std::ifstream f(path, std::ios::binary);
        if (!f) throw std::runtime_error("no se pudo abrir la fuente " + path);
        auto font = std::make_unique<Font>();
        font->data.assign(std::istreambuf_iterator<char>(f), {});
        if (!stbtt_InitFont(&font->info, font->data.data(), 0)) throw std::runtime_error("fuente inválida: " + path);
        fonts_.push_back(std::move(font));
    }
}

FontLibrary::~FontLibrary() = default;

const FontLibrary& FontLibrary::instance() {
    static const FontLibrary lib;
    return lib;
}

const Font& FontLibrary::forWeight(int weight) const { return *fonts_[weight >= 900 ? 1 : 0]; }

// ------------------------------------------------------------------------------------ canvas

Canvas2D::Canvas2D(int width, int height) : w_(width), h_(height), px_(static_cast<size_t>(width) * height * 4, 0.0f) {}

void Canvas2D::save() {
    State s;
    s.m = {m_.a, m_.b, m_.c, m_.d, m_.e, m_.f};
    s.fill = fillColor_; s.stroke = strokeColor_; s.gradient = fillGradient_;
    s.lineWidth = lineWidth_; s.alpha = alpha_; s.fontPx = fontPx_; s.fontWeight = fontWeight_;
    s.align = align_; s.baseline = baseline_;
    stack_.push_back(s);
}

void Canvas2D::restore() {
    if (stack_.empty()) return;
    const State& s = stack_.back();
    m_ = {s.m.a, s.m.b, s.m.c, s.m.d, s.m.e, s.m.f};
    fillColor_ = s.fill; strokeColor_ = s.stroke; fillGradient_ = s.gradient;
    lineWidth_ = s.lineWidth; alpha_ = s.alpha; fontPx_ = s.fontPx; fontWeight_ = s.fontWeight;
    align_ = s.align; baseline_ = s.baseline;
    stack_.pop_back();
}

void Canvas2D::translate(double x, double y) {
    m_.e += m_.a * x + m_.c * y;
    m_.f += m_.b * x + m_.d * y;
}

void Canvas2D::rotate(double r) {
    const double c = std::cos(r), s = std::sin(r);
    const double a = m_.a * c + m_.c * s, b = m_.b * c + m_.d * s;
    const double cc = -m_.a * s + m_.c * c, d = -m_.b * s + m_.d * c;
    m_.a = a; m_.b = b; m_.c = cc; m_.d = d;
}

void Canvas2D::scale(double sx, double sy) {
    m_.a *= sx; m_.b *= sx; m_.c *= sy; m_.d *= sy;
}

Canvas2D::Affine Canvas2D::inverse(const Affine& m) const {
    const double det = m.a * m.d - m.b * m.c;
    Affine i;
    i.a = m.d / det; i.b = -m.b / det; i.c = -m.c / det; i.d = m.a / det;
    i.e = -(i.a * m.e + i.c * m.f);
    i.f = -(i.b * m.e + i.d * m.f);
    return i;
}

void Canvas2D::blend(int x, int y, const Color4& c, float coverage) {
    const float a = clamp01f(c.a * alpha_ * coverage);
    if (a <= 0) return;
    float* p = &px_[(static_cast<size_t>(y) * w_ + x) * 4];
    const float inv = 1 - a;
    p[0] = c.r * a + p[0] * inv;
    p[1] = c.g * a + p[1] * inv;
    p[2] = c.b * a + p[2] * inv;
    p[3] = a + p[3] * inv;
}

template <class Coverage>
void Canvas2D::apply(double bx0, double by0, double bx1, double by1, bool stroke, Coverage coverage) {
    const int x0 = std::max(0, static_cast<int>(std::floor(bx0))), y0 = std::max(0, static_cast<int>(std::floor(by0)));
    const int x1 = std::min(w_, static_cast<int>(std::ceil(bx1))), y1 = std::min(h_, static_cast<int>(std::ceil(by1)));
    const Affine inv = inverse(m_);
    const double det = std::abs(m_.a * m_.d - m_.b * m_.c);
    const double perPixel = 1.0 / std::sqrt(std::max(det, 1e-12));  // unidades de usuario por píxel
    for (int y = y0; y < y1; ++y) {
        for (int x = x0; x < x1; ++x) {
            const double dx = x + 0.5, dy = y + 0.5;
            const double ux = inv.a * dx + inv.c * dy + inv.e, uy = inv.b * dx + inv.d * dy + inv.f;
            const float cov = coverage(ux, uy, perPixel);
            if (cov <= 0) continue;
            if (stroke || !fillGradient_) blend(x, y, stroke ? strokeColor_ : fillColor_, cov);
            else blend(x, y, fillGradient_->at(ux, uy), cov);
        }
    }
}

namespace {
struct Bounds {
    double x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18;
    void add(double x, double y) { x0 = std::min(x0, x); y0 = std::min(y0, y); x1 = std::max(x1, x); y1 = std::max(y1, y); }
};
}  // namespace

void Canvas2D::fillRect(double x, double y, double w, double h) {
    if (w <= 0 || h <= 0) return;
    Bounds b;
    for (auto [px, py] : {std::pair{x, y}, {x + w, y}, {x, y + h}, {x + w, y + h}})
        b.add(m_.a * px + m_.c * py + m_.e, m_.b * px + m_.d * py + m_.f);
    apply(b.x0, b.y0, b.x1, b.y1, false, [=](double ux, double uy, double pp) {
        const float cx = clamp01f(0.5 + std::min(ux - x, x + w - ux) / pp);
        const float cy = clamp01f(0.5 + std::min(uy - y, y + h - uy) / pp);
        return cx * cy;
    });
}

void Canvas2D::strokeRect(double x, double y, double w, double h) {
    const double lw = lineWidth_, half = lw / 2;
    const Color4 saved = fillColor_;
    const auto grad = fillGradient_;
    fillColor_ = strokeColor_;
    fillGradient_.reset();
    fillRect(x - half, y - half, w + lw, lw);          // arriba
    fillRect(x - half, y + h - half, w + lw, lw);      // abajo
    fillRect(x - half, y + half, lw, h - lw);          // izquierda
    fillRect(x + w - half, y + half, lw, h - lw);      // derecha
    fillColor_ = saved;
    fillGradient_ = grad;
}

void Canvas2D::fillCircle(double cx, double cy, double r) {
    Bounds b;
    for (auto [px, py] : {std::pair{cx - r, cy - r}, {cx + r, cy - r}, {cx - r, cy + r}, {cx + r, cy + r}})
        b.add(m_.a * px + m_.c * py + m_.e, m_.b * px + m_.d * py + m_.f);
    apply(b.x0, b.y0, b.x1, b.y1, false, [=](double ux, double uy, double pp) {
        return clamp01f(0.5 + (r - std::hypot(ux - cx, uy - cy)) / pp);
    });
}

void Canvas2D::line(double x0, double y0, double x1, double y1) {
    const double half = lineWidth_ / 2;
    const double dx = x1 - x0, dy = y1 - y0, len = std::hypot(dx, dy);
    if (len <= 0) return;
    const double ux = dx / len, uy = dy / len;
    Bounds b;
    for (auto [px, py] : {std::pair{x0 - ux * 0, y0}, {x1, y1}}) {
        for (double sx : {-half, half})
            for (double sy : {-half, half}) {
                const double qx = px + sx, qy = py + sy;
                b.add(m_.a * qx + m_.c * qy + m_.e, m_.b * qx + m_.d * qy + m_.f);
            }
    }
    apply(b.x0, b.y0, b.x1, b.y1, true, [=](double qx, double qy, double pp) {
        const double along = (qx - x0) * ux + (qy - y0) * uy;
        const double across = -(qx - x0) * uy + (qy - y0) * ux;
        const float ca = clamp01f(0.5 + std::min(along, len - along) / pp);
        const float cb = clamp01f(0.5 + (half - std::abs(across)) / pp);
        return ca * cb;
    });
}

void Canvas2D::polyline(const std::vector<std::pair<double, double>>& pts) {
    for (size_t i = 1; i < pts.size(); ++i) line(pts[i - 1].first, pts[i - 1].second, pts[i].first, pts[i].second);
    // Uniones redondeadas: sin ellas los trazos gruesos quedan con huecos en los quiebres.
    const Color4 saved = fillColor_;
    const auto grad = fillGradient_;
    fillColor_ = strokeColor_;
    fillGradient_.reset();
    for (size_t i = 1; i + 1 < pts.size(); ++i) fillCircle(pts[i].first, pts[i].second, lineWidth_ / 2);
    fillColor_ = saved;
    fillGradient_ = grad;
}

void Canvas2D::bezier(double x0, double y0, double c1x, double c1y, double c2x, double c2y, double x1, double y1) {
    std::vector<std::pair<double, double>> pts;
    const int n = 24;
    for (int i = 0; i <= n; ++i) {
        const double t = static_cast<double>(i) / n, u = 1 - t;
        pts.emplace_back(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x1,
                         u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y1);
    }
    polyline(pts);
}

// ------------------------------------------------------------------------------------ texto

namespace {

std::vector<int> decodeUtf8(const std::string& s) {
    std::vector<int> out;
    for (size_t i = 0; i < s.size();) {
        const unsigned char c = static_cast<unsigned char>(s[i]);
        int cp, len;
        if (c < 0x80) { cp = c; len = 1; }
        else if ((c >> 5) == 6) { cp = c & 0x1f; len = 2; }
        else if ((c >> 4) == 14) { cp = c & 0x0f; len = 3; }
        else { cp = c & 0x07; len = 4; }
        for (int k = 1; k < len && i + k < s.size(); ++k) cp = (cp << 6) | (static_cast<unsigned char>(s[i + k]) & 0x3f);
        out.push_back(cp);
        i += len;
    }
    return out;
}

}  // namespace

Canvas2D::Mask Canvas2D::textMask(const std::string& utf8, double& squeeze, double maxWidth, double& originX,
                                  double& originY, double, double) const {
    const Font& font = FontLibrary::instance().forWeight(fontWeight_);
    const float scale = stbtt_ScaleForMappingEmToPixels(&font.info, static_cast<float>(fontPx_));
    int ascent, descent, lineGap;
    stbtt_GetFontVMetrics(&font.info, &ascent, &descent, &lineGap);
    const auto cps = decodeUtf8(utf8);

    double width = 0;
    for (size_t i = 0; i < cps.size(); ++i) {
        int adv, lsb;
        stbtt_GetCodepointHMetrics(&font.info, cps[i], &adv, &lsb);
        width += adv * scale;
        if (i + 1 < cps.size()) width += stbtt_GetCodepointKernAdvance(&font.info, cps[i], cps[i + 1]) * scale;
    }
    squeeze = (maxWidth > 0 && width > maxWidth) ? maxWidth / width : 1.0;

    const int pad = 2 + static_cast<int>(std::ceil(lineWidth_));
    Mask mask;
    mask.w = static_cast<int>(std::ceil(width)) + pad * 2;
    mask.h = static_cast<int>(std::ceil((ascent - descent) * scale)) + pad * 2;
    mask.a.assign(static_cast<size_t>(mask.w) * mask.h, 0.0f);
    const double baselineRow = pad + ascent * scale;

    double pen = pad;
    std::vector<unsigned char> bmp;
    for (size_t i = 0; i < cps.size(); ++i) {
        int x0, y0, x1, y1;
        const float frac = static_cast<float>(pen - std::floor(pen));
        stbtt_GetCodepointBitmapBoxSubpixel(&font.info, cps[i], scale, scale, frac, 0, &x0, &y0, &x1, &y1);
        const int gw = x1 - x0, gh = y1 - y0;
        if (gw > 0 && gh > 0) {
            bmp.assign(static_cast<size_t>(gw) * gh, 0);
            stbtt_MakeCodepointBitmapSubpixel(&font.info, bmp.data(), gw, gh, gw, scale, scale, frac, 0, cps[i]);
            for (int yy = 0; yy < gh; ++yy)
                for (int xx = 0; xx < gw; ++xx) {
                    const int mx = static_cast<int>(std::floor(pen)) + x0 + xx;
                    const int my = static_cast<int>(std::round(baselineRow)) + y0 + yy;
                    if (mx < 0 || my < 0 || mx >= mask.w || my >= mask.h) continue;
                    float& dst = mask.a[static_cast<size_t>(my) * mask.w + mx];
                    dst = std::max(dst, bmp[static_cast<size_t>(yy) * gw + xx] / 255.0f);
                }
        }
        int adv, lsb;
        stbtt_GetCodepointHMetrics(&font.info, cps[i], &adv, &lsb);
        pen += adv * scale;
        if (i + 1 < cps.size()) pen += stbtt_GetCodepointKernAdvance(&font.info, cps[i], cps[i + 1]) * scale;
    }
    originX = pad;
    originY = std::round(baselineRow);
    (void)width;
    return mask;
}

void Canvas2D::drawText(const std::string& utf8, double x, double y, double maxWidth, bool stroke) {
    const Font& font = FontLibrary::instance().forWeight(fontWeight_);
    const float scale = stbtt_ScaleForMappingEmToPixels(&font.info, static_cast<float>(fontPx_));
    int ascent, descent, lineGap;
    stbtt_GetFontVMetrics(&font.info, &ascent, &descent, &lineGap);

    double squeeze = 1, ox = 0, oy = 0;
    Mask mask = textMask(utf8, squeeze, maxWidth, ox, oy, x, y);
    if (mask.w == 0 || mask.h == 0) return;

    if (stroke && lineWidth_ > 0.5) {  // el trazo se aproxima dilatando la máscara medio grosor
        const double r = lineWidth_ / 2;
        const int ir = static_cast<int>(std::ceil(r));
        Mask dil = mask;
        for (int yy = 0; yy < mask.h; ++yy)
            for (int xx = 0; xx < mask.w; ++xx) {
                float best = 0;
                for (int dy = -ir; dy <= ir; ++dy)
                    for (int dx = -ir; dx <= ir; ++dx) {
                        if (dx * dx + dy * dy > r * r + 0.5) continue;
                        const int sx = xx + dx, sy = yy + dy;
                        if (sx < 0 || sy < 0 || sx >= mask.w || sy >= mask.h) continue;
                        best = std::max(best, mask.a[static_cast<size_t>(sy) * mask.w + sx]);
                    }
                dil.a[static_cast<size_t>(yy) * mask.w + xx] = best;
            }
        mask = std::move(dil);
    }

    // Ancho sin comprimir para alinear: se recupera del tamaño de la máscara menos el relleno.
    const int pad = 2 + static_cast<int>(std::ceil(lineWidth_));
    const double textWidth = (mask.w - pad * 2) * squeeze;
    const double alignFactor = align_ == TextAlign::Left ? 0 : align_ == TextAlign::Center ? 0.5 : 1;
    const double left = x - textWidth * alignFactor;
    const double baselineY = y + (baseline_ == TextBaseline::Middle ? (ascent + descent) * 0.5 * scale : 0.0);

    Bounds b;
    for (auto [mx, my] : {std::pair<double, double>{0, 0}, {static_cast<double>(mask.w), 0},
                          {0, static_cast<double>(mask.h)}, {static_cast<double>(mask.w), static_cast<double>(mask.h)}}) {
        const double ux = left + (mx - ox) * squeeze, uy = baselineY + (my - oy);
        b.add(m_.a * ux + m_.c * uy + m_.e, m_.b * ux + m_.d * uy + m_.f);
    }
    apply(b.x0, b.y0, b.x1, b.y1, stroke, [&](double ux, double uy, double) {
        const double mx = (ux - left) / squeeze + ox - 0.5, my = uy - baselineY + oy - 0.5;
        const int ix = static_cast<int>(std::floor(mx)), iy = static_cast<int>(std::floor(my));
        const float fx = static_cast<float>(mx - ix), fy = static_cast<float>(my - iy);
        auto at = [&](int xx, int yy) {
            return xx < 0 || yy < 0 || xx >= mask.w || yy >= mask.h ? 0.0f : mask.a[static_cast<size_t>(yy) * mask.w + xx];
        };
        return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy;
    });
}

void Canvas2D::fillText(const std::string& s, double x, double y, double maxWidth) { drawText(s, x, y, maxWidth, false); }
void Canvas2D::strokeText(const std::string& s, double x, double y, double maxWidth) { drawText(s, x, y, maxWidth, true); }

// ----------------------------------------------------------------------------------- salida

Image Canvas2D::toImage(bool srgb) const {
    Image img;
    img.width = w_;
    img.height = h_;
    img.srgb = srgb;
    img.rgba.resize(static_cast<size_t>(w_) * h_ * 4);
    for (size_t i = 0; i < static_cast<size_t>(w_) * h_; ++i) {
        const float* p = &px_[i * 4];
        const float a = p[3];
        auto enc = [&](float v) { return static_cast<std::uint8_t>(std::lround(clamp01f(a > 0 ? v / a : 0) * 255)); };
        img.rgba[i * 4 + 0] = enc(p[0]);
        img.rgba[i * 4 + 1] = enc(p[1]);
        img.rgba[i * 4 + 2] = enc(p[2]);
        img.rgba[i * 4 + 3] = static_cast<std::uint8_t>(std::lround(clamp01f(a) * 255));
    }
    return img;
}

Color4 Canvas2D::pixel(int x, int y) const {
    const float* p = &px_[(static_cast<size_t>(y) * w_ + x) * 4];
    return {p[0], p[1], p[2], p[3]};
}

}  // namespace bazuko
