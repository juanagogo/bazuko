#include <doctest/doctest.h>

#include "render/Canvas2D.h"
#include "render/ProceduralTextures.h"

using namespace bazuko;
using Approx = doctest::Approx;

static std::uint8_t px(const Image& img, int x, int y, int c) { return img.rgba[(static_cast<size_t>(y) * img.width + x) * 4 + c]; }

TEST_CASE("parseColor entiende hex corto y largo, rgb() y rgba()") {
    auto c = parseColor("#ff8000");
    CHECK(c.r == Approx(1.0f));
    CHECK(c.g == Approx(128 / 255.0f));
    CHECK(parseColor("#fa0").g == Approx(170 / 255.0f));
    auto d = parseColor("rgba(255, 0, 51, 0.5)");
    CHECK(d.b == Approx(0.2f));
    CHECK(d.a == Approx(0.5f));
    CHECK(parseColor("rgb(10,20,30)").a == 1.0f);
    CHECK_THROWS_AS(parseColor("rojo"), std::invalid_argument);
}

TEST_CASE("fillRect pinta con cobertura exacta en bordes enteros") {
    Canvas2D c(8, 8);
    c.fillStyle("#ff0000");
    c.fillRect(2, 2, 4, 4);
    Image img = c.toImage();
    CHECK(px(img, 3, 3, 0) == 255);
    CHECK(px(img, 3, 3, 3) == 255);
    CHECK(px(img, 1, 1, 3) == 0);  // fuera: transparente
    CHECK(px(img, 6, 3, 3) == 0);
}

TEST_CASE("fillRect con borde fraccionario suaviza el contorno") {
    Canvas2D c(4, 1);
    c.fillStyle("#ffffff");
    c.fillRect(0, 0, 1.5, 1);
    CHECK(c.pixel(0, 0).a == Approx(1.0f));
    CHECK(c.pixel(1, 0).a == Approx(0.5f).epsilon(0.01));
    CHECK(c.pixel(2, 0).a == Approx(0.0f));
}

TEST_CASE("globalAlpha y mezcla source-over") {
    Canvas2D c(2, 2);
    c.fillStyle("#000000");
    c.fillRect(0, 0, 2, 2);
    c.fillStyle("#ffffff");
    c.globalAlpha(0.25);
    c.fillRect(0, 0, 2, 2);
    Image img = c.toImage();
    CHECK(px(img, 0, 0, 0) == Approx(64).epsilon(0.02));
    CHECK(px(img, 0, 0, 3) == 255);
}

TEST_CASE("el degradado radial se desvanece del centro al borde") {
    Canvas2D c(64, 64);
    c.fillStyle(Gradient::radial(32, 32, 0, 32).stop(0, "rgba(255,0,0,1)").stop(1, "rgba(255,0,0,0)"));
    c.fillRect(0, 0, 64, 64);
    CHECK(c.pixel(32, 32).a > 0.95f);
    CHECK(c.pixel(48, 32).a == Approx(0.5f).epsilon(0.1));
    CHECK(c.pixel(1, 1).a == Approx(0.0f));
}

TEST_CASE("el degradado lineal respeta sus paradas") {
    Canvas2D c(1, 100);
    c.fillStyle(Gradient::linear(0, 0, 0, 100).stop(0, "#000000").stop(1, "#ffffff"));
    c.fillRect(0, 0, 1, 100);
    Image img = c.toImage();
    CHECK(px(img, 0, 0, 0) < 10);
    CHECK(px(img, 0, 99, 0) > 245);
    CHECK(px(img, 0, 50, 0) == Approx(128).epsilon(0.05));
}

TEST_CASE("las transformaciones giran y escalan el dibujo") {
    Canvas2D c(32, 32);
    c.fillStyle("#00ff00");
    c.save();
    c.translate(16, 16);
    c.rotate(3.14159265 / 4);
    c.fillRect(-4, -4, 8, 8);  // rombo centrado
    c.restore();
    CHECK(c.pixel(16, 16).a == Approx(1.0f));
    CHECK(c.pixel(16, 11).a > 0.5f);   // punta superior del rombo (~5.6 de radio)
    CHECK(c.pixel(11, 11).a < 0.1f);   // la esquina de un cuadrado sin girar quedaría dentro
    c.restore();  // restore sin save no rompe
}

TEST_CASE("líneas y círculos") {
    Canvas2D c(20, 20);
    c.strokeStyle("#ffffff");
    c.lineWidth(2);
    c.line(2, 10, 18, 10);
    CHECK(c.pixel(10, 10).a > 0.9f);
    CHECK(c.pixel(10, 14).a == Approx(0.0f));
    c.fillStyle("#ff00ff");
    c.fillCircle(10, 4, 3);
    CHECK(c.pixel(10, 4).a == Approx(1.0f));
    CHECK(c.pixel(10, 8).a == Approx(0.0f));  // bajo el círculo y sobre la línea
}

TEST_CASE("el texto se dibuja con la fuente Overpass y respeta maxWidth") {
    Canvas2D wide(200, 40), narrow(200, 40);
    for (Canvas2D* c : {&wide, &narrow}) {
        c->fillStyle("#ffffff");
        c->font(900, 30);
        c->textBaseline(TextBaseline::Middle);
    }
    wide.fillText("MINUTOS", 10, 20);
    narrow.fillText("MINUTOS", 10, 20, 60);
    auto extent = [](const Canvas2D& c) {
        int maxX = 0, minX = 1000;
        for (int y = 0; y < c.height(); ++y)
            for (int x = 0; x < c.width(); ++x)
                if (c.pixel(x, y).a > 0.3f) { maxX = std::max(maxX, x); minX = std::min(minX, x); }
        return maxX - minX;
    };
    CHECK(extent(wide) > 80);
    CHECK(extent(narrow) <= 62);
    CHECK(extent(narrow) > 40);  // comprimido, no recortado
}

TEST_CASE("el texto acepta tildes y eñes (UTF-8) y se centra") {
    Canvas2D c(200, 40);
    c.fillStyle("#ffffff");
    c.font(900, 24);
    c.textAlign(TextAlign::Center);
    c.fillText("ÑERO", 100, 30);
    int minX = 1000, maxX = 0;
    for (int y = 0; y < 40; ++y)
        for (int x = 0; x < 200; ++x)
            if (c.pixel(x, y).a > 0.3f) { minX = std::min(minX, x); maxX = std::max(maxX, x); }
    CHECK(maxX > minX);
    CHECK((minX + maxX) / 2.0 == Approx(100).epsilon(0.08));
}

TEST_CASE("strokeText ensancha el contorno") {
    Canvas2D plain(80, 40), outlined(80, 40);
    plain.fillStyle("#fff"); plain.font(900, 28); plain.fillText("A", 20, 30);
    outlined.strokeStyle("#fff"); outlined.font(900, 28); outlined.lineWidth(6); outlined.strokeText("A", 20, 30);
    auto area = [](const Canvas2D& c) { double s = 0; for (int y = 0; y < c.height(); ++y) for (int x = 0; x < c.width(); ++x) s += c.pixel(x, y).a; return s; };
    CHECK(area(outlined) > area(plain) * 1.3);
}

TEST_CASE("las texturas procedurales son deterministas y tienen el tamaño esperado") {
    Image a = tex::sidewalk(11), b = tex::sidewalk(11), c = tex::sidewalk(12);
    CHECK(a.width == 512);
    CHECK(a.rgba == b.rgba);
    CHECK(a.rgba != c.rgba);
    CHECK(a.srgb);
    CHECK(a.repeat);

    CHECK(tex::brick().width == 512);
    CHECK(tex::roofTiles().width == 256);
    CHECK(tex::slab().height == 256);
    CHECK(tex::cardboard().width == 256);
    CHECK(tex::trashBag().width == 128);
    CHECK(tex::dirt().width == 512);
    CHECK(tex::concrete().width == 512);
    CHECK(tex::asphalt(7, 256).width == 256);
    // opacas: todo el lienzo queda cubierto
    for (const Image* img : {&a}) for (int i = 3; i < static_cast<int>(img->rgba.size()); i += 4) REQUIRE(img->rgba[i] == 255);
}

TEST_CASE("la fachada mide ancho*pxPerM por pisos*3m y las ventanas encendidas tienen emisivo") {
    tex::FacadeParams p;
    p.seed = 5; p.width = 6; p.floors = 3; p.pxPerM = 28; p.style = tex::FacadeStyle::Pintada;
    tex::Facade f = tex::facade(p);
    CHECK(f.map.width == 168);
    CHECK(f.map.height == 252);
    CHECK_FALSE(f.map.repeat);
    CHECK(f.emissive.width == f.map.width);
    // con varias semillas aparece al menos una ventana encendida en el mapa emisivo
    int lit = 0;
    for (unsigned seed = 1; seed <= 12; ++seed) {
        p.seed = seed;
        tex::Facade g = tex::facade(p);
        for (size_t i = 0; i < g.emissive.rgba.size(); i += 4)
            if (g.emissive.rgba[i] > 60 || g.emissive.rgba[i + 1] > 60 || g.emissive.rgba[i + 2] > 60) { ++lit; break; }
    }
    CHECK(lit >= 6);
    for (auto style : {tex::FacadeStyle::Ladrillo, tex::FacadeStyle::Ruina}) {
        p.style = style;
        p.pxPerM = 40;
        CHECK(tex::facade(p).map.height == 360);
    }
}

TEST_CASE("el letrero dibuja marco y texto") {
    tex::SignParams sp;
    sp.title = "DROGUERÍA";
    sp.sub = "SALUD Y VIDA";
    sp.w = 768;
    sp.h = 192;
    Image s = tex::sign(sp);
    CHECK(s.width == 768);
    CHECK_FALSE(s.repeat);
    // fondo azul en una esquina y marco blanco a 18 px
    CHECK(px(s, 4, 4, 2) > px(s, 4, 4, 0));
    CHECK(px(s, 384, 18, 0) > 200);
}
