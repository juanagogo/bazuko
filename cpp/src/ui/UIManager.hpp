#pragma once
#include <array>
#include <chrono>
#include <memory>
#include <string>
#include <cstddef>
#include <vector>
#include <glm/glm.hpp>
#include <unordered_map>
#include <imgui.h>
#include "../renderer/Camera.hpp"
#include "../renderer/Texture.hpp"
#include "../renderer/Renderer.hpp"
#include "../core/Window.hpp"
#include "../world/CityLayout.hpp"
#include "../world/Simulation.hpp"
#include "../audio/AudioManager.hpp"
#include "../core/FrameMetrics.hpp"

struct GLFWwindow;

namespace Bazuko {

class Texture;

struct RadioStation {
    std::string id;
    std::string name;
    std::string frequency;
    std::string genre;
    std::string program;
    std::string streamUrl;
};

struct CraftingMaterial {
    std::string id;
    std::string name;
    int have = 0;
    int need = 1;
};

// Receta de la mesa de crafteo (src/data/recipes.js del original): el banco de trabajo muestra el resultado, su efecto y los materiales
struct CraftingOption {
    std::string id;
    std::string name;
    std::string ingredients;     // resumen de una linea
    bool craftable = false;      // hay materiales
    bool fits = true;            // el resultado cabe en el costal
    int quantity = 1;
    float weight = 0.0f;
    std::string effect;          // lo que hace el objeto
    std::vector<CraftingMaterial> materials;
};

struct InventoryOption {
    size_t itemIndex = 0;
    std::string id;
    std::string name;
    int quantity = 0;
    float weight = 0.0f;
    bool usable = false;
    std::string description;
    std::string effects;      // "+40 energía · +15 ánimo"
    std::string rarityLabel;
    int hotbarSlot = -1;      // 0..4 si esta en la barra rapida
};

// Estado de la radio transistor que muestra el sintonizador
struct RadioView {
    bool on = false;
    float battery = 100.0f;     // 0..100
    float volume = 0.7f;        // volumen propio de la radio
    float signal = 1.0f;        // 0..1
    bool hasBatteries = false;  // hay pilas AA en el costal
};

// Casilla de la barra de acceso rapido (teclas 1-5)
struct HotbarSlot {
    std::string id;
    std::string name;
    int quantity = 0;
};

// Producto de una tienda (La Esquinita o un vendedor ambulante)
struct ShopOption {
    std::string key;             // id del objeto, o "costal"
    std::string name;
    std::string description;
    int price = 0;
    bool enabled = false;
    bool owned = false;
};

// Fila del menu de la recicladora
struct RecyclerRow {
    std::string name;
    int quantity = 0;
    int unitPrice = 0;
    int totalPrice = 0;
};

struct DealerOption {
    std::string id;
    std::string name;
    int price = 0;
    bool affordable = false;
    bool canCarry = false;
};

struct TalentOption {
    std::string id;
    std::string name;
    std::string description;
    std::string requirement;
    int cost = 0;
    bool unlocked = false;
    bool available = false;
};

struct CambuchePieceOption {
    std::string id;
    std::string name;
    std::string desc;
    std::string reqText;
    bool isBuilt = false;
    bool isLocked = false;
    bool canBuild = false;
};

// Tipos de aviso del juego web (.loot-toast): el color del borde y del texto indica de que se trata.
enum class ToastType { Plain, Info, Rare, Sell, Warn, Death };

class UIManager {
public:
    UIManager(GLFWwindow* window);
    ~UIManager();

    void BeginFrame();
    void EndFrame();
    void TogglePause();
    void HandleEscape();
    void HandleRadioShortcut();
    void OpenRadioMenu(bool returnToPause = true);
    void OpenPauseSection(int section);
    void OpenDealerMenu();
    // Tiendas y recicladora: se abren como secciones de la pausa (la partida se detiene mientras se compra).
    // `itemKeys` limita los productos (vendedores ambulantes); vacio = toda la tienda.
    void OpenShopMenu(const std::string& title, const std::string& subtitle, const std::vector<std::string>& itemKeys = {});
    void OpenRecyclerMenu();
    // Nota del desarrollador (pantalla de inicio del juego web); se cierra con Continuar jugando.
    void OpenDeveloperNote();
    bool IsShopMenuOpen() const { return m_Paused && m_PauseSection == 5; }
    bool IsRecyclerMenuOpen() const { return m_Paused && m_PauseSection == 6; }
    const std::vector<std::string>& ShopFilter() const { return m_ShopFilter; }
    // Datos vivos de los menus de lugares; main los actualiza cada cuadro antes de RenderHUD.
    void SetPlaceMenuData(const std::vector<ShopOption>& shop, const std::vector<RecyclerRow>& recycler,
                          float money, float weight, float capacity);
    // Progreso (0..1) de la clasificacion de basura con Q; negativo = no se esta clasificando.
    void SetSortProgress(float fraction) { m_SortProgress = fraction; }
    // Calidad grafica: 0 baja, 1 media, 2 alta (escala de resolucion interna)
    void SetGraphicsQuality(int quality) { m_GraphicsQuality = quality; }
    // Escala de resolucion que se esta usando de verdad (la adaptativa puede bajarla) y la presion de rendimiento
    void SetEffectiveRenderScale(float scale, int pressure) { m_EffectiveScale = scale; m_RenderPressure = pressure; }
    int ConsumeGraphicsQualityRequest();
    std::string ConsumeShopPurchaseRequest();
    bool ConsumeRecyclerSellRequest();
    void ToggleCraftMenu();
    bool IsPaused() const { return m_Paused; }
    bool IsCraftMenuOpen() const { return m_CraftMenuOpen; }
    bool IsDeathScreenOpen() const { return m_DeathScreenOpen; }
    void ShowDeathScreen(const std::string& causes, bool vehicleImpact);
    bool ConsumeRespawnRequest();
    void CompleteDeathRecovery();
    std::string ConsumeCraftRequest();
    size_t ConsumeInventoryUseRequest();
    size_t ConsumeInventoryDropRequest();
    bool InventoryDropWasAll() const { return m_InventoryDropAll; }
    // Barra de acceso rapido: main publica las casillas y recoge las peticiones de uso y de asignacion
    void SetHotbar(const std::array<HotbarSlot, 5>& slots) { m_Hotbar = slots; }
    int ConsumeHotbarUseRequest();
    // Radio: main publica el estado y recoge lo que el jugador pide en el sintonizador
    void SetRadioView(const RadioView& view) { m_RadioView = view; }
    bool ConsumeRadioPowerToggle() { return std::exchange(m_RadioPowerRequest, false); }
    bool ConsumeRadioBatteryRequest() { return std::exchange(m_RadioBatteryRequest, false); }
    bool ConsumeRadioVolume(float& volume) {
        if (m_RadioVolumeRequest < 0.0f) return false;
        volume = std::exchange(m_RadioVolumeRequest, -1.0f);
        return true;
    }
    // Emisora sintonizada: id del archivo de emisoras ("" si no hay ninguna) y aviso de que se acaba de elegir otra
    std::string SelectedRadioStationId() const { return m_RadioStations.empty() ? std::string{} : m_RadioStations[m_SelectedRadioStation].id; }
    bool ConsumeRadioTuned() { return std::exchange(m_RadioTuned, false); }
    void SelectRadioStation(const std::string& id) {
        for (size_t index = 0; index < m_RadioStations.size(); ++index)
            if (m_RadioStations[index].id == id) m_SelectedRadioStation = index;
    }
    bool ConsumeHotbarAssign(int& slot, size_t& itemIndex);
    bool ConsumeInventorySortRequest();
    std::string ConsumeTalentUnlockRequest();
    std::string ConsumeDealerPurchaseRequest();
    bool ConsumePetRequest();
    void SetCompanionCustomization(const std::string& name, int coat, float size = 1.0f, int accessory = 0);
    std::string GetCompanionName() const;
    int GetCompanionCoat() const { return m_CompanionCoat; }
    float GetCompanionSize() const { return m_CompanionSize; }
    int GetCompanionAccessory() const { return m_CompanionAccessory; }
    void RenderLoadingScreen(Window& window, float progress, const std::string& stageText, const std::string& tipText = "");

    void OpenCambucheMenu() { m_CambucheMenuOpen = true; }
    void CloseCambucheMenu() { m_CambucheMenuOpen = false; }
    bool IsCambucheMenuOpen() const { return m_CambucheMenuOpen; }
    std::string ConsumeCambucheBuildRequest() { return std::exchange(m_CambucheBuildRequest, {}); }
    bool ConsumeSleepRequest() { return std::exchange(m_SleepRequest, false); }
    // GPS a pie: main entrega la ruta cada cuadro y recoge las peticiones de destino hechas en el mapa
    struct GpsView {
        bool active = false;
        glm::vec2 waypoint{0.0f};
        std::string name;
        float distance = 0.0f;
        std::vector<glm::vec2> route;   // empieza en el jugador
    };
    void SetGpsView(GpsView view) { m_GpsView = std::move(view); }
    bool ConsumeGpsSetRequest(glm::vec2& position, std::string& name) {
        if (!m_GpsSetPending) return false;
        m_GpsSetPending = false;
        position = m_GpsSetPosition;
        name = m_GpsSetName;
        return true;
    }
    bool ConsumeGpsClearRequest() { return std::exchange(m_GpsClearRequest, false); }
    // Mapa grande (tecla M): norte arriba, arrastrar para mover, rueda para zoom, clic para marcar destino
    void OpenMapSection();
    void SelectPauseTab(int section);   // cambia de pestana dentro de la pausa sin cerrarla
    bool IsMapOpen() const { return m_Paused && m_PauseSection == 8; }
    void RenderCambucheMenu(const std::vector<CambuchePieceOption>& pieces, bool hasBase, bool isNight);

    void RenderHUD(float dt, const glm::vec3& playerPos, Camera& camera, Renderer& renderer, Window& window,
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
                   bool boostActive = false, float boostTimer = 0.0f, float psychosisSeverity = 0.0f);

    bool ConsumeSaveRequest();
    bool ConsumeNewGameRequest();
    bool ConsumeQuitRequest();
    bool ConsumeCharacterCreatorRequest();
    void RequestCharacterCreator() { m_CharacterCreatorRequest = true; }
    void SetSaveNotification(const std::string& message);
    // Aviso apilado en pantalla (2,5 s). Los textos de SetPickupNotification toman el tipo de su contenido.
    void Notify(const std::string& message, ToastType type = ToastType::Plain);
    // Dia de juego, estado del tiempo y temporada para el HUD y el panel de pausa
    void SetWorldInfo(int day, std::string weather, std::string season) { m_Day = day; m_WeatherLabel = std::move(weather); m_SeasonLabel = std::move(season); }
    void SetPickupNotification(const std::string& message, bool rare = false);
    // Burbujas de conversacion de los peatones: posicion en pantalla normalizada (-1..1), texto y opacidad
    struct WorldBubble { float x, y; std::string text; float alpha; };
    void SetWorldBubbles(std::vector<WorldBubble> bubbles) { m_WorldBubbles = std::move(bubbles); }
    void RenderQuitScreen(Window& window);

private:
    int m_Day = 1;
    std::string m_WeatherLabel, m_SeasonLabel;
    void SetupDarkUrbanBogotaTheme();
    void LoadLoadingArtwork(int index);
    void DrawLoadingArtwork();
    void CloseRadioMenu();
    bool m_Paused = false;
    bool m_DeathScreenOpen = false;
    bool m_RespawnRequest = false;
    bool m_DeathByVehicleImpact = false;
    std::string m_DeathCauses;
    bool m_RadioMenuOpen = false;
    bool m_RadioReturnsToPause = false;
    bool m_CraftMenuOpen = false;
    // Iconos de objetos: siluetas blancas de assets/icons/<id>.png (game-icons.net, CC BY 3.0, las del original), teñidas al dibujar
    std::unordered_map<std::string, std::shared_ptr<Texture>> m_ItemIcons;
    void DrawItemIcon(ImDrawList* draw, ImVec2 center, float size, const std::string& id, const std::string& name, unsigned int color);
    std::vector<WorldBubble> m_WorldBubbles;
    std::string m_CraftSelected;   // receta elegida en el banco de trabajo
    float m_CraftFlash = 0.0f;     // destello al fabricar
    bool m_CambucheMenuOpen = false;
    std::string m_CambucheBuildRequest;
    bool m_SleepRequest = false;
    int m_PauseSection = 0;
    bool m_RadarVisible = true;
    float m_RadarRange = 42.0f;   // metros desde el centro hasta el borde del radar (+/- cambian el zoom)
    GpsView m_GpsView;
    bool m_GpsSetPending = false;
    glm::vec2 m_GpsSetPosition{0.0f};
    std::string m_GpsSetName;
    bool m_GpsClearRequest = false;
    glm::vec2 m_MapCenter{0.0f};
    float m_MapZoom = 0.0f;       // pixeles por metro; 0 = ajustar a la ciudad al abrir
    bool m_MapNeedsCenter = true;
    void RenderMapView(const glm::vec3& playerPos, const CityLayout& city, const Simulation& simulation);
    bool m_SaveRequest = false;
    bool m_NewGameRequest = false;
    bool m_NewGameConfirmOpen = false;   // confirmacion de partida nueva: reemplaza al menu de pausa mientras esta abierta
    bool m_QuitRequest = false;
    bool m_CharacterCreatorRequest = false;
    std::string m_SaveNotification;
    float m_SaveNotificationTimer = 0.0f;
    struct Toast {
        std::string text;
        ToastType type = ToastType::Plain;
        float remaining = 2.5f;
    };
    std::vector<Toast> m_Toasts;
    float m_WhisperTimer = 5.0f;
    std::string m_ActiveWhisper;
    float m_ActiveWhisperTimer = 0.0f;
    float m_WhisperPosX = 0.5f;
    float m_WhisperPosY = 0.35f;
    std::string m_CraftRequest;
    size_t m_InventoryUseRequest = static_cast<size_t>(-1);
    size_t m_InventoryDropRequest = static_cast<size_t>(-1);
    bool m_InventorySortRequest = false;
    std::string m_TalentUnlockRequest;
    std::string m_DealerPurchaseRequest;
    float m_SortProgress = -1.0f;
    int m_GraphicsQuality = 1;
    float m_EffectiveScale = 1.0f;
    int m_RenderPressure = 0;
    int m_GraphicsQualityRequest = -1;
    std::array<HotbarSlot, 5> m_Hotbar{};
    int m_HotbarUseRequest = -1;
    RadioView m_RadioView;
    bool m_RadioPowerRequest = false;
    bool m_RadioBatteryRequest = false;
    bool m_RadioTuned = false;
    float m_RadioVolumeRequest = -1.0f;
    int m_HotbarAssignSlot = -1;
    size_t m_HotbarAssignItem = 0;
    bool m_InventoryDropAll = false;
    size_t m_InventorySelected = 0;
    FrameMetrics m_Metrics;
public:
    // Resumen de rendimiento del HUD en una linea (para BAZUKO_BENCH): FPS medio, minimo, maximo, p95/p99 (ms), 1 % bajo y tirones
    std::string PerformanceSummary() const {
        const auto recent = m_Metrics.RecentStats();
        char text[256];
        std::snprintf(text, sizeof(text), "avg=%.1f min=%.1f max=%.1f p95=%.2f p99=%.2f low1=%.1f over100=%d frames=%zu",
                      m_Metrics.average, m_Metrics.min, m_Metrics.max, recent.p95, recent.p99, recent.low1Percent, recent.over100ms, recent.frames);
        return text;
    }
private:
    std::string m_ShopTitle;
    std::string m_ShopSubtitle;
    std::vector<std::string> m_ShopFilter;
    std::string m_ShopPurchaseRequest;
    bool m_RecyclerSellRequest = false;
    std::vector<ShopOption> m_ShopOptions;
    std::vector<RecyclerRow> m_RecyclerRows;
    float m_PlaceMoney = 0.0f;
    float m_PlaceWeight = 0.0f;
    float m_PlaceCapacity = 0.0f;
    bool m_PetRequest = false;
    std::array<char, 32> m_CompanionName{{'E', 'l', ' ', 'C', 'h', 'a', 't', 'o', '\0'}};
    int m_CompanionCoat = 0;
    float m_CompanionSize = 1.0f;
    int m_CompanionAccessory = 0;
    std::vector<RadioStation> m_RadioStations;
    size_t m_SelectedRadioStation = 0;
    std::array<std::shared_ptr<Texture>, 4> m_LoadingBackgrounds{};
    std::array<std::shared_ptr<Texture>, 4> m_LoadingForegrounds{};
    std::array<bool, 4> m_LoadingArtworkLoadAttempted{};
    std::array<int, 4> m_LoadingArtworkDeck{};
    size_t m_LoadingArtworkDeckPosition = 4;
    int m_LoadingArtwork = -1;
    int m_PreviousLoadingArtwork = -1;
    std::chrono::steady_clock::time_point m_LoadingArtworkChangedAt{};
};

} // namespace Bazuko
