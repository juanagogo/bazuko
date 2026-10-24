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
#include <nlohmann/json.hpp>

#if defined(_WIN32)
extern "C" {
__declspec(dllexport) unsigned long NvOptimusEnablement = 0x00000001;
__declspec(dllexport) int AmdPowerXpressRequestHighPerformance = 1;
}
#endif

namespace fs = std::filesystem;

int main(int argc, char** argv) {
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

    ui.RenderLoadingScreen(window, 0.10f, "Motor gráfico, audio e interfaz inicializados...",
                          "💡 Consejo: Rebusca en las bolsas de basura de la Séptima para conseguir reciclaje y comida.");

    CityLayout city;
    ui.RenderLoadingScreen(window, 0.25f, "Ciudad y edificios preparados...",
                          "💡 Consejo: Puedes alternar entre vista en tercera persona e isométrica con la tecla [V].");

    CharacterManager characterManager;
    Ragdoll playerRagdoll;
    CharacterCreatorUI characterCreatorUI;
    CharacterPreview characterPreview;
    ui.RenderLoadingScreen(window, 0.30f, "Preparando el personaje y su vista previa...",
                          "💡 Consejo: Puedes personalizar tu aspecto, sexo, corte y ropa con la tecla [P].");

    Simulation simulation(city, 42, [&](size_t completed, size_t total) {
        const float progress = 0.30f + 0.40f * static_cast<float>(completed) / static_cast<float>(total);
        const std::string stage = "Cargando modelos de peatones (" + std::to_string(completed)
            + "/" + std::to_string(total) + ")...";
        ui.RenderLoadingScreen(window, progress, stage,
                               "💡 Consejo: Cuida tus niveles de hambre, sed y salud para no enfermarte.");
    });
    audio.SetRaining(simulation.IsRaining());
    ui.RenderLoadingScreen(window, 0.75f, "Simulación urbana, peatones y tráfico preparados...",
                          "💡 Consejo: Cuida tus niveles de hambre, sed y salud para no enfermarte.");
    glm::vec3 playerPos = city.GetSpawnPoint();
    playerPos.y = 0.0f;
    float playerYaw = 0.0f;
    bool playerKnockedDown = false;
    float knockdownRemaining = 0.0f;
    float vehicleImpactCooldown = 0.0f;
    bool deathByVehicleImpact = false;
    float poopCooldown = 0.0f;
    float poopAnimationRemaining = 0.0f;
    struct Item {
        std::string id;
        std::string name;
        float weight;
        int value;
        int consumableNeed = -1;
        float amount = 0.0f;
        float healthDelta = 0.0f;
        bool substance = false;
        std::string cure;
        float moodDelta = 0.0f;
        float energyDelta = 0.0f;
    };
    const std::array<Item, 40> lootTable{{
        {"lata", "Lata vacía", 0.2f, 250}, {"botella", "Botella PET", 0.3f, 150},
        {"carton", "Cartón", 0.5f, 200}, {"chatarra", "Chatarra", 1.0f, 900},
        {"cable", "Cable cobre", 0.4f, 2400}, {"pan", "Pan duro", 0.3f, 1000, 0, 25.0f, 0.0f, false, "", 5.0f},
        {"agua", "Botella agua", 0.5f, 1500, 1, 35.0f}, {"reloj", "Reloj oxidado", 0.1f, 8000},
        {"vendaje", "Vendaje", 0.1f, 3000, 3, 30.0f}, {"antibiotico", "Antibiótico", 0.1f, 18000, -1, 0.0f, 0.0f, false, "infeccion"},
        {"madera", "Tablas", 2.0f, 1500}, {"pilas", "Pilas AA", 0.1f, 2000}, {"radioTransistor", "Radio transistor", 0.6f, 18000},
        {"retrovisor", "Retrovisor", 0.8f, 15000}, {"radio", "Radio de auto", 1.5f, 35000},
        {"tela", "Retazo de tela", 0.2f, 300}, {"pastilla", "Pastilla", 0.05f, 8000, 6, 60.0f, -5.0f, true, "", 40.0f},
        {"lona", "Lona azul", 2.0f, 4000}, {"colchon", "Colchón viejo", 6.0f, 5000}, {"vela", "Vela", 0.05f, 500},
        {"popo", "Mojón de popó", 0.3f, 50}, {"alambre", "Alambre", 0.1f, 500},
        {"plastico", "Plástico", 0.1f, 200}, {"mochila", "Mochila", 0.8f, 12000},
        {"arma", "Arma casera", 1.2f, 0}, {"curita", "Curita", 0.05f, 500},
        {"rifa", "Cartón de rifa", 0.05f, 1000},
        {"cafe", "Tinto", 0.25f, 2000, 2, 40.0f, 0.0f, false, "", 15.0f},
        {"lataComida", "Comida enlatada", 0.6f, 6000, 0, 40.0f, 0.0f, false, "", 8.0f},
        {"refresco", "Refresco", 0.4f, 3500, 1, 30.0f, 0.0f, false, "", 10.0f, 10.0f},
        {"tintico", "Tintico", 0.1f, 1000, 6, 20.0f, 0.0f, true, "", 15.0f, 20.0f},
        {"pegante", "Pegante", 0.2f, 3000, 6, 40.0f, -3.0f, true, "", 25.0f},
        {"cigarrillo", "Cigarrillo suelto", 0.01f, 500, 6, 35.0f, -1.0f},
        {"jabon", "Jabón", 0.2f, 3500, 4, 40.0f},
        {"cepillo", "Cepillo", 0.1f, 3000, 4, 20.0f},
        {"vacuna", "Vacuna", 0.1f, 20000, -1, 0.0f, 0.0f, false, "tetanos"},
        {"carbon", "Carbón activo", 0.1f, 9000, -1, 0.0f, 0.0f, false, "intoxicacion"},
        {"jarabe", "Jarabe", 0.2f, 11000, -1, 0.0f, 0.0f, false, "gripe"},
        {"pomada", "Pomada", 0.15f, 9500, -1, 0.0f, 0.0f, false, "sarna"},
        {"antiparasitario", "Antiparasitario", 0.1f, 13000, -1, 0.0f, 0.0f, false, "parasitos"}
    }};
    const std::array<Item, 20> shopCatalog{{
        {"pan", "Pan duro", 0.3f, 1000, 0, 25.0f, 0.0f, false, "", 5.0f}, {"agua", "Botella agua", 0.5f, 1500, 1, 35.0f},
        {"vendaje", "Vendaje", 0.1f, 3000, 3, 30.0f}, {"madera", "Tablas", 2.0f, 1500},
        {"tela", "Retazo de tela", 0.2f, 300}, {"pilas", "Pilas AA", 0.1f, 2000},
        {"cafe", "Tinto", 0.25f, 2000, 2, 40.0f, 0.0f, false, "", 15.0f},
        {"lataComida", "Comida enlatada", 0.6f, 6000, 0, 40.0f, 0.0f, false, "", 8.0f},
        {"refresco", "Refresco", 0.4f, 3500, 1, 30.0f, 0.0f, false, "", 10.0f, 10.0f},
        {"tintico", "Tintico", 0.1f, 1000, 6, 20.0f, 0.0f, true, "", 15.0f, 20.0f},
        {"pegante", "Pegante", 0.2f, 3000, 6, 40.0f, -3.0f, true, "", 25.0f},
        {"cigarrillo", "Cigarrillo suelto", 0.01f, 500, 6, 35.0f, -1.0f},
        {"jabon", "Jabón", 0.2f, 3500, 4, 40.0f},
        {"cepillo", "Cepillo", 0.1f, 3000, 4, 20.0f},
        {"vacuna", "Vacuna", 0.1f, 20000, -1, 0.0f, 0.0f, false, "tetanos"},
        {"carbon", "Carbón activo", 0.1f, 9000, -1, 0.0f, 0.0f, false, "intoxicacion"},
        {"jarabe", "Jarabe", 0.2f, 11000, -1, 0.0f, 0.0f, false, "gripe"},
        {"pomada", "Pomada", 0.15f, 9500, -1, 0.0f, 0.0f, false, "sarna"},
        {"antiparasitario", "Antiparasitario", 0.1f, 13000, -1, 0.0f, 0.0f, false, "parasitos"},
        {"antibiotico", "Antibiótico", 0.1f, 25000, -1, 0.0f, 0.0f, false, "infeccion"}
    }};
    struct InventoryEntry { size_t itemIndex; int quantity; };
    std::vector<InventoryEntry> inventory;
    float inventoryWeight = 0.0f;
    float money = 0.0f;
    int xp = 0;
    int level = 1;
    int talentPoints = 0;
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
        playerRagdoll.Begin(playerPos, playerYaw, impactVelocity, characterManager.GetLook());
        playerPos.y = 0.0f;
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
    ui.RenderLoadingScreen(window, 0.76f, "Restaurando la partida guardada...",
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
                    if (id == "collector1" || id == "collector2" || id == "collector3" ||
                        id == "surv1" || id == "surv2" || id == "surv3" ||
                        id == "crime1" || id == "crime2" || id == "crime3") {
                        unlockedTalents.insert(id);
                    }
                }
                companionName = state.value("companionName", companionName);
                companionCoat = std::clamp(state.value("companionCoat", 0), 0, 3);
                companionIsFriend = state.value("companionIsFriend", false);
                companionPosition.x = state.value("companionX", companionPosition.x);
                companionPosition.z = state.value("companionZ", companionPosition.z);
                simulation.SetDogState(companionIsFriend, companionPosition, companionCoat);
                ui.SetCompanionCustomization(companionName, companionCoat);
                itemsCollected = state.value("itemsCollected", 0);
                itemsSold = state.value("itemsSold", 0);
                missionProgress = state.value("missionProgress", size_t{0});
                simulation.SetMissionProgress(missionProgress);
                if (state.value("missionStarted", false)) simulation.StartMission();
                if (state.value("missionComplete", false)) simulation.CompleteMission();
                objective = state.value("objective", objective);
                for (const auto& savedDisease : state.value("diseases", nlohmann::json::array())) {
                    DiseaseState disease{savedDisease.value("id", std::string{}), savedDisease.value("remaining", 0.0f), savedDisease.value("healthDrain", 0.0f), savedDisease.value("mentalDrain", 0.0f)};
                    if (disease.remaining > 0.0f && disease.healthDrain > 0.0f) diseases.push_back(std::move(disease));
                }
                if (state.contains("dayProgress")) simulation.SetDayProgress(state.value("dayProgress", 0.30f));
                playerPos.x = state.value("playerX", playerPos.x);
                playerPos.z = state.value("playerZ", playerPos.z);
                for (const auto& entry : state.value("inventory", nlohmann::json::array())) {
                    size_t itemIndex = entry.value("item", lootTable.size());
                    int quantity = entry.value("quantity", 0);
                    const float savedCapacity = 20.0f + (unlockedTalents.contains("collector2") ? 10.0f : 0.0f);
                    if (itemIndex < lootTable.size() && quantity > 0 && inventoryWeight + lootTable[itemIndex].weight * quantity <= savedCapacity) {
                        inventory.push_back({itemIndex, quantity});
                        inventoryWeight += lootTable[itemIndex].weight * quantity;
                    }
                }
                hasSavedCharacter = characterManager.Deserialize(state, [&](size_t completed, size_t total) {
                    const float progress = 0.76f + 0.06f * static_cast<float>(completed) / static_cast<float>(total);
                    const std::string stage = "Cargando personaje guardado (" + std::to_string(completed)
                        + "/" + std::to_string(total) + " modelos)...";
                    ui.RenderLoadingScreen(window, progress, stage);
                });
            } catch (const std::exception& error) { LogWarn("Partida guardada inválida: {}", error.what()); }
        }
    }
    ui.RenderLoadingScreen(window, 0.83f, "Partida y estado del jugador restaurados...");
    std::mt19937 lootRandom(std::random_device{}());
    float survivalSaveTimer = 0.0f;
    float begCooldownRemaining = 0.0f;
    const auto hasTalent = [&](const std::string& id) { return unlockedTalents.contains(id); };
    const auto inventoryCapacity = [&]() { return 20.0f + (hasTalent("collector2") ? 10.0f : 0.0f); };
    const auto awardXp = [&](int amount, float activityMultiplier = 1.0f) {
        const float talentMultiplier = hasTalent("crime3") ? 1.5f : 1.0f;
        xp += static_cast<int>(std::round(static_cast<float>(amount) * activityMultiplier * talentMultiplier));
        while (xp >= 100 * level) {
            xp -= 100 * level;
            ++level;
            ++talentPoints;
        }
    };

    auto saveGame = [&](const std::string& feedbackMsg = "Partida guardada con éxito") {
        nlohmann::json state;
        state["needs"] = needs;
        state["money"] = money;
        state["xp"] = xp;
        state["level"] = level;
        state["talentPoints"] = talentPoints;
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
        state["playerX"] = playerPos.x;
        state["playerZ"] = playerPos.z;
        state["companionName"] = ui.GetCompanionName();
        state["companionCoat"] = ui.GetCompanionCoat();
        state["companionIsFriend"] = simulation.IsDogFriend();
        state["companionX"] = simulation.GetDogPosition().x;
        state["companionZ"] = simulation.GetDogPosition().z;
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

        playerPos = city.GetSpawnPoint();
        playerPos.y = 0.0f;
        playerYaw = 0.0f;
        needs = {100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 100.0f, 80.0f};
        money = 0.0f;
        xp = 0;
        level = 1;
        talentPoints = 0;
        unlockedTalents.clear();
        companionName = "El Chato";
        companionCoat = 0;
        companionIsFriend = false;
        companionPosition = {4.0f, 0.0f, 4.0f};
        simulation.SetDogState(false, companionPosition, companionCoat);
        ui.SetCompanionCustomization(companionName, companionCoat);
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
    const auto tryInfectFromPickup = [&]() -> std::string {
        float chance = 0.12f * (needs[4] < 30.0f ? 1.5f : 1.0f)
            * (hasTalent("surv2") ? 0.6f : 1.0f);
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
    auto collectNearbyPickup = [&](float radius) {
        size_t nearest = simulation.GetPickups().size();
        float nearestDistance = radius;
        for (size_t index = 0; index < simulation.GetPickups().size(); ++index) {
            if (!simulation.GetPickups()[index].available) continue;
            const float distance = glm::distance(playerPos, simulation.GetPickups()[index].position);
            if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
        }
        PickupItem pickup;
        if (nearest >= simulation.GetPickups().size() || !simulation.CollectPickup(nearest, pickup)) return false;
        const Item& item = lootTable[pickup.itemIndex];
        if (inventoryWeight + item.weight > inventoryCapacity()) {
            simulation.RestorePickup(pickup);
            audio.Play(AudioCue::Full);
            return false;
        }
        auto entry = std::find_if(inventory.begin(), inventory.end(), [&](const InventoryEntry& value) { return value.itemIndex == pickup.itemIndex; });
        if (entry == inventory.end()) inventory.push_back({pickup.itemIndex, 1}); else ++entry->quantity;
        inventoryWeight += item.weight;
        ++itemsCollected;
        awardXp(3, hasTalent("collector1") ? 1.1f : 1.0f);
        if (item.id == "reloj") needs[5] = std::min(100.0f, needs[5] + 8.0f);
        const std::string contractedDisease = tryInfectFromPickup();
        audio.Play(AudioCue::Pickup);
        if (!contractedDisease.empty()) {
            ui.SetPickupNotification("Te enfermaste de " + contractedDisease + " al rebuscar. Busca el tratamiento adecuado.");
        } else if (item.id == "reloj") {
            ui.SetPickupNotification("+ " + item.name + " · +8 de ánimo.");
        } else {
            ui.SetPickupNotification("+ " + item.name);
        }
        return true;
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
    const auto isRecyclable = [](const Item& item) {
        static const std::unordered_set<std::string> nonRecyclable{
            "radioTransistor", "pilas", "tela", "madera", "lona", "colchon", "vela",
            "popo", "alambre", "plastico", "mochila", "arma"
        };
        return item.consumableNeed < 0 && !item.substance && item.cure.empty()
            && !nonRecyclable.contains(item.id);
    };
    const auto applyItemEffect = [&](const Item& item) {
        if (item.consumableNeed >= 0) {
            const size_t needIndex = static_cast<size_t>(item.consumableNeed);
            needs[needIndex] = std::clamp(needs[needIndex] + item.amount, 0.0f, 100.0f);
            needs[3] = std::clamp(needs[3] + item.healthDelta, 0.0f, 100.0f);
            needs[5] = std::clamp(needs[5] + item.moodDelta, 0.0f, 100.0f);
            needs[2] = std::clamp(needs[2] + item.energyDelta, 0.0f, 100.0f);
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
    const auto sellRecyclables = [&]() {
        int soldCount = 0;
        float earned = 0.0f;
        const float saleMultiplier = hasTalent("collector3") ? 1.2f : 1.0f;
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

    characterManager.Init([&](size_t completed, size_t total) {
        const float progress = 0.84f + 0.12f * static_cast<float>(completed) / static_cast<float>(total);
        const std::string stage = "Cargando modelos y animaciones del personaje (" + std::to_string(completed)
            + "/" + std::to_string(total) + ")...";
        ui.RenderLoadingScreen(window, progress, stage);
    });

    characterPreview.Init(512, 640);

    ui.RenderLoadingScreen(window, 1.0f, "¡Todo listo! Entrando a Bogotá...", "");

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

        if (!ui.IsPaused() && !characterCreatorUI.IsOpen() && Input::IsKeyPressed(GLFW_KEY_TAB)) {
            Input::ToggleCursorLock();
        }

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
        float statusSpeedMultiplier = 1.0f;
        if (needs[5] < 30.0f) statusSpeedMultiplier *= 0.8f;
        if (needs[5] <= 0.0f) statusSpeedMultiplier *= 0.7f;
        if (needs[2] <= 0.0f) statusSpeedMultiplier *= 0.5f;
        if (withdrawal > 0.0f) {
            statusSpeedMultiplier *= 0.85f;
            if (criticalWithdrawal) statusSpeedMultiplier *= 0.75f;
            else if (highWithdrawal) statusSpeedMultiplier *= 0.88f;
        }
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
            if (knockdownRemaining <= 0.0f) {
                playerKnockedDown = false;
                playerPos.y = 0.0f;
            }
        } else if (glm::length(moveDir) > 0.001f) {
            moveDir = glm::normalize(moveDir);
            currentSpeed = moveSpeed;

            glm::vec3 nextPos = playerPos + moveDir * (moveSpeed * dt);
            float impactSpeed = 0.0f;
            glm::vec3 impactDirection(0.0f);
            if (vehicleImpactCooldown <= 0.0f && needs[3] > 0.0f
                && simulation.GetVehicleImpact(nextPos, impactSpeed, impactDirection)) {
                knockDownPlayer(impactSpeed, impactDirection);
            } else if (city.IsWalkable(nextPos.x, nextPos.z) && !simulation.IsBlocked(nextPos, 0.35f)) {
                playerPos = nextPos;
            } else if (city.IsWalkable(nextPos.x, playerPos.z) && !simulation.IsBlocked({nextPos.x, 0.0f, playerPos.z}, 0.35f)) {
                playerPos.x = nextPos.x;
            } else if (city.IsWalkable(playerPos.x, nextPos.z) && !simulation.IsBlocked({playerPos.x, 0.0f, nextPos.z}, 0.35f)) {
                playerPos.z = nextPos.z;
            }

            playerYaw = std::atan2(moveDir.x, moveDir.z);
        }
        audio.Update(currentSpeed > 0.25f, isRunning);

        const float dtClamped = std::max(0.0f, dt);
        begCooldownRemaining = std::max(0.0f, begCooldownRemaining - dtClamped);
        const float hungerAndThirstDecay = hasTalent("surv1") ? 0.7f : 1.0f;
        needs[0] = std::max(0.0f, needs[0] - (100.0f / 7200.0f) * dtClamped * hungerAndThirstDecay);
        needs[1] = std::max(0.0f, needs[1] - (100.0f / 5400.0f) * dtClamped * hungerAndThirstDecay);
        needs[2] = std::max(0.0f, needs[2] - (100.0f / 5400.0f) * dtClamped - (isRunning && currentSpeed > 0.0f ? 0.01f * dtClamped : 0.0f));
        needs[4] = std::max(0.0f, needs[4] - (100.0f / 21600.0f) * dtClamped);
        needs[6] = std::max(0.0f, needs[6] - (60.0f / 7200.0f) * dtClamped);
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
        needs[5] = std::max(0.0f, needs[5] - moodDecay * dtClamped * (hasTalent("surv3") ? 0.5f : 1.0f));

        if (needs[0] <= 0.0f) healthDrain += 100.0f / 1800.0f;
        if (needs[1] <= 0.0f) healthDrain += 100.0f / 1200.0f;
        needs[3] = std::max(0.0f, needs[3] - healthDrain * dtClamped);
        if (needs[0] > 50.0f && needs[1] > 50.0f && needs[2] > 50.0f
            && needs[4] > 40.0f && needs[5] > 40.0f && withdrawal <= 0.0f
            && healthDrain == 0.0f) {
            needs[3] = std::min(100.0f, needs[3] + 0.5f * dtClamped);
        }
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
                    collectNearbyPickup(1.8f);
                }
            }
        }
        if (!ui.IsPaused() && Input::IsKeyPressed(GLFW_KEY_F)) {
            const bool atRecycler = simulation.IsNearRecycler(playerPos, 3.0f);
            if (!atRecycler) {
                ui.SetPickupNotification("Solo puedes entregar reciclables en la Recicladora El Progreso.");
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
        if (!ui.IsPaused() && (Input::IsKeyPressed(GLFW_KEY_B) || Input::IsKeyPressed(GLFW_KEY_L)) && !simulation.IsNearShop(playerPos, 2.0f)) {
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
                        : static_cast<int>(std::round((2.0f + std::uniform_real_distribution<float>(0.0f, 13.0f)(lootRandom)) * 100.0f));
                    const int earned = static_cast<int>(std::round(
                        static_cast<float>(amount) * (hasTalent("crime2") ? 1.3f : 1.0f)));
                    money += static_cast<float>(earned);
                    needs[5] = std::min(100.0f, needs[5] + (rare ? 6.0f : 2.0f));
                    awardXp(rare ? 8 : 4);
                    ui.SetPickupNotification(rare
                        ? "Una persona generosa te dio $" + std::to_string(earned) + " COP."
                        : "Recibiste $" + std::to_string(earned) + " COP de limosna.");
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
                        earned += std::round(static_cast<float>(item.value * entry->quantity) * 1.8f * 1.3f);
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
                sellRecyclables();
            } else if (vendorIndex < simulation.GetStreetVendorCount()) {
                const StreetVendor& vendor = simulation.GetVendor(vendorIndex);
                const std::array<size_t, 3> chazaCatalog{{6, 0, 1}};
                const std::array<size_t, 3> fritangaCatalog{{7, 0, 8}};
                const auto& catalog = vendor.fritanga ? fritangaCatalog : chazaCatalog;
                const Item& product = shopCatalog[catalog[std::uniform_int_distribution<size_t>(0, catalog.size() - 1)(lootRandom)]];
                if (money < product.value) {
                    ui.SetPickupNotification("No te alcanza para comprar en " + vendor.name + ".");
                } else if (!addLootById(product.id)) {
                    ui.SetPickupNotification("El costal está lleno; no puedes cargar " + product.name + ".");
                } else {
                    money -= product.value;
                    audio.Play(AudioCue::Pickup);
                    ui.SetPickupNotification(vendor.name + ": compraste " + product.name + ".");
                }
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
                        < (hasTalent("crime1") ? 0.20f : 0.25f);
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
                const float caughtChance = hasTalent("crime1") ? 0.20f : 0.25f;
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
                const Item& product = shopCatalog[std::uniform_int_distribution<size_t>(0, shopCatalog.size() - 1)(lootRandom)];
                size_t itemIndex = static_cast<size_t>(std::find_if(lootTable.begin(), lootTable.end(), [&](const Item& item) { return item.id == product.id; }) - lootTable.begin());
                if (itemIndex < lootTable.size() && money >= product.value && inventoryWeight + product.weight <= inventoryCapacity()) {
                    money -= product.value;
                    auto entry = std::find_if(inventory.begin(), inventory.end(), [&](const InventoryEntry& item) { return item.itemIndex == itemIndex; });
                    if (entry == inventory.end()) inventory.push_back({itemIndex, 1}); else ++entry->quantity;
                    inventoryWeight += product.weight;
                    audio.Play(AudioCue::Pickup);
                }
            } else if (collectNearbyPickup(1.8f)) {
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
            }
        }

        if (simulation.IsMissionComplete()) objective = "Mision completada: recibiste $5000 y 20 XP";
        else if (simulation.IsMissionStarted()) objective = "Mision: entrega 5 reciclables en El Progreso [F] (" + std::to_string(simulation.GetMissionProgress()) + "/5)";
        else if (itemsCollected < 5) objective = "Rebusca y recoge 5 objetos [Q]";
        else if (itemsSold < 3) objective = "Recicla 3 objetos del costal [F]";
        else if (level < 2) objective = "Sigue rebuscando para alcanzar nivel 2";
        else if (level >= 2) objective = "Sobrevive en Bogotá y mejora tu vida";

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
        audio.SetRaining(simulation.IsRaining());
        audio.UpdateVehicleAudio(dt, playerPos, simulation, ui.IsPaused());

        // 7. Actualizar cámara
        camera.Follow(playerPos, dt, currentSpeed, isRunning);

        // 8. Renderizado 3D con OpenGL 4.5 DSA
        renderer.BeginScene(camera, clock.GetElapsedTime());

        // Renderizar ciudad de Bogotá
        city.Render(renderer);
        simulation.Render(renderer, clock.GetElapsedTime(), playerPos);

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
            inventoryOptions.push_back({entry.itemIndex, item.id, item.name, entry.quantity, item.weight,
                item.consumableNeed >= 0 || !item.cure.empty() || item.id == "vendaje" || item.id == "curita"});
        }
        std::vector<DealerOption> dealerOptions;
        for (const std::string& id : {std::string("tintico"), std::string("pegante"), std::string("pastilla")}) {
            const auto item = std::find_if(lootTable.begin(), lootTable.end(),
                [&](const Item& entry) { return entry.id == id; });
            if (item == lootTable.end()) continue;
            dealerOptions.push_back({item->id, item->name, item->value, money >= item->value,
                                     inventoryWeight + item->weight <= inventoryCapacity()});
        }
        const std::array<TalentOption, 9> talentDefinitions{{
            {"collector1", "Ojo de águila", "+10 % de XP al recoger objetos.", "", 1},
            {"collector2", "Bolsas llenas", "+10 kg de capacidad en el costal.", "collector1", 1},
            {"collector3", "Selección experta", "+20 % de valor al vender reciclables.", "collector2", 2},
            {"surv1", "Estómago de hierro", "-30 % de desgaste de hambre y sed.", "", 1},
            {"surv2", "Piel dura", "-40 % de riesgo de enfermedad.", "surv1", 1},
            {"surv3", "Mente de acero", "-50 % de desgaste del ánimo.", "surv2", 2},
            {"crime1", "Manos ligeras", "-20 % de probabilidad de ser atrapado robando.", "", 1},
            {"crime2", "Contactos", "+30 % de dinero al pedir limosna.", "crime1", 1},
            {"crime3", "Rey de la calle", "+50 % de XP en todas las actividades.", "crime2", 2}
        }};
        std::vector<TalentOption> talentOptions(talentDefinitions.begin(), talentDefinitions.end());
        for (auto& talent : talentOptions) {
            talent.unlocked = hasTalent(talent.id);
            talent.available = !talent.unlocked && talentPoints >= talent.cost
                && (talent.requirement.empty() || hasTalent(talent.requirement));
        }
        simulation.SetDogCoat(ui.GetCompanionCoat());
        ui.RenderHUD(dt, playerPos, camera, renderer, window, city, simulation, audio,
                     characterManager.GetLook().nombre, characterManager.GetOriginInfo().name,
                     needs, money, inventoryWeight, inventoryCapacity(),
                     simulation.GetDayProgress(), simulation.GetPedestrianCount(), simulation.GetTrafficCount(), inventorySummary, diseaseSummary, level, xp, objective,
                     simulation.GetMissionProgress(), simulation.GetMissionTarget(), craftingOptions,
                     inventoryOptions, talentPoints, talentOptions, simulation.IsDogFriend(), dealerOptions);

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

        const size_t useIndex = ui.ConsumeInventoryUseRequest();
        if (useIndex < lootTable.size()) {
            auto entry = std::find_if(inventory.begin(), inventory.end(),
                [&](const InventoryEntry& value) { return value.itemIndex == useIndex; });
            if (entry != inventory.end()) {
                const Item& item = lootTable[entry->itemIndex];
                if (applyItemEffect(item)) {
                    inventoryWeight = std::max(0.0f, inventoryWeight - item.weight);
                    if (--entry->quantity == 0) inventory.erase(entry);
                    audio.Play(AudioCue::Pickup);
                }
            }
        }
        const size_t dropIndex = ui.ConsumeInventoryDropRequest();
        if (dropIndex < lootTable.size()) {
            auto entry = std::find_if(inventory.begin(), inventory.end(),
                [&](const InventoryEntry& value) { return value.itemIndex == dropIndex; });
            if (entry != inventory.end()) {
                simulation.RestorePickup({dropIndex, playerPos});
                inventoryWeight = std::max(0.0f, inventoryWeight - lootTable[dropIndex].weight);
                if (--entry->quantity == 0) inventory.erase(entry);
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

        ui.EndFrame();

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
                            - CityLayout::WIDTH * CityLayout::TILE_SIZE * 0.5f
                            + CityLayout::TILE_SIZE * 0.5f,
                        static_cast<float>(tileZ) * CityLayout::TILE_SIZE
                            - CityLayout::HEIGHT * CityLayout::TILE_SIZE * 0.5f
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
            playerPos = {respawnPosition.x, 0.0f, respawnPosition.y};
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
