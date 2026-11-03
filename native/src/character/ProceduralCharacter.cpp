#include "character/ProceduralCharacter.h"

#include <algorithm>
#include <cmath>

#include <glm/gtc/matrix_transform.hpp>

#include "render/Canvas2D.h"
#include "render/MeshBuilder.h"

namespace bazuko {

namespace {

using glm::mat4;
using glm::vec3;

const float kPiF = 3.14159265f;

mat4 T(float x, float y, float z) { return glm::translate(mat4(1.0f), vec3(x, y, z)); }
mat4 Rx(float a) { return glm::rotate(mat4(1.0f), a, vec3(1, 0, 0)); }
mat4 Ry(float a) { return glm::rotate(mat4(1.0f), a, vec3(0, 1, 0)); }
mat4 Rz(float a) { return glm::rotate(mat4(1.0f), a, vec3(0, 0, 1)); }
mat4 S(float x, float y, float z) { return glm::scale(mat4(1.0f), vec3(x, y, z)); }
// Rotación Euler 'XYZ' de three.js: R = Rx · Ry · Rz.
mat4 euler(float x, float y, float z) { return Rx(x) * Ry(y) * Rz(z); }

Rgb hex(const std::string& css) { return rgbFromHex(static_cast<std::uint32_t>(std::stoul(css.substr(1), nullptr, 16))); }
double lerpD(double a, double b, double k) { return a + (b - a) * k; }

// Acumula la geometría de un material como malla con esqueleto (16 floats por vértice).
struct SkinBuilder {
    std::vector<float> vertices;
    std::vector<std::uint32_t> indices;

    void add(const MeshBuilder& mb, int bone, float vScale = 1) {
        const auto base = static_cast<std::uint32_t>(vertices.size() / 16);
        const auto& v = mb.vertices();
        for (size_t i = 0; i < mb.vertexCount(); ++i) {
            const float* p = &v[i * MeshBuilder::kFloatsPerVertex];
            for (int k = 0; k < 6; ++k) vertices.push_back(p[k]);   // posición y normal
            vertices.push_back(p[9]);                               // uv
            vertices.push_back(p[10] * vScale);
            vertices.insert(vertices.end(), {static_cast<float>(bone), 0, 0, 0, 1, 0, 0, 0});
        }
        for (auto i : mb.indices()) indices.push_back(base + i);
    }
};

const Rgb kWhite{1, 1, 1};

}  // namespace

ProceduralCharacter::ProceduralCharacter(const Look& look, const LookData& data, GpuSink& sink, unsigned seed)
    : look_(look), data_(data), sink_(sink), rng_(seed) {
    // textura de rayas del buzo
    Canvas2D c(8, 64);
    c.fillStyle("#ffffff");
    c.fillRect(0, 0, 8, 64);
    c.fillStyle("#9a9a9a");
    for (int y = 0; y < 64; y += 16) c.fillRect(0, y, 8, 7);
    stripeTexture_ = sink_.uploadTexture(c.toImage());
    build();
    Input idle;
    computePalette(idle);
}

void ProceduralCharacter::setLook(const Look& look) {
    look_ = look;
    build();
}

size_t ProceduralCharacter::triangleCount() const {
    size_t n = 0;
    for (const Piece& p : pieces_) n += p.triangles;
    return n;
}

void ProceduralCharacter::build() {
    const Look& L = look_;
    bulk_ = L.contextura == "delgado" ? 0.86 : L.contextura == "robusto" ? 1.2 : 1.0;
    const float bulk = static_cast<float>(bulk_), sb = std::sqrt(bulk);
    const bool typeB = L.cuerpo == "b";

    std::array<SkinBuilder, MatCount> mats;
    std::array<float, MatCount> vScale;
    vScale.fill(1);

    // Emite una primitiva en el espacio local de `bone` con la transformación dada.
    auto add = [&](Bone bone, Mat mat, const mat4& local, auto&& emit) {
        MeshBuilder mb;
        mb.setTransform(local);
        emit(mb);
        mats[mat].add(mb, bone, vScale[mat]);
    };
    auto sphere = [&](Bone b, Mat m, float r, int ws, int hs, vec3 p, vec3 sc = vec3(1)) {
        add(b, m, T(p.x, p.y, p.z) * S(sc.x, sc.y, sc.z), [&](MeshBuilder& mb) { mb.uvSphere(r, ws, hs, kWhite); });
    };
    auto cap = [&](Bone b, Mat m, float r, float len, vec3 p, mat4 extra = mat4(1.0f)) {  // capsule() de character.js
        add(b, m, T(p.x, p.y, p.z) * extra * T(0, -len / 2 - r * 0.6f, 0), [&](MeshBuilder& mb) { mb.capsule(r, len, 4, 12, kWhite); });
    };
    auto box = [&](Bone b, Mat m, vec3 size, vec3 p, mat4 extra = mat4(1.0f)) {
        add(b, m, T(p.x, p.y, p.z) * extra, [&](MeshBuilder& mb) { mb.box(-size * 0.5f, size * 0.5f, kWhite, true); });
    };
    auto cyl = [&](Bone b, Mat m, float rTop, float rBottom, float h, int seg, vec3 p, mat4 extra = mat4(1.0f)) {  // centrado, como three
        add(b, m, T(p.x, p.y, p.z) * extra * T(0, -h / 2, 0), [&](MeshBuilder& mb) { mb.cylinder(rBottom, rTop, h, seg, kWhite); });
    };
    auto torus = [&](Bone b, Mat m, float r, float tube, int rs, int ts, vec3 p, mat4 extra) {
        add(b, m, T(p.x, p.y, p.z) * extra, [&](MeshBuilder& mb) { mb.torus(r, tube, rs, ts, kWhite); });
    };

    // ---- cabeza fija: cráneo, orejas, nariz, boca, ojos ----
    sphere(Head, Skin, 0.27f, 20, 16, {0, 0, 0}, {1, 0.95f, 0.95f});
    for (float x : {-0.27f, 0.27f}) sphere(Head, Skin, 0.06f, 10, 8, {x, -0.02f, 0});
    sphere(Head, Skin, 0.035f, 8, 6, {0, -0.045f, 0.255f});
    box(Head, Mouth, {0.08f, 0.018f, 0.02f}, {0, -0.115f, 0.24f});
    for (Bone eye : {EyeA, EyeB}) {
        sphere(eye, White, 0.05f, 12, 10, {0, 0, 0}, {1, 1.15f, 0.45f});
        sphere(eye, Iris, 0.03f, 10, 8, {0, -0.004f, 0.018f}, {1, 1.15f, 0.5f});
        sphere(eye, Pupil, 0.014f, 8, 6, {0, -0.004f, 0.03f});
        sphere(eye, White, 0.008f, 6, 4, {0.012f, 0.012f, 0.036f});
    }
    sphere(Sack, Sack_, 0.22f, 14, 10, {0, 0, 0});

    // ---- torso ----
    vScale[Top] = L.arriba == "rayas" ? 2.0f : 1.0f;
    add(Torso, Top, T(0, 0.24f, 0) * S((typeB ? 1.02f : 1.15f) * bulk, 1, 0.85f * sb), [&](MeshBuilder& mb) { mb.capsule(0.2f, 0.2f, 4, 14, kWhite); });
    vScale[Top] = 1.0f;
    cyl(Torso, Bottom, 0.19f * bulk * (typeB ? 1.12f : 1), 0.2f * bulk * (typeB ? 1.14f : 1), 0.12f, 14, {0, 0.02f, 0});
    if (typeB)
        for (float x : {-0.085f, 0.085f}) sphere(Torso, Top, 0.075f * bulk, 10, 8, {x, 0.3f, 0.15f * sb}, {1, 0.85f, 0.7f});
    if (L.arriba == "buzo") {
        torus(Torso, Top, 0.15f, 0.06f, 8, 16, {0, 0.5f, -0.04f}, Rx(kPiF / 2 + 0.25f));
        box(Torso, Stripe, {0.22f * bulk, 0.09f, 0.02f}, {0, 0.14f, 0.17f * sb + 0.005f});
        for (float x : {-0.04f, 0.04f}) cyl(Torso, Stripe, 0.006f, 0.006f, 0.14f, 4, {x, 0.4f, 0.17f});
    } else if (L.arriba == "chaqueta") {
        box(Torso, Stripe, {0.012f, 0.36f, 0.02f}, {0, 0.22f, 0.175f * sb});
        torus(Torso, Top, 0.12f, 0.035f, 6, 14, {0, 0.47f, 0}, Rx(kPiF / 2));
    } else {
        torus(Torso, Top, 0.09f, 0.02f, 6, 14, {0, 0.46f, 0.01f}, Rx(kPiF / 2));
    }

    // ---- brazos ----
    const bool longSleeve = L.arriba != "camiseta";
    for (int i = 0; i < 2; ++i) {
        const Bone shoulder = i == 0 ? ShoulderA : ShoulderB, elbow = i == 0 ? ElbowA : ElbowB;
        const float side = i == 0 ? 1.0f : -1.0f;
        const float r = 0.068f * sb;
        cap(shoulder, longSleeve ? Top : Skin, r, 0.12f, {0, 0, 0});
        if (!longSleeve) cap(shoulder, Top, r * 1.12f, 0.03f, {0, 0, 0});
        if (L.arriba == "sudadera" || L.arriba == "buzo") box(shoulder, Stripe, {0.02f, 0.18f, 0.05f}, {side * r, -0.13f, 0});
        cap(elbow, longSleeve ? Top : Skin, r * 0.95f, 0.08f, {0, 0, 0});
        sphere(elbow, Skin, 0.07f, 10, 8, {0, -0.2f, 0});
    }

    // ---- piernas y calzado ----
    for (int i = 0; i < 2; ++i) {
        const Bone hip = i == 0 ? HipA : HipB, knee = i == 0 ? KneeA : KneeB;
        const float side = i == 0 ? 1.0f : -1.0f;
        const float r = 0.085f * sb * (typeB ? 1.04f : 1.0f);
        const bool shorts = L.abajo == "pantaloneta";
        cap(hip, Bottom, r, 0.1f, {0, 0, 0});
        cap(knee, shorts ? Skin : Bottom, r * 0.94f, 0.06f, {0, 0, 0});
        if (L.abajo == "sudadera") {
            box(hip, Stripe, {0.02f, 0.2f, 0.04f}, {side * r, -0.12f, 0});
            box(knee, Stripe, {0.02f, 0.16f, 0.04f}, {side * r * 0.94f, -0.1f, 0});
        }
        if (L.zapatos == "tenis") {
            box(knee, Shoe, {0.15f, 0.08f, 0.25f}, {0, -0.23f, 0.04f});
            box(knee, Sole, {0.155f, 0.03f, 0.255f}, {0, -0.23f - 0.045f, 0.04f});
        } else if (L.zapatos == "chanclas") {
            box(knee, Skin, {0.13f, 0.06f, 0.22f}, {0, -0.23f, 0.04f});
            box(knee, Shoe, {0.15f, 0.025f, 0.25f}, {0, -0.27f, 0.04f});
            box(knee, Shoe, {0.14f, 0.02f, 0.04f}, {0, -0.2f, 0.08f});
        } else {
            box(knee, Shoe, {0.16f, 0.16f, 0.25f}, {0, -0.2f, 0.035f});
            box(knee, SoleBoot, {0.165f, 0.035f, 0.26f}, {0, -0.275f, 0.035f});
        }
    }

    // ---- cabeza: pelo, cejas, barba, accesorio ----
    const bool hatOn = L.cabeza != "nada";
    auto capTop = [&](float s) {
        add(Head, Hair, T(0, 0.02f, -0.015f) * S(1, 0.92f, 0.96f), [&](MeshBuilder& mb) { mb.uvSphere(0.275f * s, 16, 10, kWhite, 0, 2 * kPiF, 0, kPiF * 0.5f); });
    };
    if (L.pelo == "rapado") {
        if (!hatOn) add(Head, Hair, T(0, 0.02f, -0.015f) * S(1, 0.8f, 0.95f), [&](MeshBuilder& mb) { mb.uvSphere(0.275f, 16, 10, kWhite, 0, 2 * kPiF, 0, kPiF * 0.5f); });
    } else if (L.pelo == "corto") {
        if (!hatOn) {
            capTop(1.02f);
            box(Head, Hair, {0.3f, 0.06f, 0.08f}, {0, 0.17f, 0.2f});
        }
    } else if (L.pelo == "crespo") {
        const int n = hatOn ? 8 : 18;
        for (int i = 0; i < n; ++i) {
            const float a = static_cast<float>(i) / n * 2 * kPiF;
            const int ring = i % 3;
            const float rad = 0.2f - ring * 0.05f;
            const float y = hatOn ? -0.02f : 0.12f + ring * 0.08f;
            sphere(Head, Hair, 0.1f, 8, 6, {std::cos(a) * rad, y, std::sin(a) * rad * 0.9f - 0.03f});
        }
        if (!hatOn) sphere(Head, Hair, 0.16f, 10, 8, {0, 0.27f, -0.02f});
    } else if (L.pelo == "largo") {
        if (!hatOn) capTop(1.02f);
        box(Head, Hair, {0.5f, 0.42f, 0.14f}, {0, -0.08f, -0.2f});
        for (float x : {-0.24f, 0.24f}) box(Head, Hair, {0.07f, 0.36f, 0.2f}, {x, -0.06f, -0.06f});
    } else if (L.pelo == "cola") {
        if (!hatOn) capTop(1.02f);
        add(Head, Hair, T(0, 0.06f, -0.27f) * Rx(-0.4f) * T(0, -0.18f / 2 - 0.06f * 0.6f, 0), [&](MeshBuilder& mb) { mb.capsule(0.06f, 0.18f, 4, 12, kWhite); });
    } else if (L.pelo == "mohicano") {
        if (!hatOn)
            for (int i = 0; i < 5; ++i)
                box(Head, Hair, {0.06f, 0.12f, 0.09f}, {0, 0.27f - std::abs(i - 1.5f) * 0.02f, 0.16f - i * 0.09f});
    }
    const float browH = L.cejas == "gruesas" ? 0.03f : 0.015f;
    for (float x : {-0.1f, 0.1f}) box(Head, Hair, {0.09f, browH, 0.02f}, {x, 0.085f, 0.245f}, Rz(x > 0 ? -0.12f : 0.12f));
    if (L.barba == "bigote" || L.barba == "candado") box(Head, Hair, {0.13f, 0.03f, 0.03f}, {0, -0.085f, 0.245f});
    if (L.barba == "candado") box(Head, Hair, {0.08f, 0.07f, 0.05f}, {0, -0.17f, 0.215f});
    if (L.barba == "completa") {
        add(Head, Hair, T(0, -0.02f, 0.025f), [&](MeshBuilder& mb) { mb.uvSphere(0.245f, 14, 10, kWhite, 0, 2 * kPiF, kPiF * 0.55f, kPiF * 0.35f); });
        box(Head, Hair, {0.13f, 0.03f, 0.03f}, {0, -0.085f, 0.245f});
    }
    if (L.cabeza == "gorra" || L.cabeza == "gorra-atras") {
        add(Head, Hat, T(0, 0.05f, 0), [&](MeshBuilder& mb) { mb.uvSphere(0.285f, 16, 8, kWhite, 0, 2 * kPiF, 0, kPiF * 0.45f); });
        const float back = L.cabeza == "gorra-atras" ? -1.0f : 1.0f;
        box(Head, Hat, {0.34f, 0.03f, 0.2f}, {0, 0.11f, 0.28f * back}, Rx(0.18f * back));
        sphere(Head, Hat, 0.03f, 6, 4, {0, 0.33f, 0});
    } else if (L.cabeza == "sombrero") {
        cyl(Head, Hat, 0.46f, 0.46f, 0.03f, 24, {0, 0.13f, 0});
        cyl(Head, Hat, 0.22f, 0.27f, 0.22f, 20, {0, 0.25f, 0});
        cyl(Head, Pupil, 0.272f, 0.272f, 0.05f, 20, {0, 0.16f, 0});
    } else if (L.cabeza == "panoleta") {
        add(Head, Hat, T(0, 0.04f, -0.01f), [&](MeshBuilder& mb) { mb.uvSphere(0.283f, 16, 10, kWhite, 0, 2 * kPiF, 0, kPiF * 0.42f); });
        sphere(Head, Hat, 0.05f, 8, 6, {0, 0.06f, -0.28f});
    }

    // ---- subir a la GPU: una malla por material ----
    pieces_.clear();
    for (int m = 0; m < MatCount; ++m) {
        if (mats[m].indices.empty()) continue;
        Piece p;
        p.mat = static_cast<Mat>(m);
        p.mesh = sink_.uploadSkinnedMesh(mats[m].vertices, mats[m].indices);
        p.triangles = mats[m].indices.size() / 3;
        pieces_.push_back(p);
    }
}

void ProceduralCharacter::animate(double dt, const Input& in) {
    Pose t;
    t.armLz = 0.12;
    t.armRz = -0.12;
    t.elbL = t.elbR = -0.2;
    t.headY = in.lookAt;
    const double amp = std::min(1.0, in.speed / 3.6) * (in.running ? 1.1 : 0.9);
    if (in.speed > 0.15) {
        phase_ += dt * (5 + in.speed * 2.2);
        const double s = std::sin(phase_);
        t.legL = s * 0.8 * amp;
        t.legR = -s * 0.8 * amp;
        t.kneeL = std::max(0.0, std::sin(phase_ + kPiF / 2)) * 0.9 * amp;
        t.kneeR = std::max(0.0, std::sin(phase_ - kPiF / 2)) * 0.9 * amp;
        t.armLx = -s * 0.8 * amp;
        t.armRx = s * 0.8 * amp;
        t.lean = 0.06 * amp + (in.running ? 0.1 : 0);
        t.bob = std::abs(std::cos(phase_)) * 0.05 * amp;
    } else {
        t.bob = std::sin(in.t * 2.4) * 0.008;
        t.headX = std::sin(in.t * 0.8) * 0.05;
    }
    if (in.wet > 0.5 && in.speed < 0.15) {
        t.armLz = -0.3; t.armRz = 0.3; t.armLx = -0.6; t.armRx = -0.6; t.elbL = -1.5; t.elbR = -1.5;
    }
    const std::string& a = in.action;
    if (a == "buscar") {
        const double w = std::sin(in.t * 10);
        t.lean = 0.7; t.headX = 0.2;
        t.armLx = -1.3 + w * 0.3; t.armRx = -1.3 - w * 0.3;
        t.kneeL = 0.6; t.kneeR = 0.6; t.legL = -0.4; t.legR = -0.4;
    } else if (a == "pedir") {
        t.armRx = -1.4; t.elbR = -0.2; t.lean = 0.1; t.headX = std::sin(in.t * 2) * 0.05;
    } else if (a == "banar") {
        const double w = std::sin(in.t * 9);
        t.armLx = -2.8 + w * 0.2; t.armRx = -2.8 - w * 0.2; t.elbL = -1.2; t.elbR = -1.2; t.lean = 0.3;
    } else if (a == "comer") {
        t.armRx = -1.5; t.elbR = -1.8;
    } else if (a == "saludo") {
        t.armRx = -2.7; t.armRz = -0.3 + std::sin(in.t * 9) * 0.35; t.elbR = -0.4;
    } else if (a == "dormir") {
        t.lie = 1;
    }
    const double k = std::min(1.0, dt * 12);
    pose_.lean = lerpD(pose_.lean, t.lean, k); pose_.armLx = lerpD(pose_.armLx, t.armLx, k); pose_.armRx = lerpD(pose_.armRx, t.armRx, k);
    pose_.armLz = lerpD(pose_.armLz, t.armLz, k); pose_.armRz = lerpD(pose_.armRz, t.armRz, k); pose_.elbL = lerpD(pose_.elbL, t.elbL, k);
    pose_.elbR = lerpD(pose_.elbR, t.elbR, k); pose_.legL = lerpD(pose_.legL, t.legL, k); pose_.legR = lerpD(pose_.legR, t.legR, k);
    pose_.kneeL = lerpD(pose_.kneeL, t.kneeL, k); pose_.kneeR = lerpD(pose_.kneeR, t.kneeR, k); pose_.bob = lerpD(pose_.bob, t.bob, k);
    pose_.lie = lerpD(pose_.lie, t.lie, k); pose_.headX = lerpD(pose_.headX, t.headX, k); pose_.headY = lerpD(pose_.headY, t.headY, k);
    action_ = in.action;

    // parpadeo
    blink_ -= dt;
    eyesClosed_ = blink_ < 0.12;
    if (blink_ < 0) blink_ = 2 + rng_.next() * 3;

    const double s = 0.7 + std::min(1.0, in.load) * 0.7;
    sackScale_ = s;
    sackVisible_ = in.load > 0.02;
    dirt_ = in.dirt;
    wet_ = in.wet;
}

void ProceduralCharacter::computePalette(const Input&) {
    const Pose& p = pose_;
    const float lie = static_cast<float>(p.lie);
    auto bone = [&](Bone b, const mat4& parent, const mat4& local) { palette_[b] = parent * local; };
    bone(Root, mat4(1.0f), S(static_cast<float>(look_.estatura), static_cast<float>(look_.estatura), static_cast<float>(look_.estatura)));
    bone(Body, palette_[Root], T(0, lie * 0.3f, -lie * 0.55f) * Rx(-lie * kPiF / 2));
    bone(Hips, palette_[Body], T(0, 0.52f + static_cast<float>(p.bob) - (action_ == "buscar" ? 0.08f : 0.0f), 0));
    bone(Torso, palette_[Hips], Rx(static_cast<float>(p.lean)));
    bone(Head, palette_[Torso], T(0, 0.72f, 0) * euler(static_cast<float>(p.headX), static_cast<float>(p.headY), 0));
    bone(ShoulderA, palette_[Torso], T(0.25f, 0.36f, 0) * euler(static_cast<float>(p.armLx), 0, static_cast<float>(p.armLz)));
    bone(ElbowA, palette_[ShoulderA], T(0, -0.21f, 0) * Rx(static_cast<float>(p.elbL)));
    bone(ShoulderB, palette_[Torso], T(-0.25f, 0.36f, 0) * euler(static_cast<float>(p.armRx), 0, static_cast<float>(p.armRz)));
    bone(ElbowB, palette_[ShoulderB], T(0, -0.21f, 0) * Rx(static_cast<float>(p.elbR)));
    bone(HipA, palette_[Hips], T(0.1f, 0, 0) * Rx(static_cast<float>(p.legL)));
    bone(KneeA, palette_[HipA], T(0, -0.24f, 0) * Rx(static_cast<float>(p.kneeL)));
    bone(HipB, palette_[Hips], T(-0.1f, 0, 0) * Rx(static_cast<float>(p.legR)));
    bone(KneeB, palette_[HipB], T(0, -0.24f, 0) * Rx(static_cast<float>(p.kneeR)));
    const float eyeY = eyesClosed_ ? 0.12f : 1.0f;
    bone(EyeA, palette_[Head], T(-0.1f, 0, 0.235f) * S(1, eyeY, 1));
    bone(EyeB, palette_[Head], T(0.1f, 0, 0.235f) * S(1, eyeY, 1));
    const float s = static_cast<float>(sackScale_);
    bone(Sack, palette_[Torso], T(0, 0.28f, -0.27f) * S(s, s * 1.15f, s * 0.85f));
}

void ProceduralCharacter::update(double dt, const Input& in) {
    animate(dt, in);
    computePalette(in);
}

void ProceduralCharacter::collect(const glm::mat4& model, bool silhouette, std::vector<SkinnedDraw>& out) const {
    const auto& pal = data_.palettes;
    auto color = [&](const char* palette, int index, int fallback) {
        const auto& v = pal.at(palette);
        return hex(v[static_cast<size_t>(index >= 0 && index < static_cast<int>(v.size()) ? index : fallback)]);
    };
    const Rgb top = color("ropa", look_.arribaColor, 0);
    const double dirtFactor = 1 - dirt_ * 0.35 - wet_ * 0.15;
    for (const Piece& piece : pieces_) {
        if (piece.mat == Sack_ && !sackVisible_) continue;
        SkinnedDraw d;
        d.mesh = piece.mesh;
        d.model = model;
        d.palette = palette_.data();
        d.paletteCount = BoneCount;
        d.silhouette = silhouette;
        switch (piece.mat) {
            case Skin: d.tint = color("piel", look_.piel, 2); break;
            case Hair: d.tint = color("pelo", look_.peloColor, 0); break;
            case Top:
                d.tint = {top.r * dirtFactor, top.g * dirtFactor, top.b * dirtFactor};
                if (look_.arriba == "rayas") d.texture = stripeTexture_;
                break;
            case Bottom: d.tint = color("ropa", look_.abajoColor, 10); break;
            case Stripe: d.tint = hex("#f4f1e8"); break;
            case Shoe: d.tint = color("zapato", look_.zapatoColor, 1); break;
            case Sole: d.tint = hex("#eeeeee"); break;
            case SoleBoot: d.tint = hex("#2a1d14"); break;
            case Hat: d.tint = color("ropa", look_.cabezaColor, 0); break;
            case Sack_: d.tint = hex("#9b8a62"); break;
            case White: d.tint = hex("#ffffff"); d.unlit = true; d.castShadow = false; break;
            case Iris: d.tint = color("ojos", look_.ojos, 0); d.unlit = true; d.castShadow = false; break;
            case Pupil: d.tint = hex("#0b0b0b"); break;
            case Mouth: d.tint = hex("#5a2a22"); d.unlit = true; d.castShadow = false; break;
            default: break;
        }
        out.push_back(d);
    }
}

}  // namespace bazuko
