#pragma once
// Llamadas al grupo de usuarios de Amazon Cognito: crear cuenta, entrar, renovar, cerrar sesion, cambiar contrasena.
// Cognito guarda y compara las contrasenas; el juego solo las manda dentro de TLS y no las guarda (FR-009, FR-012).
// Son llamadas publicas del cliente del juego (sin secreto): no hace falta firmar con credenciales de AWS.
#include <memory>
#include <optional>
#include <string>

#include "online/Http.hpp"

namespace Bazuko::Online {

struct CognitoConfig {
    std::string region;     // us-east-2
    std::string clientId;   // cliente "bazuko-juego" del grupo
    std::string api;        // servicios del juego (HTTP API bazuko-social), https://... sin "/" al final; vacio = sin perfil en linea
    bool Valid() const { return !region.empty() && !clientId.empty(); }
    bool ApiValid() const { return Valid() && api.rfind("https://", 0) == 0; }
    std::string Endpoint() const { return "https://cognito-idp." + region + ".amazonaws.com/"; }
};

enum class AuthError { None, Network, NotConfigured, BadCredentials, NameTaken, NameInvalid, PasswordInvalid, TooManyAttempts, SessionExpired, CodeWrong, CodeExpired,
                       EmailInvalid, Unknown };
const char* AuthErrorText(AuthError error);   // lo que se le dice al jugador

struct Tokens {
    std::string access, id, refresh;
    std::string username;   // como se escribio al crear la cuenta
    long long expires = 0;  // segundos desde 1970 en que vence el de acceso
};

struct IdClaims { std::string username; long long expires = 0; };

struct UserInfo { std::string email; bool emailVerified = false; };   // lo que la cuenta sabe de si misma (GetUser): solo se pide con su propio token

std::shared_ptr<HttpCall> CognitoSignUp(const CognitoConfig& config, const std::string& name, const std::string& password, const std::string& email);
std::shared_ptr<HttpCall> CognitoSignIn(const CognitoConfig& config, const std::string& name, const std::string& password);
std::shared_ptr<HttpCall> CognitoRefresh(const CognitoConfig& config, const std::string& refreshToken);
std::shared_ptr<HttpCall> CognitoRevoke(const CognitoConfig& config, const std::string& refreshToken);
// Con el token de acceso de la propia cuenta (nadie puede pedirlas por otra)
std::shared_ptr<HttpCall> CognitoGetUser(const CognitoConfig& config, const std::string& accessToken);
std::shared_ptr<HttpCall> CognitoSetEmail(const CognitoConfig& config, const std::string& accessToken, const std::string& email);   // queda sin verificar
std::shared_ptr<HttpCall> CognitoRemoveEmail(const CognitoConfig& config, const std::string& accessToken);
std::shared_ptr<HttpCall> CognitoSendEmailCode(const CognitoConfig& config, const std::string& accessToken);
std::shared_ptr<HttpCall> CognitoVerifyEmail(const CognitoConfig& config, const std::string& accessToken, const std::string& code);
std::shared_ptr<HttpCall> CognitoChangePassword(const CognitoConfig& config, const std::string& accessToken, const std::string& oldPassword, const std::string& newPassword);
std::shared_ptr<HttpCall> CognitoGlobalSignOut(const CognitoConfig& config, const std::string& accessToken);   // cierra la cuenta en todos los equipos
// Sin sesion: contrasena olvidada. El codigo llega solo al correo verificado de la cuenta
std::shared_ptr<HttpCall> CognitoForgotPassword(const CognitoConfig& config, const std::string& name);
std::shared_ptr<HttpCall> CognitoConfirmForgotPassword(const CognitoConfig& config, const std::string& name, const std::string& code, const std::string& newPassword);

AuthError ParseAuthError(const HttpResponse& response);   // None si fue 200
std::optional<Tokens> ParseTokens(const HttpResponse& response, const std::string& keepRefresh = {});   // la renovacion no trae token de renovacion nuevo
std::optional<UserInfo> ParseUserInfo(const HttpResponse& response);
std::optional<IdClaims> ReadIdToken(const std::string& idToken);   // solo lee: la firma la valida el servidor, no el juego

} // namespace Bazuko::Online
