#pragma once
// Donde esta el jugador (port de src/ui/ZonaAviso.js, Bogota._zoneAt y momentosTextos.calleCercana): la zona con nombre (para el cartel al entrar a una nueva) y
// la via mas cercana (para la linea bajo el radar). Solo datos y cuentas, sin dibujo ni mundo.
#include <functional>
#include <string>
#include <vector>

namespace Bazuko {

enum class Zone { Cartucho, Parque, Candelaria, Chapinero, Andenes, Barrio, Lago };

// Zona de la ciudad en un punto del mundo (metros): los mismos rectangulos del original. Todo el parque del sur es lago, aunque caiga en los barrios.
Zone ZoneAt(float x, float z);
const char* ZoneName(Zone zone);

struct StreetBand { int first = 0, last = 0; };   // casillas de la via (los dos bordes)
struct StreetLabel {
    std::string name;
    float x = 0.0f, z = 0.0f;   // metros; `x` si es vertical (una carrera), `z` si no (una calle)
    bool vertical = true;
    bool hasMinX = false;       // calles propias del oriente: solo existen al este de esta X
    float minX = 0.0f;
};

// Nombres de vias en metros (streetLabels del original): las carreras y calles de la ciudad, la Caracas y las calles propias del oriente
std::vector<StreetLabel> StreetLabels(const std::vector<StreetBand>& carreras, const std::vector<std::string>& carrerasNames,
                                      const std::vector<StreetBand>& calles, const std::vector<std::string>& callesNames,
                                      const StreetBand& caracasLeftLane, const StreetBand& caracasRightLane, float tileSize);

// «la Carrera 10», «la Caracas», «la calle»: la via mas cercana de verdad. `isRoad(x, z)` dice si hay calzada en un punto: una via que no pasa a la altura del
// jugador no cuenta, salvo que ninguna pase.
std::string NearestStreetPhrase(float x, float z, const std::vector<StreetLabel>& labels, const std::function<bool(float, float)>& isRoad);

} // namespace Bazuko
