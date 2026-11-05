#include "render/ProceduralTextures.h"

#include <algorithm>
#include <cmath>
#include <string>
#include <vector>

#include "core/MathTypes.h"
#include "render/Canvas2D.h"

namespace bazuko::tex {

namespace {

using Rng = Mulberry32Rng;

template <class T>
const T& pick(Rng& r, const std::vector<T>& v) { return v[static_cast<size_t>(std::floor(r.next() * v.size()))]; }

void speckle(Canvas2D& c, Rng& r, double w, double h, long count, const std::vector<std::string>& colors, double maxSize = 2) {
    for (long i = 0; i < count; ++i) {
        c.fillStyle(pick(r, colors));
        const double s = 0.5 + r.next() * maxSize;
        const double x = r.next() * w, y = r.next() * h;
        c.fillRect(x, y, s, s);
    }
}

// Mancha radial que se desvanece: 'rgba(c, a)' en el centro, transparente en el borde.
void blob(Canvas2D& c, double px, double py, double pr, const std::string& inner, const std::string& outer = "rgba(0,0,0,0)") {
    c.fillStyle(Gradient::radial(px, py, 0, pr).stop(0, inner).stop(1, outer));
    c.fillRect(px - pr, py - pr, pr * 2, pr * 2);
}

const std::vector<std::string> kWalls = {"#c9a46a", "#b8695a", "#7f9aa8", "#d8c9a3", "#8fa37a",
                                         "#c27f4a", "#a7a29a", "#b58fa8", "#d2b48c", "#6d8c9e"};
const std::vector<std::string> kSmallSigns = {"SE ARRIENDA", "SE VENDE", "MINUTOS", "RECARGAS",
                                              "CERRAJERÍA", "MODISTERÍA", "SE HACEN UÑAS", "FOTOCOPIAS"};
const std::vector<std::string> kTags = {"KLAN", "LUZ", "ZONA 7", "RBQ", "LA 33", "PARCE", "ÑERO", "CALLE"};

// Ladrillo tolete a la vista en un rectángulo del canvas (pxPerM = píxeles por metro).
void brickWall(Canvas2D& x, Rng& r, double x0, double y0, double w, double h, double pxPerM = 36) {
    x.fillStyle("#5a4436");
    x.fillRect(x0, y0, w, h);
    const double bw = kBrickW * pxPerM, bh = kBrickH * pxPerM;
    static const std::vector<std::string> tones = {"#8a4b32", "#7d4430", "#94553a", "#6e3b2a", "#a05f40", "#85482f"};
    int row = 0;
    for (double y = y0; y < y0 + h; ++row, y += bh) {
        const double off = row % 2 ? bw / 2 : 0;
        for (double bx = x0 - bw; bx < x0 + w + bw; bx += bw) {
            x.fillStyle(pick(r, tones));
            x.fillRect(bx + off + 1, y + 1, bw - 2, bh - 2);
        }
    }
}


}  // namespace

Image asphalt(unsigned seed, int size) {
    Rng r(seed);
    Canvas2D x(size, size);
    x.fillStyle("#17191c");
    x.fillRect(0, 0, size, size);
    speckle(x, r, size, size, static_cast<long>(size) * 60, {"#202328", "#121316", "#2a2d31", "#1b1d20", "#0d0e10"}, 2.2);

    // parches de brea y reparaciones
    for (int i = 0; i < 14; ++i) {
        const double ppx = r.next() * size, ppy = r.next() * size, pr = 30 + r.next() * 120;
        blob(x, ppx, ppy, pr, r.next() > 0.5 ? "rgba(8,8,10,0.55)" : "rgba(40,42,46,0.35)");
    }
    // grietas
    x.strokeStyle("rgba(5,5,6,0.8)");
    for (int i = 0; i < 22; ++i) {
        double ppx = r.next() * size, ppy = r.next() * size;
        x.lineWidth(0.6 + r.next() * 1.6);
        std::vector<std::pair<double, double>> pts = {{ppx, ppy}};
        for (int k = 0; k < 18; ++k) {
            ppx += (r.next() - 0.5) * 22;
            ppy += (r.next() - 0.5) * 22;
            pts.emplace_back(ppx, ppy);
        }
        x.polyline(pts);
    }
    // charcos: apenas oscuros (sin reflejo se verían como huecos)
    for (int i = 0; i < 26; ++i) {
        const double ppx = r.next() * size, ppy = r.next() * size;
        const double rx = 30 + r.next() * 110, ry = 18 + r.next() * 70, rot = r.next() * kPi;
        x.save();
        x.translate(ppx, ppy);
        x.rotate(rot);
        x.scale(1, ry / rx);
        x.fillStyle(Gradient::radial(0, 0, rx * 0.35, rx).stop(0, "rgba(6,7,9,0.16)").stop(1, "rgba(6,7,9,0)"));
        x.fillCircle(0, 0, rx);
        x.restore();
    }
    return x.toImage();
}

Image sidewalk(unsigned seed) {
    Rng r(seed);
    const int s = 512;
    Canvas2D x(s, s);
    x.fillStyle("#5b5d5f");
    x.fillRect(0, 0, s, s);
    const int tile = 64;
    for (int ty = 0; ty < s; ty += tile) {
        for (int tx = 0; tx < s; tx += tile) {
            const int v = 80 + static_cast<int>(std::floor(r.next() * 26));
            x.fillStyle("rgb(" + std::to_string(v) + "," + std::to_string(v + 2) + "," + std::to_string(v + 4) + ")");
            x.fillRect(tx + 2, ty + 2, tile - 4, tile - 4);
            if (r.next() < 0.12) {
                x.fillStyle("rgba(30,30,28,0.5)");
                x.fillRect(tx + 2, ty + 2, tile - 4, tile - 4);
            }
        }
    }
    speckle(x, r, s, s, 9000, {"rgba(20,20,20,0.35)", "rgba(200,200,200,0.12)"}, 2);
    for (int i = 0; i < 10; ++i) {
        const double ppx = r.next() * s, ppy = r.next() * s, pr = 20 + r.next() * 60;
        blob(x, ppx, ppy, pr, "rgba(25,22,18,0.55)");
    }
    return x.toImage();
}

Image brick(unsigned seed) {
    Rng r(seed);
    const int w = 512, h = 512;
    Canvas2D x(w, h);
    x.fillStyle("#5a4436");
    x.fillRect(0, 0, w, h);
    const int bw = 64, bh = 24;
    static const std::vector<std::string> tones = {"#8a4b32", "#7d4430", "#94553a", "#6e3b2a", "#a05f40"};
    int row = 0;
    for (int y = 0; y < h; ++row, y += bh) {
        const int off = row % 2 ? bw / 2 : 0;
        for (int bx = -bw; bx < w + bw; bx += bw) {
            x.fillStyle(pick(r, tones));
            x.fillRect(bx + off + 2, y + 2, bw - 4, bh - 4);
        }
    }
    speckle(x, r, w, h, 12000, {"rgba(0,0,0,0.25)", "rgba(255,220,190,0.08)"}, 2);
    x.fillStyle(Gradient::linear(0, h, 0, h * 0.4).stop(0, "rgba(15,12,10,0.65)").stop(1, "rgba(15,12,10,0)"));
    x.fillRect(0, 0, w, h);
    return x.toImage();
}

Image roofTiles(unsigned seed) {
    Rng r(seed);
    const int s = 256;
    Canvas2D x(s, s);
    x.fillStyle("#5b2a1a");
    x.fillRect(0, 0, s, s);
    const int tw = 16, th = 24;  // 12,5 cm x 18 cm por teja
    static const std::vector<std::string> bases = {"#9a4a2c", "#8a3f26", "#a85a36", "#7d3a22", "#93502f"};
    int row = 0;
    for (int y = 0; y < s; ++row, y += th) {
        const int off = row % 2 ? tw / 2 : 0;
        for (int tx = -tw; tx < s + tw; tx += tw) {
            const std::string base = pick(r, bases);
            x.fillStyle(Gradient::linear(tx + off, 0, tx + off + tw, 0)
                            .stop(0, "rgba(40,15,8,0.9)").stop(0.3, base).stop(0.7, base).stop(1, "rgba(40,15,8,0.9)"));
            x.fillRect(tx + off, y, tw - 1, th - 2);
        }
    }
    speckle(x, r, s, s, 2500, {"rgba(60,80,40,0.35)", "rgba(0,0,0,0.3)", "rgba(255,220,180,0.08)"}, 2.5);
    return x.toImage();
}

Image slab(unsigned seed) {
    Rng r(seed);
    const int s = 256;
    Canvas2D x(s, s);
    x.fillStyle("#6e6a64");
    x.fillRect(0, 0, s, s);
    speckle(x, r, s, s, 9000, {"#7a766f", "#5f5b55", "#837e76", "#55524d"}, 2);
    for (int i = 0; i < 7; ++i) {
        const double ppx = r.next() * s, ppy = r.next() * s, pr = 20 + r.next() * 60;
        blob(x, ppx, ppy, pr, "rgba(30,28,25,0.45)", "rgba(30,28,25,0)");
    }
    return x.toImage();
}

Image cardboard(unsigned seed) {
    Rng r(seed);
    const int s = 256;
    Canvas2D x(s, s);
    x.fillStyle("#9a7449");
    x.fillRect(0, 0, s, s);
    for (int i = 0; i < s; i += 4) {
        x.fillStyle(i % 8 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.05)");
        x.fillRect(0, i, s, 2);
    }
    speckle(x, r, s, s, 3000, {"rgba(60,40,20,0.3)", "rgba(255,230,190,0.1)"}, 2);
    for (int i = 0; i < 6; ++i) {
        const double ppx = r.next() * s, ppy = r.next() * s, pr = 20 + r.next() * 50;
        blob(x, ppx, ppy, pr, "rgba(50,32,15,0.55)");
    }
    x.fillStyle("rgba(20,20,20,0.75)");
    x.font(900, 26);
    x.fillText("FRÁGIL", 20, 210);
    return x.toImage();
}

Image trashBag(unsigned seed) {
    Rng r(seed);
    const int s = 128;
    Canvas2D x(s, s);
    x.fillStyle("#121315");
    x.fillRect(0, 0, s, s);
    for (int i = 0; i < 40; ++i) {
        x.strokeStyle("rgba(255,255,255," + std::to_string(0.03 + r.next() * 0.06) + ")");
        x.lineWidth(1 + r.next() * 2);
        const double y = r.next() * s;
        const double c1 = y + (r.next() - 0.5) * 30, c2 = y + (r.next() - 0.5) * 30, e = y + (r.next() - 0.5) * 20;
        x.bezier(0, y, s * 0.3, c1, s * 0.6, c2, s, e);
    }
    return x.toImage();
}

Image dirt(unsigned seed) {
    Rng r(seed);
    const int s = 512;
    Canvas2D x(s, s);
    x.fillStyle("#3a3027");
    x.fillRect(0, 0, s, s);
    speckle(x, r, s, s, 30000, {"#2c241d", "#463a2f", "#51443a", "#231d18", "#5a5045"}, 2.5);
    for (int i = 0; i < 18; ++i) {
        const double ppx = r.next() * s, ppy = r.next() * s, pr = 20 + r.next() * 70;
        blob(x, ppx, ppy, pr, "rgba(12,10,8,0.6)");
    }
    return x.toImage();
}

Image concrete(unsigned seed) {
    Rng r(seed);
    const int s = 512;
    Canvas2D x(s, s);
    x.fillStyle("#6f6e6a");
    x.fillRect(0, 0, s, s);
    speckle(x, r, s, s, 26000, {"#62615d", "#7b7a76", "#565551", "#858480"}, 2);
    for (int i = 0; i < 10; ++i) {
        const double sx = r.next() * s;
        x.fillStyle(Gradient::linear(0, 0, 0, s).stop(0, "rgba(25,25,22,0.5)").stop(1, "rgba(25,25,22,0)"));
        x.fillRect(sx, 0, 8 + r.next() * 30, s);
    }
    // grafiti grande en las columnas
    x.save();
    x.font(900, 120);
    x.textAlign(TextAlign::Center);
    x.translate(s / 2.0, s * 0.62);
    x.rotate(-0.08);
    x.lineWidth(10);
    x.strokeStyle("#121212");
    x.fillStyle("#2ee6a6");
    x.strokeText("RBQ", 0, 0);
    x.fillText("RBQ", 0, 0);
    x.restore();
    return x.toImage();
}

Facade facade(const FacadeParams& p) {
    Rng r(p.seed);
    const double pxPerM = p.pxPerM;
    const int w = std::max(64, static_cast<int>(std::lround(p.width * pxPerM)));
    const double fh = 3 * pxPerM;
    const int floors = p.floors;
    const int h = static_cast<int>(std::lround(floors * fh));
    Canvas2D x(w, h), xe(w, h);
    xe.fillStyle("#000");
    xe.fillRect(0, 0, w, h);

    const std::string wall = pick(r, kWalls);
    const bool ruin = p.style == FacadeStyle::Ruina;
    if (p.style == FacadeStyle::Ladrillo) {
        brickWall(x, r, 0, 0, w, h, pxPerM);
    } else {
        static const std::vector<std::string> ruinWalls = {"#8c8070", "#7a6e62", "#9a8a6a", "#6f6a60"};
        x.fillStyle(ruin ? pick(r, ruinWalls) : wall);
        x.fillRect(0, 0, w, h);
        if (ruin) {
            // pañete caído: se ve el ladrillo
            const double patches = 4 + r.next() * 6;
            for (int i = 0; i < patches; ++i) {
                const double pw = w * (0.08 + r.next() * 0.25), ph = h * (0.06 + r.next() * 0.2);
                const double ppx = r.next() * (w - pw), ppy = r.next() * (h - ph);
                brickWall(x, r, ppx, ppy, pw, ph, pxPerM);
            }
        }
    }
    speckle(x, r, w, h, static_cast<long>(w * h * 0.04), {"rgba(0,0,0,0.12)", "rgba(255,255,255,0.06)"}, 2);

    // pintura vieja por pisos (cada piso lo pintó otro dueño)
    for (int f = 1; f < floors; ++f) {
        if (p.style == FacadeStyle::Pintada && r.next() < 0.45) {
            x.fillStyle(pick(r, kWalls));
            x.globalAlpha(0.85);
            x.fillRect(0, h - (f + 1) * fh, w, fh);
            x.globalAlpha(1);
        }
        x.fillStyle("rgba(0,0,0,0.25)");
        x.fillRect(0, h - f * fh - 4, w, 6);
    }

    const int cols = std::max(1, static_cast<int>(std::lround(p.width / 3.2)));
    const double cw = static_cast<double>(w) / cols;
    for (int f = p.shopFront ? 1 : 0; f < floors; ++f) {
        const double y0 = h - (f + 1) * fh;
        for (int k = 0; k < cols; ++k) {
            if (r.next() < 0.12) continue;
            const double ww = cw * (0.42 + r.next() * 0.2);
            const double wh = fh * (0.42 + r.next() * 0.12);
            const double wx = k * cw + (cw - ww) / 2;
            const double wy = y0 + fh * 0.22;
            const double lit = ruin ? r.next() * 4 : r.next();
            std::string glass = "#0d1218", emis;
            if (ruin && r.next() < 0.55) {
                // ventana tapiada con tablas
                x.fillStyle("#1a1612");
                x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
                for (int t = 0; t < 4; ++t) {
                    static const std::vector<std::string> boards = {"#6b5a40", "#5a4a33", "#7a684a"};
                    x.fillStyle(pick(r, boards));
                    x.save();
                    x.translate(wx + ww / 2, wy + (t + 0.5) * (wh / 4));
                    x.rotate((r.next() - 0.5) * 0.25);
                    x.fillRect(-ww * 0.6, -wh / 10, ww * 1.2, wh / 5);
                    x.restore();
                }
                continue;
            }
            if (lit < 0.22) { glass = "#ffb766"; emis = "#ff9e45"; }
            else if (lit < 0.3) { glass = "#a9c8ff"; emis = "#6f9dff"; }
            else if (lit < 0.36) { glass = "#e9fbff"; emis = "#c9ecff"; }
            x.fillStyle(p.style == FacadeStyle::Ladrillo ? "#e8e3d6" : "#2a2a2a");
            x.fillRect(wx - 3, wy - 3, ww + 6, wh + 6);
            x.fillStyle(glass);
            x.fillRect(wx, wy, ww, wh);
            if (!emis.empty()) {
                // cortina a medio cerrar
                xe.fillStyle(emis);
                xe.fillRect(wx, wy, ww, wh);
                if (r.next() < 0.6) {
                    static const std::vector<std::string> curtains = {"#7a2c2c", "#2c4d7a", "#6b6b2a", "#3b2a55"};
                    x.fillStyle(pick(r, curtains));
                    x.globalAlpha(0.75);
                    x.fillRect(wx, wy, ww * (0.3 + r.next() * 0.3), wh);
                    x.globalAlpha(1);
                    xe.fillStyle("rgba(0,0,0,0.7)");
                    xe.fillRect(wx, wy, ww * 0.35, wh);
                }
            }
            // rejas
            x.strokeStyle("rgba(20,20,20,0.9)");
            x.lineWidth(2);
            const int bars = std::max(3, static_cast<int>(std::lround(ww / 9)));
            for (int b = 1; b < bars; ++b) {
                const double bx = wx + (ww / bars) * b;
                x.line(bx, wy, bx, wy + wh);
            }
            x.line(wx, wy + wh / 2, wx + ww, wy + wh / 2);
            // chorreado bajo el alféizar
            x.fillStyle(Gradient::linear(0, wy + wh, 0, wy + wh + fh * 0.6).stop(0, "rgba(25,20,15,0.35)").stop(1, "rgba(25,20,15,0)"));
            x.fillRect(wx, wy + wh + 3, ww, fh * 0.6);
        }
    }

    if (p.shopFront) {
        // primer piso: persianas metálicas con grafiti
        const double y0 = h - fh;
        const int doors = std::max(1, static_cast<int>(std::lround(p.width / 4.2)));
        const double dw = static_cast<double>(w) / doors;
        for (int d = 0; d < doors; ++d) {
            const double dx = d * dw + dw * 0.08, ddw = dw * 0.84, dy = y0 + fh * 0.18, dh = fh * 0.82;
            static const std::vector<std::string> shutters = {"#6d7276", "#5a5f63", "#7b6f5f", "#4b5a52"};
            x.fillStyle(pick(r, shutters));
            x.fillRect(dx, dy, ddw, dh);
            x.fillStyle("rgba(0,0,0,0.3)");
            for (double l = dy; l < dy + dh; l += 5) x.fillRect(dx, l, ddw, 1.5);
            if (r.next() < (ruin ? 1.0 : 0.75)) {
                x.save();
                x.font(900, std::lround(fh * 0.24));
                static const std::vector<std::string> tagColors = {"#ff3b6b", "#2ee6a6", "#ffe14d", "#59b4ff", "#ffffff", "#ff8a1f"};
                x.fillStyle(pick(r, tagColors));
                x.strokeStyle("#111");
                x.lineWidth(4);
                x.translate(dx + ddw * 0.5, dy + dh * 0.55);
                x.rotate((r.next() - 0.5) * 0.3);
                x.textAlign(TextAlign::Center);
                const std::string& tag = pick(r, kTags);
                x.strokeText(tag, 0, 0);
                x.fillText(tag, 0, 0);
                x.restore();
            }
        }
        // avisito de cartulina
        if (r.next() < 0.7) {
            const std::string& txt = pick(r, kSmallSigns);
            const double sw = std::min(w * 0.4, 140.0), sh = fh * 0.16;
            const double sx = r.next() * (w - sw), sy = h - fh * 1.15;
            static const std::vector<std::string> papers = {"#ffffff", "#ffe600", "#ff7a1a", "#7dff5a"};
            x.fillStyle(pick(r, papers));
            x.fillRect(sx, sy, sw, sh);
            x.fillStyle("#c4161c");
            x.font(900, std::lround(sh * 0.62));
            x.textAlign(TextAlign::Center);
            x.textBaseline(TextBaseline::Middle);
            x.fillText(txt, sx + sw / 2, sy + sh / 2 + 1, sw * 0.92);
        }
    }

    // mugre de la base y manchas de humedad
    x.fillStyle(Gradient::linear(0, h, 0, h - fh * (ruin ? 2.2 : 1.2))
                    .stop(0, ruin ? "rgba(15,12,9,0.85)" : "rgba(20,16,12,0.7)").stop(1, "rgba(20,16,12,0)"));
    x.fillRect(0, 0, w, h);
    for (int i = 0; i < 6; ++i) {
        const double sx = r.next() * w;
        x.fillStyle(Gradient::linear(0, 0, 0, h * 0.5).stop(0, "rgba(30,30,25,0.35)").stop(1, "rgba(30,30,25,0)"));
        x.fillRect(sx, 0, 6 + r.next() * 18, h * 0.5);
    }

    Facade out{x.toImage(), xe.toImage()};
    out.map.repeat = out.emissive.repeat = false;  // ClampToEdge
    return out;
}

Image sign(const SignParams& p) {
    Canvas2D x(p.w, p.h);
    x.fillStyle(p.bg);
    x.fillRect(0, 0, p.w, p.h);
    x.strokeStyle(p.fg);
    x.lineWidth(10);
    x.strokeRect(18, 18, p.w - 36, p.h - 36);
    x.fillStyle(p.fg);
    x.textAlign(TextAlign::Center);
    x.textBaseline(TextBaseline::Middle);
    x.font(900, std::lround(p.h * (p.sub.empty() ? 0.5 : 0.36)));
    x.fillText(p.title, p.w / 2.0, p.sub.empty() ? p.h * 0.54 : p.h * 0.42, p.w * 0.9);
    if (!p.sub.empty()) {
        x.fillStyle(p.accent);
        x.font(800, std::lround(p.h * 0.15));
        x.fillText(p.sub, p.w / 2.0, p.h * 0.76, p.w * 0.88);
    }
    Image img = x.toImage();
    img.repeat = false;
    return img;
}

}  // namespace bazuko::tex
