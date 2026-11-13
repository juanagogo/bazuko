#include "online/Cognito.hpp"

#include <nlohmann/json.hpp>

namespace Bazuko::Online {

namespace {
using json = nlohmann::json;

HttpRequest CognitoRequest(const CognitoConfig& config, const char* action, const json& body) {
    HttpRequest request;
    request.url = config.Endpoint();
    request.headers = {{"Content-Type", "application/x-amz-json-1.1"}, {"X-Amz-Target", std::string("AWSCognitoIdentityProviderService.") + action}};
    request.body = body.dump();
    return request;
}

std::shared_ptr<HttpCall> Failed() {   // sin configuracion: un pedido que ya termino sin respuesta
    return HttpSend(HttpRequest{"POST", "", {}, "", 0});
}

int Base64Value(char c) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '-' || c == '+') return 62;
    if (c == '_' || c == '/') return 63;
    return -1;
}

std::optional<std::string> Base64UrlDecode(const std::string& text) {
    std::string out;
    int buffer = 0, bits = 0;
    for (char c : text) {
        if (c == '=') break;
        const int value = Base64Value(c);
        if (value < 0) return std::nullopt;
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) { bits -= 8; out.push_back(static_cast<char>((buffer >> bits) & 0xFF)); }
    }
    return out;
}
} // namespace

const char* AuthErrorText(AuthError error) {
    switch (error) {
    case AuthError::Network: return "No hay conexión con el servidor de cuentas. Revise el internet e intente de nuevo.";
    case AuthError::NotConfigured: return "Este juego no tiene servidor de cuentas configurado.";
    case AuthError::BadCredentials: return "Usuario o contraseña incorrectos.";
    case AuthError::NameTaken: return "Ese nombre ya está tomado. Escoja otro.";
    case AuthError::NameInvalid: return "Ese nombre no se puede usar: solo letras y números, de 3 a 16.";
    case AuthError::PasswordInvalid: return "La contraseña necesita al menos 8 caracteres.";
    case AuthError::TooManyAttempts: return "Demasiados intentos. Espere unos minutos e intente de nuevo.";
    case AuthError::SessionExpired: return "Su sesión se cerró. Entre de nuevo.";
    case AuthError::CodeWrong: return "Ese código no es. Revíselo en su correo.";
    case AuthError::CodeExpired: return "Ese código ya venció. Pida otro.";
    case AuthError::EmailInvalid: return "Ese correo no sirve. Revíselo.";
    case AuthError::EmailTaken: return "Ese correo ya está verificado en otra cuenta. Use otro.";
    case AuthError::Unknown: return "El servidor de cuentas no pudo hacerlo. Intente de nuevo.";
    case AuthError::None: break;
    }
    return "";
}

std::shared_ptr<HttpCall> CognitoSignUp(const CognitoConfig& config, const std::string& name, const std::string& password, const std::string& email) {
    if (!config.Valid()) return Failed();
    json body = {{"ClientId", config.clientId}, {"Username", name}, {"Password", password}};
    if (!email.empty()) body["UserAttributes"] = json::array({{{"Name", "email"}, {"Value", email}}});
    return HttpSend(CognitoRequest(config, "SignUp", body));
}

std::shared_ptr<HttpCall> CognitoSignIn(const CognitoConfig& config, const std::string& name, const std::string& password) {
    if (!config.Valid()) return Failed();
    const json body = {{"ClientId", config.clientId}, {"AuthFlow", "USER_PASSWORD_AUTH"}, {"AuthParameters", {{"USERNAME", name}, {"PASSWORD", password}}}};
    return HttpSend(CognitoRequest(config, "InitiateAuth", body));
}

std::shared_ptr<HttpCall> CognitoRefresh(const CognitoConfig& config, const std::string& refreshToken) {
    if (!config.Valid()) return Failed();
    const json body = {{"ClientId", config.clientId}, {"AuthFlow", "REFRESH_TOKEN_AUTH"}, {"AuthParameters", {{"REFRESH_TOKEN", refreshToken}}}};
    return HttpSend(CognitoRequest(config, "InitiateAuth", body));
}

std::shared_ptr<HttpCall> CognitoRevoke(const CognitoConfig& config, const std::string& refreshToken) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "RevokeToken", {{"ClientId", config.clientId}, {"Token", refreshToken}}));
}

std::shared_ptr<HttpCall> CognitoGetUser(const CognitoConfig& config, const std::string& accessToken) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "GetUser", {{"AccessToken", accessToken}}));
}

std::shared_ptr<HttpCall> CognitoSetEmail(const CognitoConfig& config, const std::string& accessToken, const std::string& email) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "UpdateUserAttributes", {{"AccessToken", accessToken}, {"UserAttributes", json::array({{{"Name", "email"}, {"Value", email}}})}}));
}

std::shared_ptr<HttpCall> CognitoRemoveEmail(const CognitoConfig& config, const std::string& accessToken) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "DeleteUserAttributes", {{"AccessToken", accessToken}, {"UserAttributeNames", json::array({"email"})}}));
}

std::shared_ptr<HttpCall> CognitoSendEmailCode(const CognitoConfig& config, const std::string& accessToken) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "GetUserAttributeVerificationCode", {{"AccessToken", accessToken}, {"AttributeName", "email"}}));
}

std::shared_ptr<HttpCall> CognitoVerifyEmail(const CognitoConfig& config, const std::string& accessToken, const std::string& code) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "VerifyUserAttribute", {{"AccessToken", accessToken}, {"AttributeName", "email"}, {"Code", code}}));
}

std::shared_ptr<HttpCall> CognitoChangePassword(const CognitoConfig& config, const std::string& accessToken, const std::string& oldPassword, const std::string& newPassword) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "ChangePassword", {{"AccessToken", accessToken}, {"PreviousPassword", oldPassword}, {"ProposedPassword", newPassword}}));
}

std::shared_ptr<HttpCall> CognitoGlobalSignOut(const CognitoConfig& config, const std::string& accessToken) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "GlobalSignOut", {{"AccessToken", accessToken}}));
}

std::shared_ptr<HttpCall> CognitoForgotPassword(const CognitoConfig& config, const std::string& name) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "ForgotPassword", {{"ClientId", config.clientId}, {"Username", name}}));
}

std::shared_ptr<HttpCall> CognitoConfirmForgotPassword(const CognitoConfig& config, const std::string& name, const std::string& code, const std::string& newPassword) {
    if (!config.Valid()) return Failed();
    return HttpSend(CognitoRequest(config, "ConfirmForgotPassword", {{"ClientId", config.clientId}, {"Username", name}, {"ConfirmationCode", code}, {"Password", newPassword}}));
}

AuthError ParseAuthError(const HttpResponse& response) {
    if (!response.reached) return AuthError::Network;
    if (response.status == 200) return AuthError::None;
    const json body = json::parse(response.body, nullptr, false);
    std::string type = body.is_object() ? body.value("__type", std::string()) : std::string();
    const std::string message = body.is_object() ? body.value("message", std::string()) : std::string();
    if (const size_t hash = type.rfind('#'); hash != std::string::npos) type = type.substr(hash + 1);
    if (type == "TooManyRequestsException" || type == "LimitExceededException" || message.find("attempts exceeded") != std::string::npos) return AuthError::TooManyAttempts;
    if (type == "UsernameExistsException") return AuthError::NameTaken;
    if (type == "AliasExistsException") return AuthError::EmailTaken;   // el correo ya esta verificado en otra cuenta (se entra tambien con el correo)
    if (type == "UserLambdaValidationException") return AuthError::NameInvalid;
    if (type == "InvalidPasswordException") return AuthError::PasswordInvalid;
    if (type == "CodeMismatchException") return AuthError::CodeWrong;
    if (type == "ExpiredCodeException") return AuthError::CodeExpired;
    if (type == "NotAuthorizedException" || type == "UserNotFoundException" || type == "UserNotConfirmedException") return AuthError::BadCredentials;
    return AuthError::Unknown;
}

std::optional<Tokens> ParseTokens(const HttpResponse& response, const std::string& keepRefresh) {
    if (!response.reached || response.status != 200) return std::nullopt;
    const json body = json::parse(response.body, nullptr, false);
    if (!body.is_object() || !body.contains("AuthenticationResult")) return std::nullopt;
    const json& result = body["AuthenticationResult"];
    Tokens tokens;
    tokens.access = result.value("AccessToken", std::string());
    tokens.id = result.value("IdToken", std::string());
    tokens.refresh = result.value("RefreshToken", keepRefresh);
    if (tokens.access.empty() || tokens.id.empty() || tokens.refresh.empty()) return std::nullopt;
    const auto claims = ReadIdToken(tokens.id);
    if (!claims) return std::nullopt;
    tokens.username = claims->username;
    tokens.expires = claims->expires;
    return tokens;
}

std::optional<UserInfo> ParseUserInfo(const HttpResponse& response) {
    if (!response.reached || response.status != 200) return std::nullopt;
    const json body = json::parse(response.body, nullptr, false);
    if (!body.is_object() || !body.contains("UserAttributes") || !body["UserAttributes"].is_array()) return std::nullopt;
    UserInfo info;
    for (const json& attribute : body["UserAttributes"]) {
        if (!attribute.is_object()) continue;
        const std::string name = attribute.value("Name", std::string());
        const std::string value = attribute.value("Value", std::string());
        if (name == "email") info.email = value;
        else if (name == "email_verified") info.emailVerified = value == "true";
    }
    return info;
}

std::optional<IdClaims> ReadIdToken(const std::string& idToken) {
    const size_t first = idToken.find('.');
    const size_t second = first == std::string::npos ? std::string::npos : idToken.find('.', first + 1);
    if (second == std::string::npos) return std::nullopt;
    const auto payload = Base64UrlDecode(idToken.substr(first + 1, second - first - 1));
    if (!payload) return std::nullopt;
    const json claims = json::parse(*payload, nullptr, false);
    if (!claims.is_object()) return std::nullopt;
    IdClaims out;
    out.username = claims.value("cognito:username", std::string());
    out.expires = claims.value("exp", 0LL);
    if (out.username.empty() || out.expires <= 0) return std::nullopt;
    return out;
}

} // namespace Bazuko::Online
