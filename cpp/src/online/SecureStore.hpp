#pragma once
// Guarda en el equipo un secreto pequeno (el token de renovacion de la sesion), nunca la contrasena.
// En Windows va cifrado con DPAPI del usuario: copiado a otro usuario u otro equipo no sirve. En otros sistemas, archivo con permisos 0600.
#include <filesystem>
#include <optional>
#include <string>

namespace Bazuko::Online {

bool SaveSecret(const std::filesystem::path& file, const std::string& secret, const std::string& purpose);
std::optional<std::string> LoadSecret(const std::filesystem::path& file, const std::string& purpose);   // vacio si no hay o no se pudo descifrar
void EraseSecret(const std::filesystem::path& file);   // sobrescribe y borra

} // namespace Bazuko::Online
