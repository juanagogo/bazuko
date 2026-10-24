#include "UIManager.hpp"
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <GLFW/glfw3.h>
#include "../core/Input.hpp"
#include "../core/Log.hpp"
#include "../core/Paths.hpp"
#include "../renderer/Texture.hpp"
#include <array>
#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <nlohmann/json.hpp>
#include <random>
#include <sstream>
#include <utility>

namespace Bazuko {

namespace {

constexpr float LoadingArtworkDuration = 7.5f;
constexpr float LoadingArtworkTransitionDuration = 0.9f;

ImTextureID LoadingTextureId(const Texture& texture) {
    return (ImTextureID)(intptr_t)texture.GetID();
}

void AddLoadingArtworkImage(ImDrawList* drawList, const Texture& texture, const ImVec2& displaySize,
                            bool foreground, float alpha) {
    ImVec2 min(0.0f, 0.0f);
    ImVec2 max(displaySize.x, displaySize.y);
    if (foreground) {
        const float boxWidth = displaySize.x * 0.74f;
        const float boxHeight = displaySize.y * 0.99f;
        const float scale = std::min(boxWidth / static_cast<float>(texture.GetWidth()),
                                     boxHeight / static_cast<float>(texture.GetHeight()));
        const float imageWidth = texture.GetWidth() * scale;
        const float imageHeight = texture.GetHeight() * scale;
        const float boxLeft = displaySize.x * 0.28f;
        min.x = boxLeft + (boxWidth - imageWidth) * 0.5f;
        max.x = min.x + imageWidth;
        max.y = displaySize.y * 1.03f;
        min.y = max.y - imageHeight;
    } else {
        const float displayAspect = displaySize.x / displaySize.y;
        const float imageAspect = static_cast<float>(texture.GetWidth()) / static_cast<float>(texture.GetHeight());
        ImVec2 uvMin(0.0f, 0.0f);
        ImVec2 uvMax(1.0f, 1.0f);
        if (imageAspect > displayAspect) {
            const float visibleWidth = displayAspect / imageAspect;
            uvMin.x = (1.0f - visibleWidth) * 0.5f;
            uvMax.x = uvMin.x + visibleWidth;
        } else {
            const float visibleHeight = imageAspect / displayAspect;
            uvMin.y = (1.0f - visibleHeight) * 0.5f;
            uvMax.y = uvMin.y + visibleHeight;
        }
        drawList->AddImage(LoadingTextureId(texture), min, max, uvMin, uvMax,
                           IM_COL32(255, 255, 255, static_cast<int>(255.0f * alpha)));
        return;
    }
    drawList->AddImage(LoadingTextureId(texture), min, max, ImVec2(0.0f, 0.0f), ImVec2(1.0f, 1.0f),
                       IM_COL32(255, 255, 255, static_cast<int>(255.0f * alpha)));
}

} // namespace

UIManager::UIManager(GLFWwindow* window) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard;
    // Evitar que ImGui fuerce el cursor visible cada cuadro
    io.ConfigFlags |= ImGuiConfigFlags_NoMouseCursorChange;

    SetupDarkUrbanBogotaTheme();

    ImGui_ImplGlfw_InitForOpenGL(window, true);
    ImGui_ImplOpenGL3_Init("#version 450");

    const std::string configPath = Paths::Find("assets/radio_stations.json");
    std::ifstream configFile(configPath);
    if (!configFile) {
        LogWarn("No se pudo abrir la configuracion de emisoras: {}", configPath);
        return;
    }

    try {
        const nlohmann::json config = nlohmann::json::parse(configFile);
        for (const auto& entry : config.at("stations")) {
            RadioStation station{
                entry.at("id").get<std::string>(),
                entry.at("name").get<std::string>(),
                entry.at("frequency").get<std::string>(),
                entry.at("genre").get<std::string>(),
                entry.at("program").get<std::string>(),
                entry.value("url", std::string{})
            };
            m_RadioStations.push_back(std::move(station));
        }
        if (m_RadioStations.empty()) {
            LogWarn("La configuracion de emisoras no contiene estaciones: {}", configPath);
        }
    } catch (const std::exception& error) {
        m_RadioStations.clear();
        LogError("No se pudo leer la configuracion de emisoras {}: {}", configPath, error.what());
    }
}

UIManager::~UIManager() {
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
}

void UIManager::SetupDarkUrbanBogotaTheme() {
    ImGuiStyle& style = ImGui::GetStyle();
    ImVec4* colors = style.Colors;

    style.WindowRounding = 6.0f;
    style.FrameRounding = 4.0f;
    style.GrabRounding = 4.0f;
    style.PopupRounding = 4.0f;
    style.ScrollbarRounding = 4.0f;
    style.FrameBorderSize = 1.0f;
    style.WindowBorderSize = 1.0f;

    colors[ImGuiCol_Text]                  = ImVec4(0.92f, 0.92f, 0.92f, 1.00f);
    colors[ImGuiCol_TextDisabled]          = ImVec4(0.50f, 0.50f, 0.50f, 1.00f);
    colors[ImGuiCol_WindowBg]              = ImVec4(0.10f, 0.11f, 0.12f, 0.88f);
    colors[ImGuiCol_ChildBg]               = ImVec4(0.12f, 0.13f, 0.14f, 0.60f);
    colors[ImGuiCol_PopupBg]               = ImVec4(0.10f, 0.11f, 0.13f, 0.94f);
    colors[ImGuiCol_Border]                = ImVec4(0.24f, 0.26f, 0.28f, 0.65f);
    colors[ImGuiCol_BorderShadow]          = ImVec4(0.00f, 0.00f, 0.00f, 0.00f);
    colors[ImGuiCol_FrameBg]               = ImVec4(0.16f, 0.18f, 0.20f, 0.70f);
    colors[ImGuiCol_FrameBgHovered]        = ImVec4(0.22f, 0.24f, 0.28f, 0.80f);
    colors[ImGuiCol_FrameBgActive]         = ImVec4(0.28f, 0.30f, 0.35f, 0.90f);
    colors[ImGuiCol_TitleBg]               = ImVec4(0.14f, 0.15f, 0.17f, 1.00f);
    colors[ImGuiCol_TitleBgActive]         = ImVec4(0.18f, 0.20f, 0.23f, 1.00f);
    colors[ImGuiCol_TitleBgCollapsed]      = ImVec4(0.10f, 0.11f, 0.12f, 0.75f);
    colors[ImGuiCol_MenuBarBg]             = ImVec4(0.12f, 0.13f, 0.14f, 1.00f);
    colors[ImGuiCol_ScrollbarBg]           = ImVec4(0.08f, 0.09f, 0.10f, 0.60f);
    colors[ImGuiCol_ScrollbarGrab]         = ImVec4(0.28f, 0.30f, 0.33f, 0.80f);
    colors[ImGuiCol_ScrollbarGrabHovered]  = ImVec4(0.38f, 0.40f, 0.44f, 0.90f);
    colors[ImGuiCol_ScrollbarGrabActive]   = ImVec4(0.48f, 0.50f, 0.55f, 1.00f);
    colors[ImGuiCol_CheckMark]             = ImVec4(0.96f, 0.77f, 0.18f, 1.00f);
    colors[ImGuiCol_SliderGrab]            = ImVec4(0.10f, 0.36f, 0.70f, 0.95f);
    colors[ImGuiCol_SliderGrabActive]      = ImVec4(0.16f, 0.49f, 0.89f, 1.00f);
    colors[ImGuiCol_Button]                = ImVec4(0.05f, 0.22f, 0.44f, 0.92f);
    colors[ImGuiCol_ButtonHovered]         = ImVec4(0.08f, 0.36f, 0.70f, 0.98f);
    colors[ImGuiCol_ButtonActive]          = ImVec4(0.10f, 0.43f, 0.80f, 1.00f);
    colors[ImGuiCol_Header]                = ImVec4(0.05f, 0.26f, 0.53f, 0.88f);
    colors[ImGuiCol_HeaderHovered]         = ImVec4(0.08f, 0.38f, 0.74f, 0.96f);
    colors[ImGuiCol_HeaderActive]          = ImVec4(0.10f, 0.45f, 0.84f, 1.00f);
    colors[ImGuiCol_Separator]             = ImVec4(0.24f, 0.26f, 0.28f, 0.70f);
}

void UIManager::BeginFrame() {
    ImGui_ImplOpenGL3_NewFrame();
    ImGui_ImplGlfw_NewFrame();
    ImGui::NewFrame();
}

void UIManager::EndFrame() {
    ImGui::Render();
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}

void UIManager::TogglePause() {
    if (m_DeathScreenOpen) return;
    m_Paused = !m_Paused;
    m_RadioMenuOpen = false;
    m_RadioReturnsToPause = false;
    m_CraftMenuOpen = false;
    m_PauseSection = 0;
    Input::SetCursorLocked(!m_Paused);
}

void UIManager::HandleEscape() {
    if (m_DeathScreenOpen) return;
    if (m_RadioMenuOpen) {
        CloseRadioMenu();
        return;
    }
    if (m_CraftMenuOpen) {
        m_CraftMenuOpen = false;
        return;
    }
    if (m_Paused && m_PauseSection != 0) {
        TogglePause();
        return;
    }
    TogglePause();
}

void UIManager::HandleRadioShortcut() {
    if (m_RadioMenuOpen) {
        CloseRadioMenu();
    } else if (!m_Paused) {
        OpenRadioMenu(false);
    }
}

void UIManager::OpenRadioMenu(bool returnToPause) {
    if (m_DeathScreenOpen) return;
    m_Paused = true;
    m_RadioMenuOpen = true;
    m_RadioReturnsToPause = returnToPause;
    m_CraftMenuOpen = false;
    m_PauseSection = 0;
    Input::SetCursorLocked(false);
}

void UIManager::CloseRadioMenu() {
    m_RadioMenuOpen = false;
    if (!m_RadioReturnsToPause) TogglePause();
    m_RadioReturnsToPause = false;
}

void UIManager::ToggleCraftMenu() {
    if (!m_Paused && !m_DeathScreenOpen) m_CraftMenuOpen = !m_CraftMenuOpen;
}

void UIManager::OpenPauseSection(int section) {
    if (m_DeathScreenOpen) return;
    const int requestedSection = std::clamp(section, 0, 3);
    if (m_Paused && m_PauseSection == requestedSection) {
        TogglePause();
        return;
    }
    m_Paused = true;
    m_PauseSection = requestedSection;
    m_RadioMenuOpen = false;
    m_RadioReturnsToPause = false;
    m_CraftMenuOpen = false;
    Input::SetCursorLocked(false);
}

void UIManager::OpenDealerMenu() {
    if (m_DeathScreenOpen) return;
    m_Paused = true;
    m_PauseSection = 4;
    m_RadioMenuOpen = false;
    m_RadioReturnsToPause = false;
    m_CraftMenuOpen = false;
    Input::SetCursorLocked(false);
}

void UIManager::ShowDeathScreen(const std::string& causes, bool vehicleImpact) {
    if (m_DeathScreenOpen) return;
    m_DeathScreenOpen = true;
    m_DeathByVehicleImpact = vehicleImpact;
    m_DeathCauses = causes;
    m_RespawnRequest = false;
    m_Paused = true;
    m_RadioMenuOpen = false;
    m_RadioReturnsToPause = false;
    m_CraftMenuOpen = false;
    m_PauseSection = 0;
    Input::SetCursorLocked(false);
}

bool UIManager::ConsumeRespawnRequest() {
    const bool requested = m_RespawnRequest;
    m_RespawnRequest = false;
    return requested;
}

void UIManager::CompleteDeathRecovery() {
    m_DeathScreenOpen = false;
    m_DeathByVehicleImpact = false;
    m_DeathCauses.clear();
    m_Paused = false;
    m_PauseSection = 0;
    Input::SetCursorLocked(true);
}

std::string UIManager::ConsumeCraftRequest() {
    std::string request = std::move(m_CraftRequest);
    m_CraftRequest.clear();
    return request;
}

size_t UIManager::ConsumeInventoryUseRequest() {
    const size_t request = m_InventoryUseRequest;
    m_InventoryUseRequest = static_cast<size_t>(-1);
    return request;
}

size_t UIManager::ConsumeInventoryDropRequest() {
    const size_t request = m_InventoryDropRequest;
    m_InventoryDropRequest = static_cast<size_t>(-1);
    return request;
}

bool UIManager::ConsumeInventorySortRequest() {
    const bool requested = m_InventorySortRequest;
    m_InventorySortRequest = false;
    return requested;
}

std::string UIManager::ConsumeTalentUnlockRequest() {
    std::string request = std::move(m_TalentUnlockRequest);
    m_TalentUnlockRequest.clear();
    return request;
}

std::string UIManager::ConsumeDealerPurchaseRequest() {
    std::string request = std::move(m_DealerPurchaseRequest);
    m_DealerPurchaseRequest.clear();
    return request;
}

bool UIManager::ConsumePetRequest() {
    const bool requested = m_PetRequest;
    m_PetRequest = false;
    return requested;
}

void UIManager::SetCompanionCustomization(const std::string& name, int coat) {
    m_CompanionName.fill('\0');
    const size_t count = std::min(name.size(), m_CompanionName.size() - 1);
    std::copy_n(name.begin(), count, m_CompanionName.begin());
    m_CompanionCoat = std::clamp(coat, 0, 3);
}

std::string UIManager::GetCompanionName() const {
    return m_CompanionName.data();
}

bool UIManager::ConsumeSaveRequest() {
    const bool requested = m_SaveRequest;
    m_SaveRequest = false;
    return requested;
}

bool UIManager::ConsumeNewGameRequest() {
    const bool requested = m_NewGameRequest;
    m_NewGameRequest = false;
    return requested;
}

bool UIManager::ConsumeQuitRequest() {
    const bool requested = m_QuitRequest;
    m_QuitRequest = false;
    return requested;
}

bool UIManager::ConsumeCharacterCreatorRequest() {
    const bool requested = m_CharacterCreatorRequest;
    m_CharacterCreatorRequest = false;
    return requested;
}

void UIManager::RenderQuitScreen(Window& window) {
    window.PollEvents();
    glClearColor(0.05f, 0.05f, 0.06f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    BeginFrame();

    ImGuiIO& io = ImGui::GetIO();
    ImVec2 center(io.DisplaySize.x * 0.5f, io.DisplaySize.y * 0.5f);
    ImGui::SetNextWindowPos(center, ImGuiCond_Always, ImVec2(0.5f, 0.5f));
    ImGui::SetNextWindowSize(ImVec2(std::min(520.0f, io.DisplaySize.x - 40.0f), 0), ImGuiCond_Always);

    ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_AlwaysAutoResize;

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(24.0f, 24.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 2.0f);
    ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.88f, 0.58f, 0.15f, 0.90f));
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.08f, 0.09f, 0.10f, 0.98f));

    if (ImGui::Begin("QuitModal", nullptr, flags)) {
        ImGui::SetCursorPosX((ImGui::GetWindowWidth() - ImGui::CalcTextSize("B A Z U K O").x * 1.5f) * 0.5f);
        ImGui::SetWindowFontScale(1.5f);
        ImGui::TextColored(ImVec4(0.96f, 0.72f, 0.16f, 1.0f), "B A Z U K O");
        ImGui::SetWindowFontScale(1.0f);

        ImGui::Spacing();
        ImGui::Separator();
        ImGui::Spacing();

        ImGui::TextColored(ImVec4(0.40f, 0.85f, 0.45f, 1.0f), "Guardando partida...");
        ImGui::Spacing();
        ImGui::Text("Tus datos, inventario y apariencia se han guardado con exito.");
        ImGui::TextDisabled("Cerrando aplicacion con seguridad. ¡Hasta pronto, sobreviviente!");
    }
    ImGui::End();

    ImGui::PopStyleColor(2);
    ImGui::PopStyleVar(2);

    EndFrame();
    window.SwapBuffers();
}

void UIManager::SetSaveNotification(const std::string& message) {
    m_SaveNotification = message;
    m_SaveNotificationTimer = 3.5f;
}

void UIManager::SetPickupNotification(const std::string& message, bool rare) {
    m_PickupNotification = message;
    m_PickupNotificationTimer = 2.5f;
    m_PickupNotificationRare = rare;
}

void UIManager::LoadLoadingArtwork(int index) {
    if (index < 0 || index >= static_cast<int>(m_LoadingArtworkLoadAttempted.size()) ||
        m_LoadingArtworkLoadAttempted[static_cast<size_t>(index)]) {
        return;
    }
    m_LoadingArtworkLoadAttempted[static_cast<size_t>(index)] = true;

    const std::string root = "public/images/pantalla-carga/";
    const std::string backgroundPath = Paths::Find(root + "fondo_pantalla_carga_" + std::to_string(index + 1) + ".webp");
    const std::string foregroundPath = Paths::Find(root + "personaje_pantalla_carga_" + std::to_string(index + 1) + ".webp");
    std::error_code error;
    if (!std::filesystem::exists(backgroundPath, error) || error) {
        LogWarn("No se encontro el fondo de la ilustracion de carga: {}", backgroundPath);
        return;
    }
    if (!std::filesystem::exists(foregroundPath, error) || error) {
        LogWarn("No se encontro el personaje de la ilustracion de carga: {}", foregroundPath);
        return;
    }

    m_LoadingBackgrounds[static_cast<size_t>(index)] = Texture::LoadCached(backgroundPath, false);
    m_LoadingForegrounds[static_cast<size_t>(index)] = Texture::LoadCached(foregroundPath, false);
}

void UIManager::DrawLoadingArtwork() {
    const auto now = std::chrono::steady_clock::now();
    if (m_LoadingArtwork < 0 ||
        std::chrono::duration<float>(now - m_LoadingArtworkChangedAt).count() >= LoadingArtworkDuration) {
        if (m_LoadingArtworkDeckPosition >= m_LoadingArtworkDeck.size()) {
            for (size_t i = 0; i < m_LoadingArtworkDeck.size(); ++i) {
                m_LoadingArtworkDeck[i] = static_cast<int>(i);
            }
            static std::mt19937 randomEngine(
                static_cast<unsigned>(std::chrono::steady_clock::now().time_since_epoch().count()));
            std::shuffle(m_LoadingArtworkDeck.begin(), m_LoadingArtworkDeck.end(), randomEngine);
            if (m_LoadingArtworkDeck.size() > 1 &&
                m_LoadingArtworkDeck.front() == m_LoadingArtwork) {
                std::swap(m_LoadingArtworkDeck[0], m_LoadingArtworkDeck[1]);
            }
            m_LoadingArtworkDeckPosition = 0;
        }
        m_PreviousLoadingArtwork = m_LoadingArtwork;
        m_LoadingArtwork = m_LoadingArtworkDeck[m_LoadingArtworkDeckPosition++];
        LoadLoadingArtwork(m_LoadingArtwork);
        m_LoadingArtworkChangedAt = std::chrono::steady_clock::now();
    }

    ImDrawList* drawList = ImGui::GetBackgroundDrawList();
    const ImVec2 displaySize = ImGui::GetIO().DisplaySize;
    const auto drawPair = [&](int index, float alpha) {
        if (index < 0) return;
        const size_t artworkIndex = static_cast<size_t>(index);
        if (m_LoadingBackgrounds[artworkIndex] && m_LoadingForegrounds[artworkIndex]) {
            AddLoadingArtworkImage(drawList, *m_LoadingBackgrounds[artworkIndex], displaySize, false, alpha);
            AddLoadingArtworkImage(drawList, *m_LoadingForegrounds[artworkIndex], displaySize, true, alpha);
        }
    };

    const float elapsed = std::chrono::duration<float>(now - m_LoadingArtworkChangedAt).count();
    const float transition = std::clamp(elapsed / LoadingArtworkTransitionDuration, 0.0f, 1.0f);
    const size_t currentIndex = static_cast<size_t>(m_LoadingArtwork);
    const bool currentArtworkAvailable =
        m_LoadingBackgrounds[currentIndex] && m_LoadingForegrounds[currentIndex];
    if (!currentArtworkAvailable && m_PreviousLoadingArtwork >= 0) {
        drawPair(m_PreviousLoadingArtwork, 1.0f);
    } else {
        if (m_PreviousLoadingArtwork >= 0 && transition < 1.0f) {
            drawPair(m_PreviousLoadingArtwork, 1.0f - transition);
        }
        drawPair(m_LoadingArtwork, transition);
    }

    const ImU32 transparent = IM_COL32(5, 8, 13, 0);
    const ImU32 dark = IM_COL32(5, 8, 13, 210);
    drawList->AddRectFilledMultiColor(ImVec2(0.0f, displaySize.y * 0.40f), displaySize,
                                      transparent, transparent, dark, dark);
    drawList->AddRectFilledMultiColor(ImVec2(0.0f, 0.0f), ImVec2(displaySize.x * 0.72f, displaySize.y),
                                      IM_COL32(5, 8, 13, 165), IM_COL32(5, 8, 13, 0),
                                      IM_COL32(5, 8, 13, 0), IM_COL32(5, 8, 13, 165));
}

void UIManager::RenderLoadingScreen(Window& window, float progress, const std::string& stageText, const std::string& tipText) {
    window.PollEvents();
    glClearColor(0.06f, 0.07f, 0.08f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

    BeginFrame();
    DrawLoadingArtwork();

    ImGuiIO& io = ImGui::GetIO();
    ImGui::SetNextWindowPos(ImVec2(48.0f, io.DisplaySize.y - 36.0f), ImGuiCond_Always, ImVec2(0.0f, 1.0f));
    ImGui::SetNextWindowSize(ImVec2(std::max(1.0f, std::min(500.0f, io.DisplaySize.x - 64.0f)), 0.0f), ImGuiCond_Always);

    ImGuiWindowFlags flags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove |
                             ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_AlwaysAutoResize |
                             ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoInputs;

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));

    if (ImGui::Begin("LoadingModal", nullptr, flags)) {
        ImGui::SetWindowFontScale(1.55f);
        ImGui::TextColored(ImVec4(0.96f, 0.72f, 0.16f, 1.0f), "B A Z U K O");
        ImGui::SetWindowFontScale(1.0f);

        ImGui::TextDisabled("SUPERVIVENCIA URBANA · BOGOTÁ");
        ImGui::Spacing();
        ImGui::TextWrapped("%s", stageText.c_str());

        ImGui::PushStyleColor(ImGuiCol_PlotHistogram, ImVec4(0.88f, 0.58f, 0.15f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0.12f, 0.14f, 0.17f, 0.90f));
        char progressOverlay[32];
        snprintf(progressOverlay, sizeof(progressOverlay), "%.0f %%", std::clamp(progress, 0.0f, 1.0f) * 100.0f);
        ImGui::ProgressBar(std::clamp(progress, 0.0f, 1.0f), ImVec2(-1.0f, 16.0f), progressOverlay);
        ImGui::PopStyleColor(2);

        if (!tipText.empty()) {
            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.88f, 0.86f, 0.80f, 1.0f));
            ImGui::TextWrapped("%s", tipText.c_str());
            ImGui::PopStyleColor();
        }
    }
    ImGui::End();

    ImGui::PopStyleVar();

    EndFrame();
    window.SwapBuffers();
}

void UIManager::RenderHUD(float dt, const glm::vec3& playerPos, Camera& camera, Renderer& renderer, Window& window,
                          const CityLayout& city, const Simulation& simulation,
                          AudioManager& audio,
                          const std::string& playerName, const std::string& playerOrigin,
                          const std::array<float, 7>& needs, float money, float inventoryWeight, float inventoryCapacity,
                          float dayProgress, size_t pedestrians, size_t traffic, const std::string& inventorySummary,
                          const std::string& diseaseSummary, int level, int xp, const std::string& objective,
                          size_t missionProgress, size_t missionTarget,
                          const std::vector<CraftingOption>& craftingOptions,
                          const std::vector<InventoryOption>& inventoryOptions, int talentPoints,
                          const std::vector<TalentOption>& talentOptions, bool companionIsFriend,
                          const std::vector<DealerOption>& dealerOptions) {
    if (m_SaveNotificationTimer > 0.0f) {
        m_SaveNotificationTimer -= (dt > 0.0f ? dt : 0.016f);
        if (m_SaveNotificationTimer <= 0.0f) m_SaveNotification.clear();
    }
    if (m_PickupNotificationTimer > 0.0f) {
        m_PickupNotificationTimer -= (dt > 0.0f ? dt : 0.016f);
        if (m_PickupNotificationTimer <= 0.0f) m_PickupNotification.clear();
    }
    static const char* needNames[] = {"Hambre", "Sed", "Energia", "Salud", "Higiene", "Animo", "Vicio"};
    static const ImVec4 needColors[] = {
        {0.82f, 0.62f, 0.12f, 1.0f}, {0.20f, 0.48f, 0.88f, 1.0f},
        {0.63f, 0.38f, 0.80f, 1.0f}, {0.77f, 0.20f, 0.18f, 1.0f},
        {0.20f, 0.65f, 0.82f, 1.0f}, {0.61f, 0.31f, 0.75f, 1.0f},
        {0.90f, 0.48f, 0.12f, 1.0f}
    };
    static const float warningThresholds[] = {30.0f, 30.0f, 30.0f, 25.0f, 30.0f, 30.0f, 20.0f};
    const ImGuiWindowFlags hudFlags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_AlwaysAutoResize |
        ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing | ImGuiWindowFlags_NoNav |
        ImGuiWindowFlags_NoMove;
    const int totalMinutes = static_cast<int>(dayProgress * 1440.0f) % 1440;
    const int hour = totalMinutes / 60;
    const int minute = totalMinutes % 60;
    const float fps = dt > 0.0f ? 1.0f / dt : 0.0f;

    if (m_DeathScreenOpen) {
        ImGui::GetBackgroundDrawList()->AddRectFilled(ImVec2(0, 0), ImGui::GetIO().DisplaySize, IM_COL32(0, 0, 0, 225));
        ImGui::SetNextWindowSize(ImVec2(520, 0), ImGuiCond_Always);
        ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x * 0.5f,
                                      ImGui::GetIO().DisplaySize.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        if (ImGui::Begin("Fin de la partida", nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse |
                ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_AlwaysAutoResize)) {
            ImGui::TextColored(ImVec4(0.88f, 0.18f, 0.16f, 1.0f), "%s",
                               m_DeathByVehicleImpact ? "TE ATROPELLARON" : "TE QUEDASTE SIN SALUD");
            ImGui::Separator();
            ImGui::TextWrapped("Estado al caer: %s.", m_DeathCauses.empty() ? "salud agotada" : m_DeathCauses.c_str());
            ImGui::Spacing();
            ImGui::TextWrapped("Volverás al cambuche con salud y necesidades recuperadas al menos al 60 %. Se perderá la mitad de los tipos de objetos del inventario y se curarán las enfermedades.");
            if (m_DeathByVehicleImpact) {
                ImGui::TextWrapped("Mira ambos sentidos antes de cruzar; los vehículos necesitan espacio para frenar.");
            } else {
                ImGui::TextWrapped("Come, bebe y descansa para mantener tus necesidades.");
            }
            ImGui::Spacing();
            if (ImGui::Button("Volver al cambuche", ImVec2(-1, 40))) m_RespawnRequest = true;
            ImGui::TextDisabled("La partida permanece pausada hasta que elijas recuperarte.");
        }
        ImGui::End();
        return;
    }

    if (!m_Paused && !m_PickupNotification.empty() && m_PickupNotificationTimer > 0.0f) {
        const float alpha = std::clamp(m_PickupNotificationTimer / 0.5f, 0.0f, 1.0f);
        ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x * 0.5f,
                                      ImGui::GetIO().DisplaySize.y * 0.78f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        ImGui::SetNextWindowBgAlpha(0.82f * alpha);
        if (ImGui::Begin("PickupNotification", nullptr, hudFlags | ImGuiWindowFlags_NoInputs)) {
            const ImVec4 color = m_PickupNotificationRare
                ? ImVec4(1.0f, 0.78f, 0.25f, alpha)
                : ImVec4(0.94f, 0.94f, 0.90f, alpha);
            ImGui::TextColored(color, "%s", m_PickupNotification.c_str());
        }
        ImGui::End();
    }

    if (m_CraftMenuOpen && !m_Paused) {
        ImGui::SetNextWindowSize(ImVec2(520, 520), ImGuiCond_FirstUseEver);
        ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x * 0.5f,
                                      ImGui::GetIO().DisplaySize.y * 0.5f), ImGuiCond_FirstUseEver, ImVec2(0.5f, 0.5f));
        if (ImGui::Begin("Mesa de crafteo [C]", &m_CraftMenuOpen)) {
            ImGui::TextWrapped("Selecciona una receta. Los ingredientes se descuentan solo cuando se puede fabricar.");
            ImGui::Separator();
            for (const auto& option : craftingOptions) {
                ImGui::Text("%s", option.name.c_str());
                ImGui::TextDisabled("Ingredientes: %s", option.ingredients.c_str());
                ImGui::BeginDisabled(!option.craftable);
                ImGui::PushID(option.id.c_str());
                if (ImGui::Button("Craftear")) m_CraftRequest = option.id;
                ImGui::PopID();
                ImGui::EndDisabled();
                ImGui::Separator();
            }
            ImGui::TextWrapped("Hierba seca aparece en las recetas originales, pero no tiene resultado definido en items.js.");
            ImGui::TextDisabled("C o Esc: cerrar");
        }
        ImGui::End();
    }

    if (m_Paused) {
        ImGui::GetBackgroundDrawList()->AddRectFilled(ImVec2(0, 0), ImGui::GetIO().DisplaySize, IM_COL32(0, 0, 0, 115));
        ImGui::SetNextWindowSize(m_RadioMenuOpen ? ImVec2(620, 0) :
            (m_PauseSection == 0 ? ImVec2(660, 0) : ImVec2(640, 0)), ImGuiCond_Always);
        ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x * 0.5f,
                                      ImGui::GetIO().DisplaySize.y * 0.5f), ImGuiCond_Always, ImVec2(0.5f, 0.5f));
        const char* pauseTitle = m_RadioMenuOpen ? "Radio · Sintonizador" :
            (m_PauseSection == 1 ? "Inventario · Costal" :
             m_PauseSection == 2 ? "Árbol de talentos" :
             m_PauseSection == 3 ? "El Chato · Compañero" :
             m_PauseSection == 4 ? "Dealer · El Cartucho" : "Partida en pausa");
        if (ImGui::Begin(pauseTitle, nullptr, ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoCollapse |
                ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoMove)) {
            if (m_RadioMenuOpen) {
                ImGui::TextColored(ImVec4(0.96f, 0.72f, 0.16f, 1.0f), "SINTONIZADOR DE RADIO");
                ImGui::TextWrapped("Selecciona una emisora. La reproduccion de audio online se conectara en una etapa posterior.");
                ImGui::Separator();

                if (m_RadioStations.empty()) {
                    ImGui::TextWrapped("No hay emisoras cargadas. Revisa assets/radio_stations.json y los mensajes de inicio.");
                } else {
                    ImGui::Text("Emisoras disponibles");
                    for (size_t index = 0; index < m_RadioStations.size(); ++index) {
                        const RadioStation& station = m_RadioStations[index];
                        const std::string label = station.frequency + "  ·  " + station.name;
                        ImGui::PushID(station.id.c_str());
                        if (ImGui::Selectable(label.c_str(), m_SelectedRadioStation == index, 0, ImVec2(0.0f, 36.0f))) {
                            m_SelectedRadioStation = index;
                        }
                        ImGui::PopID();
                    }

                    const RadioStation& selected = m_RadioStations[m_SelectedRadioStation];
                    ImGui::Separator();
                    ImGui::Text("Sintonizada: %s", selected.name.c_str());
                    ImGui::Text("Frecuencia: %s", selected.frequency.c_str());
                    ImGui::TextWrapped("Genero: %s", selected.genre.c_str());
                    ImGui::TextWrapped("Programa: %s", selected.program.c_str());
                    ImGui::TextWrapped("URL configurada: %s", selected.streamUrl.empty() ? "(sin URL; emisora ficticia)" : selected.streamUrl.c_str());
                    ImGui::TextDisabled("La URL se guarda como configuracion; todavia no se reproduce audio en linea.");
                }

                ImGui::Separator();
                if (m_RadioReturnsToPause) {
                    if (ImGui::Button("Volver a pausa", ImVec2(-1, 36))) CloseRadioMenu();
                    ImGui::TextDisabled("Esc: volver al menu de pausa");
                } else {
                    if (ImGui::Button("Cerrar radio", ImVec2(-1, 36))) CloseRadioMenu();
                    ImGui::TextDisabled("R o Esc: cerrar radio");
                }
            } else if (m_PauseSection == 1) {
                ImGui::TextColored(ImVec4(0.20f, 0.55f, 0.94f, 1.0f), "INVENTARIO");
                ImGui::SameLine();
                ImGui::TextDisabled("Peso %.1f / %.0f kg", inventoryWeight, inventoryCapacity);
                ImGui::Separator();
                if (inventoryOptions.empty()) {
                    ImGui::TextDisabled("El costal está vacío. Rebusca en las bolsas para encontrar objetos.");
                } else {
                    if (ImGui::Button("Ordenar por nombre")) m_InventorySortRequest = true;
                    ImGui::BeginChild("InventoryGrid", ImVec2(0, 360), true);
                    for (const auto& item : inventoryOptions) {
                        ImGui::PushID(static_cast<int>(item.itemIndex));
                        ImGui::Text("%s  x%d", item.name.c_str(), item.quantity);
                        ImGui::SameLine();
                        ImGui::TextDisabled("%.1f kg c/u", item.weight);
                        ImGui::SameLine();
                        ImGui::BeginDisabled(!item.usable);
                        if (ImGui::SmallButton("Usar")) m_InventoryUseRequest = item.itemIndex;
                        ImGui::EndDisabled();
                        ImGui::SameLine();
                        if (ImGui::SmallButton("Soltar")) m_InventoryDropRequest = item.itemIndex;
                        ImGui::Separator();
                        ImGui::PopID();
                    }
                    ImGui::EndChild();
                }
                ImGui::TextDisabled("I o Esc: cerrar inventario");
                if (ImGui::Button("Cerrar inventario", ImVec2(-1, 36))) TogglePause();
            } else if (m_PauseSection == 2) {
                ImGui::TextColored(ImVec4(0.20f, 0.55f, 0.94f, 1.0f), "PUNTOS DISPONIBLES: %d", talentPoints);
                ImGui::TextWrapped("Invierte puntos ganados al subir de nivel. Cada talento puede desbloquearse una sola vez.");
                ImGui::Separator();
                ImGui::BeginChild("TalentTree", ImVec2(0, 390), true);
                const std::array<const char*, 3> branches{"RECOLECCIÓN", "SUPERVIVENCIA", "VIDA EN LA CALLE"};
                const std::array<const char*, 3> branchIds{"collector", "surv", "crime"};
                for (size_t branch = 0; branch < branches.size(); ++branch) {
                    ImGui::TextColored(ImVec4(0.24f, 0.58f, 0.93f, 1.0f), "%s", branches[branch]);
                    for (const auto& talent : talentOptions) {
                        if (talent.id.rfind(branchIds[branch], 0) != 0) continue;
                        ImGui::PushID(talent.id.c_str());
                        ImGui::Text("%s · %d punto%s", talent.name.c_str(), talent.cost, talent.cost == 1 ? "" : "s");
                        ImGui::SameLine();
                        if (talent.unlocked) {
                            ImGui::TextColored(ImVec4(0.35f, 0.84f, 0.52f, 1.0f), "APRENDIDO");
                        } else {
                            ImGui::BeginDisabled(!talent.available);
                            if (ImGui::SmallButton("Aprender")) m_TalentUnlockRequest = talent.id;
                            ImGui::EndDisabled();
                        }
                        ImGui::TextWrapped("%s", talent.description.c_str());
                        if (!talent.requirement.empty()) ImGui::TextDisabled("Requisito: %s", talent.requirement.c_str());
                        ImGui::Separator();
                        ImGui::PopID();
                    }
                    ImGui::Spacing();
                }
                ImGui::EndChild();
                ImGui::TextDisabled("T o Esc: cerrar talentos");
                if (ImGui::Button("Cerrar talentos", ImVec2(-1, 36))) TogglePause();
            } else if (m_PauseSection == 3) {
                ImGui::TextColored(ImVec4(0.20f, 0.55f, 0.94f, 1.0f), "%s", m_CompanionName.data());
                ImGui::TextWrapped("%s", companionIsFriend
                    ? "El Chato es tu compañero y te sigue por el barrio."
                    : "El Chato ronda el barrio. Acércate y pulsa E para hacer amistad.");
                ImGui::Separator();
                ImGui::Text("Nombre");
                if (ImGui::InputText("##CompanionName", m_CompanionName.data(), m_CompanionName.size())) {
                    if (m_CompanionName[0] == '\0') SetCompanionCustomization("El Chato", m_CompanionCoat);
                }
                ImGui::Spacing();
                ImGui::Text("Pelaje");
                const std::array<const char*, 4> coatNames{"Canela", "Marrón", "Gris", "Negro"};
                for (int coat = 0; coat < static_cast<int>(coatNames.size()); ++coat) {
                    if (coat > 0) ImGui::SameLine();
                    ImGui::PushID(coat);
                    if (ImGui::RadioButton(coatNames[static_cast<size_t>(coat)], m_CompanionCoat == coat)) {
                        m_CompanionCoat = coat;
                    }
                    ImGui::PopID();
                }
                ImGui::Spacing();
                ImGui::BeginDisabled(!companionIsFriend);
                if (ImGui::Button("Acariciar a El Chato", ImVec2(-1, 36))) m_PetRequest = true;
                ImGui::EndDisabled();
                ImGui::TextDisabled("La amistad, el nombre y el pelaje se guardan con la partida.");
                if (ImGui::Button("Cerrar ficha", ImVec2(-1, 36))) TogglePause();
            } else if (m_PauseSection == 4) {
                ImGui::TextColored(ImVec4(0.70f, 0.38f, 0.88f, 1.0f), "SUSTANCIAS DISPONIBLES");
                ImGui::TextWrapped("Compra al dealer. De noche puedes venderle las sustancias que lleves.");
                ImGui::Separator();
                for (const DealerOption& option : dealerOptions) {
                    ImGui::PushID(option.id.c_str());
                    ImGui::Text("%s", option.name.c_str());
                    ImGui::SameLine();
                    ImGui::TextDisabled("$ %d COP", option.price);
                    ImGui::SameLine();
                    ImGui::BeginDisabled(!option.affordable || !option.canCarry);
                    if (ImGui::SmallButton("Comprar")) m_DealerPurchaseRequest = option.id;
                    ImGui::EndDisabled();
                    if (!option.affordable) ImGui::TextDisabled("No tienes dinero suficiente.");
                    else if (!option.canCarry) ImGui::TextDisabled("No cabe en el costal.");
                    ImGui::Separator();
                    ImGui::PopID();
                }
                ImGui::TextDisabled("Esc: cerrar el puesto");
                if (ImGui::Button("Cerrar", ImVec2(-1, 36))) TogglePause();
            } else {
            ImGui::Text("Bogota · Nivel %d · $ %.0f COP", level, money);
            ImGui::Text("Salud %.0f%% · Hambre %.0f%% · Sed %.0f%% · Energia %.0f%%",
                        needs[3], needs[0], needs[1], needs[2]);
            ImGui::Text("Higiene %.0f%% · Animo %.0f%% · Vicio %.0f%%",
                        needs[4], needs[5], needs[6]);
            ImGui::Separator();
            ImGui::Text("Sonido y volumen");
            float volume = audio.GetVolume();
            float volumePercent = volume * 100.0f;
            if (ImGui::SliderFloat("Volumen maestro", &volumePercent, 0.0f, 100.0f, "%.0f%%")) {
                volume = volumePercent / 100.0f;
                audio.SetVolume(volume);
            }
            bool muted = audio.IsMuted();
            if (ImGui::Button(muted ? "Activar audio" : "Silenciar audio")) audio.SetMuted(!muted);
            ImGui::SameLine();
            if (ImGui::Button(window.IsFullscreen() ? "Modo ventana [F11]" : "Pantalla completa [F11]")) window.ToggleFullscreen();
            ImGui::Separator();
            ImGui::Text("Estado actual · Dia %d - %02d:%02d", static_cast<int>(dayProgress) + 1, hour, minute);
            ImGui::Text("Nivel %d · XP %d · Salud %.0f%% · Hambre %.0f%% · Sed %.0f%% · Energia %.0f%%",
                        level, xp, needs[3], needs[0], needs[1], needs[2]);
            ImGui::Text("Higiene %.0f%% · Animo %.0f%% · Vicio %.0f%%",
                        needs[4], needs[5], needs[6]);
            ImGui::Text("Costal %.1f / %.0f kg · Peatones %llu · Trafico %llu", inventoryWeight, inventoryCapacity,
                        static_cast<unsigned long long>(pedestrians), static_cast<unsigned long long>(traffic));
            ImGui::Separator();

            // Botones de guardado y partida
            if (ImGui::Button("Guardar partida ahora")) {
                m_SaveRequest = true;
            }
            if (!m_SaveNotification.empty() && m_SaveNotificationTimer > 0.0f) {
                ImGui::SameLine();
                ImGui::TextColored(ImVec4(0.35f, 0.90f, 0.45f, 1.0f), "%s", m_SaveNotification.c_str());
            }

            ImGui::Spacing();
            if (ImGui::Button("Empezar partida nueva")) {
                ImGui::OpenPopup("ConfirmNewGameModal");
            }
            ImGui::SameLine();
            if (ImGui::Button("Personaje [P]")) {
                m_CharacterCreatorRequest = true;
                TogglePause();
            }
            ImGui::SameLine();
            if (ImGui::Button("Inventario [I]")) OpenPauseSection(1);
            ImGui::SameLine();
            if (ImGui::Button("Talentos [T]")) OpenPauseSection(2);
            ImGui::SameLine();
            if (ImGui::Button("El Chato [O]")) OpenPauseSection(3);
            ImGui::SameLine();
            if (ImGui::Button(m_RadarVisible ? "Ocultar radar [N]" : "Mostrar radar [N]")) m_RadarVisible = !m_RadarVisible;
            if (ImGui::Button("Sintonizador de radio [R]", ImVec2(-1, 34))) OpenRadioMenu();

            if (ImGui::BeginPopupModal("ConfirmNewGameModal", nullptr, ImGuiWindowFlags_AlwaysAutoResize)) {
                ImGui::Text("¿Deseas empezar una partida completamente nueva?");
                ImGui::TextColored(ImVec4(0.95f, 0.70f, 0.20f, 1.0f), "Se reiniciara todo el progreso y se abrira el Creador de Personaje.");
                ImGui::Separator();
                if (ImGui::Button("Si, iniciar nueva partida", ImVec2(180, 32))) {
                    m_NewGameRequest = true;
                    TogglePause();
                    ImGui::CloseCurrentPopup();
                }
                ImGui::SameLine();
                if (ImGui::Button("Cancelar", ImVec2(100, 32))) {
                    ImGui::CloseCurrentPopup();
                }
                ImGui::EndPopup();
            }

            ImGui::Separator();
            ImGui::TextColored(ImVec4(0.20f, 0.55f, 0.94f, 1.0f), "MAPA COMPLETO DE TECLAS");
            ImGui::BeginChild("PauseControlsGuide", ImVec2(0, 236), true);
            ImGui::TextColored(ImVec4(0.96f, 0.72f, 0.16f, 1.0f), "Movimiento y camara");
            ImGui::BulletText("W, A, S, D: caminar en la direccion indicada por la camara.");
            ImGui::BulletText("Shift: correr. Flechas: girar la camara.");
            ImGui::BulletText("V: alternar tercera persona e isometrica. Rueda del raton: acercar/alejar.");
            ImGui::BulletText("Tab: capturar o liberar el cursor. Clic izquierdo/derecho: capturarlo; arrastrar con clic para girar.");
            ImGui::Separator();
            ImGui::TextColored(ImVec4(0.96f, 0.72f, 0.16f, 1.0f), "Acciones en el mundo");
            ImGui::BulletText("E: interaccion contextual: hablar, perro, cosquilleo, retrovisores, tienda, auto u objeto.");
            ImGui::BulletText("Q: recoger objetos; cerca de un peaton, intentar robo directo; junto al dealer, comprar sustancias.");
            ImGui::BulletText("E: en la recicladora, vender materiales; en el dealer, comprar o vender sustancias por la noche.");
            ImGui::BulletText("F: entregar reciclables de la mision en la recicladora.");
            ImGui::BulletText("B / L: pedir limosna (no disponible junto a tiendas).");
            ImGui::BulletText("Z: hacer popo. X: lanzar un mojón del costal; si no tienes, hacer popo.");
            ImGui::Separator();
            ImGui::TextColored(ImVec4(0.96f, 0.72f, 0.16f, 1.0f), "Menus y opciones");
            ImGui::BulletText("I: inventario. T: arbol de talentos. O: ficha de El Chato; vuelve a pulsar la tecla para cerrar.");
            ImGui::BulletText("C: abrir/cerrar crafteo. P: abrir el creador de personaje. R: abrir/cerrar la radio.");
            ImGui::BulletText("N: mostrar/ocultar radar. Esc: cerrar el menu activo o pausar/continuar.");
            ImGui::BulletText("F11: alternar pantalla completa. En pausa, usa el raton para los botones y guardar.");
            ImGui::EndChild();
            ImGui::Separator();
            if (ImGui::Button("Continuar jugando", ImVec2(-1, 38))) TogglePause();
            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Button, ImVec4(0.40f, 0.16f, 0.14f, 0.85f));
            ImGui::PushStyleColor(ImGuiCol_ButtonHovered, ImVec4(0.70f, 0.22f, 0.18f, 1.0f));
            ImGui::PushStyleColor(ImGuiCol_ButtonActive, ImVec4(0.85f, 0.25f, 0.20f, 1.0f));
            if (ImGui::Button("Guardar y salir del juego", ImVec2(-1, 36))) {
                m_QuitRequest = true;
            }
            ImGui::PopStyleColor(3);
            ImGui::TextDisabled("Esc: continuar jugando");
            }
        }
        ImGui::End();
    }

    ImGui::SetNextWindowPos(ImVec2(12, 8), ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.62f);
    if (ImGui::Begin("Topbar", nullptr, hudFlags)) {
        ImGui::TextColored(ImVec4(0.96f, 0.72f, 0.16f, 1.0f), "%s", playerName.empty() ? "Parcero" : playerName.c_str());
        if (!playerOrigin.empty()) {
            ImGui::SameLine();
            ImGui::TextDisabled("(%s)", playerOrigin.c_str());
        }
        ImGui::SameLine(); ImGui::Text("· Bogota - %02d:%02d", hour, minute);
        ImGui::SameLine(); ImGui::Text("$ %.0f COP", money);
        ImGui::SameLine(); ImGui::Text("Nv %d", level);
        ImGui::SameLine(); ImGui::TextDisabled("FPS %.0f", fps);
        ImGui::PushStyleColor(ImGuiCol_PlotHistogram, ImVec4(0.82f, 0.61f, 0.12f, 1.0f));
        ImGui::ProgressBar(std::clamp(static_cast<float>(xp) / std::max(1, level * 100), 0.0f, 1.0f), ImVec2(200, 5), "");
        ImGui::PopStyleColor();
        ImGui::End();
    }

    ImGui::SetNextWindowPos(ImVec2(12, ImGui::GetIO().DisplaySize.y - 15), ImGuiCond_Always, ImVec2(0, 1));
    ImGui::SetNextWindowBgAlpha(0.82f);
    if (ImGui::Begin("Necesidades", nullptr, hudFlags)) {
        for (size_t i = 0; i < needs.size(); ++i) {
            const float value = std::clamp(needs[i], 0.0f, 100.0f);
            const bool warning = value <= warningThresholds[i];
            const bool critical = i == 3 ? value <= 10.0f
                : i == 4 ? value <= 20.0f
                : i == 5 ? value <= 10.0f
                : i == 6 ? value <= 4.0f : value <= 0.0f;
            if (critical) ImGui::TextColored(ImVec4(1.0f, 0.32f, 0.25f, 1.0f), "%s", needNames[i]);
            else if (warning) ImGui::TextColored(ImVec4(1.0f, 0.72f, 0.24f, 1.0f), "%s", needNames[i]);
            else ImGui::Text("%s", needNames[i]);
            ImGui::SameLine(76.0f);
            ImVec4 barColor = needColors[i];
            if (critical) barColor = ImVec4(0.95f, 0.12f, 0.10f, 1.0f);
            else if (warning) barColor = ImVec4(0.98f, 0.62f, 0.14f, 1.0f);
            const std::string overlay = std::to_string(static_cast<int>(value + 0.5f)) + "%";
            ImGui::PushStyleColor(ImGuiCol_PlotHistogram, barColor);
            ImGui::ProgressBar(value / 100.0f, ImVec2(170, 14), overlay.c_str());
            ImGui::PopStyleColor();
        }
        if (needs[3] <= 10.0f) {
            ImGui::TextColored(ImVec4(1.0f, 0.35f, 0.27f, 1.0f), "Salud crítica: usa vendajes o evita los vehículos.");
        } else if (needs[3] <= 25.0f) {
            ImGui::TextColored(ImVec4(1.0f, 0.72f, 0.24f, 1.0f), "Salud baja: usa vendajes y evita los vehículos.");
        }
        ImGui::End();
    }

    ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x - 12, 12), ImGuiCond_Always, ImVec2(1, 0));
    ImGui::SetNextWindowBgAlpha(0.64f);
    if (ImGui::Begin("Costal", nullptr, hudFlags)) {
        ImGui::Text("Peso: %.1f / %.0f kg", inventoryWeight, inventoryCapacity);
        ImGui::End();
    }

    ImGui::SetNextWindowPos(ImVec2(12, 47), ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.48f);
    if (ImGui::Begin("Vista y objetivo", nullptr, hudFlags)) {
        if (ImGui::Button(camera.GetMode() == CameraMode::ThirdPerson ? "Tercera persona [V]" : "Isometrica [V]")) camera.ToggleMode();
        ImGui::SameLine();
        if (ImGui::Button(audio.IsMuted() ? "Activar audio" : "Silenciar audio")) audio.SetMuted(!audio.IsMuted());
        ImGui::SameLine();
        if (ImGui::Button("Personaje [P]")) m_CharacterCreatorRequest = true;
        ImGui::SameLine();
        if (ImGui::Button("Inventario [I]")) OpenPauseSection(1);
        ImGui::SameLine();
        if (ImGui::Button("Talentos [T]")) OpenPauseSection(2);
        ImGui::SameLine();
        if (ImGui::Button("El Chato [O]")) OpenPauseSection(3);
        ImGui::SameLine();
        if (ImGui::Button("Pausa [Esc]")) TogglePause();
        ImGui::TextWrapped("%s", objective.c_str());
        if (simulation.IsMissionComplete()) ImGui::TextColored(ImVec4(0.35f, 0.85f, 0.48f, 1.0f), "Mision completada");
        else if (simulation.IsMissionStarted()) ImGui::Text("Reciclables: %llu / %llu", static_cast<unsigned long long>(missionProgress), static_cast<unsigned long long>(missionTarget));
        else ImGui::TextDisabled("Acercate al marcador para iniciar la mision");
        ImGui::End();
    }

    if (!m_Paused && Input::IsKeyPressed(GLFW_KEY_N)) m_RadarVisible = !m_RadarVisible;
    if (m_RadarVisible) {
        const float radarSize = 156.0f;
        const ImVec2 radarPos(ImGui::GetIO().DisplaySize.x - radarSize - 12.0f, 46.0f);
        ImGui::SetNextWindowPos(radarPos, ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(radarSize, radarSize + 25.0f), ImGuiCond_Always);
        ImGui::SetNextWindowBgAlpha(0.78f);
        if (ImGui::Begin("Radar Bogota [N]", nullptr, hudFlags | ImGuiWindowFlags_NoScrollbar)) {
            const ImVec2 origin = ImGui::GetCursorScreenPos();
            const float mapSize = radarSize - 20.0f;
            const float range = 42.0f;
            const ImVec2 center(origin.x + mapSize * 0.5f, origin.y + mapSize * 0.5f);
            ImDrawList* draw = ImGui::GetWindowDrawList();
            draw->AddRectFilled(origin, ImVec2(origin.x + mapSize, origin.y + mapSize), IM_COL32(26, 29, 32, 245), 4.0f);
            constexpr int samples = 30;
            for (int z = 0; z < samples; ++z) for (int x = 0; x < samples; ++x) {
                const float worldX = playerPos.x + ((x + 0.5f) / samples * 2.0f - 1.0f) * range;
                const float worldZ = playerPos.z + ((z + 0.5f) / samples * 2.0f - 1.0f) * range;
                const int tileX = static_cast<int>(std::floor((worldX + CityLayout::WIDTH) / CityLayout::TILE_SIZE));
                const int tileZ = static_cast<int>(std::floor((worldZ + CityLayout::HEIGHT) / CityLayout::TILE_SIZE));
                const TileType tile = city.GetTileAt(tileX, tileZ);
                ImU32 color = IM_COL32(48, 50, 53, 255);
                if (tile == TileType::Road) color = IM_COL32(104, 106, 108, 255);
                else if (tile == TileType::Busway) color = IM_COL32(133, 87, 60, 255);
                else if (tile == TileType::Sidewalk || tile == TileType::Plaza) color = IM_COL32(115, 112, 105, 255);
                else if (tile == TileType::Grass) color = IM_COL32(62, 92, 58, 255);
                const ImVec2 cell0(origin.x + x * mapSize / samples, origin.y + z * mapSize / samples);
                const ImVec2 cell1(origin.x + (x + 1) * mapSize / samples + 0.5f, origin.y + (z + 1) * mapSize / samples + 0.5f);
                draw->AddRectFilled(cell0, cell1, color);
            }
            const float markerX = origin.x + mapSize * 0.5f;
            const float markerY = origin.y + mapSize * 0.5f;
            const auto drawWorldMarker = [&](const glm::vec3& position, float radius, ImU32 color) {
                const float dx = (position.x - playerPos.x) / range;
                const float dz = (position.z - playerPos.z) / range;
                if (std::abs(dx) <= 1.0f && std::abs(dz) <= 1.0f) {
                    draw->AddCircleFilled(ImVec2(center.x + dx * mapSize * 0.5f, center.y + dz * mapSize * 0.5f), radius, color);
                }
            };
            for (const auto& pickup : simulation.GetPickups()) drawWorldMarker(pickup.position, 2.0f, IM_COL32(248, 204, 78, 255));
            if (!simulation.IsMissionComplete()) drawWorldMarker(simulation.GetMissionNpcPosition(), 3.0f, IM_COL32(237, 84, 72, 255));
            drawWorldMarker(simulation.GetDogPosition(), 2.5f, IM_COL32(117, 184, 255, 255));
            draw->AddCircleFilled(ImVec2(markerX, markerY), 4.0f, IM_COL32(49, 220, 115, 255));
            draw->AddCircle(ImVec2(markerX, markerY), 7.0f, IM_COL32(12, 38, 24, 255));
            ImGui::Dummy(ImVec2(mapSize, mapSize));
            ImGui::End();
        }
    }

    const float displayHeight = ImGui::GetIO().DisplaySize.y;
    ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x - 12, 228), ImGuiCond_Always, ImVec2(1, 0));
    ImGui::SetNextWindowSize(ImVec2(190, std::max(120.0f, displayHeight - 250.0f)), ImGuiCond_Always);
    ImGui::SetNextWindowBgAlpha(0.76f);
    if (ImGui::Begin("Inventario", nullptr, ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings)) {
        ImGui::Text("Peso %.1f / %.0f kg", inventoryWeight, inventoryCapacity);
        ImGui::Separator();
        if (inventorySummary == "Vacio" || inventorySummary.empty()) ImGui::TextDisabled("Costal vacio");
        else {
            std::istringstream items(inventorySummary);
            std::string itemLine;
            while (std::getline(items, itemLine, '|')) {
                const size_t first = itemLine.find_first_not_of(" \t");
                const size_t last = itemLine.find_last_not_of(" \t");
                if (first != std::string::npos) ImGui::TextWrapped("%s", itemLine.substr(first, last - first + 1).c_str());
            }
        }
        if (ImGui::CollapsingHeader("Salud")) ImGui::TextWrapped("%s", diseaseSummary.c_str());
        ImGui::Separator();
        ImGui::TextDisabled("Peatones %llu | Trafico %llu", static_cast<unsigned long long>(pedestrians), static_cast<unsigned long long>(traffic));
        ImGui::End();
    }

    std::string interactionPrompt;
    const bool nearMissionNpc = simulation.IsNearMissionNpc(playerPos, 2.0f);
    const size_t nearbyCar = simulation.GetNearbyCar(playerPos, 2.0f);
    const size_t nearbyParkedCar = simulation.GetNearbyParkedCar(playerPos, 2.0f);
    const bool nearDealer = simulation.IsNearDealer(playerPos, 2.2f);
    const bool nearRecycler = simulation.IsNearRecycler(playerPos, 2.5f);
    const size_t nearbyVendor = simulation.GetNearbyVendor(playerPos, 2.0f);
    const size_t nearbyPedestrian = simulation.GetNearbyPedestrian(playerPos, 1.8f);
    const bool nearPickup = std::any_of(simulation.GetPickups().begin(), simulation.GetPickups().end(), [&](const PickupItem& pickup) {
        return pickup.available && !pickup.container && glm::distance(playerPos, pickup.position) < 1.8f;
    });
    const bool nearContainer = std::any_of(simulation.GetPickups().begin(), simulation.GetPickups().end(), [&](const PickupItem& pickup) {
        return pickup.available && pickup.container && glm::distance(playerPos, pickup.position) < 1.8f;
    });
    if (nearMissionNpc && !simulation.IsMissionStarted() && !simulation.IsMissionComplete()) interactionPrompt = "[E] Hablar con el vecino · iniciar mision";
    else if (simulation.IsNearDog(playerPos, 2.0f)) interactionPrompt = simulation.IsDogFriend()
        ? "[E] Acariciar a El Chato" : "[E] Acercarte a El Chato y hacer amistad";
    else if (nearDealer) interactionPrompt = simulation.IsNight()
        ? "[E] Vender sustancias (si llevas) · [Q] Comprar"
        : "[E] / [Q] Comprar sustancias al dealer";
    else if (nearRecycler) interactionPrompt = "[E] Vender reciclables · [F] Entregar objetos de la mision";
    else if (nearbyVendor < simulation.GetStreetVendorCount()) interactionPrompt = "[E] Comprar en " + simulation.GetVendor(nearbyVendor).name;
    else if (nearbyPedestrian < simulation.GetPedestrianCount()) interactionPrompt = "[E] Intentar cosquilleo · [Q] Robo directo";
    else if (nearbyParkedCar < simulation.GetParkedCarCount()) interactionPrompt = "[E] Robar retrovisores del auto estacionado";
    else if (nearbyCar < simulation.GetTrafficCount()) interactionPrompt = "[E] Intentar robar retrovisores del auto";
    else if (simulation.IsNearShop(playerPos, 2.2f)) interactionPrompt = "[E] Tienda · comprar un articulo";
    else if (nearContainer) interactionPrompt = "[E] Revisar caneca · buscar objetos";
    else if (nearPickup) interactionPrompt = "[E] Recoger objeto del suelo";
    else if (inventorySummary.find("Pan duro") != std::string::npos || inventorySummary.find("Botella agua") != std::string::npos || inventorySummary.find("Vendaje") != std::string::npos || inventorySummary.find("Curita") != std::string::npos || inventorySummary.find("Tinto") != std::string::npos || inventorySummary.find("Comida enlatada") != std::string::npos || inventorySummary.find("Refresco") != std::string::npos || inventorySummary.find("Tintico") != std::string::npos || inventorySummary.find("Pegante") != std::string::npos || inventorySummary.find("Pastilla") != std::string::npos || inventorySummary.find("Cigarrillo") != std::string::npos || inventorySummary.find("Jabón") != std::string::npos || inventorySummary.find("Cepillo") != std::string::npos || inventorySummary.find("Vacuna") != std::string::npos || inventorySummary.find("Carbón activo") != std::string::npos || inventorySummary.find("Jarabe") != std::string::npos || inventorySummary.find("Pomada") != std::string::npos || inventorySummary.find("Antiparasitario") != std::string::npos || inventorySummary.find("Antibiótico") != std::string::npos) interactionPrompt = "[E] Usar el primer consumible o medicamento del costal";
    if (!interactionPrompt.empty()) {
        ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x * 0.5f, ImGui::GetIO().DisplaySize.y - 42.0f), ImGuiCond_Always, ImVec2(0.5f, 1.0f));
        ImGui::SetNextWindowBgAlpha(0.82f);
        if (ImGui::Begin("Interaccion", nullptr, hudFlags)) {
            ImGui::TextUnformatted(interactionPrompt.c_str());
            ImGui::End();
        }
    }

    ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x - 330, 16), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowSize(ImVec2(314, 0), ImGuiCond_FirstUseEver);
    ImGui::SetNextWindowCollapsed(true, ImGuiCond_FirstUseEver);
    if (ImGui::Begin("Ajustes de Render & Clima")) {
        // Controles de ventana
        if (ImGui::Button(window.IsFullscreen() ? "Modo Ventana [F11]" : "Pantalla Completa [F11]")) {
            window.ToggleFullscreen();
        }
        ImGui::SameLine();
        if (ImGui::Button("Maximizar")) {
            window.Maximize();
        }

        ImGui::Separator();
        auto& lighting = renderer.GetLighting();
        ImGui::SliderFloat("Densidad Niebla", &lighting.fogDensity, 0.001f, 0.06f, "%.3f");
        ImGui::ColorEdit3("Color Niebla", &lighting.fogColor.r);
        ImGui::ColorEdit3("Luz Ambiente", &lighting.ambientColor.r);
        ImGui::ColorEdit3("Color Sol", &lighting.sunColor.r);

        static bool wireframe = false;
        if (ImGui::Checkbox("Modo Wireframe", &wireframe)) {
            renderer.SetWireframe(wireframe);
        }

        ImGui::Separator();
        ImGui::TextColored(ImVec4(0.95f, 0.70f, 0.20f, 1.0f), "Controles:");
        ImGui::BulletText("Mouse: Giro 360 continuo (confinado)");
        ImGui::BulletText("Tab / Esc: Mostrar/Ocultar cursor");
        ImGui::BulletText("F11: Pantalla completa");
        ImGui::BulletText("Flechas: Control de vista");
        ImGui::BulletText("W, A, S, D: Moverse");
        ImGui::BulletText("Shift: Correr");
        ImGui::BulletText("V: Tercera Persona / Isometrica");
        ImGui::BulletText("N: Mostrar / ocultar radar");
        ImGui::BulletText("Z: Hacer popo · X: Lanzar mojón si tienes uno");
        ImGui::BulletText("E / Q cerca de peatones: Cosquilleo / robo directo");
    }
    ImGui::End();
}

} // namespace Bazuko
