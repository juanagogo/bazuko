#pragma once
// Supervivencia del jugador (hambre, sed, energia, higiene, animo, salud, frio, lluvia, enfermedades y adrenalina): la logica que antes vivia
// dentro del bucle de main(). Es una funcion pura sobre `PlayerSession` y los datos del mundo que recibe: no toca la interfaz, el audio ni la
// ventana, asi que la puede ejecutar un servidor y se prueba sola (tests/SurvivalTest.cpp compara cada paso con el codigo original).
#include "PlayerSession.hpp"

#include <functional>

namespace Bazuko {

// Lo que el mundo y el jugador aportan en un cuadro
struct SurvivalInput {
    float dt = 0.0f;                  // s ya acotados a >= 0
    bool nearFire = false;            // junto al fogon encendido del cambuche (a menos de 3,6 m)
    bool night = false;
    bool raining = false;
    float rainIntensity = 0.0f;       // 0 a 1
    float waterDepth = 0.0f;          // m de agua del lago donde pisa
    bool running = false;
    float speed = 0.0f;               // m/s
    float hungerThirstDecayMult = 1.0f;   // talento "decayMult"
    float diseaseResistTalent = 1.0f;     // talento "diseaseResist"
    float diseaseResistCharacter = 1.0f;  // del personaje elegido
    float mentalDecayMult = 1.0f;         // talento "mentalDecayMult"
    float withdrawal = 0.0f;              // 0 a 100, de needs[6]
    bool highWithdrawal = false;          // >= 50
    bool criticalWithdrawal = false;      // >= 80
};

// Hechos del cuadro que la interfaz debe avisar (la logica no avisa por si sola)
struct SurvivalEvents {
    bool becameSoaked = false;        // acaba de empaparse (>= 0,7)
    bool caughtCold = false;          // se resfrio: agrego la gripe
    bool adrenalineEnded = false;     // se acabo la adrenalina
};

// Avanza un cuadro. `roll` devuelve un numero uniforme en [0, 1) y solo se llama cuando hay que tirar el dado del resfriado
// (igual que el codigo original, para no alterar la secuencia de azar de la partida).
SurvivalEvents StepSurvival(PlayerSession& session, const SurvivalInput& input, const std::function<float()>& roll);

} // namespace Bazuko
