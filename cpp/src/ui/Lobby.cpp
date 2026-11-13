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
#include "online/NameRules.hpp"
#include "online/Session.hpp"
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
#include <ctime>
#include <fstream>
#include <memory>
#include <optional>
#include <random>
#include <thread>
#include <vector>

namespace Bazuko {

// ---- la sala de este jugador ----

bool LobbyRoom::Active() const {
#ifdef BAZUKO_NET_ENABLED
    return session != nullptr;
#else
    return false;
#endif
}

std::string LobbyRoom::Code() const {
#ifdef BAZUKO_NET_ENABLED
    return session ? session->RoomCode() : std::string();
#else
    return {};
#endif
}

void LobbyRoom::Close() {
#ifdef BAZUKO_NET_ENABLED
    beacon.reset();
    if (session) session->CloseRoom();   // el relevo la borra ya y el codigo queda libre
    session.reset();   // en esta red se cierra el puerto
#endif
}

namespace {
namespace C = Carton;

enum class Screen { Home, Multi, Create, Join, Settings, Profile, Ranking };
enum class Modal { None, Opening, RoomReady, ConfirmQuit, AskCode };   // encima de la pantalla: abriendo la sala, su ficha, salir con la sala abierta, pedir el codigo de otra

struct SaveSummary { bool exists = false; std::string name; float money = 0.0f; int day = 0; std::string look; };   // look: JSON plano del personaje sin nombre

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
        if (state.contains("character") && state["character"].is_object()) {
            summary.name = state["character"].value("nombre", std::string{});
            nlohmann::json look = nlohmann::json::object();
            for (const auto& [key, value] : state["character"].items())
                if (key != "nombre" && (value.is_string() || value.is_number() || value.is_boolean())) look[key] = value;
            if (!look.empty()) summary.look = look.dump();
        }
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
bool Field(const char* id, char* buffer, size_t size, float width, ImGuiInputTextFlags flags = 0, ImGuiInputTextCallback filter = nullptr) {
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
    const bool changed = ImGui::InputText(id, buffer, size, filter ? flags | ImGuiInputTextFlags_CallbackCharFilter : flags, filter);
    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(6);
    ImGui::PopFont();
    return changed;
}

// Nombre de usuario: solo letras a-z y numeros (el resto ni se escribe)
int OnlyLettersAndDigits(ImGuiInputTextCallbackData* data) {
    const ImWchar c = data->EventChar;
    const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9');
    return ok ? 0 : 1;
}

// Borra una contrasena escrita en cuanto ya no hace falta
// Codigos de verificacion: solo numeros
int OnlyDigits(ImGuiInputTextCallbackData* data) {
    return data->EventChar >= '0' && data->EventChar <= '9' ? 0 : 1;
}

void WipeBuffer(char* buffer, size_t size) {
    volatile char* p = buffer;
    for (size_t i = 0; i < size; ++i) p[i] = '\0';
}

void CopyTo(char* buffer, size_t size, const std::string& text) {
    std::snprintf(buffer, size, "%s", text.c_str());
}

std::string Trim(const std::string& text) {
    const size_t first = text.find_first_not_of(" \t");
    if (first == std::string::npos) return {};
    return text.substr(first, text.find_last_not_of(" \t") - first + 1);
}

// 13/11/2026 (hora local)
std::string DateText(long long seconds) {
    const std::time_t when = static_cast<std::time_t>(seconds);
    std::tm parts{};
#ifdef _WIN32
    localtime_s(&parts, &when);
#else
    localtime_r(&when, &parts);
#endif
    char text[16];
    std::snprintf(text, sizeof text, "%02d/%02d/%04d", parts.tm_mday, parts.tm_mon + 1, parts.tm_year + 1900);
    return text;
}

// 3 h 20 min de juego
std::string HoursText(long long seconds) {
    const long long minutes = std::max(0LL, seconds) / 60;
    if (minutes < 60) return std::to_string(minutes) + " min";
    return std::to_string(minutes / 60) + " h " + std::to_string(minutes % 60) + " min";
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
    LobbyRoom& hosted;                    // la sala de este jugador (sigue abierta al volver de la partida)
    bool inGame = false;                  // se volvio desde una partida: la ciudad ya esta cargada
    char codeText[16] = {};               // codigo propio de la sala (opcional)
    Modal modal = Modal::None;
    double openingSince = 0.0;
    // unirse a una sala con codigo de la lista: se escribe el codigo y el servidor lo revisa antes de salir a la partida
    std::string askName, askRelay;
    char askText[16] = {};
    std::string askError;
    double askCheckSince = -1.0;   // < 0: no se esta revisando
    bool askFocus = false;
    // cuenta del jugador (pantalla Perfil): entrar, crear cuenta, cerrar sesion
    Online::Session* account = nullptr;
    bool signUpTab = false;      // false: «Entrar»; true: «Crear cuenta»
    bool wantMulti = false;      // se pidio el Multijugador sin sesion: al entrar, sigue a la lista de salas
    char accName[Online::kNameMax + 1] = {};
    char accPass[72] = {}, accPass2[72] = {};
    char accEmail[96] = {};
    std::string accError;        // lo que salio mal (revisado en el juego o devuelto por el servidor)
    std::string accInfo;         // lo que salio bien («Correo verificado», «Contraseña cambiada»)
    // dentro del Perfil: la ficha (Main) o una gestion de la cuenta
    enum class AccPanel { Main, Email, Verify, Password, ForgotName, ForgotCode, Delete };
    AccPanel accPanel = AccPanel::Main;
    char accOld[72] = {};        // contrasena actual al cambiarla
    char accCode[8] = {};        // codigo de 6 numeros que llega al correo
    char accCode2[24] = {};      // el nombre escrito para confirmar que se borra la cuenta
    // clasificacion: estadistica elegida (kRankTables), alcance (0 top 10, 1 top 100, 2 global) y la pagina global
    int rankTable = 0, rankScope = 0, rankFrom = 0;
    std::shared_ptr<Online::HttpCall> rankCall;
    std::optional<Online::Leaderboard> rankBoard;
    bool rankFailed = false;
#ifdef BAZUKO_NET_ENABLED
    std::unique_ptr<Net::RoomBrowser> browser;
#endif

    Lobby(LobbySettings& s, AudioManager& a, const std::filesystem::path& savegame, LobbyRoom& room, bool fromGame, Online::Session* acc)
        : settings(s), audio(a), save(ReadSave(savegame)), hosted(room), inGame(fromGame), account(acc) {
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
        if (screen == Screen::Profile && next != Screen::Profile) { ForgetPasswords(); accPanel = AccPanel::Main; accError.clear(); accInfo.clear(); }
        if (next != Screen::Profile) wantMulti = false;
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

    bool AccountsOn() const { return account && account->Configured(); }
    bool SignedIn() const { return account && account->GetState() == Online::Session::State::SignedIn; }

    // El multijugador pide cuenta (si este juego tiene servidor de cuentas): sin sesion, primero la pantalla de entrar
    void TryMulti() {
        if (AccountsOn() && !SignedIn()) {
            Go(Screen::Profile);
            wantMulti = true;
            return;
        }
        Go(Screen::Multi);
    }

    void ForgetPasswords() {
        WipeBuffer(accPass, sizeof accPass);
        WipeBuffer(accPass2, sizeof accPass2);
        WipeBuffer(accOld, sizeof accOld);
    }

    void SubmitAccount() {
        if (!account || account->GetState() == Online::Session::State::Working) return;
        accError.clear();
        account->ClearError();
        const std::string name = accName;
        if (signUpTab) {
            if (const auto problem = Online::CheckName(name); problem != Online::NameProblem::None) { accError = Online::NameProblemText(problem); return; }
            if (const auto problem = Online::CheckPassword(accPass, accPass2, name); problem != Online::PasswordProblem::None) { accError = Online::PasswordProblemText(problem); return; }
            const std::string email = Trim(accEmail);
            if (!email.empty() && (email.find('@') == std::string::npos || email.find('.') == std::string::npos || email.find(' ') != std::string::npos)) {
                accError = "Ese correo no parece bien escrito. Revíselo o déjelo vacío.";
                return;
            }
            account->SignUp(name, std::string(accPass), email);
        } else {
            if (name.empty() || accPass[0] == '\0') { accError = "Escriba su usuario y su contraseña."; return; }
            account->SignIn(name, std::string(accPass));
        }
        ForgetPasswords();   // la contrasena ya va en camino (por TLS) y no se queda en el lobby
    }

    // cada cuadro: la sesion termina lo pendiente; si se entro viniendo del Multijugador, sigue a la lista de salas
    void TickAccount() {
        if (!account) return;
        account->Update(static_cast<long long>(std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count()));
        using Task = Online::Session::Task;
        using TaskState = Online::Session::TaskState;
        const TaskState state = account->GetTaskState();
        if (state == TaskState::Done || state == TaskState::Failed) {
            const Task task = account->CurrentTask();
            const Online::AuthError error = account->TaskError();
            const bool ok = state == TaskState::Done;
            switch (task) {
            case Task::SetEmail:
                if (!ok) accError = Online::AuthErrorText(error);
                else if (account->Email().empty()) { SetPanel(AccPanel::Main); accInfo = "Correo quitado. Sin correo no se puede recuperar la contraseña."; }
                else SetPanel(AccPanel::Verify);   // ya se mando el codigo
                break;
            case Task::SendEmailCode:
                if (ok) accInfo = "Código enviado. Revise su correo.";
                else accError = Online::AuthErrorText(error);
                break;
            case Task::VerifyEmail:
                if (ok) { SetPanel(AccPanel::Main); accInfo = "Correo verificado. Si olvida la contraseña, puede recuperarla."; }
                else accError = Online::AuthErrorText(error);
                break;
            case Task::ChangePassword:
                if (ok) { SetPanel(AccPanel::Main); accInfo = "Contraseña cambiada. Su cuenta se cerró en los demás equipos."; }
                else accError = error == Online::AuthError::BadCredentials ? "La contraseña actual no es esa." : Online::AuthErrorText(error);
                break;
            case Task::ForgotPassword:
                if (ok) { if (accPanel == AccPanel::ForgotName) SetPanel(AccPanel::ForgotCode); else accInfo = "Si la cuenta tiene correo verificado, le llegó otro código."; }
                else accError = Online::AuthErrorText(error);
                break;
            case Task::ConfirmForgotPassword:
                if (ok) { SetPanel(AccPanel::Main); accInfo = "Contraseña cambiada. Su cuenta se cerró en los demás equipos."; }
                else accError = Online::AuthErrorText(error);
                break;
            case Task::SaveProfile:
                if (ok) accInfo = "Perfil guardado.";
                else accError = Online::AuthErrorText(error);
                break;
            case Task::DeleteAccount:
                if (ok) { SetPanel(AccPanel::Main); signUpTab = false; accInfo = "Su cuenta se borró. El nombre quedó libre."; }
                else accError = Online::AuthErrorText(error);
                break;
            case Task::LoadUser:
            case Task::None:
                break;
            }
            account->ClearTask();
        }
        if (SignedIn() && screen == Screen::Profile && wantMulti) {
            wantMulti = false;
            Go(Screen::Multi);
        }
    }

    float ProfileHeight() const {
        if (!AccountsOn()) return 400.0f;
        const float notes = accError.empty() && accInfo.empty() ? 0.0f : 46.0f;
        if (SignedIn()) {
            switch (accPanel) {
            case AccPanel::Email: return 300.0f + notes;
            case AccPanel::Verify: return 360.0f + notes;
            case AccPanel::Password: return 450.0f + notes;
            case AccPanel::Delete: return 360.0f + notes;
            default: return 570.0f + notes;
            }
        }
        if (account->GetState() == Online::Session::State::Working) return 300.0f;
        if (accPanel == AccPanel::ForgotName) return 340.0f + notes;
        if (accPanel == AccPanel::ForgotCode) return 450.0f + notes;
        return (signUpTab ? 630.0f : 440.0f) + (wantMulti ? 54.0f : 0.0f) + notes;
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
        if (screen == Screen::Profile && accPanel != AccPanel::Main) { SetPanel(AccPanel::Main); accInfo.clear(); return; }   // Esc: primero sale de la gestion
        if (screen == Screen::Create || screen == Screen::Join || screen == Screen::Ranking) Go(Screen::Multi);
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
        if (C::Tape("historia", "Historia", ImVec2(inner, 58.0f), true, true, "Enter", 26)) PickStory();
        y += 64.0f;
        C::Text(draw, false, 17, ImVec2(x + 6.0f, y), C::kMarcador,
                inGame ? "Siga con su partida donde la dejó." : "Otra noche en la calle. Sobreviva en el centro de Bogotá.", inner - 12.0f);
        y += 36.0f;

        ImGui::SetCursorScreenPos(ImVec2(x, y));
#ifdef BAZUKO_NET_ENABLED
        if (C::Tape("multijugador", "Multijugador", ImVec2(inner, 52.0f), false, true, nullptr, 24)) TryMulti();
#else
        C::Tape("multijugador", "Multijugador", ImVec2(inner, 52.0f), false, false, nullptr, 24);
#endif
        Scrawl(draw, ImVec2(x + inner - 140.0f, y - 14.0f), "en desarrollo", 16);
        y += 58.0f;
#ifdef BAZUKO_NET_ENABLED
        C::Text(draw, false, 17, ImVec2(x + 6.0f, y), C::kMarcador,
                AccountsOn() && !SignedIn() ? "Abra una sala o entre a la de alguien más. Se juega con cuenta." : "Abra una sala o entre a la de alguien más.", inner - 12.0f);
#else
        C::Text(draw, false, 17, ImVec2(x + 6.0f, y), C::kMarcador, "Esta copia del juego se compiló sin red.", inner - 12.0f);
#endif
        y += 40.0f;

        const float half = (inner - 14.0f) * 0.5f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("ajustes", "Ajustes", ImVec2(half, 46.0f), false, true, nullptr, 21)) Go(Screen::Settings);
        ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
        if (C::Tape("perfil", SignedIn() ? account->Name().c_str() : "Perfil", ImVec2(half, 46.0f), false, true, nullptr, 21)) Go(Screen::Profile);
        if (AccountsOn() && !SignedIn()) Scrawl(draw, ImVec2(x + half + 14.0f + half - 104.0f, y - 14.0f), "sin entrar", 15);
        y += 62.0f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("salir", "Salir del juego", ImVec2(190.0f, 40.0f), false, true, nullptr, 18)) RequestQuit();
        if (hosted.Active()) {   // recordatorio: la sala sigue abierta mientras se esta en el lobby
            const std::string open = "Su sala «" + hosted.name + "» sigue abierta.";
            C::Text(draw, false, 16, ImVec2(x + 210.0f, y + 10.0f), C::kRojo, open.c_str(), inner - 210.0f);
        }
    }

    // ---- la sala propia ----

    void PickStory() {
        hosted.Close();   // la historia es de un solo jugador: la sala abierta se cierra
        choice.mode = LobbyChoice::Mode::Story;
        done = true;
    }

    // Salir del juego: con una sala abierta se pregunta antes, porque se cierra y nadie mas podra entrar
    void RequestQuit() {
        if (hosted.Active()) { modal = Modal::ConfirmQuit; return; }
        choice.mode = LobbyChoice::Mode::Quit;
        done = true;
    }

    std::string PlayerName() const { return save.name.empty() ? std::string("Parcero") : save.name; }

#ifdef BAZUKO_NET_ENABLED
    // Abre la sala aqui mismo (en esta red o en el servidor de salas). Por internet se espera el codigo en la ventana «Abriendo sala».
    void OpenRoom(const std::string& name) {
        hosted.Close();   // una sala a la vez
        hosted.name = name;
        hosted.internet = settings.roomInternet;
        hosted.listed = !settings.roomInternet || settings.roomPublic;
        hosted.maxPlayers = std::clamp(settings.roomSize, 2, 16);
        hosted.wantedCode.clear();
        const size_t max = static_cast<size_t>(hosted.maxPlayers);
        if (hosted.internet) {
            const std::string typed = Trim(codeText);
            if (!typed.empty()) {
                hosted.wantedCode = Net::Relay::NormalizeRoomCode(typed);
                if (hosted.wantedCode.empty()) { createError = "El código lleva 6 letras o números (sin O, I, L, 0 ni 1)."; return; }
            }
            hosted.relay = RelayForRoom();
            if (hosted.relay.empty()) { createError = "No hay servidor de salas disponible: abra la sala en esta red."; return; }
            const size_t colon = hosted.relay.rfind(':');
            const std::string host = colon == std::string::npos ? hosted.relay : hosted.relay.substr(0, colon);
            const uint16_t port = colon == std::string::npos ? Net::Relay::kDefaultPort : static_cast<uint16_t>(std::atoi(hosted.relay.c_str() + colon + 1));
            hosted.session = Net::NetSession::StartHostViaRelay(host, port == 0 ? Net::Relay::kDefaultPort : port, PlayerName(), max, hosted.wantedCode);
            if (!hosted.session) { createError = "No se pudo conectar con el servidor de salas."; return; }
            hosted.session->SetRoomInfo(name, hosted.listed);
            modal = Modal::Opening;
            openingSince = glfwGetTime();
        } else {
            hosted.relay.clear();
            hosted.session = Net::NetSession::StartHost(7777, PlayerName(), max);
            if (!hosted.session) { createError = "No se pudo abrir la sala: el puerto 7777 está ocupado."; return; }
            hosted.session->SetRoomInfo(name, false);
            hosted.beacon = Net::LanBeacon::Create(hosted.session->Port(), name, static_cast<uint8_t>(max));
            modal = Modal::RoomReady;
        }
    }

    // Cada cuadro: la sala abierta atiende la red (quien entre mientras el anfitrion esta en el lobby lo espera en el cambuche)
    void TickRoom(float dt) {
        if (!hosted.session) return;
        Net::LocalState waiting;
        waiting.position = glm::vec3(112.98f, 0.0f, 97.84f);
        hosted.session->Update(dt, waiting);
        (void)hosted.session->ConsumeNotices();
        if (hosted.beacon) hosted.beacon->Update(hosted.session->PlayerCount());
        if (modal == Modal::Opening) {
            if (!hosted.session->RoomCode().empty()) modal = Modal::RoomReady;
            else if (hosted.session->RoomFailed() || glfwGetTime() - openingSince > 12.0) {
                createError = hosted.session->RoomError() == Net::Relay::kCodeTaken ? "Ese código ya lo usa otra sala: escoja otro."
                            : hosted.session->RoomError() == Net::Relay::kTooManyRooms ? "El servidor de salas está lleno; intente más tarde."
                            : "El servidor de salas no pudo abrir la sala.";
                hosted.Close();
                modal = Modal::None;
                screen = Screen::Create;
            }
        } else if (hosted.internet && hosted.session->RoomFailed()) {   // se cayo la conexion con el servidor de salas
            hosted.Close();
            if (modal == Modal::RoomReady) modal = Modal::None;
        }
    }
#endif

    void EnterOwnRoom() {
        choice.mode = LobbyChoice::Mode::EnterRoom;
        choice.roomName = hosted.name;
        choice.listed = hosted.listed;
        choice.maxPlayers = hosted.maxPlayers;
        choice.address = hosted.relay;
        choice.code = hosted.Code();
        done = true;
    }

    // Lo que se ve encima de la pantalla (la pieza de carton cambia de contenido); devuelve la altura que necesita
    static float ModalHeight(Modal m) { return m == Modal::RoomReady ? 470.0f : m == Modal::ConfirmQuit ? 330.0f : m == Modal::AskCode ? 360.0f : 260.0f; }

    void AskCodeFor(const std::string& name, const std::string& relay) {
        askName = name; askRelay = relay;
        CopyTo(askText, sizeof askText, "");
        askError.clear();
        askCheckSince = -1.0;
        askFocus = true;
        modal = Modal::AskCode;
    }

    void JoinWithCode(const std::string& code) {
        hosted.Close();   // entrar a la sala de otro cierra la propia
        choice.mode = LobbyChoice::Mode::JoinRoom; choice.roomName = askName; choice.code = code; choice.address = askRelay;
        modal = Modal::None;
        done = true;
    }

    void DrawAskCode(ImDrawList* draw, float x, float y, float inner) {
        C::Text(draw, true, 34, ImVec2(x, y), C::kMarcador, "SALA CON CÓDIGO");
        y += 52.0f;
        C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 4u, 2.5f);
        y += 18.0f;
        C::Text(draw, true, 24, ImVec2(x, y), C::kMarcador, askName.empty() ? "Sala sin nombre" : askName.c_str(), inner);
        y += 40.0f;
        C::Text(draw, false, 18, ImVec2(x, y), C::kMarcador, "Para entrar escriba el código que le dio quien abrió la sala.", inner);
        y += 40.0f;
        const bool checking = askCheckSince >= 0.0;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (askFocus) { ImGui::SetKeyboardFocusHere(); askFocus = false; }
        const bool entered = Field("##codigoPedido", askText, sizeof askText, 200.0f, ImGuiInputTextFlags_CharsUppercase | ImGuiInputTextFlags_CharsNoBlank | ImGuiInputTextFlags_EnterReturnsTrue);
        ImGui::SetCursorScreenPos(ImVec2(x + 220.0f, y - 4.0f));
        const bool pressed = C::Tape("entrarConCodigo", checking ? "Revisando..." : "Entrar", ImVec2(180.0f, 50.0f), true, !checking, "Enter", 20);
        ImGui::SetCursorScreenPos(ImVec2(x + 420.0f, y - 4.0f));
        if (C::Tape("cancelarCodigo", "Cancelar", ImVec2(150.0f, 50.0f), false, true, "Esc", 18)) { CancelModal(); return; }
        y += 64.0f;
        if (!askError.empty()) C::Text(draw, false, 17, ImVec2(x, y), C::kRojo, askError.c_str(), inner);
        if ((pressed || entered) && !checking) {
            const std::string code = Net::Relay::NormalizeRoomCode(askText);
            if (code.empty()) askError = "Escriba el código: 6 letras o números.";
            else if (code == hosted.Code()) { modal = Modal::None; EnterOwnRoom(); }
            else if (browser) { askError.clear(); browser->CheckCode(askRelay, code); askCheckSince = ImGui::GetTime(); }
            else JoinWithCode(code);
            return;
        }
        if (checking && browser) {   // la respuesta del servidor: existe, no existe o (relevo anterior) no contesta
            const std::string code = Net::Relay::NormalizeRoomCode(askText);
            const int found = browser->CodeCheck(askRelay, code);
            if (found == 1 || (found < 0 && ImGui::GetTime() - askCheckSince > 3.0)) JoinWithCode(code);
            else if (found == 0) { askCheckSince = -1.0; askError = "Ese código no es de ninguna sala abierta. Revíselo con quien abrió la sala."; }
        }
    }

    void DrawModal(ImDrawList* draw, ImVec2 min, float width) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        if (modal == Modal::Opening) {
            C::Text(draw, true, 34, ImVec2(x, y), C::kMarcador, "ABRIENDO SALA...");
            y += 52.0f;
            C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 4u, 2.5f);
            y += 22.0f;
            const std::string where = "Pidiendo la sala al servidor de salas " + hosted.relay + ".";
            C::Text(draw, false, 18, ImVec2(x, y), C::kMarcador, where.c_str(), inner);
            y += 70.0f;
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if (C::Tape("cancelarApertura", "Cancelar", ImVec2(160.0f, 44.0f), false, true, "Esc", 18)) CancelModal();
            return;
        }
#ifdef BAZUKO_NET_ENABLED
        if (modal == Modal::AskCode) { DrawAskCode(draw, x, y, inner); return; }
#endif
        if (modal == Modal::ConfirmQuit) {
            C::Text(draw, true, 34, ImVec2(x, y), C::kMarcador, "HAY UNA SALA ABIERTA");
            y += 52.0f;
            C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 4u, 2.5f);
            y += 22.0f;
            std::string body = "Su sala «" + hosted.name + "»";
            if (!hosted.Code().empty()) body += " (código " + hosted.Code() + ")";
            body += " se va a cerrar al salir del juego y nadie más podrá entrar.";
            C::Text(draw, false, 19, ImVec2(x, y), C::kMarcador, body.c_str(), inner);
            y += 96.0f;
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if (C::Tape("cerrarYSalir", "Cerrar sala y salir", ImVec2(260.0f, 50.0f), true, true, nullptr, 20)) {
                hosted.Close();
                choice.mode = LobbyChoice::Mode::Quit;
                done = true;
            }
            ImGui::SetCursorScreenPos(ImVec2(x + 280.0f, y));
            if (C::Tape("cancelarSalir", "Cancelar", ImVec2(160.0f, 50.0f), false, true, "Esc", 18)) CancelModal();
            return;
        }
        // la ficha de la sala recien abierta
        C::Text(draw, true, 34, ImVec2(x, y), C::kMarcador, "SALA ABIERTA");
        y += 52.0f;
        C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 4u, 2.5f);
        y += 18.0f;
        C::Text(draw, true, 26, ImVec2(x, y), C::kMarcador, hosted.name.c_str(), inner);
        y += 44.0f;
        if (hosted.internet) {
            C::Text(draw, true, 20, ImVec2(x, y + 12.0f), C::kMarcador, "Código");
            const std::string code = hosted.Code();
            C::Text(draw, true, 44, ImVec2(x + 110.0f, y - 4.0f), C::kRojo, code.c_str());
            C::HandRect(draw, ImVec2(x + 98.0f, y - 8.0f), ImVec2(x + 122.0f + C::TextWidth(true, 44, code.c_str()), y + 52.0f), 91u, C::kRojo, 2.5f);
            y += 66.0f;
            if (!hosted.wantedCode.empty() && hosted.wantedCode != code) {
                C::Text(draw, false, 16, ImVec2(x, y), C::kRojo, "Este servidor de salas todavía no acepta códigos propios: le dio este.", inner);
                y += 28.0f;
            }
        }
        const auto row = [&](const char* label, const std::string& value) {
            C::Text(draw, true, 19, ImVec2(x, y), C::kMarcador, label);
            C::Text(draw, false, 19, ImVec2(x + 150.0f, y), C::kMarcador, value.c_str(), inner - 150.0f);
            y += 32.0f;
        };
#ifdef BAZUKO_NET_ENABLED
        const uint16_t lanPort = hosted.session ? hosted.session->Port() : 0;
#else
        const uint16_t lanPort = 0;
#endif
        row("Dónde", hosted.internet ? "Por internet (" + hosted.relay + ")" : "En esta red, puerto " + std::to_string(lanPort));
        if (hosted.internet) row("Quién entra", hosted.listed ? "Todos: sale en la lista y entra cualquiera" : "Sale en la lista; para entrar piden el código");
        row("Cupo", std::to_string(hosted.maxPlayers) + " jugadores");
        y += 18.0f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("entrarSala", "Entrar a la sala", ImVec2(250.0f, 54.0f), true, true, "Enter", 22)) EnterOwnRoom();
        ImGui::SetCursorScreenPos(ImVec2(x + 270.0f, y));
        if (C::Tape("volverSala", "Volver", ImVec2(150.0f, 54.0f), false, true, "Esc", 20)) CancelModal();
        C::Text(draw, false, 16, ImVec2(x, y + 66.0f), C::kMarcador, "Con «Volver» la sala sigue abierta: está en la lista de salas, donde puede entrar o cerrarla.", inner);
        if (ImGui::IsKeyPressed(ImGuiKey_Enter, false) && !ImGui::IsAnyItemFocused()) EnterOwnRoom();
    }

    void CancelModal() {
        if (modal == Modal::Opening) { hosted.Close(); screen = Screen::Create; }
        else if (modal == Modal::RoomReady) Go(Screen::Multi);
        else if (modal == Modal::AskCode) askCheckSince = -1.0;
        modal = Modal::None;
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

    // ---- clasificacion (GET /clasificacion/{tabla}): una tabla por estadistica, top 10, top 100 y global por paginas ----
    static constexpr const char* kRankTables[] = {"dias", "plata", "peleas", "partidas", "tiempo"};
    static constexpr const char* kRankLabels[] = {"Días", "Plata", "Peleas", "Partidas", "Tiempo"};
    static constexpr int kRankPage = 50;

    void RankFetch() {
        rankBoard.reset();
        rankFailed = false;
        if (!SignedIn() || !account->ProfileOnline()) { rankCall.reset(); return; }
        const int count = rankScope == 0 ? 10 : rankScope == 1 ? 100 : kRankPage;
        rankCall = Online::ApiLeaderboard(account->Config(), account->AccessToken(), kRankTables[rankTable], rankScope == 2 ? rankFrom : 0, count);
    }

    void RankTick() {
        if (!rankCall || !rankCall->Done()) return;
        const Online::HttpResponse response = rankCall->Result();
        rankCall.reset();
        if (auto board = Online::ParseLeaderboard(response)) rankBoard = std::move(*board);
        else rankFailed = true;
    }

    std::string RankValue(long long value) const {
        switch (rankTable) {
            case 0: return std::to_string(value) + (value == 1 ? " día" : " días");
            case 1: return "$ " + Thousands(static_cast<int>(std::min<long long>(value, 2000000000LL)));
            case 2: return std::to_string(value) + (value == 1 ? " pelea" : " peleas");
            case 3: return std::to_string(value) + (value == 1 ? " partida" : " partidas");
            default: return HoursText(value);
        }
    }

    void Ranking(ImDrawList* draw, ImVec2 min, float width, float height) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        Header(draw, x, y, inner, "CLASIFICACIÓN", false);
        if (!AccountsOn() || !account->ProfileOnline()) {
            C::Text(draw, false, 18, ImVec2(x, y), C::kMarcador, "La clasificación no está disponible en esta copia del juego.", inner);
            return;
        }
        if (!SignedIn()) {
            C::Text(draw, false, 18, ImVec2(x, y), C::kMarcador, "Entre a su cuenta para ver la clasificación.", inner);
            return;
        }
        RankTick();
        if (!rankCall && !rankBoard && !rankFailed) RankFetch();

        // una pestana por estadistica
        const float tab = (inner - 4.0f * 10.0f) / 5.0f;
        for (int i = 0; i < 5; ++i) {
            ImGui::SetCursorScreenPos(ImVec2(x + i * (tab + 10.0f), y));
            if (C::Tape(kRankTables[i], kRankLabels[i], ImVec2(tab, 42.0f), rankTable == i, true, nullptr, 18) && rankTable != i) { rankTable = i; rankFrom = 0; RankFetch(); }
        }
        y += 54.0f;
        static constexpr const char* scopes[] = {"Top 10", "Top 100", "Global"};
        for (int i = 0; i < 3; ++i) {
            ImGui::SetCursorScreenPos(ImVec2(x + i * 136.0f, y));
            if (C::Tape(scopes[i], scopes[i], ImVec2(126.0f, 38.0f), rankScope == i, true, nullptr, 17) && rankScope != i) { rankScope = i; rankFrom = 0; RankFetch(); }
        }
        ImGui::SetCursorScreenPos(ImVec2(x + inner - 150.0f, y));
        if (C::Tape("rank-actualizar", "Actualizar", ImVec2(150.0f, 38.0f), false, !rankCall, "R", 16) || (ImGui::IsKeyPressed(ImGuiKey_R) && !ImGui::GetIO().WantTextInput && !rankCall)) RankFetch();
        y += 52.0f;

        // la fila propia, siempre a la vista aunque no este en la pagina
        std::string own;
        if (rankBoard && rankBoard->ownPlace > 0) own = "Su puesto: " + std::to_string(rankBoard->ownPlace) + " · " + RankValue(rankBoard->ownValue);
        else if (rankBoard) own = "Usted todavía no sale: las estadísticas se suman al jugar por internet.";
        if (!own.empty()) C::Text(draw, true, 19, ImVec2(x, y), C::kRojo, own.c_str(), inner);
        y += 32.0f;

        const float footer = rankScope == 2 ? 70.0f : 24.0f;
        const float listHeight = std::max(80.0f, min.y + height - footer - y);
        C::HandRect(draw, ImVec2(x - 6.0f, y - 4.0f), ImVec2(x + inner + 6.0f, y + listHeight), 13u, C::kMarcador, 2.0f);
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ScrollbarBg, ImVec4(0, 0, 0, 0));
        ImGui::PushStyleColor(ImGuiCol_ScrollbarGrab, ImGui::ColorConvertU32ToFloat4(C::kCanto));
        ImGui::BeginChild("##clasificacion", ImVec2(inner, listHeight - 6.0f), false, ImGuiWindowFlags_NoBackground);
        ImDrawList* list = ImGui::GetWindowDrawList();
        const float rowWidth = inner - 20.0f;
        if (rankCall) {
            C::Text(list, false, 18, ImGui::GetCursorScreenPos() + ImVec2(8.0f, 12.0f), C::kMarcador, "Buscando la clasificación...");
            ImGui::Dummy(ImVec2(rowWidth, 40.0f));
        } else if (rankFailed) {
            C::Text(list, false, 18, ImGui::GetCursorScreenPos() + ImVec2(8.0f, 12.0f), C::kMarcador, "No se pudo traer la clasificación. Revise el internet y actualice.", rowWidth);
            ImGui::Dummy(ImVec2(rowWidth, 40.0f));
        } else if (rankBoard && rankBoard->rows.empty()) {
            C::Text(list, false, 18, ImGui::GetCursorScreenPos() + ImVec2(8.0f, 12.0f), C::kMarcador,
                    rankFrom > 0 ? "No hay más jugadores." : "Todavía nadie tiene partidas por internet. Juegue una y aparecerá aquí.", rowWidth);
            ImGui::Dummy(ImVec2(rowWidth, 40.0f));
        } else if (rankBoard) {
            std::string me = account->Name();
            for (char& c : me) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            for (const Online::LeaderRow& row : rankBoard->rows) {
                std::string name = row.name;
                for (char& c : name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
                const ImU32 ink = name == me ? C::kRojo : C::kMarcador;
                const ImVec2 at = ImGui::GetCursorScreenPos();
                const std::string place = std::to_string(row.place) + ".";
                C::Text(list, true, 20, at + ImVec2(8.0f, 4.0f), ink, place.c_str());
                C::Text(list, row.place <= 3, 20, at + ImVec2(78.0f, 4.0f), ink, row.name.c_str(), rowWidth - 330.0f);
                const std::string value = RankValue(row.value);
                C::Text(list, false, 19, at + ImVec2(rowWidth - 8.0f - C::TextWidth(false, 19, value.c_str()), 5.0f), ink, value.c_str());
                ImGui::Dummy(ImVec2(rowWidth, 34.0f));
            }
        }
        ImGui::EndChild();
        ImGui::PopStyleColor(3);

        if (rankScope == 2) {   // global: paginas de 50
            const float by = min.y + height - footer + 12.0f;
            ImGui::SetCursorScreenPos(ImVec2(x, by));
            if (C::Tape("rank-anterior", "Anterior", ImVec2(150.0f, 40.0f), false, rankFrom > 0 && !rankCall, nullptr, 17)) { rankFrom = std::max(0, rankFrom - kRankPage); RankFetch(); }
            const std::string pageText = "Página " + std::to_string(rankFrom / kRankPage + 1);
            C::Text(draw, false, 18, ImVec2(x + inner * 0.5f - C::TextWidth(false, 18, pageText.c_str()) * 0.5f, by + 10.0f), C::kMarcador, pageText.c_str());
            ImGui::SetCursorScreenPos(ImVec2(x + inner - 150.0f, by));
            const bool more = rankBoard && rankBoard->next >= 0;
            if (C::Tape("rank-siguiente", "Siguiente", ImVec2(150.0f, 40.0f), false, more && !rankCall, nullptr, 17) && more) { rankFrom = rankBoard->next; RankFetch(); }
        }
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
        if (C::Tape("crear", "Crear sala", ImVec2(180.0f, 46.0f), true, true, nullptr, 21)) Go(Screen::Create);
        ImGui::SetCursorScreenPos(ImVec2(x + 192.0f, y));
        if (C::Tape("codigo", "Unirse con código o IP", ImVec2(244.0f, 46.0f), false, true, nullptr, 17)) { CopyTo(joinText, sizeof joinText, ""); Go(Screen::Join); }
        ImGui::SetCursorScreenPos(ImVec2(x + 448.0f, y));
        if (C::Tape("clasificacion", "Clasificación", ImVec2(170.0f, 46.0f), false, true, nullptr, 17)) { rankBoard.reset(); rankFailed = false; Go(Screen::Ranking); }
        ImGui::SetCursorScreenPos(ImVec2(x + inner - 130.0f, y));
        if (C::Tape("actualizar", "Actualizar", ImVec2(130.0f, 46.0f), false, true, "R", 17)) browser->Refresh();
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
        std::vector<Net::RoomListing> rooms = browser->Rooms();
        if (hosted.Active()) {   // la sala propia va arriba, con sus botones; no se repite si tambien sale en la lista
            const std::string ownCode = hosted.Code();
            const uint16_t ownPort = hosted.session->Port();
            std::erase_if(rooms, [&](const Net::RoomListing& r) { return r.lan ? (!hosted.internet && r.port == ownPort && r.name == hosted.name) : (!ownCode.empty() && r.code == ownCode); });
            if (hosted.internet && !hosted.listed) {   // la propia con codigo llega tapada: se quita la primera de ese servidor con su nombre
                const auto own = std::find_if(rooms.begin(), rooms.end(), [&](const Net::RoomListing& r) {
                    return r.locked && r.name == Net::CleanRoomName(hosted.name, Net::Relay::kMaxRoomName) && r.address + ":" + std::to_string(r.port) == hosted.relay; });
                if (own != rooms.end()) rooms.erase(own);
            }
            const ImVec2 rowMin = ImGui::GetCursorScreenPos();
            const float rowWidth = inner - 20.0f;
            C::Text(list, true, 21, rowMin + ImVec2(8.0f, 6.0f), C::kRojo, ("Su sala: " + hosted.name).c_str(), rowWidth - 330.0f);
            std::string where = hosted.internet ? "Por internet · código " + (ownCode.empty() ? std::string("...") : ownCode) + (hosted.listed ? " · entra cualquiera" : " · piden el código")
                                                : "En esta red · puerto " + std::to_string(ownPort);
            C::Text(list, false, 16, rowMin + ImVec2(8.0f, 34.0f), C::kMarcador, where.c_str(), rowWidth - 330.0f);
            char count[32];
            std::snprintf(count, sizeof count, "%d de %d", static_cast<int>(hosted.session->PlayerCount()), hosted.maxPlayers);
            C::Text(list, true, 19, rowMin + ImVec2(rowWidth - 310.0f, 18.0f), C::kMarcador, count);
            ImGui::SetCursorScreenPos(rowMin + ImVec2(rowWidth - 230.0f, 10.0f));
            if (C::Tape("entrarPropia", "Entrar", ImVec2(110.0f, 42.0f), true, true, nullptr, 18)) EnterOwnRoom();
            ImGui::SetCursorScreenPos(rowMin + ImVec2(rowWidth - 110.0f, 10.0f));
            if (C::Tape("cerrarPropia", "Cerrar", ImVec2(110.0f, 42.0f), false, true, nullptr, 18)) { hosted.Close(); browser->Refresh(); }
            ImGui::SetCursorScreenPos(rowMin + ImVec2(0.0f, 62.0f));
            C::HandLine(list, rowMin + ImVec2(6.0f, 60.0f), rowMin + ImVec2(rowWidth - 6.0f, 60.0f), 29u, 2.0f, C::kRojo);
            ImGui::Dummy(ImVec2(rowWidth, 6.0f));
        }
        if (rooms.empty()) {
            const ImVec2 at = ImGui::GetCursorScreenPos() + ImVec2(8.0f, 14.0f);
            C::Text(list, false, 18, at, C::kMarcador, hosted.Active() ? "No hay salas de otros jugadores por ahora. Actualice la lista en un rato."
                                                                        : "No hay salas abiertas por ahora. Cree una o actualice la lista.", inner - 30.0f);
            ImGui::Dummy(ImVec2(inner - 20.0f, 60.0f));
        }
        for (size_t i = 0; i < rooms.size(); ++i) {
            const Net::RoomListing& room = rooms[i];
            ImGui::PushID(static_cast<int>(i));
            const ImVec2 rowMin = ImGui::GetCursorScreenPos();
            const float rowWidth = inner - 20.0f;
            C::Text(list, true, 21, rowMin + ImVec2(8.0f, 6.0f), C::kMarcador, room.name.empty() ? "Sala sin nombre" : room.name.c_str(), rowWidth - 300.0f);
            const std::string where = room.lan ? "En esta red · " + room.address : room.locked ? "Por internet · piden el código para entrar" : "Por internet · código " + room.code;
            C::Text(list, false, 16, rowMin + ImVec2(8.0f, 34.0f), C::kMarcador, where.c_str());
            char count[32];
            std::snprintf(count, sizeof count, "%d de %d", room.players, room.maxPlayers);
            C::Text(list, true, 19, rowMin + ImVec2(rowWidth - 270.0f, 18.0f), C::kMarcador, count);
            C::Hatch(list, rowMin + ImVec2(rowWidth - 190.0f, 20.0f), rowMin + ImVec2(rowWidth - 140.0f, 40.0f),
                     room.maxPlayers > 0 ? static_cast<float>(room.players) / static_cast<float>(room.maxPlayers) : 0.0f);
            const bool full = room.maxPlayers > 0 && room.players >= room.maxPlayers;
            ImGui::SetCursorScreenPos(rowMin + ImVec2(rowWidth - 124.0f, 10.0f));
            if (C::Tape("entrar", full ? "Llena" : "Unirse", ImVec2(124.0f, 42.0f), !full, !full, nullptr, 18)) {
              if (room.locked) AskCodeFor(room.name, room.address + ":" + std::to_string(room.port));   // pide el codigo antes de entrar
              else {
                hosted.Close();   // entrar a la sala de otro cierra la propia
                choice.roomName = room.name;
                if (room.lan) { choice.mode = LobbyChoice::Mode::JoinAddress; choice.address = room.address + ":" + std::to_string(room.port); }
                else { choice.mode = LobbyChoice::Mode::JoinRoom; choice.code = room.code; choice.address = room.address + ":" + std::to_string(room.port); }
                done = true;
              }
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
            C::Text(draw, true, 20, ImVec2(x, y + 10.0f), C::kMarcador, "Código");
            ImGui::SetCursorScreenPos(ImVec2(x + 120.0f, y));
            Field("##codigoSala", codeText, sizeof codeText, 170.0f, ImGuiInputTextFlags_CharsUppercase | ImGuiInputTextFlags_CharsNoBlank);
            C::Text(draw, false, 16, ImVec2(x + 310.0f, y + 2.0f), C::kMarcador, "Opcional: 6 letras o números. Vacío, el servidor pone uno.", inner - 310.0f);
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
                                  : "Sale en la lista de todos, pero para entrar hay que escribir el código.";
        C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador, hint, inner);
        y += 44.0f;
        const std::string name = Trim(roomName);
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("abrir", "Abrir sala", ImVec2(240.0f, 54.0f), true, !name.empty(), nullptr, 24)) {
            settings.roomName = name;
            createError.clear();
#ifdef BAZUKO_NET_ENABLED
            OpenRoom(name);
#endif
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
                else if (text == hosted.Code()) EnterOwnRoom();   // su propio codigo: entra a su sala
                else { hosted.Close(); choice.mode = LobbyChoice::Mode::JoinRoom; choice.code = text; choice.address = server; done = true; }
            } else if (!text.empty() && text.find(' ') == std::string::npos) {
                hosted.Close(); choice.mode = LobbyChoice::Mode::JoinAddress; choice.address = text; done = true;
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

    // Lo de la Historia guardada en este equipo (no necesita cuenta)
    void StorySummary(ImDrawList* draw, float x, float& y, float inner) {
        if (save.exists) {
            const std::string line = "Historia: " + (save.name.empty() ? std::string("sin nombre") : save.name) + " · $ " + Thousands(static_cast<int>(save.money)) +
                                     " · " + std::to_string(std::max(1, save.day)) + (save.day == 1 ? " día en la calle" : " días en la calle");
            C::Text(draw, false, 18, ImVec2(x, y), C::kMarcador, line.c_str(), inner);
            y += C::TextHeight(false, 18, line.c_str(), inner) + 10.0f;
        } else {
            C::Text(draw, false, 18, ImVec2(x, y), C::kMarcador, "Todavía no tiene una Historia guardada en este equipo.", inner);
            y += 32.0f;
        }
    }

    void Label(ImDrawList* draw, float x, float& y, const char* text) {
        C::Text(draw, true, 19, ImVec2(x, y), C::kMarcador, text);
        y += 28.0f;
    }

    // Aviso bajo los campos: lo que salio mal en rojo, lo que salio bien con marcador
    void Notes(ImDrawList* draw, float x, float& y, float inner) {
        const std::string& text = !accError.empty() ? accError : accInfo;
        if (text.empty()) return;
        C::Text(draw, false, 17, ImVec2(x, y), accError.empty() ? C::kMarcador : C::kRojo, text.c_str(), inner);
        y += C::TextHeight(false, 17, text.c_str(), inner) + 10.0f;
    }

    bool TaskBusy() const { return account && account->GetTaskState() == Online::Session::TaskState::Working; }

    void SetPanel(AccPanel next) {
        accPanel = next;
        accError.clear();
        ForgetPasswords();
        WipeBuffer(accCode, sizeof accCode);
        WipeBuffer(accCode2, sizeof accCode2);
    }

    bool LooksLikeEmail(const std::string& email) const {
        const size_t at = email.find('@');
        return at != std::string::npos && at > 0 && email.find('.', at) != std::string::npos && email.find(' ') == std::string::npos && email.size() <= 90;
    }

    // Con sesion: el correo (agregar, cambiar, verificar), cambiar la contrasena y cerrar sesion
    void SignedInPanel(ImDrawList* draw, float x, float& y, float inner) {
        const bool busy = TaskBusy();
        const float half = (inner - 14.0f) * 0.5f;
        if (accPanel == AccPanel::Email) {
            C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador,
                    "Con un correo verificado puede recuperar la contraseña si la olvida. Nadie más lo ve. Si lo deja vacío, se quita.", inner);
            y += 54.0f;
            Label(draw, x, y, "Correo");
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            const bool enter = Field("##correo-nuevo", accEmail, sizeof accEmail, inner, ImGuiInputTextFlags_CharsNoBlank | ImGuiInputTextFlags_EnterReturnsTrue);
            y += 52.0f;
            Notes(draw, x, y, inner);
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if ((C::Tape("guardar-correo", busy ? "Guardando..." : "Guardar", ImVec2(half, 46.0f), true, !busy, nullptr, 20) || enter) && !busy) {
                const std::string email = Trim(accEmail);
                if (!email.empty() && !LooksLikeEmail(email)) accError = "Ese correo no parece bien escrito. Revíselo.";
                else { accError.clear(); accInfo.clear(); account->SetEmail(email); }
            }
            ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
            if (C::Tape("cancelar-correo", "Cancelar", ImVec2(half, 46.0f), false, !busy, nullptr, 20)) SetPanel(AccPanel::Main);
            return;
        }
        if (accPanel == AccPanel::Verify) {
            const std::string text = "Le mandamos un código a " + account->Email() + ". Escríbalo aquí; si no llega en unos minutos, revise el correo no deseado.";
            C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador, text.c_str(), inner);
            y += C::TextHeight(false, 17, text.c_str(), inner) + 14.0f;
            Label(draw, x, y, "Código");
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            const bool enter = Field("##codigo-correo", accCode, sizeof accCode, 200.0f, ImGuiInputTextFlags_EnterReturnsTrue, OnlyDigits);
            y += 52.0f;
            Notes(draw, x, y, inner);
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if ((C::Tape("verificar", busy ? "Revisando..." : "Verificar", ImVec2(half, 46.0f), true, !busy, nullptr, 20) || enter) && !busy) {
                if (std::strlen(accCode) < 6) accError = "El código tiene 6 números.";
                else { accError.clear(); accInfo.clear(); account->VerifyEmail(accCode); }
            }
            ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
            if (C::Tape("otro-codigo", "Mandar otro código", ImVec2(half, 46.0f), false, !busy, nullptr, 18)) { accError.clear(); accInfo.clear(); account->SendEmailCode(); }
            y += 58.0f;
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if (C::Tape("cancelar-codigo", "Después", ImVec2(half, 40.0f), false, !busy, nullptr, 18)) SetPanel(AccPanel::Main);
            return;
        }
        if (accPanel == AccPanel::Delete) { DeletePanel(draw, x, y, inner); return; }
        if (accPanel == AccPanel::Password) {
            C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador, "Al cambiarla, su cuenta se cierra en los demás equipos y sigue abierta en este.", inner);
            y += 50.0f;
            Label(draw, x, y, "Contraseña actual");
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            Field("##clave-actual", accOld, sizeof accOld, inner, ImGuiInputTextFlags_Password);
            y += 52.0f;
            Label(draw, x, y, "Contraseña nueva");
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            Field("##clave-nueva", accPass, sizeof accPass, inner, ImGuiInputTextFlags_Password);
            y += 52.0f;
            Label(draw, x, y, "Repita la nueva");
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            Field("##clave-nueva2", accPass2, sizeof accPass2, inner, ImGuiInputTextFlags_Password);
            y += 52.0f;
            Notes(draw, x, y, inner);
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if (C::Tape("cambiar-clave", busy ? "Cambiando..." : "Cambiar", ImVec2(half, 46.0f), true, !busy, nullptr, 20) && !busy) {
                if (accOld[0] == '\0') accError = "Escriba su contraseña actual.";
                else if (const auto problem = Online::CheckPassword(accPass, accPass2, account->Name()); problem != Online::PasswordProblem::None) accError = Online::PasswordProblemText(problem);
                else if (std::strcmp(accOld, accPass) == 0) accError = "La nueva tiene que ser distinta de la actual.";
                else {
                    accError.clear(); accInfo.clear();
                    account->ChangePassword(std::string(accOld), std::string(accPass));
                    ForgetPasswords();
                }
            }
            ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
            if (C::Tape("cancelar-clave", "Cancelar", ImVec2(half, 46.0f), false, !busy, nullptr, 20)) SetPanel(AccPanel::Main);
            return;
        }

        // la ficha de la cuenta
        C::Text(draw, true, 34, ImVec2(x, y), C::kMarcador, account->Name().c_str());
        const Online::OwnProfile& profile = account->Profile();
        if (account->ProfileLoaded() && profile.created > 0) {
            const std::string since = "cuenta desde " + DateText(profile.created);
            C::Text(draw, false, 15, ImVec2(x + inner - C::TextWidth(false, 15, since.c_str()), y + 14.0f), C::kMarcador, since.c_str());
        }
        y += 48.0f;
        std::string mail;
        if (!account->UserLoaded()) mail = busy ? "Correo: buscando..." : "Correo: no se pudo consultar ahora.";
        else if (account->Email().empty()) mail = "Sin correo: si olvida la contraseña, no hay cómo recuperarla.";
        else mail = "Correo: " + account->Email() + (account->EmailVerified() ? " · verificado" : " · sin verificar");
        C::Text(draw, false, 18, ImVec2(x, y), account->UserLoaded() && !account->EmailVerified() ? C::kRojo : C::kMarcador, mail.c_str(), inner);
        y += C::TextHeight(false, 18, mail.c_str(), inner) + 12.0f;
        const bool loaded = account->UserLoaded();
        const bool canVerify = loaded && !account->Email().empty() && !account->EmailVerified();
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("correo", loaded && account->Email().empty() ? "Agregar correo" : "Cambiar correo", ImVec2(half, 42.0f), false, loaded && !busy, nullptr, 18)) {
            SetPanel(AccPanel::Email);
            CopyTo(accEmail, sizeof accEmail, account->Email());
            accInfo.clear();
        }
        ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
        if (C::Tape("verificar-correo", "Verificar correo", ImVec2(half, 42.0f), canVerify, canVerify && !busy, nullptr, 18)) {
            accInfo.clear();
            account->SendEmailCode();
            SetPanel(AccPanel::Verify);
        }
        y += 52.0f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("clave", "Cambiar contraseña", ImVec2(half, 42.0f), false, !busy, nullptr, 18)) { SetPanel(AccPanel::Password); accInfo.clear(); }
        ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
        if (C::Tape("cerrar-sesion", "Cerrar sesión", ImVec2(half, 42.0f), false, !busy, nullptr, 18)) {
            account->SignOut();
            accError.clear();
            accInfo.clear();
            signUpTab = false;
            SetPanel(AccPanel::Main);
        }
        y += 56.0f;

        // multijugador: estadisticas y lo que ven los demas
        C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 9u, 2.0f);
        y += 12.0f;
        C::Text(draw, true, 20, ImVec2(x, y), C::kMarcador, "En multijugador");
        y += 30.0f;
        if (!account->ProfileOnline()) {
            C::Text(draw, false, 16, ImVec2(x, y), C::kMarcador, "El perfil en línea no está disponible en esta copia del juego.", inner);
            y += 30.0f;
        } else if (!account->ProfileLoaded()) {
            C::Text(draw, false, 16, ImVec2(x, y), C::kMarcador, busy ? "Buscando su perfil..." : "No se pudo traer su perfil ahora. Revise el internet.", inner);
            y += 30.0f;
        } else {
            const std::string stats = std::to_string(profile.games) + (profile.games == 1 ? " partida · " : " partidas · ") + std::to_string(profile.days) +
                                      (profile.days == 1 ? " día · $ " : " días · $ ") + Thousands(static_cast<int>(std::min<long long>(profile.money, 2000000000LL))) + " · " +
                                      std::to_string(profile.fights) + (profile.fights == 1 ? " pelea · " : " peleas · ") + HoursText(profile.seconds);
            C::Text(draw, false, 18, ImVec2(x, y), C::kMarcador, stats.c_str(), inner);
            y += C::TextHeight(false, 18, stats.c_str(), inner) + 4.0f;
            if (profile.games == 0) {
                C::Text(draw, false, 15, ImVec2(x, y), C::kMarcador, "Se suman al terminar partidas por internet y salen en la tabla de clasificación.", inner);
                y += C::TextHeight(false, 15, "Se suman al terminar partidas por internet y salen en la tabla de clasificación.", inner) + 4.0f;
            }
            y += 8.0f;
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if (C::Tape("visibilidad", profile.friendsOnly ? "Mi perfil: solo amigos" : "Mi perfil: lo ven todos", ImVec2(half, 42.0f), false, !busy, nullptr, 17)) {
                accInfo.clear(); accError.clear();
                account->SetFriendsOnly(!profile.friendsOnly);
            }
            ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
            const bool hasLook = !save.look.empty();
            if (C::Tape("apariencia", profile.appearance.empty() ? "Llevar mi personaje" : "Actualizar mi personaje", ImVec2(half, 42.0f), false, hasLook && !busy, nullptr, 17)) {
                accInfo.clear(); accError.clear();
                account->SetAppearance(save.look);
            }
            y += 50.0f;
            const char* lookNote = !hasLook ? "Para llevar su personaje a la cuenta, créelo primero en la Historia (tecla P)."
                                 : profile.appearance.empty() ? "Así lo verán en las salas: el aspecto de su personaje de la Historia, sin su nombre."
                                 : "Su cuenta lleva el aspecto de su personaje. Si lo cambia en la Historia, actualícelo aquí.";
            C::Text(draw, false, 15, ImVec2(x, y), C::kMarcador, lookNote, inner);
            y += C::TextHeight(false, 15, lookNote, inner) + 8.0f;
        }
        Notes(draw, x, y, inner);
        C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 7u, 2.0f);
        y += 12.0f;
        StorySummary(draw, x, y, inner);
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("borrar-cuenta", "Borrar cuenta", ImVec2(180.0f, 36.0f), false, !busy, nullptr, 16)) { SetPanel(AccPanel::Delete); accInfo.clear(); }
    }

    // Borrar la cuenta: se escribe el nombre para confirmar. No tiene vuelta atras.
    void DeletePanel(ImDrawList* draw, float x, float& y, float inner) {
        const bool busy = TaskBusy();
        const float half = (inner - 14.0f) * 0.5f;
        C::Text(draw, true, 24, ImVec2(x, y), C::kRojo, "Esto no tiene vuelta atrás.");
        y += 36.0f;
        const char* text = "Se borran su cuenta, su perfil, sus estadísticas y sus amigos, y el nombre queda libre para otro. La Historia guardada en este equipo no se toca.";
        C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador, text, inner);
        y += C::TextHeight(false, 17, text, inner) + 14.0f;
        const std::string label = "Escriba " + account->Name() + " para confirmar";
        Label(draw, x, y, label.c_str());
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        Field("##borrar-nombre", accCode2, sizeof accCode2, inner, 0, OnlyLettersAndDigits);
        y += 52.0f;
        Notes(draw, x, y, inner);
        std::string typed = accCode2, name = account->Name();
        for (char& c : typed) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (char& c : name) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        const bool matches = !typed.empty() && typed == name;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("borrar-ya", busy ? "Borrando..." : "Borrar mi cuenta", ImVec2(half, 46.0f), true, matches && !busy, nullptr, 19) && matches && !busy) {
            accError.clear(); accInfo.clear();
            account->DeleteAccount();
        }
        ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
        if (C::Tape("no-borrar", "No, volver", ImVec2(half, 46.0f), false, !busy, nullptr, 19)) SetPanel(AccPanel::Main);
    }

    // Sin sesion: contrasena olvidada (nombre, luego codigo y contrasena nueva)
    void ForgotPanel(ImDrawList* draw, float x, float& y, float inner) {
        const bool busy = TaskBusy() || account->GetState() == Online::Session::State::Working;
        const float half = (inner - 14.0f) * 0.5f;
        if (accPanel == AccPanel::ForgotName) {
            C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador,
                    "Escriba su usuario. Si la cuenta tiene un correo verificado, le llega un código para poner una contraseña nueva.", inner);
            y += 54.0f;
            Label(draw, x, y, "Usuario");
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            const bool enter = Field("##usuario-olvido", accName, sizeof accName, inner, ImGuiInputTextFlags_EnterReturnsTrue, OnlyLettersAndDigits);
            y += 52.0f;
            Notes(draw, x, y, inner);
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if ((C::Tape("mandar-codigo", busy ? "Mandando..." : "Mandar código", ImVec2(half, 46.0f), true, !busy, nullptr, 20) || enter) && !busy) {
                if (accName[0] == '\0') accError = "Escriba su usuario.";
                else { accError.clear(); accInfo.clear(); account->ForgotPassword(accName); }
            }
            ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
            if (C::Tape("volver-entrar", "Volver a Entrar", ImVec2(half, 46.0f), false, !busy, nullptr, 18)) { SetPanel(AccPanel::Main); accInfo.clear(); }
            return;
        }
        const std::string text = "Si la cuenta " + std::string(accName) + " tiene un correo verificado, le llegó un código. Escríbalo con su contraseña nueva.";
        C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador, text.c_str(), inner);
        y += C::TextHeight(false, 17, text.c_str(), inner) + 14.0f;
        Label(draw, x, y, "Código");
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        Field("##codigo-olvido", accCode, sizeof accCode, 200.0f, 0, OnlyDigits);
        y += 52.0f;
        Label(draw, x, y, "Contraseña nueva");
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        Field("##olvido-clave", accPass, sizeof accPass, inner, ImGuiInputTextFlags_Password);
        y += 52.0f;
        Label(draw, x, y, "Repita la nueva");
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        Field("##olvido-clave2", accPass2, sizeof accPass2, inner, ImGuiInputTextFlags_Password);
        y += 52.0f;
        Notes(draw, x, y, inner);
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("cambiar-entrar", busy ? "Cambiando..." : "Cambiar y entrar", ImVec2(half, 46.0f), true, !busy, nullptr, 19) && !busy) {
            if (std::strlen(accCode) < 6) accError = "El código tiene 6 números.";
            else if (const auto problem = Online::CheckPassword(accPass, accPass2, accName); problem != Online::PasswordProblem::None) accError = Online::PasswordProblemText(problem);
            else {
                accError.clear(); accInfo.clear();
                account->ConfirmForgotPassword(accName, accCode, std::string(accPass));
                ForgetPasswords();
            }
        }
        ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
        if (C::Tape("otro-codigo-olvido", "Mandar otro código", ImVec2(half, 46.0f), false, !busy, nullptr, 18)) { accError.clear(); accInfo.clear(); account->ForgotPassword(accName); }
    }

    void Profile(ImDrawList* draw, ImVec2 min, float width) {
        float y = min.y + 22.0f;
        const float x = min.x + 30.0f, inner = width - 60.0f;
        using State = Online::Session::State;
        Header(draw, x, y, inner, SignedIn() ? "SU CUENTA" : "PERFIL", false);

        if (!AccountsOn()) {   // este juego no tiene servidor de cuentas: solo lo de la Historia
            StorySummary(draw, x, y, inner);
            C::HandLine(draw, ImVec2(x, y), ImVec2(x + inner, y), 7u, 2.0f);
            y += 18.0f;
            C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador,
                    "Las cuentas de jugador todavía no están abiertas en esta copia del juego. La Historia se juega sin cuenta y sin internet; su aspecto se cambia en el juego con la tecla P.", inner);
            return;
        }

        if (SignedIn()) {
            SignedInPanel(draw, x, y, inner);
            return;
        }

        if (account->GetState() == State::Working) {
            C::Text(draw, true, 26, ImVec2(x, y + 10.0f), C::kMarcador, "Conectando con el servidor de cuentas...");
            y += 60.0f;
            C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador, "Un momento. Si no hay internet, se puede jugar la Historia sin cuenta.", inner);
            return;
        }

        if (accPanel == AccPanel::ForgotName || accPanel == AccPanel::ForgotCode) {
            ForgotPanel(draw, x, y, inner);
            return;
        }
        if (wantMulti) {
            C::Text(draw, false, 18, ImVec2(x, y), C::kRojo, "Para el Multijugador necesita una cuenta. Entre o cree una; la Historia no la pide.", inner);
            y += 54.0f;
        }
        const float half = (inner - 14.0f) * 0.5f;
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("tab-entrar", "Entrar", ImVec2(half, 42.0f), false, true, nullptr, 20) && signUpTab) { signUpTab = false; accError.clear(); account->ClearError(); ForgetPasswords(); }
        if (!signUpTab) CircleLast(draw, 31u);
        ImGui::SetCursorScreenPos(ImVec2(x + half + 14.0f, y));
        if (C::Tape("tab-crear", "Crear cuenta", ImVec2(half, 42.0f), false, true, nullptr, 20) && !signUpTab) { signUpTab = true; accError.clear(); account->ClearError(); ForgetPasswords(); }
        if (signUpTab) CircleLast(draw, 37u);
        y += 62.0f;

        bool submit = false;
        Label(draw, x, y, "Usuario");
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        Field("##usuario", accName, sizeof accName, inner, 0, OnlyLettersAndDigits);
        y += 44.0f;
        if (signUpTab) {
            const auto problem = Online::CheckName(accName);
            const char* hint = accName[0] == '\0' ? "De 3 a 16 letras (a-z) o números, sin espacios. Así lo verán los demás."
                             : problem == Online::NameProblem::None ? "Sirve. Si nadie más lo tiene, es suyo." : Online::NameProblemText(problem);
            C::Text(draw, false, 15, ImVec2(x, y), accName[0] != '\0' && problem != Online::NameProblem::None ? C::kRojo : C::kMarcador, hint, inner);
            y += 26.0f;
        }

        Label(draw, x, y, "Contraseña");
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        submit |= Field("##clave", accPass, sizeof accPass, inner, ImGuiInputTextFlags_Password | (signUpTab ? 0 : ImGuiInputTextFlags_EnterReturnsTrue));
        y += 52.0f;
        if (signUpTab) {
            Label(draw, x, y, "Repita la contraseña");
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            Field("##clave2", accPass2, sizeof accPass2, inner, ImGuiInputTextFlags_Password);
            y += 44.0f;
            if (accPass[0] != '\0') {
                const auto problem = Online::CheckPassword(accPass, accPass2, accName);
                if (problem != Online::PasswordProblem::None && !(problem == Online::PasswordProblem::Mismatch && accPass2[0] == '\0'))
                    C::Text(draw, false, 15, ImVec2(x, y), C::kRojo, Online::PasswordProblemText(problem), inner);
            }
            y += 26.0f;
            Label(draw, x, y, "Correo (opcional)");
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            Field("##correo", accEmail, sizeof accEmail, inner, ImGuiInputTextFlags_CharsNoBlank);
            y += 44.0f;
            const char* note = "Solo sirve para recuperar la contraseña si la olvida. Sin correo no hay cómo recuperarla. Nadie más lo ve.";
            C::Text(draw, false, 15, ImVec2(x, y), C::kMarcador, note, inner);
            y += C::TextHeight(false, 15, note, inner) + 12.0f;
        }

        const std::string error = !accError.empty() ? accError : account->Error() != Online::AuthError::None ? std::string(Online::AuthErrorText(account->Error())) : std::string();
        if (!error.empty()) {
            C::Text(draw, false, 17, ImVec2(x, y), C::kRojo, error.c_str(), inner);
            y += C::TextHeight(false, 17, error.c_str(), inner) + 10.0f;
        } else if (!accInfo.empty()) {   // por ejemplo, «Su cuenta se borró»
            C::Text(draw, false, 17, ImVec2(x, y), C::kMarcador, accInfo.c_str(), inner);
            y += C::TextHeight(false, 17, accInfo.c_str(), inner) + 10.0f;
        }
        ImGui::SetCursorScreenPos(ImVec2(x, y));
        if (C::Tape("cuenta-ok", signUpTab ? "Crear cuenta" : "Entrar", ImVec2(inner, 50.0f), true, true, signUpTab ? nullptr : "Enter", 22)) submit = true;
        if (submit) SubmitAccount();
        if (!signUpTab) {
            y += 62.0f;
            ImGui::SetCursorScreenPos(ImVec2(x, y));
            if (C::Tape("olvido", "Olvidé mi contraseña", ImVec2(260.0f, 38.0f), false, true, nullptr, 17)) { SetPanel(AccPanel::ForgotName); accInfo.clear(); account->ClearError(); }
        }
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

LobbyChoice RunLobby(Window& window, UIManager& ui, AudioManager& audio, LobbySettings& settings, const std::filesystem::path& savegame, LobbyRoom& room, bool inGame,
                     Online::Session* account) {
    settings.ApplyAudio(audio);
    Lobby lobby(settings, audio, savegame, room, inGame, account);
    double lastTime = glfwGetTime();
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
    // prueba de volver al lobby: BAZUKO_PRUEBA_VOLVER=segundos entra a Historia sin tocar nada, el juego pide «Guardar y salir» a esos segundos
    // y el lobby de vuelta se guarda en BAZUKO_PRUEBA_VOLVER_SHOT y cierra
    if (std::getenv("BAZUKO_PRUEBA_VOLVER")) {
        if (!inGame) { lobby.choice.mode = LobbyChoice::Mode::Story; lobby.done = true; }
        else shotPath = std::getenv("BAZUKO_PRUEBA_VOLVER_SHOT");
    }
    int shotFrames = 0;
    if (const char* which = std::getenv("BAZUKO_LOBBY_PANTALLA")) {
        const std::string name = which;
        if (name == "multi") lobby.Go(Screen::Multi);
        else if (name.rfind("clasificacion", 0) == 0 && account) {   // con filas de muestra, sin red
            account->PreviewSignedIn("Jairo117", "", false);
            lobby.Go(Screen::Ranking);
            lobby.rankTable = 1;
            lobby.rankScope = name == "clasificacion-global" ? 2 : 0;
            Online::Leaderboard sample;
            const char* names[] = {"Rosa", "ElFlaco", "Marlon", "Yeimy", "Chucho", "Doris", "Jairo117", "Pacho", "Lucero", "Wilson"};
            for (int i = 0; i < 10; ++i) sample.rows.push_back({i + 1, names[i], 2400000LL - i * 215000LL});
            sample.ownPlace = 7;
            sample.ownValue = sample.rows[6].value;
            sample.next = lobby.rankScope == 2 ? 50 : -1;
            if (name == "clasificacion-vacia") { sample.rows.clear(); sample.ownPlace = 0; }
            lobby.rankBoard = sample;
        }
        else if (name == "crear") lobby.Go(Screen::Create);
        else if (name == "unirse") lobby.Go(Screen::Join);
        else if (name == "ajustes") lobby.Go(Screen::Settings);
        else if (name == "perfil") lobby.Go(Screen::Profile);
        else if (name == "crear-cuenta") { lobby.Go(Screen::Profile); lobby.signUpTab = true; }
        else if (name == "pide-cuenta") lobby.TryMulti();
        // cuenta-*: una cuenta de muestra (sin red) para ver la ficha y sus gestiones; olvido*: contrasena olvidada
        else if (name.rfind("cuenta", 0) == 0 && account) {
            Online::OwnProfile sample;
            sample.name = "Jairo117";
            sample.created = 1794600000;
            if (name == "cuenta") { sample.games = 12; sample.days = 31; sample.money = 184500; sample.fights = 7; sample.seconds = 5 * 3600 + 20 * 60; sample.appearance = "{}"; }
            account->PreviewSignedIn("Jairo117", name == "cuenta-sin-correo" ? "" : "jairo117@ejemplo.com", name == "cuenta", &sample);
            lobby.Go(Screen::Profile);
            if (name == "cuenta-correo") { lobby.SetPanel(Lobby::AccPanel::Email); CopyTo(lobby.accEmail, sizeof lobby.accEmail, account->Email()); }
            else if (name == "cuenta-codigo") lobby.SetPanel(Lobby::AccPanel::Verify);
            else if (name == "cuenta-clave") lobby.SetPanel(Lobby::AccPanel::Password);
            else if (name == "cuenta-borrar") lobby.SetPanel(Lobby::AccPanel::Delete);
        }
        else if (name == "olvido" || name == "olvido-codigo") {
            lobby.Go(Screen::Profile);
            CopyTo(lobby.accName, sizeof lobby.accName, "Jairo117");
            lobby.SetPanel(name == "olvido" ? Lobby::AccPanel::ForgotName : Lobby::AccPanel::ForgotCode);
        }
#ifdef BAZUKO_NET_ENABLED
        // sala | sala-lista | sala-salir: abre una sala por internet (codigo en BAZUKO_LOBBY_CODIGO) y muestra su ficha, la lista con ella o el aviso al salir
        // pedir-codigo: la lista con una sala con codigo y el recuadro que pide el codigo para entrar (BAZUKO_LOBBY_CODIGO: lo escrito, se revisa)
        else if (name == "pedir-codigo") {
            lobby.Go(Screen::Multi);
            for (int i = 0; i < 300; ++i) {
                lobby.browser->Update();
                const auto rooms = lobby.browser->Rooms();
                const auto locked = std::find_if(rooms.begin(), rooms.end(), [](const Net::RoomListing& r) { return r.locked; });
                if (locked != rooms.end()) {
                    lobby.AskCodeFor(locked->name, locked->address + ":" + std::to_string(locked->port));
                    if (const char* code = std::getenv("BAZUKO_LOBBY_CODIGO")) {
                        CopyTo(lobby.askText, sizeof lobby.askText, code);
                        lobby.browser->CheckCode(lobby.askRelay, Net::Relay::NormalizeRoomCode(code));
                        for (int k = 0; k < 60 && lobby.browser->CodeCheck(lobby.askRelay, Net::Relay::NormalizeRoomCode(code)) < 0; ++k) { lobby.browser->Update(); std::this_thread::sleep_for(std::chrono::milliseconds(16)); }
                        if (lobby.browser->CodeCheck(lobby.askRelay, Net::Relay::NormalizeRoomCode(code)) == 0) lobby.askError = "Ese código no es de ninguna sala abierta. Revíselo con quien abrió la sala.";
                    }
                    break;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(16));
            }
        }
        else if (name.rfind("sala", 0) == 0) {
            if (const char* code = std::getenv("BAZUKO_LOBBY_CODIGO")) CopyTo(lobby.codeText, sizeof lobby.codeText, code);
            settings.roomInternet = true;
            lobby.Go(Screen::Multi);
            lobby.screen = Screen::Create;
            lobby.OpenRoom(Trim(lobby.roomName));
            if (name == "sala-lista" || name == "sala-salir") {
                for (int i = 0; i < 200 && lobby.modal == Modal::Opening; ++i) { lobby.TickRoom(0.016f); lobby.browser->Update(); std::this_thread::sleep_for(std::chrono::milliseconds(16)); }
                lobby.modal = name == "sala-salir" ? Modal::ConfirmQuit : Modal::None;
                lobby.Go(name == "sala-salir" ? Screen::Home : Screen::Multi);
            }
        }
#endif
    }

    while (!lobby.done) {
        glfwWaitEventsTimeout(1.0 / 60.0);   // el lobby no necesita correr a mil cuadros: espera eventos o el siguiente cuadro
        if (glfwWindowShouldClose(native)) {   // cerrar la ventana es salir del juego: con la sala abierta, se pregunta primero
            if (!room.Active()) { lobby.choice.mode = LobbyChoice::Mode::Quit; break; }
            glfwSetWindowShouldClose(native, GLFW_FALSE);
            lobby.modal = Modal::ConfirmQuit;
        }
        const double now = glfwGetTime();
        const float frameDt = static_cast<float>(std::min(now - lastTime, 0.1));
        lastTime = now;
#ifdef BAZUKO_NET_ENABLED
        lobby.TickRoom(frameDt);
#else
        (void)frameDt;
#endif
        int fbWidth = 0, fbHeight = 0;
        glfwGetFramebufferSize(native, &fbWidth, &fbHeight);
        if (fbWidth <= 0 || fbHeight <= 0) continue;   // minimizada
        glViewport(0, 0, fbWidth, fbHeight);
        glClearColor(0.80f, 0.64f, 0.42f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
        ui.BeginFrame();
        lobby.PollFetch();
        lobby.TickAccount();
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
        const bool wide = lobby.screen == Screen::Multi || lobby.screen == Screen::Settings || lobby.screen == Screen::Create || lobby.screen == Screen::Ranking;
        const float width = std::min(display.x - 32.0f, wide ? 820.0f : 560.0f);
        const float top = margin + wordHeight + 18.0f;
        const float room = std::max(300.0f, display.y - top - 24.0f);
        float fit = room;   // cada pantalla mide lo que tiene; la de salas usa todo el alto para la lista
        switch (lobby.screen) {
            case Screen::Home: fit = 440.0f; break;
            case Screen::Profile: fit = lobby.ProfileHeight(); break;
            case Screen::Join: fit = 380.0f; break;
            case Screen::Create: fit = settings.roomInternet ? 602.0f : 478.0f; break;
            case Screen::Settings: fit = 560.0f; break;
            case Screen::Multi: break;
            case Screen::Ranking: break;
        }
        if (lobby.modal != Modal::None) fit = Lobby::ModalHeight(lobby.modal);
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
        const Modal shownModal = lobby.modal;
        if (shownModal != Modal::None) lobby.DrawModal(draw, panelMin, width);
        else switch (lobby.screen) {
            case Screen::Home: lobby.Home(draw, panelMin, width); break;
            case Screen::Multi: lobby.Multi(draw, panelMin, width, height); break;
            case Screen::Ranking: lobby.Ranking(draw, panelMin, width, height); break;
            case Screen::Create: lobby.Create(draw, panelMin, width); break;
            case Screen::Join: lobby.Join(draw, panelMin, width); break;
            case Screen::Settings: lobby.Settings(draw, panelMin, width); break;
            case Screen::Profile: lobby.Profile(draw, panelMin, width); break;
        }
        if (ImGui::IsKeyPressed(ImGuiKey_Escape, false) || ImGui::IsKeyPressed(ImGuiKey_GamepadFaceRight, false)) {
            if (shownModal != Modal::None) lobby.CancelModal(); else lobby.Back();
        }
        if (shownModal == Modal::None && lobby.screen == Screen::Home && !ImGui::GetIO().WantTextInput && ImGui::IsKeyPressed(ImGuiKey_Enter, false) && !ImGui::IsAnyItemFocused())
            lobby.PickStory();
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
