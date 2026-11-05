#include "render/MeshBuilder.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <map>
#include <utility>

#include <glm/gtc/matrix_inverse.hpp>

namespace bazuko {

void MeshBuilder::setTransform(const glm::mat4& m) {
    m_ = m;
    nm_ = glm::inverseTranspose(glm::mat3(m));
}

void MeshBuilder::vertex(const glm::vec3& p, const glm::vec3& n, const Rgb& c, glm::vec2 uv) {
    const glm::vec3 wp = glm::vec3(m_ * glm::vec4(p, 1.0f));
    glm::vec3 wn = nm_ * n;
    const float len = glm::length(wn);
    if (len > 0) wn /= len;
    for (float f : {wp.x, wp.y, wp.z, wn.x, wn.y, wn.z, static_cast<float>(c.r), static_cast<float>(c.g),
                    static_cast<float>(c.b), uv.x, uv.y, house_})
        vertices_.push_back(f);
}

void MeshBuilder::orient(size_t first) {
    auto pos = [&](std::uint32_t i) { return glm::vec3(vertices_[i * kFloatsPerVertex], vertices_[i * kFloatsPerVertex + 1], vertices_[i * kFloatsPerVertex + 2]); };
    auto nor = [&](std::uint32_t i) { return glm::vec3(vertices_[i * kFloatsPerVertex + 3], vertices_[i * kFloatsPerVertex + 4], vertices_[i * kFloatsPerVertex + 5]); };
    for (size_t t = first; t + 2 < indices_.size(); t += 3) {
        const std::uint32_t a = indices_[t], b = indices_[t + 1], c = indices_[t + 2];
        const glm::vec3 geo = glm::cross(pos(b) - pos(a), pos(c) - pos(a));
        if (glm::dot(geo, nor(a) + nor(b) + nor(c)) < 0) std::swap(indices_[t + 1], indices_[t + 2]);
    }
}

void MeshBuilder::append(const MeshBuilder& o) {
    const auto base = static_cast<std::uint32_t>(vertexCount());
    vertices_.insert(vertices_.end(), o.vertices_.begin(), o.vertices_.end());
    for (auto i : o.indices_) indices_.push_back(base + i);
}

void MeshBuilder::appendWithHouse(const MeshBuilder& o, unsigned id) {
    const auto base = static_cast<std::uint32_t>(vertexCount());
    vertices_.insert(vertices_.end(), o.vertices_.begin(), o.vertices_.end());
    for (size_t v = base; v < vertexCount(); ++v) vertices_[v * kFloatsPerVertex + 11] = static_cast<float>(id);
    for (auto i : o.indices_) indices_.push_back(base + i);
}

void MeshBuilder::tri(const glm::vec3& a, const glm::vec3& b, const glm::vec3& c, const Rgb& color) {
    triangle(a, b, c, color, true);
}

bool MeshBuilder::computeBounds(glm::vec3& lo, glm::vec3& hi) const {
    if (vertices_.empty()) return false;
    lo = glm::vec3(1e30f);
    hi = glm::vec3(-1e30f);
    for (size_t v = 0; v < vertexCount(); ++v) {
        const glm::vec3 p(vertices_[v * kFloatsPerVertex], vertices_[v * kFloatsPerVertex + 1], vertices_[v * kFloatsPerVertex + 2]);
        lo = glm::min(lo, p);
        hi = glm::max(hi, p);
    }
    return true;
}

void MeshBuilder::quad(const glm::vec3& a, const glm::vec3& b, const glm::vec3& c, const glm::vec3& d,
                       const glm::vec3& n, const Rgb& color, glm::vec2 uvA, glm::vec2 uvB, glm::vec2 uvC, glm::vec2 uvD) {
    const auto base = static_cast<std::uint32_t>(vertexCount());
    vertex(a, n, color, uvA);
    vertex(b, n, color, uvB);
    vertex(c, n, color, uvC);
    vertex(d, n, color, uvD);
    // El sentido de giro lo da el orden de las esquinas; se invierte si contradice la normal pedida.
    const glm::vec3 geo = glm::cross(b - a, c - a);
    const bool flip = glm::dot(geo, n) < 0;
    const std::uint32_t tri[6] = {0, 1, 2, 0, 2, 3};
    for (int i = 0; i < 6; i += 3) {
        if (flip) { indices_.push_back(base + tri[i]); indices_.push_back(base + tri[i + 2]); indices_.push_back(base + tri[i + 1]); }
        else { for (int k = 0; k < 3; ++k) indices_.push_back(base + tri[i + k]); }
    }
}

void MeshBuilder::box(const glm::vec3& lo, const glm::vec3& hi, const Rgb& color, bool bottom) {
    quad({lo.x, hi.y, lo.z}, {lo.x, hi.y, hi.z}, {hi.x, hi.y, hi.z}, {hi.x, hi.y, lo.z}, {0, 1, 0}, color);
    quad({hi.x, lo.y, lo.z}, {hi.x, hi.y, lo.z}, {hi.x, hi.y, hi.z}, {hi.x, lo.y, hi.z}, {1, 0, 0}, color);
    quad({lo.x, lo.y, hi.z}, {lo.x, hi.y, hi.z}, {lo.x, hi.y, lo.z}, {lo.x, lo.y, lo.z}, {-1, 0, 0}, color);
    quad({lo.x, lo.y, hi.z}, {hi.x, lo.y, hi.z}, {hi.x, hi.y, hi.z}, {lo.x, hi.y, hi.z}, {0, 0, 1}, color);
    quad({hi.x, lo.y, lo.z}, {lo.x, lo.y, lo.z}, {lo.x, hi.y, lo.z}, {hi.x, hi.y, lo.z}, {0, 0, -1}, color);
    if (bottom) quad({lo.x, lo.y, lo.z}, {hi.x, lo.y, lo.z}, {hi.x, lo.y, hi.z}, {lo.x, lo.y, hi.z}, {0, -1, 0}, color);
}

void MeshBuilder::wall(const glm::vec2& from, const glm::vec2& to, float y0, float y1, const glm::vec3& n,
                       const Rgb& color) {
    quad({from.x, y0, from.y}, {to.x, y0, to.y}, {to.x, y1, to.y}, {from.x, y1, from.y}, n, color);
}

void MeshBuilder::triangle(const glm::vec3& a, const glm::vec3& b, const glm::vec3& c, const Rgb& color, bool flat,
                           const glm::vec3* na, const glm::vec3* nb, const glm::vec3* nc) {
    const auto base = static_cast<std::uint32_t>(vertexCount());
    glm::vec3 fn = glm::cross(b - a, c - a);
    const float len = glm::length(fn);
    fn = len > 0 ? fn / len : glm::vec3(0, 1, 0);
    vertex(a, flat || !na ? fn : *na, color, {0, 0});
    vertex(b, flat || !nb ? fn : *nb, color, {1, 0});
    vertex(c, flat || !nc ? fn : *nc, color, {0, 1});
    indices_.push_back(base);
    indices_.push_back(base + 1);
    indices_.push_back(base + 2);
}

void MeshBuilder::cylinder(float rb, float rt, float h, int seg, const Rgb& color, bool caps, bool open) {
    const size_t firstIndex = indices_.size();
    const float slope = (rb - rt) / h;  // normal inclinada para troncos
    for (int i = 0; i < seg; ++i) {
        const float a0 = 2 * static_cast<float>(kPi) * i / seg, a1 = 2 * static_cast<float>(kPi) * (i + 1) / seg;
        const glm::vec3 b0(std::sin(a0) * rb, 0, std::cos(a0) * rb), b1(std::sin(a1) * rb, 0, std::cos(a1) * rb);
        const glm::vec3 t0(std::sin(a0) * rt, h, std::cos(a0) * rt), t1(std::sin(a1) * rt, h, std::cos(a1) * rt);
        const glm::vec3 n0 = glm::normalize(glm::vec3(std::sin(a0), slope, std::cos(a0)));
        const glm::vec3 n1 = glm::normalize(glm::vec3(std::sin(a1), slope, std::cos(a1)));
        const auto base = static_cast<std::uint32_t>(vertexCount());
        vertex(b0, n0, color, {static_cast<float>(i) / seg, 0});
        vertex(b1, n1, color, {static_cast<float>(i + 1) / seg, 0});
        vertex(t1, n1, color, {static_cast<float>(i + 1) / seg, 1});
        vertex(t0, n0, color, {static_cast<float>(i) / seg, 1});
        for (auto k : {0u, 1u, 2u, 0u, 2u, 3u}) indices_.push_back(base + k);
        if (open) {  // una caneca abierta se ve también por dentro
            const auto b2 = static_cast<std::uint32_t>(vertexCount());
            vertex(b0, -n0, color, {0, 0}); vertex(b1, -n1, color, {1, 0}); vertex(t1, -n1, color, {1, 1}); vertex(t0, -n0, color, {0, 1});
            for (auto k : {0u, 2u, 1u, 0u, 3u, 2u}) indices_.push_back(b2 + k);
        }
        if (caps && !open) {
            const glm::vec3 up(0, 1, 0), down(0, -1, 0), top(0, h, 0), bot(0, 0, 0);
            if (rt > 0) {
                const auto tb = static_cast<std::uint32_t>(vertexCount());
                vertex(top, up, color, {0.5f, 0.5f}); vertex(t1, up, color, {1, 0}); vertex(t0, up, color, {0, 0});
                indices_.push_back(tb); indices_.push_back(tb + 1); indices_.push_back(tb + 2);
            }
            if (rb > 0) {
                const auto bb = static_cast<std::uint32_t>(vertexCount());
                vertex(bot, down, color, {0.5f, 0.5f}); vertex(b0, down, color, {0, 0}); vertex(b1, down, color, {1, 0});
                indices_.push_back(bb); indices_.push_back(bb + 1); indices_.push_back(bb + 2);
            }
        }
    }
    orient(firstIndex);
}

void MeshBuilder::cone(float r, float h, int seg, const Rgb& color) {
    const size_t firstIndex = indices_.size();
    // El cono de three.js está centrado en el origen: la base queda en -h/2.
    for (int i = 0; i < seg; ++i) {
        const float a0 = 2 * static_cast<float>(kPi) * i / seg, a1 = 2 * static_cast<float>(kPi) * (i + 1) / seg;
        const glm::vec3 p0(std::sin(a0) * r, -h / 2, std::cos(a0) * r), p1(std::sin(a1) * r, -h / 2, std::cos(a1) * r);
        const glm::vec3 apex(0, h / 2, 0);
        const glm::vec3 n0 = glm::normalize(glm::vec3(std::sin(a0), r / h, std::cos(a0)));
        const glm::vec3 n1 = glm::normalize(glm::vec3(std::sin(a1), r / h, std::cos(a1)));
        const glm::vec3 nm = glm::normalize((n0 + n1) * 0.5f);
        const auto base = static_cast<std::uint32_t>(vertexCount());
        vertex(p0, n0, color, {0, 0}); vertex(p1, n1, color, {1, 0}); vertex(apex, nm, color, {0.5f, 1});
        indices_.push_back(base); indices_.push_back(base + 2); indices_.push_back(base + 1);
    }
    orient(firstIndex);
}

void MeshBuilder::disc(float r, int seg, const Rgb& color) {
    const size_t firstIndex = indices_.size();
    for (int i = 0; i < seg; ++i) {
        const float a0 = 2 * static_cast<float>(kPi) * i / seg, a1 = 2 * static_cast<float>(kPi) * (i + 1) / seg;
        const auto base = static_cast<std::uint32_t>(vertexCount());
        vertex({0, 0, 0}, {0, 1, 0}, color, {0.5f, 0.5f});
        vertex({std::cos(a0) * r, 0, -std::sin(a0) * r}, {0, 1, 0}, color, {0, 0});
        vertex({std::cos(a1) * r, 0, -std::sin(a1) * r}, {0, 1, 0}, color, {1, 0});
        indices_.push_back(base); indices_.push_back(base + 2); indices_.push_back(base + 1);
    }
    orient(firstIndex);
}

void MeshBuilder::ring(float inner, float outer, int seg, const Rgb& color) {
    const size_t firstIndex = indices_.size();
    for (int i = 0; i < seg; ++i) {
        const float a0 = 2 * static_cast<float>(kPi) * i / seg, a1 = 2 * static_cast<float>(kPi) * (i + 1) / seg;
        const auto base = static_cast<std::uint32_t>(vertexCount());
        vertex({std::cos(a0) * inner, 0, -std::sin(a0) * inner}, {0, 1, 0}, color, {0, 0});
        vertex({std::cos(a0) * outer, 0, -std::sin(a0) * outer}, {0, 1, 0}, color, {1, 0});
        vertex({std::cos(a1) * outer, 0, -std::sin(a1) * outer}, {0, 1, 0}, color, {1, 1});
        vertex({std::cos(a1) * inner, 0, -std::sin(a1) * inner}, {0, 1, 0}, color, {0, 1});
        for (std::uint32_t k : {0u, 2u, 1u, 0u, 3u, 2u}) indices_.push_back(base + k);
    }
    orient(firstIndex);
}

void MeshBuilder::sphere(float radius, int detail, const Rgb& color, bool flat) {
    const size_t firstIndex = indices_.size();
    const float t = (1 + std::sqrt(5.0f)) / 2;
    std::vector<glm::vec3> v = {{-1, t, 0}, {1, t, 0}, {-1, -t, 0}, {1, -t, 0}, {0, -1, t}, {0, 1, t},
                                {0, -1, -t}, {0, 1, -t}, {t, 0, -1}, {t, 0, 1}, {-t, 0, -1}, {-t, 0, 1}};
    for (auto& p : v) p = glm::normalize(p);
    std::vector<std::array<int, 3>> faces = {{0, 11, 5}, {0, 5, 1}, {0, 1, 7}, {0, 7, 10}, {0, 10, 11}, {1, 5, 9}, {5, 11, 4},
                                             {11, 10, 2}, {10, 7, 6}, {7, 1, 8}, {3, 9, 4}, {3, 4, 2}, {3, 2, 6}, {3, 6, 8},
                                             {3, 8, 9}, {4, 9, 5}, {2, 4, 11}, {6, 2, 10}, {8, 6, 7}, {9, 8, 1}};
    for (int d = 0; d < detail; ++d) {
        std::map<std::pair<int, int>, int> cache;
        auto mid = [&](int a, int b) {
            const std::pair<int, int> key = std::minmax(a, b);
            auto it = cache.find(key);
            if (it != cache.end()) return it->second;
            v.push_back(glm::normalize(v[a] + v[b]));
            return cache[key] = static_cast<int>(v.size()) - 1;
        };
        std::vector<std::array<int, 3>> next;
        for (auto& f : faces) {
            const int a = mid(f[0], f[1]), b = mid(f[1], f[2]), c = mid(f[2], f[0]);
            next.push_back({f[0], a, c}); next.push_back({f[1], b, a}); next.push_back({f[2], c, b}); next.push_back({a, b, c});
        }
        faces = std::move(next);
    }
    for (auto& f : faces) {
        glm::vec3 a = v[f[0]] * radius, b = v[f[1]] * radius, c = v[f[2]] * radius;
        int i1 = f[1], i2 = f[2];
        if (glm::dot(glm::cross(b - a, c - a), a + b + c) < 0) { std::swap(b, c); std::swap(i1, i2); }  // hacia afuera
        triangle(a, b, c, color, flat, &v[f[0]], &v[i1], &v[i2]);
    }
    orient(firstIndex);
}

void MeshBuilder::uvSphere(float r, int ws, int hs, const Rgb& color, float phiStart, float phiLength, float thetaStart, float thetaLength) {
    const size_t firstIndex = indices_.size();
    const auto base = static_cast<std::uint32_t>(vertexCount());
    for (int iy = 0; iy <= hs; ++iy) {
        const float v = static_cast<float>(iy) / hs;
        for (int ix = 0; ix <= ws; ++ix) {
            const float u = static_cast<float>(ix) / ws;
            const float ph = phiStart + u * phiLength, th = thetaStart + v * thetaLength;
            const glm::vec3 p(-r * std::cos(ph) * std::sin(th), r * std::cos(th), r * std::sin(ph) * std::sin(th));
            vertex(p, glm::normalize(p), color, {u, 1 - v});
        }
    }
    for (int iy = 0; iy < hs; ++iy) {
        for (int ix = 0; ix < ws; ++ix) {
            const std::uint32_t a = base + iy * (ws + 1) + ix + 1, b = base + iy * (ws + 1) + ix;
            const std::uint32_t c = base + (iy + 1) * (ws + 1) + ix, d = base + (iy + 1) * (ws + 1) + ix + 1;
            if (iy != 0 || thetaStart > 0) { indices_.push_back(a); indices_.push_back(b); indices_.push_back(d); }
            if (iy != hs - 1 || thetaStart + thetaLength < 3.141592f) { indices_.push_back(b); indices_.push_back(c); indices_.push_back(d); }
        }
    }
    orient(firstIndex);
}

void MeshBuilder::capsule(float radius, float length, int capSeg, int radialSeg, const Rgb& color) {
    const size_t firstIndex = indices_.size();
    const float halfPi = 1.570796327f;
    struct Ring { float y, rad, ny, nr; };  // altura, radio y normal (componente vertical y radial)
    std::vector<Ring> rings;
    for (int i = capSeg; i >= 0; --i) {  // tapa superior: del polo al ecuador
        const float a = static_cast<float>(i) / capSeg * halfPi;
        rings.push_back({length / 2 + radius * std::sin(a), radius * std::cos(a), std::sin(a), std::cos(a)});
    }
    for (int i = 0; i <= capSeg; ++i) {  // tapa inferior: del ecuador al polo
        const float a = static_cast<float>(i) / capSeg * halfPi;
        rings.push_back({-length / 2 - radius * std::sin(a), radius * std::cos(a), -std::sin(a), std::cos(a)});
    }
    const auto base = static_cast<std::uint32_t>(vertexCount());
    for (size_t r = 0; r < rings.size(); ++r) {
        for (int s = 0; s <= radialSeg; ++s) {
            const float ang = 2 * 3.141592654f * s / radialSeg;
            const glm::vec3 dir(std::sin(ang), 0, std::cos(ang));
            vertex({dir.x * rings[r].rad, rings[r].y, dir.z * rings[r].rad}, {dir.x * rings[r].nr, rings[r].ny, dir.z * rings[r].nr}, color,
                   {static_cast<float>(s) / radialSeg, 1 - static_cast<float>(r) / (rings.size() - 1)});
        }
    }
    for (size_t r = 0; r + 1 < rings.size(); ++r)
        for (int s = 0; s < radialSeg; ++s) {
            const std::uint32_t a = base + static_cast<std::uint32_t>(r) * (radialSeg + 1) + s, b = a + 1;
            const std::uint32_t c = a + (radialSeg + 1), d = c + 1;
            for (auto i : {a, c, b, b, c, d}) indices_.push_back(i);
        }
    orient(firstIndex);
}

void MeshBuilder::torus(float radius, float tube, int radialSeg, int tubularSeg, const Rgb& color) {
    const size_t firstIndex = indices_.size();
    const auto base = static_cast<std::uint32_t>(vertexCount());
    const float twoPi = 6.283185307f;
    for (int j = 0; j <= radialSeg; ++j)
        for (int i = 0; i <= tubularSeg; ++i) {
            const float u = static_cast<float>(i) / tubularSeg * twoPi, v = static_cast<float>(j) / radialSeg * twoPi;
            const glm::vec3 p((radius + tube * std::cos(v)) * std::cos(u), (radius + tube * std::cos(v)) * std::sin(u), tube * std::sin(v));
            const glm::vec3 center(radius * std::cos(u), radius * std::sin(u), 0);
            vertex(p, glm::normalize(p - center), color, {static_cast<float>(i) / tubularSeg, static_cast<float>(j) / radialSeg});
        }
    for (int j = 1; j <= radialSeg; ++j)
        for (int i = 1; i <= tubularSeg; ++i) {
            const std::uint32_t a = base + (tubularSeg + 1) * j + i - 1, b = base + (tubularSeg + 1) * (j - 1) + i - 1;
            const std::uint32_t c = base + (tubularSeg + 1) * (j - 1) + i, d = base + (tubularSeg + 1) * j + i;
            for (auto k : {a, b, d, b, c, d}) indices_.push_back(k);
        }
    orient(firstIndex);
}

}  // namespace bazuko
