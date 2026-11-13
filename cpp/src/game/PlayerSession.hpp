#pragma once
// Estado de UN jugador: lo que antes eran ~100 variables locales de main(). Es el estado que un servidor guardara por jugador
// (ver docs/multijugador-main.md). main() sigue usando los mismos nombres mediante referencias a esta estructura.
#include "PlayerState.hpp"

#include <array>
#include <glm/glm.hpp>
#include <string>
#include <unordered_set>
#include <vector>

namespace Bazuko {

// Acciones del personaje (animaciones de Blender): saltar (Espacio), agacharse (Ctrl), punos (J), patada (K) y navaja (H)
enum class PlayerAction { None, Jump, Jab, Cross, Kick, Slash, Stab, Pet, Hook, HighKick, Slip, Duck };

struct DiseaseState { std::string id; float remaining; float healthDrain; float mentalDrain; };

struct PlayerSession {
    glm::vec3 position{0.0f};   // playerPos en main()
    glm::vec3 companionPosition{0.0f};
    bool knockedOnDeck = false;   // la caida empezo sobre el tablero: se levanta alli
    float locomotionPhase = 0.0f;   // fase 0..1 del ciclo de caminar/correr: avanza segun la velocidad del personaje
    bool playerOnDeck = false;   // sobre el tablero del viaducto (capa elevada); en la calle pasa por debajo
    float playerYaw = 0.0f;
    bool playerKnockedDown = false;
    float knockdownRemaining = 0.0f;
    float vehicleImpactCooldown = 0.0f;
    bool deathByVehicleImpact = false;
    bool deathByLimpieza = false;   // lo mataron los de la camioneta negra: recorte propio y consejo al anochecer siguiente
    float poopCooldown = 0.0f;
    float poopAnimationRemaining = 0.0f;
    int poopMode = 0;   // 0 nada, 1 agacharse a hacer popo, 2 recoger el mojon con la mano y lanzarlo
    float poopElapsed = 0.0f;
    bool poopStepDone = false;
    glm::vec3 poopThrowDirection{0.0f, 0.0f, 1.0f};
    bool petWaiting = false;   // caricia al Chato: se pide con E, el perro se sienta delante y luego la anima PetDog
    bool petRewardPending = false;
    float petWaitTime = 0.0f;
    PlayerAction playerAction = PlayerAction::None;
    int playerActionClip = -1;
    float actionTime = 0.0f;
    float actionDuration = 0.0f;
    bool nextKnifeIsStab = false;
    bool nextKickIsHigh = false;
    bool nextDodgeIsDuck = false;
    int punchChain = 0;   // jab, cruzado y gancho en cadena (se reinicia si pasa mas de 1,4 s)
    float fightStanceRemaining = 0.0f;
    float knifeStanceRemaining = 0.0f;
    float stillSeconds = 0.0f;
    float jumpOffset = 0.0f;
    float pickupTime = -1.0f;   // >= 0 mientras recoge una bolsa de un golpe (E): se agacha y el brazo baja al objeto
    glm::vec3 pickupTarget{0.0f};
    float grabTime = -1.0f;   // >= 0 mientras el brazo derecho roba un retrovisor (Combat::AppendGrab)
    bool jumpMoving = false;   // salto con carrera (camino o corriendo) en vez de salto estatico
    glm::vec3 jumpDirection{0.0f};   // hacia donde sale despedido el salto en movimiento
    float jumpSpeed = 0.0f;   // m/s horizontales en el aire: decide cuanto avanza
    bool playerCrouching = false;
    int comboStep = 0;
    float comboIdle = 0.0f;
    float clickTime = 0.0f;
    float clickMove = 0.0f;
    bool clickTracking = false;
    bool clickWasLocked = false;
    bool actionHitDone = false;
    int playerHitKind = 0;   // 0 ninguno, 1 cara, 2 pecho, 3 piernas
    float playerHitTime = 0.0f;
    glm::vec3 playerStaggerDirection{0.0f};   // hacia donde lo empuja el golpe: da pasos atras por la desestabilizacion
    float knockdownLyingYaw = 0.0f;
    bool boostActive = false;
    float boostTimer = 0.0f;
    std::vector<InventoryEntry> inventory;
    float inventoryWeight = 0.0f;
    float money = 0.0f;
    int xp = 0;
    int level = 1;
    int talentPoints = 0;
    bool bigSack = false;   // Costal grande comprado en la tienda
    bool cartAttached = false;   // la carreta de balineras esta enganchada: +120 kg de capacidad, pero pesa (Cart.js)
    float playerWaterDepth = 0.0f;   // metros de agua del lago sobre el fondo donde pisa el jugador
    bool playerSwimming = false;   // agua profunda: nada en lugar de caminar
    float swimPhase = 0.0f;   // fase 0..1 de la brazada
    float swimPitch = 0.0f;   // 0 de pie en el agua .. 1 tendido nadando (se suaviza)
    bool tiredGait = false;   // el jugador camina cansado por falta de energia
    bool playerFreezing = false;   // frio nocturno con lluvia y sin calor (La Nevera)
    float warmTimer = 0.0f;   // s de calor contra el frio: lo dan la comida caliente y el fogon del cambuche; se guarda
    float playerWetness = 0.0f;   // 0 seco .. 1 empapado: la lluvia moja, el tiempo seca; no se guarda
    float coldCheckTimer = 0.0f;
    bool radioOn = false;   // radio transistor: encendida, volumen propio y bateria (100 % dura unos 40 min)
    float radioVolume = 0.7f;
    float radioBattery = 100.0f;
    glm::vec3 playerVelocity{0.0f};   // inercia de movimiento (como Player.js: 22/s al moverse, 18/s al frenar)
    std::string equippedWeapon;   // arma en la mano (id del objeto: cuchillo, botella_picada, arma), vacio = puños
    std::array<std::string, 5> hotbar{};   // objetos de la barra de acceso rapido (teclas 1-5)
    bool sorting = false;   // manteniendo Q sobre una bolsa
    float sortProgress = 0.0f;
    glm::vec3 sortPosition{0.0f};
    std::unordered_set<std::string> unlockedTalents;
    std::string companionName = "El Chato";
    int companionCoat = 0;
    bool companionIsFriend = false;
    int itemsCollected = 0;
    int itemsSold = 0;
    size_t missionProgress = 0;
    std::array<float, 7> needs{100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 80.0f};
    std::string objective = "Recoge 5 objetos para empezar";
    std::vector<DiseaseState> diseases;
};

} // namespace Bazuko
