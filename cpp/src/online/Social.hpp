#pragma once
// Servicios del juego en AWS (HTTP API bazuko-social): por ahora el perfil propio. Cada pedido lleva el token de acceso de la cuenta;
// el servidor saca la cuenta del token, asi que no hay forma de pedir ni cambiar la de otro (FR-013).
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "online/Cognito.hpp"

namespace Bazuko::Online {

struct OwnProfile {
    std::string name;
    std::string appearance;   // JSON plano con las opciones del creador de personaje ("" = sin apariencia en la cuenta)
    bool friendsOnly = false; // visibilidad: false = lo ven todos, true = solo amigos
    long long created = 0;    // segundos desde 1970
    long long games = 0, days = 0, money = 0, fights = 0, seconds = 0;   // estadisticas de multijugador
};

std::shared_ptr<HttpCall> ApiGetMe(const CognitoConfig& config, const std::string& accessToken);
std::shared_ptr<HttpCall> ApiPutMe(const CognitoConfig& config, const std::string& accessToken, const std::string& bodyJson);
std::shared_ptr<HttpCall> ApiDeleteMe(const CognitoConfig& config, const std::string& accessToken);
std::shared_ptr<HttpCall> CognitoDeleteUser(const CognitoConfig& config, const std::string& accessToken);

std::optional<OwnProfile> ParseOwnProfile(const HttpResponse& response);
AuthError ParseApiError(const HttpResponse& response);   // None si fue 2xx
std::string ProfileChangesJson(const std::string* appearanceJson, const bool* friendsOnly);   // el cuerpo de PUT /yo con lo que cambia

// Clasificacion (GET /clasificacion/{tabla}): tablas "dias", "plata", "peleas", "partidas", "tiempo"; pagina de 10, 50 o 100 desde `from`
struct LeaderRow { int place = 0; std::string name; long long value = 0; };
struct Leaderboard {
    std::vector<LeaderRow> rows;
    int next = -1;                  // desde donde sigue la pagina siguiente (-1: no hay mas)
    int ownPlace = 0;               // 0: sin estadisticas todavia
    long long ownValue = 0;
};
std::shared_ptr<HttpCall> ApiLeaderboard(const CognitoConfig& config, const std::string& accessToken, const std::string& table, int from, int count);
std::optional<Leaderboard> ParseLeaderboard(const HttpResponse& response);

// Partidas por internet: cada cuenta dice que esta en la sala; el anfitrion manda lo que vio de cada jugador desde su ultimo informe
struct MatchResult { std::string name; long long days = 0, money = 0, fights = 0, deaths = 0, seconds = 0; };
std::shared_ptr<HttpCall> ApiMatchPresent(const CognitoConfig& config, const std::string& accessToken, const std::string& roomCode, bool host);
std::shared_ptr<HttpCall> ApiMatchResult(const CognitoConfig& config, const std::string& accessToken, const std::string& roomCode, const std::vector<MatchResult>& players);
std::string MatchResultJson(const std::vector<MatchResult>& players);

} // namespace Bazuko::Online
