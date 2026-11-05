#if defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#include <cstdlib>
#endif

#include "core/Window.hpp"
#include "core/Input.hpp"
#include "core/Clock.hpp"
#include "core/Log.hpp"
#include "core/Paths.hpp"
#include "renderer/Renderer.hpp"
#include "renderer/Camera.hpp"
#include "renderer/Mesh.hpp"
#include "renderer/Model.hpp"
#include "ui/UIManager.hpp"
#include "game/GameData.hpp"
#include "game/Weapons.hpp"
#include "ui/Carton.hpp"
#include "game/PlayerState.hpp"
#include "game/PlayerSession.hpp"
#include "game/Survival.hpp"
#include "game/Economy.hpp"
#include "game/Movement.hpp"
#ifdef BAZUKO_NET_ENABLED
#include "net/NetSession.hpp"
#endif
#include "game/Fight.hpp"
#include "core/PlayerInputSampler.hpp"
#include "world/SafeSpawn.hpp"
#include "world/Atmosphere.hpp"
#include "world/Viaduct.hpp"
#include "world/StarField.hpp"
#include "world/Climate.hpp"
#include "world/GpsNavigation.hpp"
#include "core/ScreenshotPng.hpp"
#include "core/AdaptiveResolution.hpp"
#include "game/Harvest.hpp"
#include "audio/AudioManager.hpp"
#include "world/Decals.hpp"
#include "world/LightBeams.hpp"
#include "world/CityLayout.hpp"
#include "world/Simulation.hpp"
#include "world/Lake.hpp"
#include "character/CombatMoves.hpp"
#include "character/JumpMoves.hpp"
#include "world/SkyDome.hpp"
#include "character/CharacterManager.hpp"
#include "character/Ragdoll.hpp"
#include "ui/CharacterCreatorUI.hpp"

#include <GLFW/glfw3.h>
#include <imgui.h>
#include <glm/gtc/matrix_transform.hpp>
#include <cmath>
#include <filesystem>
#include <array>
#include <optional>
#include <tuple>
#include <algorithm>
#include <random>
#include <fstream>
#include <limits>
#include <unordered_set>
#include <chrono>
#include <thread>
#include <nlohmann/json.hpp>

#if defined(_WIN32)
extern "C" {
__declspec(dllexport) unsigned long NvOptimusEnablement = 0x00000001;
__declspec(dllexport) int AmdPowerXpressRequestHighPerformance = 1;
}
#endif

namespace fs = std::filesystem;

int main(int argc, char** argv) {
#if defined(_WIN32)
    HWND consoleWnd = ::GetConsoleWindow();
    if (consoleWnd != NULL) {
        ::ShowWindow(consoleWnd, SW_HIDE);
    }
#endif
    using namespace Bazuko;
    Paths::Init(argc, argv);

    LogInfo("Iniciando Bazuko - Motor C++ / OpenGL 4.5 Core DSA...");

    Window window({"Bazuko - Bogota 3D (C++ OpenGL 4.5 DSA)", 1280, 720, false, true});
    Input::Init(window.GetNativeWindow());

    Renderer renderer;
    if (const char* gammaEnv = std::getenv("BAZUKO_GAMMA")) renderer.SetGammaCorrect(std::atoi(gammaEnv) != 0);   // pruebas: 0 compara sin gamma
    AudioManager audio;
    UIManager ui(window.GetNativeWindow());
    Camera camera(55.0f, window.GetAspectRatio());

    window.SetResizeCallback([&](int width, int height) {
        if (height > 0) {
            camera.SetAspectRatio(static_cast<float>(width) / static_cast<float>(height));
            renderer.SetViewport(0, 0, width, height);
        }
    });

    ui.RenderLoadingScreen(window, 0.06f, "Motor gráfico, audio e interfaz inicializados...",
                          "💡 Consejo: Rebusca en las bolsas de basura de la Séptima para conseguir reciclaje y comida.");

    std::unique_ptr<Renderer> previewRenderer;   // vista previa del cambuche (se crea la primera vez que se abre el menu)
    CityLayout city([&](size_t completed, size_t total, const std::string& stage) {
        const float progress = 0.06f + 0.22f * static_cast<float>(completed) / static_cast<float>(total);
        ui.RenderLoadingScreen(window, progress, stage,
                               "💡 Consejo: Puedes alternar entre vista en tercera persona e isométrica con la tecla [V].");
    });

    CharacterManager characterManager;
    Ragdoll playerRagdoll;
    CharacterCreatorUI characterCreatorUI;
    CharacterPreview characterPreview;

    // semilla del mundo: 42 como siempre; BAZUKO_SEED permite reproducir otra (y es la que compartira el servidor con sus clientes)
    const uint32_t worldSeed = std::getenv("BAZUKO_SEED") ? static_cast<uint32_t>(std::strtoul(std::getenv("BAZUKO_SEED"), nullptr, 10)) : 42u;
    Simulation simulation(city, worldSeed, [&](size_t completed, size_t total, const std::string& name) {
        const float progress = 0.28f + 0.47f * static_cast<float>(completed) / static_cast<float>(total);
        const std::string stage = "Cargando mundo urbano (" + std::to_string(completed)
            + "/" + std::to_string(total) + "): " + (name.empty() ? "elementos 3D" : name) + "...";
        ui.RenderLoadingScreen(window, progress, stage,
                               "💡 Consejo: Cuida tus niveles de hambre, sed y salud para no enfermarte.");
    });
    audio.SetRaining(simulation.IsRaining());
    Lake lake;   // agua del Parque del Lago, peces y salpicaduras
    Decals decals;   // manchas de aceite, grietas y mugre sobre calles y andenes
    decals.Build(city, simulation.StreetLampPositions());
    LogInfo("Decals generados: {} (en paredes y postes: {})", decals.Count(), decals.CountWall());
    LightBeams lightBeams;   // conos de luz de los faros en niebla, lluvia o bruma
    float frameLampPower = 0.0f;   // que tan encendidas estan las luces de la calle (0 de dia, 1 de noche)
    SkyDome skyDome;   // cielo con gradiente y nubes
    SkyColors skyColors;
    float moonVisibility = 0.0f, moonPhase = 0.5f;

    characterManager.Init([&](size_t completed, size_t total) {
        const float progress = 0.75f + 0.13f * static_cast<float>(completed) / static_cast<float>(total);
        const std::string stage = "Cargando modelos y animaciones del personaje (" + std::to_string(completed)
            + "/" + std::to_string(total) + ")...";
        ui.RenderLoadingScreen(window, progress, stage,
                               "💡 Consejo: Puedes personalizar tu aspecto, sexo, corte y ropa con la tecla [P].");
    });

    characterPreview.Init(512, 640);
    ui.RenderLoadingScreen(window, 0.89f, "Configurando estudio 3D y vista previa...",
                           "💡 Consejo: Puedes personalizar tu aspecto, sexo, corte y ropa con la tecla [P].");
    PlayerSession session;   // todo el estado del jugador vive aqui (game/PlayerSession.hpp); abajo, referencias con los nombres de siempre
    auto& playerPos = session.position;
    playerPos = city.GetSpawnPoint();
    // GPS a pie sobre la grilla del mapa: anden 1, cruce de calzada 6 (busway 10); edificios, agua, solidos y obstaculos no se pisan
    GpsNavigation gps(CityLayout::WIDTH, CityLayout::HEIGHT, CityLayout::TILE_SIZE, CityLayout::ORIGIN_X, CityLayout::ORIGIN_Z,
        [&city](int tx, int tz) {
            const float wx = static_cast<float>(tx) * CityLayout::TILE_SIZE + CityLayout::TILE_SIZE * 0.5f - CityLayout::ORIGIN_X;
            const float wz = static_cast<float>(tz) * CityLayout::TILE_SIZE + CityLayout::TILE_SIZE * 0.5f - CityLayout::ORIGIN_Z;
            if (!city.IsWalkable(wx, wz) || city.HitsObstacle(wx, wz, 0.9f) || Viaduct::BlockedOnGround(wx, wz)) return GpsNavigation::kBlocked;
            const TileType tile = city.GetTileAt(tx, tz);
            if (tile == TileType::Road) return 6.0f;
            if (tile == TileType::Busway) return 10.0f;
            if (tile == TileType::Grass || tile == TileType::Dirt) return 1.15f;
            return 1.0f;
        });
    std::optional<std::tuple<float, float, std::string>> pendingGps;   // destino guardado: se planifica en el primer cuadro
    const std::shared_ptr<Mesh> gpsBeacon = Mesh::CreateCube({0.5f, 40.0f, 0.5f}, {1.0f, 0.35f, 0.68f, 1.0f});
    playerPos.y = 0.0f;
    auto& knockedOnDeck = session.knockedOnDeck;   // la caida empezo sobre el tablero: se levanta alli
    StarField starField;
    auto& locomotionPhase = session.locomotionPhase;   // fase 0..1 del ciclo de caminar/correr: avanza segun la velocidad del personaje
    float starVisibility = 0.0f;   // 0..1: las estrellas aparecen al oscurecer y con el cielo despejado
    glm::vec3 celestialSun(0.0f, 1.0f, 0.0f), celestialMoon(0.0f, -1.0f, 0.0f);   // direcciones hacia el sol y la luna
    float celestialMoonLight = 1.0f;                                                // fraccion iluminada de la luna
    auto& playerOnDeck = session.playerOnDeck;   // sobre el tablero del viaducto (capa elevada); en la calle pasa por debajo
    // Regla estricta: el jugador nunca aparece ni se carga dentro de un edificio, un modelo o un recinto sin salida.
    // Toda posicion que se le asigna (inicio, partida guardada, partida nueva, recuperacion, fin de una caida)
    // pasa por aqui: si esta bloqueada o encerrada se mueve al lugar libre con salida mas cercano.
    const auto isFreeForPlayer = [&](float x, float z) {
        return city.IsWalkable(x, z) && !city.HitsObstacle(x, z, 0.5f) && !simulation.IsBlocked({x, 0.0f, z}, 0.5f);
    };
    // Donde se puede pisar segun la capa: sobre el tablero solo entre las barandas (y el bus elevado); en la calle,
    // el mapa, los vehiculos y el muro bajo de la rampa
    const auto canStand = [&](float x, float z) {
        if (playerOnDeck) return !Viaduct::BlockedOnDeck(x, z, 0.35f) && !simulation.IsBlocked({x, playerPos.y, z}, 0.35f);
        return city.IsWalkable(x, z, true) && !city.HitsObstacle(x, z, 0.35f) && !Viaduct::BlockedOnGround(x, z) && !simulation.IsBlocked({x, 0.0f, z}, 0.35f);   // el jugador puede meterse al lago
    };
    const auto placeSafely = [&](const glm::vec3& wanted) {
        glm::vec3 safe = FindSafePlayerPosition(wanted, isFreeForPlayer, city.GetSpawnPoint());
        safe.y = city.GetGroundHeight(safe.x, safe.z);
        if (glm::distance(glm::vec2(safe.x, safe.z), glm::vec2(wanted.x, wanted.z)) > 0.05f)
            LogWarn("Posicion del jugador bloqueada ({:.1f}, {:.1f}): se movio a ({:.1f}, {:.1f})", wanted.x, wanted.z, safe.x, safe.z);
        return safe;
    };
    playerPos = placeSafely(playerPos);
    auto& playerYaw = session.playerYaw;
    auto& playerKnockedDown = session.playerKnockedDown;
    auto& knockdownRemaining = session.knockdownRemaining;
    auto& vehicleImpactCooldown = session.vehicleImpactCooldown;
    auto& deathByVehicleImpact = session.deathByVehicleImpact;
    auto& poopCooldown = session.poopCooldown;
    auto& poopAnimationRemaining = session.poopAnimationRemaining;
    auto& poopMode = session.poopMode;   // 0 nada, 1 agacharse a hacer popo, 2 recoger el mojon con la mano y lanzarlo
    auto& poopElapsed = session.poopElapsed;
    auto& poopStepDone = session.poopStepDone;
    auto& poopThrowDirection = session.poopThrowDirection;
    const auto& recipes = Economy::Recipes();   // recetas de la mesa de crafteo (game/Economy.cpp)
    // Acciones del personaje (animaciones de Blender): saltar (Espacio), agacharse (Ctrl), puños (J), patada (K) y navaja (H)
    auto& petWaiting = session.petWaiting; auto& petRewardPending = session.petRewardPending;   // caricia al Chato: se pide con E, el perro se sienta delante y luego la anima PetDog
    auto& petWaitTime = session.petWaitTime;
    auto& playerAction = session.playerAction;
    const auto combatMoveOf = [](PlayerAction action) -> int {   // tecnica por codigo (CombatMoves.hpp) de cada accion de combate; -1 si no la tiene
        switch (action) {
            case PlayerAction::Jab: return static_cast<int>(Combat::Move::Jab);
            case PlayerAction::Cross: return static_cast<int>(Combat::Move::Cross);
            case PlayerAction::Hook: return static_cast<int>(Combat::Move::Hook);
            case PlayerAction::Kick: return static_cast<int>(Combat::Move::Roundhouse);
            case PlayerAction::HighKick: return static_cast<int>(Combat::Move::HighRoundhouse);
            case PlayerAction::Slip: return static_cast<int>(Combat::Move::Slip);
            case PlayerAction::Duck: return static_cast<int>(Combat::Move::RollingDuck);
            default: return -1;
        }
    };
    auto& playerActionClip = session.playerActionClip;
    auto& actionTime = session.actionTime; auto& actionDuration = session.actionDuration;
    auto& nextKnifeIsStab = session.nextKnifeIsStab; auto& nextKickIsHigh = session.nextKickIsHigh; auto& nextDodgeIsDuck = session.nextDodgeIsDuck;
    auto& punchChain = session.punchChain;   // jab, cruzado y gancho en cadena (se reinicia si pasa mas de 1,4 s)
    auto& fightStanceRemaining = session.fightStanceRemaining; auto& knifeStanceRemaining = session.knifeStanceRemaining; auto& stillSeconds = session.stillSeconds;
    auto& jumpOffset = session.jumpOffset;
    auto& pickupTime = session.pickupTime;   // >= 0 mientras recoge una bolsa de un golpe (E): se agacha y el brazo baja al objeto
    auto& pickupTarget = session.pickupTarget;
    auto& grabTime = session.grabTime;   // >= 0 mientras el brazo derecho roba un retrovisor (Combat::AppendGrab)
    auto& jumpMoving = session.jumpMoving;   // salto con carrera (camino o corriendo) en vez de salto estatico
    auto& jumpDirection = session.jumpDirection;   // hacia donde sale despedido el salto en movimiento
    auto& jumpSpeed = session.jumpSpeed;   // m/s horizontales en el aire: decide cuanto avanza

    auto& playerCrouching = session.playerCrouching;
    // Clic izquierdo: golpes encadenados (jab, cruzado y patada). Los golpes recibidos y el atropello tienen sus propias animaciones.
    auto& comboStep = session.comboStep;
    auto& comboIdle = session.comboIdle; auto& clickTime = session.clickTime; auto& clickMove = session.clickMove;
    auto& clickTracking = session.clickTracking; auto& clickWasLocked = session.clickWasLocked; auto& actionHitDone = session.actionHitDone;
    auto& playerHitKind = session.playerHitKind;   // 0 ninguno, 1 cara, 2 pecho, 3 piernas
    auto& playerHitTime = session.playerHitTime;
    auto& playerStaggerDirection = session.playerStaggerDirection;   // hacia donde lo empuja el golpe: da pasos atras por la desestabilizacion
    auto& knockdownLyingYaw = session.knockdownLyingYaw;
    constexpr float kKnockdownSeconds = 3.4f;   // vuelo (0,8 s), tendido (0,8 s), levantarse (1,5 s) y una pausa
    std::shared_ptr<Model> knifeModel = Model::LoadFromFile(Paths::Find("public/models/arma/cuchillo.glb"));
    auto& boostActive = session.boostActive;
    auto& boostTimer = session.boostTimer;
    // Objetos, tienda, botin y talentos vienen de assets/data/game-data.json (generado desde src/data del juego web).
    // El orden de los objetos es fijo: las partidas guardadas guardan su indice.
    const GameData& gameData = GameData::Get();
    using Item = ItemDef;
    const std::vector<Item>& lootTable = gameData.items;
    auto& inventory = session.inventory;
    auto& inventoryWeight = session.inventoryWeight;
    auto& money = session.money;
    auto& xp = session.xp;
    auto& level = session.level;
    auto& talentPoints = session.talentPoints;
    auto& bigSack = session.bigSack;   // Costal grande comprado en la tienda
    auto& playerWaterDepth = session.playerWaterDepth;   // metros de agua del lago sobre el fondo donde pisa el jugador
    auto& playerSwimming = session.playerSwimming;   // agua profunda: nada en lugar de caminar
    auto& swimPhase = session.swimPhase;   // fase 0..1 de la brazada
    auto& swimPitch = session.swimPitch;   // 0 de pie en el agua .. 1 tendido nadando (se suaviza)
    auto& tiredGait = session.tiredGait;   // el jugador camina cansado por falta de energia
    auto& playerFreezing = session.playerFreezing;   // frio nocturno con lluvia y sin calor (La Nevera)
    auto& warmTimer = session.warmTimer;   // s de calor contra el frio: lo dan la comida caliente y el fogon del cambuche; se guarda
    auto& playerWetness = session.playerWetness;   // 0 seco .. 1 empapado: la lluvia moja, el tiempo seca; no se guarda
    auto& coldCheckTimer = session.coldCheckTimer;
    auto& radioOn = session.radioOn;   // radio transistor: encendida, volumen propio y bateria (100 % dura unos 40 min)
    auto& radioVolume = session.radioVolume;
    auto& radioBattery = session.radioBattery;
    int graphicsQuality = 1;   // 0 baja, 1 media, 2 alta: escala de resolucion interna 1 / 1 / 1,5
    auto& playerVelocity = session.playerVelocity;   // inercia de movimiento (como Player.js: 22/s al moverse, 18/s al frenar)
    auto& equippedWeapon = session.equippedWeapon;   // arma en la mano (id del objeto: cuchillo, botella_picada, arma), vacio = puños
    auto& hotbar = session.hotbar;   // objetos de la barra de acceso rapido (teclas 1-5)
    auto& sorting = session.sorting;   // manteniendo Q sobre una bolsa
    auto& sortProgress = session.sortProgress;
    auto& sortPosition = session.sortPosition;
    auto& unlockedTalents = session.unlockedTalents;
    auto& companionName = session.companionName;
    auto& companionCoat = session.companionCoat;
    auto& companionIsFriend = session.companionIsFriend;
    auto& companionPosition = session.companionPosition;
    companionPosition = simulation.GetDogPosition();
    auto& itemsCollected = session.itemsCollected;
    auto& itemsSold = session.itemsSold;
    auto& missionProgress = session.missionProgress;
    auto& needs = session.needs;
    const auto knockDownPlayer = [&](float impactSpeed, const glm::vec3& impactDirection) {
        const float damage = std::min(100.0f, std::max(4.0f,
            std::round(0.6f * impactSpeed * impactSpeed + 1.5f * impactSpeed)));
        needs[3] = std::max(0.0f, needs[3] - damage);
        needs[2] = std::max(0.0f, needs[2] - damage * 0.25f);
        vehicleImpactCooldown = 1.5f;
        if (needs[3] <= 0.0f) deathByVehicleImpact = true;
        playerKnockedDown = true;
        knockdownRemaining = kKnockdownSeconds;
        // cae con el cuerpo girado de forma distinta cada vez (no siempre alineado con el golpe)
        knockdownLyingYaw = std::atan2(-impactDirection.x, -impactDirection.z) + (static_cast<float>(std::rand() % 1000) / 1000.0f - 0.5f) * 1.4f;
        playerHitKind = 0;
        const glm::vec3 impactVelocity = impactDirection * std::max(2.0f, impactSpeed * 0.8f)
            + glm::vec3(0.0f, std::max(2.0f, impactSpeed * 0.55f), 0.0f);
        // sobre el tablero cae sobre el tablero (contenido por las barandas); en la calle, sobre la calzada
        knockedOnDeck = playerOnDeck;
        playerRagdoll.SetSurface(playerOnDeck ? playerPos.y : 0.0f, playerOnDeck ? Viaduct::kWalkHalfWidth : 0.0f);
        playerRagdoll.Begin(playerPos, playerYaw, impactVelocity, characterManager.GetLook());
        ui.SetPickupNotification("¡Atropellamiento! Recupera salud y espera a que termine la caída.");
    };
    auto& objective = session.objective;
    auto& diseases = session.diseases;
    const auto showDeathScreenIfNeeded = [&]() {
        if (needs[3] > 0.0f || playerKnockedDown || ui.IsDeathScreenOpen()) return;
        std::vector<std::string> causes;
        if (deathByVehicleImpact) causes.emplace_back("atropello");
        if (needs[1] <= 0.0f) causes.emplace_back("deshidratación");
        if (needs[0] <= 0.0f) causes.emplace_back("hambre");
        if (needs[2] <= 0.0f) causes.emplace_back("agotamiento");
        if (needs[4] <= 0.0f) causes.emplace_back("higiene agotada");
        if (needs[5] <= 0.0f) causes.emplace_back("ánimo agotado");
        if (needs[6] < 20.0f) causes.emplace_back("abstinencia");
        if (!diseases.empty()) causes.emplace_back("enfermedad");
        if (causes.empty()) causes.emplace_back("salud agotada");
        std::string summary;
        for (const auto& cause : causes) {
            if (!summary.empty()) summary += ", ";
            summary += cause;
        }
        // lugar de la muerte para el recorte de periodico: la franja de calle mas cercana
        std::string place = "la calle";
        {
            const auto& data = city.GetData();
            const auto nearest = [&](const std::vector<CityLayout::Band>& bands, bool alongX, float origin, float coordinate, float& best) {
                int found = -1;
                for (size_t i = 0; i < bands.size(); ++i) {
                    const float center = ((bands[i].first + bands[i].last + 1) * 0.5f) * CityLayout::TILE_SIZE - origin;
                    if (std::abs(coordinate - center) < best) { best = std::abs(coordinate - center); found = static_cast<int>(i); }
                }
                (void)alongX;
                return found;
            };
            float bestDistance = 1.0e9f;
            static const char* const calles[] = {"la Calle 10", "la Calle 9", "la Calle 8", "la Calle 7"};
            static const char* const carreras[] = {"la Carrera 15", "la Carrera 10", "la Carrera 8", "la Carrera 7", "la Carrera 6"};
            std::vector<CityLayout::Band> calleBands = data.calles;
            for (auto& band : calleBands) { band.first += CityLayout::NORTH_ROWS; band.last += CityLayout::NORTH_ROWS; }
            const int street = nearest(calleBands, false, CityLayout::ORIGIN_Z, playerPos.z, bestDistance);
            const int avenue = nearest(data.carreras, true, CityLayout::ORIGIN_X, playerPos.x, bestDistance);
            if (bestDistance < 30.0f) {
                if (avenue >= 0 && bestDistance < 1.0e8f && std::abs(playerPos.x - (((data.carreras[static_cast<size_t>(avenue)].first + data.carreras[static_cast<size_t>(avenue)].last + 1) * 0.5f) * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X)) <= bestDistance + 0.01f)
                    place = carreras[std::min<size_t>(static_cast<size_t>(avenue), 4)];
                else if (street >= 0) place = calles[std::min<size_t>(static_cast<size_t>(street), 3)];
            }
        }
        ui.ShowDeathScreen(summary, deathByVehicleImpact, characterManager.GetLook().nombre, place);
    };
    const fs::path savePath = "savegame.json";
    bool hasSavedCharacter = false;
    ui.RenderLoadingScreen(window, 0.90f, "Comprobando y restaurando datos de partida...",
                          "💡 Consejo: Tus necesidades y tu inventario se conservan al guardar.");
    {
        std::ifstream save(savePath);
        if (save) {
            try {
                nlohmann::json state;
                save >> state;
                auto savedNeeds = state.value("needs", std::vector<float>{});
                for (size_t i = 0; i < std::min(needs.size(), savedNeeds.size()); ++i) needs[i] = std::clamp(savedNeeds[i], 0.0f, 100.0f);
                money = state.value("money", 0.0f);
                xp = state.value("xp", 0);
                level = std::max(1, state.value("level", 1));
                talentPoints = std::max(0, state.value("talentPoints", level - 1));
                for (const auto& id : state.value("talents", std::vector<std::string>{})) {
                    if (gameData.FindTalent(id)) unlockedTalents.insert(id);
                }
                bigSack = state.value("bigSack", false);
                graphicsQuality = std::clamp(state.value("graphicsQuality", 1), 0, 2);
                if (state.contains("radio") && state["radio"].is_object()) {
                    const auto& savedRadio = state["radio"];
                    radioOn = savedRadio.value("on", false);
                    radioVolume = std::clamp(savedRadio.value("volume", 0.7f), 0.0f, 1.0f);
                    radioBattery = std::clamp(savedRadio.value("battery", 100.0f), 0.0f, 100.0f);
                    ui.SelectRadioStation(savedRadio.value("station", std::string{}));
                }
                {
                    const auto savedHotbar = state.value("hotbar", std::vector<std::string>{});
                    for (size_t slot = 0; slot < std::min(hotbar.size(), savedHotbar.size()); ++slot)
                        if (savedHotbar[slot].empty() || gameData.FindItem(savedHotbar[slot])) hotbar[slot] = savedHotbar[slot];
                }
                equippedWeapon = state.value("equippedWeapon", std::string{});
                warmTimer = std::clamp(state.value("warmTimer", 0.0f), 0.0f, 900.0f);
                if (!equippedWeapon.empty() && !FindWeapon(equippedWeapon)) equippedWeapon.clear();
                companionName = state.value("companionName", companionName);
                companionCoat = std::clamp(state.value("companionCoat", 0), 0, 3);
                const float savedCompanionSize = state.value("companionSize", 1.0f);
                const int savedCompanionAccessory = state.value("companionAccessory", 0);
                companionIsFriend = state.value("companionIsFriend", false);
                companionPosition.x = state.value("companionX", companionPosition.x);
                companionPosition.z = state.value("companionZ", companionPosition.z);
                simulation.SetDogState(companionIsFriend, companionPosition, companionCoat);
                ui.SetCompanionCustomization(companionName, companionCoat, savedCompanionSize, savedCompanionAccessory);
                itemsCollected = state.value("itemsCollected", 0);
                itemsSold = state.value("itemsSold", 0);
                missionProgress = state.value("missionProgress", size_t{0});
                simulation.SetMissionProgress(missionProgress);
                if (state.value("missionStarted", false)) simulation.StartMission();
                if (state.value("missionComplete", false)) simulation.CompleteMission();
                objective = state.value("objective", objective);
                {
                    CambucheState cambucheState{};
                    const auto& savedCambuche = state.value("cambuche", nlohmann::json::object());
                    cambucheState.base    = savedCambuche.value("base",    false);
                    cambucheState.techo   = savedCambuche.value("techo",   false);
                    cambucheState.paredes = savedCambuche.value("paredes", false);
                    cambucheState.cama    = savedCambuche.value("cama",    false);
                    cambucheState.fogon   = savedCambuche.value("fogon",   false);
                    cambucheState.vela    = savedCambuche.value("vela",    false);
                    simulation.SetCambucheState(cambucheState);
                }
                for (const auto& savedDisease : state.value("diseases", nlohmann::json::array())) {
                    DiseaseState disease{savedDisease.value("id", std::string{}), savedDisease.value("remaining", 0.0f), savedDisease.value("healthDrain", 0.0f), savedDisease.value("mentalDrain", 0.0f)};
                    if (disease.remaining > 0.0f && disease.healthDrain > 0.0f) diseases.push_back(std::move(disease));
                }
                if (state.contains("dayProgress")) simulation.SetDayProgress(state.value("dayProgress", 0.30f));
                simulation.SetDay(state.value("day", 1));
                if (state.contains("gps") && state["gps"].is_object())
                    pendingGps = std::make_tuple(state["gps"].value("x", 0.0f), state["gps"].value("z", 0.0f), state["gps"].value("name", std::string("Punto marcado")));
                // Las partidas guardadas con la distribucion de calles anterior (sin mapVersion) usan otro marco de
                // coordenadas: conservan todo menos la posicion, y el jugador vuelve al cambuche
                const bool sameMap = state.value("mapVersion", 1) >= 2;
                if (sameMap) {
                    playerPos.x = state.value("playerX", playerPos.x);
                    playerPos.z = state.value("playerZ", playerPos.z);
                }
                {
                    const glm::vec3 savedPosition = playerPos;
                    float deckY = 0.0f;
                    if (sameMap && state.value("playerOnDeck", false) && Viaduct::StepLayer(true, playerPos.x, playerPos.z, deckY)) {
                        playerOnDeck = true;   // guardo sobre el tablero: se queda alli
                        playerPos.y = deckY;
                    } else {
                        playerOnDeck = false;
                        playerPos = placeSafely(savedPosition);
                    }
                    if (glm::distance(glm::vec2(savedPosition.x, savedPosition.z), glm::vec2(playerPos.x, playerPos.z)) > 0.05f)
                        ui.Notify("Tu posición guardada estaba bloqueada: te movimos al lugar libre más cercano.", ToastType::Warn);
                }
                auto restoredInventory = RestoreInventory(state.value("inventory", nlohmann::json::array()),
                                                          gameData, unlockedTalents, bigSack);
                inventory = std::move(restoredInventory.entries);
                inventoryWeight = restoredInventory.weight;
                hasSavedCharacter = characterManager.Deserialize(state, [&](size_t completed, size_t total) {
                    const float progress = 0.91f + 0.06f * static_cast<float>(completed) / static_cast<float>(total);
                    const std::string stage = "Cargando apariencia del personaje (" + std::to_string(completed)
                        + "/" + std::to_string(total) + " piezas)...";
                    ui.RenderLoadingScreen(window, progress, stage);
                });
            } catch (const std::exception& error) { LogWarn("Partida guardada inválida: {}", error.what()); }
        }
    }
    ui.RenderLoadingScreen(window, 0.97f, "Partida y estado del jugador preparados...");
    std::mt19937 lootRandom(std::random_device{}());
    float survivalSaveTimer = 0.0f;
    float begCooldownRemaining = 0.0f;
    const auto hasTalent = [&](const std::string& id) { return unlockedTalents.contains(id); };
    const auto talentEffect = [&](const std::string& key, float base = 1.0f) {
        return gameData.TalentEffect(unlockedTalents, key, base);
    };
    const auto cambucheBuilt = [&](const std::string& id) {
        const auto& state = simulation.GetCambucheState();
        return id == "base" ? state.base : id == "techo" ? state.techo : id == "paredes" ? state.paredes
             : id == "cama" ? state.cama : id == "fogon" ? state.fogon : id == "vela" ? state.vela : false;
    };
    const auto inventoryCapacity = [&]() {
        return Economy::Capacity(session, gameData);
    };
    const auto awardXp = [&](int amount, float activityMultiplier = 1.0f) {
        const int gained = Economy::AwardXp(session, amount, activityMultiplier, talentEffect("xpMult"));
        for (int i = 1; i <= gained; ++i) ui.Notify("¡Nivel " + std::to_string(level - gained + i) + "! +1 punto de talento", ToastType::Rare);
    };

    auto saveGame = [&](const std::string& feedbackMsg = "Partida guardada con éxito") {
        nlohmann::json state;
        state["needs"] = needs;
        state["money"] = money;
        state["xp"] = xp;
        state["level"] = level;
        state["talentPoints"] = talentPoints;
        state["bigSack"] = bigSack;
        state["hotbar"] = hotbar;
        state["equippedWeapon"] = equippedWeapon;
        state["warmTimer"] = warmTimer;
        state["graphicsQuality"] = graphicsQuality;
        state["radio"] = {{"on", radioOn}, {"volume", radioVolume}, {"battery", radioBattery}, {"station", ui.SelectedRadioStationId()}};
        state["talents"] = std::vector<std::string>(unlockedTalents.begin(), unlockedTalents.end());
        state["itemsCollected"] = itemsCollected;
        state["itemsSold"] = itemsSold;
        state["missionProgress"] = simulation.GetMissionProgress();
        state["missionStarted"] = simulation.IsMissionStarted();
        state["missionComplete"] = simulation.IsMissionComplete();
        state["objective"] = objective;
        state["dayProgress"] = simulation.GetDayProgress();
        state["day"] = simulation.GetDay();
        if (gps.Waypoint()) state["gps"] = {{"x", gps.Waypoint()->x}, {"z", gps.Waypoint()->z}, {"name", gps.Name()}};
        state["diseases"] = nlohmann::json::array();
        for (const auto& disease : diseases) {
            state["diseases"].push_back({{"id", disease.id}, {"remaining", disease.remaining}, {"healthDrain", disease.healthDrain}, {"mentalDrain", disease.mentalDrain}});
        }
        state["mapVersion"] = 2;   // mapa del original (assets/data/city-map.json)
        state["playerX"] = playerPos.x;
        state["playerZ"] = playerPos.z;
        state["playerOnDeck"] = playerOnDeck;
        state["companionName"] = ui.GetCompanionName();
        state["companionCoat"] = ui.GetCompanionCoat();
        state["companionSize"] = ui.GetCompanionSize();
        state["companionAccessory"] = ui.GetCompanionAccessory();
        state["companionIsFriend"] = simulation.IsDogFriend();
        state["companionX"] = simulation.GetDogPosition().x;
        state["companionZ"] = simulation.GetDogPosition().z;
        {
            const auto& cs = simulation.GetCambucheState();
            state["cambuche"] = {
                {"base",    cs.base},
                {"techo",   cs.techo},
                {"paredes", cs.paredes},
                {"cama",    cs.cama},
                {"fogon",   cs.fogon},
                {"vela",    cs.vela}
            };
        }
        characterManager.Serialize(state);
        state["inventory"] = nlohmann::json::array();
        for (const auto& entry : inventory) {
            state["inventory"].push_back({{"item", entry.itemIndex}, {"quantity", entry.quantity}});
        }
        std::ofstream save(savePath);
        if (save) {
            save << state.dump(2);
            ui.SetSaveNotification(feedbackMsg);
            LogInfo("Partida guardada correctamente en {}", savePath.string());
        }
        survivalSaveTimer = 0.0f;
    };

    auto startNewGame = [&]() {
        std::error_code ec;
        fs::remove(savePath, ec);

        playerPos = placeSafely(city.GetSpawnPoint());
        playerOnDeck = false;
        playerYaw = 0.0f;
        needs = {100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 80.0f};
        money = 0.0f;
        xp = 0;
        level = 1;
        talentPoints = 0;
        bigSack = false;
        hotbar = {};
        equippedWeapon.clear();
        warmTimer = 0.0f;
        radioOn = false;
        radioBattery = 100.0f;
        unlockedTalents.clear();
        companionName = "El Chato";
        companionCoat = 0;
        companionIsFriend = false;
        companionPosition = {4.0f, 0.0f, 4.0f};
        simulation.SetDogState(false, companionPosition, companionCoat);
        ui.SetCompanionCustomization(companionName, companionCoat);
        simulation.SetCambucheState({});
        playerWetness = 0.0f;
        coldCheckTimer = 0.0f;
        itemsCollected = 0;
        itemsSold = 0;
        missionProgress = 0;
        objective = "Recoge 5 objetos para empezar";
        inventory.clear();
        inventoryWeight = 0.0f;
        diseases.clear();

        simulation.ResetMission();
        simulation.SetDayProgress(0.30f);
        simulation.SetDay(1);

        CharacterLook defaultLook;
        characterManager.ApplyLook(defaultLook, true);
        characterCreatorUI.Open(characterManager.GetLook(), false);

        ui.SetSaveNotification("¡Partida nueva iniciada!");
        LogInfo("Partida nueva iniciada desde cero.");
    };
    const auto tryInfectFromPickup = [&](bool sortedBag = false) -> std::string {
        const float resistance = talentEffect("diseaseResist") * characterManager.GetDiseaseResistance()
            * (sortedBag ? talentEffect("sortDiseaseMult") : 1.0f);
        return Economy::TryInfectFromPickup(session, lootRandom, sortedBag, resistance);
    };
    const auto addLootById = [&](const std::string& id) { return Economy::AddItem(session, gameData, id); };
    // Recolecta la bolsa o caneca mas cercana. `sorted`: se mantuvo Q el tiempo completo (mas botin y mas riesgo).
    // Lo que no cabe en el costal se queda en la bolsa para la proxima vez.
    auto harvestNearbyPickup = [&](float radius, bool sorted) {
        size_t nearest = simulation.GetPickups().size();
        float nearestDistance = radius;
        for (size_t index = 0; index < simulation.GetPickups().size(); ++index) {
            if (!simulation.GetPickups()[index].available) continue;
            const float distance = glm::distance(playerPos, simulation.GetPickups()[index].position);
            if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
        }
        PickupItem pickup;
        if (nearest >= simulation.GetPickups().size() || !simulation.CollectPickup(nearest, pickup)) return false;
        pickupTarget = pickup.position;   // hacia el que se agacha y baja el brazo
        pickupTime = 0.0f;

        std::vector<std::string> items;
        std::string rareFound;
        bool bagSorted = sorted;
        if (!pickup.pendingLoot.empty()) {
            items = pickup.pendingLoot;
            bagSorted = pickup.pendingSorted;
        } else {
            const HarvestParams params{boostActive, sorted, talentEffect("rareChanceMult"), characterManager.GetExtraLoot()};
            HarvestResult result = RollHarvest(gameData, params, lootRandom, pickup.guaranteedLoot);
            items = std::move(result.items);
            rareFound = std::move(result.rare);
        }
        std::vector<std::string> added, leftover;
        for (const std::string& id : items) (addLootById(id) ? added : leftover).push_back(id);
        pickup.pendingLoot = leftover;
        pickup.pendingSorted = bagSorted;
        if (added.empty()) {
            pickup.pendingLoot = items;
            simulation.RestorePickup(pickup);
            audio.Play(AudioCue::Full);
            ui.SetPickupNotification("El costal está lleno: la bolsa conserva su contenido.");
            return false;
        }
        if (!leftover.empty()) simulation.RestorePickup(pickup);
        else simulation.RecycleGuaranteedLoot(pickup.guaranteedLoot);

        itemsCollected += static_cast<int>(added.size());
        awardXp(3);
        const auto isRareItem = [&](const std::string& id) {
            const ItemDef* item = gameData.FindItem(id);
            return item && (item->rarity == "rare" || item->rarity == "veryRare");
        };
        const bool foundRare = !rareFound.empty() || std::any_of(added.begin(), added.end(), isRareItem);
        if (foundRare) needs[5] = std::min(100.0f, needs[5] + 8.0f);
        const std::string contractedDisease = tryInfectFromPickup(bagSorted);
        audio.Play(foundRare ? AudioCue::Treasure : AudioCue::Pickup);

        // "+ Lata vacía ×2 (Común) · Reloj oxidado (Raro)"
        std::string summary;
        std::vector<std::string> shown;
        for (const std::string& id : added) {
            if (std::find(shown.begin(), shown.end(), id) != shown.end()) continue;
            shown.push_back(id);
            const ItemDef* item = gameData.FindItem(id);
            if (!item) continue;
            const int count = static_cast<int>(std::count(added.begin(), added.end(), id));
            if (!summary.empty()) summary += " · ";
            summary += item->name;
            if (count > 1) summary += " ×" + std::to_string(count);
            if (!item->rarityLabel.empty()) summary += " (" + item->rarityLabel + ")";
        }
        std::string message = std::string(bagSorted ? "Clasificaste: " : "+ ") + summary;
        if (foundRare) message += " · +8 de ánimo";
        if (!leftover.empty()) message += " · El costal se llenó: el resto sigue en la bolsa.";
        if (!contractedDisease.empty()) message = "Te enfermaste de " + contractedDisease + " al rebuscar. " + message;
        ui.SetPickupNotification(message, foundRare);
        return true;
    };
    // Empieza a clasificar la bolsa cercana: hay que mantener Q kSortSeconds; soltar antes recoge sin clasificar.
    const auto beginSorting = [&](float radius) {
        float nearestDistance = radius;
        for (const PickupItem& pickup : simulation.GetPickups()) {
            if (!pickup.available) continue;
            const float distance = glm::distance(playerPos, pickup.position);
            if (distance >= nearestDistance) continue;
            nearestDistance = distance;
            sortPosition = pickup.position;
            sorting = true;
            sortProgress = 0.0f;
        }
        return sorting;
    };
    const auto inventoryCount = [&](const std::string& id) { return Economy::CountItem(session, gameData, id); };
    const auto availableLootCount = [&](const std::string& id) { return Economy::AvailableCount(session, gameData, id); };
    const auto isRecyclable = [](const Item& item) { return item.recyclable; };
    const auto applyItemEffect = [&](const Item& item) {
        switch (Economy::ApplyItemEffect(session, item)) {
            case Economy::EffectOutcome::Applied: return true;
            case Economy::EffectOutcome::NoSuchDisease: ui.SetPickupNotification("Usaste " + item.name + "; no tenías " + item.cure + "."); return true;
            case Economy::EffectOutcome::CuredDisease: ui.SetPickupNotification(item.name + " curó " + item.cure + "."); return true;
            case Economy::EffectOutcome::NotApplicable: break;
        }
        return false;
    };
    // Precio de la recicladora: adrenalina x1.2 y mejora de origen (Gota a gota +15 %)
    const auto recyclerMultiplier = [&]() {
        return (boostActive ? 1.2f : 1.0f) * characterManager.GetSellMultiplier();
    };
    const auto sellRecyclables = [&]() {
        const Economy::SellResult sale = Economy::SellRecyclables(session, gameData, recyclerMultiplier());
        if (sale.soldCount == 0) {
            audio.Play(AudioCue::Empty);
            ui.SetPickupNotification("No tienes materiales reciclables para vender.");
            return false;
        }
        awardXp(2 * sale.soldCount);
        audio.Play(AudioCue::Sell);
        ui.SetPickupNotification("Vendiste " + std::to_string(sale.soldCount) + " reciclables por $"
                                 + std::to_string(static_cast<int>(sale.earned)) + " COP.");
        return true;
    };

    ui.RenderLoadingScreen(window, 0.99f, "Sincronizando semáforos, rutas de tráfico y entorno...", "");
    ui.RenderLoadingScreen(window, 1.0f, "¡Todo listo! Entrando a Bogotá...", "");
#ifdef BAZUKO_NET_ENABLED
    std::unique_ptr<Net::NetSession> netSession;
    {   // multijugador (compilado con -DBAZUKO_NET=ON): --anfitrion[=puerto] o --conectar=ip[:puerto]  (tambien BAZUKO_HOST / BAZUKO_JOIN)
        std::string hostArg, joinArg;
        for (int i = 1; i < argc; ++i) {
            const std::string arg = argv[i];
            if (arg == "--anfitrion") hostArg = "7777";
            else if (arg.rfind("--anfitrion=", 0) == 0) hostArg = arg.substr(12);
            else if (arg.rfind("--conectar=", 0) == 0) joinArg = arg.substr(11);
        }
        if (const char* env = std::getenv("BAZUKO_HOST")) hostArg = env;
        if (const char* env = std::getenv("BAZUKO_JOIN")) joinArg = env;
        const std::string playerName = characterManager.GetLook().nombre.empty() ? std::string("Parcero") : characterManager.GetLook().nombre;
        if (!hostArg.empty()) {
            netSession = Net::NetSession::StartHost(static_cast<uint16_t>(std::atoi(hostArg.c_str())), playerName);
            if (netSession) { netSession->SetWorldProvider([&simulation](const glm::vec3& viewer, uint32_t tick) { return simulation.ExportWorld(viewer, tick); });
                LogInfo("Multijugador: anfitrion en el puerto {}", netSession->Port()); ui.Notify("Eres el anfitrión: puerto " + std::to_string(netSession->Port()), ToastType::Info); }
            else LogWarn("Multijugador: no se pudo abrir el puerto {}", hostArg);
        } else if (!joinArg.empty()) {
            const size_t colon = joinArg.rfind(':');
            const std::string address = colon == std::string::npos ? joinArg : joinArg.substr(0, colon);
            const uint16_t port = colon == std::string::npos ? uint16_t{7777} : static_cast<uint16_t>(std::atoi(joinArg.c_str() + colon + 1));
            netSession = Net::NetSession::Join(address, port, playerName);
            if (netSession) { LogInfo("Multijugador: conectando a {}:{}", address, port); ui.Notify("Conectando a " + address + ":" + std::to_string(port) + "...", ToastType::Info); }
            else LogWarn("Multijugador: no se pudo conectar a {}:{}", address, port);
        }
    }
#endif
    // Verificacion visual: BAZUKO_SHOT=ruta.png guarda una captura tras BAZUKO_SHOT_DELAY s (por defecto 6) y cierra
    const char* shotPath = std::getenv("BAZUKO_SHOT");
    float shotDelay = 6.0f;
    if (const char* delay = std::getenv("BAZUKO_SHOT_DELAY")) shotDelay = static_cast<float>(std::atof(delay));
    if (const char* where = std::getenv("BAZUKO_POS")) {   // pruebas: BAZUKO_POS=x,z coloca al jugador (p. ej. dentro del lago), con o sin captura
        float px = 0.0f, pz = 0.0f;
        if (std::sscanf(where, "%f,%f", &px, &pz) == 2) playerPos = glm::vec3(px, std::max(city.GetGroundHeight(px, pz), CityLayout::kLakeSurface - 1.25f), pz);
    }
    if (shotPath) {
        const auto envFloat = [](const char* name, float fallback) { const char* v = std::getenv(name); return v ? static_cast<float>(std::atof(v)) : fallback; };
        if (std::getenv("BAZUKO_PREVIEW_GRAB")) grabTime = static_cast<float>(std::atof(std::getenv("BAZUKO_PREVIEW_GRAB")));   // pruebas: congela el robo en ese segundo
        if (std::getenv("BAZUKO_DOG_FRIEND")) simulation.BefriendDog();   // pruebas: El Chato ya es amigo (se puede acariciar)
        if (const char* weather = std::getenv("BAZUKO_WEATHER")) simulation.ForceWeather(static_cast<Climate::Weather>(std::clamp(std::atoi(weather), 0, Climate::kWeatherCount - 1)));   // pruebas: 0 soleado .. 6 tormenta
        if (const char* hour = std::getenv("BAZUKO_HOUR")) simulation.SetDayProgress(static_cast<float>(std::atof(hour)) / 24.0f);   // pruebas: hora del dia
        camera.SetOrbit(envFloat("BAZUKO_YAW", camera.GetYaw()), envFloat("BAZUKO_PITCH", 0.22f), envFloat("BAZUKO_DIST", 5.5f));
    } else {
        ui.OpenDeveloperNote();
        // pruebas: hora y clima tambien al jugar normal (sin captura)
        if (const char* weather = std::getenv("BAZUKO_WEATHER")) simulation.ForceWeather(static_cast<Climate::Weather>(std::clamp(std::atoi(weather), 0, Climate::kWeatherCount - 1)));
        if (const char* hour = std::getenv("BAZUKO_HOUR")) simulation.SetDayProgress(static_cast<float>(std::atof(hour)) / 24.0f);
    }
    const double shotStart = glfwGetTime();
    std::this_thread::sleep_for(std::chrono::milliseconds(350));

    // Si es partida nueva o no tiene personaje configurado, abrir creador inmediatamente
    if (!hasSavedCharacter) {
        characterCreatorUI.Open(characterManager.GetLook(), false);
    }

    Clock clock;
    LogInfo("Motor iniciado con exito. Entrando al bucle principal.");

    while (!window.ShouldClose()) {
        // 1. Snapshot de estado previo
        Input::BeginFrame();

        // 2. Procesar eventos del sistema
        window.PollEvents();

        // 3. Post-poll para asegurar deltas de mouse
        Input::PostPoll();
        const PlayerInput playerInput = SamplePlayerInput();   // intenciones del jugador en este cuadro (core/PlayerInputSampler.hpp)

        float dt = clock.Tick();
        if (dt > 0.1f) dt = 0.1f;
        showDeathScreenIfNeeded();

        // 4. Teclas de acción
        if (Input::IsKeyPressed(GLFW_KEY_ESCAPE)) {
            if (characterCreatorUI.IsOpen()) {
                // El modal de creación maneja su propio escape o cierre
            } else {
                ui.HandleEscape();
            }
        }
        if (!ui.IsPaused() && (Input::IsKeyPressed(GLFW_KEY_P) || ui.ConsumeCharacterCreatorRequest())) {
            characterCreatorUI.Open(characterManager.GetLook(), true);
        }
        if (!characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_R)) {
            ui.HandleRadioShortcut();
        }
        if (!characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_I)) ui.OpenPauseSection(1);
        if (!characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_M)) ui.OpenMapSection();
        {   // solo pruebas: BAZUKO_OPEN_MAP=<s> abre el mapa grande a los s segundos
            static const char* openMapAt = std::getenv("BAZUKO_OPEN_MAP");
            static bool openMapDone = false;
            if (openMapAt && !openMapDone && clock.GetElapsedTime() > static_cast<float>(std::atof(openMapAt))) { openMapDone = true; ui.OpenMapSection(); }
        }
        {   // solo pruebas: BAZUKO_OPEN_UI=<panel>@<s> abre un panel (pausa0-3, radio, crafteo) a los s segundos
            static const char* openUi = std::getenv("BAZUKO_OPEN_UI");
            static bool openUiDone = false;
            if (openUi && !openUiDone) {
                const std::string spec(openUi);
                const size_t at = spec.find('@');
                if (clock.GetElapsedTime() > static_cast<float>(std::atof(spec.c_str() + (at == std::string::npos ? 0 : at + 1)))) {
                    openUiDone = true;
                    const std::string name = spec.substr(0, at);
                    if (name.rfind("pausa", 0) == 0) { ui.OpenPauseSection(0); ui.SelectPauseTab(std::atoi(name.c_str() + 5)); }
                    else if (name == "radio") ui.OpenRadioMenu(false);
                    else if (name == "crafteo") ui.ToggleCraftMenu();
                    else if (name == "dealer") ui.OpenDealerMenu();
                    else if (name == "cambuche") ui.OpenCambucheMenu();
                    else if (name == "muerte") ui.ShowDeathScreen("atropello", true, characterManager.GetLook().nombre, "la Calle 7");
                    else if (name == "tienda") ui.OpenShopMenu("Tienda La Esquinita", "Doña Rosa fía, pero solo a los conocidos.");
                    else if (name == "reciclaje") ui.OpenRecyclerMenu();
                }
            }
        }
        if (!characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_T)) ui.OpenPauseSection(2);
        if (!characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_O)) ui.OpenPauseSection(3);
        if (characterCreatorUI.IsOpen()) {
            dt = 0.0f;
            if (Input::IsCursorLocked()) {
                Input::SetCursorLocked(false);
            }
            // Actualizar y renderizar la vista previa 3D del personaje en el FBO
            characterPreview.Update(0.016f, characterCreatorUI.IsFocusingFace());
            characterPreview.Render(renderer, characterManager, clock.GetElapsedTime());
        }
        if (ui.IsPaused()) dt = 0.0f;
        vehicleImpactCooldown = std::max(0.0f, vehicleImpactCooldown - dt);
        if (Input::IsKeyPressed(GLFW_KEY_C)) ui.ToggleCraftMenu();
        // con la mesa de crafteo abierta el raton queda libre para usar el menu (se vuelve a fijar con un clic al cerrarla)
        if (ui.IsCraftMenuOpen() && Input::IsCursorLocked()) Input::SetCursorLocked(false);

        if (!characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_TAB)) ui.OpenPauseSection(1);

        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_V)) {
            camera.ToggleMode();
        }

        if (Input::IsKeyPressed(GLFW_KEY_F11)) {
            window.ToggleFullscreen();
        }

        // 5. Control de cursor y cámara
        ImGuiIO& io = ImGui::GetIO();

        // Si el usuario hace click en la pantalla cuando el cursor está libre, volver a bloquearlo
        if (!ui.IsPaused() && !ui.IsCraftMenuOpen() && !characterCreatorUI.IsOpen() && !Input::IsCursorLocked() && !io.WantCaptureMouse) {
            if (Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_LEFT) || Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_RIGHT)) {
                Input::SetCursorLocked(true);
            }
        }

        // Si el cursor está bloqueado (oculto) O si el usuario arrastra con click:
        bool shouldRotate = !ui.IsPaused() && !ui.IsCraftMenuOpen() && !characterCreatorUI.IsOpen() && (Input::IsCursorLocked() ||
                           ((Input::IsMouseButtonDown(GLFW_MOUSE_BUTTON_LEFT) || Input::IsMouseButtonDown(GLFW_MOUSE_BUTTON_RIGHT)) && !io.WantCaptureMouse));

        if (shouldRotate) {
            glm::vec2 delta = Input::GetMouseDelta();
            if (std::abs(delta.x) > 0.0001f || std::abs(delta.y) > 0.0001f) {
                camera.Orbit(delta.x, delta.y);
            }
        }

        // Control de vista con flechas del teclado
        float arrowX = ui.IsPaused() ? 0.0f : (Input::IsKeyDown(GLFW_KEY_RIGHT) ? 1.0f : 0.0f) - (Input::IsKeyDown(GLFW_KEY_LEFT) ? 1.0f : 0.0f);
        float arrowY = ui.IsPaused() ? 0.0f : (Input::IsKeyDown(GLFW_KEY_DOWN) ? 1.0f : 0.0f) - (Input::IsKeyDown(GLFW_KEY_UP) ? 1.0f : 0.0f);
        if (std::abs(arrowX) > 0.01f || std::abs(arrowY) > 0.01f) {
            camera.Orbit(arrowX * dt * 250.0f, arrowY * dt * 180.0f);
        }

        // Zoom de cámara con la rueda
        float scroll = Input::GetScrollDelta();
        if (!ui.IsPaused() && std::abs(scroll) > 0.01f && !io.WantCaptureMouse) {
            camera.Zoom(-scroll * 0.5f);
        }

        // 6. Movimiento del personaje (WASD)
        bool isRunning = !ui.IsPaused() && playerInput.run;
        const float withdrawal = needs[6] < 20.0f ? (20.0f - needs[6]) * 5.0f : 0.0f;
        const bool highWithdrawal = withdrawal >= 50.0f;
        const bool criticalWithdrawal = withdrawal >= 80.0f;
        static bool wasInWithdrawal = false;
        if (withdrawal > 0.0f && !wasInWithdrawal) ui.Notify("Abstinencia: tu cuerpo pide consumir; vas más lento y el ánimo baja.", ToastType::Warn);
        wasInWithdrawal = withdrawal > 0.0f;
        ui.SetBodyState(playerFreezing, withdrawal > 0.0f);
        const float psychosisSeverity = std::clamp((withdrawal - 50.0f) / 50.0f, 0.0f, 1.0f);
        const Movement::SpeedResult speedResult = Movement::ComputeSpeed(session, {isRunning, withdrawal, highWithdrawal, criticalWithdrawal});   // game/Movement.cpp
        isRunning = speedResult.running;
        float moveSpeed = speedResult.speed;

        glm::vec3 moveDir(0.0f);
        if (static const char* autoWalk = std::getenv("BAZUKO_AUTOWALK"); autoWalk && !ui.IsPaused()) {   // pruebas: BAZUKO_AUTOWALK=x,z camina en esa direccion
            float ax = 0.0f, az = 0.0f;
            if (std::sscanf(autoWalk, "%f,%f", &ax, &az) == 2) moveDir += glm::vec3(ax, 0.0f, az);
        }
        if (!ui.IsPaused()) moveDir += MoveDirection(playerInput, camera.GetMode() == CameraMode::ThirdPerson, camera.GetYaw());   // game/PlayerInput.hpp

        // paso de fisica (inercia, colisiones, atropello, capas del viaducto y caida): game/Movement.cpp; aqui solo se le presta el mundo
        Movement::World movementWorld;
        movementWorld.canStand = canStand;
        movementWorld.vehicleImpact = [&](const glm::vec3& next, float& impactSpeed, glm::vec3& impactDirection) { return simulation.GetVehicleImpact(next, impactSpeed, impactDirection); };
        movementWorld.knockDown = knockDownPlayer;
        movementWorld.ragdollStep = [&](float stepDt) { playerRagdoll.Update(stepDt); return playerRagdoll.GetPlayerPosition(); };
        movementWorld.placeSafely = placeSafely;
        movementWorld.ragdollReleased = [&]() { playerRagdoll.SetSurface(0.0f); };
        movementWorld.groundHeight = [&](float x, float z) { return city.GetGroundHeight(x, z); };
        movementWorld.lakeFloorMinY = CityLayout::kLakeSurface - 1.25f;
        const float currentSpeed = Movement::Step(session, movementWorld, dt, moveDir, moveSpeed);
        playerWaterDepth = playerOnDeck || playerKnockedDown ? 0.0f : CityLayout::WaterDepth(playerPos.x, playerPos.z);
        playerSwimming = playerWaterDepth > (playerSwimming ? 1.0f : 1.15f);
        lake.Update(dt, clock.GetElapsedTime(), playerPos, currentSpeed, playerWaterDepth, playerSwimming);
        {   // superficie bajo los pies: tierra y pasto, calzada o anden
            const TileType ground = city.GetTileAt(static_cast<int>(std::floor((playerPos.x + CityLayout::ORIGIN_X) / CityLayout::TILE_SIZE)),
                                                   static_cast<int>(std::floor((playerPos.z + CityLayout::ORIGIN_Z) / CityLayout::TILE_SIZE)));
            const int surface = playerOnDeck || ground == TileType::Road || ground == TileType::Busway ? 1
                : ground == TileType::Grass || ground == TileType::Dirt ? 2 : 0;
            audio.Update(currentSpeed > 0.25f, isRunning, surface, simulation.IsRaining(), currentSpeed * dt, dt);
        }

        const float dtClamped = std::max(0.0f, dt);
        begCooldownRemaining = std::max(0.0f, begCooldownRemaining - dtClamped);
        {   // supervivencia (frio, hambre, sed, lluvia, enfermedades, animo, salud y adrenalina): game/Survival.cpp; aqui solo se avisa a la interfaz
            glm::vec4 fire;
            SurvivalInput survival;
            survival.dt = dtClamped;
            survival.nearFire = simulation.GetCambucheFireLight(0.0f, playerPos, fire) && glm::distance(glm::vec2(playerPos.x, playerPos.z), glm::vec2(fire.x, fire.z)) < 3.6f;
            survival.night = simulation.IsNight();
            survival.raining = simulation.IsRaining();
            survival.rainIntensity = simulation.GetRainIntensity();
            survival.waterDepth = playerWaterDepth;
            survival.running = isRunning;
            survival.speed = currentSpeed;
            survival.hungerThirstDecayMult = talentEffect("decayMult");
            survival.diseaseResistTalent = talentEffect("diseaseResist");
            survival.diseaseResistCharacter = characterManager.GetDiseaseResistance();
            survival.mentalDecayMult = talentEffect("mentalDecayMult");
            survival.withdrawal = withdrawal;
            survival.highWithdrawal = highWithdrawal;
            survival.criticalWithdrawal = criticalWithdrawal;
            const SurvivalEvents survivalEvents = StepSurvival(session, survival, [&]() { return std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom); });
            ui.SetWarmth(warmTimer);
            if (survivalEvents.becameSoaked) ui.Notify("Estás empapado por la llovizna. Busca resguardo o te resfriarás.", ToastType::Warn);
            if (survivalEvents.caughtCold) ui.Notify("Te resfriaste por la lluvia: tienes gripe.", ToastType::Warn);
            if (survivalEvents.adrenalineEnded) ui.SetPickupNotification("La adrenalina se ha agotado.");
        }

        // Psicosis y alucinaciones por abstinencia
        if (psychosisSeverity > 0.0f && !ui.IsPaused()) {
            const float fovPulse = std::sin(clock.GetElapsedTime() * 4.5f) * 3.2f * psychosisSeverity;
            camera.SetPsychosisFovOffset(fovPulse);
            // Filtro del original: contraste +40 %, saturacion +45 % y tono oscilante de hasta 14 grados
            renderer.SetColorGrade(1.0f + 0.4f * psychosisSeverity, 1.0f + 0.45f * psychosisSeverity,
                                   std::sin(clock.GetElapsedTime() * 3.0f) * 14.0f * psychosisSeverity);
            camera.SetPsychosisRoll(psychosisSeverity > 0.6f
                ? (std::uniform_real_distribution<float>(-0.5f, 0.5f)(lootRandom)) * 0.014f * psychosisSeverity : 0.0f);
            // Latidos taquicardicos y delirios verbales
            static float heartbeatTimer = 0.0f;
            static float mutteringTimer = 18.0f;
            heartbeatTimer -= dtClamped;
            if (heartbeatTimer <= 0.0f) {
                audio.PlayHeartbeat(psychosisSeverity);
                heartbeatTimer = 0.95f - 0.42f * psychosisSeverity;
            }
            mutteringTimer -= dtClamped;
            if (mutteringTimer <= 0.0f) {
                static const std::array<const char*, 5> mutterings{{
                    "\"¡¡Dejen de vigilarme, sé quiénes son!!\"", "\"¡¡Están en las sombras... nos tienen acorralados!!\"",
                    "\"¡¡No me toquen, aléjense de mí!!\"", "\"¿Quién anda susurrando mi nombre?\"",
                    "\"¡¡Esos peatones son policías encubiertos!!\""}};
                ui.Notify(mutterings[static_cast<size_t>(std::uniform_int_distribution<int>(0, 4)(lootRandom))], ToastType::Warn);
                mutteringTimer = 16.0f + std::uniform_real_distribution<float>(0.0f, 12.0f)(lootRandom);
            }
        } else {
            camera.SetPsychosisFovOffset(0.0f);
            camera.SetPsychosisRoll(0.0f);
            renderer.SetColorGrade(1.0f, 1.0f, 0.0f);
        }
        simulation.UpdatePsychosis(dtClamped, playerPos, psychosisSeverity);

        showDeathScreenIfNeeded();
        if (ui.IsDeathScreenOpen()) dt = 0.0f;
        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && playerInput.sortPressed) {
            if (simulation.IsNearDealer(playerPos, 2.2f)) {
                ui.OpenDealerMenu();
            } else {
                const size_t pedestrian = simulation.GetNearbyPedestrian(playerPos, 1.8f);
                if (pedestrian < simulation.GetPedestrianCount()) {
                const RobberyOutcome outcome = simulation.RobPedestrian(pedestrian, true, playerPos);
                if (outcome.attempted && simulation.CallPolice(playerPos, outcome.caught ? 1.0f : 0.8f)) ui.SetPickupNotification("¡Llamaron a la policía! Una patrulla va hacia ti.");
                if (outcome.attempted) {
                    money += outcome.money;
                    if (outcome.successful) {
                        awardXp(8);
                        ui.SetPickupNotification("¡Robo directo! Obtienes dinero, pero el peatón puede defenderse.");
                    }
                    if (outcome.caught) {
                        const float damage = 6.0f + std::floor(std::uniform_real_distribution<float>(0.0f, 10.0f)(lootRandom));
                        needs[3] = std::max(0.0f, needs[3] - damage);
                        ui.SetPickupNotification("¡El peatón se defendió! Perdiste salud y salió corriendo.");
                    }
                }
                } else {
                    beginSorting(1.8f);
                }
            }
        }
        if (static const char* sortHold = std::getenv("BAZUKO_SORT_HOLD"); sortHold && !sorting && clock.GetElapsedTime() > 1.0f && !simulation.GetPickups().empty()) {   // pruebas: se coloca junto a la primera bolsa y la revisa sin soltar Q
            static bool placed = false;
            if (!placed) {
                placed = true;
                size_t pick = static_cast<size_t>(std::atoi(sortHold));
                pick = std::min(pick, simulation.GetPickups().size() - 1);
                playerPos = simulation.GetPickups()[pick].position + glm::vec3(0.0f, 0.0f, 1.1f);
                playerPos.y = city.GetGroundHeight(playerPos.x, playerPos.z);
                sortPosition = simulation.GetPickups()[pick].position;
                sorting = true;
            }
        }
        if (sorting) {
            const bool canSort = !ui.IsPaused() && !characterCreatorUI.IsOpen() && !ui.IsDeathScreenOpen();
            if (!canSort || glm::distance(playerPos, sortPosition) > 2.2f) {
                sorting = false;
                sortProgress = 0.0f;
            } else if (playerInput.sortHeld || std::getenv("BAZUKO_SORT_HOLD")) {
                sortProgress = std::min(kSortSeconds, sortProgress + std::max(0.0f, dt));
            } else {
                const bool complete = sortProgress >= kSortSeconds;
                sorting = false;
                sortProgress = 0.0f;
                harvestNearbyPickup(2.2f, complete);
            }
        }
        if (!ui.IsPaused() && playerInput.collectPressed) {
            const bool atRecycler = simulation.IsNearRecycler(playerPos, 3.0f);
            if (!atRecycler) {
                if (boostActive) {
                    boostActive = false;
                    boostTimer = 0.0f;
                    ui.SetPickupNotification("Adrenalina desactivada.");
                } else if (needs[2] < 15.0f) {
                    ui.SetPickupNotification("No tienes suficiente energía para activar adrenalina (mínimo 15).");
                } else if (needs[3] <= 5.0f) {
                    ui.SetPickupNotification("Tu salud es demasiado baja para el esfuerzo (mínimo 5).");
                } else {
                    boostActive = true;
                    boostTimer = 8.0f;
                    needs[2] = std::max(0.0f, needs[2] - 10.0f);
                    audio.Play(AudioCue::Pickup);
                    ui.SetPickupNotification("⚡ ¡Adrenalina activada! Mayor velocidad, más botín y ventas.");
                }
            } else if (!simulation.IsMissionStarted()) {
                ui.SetPickupNotification("Habla con el vecino de la recicladora para iniciar la misión.");
            } else if (simulation.IsMissionComplete()) {
                ui.SetPickupNotification("La misión de reciclaje ya está completa.");
            } else {
                int deliveredCount = 0;
                size_t remaining = simulation.GetMissionTarget() - simulation.GetMissionProgress();
                for (auto entry = inventory.begin(); entry != inventory.end() && remaining > 0;) {
                    const Item& item = lootTable[entry->itemIndex];
                    if (!isRecyclable(item)) {
                        ++entry;
                        continue;
                    }
                    const int delivered = std::min(entry->quantity, static_cast<int>(remaining));
                    entry->quantity -= delivered;
                    remaining -= static_cast<size_t>(delivered);
                    deliveredCount += delivered;
                    inventoryWeight = std::max(0.0f, inventoryWeight - item.weight * delivered);
                    for (int count = 0; count < delivered; ++count) simulation.CompleteMissionItem();
                    if (entry->quantity == 0) entry = inventory.erase(entry);
                    else ++entry;
                }
                missionProgress = simulation.GetMissionProgress();
                if (missionProgress >= simulation.GetMissionTarget()) {
                    money += 5000.0f;
                    awardXp(20);
                    simulation.CompleteMission();
                    ui.SetPickupNotification("¡Misión completa! Entregaste los reciclables y recibiste $5000 COP.");
                } else if (deliveredCount > 0) {
                    awardXp(2 * deliveredCount);
                    audio.Play(AudioCue::Sell);
                    ui.SetPickupNotification("Entregaste " + std::to_string(deliveredCount) + " reciclables ("
                        + std::to_string(missionProgress) + "/" + std::to_string(simulation.GetMissionTarget()) + ").");
                } else {
                    audio.Play(AudioCue::Empty);
                    ui.SetPickupNotification("No tienes materiales reciclables para entregar.");
                }
            }
        }
        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && playerInput.shopPressed) {
            const bool nearCambuche = simulation.IsNearCambuche(playerPos, 4.5f);
            if (nearCambuche && !simulation.IsNearShop(playerPos, 2.0f)) {
                ui.OpenCambucheMenu();
            } else if (!simulation.IsNearShop(playerPos, 2.0f)) {
                // Pedir limosna
                if (begCooldownRemaining > 0.0f) {
                    ui.SetPickupNotification("Espera " + std::to_string(static_cast<int>(std::ceil(begCooldownRemaining)))
                                             + " s antes de volver a pedir limosna.");
                } else if (needs[2] < 3.0f) {
                    ui.SetPickupNotification("Estás demasiado cansado para pedir limosna (necesitas 3 de energía).");
                } else {
                    begCooldownRemaining = 4.0f;
                    needs[2] = std::max(0.0f, needs[2] - 3.0f);
                    const auto chance = [&](float probability) {
                        return std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) < probability;
                    };
                    if (needs[4] < 20.0f && chance(0.70f)) {
                        needs[5] = std::max(0.0f, needs[5] - 2.0f);
                        ui.SetPickupNotification("La gente te rechaza por tu higiene. Usa jabón o un cepillo.");
                    } else if (chance(0.20f)) {
                        needs[5] = std::max(0.0f, needs[5] - 1.0f);
                        ui.SetPickupNotification("Los transeúntes te ignoran.");
                    } else if (chance(0.18f)) {
                        const std::string gift = std::uniform_int_distribution<int>(0, 1)(lootRandom) == 0 ? "pan" : "agua";
                        const bool received = addLootById(gift);
                        needs[5] = std::min(100.0f, needs[5] + 4.0f);
                        awardXp(4);
                        ui.SetPickupNotification(received
                            ? "Una persona te regaló " + (gift == "pan" ? std::string("pan") : std::string("agua")) + "."
                            : "Te ofrecieron comida o agua, pero el costal está lleno.");
                    } else {
                        const bool rare = chance(0.08f);
                        const int amount = rare
                            ? (std::uniform_int_distribution<int>(0, 1)(lootRandom) == 0 ? 5000 : 10000)
                            : static_cast<int>(std::round((2.0f + std::uniform_real_distribution<float>(0.0f, 13.0f)(lootRandom))
                                                          * characterManager.GetBegMultiplier())) * 100;
                        const int earned = amount;
                        money += static_cast<float>(earned);
                        needs[5] = std::min(100.0f, needs[5] + (rare ? 6.0f : 2.0f));
                        awardXp(rare ? 8 : 4);
                        ui.SetPickupNotification(rare
                            ? "Una persona generosa te dio $" + std::to_string(earned) + " COP."
                            : "Recibiste $" + std::to_string(earned) + " COP de limosna.");
                    }
                }
            }
        }
        if (!ui.IsPaused() && playerInput.interactPressed) {
            size_t carIndex = simulation.GetNearbyCar(playerPos, 2.0f);
            size_t parkedCarIndex = simulation.GetNearbyParkedCar(playerPos, 2.0f);
            const size_t vendorIndex = simulation.GetNearbyVendor(playerPos, 2.0f);
            size_t pedestrianIndex = simulation.GetNearbyPedestrian(playerPos, 1.8f);
            bool nearShop = simulation.IsNearShop(playerPos, 2.2f);
            if (simulation.IsNearMissionNpc(playerPos, 2.0f) && !simulation.IsMissionStarted() && !simulation.IsMissionComplete()) {
                simulation.StartMission();
            } else if (simulation.IsNearDog(playerPos, 2.0f)) {
                if (simulation.IsDogFriend()) {
                    if (simulation.CanPetDog() && playerAction == PlayerAction::None && !playerCrouching && !playerKnockedDown && !petWaiting) {
                        const glm::vec3 dogAt = simulation.GetDogPosition();
                        playerYaw = std::atan2(dogAt.x - playerPos.x, dogAt.z - playerPos.z);
                        simulation.BeginPet(playerPos, playerYaw);   // el Chato va a sentarse delante del jugador
                        petWaiting = true;
                        petWaitTime = 0.0f;
                    }
                    else if (!simulation.CanPetDog()) ui.SetPickupNotification("El Chato ya recibió sus caricias por ahora.");
                } else {
                    simulation.BefriendDog();
                    needs[5] = std::min(100.0f, needs[5] + 15.0f);
                    ui.SetPickupNotification("El Chato confía en ti. Ahora te acompañará.");
                }
            } else if (simulation.IsNearDealer(playerPos, 2.2f)) {
                if (simulation.IsNight() && std::any_of(inventory.begin(), inventory.end(), [&](const InventoryEntry& entry) {
                        return lootTable[entry.itemIndex].substance;
                    })) {
                    int soldQuantity = 0;
                    float earned = 0.0f;
                    for (auto entry = inventory.begin(); entry != inventory.end();) {
                        const Item& item = lootTable[entry->itemIndex];
                        if (!item.substance) {
                            ++entry;
                            continue;
                        }
                        soldQuantity += entry->quantity;
                        earned += std::round(static_cast<float>(item.value * entry->quantity) * 1.8f * 1.3f * talentEffect("substancePriceMult"));
                        inventoryWeight = std::max(0.0f, inventoryWeight - item.weight * entry->quantity);
                        entry = inventory.erase(entry);
                    }
                    money += earned;
                    audio.Play(AudioCue::Sell);
                    ui.SetPickupNotification("Vendiste " + std::to_string(soldQuantity)
                        + " sustancias al dealer por $" + std::to_string(static_cast<int>(earned)) + " COP.");
                } else {
                    ui.OpenDealerMenu();
                }
            } else if (simulation.IsNearRecycler(playerPos, 2.5f)) {
                ui.OpenRecyclerMenu();
            } else if (vendorIndex < simulation.GetStreetVendorCount()) {
                const StreetVendor& vendor = simulation.GetVendor(vendorIndex);
                ui.OpenShopMenu(vendor.name, "Venta ambulante: lo justo para el día.", vendor.items);
            } else if (pedestrianIndex < simulation.GetPedestrianCount()) {
                const RobberyOutcome outcome = simulation.RobPedestrian(pedestrianIndex, false, playerPos);
                if (outcome.attempted && simulation.CallPolice(playerPos, outcome.caught ? 1.0f : outcome.successful ? 0.35f : 0.2f)) ui.SetPickupNotification("¡Llamaron a la policía! Una patrulla va hacia ti.");
                if (outcome.attempted && outcome.successful) {
                    money += outcome.money;
                    awardXp(8);
                    if (std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) < 0.4f) {
                        const std::array<std::string, 3> loot{{"pan", "lata", "reloj"}};
                        addLootById(loot[static_cast<size_t>(std::uniform_int_distribution<int>(0, 2)(lootRandom))]);
                    }
                    ui.SetPickupNotification("Cosquilleo exitoso: robaste a un peatón sin que se diera cuenta.");
                } else if (outcome.caught) {
                    ui.SetPickupNotification("¡Te descubrieron intentando robar! El peatón salió corriendo.");
                } else if (outcome.attempted) {
                    ui.SetPickupNotification("Falló el cosquilleo, pero lograste disimular.");
                }
            } else if (parkedCarIndex < simulation.GetParkedCarCount()) {
                const int mirrorCapacity = std::min(2, availableLootCount("retrovisor"));
                if (mirrorCapacity == 0) {
                    ui.SetPickupNotification("El costal está lleno; deja espacio para guardar los retrovisores.");
                } else if (simulation.StealParkedCar(parkedCarIndex)) {
                    grabTime = 0.0f;
                    audio.PlayTheftRemark(2.0f);
                    const bool caught = std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom)
                        < 0.25f * talentEffect("stealCaughtMult");
                    if (simulation.CallPolice(playerPos, caught ? 1.0f : 0.6f)) ui.SetPickupNotification("¡Llamaron a la policía! Una patrulla va hacia ti.");
                    if (caught) {
                        needs[3] = std::max(0.0f, needs[3] - 25.0f);
                        money = std::max(0.0f, money - 5000.0f);
                        audio.PlayCarAlarm(2.0f);
                        ui.SetPickupNotification("¡Alarma! Te atraparon robando los retrovisores.");
                    } else {
                        awardXp(8);
                        const int mirrors = std::uniform_int_distribution<int>(1, mirrorCapacity)(lootRandom);
                        for (int index = 0; index < mirrors; ++index) addLootById("retrovisor");
                        audio.Play(AudioCue::Treasure);
                        ui.SetPickupNotification("Robaste los retrovisores del auto estacionado.");
                    }
                }
            } else if (availableLootCount("retrovisor") == 0) {
                ui.SetPickupNotification("El costal está lleno; deja espacio para guardar los retrovisores.");
            } else if (simulation.StealCar(carIndex)) {
                grabTime = 0.0f;
                audio.PlayTheftRemark(2.0f);
                const float caughtChance = 0.25f * talentEffect("stealCaughtMult");
                const bool caught = std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) < caughtChance;
                if (simulation.CallPolice(playerPos, caught ? 1.0f : 0.6f)) ui.SetPickupNotification("¡Llamaron a la policía! Una patrulla va hacia ti.");
                if (caught) {
                    needs[3] = std::max(0.0f, needs[3] - 25.0f);
                    money = std::max(0.0f, money - 5000.0f);
                    audio.PlayCarAlarm(2.0f);
                    audio.Play(AudioCue::Empty);
                } else {
                    awardXp(8);
                    const int mirrorCapacity = std::min(2, availableLootCount("retrovisor"));
                    const int mirrors = std::uniform_int_distribution<int>(1, mirrorCapacity)(lootRandom);
                    for (int index = 0; index < mirrors; ++index) addLootById("retrovisor");
                    if (std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) < 0.2f)
                        addLootById("radio");
                    audio.Play(AudioCue::Treasure);
                }
            } else if (nearShop) {
                ui.OpenShopMenu("Tienda La Esquinita", "Doña Rosa fía, pero solo a los conocidos.");
            } else if (harvestNearbyPickup(1.8f, false)) {
            } else {
                auto usable = std::find_if(inventory.begin(), inventory.end(), [&](const InventoryEntry& entry) {
                    const Item& item = lootTable[entry.itemIndex];
                    return item.consumableNeed >= 0 || !item.cure.empty()
                        || item.id == "vendaje" || item.id == "curita";
                });
                if (usable != inventory.end()) {
                    const Item& item = lootTable[usable->itemIndex];
                    if (applyItemEffect(item)) {
                        inventoryWeight = std::max(0.0f, inventoryWeight - item.weight);
                        if (--usable->quantity == 0) inventory.erase(usable);
                        audio.Play(AudioCue::Pickup);
                    }
                }
            }
        }
        const std::string craftRequest = ui.ConsumeCraftRequest();
        if (!craftRequest.empty()) {
            const Economy::CraftResult crafted = Economy::Craft(session, gameData, recipes, craftRequest);
            if (crafted.outcome == Economy::CraftOutcome::MissingMaterials || crafted.outcome == Economy::CraftOutcome::NoRoom) audio.Play(AudioCue::Full);
            if (crafted.outcome == Economy::CraftOutcome::Crafted) {
                awardXp(10);
                audio.Play(AudioCue::Treasure);
                ui.Notify("Crafteado: " + crafted.resultName + " ×" + std::to_string(crafted.quantity), ToastType::Info);
            }
        }

        // Construir piezas del cambuche
        {
            const std::string buildRequest = ui.ConsumeCambucheBuildRequest();
            if (!buildRequest.empty()) {
                const auto countItem = [&](const std::string& id) {
                    int qty = 0;
                    for (const auto& entry : inventory) if (lootTable[entry.itemIndex].id == id) qty += entry.quantity;
                    return qty;
                };
                const auto consumeItem = [&](const std::string& id, int qty = 1) {
                    for (int rem = 0; rem < qty; ++rem) {
                        auto it = std::find_if(inventory.begin(), inventory.end(),
                            [&](const InventoryEntry& e) { return lootTable[e.itemIndex].id == id; });
                        if (it == inventory.end()) break;
                        inventoryWeight = std::max(0.0f, inventoryWeight - lootTable[it->itemIndex].weight);
                        if (--it->quantity == 0) inventory.erase(it);
                    }
                };
                bool canBuild = false;
                const CambuchePieceDef* piece = gameData.FindCambuchePiece(buildRequest);
                if (piece && !cambucheBuilt(piece->id) && (piece->needs.empty() || cambucheBuilt(piece->needs))
                    && std::all_of(piece->req.begin(), piece->req.end(),
                                   [&](const auto& need) { return countItem(need.first) >= need.second; })) {
                    for (const auto& need : piece->req) consumeItem(need.first, need.second);
                    canBuild = true;
                }
                if (canBuild && simulation.BuildCambuchePiece(buildRequest)) {
                    awardXp(15);
                    audio.Play(AudioCue::Treasure);
                    ui.SetPickupNotification("Construiste: " + piece->name + ". ¡El cambuche crece!");
                    saveGame("Cambuche actualizado");
                }
            }
        }

        // Dormir en el cambuche
        if (ui.ConsumeSleepRequest() && simulation.GetCambucheState().base) {
            needs[2] = std::min(100.0f, needs[2] + 60.0f); // Recupera energía
            needs[3] = std::min(100.0f, needs[3] + 20.0f); // Recupera algo de salud
            needs[5] = std::min(100.0f, needs[5] + 15.0f); // Mejora el ánimo
            simulation.SleepUntilMorning();                 // Avanza al día siguiente
            ui.SetPickupNotification("Dormiste en el cambuche. Energía y salud recuperadas. ¡Buenos días!");
            saveGame("Partida guardada al despertar");
        }

        if (simulation.IsMissionComplete()) objective = "Mision completada: recibiste $5000 y 20 XP";
        else if (simulation.IsMissionStarted()) objective = "Mision: entrega 5 reciclables en El Progreso [F] (" + std::to_string(simulation.GetMissionProgress()) + "/5)";
        else if (itemsCollected < 5) objective = "Rebusca y recoge 5 objetos [Q]";
        else if (itemsSold < 3) objective = "Recicla 3 objetos del costal [F]";
        else if (level < 2) objective = "Sigue rebuscando para alcanzar nivel 2";
        else if (level >= 2) objective = "Sobrevive en Bogotá y mejora tu vida";

        // Informar direcci\u00f3n de vista para el spawn fuera de c\u00e1mara de bolsas de basura
        {
            const float facingYaw = camera.GetMode() == CameraMode::ThirdPerson ? camera.GetYaw() : playerYaw;
            simulation.SetPlayerFacing({std::sin(facingYaw), std::cos(facingYaw)});
        }
        std::vector<Net::PlayerView> remoteViewers;   // anfitrion: los otros jugadores existen para peatones, policia y trafico
#ifdef BAZUKO_NET_ENABLED
        if (netSession) {   // multijugador: cuenta mi estado, recibe el de los demas y los dibuja (net/NetSession.hpp)
            netSession->Update(dt, Net::LocalState{playerPos, playerYaw, playerVelocity, playerKnockedDown});
            // mundo compartido: el invitado deja de simular trafico y peatones y aplica lo que manda el anfitrion (misma semilla = mismos carros)
            simulation.SetGuestMode(netSession->GetRole() == Net::NetSession::Role::Client && netSession->Connected());
            if (simulation.IsGuest()) {
                static bool warnedMismatch = false;
                if (auto world = netSession->ConsumeWorld()) {
                    if (!simulation.ApplyWorld(*world) && !warnedMismatch) { warnedMismatch = true; LogWarn("Multijugador: el mundo del anfitrion no coincide con el local (otra semilla o modelos distintos)"); }
                }
            }
            for (const std::string& notice : netSession->ConsumeNotices()) ui.Notify(notice, ToastType::Info);
            std::vector<Simulation::RemotePlayerView> remoteViews;
            for (const Net::RemotePlayer& remote : netSession->Remotes()) remoteViews.push_back({remote.id, remote.position, remote.yaw, remote.speed, remote.knockedDown});
            if (netSession->GetRole() == Net::NetSession::Role::Host)
                for (const Simulation::RemotePlayerView& remote : remoteViews) {
                    Net::PlayerView view;
                    view.id = remote.id; view.position = {remote.position.x, remote.position.y, remote.position.z}; view.yaw = remote.yaw; view.alive = !remote.knockedDown;
                    remoteViewers.push_back(view);
                }
            simulation.SetRemotePlayers(std::move(remoteViews));
        }
#endif
        simulation.Update(dt, playerPos, remoteViewers);
#ifdef BAZUKO_NET_ENABLED
        if (netSession && netSession->GetRole() == Net::NetSession::Role::Host) {
            // lo que el mundo les hace a los demas jugadores (golpes de peatones) se les entrega, y lo que ellos hacen al mundo se aplica aqui
            for (const Net::PlayerView& viewer : remoteViewers) {
                int kind = 0; glm::vec3 from{};
                while (simulation.ConsumePlayerHitFor(viewer.id, kind, from)) netSession->SendHit(viewer.id, kind, from);
            }
            for (const Net::NetSession::RemoteStrike& strike : netSession->ConsumeRemoteStrikes()) {
                const glm::vec2 forward(std::sin(strike.command.yaw), std::cos(strike.command.yaw));
                if (!simulation.HitPedestrian(strike.position, forward, strike.command.reach, strike.command.kind, strike.command.damage, strike.command.knockback))
                    simulation.HitVehicle(strike.position, forward, 1.4f);
            }
        }
#endif
        poopCooldown = std::max(0.0f, poopCooldown - dt);
        poopAnimationRemaining = std::max(0.0f, poopAnimationRemaining - dt);
        if (poopMode != 0) {
            poopElapsed += dt;
            if (!poopStepDone && poopMode == 1 && poopElapsed >= 0.9f) {
                poopStepDone = true;
                simulation.DropPoop(playerPos);
                needs[0] = std::max(0.0f, needs[0] - 2.0f);
                needs[4] = std::max(0.0f, needs[4] - 3.0f);
                ui.SetPickupNotification(addLootById("popo") ? "Hiciste popó. El mojón queda listo para lanzarlo con X." : "Hiciste popó, pero el costal está lleno.");
            } else if (!poopStepDone && poopMode == 2 && poopElapsed >= 1.25f) {
                poopStepDone = true;
                auto poop = std::find_if(inventory.begin(), inventory.end(), [&](const InventoryEntry& entry) { return lootTable[entry.itemIndex].id == "popo"; });
                if (poop != inventory.end() && simulation.ThrowPoop(playerPos, poopThrowDirection)) {
                    inventoryWeight = std::max(0.0f, inventoryWeight - lootTable[poop->itemIndex].weight);
                    if (--poop->quantity <= 0) inventory.erase(poop);
                    ui.SetPickupNotification("Lanzaste un mojón. Si impacta a un peatón, obtienes experiencia.");
                }
            }
            if (poopAnimationRemaining <= 0.0f || playerKnockedDown) poopMode = 0;
        }
        {   // acciones del personaje
            const bool canAct = !ui.IsPaused() && !characterCreatorUI.IsOpen() && !playerKnockedDown && poopAnimationRemaining <= 0.0f;
            const auto faceForward = [&]() {
                if (camera.GetMode() != CameraMode::ThirdPerson) return;
                const float yaw = camera.GetYaw();
                playerYaw = std::atan2(-std::sin(yaw), -std::cos(yaw));   // hacia donde mira la camara
            };
            const auto startAction = [&](PlayerAction action, const char* clipName, float seconds) {
                const int clip = characterManager.FindClip(clipName);
                Fight::StartAction(session, action, clip, characterManager.ClipDuration(clip), seconds);   // game/Fight.cpp
                faceForward();
            };
            {   // caricia: espera a que el Chato este sentado delante y entonces se agacha y le acaricia la cabeza (PetDog)
                static const char* autoPet = std::getenv("BAZUKO_AUTO_PET");   // solo pruebas: pide la caricia a los s segundos
                static bool autoPetDone = false;
                if (autoPet && !autoPetDone && clock.GetElapsedTime() > static_cast<float>(std::atof(autoPet)) && simulation.CanPetDog() && !petWaiting) {
                    autoPetDone = true;
                    const glm::vec3 dogAt = simulation.GetDogPosition();
                    playerYaw = std::atan2(dogAt.x - playerPos.x, dogAt.z - playerPos.z);
                    simulation.BeginPet(playerPos, playerYaw);
                    petWaiting = true;
                    petWaitTime = 0.0f;
                }
                if (petWaiting) {
                    petWaitTime += dt;
                    if (!simulation.IsDogPetting() || playerKnockedDown || playerHitKind != 0) {
                        petWaiting = false;
                    } else if (simulation.IsDogReadyForPet() || petWaitTime > 8.0f) {
                        petWaiting = false;
                        const glm::vec3 dogAt = simulation.GetDogPosition();
                        startAction(PlayerAction::Pet, "PetDog", 0.0f);
                        actionHitDone = true;   // no es un golpe
                        playerYaw = std::atan2(dogAt.x - playerPos.x, dogAt.z - playerPos.z);
                        petRewardPending = true;
                    }
                }
            }
            // golpes recibidos de peatones agresivos
            int hitKind = 0;
            glm::vec3 hitFrom{};
            std::vector<std::pair<int, glm::vec3>> netHits;   // golpes de otros jugadores (o de peatones del anfitrion) que llegan por la red
#ifdef BAZUKO_NET_ENABLED
            if (netSession) for (const Net::NetSession::IncomingHit& incoming : netSession->ConsumeHits()) netHits.push_back({incoming.kind, incoming.from});
#endif
            while (!netHits.empty() || simulation.ConsumePlayerHit(hitKind, hitFrom)) {
                if (!netHits.empty()) { hitKind = netHits.back().first; hitFrom = netHits.back().second; netHits.pop_back(); }
                switch (Fight::ReceiveHit(session, hitKind, hitFrom)) {   // game/Fight.cpp
                    case Fight::HitResult::Ignored: break;
                    case Fight::HitResult::Dodged: ui.SetPickupNotification("¡Esquivaste el golpe!"); break;   // el esquive lateral o rotatorio evita el golpe
                    case Fight::HitResult::Hurt:
                        ui.SetPickupNotification(hitKind == 1 ? "Te golpearon en la cara: -8 de salud." : hitKind == 2 ? "Te golpearon en el pecho: -6 de salud." : "Te patearon las piernas: -5 de salud.");
                        break;
                }
            }
            Fight::StaggerStep(session, dt, canStand);
            const bool free = playerAction == PlayerAction::None && playerHitKind == 0;
            const bool recovered = playerAction != PlayerAction::None && playerAction != PlayerAction::Jump && actionTime > actionDuration * 0.62f;
            playerCrouching = canAct && free && playerInput.crouch;
            if (canAct && !playerCrouching && (free || recovered)) {
                if (playerInput.punchPressed) {
                    if (comboIdle > 1.4f) punchChain = 0;
                    comboIdle = 0.0f;
                    const PlayerAction punch = punchChain % 3 == 0 ? PlayerAction::Jab : punchChain % 3 == 1 ? PlayerAction::Cross : PlayerAction::Hook;
                    ++punchChain;
                    startAction(punch, "PunchJab", Combat::Info(static_cast<Combat::Move>(combatMoveOf(punch))).duration);
                    fightStanceRemaining = 3.0f;
                } else if (playerInput.kickPressed) {
                    const PlayerAction kick = nextKickIsHigh ? PlayerAction::HighKick : PlayerAction::Kick;
                    nextKickIsHigh = !nextKickIsHigh;
                    startAction(kick, "Kick", Combat::Info(static_cast<Combat::Move>(combatMoveOf(kick))).duration);
                    fightStanceRemaining = 3.0f;
                } else if (playerInput.dodgePressed) {
                    const PlayerAction dodge = nextDodgeIsDuck ? PlayerAction::Duck : PlayerAction::Slip;
                    nextDodgeIsDuck = !nextDodgeIsDuck;
                    startAction(dodge, "FightIdle", Combat::Info(static_cast<Combat::Move>(combatMoveOf(dodge))).duration);
                    fightStanceRemaining = 3.0f;
                } else if (playerInput.knifePressed) {
                    startAction(nextKnifeIsStab ? PlayerAction::Stab : PlayerAction::Slash, nextKnifeIsStab ? "KnifeStab" : "KnifeSlash", 0.0f);
                    nextKnifeIsStab = !nextKnifeIsStab;
                    knifeStanceRemaining = 4.0f;
                }
            }
            // clic izquierdo corto (sin arrastrar la camara): jab, cruzado y patada
            comboIdle += dt;
            if (!ui.IsPaused() && !ui.IsCraftMenuOpen() && !io.WantCaptureMouse && playerInput.clickPressed) {
                clickTracking = true;
                clickTime = 0.0f;
                clickMove = 0.0f;
                clickWasLocked = Input::IsCursorLocked();
            }
            if (clickTracking) {
                clickTime += dt;
                clickMove += glm::length(Input::GetMouseDelta());
                if (playerInput.clickReleased) {
                    clickTracking = false;
                    if (clickWasLocked && clickTime < 0.3f && clickMove < 12.0f && canAct && !playerCrouching && (free || recovered)) {
                        if (comboIdle > 1.4f) comboStep = 0;
                        comboIdle = 0.0f;
                        const int step = comboStep++ % 4;
                        const PlayerAction blow = step == 0 ? PlayerAction::Jab : step == 1 ? PlayerAction::Cross : step == 2 ? PlayerAction::Hook
                            : (comboStep % 8 == 0 ? PlayerAction::HighKick : PlayerAction::Kick);
                        startAction(blow, "PunchJab", Combat::Info(static_cast<Combat::Move>(combatMoveOf(blow))).duration);
                        fightStanceRemaining = 3.0f;
                    }
                } else if (!playerInput.clickDown) {
                    clickTracking = false;
                }
            }
            if (canAct && free && playerInput.jumpPressed) {
                // desde quieto: salto vertical estatico; caminando o corriendo: salto con carrera, cuyo alcance sale de la velocidad
                const float planarSpeed = glm::length(glm::vec2(playerVelocity.x, playerVelocity.z));
                jumpMoving = planarSpeed > 1.2f;
                if (jumpMoving) {
                    jumpDirection = glm::normalize(glm::vec3(playerVelocity.x, 0.0f, playerVelocity.z));
                    jumpSpeed = std::clamp(planarSpeed * 1.3f, 3.2f, 8.0f);   // a pie ~3 m de salto, corriendo ~6 m
                }
                startAction(PlayerAction::Jump, "Jump", Jump::TimingFor(jumpMoving).duration);
            }
            {   // la accion en curso: impacto, salto, caricia y fin (game/Fight.cpp); aqui solo se aplica el golpe al mundo
                const Fight::TickResult tick = Fight::TickAction(session, dt, [&](PlayerAction action) {
                    const int combatMove = combatMoveOf(action);
                    return combatMove >= 0 ? Combat::Info(static_cast<Combat::Move>(combatMove)).impact : action == PlayerAction::Stab ? 0.28f : 0.30f;
                });
                if (tick.strike) {
                    const bool kicking = tick.strikeAction == PlayerAction::Kick || tick.strikeAction == PlayerAction::HighKick;
                    const WeaponStats* weapon = !kicking && tick.strikeAction != PlayerAction::Slash && tick.strikeAction != PlayerAction::Stab ? FindWeapon(equippedWeapon) : nullptr;
                    const float weaponDamage = weapon ? weapon->damage * (tick.strikeAction == PlayerAction::Hook ? 1.5f : 1.0f) : -1.0f;   // el ultimo golpe del combo pega mas
                    if (!simulation.HitPedestrian(playerPos, {std::sin(playerYaw), std::cos(playerYaw)}, weapon ? weapon->range : kicking ? 1.6f : 1.3f, tick.strikeKind, weaponDamage, weapon ? weapon->knockback : 1.0f))
                        simulation.HitVehicle(playerPos, {std::sin(playerYaw), std::cos(playerYaw)}, 1.4f);
#ifdef BAZUKO_NET_ENABLED
                    if (netSession) {   // multijugador: el golpe tambien se resuelve contra los demas jugadores (el anfitrion decide)
                        Net::StrikeCommand strike;
                        strike.yaw = playerYaw; strike.kind = static_cast<uint8_t>(std::clamp(tick.strikeKind, 1, 3)); strike.damage = weaponDamage;
                        strike.reach = weapon ? weapon->range : kicking ? 1.6f : 1.3f; strike.knockback = weapon ? weapon->knockback : 1.0f;
                        netSession->Strike(strike);
                    }
#endif
                }
                if (tick.petRewardDue && simulation.PetDog()) {   // la mano ya esta sobre la cabeza
                    needs[5] = std::min(100.0f, needs[5] + 5.0f);
                    ui.SetPickupNotification("El Chato se pone feliz. +5 de ánimo.");
                }
                if (tick.petEnded) simulation.EndPet();
            }
            if (pickupTime >= 0.0f) { pickupTime += dt; if (pickupTime >= 0.85f) pickupTime = -1.0f; }
            if (sorting) {   // de cara a la bolsa mientras se revisa
                const glm::vec3 toBag = sortPosition - playerPos;
                if (glm::length(glm::vec2(toBag.x, toBag.z)) > 0.05f) playerYaw = std::atan2(toBag.x, toBag.z);
            }
            if (grabTime >= 0.0f && !std::getenv("BAZUKO_PREVIEW_GRAB")) { grabTime += dt; if (grabTime >= Combat::kGrabDuration) grabTime = -1.0f; }
            fightStanceRemaining = std::max(0.0f, fightStanceRemaining - dt);
            knifeStanceRemaining = std::max(0.0f, knifeStanceRemaining - dt);
        }
        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && !playerKnockedDown
            && (playerInput.poopPressed || playerInput.throwPressed)) {
            if (!equippedWeapon.empty() && inventoryCount(equippedWeapon) == 0) equippedWeapon.clear();   // se vendio, se tiro o se la robaron
            const bool throwPressed = playerInput.throwPressed && inventoryCount("popo") > 0;
            if (poopMode != 0) {
                // ya esta en plena accion
            } else if (throwPressed) {
                // se agacha, recoge el mojon del suelo con la mano y lo lanza (se suelta hacia el segundo 1,25 de la animacion)
                const float yaw = camera.GetMode() == CameraMode::ThirdPerson ? camera.GetYaw() : playerYaw;
                const float facingSign = camera.GetMode() == CameraMode::ThirdPerson ? -1.0f : 1.0f;
                poopThrowDirection = glm::vec3(facingSign * std::sin(yaw), 0.0f, facingSign * std::cos(yaw));
                playerYaw = std::atan2(poopThrowDirection.x, poopThrowDirection.z);
                poopMode = 2; poopElapsed = 0.0f; poopStepDone = false; poopAnimationRemaining = 1.84f;
            } else if (poopCooldown <= 0.0f) {
                poopMode = 1; poopElapsed = 0.0f; poopStepDone = false; poopAnimationRemaining = 2.0f;
                poopCooldown = 2.6f;
            } else {
                ui.SetPickupNotification("Espera un momento antes de volver a hacer popó.");
            }
        }
        const size_t poopHits = simulation.ConsumePoopHitCount();
        if (poopHits > 0) {
            awardXp(static_cast<int>(poopHits) * 5);
            needs[5] = std::min(100.0f, needs[5] + static_cast<float>(poopHits) * 4.0f);
            ui.SetPickupNotification("¡Impacto! Le diste a un peatón con el mojón. +5 XP.");
        }
        if (!playerKnockedDown && vehicleImpactCooldown <= 0.0f && needs[3] > 0.0f) {
            float impactSpeed = 0.0f;
            glm::vec3 impactDirection(0.0f);
            if (simulation.GetVehicleImpact(playerPos, impactSpeed, impactDirection)) {
                knockDownPlayer(impactSpeed, impactDirection);
            }
        }
        showDeathScreenIfNeeded();
        if (ui.IsDeathScreenOpen()) dt = 0.0f;
        audio.SetRaining(simulation.IsRaining(), simulation.GetRainIntensity());
        simulation.SetReducedWeather(graphicsQuality == 0);
        simulation.SetTreeRange(graphicsQuality == 0 ? 38.0f : graphicsQuality == 1 ? 52.0f : 70.0f);   // mas lejos se pierden en la niebla; menos arboles es menos costo en la GPU integrada
        if (const char* weatherToast = simulation.ConsumeWeatherChange()) ui.Notify(weatherToast, ToastType::Info);
        {   // GPS: destinos pedidos en el mapa, avance de la ruta, llegada y datos para el radar
            const GpsNavigation::Point here{playerPos.x, playerPos.z};
            const float gpsNow = clock.GetElapsedTime();
            if (pendingGps) {
                if (!gps.SetWaypoint({std::get<0>(*pendingGps), std::get<1>(*pendingGps)}, std::get<2>(*pendingGps), here, gpsNow)) gps.Clear();
                pendingGps.reset();
            }
            if (ui.ConsumeGpsClearRequest() && gps.Waypoint()) {
                gps.Clear();
                ui.Notify("GPS: destino quitado", ToastType::Info);
            }
            glm::vec2 requested;
            std::string requestedName;
            if (ui.ConsumeGpsSetRequest(requested, requestedName)) {
                if (gps.SetWaypoint({requested.x, requested.y}, requestedName, here, gpsNow)) {
                    char text[128];
                    std::snprintf(text, sizeof(text), "GPS: ruta a %s (%.0f m)", requestedName.c_str(), gps.RouteLength());
                    ui.Notify(text, ToastType::Info);
                } else {
                    gps.Clear();
                    ui.Notify("GPS: no hay camino a pie hasta ese punto.", ToastType::Warn);
                }
            }
            if (gps.Update(here, gpsNow) == GpsNavigation::Event::Arrived) ui.Notify("Llegaste a " + gps.LastArrivalName(), ToastType::Info);
            UIManager::GpsView view;
            if (gps.Waypoint()) {
                view.active = true;
                view.waypoint = {gps.Waypoint()->x, gps.Waypoint()->z};
                view.name = gps.Name();
                view.distance = gps.RemainingDistance(here);
                for (const GpsNavigation::Point& point : gps.RemainingRoute(here)) view.route.emplace_back(point.x, point.z);
            }
            ui.SetGpsView(std::move(view));
        }
        {
            const bool night = simulation.IsNight();
            const Climate::WeatherInfo& info = Climate::Info(simulation.GetWeather());
            ui.SetWorldInfo(simulation.GetDay(), (night && info.nightLabel) ? info.nightLabel : info.label, simulation.GetSeason().label);
        }
        audio.UpdateVehicleAudio(dt, playerPos, simulation, ui.IsPaused());
        audio.UpdatePolice(playerPos, simulation.GetSirenPositions(), simulation.ConsumePoliceSounds(), ui.IsPaused());

        // 7. Actualizar cámara
        camera.Follow(playerPos, dt, currentSpeed, isRunning);

        // 8. Renderizado 3D con OpenGL 4.5 DSA
        {
            static const std::array<float, 3> renderScales{1.0f, 1.0f, 1.5f};   // baja y media a resolucion nativa (con MSAA 4x); alta sobremuestrea 1,5x
            if (const int requested = ui.ConsumeGraphicsQualityRequest(); requested >= 0 && requested <= 2 && requested != graphicsQuality) {
                graphicsQuality = requested;
                static const std::array<const char*, 3> qualityNames{"baja", "media", "alta"};
                ui.Notify(std::string("Calidad gráfica: ") + qualityNames[static_cast<size_t>(requested)], ToastType::Info);
            }
            ui.SetGraphicsQuality(graphicsQuality);
            // Resolucion adaptativa: la calidad elegida es el techo; si los FPS reales se mantienen bajos la escala baja
            // y se recupera sola, sin cambiar la preferencia guardada
            if (static const char* forcedQuality = std::getenv("BAZUKO_QUALITY"); forcedQuality) graphicsQuality = std::clamp(std::atoi(forcedQuality), 0, 2);   // pruebas y benchmark: calidad fija
            static AdaptiveResolution adaptiveResolution(1.0f);
            static int adaptiveQuality = -1;
            static auto previousFrame = std::chrono::steady_clock::now();
            const auto now = std::chrono::steady_clock::now();
            const float frameMs = std::chrono::duration<float, std::milli>(now - previousFrame).count();
            previousFrame = now;
            if (adaptiveQuality != graphicsQuality) {
                adaptiveQuality = graphicsQuality;
                adaptiveResolution.SetLimit(renderScales[static_cast<size_t>(graphicsQuality)]);
            }
            static const bool fixedScale = std::getenv("BAZUKO_NOADAPT") != nullptr;   // benchmark: sin bajar la resolucion por carga
            if (!fixedScale && !ui.IsPaused() && frameMs < 1000.0f && adaptiveResolution.Sample(frameMs) && adaptiveResolution.ratio < renderScales[static_cast<size_t>(graphicsQuality)])
                ui.Notify("Resolución ajustada por rendimiento", ToastType::Warn);
            renderer.SetRenderScale(adaptiveResolution.ratio);
            const bool underLoad = adaptiveResolution.ratio < renderScales[static_cast<size_t>(graphicsQuality)] - 0.02f;   // la resolucion ya bajo por carga: SSAO, bloom y reflejos se apagan solos
            renderer.SetScreenReflections(graphicsQuality > 0 && !underLoad);
            renderer.SetGBufferReflections(graphicsQuality == 2 && !underLoad);
            renderer.SetPostEffects(graphicsQuality == 0 || underLoad ? 0 : graphicsQuality == 1 ? 6 : 12, graphicsQuality == 0 || underLoad ? 0.0f : graphicsQuality == 1 ? 0.04f : 0.06f);   // SSAO y bloom: no en calidad baja
            ui.SetEffectiveRenderScale(adaptiveResolution.ratio, adaptiveResolution.pressure);
        }
        renderer.SetWetness(simulation.GetWetness());
        Carton::SetWetness(simulation.GetWetness());
        // sombras del sol y la luna alrededor del jugador: baja no las dibuja, media 1024 px en 40 m, alta 2048 px en 60 m
        static const bool noShadows = std::getenv("BAZUKO_NOSHADOW") != nullptr;   // pruebas: compara el costo
        renderer.SetFarShadows(graphicsQuality == 2 && !noShadows && !std::getenv("BAZUKO_NOFARSHADOW"));
        renderer.ConfigureShadows(noShadows || graphicsQuality == 0 ? 0 : graphicsQuality == 1 ? 1024 : 2048, graphicsQuality == 1 ? 40.0f : 60.0f);
        {   // luz y cielo segun la hora y el clima (la calidad baja solo conserva la hora)
            const bool reducedWeather = graphicsQuality == 0;
            const Atmosphere atmosphere = ComputeAtmosphere(simulation.GetHour(), reducedWeather ? 0.0f : simulation.GetRainIntensity(), reducedWeather ? 0.0f : simulation.GetMist(),
                                                            simulation.GetCloudCover(), simulation.GetLightningFlash());
            {   // el sol cruza el cielo segun la hora y la temporada; de noche la luz direccional (y las sombras) pasa a la luna
                const glm::vec3 toSun = Climate::SunDirection(simulation.GetHour(), simulation.GetDay());
                const glm::vec3 toMoon = Climate::MoonDirection(simulation.GetHour(), simulation.GetDay());
                const float sunWeight = AtmosphereSmoothstep(-0.12f, 0.12f, toSun.y);
                glm::vec3 toLight = glm::mix(toMoon, toSun, sunWeight);
                toLight.y = std::max(toLight.y, 0.30f);   // sin sombras rasantes
                celestialSun = toSun;
                celestialMoon = toMoon;
                celestialMoonLight = Climate::MoonIllumination(Climate::MoonPhase(simulation.GetDay(), simulation.GetHour()));
                renderer.GetLighting().sunDir = -glm::normalize(toLight);
            }
            // cielo: paleta del juego web segun la altura del sol y el clima; el horizonte es tambien el color de la niebla
            skyColors = ComputeSkyColors(celestialSun.y, simulation.GetCloudCover(), reducedWeather ? 0.0f : simulation.GetRainIntensity(),
                                         reducedWeather ? 0.0f : simulation.GetMist(), simulation.GetLightningFlash());
            moonPhase = Climate::MoonPhase(simulation.GetDay(), simulation.GetHour());
            moonVisibility = AtmosphereSmoothstep(-0.02f, 0.06f, celestialMoon.y) * (0.25f + 0.75f * skyColors.night);
            skyDome.Update(std::max(0.0f, dt), simulation.GetWind());
            LightBlockData& lighting = renderer.GetLighting();
            lighting.sunColor = atmosphere.sunColor;
            lighting.ambientColor = atmosphere.ambientColor;
            lighting.fogColor = skyColors.horizon;
            lighting.fogDensity = atmosphere.fogDensity;
            // farolas: se encienden solas al oscurecer; solo las mas cercanas aportan luz
            lighting.lampCount = 0;
            if (atmosphere.lampPower > 0.01f) {
                const size_t lampBudget = graphicsQuality == 0 ? 28 : graphicsQuality == 1 ? 84 : static_cast<size_t>(LightBlockData::kMaxLampLights) - 24;   // el resto de casillas es para balizas y faros de los vehiculos
                for (const glm::vec4& lamp : simulation.GetNearestLampLights(playerPos, lampBudget, 110.0f)) {
                    lighting.lampPosition[lighting.lampCount] = glm::vec4(glm::vec3(lamp), 18.0f);
                    lighting.lampColor[lighting.lampCount] = glm::vec4(1.0f, 0.74f, 0.36f, 3.3f * atmosphere.lampPower * lamp.w);
                    ++lighting.lampCount;
                }
            }
            if (glm::vec4 fire; graphicsQuality > 0 && lighting.lampCount < LightBlockData::kMaxLampLights - 4 && simulation.GetCambucheFireLight(clock.GetElapsedTime(), playerPos, fire)) {   // fogon del cambuche
                lighting.lampPosition[lighting.lampCount] = glm::vec4(glm::vec3(fire), 9.0f);
                lighting.lampColor[lighting.lampCount] = glm::vec4(1.0f, 0.52f, 0.18f, 2.2f * fire.w);
                ++lighting.lampCount;
            }
            if (std::array<glm::vec4, 2> dealerFires; graphicsQuality > 0) {   // canecas con fuego del rincon del dealer
                const int count = simulation.GetDealerFireLights(clock.GetElapsedTime(), playerPos, dealerFires);
                for (int index = 0; index < count && lighting.lampCount < LightBlockData::kMaxLampLights - 4; ++index) {
                    lighting.lampPosition[lighting.lampCount] = glm::vec4(glm::vec3(dealerFires[static_cast<size_t>(index)]), 9.0f);
                    lighting.lampColor[lighting.lampCount] = glm::vec4(1.0f, 0.52f, 0.18f, 2.4f * dealerFires[static_cast<size_t>(index)].w);
                    ++lighting.lampCount;
                }
            }
            if (atmosphere.lampPower > 0.2f && graphicsQuality > 0) {   // faros de los vehiculos cercanos (8 en media, 24 en alta)
                for (const glm::vec4& headlight : simulation.GetHeadlightLights(playerPos, graphicsQuality == 1 ? 5 : 12, 70.0f)) {
                    if (lighting.lampCount >= LightBlockData::kMaxLampLights - 4) break;
                    lighting.lampPosition[lighting.lampCount] = glm::vec4(glm::vec3(headlight), 9.0f);
                    lighting.lampColor[lighting.lampCount] = glm::vec4(1.0f, 0.93f, 0.78f, 1.0f * atmosphere.lampPower);
                    ++lighting.lampCount;
                }
            }
            for (const Simulation::StrobeLight& strobe : simulation.GetStrobeLights(playerPos, clock.GetElapsedTime(), 70.0f)) {   // la baliza ilumina la calle de rojo y de azul
                if (lighting.lampCount >= LightBlockData::kMaxLampLights) break;
                lighting.lampPosition[lighting.lampCount] = strobe.position;
                lighting.lampColor[lighting.lampCount] = glm::vec4(strobe.color, 16.0f);
                ++lighting.lampCount;
            }
            simulation.SetLampGlow(atmosphere.lampPower);
            frameLampPower = atmosphere.lampPower;
            renderer.SetVolumetricFog(graphicsQuality == 2 ? std::clamp(0.0010f + 0.0055f * simulation.GetMist() + 0.0035f * simulation.GetRainIntensity(), 0.0f, 0.012f) : 0.0f);
            renderer.SetHeightFog(reducedWeather ? 0.0f : std::clamp(0.12f + 2.0f * simulation.GetMist(), 0.0f, 2.0f));   // la bruma se espesa cerca del suelo
            starVisibility = std::clamp((atmosphere.lampPower - 0.35f) / 0.5f, 0.0f, 1.0f)
                * (1.0f - std::min(1.0f, 0.85f * simulation.GetRainIntensity() + 0.9f * simulation.GetMist()));
            city.SetNightGlow(atmosphere.lampPower);
        }
        {   // rayos de luz del sol: solo en calidad alta, con el sol sobre el horizonte y poco nublado
            const float sunUp = AtmosphereSmoothstep(0.0f, 0.18f, celestialSun.y);
            const float clear = std::clamp(1.0f - simulation.GetCloudCover() * 0.9f - simulation.GetRainIntensity(), 0.0f, 1.0f);
            const float lowSun = 1.0f - 0.6f * std::clamp(celestialSun.y / 0.7f, 0.0f, 1.0f);   // mas fuertes con el sol bajo
            renderer.SetLightShafts(graphicsQuality == 2 ? 0.22f * sunUp * clear * lowSun : 0.0f, celestialSun, glm::vec3(1.0f, 0.82f, 0.55f));
        }
        renderer.BeginScaledTarget();
        renderer.BeginScene(camera, clock.GetElapsedTime());

        skyDome.Render(renderer, skyColors, celestialSun, celestialMoon, moonPhase, moonVisibility, simulation.GetCloudCover(), simulation.GetLightningFlash(), graphicsQuality == 0 ? 2 : graphicsQuality == 1 ? 3 : 4);

        // Renderizar ciudad de Bogotá
        city.Render(renderer, playerPos);
        if (!std::getenv("BAZUKO_NODECALS")) decals.Render(renderer, playerPos, graphicsQuality == 0 ? 35.0f : 70.0f);
        lake.DrawFish(renderer, clock.GetElapsedTime());
        simulation.Render(renderer, clock.GetElapsedTime(), playerPos);
        if (gps.Waypoint() && ui.IsGpsBeaconVisible()) {   // haz del destino: columna translucida que se ve desde lejos
            const float pulse = 0.30f + 0.12f * std::sin(clock.GetElapsedTime() * 2.5f);
            const glm::vec3 beaconBase(gps.Waypoint()->x, city.GetGroundHeight(gps.Waypoint()->x, gps.Waypoint()->z) + 20.0f, gps.Waypoint()->z);
            renderer.Submit(*gpsBeacon, glm::translate(glm::mat4(1.0f), beaconBase), glm::vec4(1.0f, 1.0f, 1.0f, pulse), false, false, nullptr, 2);
        }
        starField.Render(renderer, camera.GetPosition(), starVisibility, clock.GetElapsedTime());
        // Renderizar personaje
        {
            if (playerKnockedDown) {
                // atropello: vuela y rueda (0,8 s), queda tendido, y se levanta del suelo como una persona (rodar, rodillas, zancada)
                const float fallElapsed = kKnockdownSeconds - knockdownRemaining;
                glm::mat4 playerModel;
                int fallClip;
                float fallTime = fallElapsed;
                if (fallElapsed < 0.8f) {
                    playerModel = playerRagdoll.GetCharacterTransform(playerYaw, 0.0f);
                    fallClip = characterManager.FindClip("RunOverTumble");
                } else {
                    const float groundY = knockedOnDeck ? Viaduct::DeckHeightAt(playerPos.x, playerPos.z) : city.GetGroundHeight(playerPos.x, playerPos.z);
                    playerModel = glm::rotate(glm::translate(glm::mat4(1.0f), glm::vec3(playerPos.x, groundY, playerPos.z)), knockdownLyingYaw, glm::vec3(0.0f, 1.0f, 0.0f));
                    if (fallElapsed < 1.6f || deathByVehicleImpact) {
                        fallClip = characterManager.FindClip("LyingLoop");
                        fallTime = fallElapsed - 0.8f;
                    } else if (fallElapsed < 3.1f) {
                        fallClip = characterManager.FindClip("GetUp");
                        fallTime = fallElapsed - 1.6f;
                    } else {
                        fallClip = characterManager.FindClip("Idle");
                    }
                }
                characterManager.Draw(renderer, playerModel, fallTime, false, false, fallClip);
            } else {
                glm::mat4 playerModel = glm::translate(glm::mat4(1.0f), playerPos);
                playerModel = glm::rotate(playerModel, playerYaw, glm::vec3(0.0f, 1.0f, 0.0f));
                playerModel = glm::translate(playerModel, glm::vec3(0.0f, jumpOffset, 0.0f));
                const bool movingNow = currentSpeed > 0.25f;
                {   // nadando: el cuerpo se tiende sobre el agua (brazada de crol con el ciclo de la carrera) y al parar flota de pie
                    const float swimTarget = playerSwimming && movingNow ? 1.0f : 0.0f;
                    swimPitch += (swimTarget - swimPitch) * std::min(1.0f, std::max(0.0f, dt) * 4.0f);
                    if (swimPitch > 0.01f) {
                        const float bob = 0.04f * std::sin(clock.GetElapsedTime() * 2.2f);
                        playerModel = glm::translate(playerModel, glm::vec3(0.0f, 0.95f * swimPitch + bob * swimPitch, -0.85f * swimPitch));   // el cuerpo va metido en el agua, con la espalda a flor
                        playerModel = glm::rotate(playerModel, glm::radians(78.0f) * swimPitch, glm::vec3(1.0f, 0.0f, 0.0f));
                    }
                }
                stillSeconds = movingNow || playerAction != PlayerAction::None ? 0.0f : stillSeconds + dt;
                int poseClip = -1;
                float poseTime = clock.GetElapsedTime();
                if (poopMode != 0) {
                    poseClip = characterManager.FindClip(poopMode == 1 ? "PoopSquat" : "PoopPickThrow");
                    poseTime = poopElapsed;
                } else if (playerHitKind > 0) {
                    poseClip = characterManager.FindClip(playerHitKind == 1 ? "HitFace" : playerHitKind == 2 ? "HitChest" : "HitLegs");
                    poseTime = playerHitTime;
                } else if (playerAction != PlayerAction::None && combatMoveOf(playerAction) >= 0) {
                    poseClip = characterManager.FindClip("FightIdle");   // la guardia es la base; la tecnica gira huesos encima
                    poseTime = 0.0f;
                } else if (playerAction == PlayerAction::Jump) {
                    poseClip = characterManager.FindClip("Idle");   // el salto gira huesos sobre el reposo (JumpMoves.hpp)
                    poseTime = 0.0f;
                } else if (playerAction != PlayerAction::None) {
                    poseClip = playerActionClip;
                    poseTime = actionTime;
                } else if (playerCrouching) {
                    poseClip = characterManager.FindClip(movingNow ? "CrouchWalk" : "Crouch");
                } else if (!movingNow && knifeStanceRemaining > 0.0f) {
                    poseClip = characterManager.FindClip("KnifeIdle");
                } else if (!movingNow && fightStanceRemaining > 0.0f) {
                    poseClip = characterManager.FindClip("FightIdle");
                } else if (!movingNow && stillSeconds > 6.0f) {
                    poseClip = characterManager.FindClip("IdleRelaxed");
                }
                int blendClip = -1;
                float blendWeight = 0.0f;
                if (poseClip < 0 && movingNow) {   // caminar y correr se mezclan y avanzan al ritmo de la velocidad real: los pies no resbalan
                    const CharacterManager::LocomotionBlend blend = characterManager.ComputeLocomotion(currentSpeed);
                    if (blend.valid) {
                        locomotionPhase = std::fmod(locomotionPhase + std::max(0.0f, dt) * blend.rate, 1.0f);
                        poseClip = characterManager.GetWalkClip();
                        blendClip = characterManager.GetRunClip();
                        blendWeight = blend.run;
                        poseTime = locomotionPhase * characterManager.GetWalkDuration();
                        // sin energia (bajo 20; vuelve a andar normal sobre 30) camina cansado: encorvado y arrastrando los pies
                        if (static const char* forcedEnergy = std::getenv("BAZUKO_ENERGIA")) needs[2] = static_cast<float>(std::atof(forcedEnergy));   // pruebas
                        if (needs[2] < 20.0f) tiredGait = true; else if (needs[2] > 30.0f) tiredGait = false;
                        if (tiredGait && characterManager.GetTiredClip() >= 0 && blend.run < 0.2f && currentSpeed >= 1.1f) {
                            locomotionPhase = std::fmod(locomotionPhase - std::max(0.0f, dt) * blend.rate + std::max(0.0f, dt) * currentSpeed / characterManager.GetTiredStride(), 1.0f);
                            poseClip = characterManager.GetTiredClip();
                            blendClip = -1;
                            blendWeight = 0.0f;
                            poseTime = locomotionPhase * characterManager.GetTiredDuration();
                        }
                        if (currentSpeed < 1.1f && characterManager.FindClip("Idle") >= 0) {   // al arrancar y al frenar el reposo se mezcla con la caminata en vez de cambiar de golpe
                            const float t = std::clamp((currentSpeed - 0.25f) / 0.85f, 0.0f, 1.0f);
                            poseClip = characterManager.FindClip("Idle");
                            blendClip = characterManager.GetWalkClip();
                            blendWeight = t * t * (3.0f - 2.0f * t);
                        }
                    }
                } else if (!movingNow) {
                    locomotionPhase = 0.0f;
                }
                {   // pruebas: BAZUKO_PREVIEW_CLIP=<clip> reproduce ese clip en el jugador (BAZUKO_PREVIEW_TIME fija el segundo)
                    static const char* previewName = std::getenv("BAZUKO_PREVIEW_CLIP");
                    static const char* previewTime = std::getenv("BAZUKO_PREVIEW_TIME");
                    if (previewName) {
                        poseClip = characterManager.FindClip(previewName);
                        poseTime = previewTime ? static_cast<float>(std::atof(previewTime)) : std::fmod(clock.GetElapsedTime(), 3.0f);
                    }
                }
                std::vector<Model::BoneTurn> swimTurns;
                if (swimPitch > 0.5f) {   // nadando: brazos en molino de crol y patada alterna sobre la pose de reposo
                    constexpr float kTau = 6.2831853f;
                    swimPhase = std::fmod(swimPhase + std::max(0.0f, dt) * (playerWaterDepth > 1.15f ? 0.62f : 0.52f), 1.0f);
                    if (static const char* fixedPhase = std::getenv("BAZUKO_SWIMPHASE")) swimPhase = static_cast<float>(std::atof(fixedPhase));   // pruebas: congela la brazada
                    poseClip = characterManager.FindClip("Idle");
                    blendClip = -1;
                    blendWeight = 0.0f;
                    poseTime = 0.0f;
                    const auto bone = [&](const char* name, float angle) { swimTurns.push_back({name, {angle, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true}); };
                    // Brazada de crol (esquema por etapas): entrada con el brazo estirado al frente, jalada bajo el cuerpo con el codo alto,
                    // salida junto a la cadera y recobro fuera del agua con el codo alto y el antebrazo colgando. Direcciones en el espacio
                    // del modelo con el cuerpo tendido: +y avance, +z hacia el agua, -z hacia el cielo, x lateral (`s` segun el lado)
                    struct ArmKey { float q; glm::vec3 upper, fore; };
                    static const std::array<ArmKey, 8> keys{{
                        {0.00f, {0.25f, 1.00f, 0.20f}, {0.20f, 1.00f, 0.25f}},    // a: mano al frente, entrada
                        {0.14f, {0.30f, 0.75f, 0.60f}, {0.15f, 0.10f, 1.00f}},    // b-c: agarre, antebrazo hacia abajo
                        {0.30f, {0.20f, 0.05f, 1.00f}, {0.10f, -0.65f, 0.90f}},   // d: jalada bajo el cuerpo
                        {0.50f, {0.15f, -1.00f, 0.30f}, {0.10f, -1.00f, 0.25f}},  // e: empuje hasta la cadera
                        {0.60f, {0.60f, -0.70f, -0.45f}, {0.30f, -0.80f, 0.25f}}, // salida del agua
                        {0.74f, {1.00f, -0.15f, -0.40f}, {0.35f, 0.40f, 0.95f}},  // f: codo alto, antebrazo colgando
                        {0.88f, {0.80f, 0.55f, -0.25f}, {0.25f, 0.85f, 0.45f}},   // g: la mano pasa junto a la cabeza
                        {1.00f, {0.25f, 1.00f, 0.20f}, {0.20f, 1.00f, 0.25f}}}};
                    const auto stroke = [&](const char* arm, const char* forearm, const char* hand, float side, float q) {
                        q = q - std::floor(q);
                        size_t next = 1;
                        while (next < keys.size() - 1 && keys[next].q < q) ++next;
                        const ArmKey& from = keys[next - 1];
                        const ArmKey& to = keys[next];
                        const float u = glm::smoothstep(0.0f, 1.0f, (q - from.q) / std::max(0.0001f, to.q - from.q));
                        const auto mirrored = [&](glm::vec3 v) { v.x *= side; return glm::normalize(v); };
                        const glm::vec3 upper = glm::normalize(glm::mix(mirrored(from.upper), mirrored(to.upper), u));
                        const glm::vec3 fore = glm::normalize(glm::mix(mirrored(from.fore), mirrored(to.fore), u));
                        swimTurns.push_back({arm, {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true, forearm, upper});
                        swimTurns.push_back({forearm, {0.0f, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true, hand, fore});
                    };
                    stroke("mixamorig:LeftArm", "mixamorig:LeftForeArm", "mixamorig:LeftHand", 1.0f, swimPhase);
                    stroke("mixamorig:RightArm", "mixamorig:RightForeArm", "mixamorig:RightHand", -1.0f, swimPhase + 0.5f);
                    {   // el torso rueda un poco hacia el brazo que recobra
                        const float roll = 0.28f * std::sin(kTau * swimPhase);
                        swimTurns.push_back({"mixamorig:Spine1", {0.0f, roll, 0.0f}, {0.0f, 0.0f, 0.0f}, true});
                        swimTurns.push_back({"mixamorig:Spine2", {0.0f, roll, 0.0f}, {0.0f, 0.0f, 0.0f}, true});
                    }
                    bone("mixamorig:RightUpLeg", 0.38f * std::sin(kTau * 2.0f * swimPhase));
                    bone("mixamorig:LeftUpLeg", -0.38f * std::sin(kTau * 2.0f * swimPhase));
                }
                {   // basura: revisandola (Q mantenido) se agacha y revuelve con los dos brazos; al recogerla de un golpe baja el brazo derecho
                    const auto toLocal = [&](const glm::vec3& target) {
                        const glm::vec3 v = target - playerPos;
                        const glm::vec3 forward(std::sin(playerYaw), 0.0f, std::cos(playerYaw)), left(std::cos(playerYaw), 0.0f, -std::sin(playerYaw));
                        return glm::vec3(glm::dot(v, left), 0.0f, glm::dot(v, forward));
                    };
                    static float sortElapsed = 0.0f;
                    if (sorting) {
                        sortElapsed += std::max(0.0f, dt);
                        Combat::AppendGroundWork(swimTurns, std::min(1.0f, sortElapsed / 0.30f), toLocal(sortPosition), sortElapsed, 1.0f, true);
                    } else {
                        sortElapsed = 0.0f;
                        if (pickupTime >= 0.0f) {
                            const float u = pickupTime / 0.85f;
                            const float envelope = u < 0.35f ? glm::smoothstep(0.0f, 0.35f, u) : 1.0f - glm::smoothstep(0.55f, 1.0f, u);   // baja rapido, toca y sube
                            Combat::AppendGroundWork(swimTurns, 0.75f * envelope, toLocal(pickupTarget), pickupTime, 0.5f, false);
                        }
                    }
                }
                if (grabTime >= 0.0f) Combat::AppendGrab(swimTurns, grabTime);   // robo de un retrovisor: el brazo derecho agarra rapido y vuelve
                if (playerAction == PlayerAction::Jump) Jump::Append(swimTurns, actionTime, jumpMoving);
                else if (const int combatMove = combatMoveOf(playerAction); combatMove >= 0 && playerAction != PlayerAction::None)
                    Combat::AppendMove(swimTurns, static_cast<Combat::Move>(combatMove), actionTime);
                else if (!movingNow && fightStanceRemaining > 0.0f && playerAction == PlayerAction::None)
                    Combat::AppendFists(swimTurns);   // en guardia los puños van cerrados
                if (static const char* previewJump = std::getenv("BAZUKO_PREVIEW_JUMP")) {   // pruebas: BAZUKO_PREVIEW_JUMP=static|moving con BAZUKO_PREVIEW_TIME=<s>
                    static const char* jumpTime = std::getenv("BAZUKO_PREVIEW_TIME");
                    poseClip = characterManager.FindClip("Idle");
                    blendClip = -1;
                    blendWeight = 0.0f;
                    poseTime = 0.0f;
                    Jump::Append(swimTurns, jumpTime ? static_cast<float>(std::atof(jumpTime)) : 0.0f, std::string(previewJump) == "moving");
                }
                if (static const char* previewMove = std::getenv("BAZUKO_PREVIEW_MOVE")) {   // pruebas: BAZUKO_PREVIEW_MOVE=<tecnica> con BAZUKO_PREVIEW_TIME=<s>
                    const int move = Combat::FindMove(previewMove);
                    if (move >= 0) {
                        static const char* moveTime = std::getenv("BAZUKO_PREVIEW_TIME");
                        poseClip = characterManager.FindClip("FightIdle");
                        blendClip = -1;
                        blendWeight = 0.0f;
                        poseTime = 0.0f;
                        Combat::AppendMove(swimTurns, static_cast<Combat::Move>(move), moveTime ? static_cast<float>(std::atof(moveTime)) : std::fmod(clock.GetElapsedTime(), Combat::Info(static_cast<Combat::Move>(move)).duration + 0.4f));
                    }
                }
                {   // pies sobre la pendiente: en rampas (viaducto, estacion) la punta de los pies sigue la inclinacion del suelo en vez de quedar horizontal
                    static glm::vec3 previousIkPosition = playerPos;
                    static float smoothSlope = 0.0f;
                    static const char* forcedSlope = std::getenv("BAZUKO_IK_SLOPE");   // pruebas: pendiente forzada (grados)
                    const float travelled = glm::distance(glm::vec2(playerPos.x, playerPos.z), glm::vec2(previousIkPosition.x, previousIkPosition.z));
                    if (travelled > 0.002f) {
                        const float measured = std::clamp((playerPos.y - previousIkPosition.y) / travelled, -0.7f, 0.7f);
                        smoothSlope += (measured - smoothSlope) * (1.0f - std::exp(-8.0f * std::max(dt, 0.0f)));
                    } else if (!movingNow) {
                        smoothSlope += (0.0f - smoothSlope) * (1.0f - std::exp(-6.0f * std::max(dt, 0.0f)));
                    }
                    previousIkPosition = playerPos;
                    float slope = forcedSlope ? std::tan(glm::radians(static_cast<float>(std::atof(forcedSlope)))) : smoothSlope;
                    const bool freeLegs = swimTurns.empty() && !playerSwimming && playerAction == PlayerAction::None && !std::getenv("BAZUKO_NOFOOTIK");
                    if (freeLegs && std::abs(slope) > 0.04f) {
                        const float angle = std::atan(slope) * 0.85f;   // 0,85: el pie no copia todo el angulo (la suela se apoya de punta a talon)
                        for (const char* side : {"Left", "Right"}) swimTurns.push_back({std::string("mixamorig:") + side + "Foot", {-angle, 0.0f, 0.0f}, {0.0f, 0.0f, 0.0f}, true});
                        swimTurns.push_back({"mixamorig:Hips", {0.0f, 0.0f, 0.0f}, {0.0f, -std::min(0.10f, 0.18f * std::max(-slope, 0.0f) + 0.10f * std::max(slope, 0.0f)), 0.0f}, true});   // la cadera baja al bajar y un poco al subir
                    }
                }
                characterManager.Draw(renderer, playerModel, poseTime, movingNow, isRunning, poseClip, blendClip, blendWeight, swimTurns.empty() ? nullptr : &swimTurns);
                if (knifeModel && (playerAction == PlayerAction::Slash || playerAction == PlayerAction::Stab || knifeStanceRemaining > 0.0f || equippedWeapon == "cuchillo")) {
                    // la navaja va en la mano derecha, con la hoja saliendo del puno
                    const glm::mat4 hand = characterManager.HandMatrix(playerModel, poseTime, poseClip >= 0 ? poseClip : characterManager.FindClip("Idle"), true);
                    glm::mat4 grip = glm::rotate(glm::mat4(1.0f), glm::radians(75.0f), glm::vec3(1.0f, 0.0f, 0.0f));
                    grip = glm::scale(grip, glm::vec3(1.3f));
                    knifeModel->Draw(renderer, hand * grip);
                }
            }
        }

        if (graphicsQuality > 0 && !std::getenv("BAZUKO_NOBEAMS")) {   // los haces de los faros se ven en el aire humedo y con poca luz
            const float damp = std::clamp(0.9f * simulation.GetMist() + 0.9f * simulation.GetRainIntensity() + 0.12f, 0.0f, 1.0f);
            const float dark = AtmosphereSmoothstep(0.05f, 0.5f, frameLampPower);
            std::vector<LightBeams::Beam> beams;
            for (const auto& headlight : simulation.GetHeadlightBeams(playerPos, graphicsQuality == 1 ? 6 : 14, 60.0f))
                beams.push_back({headlight.position, headlight.direction, 18.0f, 2.6f});
            if (std::getenv("BAZUKO_LOG_BEAMS")) LogInfo("Haces: {} visibilidad {:.2f} (aire {:.2f}, oscuridad {:.2f})", beams.size(), damp * dark, damp, dark);
            lightBeams.Render(renderer, beams, damp * dark);
            {   // cono de luz de las farolas: columna calida y suave bajo cada una (como el aire con bruma de noche), mas marcada con humedad
                std::vector<LightBeams::Beam> lampCones;
                for (const glm::vec4& lamp : simulation.GetNearestLampLights(playerPos, graphicsQuality == 1 ? 18 : 44, 80.0f))
                    lampCones.push_back({glm::vec3(lamp), glm::vec3(0.0f, -0.999f, 0.0f), 7.0f, 3.6f});
                lightBeams.Render(renderer, lampCones, dark * (0.20f + 0.60f * damp), glm::vec3(1.0f, 0.74f, 0.40f));
            }
        }
        lake.DrawSurface(renderer, clock.GetElapsedTime());   // al final: el agua translucida deja ver al jugador y a los peces sumergidos
        renderer.EndScene();
        renderer.EndScaledTarget();
        renderer.RenderShadowMap(-renderer.GetLighting().sunDir, playerPos);   // con lo que se vio en este cuadro: lo usa el siguiente

        // 9. Interfaz gráfica (Dear ImGui)
        {   // burbujas de conversacion de los peatones cercanos
            simulation.SetPlayerHygiene(needs[4]);
            std::vector<UIManager::WorldBubble> bubbles;
            for (const auto& bubble : simulation.GetPedestrianBubbles(playerPos)) {
                const glm::vec4 clip = camera.GetViewProjectionMatrix() * glm::vec4(bubble.position, 1.0f);
                if (clip.w > 0.1f) bubbles.push_back({clip.x / clip.w, clip.y / clip.w, bubble.text, bubble.alpha});
            }
            ui.SetWorldBubbles(std::move(bubbles));
        }
        ui.BeginFrame();
        std::string inventorySummary = inventory.empty() ? "Vacío" : "";
        for (const auto& entry : inventory) {
            if (!inventorySummary.empty()) inventorySummary += "  |  ";
            inventorySummary += lootTable[entry.itemIndex].name + " x" + std::to_string(entry.quantity);
        }
        std::string diseaseSummary = diseases.empty() ? "Sin enfermedades" : "";
        for (const auto& disease : diseases) {
            if (!diseaseSummary.empty()) diseaseSummary += "  |  ";
            diseaseSummary += disease.id + " (" + std::to_string(static_cast<int>(disease.remaining)) + " s)";
        }
        const std::array<const char*, kNeedCount> needLabels{"hambre", "sed", "energía", "salud", "higiene", "ánimo", "vicio"};
        std::vector<CraftingOption> craftingOptions;
        for (const Economy::RecipeDef& recipe : recipes) {
            const auto resultItem = std::find_if(lootTable.begin(), lootTable.end(), [&](const Item& item) { return item.id == recipe.id; });
            if (resultItem == lootTable.end()) continue;
            CraftingOption option;
            option.id = recipe.id;
            option.name = resultItem->name;
            option.quantity = recipe.quantity;
            option.weight = resultItem->weight;
            option.craftable = true;
            for (const auto& [id, quantity] : recipe.ingredients) {
                const auto material = std::find_if(lootTable.begin(), lootTable.end(), [&](const Item& item) { return item.id == id; });
                const std::string materialName = material != lootTable.end() ? material->name : id;
                option.materials.push_back({id, materialName, inventoryCount(id), quantity});
                option.craftable = option.craftable && inventoryCount(id) >= quantity;
                option.ingredients += (option.ingredients.empty() ? "" : " · ") + materialName + " (" + std::to_string(inventoryCount(id)) + "/" + std::to_string(quantity) + ")";
            }
            option.fits = inventoryWeight + resultItem->weight * static_cast<float>(recipe.quantity) <= inventoryCapacity();
            // efecto del objeto a partir de sus datos
            std::string effect;
            const auto addEffect = [&](const std::string& piece) { effect += (effect.empty() ? "" : " · ") + piece; };
            const auto signed1 = [](float v) { return (v > 0 ? "+" : "") + std::to_string(static_cast<int>(v)); };
            if (resultItem->consumableNeed >= 0) addEffect(signed1(resultItem->amount) + " " + needLabels[static_cast<size_t>(resultItem->consumableNeed)]);
            for (int need = 0; need < kNeedCount; ++need)
                if (need != resultItem->consumableNeed && resultItem->deltas[static_cast<size_t>(need)] != 0.0f)
                    addEffect(signed1(resultItem->deltas[static_cast<size_t>(need)]) + " " + needLabels[static_cast<size_t>(need)]);
            if (!resultItem->cure.empty()) addEffect("Cura: " + resultItem->cure);
            if (effect.empty()) addEffect(resultItem->usable ? "Se usa desde el inventario" : "Se vende por $" + std::to_string(resultItem->value));
            char weightText[32];
            std::snprintf(weightText, sizeof(weightText), "%.2f kg", resultItem->weight);
            addEffect(weightText);
            option.effect = effect;
            craftingOptions.push_back(std::move(option));
        }
        std::vector<InventoryOption> inventoryOptions;
        inventoryOptions.reserve(inventory.size());
        for (const auto& entry : inventory) {
            const Item& item = lootTable[entry.itemIndex];
            const auto hotbarSlot = std::find(hotbar.begin(), hotbar.end(), item.id);
            inventoryOptions.push_back({entry.itemIndex, item.id, item.name, entry.quantity, item.weight,
                item.consumableNeed >= 0 || !item.cure.empty() || item.id == "vendaje" || item.id == "curita"
                    || item.id == "pilas" || item.id == "radioTransistor" || !item.weapon.empty(),
                item.desc, DescribeItemEffects(item), item.rarityLabel,
                hotbarSlot == hotbar.end() ? -1 : static_cast<int>(hotbarSlot - hotbar.begin()), item.value});
        }
        {   // lo que el jibaro le compra de noche al jugador: sustancias del costal a 1,8 veces su valor
            std::vector<DealerSale> sales;
            for (const auto& entry : inventory) {
                const Item& item = lootTable[entry.itemIndex];
                if (!item.substance) continue;
                sales.push_back({item.id, item.name, entry.quantity, static_cast<int>(std::round(static_cast<float>(item.value) * 1.8f * 1.3f * talentEffect("substancePriceMult")))});
            }
            ui.SetDealerSales(std::move(sales), simulation.IsNight());
        }
        std::vector<DealerOption> dealerOptions;
        for (const std::string& id : {std::string("tintico"), std::string("pegante"), std::string("pastilla"), std::string("basuco")}) {
            const auto item = std::find_if(lootTable.begin(), lootTable.end(),
                [&](const Item& entry) { return entry.id == id; });
            if (item == lootTable.end()) continue;
            std::string detail = DescribeItemEffects(*item);
            for (size_t at = detail.find(" · "); at != std::string::npos; at = detail.find(" · ")) detail.replace(at, 4, ", ");
            char weightText[32];
            std::snprintf(weightText, sizeof(weightText), "%.2g", item->weight);
            for (char* c = weightText; *c; ++c) if (*c == '.') *c = ',';
            detail += std::string(", pesa ") + weightText + " kg";
            dealerOptions.push_back({item->id, item->name, item->value, money >= item->value,
                                     inventoryWeight + item->weight <= inventoryCapacity(), detail});
        }
        std::vector<TalentOption> talentOptions;
        for (const TalentDef& definition : gameData.talents) {
            talentOptions.push_back({definition.id, definition.name, definition.desc,
                                     definition.prerequisites.empty() ? std::string{} : definition.prerequisites.front(), definition.cost});
            talentOptions.back().branch = definition.branch;
        }
        for (auto& talent : talentOptions) {
            talent.unlocked = hasTalent(talent.id);
            talent.available = !talent.unlocked && talentPoints >= talent.cost
                && (talent.requirement.empty() || hasTalent(talent.requirement));
        }
        simulation.SetDogCoat(ui.GetCompanionCoat());
        simulation.SetDogLook(ui.GetCompanionSize(), ui.GetCompanionAccessory());
        {
            std::vector<ShopOption> shopOptions;
            if (ui.IsShopMenuOpen()) {
                const auto allowed = [&](const std::string& key) {
                    return ui.ShopFilter().empty() || std::find(ui.ShopFilter().begin(), ui.ShopFilter().end(), key) != ui.ShopFilter().end();
                };
                for (const ShopEntry& entry : gameData.shop) {
                    ShopOption option;
                    option.price = entry.price;
                    if (!entry.upgrade.empty()) {
                        option.key = entry.upgrade;
                        option.name = entry.label.empty() ? entry.upgrade : entry.label;
                        option.owned = bigSack;
                        option.description = bigSack ? "Ya lo tienes." : entry.desc;
                        option.enabled = !bigSack && money >= static_cast<float>(entry.price);
                    } else {
                        const ItemDef* product = gameData.FindItem(entry.item);
                        if (!product) continue;
                        option.key = entry.item;
                        option.name = entry.label.empty() ? product->name : entry.label;
                        const bool heavy = inventoryWeight + product->weight * static_cast<float>(entry.qty) > inventoryCapacity();
                        option.description = heavy ? "No te cabe en el costal."
                            : !entry.desc.empty() ? entry.desc : DescribeItemEffects(*product);
                        option.enabled = !heavy && money >= static_cast<float>(entry.price);
                    }
                    if (allowed(option.key)) shopOptions.push_back(std::move(option));
                }
            }
            std::vector<RecyclerRow> recyclerRows;
            if (ui.IsRecyclerMenuOpen()) {
                const float multiplier = recyclerMultiplier();
                for (const auto& entry : inventory) {
                    const Item& item = lootTable[entry.itemIndex];
                    if (!isRecyclable(item)) continue;
                    recyclerRows.push_back({item.name, entry.quantity, static_cast<int>(std::round(item.value * multiplier)),
                                            static_cast<int>(std::round(item.value * entry.quantity * multiplier))});
                }
            }
            ui.SetPlaceMenuData(shopOptions, recyclerRows, money, inventoryWeight, inventoryCapacity());
            ui.SetSortProgress(sorting ? sortProgress / kSortSeconds : -1.0f);
        }
        ui.RenderHUD(dt, playerPos, camera, renderer, window, city, simulation, audio,
                     characterManager.GetLook().nombre, characterManager.GetOriginInfo().name,
                     needs, money, inventoryWeight, inventoryCapacity(),
                     simulation.GetDayProgress(), simulation.GetPedestrianCount(), simulation.GetTrafficCount(), inventorySummary, diseaseSummary, level, xp, objective,
                     simulation.GetMissionProgress(), simulation.GetMissionTarget(), craftingOptions,
                     inventoryOptions, talentPoints, talentOptions, simulation.IsDogFriend(), dealerOptions,
                     boostActive, boostTimer, psychosisSeverity);

        const std::string shopPurchase = ui.ConsumeShopPurchaseRequest();
        if (!shopPurchase.empty()) {
            const Economy::PurchaseResult purchase = Economy::Purchase(session, gameData, shopPurchase);
            switch (purchase.outcome) {
                case Economy::PurchaseOutcome::UnknownProduct: LogWarn("El menu de la tienda solicito un producto desconocido: {}", shopPurchase); break;
                case Economy::PurchaseOutcome::NotEnoughMoney: ui.SetPickupNotification("No te alcanza para comprar eso."); break;
                case Economy::PurchaseOutcome::UpgradeAlreadyOwned: break;
                case Economy::PurchaseOutcome::BoughtUpgrade:
                    audio.Play(AudioCue::Pickup);
                    ui.SetPickupNotification("Compraste el " + purchase.label + ": ahora cargas " + std::to_string(static_cast<int>(gameData.costalBonus)) + " kg más.");
                    break;
                case Economy::PurchaseOutcome::ProductMissing: LogWarn("Producto sin objeto: {}", shopPurchase); break;
                case Economy::PurchaseOutcome::NoRoom:
                    audio.Play(AudioCue::Full);
                    ui.SetPickupNotification("No te cabe en el costal: " + purchase.label + ".");
                    break;
                case Economy::PurchaseOutcome::Bought:
                    audio.Play(AudioCue::Pickup);
                    ui.SetPickupNotification("Compraste " + purchase.label + ".");
                    break;
            }
        }
        if (ui.ConsumeRecyclerSellRequest()) sellRecyclables();

        if (const std::string dealerSale = ui.ConsumeDealerSellRequest(); !dealerSale.empty() && simulation.IsNight()) {
            const auto entry = std::find_if(inventory.begin(), inventory.end(), [&](const InventoryEntry& candidate) { return lootTable[candidate.itemIndex].id == dealerSale && lootTable[candidate.itemIndex].substance; });
            if (entry != inventory.end()) {
                const Item& item = lootTable[entry->itemIndex];
                const int quantity = entry->quantity;
                inventoryWeight = std::max(0.0f, inventoryWeight - item.weight * static_cast<float>(quantity));
                if (std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) < 0.15f) {   // en cada venta hay un 15 % de que caiga la policia y se lleve la mercancia
                    ui.SetPickupNotification("Cayó la policía y se llevó la mercancía.");
                    simulation.CallPolice(playerPos, 0.5f);
                } else {
                    const float earned = std::round(static_cast<float>(item.value * quantity) * 1.8f * 1.3f * talentEffect("substancePriceMult"));
                    money += earned;
                    audio.Play(AudioCue::Sell);
                    ui.SetPickupNotification("Vendiste " + std::to_string(quantity) + " " + item.name + " al jíbaro por $" + std::to_string(static_cast<int>(earned)) + ".");
                }
                inventory.erase(entry);
            }
        }
        const std::string dealerPurchase = ui.ConsumeDealerPurchaseRequest();
        if (!dealerPurchase.empty()) {
            const auto item = std::find_if(lootTable.begin(), lootTable.end(),
                [&](const Item& entry) { return entry.id == dealerPurchase && entry.substance; });
            if (item == lootTable.end()) {
                LogWarn("El menu del dealer solicito un articulo desconocido: {}", dealerPurchase);
            } else if (money < item->value) {
                ui.SetPickupNotification("No tienes dinero suficiente para comprar " + item->name + ".");
            } else if (!addLootById(item->id)) {
                ui.SetPickupNotification("No cabe " + item->name + " en el costal.");
            } else {
                money -= static_cast<float>(item->value);
                audio.Play(AudioCue::Pickup);
                ui.SetPickupNotification("Compraste " + item->name + " al dealer.");
            }
        }

        {
            // Radio transistor: peticiones del sintonizador, bateria, bienestar y sintesis
            if (ui.ConsumeRadioPowerToggle()) {
                radioOn = !radioOn;
                if (radioOn && radioBattery <= 0.0f) {
                    radioOn = false;
                    ui.Notify("La radio no tiene pilas.", ToastType::Warn);
                } else {
                    ui.Notify(radioOn ? "Radio encendida" : "Radio apagada", ToastType::Info);
                }
            }
            if (ui.ConsumeRadioTuned() && !radioOn && radioBattery > 0.0f) {
                radioOn = true;
                ui.Notify("Radio encendida", ToastType::Info);
            }
            if (ui.ConsumeRadioBatteryRequest() && radioBattery < 100.0f) {
                const int pilasIndex = gameData.ItemIndex("pilas");
                auto pilas = std::find_if(inventory.begin(), inventory.end(),
                    [&](const InventoryEntry& value) { return static_cast<int>(value.itemIndex) == pilasIndex; });
                if (pilas != inventory.end()) {
                    radioBattery = std::min(100.0f, radioBattery + 50.0f);
                    inventoryWeight = std::max(0.0f, inventoryWeight - lootTable[pilas->itemIndex].weight);
                    if (--pilas->quantity == 0) inventory.erase(pilas);
                    ui.Notify("¡Pilas nuevas colocadas en la radio! (+50%)", ToastType::Info);
                }
            }
            if (float requestedVolume = 0.0f; ui.ConsumeRadioVolume(requestedVolume)) radioVolume = std::clamp(requestedVolume, 0.0f, 1.0f);
            const RadioProgram radioProgram = RadioProgramFromId(ui.SelectedRadioStationId());
            const float radioSignal = radioProgram == RadioProgram::None ? 0.0f : 1.0f;
            if (radioOn) {
                radioBattery = std::max(0.0f, radioBattery - dtClamped / 24.0f);
                if (radioBattery <= 0.0f) {
                    radioOn = false;
                    ui.Notify("La radio se quedó sin pilas.", ToastType::Warn);
                } else if (radioSignal > 0.4f) {
                    needs[5] = std::min(100.0f, needs[5] + dtClamped * 0.8f * radioSignal);   // escuchar radio sube el ánimo
                }
            }
            audio.UpdateRadio(radioOn && !ui.IsDeathScreenOpen(), radioProgram, radioSignal, radioVolume);
            const int batteriesIndex = gameData.ItemIndex("pilas");
            const bool hasBatteries = std::any_of(inventory.begin(), inventory.end(), [&](const InventoryEntry& value) {
                return static_cast<int>(value.itemIndex) == batteriesIndex && value.quantity > 0;
            });
            ui.SetRadioView({radioOn, radioBattery, radioVolume, radioSignal, hasBatteries});
        }
        const auto useInventoryItem = [&](size_t itemIndex) {
            auto entry = std::find_if(inventory.begin(), inventory.end(),
                [&](const InventoryEntry& value) { return value.itemIndex == itemIndex; });
            if (entry == inventory.end()) return;
            const Item& item = lootTable[entry->itemIndex];
            if (item.id == "radioTransistor") {
                ui.OpenRadioMenu(false);
                return;
            }
            if (!item.weapon.empty()) {   // las armas no se gastan: se sacan o se guardan
                equippedWeapon = equippedWeapon == item.weapon ? std::string{} : item.weapon;
                if (equippedWeapon.empty()) ui.Notify("Guardaste el " + item.name + ". Vuelves a los puños.", ToastType::Info);
                else { ui.Notify(item.name + " en la mano. Golpea con J: pega más y llega más lejos.", ToastType::Info); fightStanceRemaining = 4.0f; }
                audio.Play(AudioCue::Pickup);
                return;
            }
            if (item.id == "pilas") {
                if (radioBattery >= 100.0f) {
                    ui.Notify("La radio ya tiene la batería llena.", ToastType::Warn);
                    return;
                }
                radioBattery = std::min(100.0f, radioBattery + 50.0f);
                ui.Notify("¡Pilas nuevas colocadas en la radio! (+50%)", ToastType::Info);
            } else if (!applyItemEffect(item)) {
                return;
            }
            inventoryWeight = std::max(0.0f, inventoryWeight - item.weight);
            if (--entry->quantity == 0) inventory.erase(entry);
            audio.Play(AudioCue::Pickup);
        };
        const size_t useIndex = ui.ConsumeInventoryUseRequest();
        if (useIndex < lootTable.size()) useInventoryItem(useIndex);
        // Barra rapida: teclas 1-5 (o clic) usan el objeto; desde el inventario se asignan
        for (size_t slot = 0; slot < hotbar.size(); ++slot) {
            if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && playerInput.hotbarPressed[slot] && !hotbar[slot].empty()) {
                const int index = gameData.ItemIndex(hotbar[slot]);
                if (index >= 0) useInventoryItem(static_cast<size_t>(index));
            }
        }
        if (const int clicked = ui.ConsumeHotbarUseRequest(); clicked >= 0 && static_cast<size_t>(clicked) < hotbar.size() && !hotbar[static_cast<size_t>(clicked)].empty()) {
            const int index = gameData.ItemIndex(hotbar[static_cast<size_t>(clicked)]);
            if (index >= 0) useInventoryItem(static_cast<size_t>(index));
        }
        int assignSlot = 0;
        size_t assignItem = 0;
        if (ui.ConsumeHotbarAssign(assignSlot, assignItem) && assignItem < lootTable.size() && assignSlot >= 0 && assignSlot < 5) {
            const std::string& id = lootTable[assignItem].id;
            const bool alreadyThere = hotbar[static_cast<size_t>(assignSlot)] == id;
            for (std::string& slotId : hotbar) if (slotId == id) slotId.clear();
            if (!alreadyThere) hotbar[static_cast<size_t>(assignSlot)] = id;
        }
        {
            std::array<HotbarSlot, 5> hotbarView;
            for (size_t slot = 0; slot < hotbar.size(); ++slot) {
                const int index = hotbar[slot].empty() ? -1 : gameData.ItemIndex(hotbar[slot]);
                if (index < 0) continue;
                int quantity = 0;
                for (const auto& entry : inventory) if (entry.itemIndex == static_cast<size_t>(index)) quantity += entry.quantity;
                hotbarView[slot] = {hotbar[slot], lootTable[static_cast<size_t>(index)].name, quantity};
            }
            ui.SetHotbar(hotbarView);
        }
        const size_t dropIndex = ui.ConsumeInventoryDropRequest();
        if (dropIndex < lootTable.size()) {
            const int dropped = Economy::DropItem(session, gameData, dropIndex, ui.InventoryDropWasAll());
            if (dropped > 0) {
                PickupItem bag;
                bag.position = playerPos;
                bag.pendingLoot.assign(static_cast<size_t>(dropped), lootTable[dropIndex].id);
                simulation.RestorePickup(bag);
            }
        }
        if (ui.ConsumeInventorySortRequest()) {
            std::sort(inventory.begin(), inventory.end(), [&](const InventoryEntry& a, const InventoryEntry& b) {
                return lootTable[a.itemIndex].name < lootTable[b.itemIndex].name;
            });
        }
        const std::string talentRequest = ui.ConsumeTalentUnlockRequest();
        if (!talentRequest.empty()) {
            const auto talent = std::find_if(talentOptions.begin(), talentOptions.end(),
                [&](const TalentOption& option) { return option.id == talentRequest; });
            if (talent != talentOptions.end() && talent->available
                && unlockedTalents.insert(talentRequest).second) {
                talentPoints -= talent->cost;
                ui.SetSaveNotification("Talento aprendido: " + talent->name);
                ui.Notify("Talento: " + talent->name, ToastType::Rare);
            }
        }
        if (ui.ConsumePetRequest()) {
            if (simulation.PetDog()) {
                needs[5] = std::min(100.0f, needs[5] + 5.0f);
                ui.SetPickupNotification("El Chato mueve la cola. +5 de ánimo.");
            } else {
                ui.SetPickupNotification("El Chato necesita un momento antes de otra caricia.");
            }
        }
        companionName = ui.GetCompanionName();
        companionCoat = ui.GetCompanionCoat();
        companionIsFriend = simulation.IsDogFriend();
        companionPosition = simulation.GetDogPosition();

        CharacterLook changedLook;
        bool appearanceUpdated = false;
        if (characterCreatorUI.Render(characterPreview, changedLook, appearanceUpdated)) {
            characterManager.ApplyLook(changedLook, true);
            survivalSaveTimer = 5.0f; // Guardar partida al confirmar personaje
        } else if (appearanceUpdated) {
            characterManager.ApplyLook(changedLook, false);
        }

        // Menú del cambuche (refugio progresivo)
        {
            const auto countItem = [&](const std::string& id) {
                int qty = 0;
                for (const auto& entry : inventory) if (lootTable[entry.itemIndex].id == id) qty += entry.quantity;
                return qty;
            };
            const auto& cs = simulation.GetCambucheState();
            std::vector<CambuchePieceOption> cambuchePieces;
            for (const CambuchePieceDef& piece : gameData.cambuche) {
                const bool built = cambucheBuilt(piece.id);
                const bool locked = !piece.needs.empty() && !cambucheBuilt(piece.needs);
                bool enough = true;
                std::string requirements;
                for (const auto& need : piece.req) {
                    const int have = countItem(need.first);
                    enough = enough && have >= need.second;
                    const ItemDef* material = gameData.FindItem(need.first);
                    if (!requirements.empty()) requirements += ", ";
                    requirements += (material ? material->name : need.first) + " " + std::to_string(have) + " de " + std::to_string(need.second);
                }
                cambuchePieces.push_back({piece.id, piece.name, locked ? "Primero arma la base." : piece.desc,
                                          built || locked ? std::string{} : requirements, built, locked, !built && !locked && enough});
            }
            ui.RenderCambucheMenu(cambuchePieces, cs.base, simulation.IsNight());
        }

        ui.EndFrame();
        {   // vista previa 3D del cambuche en el recuadro del menu: un segundo renderizador pequeno, con su HDR y su tono, solo dentro de ese rectangulo
            glm::vec4 rect;
            if (!std::getenv("BAZUKO_SIN_PREVIA") && ui.GetCambuchePreviewRect(rect)) {
                if (!previewRenderer) previewRenderer = std::make_unique<Renderer>();
                int framebufferWidth = 0, framebufferHeight = 0;
                glfwGetFramebufferSize(glfwGetCurrentContext(), &framebufferWidth, &framebufferHeight);
                const ImVec2 display = ImGui::GetIO().DisplaySize;
                const float sx = display.x > 0.0f ? static_cast<float>(framebufferWidth) / display.x : 1.0f, sy = display.y > 0.0f ? static_cast<float>(framebufferHeight) / display.y : 1.0f;
                const int px = static_cast<int>(rect.x * sx), pw = std::max(1, static_cast<int>(rect.z * sx)), ph = std::max(1, static_cast<int>(rect.w * sy));
                const int py = framebufferHeight - static_cast<int>((rect.y + rect.w) * sy);
                previewRenderer->SetViewport(px, py, pw, ph);
                if (std::getenv("BAZUKO_LOG_PREVIA")) LogInfo("PREVIA rect ({}, {}, {}, {}) pantalla {}x{} escala {:.2f}", px, py, pw, ph, framebufferWidth, framebufferHeight, sx);
                previewRenderer->BeginScaledTarget();
                LightBlockData& light = previewRenderer->GetLighting();
                light = renderer.GetLighting();
                light.lampCount = 0;
                light.sunDir = glm::normalize(glm::vec3(-0.45f, -0.75f, -0.35f));   // luz de estudio calida desde arriba a la derecha
                light.sunColor = glm::vec3(1.0f, 0.88f, 0.70f) * 1.6f;
                light.ambientColor = glm::vec3(0.42f, 0.38f, 0.36f);
                light.fogDensity = 0.0f;
                light.fogColor = glm::vec3(0.07f, 0.06f, 0.05f);
                Camera previewCamera(32.0f, static_cast<float>(pw) / static_cast<float>(ph), 0.1f, 60.0f);
                const float turn = clock.GetElapsedTime() * 0.5f;
                previewCamera.LookAt(glm::vec3(std::sin(turn) * 6.2f, 3.4f, std::cos(turn) * 6.2f), glm::vec3(0.0f, 0.95f, 0.0f), glm::vec3(0.0f, 1.0f, 0.0f));
                previewRenderer->BeginScene(previewCamera, clock.GetElapsedTime());
                simulation.DrawShelterPreview(*previewRenderer, 0.0f);
                previewRenderer->EndScene();
                previewRenderer->EndScaledTarget();
                if (std::getenv("BAZUKO_LOG_PREVIA")) LogInfo("PREVIA glError {}", static_cast<int>(glGetError()));
                renderer.SetViewport(0, 0, framebufferWidth, framebufferHeight);
            }
        }


        if (shotPath && glfwGetTime() - shotStart > shotDelay) {
            if (std::getenv("BAZUKO_BENCH")) LogInfo("BENCH {}", ui.PerformanceSummary());
            int shotWidth = 0, shotHeight = 0;
            glfwGetFramebufferSize(glfwGetCurrentContext(), &shotWidth, &shotHeight);
            std::vector<uint8_t> pixels(static_cast<size_t>(shotWidth) * shotHeight * 3), flipped(pixels.size());
            glReadBuffer(GL_BACK);
            glPixelStorei(GL_PACK_ALIGNMENT, 1);
            glReadPixels(0, 0, shotWidth, shotHeight, GL_RGB, GL_UNSIGNED_BYTE, pixels.data());
            for (int y = 0; y < shotHeight; ++y)
                std::copy_n(&pixels[static_cast<size_t>(shotHeight - 1 - y) * shotWidth * 3], static_cast<size_t>(shotWidth) * 3, &flipped[static_cast<size_t>(y) * shotWidth * 3]);
            WritePngRgb(shotPath, shotWidth, shotHeight, flipped);
            LogInfo("Captura guardada en {}", shotPath);
            glfwSetWindowShouldClose(glfwGetCurrentContext(), GLFW_TRUE);
        }
        window.SwapBuffers();

        if (ui.ConsumeRespawnRequest()) {
            constexpr glm::vec2 shelterPosition{112.98f, 94.64f};
            glm::vec2 respawnPosition{};
            float nearestRespawnDistance = std::numeric_limits<float>::infinity();
            bool foundRespawnPosition = false;
            for (int tileZ = 1; tileZ < CityLayout::HEIGHT - 1; ++tileZ) {
                for (int tileX = 1; tileX < CityLayout::WIDTH - 1; ++tileX) {
                    const glm::vec2 candidate(
                        static_cast<float>(tileX) * CityLayout::TILE_SIZE
                            - CityLayout::ORIGIN_X
                            + CityLayout::TILE_SIZE * 0.5f,
                        static_cast<float>(tileZ) * CityLayout::TILE_SIZE
                            - CityLayout::ORIGIN_Z
                            + CityLayout::TILE_SIZE * 0.5f);
                    if (!city.IsSidewalk(candidate.x, candidate.y)
                        || city.IsBlocked(candidate.x, candidate.y, 0.4f)
                        || simulation.IsBlocked({candidate.x, 0.0f, candidate.y}, 0.4f)) continue;
                    const float distance = glm::distance(candidate, shelterPosition);
                    if (distance >= nearestRespawnDistance) continue;
                    nearestRespawnDistance = distance;
                    respawnPosition = candidate;
                    foundRespawnPosition = true;
                }
            }
            if (!foundRespawnPosition) {
                LogError("No se encontró un andén libre para recuperar al jugador.");
                continue;
            }
            const size_t typesToLose = inventory.size() / 2;
            inventory.erase(inventory.begin(), inventory.begin() + static_cast<std::ptrdiff_t>(typesToLose));
            inventoryWeight = 0.0f;
            for (const auto& entry : inventory) {
                inventoryWeight += lootTable[entry.itemIndex].weight * static_cast<float>(entry.quantity);
            }
            for (float& need : needs) need = std::max(60.0f, need);
            diseases.clear();
            playerPos = placeSafely({respawnPosition.x, 0.0f, respawnPosition.y});
            playerOnDeck = false;
            playerYaw = 0.0f;
            playerKnockedDown = false;
            knockdownRemaining = 0.0f;
            vehicleImpactCooldown = 1.5f;
            deathByVehicleImpact = false;
            ui.CompleteDeathRecovery();
            saveGame("Volviste al cambuche. Salud recuperada; partida guardada.");
        }

        if (ui.ConsumeSaveRequest()) {
            saveGame("Partida guardada con éxito");
        }

        if (ui.ConsumeNewGameRequest()) {
            startNewGame();
        }

        if (ui.ConsumeQuitRequest()) {
            saveGame("Guardando partida...");
            // Mostrar pantalla de cierre con mensaje de guardado
            ui.RenderQuitScreen(window);
            // Breve espera para que el usuario vea el mensaje
            double quitStart = glfwGetTime();
            while (glfwGetTime() - quitStart < 1.5) {
                ui.RenderQuitScreen(window);
            }
            break; // Salir del bucle principal
        }

        if (!ui.IsDeathScreenOpen()) {
            survivalSaveTimer += dt;
            if (survivalSaveTimer >= 5.0f) {
                saveGame("Partida guardada");
            }
        }
    }

    Input::Shutdown();
    LogInfo("Cerrando aplicacion con normalidad.");
    return 0;
}

#if defined(_WIN32)
int WINAPI WinMain(HINSTANCE, HINSTANCE, LPSTR, int) {
    return main(__argc, __argv);
}
#endif
