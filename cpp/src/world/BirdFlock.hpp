#pragma once
#include <cstddef>
#include <cstdint>
#include <random>
#include <vector>
#include <glm/glm.hpp>

namespace Bazuko {

// Donde esta posada un ave: en el suelo, en una rama de arbol o en un poste.
enum class BirdPerch : uint8_t { Ground = 0, Tree = 1, Pole = 2 };

// Sitio donde un ave puede posarse (los pies quedan en `position`).
struct BirdSpot {
    glm::vec3 position{0.0f};
    BirdPerch kind = BirdPerch::Ground;
};

struct Bird {
    glm::vec3 position{0.0f};   // pies del ave
    glm::vec3 origin{0.0f};     // de donde despego
    glm::vec3 target{0.0f};     // donde va a posarse
    float flightRemaining = 0.0f;   // > 0 mientras vuela
    float flightDuration = 1.0f;
    float flightPeak = 0.0f;        // metros extra de altura sobre la ruta recta
    float flapRate = 14.0f;         // aleteos por segundo (aprox.)
    float restRemaining = 0.0f;     // tiempo que se queda posada
    float phase = 0.0f;
    float yaw = 0.0f;
    float pitch = 0.0f;
    size_t modelIndex = 0;
    BirdPerch perch = BirdPerch::Ground;
    BirdPerch targetPerch = BirdPerch::Ground;
    bool scared = false;
    // Posada en el suelo: de vez en cuando da unos pasos cortos cerca de donde aterrizo
    glm::vec3 home{0.0f};
    glm::vec3 walkTarget{0.0f};
    bool walking = false;
    float walkCycle = 0.0f;          // fase del paso (radianes), avanza al caminar
    float walkSpeed = 0.0f;          // m/s actual
    float lookTimer = 0.0f;          // hasta el siguiente vistazo de vigilancia
    float lookYaw = 0.0f;            // giro actual de la cabeza (rad)
    float lookYawTarget = 0.0f;
    float peckTimer = 0.0f;          // > 0 mientras picotea

    bool IsFlying() const { return flightRemaining > 0.0f; }
};

// Cuantas aves hay en cada tipo de posadero al empezar.
struct BirdFlockSettings {
    size_t onGround = 34;
    size_t inTrees = 14;
    size_t onPoles = 16;
};

// Bandada repartida por todo el mapa: se posa en el suelo, en arboles y en postes, vuela alto
// de un sitio a otro y sale volando si el jugador (sobre todo corriendo) o un peaton se acerca.
class BirdFlock {
public:
    explicit BirdFlock(uint32_t seed = 7);

    // Define los sitios de posado y reparte la bandada inicial entre ellos.
    void SetSpots(std::vector<BirdSpot> spots, size_t modelCount, const BirdFlockSettings& settings = BirdFlockSettings{});

    // `disturbances`: posiciones XZ de peatones u otras amenazas que asustan a las aves del suelo.
    void Update(float dt, const glm::vec3& playerPosition, const std::vector<glm::vec2>& disturbances);

    const std::vector<Bird>& Birds() const { return m_Birds; }
    const std::vector<BirdSpot>& Spots() const { return m_Spots; }
    float PlayerSpeed() const { return m_PlayerSpeed; }

private:
    void StartFlight(Bird& bird, const glm::vec3& playerPosition, bool scared);
    void AdvanceFlight(Bird& bird, float dt);
    void UpdateGroundBehaviour(Bird& bird, float dt);   // pasos, vistazos y picoteo del ave posada
    float Unit() { return m_Unit(m_Random); }

    std::mt19937 m_Random;
    std::uniform_real_distribution<float> m_Unit{0.0f, 1.0f};
    std::vector<BirdSpot> m_Spots;
    std::vector<size_t> m_GroundSpots;    // indices de los sitios del suelo
    std::vector<size_t> m_ElevatedSpots;  // indices de ramas y postes
    std::vector<Bird> m_Birds;
    std::vector<uint8_t> m_Flush;
    glm::vec3 m_PreviousPlayer{0.0f};
    float m_PlayerSpeed = 0.0f;
    bool m_HasPreviousPlayer = false;
};

} // namespace Bazuko
