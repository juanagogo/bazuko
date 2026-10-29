#define IMGUI_DEFINE_MATH_OPERATORS
#include "UIManager.hpp"
#include <imgui.h>
#include <imgui_impl_glfw.h>
#include <imgui_impl_opengl3.h>
#include <GLFW/glfw3.h>
#include "../core/Input.hpp"
#include "../core/Log.hpp"
#include "../core/Paths.hpp"
#include "../renderer/Texture.hpp"
#include "SignStyle.hpp"
#include "../world/Viaduct.hpp"
#include <array>
#include <algorithm>
#include <cfloat>
#include <cmath>
#include <cstdio>
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

    SignUI::LoadFonts();
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
    // Mismo aspecto que el juego web: ver SignStyle.cpp
    SignUI::ApplyTheme();
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
    m_NewGameConfirmOpen = false;
    Input::SetCursorLocked(!m_Paused);
}

void UIManager::HandleEscape() {
    if (m_DeathScreenOpen) return;
    if (m_NewGameConfirmOpen) {
        m_NewGameConfirmOpen = false;   // Esc cancela la confirmacion y vuelve a la pausa
        return;
    }
    if (m_RadioMenuOpen) {
        CloseRadioMenu();
        return;
    }
    if (m_CraftMenuOpen) {
        m_CraftMenuOpen = false;
        return;
    }
    if (m_CambucheMenuOpen) {
        m_CambucheMenuOpen = false;
        Input::SetCursorLocked(true);
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

void UIManager::SelectPauseTab(int section) {
    m_PauseSection = section;
    m_RadioMenuOpen = false;
    m_RadioReturnsToPause = false;
    m_CraftMenuOpen = false;
    if (section == 8) m_MapNeedsCenter = true;
}

void UIManager::OpenMapSection() {
    if (m_DeathScreenOpen) return;
    if (m_Paused && m_PauseSection == 8) {
        TogglePause();
        return;
    }
    m_Paused = true;
    m_PauseSection = 8;
    m_MapNeedsCenter = true;
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

void UIManager::OpenShopMenu(const std::string& title, const std::string& subtitle, const std::vector<std::string>& itemKeys) {
    if (m_DeathScreenOpen) return;
    m_Paused = true;
    m_PauseSection = 5;
    m_ShopTitle = title;
    m_ShopSubtitle = subtitle;
    m_ShopFilter = itemKeys;
    m_ShopPurchaseRequest.clear();
    m_RadioMenuOpen = false;
    m_RadioReturnsToPause = false;
    m_CraftMenuOpen = false;
    Input::SetCursorLocked(false);
}

void UIManager::OpenDeveloperNote() {
    if (m_DeathScreenOpen) return;
    m_Paused = true;
    m_PauseSection = 7;
    m_RadioMenuOpen = false;
    m_RadioReturnsToPause = false;
    m_CraftMenuOpen = false;
    Input::SetCursorLocked(false);
}

void UIManager::OpenRecyclerMenu() {
    if (m_DeathScreenOpen) return;
    m_Paused = true;
    m_PauseSection = 6;
    m_RecyclerSellRequest = false;
    m_RadioMenuOpen = false;
    m_RadioReturnsToPause = false;
    m_CraftMenuOpen = false;
    Input::SetCursorLocked(false);
}

void UIManager::SetPlaceMenuData(const std::vector<ShopOption>& shop, const std::vector<RecyclerRow>& recycler,
                                 float money, float weight, float capacity) {
    m_ShopOptions = shop;
    m_RecyclerRows = recycler;
    m_PlaceMoney = money;
    m_PlaceWeight = weight;
    m_PlaceCapacity = capacity;
}

std::string UIManager::ConsumeShopPurchaseRequest() {
    std::string request = std::move(m_ShopPurchaseRequest);
    m_ShopPurchaseRequest.clear();
    return request;
}

bool UIManager::ConsumeRecyclerSellRequest() {
    const bool requested = m_RecyclerSellRequest;
    m_RecyclerSellRequest = false;
    return requested;
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

int UIManager::ConsumeGraphicsQualityRequest() {
    const int request = m_GraphicsQualityRequest;
    m_GraphicsQualityRequest = -1;
    return request;
}

int UIManager::ConsumeHotbarUseRequest() {
    const int request = m_HotbarUseRequest;
    m_HotbarUseRequest = -1;
    return request;
}

bool UIManager::ConsumeHotbarAssign(int& slot, size_t& itemIndex) {
    if (m_HotbarAssignSlot < 0) return false;
    slot = m_HotbarAssignSlot;
    itemIndex = m_HotbarAssignItem;
    m_HotbarAssignSlot = -1;
    return true;
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

void UIManager::SetCompanionCustomization(const std::string& name, int coat, float size, int accessory) {
    m_CompanionSize = std::clamp(size, 0.6f, 1.6f);
    m_CompanionAccessory = std::clamp(accessory, 0, 3);
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

void UIManager::DrawItemIcon(ImDrawList* draw, ImVec2 center, float size, const std::string& id, const std::string& name, unsigned int color) {
    auto found = m_ItemIcons.find(id);
    if (found == m_ItemIcons.end()) {
        std::shared_ptr<Texture> texture;
        const std::string path = Paths::Find("assets/icons/" + id + ".png");
        if (!path.empty() && std::filesystem::exists(path)) {
            try { texture = std::make_shared<Texture>(path, false); } catch (...) { texture.reset(); }
        }
        found = m_ItemIcons.emplace(id, std::move(texture)).first;
    }
    if (found->second) {
        const float half = size * 0.5f;
        draw->AddImage((ImTextureID)(intptr_t)found->second->GetID(), ImVec2(center.x - half, center.y - half), ImVec2(center.x + half, center.y + half),
                       ImVec2(0.0f, 0.0f), ImVec2(1.0f, 1.0f), color);
        return;
    }
    // sin silueta propia: medallon con la inicial del objeto
    draw->AddCircle(center, size * 0.42f, color, 32, 1.5f);
    const std::string initial = name.empty() ? "?" : name.substr(0, name.size() > 1 && static_cast<unsigned char>(name[0]) >= 0xC0 ? 2 : 1);
    ImFont* font = SignUI::GetFonts().monoBold14;
    const ImVec2 extent = font->CalcTextSizeA(size * 0.5f, FLT_MAX, 0.0f, initial.c_str());
    draw->AddText(font, size * 0.5f, ImVec2(center.x - extent.x * 0.5f, center.y - extent.y * 0.5f), color, initial.c_str());
}

void UIManager::Notify(const std::string& message, ToastType type) {
    if (message.empty()) return;
    // El mismo aviso repetido solo reinicia su tiempo
    for (Toast& toast : m_Toasts) {
        if (toast.text == message) {
            toast.remaining = 2.5f;
            return;
        }
    }
    m_Toasts.push_back({message, type, 2.5f});
    if (m_Toasts.size() > 4) m_Toasts.erase(m_Toasts.begin());
}

void UIManager::SetPickupNotification(const std::string& message, bool rare) {
    const auto has = [&](const char* part) { return message.find(part) != std::string::npos; };
    ToastType type = ToastType::Plain;
    if (rare) type = ToastType::Rare;
    else if (has("enfermaste") || has("Alarma") || has("descubrieron") || has("defendió") || has("Atropell")) type = ToastType::Death;
    else if (message.rfind("Vendiste", 0) == 0) type = ToastType::Sell;
    else if (message.rfind("No ", 0) == 0 || message.rfind("Espera", 0) == 0 || has("demasiado") || has("lleno") || has("rechaza")
             || has("ignoran") || has("Falló") || has("agotado") || has("mínimo")) type = ToastType::Warn;
    else if (message.rfind("Compraste", 0) == 0 || message.rfind("Construiste", 0) == 0 || has("curó") || has("Dormiste")
             || has("Entregaste") || has("Misión completa") || has("activada")) type = ToastType::Info;
    Notify(message, type);
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

    // Tarjeta de carga del juego web (#loading-screen .loading-card): etiqueta, titulo, lema, tres etapas, estado con porcentaje y barra de 6 px
    ImGuiIO& io = ImGui::GetIO();
    {
        namespace W = SignUI::Web;
        const ImVec2 display = io.DisplaySize;
        const float cardWidth = std::min(520.0f, display.x - 40.0f);
        const float left = std::clamp(display.x * 0.04f, 20.0f, 70.0f);
        const float bottom = std::clamp(display.y * 0.05f, 22.0f, 60.0f);
        const float titleSize = std::clamp(display.x * 0.06f, 36.0f, 60.0f);
        ImFont* titleFont = SignUI::Ov(true, 26);
        const float titleScale = titleSize / titleFont->FontSize;
        const float cardHeight = 24.0f + 14.0f + 12.0f + titleSize * 1.1f + 8.0f + 20.0f + 24.0f + 28.0f + 20.0f + 44.0f + 6.0f + 16.0f + 18.0f + 24.0f;
        const ImVec2 min(left, display.y - bottom - cardHeight), max(left + cardWidth, display.y - bottom);
        ImDrawList* draw = ImGui::GetForegroundDrawList();
        const ImU32 gold = IM_COL32(0xed, 0xc5, 0x5e, 255);
        for (int layer = 1; layer <= 6; ++layer)
            draw->AddRectFilled(min + ImVec2(-static_cast<float>(layer) * 4.0f, 16.0f - static_cast<float>(layer) * 4.0f), max + ImVec2(static_cast<float>(layer) * 4.0f, 16.0f + static_cast<float>(layer) * 4.0f), IM_COL32(0, 0, 0, 8), 16.0f + static_cast<float>(layer) * 4.0f);
        draw->AddRectFilledMultiColor(min, max, IM_COL32(0x10, 0x15, 0x1a, 235), IM_COL32(0x10, 0x15, 0x1a, 201), IM_COL32(0x10, 0x15, 0x1a, 201), IM_COL32(0x10, 0x15, 0x1a, 235));
        draw->AddRect(min, max, IM_COL32(0xed, 0xc5, 0x5e, 48), 16.0f, 0, 1.0f);
        float y = min.y + 24.0f;
        const float x = min.x + 24.0f, inner = cardWidth - 48.0f;
        W::Text(draw, SignUI::Ov(true, 11), ImVec2(x, y), gold, "BOGOTÁ · SUPERVIVENCIA URBANA", 1.76f);
        y += 12.0f + 12.0f;
        SignUI::AddSpacedText(draw, titleFont, titleSize, ImVec2(x, y - 2.0f), gold, "BAZUKO", titleSize * 0.15f);
        (void)titleScale;
        y += titleSize * 1.1f + 8.0f;
        W::Text(draw, SignUI::Ov(false, 16), ImVec2(x, y), IM_COL32(0xe3, 0xdc, 0xcd, 255), "Otra noche en la calle.");
        y += 24.0f + 24.0f;
        // etapas: la barra de 5 pasos se divide en Ciudad (0-1), Recursos (2-3) y Ultimos detalles (4-5)
        const float value = std::clamp(progress, 0.0f, 1.0f) * 5.0f;
        const int step = value < 2.0f ? 0 : value < 4.0f ? 1 : 2;
        static const std::array<const char*, 3> stepNames{{"Ciudad", "Recursos", "Últimos detalles"}};
        const float stepWidth = (inner - 32.0f) / 3.0f;
        for (int i = 0; i < 3; ++i) {
            const float sx = x + static_cast<float>(i) * (stepWidth + 16.0f);
            const bool active = i <= step || value >= 5.0f;
            draw->AddRectFilled(ImVec2(sx, y), ImVec2(sx + stepWidth, y + 2.0f), active ? gold : IM_COL32(255, 255, 255, 37));
            W::Text(draw, SignUI::Ov(false, 12), ImVec2(sx, y + 8.0f), active ? gold : IM_COL32(0xa9, 0xa9, 0x9f, 255), stepNames[static_cast<size_t>(i)]);
        }
        y += 20.0f + 20.0f;
        // estado y porcentaje
        char percent[16];
        std::snprintf(percent, sizeof(percent), "%d %%", static_cast<int>(std::round(std::clamp(progress, 0.0f, 1.0f) * 100.0f)));
        const float percentWidth = W::TextWidth(SignUI::Ov(true, 14), percent);
        draw->AddText(SignUI::Ov(false, 14), SignUI::Ov(false, 14)->FontSize, ImVec2(x, y), IM_COL32(0xec, 0xe3, 0xce, 255), stageText.c_str(), nullptr, inner - percentWidth - 12.0f);
        W::Text(draw, SignUI::Ov(true, 14), ImVec2(x + inner - percentWidth, y), gold, percent);
        y += 28.0f;
        // barra de progreso de 6 px
        draw->AddRectFilled(ImVec2(x, y), ImVec2(x + inner, y + 6.0f), IM_COL32(255, 255, 255, 32), 10.0f);
        const float fill = inner * std::clamp(progress, 0.0f, 1.0f);
        if (fill > 1.0f) draw->AddRectFilled(ImVec2(x, y), ImVec2(x + fill, y + 6.0f), gold, 10.0f);
        y += 6.0f + 16.0f;
        (void)tipText;
        const std::string hint = "Prepara el costal. Recoge materiales, busca comida y construye tu cambuche.";
        draw->AddText(SignUI::Ov(false, 12), SignUI::Ov(false, 12)->FontSize, ImVec2(x, y), IM_COL32(0xc3, 0xbf, 0xb5, 255), hint.c_str(), nullptr, inner);
    }

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
                          const std::vector<DealerOption>& dealerOptions,
                          bool boostActive, float boostTimer, float psychosisSeverity) {
    if (m_SaveNotificationTimer > 0.0f) {
        m_SaveNotificationTimer -= (dt > 0.0f ? dt : 0.016f);
        if (m_SaveNotificationTimer <= 0.0f) m_SaveNotification.clear();
    }
    for (Toast& toast : m_Toasts) toast.remaining -= (dt > 0.0f ? dt : 0.016f);
    std::erase_if(m_Toasts, [](const Toast& toast) { return toast.remaining <= 0.0f; });
    // Rendimiento: el intervalo real entre cuadros, aunque la simulacion limite su dt
    m_Metrics.Sample(ImGui::GetTime() * 1000.0, !m_Paused);
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
        SignUI::DrawBackdrop(0.85f);
        const ImVec4 blueText(0.84f, 0.89f, 1.0f, 1.0f);
        if (SignUI::BeginMenu("Fin de la partida", m_DeathByVehicleImpact ? "Te atropellaron" : "Te quedaste sin salud",
                              "La partida permanece pausada hasta que elijas recuperarte.", SignUI::Icon::Heart, nullptr, 520.0f, 440.0f)) {
            ImGui::PushStyleColor(ImGuiCol_Text, blueText);
            ImGui::TextWrapped("Estado al caer: %s.", m_DeathCauses.empty() ? "salud agotada" : m_DeathCauses.c_str());
            ImGui::Spacing();
            ImGui::TextWrapped("Volverás al cambuche con salud y necesidades recuperadas al menos al 60 %%. Se perderá la mitad de los tipos de objetos del inventario y se curarán las enfermedades.");
            ImGui::Spacing();
            if (m_DeathByVehicleImpact) {
                ImGui::TextWrapped("Mira ambos sentidos antes de cruzar; los vehículos necesitan espacio para frenar.");
            } else {
                ImGui::TextWrapped("Come, bebe y descansa para mantener tus necesidades.");
            }
            ImGui::PopStyleColor();
            SignUI::BeginFooter();
            if (SignUI::PrimaryButton("Volver al cambuche")) m_RespawnRequest = true;
        }
        SignUI::EndMenu();
        return;
    }

    if (!m_Paused && !m_WorldBubbles.empty()) {
        // Burbujas blancas con borde oscuro sobre la cabeza de cada peatón (.npc-bubble del original)
        const SignUI::Fonts& bubbleFonts = SignUI::GetFonts();
        ImDrawList* bubbleDraw = ImGui::GetBackgroundDrawList();
        const ImVec2 screen = ImGui::GetIO().DisplaySize;
        for (const WorldBubble& bubble : m_WorldBubbles) {
            const float sx = (bubble.x * 0.5f + 0.5f) * screen.x, sy = (-bubble.y * 0.5f + 0.5f) * screen.y;
            const ImVec2 size = bubbleFonts.monoBold14->CalcTextSizeA(13.0f, screen.x * 0.4f, 0.0f, bubble.text.c_str());
            const ImVec2 min(sx - size.x * 0.5f - 10.0f, sy - size.y - 24.0f), max(sx + size.x * 0.5f + 10.0f, sy - 8.0f);
            const int fade = static_cast<int>(240.0f * bubble.alpha);
            bubbleDraw->AddRectFilled(min, max, IM_COL32(255, 255, 255, fade), 12.0f);
            bubbleDraw->AddRect(min, max, IM_COL32(45, 52, 54, static_cast<int>(255.0f * bubble.alpha)), 12.0f, 0, 1.5f);
            bubbleDraw->AddTriangleFilled(ImVec2(sx - 6.0f, max.y - 0.5f), ImVec2(sx + 6.0f, max.y - 0.5f), ImVec2(sx, max.y + 6.0f), IM_COL32(255, 255, 255, fade));
            bubbleDraw->AddText(bubbleFonts.monoBold14, 13.0f, ImVec2(min.x + 10.0f, min.y + 6.0f), IM_COL32(26, 26, 36, static_cast<int>(255.0f * bubble.alpha)), bubble.text.c_str());
        }
    }

    if (!m_Paused && !m_Toasts.empty()) {
        // Avisos apilados cerca del borde superior (sobre el personaje, que queda hacia el centro), con borde de color segun el tipo (.loot-toast del juego web)
        const SignUI::Fonts& toastFonts = SignUI::GetFonts();
        ImDrawList* toastDraw = ImGui::GetForegroundDrawList();
        const ImVec2 display = ImGui::GetIO().DisplaySize;
        float y = display.y * 0.055f;
        for (const Toast& toast : m_Toasts) {
            const float alpha = std::clamp(toast.remaining / 0.5f, 0.0f, 1.0f);
            ImU32 accent = IM_COL32(102, 102, 102, 255);
            ImU32 text = IM_COL32(221, 221, 221, 255);
            switch (toast.type) {
            case ToastType::Rare: accent = text = IM_COL32(201, 162, 39, 255); break;
            case ToastType::Sell: accent = text = IM_COL32(42, 183, 202, 255); break;
            case ToastType::Warn: accent = text = IM_COL32(208, 160, 32, 255); break;
            case ToastType::Info: accent = text = IM_COL32(39, 174, 96, 255); break;
            case ToastType::Death: accent = text = IM_COL32(192, 57, 43, 255); break;
            case ToastType::Plain: break;
            }
            const auto fade = [&](ImU32 color) { return (color & 0x00FFFFFF) | (static_cast<ImU32>(((color >> 24) & 0xFF) * alpha) << 24); };
            const ImVec2 size = toastFonts.mono14->CalcTextSizeA(14.0f, display.x * 0.7f, 0.0f, toast.text.c_str());
            const ImVec2 min((display.x - size.x) * 0.5f - 16.0f, y);
            const ImVec2 max((display.x + size.x) * 0.5f + 16.0f, y + size.y + 16.0f);
            toastDraw->AddRectFilled(min, max, fade(IM_COL32(0, 0, 0, 217)));
            toastDraw->AddRectFilled(min, ImVec2(min.x + 3.0f, max.y), fade(accent));
            toastDraw->AddText(toastFonts.mono14, 14.0f, ImVec2(min.x + 16.0f, y + 8.0f), fade(text), toast.text.c_str(), nullptr, display.x * 0.7f);
            y = max.y + 6.0f;
        }
    }

    if (m_CraftMenuOpen && !m_Paused) RenderCraftWindow(craftingOptions, inventoryWeight, inventoryCapacity);

    if (m_Paused && m_NewGameConfirmOpen) {
        // Confirmacion: solo se ve este mensaje, centrado y fijo, sobre el juego oscurecido (el menu de pausa se oculta)
        using SignUI::Icon;
        SignUI::DrawBackdrop(0.7f);
        bool closeRequested = false;
        if (SignUI::BeginMenu("##ConfirmarPartidaNueva", "Partida nueva", "Se reiniciará todo el progreso", Icon::Home, &closeRequested, 520.0f, 330.0f)) {
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.84f, 0.89f, 1.0f, 1.0f));
            ImGui::TextWrapped("¿Deseas empezar una partida completamente nueva?");
            ImGui::PopStyleColor();
            ImGui::Spacing();
            ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.93f, 0.84f, 0.53f, 1.0f));
            ImGui::TextWrapped("Se reiniciará todo el progreso y se abrirá el Creador de Personaje.");
            ImGui::PopStyleColor();
            SignUI::BeginFooter();
            {   // los dos botones, centrados respecto al mensaje
                const auto buttonWidth = [](const char* label) {
                    return 28.0f + SignUI::SpacedTextWidth(SignUI::GetFonts().monoBold12, 12.0f, SignUI::Upper(label).c_str(), 1.0f);
                };
                const float total = buttonWidth("Sí, iniciar nueva partida") + 8.0f + buttonWidth("Cancelar");
                ImGui::SetCursorScreenPos(ImVec2(ImGui::GetWindowPos().x + ImGui::GetWindowWidth() * 0.5f - total * 0.5f, ImGui::GetCursorScreenPos().y));
                SignUI::FlexReset();
            }
            if (SignUI::Button("Sí, iniciar nueva partida", Icon::None, false, true)) {
                m_NewGameRequest = true;
                TogglePause();   // cierra la pausa y reinicia m_NewGameConfirmOpen
            }
            if (SignUI::Button("Cancelar")) closeRequested = true;
        }
        SignUI::EndMenu();
        if (closeRequested) m_NewGameConfirmOpen = false;   // vuelve al menu de pausa
    } else if (m_Paused && m_RadioMenuOpen) {
        RenderRadioMenu();
    } else if (m_Paused && m_PauseSection == 1) {
        RenderInventoryWindow(inventoryOptions, inventoryWeight, inventoryCapacity);
    } else if (m_Paused && m_PauseSection == 2) {
        RenderTalentWindow(talentOptions, talentPoints);
    } else if (m_Paused && m_PauseSection == 4) {
        RenderDealerWindow(dealerOptions, money);
    } else if (m_Paused && !m_RadioMenuOpen && (m_PauseSection == 0 || m_PauseSection == 3 || m_PauseSection == 8 || m_PauseSection == 9 || m_PauseSection == 10)) {
        PauseContext context;
        context.playerPos = playerPos;
        context.camera = &camera;
        context.city = &city;
        context.simulation = &simulation;
        context.audio = &audio;
        context.playerName = playerName;
        context.needs = &needs;
        context.money = money;
        context.level = level;
        context.xp = xp;
        context.dayProgress = dayProgress;
        context.companionIsFriend = companionIsFriend;
        RenderPauseTabs(context);
    } else if (m_Paused) {
        using SignUI::Icon;
        SignUI::DrawBackdrop(0.45f);
        SignUI::Fonts fonts = SignUI::GetFonts();   // copia: los menus de lugares usan Overpass como el juego web
        fonts.monoBold14 = SignUI::Ov(true, 15);
        fonts.monoBold13 = SignUI::Ov(true, 14);
        fonts.monoBold12 = SignUI::Ov(true, 13);
        const ImVec4 blueText(0.84f, 0.89f, 1.0f, 1.0f);
        const ImVec4 gold(0.93f, 0.84f, 0.53f, 1.0f);
        const auto fmt = [](const char* pattern, auto... values) {
            char buffer[160];
            std::snprintf(buffer, sizeof(buffer), pattern, values...);
            return std::string(buffer);
        };
        std::string pauseTitle = "Partida en pausa";
        std::string pauseSubtitle = "Vagabundo / Habitante de Calle · Bogotá";
        Icon pauseIcon = Icon::Pause;
        if (m_RadioMenuOpen) {
            pauseTitle = "Radio · Sintonizador";
            pauseSubtitle = "Emisoras AM/FM del barrio";
            pauseIcon = Icon::Radio;
        } else if (m_PauseSection == 1) {
            pauseTitle = "Inventario · Costal";
            pauseSubtitle = fmt("Peso %.1f / %.0f kg", inventoryWeight, inventoryCapacity);
            pauseIcon = Icon::Bag;
        } else if (m_PauseSection == 2) {
            pauseTitle = "Árbol de talentos";
            pauseSubtitle = fmt("Puntos disponibles: %d", talentPoints);
            pauseIcon = Icon::Star;
        } else if (m_PauseSection == 3) {
            pauseTitle = "El Chato · Compañero";
            pauseSubtitle = m_CompanionName.data();
            pauseIcon = Icon::Paw;
        } else if (m_PauseSection == 4) {
            pauseTitle = "Dealer · El Cartucho";
            pauseSubtitle = "Sustancias disponibles";
            pauseIcon = Icon::Pill;
        } else if (m_PauseSection == 5) {
            pauseTitle = m_ShopTitle;
            pauseSubtitle = m_ShopSubtitle;
            pauseIcon = Icon::Bag;
        } else if (m_PauseSection == 7) {
            pauseTitle = "Nota del desarrollador";
            pauseSubtitle = "Colaboración abierta";
            pauseIcon = Icon::Book;
        } else if (m_PauseSection == 6) {
            pauseTitle = "Recicladora El Progreso";
            pauseSubtitle = "Pagan de contado. Comida, remedios y sustancias no se reciben.";
            pauseIcon = Icon::Gear;
        }
        // Dinero (y carga) a la derecha del boton principal del pie
        const auto footerMoney = [&](bool showWeight) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 min = ImGui::GetItemRectMin();
            const ImVec2 max = ImGui::GetItemRectMax();
            float x = max.x + 16.0f;
            const float y = (min.y + max.y) * 0.5f - 7.0f;
            const auto put = [&](const char* text, ImU32 color) {
                draw->AddText(fonts.monoBold13, 13.0f, ImVec2(x, y), color, text);
                x += fonts.monoBold13->CalcTextSizeA(13.0f, FLT_MAX, 0.0f, text).x;
            };
            char buffer[64];
            put("Tienes ", IM_COL32(255, 255, 255, 255));
            std::snprintf(buffer, sizeof(buffer), "$ %.0f", m_PlaceMoney);
            put(buffer, IM_COL32(246, 196, 0, 255));
            if (showWeight) {
                x += 14.0f;
                std::snprintf(buffer, sizeof(buffer), "Carga %.1f / %.0f kg", m_PlaceWeight, m_PlaceCapacity);
                put(buffer, IM_COL32(214, 228, 255, 255));
            }
        };
        // ancho de la columna derecha de una fila: cantidad + botones
        const auto rowRight = [](float contentWidth) { return ImGui::GetWindowWidth() - 10.0f - contentWidth; };
        bool closeRequested = false;
        ImGui::PushFont(SignUI::Ov(false, 14));
        if (SignUI::BeginMenu(pauseTitle.c_str(), pauseTitle.c_str(), pauseSubtitle.c_str(), pauseIcon, &closeRequested,
                               560.0f, m_PauseSection == 7 ? 312.0f : 680.0f)) {
            if (m_RadioMenuOpen) {
                const RadioView& radio = m_RadioView;
                if (SignUI::BeginSection("Radio transistor", Icon::Radio)) {
                    SignUI::FlexReset();
                    if (SignUI::Button(radio.on ? "Apagar radio" : "Encender radio", Icon::Radio, radio.on)) m_RadioPowerRequest = true;
                    ImGui::SameLine(0.0f, 14.0f);
                    ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 11.0f);
                    ImGui::PushFont(fonts.monoBold12);
                    ImGui::TextColored(radio.on ? ImVec4(0.30f, 0.90f, 0.50f, 1.0f) : ImVec4(0.65f, 0.70f, 0.78f, 1.0f),
                                       radio.on ? "• TRANSMISIÓN ACTIVA" : "• APAGADA");
                    ImGui::PopFont();
                    ImGui::Spacing();
                    const int batteryPercent = static_cast<int>(radio.battery + 0.5f);
                    ImGui::Text("Batería: %d%%", batteryPercent);
                    ImGui::SameLine(0.0f, 12.0f);
                    SignUI::StatBar(radio.battery / 100.0f,
                                    batteryPercent > 30 ? IM_COL32(39, 174, 96, 255) : batteryPercent > 10 ? IM_COL32(243, 156, 18, 255) : IM_COL32(231, 76, 60, 255),
                                    180.0f, 10.0f, batteryPercent <= 10);
                    SignUI::FlexReset();
                    if (SignUI::Button("Poner pilas AA (+50%)", Icon::Bolt) && radio.hasBatteries && radio.battery < 100.0f) m_RadioBatteryRequest = true;
                    if (!radio.hasBatteries) SignUI::NoteText("No tienes pilas AA en el costal: cómpralas en la tienda o encuéntralas en la basura.");
                    ImGui::Spacing();
                    ImGui::AlignTextToFramePadding();
                    ImGui::TextUnformatted("Volumen:");
                    ImGui::SameLine(0.0f, 12.0f);
                    float radioVolume = radio.volume;
                    if (SignUI::Slider("volumenRadio", &radioVolume, 200.0f)) m_RadioVolumeRequest = radioVolume;
                    ImGui::SameLine(0.0f, 10.0f);
                    ImGui::TextColored(gold, "%d%%", static_cast<int>(radioVolume * 100.0f + 0.5f));
                    ImGui::Text("Señal: %d%%", static_cast<int>(radio.signal * 100.0f + 0.5f));
                }
                SignUI::EndSection();
                if (m_RadioStations.empty()) {
                    ImGui::TextWrapped("No hay emisoras cargadas. Revisa assets/radio_stations.json y los mensajes de inicio.");
                }
                for (size_t index = 0; index < m_RadioStations.size(); ++index) {
                    const RadioStation& station = m_RadioStations[index];
                    const bool selected = m_SelectedRadioStation == index;
                    if (SignUI::BeginRow(station.id.c_str(), static_cast<int>(index))) {
                        const float buttonWidth = SignUI::RowButtonWidth(selected ? "Sintonizada" : "Sintonizar");
                        const float rowTop = SignUI::RowBegin();
                        ImGui::PushFont(fonts.monoBold14);
                        ImGui::Text("%s  ·  %s", station.frequency.c_str(), station.name.c_str());
                        ImGui::PopFont();
                        SignUI::RowCluster(rowTop, rowRight(buttonWidth));
                        if (SignUI::RowButton(selected ? "Sintonizada" : "Sintonizar", !selected, selected)) {
                            m_SelectedRadioStation = index;
                            m_RadioTuned = true;
                        }
                        SignUI::RowBelow(rowTop);
                        ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                        ImGui::PushTextWrapPos(rowRight(buttonWidth + 8.0f));
                        ImGui::TextWrapped("%s · %s", station.genre.c_str(), station.program.c_str());
                        ImGui::PopTextWrapPos();
                        ImGui::PopStyleColor();
                    }
                    SignUI::EndRow();
                }
                SignUI::BeginFooter();
                if (SignUI::PrimaryButton(m_RadioReturnsToPause ? "Volver a pausa" : "Cerrar radio")) CloseRadioMenu();
            } else if (m_PauseSection == 1) {
                if (inventoryOptions.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                    ImGui::TextWrapped("El costal está vacío. Rebusca en las bolsas para encontrar objetos.");
                    ImGui::PopStyleColor();
                } else {
                    const size_t count = inventoryOptions.size();
                    constexpr int columns = 5;
                    constexpr float slotSize = 56.0f;
                    constexpr float slotGap = 6.0f;
                    if (m_InventorySelected >= count) m_InventorySelected = count - 1;
                    // Teclado: flechas o WASD mueven, Enter usa, X o Supr tiran (Mayús: todo), 1-5 asignan la barra rápida
                    const auto pressed = [](ImGuiKey a, ImGuiKey b) { return ImGui::IsKeyPressed(a, false) || ImGui::IsKeyPressed(b, false); };
                    if (pressed(ImGuiKey_RightArrow, ImGuiKey_D)) m_InventorySelected = std::min(count - 1, m_InventorySelected + 1);
                    if (pressed(ImGuiKey_LeftArrow, ImGuiKey_A) && m_InventorySelected > 0) --m_InventorySelected;
                    if (pressed(ImGuiKey_DownArrow, ImGuiKey_S) && m_InventorySelected + columns < count) m_InventorySelected += columns;
                    if (pressed(ImGuiKey_UpArrow, ImGuiKey_W) && m_InventorySelected >= static_cast<size_t>(columns)) m_InventorySelected -= columns;
                    const InventoryOption& chosen = inventoryOptions[m_InventorySelected];
                    if (pressed(ImGuiKey_Enter, ImGuiKey_KeypadEnter) && chosen.usable) m_InventoryUseRequest = chosen.itemIndex;
                    if (pressed(ImGuiKey_X, ImGuiKey_Delete)) {
                        m_InventoryDropRequest = chosen.itemIndex;
                        m_InventoryDropAll = ImGui::GetIO().KeyShift;
                    }
                    for (int slot = 0; slot < 5; ++slot) {
                        if (ImGui::IsKeyPressed(static_cast<ImGuiKey>(ImGuiKey_1 + slot), false) && chosen.usable) {
                            m_HotbarAssignSlot = slot;
                            m_HotbarAssignItem = chosen.itemIndex;
                        }
                    }

                    const ImVec2 base = ImGui::GetCursorScreenPos();
                    const float totalWidth = ImGui::GetContentRegionAvail().x;
                    const float gridWidth = columns * slotSize + (columns - 1) * slotGap;
                    ImDrawList* draw = ImGui::GetWindowDrawList();
                    const size_t slotCount = std::max<size_t>(20, ((count + columns - 1) / columns) * columns);
                    for (size_t index = 0; index < slotCount; ++index) {
                        const ImVec2 min(base.x + static_cast<float>(index % columns) * (slotSize + slotGap),
                                         base.y + static_cast<float>(index / columns) * (slotSize + slotGap));
                        const ImVec2 max(min.x + slotSize, min.y + slotSize);
                        const bool filled = index < count;
                        ImGui::SetCursorScreenPos(min);
                        ImGui::PushID(static_cast<int>(index));
                        if (ImGui::InvisibleButton("##casilla", ImVec2(slotSize, slotSize)) && filled) m_InventorySelected = index;
                        if (filled && ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0) && inventoryOptions[index].usable)
                            m_InventoryUseRequest = inventoryOptions[index].itemIndex;
                        const bool hovered = ImGui::IsItemHovered();
                        ImGui::PopID();
                        const bool selected = filled && index == m_InventorySelected;
                        draw->AddRectFilled(min, max, hovered ? IM_COL32(26, 44, 72, 245) : IM_COL32(14, 24, 40, 235), 6.0f);
                        draw->AddRect(min, max, selected ? IM_COL32(246, 196, 0, 255) : IM_COL32(74, 100, 140, 200), 6.0f, 0, selected ? 2.5f : 1.0f);
                        if (!filled) continue;
                        const InventoryOption& slotItem = inventoryOptions[index];
                        DrawItemIcon(draw, ImVec2((min.x + max.x) * 0.5f, min.y + slotSize * 0.42f), slotSize * 0.55f, slotItem.id, slotItem.name, IM_COL32(236, 240, 248, 255));
                        char amount[16];
                        std::snprintf(amount, sizeof(amount), "x%d", slotItem.quantity);
                        const float amountWidth = fonts.monoBold12->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, amount).x;
                        draw->AddText(fonts.monoBold12, 12.0f, ImVec2(max.x - amountWidth - 5.0f, max.y - 15.0f), IM_COL32(246, 196, 0, 255), amount);
                        if (slotItem.hotbarSlot >= 0) {
                            char key[4];
                            std::snprintf(key, sizeof(key), "%d", slotItem.hotbarSlot + 1);
                            draw->AddRectFilled(ImVec2(min.x + 3.0f, min.y + 3.0f), ImVec2(min.x + 15.0f, min.y + 16.0f), IM_COL32(246, 196, 0, 255), 3.0f);
                            draw->AddText(fonts.monoBold12, 12.0f, ImVec2(min.x + 6.0f, min.y + 2.0f), IM_COL32(14, 15, 18, 255), key);
                        }
                    }
                    const float gridHeight = static_cast<float>(slotCount / columns) * (slotSize + slotGap);

                    // Detalle del objeto seleccionado
                    const float detailX = base.x + gridWidth + 16.0f;
                    const float detailWidth = std::max(120.0f, base.x + totalWidth - detailX);
                    ImGui::SetCursorScreenPos(ImVec2(detailX, base.y));
                    ImGui::BeginGroup();
                    {
                        const ImVec2 iconBase = ImGui::GetCursorScreenPos();
                        draw->AddRectFilled(iconBase, ImVec2(iconBase.x + 64.0f, iconBase.y + 64.0f), IM_COL32(14, 24, 40, 235), 8.0f);
                        draw->AddRect(iconBase, ImVec2(iconBase.x + 64.0f, iconBase.y + 64.0f), IM_COL32(246, 196, 0, 220), 8.0f, 0, 1.5f);
                        DrawItemIcon(draw, ImVec2(iconBase.x + 32.0f, iconBase.y + 32.0f), 46.0f, chosen.id, chosen.name, IM_COL32(246, 220, 120, 255));
                        ImGui::Dummy(ImVec2(64.0f, 70.0f));
                    }
                    ImGui::PushTextWrapPos(ImGui::GetCursorPos().x + detailWidth);
                    ImGui::PushFont(fonts.monoBold14);
                    ImGui::TextUnformatted(chosen.name.c_str());
                    ImGui::PopFont();
                    if (!chosen.rarityLabel.empty()) ImGui::TextColored(gold, "%s", chosen.rarityLabel.c_str());
                    ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                    ImGui::TextWrapped("%s", chosen.description.c_str());
                    if (!chosen.effects.empty()) ImGui::TextWrapped("%s", chosen.effects.c_str());
                    ImGui::Text("%.1f kg c/u · %.1f kg", chosen.weight, chosen.weight * static_cast<float>(chosen.quantity));
                    ImGui::PopStyleColor();
                    ImGui::PopTextWrapPos();
                    ImGui::Spacing();
                    SignUI::FlexReset();
                    if (SignUI::Button("Usar", Icon::None, false, false) && chosen.usable) m_InventoryUseRequest = chosen.itemIndex;
                    if (SignUI::Button("Tirar 1")) { m_InventoryDropRequest = chosen.itemIndex; m_InventoryDropAll = false; }
                    if (SignUI::Button("Tirar todo")) { m_InventoryDropRequest = chosen.itemIndex; m_InventoryDropAll = true; }
                    if (SignUI::Button("Ordenar", Icon::Book)) m_InventorySortRequest = true;
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.78f, 0.84f, 0.95f, 0.65f));
                    ImGui::PushTextWrapPos(ImGui::GetCursorPos().x + detailWidth);
                    ImGui::TextWrapped(chosen.usable ? "Acceso rápido: pulsa 1-5 para asignar. Enter usa; X tira (Mayús: todo)."
                                                       : "Este objeto no se puede usar; X lo tira (Mayús: todo).");
                    ImGui::PopTextWrapPos();
                    ImGui::PopStyleColor();
                    ImGui::EndGroup();
                    ImGui::SetCursorScreenPos(ImVec2(base.x, base.y + std::max(gridHeight, ImGui::GetItemRectSize().y)));
                }
                SignUI::BeginFooter();
                if (SignUI::PrimaryButton("Cerrar inventario")) TogglePause();
                ImGui::SameLine(0.0f, 16.0f);
                ImGui::SetCursorPosY(ImGui::GetCursorPosY() + 11.0f);
                ImGui::TextColored(blueText, "Peso %.1f / %.0f kg", inventoryWeight, inventoryCapacity);
            } else if (m_PauseSection == 2) {
                ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                ImGui::TextWrapped("Invierte puntos ganados al subir de nivel. Cada talento puede desbloquearse una sola vez.");
                ImGui::PopStyleColor();
                ImGui::Spacing();
                const std::array<const char*, 3> branches{"Recolección", "Supervivencia", "Vida en la calle"};
                const std::array<const char*, 3> branchIds{"collector", "surv", "crime"};
                for (size_t branch = 0; branch < branches.size(); ++branch) {
                    if (!SignUI::BeginSection(branches[branch], Icon::Star)) { SignUI::EndSection(); continue; }
                    int rowIndex = 0;
                    for (const auto& talent : talentOptions) {
                        if (talent.id.rfind(branchIds[branch], 0) != 0) continue;
                        ImGui::PushID(talent.id.c_str());
                        if (SignUI::BeginRow("talento", rowIndex++)) {
                            const float buttonWidth = talent.unlocked ? 90.0f : SignUI::RowButtonWidth("Aprender");
                            const float rowTop = SignUI::RowBegin();
                            ImGui::PushFont(fonts.monoBold13);
                            ImGui::Text("%s", talent.name.c_str());
                            ImGui::PopFont();
                            ImGui::SameLine();
                            ImGui::TextColored(gold, "· %d punto%s", talent.cost, talent.cost == 1 ? "" : "s");
                            SignUI::RowCluster(rowTop, rowRight(buttonWidth));
                            if (talent.unlocked) {
                                ImGui::SetCursorPosY(rowTop + 7.0f);
                                ImGui::TextColored(ImVec4(0.45f, 0.90f, 0.62f, 1.0f), "APRENDIDO");
                            } else if (SignUI::RowButton("Aprender", talent.available, true)) {
                                m_TalentUnlockRequest = talent.id;
                            }
                            SignUI::RowBelow(rowTop);
                            ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                            ImGui::PushTextWrapPos(rowRight(buttonWidth + 8.0f));
                            ImGui::TextWrapped("%s", talent.description.c_str());
                            ImGui::PopTextWrapPos();
                            ImGui::PopStyleColor();
                            if (!talent.requirement.empty())
                                ImGui::TextColored(ImVec4(1.0f, 0.71f, 0.67f, 1.0f), "Requisito: %s", talent.requirement.c_str());
                        }
                        SignUI::EndRow();
                        ImGui::PopID();
                    }
                    SignUI::EndSection();
                }
                SignUI::BeginFooter();
                if (SignUI::PrimaryButton("Cerrar talentos")) TogglePause();
            } else if (m_PauseSection == 3) {
                ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                ImGui::TextWrapped("%s", companionIsFriend
                    ? "El Chato es tu compañero y te sigue por el barrio."
                    : "El Chato ronda el barrio. Acércate y pulsa E para hacer amistad.");
                ImGui::PopStyleColor();
                ImGui::Spacing();
                if (SignUI::BeginSection("Nombre y pelaje", Icon::Paw)) {
                    ImGui::SetNextItemWidth(-1.0f);
                    if (ImGui::InputText("##CompanionName", m_CompanionName.data(), m_CompanionName.size())) {
                        if (m_CompanionName[0] == '\0') SetCompanionCustomization("El Chato", m_CompanionCoat, m_CompanionSize, m_CompanionAccessory);
                    }
                    ImGui::Spacing();
                    const std::array<const char*, 4> coatNames{"Canela", "Marrón", "Gris", "Negro"};
                    SignUI::FlexReset();
                    for (int coat = 0; coat < static_cast<int>(coatNames.size()); ++coat) {
                        if (SignUI::Button(coatNames[static_cast<size_t>(coat)], Icon::None, m_CompanionCoat == coat)) m_CompanionCoat = coat;
                    }
                    ImGui::Spacing();
                    ImGui::TextColored(gold, "Accesorio");
                    const std::array<const char*, 4> accessoryNames{"Ninguno", "Bufanda roja", "Gorra bogotana", "Collar azul"};
                    SignUI::FlexReset();
                    for (int accessory = 0; accessory < static_cast<int>(accessoryNames.size()); ++accessory) {
                        if (SignUI::Button(accessoryNames[static_cast<size_t>(accessory)], Icon::None, m_CompanionAccessory == accessory))
                            m_CompanionAccessory = accessory;
                    }
                    ImGui::Spacing();
                    ImGui::AlignTextToFramePadding();
                    ImGui::TextUnformatted("Tamaño:");
                    ImGui::SameLine(0.0f, 12.0f);
                    float sizeFraction = (m_CompanionSize - 0.6f) / 1.0f;
                    if (SignUI::Slider("tamanoChato", &sizeFraction, 220.0f)) m_CompanionSize = 0.6f + std::clamp(sizeFraction, 0.0f, 1.0f);
                    ImGui::SameLine(0.0f, 10.0f);
                    ImGui::TextColored(gold, "%.1f×", m_CompanionSize);
                }
                SignUI::EndSection();
                SignUI::FlexReset();
                if (SignUI::Button("Acariciar a El Chato", Icon::Heart) && companionIsFriend) m_PetRequest = true;
                if (!companionIsFriend) SignUI::NoteText("Hazte amigo de El Chato (E) para acariciarlo.");
                SignUI::NoteText("La amistad, el nombre, el pelaje, el accesorio y el tamaño se guardan con la partida.");
                SignUI::BeginFooter();
                if (SignUI::PrimaryButton("Cerrar ficha")) TogglePause();
            } else if (m_PauseSection == 4) {
                ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                ImGui::TextWrapped("Compra al dealer. De noche puedes venderle las sustancias que lleves.");
                ImGui::PopStyleColor();
                ImGui::Spacing();
                int rowIndex = 0;
                for (const DealerOption& option : dealerOptions) {
                    ImGui::PushID(option.id.c_str());
                    if (SignUI::BeginRow("dealer", rowIndex++)) {
                        const float buttonWidth = SignUI::RowButtonWidth("Comprar");
                        const float rowTop = SignUI::RowBegin();
                        ImGui::PushFont(fonts.monoBold14);
                        ImGui::Text("%s", option.name.c_str());
                        ImGui::PopFont();
                        ImGui::SameLine(rowRight(buttonWidth + 110.0f));
                        ImGui::SetCursorPosY(rowTop + 7.0f);
                        ImGui::TextColored(ImVec4(0.96f, 0.77f, 0.0f, 1.0f), "$ %d COP", option.price);
                        SignUI::RowCluster(rowTop, rowRight(buttonWidth));
                        if (SignUI::RowButton("Comprar", option.affordable && option.canCarry, true)) m_DealerPurchaseRequest = option.id;
                        SignUI::RowBelow(rowTop);
                        if (!option.affordable) ImGui::TextColored(ImVec4(1.0f, 0.71f, 0.67f, 1.0f), "No tienes dinero suficiente.");
                        else if (!option.canCarry) ImGui::TextColored(ImVec4(1.0f, 0.71f, 0.67f, 1.0f), "No cabe en el costal.");
                    }
                    SignUI::EndRow();
                    ImGui::PopID();
                }
                SignUI::BeginFooter();
                if (SignUI::PrimaryButton("Cerrar")) TogglePause();
            } else if (m_PauseSection == 7) {
                // Misma nota que muestra el juego web al iniciar (los creditos siguen ocultos alli)
                ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14.0f, 12.0f));
                ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0.20f));
                ImGui::BeginChild("solicitud", ImVec2(0, 0), ImGuiChildFlags_AutoResizeY | ImGuiChildFlags_AlwaysUseWindowPadding, ImGuiWindowFlags_NoScrollbar);
                ImGui::PopStyleColor();
                ImGui::PopStyleVar();
                const ImVec2 start = ImGui::GetWindowPos();
                ImGui::GetWindowDrawList()->AddRectFilled(start, ImVec2(start.x + 3.0f, start.y + ImGui::GetWindowHeight()), IM_COL32(255, 223, 133, 255));
                ImGui::PushFont(fonts.monoBold14);
                ImGui::TextColored(ImVec4(1.0f, 0.875f, 0.52f, 1.0f), "Hagamos visibles las tareas pendientes");
                ImGui::PopFont();
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1, 1, 1, 1));
                ImGui::TextWrapped("A quienes mantienen y colaboran en el proyecto: por favor, publiquen las funcionalidades que se deben desarrollar como issues abiertos al público, indicando qué se necesita y su estado. Así cualquiera podrá conocer las tareas, proponer ideas y colaborar sin duplicar esfuerzos.");
                ImGui::PopStyleColor();
                ImGui::TextColored(ImVec4(1.0f, 0.875f, 0.52f, 1.0f), "github.com/juanagogo/bazuko/issues");
                ImGui::EndChild();
                SignUI::BeginFooter();
                if (SignUI::PrimaryButton("Continuar jugando")) TogglePause();
            } else if (m_PauseSection == 5) {
                int rowIndex = 0;
                for (const ShopOption& option : m_ShopOptions) {
                    ImGui::PushID(option.key.c_str());
                    if (SignUI::BeginRow("producto", rowIndex++)) {
                        const char* buttonLabel = option.owned ? "Listo" : "Comprar";
                        const float buttonWidth = SignUI::RowButtonWidth("Comprar");
                        const float rowTop = SignUI::RowBegin();
                        ImGui::PushFont(fonts.monoBold14);
                        ImGui::Text("%s", option.name.c_str());
                        ImGui::PopFont();
                        ImGui::SameLine(rowRight(buttonWidth + 92.0f));
                        ImGui::SetCursorPosY(rowTop + 7.0f);
                        ImGui::TextColored(ImVec4(0.96f, 0.77f, 0.0f, 1.0f), "$ %d", option.price);
                        SignUI::RowCluster(rowTop, rowRight(buttonWidth));
                        if (SignUI::RowButton(buttonLabel, option.enabled, true)) m_ShopPurchaseRequest = option.key;
                        SignUI::RowBelow(rowTop);
                        ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                        ImGui::PushTextWrapPos(rowRight(buttonWidth + 8.0f));
                        ImGui::TextWrapped("%s", option.description.c_str());
                        ImGui::PopTextWrapPos();
                        ImGui::PopStyleColor();
                    }
                    SignUI::EndRow();
                    ImGui::PopID();
                }
                SignUI::BeginFooter();
                if (SignUI::PrimaryButton("Cerrar")) TogglePause();
                footerMoney(true);
            } else if (m_PauseSection == 6) {
                int total = 0;
                for (const RecyclerRow& row : m_RecyclerRows) total += row.totalPrice;
                if (m_RecyclerRows.empty()) {
                    ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                    ImGui::TextWrapped("No traes nada para vender. Busca en las bolsas de basura: latas, botellas, cartón, chatarra y, con suerte, objetos de valor.");
                    ImGui::PopStyleColor();
                }
                int rowIndex = 0;
                for (const RecyclerRow& row : m_RecyclerRows) {
                    ImGui::PushID(rowIndex);
                    if (SignUI::BeginRow("venta", rowIndex++)) {
                        const float rowTop = SignUI::RowBegin();
                        ImGui::PushFont(fonts.monoBold14);
                        ImGui::Text("%s", row.name.c_str());
                        ImGui::PopFont();
                        ImGui::SameLine(rowRight(150.0f));
                        ImGui::SetCursorPosY(rowTop + 7.0f);
                        ImGui::TextColored(ImVec4(1, 1, 1, 1), "× %d", row.quantity);
                        ImGui::SameLine(rowRight(90.0f));
                        ImGui::SetCursorPosY(rowTop + 7.0f);
                        ImGui::TextColored(ImVec4(0.96f, 0.77f, 0.0f, 1.0f), "$ %d", row.totalPrice);
                        SignUI::RowBelow(rowTop - 8.0f);
                        ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                        ImGui::Text("$ %d c/u", row.unitPrice);
                        ImGui::PopStyleColor();
                    }
                    SignUI::EndRow();
                    ImGui::PopID();
                }
                SignUI::BeginFooter();
                char sellLabel[64];
                if (total > 0) std::snprintf(sellLabel, sizeof(sellLabel), "Vender todo · $ %d", total);
                else std::snprintf(sellLabel, sizeof(sellLabel), "Vender todo");
                if (SignUI::PrimaryButton(sellLabel, false, total > 0)) m_RecyclerSellRequest = true;
                footerMoney(false);
            } else {
                // ---- Sonido y volumen ----
                if (SignUI::BeginSection("Sonido y Volumen", Icon::Sound)) {
                    const bool muted = audio.IsMuted();
                    float volume = audio.GetVolume();
                    const float rowTop = ImGui::GetCursorPosY();
                    const float available = ImGui::GetContentRegionAvail().x;
                    const float buttonWidth = 14.0f + 22.0f + SignUI::SpacedTextWidth(fonts.monoBold12, 12.0f,
                        SignUI::Upper(muted ? "Activar" : "Silenciar").c_str(), 1.0f) + 14.0f;
                    ImGui::SetCursorPosY(rowTop + 11.0f);
                    ImGui::TextUnformatted("Volumen maestro:");
                    ImGui::SameLine(0.0f, 12.0f);
                    ImGui::SetCursorPosY(rowTop + 9.0f);
                    const float sliderWidth = std::max(80.0f, available - 118.0f - 12.0f - 12.0f - 44.0f - 12.0f - buttonWidth);
                    if (SignUI::Slider("volumen", &volume, sliderWidth)) audio.SetVolume(volume);
                    ImGui::SameLine(0.0f, 10.0f);
                    ImGui::SetCursorPosY(rowTop + 11.0f);
                    ImGui::PushFont(fonts.monoBold12);
                    ImGui::TextColored(gold, "%d%%", static_cast<int>(volume * 100.0f + 0.5f));
                    ImGui::PopFont();
                    ImGui::SameLine(available - buttonWidth);
                    ImGui::SetCursorPosY(rowTop);
                    SignUI::FlexReset();
                    if (SignUI::Button(muted ? "Activar" : "Silenciar", muted ? Icon::Mute : Icon::Sound)) audio.SetMuted(!muted);
                    // mezcla por categoria (se multiplica por el volumen maestro)
                    static const std::array<std::pair<const char*, MixCategory>, 4> mixRows{{
                        {"Ambiente", MixCategory::Ambient}, {"Tráfico", MixCategory::Traffic}, {"Voces", MixCategory::Voices}, {"Efectos", MixCategory::Effects}}};
                    for (const auto& [label, category] : mixRows) {
                        float level = audio.GetMix(category);
                        ImGui::PushID(label);
                        ImGui::TextUnformatted(label);
                        ImGui::SameLine(110.0f);
                        if (SignUI::Slider("mezcla", &level, std::max(80.0f, available - 200.0f))) audio.SetMix(category, level);
                        ImGui::SameLine(0.0f, 10.0f);
                        ImGui::TextColored(gold, "%d%%", static_cast<int>(level * 100.0f + 0.5f));
                        ImGui::PopID();
                    }
                }
                SignUI::EndSection();

                // ---- Rendimiento y calidad ----
                if (SignUI::BeginSection("Rendimiento y Calidad (FPS)", Icon::Bolt)) {
                    SignUI::FlexReset();
                    static const char* const qualityLabels[3] = {"Baja (Máx FPS)", "Media", "Alta (Detalle)"};
                    for (int quality = 0; quality < 3; ++quality)
                        if (SignUI::Button(qualityLabels[quality], quality == 1 ? Icon::Gear : Icon::Bolt, m_GraphicsQuality == quality))
                            m_GraphicsQualityRequest = quality;
                    ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.78f, 0.84f, 0.95f, 0.65f));
                    ImGui::TextWrapped("Resolución interna: baja 0,75×, media 1×, alta 1,25×. El panel de rendimiento muestra el efecto en los FPS.");
                    ImGui::PopStyleColor();
                }
                SignUI::EndSection();

                // ---- Estado actual ----
                if (SignUI::BeginSection("Estado Actual", Icon::Chart)) {
                    const float columnX = ImGui::GetCursorPosX() + ImGui::GetContentRegionAvail().x * 0.5f;
                    const auto pair = [&](const char* label, const std::string& value, bool second) {
                        if (second) ImGui::SameLine(columnX);
                        ImGui::TextColored(ImVec4(0.67f, 0.67f, 0.67f, 1.0f), "%s ", label);
                        ImGui::SameLine(0.0f, 0.0f);
                        ImGui::PushFont(fonts.monoBold13);
                        ImGui::TextUnformatted(value.c_str());
                        ImGui::PopFont();
                    };
                    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 6.0f));
                    pair("Personaje:", playerName.empty() ? "Parcero" : playerName, false);
                    pair("Dinero:", fmt("$ %.0f", money), true);
                    pair("Tiempo:", fmt("Día %d — %02d:%02d", m_Day, hour, minute), false);
                    if (!m_WeatherLabel.empty()) pair("Clima:", m_WeatherLabel + " · " + m_SeasonLabel, true);
                    pair("Nivel:", fmt("Nv %d · XP %d", level, xp), true);
                    pair("Salud:", fmt("%.0f%%", needs[3]), false);
                    pair("Sed / Hambre:", fmt("%.0f%% / %.0f%%", needs[1], needs[0]), true);
                    pair("Energía:", fmt("%.0f%%", needs[2]), false);
                    pair("Higiene:", fmt("%.0f%%", needs[4]), true);
                    pair("Ánimo:", fmt("%.0f%%", needs[5]), false);
                    pair("Vicio:", fmt("%.0f%%", needs[6]), true);
                    pair("Costal:", fmt("%.1f / %.0f kg", inventoryWeight, inventoryCapacity), false);
                    pair("Peatones / Tráfico:", fmt("%llu / %llu", static_cast<unsigned long long>(pedestrians),
                                                    static_cast<unsigned long long>(traffic)), true);
                    ImGui::PopStyleVar();
                }
                SignUI::EndSection();

                // ---- Opciones rápidas ----
                if (SignUI::BeginSection("Opciones Rápidas", Icon::Gear)) {
                    SignUI::FlexReset();
                    if (SignUI::Button("Radio transistor (R)", Icon::Radio)) OpenRadioMenu();
                    if (SignUI::Button("Guardar partida ahora", Icon::Save)) m_SaveRequest = true;
                    if (SignUI::Button(m_RadarVisible ? "Ocultar radar (N)" : "Mostrar radar (N)", Icon::Compass)) m_RadarVisible = !m_RadarVisible;
                    if (SignUI::Button(window.IsFullscreen() ? "Modo ventana (F11)" : "Pantalla completa (F11)", Icon::Camera)) window.ToggleFullscreen();
                    if (SignUI::Button("Personaje (P)", Icon::Person)) {
                        m_CharacterCreatorRequest = true;
                        TogglePause();
                    }
                    if (SignUI::Button("Mapa y GPS (M)", Icon::Compass)) OpenMapSection();
                    if (SignUI::Button("Inventario (I)", Icon::Bag)) OpenPauseSection(1);
                    if (SignUI::Button("Talentos (T)", Icon::Star)) OpenPauseSection(2);
                    if (SignUI::Button("El Chato (O)", Icon::Paw)) OpenPauseSection(3);
                    if (SignUI::Button("Empezar partida nueva", Icon::Home, false, true)) m_NewGameConfirmOpen = true;
                    if (!m_SaveNotification.empty() && m_SaveNotificationTimer > 0.0f)
                        ImGui::TextColored(ImVec4(0.45f, 0.92f, 0.55f, 1.0f), "%s", m_SaveNotification.c_str());
                }
                SignUI::EndSection();

                // ---- Guía de controles ----
                ImGui::PushStyleColor(ImGuiCol_Header, ImVec4(0, 0, 0, 0));
                ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(1, 1, 1, 0.06f));
                ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(1, 1, 1, 0.10f));
                ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(1.0f, 0.88f, 0.60f, 1.0f));
                ImGui::PushFont(fonts.monoBold13);
                const bool guideOpen = ImGui::CollapsingHeader("Guía completa de controles y supervivencia", ImGuiTreeNodeFlags_DefaultOpen);
                ImGui::PopFont();
                ImGui::PopStyleColor(4);
                if (guideOpen) {
                    static const char* const guide[][2] = {
                        {"WASD", "Desplazarse por el barrio."},
                        {"Ratón", "Clic para fijar cámara (o arrastrar) · Rueda para zoom."},
                        {"Flechas", "Girar la cámara."},
                        {"Shift", "Correr."},
                        {"V", "Alternar vista tercera persona / isométrica."},
                        {"E", "Interactuar con basura, tiendas, cambuche o autos."},
                        {"Q", "Recoger objetos, robo directo a peatones o comprar al dealer."},
                        {"F", "Entregar reciclables de la misión en la recicladora."},
                        {"B / L", "Pedir limosna a peatones."},
                        {"Z / X", "Hacer popo / lanzar un mojón."},
                        {"I / Tab", "Inventario: cuadrícula, detalle y tirar objetos."},
                        {"1-5", "Usar el objeto de la barra rápida (se asigna en el inventario)."},
                        {"T", "Abrir árbol de talentos."},
                        {"O", "Ficha de El Chato."},
                        {"C", "Abrir mesa de crafteo."},
                        {"P", "Modificar apariencia del personaje."},
                        {"N", "Alternar radar / minimapa urbano."},
                        {"R", "Abrir sintonizador de radio transistor AM/FM."},
                        {"F11", "Alternar pantalla completa."},
                        {"ESC", "Pausar el juego / cerrar paneles."},
                    };
                    ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(8.0f, 3.0f));
                    for (const auto& entry : guide) SignUI::KeyHint(entry[0], entry[1]);
                    ImGui::PopStyleVar();
                }
                SignUI::BeginFooter();
                if (SignUI::PrimaryButton("Continuar jugando")) TogglePause();
                ImGui::SameLine(0.0f, 14.0f);
                SignUI::FlexReset();
                if (SignUI::Button("Guardar y salir del juego", Icon::None, false, true)) m_QuitRequest = true;
            }
        }
        SignUI::EndMenu();
        ImGui::PopFont();
        if (closeRequested) {
            if (m_RadioMenuOpen) CloseRadioMenu();
            else TogglePause();
        }
    }

    if (!m_Paused || m_DeathScreenOpen) {
        // el HUD queda visible bajo los paneles (como en el juego web); solo se oculta al morir
    }
    {
        HudContext hud;
        hud.dt = dt;
        hud.playerPos = playerPos;
        hud.camera = &camera;
        hud.city = &city;
        hud.simulation = &simulation;
        hud.audio = &audio;
        hud.playerName = playerName;
        hud.needs = &needs;
        hud.money = money;
        hud.dayProgress = dayProgress;
        hud.diseaseSummary = diseaseSummary;
        hud.level = level;
        hud.xp = xp;
        hud.talentPoints = talentPoints;
        hud.objective = objective;
        hud.missionProgress = missionProgress;
        hud.missionTarget = missionTarget;
        hud.boostActive = boostActive;
        hud.boostTimer = boostTimer;
        hud.inventory = &inventoryOptions;
        RenderWebHud(hud);
    }

    // Viñeta roja oscura pulsante en los bordes de la pantalla durante psicosis
    if (psychosisSeverity > 0.0f && !m_Paused) {
        const float pulse = 0.5f + 0.5f * static_cast<float>(std::sin(ImGui::GetTime() * 4.0));
        const int alphaVal = static_cast<int>((75.0f + 65.0f * pulse) * psychosisSeverity);
        const ImU32 vigColor = IM_COL32(45, 6, 10, std::clamp(alphaVal, 0, 255));
        ImDrawList* bgDraw = ImGui::GetBackgroundDrawList();
        const ImVec2 dSize = ImGui::GetIO().DisplaySize;
        const float thickness = (35.0f + 15.0f * pulse) * psychosisSeverity;
        bgDraw->AddRectFilledMultiColor(ImVec2(0, 0), ImVec2(dSize.x, thickness), vigColor, vigColor, 0, 0);
        bgDraw->AddRectFilledMultiColor(ImVec2(0, dSize.y - thickness), ImVec2(dSize.x, dSize.y), 0, 0, vigColor, vigColor);
        bgDraw->AddRectFilledMultiColor(ImVec2(0, 0), ImVec2(thickness, dSize.y), vigColor, 0, 0, vigColor);
        bgDraw->AddRectFilledMultiColor(ImVec2(dSize.x - thickness, 0), ImVec2(dSize.x, dSize.y), 0, vigColor, vigColor, 0);

        // Susurros de paranoia flotantes
        static const std::array<const char*, 9> paranoiaWhispers{{
            "¿QUIÉN ESTÁ AHÍ?", "TE ESTÁN SIGUIENDO", "NO MIRES ATRÁS",
            "TODOS TE ESTÁN MIRANDO", "¡VIENEN POR TI!", "ESTÁN EN LAS PAREDES",
            "NO CONFÍES EN NADIE", "¡ESOS CARROS TE VIGILAN!", "¡CORRE!"
        }};
        m_WhisperTimer -= dt;
        if (m_WhisperTimer <= 0.0f) {
            static std::mt19937 whisperRand(777);
            std::uniform_int_distribution<size_t> pick(0, paranoiaWhispers.size() - 1);
            m_ActiveWhisper = paranoiaWhispers[pick(whisperRand)];
            m_ActiveWhisperTimer = 3.2f;
            std::uniform_real_distribution<float> randX(0.20f, 0.75f);
            std::uniform_real_distribution<float> randY(0.20f, 0.70f);
            m_WhisperPosX = randX(whisperRand);
            m_WhisperPosY = randY(whisperRand);
            m_WhisperTimer = 6.0f + std::uniform_real_distribution<float>(0.0f, 7.0f)(whisperRand);
        }
        if (m_ActiveWhisperTimer > 0.0f) {
            m_ActiveWhisperTimer -= dt;
            const float alpha = std::clamp(m_ActiveWhisperTimer / 0.7f, 0.0f, 0.92f);
            const ImVec2 whisperPos(ImGui::GetIO().DisplaySize.x * m_WhisperPosX,
                                    ImGui::GetIO().DisplaySize.y * m_WhisperPosY);
            ImGui::SetNextWindowPos(whisperPos, ImGuiCond_Always, ImVec2(0.5f, 0.5f));
            ImGui::SetNextWindowBgAlpha(0.75f * alpha);
            if (ImGui::Begin("WhisperOverlay", nullptr, hudFlags | ImGuiWindowFlags_NoInputs)) {
                ImGui::TextColored(ImVec4(1.0f, 0.22f, 0.22f, alpha), "\"%s\"", m_ActiveWhisper.c_str());
            }
            ImGui::End();
        }
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
    else if (nearContainer) interactionPrompt = "[E] Revisar caneca · mantén [Q] para clasificar (más botín)";
    else if (nearPickup) interactionPrompt = "[E] Recoger bolsa · mantén [Q] para clasificar (más botín)";
    else if (inventorySummary.find("Pan duro") != std::string::npos || inventorySummary.find("Botella agua") != std::string::npos || inventorySummary.find("Vendaje") != std::string::npos || inventorySummary.find("Curita") != std::string::npos || inventorySummary.find("Tinto") != std::string::npos || inventorySummary.find("Comida enlatada") != std::string::npos || inventorySummary.find("Refresco") != std::string::npos || inventorySummary.find("Tintico") != std::string::npos || inventorySummary.find("Pegante") != std::string::npos || inventorySummary.find("Pastilla") != std::string::npos || inventorySummary.find("Cigarrillo") != std::string::npos || inventorySummary.find("Jabón") != std::string::npos || inventorySummary.find("Cepillo") != std::string::npos || inventorySummary.find("Vacuna") != std::string::npos || inventorySummary.find("Carbón activo") != std::string::npos || inventorySummary.find("Jarabe") != std::string::npos || inventorySummary.find("Pomada") != std::string::npos || inventorySummary.find("Antiparasitario") != std::string::npos || inventorySummary.find("Antibiótico") != std::string::npos) interactionPrompt = "[E] Usar el primer consumible o medicamento del costal";
    if (!m_Paused && !m_DeathScreenOpen && std::any_of(m_Hotbar.begin(), m_Hotbar.end(), [](const HotbarSlot& slot) { return !slot.id.empty(); })) {
        // Barra de acceso rapido (teclas 1-5), abajo a la derecha: solo aparece cuando hay objetos asignados desde el inventario (#quickbar)
        const SignUI::Fonts& quickFonts = SignUI::GetFonts();
        const ImVec2 display = ImGui::GetIO().DisplaySize;
        constexpr float slotSize = 44.0f;
        constexpr float slotGap = 5.0f;
        const float barWidth = 5.0f * slotSize + 4.0f * slotGap;
        ImGui::SetNextWindowPos(ImVec2(display.x - 20.0f, display.y - 20.0f), ImGuiCond_Always, ImVec2(1.0f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        if (ImGui::Begin("Barra rapida", nullptr, hudFlags | ImGuiWindowFlags_NoBackground)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 base = ImGui::GetCursorScreenPos();
            for (int slot = 0; slot < 5; ++slot) {
                const HotbarSlot& entry = m_Hotbar[static_cast<size_t>(slot)];
                const ImVec2 min(base.x + static_cast<float>(slot) * (slotSize + slotGap), base.y);
                const ImVec2 max(min.x + slotSize, min.y + slotSize);
                ImGui::SetCursorScreenPos(min);
                ImGui::PushID(slot);
                if (ImGui::InvisibleButton("##rapida", ImVec2(slotSize, slotSize)) && !entry.id.empty() && entry.quantity > 0) m_HotbarUseRequest = slot;
                const bool hovered = ImGui::IsItemHovered();
                ImGui::PopID();
                const bool filled = !entry.id.empty();
                const float fade = filled ? 1.0f : 0.4f;
                draw->AddRectFilled(min, max, IM_COL32(0, 0, 0, static_cast<int>(153 * fade)));
                draw->AddRect(min, max, hovered ? IM_COL32(255, 209, 102, 255) : IM_COL32(85, 85, 85, static_cast<int>(255 * fade)));
                char key[4];
                std::snprintf(key, sizeof(key), "%d", slot + 1);
                draw->AddText(quickFonts.mono11, 10.0f, ImVec2(min.x + 3.0f, min.y + 1.0f), IM_COL32(74, 181, 232, static_cast<int>(255 * fade)), key);
                if (!filled) continue;
                DrawItemIcon(draw, ImVec2((min.x + max.x) * 0.5f, (min.y + max.y) * 0.5f), 26.0f, entry.id, entry.name, entry.quantity > 0 ? IM_COL32(236, 240, 248, 255) : IM_COL32(120, 128, 142, 255));
                char amount[16];
                std::snprintf(amount, sizeof(amount), "%d", entry.quantity);
                const float amountWidth = quickFonts.mono11->CalcTextSizeA(11.0f, FLT_MAX, 0.0f, amount).x;
                draw->AddText(quickFonts.mono11, 11.0f, ImVec2(max.x - amountWidth - 3.0f, max.y - 14.0f), IM_COL32(201, 162, 39, 255), amount);
            }
            ImGui::SetCursorScreenPos(base);
            ImGui::Dummy(ImVec2(barWidth, slotSize));
        }
        ImGui::End();
        ImGui::PopStyleVar();
    }

    if (m_SortProgress >= 0.0f && !m_Paused) {
        const bool complete = m_SortProgress >= 1.0f;
        ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x * 0.5f, ImGui::GetIO().DisplaySize.y - 178.0f), ImGuiCond_Always, ImVec2(0.5f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0.80f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.2f, 0.2f, 0.2f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(14.0f, 10.0f));
        if (ImGui::Begin("Clasificando", nullptr, hudFlags | ImGuiWindowFlags_NoInputs)) {
            ImGui::PushFont(SignUI::GetFonts().mono14);
            ImGui::TextColored(complete ? ImVec4(1.0f, 0.82f, 0.40f, 1.0f) : ImVec4(0.86f, 0.90f, 0.96f, 1.0f), "%s",
                               complete ? "¡Lista! Suelta Q para recoger" : "Clasificando basura… mantén Q");
            ImGui::PopFont();
            SignUI::StatBar(m_SortProgress, complete ? IM_COL32(255, 209, 102, 255) : IM_COL32(39, 174, 96, 255), 260.0f, 10.0f);
        }
        ImGui::End();
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(2);
    }

    if (!interactionPrompt.empty()) {
        // #interaction-prompt: pastilla oscura con borde y texto dorados, 160 px sobre el borde inferior
        ImFont* font = SignUI::Ov(true, 13);
        const float width = SignUI::Web::TextWidth(font, interactionPrompt.c_str()) + 28.0f;
        const ImVec2 display = ImGui::GetIO().DisplaySize;
        ImGui::SetNextWindowPos(ImVec2(display.x * 0.5f, display.y - 160.0f), ImGuiCond_Always, ImVec2(0.5f, 1.0f));
        ImGui::SetNextWindowSize(ImVec2(width, 32.0f), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        if (ImGui::Begin("Interaccion", nullptr, hudFlags | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoInputs)) {
            ImDrawList* draw = ImGui::GetWindowDrawList();
            const ImVec2 at = ImGui::GetWindowPos();
            draw->AddRectFilled(at + ImVec2(0, 2), at + ImVec2(width, 34), IM_COL32(0, 0, 0, 120), 9.0f);
            draw->AddRectFilled(at, at + ImVec2(width, 32.0f), IM_COL32(10, 10, 15, 230), 9.0f);
            draw->AddRect(at, at + ImVec2(width, 32.0f), IM_COL32(255, 209, 102, 255), 9.0f);
            SignUI::Web::Text(draw, font, at + ImVec2(14.0f, 8.0f), IM_COL32(255, 209, 102, 255), interactionPrompt.c_str());
        }
        ImGui::End();
        ImGui::PopStyleVar(2);
    }

    if (m_PerfVisible) {
        // Panel de rendimiento y coordenadas (#performance-panel): oculto al empezar, F3 o Ajustes lo muestran
        const FrameMetrics::Recent recent = m_Metrics.RecentStats();
        const auto fps = [&](float value) {
            char buffer[24];
            if (m_Metrics.frames) std::snprintf(buffer, sizeof(buffer), "%.1f", value);
            else std::snprintf(buffer, sizeof(buffer), "—");
            return std::string(buffer);
        };
        char lines[640];
        std::snprintf(lines, sizeof(lines),
            "FPS actual %s%s\nMín %s · Máx %s\nPromedio %s · %.1f ms\nÚltimos %zu cuadros · p95 %.1f ms · p99 %.1f ms\n"
            "1%% bajos %.1f FPS · Tirones >100 ms %d\nX %.2f  Y %.2f  Z %.2f\nResolución %.2f×%s",
            fps(m_Metrics.current).c_str(), m_Paused ? " · pausa" : "", fps(m_Metrics.min).c_str(), fps(m_Metrics.max).c_str(),
            fps(m_Metrics.average).c_str(), m_Metrics.frameMs, recent.frames, recent.p95, recent.p99, recent.low1Percent,
            recent.over100ms, playerPos.x, playerPos.y, playerPos.z, m_EffectiveScale, m_RenderPressure > 0 ? " · bajo presión" : "");
        ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x - 12.0f, ImGui::GetIO().DisplaySize.y - 78.0f), ImGuiCond_Always, ImVec2(1.0f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.035f, 0.067f, 0.082f, 0.88f));
        ImGui::PushStyleColor(ImGuiCol_Border, ImVec4(0.33f, 0.47f, 0.42f, 1.0f));
        ImGui::PushStyleColor(ImGuiCol_Text, ImVec4(0.85f, 0.976f, 0.90f, 1.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(12.0f, 10.0f));
        if (ImGui::Begin("Rendimiento", nullptr, hudFlags)) {
            ImGui::PushFont(SignUI::GetFonts().mono12);
            ImGui::TextUnformatted(lines);
            if (ImGui::SmallButton("Reiniciar medición")) m_Metrics.Reset();
            ImGui::PopFont();
        }
        ImGui::End();
        ImGui::PopStyleVar();
        ImGui::PopStyleColor(3);
    }

    // Panel de depuracion de iluminacion y ventana: solo con BAZUKO_DEBUG_UI=1 (el juego web no lo tiene)
    static const bool debugUi = std::getenv("BAZUKO_DEBUG_UI") != nullptr;
    if (debugUi) {
        ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x - 330, 120), ImGuiCond_FirstUseEver);
        ImGui::SetNextWindowSize(ImVec2(314, 0), ImGuiCond_FirstUseEver);
        if (ImGui::Begin("Ajustes de Render & Clima")) {
            if (ImGui::Button(window.IsFullscreen() ? "Modo Ventana [F11]" : "Pantalla Completa [F11]")) window.ToggleFullscreen();
            ImGui::SameLine();
            if (ImGui::Button("Maximizar")) window.Maximize();
            ImGui::Separator();
            auto& lighting = renderer.GetLighting();
            ImGui::SliderFloat("Densidad Niebla", &lighting.fogDensity, 0.001f, 0.06f, "%.3f");
            ImGui::ColorEdit3("Color Niebla", &lighting.fogColor.r);
            ImGui::ColorEdit3("Luz Ambiente", &lighting.ambientColor.r);
            ImGui::ColorEdit3("Color Sol", &lighting.sunColor.r);
            bool gamma = renderer.GetGammaCorrect();
            if (ImGui::Checkbox("Iluminación lineal (gamma sRGB)", &gamma)) renderer.SetGammaCorrect(gamma);
            static bool wireframe = false;
            if (ImGui::Checkbox("Modo Wireframe", &wireframe)) renderer.SetWireframe(wireframe);
        }
        ImGui::End();
    }
}

void UIManager::RenderCambucheMenu(const std::vector<CambuchePieceOption>& pieces, bool hasBase, bool isNight) {
    if (!m_CambucheMenuOpen) return;

    // Liberar el ratón mientras el menú está abierto
    Input::SetCursorLocked(false);

    using SignUI::Icon;
    SignUI::Fonts fonts = SignUI::GetFonts();   // Overpass como el resto de los menus de lugares del juego web
    fonts.monoBold14 = SignUI::Ov(true, 15);
    fonts.monoBold13 = SignUI::Ov(true, 14);
    fonts.monoBold12 = SignUI::Ov(true, 13);
    const ImVec4 blueText(0.84f, 0.89f, 1.0f, 1.0f);
    SignUI::DrawBackdrop(0.55f);
    bool closeRequested = false;
    ImGui::PushFont(SignUI::Ov(false, 14));
    if (SignUI::BeginMenu("Cambuche", "Cambuche · Refugio urbano", "Construye tu refugio paso a paso", Icon::Home, &closeRequested)) {
        ImGui::PushStyleColor(ImGuiCol_Text, blueText);
        ImGui::TextWrapped("Acércate a los materiales y recógelos antes de construir.");
        ImGui::PopStyleColor();
        ImGui::Spacing();

        int rowIndex = 0;
        for (const auto& piece : pieces) {
            ImGui::PushID(piece.id.c_str());
            if (SignUI::BeginRow("pieza", rowIndex++)) {
                const float statusWidth = piece.canBuild && !piece.isBuilt && !piece.isLocked ? SignUI::RowButtonWidth("Construir") : 128.0f;
                const ImVec2 at = ImGui::GetCursorScreenPos();
                const float rowTop = ImGui::GetCursorPosY();
                ImDrawList* draw = ImGui::GetWindowDrawList();
                if (piece.isBuilt) {
                    draw->AddCircleFilled(ImVec2(at.x + 10.0f, at.y + 15.0f), 9.0f, IM_COL32(25, 196, 99, 255), 16);
                    SignUI::DrawIcon(draw, Icon::Check, ImVec2(at.x + 10.0f, at.y + 15.0f), 14.0f);
                } else {
                    SignUI::DrawIcon(draw, Icon::Home, ImVec2(at.x + 10.0f, at.y + 15.0f), 18.0f, piece.isLocked ? 0.35f : 1.0f);
                }
                ImGui::SetCursorScreenPos(ImVec2(at.x + 30.0f, at.y + 7.0f));
                ImGui::PushFont(fonts.monoBold14);
                ImGui::TextColored(piece.isLocked ? ImVec4(0.6f, 0.65f, 0.72f, 1.0f) : ImVec4(1, 1, 1, 1), "%s", piece.name.c_str());
                ImGui::PopFont();
                SignUI::RowCluster(rowTop, ImGui::GetWindowWidth() - 10.0f - statusWidth);
                if (piece.isBuilt) {
                    ImGui::SetCursorPosY(rowTop + 7.0f);
                    ImGui::TextColored(ImVec4(0.62f, 0.94f, 0.75f, 1.0f), "Construido");
                } else if (piece.isLocked) {
                    ImGui::SetCursorPosY(rowTop + 7.0f);
                    ImGui::TextDisabled("Bloqueado");
                } else if (piece.canBuild) {
                    if (SignUI::RowButton("Construir", true, true)) m_CambucheBuildRequest = piece.id;
                } else {
                    ImGui::SetCursorPosY(rowTop + 7.0f);
                    ImGui::TextColored(ImVec4(1.0f, 0.71f, 0.67f, 1.0f), "Faltan materiales");
                }
                SignUI::RowBelow(rowTop);
                ImGui::SetCursorPosX(ImGui::GetCursorPosX() + 20.0f);
                ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                ImGui::PushTextWrapPos(ImGui::GetWindowWidth() - 18.0f - statusWidth);
                ImGui::TextWrapped("%s", piece.desc.c_str());
                ImGui::PopTextWrapPos();
                ImGui::PopStyleColor();
                if (!piece.reqText.empty()) {
                    ImGui::SetCursorPosX(ImGui::GetCursorPosX() + 30.0f);
                    ImGui::TextColored(piece.canBuild ? ImVec4(0.62f, 0.94f, 0.75f, 1.0f) : ImVec4(1.0f, 0.71f, 0.67f, 1.0f),
                                       "Requiere: %s", piece.reqText.c_str());
                }
            }
            SignUI::EndRow();
            ImGui::PopID();
        }

        ImGui::Spacing();
        if (hasBase) {
            if (!isNight) {
                ImGui::TextDisabled("Puedes dormir aquí de noche para recuperar energía.");
            } else {
                ImGui::PushStyleColor(ImGuiCol_Text, blueText);
                ImGui::TextWrapped("Es de noche. Puedes descansar en el cambuche.");
                ImGui::PopStyleColor();
                SignUI::FlexReset();
                if (SignUI::Button("Dormir (recupera energía y salud)", Icon::Heart)) {
                    m_SleepRequest = true;
                    m_CambucheMenuOpen = false;
                    Input::SetCursorLocked(true);
                }
            }
        } else {
            ImGui::TextColored(ImVec4(1.0f, 0.82f, 0.45f, 1.0f), "Construye la base para poder descansar aquí.");
        }

        SignUI::BeginFooter();
        if (SignUI::PrimaryButton("Cerrar (Esc)")) closeRequested = true;
    }
    SignUI::EndMenu();
    ImGui::PopFont();
    if (closeRequested) {
        m_CambucheMenuOpen = false;
        Input::SetCursorLocked(true);
    }
}

// Mapa grande de la pausa (como MapView del juego web): norte arriba, arrastrar mueve, la rueda acerca, clic marca el destino
// del GPS y clic derecho lo quita. Pinta el plano con la paleta del original y los bordes de manzana.
void UIManager::RenderMapView(const glm::vec3& playerPos, const CityLayout& city, const Simulation& simulation, ImVec2 origin, ImVec2 size) {
    const SignUI::Fonts& fonts = SignUI::GetFonts();
    namespace W = SignUI::Web;
    {
        ImDrawList* draw = ImGui::GetWindowDrawList();
        constexpr float sideWidth = 250.0f;
        // lienzo .map-view__canvas: alto = clamp(260, alto de la ventana - 290, 560)
        const float canvasHeight = std::clamp(size.y - 76.0f, 260.0f, 560.0f);
        const ImVec2 canvasMin(origin.x, origin.y);
        const ImVec2 canvasMax(origin.x + size.x - sideWidth - 12.0f, origin.y + canvasHeight);
        const float canvasWidth = canvasMax.x - canvasMin.x;

        const float worldWidth = CityLayout::WIDTH * CityLayout::TILE_SIZE;
        const float worldHeight = CityLayout::HEIGHT * CityLayout::TILE_SIZE;
        const float fitZoom = std::min(canvasWidth / worldWidth, canvasHeight / worldHeight) * 0.97f;
        const glm::vec2 cityCenter(worldWidth * 0.5f - CityLayout::ORIGIN_X, worldHeight * 0.5f - CityLayout::ORIGIN_Z);
        if (m_MapZoom <= 0.0f) m_MapZoom = std::max(fitZoom, 2.2f);   // abre acercado a la zona del jugador (2,2 px/m como el original)
        if (m_MapNeedsCenter) { m_MapCenter = {playerPos.x, playerPos.z}; m_MapNeedsCenter = false; }
        m_MapZoom = std::clamp(m_MapZoom, fitZoom, 9.0f);
        const auto toScreen = [&](float x, float z) {
            return ImVec2((canvasMin.x + canvasMax.x) * 0.5f + (x - m_MapCenter.x) * m_MapZoom, (canvasMin.y + canvasMax.y) * 0.5f + (z - m_MapCenter.y) * m_MapZoom);
        };
        const auto toWorld = [&](const ImVec2& p) {
            return glm::vec2(m_MapCenter.x + (p.x - (canvasMin.x + canvasMax.x) * 0.5f) / m_MapZoom, m_MapCenter.y + (p.y - (canvasMin.y + canvasMax.y) * 0.5f) / m_MapZoom);
        };

        // interaccion sobre el lienzo
        ImGui::SetCursorScreenPos(canvasMin);
        ImGui::InvisibleButton("##mapa", ImVec2(canvasWidth, canvasHeight), ImGuiButtonFlags_MouseButtonLeft | ImGuiButtonFlags_MouseButtonRight);
        const bool hovered = ImGui::IsItemHovered();
        ImGuiIO& io = ImGui::GetIO();
        if (hovered && std::abs(io.MouseWheel) > 0.01f) {   // el zoom conserva el punto bajo el cursor
            const glm::vec2 before = toWorld(io.MousePos);
            m_MapZoom = std::clamp(m_MapZoom * (io.MouseWheel > 0.0f ? 1.18f : 1.0f / 1.18f), fitZoom, 9.0f);
            const glm::vec2 after = toWorld(io.MousePos);
            m_MapCenter += before - after;
        }
        const bool dragging = ImGui::IsItemActive() && ImGui::IsMouseDragging(ImGuiMouseButton_Left, 4.0f);
        if (dragging) m_MapCenter -= glm::vec2(io.MouseDelta.x, io.MouseDelta.y) / m_MapZoom;

        draw->PushClipRect(canvasMin, canvasMax, true);
        draw->AddRectFilled(canvasMin, canvasMax, IM_COL32(11, 13, 17, 255));   // #0b0d11
        // Paleta del original (MAP_COLORS de CityMapRaster.js)
        const auto colorOf = [](char code) -> ImU32 {
            switch (code) {
                case 'r': return IM_COL32(0x24, 0x27, 0x2d, 255);   // calle
                case 'B': return IM_COL32(0x5b, 0x2c, 0x31, 255);   // carril exclusivo
                case 's': return IM_COL32(0x6b, 0x6e, 0x72, 255);   // anden
                case 'f': return IM_COL32(0x58, 0x5c, 0x61, 255);   // piso
                case 'p': return IM_COL32(0x77, 0x73, 0x6a, 255);   // plaza
                case 'd': return IM_COL32(0x5d, 0x4b, 0x37, 255);   // tierra
                case 'g': return IM_COL32(0x2f, 0x5b, 0x35, 255);   // pasto
                case 'W': return IM_COL32(0x1e, 0x5a, 0x86, 255);   // agua
                case 'R': return IM_COL32(0x4a, 0x40, 0x38, 255);   // ruina
                case 'w': return IM_COL32(0x15, 0x17, 0x1b, 255);   // muro
                case 'S': return IM_COL32(0x2c, 0x6b, 0x4b, 255);   // tienda D69
                case 'C': return IM_COL32(0x8a, 0x6d, 0x22, 255);   // torre Colpatria
                case 'A': return IM_COL32(0x6f, 0x6a, 0x5e, 255);   // anexo de Colpatria
                case 'M': return IM_COL32(0x45, 0x4b, 0x56, 255);   // edificio pequeno
                default: return IM_COL32(0x3b, 0x41, 0x4c, 255);    // edificio
            }
        };
        const auto isSolid = [](char code) { return code != 'r' && code != 'B' && code != 's' && code != 'f' && code != 'p' && code != 'd' && code != 'g' && code != 'W'; };
        const glm::vec2 topLeft = toWorld(canvasMin), bottomRight = toWorld(canvasMax);
        const int tx0 = std::max(0, static_cast<int>(std::floor((topLeft.x + CityLayout::ORIGIN_X) / CityLayout::TILE_SIZE)));
        const int tx1 = std::min(CityLayout::WIDTH - 1, static_cast<int>(std::floor((bottomRight.x + CityLayout::ORIGIN_X) / CityLayout::TILE_SIZE)));
        const int tz0 = std::max(0, static_cast<int>(std::floor((topLeft.y + CityLayout::ORIGIN_Z) / CityLayout::TILE_SIZE)));
        const int tz1 = std::min(CityLayout::HEIGHT - 1, static_cast<int>(std::floor((bottomRight.y + CityLayout::ORIGIN_Z) / CityLayout::TILE_SIZE)));
        const float tilePixels = CityLayout::TILE_SIZE * m_MapZoom;
        const float edge = std::max(1.0f, tilePixels * 0.25f);   // 1 de 4 px por casilla, como el plano del original
        for (int z = tz0; z <= tz1; ++z) {
            for (int x = tx0; x <= tx1; ++x) {
                const char code = city.GetMapCode(x, z);
                const ImVec2 a = toScreen(x * CityLayout::TILE_SIZE - CityLayout::ORIGIN_X, z * CityLayout::TILE_SIZE - CityLayout::ORIGIN_Z);
                const ImVec2 b(a.x + tilePixels + 0.6f, a.y + tilePixels + 0.6f);
                draw->AddRectFilled(a, b, colorOf(code));
                if (!isSolid(code)) continue;
                // bordes de manzana: claro arriba y a la izquierda, oscuro abajo y a la derecha
                const ImU32 light = IM_COL32(255, 255, 255, 23), dark = IM_COL32(0, 0, 0, 64);
                if (!isSolid(city.GetMapCode(x, z - 1))) draw->AddRectFilled(a, ImVec2(b.x, a.y + edge), light);
                if (!isSolid(city.GetMapCode(x - 1, z))) draw->AddRectFilled(a, ImVec2(a.x + edge, b.y), light);
                if (!isSolid(city.GetMapCode(x, z + 1))) draw->AddRectFilled(ImVec2(a.x, b.y - edge), b, dark);
                if (!isSolid(city.GetMapCode(x + 1, z))) draw->AddRectFilled(ImVec2(b.x - edge, a.y), b, dark);
            }
        }
        // tablero del viaducto: franja translucida sobre la calle inferior
        {
            std::vector<ImVec2> deck;
            for (float z = Viaduct::kStartZ; z <= Viaduct::kEndZ; z += 2.0f) deck.push_back(toScreen(Viaduct::BridgeCenter(z), z));
            if (deck.size() > 1) draw->AddPolyline(deck.data(), static_cast<int>(deck.size()), IM_COL32(205, 210, 220, 82), ImDrawFlags_RoundCornersAll, Viaduct::kHalfWidth * 2.0f * m_MapZoom);
        }
        // nombres de vias (solo con espacio para leerlos): carreras, Caracas y calles
        if (m_MapZoom > 1.1f) {
            const auto upper = [](std::string text) { for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c))); return text; };
            const auto& data = city.GetData();
            const auto labelColor = IM_COL32(214, 228, 255, 190);
            const ImVec2 cityTop = toScreen(0.0f, -CityLayout::ORIGIN_Z), cityBottom = toScreen(0.0f, worldHeight - CityLayout::ORIGIN_Z);
            const ImVec2 cityLeft = toScreen(-CityLayout::ORIGIN_X, 0.0f), cityRight = toScreen(worldWidth - CityLayout::ORIGIN_X, 0.0f);
            const auto vertical = [&](const std::string& name, float worldX) {
                const ImVec2 at = toScreen(worldX, 0.0f);
                if (at.x < canvasMin.x + 20.0f || at.x > canvasMax.x - 20.0f) return;
                const float y = std::min(std::max((canvasMin.y + canvasMax.y) * 0.5f - canvasHeight * 0.2f, cityTop.y + 50.0f), cityBottom.y - 50.0f);
                const std::string text = upper(name);
                const ImVec2 extent = fonts.monoBold12->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, text.c_str());
                // ImGui no gira texto: las letras se apilan de arriba hacia abajo, una bajo otra
                float cursor = y - 6.0f * static_cast<float>(text.size()) * 0.5f;
                for (char c : text) {
                    const char glyph[2] = {c, 0};
                    draw->AddText(fonts.monoBold12, 12.0f, ImVec2(at.x - 3.5f, cursor), labelColor, glyph);
                    cursor += 11.0f;
                }
            };
            const auto horizontal = [&](const std::string& name, float worldZ) {
                const ImVec2 at = toScreen(0.0f, worldZ);
                if (at.y < canvasMin.y + 20.0f || at.y > canvasMax.y - 20.0f) return;
                const float x = std::min(std::max((canvasMin.x + canvasMax.x) * 0.5f - canvasWidth * 0.2f, cityLeft.x + 50.0f), cityRight.x - 50.0f);
                const std::string text = upper(name);
                const ImVec2 extent = fonts.monoBold12->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, text.c_str());
                draw->AddText(fonts.monoBold12, 12.0f, ImVec2(x - extent.x * 0.5f, at.y - 6.0f), labelColor, text.c_str());
            };
            for (size_t i = 0; i < data.carreras.size() && i < data.carrerasNames.size(); ++i)
                vertical(data.carrerasNames[i], static_cast<float>(data.carreras[i].first + data.carreras[i].last) * 0.5f * CityLayout::TILE_SIZE);
            if (data.caracasLanes.size() >= 2)
                vertical("Av. Caracas", static_cast<float>(data.caracasLanes[0].first + data.caracasLanes[1].last) * 0.5f * CityLayout::TILE_SIZE);
            for (size_t i = 0; i < data.calles.size() && i < data.callesNames.size(); ++i)
                horizontal(data.callesNames[i], static_cast<float>(data.calles[i].first + data.calles[i].last) * 0.5f * CityLayout::TILE_SIZE);
        }
        // ruta: trazo negro de 7 px con el amarillo de 4 px encima
        if (m_GpsView.active && m_GpsView.route.size() > 1) {
            std::vector<ImVec2> line;
            for (const glm::vec2& point : m_GpsView.route) line.push_back(toScreen(point.x, point.y));
            draw->AddPolyline(line.data(), static_cast<int>(line.size()), IM_COL32(0, 0, 0, 178), ImDrawFlags_RoundCornersAll, 7.0f);
            draw->AddPolyline(line.data(), static_cast<int>(line.size()), IM_COL32(246, 196, 0, 255), ImDrawFlags_RoundCornersAll, 4.0f);
        }
        // lugares: circulo oscuro con el borde de su color y un icono
        struct Place { std::string name; glm::vec3 position; ImU32 color; SignUI::Icon icon; };
        std::vector<Place> places{
            {"Cambuche", simulation.GetCambuchePosition(), IM_COL32(255, 209, 102, 255), SignUI::Icon::Home},
            {"Recicladora", simulation.GetRecyclerPosition(), IM_COL32(42, 183, 202, 255), SignUI::Icon::Bag},
            {"Dealer", simulation.GetDealerPosition(), IM_COL32(155, 89, 182, 255), SignUI::Icon::Pill},
        };
        for (const auto& landmark : city.GetLandmarks()) {
            if (landmark.name == "Pasarela") continue;
            ImU32 color = IM_COL32(228, 89, 96, 255);
            SignUI::Icon icon = SignUI::Icon::Compass;
            if (landmark.name == "Gasolinera") { color = IM_COL32(0xf2, 0x5b, 0x5b, 255); icon = SignUI::Icon::Flame; }
            else if (landmark.name == "Torre Colpatria") { color = IM_COL32(0xff, 0xcb, 0x45, 255); icon = SignUI::Icon::Star; }
            else if (landmark.name == "Parque del Lago") { color = IM_COL32(0x5e, 0xd4, 0xdc, 255); icon = SignUI::Icon::Drop; }
            else if (landmark.name == "Tienda D69") { color = IM_COL32(0x3c, 0xc4, 0x7c, 255); icon = SignUI::Icon::Bag; }
            places.push_back({landmark.name, landmark.position, color, icon});
        }
        const Place* hoveredPlace = nullptr;
        for (const Place& place : places) {
            const ImVec2 at = toScreen(place.position.x, place.position.z);
            if (at.x < canvasMin.x - 20.0f || at.y < canvasMin.y - 20.0f || at.x > canvasMax.x + 20.0f || at.y > canvasMax.y + 20.0f) continue;
            const bool big = hovered && std::hypot(io.MousePos.x - at.x, io.MousePos.y - at.y) < 14.0f;
            if (big) hoveredPlace = &place;
            const float radius = big ? 12.0f : 10.0f;
            draw->AddCircleFilled(at, radius, IM_COL32(14, 15, 18, 217), 24);
            draw->AddCircle(at, radius, place.color, 24, 2.0f);
            SignUI::DrawIcon(draw, place.icon, at, 12.0f);
            if (big || m_MapZoom > 3.5f) {   // etiqueta sobre el lugar al pasar el cursor o con mucho zoom
                const ImVec2 extent = fonts.monoBold12->CalcTextSizeA(12.0f, FLT_MAX, 0.0f, place.name.c_str());
                const ImVec2 tag(at.x - extent.x * 0.5f, at.y - 18.0f - extent.y);
                draw->AddRectFilled(ImVec2(tag.x - 5.0f, tag.y - 2.0f), ImVec2(tag.x + extent.x + 5.0f, tag.y + extent.y + 2.0f), IM_COL32(14, 15, 18, 230), 3.0f);
                draw->AddText(fonts.monoBold12, 12.0f, tag, IM_COL32(245, 245, 245, 255), place.name.c_str());
            }
        }
        // destino: alfiler amarillo con centro oscuro
        if (m_GpsView.active) {
            const ImVec2 tip = toScreen(m_GpsView.waypoint.x, m_GpsView.waypoint.y);
            const ImVec2 head(tip.x, tip.y - 14.0f);
            draw->AddTriangleFilled(tip, ImVec2(head.x - 7.0f, head.y + 3.0f), ImVec2(head.x + 7.0f, head.y + 3.0f), IM_COL32(246, 196, 0, 255));
            draw->AddCircleFilled(head, 9.0f, IM_COL32(246, 196, 0, 255), 24);
            draw->AddCircle(head, 9.0f, IM_COL32(14, 15, 18, 255), 24, 2.0f);
            draw->AddCircleFilled(head, 3.2f, IM_COL32(14, 15, 18, 255), 12);
        }
        // jugador: flecha hacia donde mira la camara, con halo azul
        {
            const ImVec2 me = toScreen(playerPos.x, playerPos.z);
            glm::vec2 facing(playerPos.x - m_CameraPosition.x, playerPos.z - m_CameraPosition.z);
            facing = glm::length(facing) > 0.01f ? glm::normalize(facing) : glm::vec2(0.0f, -1.0f);
            const glm::vec2 side(-facing.y, facing.x);
            const auto at = [&](float forward, float lateral) { return ImVec2(me.x + facing.x * forward + side.x * lateral, me.y + facing.y * forward + side.y * lateral); };
            draw->AddCircleFilled(me, 13.0f, IM_COL32(11, 79, 163, 89), 24);
            const ImVec2 arrow[4] = {at(10.0f, 0.0f), at(-7.0f, 7.0f), at(-3.0f, 0.0f), at(-7.0f, -7.0f)};
            draw->AddConvexPolyFilled(arrow, 4, IM_COL32(255, 255, 255, 255));
            draw->AddPolyline(arrow, 4, IM_COL32(11, 79, 163, 255), ImDrawFlags_Closed, 2.0f);
        }
        draw->PopClipRect();
        draw->AddRect(canvasMin, canvasMax, IM_COL32(14, 15, 18, 255), 8.0f, 0, 3.0f);

        // leyenda (arriba a la izquierda), herramientas (arriba a la derecha) y ayuda (abajo), como .map-view__legend / __tools / __hint
        {
            struct Entry { const char* name; ImU32 color; };
            static const std::array<Entry, 6> legend{{{"Andén", IM_COL32(0x6b, 0x6e, 0x72, 255)}, {"Calle", IM_COL32(0x24, 0x27, 0x2d, 255)}, {"Parque", IM_COL32(0x2f, 0x5b, 0x35, 255)},
                                                      {"Agua", IM_COL32(0x1e, 0x5a, 0x86, 255)}, {"Edificio", IM_COL32(0x3b, 0x41, 0x4c, 255)}, {"Ruta", IM_COL32(246, 196, 0, 255)}}};
            ImFont* legendFont = SignUI::Ov(true, 11);
            float total = 20.0f;
            for (const Entry& entry : legend) total += 15.0f + W::TextWidth(legendFont, entry.name) + 10.0f;
            const ImVec2 legendMin(canvasMin.x + 10.0f, canvasMin.y + 10.0f);
            draw->AddRectFilled(legendMin, legendMin + ImVec2(total - 6.0f, 25.0f), IM_COL32(14, 15, 18, 204), 7.0f);
            float x = legendMin.x + 10.0f;
            for (const Entry& entry : legend) {
                const bool route = std::string(entry.name) == "Ruta";
                if (route) draw->AddRectFilled(ImVec2(x, legendMin.y + 10.0f), ImVec2(x + 10.0f, legendMin.y + 14.0f), entry.color, 2.0f);
                else {
                    draw->AddRectFilled(ImVec2(x, legendMin.y + 7.0f), ImVec2(x + 10.0f, legendMin.y + 17.0f), entry.color, 3.0f);
                    draw->AddRect(ImVec2(x, legendMin.y + 7.0f), ImVec2(x + 10.0f, legendMin.y + 17.0f), IM_COL32(255, 255, 255, 90), 3.0f);
                }
                W::Text(draw, legendFont, ImVec2(x + 15.0f, legendMin.y + 5.5f), IM_COL32(255, 255, 255, 255), entry.name);
                x += 15.0f + W::TextWidth(legendFont, entry.name) + 10.0f;
            }
            // herramientas: norte, acercar, alejar, centrar en el jugador y ver toda la ciudad
            const float toolX = canvasMax.x - 10.0f - 32.0f;
            draw->AddCircleFilled(ImVec2(toolX + 16.0f, canvasMin.y + 10.0f + 16.0f), 16.0f, IM_COL32(14, 15, 18, 217), 24);
            draw->AddCircle(ImVec2(toolX + 16.0f, canvasMin.y + 10.0f + 16.0f), 16.0f, IM_COL32(255, 255, 255, 64), 24, 1.0f);
            {
                const ImVec2 c(toolX + 16.0f, canvasMin.y + 26.0f);
                draw->AddTriangleFilled(ImVec2(c.x, c.y - 11.0f), ImVec2(c.x - 4.0f, c.y - 4.0f), ImVec2(c.x + 4.0f, c.y - 4.0f), IM_COL32(246, 196, 0, 255));
                W::Text(draw, SignUI::Ov(true, 12), ImVec2(c.x - 4.0f, c.y - 3.0f), IM_COL32(255, 255, 255, 255), "N");
            }
            struct Tool { const char* id; SignUI::Icon icon; };
            static const std::array<Tool, 4> tools{{{"acercar", SignUI::Icon::Plus}, {"alejar", SignUI::Icon::Minus}, {"centrar", SignUI::Icon::Target}, {"ciudad", SignUI::Icon::Expand}}};
            for (size_t i = 0; i < tools.size(); ++i) {
                const ImVec2 min(toolX, canvasMin.y + 10.0f + 36.0f + static_cast<float>(i) * 36.0f);
                ImGui::SetCursorScreenPos(min);
                ImGui::PushID(tools[i].id);
                const bool pressed = ImGui::InvisibleButton("##herramienta", ImVec2(32.0f, 32.0f));
                ImGui::PopID();
                const bool over = ImGui::IsItemHovered();
                draw->AddRectFilled(min, min + ImVec2(32, 32), over ? IM_COL32(246, 196, 0, 255) : IM_COL32(14, 15, 18, 217), 7.0f);
                draw->AddRect(min, min + ImVec2(32, 32), IM_COL32(255, 255, 255, 64), 7.0f);
                SignUI::DrawIcon(draw, tools[i].icon, min + ImVec2(16, 16), 17.0f);
                if (pressed) {
                    if (i == 0) m_MapZoom = std::clamp(m_MapZoom * 1.35f, fitZoom, 9.0f);
                    else if (i == 1) m_MapZoom = std::clamp(m_MapZoom / 1.35f, fitZoom, 9.0f);
                    else if (i == 2) m_MapCenter = {playerPos.x, playerPos.z};
                    else { m_MapZoom = fitZoom; m_MapCenter = cityCenter; }
                }
            }
            // ayuda: teclas blancas sobre el lienzo
            ImFont* hintFont = SignUI::Ov(true, 12);
            float hx = canvasMin.x + 10.0f;
            const float hy = canvasMax.y - 28.0f;
            const std::array<std::pair<const char*, const char*>, 3> hints{{{"Clic", "marcar"}, {"Clic der.", "quitar"}, {"Rueda", "zoom"}}};
            for (const auto& [key, text] : hints) {
                const float keyWidth = W::TextWidth(hintFont, key) + 14.0f;
                draw->AddRectFilled(ImVec2(hx, hy + 1.0f), ImVec2(hx + keyWidth, hy + 21.0f), IM_COL32(154, 163, 181, 255), 5.0f);
                draw->AddRectFilled(ImVec2(hx, hy + 1.0f), ImVec2(hx + keyWidth, hy + 18.0f), IM_COL32(255, 255, 255, 255), 5.0f);
                W::Text(draw, hintFont, ImVec2(hx + 7.0f, hy + 3.5f), W::kInk, key);
                const float textWidth = W::Text(draw, hintFont, ImVec2(hx + keyWidth + 6.0f, hy + 3.5f), IM_COL32(255, 255, 255, 255), text);
                hx += keyWidth + 6.0f + textWidth + 14.0f;
            }
        }

        // clic: marca destino (sobre un lugar usa su nombre); clic derecho: lo quita
        if (hovered && ImGui::IsMouseReleased(ImGuiMouseButton_Left) && !dragging && ImGui::GetMouseDragDelta(ImGuiMouseButton_Left, 4.0f).x == 0.0f
            && ImGui::GetMouseDragDelta(ImGuiMouseButton_Left, 4.0f).y == 0.0f) {
            const glm::vec2 target = hoveredPlace ? glm::vec2(hoveredPlace->position.x, hoveredPlace->position.z) : toWorld(io.MousePos);
            m_GpsSetPending = true;
            m_GpsSetPosition = target;
            m_GpsSetName = hoveredPlace ? hoveredPlace->name : "Punto marcado";
        }
        if (hovered && ImGui::IsMouseClicked(ImGuiMouseButton_Right)) m_GpsClearRequest = true;
        {
            const glm::vec2 cursor = hovered ? toWorld(io.MousePos) : glm::vec2(m_MapCenter.x, m_MapCenter.y);
            char coords[64];
            std::snprintf(coords, sizeof(coords), "X %.0f  Z %.0f", cursor.x, cursor.y);
            ImFont* coordFont = SignUI::Ov(true, 12);
            const float width = W::TextWidth(coordFont, coords);
            W::Text(draw, coordFont, ImVec2(canvasMax.x - width - 10.0f, canvasMax.y - 24.0f), IM_COL32(214, 228, 255, 255), coords);
        }

        // columna derecha: destino actual y lugares, del mas cercano al mas lejano
        const float sideX = canvasMax.x + 12.0f;
        ImGui::SetCursorScreenPos(ImVec2(sideX, canvasMin.y));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 10.0f));
        ImGui::BeginGroup();
        {
            const bool hasDestination = m_GpsView.active;
            const float boxHeight = hasDestination ? 112.0f : 66.0f;
            if (W::BeginPanel("##destino", sideWidth, boxHeight, ImVec2(12.0f, 10.0f), !hasDestination)) {
                ImDrawList* d = ImGui::GetWindowDrawList();
                const ImVec2 at = ImGui::GetCursorScreenPos();
                W::Text(d, SignUI::Ov(true, 11), at, IM_COL32(246, 196, 0, 255), hasDestination ? "DESTINO" : "SIN DESTINO", 1.1f);
                if (hasDestination) {
                    W::Text(d, SignUI::Ov(true, 16), at + ImVec2(0, 17), IM_COL32(255, 255, 255, 255), m_GpsView.name.c_str());
                    char meta[48];
                    if (m_GpsView.distance >= 1000.0f) std::snprintf(meta, sizeof(meta), "%.1f km a pie", m_GpsView.distance / 1000.0f);
                    else std::snprintf(meta, sizeof(meta), "%.0f m a pie", m_GpsView.distance);
                    W::Text(d, SignUI::Ov(true, 13), at + ImVec2(0, 40), IM_COL32(214, 228, 255, 255), meta);
                    ImGui::SetCursorScreenPos(at + ImVec2(0, 58));
                    if (W::Button("quitarDestino", "Quitar destino", SignUI::Icon::None, false, false, 32.0f, 12)) m_GpsClearRequest = true;
                } else {
                    d->AddText(SignUI::Ov(true, 13), SignUI::Ov(true, 13)->FontSize, at + ImVec2(0, 17), IM_COL32(214, 228, 255, 255), "Haz clic en el mapa o elige un lugar.", nullptr, sideWidth - 28.0f);
                }
            }
            W::EndPanel();
        }
        ImGui::Dummy(ImVec2(0, -6.0f));
        W::Text(ImGui::GetWindowDrawList(), SignUI::Ov(true, 12), ImGui::GetCursorScreenPos(), IM_COL32(214, 228, 255, 255), "IR A... (MÁS CERCA PRIMERO)", 1.2f);
        ImGui::Dummy(ImVec2(1, 14.0f));
        std::vector<const Place*> ordered;
        for (const Place& place : places) ordered.push_back(&place);
        const glm::vec2 here(playerPos.x, playerPos.z);
        std::sort(ordered.begin(), ordered.end(), [&](const Place* a, const Place* b) {
            return glm::distance(here, glm::vec2(a->position.x, a->position.z)) < glm::distance(here, glm::vec2(b->position.x, b->position.z));
        });
        const float listHeight = canvasMax.y - ImGui::GetCursorScreenPos().y;
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(0.0f, 4.0f));
        ImGui::BeginChild("##lugares", ImVec2(sideWidth, listHeight), ImGuiChildFlags_None, ImGuiWindowFlags_None);
        ImGui::PopStyleVar(2);
        {
            int placeId = 0;
            for (const Place* place : ordered) {
                ImGui::PushID(placeId++);
                const float distance = glm::distance(here, glm::vec2(place->position.x, place->position.z));
                const bool active = m_GpsView.active && m_GpsView.name == place->name;
                const float rowWidth = sideWidth - 12.0f;
                const bool pressed = ImGui::InvisibleButton("##lugar", ImVec2(rowWidth, 40.0f));
                const bool over = ImGui::IsItemHovered();
                ImDrawList* d = ImGui::GetWindowDrawList();
                const ImVec2 min = ImGui::GetItemRectMin(), max = ImGui::GetItemRectMax();
                d->AddRectFilled(min, max, active ? IM_COL32(246, 196, 0, 41) : IM_COL32(255, 255, 255, over ? 36 : 15), 6.0f);
                d->AddRect(min, max, active ? IM_COL32(246, 196, 0, 255) : IM_COL32(0, 0, 0, 0), 6.0f, 0, 2.0f);
                const ImVec2 iconCenter(min.x + 22.0f, (min.y + max.y) * 0.5f);
                d->AddCircleFilled(iconCenter, 13.0f, W::kCarcasa, 22);
                d->AddCircle(iconCenter, 13.0f, place->color, 22, 2.0f);
                SignUI::DrawIcon(d, place->icon, iconCenter, 13.0f);
                W::Text(d, SignUI::Ov(true, 14), ImVec2(min.x + 44.0f, (min.y + max.y) * 0.5f - 8.0f), IM_COL32(255, 255, 255, 255), place->name.c_str());
                char label[32];
                if (distance >= 1000.0f) std::snprintf(label, sizeof(label), "%.1fkm", distance / 1000.0f);
                else std::snprintf(label, sizeof(label), "%.0fm", distance);
                const float labelWidth = W::TextWidth(SignUI::Ov(true, 12), label);
                W::Text(d, SignUI::Ov(true, 12), ImVec2(max.x - labelWidth - 10.0f, (min.y + max.y) * 0.5f - 7.0f), IM_COL32(214, 228, 255, 255), label);
                if (pressed) {
                    m_GpsSetPending = true;
                    m_GpsSetPosition = {place->position.x, place->position.z};
                    m_GpsSetName = place->name;
                    m_MapCenter = {place->position.x, place->position.z};
                }
                ImGui::PopID();
            }
        }
        ImGui::EndChild();
        ImGui::EndGroup();
        ImGui::PopStyleVar();
        ImGui::SetCursorScreenPos(ImVec2(origin.x, canvasMax.y + 1.0f));
        ImGui::Dummy(ImVec2(1.0f, 1.0f));
    }
}

} // namespace Bazuko
