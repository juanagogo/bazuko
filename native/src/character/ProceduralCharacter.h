#pragma once

#include <array>
#include <string>
#include <vector>

#include <glm/glm.hpp>

#include "character/CharacterLibrary.h"
#include "character/Look.h"
#include "core/Rng.h"
#include "render/SkinnedDraw.h"

namespace bazuko {

// Escala del personaje procedural al del mundo (CHARACTER_SCALE).
constexpr double kProceduralScale = 1.15;

// Personaje "cabezón" liviano hecho solo de primitivas (character.js), con piezas intercambiables (pelo, barba,
// ropa, calzado, gorra) sobre un esqueleto fijo de 16 huesos animado a mano. Mira hacia +Z.
// Se dibuja con el mismo pipeline que los personajes realistas: una malla con esqueleto por material.
class ProceduralCharacter {
public:
    ProceduralCharacter(const Look& look, const LookData& data, GpuSink& sink, unsigned seed = 1);

    const Look& look() const { return look_; }
    void setLook(const Look& look);  // reconstruye la geometría

    struct Input {
        double speed = 0;        // m/s del modelo
        bool running = false;
        std::string action;      // buscar, pedir, banar, comer, saludo, dormir
        double t = 0;            // reloj para los gestos en reposo
        double load = 0;         // 0..1: llenado del costal
        double dirt = 0, wet = 0;
        double lookAt = 0;       // giro de la cabeza (rad)
    };
    void update(double dt, const Input& in);
    void collect(const glm::mat4& model, bool silhouette, std::vector<SkinnedDraw>& out) const;

    // Huesos (para pruebas).
    enum Bone { Root, Body, Hips, Torso, Head, ShoulderA, ElbowA, ShoulderB, ElbowB, HipA, KneeA, HipB, KneeB, EyeA, EyeB, Sack, BoneCount };
    const glm::mat4& boneWorld(Bone b) const { return palette_[b]; }
    // Número de piezas dibujables y de triángulos.
    size_t drawCount() const { return pieces_.size(); }
    size_t triangleCount() const;

private:
    enum Mat { Skin, Hair, Top, Bottom, Stripe, Shoe, Sole, SoleBoot, Hat, Sack_, White, Iris, Pupil, Mouth, MatCount };
    struct Piece {
        Mat mat;
        int mesh = -1;
        size_t triangles = 0;
    };
    struct Pose {
        double lean = 0, armLx = 0, armRx = 0, armLz = 0, armRz = 0, elbL = 0, elbR = 0, legL = 0, legR = 0, kneeL = 0,
               kneeR = 0, bob = 0, lie = 0, headX = 0, headY = 0;
    };

    void build();
    void animate(double dt, const Input& in);
    void computePalette(const Input& in);

    Look look_;
    const LookData& data_;
    GpuSink& sink_;
    Mulberry32Rng rng_;
    double bulk_ = 1;
    int stripeTexture_ = -1;
    std::vector<Piece> pieces_;
    std::array<glm::mat4, BoneCount> palette_;
    Pose pose_;
    double phase_ = 0, blink_ = 2;
    bool eyesClosed_ = false;
    double sackScale_ = 0.7, dirt_ = 0, wet_ = 0;
    std::string action_;
    bool sackVisible_ = false;
};

}  // namespace bazuko
