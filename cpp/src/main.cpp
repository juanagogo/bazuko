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
#include "game/PlayerState.hpp"
#include "world/SafeSpawn.hpp"
#include "world/Atmosphere.hpp"
#include "world/Viaduct.hpp"
#include "world/StarField.hpp"
#include "core/ScreenshotPng.hpp"
#include "core/AdaptiveResolution.hpp"
#include "game/Harvest.hpp"
#include "audio/AudioManager.hpp"
#include "world/CityLayout.hpp"
#include "world/Simulation.hpp"
#include "character/CharacterManager.hpp"
#include "character/Ragdoll.hpp"
#include "ui/CharacterCreatorUI.hpp"

#include <GLFW/glfw3.h>
#include <imgui.h>
#include <glm/gtc/matrix_transform.hpp>
#include <cmath>
#include <filesystem>
#include <array>
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

    CityLayout city([&](size_t completed, size_t total, const std::string& stage) {
        const float progress = 0.06f + 0.22f * static_cast<float>(completed) / static_cast<float>(total);
        ui.RenderLoadingScreen(window, progress, stage,
                               "💡 Consejo: Puedes alternar entre vista en tercera persona e isométrica con la tecla [V].");
    });

    CharacterManager characterManager;
    Ragdoll playerRagdoll;
    CharacterCreatorUI characterCreatorUI;
    CharacterPreview characterPreview;

    Simulation simulation(city, 42, [&](size_t completed, size_t total, const std::string& name) {
        const float progress = 0.28f + 0.47f * static_cast<float>(completed) / static_cast<float>(total);
        const std::string stage = "Cargando mundo urbano (" + std::to_string(completed)
            + "/" + std::to_string(total) + "): " + (name.empty() ? "elementos 3D" : name) + "...";
        ui.RenderLoadingScreen(window, progress, stage,
                               "💡 Consejo: Cuida tus niveles de hambre, sed y salud para no enfermarte.");
    });
    audio.SetRaining(simulation.IsRaining());

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
    glm::vec3 playerPos = city.GetSpawnPoint();
    playerPos.y = 0.0f;
    bool knockedOnDeck = false;  // la caida empezo sobre el tablero: se levanta alli
    StarField starField;
    float starVisibility = 0.0f;   // 0..1: las estrellas aparecen al oscurecer y con el cielo despejado
    bool playerOnDeck = false;   // sobre el tablero del viaducto (capa elevada); en la calle pasa por debajo
    // Regla estricta: el jugador nunca aparece ni se carga dentro de un edificio, un modelo o un recinto sin salida.
    // Toda posicion que se le asigna (inicio, partida guardada, partida nueva, recuperacion, fin de una caida)
    // pasa por aqui: si esta bloqueada o encerrada se mueve al lugar libre con salida mas cercano.
    const auto isFreeForPlayer = [&](float x, float z) {
        return city.IsWalkable(x, z) && !simulation.IsBlocked({x, 0.0f, z}, 0.5f);
    };
    // Donde se puede pisar segun la capa: sobre el tablero solo entre las barandas (y el bus elevado); en la calle,
    // el mapa, los vehiculos y el muro bajo de la rampa
    const auto canStand = [&](float x, float z) {
        if (playerOnDeck) return !Viaduct::BlockedOnDeck(x, z, 0.35f) && !simulation.IsBlocked({x, playerPos.y, z}, 0.35f);
        return city.IsWalkable(x, z) && !Viaduct::BlockedOnGround(x, z) && !simulation.IsBlocked({x, 0.0f, z}, 0.35f);
    };
    const auto placeSafely = [&](const glm::vec3& wanted) {
        glm::vec3 safe = FindSafePlayerPosition(wanted, isFreeForPlayer, city.GetSpawnPoint());
        safe.y = city.GetGroundHeight(safe.x, safe.z);
        if (glm::distance(glm::vec2(safe.x, safe.z), glm::vec2(wanted.x, wanted.z)) > 0.05f)
            LogWarn("Posicion del jugador bloqueada ({:.1f}, {:.1f}): se movio a ({:.1f}, {:.1f})", wanted.x, wanted.z, safe.x, safe.z);
        return safe;
    };
    playerPos = placeSafely(playerPos);
    float playerYaw = 0.0f;
    bool playerKnockedDown = false;
    float knockdownRemaining = 0.0f;
    float vehicleImpactCooldown = 0.0f;
    bool deathByVehicleImpact = false;
    float poopCooldown = 0.0f;
    float poopAnimationRemaining = 0.0f;
    bool boostActive = false;
    float boostTimer = 0.0f;
    // Objetos, tienda, botin y talentos vienen de assets/data/game-data.json (generado desde src/data del juego web).
    // El orden de los objetos es fijo: las partidas guardadas guardan su indice.
    const GameData& gameData = GameData::Get();
    using Item = ItemDef;
    const std::vector<Item>& lootTable = gameData.items;
    std::vector<InventoryEntry> inventory;
    float inventoryWeight = 0.0f;
    float money = 0.0f;
    int xp = 0;
    int level = 1;
    int talentPoints = 0;
    bool bigSack = false;   // Costal grande comprado en la tienda
    float playerWetness = 0.0f;    // 0 seco .. 1 empapado: la lluvia moja, el tiempo seca; no se guarda
    float coldCheckTimer = 0.0f;
    bool radioOn = false;          // radio transistor: encendida, volumen propio y bateria (100 % dura unos 40 min)
    float radioVolume = 0.7f;
    float radioBattery = 100.0f;
    int graphicsQuality = 1;   // 0 baja, 1 media, 2 alta: escala de resolucion interna 0,75 / 1 / 1,25
    glm::vec3 playerVelocity{0.0f};   // inercia de movimiento (como Player.js: 22/s al moverse, 18/s al frenar)
    std::array<std::string, 5> hotbar{};   // objetos de la barra de acceso rapido (teclas 1-5)
    bool sorting = false;   // manteniendo Q sobre una bolsa
    float sortProgress = 0.0f;
    glm::vec3 sortPosition{0.0f};
    std::unordered_set<std::string> unlockedTalents;
    std::string companionName = "El Chato";
    int companionCoat = 0;
    bool companionIsFriend = false;
    glm::vec3 companionPosition = simulation.GetDogPosition();
    int itemsCollected = 0;
    int itemsSold = 0;
    size_t missionProgress = 0;
    std::array<float, 7> needs{100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 80.0f};
    const auto knockDownPlayer = [&](float impactSpeed, const glm::vec3& impactDirection) {
        const float damage = std::min(100.0f, std::max(4.0f,
            std::round(0.6f * impactSpeed * impactSpeed + 1.5f * impactSpeed)));
        needs[3] = std::max(0.0f, needs[3] - damage);
        needs[2] = std::max(0.0f, needs[2] - damage * 0.25f);
        vehicleImpactCooldown = 1.5f;
        if (needs[3] <= 0.0f) deathByVehicleImpact = true;
        playerKnockedDown = true;
        knockdownRemaining = 1.8f;
        const glm::vec3 impactVelocity = impactDirection * std::max(2.0f, impactSpeed * 0.8f)
            + glm::vec3(0.0f, std::max(2.0f, impactSpeed * 0.55f), 0.0f);
        // sobre el tablero cae sobre el tablero (contenido por las barandas); en la calle, sobre la calzada
        knockedOnDeck = playerOnDeck;
        playerRagdoll.SetSurface(playerOnDeck ? playerPos.y : 0.0f, playerOnDeck ? Viaduct::kWalkHalfWidth : 0.0f);
        playerRagdoll.Begin(playerPos, playerYaw, impactVelocity, characterManager.GetLook());
        ui.SetPickupNotification("¡Atropellamiento! Recupera salud y espera a que termine la caída.");
    };
    std::string objective = "Recoge 5 objetos para empezar";
    struct DiseaseState { std::string id; float remaining; float healthDrain; float mentalDrain; };
    std::vector<DiseaseState> diseases;
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
        ui.ShowDeathScreen(summary, deathByVehicleImpact);
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
        return InventoryCapacity(gameData, unlockedTalents, bigSack);
    };
    const auto awardXp = [&](int amount, float activityMultiplier = 1.0f) {
        const float talentMultiplier = talentEffect("xpMult");
        xp += static_cast<int>(std::round(static_cast<float>(amount) * activityMultiplier * talentMultiplier));
        while (xp >= 100 * level) {
            xp -= 100 * level;
            ++level;
            ++talentPoints;
            ui.Notify("¡Nivel " + std::to_string(level) + "! +1 punto de talento", ToastType::Rare);
        }
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

        CharacterLook defaultLook;
        characterManager.ApplyLook(defaultLook, true);
        characterCreatorUI.Open(characterManager.GetLook(), false);

        ui.SetSaveNotification("¡Partida nueva iniciada!");
        LogInfo("Partida nueva iniciada desde cero.");
    };
    const auto tryInfectFromPickup = [&](bool sortedBag = false) -> std::string {
        const float resistance = talentEffect("diseaseResist") * characterManager.GetDiseaseResistance()
            * (sortedBag ? talentEffect("sortDiseaseMult") : 1.0f);
        float chance = InfectionChance(sortedBag, resistance) * (needs[4] < 30.0f ? 1.5f : 1.0f);
        if (std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) >= chance) return {};

        const std::array<DiseaseState, 3> types{{
            {"gripe", 45.0f, 0.12f, 0.01f},
            {"infeccion", 54.0f, 0.216f, 0.02f},
            {"intoxicacion", 36.0f, 0.096f, 0.03f}
        }};
        const DiseaseState& type = types[static_cast<size_t>(std::uniform_int_distribution<int>(0, 2)(lootRandom))];
        if (std::none_of(diseases.begin(), diseases.end(),
                         [&](const DiseaseState& disease) { return disease.id == type.id; })) {
            diseases.push_back(type);
            return type.id;
        }
        return {};
    };
    const auto addLootById = [&](const std::string& id) {
        const auto item = std::find_if(lootTable.begin(), lootTable.end(),
            [&](const Item& entry) { return entry.id == id; });
        if (item == lootTable.end()) return false;
        const size_t itemIndex = static_cast<size_t>(item - lootTable.begin());
        if (inventoryWeight + item->weight > inventoryCapacity()) return false;
        auto entry = std::find_if(inventory.begin(), inventory.end(),
            [&](const InventoryEntry& value) { return value.itemIndex == itemIndex; });
        if (entry == inventory.end()) inventory.push_back({itemIndex, 1});
        else ++entry->quantity;
        inventoryWeight += item->weight;
        return true;
    };
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
    const auto inventoryCount = [&](const std::string& id) {
        int count = 0;
        for (const auto& entry : inventory) if (lootTable[entry.itemIndex].id == id) count += entry.quantity;
        return count;
    };
    const auto availableLootCount = [&](const std::string& id) {
        const auto item = std::find_if(lootTable.begin(), lootTable.end(),
            [&](const Item& entry) { return entry.id == id; });
        if (item == lootTable.end() || item->weight <= 0.0f) return 0;
        return std::max(0, static_cast<int>(std::floor(
            (inventoryCapacity() - inventoryWeight + 0.0001f) / item->weight)));
    };
    const auto isRecyclable = [](const Item& item) { return item.recyclable; };
    const auto applyItemEffect = [&](const Item& item) {
        if (item.consumableNeed >= 0) {
            const size_t needIndex = static_cast<size_t>(item.consumableNeed);
            needs[needIndex] = std::clamp(needs[needIndex] + item.amount, 0.0f, 100.0f);
            for (size_t need = 0; need < needs.size(); ++need)
                needs[need] = std::clamp(needs[need] + item.deltas[need], 0.0f, 100.0f);
            return true;
        }
        if (item.id == "vendaje" || item.id == "curita") {
            needs[3] = std::min(100.0f, needs[3] + (item.id == "curita" ? 15.0f : 30.0f));
            return true;
        }
        if (!item.cure.empty()) {
            const size_t before = diseases.size();
            std::erase_if(diseases, [&](const DiseaseState& disease) { return disease.id == item.cure; });
            if (diseases.size() == before) {
                ui.SetPickupNotification("Usaste " + item.name + "; no tenías " + item.cure + ".");
            } else {
                ui.SetPickupNotification(item.name + " curó " + item.cure + ".");
            }
            return true;
        }
        return false;
    };
    // Precio de la recicladora: adrenalina x1.2 y mejora de origen (Gota a gota +15 %)
    const auto recyclerMultiplier = [&]() {
        return (boostActive ? 1.2f : 1.0f) * characterManager.GetSellMultiplier();
    };
    const auto sellRecyclables = [&]() {
        int soldCount = 0;
        float earned = 0.0f;
        const float saleMultiplier = recyclerMultiplier();
        for (auto entry = inventory.begin(); entry != inventory.end();) {
            const Item& item = lootTable[entry->itemIndex];
            if (!isRecyclable(item)) {
                ++entry;
                continue;
            }
            earned += static_cast<float>(item.value * entry->quantity) * saleMultiplier;
            soldCount += entry->quantity;
            inventoryWeight -= item.weight * entry->quantity;
            entry = inventory.erase(entry);
        }
        if (soldCount == 0) {
            audio.Play(AudioCue::Empty);
            ui.SetPickupNotification("No tienes materiales reciclables para vender.");
            return false;
        }
        money += earned;
        itemsSold += soldCount;
        needs[5] = std::min(100.0f, needs[5] + 2.0f);
        awardXp(2 * soldCount);
        audio.Play(AudioCue::Sell);
        ui.SetPickupNotification("Vendiste " + std::to_string(soldCount) + " reciclables por $"
                                 + std::to_string(static_cast<int>(earned)) + " COP.");
        return true;
    };

    ui.RenderLoadingScreen(window, 0.99f, "Sincronizando semáforos, rutas de tráfico y entorno...", "");
    ui.RenderLoadingScreen(window, 1.0f, "¡Todo listo! Entrando a Bogotá...", "");
    // Verificacion visual: BAZUKO_SHOT=ruta.png guarda una captura tras BAZUKO_SHOT_DELAY s (por defecto 6) y cierra
    const char* shotPath = std::getenv("BAZUKO_SHOT");
    float shotDelay = 6.0f;
    if (const char* delay = std::getenv("BAZUKO_SHOT_DELAY")) shotDelay = static_cast<float>(std::atof(delay));
    if (shotPath) {
        const auto envFloat = [](const char* name, float fallback) { const char* v = std::getenv(name); return v ? static_cast<float>(std::atof(v)) : fallback; };
        camera.SetOrbit(envFloat("BAZUKO_YAW", camera.GetYaw()), envFloat("BAZUKO_PITCH", 0.22f), envFloat("BAZUKO_DIST", 5.5f));
    } else {
        ui.OpenDeveloperNote();
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
        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && !Input::IsCursorLocked() && !io.WantCaptureMouse) {
            if (Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_LEFT) || Input::IsMouseButtonPressed(GLFW_MOUSE_BUTTON_RIGHT)) {
                Input::SetCursorLocked(true);
            }
        }

        // Si el cursor está bloqueado (oculto) O si el usuario arrastra con click:
        bool shouldRotate = !ui.IsPaused() && !characterCreatorUI.IsOpen() && (Input::IsCursorLocked() ||
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
        bool isRunning = !ui.IsPaused() && (Input::IsKeyDown(GLFW_KEY_LEFT_SHIFT) || Input::IsKeyDown(GLFW_KEY_RIGHT_SHIFT));
        const float withdrawal = needs[6] < 20.0f ? (20.0f - needs[6]) * 5.0f : 0.0f;
        const bool highWithdrawal = withdrawal >= 50.0f;
        const bool criticalWithdrawal = withdrawal >= 80.0f;
        static bool wasInWithdrawal = false;
        if (withdrawal > 0.0f && !wasInWithdrawal) ui.Notify("Abstinencia: tu cuerpo pide consumir; vas más lento y el ánimo baja.", ToastType::Warn);
        wasInWithdrawal = withdrawal > 0.0f;
        const float psychosisSeverity = std::clamp((withdrawal - 50.0f) / 50.0f, 0.0f, 1.0f);
        float statusSpeedMultiplier = 1.0f;
        if (needs[5] < 30.0f) statusSpeedMultiplier *= 0.8f;
        if (needs[5] <= 0.0f) statusSpeedMultiplier *= 0.7f;
        if (needs[2] <= 0.0f) statusSpeedMultiplier *= 0.5f;
        if (withdrawal > 0.0f) {
            statusSpeedMultiplier *= 0.85f;
            if (criticalWithdrawal) statusSpeedMultiplier *= 0.75f;
            else if (highWithdrawal) statusSpeedMultiplier *= 0.88f;
        }
        if (boostActive) statusSpeedMultiplier *= 1.35f;
        float moveSpeed = (isRunning ? 6.0f : 3.0f) * statusSpeedMultiplier;

        glm::vec3 moveDir(0.0f);
        if (!ui.IsPaused() && camera.GetMode() == CameraMode::ThirdPerson) {
            float camYaw = camera.GetYaw();
            glm::vec3 forward = glm::normalize(glm::vec3(std::sin(camYaw), 0.0f, std::cos(camYaw)));
            glm::vec3 right = glm::normalize(glm::vec3(std::cos(camYaw), 0.0f, -std::sin(camYaw)));

            if (Input::IsKeyDown(GLFW_KEY_W)) moveDir -= forward;
            if (Input::IsKeyDown(GLFW_KEY_S)) moveDir += forward;
            if (Input::IsKeyDown(GLFW_KEY_A)) moveDir -= right;
            if (Input::IsKeyDown(GLFW_KEY_D)) moveDir += right;
        } else if (!ui.IsPaused()) {
            if (Input::IsKeyDown(GLFW_KEY_W)) moveDir += glm::vec3(-1.0f, 0.0f, -1.0f);
            if (Input::IsKeyDown(GLFW_KEY_S)) moveDir += glm::vec3( 1.0f, 0.0f,  1.0f);
            if (Input::IsKeyDown(GLFW_KEY_A)) moveDir += glm::vec3(-1.0f, 0.0f,  1.0f);
            if (Input::IsKeyDown(GLFW_KEY_D)) moveDir += glm::vec3( 1.0f, 0.0f, -1.0f);
        }

        float currentSpeed = 0.0f;
        if (playerKnockedDown) {
            knockdownRemaining = std::max(0.0f, knockdownRemaining - dt);
            playerRagdoll.Update(dt);
            playerPos = playerRagdoll.GetPlayerPosition();
            playerVelocity = glm::vec3(0.0f);
            if (knockdownRemaining <= 0.0f) {
                playerKnockedDown = false;
                float deckY = 0.0f;
                if (knockedOnDeck && Viaduct::StepLayer(true, playerPos.x, playerPos.z, deckY)) {
                    playerOnDeck = true;   // se levanta sobre el tablero
                    playerPos.y = deckY;
                } else {
                    playerOnDeck = false;
                    playerPos = placeSafely(playerPos);   // la caida no puede dejarlo dentro de un modelo
                }
                playerRagdoll.SetSurface(0.0f);
            }
        } else if (const bool moving = glm::length(moveDir) > 0.001f; moving || glm::dot(playerVelocity, playerVelocity) > 0.0005f) {
            if (moving) moveDir = glm::normalize(moveDir);
            const glm::vec3 targetVelocity = moving ? moveDir * moveSpeed : glm::vec3(0.0f);
            const float accelerationRate = moving ? 22.0f : 18.0f;
            playerVelocity = glm::mix(playerVelocity, targetVelocity, 1.0f - std::exp(-accelerationRate * std::max(0.0f, dt)));
            if (!moving && glm::dot(playerVelocity, playerVelocity) < 0.0005f) playerVelocity = glm::vec3(0.0f);
            currentSpeed = glm::length(playerVelocity);

            glm::vec3 nextPos = playerPos + playerVelocity * dt;
            float impactSpeed = 0.0f;
            glm::vec3 impactDirection(0.0f);
            if (vehicleImpactCooldown <= 0.0f && needs[3] > 0.0f
                && simulation.GetVehicleImpact(nextPos, impactSpeed, impactDirection)) {
                knockDownPlayer(impactSpeed, impactDirection);
            } else if (canStand(nextPos.x, nextPos.z)) {
                playerPos.x = nextPos.x;
                playerPos.z = nextPos.z;
            } else if (canStand(nextPos.x, playerPos.z)) {
                playerPos.x = nextPos.x;
            } else if (canStand(playerPos.x, nextPos.z)) {
                playerPos.z = nextPos.z;
            }
            // capa: se sube al tablero solo por la rampa y se baja al salir por un extremo; la altura sigue al tablero
            playerOnDeck = Viaduct::StepLayer(playerOnDeck, playerPos.x, playerPos.z, playerPos.y);
            if (!playerOnDeck) playerPos.y = city.GetGroundHeight(playerPos.x, playerPos.z);   // la isla de la estacion se sube por sus rampas

            if (moving) playerYaw = std::atan2(moveDir.x, moveDir.z);
        }
        audio.Update(currentSpeed > 0.25f, isRunning);

        const float dtClamped = std::max(0.0f, dt);
        begCooldownRemaining = std::max(0.0f, begCooldownRemaining - dtClamped);
        const float hungerAndThirstDecay = talentEffect("decayMult");
        needs[0] = std::max(0.0f, needs[0] - (100.0f / 7200.0f) * dtClamped * hungerAndThirstDecay);
        needs[1] = std::max(0.0f, needs[1] - (100.0f / 5400.0f) * dtClamped * hungerAndThirstDecay);
        needs[2] = std::max(0.0f, needs[2] - (100.0f / 5400.0f) * dtClamped - (isRunning && currentSpeed > 0.0f ? 0.01f * dtClamped : 0.0f));
        needs[4] = std::max(0.0f, needs[4] - (100.0f / 21600.0f) * dtClamped);
        needs[6] = std::max(0.0f, needs[6] - (60.0f / 7200.0f) * dtClamped);
        // Lluvia: moja al jugador (empapado en ~45 s con lluvia fuerte), lo lava un poco y, si sigue mojado,
        // puede resfriarse; con el tiempo se seca
        {
            const float rain = simulation.GetRainIntensity();
            const bool wasSoaked = playerWetness >= 0.7f;
            if (rain > 0.1f) {
                playerWetness = std::min(1.0f, playerWetness + dtClamped * rain / 45.0f);
                needs[4] = std::min(100.0f, needs[4] + 0.03f * rain * dtClamped);
            } else {
                playerWetness = std::max(0.0f, playerWetness - dtClamped / 120.0f);
            }
            if (!wasSoaked && playerWetness >= 0.7f) ui.Notify("Estás empapado por la llovizna. Busca resguardo o te resfriarás.", ToastType::Warn);
            if (playerWetness >= 0.6f) {
                coldCheckTimer += dtClamped;
                if (coldCheckTimer >= 20.0f) {
                    coldCheckTimer = 0.0f;
                    const float chance = 0.04f * (simulation.IsNight() ? 1.6f : 1.0f) * talentEffect("diseaseResist")
                        * characterManager.GetDiseaseResistance();
                    const bool hasCold = std::any_of(diseases.begin(), diseases.end(), [](const DiseaseState& disease) { return disease.id == "gripe"; });
                    if (!hasCold && std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) < chance) {
                        diseases.push_back({"gripe", 45.0f, 0.12f, 0.01f});
                        ui.Notify("Te resfriaste por la lluvia: tienes gripe.", ToastType::Warn);
                    }
                }
            } else {
                coldCheckTimer = 0.0f;
            }
        }
        float healthDrain = 0.0f;
        float mentalDrain = 0.0f;
        for (auto disease = diseases.begin(); disease != diseases.end();) {
            healthDrain += disease->healthDrain;
            mentalDrain += disease->mentalDrain;
            disease->remaining -= dtClamped;
            if (disease->remaining <= 0.0f) disease = diseases.erase(disease); else ++disease;
        }
        float moodDecay = 100.0f / 10800.0f
            + (simulation.IsNight() ? 100.0f / 21600.0f : 0.0f) + mentalDrain;
        if (needs[0] < 30.0f) moodDecay *= 1.5f;
        if (needs[1] < 30.0f) moodDecay *= 1.5f;
        if (needs[2] < 30.0f) moodDecay *= 1.3f;
        if (withdrawal > 0.0f) {
            moodDecay *= 1.5f;
            if (criticalWithdrawal) moodDecay *= 2.2f;
            else if (highWithdrawal) moodDecay *= 1.6f;
        }
        needs[5] = std::max(0.0f, needs[5] - moodDecay * dtClamped * talentEffect("mentalDecayMult"));

        if (needs[0] <= 0.0f) healthDrain += 100.0f / 1800.0f;
        if (needs[1] <= 0.0f) healthDrain += 100.0f / 1200.0f;
        needs[3] = std::max(0.0f, needs[3] - healthDrain * dtClamped);
        ApplyHealthRegeneration(needs, withdrawal, healthDrain, dtClamped);

        // Actualización de Boost (Adrenalina)
        if (boostActive && dtClamped > 0.0f) {
            boostTimer = std::max(0.0f, boostTimer - dtClamped);
            needs[3] = std::max(0.0f, needs[3] - 3.0f * dtClamped);
            if (boostTimer <= 0.0f || needs[3] <= 5.0f) {
                boostActive = false;
                boostTimer = 0.0f;
                ui.SetPickupNotification("La adrenalina se ha agotado.");
            }
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
        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_Q)) {
            if (simulation.IsNearDealer(playerPos, 2.2f)) {
                ui.OpenDealerMenu();
            } else {
                const size_t pedestrian = simulation.GetNearbyPedestrian(playerPos, 1.8f);
                if (pedestrian < simulation.GetPedestrianCount()) {
                const RobberyOutcome outcome = simulation.RobPedestrian(pedestrian, true, playerPos);
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
        if (sorting) {
            const bool canSort = !ui.IsPaused() && !characterCreatorUI.IsOpen() && !ui.IsDeathScreenOpen();
            if (!canSort || glm::distance(playerPos, sortPosition) > 2.2f) {
                sorting = false;
                sortProgress = 0.0f;
            } else if (Input::IsKeyDown(GLFW_KEY_Q)) {
                sortProgress = std::min(kSortSeconds, sortProgress + std::max(0.0f, dt));
            } else {
                const bool complete = sortProgress >= kSortSeconds;
                sorting = false;
                sortProgress = 0.0f;
                harvestNearbyPickup(2.2f, complete);
            }
        }
        if (!ui.IsPaused() && Input::IsKeyPressed(GLFW_KEY_F)) {
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
        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && (Input::IsKeyPressed(GLFW_KEY_B) || Input::IsKeyPressed(GLFW_KEY_L))) {
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
        if (!ui.IsPaused() && Input::IsKeyPressed(GLFW_KEY_E)) {
            size_t carIndex = simulation.GetNearbyCar(playerPos, 2.0f);
            size_t parkedCarIndex = simulation.GetNearbyParkedCar(playerPos, 2.0f);
            const size_t vendorIndex = simulation.GetNearbyVendor(playerPos, 2.0f);
            size_t pedestrianIndex = simulation.GetNearbyPedestrian(playerPos, 1.8f);
            bool nearShop = simulation.IsNearShop(playerPos, 2.2f);
            if (simulation.IsNearMissionNpc(playerPos, 2.0f) && !simulation.IsMissionStarted() && !simulation.IsMissionComplete()) {
                simulation.StartMission();
            } else if (simulation.IsNearDog(playerPos, 2.0f)) {
                if (simulation.IsDogFriend()) {
                    if (simulation.PetDog()) {
                        needs[5] = std::min(100.0f, needs[5] + 5.0f);
                        ui.SetPickupNotification("El Chato mueve la cola. +5 de ánimo.");
                    } else ui.SetPickupNotification("El Chato ya recibió sus caricias por ahora.");
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
                    audio.PlayTheftRemark(2.0f);
                    const bool caught = std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom)
                        < 0.25f * talentEffect("stealCaughtMult");
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
                audio.PlayTheftRemark(2.0f);
                const float caughtChance = 0.25f * talentEffect("stealCaughtMult");
                const bool caught = std::uniform_real_distribution<float>(0.0f, 1.0f)(lootRandom) < caughtChance;
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
            auto countItem = [&](const std::string& id) {
                int quantity = 0;
                for (const auto& entry : inventory) if (lootTable[entry.itemIndex].id == id) quantity += entry.quantity;
                return quantity;
            };
            std::string resultId;
            std::array<std::pair<std::string, int>, 3> ingredients;
            if (craftRequest == "radioTransistor" && countItem("chatarra") >= 1 && countItem("cable") >= 2 && countItem("pilas") >= 1 && inventoryWeight + 0.6f <= inventoryCapacity()) {
                resultId = "radioTransistor";
                ingredients = {{{"chatarra", 1}, {"cable", 2}, {"pilas", 1}}};
            } else if (craftRequest == "antibiotico" && countItem("pastilla") >= 1 && countItem("botella") >= 1 && inventoryWeight + 0.1f <= inventoryCapacity()) {
                resultId = "antibiotico";
                ingredients = {{{"pastilla", 1}, {"botella", 1}, {"", 0}}};
            } else if (craftRequest == "arma" && countItem("chatarra") >= 2 && countItem("alambre") >= 1 && countItem("madera") >= 1 && inventoryWeight + 1.2f <= inventoryCapacity()) {
                resultId = "arma";
                ingredients = {{{"chatarra", 2}, {"alambre", 1}, {"madera", 1}}};
            } else if (craftRequest == "mochila" && countItem("tela") >= 3 && countItem("alambre") >= 1 && inventoryWeight + 0.8f <= inventoryCapacity()) {
                resultId = "mochila";
                ingredients = {{{"tela", 3}, {"alambre", 1}, {"", 0}}};
            } else if (craftRequest == "curita" && countItem("tela") >= 1 && countItem("plastico") >= 1 && inventoryWeight + 0.1f <= inventoryCapacity()) {
                resultId = "curita";
                ingredients = {{{"tela", 1}, {"plastico", 1}, {"", 0}}};
            } else if (craftRequest == "rifa" && countItem("carton") >= 2 && countItem("lata") >= 1 && inventoryWeight + 0.05f <= inventoryCapacity()) {
                resultId = "rifa";
                ingredients = {{{"carton", 2}, {"lata", 1}, {"", 0}}};
            }
            if (!resultId.empty()) {
                for (const auto& [id, quantity] : ingredients) {
                    for (int removed = 0; removed < quantity; ++removed) {
                        auto entry = std::find_if(inventory.begin(), inventory.end(), [&](const InventoryEntry& item) { return lootTable[item.itemIndex].id == id; });
                        if (entry != inventory.end()) {
                            inventoryWeight -= lootTable[entry->itemIndex].weight;
                            if (--entry->quantity == 0) inventory.erase(entry);
                        }
                    }
                }
                size_t resultIndex = static_cast<size_t>(std::find_if(lootTable.begin(), lootTable.end(), [&](const Item& item) { return item.id == resultId; }) - lootTable.begin());
                auto result = std::find_if(inventory.begin(), inventory.end(), [&](const InventoryEntry& entry) { return entry.itemIndex == resultIndex; });
                const int resultQuantity = resultId == "curita" ? 2 : 1;
                if (result == inventory.end()) inventory.push_back({resultIndex, resultQuantity}); else result->quantity += resultQuantity;
                inventoryWeight += lootTable[resultIndex].weight;
                awardXp(10);
                audio.Play(AudioCue::Treasure);
                ui.Notify("Crafteado: " + lootTable[resultIndex].name + " ×" + std::to_string(resultQuantity), ToastType::Info);
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
            simulation.SetDayProgress(0.30f);               // Avanza al día siguiente
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
        simulation.Update(dt, playerPos);
        poopCooldown = std::max(0.0f, poopCooldown - dt);
        poopAnimationRemaining = std::max(0.0f, poopAnimationRemaining - dt);
        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && !playerKnockedDown
            && (Input::IsKeyPressed(GLFW_KEY_Z) || Input::IsKeyPressed(GLFW_KEY_X))) {
            const bool throwPressed = Input::IsKeyPressed(GLFW_KEY_X) && inventoryCount("popo") > 0;
            if (throwPressed) {
                auto poop = std::find_if(inventory.begin(), inventory.end(),
                    [&](const InventoryEntry& entry) { return lootTable[entry.itemIndex].id == "popo"; });
                const float yaw = camera.GetMode() == CameraMode::ThirdPerson ? camera.GetYaw() : playerYaw;
                const float facingSign = camera.GetMode() == CameraMode::ThirdPerson ? -1.0f : 1.0f;
                const glm::vec3 direction(facingSign * std::sin(yaw), 0.0f, facingSign * std::cos(yaw));
                if (poop != inventory.end() && simulation.ThrowPoop(playerPos, direction)) {
                    inventoryWeight = std::max(0.0f, inventoryWeight - lootTable[poop->itemIndex].weight);
                    if (--poop->quantity <= 0) inventory.erase(poop);
                    ui.SetPickupNotification("Lanzaste un mojón. Si impacta a un peatón, obtienes experiencia.");
                }
            } else if (poopCooldown <= 0.0f) {
                poopCooldown = 2.2f;
                poopAnimationRemaining = 0.8f;
                simulation.DropPoop(playerPos);
                needs[0] = std::max(0.0f, needs[0] - 2.0f);
                needs[4] = std::max(0.0f, needs[4] - 3.0f);
                if (!addLootById("popo")) {
                    ui.SetPickupNotification("Hiciste popó, pero el costal está lleno.");
                } else {
                    ui.SetPickupNotification("Hiciste popó. El mojón queda listo para lanzarlo con X.");
                }
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
        if (const int weatherChange = simulation.ConsumeWeatherChange(); weatherChange != 0) {
            static const char* const weatherMessages[] = {
                "", "Comienza a lloviznar en el centro de Bogotá…", "La llovizna cesa sobre los cerros orientales.",
                "Una neblina baja cubre el centro de la ciudad…", "La neblina se disipa."};
            ui.Notify(weatherMessages[weatherChange], ToastType::Info);
        }
        audio.UpdateVehicleAudio(dt, playerPos, simulation, ui.IsPaused());

        // 7. Actualizar cámara
        camera.Follow(playerPos, dt, currentSpeed, isRunning);

        // 8. Renderizado 3D con OpenGL 4.5 DSA
        {
            static const std::array<float, 3> renderScales{0.75f, 1.0f, 1.25f};
            if (const int requested = ui.ConsumeGraphicsQualityRequest(); requested >= 0 && requested <= 2 && requested != graphicsQuality) {
                graphicsQuality = requested;
                static const std::array<const char*, 3> qualityNames{"baja", "media", "alta"};
                ui.Notify(std::string("Calidad gráfica: ") + qualityNames[static_cast<size_t>(requested)], ToastType::Info);
            }
            ui.SetGraphicsQuality(graphicsQuality);
            // Resolucion adaptativa: la calidad elegida es el techo; si los FPS reales se mantienen bajos la escala baja
            // y se recupera sola, sin cambiar la preferencia guardada
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
            if (!ui.IsPaused() && frameMs < 1000.0f && adaptiveResolution.Sample(frameMs) && adaptiveResolution.ratio < renderScales[static_cast<size_t>(graphicsQuality)])
                ui.Notify("Resolución ajustada por rendimiento", ToastType::Warn);
            renderer.SetRenderScale(adaptiveResolution.ratio);
            ui.SetEffectiveRenderScale(adaptiveResolution.ratio, adaptiveResolution.pressure);
        }
        renderer.SetWetness(simulation.GetWetness());
        {   // luz y cielo segun la hora y el clima (la calidad baja solo conserva la hora)
            const bool reducedWeather = graphicsQuality == 0;
            const Atmosphere atmosphere = ComputeAtmosphere(simulation.GetHour(), reducedWeather ? 0.0f : simulation.GetRainIntensity(), reducedWeather ? 0.0f : simulation.GetMist());
            LightBlockData& lighting = renderer.GetLighting();
            lighting.sunColor = atmosphere.sunColor;
            lighting.ambientColor = atmosphere.ambientColor;
            lighting.fogColor = atmosphere.fogColor;
            lighting.fogDensity = atmosphere.fogDensity;
            // farolas: se encienden solas al oscurecer; solo las mas cercanas aportan luz
            lighting.lampCount = 0;
            if (atmosphere.lampPower > 0.01f) {
                const size_t lampBudget = graphicsQuality == 0 ? 12 : graphicsQuality == 1 ? 20 : static_cast<size_t>(LightBlockData::kMaxLampLights);
                for (const glm::vec4& lamp : simulation.GetNearestLampLights(playerPos, lampBudget, 110.0f)) {
                    lighting.lampPosition[lighting.lampCount] = glm::vec4(glm::vec3(lamp), 18.0f);
                    lighting.lampColor[lighting.lampCount] = glm::vec4(1.0f, 0.78f, 0.45f, 2.4f * atmosphere.lampPower * lamp.w);
                    ++lighting.lampCount;
                }
            }
            simulation.SetLampGlow(atmosphere.lampPower);
            starVisibility = std::clamp((atmosphere.lampPower - 0.35f) / 0.5f, 0.0f, 1.0f)
                * (1.0f - std::min(1.0f, 0.85f * simulation.GetRainIntensity() + 0.9f * simulation.GetMist()));
            city.SetNightGlow(atmosphere.lampPower);
        }
        renderer.BeginScaledTarget();
        renderer.BeginScene(camera, clock.GetElapsedTime());

        // Renderizar ciudad de Bogotá
        city.Render(renderer, playerPos);
        simulation.Render(renderer, clock.GetElapsedTime(), playerPos);
        starField.Render(renderer, camera.GetPosition(), starVisibility, clock.GetElapsedTime());

        // Renderizar personaje
        {
            if (playerKnockedDown) {
                const float recovery = std::clamp((0.35f - knockdownRemaining) / 0.35f, 0.0f, 1.0f);
                const glm::mat4 playerModel = playerRagdoll.GetCharacterTransform(playerYaw, recovery);
                const float fallElapsed = 1.8f - knockdownRemaining;
                const int fallClip = characterManager.GetKnockdownAnimationClip(recovery > 0.0f);
                characterManager.Draw(renderer, playerModel, fallElapsed, false, false, fallClip);
            } else {
                glm::mat4 playerModel = glm::translate(glm::mat4(1.0f), playerPos);
                playerModel = glm::rotate(playerModel, playerYaw, glm::vec3(0.0f, 1.0f, 0.0f));
                const float crouchProgress = 1.0f - poopAnimationRemaining / 0.8f;
                const float crouchAmount = std::sin(glm::pi<float>() * std::clamp(crouchProgress, 0.0f, 1.0f));
                playerModel = glm::translate(playerModel, glm::vec3(0.0f, -0.06f * crouchAmount, 0.0f));
                playerModel = glm::rotate(playerModel, 0.12f * crouchAmount, glm::vec3(1.0f, 0.0f, 0.0f));
                playerModel = glm::scale(playerModel,
                    glm::vec3(1.0f, 1.0f - 0.07f * crouchAmount, 1.0f));
                characterManager.Draw(renderer, playerModel, clock.GetElapsedTime(), currentSpeed > 0.25f, isRunning);
            }
        }

        renderer.EndScene();
        renderer.EndScaledTarget();

        // 9. Interfaz gráfica (Dear ImGui)
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
        const std::vector<CraftingOption> craftingOptions{
            {"radioTransistor", "Radio transistor AM/FM x1", "Chatarra (" + std::to_string(inventoryCount("chatarra")) + "/1) · Cable (" + std::to_string(inventoryCount("cable")) + "/2) · Pilas (" + std::to_string(inventoryCount("pilas")) + "/1)", inventoryCount("chatarra") >= 1 && inventoryCount("cable") >= 2 && inventoryCount("pilas") >= 1 && inventoryWeight + 0.6f <= inventoryCapacity()},
            {"arma", "Arma casera x1", "Chatarra (" + std::to_string(inventoryCount("chatarra")) + "/2) · Alambre (" + std::to_string(inventoryCount("alambre")) + "/1) · Tablas (" + std::to_string(inventoryCount("madera")) + "/1)", inventoryCount("chatarra") >= 2 && inventoryCount("alambre") >= 1 && inventoryCount("madera") >= 1 && inventoryWeight + 1.2f <= inventoryCapacity()},
            {"mochila", "Mochila x1", "Tela (" + std::to_string(inventoryCount("tela")) + "/3) · Alambre (" + std::to_string(inventoryCount("alambre")) + "/1)", inventoryCount("tela") >= 3 && inventoryCount("alambre") >= 1 && inventoryWeight + 0.8f <= inventoryCapacity()},
            {"curita", "Curita x2", "Tela (" + std::to_string(inventoryCount("tela")) + "/1) · Plastico (" + std::to_string(inventoryCount("plastico")) + "/1)", inventoryCount("tela") >= 1 && inventoryCount("plastico") >= 1 && inventoryWeight + 0.1f <= inventoryCapacity()},
            {"antibiotico", "Antibiotico x1", "Pastilla (" + std::to_string(inventoryCount("pastilla")) + "/1) · Botella (" + std::to_string(inventoryCount("botella")) + "/1)", inventoryCount("pastilla") >= 1 && inventoryCount("botella") >= 1 && inventoryWeight + 0.1f <= inventoryCapacity()},
            {"rifa", "Carton de rifa x1", "Carton (" + std::to_string(inventoryCount("carton")) + "/2) · Lata (" + std::to_string(inventoryCount("lata")) + "/1)", inventoryCount("carton") >= 2 && inventoryCount("lata") >= 1 && inventoryWeight + 0.05f <= inventoryCapacity()},
            {"hierba", "Hierba seca x2", "Tela (" + std::to_string(inventoryCount("tela")) + "/1) · Tablas (" + std::to_string(inventoryCount("madera")) + "/1) · Resultado sin definir", false}
        };
        std::vector<InventoryOption> inventoryOptions;
        inventoryOptions.reserve(inventory.size());
        for (const auto& entry : inventory) {
            const Item& item = lootTable[entry.itemIndex];
            const auto hotbarSlot = std::find(hotbar.begin(), hotbar.end(), item.id);
            inventoryOptions.push_back({entry.itemIndex, item.id, item.name, entry.quantity, item.weight,
                item.consumableNeed >= 0 || !item.cure.empty() || item.id == "vendaje" || item.id == "curita"
                    || item.id == "pilas" || item.id == "radioTransistor",
                item.desc, DescribeItemEffects(item), item.rarityLabel,
                hotbarSlot == hotbar.end() ? -1 : static_cast<int>(hotbarSlot - hotbar.begin())});
        }
        std::vector<DealerOption> dealerOptions;
        for (const std::string& id : {std::string("tintico"), std::string("pegante"), std::string("pastilla")}) {
            const auto item = std::find_if(lootTable.begin(), lootTable.end(),
                [&](const Item& entry) { return entry.id == id; });
            if (item == lootTable.end()) continue;
            dealerOptions.push_back({item->id, item->name, item->value, money >= item->value,
                                     inventoryWeight + item->weight <= inventoryCapacity()});
        }
        std::vector<TalentOption> talentOptions;
        for (const TalentDef& definition : gameData.talents) {
            talentOptions.push_back({definition.id, definition.name, definition.desc,
                                     definition.prerequisites.empty() ? std::string{} : definition.prerequisites.front(), definition.cost});
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
            const auto entry = std::find_if(gameData.shop.begin(), gameData.shop.end(), [&](const ShopEntry& candidate) {
                return candidate.item == shopPurchase || (!candidate.upgrade.empty() && candidate.upgrade == shopPurchase);
            });
            if (entry == gameData.shop.end()) {
                LogWarn("El menu de la tienda solicito un producto desconocido: {}", shopPurchase);
            } else if (money < static_cast<float>(entry->price)) {
                ui.SetPickupNotification("No te alcanza para comprar eso.");
            } else if (!entry->upgrade.empty()) {
                if (!bigSack) {
                    bigSack = true;
                    money -= static_cast<float>(entry->price);
                    audio.Play(AudioCue::Pickup);
                    ui.SetPickupNotification("Compraste el " + entry->label + ": ahora cargas " + std::to_string(static_cast<int>(gameData.costalBonus)) + " kg más.");
                }
            } else if (const ItemDef* product = gameData.FindItem(entry->item); product == nullptr) {
                LogWarn("Producto sin objeto: {}", entry->item);
            } else if (inventoryWeight + product->weight * static_cast<float>(entry->qty) > inventoryCapacity()) {
                audio.Play(AudioCue::Full);
                ui.SetPickupNotification("No te cabe en el costal: " + product->name + ".");
            } else {
                for (int unit = 0; unit < entry->qty; ++unit) addLootById(product->id);
                money -= static_cast<float>(entry->price);
                audio.Play(AudioCue::Pickup);
                ui.SetPickupNotification("Compraste " + (entry->label.empty() ? product->name : entry->label) + ".");
            }
        }
        if (ui.ConsumeRecyclerSellRequest()) sellRecyclables();

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
            if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_1 + static_cast<int>(slot)) && !hotbar[slot].empty()) {
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
            auto entry = std::find_if(inventory.begin(), inventory.end(),
                [&](const InventoryEntry& value) { return value.itemIndex == dropIndex; });
            if (entry != inventory.end()) {
                const int dropped = ui.InventoryDropWasAll() ? entry->quantity : 1;
                PickupItem bag;
                bag.position = playerPos;
                bag.pendingLoot.assign(static_cast<size_t>(dropped), lootTable[dropIndex].id);
                simulation.RestorePickup(bag);
                inventoryWeight = std::max(0.0f, inventoryWeight - lootTable[dropIndex].weight * static_cast<float>(dropped));
                entry->quantity -= dropped;
                if (entry->quantity <= 0) inventory.erase(entry);
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
                    if (!requirements.empty()) requirements += " · ";
                    requirements += (material ? material->name : need.first) + " (" + std::to_string(have) + "/" + std::to_string(need.second) + ")";
                }
                cambuchePieces.push_back({piece.id, piece.name, locked ? "Primero arma la base." : piece.desc,
                                          built || locked ? std::string{} : requirements, built, locked, !built && !locked && enough});
            }
            ui.RenderCambucheMenu(cambuchePieces, cs.base, simulation.IsNight());
        }

        ui.EndFrame();


        if (shotPath && glfwGetTime() - shotStart > shotDelay) {
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
