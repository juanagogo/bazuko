#pragma once
// Regla de nombres de usuario de las cuentas: la misma que el servidor (servicios/src/reglas/nombres.ts), que la vuelve a aplicar
// aunque el juego se salte esta (FR-003). Las listas de nombres prohibidos salen al compilar de servicios/datos/nombres-prohibidos.json.
#include <cctype>
#include <cstring>
#include <string>

#include "online/NameRulesData.hpp"   // generado por CMake: kForbiddenParts y kForbiddenExact

namespace Bazuko::Online {

inline constexpr size_t kNameMin = 3, kNameMax = 16;
inline constexpr size_t kPasswordMin = 8;

enum class NameProblem { None, TooShort, TooLong, BadCharacters, Forbidden };

inline NameProblem CheckName(const std::string& name) {
    if (name.size() < kNameMin) return NameProblem::TooShort;
    if (name.size() > kNameMax) return NameProblem::TooLong;
    std::string lower;
    for (char c : name) {
        const bool letter = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
        const bool digit = c >= '0' && c <= '9';
        if (!letter && !digit) return NameProblem::BadCharacters;   // sin tildes, enes, espacios, simbolos ni emojis
        lower.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    for (const char* part : kForbiddenParts) if (lower.find(part) != std::string::npos) return NameProblem::Forbidden;
    std::string bare = lower;
    while (!bare.empty() && bare.back() >= '0' && bare.back() <= '9') bare.pop_back();   // "soporte99" cuenta como "soporte"
    for (const char* exact : kForbiddenExact) if (bare == exact) return NameProblem::Forbidden;
    return NameProblem::None;
}

// Lo que se le dice al jugador mientras escribe (vacio si el nombre sirve)
inline const char* NameProblemText(NameProblem problem) {
    switch (problem) {
    case NameProblem::TooShort: return "El nombre necesita al menos 3 letras o números.";
    case NameProblem::TooLong: return "El nombre puede tener hasta 16 letras o números.";
    case NameProblem::BadCharacters: return "Solo letras (a-z, sin tildes ni ñ) y números, sin espacios.";
    case NameProblem::Forbidden: return "Ese nombre no se puede usar. Escoja otro.";
    case NameProblem::None: break;
    }
    return "";
}

enum class PasswordProblem { None, TooShort, SameAsName, Mismatch };

inline PasswordProblem CheckPassword(const std::string& password, const std::string& repeat, const std::string& name) {
    if (password.size() < kPasswordMin) return PasswordProblem::TooShort;
    std::string a = password, b = name;
    for (char& c : a) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    for (char& c : b) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if (a == b) return PasswordProblem::SameAsName;
    if (password != repeat) return PasswordProblem::Mismatch;
    return PasswordProblem::None;
}

inline const char* PasswordProblemText(PasswordProblem problem) {
    switch (problem) {
    case PasswordProblem::TooShort: return "La contraseña necesita al menos 8 caracteres.";
    case PasswordProblem::SameAsName: return "La contraseña no puede ser igual al nombre.";
    case PasswordProblem::Mismatch: return "Las dos contraseñas no son iguales.";
    case PasswordProblem::None: break;
    }
    return "";
}

} // namespace Bazuko::Online
