#include "online/Social.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>

namespace Bazuko::Online {

namespace {
using json = nlohmann::json;

std::shared_ptr<HttpCall> ApiCall(const CognitoConfig& config, const char* method, const std::string& path, const std::string& accessToken, const std::string& body = {}) {
    HttpRequest request;
    request.method = method;
    if (!config.ApiValid()) { request.url.clear(); return HttpSend(request); }   // sin servicio: un pedido que termina sin respuesta
    request.url = config.api + path;
    request.headers = {{"Authorization", "Bearer " + accessToken}};
    if (!body.empty()) { request.headers.emplace_back("Content-Type", "application/json"); request.body = body; }
    return HttpSend(request);
}

long long Count(const json& object, const char* key) {
    const auto it = object.find(key);
    return it != object.end() && it->is_number() ? std::max(0LL, it->get<long long>()) : 0LL;
}
} // namespace

std::shared_ptr<HttpCall> ApiGetMe(const CognitoConfig& config, const std::string& accessToken) { return ApiCall(config, "GET", "/yo", accessToken); }
std::shared_ptr<HttpCall> ApiPutMe(const CognitoConfig& config, const std::string& accessToken, const std::string& bodyJson) { return ApiCall(config, "PUT", "/yo", accessToken, bodyJson); }
std::shared_ptr<HttpCall> ApiDeleteMe(const CognitoConfig& config, const std::string& accessToken) { return ApiCall(config, "DELETE", "/yo", accessToken); }

std::shared_ptr<HttpCall> CognitoDeleteUser(const CognitoConfig& config, const std::string& accessToken) {
    HttpRequest request;
    if (!config.Valid()) return HttpSend(request);
    request.url = config.Endpoint();
    request.headers = {{"Content-Type", "application/x-amz-json-1.1"}, {"X-Amz-Target", "AWSCognitoIdentityProviderService.DeleteUser"}};
    request.body = json{{"AccessToken", accessToken}}.dump();
    return HttpSend(request);
}

std::optional<OwnProfile> ParseOwnProfile(const HttpResponse& response) {
    if (!response.reached || response.status != 200) return std::nullopt;
    const json body = json::parse(response.body, nullptr, false);
    if (!body.is_object() || !body.contains("nombre") || !body["nombre"].is_string()) return std::nullopt;
    OwnProfile profile;
    profile.name = body["nombre"].get<std::string>();
    if (const auto it = body.find("apariencia"); it != body.end() && it->is_object()) profile.appearance = it->dump();
    profile.friendsOnly = body.value("visibilidad", std::string()) == "amigos";
    profile.created = Count(body, "creado");
    if (const auto it = body.find("estadisticas"); it != body.end() && it->is_object()) {
        profile.games = Count(*it, "partidas");
        profile.days = Count(*it, "dias");
        profile.money = Count(*it, "plata");
        profile.fights = Count(*it, "peleas");
        profile.seconds = Count(*it, "tiempo");
    }
    return profile;
}

AuthError ParseApiError(const HttpResponse& response) {
    if (!response.reached) return AuthError::Network;
    if (response.status >= 200 && response.status < 300) return AuthError::None;
    if (response.status == 401) return AuthError::SessionExpired;   // el autorizador no acepto el token
    if (response.status == 429) return AuthError::TooManyAttempts;
    return AuthError::Unknown;
}

std::string ProfileChangesJson(const std::string* appearanceJson, const bool* friendsOnly) {
    json body = json::object();
    if (appearanceJson) {
        const json look = json::parse(*appearanceJson, nullptr, false);
        body["apariencia"] = look.is_object() ? look : json(nullptr);
    }
    if (friendsOnly) body["visibilidad"] = *friendsOnly ? "amigos" : "todos";
    return body.dump();
}

std::shared_ptr<HttpCall> ApiLeaderboard(const CognitoConfig& config, const std::string& accessToken, const std::string& table, int from, int count) {
    return ApiCall(config, "GET", "/clasificacion/" + table + "?desde=" + std::to_string(std::max(0, from)) + "&cuantos=" + std::to_string(count), accessToken);
}

std::optional<Leaderboard> ParseLeaderboard(const HttpResponse& response) {
    if (!response.reached || response.status != 200) return std::nullopt;
    const json body = json::parse(response.body, nullptr, false);
    if (!body.is_object() || !body.contains("filas") || !body["filas"].is_array()) return std::nullopt;
    Leaderboard board;
    for (const json& row : body["filas"]) {
        if (!row.is_object() || !row.contains("nombre") || !row["nombre"].is_string()) continue;
        board.rows.push_back(LeaderRow{static_cast<int>(Count(row, "puesto")), row["nombre"].get<std::string>().substr(0, 16), Count(row, "valor")});
        if (board.rows.size() >= 100) break;
    }
    if (const auto it = body.find("siguiente"); it != body.end() && it->is_number_integer()) board.next = std::max(0, it->get<int>());
    if (const auto it = body.find("yo"); it != body.end() && it->is_object()) {
        board.ownPlace = static_cast<int>(Count(*it, "puesto"));
        board.ownValue = Count(*it, "valor");
    }
    return board;
}

std::shared_ptr<HttpCall> ApiMatchPresent(const CognitoConfig& config, const std::string& accessToken, const std::string& roomCode, bool host) {
    return ApiCall(config, "POST", "/partidas/" + roomCode + "/presente", accessToken, json{{"anfitrion", host}}.dump());
}

std::string MatchResultJson(const std::vector<MatchResult>& players) {
    json list = json::array();
    for (const MatchResult& p : players)
        list.push_back({{"nombre", p.name}, {"dias", std::max(0LL, p.days)}, {"plata", std::max(0LL, p.money)}, {"peleas", std::max(0LL, p.fights)},
                        {"muertes", std::max(0LL, p.deaths)}, {"tiempo", std::max(0LL, p.seconds)}});
    return json{{"jugadores", list}}.dump();
}

std::shared_ptr<HttpCall> ApiMatchResult(const CognitoConfig& config, const std::string& accessToken, const std::string& roomCode, const std::vector<MatchResult>& players) {
    return ApiCall(config, "POST", "/partidas/" + roomCode + "/resultado", accessToken, MatchResultJson(players));
}

} // namespace Bazuko::Online
