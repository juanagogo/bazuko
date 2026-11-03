#pragma once

#include <memory>
#include <vector>

#include "character/Animator.h"
#include "character/CharacterLibrary.h"
#include "render/SkinnedDraw.h"

namespace bazuko {

// Escala del modelo (~1,7 m) a la del mundo (el personaje procedural mide ~1,85 m).
constexpr double kRealisticScale = 1.08;

// Una instancia animada de un personaje: su propio animador y matrices de hueso, con las mallas compartidas.
class Character {
public:
    explicit Character(std::shared_ptr<const CharacterBlueprint> blueprint);

    const CharacterBlueprint& blueprint() const { return *bp_; }
    const Animator& animator() const { return animator_; }

    // Avanza la animación y recalcula las matrices de hueso.
    void update(double dt, const Animator::Input& in);

    // Añade las piezas de este personaje con la transformación de mundo dada.
    void collect(const glm::mat4& model, bool silhouette, std::vector<SkinnedDraw>& out) const;

    // Altura máxima del modelo en metros del mundo (sirve para descartar por cámara).
    static constexpr double kHeight = 1.9;

private:
    void computePalettes();

    std::shared_ptr<const CharacterBlueprint> bp_;
    Animator animator_;
    std::vector<std::vector<glm::mat4>> palettes_;  // por pieza
};

}  // namespace bazuko
