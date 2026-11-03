#pragma once

#include <map>
#include <memory>
#include <string>
#include <vector>

#include "character/Retarget.h"

namespace bazuko {

// Nombres de los clips que busca el personaje; los que no existen caen en idle / walk / run.
const std::vector<std::string>& characterClipNames();

// Mezcla de clips con pesos que se acercan al objetivo (RealisticCharacter.update + AnimationMixer de three.js):
// el peso de cada clip sigue al destino con k = min(1, dt·8) y los giros se acumulan con slerp ponderado.
class Animator {
public:
    // `clips` por nombre en minúsculas; `rig` es el esqueleto del personaje (con la pose de reposo del retarget).
    Animator(const Rig& rig, std::map<std::string, std::shared_ptr<const Clip>> clips);

    struct Input {
        double speed = 0;       // m/s en unidades del modelo
        bool running = false;
        std::string action;     // "buscar", "pedir", "comer", "dormir", "saludo" o vacío
    };
    void update(double dt, const Input& in);

    // Pose resultante (rotaciones locales por nodo).
    const Pose& pose() const { return pose_; }
    double weight(const std::string& clip) const;
    double time(const std::string& clip) const;
    bool hasClip(const std::string& clip) const { return actions_.count(clip) > 0; }

private:
    struct Action {
        std::shared_ptr<const Clip> clip;
        double time = 0, weight = 0, timeScale = 1;
    };
    const Rig& rig_;
    std::vector<std::string> order_;  // orden de acumulación = orden de characterClipNames()
    std::map<std::string, Action> actions_;
    Pose pose_;
};

}  // namespace bazuko
