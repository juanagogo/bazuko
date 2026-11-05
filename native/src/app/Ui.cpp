#include "app/Ui.h"

#include <imgui.h>
#include <imgui_impl_opengl3.h>
#include <imgui_impl_sdl3.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

#include "game/Money.h"
#include "game/Places.h"
#include "render/LocalLights.h"

namespace bazuko {

namespace {

// Paleta de la señalética: azul de fondo y amarillo de acento.
const ImVec4 kBlue{0.043f, 0.122f, 0.227f, 0.94f}, kBlueLight{0.09f, 0.22f, 0.40f, 1.0f}, kYellow{0.965f, 0.769f, 0.0f, 1.0f},
    kText{0.95f, 0.96f, 0.98f, 1.0f}, kDim{0.62f, 0.70f, 0.80f, 1.0f}, kGreen{0.36f, 0.85f, 0.52f, 1.0f},
    kRed{0.93f, 0.33f, 0.33f, 1.0f};

ImVec4 hexColor(const std::string& hex, float a = 1) {
    unsigned v = 0;
    if (hex.size() >= 7) v = static_cast<unsigned>(std::strtoul(hex.c_str() + 1, nullptr, 16));
    return {((v >> 16) & 255) / 255.0f, ((v >> 8) & 255) / 255.0f, (v & 255) / 255.0f, a};
}

ImVec4 toastColor(const std::string& type) {
    if (type == "warn") return {0.98f, 0.70f, 0.20f, 1};
    if (type == "rare") return {0.78f, 0.55f, 1.0f, 1};
    if (type == "sell") return kGreen;
    if (type == "death") return kRed;
    return kText;
}

std::string clean(const std::string& s) { return stripUnsupported(s); }

void centerNext(float w, float h) {
    const ImVec2 c = ImGui::GetMainViewport()->GetCenter();
    ImGui::SetNextWindowPos(c, ImGuiCond_Always, {0.5f, 0.5f});
    ImGui::SetNextWindowSize({w, h}, ImGuiCond_Always);
}

constexpr ImGuiWindowFlags kPanelFlags = ImGuiWindowFlags_NoCollapse | ImGuiWindowFlags_NoResize | ImGuiWindowFlags_NoMove |
                                         ImGuiWindowFlags_NoSavedSettings;
constexpr ImGuiWindowFlags kOverlayFlags = ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoInputs | ImGuiWindowFlags_NoMove |
                                           ImGuiWindowFlags_NoSavedSettings | ImGuiWindowFlags_NoFocusOnAppearing |
                                           ImGuiWindowFlags_NoNav | ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoBackground;

void bar(const char* label, double value, ImVec4 color, bool critical = false) {
    const float v = static_cast<float>(std::clamp(value, 0.0, 100.0) / 100.0);
    ImGui::PushStyleColor(ImGuiCol_PlotHistogram, critical ? kRed : color);
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0.45f));
    char overlay[16];
    std::snprintf(overlay, sizeof overlay, "%d", static_cast<int>(std::lround(value)));
    ImGui::TextUnformatted(label);
    ImGui::SameLine(78);
    ImGui::ProgressBar(v, {150, 13}, overlay);
    ImGui::PopStyleColor(2);
}

}  // namespace

Ui::Ui(SDL_Window* window, SDL_GLContext gl, UiHooks hooks) : hooks_(std::move(hooks)) {
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& io = ImGui::GetIO();
    io.IniFilename = nullptr;
    io.ConfigFlags |= ImGuiConfigFlags_NavEnableKeyboard * 0;  // sin navegación con teclado: E/Q/WASD son del juego
    static const ImWchar ranges[] = {0x20, 0xFF, 0x2010, 0x2027, 0};
    const float scale = std::max(1.0f, SDL_GetWindowDisplayScale(window));
    io.Fonts->AddFontFromFileTTF(BAZUKO_ASSETS_DIR "/fonts/Overpass-ExtraBold.ttf", 17.0f * scale, nullptr, ranges);
    io.FontGlobalScale = 1.0f / scale;

    ImGuiStyle& st = ImGui::GetStyle();
    st.WindowRounding = 8;
    st.FrameRounding = 5;
    st.GrabRounding = 5;
    st.WindowBorderSize = 1;
    st.WindowPadding = {12, 10};
    st.ItemSpacing = {8, 6};
    ImVec4* c = st.Colors;
    c[ImGuiCol_WindowBg] = kBlue;
    c[ImGuiCol_Border] = {0.965f, 0.769f, 0.0f, 0.55f};
    c[ImGuiCol_Text] = kText;
    c[ImGuiCol_TitleBg] = kBlueLight;
    c[ImGuiCol_TitleBgActive] = kBlueLight;
    c[ImGuiCol_Button] = kBlueLight;
    c[ImGuiCol_ButtonHovered] = {0.18f, 0.34f, 0.58f, 1};
    c[ImGuiCol_ButtonActive] = {0.965f, 0.769f, 0.0f, 1};
    c[ImGuiCol_FrameBg] = {0.02f, 0.06f, 0.12f, 0.9f};
    c[ImGuiCol_Header] = kBlueLight;
    c[ImGuiCol_HeaderHovered] = {0.18f, 0.34f, 0.58f, 1};
    c[ImGuiCol_Separator] = {0.965f, 0.769f, 0.0f, 0.35f};
    c[ImGuiCol_Tab] = kBlueLight;
    c[ImGuiCol_TabHovered] = {0.965f, 0.769f, 0.0f, 0.6f};
    c[ImGuiCol_TabActive] = {0.965f, 0.769f, 0.0f, 0.85f};
    c[ImGuiCol_CheckMark] = kYellow;
    c[ImGuiCol_SliderGrab] = kYellow;

    ImGui_ImplSDL3_InitForOpenGL(window, gl);
    ImGui_ImplOpenGL3_Init("#version 450");
}

Ui::~Ui() {
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplSDL3_Shutdown();
    ImGui::DestroyContext();
}

void Ui::processEvent(const SDL_Event& e) { ImGui_ImplSDL3_ProcessEvent(&e); }
bool Ui::wantsKeyboard() const { return ImGui::GetIO().WantTextInput; }
bool Ui::wantsMouse() const { return ImGui::GetIO().WantCaptureMouse; }

void Ui::newFrame() {
    ImGui_ImplOpenGL3_NewFrame();
    ImGui_ImplSDL3_NewFrame();
    ImGui::NewFrame();
}

void Ui::render() {
    ImGui::Render();
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
}

bool Ui::modal() const {
    return creator_.open || death_ || panel_ == Panel::Recycler || panel_ == Panel::Shop || panel_ == Panel::Cambuche;
}

void Ui::handle(const GameEvent& ev) {
    if (const auto m = toastFor(ev)) toasts_.add(*m);
    if (std::holds_alternative<EvOpenRecycler>(ev)) panel_ = Panel::Recycler;
    else if (const auto* s = std::get_if<EvOpenShop>(&ev)) { panel_ = Panel::Shop; shopVendor_ = s->vendor; }
    else if (std::holds_alternative<EvOpenCambuche>(ev)) panel_ = Panel::Cambuche;
    else if (std::holds_alternative<EvOpenCrafting>(ev)) panel_ = Panel::Crafting;
    else if (std::holds_alternative<EvDealerToggle>(ev)) toggle(Panel::Dealer);
}

void Ui::openCreator(const Look& look, bool first) {
    creator_ = Creator{};
    creator_.open = true;
    creator_.first = first;
    creator_.look = look;
    creator_.initial = look;
    std::snprintf(creator_.name, sizeof creator_.name, "%s", look.nombre.c_str());
    panel_ = Panel::None;
}

void Ui::applyLook(const Look& l) {
    creator_.look = l;
    if (hooks_.lookChanged) hooks_.lookChanged(l);
}

// ---------------------------------------------------------------- HUD

void Ui::draw(const UiFrame& f) {
    if (creator_.open) {
        creatorWindow(f);
        toastsWindow(f);
        return;
    }
    hud(f);
    toastsWindow(f);
    switch (panel_) {
        case Panel::Talents: talents(f); break;
        case Panel::Crafting: crafting(f); break;
        case Panel::Dealer: dealer(f); break;
        case Panel::Recycler: recycler(f); break;
        case Panel::Shop: shop(f); break;
        case Panel::Cambuche: cambuche(f); break;
        case Panel::None: break;
    }
    if (death_) deathDialog(f);
    if (perf_) perfWindow(f);
    if (f.sleeping || f.sleepFade > 0) {
        ImDrawList* dl = ImGui::GetForegroundDrawList();
        const ImVec2 size = ImGui::GetIO().DisplaySize;
        dl->AddRectFilled({0, 0}, size, IM_COL32(0, 0, 0, static_cast<int>(255 * std::clamp(f.sleepFade, 0.0, 1.0))));
        if (f.sleepFade > 0.5) {
            const char* msg = "Durmiendo...";
            const ImVec2 ts = ImGui::CalcTextSize(msg);
            dl->AddText({(size.x - ts.x) / 2, size.y / 2 - ts.y / 2}, IM_COL32(246, 196, 0, 255), msg);
        }
    }
}

void Ui::hud(const UiFrame& f) {
    GameState& s = *f.state;
    const StatsSystem& st = s.stats;
    const ImVec2 disp = ImGui::GetIO().DisplaySize;

    // Esquina superior izquierda: nombre, nivel, XP y necesidades.
    ImGui::SetNextWindowPos({12, 12});
    ImGui::SetNextWindowBgAlpha(0.8f);
    ImGui::Begin("##stats", nullptr, kOverlayFlags & ~ImGuiWindowFlags_NoBackground);
    ImGui::TextColored(kYellow, "%s", f.playerName.empty() ? "Parcero" : clean(f.playerName).c_str());
    ImGui::SameLine();
    ImGui::TextColored(kDim, "Nv %d", st.level);
    ImGui::SameLine(190);
    ImGui::TextColored(s.talents.points() > 0 ? kYellow : kDim, "* %d", s.talents.points());
    ImGui::ProgressBar(static_cast<float>(xpFraction(s)), {228, 7}, "");
    bar("Hambre", st.hambre, {0.91f, 0.57f, 0.23f, 1});
    bar("Sed", st.sed, {0.23f, 0.62f, 0.91f, 1});
    bar("Energía", st.energia, {0.95f, 0.82f, 0.23f, 1});
    bar("Salud", st.salud, kRed);
    bar("Higiene", st.higiene, {0.24f, 0.81f, 0.81f, 1});
    bar("Ánimo", st.animo, {0.65f, 0.42f, 1.0f, 1});
    bar("Vicio", st.vicio, {0.56f, 0.27f, 0.68f, 1}, st.inWithdrawal());
    ImGui::End();

    // Esquina superior derecha: reloj, dinero y cámara.
    ImGui::SetNextWindowPos({disp.x - 12, 12}, ImGuiCond_Always, {1, 0});
    ImGui::SetNextWindowBgAlpha(0.8f);
    ImGui::Begin("##clock", nullptr, kOverlayFlags & ~ImGuiWindowFlags_NoBackground);
    ImGui::TextColored(kYellow, "%s", clockText(s.clock.day, s.clock.hour).c_str());
    ImGui::TextColored(kGreen, "%s", cop(st.dinero).c_str());
    if (f.interaction->boostActive()) ImGui::TextColored(kYellow, "BOOST %.0fs", std::ceil(f.interaction->boostTimeLeft()));
    ImGui::TextColored(kDim, "%s · V", f.camera == CameraMode::ThirdPerson ? "Tercera persona" : "Isométrica");
    ImGui::End();

    // Advertencias de necesidades críticas.
    const auto warnings = statusWarnings(st);
    if (!warnings.empty()) {
        std::string line;
        for (const auto& w : warnings) line += (line.empty() ? "" : " ") + w;
        ImGui::SetNextWindowPos({disp.x / 2, 14}, ImGuiCond_Always, {0.5f, 0});
        ImGui::SetNextWindowBgAlpha(0.85f);
        ImGui::Begin("##warn", nullptr, kOverlayFlags & ~ImGuiWindowFlags_NoBackground);
        ImGui::TextColored(kRed, "%s", clean(line).c_str());
        ImGui::End();
    }

    // Inventario (clic en comida o medicina para usarla) y enfermedades, al lado izquierdo.
    ImGui::SetNextWindowPos({12, disp.y - 12}, ImGuiCond_Always, {0, 1});
    ImGui::SetNextWindowBgAlpha(0.8f);
    ImGui::Begin("##inv", nullptr, (kOverlayFlags & ~ImGuiWindowFlags_NoBackground) & ~ImGuiWindowFlags_NoInputs);
    ImGui::TextColored(kYellow, "Mochila");
    const auto& items = s.inventory.items();
    if (items.empty()) ImGui::TextColored(kDim, "vacía");
    for (const ItemStack& it : items) {
        const ItemDef* def = f.data->item(it.id);
        const bool usable = def && (def->consumable || def->cure);
        const std::string label = (def ? def->name : it.id) + "  x" + std::to_string(it.qty);
        if (usable) {
            if (ImGui::Selectable((label + "##" + it.id).c_str(), false, 0, {170, 0}) && hooks_.useItem) hooks_.useItem(it.id);
            if (ImGui::IsItemHovered()) ImGui::SetTooltip("Clic para usar");
        } else {
            ImGui::TextColored(kDim, "%s", label.c_str());
        }
    }
    ImGui::TextColored(kDim, "Peso %.1f/%.0f", s.inventory.totalWeight(), s.inventory.maxWeight);
    if (s.diseases.hasAny()) {
        ImGui::Separator();
        for (const auto& [id, left] : s.diseases.active()) {
            const DiseaseDef* d = f.data->disease(id);
            ImGui::TextColored(kRed, "%s %ds", clean(d ? d->name : id).c_str(), static_cast<int>(std::ceil(left)));
        }
    }
    ImGui::End();

    // Cartel de interacción.
    const std::string prompt = modal() || f.dead ? std::string() : promptFor(f.interaction->current(), *f.city);
    if (!prompt.empty()) {
        ImGui::SetNextWindowPos({disp.x / 2, disp.y - 70}, ImGuiCond_Always, {0.5f, 1});
        ImGui::SetNextWindowBgAlpha(0.88f);
        ImGui::Begin("##prompt", nullptr, kOverlayFlags & ~ImGuiWindowFlags_NoBackground);
        ImGui::TextColored(kYellow, "%s", clean(prompt).c_str());
        ImGui::End();
    }

    // Atajos de paneles.
    ImGui::SetNextWindowPos({disp.x - 12, disp.y - 12}, ImGuiCond_Always, {1, 1});
    ImGui::Begin("##hint", nullptr, kOverlayFlags);
    ImGui::TextColored(kDim, "T talentos · C crafteo · F boost · B pedir · P apariencia · F3 rendimiento");
    ImGui::End();
}

void Ui::toastsWindow(const UiFrame& f) {
    (void)f;
    const ImVec2 disp = ImGui::GetIO().DisplaySize;
    float y = disp.y - 110;
    int n = 0;
    for (auto it = toasts_.items().rbegin(); it != toasts_.items().rend(); ++it, ++n) {
        const float a = static_cast<float>(ToastQueue::alpha(*it));
        const std::string text = clean(it->msg.text);
        if (text.empty()) continue;
        char id[24];
        std::snprintf(id, sizeof id, "##toast%d", n);
        ImGui::SetNextWindowPos({disp.x / 2, y}, ImGuiCond_Always, {0.5f, 1});
        ImGui::SetNextWindowBgAlpha(0.85f * a);
        ImGui::PushStyleVar(ImGuiStyleVar_Alpha, a);
        ImGui::Begin(id, nullptr, kOverlayFlags & ~ImGuiWindowFlags_NoBackground);
        ImGui::TextColored(toastColor(it->msg.type), "%s", text.c_str());
        const float h = ImGui::GetWindowHeight();
        ImGui::End();
        ImGui::PopStyleVar();
        y -= h + 6;
    }
}

// ---------------------------------------------------------------- paneles

void Ui::talents(const UiFrame& f) {
    GameState& s = *f.state;
    const GameData& d = *f.data;
    const ImVec2 disp = ImGui::GetIO().DisplaySize;
    const float w = std::min(disp.x - 40, 980.0f), h = std::min(disp.y - 60, 560.0f);
    centerNext(w, h);
    ImGui::Begin("Árbol de talentos", nullptr, kPanelFlags);
    ImGui::TextColored(kYellow, "Puntos: %d", s.talents.points());
    ImGui::Separator();
    const float colW = (w - 24 - 8 * (static_cast<float>(d.branches.size()) - 1)) / static_cast<float>(d.branches.size());
    for (size_t b = 0; b < d.branches.size(); ++b) {
        if (b) ImGui::SameLine();
        ImGui::BeginChild(("##rama" + d.branches[b].id).c_str(), {colW, h - 110}, ImGuiChildFlags_Borders);
        ImGui::TextColored(kYellow, "%s", clean(d.branches[b].name).c_str());
        ImGui::Separator();
        for (const Talent& t : d.talents) {
            if (t.branch != d.branches[b].id) continue;
            const bool owned = s.talents.has(t.id), can = s.talents.canUnlock(t.id);
            ImGui::PushID(t.id.c_str());
            ImGui::PushStyleColor(ImGuiCol_Button, owned ? ImVec4(0.12f, 0.45f, 0.25f, 1) : can ? kBlueLight : ImVec4(0.12f, 0.15f, 0.2f, 1));
            ImGui::PushStyleColor(ImGuiCol_Text, owned ? kText : can ? kText : kDim);
            if (ImGui::Button(t.name.c_str(), {colW - 16, 0}) && can) s.talents.unlock(t.id);
            ImGui::PopStyleColor(2);
            ImGui::PushTextWrapPos(ImGui::GetCursorPosX() + colW - 20);
            ImGui::TextColored(kDim, "%s", t.desc.c_str());
            if (!t.prereqs.empty()) {
                std::string reqs;
                for (const auto& r : t.prereqs) reqs += (reqs.empty() ? "" : ", ") + (d.talent(r) ? d.talent(r)->name : r);
                ImGui::TextColored(kDim, "Requiere: %s", reqs.c_str());
            }
            ImGui::TextColored(owned ? kGreen : kYellow, owned ? "Desbloqueado" : "Costo: %d", t.cost);
            ImGui::PopTextWrapPos();
            ImGui::PopID();
            ImGui::Spacing();
        }
        ImGui::EndChild();
    }
    ImGui::TextColored(kDim, "Clic en un talento disponible para desbloquearlo. T o Esc para cerrar.");
    ImGui::End();
}

void Ui::crafting(const UiFrame& f) {
    GameState& s = *f.state;
    centerNext(520, 420);
    ImGui::Begin("Mesa de crafteo", nullptr, kPanelFlags);
    for (const Recipe& r : f.data->recipes) {
        ImGui::PushID(r.id.c_str());
        const bool ok = s.crafting.canCraft(r, s.inventory);
        ImGui::TextColored(kYellow, "%s x%d", clean(r.name).c_str(), r.qty);
        ImGui::SameLine(ImGui::GetWindowWidth() - 120);
        ImGui::BeginDisabled(!ok);
        if (ImGui::Button("Craftear", {96, 0})) craftRecipe(s, r);
        ImGui::EndDisabled();
        for (const auto& [id, qty] : r.ingredients) {
            const ItemDef* def = f.data->item(id);
            const int have = s.inventory.count(id);
            ImGui::TextColored(have >= qty ? kGreen : kRed, "   %s (%d/%d)", def ? def->name.c_str() : id.c_str(), have, qty);
        }
        ImGui::Separator();
        ImGui::PopID();
    }
    ImGui::TextColored(kDim, "C o Esc para cerrar.");
    ImGui::End();
}

void Ui::dealer(const UiFrame& f) {
    GameState& s = *f.state;
    centerNext(560, 380);
    ImGui::Begin("Rincón del Dealer", nullptr, kPanelFlags);
    ImGui::TextColored(kGreen, "Tu dinero: %s", cop(s.stats.dinero).c_str());
    ImGui::Separator();
    for (const LootEntry& e : f.data->lootSubstance) {
        const ItemDef* it = f.data->item(e.item);
        if (!it) continue;
        ImGui::PushID(it->id.c_str());
        const bool afford = s.stats.dinero >= it->value, weightOk = s.inventory.canAdd(it->id);
        ImGui::TextColored(kYellow, "%s", it->name.c_str());
        ImGui::SameLine(ImGui::GetWindowWidth() - 190);
        ImGui::Text("%s", cop(it->value).c_str());
        ImGui::SameLine(ImGui::GetWindowWidth() - 110);
        ImGui::BeginDisabled(!afford || !weightOk);
        if (ImGui::Button(afford ? (weightOk ? "Comprar" : "Lleno") : "Sin dinero", {96, 0})) f.interaction->buySubstance(it->id);
        ImGui::EndDisabled();
        ImGui::TextColored(kDim, "%s", dealerEffect(*it).c_str());
        ImGui::Separator();
        ImGui::PopID();
    }
    ImGui::TextColored(kDim, "De noche puedes vender sustancias aquí (1.8x el precio base). Q o Esc para cerrar.");
    ImGui::End();
}

void Ui::recycler(const UiFrame& f) {
    GameState& s = *f.state;
    const double mult = (f.interaction->boostActive() ? 1.2 : 1.0) * f.interaction->originEffect("sellMult");
    centerNext(520, 420);
    ImGui::Begin("Recicladora El Progreso", nullptr, kPanelFlags);
    ImGui::TextColored(kDim, "Pagan de contado. Comida, remedios y sustancias no se reciben.");
    ImGui::Separator();
    const int total = recyclerTotal(s, mult);
    bool any = false;
    ImGui::BeginChild("##lista", {0, 270});
    for (const ItemStack& it : s.inventory.items()) {
        const ItemDef* d = f.data->item(it.id);
        if (!d || !d->recyclable()) continue;
        any = true;
        ImGui::Text("%s  x%d", d->name.c_str(), it.qty);
        ImGui::SameLine(ImGui::GetWindowWidth() - 130);
        ImGui::TextColored(kGreen, "%s", cop(d->value * it.qty * mult).c_str());
    }
    if (!any) ImGui::TextWrapped("No traes nada para vender. Busca en las bolsas de basura: latas, botellas, cartón, chatarra y, con suerte, cobre.");
    ImGui::EndChild();
    ImGui::Separator();
    ImGui::TextColored(kGreen, "Tienes %s", cop(s.stats.dinero).c_str());
    ImGui::SameLine(ImGui::GetWindowWidth() - 230);
    ImGui::BeginDisabled(total == 0);
    const std::string label = total ? "Vender todo · " + cop(total) : "Vender todo";
    if (ImGui::Button(label.c_str(), {214, 0})) sellToRecycler(s, mult);
    ImGui::EndDisabled();
    ImGui::End();
}

void Ui::shop(const UiFrame& f) {
    GameState& s = *f.state;
    const auto& vendors = f.city->vendors();
    const bool ambulant = shopVendor_ >= 0 && shopVendor_ < static_cast<int>(vendors.size());
    centerNext(560, 460);
    ImGui::Begin(ambulant ? vendors[shopVendor_].title.c_str() : "Tienda La Esquinita", nullptr, kPanelFlags);
    ImGui::TextColored(kDim, "%s", ambulant ? "Venta ambulante: lo justo para el día." : "Doña Rosa fía, pero solo a los conocidos.");
    ImGui::Separator();
    ImGui::BeginChild("##lista", {0, 320});
    for (const ShopEntry& e : f.data->shopItems) {
        if (ambulant && std::find(vendors[shopVendor_].items.begin(), vendors[shopVendor_].items.end(), e.item) == vendors[shopVendor_].items.end())
            continue;
        const ItemDef* it = e.upgrade.empty() ? f.data->item(e.item) : nullptr;
        const ShopStatus status = canBuy(s, e);
        ImGui::PushID((e.item + e.upgrade).c_str());
        ImGui::TextColored(kYellow, "%s", clean(e.label.empty() && it ? it->name : e.label).c_str());
        ImGui::SameLine(ImGui::GetWindowWidth() - 190);
        ImGui::Text("%s", cop(e.price).c_str());
        ImGui::SameLine(ImGui::GetWindowWidth() - 110);
        ImGui::BeginDisabled(status != ShopStatus::Ok);
        if (ImGui::Button(status == ShopStatus::AlreadyOwned ? "Listo" : "Comprar", {96, 0})) buy(s, e);
        ImGui::EndDisabled();
        const char* note = status == ShopStatus::AlreadyOwned ? "Ya lo tienes." : status == ShopStatus::TooHeavy ? "No te cabe en el costal." : nullptr;
        ImGui::TextColored(kDim, "%s", note ? note : clean(!e.desc.empty() ? e.desc : it ? describeItem(*it) : std::string()).c_str());
        ImGui::Separator();
        ImGui::PopID();
    }
    ImGui::EndChild();
    ImGui::TextColored(kGreen, "Tienes %s", cop(s.stats.dinero).c_str());
    ImGui::SameLine();
    ImGui::TextColored(kDim, "   Carga %.1f / %.0f kg", s.inventory.totalWeight(), s.inventory.maxWeight);
    ImGui::End();
}

void Ui::cambuche(const UiFrame& f) {
    GameState& s = *f.state;
    centerNext(560, 520);
    ImGui::Begin("Tu cambuche", nullptr, kPanelFlags);
    ImGui::TextColored(kDim, "Ármalo por partes con lo que encuentres o compres.");
    ImGui::Separator();
    ImGui::BeginChild("##lista", {0, 360});
    for (const CambuchePiece& p : f.data->cambuche) {
        const bool done = s.hasBuilt(p.id);
        const BuildStatus status = canBuild(s, p);
        ImGui::PushID(p.id.c_str());
        ImGui::TextColored(done ? kGreen : kYellow, "%s", p.name.c_str());
        ImGui::SameLine(ImGui::GetWindowWidth() - 110);
        if (done) {
            ImGui::TextColored(kGreen, "Hecho");
        } else {
            ImGui::BeginDisabled(status != BuildStatus::Ok);
            if (ImGui::Button("Armar", {96, 0})) build(s, p);
            ImGui::EndDisabled();
        }
        ImGui::TextColored(kDim, "%s", (status == BuildStatus::NeedsBase ? std::string("Primero arma la base.") : p.desc).c_str());
        if (!done && status != BuildStatus::NeedsBase) {
            for (const auto& [id, qty] : p.req) {
                const ItemDef* it = f.data->item(id);
                const int have = s.inventory.count(id);
                ImGui::SameLine();
                ImGui::TextColored(have >= qty ? kGreen : kRed, "%s %d/%d", it ? it->name.c_str() : id.c_str(), std::min(have, qty), qty);
            }
        }
        ImGui::Separator();
        ImGui::PopID();
    }
    ImGui::EndChild();
    const bool base = s.hasBuilt("base");
    ImGui::TextColored(kDim, "%s", base ? "Dormir guarda la partida." : "Sin base no se puede dormir.");
    ImGui::SameLine(ImGui::GetWindowWidth() - 250);
    ImGui::BeginDisabled(!base);
    if (ImGui::Button(s.clock.isNight() ? "Dormir hasta las 6:00" : "Echar una siesta (3 h)", {234, 0})) {
        panel_ = Panel::None;
        if (hooks_.sleep) hooks_.sleep();
    }
    ImGui::EndDisabled();
    ImGui::End();
}

void Ui::deathDialog(const UiFrame& f) {
    centerNext(520, 250);
    ImGui::Begin("Te quedaste sin salud", nullptr, kPanelFlags);
    ImGui::TextColored(kRed, "La partida está en pausa.");
    ImGui::Separator();
    ImGui::PushTextWrapPos(ImGui::GetWindowWidth() - 16);
    ImGui::TextWrapped("%s", f.deathCauses.empty() ? "Tu salud llegó a cero." : ("Estado al caer: " + f.deathCauses + ".").c_str());
    ImGui::TextWrapped("Volverás al cambuche con salud y necesidades recuperadas al menos al 60 %%. Perderás la mitad de los tipos de objetos del inventario.");
    ImGui::TextWrapped("Come, bebe agua y descansa. Puedes consumir comida y agua con clic en la mochila.");
    ImGui::PopTextWrapPos();
    ImGui::SetCursorPosY(ImGui::GetWindowHeight() - 44);
    if (ImGui::Button("Volver al cambuche", {200, 0}) && hooks_.respawn) hooks_.respawn();
    ImGui::End();
}

// ---------------------------------------------------------------- creador

void Ui::creatorWindow(const UiFrame& f) {
    Look look = creator_.look;
    if (!look.hasReal) {
        look.real = f.catalog->normalize(look.real);
        look.hasReal = true;
        applyLook(look);
    }
    const GameData& d = *f.data;
    const ImVec2 disp = ImGui::GetIO().DisplaySize;
    ImGui::SetNextWindowPos({16, 16});
    ImGui::SetNextWindowSize({380, disp.y - 32});
    ImGui::Begin("Crea tu personaje", nullptr, kPanelFlags);

    static const char* kTabs[] = {"Nombre", "Cuerpo", "Pelo", "Barba", "Ropa"};
    ImGui::BeginTabBar("##tabs");
    for (int t = 0; t < 5; ++t)
        if (ImGui::BeginTabItem(kTabs[t])) {
            creator_.tab = t;
            ImGui::EndTabItem();
        }
    ImGui::EndTabBar();
    ImGui::Spacing();

    bool changed = false;
    auto swatches = [&](const char* key, int& index, const char* id) {
        const auto& pal = d.look.palettes.at(key);
        ImGui::PushID(id);
        for (size_t i = 0; i < pal.size(); ++i) {
            if (i && i % 8) ImGui::SameLine();
            ImGui::PushID(static_cast<int>(i));
            if (ImGui::ColorButton("##c", hexColor(pal[i]), ImGuiColorEditFlags_NoTooltip | (static_cast<int>(i) == index ? 0 : ImGuiColorEditFlags_NoBorder), {30, 30})) {
                index = static_cast<int>(i);
                changed = true;
            }
            ImGui::PopID();
        }
        ImGui::PopID();
    };
    auto choose = [&](const char* label, const char* category, std::string& value) {
        ImGui::TextColored(kYellow, "%s", label);
        for (const PieceOption& o : f.catalog->optionsFor(category, look.real.sexo)) {
            if (ImGui::RadioButton((o.label + "##" + category + o.id).c_str(), value == o.id) && value != o.id) {
                value = o.id;
                changed = true;
            }
        }
    };

    switch (creator_.tab) {
        case 0: {
            ImGui::TextColored(kYellow, "Nombre");
            ImGui::SetNextItemWidth(250);
            ImGui::InputText("##nombre", creator_.name, sizeof creator_.name);
            ImGui::SameLine();
            if (ImGui::Button("Sugerir") && !d.look.nameIdeas.empty()) {
                const auto& ideas = d.look.nameIdeas;
                std::snprintf(creator_.name, sizeof creator_.name, "%s", ideas[static_cast<size_t>(f.rng->next() * static_cast<double>(ideas.size())) % ideas.size()].c_str());
            }
            ImGui::Spacing();
            ImGui::TextColored(kYellow, "Origen");
            for (const Origin& o : d.origins) {
                if (ImGui::RadioButton(o.name.c_str(), look.origen == o.id)) {
                    look.origen = o.id;
                    changed = true;
                }
                ImGui::PushTextWrapPos(ImGui::GetWindowWidth() - 16);
                ImGui::Indent(24);
                ImGui::TextColored(kDim, "%s", o.desc.c_str());
                ImGui::Unindent(24);
                ImGui::PopTextWrapPos();
            }
            break;
        }
        case 1: {
            ImGui::TextColored(kYellow, "Sexo");
            for (const char* sx : {"hombre", "mujer"})
                if (ImGui::RadioButton(sx, look.real.sexo == sx) && look.real.sexo != sx) {
                    look.real.sexo = sx;
                    changed = true;
                }
            ImGui::TextColored(kYellow, "Edad");
            for (const char* ed : {"joven", "adulto", "mayor"}) {
                ImGui::SameLine(ed == std::string("joven") ? 0 : ImGui::GetCursorPosX());
                if (ImGui::RadioButton(ed, look.real.edad == ed) && look.real.edad != ed) {
                    look.real.edad = ed;
                    changed = true;
                }
            }
            ImGui::Spacing();
            ImGui::TextColored(kYellow, "Piel");
            swatches("piel", look.piel, "piel");
            break;
        }
        case 2:
            choose("Estilo", "pelo", look.real.pelo);
            ImGui::Spacing();
            ImGui::TextColored(kYellow, "Color");
            swatches("pelo", look.peloColor, "pelo");
            break;
        case 3: choose("Barba", "barba", look.real.barba); break;
        case 4:
            choose("Ropa", "ropa", look.real.ropa);
            ImGui::Spacing();
            choose("Calzado", "calzado", look.real.calzado);
            break;
    }
    if (changed) {
        look.real = f.catalog->normalize(look.real);
        applyLook(look);
    }

    ImGui::SetCursorPosY(ImGui::GetWindowHeight() - 84);
    ImGui::Separator();
    if (ImGui::Button("Aleatorio", {110, 0})) {
        Look r = randomLook(creator_.look, d.look, *f.rng);
        r.real = f.catalog->randomReal(*f.rng);
        r.hasReal = true;
        applyLook(r);
    }
    ImGui::SameLine();
    if (ImGui::Button(creator_.first ? "Empezar" : "Guardar", {110, 0})) {
        Look done = creator_.look;
        done.nombre = cleanName(creator_.name);
        if (done.nombre.empty()) done.nombre = "Parcero";
        creator_.open = false;
        if (hooks_.creatorClosed) hooks_.creatorClosed(done, true);
    }
    if (!creator_.first) {
        ImGui::SameLine();
        if (ImGui::Button("Cancelar", {110, 0})) {
            creator_.open = false;
            if (hooks_.lookChanged) hooks_.lookChanged(creator_.initial);
            if (hooks_.creatorClosed) hooks_.creatorClosed(creator_.initial, false);
        }
    }
    ImGui::TextColored(kDim, "Arrastra con el botón derecho para girar el personaje.");
    ImGui::End();
}

// ---------------------------------------------------------------- carga y rendimiento

void Ui::drawLoading(const LoadingView& v) {
    const ImVec2 disp = ImGui::GetIO().DisplaySize;
    ImGui::GetBackgroundDrawList()->AddRectFilled({0, 0}, disp, IM_COL32(8, 24, 48, 255));
    centerNext(520, v.error.empty() ? 150 : 170);
    ImGui::Begin("##carga", nullptr, kPanelFlags | ImGuiWindowFlags_NoTitleBar);
    ImGui::PushFont(nullptr);
    ImGui::TextColored(kYellow, "BAZUKO");
    ImGui::PopFont();
    ImGui::Separator();
    if (!v.error.empty()) {
        ImGui::TextColored(kRed, "No se pudo completar la carga.");
        ImGui::PushTextWrapPos(ImGui::GetWindowWidth() - 16);
        ImGui::TextWrapped("%s", v.error.c_str());
        ImGui::PopTextWrapPos();
    } else {
        ImGui::TextUnformatted(v.text.c_str());
        ImGui::ProgressBar(static_cast<float>(std::clamp(v.progress, 0.0, 1.0)), {-1, 16});
    }
    ImGui::End();
}

void Ui::perfWindow(const UiFrame& f) {
    const FrameMetrics& m = *f.metrics;
    auto fps = [&](double v) { return m.frameMs() > 0 ? v : 0.0; };
    ImGui::SetNextWindowPos({12, ImGui::GetIO().DisplaySize.y * 0.5f}, ImGuiCond_Always, {0, 0.5f});
    ImGui::SetNextWindowBgAlpha(0.8f);
    ImGui::Begin("##perf", nullptr, (kOverlayFlags & ~ImGuiWindowFlags_NoBackground) & ~ImGuiWindowFlags_NoInputs);
    ImGui::Text("FPS actual %.1f", fps(m.current()));
    ImGui::Text("Mín %.1f · Máx %.1f", fps(m.min()), fps(m.max()));
    ImGui::Text("Promedio %.1f · %.1f ms", fps(m.average()), m.frameMs());
    ImGui::Text("X %.2f  Y %.2f  Z %.2f", f.playerPos.x, f.playerPos.y, f.playerPos.z);
    ImGui::Text("Dibujo %d · Triángulos %zu", f.stats.drawCalls, f.stats.triangles);
    ImGui::Text("Resolución %.2fx", f.renderScale);
    ImGui::Text("Grupos en cámara %d/%d · Descartados %d", f.stats.batchesVisible, f.stats.batchesVisible + f.stats.batchesCulled,
                f.stats.batchesCulled);
    ImGui::Text("Luces dinámicas %d · Halos %d", LocalLights::kPoolSize, f.stats.halos);
    if (ImGui::Button("Reiniciar medición") && hooks_.resetMetrics) hooks_.resetMetrics();
    ImGui::End();
}

}  // namespace bazuko
