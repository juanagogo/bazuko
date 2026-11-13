#define IMGUI_DEFINE_MATH_OPERATORS
#include "Lobby.hpp"

#include "Carton.hpp"
#include "Halftone.hpp"
#include "MarcaBazuko.hpp"
#include "UIManager.hpp"
#include "../audio/AudioManager.hpp"
#include "../core/Input.hpp"
#include "../core/Paths.hpp"
#include "../core/ServerList.hpp"
#include "../core/ScreenshotPng.hpp"
#include "../core/Window.hpp"
#include "../renderer/GL.hpp"
#ifdef BAZUKO_NET_ENABLED
#include "../net/RelayProtocol.hpp"
#include "../net/RoomDirectory.hpp"
#endif

#include <GLFW/glfw3.h>
#include <imgui.h>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <memory>
#include <random>
#include <vector>

namespace Bazuko {

namespace {
namespace C = Carton;

enum class Screen { Home, Multi, Create, Join, Settings, Profile };

struct SaveSummary { bool exists = false; std::string name; float money = 0.0f; int day = 0; };

SaveSummary ReadSave(const std::filesystem::path& savegame) {
    SaveSummary summary;
    std::ifstream in(savegame);
    if (!in) return summary;
    try {
        nlohmann::json state;
        in >> state;
        summary.exists = true;
        summary.money = state.value("money", 0.0f);
        summary.day = state.value("day", 1);
        if (state.contains("character") && state["character"].is_object()) summary.name = state["character"].value("nombre", std::string{});
    } catch (...) { summary.exists = false; }
    return summary;
}

std::string Thousands(int value) {   // punto de miles: 15.000
    std::string digits = std::to_string(std::max(0, value)), out;
    for (size_t i = 0; i < digits.size(); ++i) {
        if (i > 0 && (digits.size() - i) % 3 == 0) out += '.';
        out += digits[i];
    }
    return out;
}

// Barra de carton: la cantidad se lee por lo lleno de la masa rayada. Se arrastra con el raton; con teclado o mando, izquierda y derecha.
bool Slider(const char* id, float* value, float width) {
    ImDrawList* draw = ImGui::GetWindowDrawList();
    const ImVec2 min = ImGui::GetCursorScreenPos(), size(width, 28.0f);
    ImGui::InvisibleButton(id, size);
    float next = *value;
    if (ImGui::IsItemActive()) next = std::clamp((ImGui::GetIO().MousePos.x - min.x - 4.0f) / (width - 8.0f), 0.0f, 1.0f);
    if (ImGui::IsItemFocused()) {
        if (ImGui::IsKeyPressed(ImGuiKey_LeftArrow) || ImGui::IsKeyPressed(ImGuiKey_GamepadDpadLeft)) next = std::max(0.0f, next - 0.05f);
        if (ImGui::IsKeyPressed(ImGuiKey_RightArrow) || ImGui::IsKeyPressed(ImGuiKey_GamepadDpadRight)) next = std::min(1.0f, next + 0.05f);
    }
    const unsigned int seed = static_cast<unsigned int>(ImGui::GetID(id));
    C::Hatch(draw, min + ImVec2(4.0f, 4.0f), min + size - ImVec2(4.0f, 4.0f), next);
    C::HandRect(draw, min, min + size, seed, ImGui::IsItemHovered() || ImGui::IsItemFocused() ? C::kRojo : C::kMarcador, 2.5f);
    const bool changed = next != *value;
    *value = next;
    return changed;
}

// Campo de texto: tira de cinta con letra de marcador
bool Field(const char* id, char* buffer, size_t size, float width, ImGuiInputTextFlags flags = 0) {
    ImGui::PushFont(C::Font(false, 20));
    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImGui::ColorConvertU32ToFloat4(C::kCinta));
    ImGui::PushStyleColor(ImGuiCol_FrameBgHovered, ImVec4(0.95f, 0.90f, 0.77f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_FrameBgActive, ImVec4(0.97f, 0.93f, 0.82f, 1.0f));
    ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(C::kMarcador));
    ImGui::PushStyleColor(ImGuiCol_TextSelectedBg, ImVec4(0.67f, 0.11f, 0.09f, 0.35f));
    ImGui::PushStyleColor(ImGuiCol_Border, ImGui::ColorConvertU32ToFloat4(C::kMarcador));
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(10.0f, 8.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_FrameRounding, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_FrameBorderSize, 2.0f);
    ImGui::SetNextItemWidth(width);
    const bool changed = ImGui::InputText(id, buffer, size, flags);
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(6);
    ImGui::PopFont();
    return changed;
}

void CopyTo(char* buffer, size_t size, const std::string& text) {
    std::snprintf(buffer, size, "%s", text.c_str());
}

std::string Trim(const std::string& text) {
    const size_t first = text.find_first_not_of(" \t");
    if (first == std::string::npos) return {};
    return text.substr(first, text.find_last_not_of(" \t") - first + 1);
}

// Lo marcado: circulo rojo hecho a mano alrededor de la ultima cinta dibujada
void CircleLast(ImDrawList* draw, unsigned int seed) {
    const ImVec2 min = ImGui::GetItemRectMin(), max = ImGui::GetItemRectMax();
    C::HandCircle(draw, (min + max) * 0.5f, (max.x - min.x) * 0.5f + 10.0f, (max.y - min.y) * 0.5f + 8.0f, seed, C::kRojo, 3.0f);
}

// Etiqueta escrita a mano en rojo, ladeada por la marca ("en desarrollo")
void Scrawl(ImDrawList* draw, ImVec2 pos, const char* text, int px = 18) {
    C::Text(draw, true, px, pos, C::kRojo, text);
    const float width = C::TextWidth(true, px, text);
    C::HandLine(draw, pos + ImVec2(-2.0f, static_cast<float>(px) + 3.0f), pos + ImVec2(width + 4.0f, static_cast<float>(px) + 1.0f), 77u, 2.0f, C::kRojo);
}

struct Lobby {
    Screen screen = Screen::Home;
    LobbySettings& settings;
    AudioManager& audio;
    SaveSummary save;
    LobbyChoice choice;
    bool done = false;
    char roomName[64] = {};
    char relay[96] = {};
    char joinText[96] = {};
    std::string joinError, createError;
    bool editingRelay = false;            // el campo del servidor de salas solo se muestra al pulsar «Cambiar»
    ServerListFetch fetch;                // lista de servidores publicada (ver core/ServerList.hpp)
    bool fetchApplied = false;
    std::vector<std::string> autoRelays;  // servidores en modo automatico: la lista bajada, la ultima guardada o el de respaldo
#ifdef BAZUKO_NET_ENABLED
    std::unique_ptr<Net::RoomBrowser> browser;
#endif

    Lobby(LobbySettings& s, AudioManager& a, const std::filesystem::path& savegame) : settings(s), audio(a), save(ReadSave(savegame)) {
        const std::string fallbackName = "Parche de " + (save.name.empty() ? std::string("la calle") : save.name);
        CopyTo(roomName, sizeof roomName, settings.roomName.empty() ? fallbackName : settings.roomName);
        CopyTo(relay, sizeof relay, settings.relay);
        autoRelays = settings.relayCache;
        if (autoRelays.empty() && !FallbackServer().empty()) autoRelays.push_back(FallbackServer());
        fetch.Start(ServerListUrl());
    }

    // los servidores que se usan: el que escribio el jugador o, en automatico, la lista
    std::vector<std::string> EffectiveRelays() const {
        const std::string custom = Trim(relay);
        if (!custom.empty()) return {custom};
        return autoRelays;
    }

    // cuando llega la lista publicada, reemplaza a la guardada y se usa de una vez
    void PollFetch() {
        if (fetchApplied || !fetch.Done()) return;
        fetchApplied = true;
        const std::vector<std::string> list = fetch.Result();
        if (list.empty()) return;   // sin internet o archivo con fallas: sigue la ultima lista o el respaldo
        autoRelays = list;
        settings.relayCache = list;
#ifdef BAZUKO_NET_ENABLED
        if (browser) { ApplyRelay(); browser->Refresh(); }
#endif
    }

    // donde se abre una sala por internet o se busca un codigo: el primer servidor que responde
    std::string RelayForRoom() const {
#ifdef BAZUKO_NET_ENABLED
        if (browser) if (std::string online = browser->OnlineRelay(); !online.empty()) return online;
#endif
        const std::vector<std::string> relays = EffectiveRelays();
        return relays.empty() ? std::string() : relays.front();
    }

    void Go(Screen next) {
        screen = next;
        joinError.clear();
        createError.clear();
#ifdef BAZUKO_NET_ENABLED
        if (next == Screen::Multi) {   // la lista se busca solo mientras se mira
            if (!browser) browser = std::make_unique<Net::RoomBrowser>();
            ApplyRelay();
            browser->Refresh();
        }
#endif
    }

#ifdef BAZUKO_NET_ENABLED
    void ApplyRelay() {
        settings.relay = Trim(relay);
        if (!browser) return;
        std::vector<std::pair<std::string, uint16_t>> relays;
        for (const std::string& address : EffectiveRelays()) {
            const size_t colon = address.rfind(':');
            const std::string host = colon == std::string::npos ? address : address.substr(0, colon);
            const uint16_t port = colon == std::string::npos ? Net::Relay::kDefaultPort : static_cast<uint16_t>(std::atoi(address.c_str() + colon + 1));
            if (!host.empty()) relays.emplace_back(host, port == 0 ? Net::Relay::kDefaultPort : port);
        }
        browser->SetRelays(relays);
    }
#endif

    void Back() {
        if (screen == Screen::Create || screen == Screen::Join) Go(Screen::Multi);
        else if (screen != Screen::Home) Go(Screen::Home);
    }

    // ---- pantallas ----

    void Home(ImDrawList* draw, ImVec2 min, float width) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        C::Text(draw, true, 34, ImVec2(x, y), C::kMarcador, "¿QUÉ VA A JUGAR?");
        y += 52.0f;
        C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 3u, 2.5f);
        y += 18.0f;

        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("historia", "Historia", ImVec2(inner, 58.0f), true, true, "Enter", 26)) { choice.mode = LobbyChoice::Mode::Story; done = true; }
        y += 64.0f;
        C::Text(draw, false, 17, ImVec2(x + 6.0f, y), C::kMarcador, "Otra noche en la calle. Sobreviva en el centro de Bogotá.", inner - 12.0f);
        y += 36.0f;

        ImGui::SetCursorScreenPos(ImVec2(x, y));
#ifdef BAZUKO_NET_ENABLED
        if (C::Tape("multijugador", "Multijugador", ImVec2(inner, 52.0f), false, true, nullptr, 24)) Go(Screen::Multi);
#else
        C::Tape("multijugador", "Multijugador", ImVec2(inner, 52.0f), false, false, nullptr, 24);
#endif
        Scrawl(draw, ImVec2(x + inner - 140.0f, y - 14.0f), "en desarrollo", 16);
        y += 58.0f;
#ifdef BAZUKO_NET_ENABLED
        C::Text(draw, false, 17, ImVec2(x + 6.0f, y), C::kMarcador, "Abra una sala o entre a la de alguien más.", inner - 12.0f);
#else
        C::Text(draw, false, 17, ImVec2(x + 6.0f, y), C::kMarcador, "Esta copia del juego se compiló sin red.", inner - 12.0f);
#endif
        y += 40.0f;

        const float half = (inner - 14.0f) * 0.5f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("ajustes", "Ajustes", ImVec2(half, 46.0f), false, true, nullptr, 21)) Go(Screen::Settings);
        ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
        if (C::Tape("perfil", "Perfil", ImVec2(half, 46.0f), false, true, nullptr, 21)) Go(Screen::Profile);
        Scrawl(draw, ImVec2(x + half + 14.0f + half - 120.0f, y - 14.0f), "en desarrollo", 15);
        y += 62.0f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("salir", "Salir", ImVec2(130.0f, 40.0f), false, true, nullptr, 18)) { choice.mode = LobbyChoice::Mode::Quit; done = true; }
    }

    void Header(ImDrawList* draw, float x, float& y, float inner, const char* title, bool developing) {
        C::Text(draw, true, 34, ImVec2(x, y), C::kMarcador, title);
        if (developing) Scrawl(draw, ImVec2(x + C::TextWidth(true, 34, title) + 18.0f, y + 12.0f), "en desarrollo", 17);
        ImGui::SetCursorScreenPos(ImVec2(x + inner - 120.0f, y + 2.0f));
        if (C::Tape("volver", "Volver", ImVec2(120.0f, 38.0f), false, true, "Esc", 16)) Back();
        y += 52.0f;
        C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 4u, 2.5f);
        y += 16.0f;
    }

    void Multi(ImDrawList* draw, ImVec2 min, float width, float height) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        Header(draw, x, y, inner, "MULTIJUGADOR", true);
#ifdef BAZUKO_NET_ENABLED
        C::Text(draw, false, 16, ImVec2(x, y), C::kMarcador, "Todavía está en desarrollo: puede haber fallas al jugar con otros.", inner);
        y += 30.0f;
        // barra de acciones
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("crear", "Crear sala", ImVec2(200.0f, 46.0f), true, true, nullptr, 21)) Go(Screen::Create);
        ImGui::SetCursorScreenPos(ImVec2(x + 214.0f, y));
        if (C::Tape("codigo", "Unirse con código o IP", ImVec2(260.0f, 46.0f), false, true, nullptr, 18)) { CopyTo(joinText, sizeof joinText, ""); Go(Screen::Join); }
        ImGui::SetCursorScreenPos(ImVec2(x + inner - 150.0f, y));
        if (C::Tape("actualizar", "Actualizar", ImVec2(150.0f, 46.0f), false, true, "R", 17)) browser->Refresh();
        if (ImGui::IsKeyPressed(ImGuiKey_R) && !ImGui::GetIO().WantTextInput) browser->Refresh();
        y += 62.0f;

        C::Text(draw, true, 22, ImVec2(x, y), C::kMarcador, "SALAS ABIERTAS");
        y += 32.0f;
        const float footer = 92.0f;
        const float listHeight = std::max(80.0f, min.y + height - footer - y);
        C::HandRect(draw, ImVec2(x - 6.0f, y - 4.0f), ImVec2(x + inner + 6.0f, y + listHeight), 9u, C::kMarcador, 2.0f);
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ScrollbarBg, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ScrollbarGrab, ImGui::ColorConvertU32ToFloat4(C::kCanto));
        ImGui::BeginChild("##salas", ImVec2(inner, listHeight - 6.0f), false, ImGuiWindowFlags_NoBackground);
        ImDrawList* list = ImGui::GetWindowDrawList();
        const std::vector<Net::RoomListing> rooms = browser->Rooms();
        if (rooms.empty()) {
            const ImVec2 at = ImGui::GetCursorScreenPos() + ImVec2(8.0f, 14.0f);
            C::Text(list, false, 18, at, C::kMarcador, "No hay salas abiertas por ahora. Cree una o actualice la lista.", inner - 30.0f);
            ImGui::Dummy(ImVec2(inner - 20.0f, 60.0f));
        }
        for (size_t i = 0; i < rooms.size(); ++i) {
            const Net::RoomListing& room = rooms[i];
            ImGui::PushID(static_cast<int>(i));
            const ImVec2 rowMin = ImGui::GetCursorScreenPos();
            const float rowWidth = inner - 20.0f;
            C::Text(list, true, 21, rowMin + ImVec2(8.0f, 6.0f), C::kMarcador, room.name.empty() ? "Sala sin nombre" : room.name.c_str(), rowWidth - 300.0f);
            const std::string where = room.lan ? "En esta red · " + room.address : "Por internet · código " + room.code;
            C::Text(list, false, 16, rowMin + ImVec2(8.0f, 34.0f), C::kMarcador, where.c_str());
            char count[32];
            std::snprintf(count, sizeof count, "%d de %d", room.players, room.maxPlayers);
            C::Text(list, true, 19, rowMin + ImVec2(rowWidth - 270.0f, 18.0f), C::kMarcador, count);
            C::Hatch(list, rowMin + ImVec2(rowWidth - 190.0f, 20.0f), rowMin + ImVec2(rowWidth - 140.0f, 40.0f),
                     room.maxPlayers > 0 ? static_cast<float>(room.players) / static_cast<float>(room.maxPlayers) : 0.0f);
            const bool full = room.maxPlayers > 0 && room.players >= room.maxPlayers;
            ImGui::SetCursorScreenPos(rowMin + ImVec2(rowWidth - 124.0f, 10.0f));
            if (C::Tape("entrar", full ? "Llena" : "Entrar", ImVec2(124.0f, 42.0f), !full, !full, nullptr, 18)) {
                choice.roomName = room.name;
                if (room.lan) { choice.mode = LobbyChoice::Mode::JoinAddress; choice.address = room.address + ":" + std::to_string(room.port); }
                else { choice.mode = LobbyChoice::Mode::JoinRoom; choice.code = room.code; choice.address = room.address + ":" + std::to_string(room.port); }
                done = true;
            }
            ImGui::SetCursorScreenPos(rowMin + ImVec2(0.0f, 62.0f));
            if (i + 1 < rooms.size()) C::HandLine(list, rowMin + ImVec2(6.0f, 60.0f), rowMin + ImVec2(rowWidth - 6.0f, 60.0f), 30u + static_cast<unsigned>(i), 1.5f);
            ImGui::Dummy(ImVec2(rowWidth, 6.0f));
            ImGui::PopID();
        }
        ImGui::EndChild();
        ImGui::PopStyleColor(3);

        // servidor de salas por internet: automatico (lista publicada) salvo que el jugador escriba otro con «Cambiar»
        y = min.y + height - footer + 14.0f;
        const bool automatic = Trim(relay).empty();
        const char* state = automatic ? "sin servidores: solo se ven las salas de esta red" : "sin servidor: solo esta red";
        switch (browser->GetRelayState()) {
            case Net::RoomBrowser::RelayState::Online: state = "conectado"; break;
            case Net::RoomBrowser::RelayState::Connecting: state = automatic && !fetch.Done() ? "buscando servidores..." : "buscando..."; break;
            case Net::RoomBrowser::RelayState::Failed: state = "no responde; se ven solo las salas de esta red"; break;
            default: break;
        }
        if (!editingRelay) {
            const std::string line = automatic ? std::string("Servidor de salas: automático") : "Servidor de salas: " + Trim(relay);
            C::Text(draw, true, 18, ImVec2(x, y + 10.0f), C::kMarcador, line.c_str());
            const float lineWidth = C::TextWidth(true, 18, line.c_str()) + 14.0f;
            C::Text(draw, false, 16, ImVec2(x + lineWidth, y + 12.0f), C::kMarcador, state, inner - lineWidth - 140.0f);
            ImGui::SetCursorScreenPos(ImVec2(x + inner - 120.0f, y));
            if (C::Tape("cambiarServidor", "Cambiar", ImVec2(120.0f, 40.0f), false, true, nullptr, 17)) editingRelay = true;
        } else {
            C::Text(draw, true, 18, ImVec2(x, y + 10.0f), C::kMarcador, "Servidor:");
            const float labelWidth = C::TextWidth(true, 18, "Servidor:") + 12.0f;
            const float fieldWidth = std::max(160.0f, inner - labelWidth - 300.0f);
            ImGui::SetCursorScreenPos(ImVec2(x + labelWidth, y));
            const bool entered = Field("##relevo", relay, sizeof relay, fieldWidth, ImGuiInputTextFlags_EnterReturnsTrue);
            ImGui::SetCursorScreenPos(ImVec2(x + labelWidth + fieldWidth + 12.0f, y));
            if (C::Tape("listoServidor", "Listo", ImVec2(110.0f, 40.0f), false, true, nullptr, 17) || entered) {
                editingRelay = false;
                ApplyRelay();
                browser->Refresh();
            }
            ImGui::SetCursorScreenPos(ImVec2(x + inner - 160.0f, y));
            if (C::Tape("automatico", "Automático", ImVec2(160.0f, 40.0f), false, true, nullptr, 17)) {
                CopyTo(relay, sizeof relay, "");
                editingRelay = false;
                ApplyRelay();
                browser->Refresh();
            }
        }
#else
        (void)height;
        C::Text(draw, false, 18, ImVec2(x, y), C::kMarcador, "Esta copia del juego se compiló sin red (BAZUKO_NET=OFF).", inner);
#endif
    }

    void Create(ImDrawList* draw, ImVec2 min, float width) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        Header(draw, x, y, inner, "CREAR SALA", true);
        C::Text(draw, true, 20, ImVec2(x, y), C::kMarcador, "Nombre de la sala");
        y += 30.0f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        Field("##nombreSala", roomName, sizeof roomName, std::min(inner, 460.0f));
        y += 58.0f;

        C::Text(draw, true, 20, ImVec2(x, y + 10.0f), C::kMarcador, "Dónde");
        ImGui::SetCursorScreenPos(ImVec2(x + 120.0f, y));
        if (C::Tape("lan", "En esta red", ImVec2(190.0f, 42.0f), false, true, nullptr, 18)) settings.roomInternet = false;
        if (!settings.roomInternet) CircleLast(draw, 51u);
        ImGui::SetCursorScreenPos(ImVec2(x + 340.0f, y));
        if (C::Tape("internet", "Por internet", ImVec2(190.0f, 42.0f), false, true, nullptr, 18)) settings.roomInternet = true;
        if (settings.roomInternet) CircleLast(draw, 52u);
        y += 62.0f;

        if (settings.roomInternet) {
            C::Text(draw, true, 20, ImVec2(x, y + 10.0f), C::kMarcador, "Quién la ve");
            ImGui::SetCursorScreenPos(ImVec2(x + 120.0f, y));
            if (C::Tape("publica", "Todos", ImVec2(190.0f, 42.0f), false, true, nullptr, 18)) settings.roomPublic = true;
            if (settings.roomPublic) CircleLast(draw, 53u);
            ImGui::SetCursorScreenPos(ImVec2(x + 340.0f, y));
            if (C::Tape("privada", "Solo con código", ImVec2(190.0f, 42.0f), false, true, nullptr, 18)) settings.roomPublic = false;
            if (!settings.roomPublic) CircleLast(draw, 54u);
            y += 62.0f;
        }

        C::Text(draw, true, 20, ImVec2(x, y + 10.0f), C::kMarcador, "Cupo");
        static const int sizes[4] = {2, 4, 8, 16};
        for (int i = 0; i < 4; ++i) {
            char label[8];
            std::snprintf(label, sizeof label, "%d", sizes[i]);
            ImGui::SetCursorScreenPos(ImVec2(x + 120.0f + static_cast<float>(i) * 92.0f, y));
            if (C::Tape(label, label, ImVec2(70.0f, 42.0f), false, true, nullptr, 20)) settings.roomSize = sizes[i];
            if (settings.roomSize == sizes[i]) CircleLast(draw, 60u + static_cast<unsigned>(i));
        }
        y += 66.0f;

        const char* hint = !settings.roomInternet
            ? "Quienes estén conectados a la misma red la verán en su lista."
            : settings.roomPublic ? "Se abre en el servidor de salas y sale en la lista de todos."
                                  : "Se abre en el servidor de salas; solo entra quien tenga el código.";
        C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador, hint, inner);
        y += 44.0f;
        const std::string name = Trim(roomName);
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("abrir", "Abrir sala", ImVec2(240.0f, 54.0f), true, !name.empty(), nullptr, 24)) {
            settings.roomName = name;
            choice.mode = settings.roomInternet ? LobbyChoice::Mode::HostRelay : LobbyChoice::Mode::HostLan;
            choice.roomName = name;
            choice.listed = settings.roomPublic;
            choice.maxPlayers = settings.roomSize;
            choice.address = settings.roomInternet ? RelayForRoom() : std::string();
            if (settings.roomInternet && choice.address.empty()) createError = "No hay servidor de salas disponible: abra la sala en esta red.";
            else done = true;
        }
        if (!createError.empty()) C::Text(draw, false, 16, ImVec2(x + 260.0f, y + 16.0f), C::kRojo, createError.c_str(), inner - 260.0f);
    }

    void Join(ImDrawList* draw, ImVec2 min, float width) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        Header(draw, x, y, inner, "UNIRSE", true);
        C::Text(draw, true, 20, ImVec2(x, y), C::kMarcador, "Código de la sala o dirección IP");
        y += 30.0f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        const bool entered = Field("##unirse", joinText, sizeof joinText, std::min(inner, 360.0f), ImGuiInputTextFlags_EnterReturnsTrue);
        y += 56.0f;
        C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador,
                "Un código de 6 letras entra por el servidor de salas. Una IP entra directo (agregue :puerto si no es 7777).", inner);
        y += 56.0f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("entrarJoin", "Entrar", ImVec2(200.0f, 50.0f), true, true, nullptr, 22) || entered) {
            std::string text = Trim(joinText);
            const bool isCode = text.size() == 6 && std::all_of(text.begin(), text.end(), [](char c) { return std::isalnum(static_cast<unsigned char>(c)) != 0; });
            if (isCode) {
                for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
                const std::string server = RelayForRoom();
                if (server.empty()) joinError = "Para entrar con código hace falta un servidor de salas, y ahora no hay ninguno.";
                else { choice.mode = LobbyChoice::Mode::JoinRoom; choice.code = text; choice.address = server; done = true; }
            } else if (!text.empty() && text.find(' ') == std::string::npos) {
                choice.mode = LobbyChoice::Mode::JoinAddress; choice.address = text; done = true;
            } else {
                joinError = "Escriba un código de 6 caracteres o una dirección IP.";
            }
        }
        if (!joinError.empty()) C::Text(draw, false, 17, ImVec2(x, y + 64.0f), C::kRojo, joinError.c_str(), inner);
    }

    void Settings(ImDrawList* draw, ImVec2 min, float width) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        Header(draw, x, y, inner, "AJUSTES", false);
        C::Text(draw, true, 22, ImVec2(x, y), C::kMarcador, "SONIDO");
        y += 34.0f;
        const float labelWidth = 150.0f, barWidth = std::min(inner - labelWidth - 170.0f, 360.0f);
        C::Text(draw, true, 19, ImVec2(x, y + 3.0f), C::kMarcador, "General");
        ImGui::SetCursorScreenPos(ImVec2(x + labelWidth, y));
        if (Slider("##general", &settings.volume, barWidth)) audio.SetVolume(settings.volume);
        ImGui::SetCursorScreenPos(ImVec2(x + labelWidth + barWidth + 20.0f, y - 6.0f));
        if (C::Tape("silencio", settings.muted ? "Activar" : "Silenciar", ImVec2(150.0f, 40.0f), false, true, nullptr, 17)) {
            settings.muted = !settings.muted;
            audio.SetMuted(settings.muted);
        }
        if (settings.muted) CircleLast(draw, 70u);
        y += 46.0f;
        static const std::array<std::pair<const char*, MixCategory>, 4> rows{{
            {"Ambiente", MixCategory::Ambient}, {"Tráfico", MixCategory::Traffic}, {"Voces", MixCategory::Voices}, {"Efectos", MixCategory::Effects}}};
        for (size_t i = 0; i < rows.size(); ++i) {
            C::Text(draw, false, 18, ImVec2(x + 14.0f, y + 4.0f), C::kMarcador, rows[i].first);
            ImGui::SetCursorScreenPos(ImVec2(x + labelWidth, y));
            ImGui::PushID(static_cast<int>(i));
            if (Slider("##mezcla", &settings.mix[i], barWidth)) audio.SetMix(rows[i].second, settings.mix[i]);
            ImGui::PopID();
            y += 38.0f;
        }
        y += 14.0f;
        C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 6u, 2.0f);
        y += 16.0f;
        C::Text(draw, true, 22, ImVec2(x, y), C::kMarcador, "CALIDAD");
        y += 36.0f;
        static const char* const labels[3] = {"Baja", "Media", "Alta"};
        for (int quality = 0; quality < 3; ++quality) {
            ImGui::SetCursorScreenPos(ImVec2(x + static_cast<float>(quality) * 170.0f, y));
            if (C::Tape(labels[quality], labels[quality], ImVec2(140.0f, 44.0f), false, true, nullptr, 20)) settings.quality = quality;
            if (settings.quality == quality) CircleLast(draw, 80u + static_cast<unsigned>(quality));
        }
        y += 62.0f;
        C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador,
                "Baja da más cuadros por segundo en equipos modestos; alta suma reflejos, sombras lejanas y más detalle. Se puede cambiar después en la pausa.", inner);
    }

    void Profile(ImDrawList* draw, ImVec2 min, float width) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        Header(draw, x, y, inner, "PERFIL", true);
        if (save.exists) {
            const std::string name = save.name.empty() ? std::string("Sin nombre todavía") : save.name;
            C::Text(draw, true, 30, ImVec2(x, y), C::kMarcador, name.c_str());
            y += 48.0f;
            const std::string money = "Plata guardada: $ " + Thousands(static_cast<int>(save.money));
            C::Text(draw, false, 20, ImVec2(x, y), C::kMarcador, money.c_str());
            y += 32.0f;
            const std::string day = "Lleva " + std::to_string(std::max(1, save.day)) + (save.day == 1 ? " día en la calle" : " días en la calle");
            C::Text(draw, false, 20, ImVec2(x, y), C::kMarcador, day.c_str());
            y += 46.0f;
        } else {
            C::Text(draw, false, 20, ImVec2(x, y), C::kMarcador, "Todavía no tiene una partida guardada. Su perfil empieza con la primera noche.", inner);
            y += 70.0f;
        }
        C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 7u, 2.0f);
        y += 18.0f;
        C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador,
                "Pronto podrá cambiar su nombre aquí y llevar su perfil a las salas de otros jugadores. Por ahora su aspecto se cambia en el juego con la tecla P.", inner);
    }
};

} // namespace

// ---- ajustes ----

LobbySettings LobbySettings::Load(const std::filesystem::path& file, const std::filesystem::path& savegame) {
    LobbySettings settings;
    bool hasQuality = false;
    if (std::ifstream in(file); in) {
        try {
            nlohmann::json state;
            in >> state;
            settings.volume = std::clamp(state.value("volume", settings.volume), 0.0f, 1.0f);
            settings.muted = state.value("muted", false);
            const auto mix = state.value("mix", std::vector<float>{});
            for (size_t i = 0; i < std::min(mix.size(), settings.mix.size()); ++i) settings.mix[i] = std::clamp(mix[i], 0.0f, 1.0f);
            if (state.contains("quality")) { settings.quality = std::clamp(state.value("quality", 1), 0, 2); hasQuality = true; }
            settings.relay = state.value("relay", settings.relay);
            if (settings.relay == "127.0.0.1:7770") settings.relay.clear();   // el valor por defecto de antes pasa a automatico
            for (const auto& address : state.value("relayCache", std::vector<std::string>{}))
                if (!address.empty() && address.size() <= 120 && settings.relayCache.size() < 8) settings.relayCache.push_back(address);
            if (const auto own = state.find("servidorPropio"); own != state.end() && own->is_object()) {
                settings.ownServer = own->value("activo", false);
                settings.playitPath = own->value("playit", std::string{});
            }
            settings.roomName = state.value("roomName", std::string{});
            settings.roomInternet = state.value("roomInternet", false);
            settings.roomPublic = state.value("roomPublic", true);
            settings.roomSize = std::clamp(state.value("roomSize", 8), 2, 16);
        } catch (...) {}
    }
    if (!hasQuality) {   // equipos que ya tenian partida: la calidad que eligieron en la pausa
        if (std::ifstream in(savegame); in) {
            try { nlohmann::json state; in >> state; settings.quality = std::clamp(state.value("graphicsQuality", 1), 0, 2); } catch (...) {}
        }
    }
    return settings;
}

void LobbySettings::Save(const std::filesystem::path& file) const {
    nlohmann::json state;
    state["volume"] = volume;
    state["muted"] = muted;
    state["mix"] = std::vector<float>(mix.begin(), mix.end());
    state["quality"] = quality;
    state["relay"] = relay;
    state["relayCache"] = relayCache;
    if (ownServer || !playitPath.empty()) state["servidorPropio"] = {{"activo", ownServer}, {"playit", playitPath}};
    state["roomName"] = roomName;
    state["roomInternet"] = roomInternet;
    state["roomPublic"] = roomPublic;
    state["roomSize"] = roomSize;
    std::ofstream out(file, std::ios::trunc);
    out << state.dump(2);
}

void LobbySettings::ApplyAudio(AudioManager& audio) const {
    audio.SetVolume(volume);
    audio.SetMuted(muted);
    static constexpr MixCategory categories[4] = {MixCategory::Ambient, MixCategory::Traffic, MixCategory::Voices, MixCategory::Effects};
    for (size_t i = 0; i < mix.size(); ++i) audio.SetMix(categories[i], mix[i]);
}

void LobbySettings::ReadAudio(const AudioManager& audio) {
    volume = audio.GetVolume();
    muted = audio.IsMuted();
    static constexpr MixCategory categories[4] = {MixCategory::Ambient, MixCategory::Traffic, MixCategory::Voices, MixCategory::Effects};
    for (size_t i = 0; i < mix.size(); ++i) mix[i] = audio.GetMix(categories[i]);
}

// ---- lobby ----

LobbyChoice RunLobby(Window& window, UIManager& ui, AudioManager& audio, LobbySettings& settings, const std::filesystem::path& savegame) {
    settings.ApplyAudio(audio);
    Lobby lobby(settings, audio, savegame);
    std::vector<C::HalftoneDot> dots;
    float builtWidth = 0.0f, builtHeight = 0.0f;
    std::mt19937 pick(static_cast<unsigned>(std::chrono::steady_clock::now().time_since_epoch().count()));
    const int artwork = static_cast<int>(pick() % 4u) + 1;
    GLFWwindow* native = window.GetNativeWindow();
    // Input::Init deja el raton atrapado para la camara: en el lobby se necesita la flecha, y al salir vuelve a quedar atrapado como antes
    const bool wasLocked = Input::IsCursorLocked();
    Input::SetCursorLocked(false);
    // pruebas: BAZUKO_LOBBY_SHOT=ruta.png guarda una captura del lobby y cierra; BAZUKO_LOBBY_PANTALLA=multi|crear|unirse|ajustes|perfil elige cual
    const char* shotPath = std::getenv("BAZUKO_LOBBY_SHOT");
    int shotFrames = 0;
    if (const char* which = std::getenv("BAZUKO_LOBBY_PANTALLA")) {
        const std::string name = which;
        if (name == "multi") lobby.Go(Screen::Multi);
        else if (name == "crear") lobby.Go(Screen::Create);
        else if (name == "unirse") lobby.Go(Screen::Join);
        else if (name == "ajustes") lobby.Go(Screen::Settings);
        else if (name == "perfil") lobby.Go(Screen::Profile);
    }

    while (!lobby.done) {
        glfwWaitEventsTimeout(1.0 / 60.0);   // el lobby no necesita correr a mil cuadros: espera eventos o el siguiente cuadro
        if (glfwWindowShouldClose(native)) { lobby.choice.mode = LobbyChoice::Mode::Quit; break; }
        int fbWidth = 0, fbHeight = 0;
        glfwGetFramebufferSize(native, &fbWidth, &fbHeight);
        if (fbWidth <= 0 || fbHeight <= 0) continue;   // minimizada
        glViewport(0, 0, fbWidth, fbHeight);
        glClearColor(0.80f, 0.64f, 0.42f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        ui.BeginFrame();
        lobby.PollFetch();
#ifdef BAZUKO_NET_ENABLED
        if (lobby.browser && (lobby.screen == Screen::Multi || lobby.screen == Screen::Join || lobby.screen == Screen::Create)) lobby.browser->Update();
#endif

        const ImVec2 display = ImGui::GetIO().DisplaySize;
        ImDrawList* back = ImGui::GetBackgroundDrawList();
        // carton de fondo con la flauta, el arte de la carga en semitono y BAZUKO ya escrito arriba
        const float margin = std::clamp(display.x * 0.02f, 16.0f, 30.0f);
        const float wordWidth = std::min(display.x - margin * 2.0f, display.y * 0.2f * C::kMarcaWidth / C::kMarcaHeight);   // BAZUKO ocupa a lo sumo un quinto del alto
        const float wordScale = wordWidth / C::kMarcaWidth;
        const float wordHeight = C::kMarcaHeight * wordScale;
        back->AddRectFilled(ImVec2(0, 0), display, C::kCarton);
        for (float fx = 0.0f; fx < display.x; fx += 7.0f) back->AddLine(ImVec2(fx, 0.0f), ImVec2(fx, display.y), IM_COL32(90, 60, 25, 26), 1.0f);
        if (std::abs(builtWidth - display.x) > 0.5f || std::abs(builtHeight - display.y) > 0.5f) {
            const std::string folder = "public/images/pantalla-carga/";
            dots = C::BuildHalftone(Paths::Find(folder + "fondo_pantalla_carga_" + std::to_string(artwork) + ".webp"),
                                    Paths::Find(folder + "personaje_pantalla_carga_" + std::to_string(artwork) + ".webp"), display.x, display.y, margin + wordHeight);
            builtWidth = display.x;
            builtHeight = display.y;
        }
        for (const C::HalftoneDot& dot : dots) back->AddCircleFilled(ImVec2(dot.x, dot.y), dot.radius, C::kMarcador, 8);
        for (const C::MarcaStroke& stroke : C::MarcaBazuko()) {
            std::vector<ImVec2> points;
            for (size_t i = 0; i + 1 < stroke.xy.size(); i += 2)
                points.push_back(ImVec2(margin + stroke.xy[i] * wordScale, margin + (stroke.xy[i + 1] - C::kMarcaTop) * wordScale));
            back->AddConcavePolyFilled(points.data(), static_cast<int>(points.size()), C::kMarcador);
        }

        // la pieza de carton del menu, a la izquierda (el arte queda a la vista a la derecha)
        const bool wide = lobby.screen == Screen::Multi || lobby.screen == Screen::Settings || lobby.screen == Screen::Create;
        const float width = std::min(display.x - 32.0f, wide ? 820.0f : 560.0f);
        const float top = margin + wordHeight + 18.0f;
        const float room = std::max(300.0f, display.y - top - 24.0f);
        float fit = room;   // cada pantalla mide lo que tiene; la de salas usa todo el alto para la lista
        switch (lobby.screen) {
            case Screen::Home: fit = 440.0f; break;
            case Screen::Profile: fit = 400.0f; break;
            case Screen::Join: fit = 380.0f; break;
            case Screen::Create: fit = settings.roomInternet ? 540.0f : 478.0f; break;
            case Screen::Settings: fit = 560.0f; break;
            case Screen::Multi: break;
        }
        const float height = std::min(fit, room);
        const ImVec2 panelMin(std::max(16.0f, display.x * 0.05f), top);
        ImGui::SetNextWindowPos(panelMin, ImGuiCond_Always);
        ImGui::SetNextWindowSize(ImVec2(width, height), ImGuiCond_Always);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
        ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0, 0, 0, 0));
        ImGui::Begin("##lobbyCarton", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings |
                                                   ImGuiWindowFlags_NoScrollWithMouse | ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoBringToFrontOnFocus);
        ImGui::PopStyleColor();
        ImGui::PopStyleVar(2);
        ImDrawList* draw = ImGui::GetWindowDrawList();
        C::Panel(draw, panelMin, panelMin + ImVec2(width, height), 21u, 9.0f);
        switch (lobby.screen) {
            case Screen::Home: lobby.Home(draw, panelMin, width); break;
            case Screen::Multi: lobby.Multi(draw, panelMin, width, height); break;
            case Screen::Create: lobby.Create(draw, panelMin, width); break;
            case Screen::Join: lobby.Join(draw, panelMin, width); break;
            case Screen::Settings: lobby.Settings(draw, panelMin, width); break;
            case Screen::Profile: lobby.Profile(draw, panelMin, width); break;
        }
        if (ImGui::IsKeyPressed(ImGuiKey_Escape, false) || ImGui::IsKeyPressed(ImGuiKey_GamepadFaceRight, false)) lobby.Back();
        if (lobby.screen == Screen::Home && !ImGui::GetIO().WantTextInput && ImGui::IsKeyPressed(ImGuiKey_Enter, false) && !ImGui::IsAnyItemFocused()) {
            lobby.choice.mode = LobbyChoice::Mode::Story;
            lobby.done = true;
        }
        ImGui::End();

        ui.EndFrame();
        if (shotPath && ++shotFrames == 90) {   // ~1,5 s: la lista de salas ya respondio
            std::vector<uint8_t> pixels(static_cast<size_t>(fbWidth) * fbHeight * 3), flipped(pixels.size());
            glReadBuffer(GL_BACK);
            glPixelStorei(GL_PACK_ALIGNMENT, 1);
            glReadPixels(0, 0, fbWidth, fbHeight, GL_RGB, GL_UNSIGNED_BYTE, pixels.data());
            for (int y = 0; y < fbHeight; ++y)
                std::copy_n(&pixels[static_cast<size_t>(fbHeight - 1 - y) * fbWidth * 3], static_cast<size_t>(fbWidth) * 3, &flipped[static_cast<size_t>(y) * fbWidth * 3]);
            WritePngRgb(shotPath, fbWidth, fbHeight, flipped);
            lobby.choice.mode = LobbyChoice::Mode::Quit;
            lobby.done = true;
        }
        window.SwapBuffers();
    }
    settings.roomName = Trim(lobby.roomName);
    settings.relay = Trim(lobby.relay);
    if (wasLocked) Input::SetCursorLocked(true);
    return lobby.choice;
}

} // namespace Bazuko
