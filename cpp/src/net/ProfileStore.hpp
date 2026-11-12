#pragma once
// Perfiles de jugador para el servidor: un archivo por jugador (`<carpeta>/<clave>.json`) con el mismo contenido del guardado actual
// (`savegame.json`) dentro de un sobre con version. La clave es un identificador aleatorio de 128 bits en hexadecimal que genera el cliente
// la primera vez; se valida estrictamente (solo hexadecimal, 32 caracteres) para que nunca se use como ruta fuera de la carpeta.
// `Sanitize` repara o recorta lo que un guardado manipulado pueda traer (dinero negativo, objetos inexistentes, posicion fuera del mapa...).
#include "game/GameData.hpp"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace Bazuko::Net {

inline constexpr int kProfileFormat = 1;

std::string NewPlayerKey();                  // 32 caracteres hexadecimales aleatorios
bool IsValidPlayerKey(const std::string& key);

// Envuelve un guardado del juego como perfil de `key`
nlohmann::json WrapSave(const nlohmann::json& save, const std::string& key);
// Saca el guardado de un perfil (nullopt si el sobre es invalido o de otra clave)
std::optional<nlohmann::json> UnwrapProfile(const nlohmann::json& profile, const std::string& key);

// Repara el guardado en sitio; devuelve una descripcion de cada correccion (vacio = estaba limpio)
std::vector<std::string> Sanitize(nlohmann::json& save, const GameData& data);

class ProfileStore {
public:
    explicit ProfileStore(std::filesystem::path root) : m_Root(std::move(root)) {}
    bool Exists(const std::string& key) const;
    std::optional<nlohmann::json> Load(const std::string& key) const;       // el guardado ya desenvuelto; nullopt si falta o esta corrupto
    bool Save(const std::string& key, const nlohmann::json& save) const;    // escritura atomica (archivo temporal y renombrado)
    const std::filesystem::path& Root() const { return m_Root; }

private:
    std::filesystem::path PathFor(const std::string& key) const { return m_Root / (key + ".json"); }
    std::filesystem::path m_Root;
};

} // namespace Bazuko::Net
