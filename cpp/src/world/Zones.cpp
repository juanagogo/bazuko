#include "Zones.hpp"

#include <algorithm>
#include <cmath>

namespace Bazuko {

namespace {
// Los rectangulos de Bogota._zoneAt, ya en metros (las casillas del trazado original ampliado con las calles)
constexpr float kCartuchoX0 = 29.0f, kCartuchoX1 = 56.0f, kCartuchoZ0 = 46.0f, kCartuchoZ1 = 64.0f;
constexpr float kParqueX0 = 98.0f, kParqueX1 = 116.0f, kParqueZ0 = 90.0f, kParqueZ1 = 114.0f;
constexpr float kEastSeamX = 238.0f;                  // desde la Carrera 5 mandan La Candelaria y Chapinero
constexpr float kCandelariaEndZ = 120.0f;             // frontera entre los dos barrios
constexpr float kOriginalWidth = 148.0f, kOriginalHeight = 120.0f;   // la ciudad anterior; mas alla son los barrios
constexpr float kLakeZ0 = 222.0f, kLakeZ1 = 318.0f;   // el Parque del Lago
}

Zone ZoneAt(float x, float z) {
    if (z >= kLakeZ0 && z <= kLakeZ1 && x < kEastSeamX) return Zone::Lago;
    if (x >= kCartuchoX0 && x <= kCartuchoX1 && z >= kCartuchoZ0 && z <= kCartuchoZ1) return Zone::Cartucho;
    if (x >= kParqueX0 && x <= kParqueX1 && z >= kParqueZ0 && z <= kParqueZ1) return Zone::Parque;
    if (x >= kEastSeamX) return z < kCandelariaEndZ ? Zone::Candelaria : Zone::Chapinero;
    return x < kOriginalWidth && z < kOriginalHeight ? Zone::Andenes : Zone::Barrio;
}

const char* ZoneName(Zone zone) {
    switch (zone) {
        case Zone::Cartucho: return "El Cartucho";
        case Zone::Parque: return "Parque Tercer Milenio";
        case Zone::Candelaria: return "La Candelaria";
        case Zone::Chapinero: return "Chapinero";
        case Zone::Andenes: return "El centro";
        case Zone::Barrio: return "Los barrios";
        case Zone::Lago: return "Parque del Lago";
    }
    return "";
}

std::vector<StreetLabel> StreetLabels(const std::vector<StreetBand>& carreras, const std::vector<std::string>& carrerasNames,
                                      const std::vector<StreetBand>& calles, const std::vector<std::string>& callesNames,
                                      const StreetBand& caracasLeftLane, const StreetBand& caracasRightLane, float tileSize) {
    const auto mid = [&](int a, int b) { return (static_cast<float>(a) + static_cast<float>(b)) * 0.5f * tileSize; };
    std::vector<StreetLabel> out;
    for (size_t i = 0; i < carreras.size() && i < carrerasNames.size(); ++i) out.push_back({carrerasNames[i], mid(carreras[i].first, carreras[i].last), 0.0f, true, false, 0.0f});
    out.push_back({"Av. Caracas", mid(caracasLeftLane.first, caracasRightLane.last), 0.0f, true, false, 0.0f});
    for (size_t i = 0; i < calles.size() && i < callesNames.size(); ++i) out.push_back({callesNames[i], 0.0f, mid(calles[i].first, calles[i].last), false, false, 0.0f});
    // calles propias del oriente (EAST_LABELLED_*): su nombre no se pinta en el centro
    out.push_back({"Carrera 4", mid(154, 157), 0.0f, true, false, 0.0f});
    out.push_back({"Carrera 3", mid(174, 177), 0.0f, true, false, 0.0f});
    const float east = carreras.empty() ? 0.0f : mid(carreras.back().first, carreras.back().last);
    out.push_back({"Calle 8A", 0.0f, mid(56, 59), false, true, east});
    out.push_back({"Calle 6", 0.0f, mid(118, 123), false, true, east});
    out.push_back({"Calle 5", 0.0f, mid(140, 145), false, true, east});
    return out;
}

std::string NearestStreetPhrase(float x, float z, const std::vector<StreetLabel>& labels, const std::function<bool(float, float)>& isRoad) {
    const StreetLabel* best = nullptr; float bestDistance = 0.0f;
    const StreetLabel* fallback = nullptr; float fallbackDistance = 0.0f;
    for (const StreetLabel& label : labels) {
        if (label.hasMinX && x < label.minX) continue;
        const float distance = label.vertical ? std::abs(x - label.x) : std::abs(z - label.z);
        if (!fallback || distance < fallbackDistance) { fallback = &label; fallbackDistance = distance; }
        if (isRoad && !(label.vertical ? isRoad(label.x, z) : isRoad(x, label.z))) continue;
        if (!best || distance < bestDistance) { best = &label; bestDistance = distance; }
    }
    const StreetLabel* chosen = best ? best : fallback;
    if (!chosen) return "la calle";
    std::string name = chosen->name;
    if (name.rfind("Av. ", 0) == 0) name = name.substr(4);
    return "la " + name;
}

} // namespace Bazuko
