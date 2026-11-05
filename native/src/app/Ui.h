#pragma once

#include <SDL3/SDL.h>

#include <functional>
#include <string>

#include "character/Catalog.h"
#include "character/Look.h"
#include "core/FrameMetrics.h"
#include "core/Rng.h"
#include "game/CameraRig.h"
#include "game/Entities.h"
#include "game/GameState.h"
#include "game/Interaction.h"
#include "game/UiText.h"
#include "render/Renderer.h"
#include "world/Bogota.h"

namespace bazuko {

// Acciones que la interfaz le pide al juego.
struct UiHooks {
    std::function<void(const std::string&)> useItem;
    std::function<void()> sleep, respawn, cameraToggle, resetMetrics;
    std::function<void(const Look&)> lookChanged;               // vista previa en vivo del creador
    std::function<void(const Look&, bool accepted)> creatorClosed;
};

struct LoadingView {
    std::string text;
    double progress = 0;  // 0..1
    std::string error;    // si no está vacío se muestra en lugar del progreso
};

// Datos que la interfaz lee cada cuadro.
struct UiFrame {
    GameState* state = nullptr;
    Interaction* interaction = nullptr;
    const Entities* entities = nullptr;
    const Bogota* city = nullptr;
    const GameData* data = nullptr;
    const Catalog* catalog = nullptr;
    Rng* rng = nullptr;
    std::string playerName;
    Vec3 playerPos;
    CameraMode camera = CameraMode::ThirdPerson;
    const FrameMetrics* metrics = nullptr;
    RenderStats stats;
    double renderScale = 1;
    bool sleeping = false;
    double sleepFade = 0;  // 0..1 oscurecimiento mientras duerme
    bool dead = false;
    std::string deathCauses;
};

// Dear ImGui: HUD, paneles (T talentos, C crafteo, dealer), menús de los lugares, creador de personaje,
// pantalla de carga y medidor de rendimiento (F3). Paleta azul y amarilla de la señalética.
class Ui {
public:
    enum class Panel { None, Talents, Crafting, Dealer, Recycler, Shop, Cambuche };

    Ui(SDL_Window* window, SDL_GLContext gl, UiHooks hooks);
    ~Ui();
    Ui(const Ui&) = delete;
    Ui& operator=(const Ui&) = delete;

    // true si ImGui se quedó con el evento (campos de texto, ventanas bajo el ratón).
    void processEvent(const SDL_Event& e);
    bool wantsKeyboard() const;
    bool wantsMouse() const;

    void newFrame();
    void draw(const UiFrame& f);
    void drawLoading(const LoadingView& v);
    void render();

    void update(double dt) { toasts_.update(dt); }
    // Abre menús y encola avisos según el evento.
    void handle(const GameEvent& ev);
    void toast(const std::string& text, const std::string& type = "info") { toasts_.add({text, type}); }

    Panel panel() const { return panel_; }
    // Los menús de lugares, el creador y la muerte detienen el mundo.
    bool modal() const;
    bool anyOpen() const { return panel_ != Panel::None || creator_.open; }
    void toggle(Panel p) { panel_ = panel_ == p ? Panel::None : p; }
    void close() { panel_ = Panel::None; }
    bool creatorOpen() const { return creator_.open; }
    void openCreator(const Look& look, bool first);
    void togglePerf() { perf_ = !perf_; }
    bool perfVisible() const { return perf_; }
    void setDeathOpen(bool open) { death_ = open; }

private:
    struct Creator {
        bool open = false, first = false;
        Look look, initial;
        int tab = 0;
        char name[32] = {};
    };
    void hud(const UiFrame& f);
    void toastsWindow(const UiFrame& f);
    void talents(const UiFrame& f);
    void crafting(const UiFrame& f);
    void dealer(const UiFrame& f);
    void recycler(const UiFrame& f);
    void shop(const UiFrame& f);
    void cambuche(const UiFrame& f);
    void deathDialog(const UiFrame& f);
    void creatorWindow(const UiFrame& f);
    void perfWindow(const UiFrame& f);
    void applyLook(const Look& l);

    UiHooks hooks_;
    ToastQueue toasts_;
    Panel panel_ = Panel::None;
    int shopVendor_ = -1;
    bool perf_ = false, death_ = false;
    Creator creator_;
};

}  // namespace bazuko
