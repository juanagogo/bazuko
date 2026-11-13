// Sesion guardada en el equipo: el archivo no tiene el token en claro, no se abre con otro proposito (otra "entropia" de DPAPI),
// y borrarlo no deja nada. Las respuestas de Cognito se leen sin tocar la red.
#include "online/Cognito.hpp"
#include "online/SecureStore.hpp"
#include "online/Social.hpp"

#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <string>

using namespace Bazuko::Online;

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { std::printf("FALLO: %s\n", msg); ++failures; } } while (0)

int main() {
    const std::filesystem::path file = std::filesystem::temp_directory_path() / "bazuko_sesion_prueba.bin";
    const std::string token = "eyJjdHkiOiJKV1QiLCJlbmMiOiJBMjU2R0NNIn0.token-de-renovacion-de-prueba";

    CHECK(SaveSecret(file, token, "Bazuko sesion v1"), "se guarda el token");
    {
        std::ifstream in(file, std::ios::binary);
        const std::string raw((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
#ifdef _WIN32
        CHECK(raw.find("token-de-renovacion") == std::string::npos, "el archivo no tiene el token en claro");
#endif
        CHECK(!raw.empty(), "el archivo existe");
    }
    const auto back = LoadSecret(file, "Bazuko sesion v1");
    CHECK(back && *back == token, "se lee el mismo token");
#ifdef _WIN32
    CHECK(!LoadSecret(file, "otro proposito"), "con otra entropia no se descifra");
#endif
    EraseSecret(file);
    CHECK(!std::filesystem::exists(file), "cerrar sesion borra el archivo");
    CHECK(!LoadSecret(file, "Bazuko sesion v1"), "sin archivo no hay sesion");

    // Lectura de respuestas de Cognito (sin red)
    HttpResponse taken{true, 400, R"({"__type":"UsernameExistsException","message":"User already exists"})"};
    CHECK(ParseAuthError(taken) == AuthError::NameTaken, "nombre ya tomado");
    HttpResponse wrong{true, 400, R"({"__type":"NotAuthorizedException","message":"Incorrect username or password."})"};
    CHECK(ParseAuthError(wrong) == AuthError::BadCredentials, "usuario o contrasena incorrectos");
    HttpResponse lambda{true, 400, R"({"__type":"UserLambdaValidationException","message":"PreSignUp failed with error nombre_prohibido."})"};
    CHECK(ParseAuthError(lambda) == AuthError::NameInvalid, "el servidor rechaza el nombre");
    HttpResponse limit{true, 400, R"({"__type":"NotAuthorizedException","message":"Password attempts exceeded"})"};
    CHECK(ParseAuthError(limit) == AuthError::TooManyAttempts, "demasiados intentos");
    CHECK(ParseAuthError(HttpResponse{}) == AuthError::Network, "sin respuesta es error de red");
    HttpResponse badCode{true, 400, R"({"__type":"CodeMismatchException","message":"Invalid verification code provided, please try again."})"};
    CHECK(ParseAuthError(badCode) == AuthError::CodeWrong, "codigo equivocado");
    HttpResponse oldCode{true, 400, R"({"__type":"ExpiredCodeException","message":"Invalid code provided, please request a code again."})"};
    CHECK(ParseAuthError(oldCode) == AuthError::CodeExpired, "codigo vencido");
    HttpResponse weak{true, 400, R"({"__type":"InvalidPasswordException","message":"Password did not conform with policy"})"};
    CHECK(ParseAuthError(weak) == AuthError::PasswordInvalid, "contrasena que no cumple");

    // Lo que la cuenta sabe de si misma (GetUser): correo y si esta verificado
    HttpResponse user{true, 200, R"({"Username":"jairo117","UserAttributes":[{"Name":"sub","Value":"abc"},{"Name":"email","Value":"jairo@ejemplo.com"},{"Name":"email_verified","Value":"true"}]})"};
    const auto info = ParseUserInfo(user);
    CHECK(info && info->email == "jairo@ejemplo.com" && info->emailVerified, "se leen correo y verificacion");
    HttpResponse noMail{true, 200, R"({"Username":"jairo117","UserAttributes":[{"Name":"sub","Value":"abc"}]})"};
    const auto bare = ParseUserInfo(noMail);
    CHECK(bare && bare->email.empty() && !bare->emailVerified, "cuenta sin correo");
    CHECK(!ParseUserInfo(HttpResponse{true, 400, "{}"}), "una falla no es un usuario");

    // Perfil propio (GET /yo)
    HttpResponse me{true, 200, R"({"nombre":"Jairo117","apariencia":{"pelo":"corto","pielIdx":2},"visibilidad":"amigos","creado":1794600000,"estadisticas":{"partidas":3,"dias":9,"plata":4800,"peleas":1,"tiempo":3600}})"};
    const auto profile = ParseOwnProfile(me);
    CHECK(profile && profile->name == "Jairo117" && profile->friendsOnly && profile->created == 1794600000, "se lee el perfil propio");
    CHECK(profile && profile->games == 3 && profile->days == 9 && profile->money == 4800 && profile->fights == 1 && profile->seconds == 3600, "se leen las estadisticas");
    CHECK(profile && profile->appearance.find("corto") != std::string::npos, "se lee la apariencia");
    HttpResponse fresh{true, 200, R"({"nombre":"Rosa","apariencia":null,"visibilidad":"todos","creado":5,"estadisticas":{"partidas":-4}})"};
    const auto bare2 = ParseOwnProfile(fresh);
    CHECK(bare2 && bare2->appearance.empty() && !bare2->friendsOnly && bare2->games == 0, "perfil nuevo sin apariencia; nada negativo");
    CHECK(ParseApiError(HttpResponse{true, 401, R"({"message":"Unauthorized"})"}) == AuthError::SessionExpired, "401 es sesion vencida");
    CHECK(ParseApiError(HttpResponse{true, 204, ""}) == AuthError::None, "204 es exito");
    const std::string look = R"({"pelo":"corto"})";
    const bool only = true;
    CHECK(ProfileChangesJson(&look, nullptr) == R"({"apariencia":{"pelo":"corto"}})", "cambio de apariencia");
    CHECK(ProfileChangesJson(nullptr, &only) == R"({"visibilidad":"amigos"})", "cambio de visibilidad");

    // Un token de identidad (cabecera.cuerpo.firma) con nombre y vencimiento: {"cognito:username":"Jairo117","exp":2000000000}
    const std::string idToken = "eyJhbGciOiJSUzI1NiJ9.eyJjb2duaXRvOnVzZXJuYW1lIjoiSmFpcm8xMTciLCJleHAiOjIwMDAwMDAwMDB9.firma";
    const auto claims = ReadIdToken(idToken);
    CHECK(claims && claims->username == "Jairo117" && claims->expires == 2000000000, "se leen nombre y vencimiento del token");
    CHECK(!ReadIdToken("no-es-un-token"), "un texto cualquiera no es un token");

    if (failures == 0) std::printf("Sesion guardada: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
