// Zonas con nombre y via mas cercana: los mismos rectangulos y reglas del original, con las vias reales de la ciudad del port (assets/data/city-map.json).
#include "world/Zones.hpp"

#include <nlohmann/json.hpp>

#include <cstdio>
#include <fstream>

using namespace Bazuko;

static int failures = 0;
#define CHECK(condition, message) do { if (!(condition)) { ++failures; std::printf("FALLO (%d): %s\n", __LINE__, message); } } while (0)

static std::vector<StreetBand> Bands(const nlohmann::json& list) {
    std::vector<StreetBand> out;
    for (const auto& pair : list) out.push_back({pair.at(0).get<int>(), pair.at(1).get<int>()});
    return out;
}

int main() {
    // zonas
    CHECK(ZoneAt(112.98f, 97.84f) == Zone::Parque, "frente al cambuche es el Parque Tercer Milenio");
    CHECK(ZoneAt(40.0f, 55.0f) == Zone::Cartucho, "El Cartucho");
    CHECK(ZoneAt(300.0f, 50.0f) == Zone::Candelaria, "La Candelaria al norte de la Calle 8A");
    CHECK(ZoneAt(300.0f, 150.0f) == Zone::Chapinero, "Chapinero al sur");
    CHECK(ZoneAt(75.0f, -30.0f) == Zone::Andenes && ZoneAt(60.0f, 100.0f) == Zone::Andenes, "el centro, tambien las filas del Portal al norte");
    CHECK(ZoneAt(200.0f, 200.0f) == Zone::Barrio && ZoneAt(160.0f, 60.0f) == Zone::Barrio, "mas alla de la ciudad anterior son los barrios");
    CHECK(ZoneAt(75.0f, 250.0f) == Zone::Lago && ZoneAt(200.0f, 230.0f) == Zone::Lago, "el parque del sur es el lago, no los barrios");
    CHECK(ZoneAt(300.0f, 250.0f) == Zone::Chapinero, "al oriente de la Carrera 5 sigue mandando Chapinero, no el lago");
    CHECK(std::string(ZoneName(Zone::Cartucho)) == "El Cartucho" && std::string(ZoneName(Zone::Lago)) == "Parque del Lago", "nombres");

    // vias reales de la ciudad
    std::ifstream file(BAZUKO_CITY_MAP_PATH);
    nlohmann::json city = nlohmann::json::parse(file, nullptr, false);
    CHECK(!city.is_discarded() && city.contains("carreras"), "se lee el mapa de la ciudad");
    if (!city.is_discarded() && city.contains("carreras")) {
        const std::vector<std::string> carreraNames = city.at("carrerasNames").get<std::vector<std::string>>();
        const std::vector<std::string> calleNames = city.at("callesNames").get<std::vector<std::string>>();
        const auto lanes = Bands(city.at("caracasLanes"));
        const auto labels = StreetLabels(Bands(city.at("carreras")), carreraNames, Bands(city.at("calles")), calleNames, lanes.at(0), lanes.at(1), 2.0f);
        CHECK(labels.size() == carreraNames.size() + calleNames.size() + 1 + 5, "una etiqueta por via, la Caracas y las cinco del oriente");
        const auto always = [](float, float) { return true; };
        CHECK(NearestStreetPhrase(113.0f, 98.0f, labels, always) == "la Carrera 10", "junto al cambuche la via mas cercana es la Carrera 10");
        CHECK(NearestStreetPhrase(75.0f, 10.0f, labels, always) == "la Caracas", "sobre la Caracas se dice «la Caracas» (sin «Av.»)");
        CHECK(NearestStreetPhrase(300.0f, 241.0f, labels, always) == "la Calle 6", "en Chapinero, la Calle 6 (propia del oriente)");
        CHECK(NearestStreetPhrase(100.0f, 241.0f, labels, always) != "la Calle 6", "la Calle 6 no existe en el centro");
        // una via que no pasa a la altura del jugador no cuenta, salvo que ninguna pase
        const auto onlyHorizontal = [&](float, float z) { return std::abs(z - 79.0f) < 1.0f || std::abs(z - 31.0f) < 1.0f; };
        CHECK(NearestStreetPhrase(113.0f, 98.0f, labels, onlyHorizontal) == "la Calle 9", "si solo hay calzada en las calles, gana la mas cercana de ellas");
        const auto never = [](float, float) { return false; };
        CHECK(NearestStreetPhrase(113.0f, 98.0f, labels, never) == "la Carrera 10", "sin calzada en ninguna, sirve la mas cercana");
        CHECK(NearestStreetPhrase(0.0f, 0.0f, {}, always) == "la calle", "sin vias: «la calle»");
    }
    if (failures == 0) std::printf("Zonas y vias: todo correcto\n");
    return failures == 0 ? 0 : 1;
}
