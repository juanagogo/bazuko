// Regla de nombres de las cuentas: los mismos casos que servicios/test/nombres.test.ts (si cambia uno, cambia el otro).
#include "online/NameRules.hpp"

#include <cstdio>

using namespace Bazuko::Online;

static int failures = 0;
#define CHECK(cond, msg) do { if (!(cond)) { std::printf("FALLO: %s\n", msg); ++failures; } } while (0)

int main() {
    for (const char* ok : {"Jairo", "jairo117", "ABC", "Vergara", "Computador", "Maricarmen", "a1b2c3d4e5f6g7h8"})
        CHECK(CheckName(ok) == NameProblem::None, ok);

    struct Case { const char* name; NameProblem problem; };
    const Case bad[] = {
        {"ab", NameProblem::TooShort}, {"", NameProblem::TooShort}, {"a1b2c3d4e5f6g7h8i", NameProblem::TooLong},
        {"Hola Mundo", NameProblem::BadCharacters}, {"\xC3\x91" "andu", NameProblem::BadCharacters}, {"Jos\xC3\xA9", NameProblem::BadCharacters},
        {"juan_p", NameProblem::BadCharacters}, {"juan-p", NameProblem::BadCharacters}, {"emoji\xF0\x9F\x98\x80", NameProblem::BadCharacters},
        {"SuperAdmin", NameProblem::Forbidden}, {"Bazuko2", NameProblem::Forbidden}, {"soporte", NameProblem::Forbidden},
        {"Soporte99", NameProblem::Forbidden}, {"MIERDA", NameProblem::Forbidden},
    };
    for (const Case& c : bad) CHECK(CheckName(c.name) == c.problem, c.name);

    CHECK(CheckPassword("corta", "corta", "Jairo") == PasswordProblem::TooShort, "contrasena corta");
    CHECK(CheckPassword("jairo117", "jairo117", "Jairo117") == PasswordProblem::SameAsName, "contrasena igual al nombre");
    CHECK(CheckPassword("calle larga 7", "calle larga 8", "Jairo") == PasswordProblem::Mismatch, "contrasenas distintas");
    CHECK(CheckPassword("calle larga 7", "calle larga 7", "Jairo") == PasswordProblem::None, "contrasena valida");

    if (failures == 0) std::printf("Reglas de nombres: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
